"""Depth maps for card pictures, for the app's spatial picture effect (release 1.0.6).

For each picture shown on a card in the last 3 days, a depth map (white = near, black = far) is made with the
free Depth Anything V2 Small model and saved as covers/depth/<key>.jpg, where <key> comes from the picture's
address (pic_key below; the app works out the same key). Old depth maps are deleted after 5 days.
A picture without a depth map simply shows without the effect, so nothing breaks if this job is late or off.
Run by .github/workflows/depth.yml every hour. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY.
"""
import io
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from PIL import Image
from supabase import create_client

BUCKET = "covers"
FOLDER = "depth"
PER_RUN = int(os.getenv("DEPTH_PER_RUN", "250"))
KEEP_DAYS = 5
WIDTH = 512
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def pic_key(url):
    """Two 32-bit FNV-1a hashes of the picture address (the app's picKey gives the same 16 characters)."""
    a, b = 0x811C9DC5, 0x5BD1E995
    for ch in url:
        c = ord(ch) & 0xFF
        a = ((a ^ c) * 0x01000193) & 0xFFFFFFFF
        b = ((b ^ c) * 0x01000193) & 0xFFFFFFFF
    return f"{a:08x}{b:08x}"


def existing(store):
    """Depth maps already saved: {name: created_at}."""
    out, offset = {}, 0
    while True:
        part = store.list(FOLDER, {"limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}) or []
        for f in part:
            if f.get("name", "").endswith(".jpg"):
                out[f["name"]] = f.get("created_at") or ""
        if len(part) < 1000:
            return out
        offset += 1000


def main():
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    store = db.storage.from_(BUCKET)
    now = datetime.now(timezone.utc)
    rows = (db.table("stories").select("image_url,created_at").gte("created_at", (now - timedelta(days=3)).isoformat())
            .not_.is_("image_url", "null").order("created_at", desc=True).limit(1500).execute().data)
    urls = list(dict.fromkeys(r["image_url"] for r in rows if (r.get("image_url") or "").startswith("http")))
    have = existing(store)
    todo = [u for u in urls if f"{pic_key(u)}.jpg" not in have]
    print(f"{len(urls)} pictures on recent cards, {len(have)} depth maps saved, {len(todo)} to make (max {PER_RUN} this run)")

    made = failed = 0
    if todo:
        from transformers import pipeline as hf_pipeline
        model = hf_pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
        started = time.time()
        for u in todo[:PER_RUN]:
            if time.time() - started > 25 * 60:
                print("[stop] 25 minutes used, the rest waits for the next run")
                break
            try:
                req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "image/*"})
                img = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=20).read(8_000_000))).convert("RGB")
                if img.width > 1024:
                    img = img.resize((1024, round(1024 * img.height / img.width)), Image.LANCZOS)
                d = model(img)["depth"].convert("L").resize((WIDTH, max(1, round(WIDTH * img.height / img.width))), Image.BICUBIC)
                buf = io.BytesIO()
                d.save(buf, "JPEG", quality=82)
                store.upload(f"{FOLDER}/{pic_key(u)}.jpg", buf.getvalue(),
                             {"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
                made += 1
            except Exception as ex:
                failed += 1
                print(f"[warn] {u[:90]}: {str(ex)[:120]}")

    # old ones go after 5 days (cards that old have scrolled far away)
    cut = (now - timedelta(days=KEEP_DAYS)).isoformat()
    old = [f"{FOLDER}/{n}" for n, at in have.items() if at and at < cut]
    for i in range(0, len(old), 100):
        store.remove(old[i:i + 100])
    note = f"{made} depth maps made, {failed} failed, {len(old)} old ones deleted, {max(0, len(todo) - made - failed)} waiting"
    print(f"::notice title=Depth maps::{note}")


if __name__ == "__main__":
    if "--key" in sys.argv:
        print(pic_key(sys.argv[-1]))
    else:
        main()
