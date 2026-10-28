"""
Makes the backup picture library: 20 ready-made pictures per category, used only when every picture
service fails. Made on AI Horde (free), so it doesn't use the Cloudflare allowance.
Uploads to Supabase Storage bucket "covers" under library/<category>-NN.jpg and writes a contact sheet.
"""
import io, json, os, sys, time, urllib.error, urllib.request

from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
API = "https://aihorde.net/api/v2"
KEY = os.getenv("AI_HORDE_KEY", "").strip() or "0000000000"
HEAD = {"apikey": KEY, "Client-Agent": "CyberSid:1.0:cybershortapp.github.io", "Content-Type": "application/json",
        "Accept": "application/json", "User-Agent": "CyberSid/1.0 (+https://cybershortapp.github.io/cybershorts/)"}
STYLE = ("A premium glossy 3D render of {scene}, one centred sculptural object floating on a smooth seamless {bg} background, "
         "soft studio lighting, subtle reflections, soft shadow underneath, bright cheerful accent colours, minimal and elegant, "
         "Apple product photography style, lots of empty space around the object")
NEG = "text, letters, words, numbers, logo, watermark, brand, signature, people, faces, hands, dark background, nsfw, nude"
CATS = {
 "ransomware": ("soft peach", [
   "a server rack wrapped in heavy steel chains with a big gold padlock", "a laptop locked inside a glass safe with a paper tag hanging from the handle",
   "a stack of folders sealed with a chunky red padlock and chain", "a small factory control panel covered by a large padlock",
   "a toy city building made of blocks with a big padlock on its door", "a hard drive inside a bird cage with a golden key hanging out of reach",
   "a cargo container chained shut with a big padlock", "a school backpack and a laptop locked together with a chain",
   "a soft foam cloud with a big padlock in front of it", "a hospital clipboard and stethoscope locked inside a small cage"]),
 "breaches": ("soft sky blue", [
   "an open filing cabinet with blank paper ID cards flying out", "a cracked piggy bank with tiny blank cards spilling out",
   "a broken glass jar with blank envelopes floating out", "a laptop with a stream of tiny blank paper documents flying out of the screen",
   "a house-shaped mailbox overflowing with blank letters blowing away", "a cracked glass tank with small glowing cubes spilling out",
   "an open suitcase with blank booklets and cards flying away", "a cracked database cylinder with glowing cubes escaping",
   "a shopping bag with blank receipts and cards falling out", "a smartphone with a small door open and blank contact cards flying out"]),
 "vulnerabilities": ("pale mint", [
   "a shield with a crack and a tiny toy bug walking through it", "a brick wall with one missing brick and a small toy bug peeking in",
   "a home wifi router with a small crack and a toy bug on top", "a puzzle box with one missing piece glowing softly",
   "a padlock with a bent key stuck in it", "a window with a crack and a tiny ladder leaning against it",
   "a magnifying glass over a cracked shield", "a gear machine with one broken tooth on a gear",
   "a laptop with a sticking plaster patch on its lid", "a small castle gate with a loose broken hinge"]),
 "scams": ("soft butter yellow", [
   "a smartphone with a shiny fishing hook dangling in front of it", "a fishing hook holding a wrapped gift box",
   "a mousetrap with a blank credit card as bait", "an envelope with a fishing hook coming out of it",
   "a small treasure chest with a fishing hook inside", "a golden key on a fishing hook above a laptop",
   "a wrapped present with a fishing hook hidden under the ribbon", "a gold coin on a string being pulled away",
   "a parcel box with a fishing hook stuck in its side", "a smartphone inside a mousetrap"]),
 "policy": ("soft lilac", [
   "a classical government building with a shield above it", "a wooden gavel resting beside a laptop",
   "a balance scale with a padlock on one side and a laptop on the other", "a rolled blank document with a wax seal and a small shield",
   "a podium with a microphone and a shield", "a globe with small shields placed around it",
   "a stack of books with a padlock on top", "a rubber stamp beside a blank document",
   "a leather briefcase with a shield emblem", "a fountain pen signing a blank document with a shield"]),
 "tools": ("soft coral pink", [
   "a neat toolbox of security tools beside a laptop", "a wrench and a shield crossed",
   "a small robot arm tightening a bolt on a server", "a magnifying glass, a key and a shield on a desk",
   "a laptop with gears floating above it", "a security camera on a small stand",
   "a hardware security key on a keyring", "a small radar dish scanning",
   "a lighthouse on a small island shining a beam of light", "a microscope looking at a tiny toy bug"]),
 "other": ("soft lavender", [
   "a globe made of connected glowing nodes with a shield in front", "a satellite orbiting a small planet",
   "a chess board with a knight piece and a small shield", "a hot air balloon carrying a small server",
   "a small rocket next to a shield", "a toy city skyline of blocks with glowing windows",
   "a brass compass on a folded map", "a lightbulb with a small shield inside",
   "an hourglass filled with small glowing cubes", "a paper airplane carrying an envelope"]),
}

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers=HEAD,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())

