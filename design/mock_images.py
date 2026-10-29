"""Makes a few pictures for the design mockups on AI Horde (free). Saves JPEGs to the folder given."""
import io, json, os, sys, time, urllib.request
from PIL import Image
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
API = "https://aihorde.net/api/v2"
HEAD = {"apikey": os.getenv("AI_HORDE_KEY", "") or "0000000000", "Client-Agent": "CyberSid:1.0:cybershortapp.github.io",
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "CyberSid/1.0 (+https://cybershortapp.github.io/cybershorts/)"}
STYLE = ("A premium glossy 3D render of {scene}, floating on a smooth seamless {bg} background, soft studio lighting, "
         "subtle reflections, soft shadow, bright cheerful accent colours, minimal and elegant, Apple product photography style")
NEG = " ### text, letters, words, numbers, logo, watermark, brand, signature, people, faces, hands, dark background, nsfw"
JOBS = {
 "t-sandbox": ("a transparent glass cube with a small browser window inside and five golden chain links breaking out through a crack in the glass", "soft sky blue", 1024, 576),
 "t-stage": ("a small golden trophy cup on a tiny stage with a spotlight and a laptop on a podium", "soft lilac", 1024, 576),
 "t-update": ("a browser window with a glowing green shield and a circular update arrow", "pale mint", 1024, 576),
 "t-turtle": ("a cute sea turtle toy carrying a road signpost with arrows pointing different ways", "soft aqua", 1024, 576),
 "g-house": ("a cute isometric cutaway toy house with four rooms showing a wifi router, a laptop, a smartphone and a piggy bank", "soft lavender", 768, 768),
 "g-vault": ("a big round bank vault door with a glowing combination dial", "soft mint", 768, 768),
 "g-pizza": ("a pizza delivery box with a broken padlock and tiny blank cards flying out of it", "soft peach", 1024, 576),
 "g-mail": ("an open envelope with three small red flags sticking out of the letter", "soft sky blue", 768, 768),
}
def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers=HEAD, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())
running = {}
for name, (scene, bg, w, h) in JOBS.items():
    for attempt in range(3):
        try:
            jid = call("POST", "/generate/async", {"prompt": STYLE.format(scene=scene, bg=bg) + NEG, "models": ["Juggernaut XL", "AlbedoBase XL (SDXL)"],
                       "nsfw": False, "censor_nsfw": True, "r2": True, "shared": False, "slow_workers": True,
                       "params": {"width": w, "height": h, "steps": 25, "n": 2, "sampler_name": "k_euler_a", "cfg_scale": 6}})["id"]
            running[jid] = name
            break
        except Exception as ex:
            print("submit", name, ex); time.sleep(3)
    time.sleep(1.2)
t0 = time.time()
while running and time.time() - t0 < 2400:
    time.sleep(10)
    for jid, name in list(running.items()):
        try:
            st = call("GET", f"/generate/check/{jid}")
        except Exception:
            continue
        if st.get("faulted"):
            print(name, "faulted"); del running[jid]; continue
        if not st.get("done"):
            continue
        del running[jid]
        for k, g in enumerate(call("GET", f"/generate/status/{jid}")["generations"]):
            if g.get("censored"):
                print(name, k, "censored"); continue
            with urllib.request.urlopen(urllib.request.Request(g["img"], headers={"User-Agent": HEAD["User-Agent"]}), timeout=60) as r:
                Image.open(io.BytesIO(r.read())).convert("RGB").save(os.path.join(out, f"{name}-{k}.jpg"), "JPEG", quality=86)
            print("saved", name, k, f"{time.time()-t0:.0f}s")
print("left", list(running.values()))
