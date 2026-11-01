"""Depth maps for a few of our own AI card pictures (Depth Anything V2 Small), for the spatial picture prototype.
Writes <id>.jpg (the picture, 900 px wide) and <id>-depth.png (white = near) to the output folder."""
import io, os, sys, urllib.request
from PIL import Image
from transformers import pipeline
out = sys.argv[1]
URLS = [u for u in os.environ["URLS"].split() if u]
pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
for u in URLS:
    key = u.rsplit("/", 1)[1].split("-")[0][:16].replace(":", "_")
    img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "CyberSid/1.0"})).read())).convert("RGB")
    img = img.resize((900, round(900 * img.height / img.width)), Image.LANCZOS)
    d = pipe(img)["depth"].convert("L").resize(img.size, Image.BICUBIC)
    img.save(f"{out}/{key}.jpg", quality=86)
    d.save(f"{out}/{key}-depth.png")
    print("done", key, img.size)
