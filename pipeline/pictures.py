"""Our own copy of each news-site picture (release 1.0.4).

Some news sites' pictures load fine on a server but not in the app on some phones (seen with note.com and
Iran International), some are huge (a 14 MB photo), and some sites later block apps or change their links.
So for every recent story with a news-site picture, the server saves a small JPEG copy (at most 1080 px wide)
in our own storage (bucket "pictures") and the story points at that copy. The app loads it exactly like the
AI pictures, which work everywhere, and still credits the news site ("Image: <source>").
Copies of stories older than KEEP_DAYS are deleted so the free storage never fills up.
"""
import io
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageOps

BUCKET = "pictures"
MAX_W, MAX_H = 1080, 1080
MAX_BYTES = 25_000_000     # never download more than this
MIN_W = 480                # smaller ones are left as they are (the AI picture step deals with them)
KEEP_DAYS = 45
OURS = "/storage/v1/object/public/"
APP_UA = "okhttp/4.12.0"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def is_ours(url):
    return bool(url) and OURS in url


def _download(url):
    """The picture's bytes, trying the app's way first and then a browser's. None if it can't be had."""
    for ua in (APP_UA, BROWSER_UA):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "image/webp,image/jpeg,image/png,image/*"})
            with urllib.request.urlopen(req, timeout=15) as r:
                if not r.headers.get("Content-Type", "").lower().startswith("image/"):
                    continue
                data = r.read(MAX_BYTES + 1)
                if 4000 <= len(data) <= MAX_BYTES:
                    return data
        except Exception:
            continue
    return None


def shrink(data):
    """A phone-sized JPEG of the picture, or None if it isn't a real, big enough picture."""
    try:
        im = Image.open(io.BytesIO(data))
        im.draft("RGB", (MAX_W * 2, MAX_H * 2))     # big JPEGs decode quickly at a smaller size
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, (255, 255, 255))
            flat.paste(im, mask=im.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")
    except Exception:
        return None
    if im.width < MIN_W:
        return None
    im.thumbnail((MAX_W, MAX_H), Image.LANCZOS)
    lo, hi = im.convert("L").getextrema()
    if hi - lo < 25:          # one flat colour: an error image, not a picture
        return None
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80, optimize=True, progressive=True)
    return out.getvalue()


def _bucket(db):
    """Make the public bucket the first time (the server key is allowed to)."""
    try:
        db.storage.get_bucket(BUCKET)
    except Exception:
        db.storage.create_bucket(BUCKET, options={"public": True, "file_size_limit": 1_048_576, "allowed_mime_types": ["image/jpeg"]})


def copy_pictures(db, since, limit=40, deadline=None):
    """Copy the news-site pictures of stories created after `since`. Returns a short note for the run summary."""
    rows = (db.table("stories").select("id,image_url").not_.is_("image_url", "null").gte("created_at", since)
            .order("created_at", desc=True).limit(300).execute().data)
    theirs = [r for r in rows if r["image_url"].startswith("http") and not is_ours(r["image_url"])]
    todo = theirs[:limit]
    if not todo:
        return "none needed"
    _bucket(db)
    store = db.storage.from_(BUCKET)
    with ThreadPoolExecutor(6) as pool:
        files = list(pool.map(lambda r: _download(r["image_url"]), todo))
    copied, skipped = 0, 0
    for r, raw in zip(todo, files):
        if deadline and datetime.now(timezone.utc) > deadline:
            break
        jpg = shrink(raw) if raw else None
        if not jpg:
            skipped += 1     # kept as it is; the picture re-check still watches it
            continue
        path = f"{r['id']}.jpg"
        try:
            store.upload(path, jpg, {"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
            url = store.get_public_url(path).rstrip("?")
            db.table("stories").update({"image_url": url}).eq("id", r["id"]).eq("image_url", r["image_url"]).execute()
            copied += 1
        except Exception as ex:
            print(f"[warn] picture copy {r['id'][:10]}: {str(ex)[:80]}")
            skipped += 1
    left = len(theirs) - len(todo)
    return f"{copied} copied" + (f", {skipped} left as they are" if skipped else "") + (f", {left} waiting" if left else "")


def cleanup_old_copies(db, days=KEEP_DAYS, limit=60):
    """Delete copies of stories older than `days` (their cards fall back to the app's own artwork)."""
    before = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = (db.table("stories").select("id,image_url").like("image_url", f"%{OURS}{BUCKET}/%")
            .or_("category.is.null,category.neq.History").lt("published_at", before).limit(limit).execute().data)
    if not rows:
        return 0
    db.storage.from_(BUCKET).remove([f"{r['id']}.jpg" for r in rows])
    for r in rows:
        db.table("stories").update({"image_url": None}).eq("id", r["id"]).execute()
    return len(rows)


if __name__ == "__main__":
    # offline check of the shrinking (no database, no network)
    big = Image.new("RGB", (4000, 2600))
    for x in range(0, 4000, 50):
        big.paste((x % 255, 80, 200), (x, 0, x + 25, 2600))
    b = io.BytesIO(); big.save(b, "PNG")
    out = shrink(b.getvalue())
    im = Image.open(io.BytesIO(out))
    print("big png ->", im.size, len(out) // 1024, "KB")
    flat = Image.new("RGB", (1200, 600), (240, 240, 240)); b = io.BytesIO(); flat.save(b, "PNG")
    print("flat ->", shrink(b.getvalue()))
    small = Image.new("RGB", (300, 200), (10, 200, 30)); b = io.BytesIO(); small.save(b, "JPEG")
    print("small ->", shrink(b.getvalue()))
    rgba = Image.new("RGBA", (1600, 900), (0, 0, 0, 0))
    for x in range(0, 1600, 40):
        rgba.paste((200, 30, 30, 255), (x, 0, x + 20, 900))
    b = io.BytesIO(); rgba.save(b, "PNG")
    print("rgba ->", Image.open(io.BytesIO(shrink(b.getvalue()))).size)
