import { Asset } from 'expo-asset';
import { type ExpoWebGLRenderingContext, GLView } from 'expo-gl';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image as RNImage, Platform, StyleSheet } from 'react-native';

/**
 * The spatial picture (release 1.0.6): like a spatial scene in the iPhone Photos app, the parts of the picture
 * that are near (a phone, a padlock) move against the background as the reader tilts the phone, so the
 * picture looks 3D. It sits on top of the card's normal picture, inside the same slow zoom, and fades in once
 * it's ready. Only on the card on screen.
 *
 * The depth map (white = near) is made on our server for each picture (pipeline/depth.py) and saved as
 * covers/depth/<picKey(picture address)>.jpg. No depth map yet, Reduce Motion on, or anything fails: the card
 * simply keeps its normal picture.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/** Two 32-bit FNV-1a hashes of the picture address: the same 16 characters as pic_key in pipeline/depth.py. */
export function picKey(url: string) {
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i) & 0xff;
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
export const depthUrl = (picture: string) => `${BASE}/storage/v1/object/public/covers/depth/${picKey(picture)}.jpg`;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});

// ---- the phone's tilt, shared; the motion sensor is only on while a spatial picture is on screen ----
const tilt = { x: 0, y: 0 };
let users = 0;
let sub: { remove(): void } | null = null;
let rest: { b: number; g: number } | null = null;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
function startMotion() {
  users += 1;
  if (sub) return;
  rest = null;
  try {
    DeviceMotion.setUpdateInterval(33);
    sub = DeviceMotion.addListener((m) => {
      const r = m?.rotation;
      if (!r) return;
      const k = Math.abs(r.beta) > 7 || Math.abs(r.gamma) > 7 ? Math.PI / 180 : 1; // degrees on some phones
      const b = r.beta * k;
      const g = r.gamma * k;
      if (!rest) rest = { b, g };
      // the "level" position follows slowly, so however the phone is held, the picture settles back to centre
      rest.b += (b - rest.b) * 0.01;
      rest.g += (g - rest.g) * 0.01;
      // a small tilt (about 10 degrees) already moves the picture fully
      tilt.x = clamp((g - rest.g) / 0.18);
      tilt.y = clamp((b - rest.b) / 0.18);
    });
  } catch {
    sub = null;
  }
}
function stopMotion() {
  users = Math.max(0, users - 1);
  if (users === 0 && sub) {
    sub.remove();
    sub = null;
    tilt.x = tilt.y = 0;
  }
}

const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
const FRAG = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uImg;
uniform sampler2D uDep;
uniform vec2 uTilt;
uniform float uK;
uniform vec2 uScale;
void main() {
  vec2 p = 0.5 + (vec2(vUv.x, 1.0 - vUv.y) - 0.5) * uScale / 1.035;
  vec2 q = p;
  for (int i = 0; i < 6; i++) {
    float d = texture2D(uDep, q).r;
    q = p - uTilt * (d - 0.42) * uK;
  }
  gl_FragColor = texture2D(uImg, q);
}`;

const sizeOf = (uri: string) => new Promise<number>((ok) => RNImage.getSize(uri, (w, h) => ok(w / Math.max(1, h)), () => ok(16 / 9)));

async function textureSource(uri: string): Promise<unknown> {
  if (Platform.OS === 'web') {
    // the browser build (only used for testing): wait for the picture to load before it becomes a texture
    return new Promise((ok, no) => {
      const img = new (globalThis as unknown as { Image: new () => HTMLImageElement }).Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => ok(img);
      img.onerror = no;
      img.src = uri;
    });
  }
  const a = await Asset.fromURI(uri).downloadAsync();
  if (!a.localUri) throw new Error('not downloaded');
  return a;
}

export function SpatialPicture({ uri, active }: { uri: string; active: boolean }) {
  const [depth, setDepth] = useState<string | null>(null);

  // is there a depth map for this picture yet? (a quick check, so a missing one never shows a broken picture)
  useEffect(() => {
    let live = true;
    setDepth(null);
    if (!active || reduceMotion || !uri || !BASE) return;
    const d = depthUrl(uri);
    fetch(d, { method: 'HEAD' })
      .then((r) => { if (live && r.ok) setDepth(d); })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uri, active]);

  if (!depth || !active) return null;
  return <SpatialGL key={depth} uri={uri} depth={depth} />;
}

/**
 * The drawing itself. Its GL context is destroyed the moment this view goes (the reader swipes on), so every
 * use of it is guarded: the layout-effect clean-up runs before the view is removed and stops the drawing, and
 * code that resumes after a download checks that it is still wanted. Touching a destroyed context crashes the
 * app, which is what build 3 of the 1.0.6 test app did.
 */
function SpatialGL({ uri, depth }: { uri: string; depth: string }) {
  const fade = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);
  const stop = useRef<() => void>(() => {});
  useLayoutEffect(
    () => () => {
      gone.current = true;
      stop.current();
    },
    [],
  );

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    if (gone.current) return;
    let raf = 0;
    let motion = false;
    stop.current = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (motion) stopMotion();
      motion = false;
    };
    try {
      const [imgSrc, depSrc, aspect] = await Promise.all([textureSource(uri), textureSource(depth), sizeOf(uri)]);
      if (gone.current) return;
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const upload = (unit: number, src: unknown) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gl.texImage2D as any)(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      };
      upload(0, imgSrc);
      upload(1, depSrc);
      gl.uniform1i(gl.getUniformLocation(prog, 'uImg'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uDep'), 1);
      const uTilt = gl.getUniformLocation(prog, 'uTilt');
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const ca = w / Math.max(1, h);
      // fill the frame like the normal picture does ("cover")
      gl.uniform2f(gl.getUniformLocation(prog, 'uScale'), aspect > ca ? ca / aspect : 1, aspect > ca ? 1 : aspect / ca);
      gl.uniform1f(gl.getUniformLocation(prog, 'uK'), 0.06); // how far near things move: 0.035 in build 5 was too subtle
      gl.viewport(0, 0, w, h);

      startMotion();
      motion = true;
      const now = { x: 0, y: 0 };
      let last = 0;
      let shown = false;
      const draw = (t: number) => {
        raf = 0;
        if (gone.current) return;
        raf = requestAnimationFrame(draw);
        if (t - last < 30) return; // about 30 frames a second is plenty and easy on the battery
        last = t;
        // the phone's tilt, plus a very gentle sway so the picture never looks frozen
        // a gentle sway on its own too (about one slow sway every 6 seconds), so the depth is easy to see
        const sx = Math.sin(t / 950) * 0.55;
        const sy = Math.sin(t / 1400 + 1.3) * 0.35;
        now.x += (tilt.x + sx - now.x) * 0.22;
        now.y += (tilt.y + sy - now.y) * 0.22;
        gl.uniform2f(uTilt, clamp(now.x), -clamp(now.y));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.endFrameEXP();
        if (!shown) {
          shown = true;
          Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
        }
      };
      if (!gone.current) raf = requestAnimationFrame(draw);
    } catch {
      stop.current();
    }
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
    </Animated.View>
  );
}
