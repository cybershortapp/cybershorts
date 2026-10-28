"""
Tries AI Horde (free, volunteer-run) as a second picture service. Read-only test, nothing is saved to the app.
Writes the pictures and a timing report into the folder given as the first argument.
"""
import json, os, sys, time, urllib.error, urllib.request

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
API = "https://aihorde.net/api/v2"
KEY = os.getenv("AI_HORDE_KEY", "").strip() or "0000000000"
HEAD = {"apikey": KEY, "Client-Agent": "CyberSid:1.0:cybershortapp.github.io", "Content-Type": "application/json"}
log = []

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers=HEAD,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())

try:
    models = call("GET", "/status/models?type=image")
except urllib.error.HTTPError as ex:
    models = []
    log.append(f"models list: HTTP {ex.code} {ex.read()[:300]}")
except Exception as ex:
    models = []
    log.append(f"models list: error {str(ex)[:200]}")
models.sort(key=lambda m: -m.get("count", 0))
flux = [m for m in models if "flux" in m["name"].lower()]
log.append("top models: " + "; ".join(f"{m['name']} x{m['count']} q{m.get('queued', 0)} eta{m.get('eta', 0)}" for m in models[:12]))
log.append("flux models: " + "; ".join(f"{m['name']} x{m['count']} eta{m.get('eta', 0)}" for m in flux))

STYLE = ("A premium glossy 3D render of {scene}, presented as one centred sculptural object floating on a smooth seamless "
         "{bg} background, soft studio lighting, subtle reflections, gentle soft shadow underneath, bright saturated accent colours, "
         "minimal and elegant like an Apple product photograph, generous empty space around the object")
NEG = "text, letters, words, numbers, logo, watermark, brand name, signature, people faces, dark background"
tests = [("flux", "a large cargo ship stacked with colourful shipping containers, one red container wrapped in heavy steel chains with a big gold padlock", "soft peach"),
         ("sdxl", "a sleek home media server box with its lid cracked open and shiny gold coins spilling out", "soft lavender")]
for kind, scene, bg in tests:
    prompt = STYLE.format(scene=scene, bg=bg) + " ### " + NEG
    if kind == "flux" and flux:
        models_ = [flux[0]["name"]]
        params = {"width": 1024, "height": 576, "steps": 6, "n": 1, "sampler_name": "k_euler", "cfg_scale": 1}
    else:
        sd = [m["name"] for m in models if any(k in m["name"].lower() for k in ("albedobase", "juggernaut", "dreamshaper xl", "sdxl"))]
        models_ = sd[:3] or ([models[0]["name"]] if models else [])
        params = {"width": 1024, "height": 576, "steps": 25, "n": 1, "sampler_name": "k_euler_a", "cfg_scale": 6}
    t0 = time.time()
    try:
        job = call("POST", "/generate/async", {"prompt": prompt, "params": params, "models": models_, "nsfw": False,
                                               "censor_nsfw": True, "r2": True, "shared": False, "slow_workers": True})
        jid = job["id"]
        log.append(f"{kind}: queued {jid} models {models_} kudos {job.get('kudos')}")
        while time.time() - t0 < 420:
            time.sleep(6)
            st = call("GET", f"/generate/check/{jid}")
            if st.get("faulted") or not st.get("is_possible", True):
                log.append(f"{kind}: faulted/not possible {st}")
                break
            if st.get("done"):
                res = call("GET", f"/generate/status/{jid}")
                g = res["generations"][0]
                with urllib.request.urlopen(urllib.request.Request(g["img"], headers={"User-Agent": "CyberSid/1.0"}), timeout=60) as r:
                    data = r.read()
                open(os.path.join(out, f"horde-{kind}.webp"), "wb").write(data)
                log.append(f"{kind}: done in {time.time() - t0:.0f}s model {g.get('model')} censored {g.get('censored')} bytes {len(data)}")
                break
        else:
            log.append(f"{kind}: timed out after 420s, last {st}")
    except urllib.error.HTTPError as ex:
        log.append(f"{kind}: HTTP {ex.code} {ex.read()[:300]}")
    except Exception as ex:
        log.append(f"{kind}: error {str(ex)[:200]}")
open(os.path.join(out, "horde.txt"), "w").write("\n".join(log) + "\n")
print("\n".join(log))
for line in log:
    print("::notice::" + line.replace("\n", " ")[:900])
