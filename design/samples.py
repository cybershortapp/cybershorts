"""
Design samples: tries new picture styles for story cards on Cloudflare Workers AI (FLUX.1 schnell, free tier).
Only for choosing an art direction. Nothing here touches the app, the database or the live pipeline.
Reads design/scenes.json and saves one JPEG per entry into the folder given as the first argument.
"""
import base64, io, json, os, sys, time, urllib.error, urllib.request

from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
account = os.environ["CF_ACCOUNT_ID"].strip().strip("'\"")
token = os.environ["CF_API_TOKEN"].strip().strip("'\"")
url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/black-forest-labs/flux-1-schnell"

spec = json.load(open(os.path.join(os.path.dirname(__file__), "scenes.json")))
styles, scenes, jobs = spec["styles"], spec["scenes"], spec["jobs"]
done, failed = 0, []
for job in jobs:
    scene = scenes[job["scene"]]
    prompt = styles[job["style"]].format(scene=scene["text"], bg=scene.get("bg", "soft cream"))
    name = f'{job["scene"]}-{job["style"]}{job.get("tag", "")}'
    body = json.dumps({"prompt": prompt, "steps": 8}).encode()
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                img = json.loads(r.read())["result"]["image"]
            im = Image.open(io.BytesIO(base64.b64decode(img))).convert("RGB")
            im.save(os.path.join(out, name + ".jpg"), "JPEG", quality=88, optimize=True)
            print("ok", name, im.size)
            done += 1
            break
        except urllib.error.HTTPError as ex:
            print("http", ex.code, name, ex.read()[:200])
            time.sleep(5)
        except Exception as ex:
            print("fail", name, str(ex)[:120])
            time.sleep(5)
    else:
        failed.append(name)
json.dump({"made": done, "failed": failed}, open(os.path.join(out, "result.json"), "w"), indent=1)
print("made", done, "failed", failed)