def submit(cat, i):
    bg, scenes = CATS[cat]
    prompt = STYLE.format(scene=scenes[i], bg=bg) + " ### " + NEG
    body = {"prompt": prompt, "models": ["Juggernaut XL", "AlbedoBase XL (SDXL)"], "nsfw": False, "censor_nsfw": True,
            "r2": True, "shared": False, "slow_workers": True,
            "params": {"width": 1024, "height": 576, "steps": 25, "n": 2, "sampler_name": "k_euler_a", "cfg_scale": 6}}
    return call("POST", "/generate/async", body)["id"]

db = None
if os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY"):
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

todo = [(c, i) for c in CATS for i in range(len(CATS[c][1]))]
only = os.getenv("ONLY", "").strip()
if only:
    todo = [t for t in todo if t[0] in only.split(",")]
running, saved, log, thumbs = {}, {}, [], []
t0 = time.time()
while (todo or running) and time.time() - t0 < 5.5 * 3600:
    while todo and len(running) < int(os.getenv("PARALLEL", "4")):
        c, i = todo.pop(0)
        try:
            running[submit(c, i)] = (c, i, time.time())
        except urllib.error.HTTPError as ex:
            log.append(f"submit {c} {i}: HTTP {ex.code} {ex.read()[:160]}")
            todo.append((c, i))
            time.sleep(20)
            break
    time.sleep(8)
    for jid, (c, i, started) in list(running.items()):
        try:
            st = call("GET", f"/generate/check/{jid}")
        except Exception as ex:
            continue
        if st.get("faulted") or not st.get("is_possible", True) or time.time() - started > 1500:
            log.append(f"{c} {i}: gave up ({st.get('faulted')}, possible {st.get('is_possible')})")
            del running[jid]
            continue
        if not st.get("done"):
            continue
        del running[jid]
        try:
            gens = call("GET", f"/generate/status/{jid}")["generations"]
        except Exception as ex:
            log.append(f"{c} {i}: status failed {ex}")
            continue
        for k, g in enumerate(gens):
            if g.get("censored"):
                log.append(f"{c} {i}.{k}: censored, skipped")
                continue
            try:
                with urllib.request.urlopen(urllib.request.Request(g["img"], headers={"User-Agent": HEAD["User-Agent"]}), timeout=60) as r:
                    im = Image.open(io.BytesIO(r.read())).convert("RGB")
            except Exception as ex:
                log.append(f"{c} {i}.{k}: download failed {ex}")
                continue
            lo, hi = im.convert("L").getextrema()
            if hi - lo < 40:
                log.append(f"{c} {i}.{k}: blank, skipped")
                continue
            n = saved.get(c, 0) + 1
            saved[c] = n
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
            name = f"library/{c}-{n:02d}.jpg"
            if db:
                db.storage.from_("covers").upload(name, buf.getvalue(), {"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
            thumbs.append((c, im.resize((256, 144))))
            log.append(f"saved {name} ({g.get('model')}) after {time.time() - started:.0f}s")

# contact sheet per category
for c in CATS:
    ims = [t for cc, t in thumbs if cc == c]
    if not ims:
        continue
    sheet = Image.new("RGB", (5 * 260, ((len(ims) + 4) // 5) * 148), "white")
    for k, t in enumerate(ims):
        sheet.paste(t, ((k % 5) * 260, (k // 5) * 148))
    sheet.save(os.path.join(out, f"sheet-{c}.jpg"), "JPEG", quality=80)
summary = f"saved per category: {json.dumps(saved)} in {time.time() - t0:.0f}s"
log.append(summary)
open(os.path.join(out, "library.txt"), "w").write("\n".join(log) + "\n")
print("\n".join(log))
print("::notice::" + summary)
