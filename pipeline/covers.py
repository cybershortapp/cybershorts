"""
AI cover pictures for stories that have no usable photo of their own.

Every picture uses the same house style (dark navy, cyan / blue / violet glow) so the feed looks like one brand.
Pictures are saved in Supabase Storage (bucket "covers") and shown in the app as "AI illustration".

Providers, tried in order:
  1. Cloudflare Workers AI (FLUX.1 schnell). Free: 10,000 "neurons" a day, about 150 pictures.
     Needs CF_ACCOUNT_ID and CF_API_TOKEN.
  2. Pollinations.ai. Free, no key needed, but slower (about one picture every 15 seconds).
     Set POLLINATIONS=false to turn it off. POLLINATIONS_TOKEN is optional.
"""
import base64, io, json, os, random, re, time, urllib.error, urllib.parse, urllib.request

from PIL import Image

UA = "CyberSid/1.0 (+news cover pictures)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
BUCKET = "covers"
W, H = 1024, 576

STYLE = ("Editorial 3D illustration for a cyber security news story: {scene}. "
         "Clean modern isometric style, dark navy background, glowing cyan, blue and violet light, "
         "soft depth of field, high detail, cinematic lighting, centred subject. "
         "No text, no letters, no numbers, no words, no logos, no watermark, no real people, no faces.")

# used when the AI gave no scene (or for old stories)
FALLBACK_SCENES = {
    "Ransomware": "a server rack wrapped in glowing chains with a large padlock in front",
    "Breaches": "an open vault with streams of glowing data files flying out",
    "Vulnerabilities": "a cracked glowing shield with a small bug crawling through the gap",
    "Scams": "a smartphone showing a fake message with a fishing hook hanging over it",
    "Policy": "a government building made of glowing circuit lines with a shield above it",
    "Tools": "a neat toolbox of glowing security tools beside a laptop",
    "Other": "a glowing globe of connected network nodes with a shield in front",
}
BAD_SCENE = re.compile(r"\b(logo|text|word|letter|sign reading|headline|photo of)\b", re.I)


def cover_prompt(scene, category):
    scene = re.sub(r"\s+", " ", str(scene or "")).strip(" .\"'")[:220]
    if len(scene) < 12 or BAD_SCENE.search(scene):
        scene = FALLBACK_SCENES.get(category) or FALLBACK_SCENES["Other"]
    return STYLE.format(scene=scene)


APP_UA = "okhttp/4.12.0"   # what the Android app's picture loader sends
PHONE_FORMATS = ("image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif")


def image_problem(url, min_width=480):
    """Why the story's own picture would NOT show well in the app, or None if it's fine.
    Checks: https, a format every phone can show, big enough, and the site lets an app load it
    (some sites only serve pictures to browsers coming from their own pages)."""
    if not url:
        return "no picture"
    if not url.lower().startswith("https://"):
        return "plain http (Android blocks it)"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": APP_UA, "Accept": "image/webp,image/*"})
        with urllib.request.urlopen(req, timeout=8) as r:
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if ctype not in PHONE_FORMATS:
                return f"format {ctype or 'unknown'}"
            data = r.read(600_000)
    except urllib.error.HTTPError as ex:
        return f"site refused the app (HTTP {ex.code})"
    except Exception as ex:
        return f"could not load ({str(ex)[:40]})"
    if len(data) < 4000:
        return "too small"
    try:
        w, _ = Image.open(io.BytesIO(data)).size
    except Exception:
        return "not a readable picture"
    return None if w >= min_width else f"too small ({w}px wide)"


def usable_image(url, min_width=480):
    return image_problem(url, min_width) is None


def _finish(raw):
    """Crop to 16:9, resize, save as a small JPEG. Returns None if it isn't a real picture."""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    if w < 256 or h < 256:
        return None
    target = W / H
    if w / h > target:
        nw = int(h * target)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((W, H), Image.LANCZOS)
    # an almost single-colour picture is an error image, not a cover
    lo, hi = im.convert("L").getextrema()
    if hi - lo < 40:
        return None
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80, optimize=True, progressive=True)
    return out.getvalue()


class CoverMaker:
    def __init__(self, db):
        self.db = db
        # tolerate copy-paste mistakes: spaces and quote marks around the values
        self.cf_account = os.getenv("CF_ACCOUNT_ID", "").strip().strip("'\"").strip()
        self.cf_token = os.getenv("CF_API_TOKEN", "").strip().strip("'\"").strip()
        self.use_pollinations = os.getenv("POLLINATIONS", "true").lower() != "false"
        self.poll_token = os.getenv("POLLINATIONS_TOKEN", "").strip()
        self.cf_dead = False
        self.poll_dead = False
        self._last_poll = 0.0
        self.used = {}
        self.errors = []

    def describe(self):
        parts = []
        if self.cf_account and self.cf_token:
            parts.append("cloudflare")
        if self.use_pollinations:
            parts.append("pollinations")
        return " > ".join(parts) or "none"

    @property
    def available(self):
        return (self.cf_account and self.cf_token and not self.cf_dead) or (self.use_pollinations and not self.poll_dead)

    def _cloudflare(self, prompt, seed):
        url = (f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account}"
               "/ai/run/@cf/black-forest-labs/flux-1-schnell")
        body = json.dumps({"prompt": prompt, "steps": 4}).encode()   # this model rejects a "seed" setting
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Bearer {self.cf_token}", "Content-Type": "application/json", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        img = (data.get("result") or {}).get("image")
        if not img:
            raise ValueError(f"no image in reply: {str(data)[:120]}")
        return base64.b64decode(img)

    def _pollinations(self, prompt, seed):
        wait = 16 - (time.time() - self._last_poll)
        if wait > 0:
            time.sleep(wait)   # free tier allows about one picture every 15 seconds
        q = urllib.parse.urlencode({"width": W, "height": H, "seed": seed, "nologo": "true", "model": "flux"})
        url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}?{q}"
        headers = {"User-Agent": UA}
        if self.poll_token:
            headers["Authorization"] = f"Bearer {self.poll_token}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                if not r.headers.get("Content-Type", "").startswith("image/"):
                    raise ValueError("reply was not an image")
                return r.read(8_000_000)
        finally:
            self._last_poll = time.time()

    def picture(self, prompt):
        seed = random.randint(1, 999_999)
        providers = []
        if self.cf_account and self.cf_token and not self.cf_dead:
            providers.append(("cloudflare", self._cloudflare))
        if self.use_pollinations and not self.poll_dead:
            providers.append(("pollinations", self._pollinations))
        for name, fn in providers:
            try:
                try:
                    raw = fn(prompt, seed)
                except urllib.error.HTTPError as ex:
                    if ex.code < 500:
                        raise
                    time.sleep(5)   # a busy server: one more try
                    raw = fn(prompt, seed)
                jpg = _finish(raw)
                if jpg:
                    self.used[name] = self.used.get(name, 0) + 1
                    return jpg
                self.errors.append(f"{name}: blank picture")
            except urllib.error.HTTPError as ex:
                try:
                    detail = ex.read().decode("utf-8", "replace")
                    detail = "; ".join(e.get("message", "") for e in json.loads(detail).get("errors", [])) or detail
                except Exception:
                    detail = ""
                self.errors.append(f"{name}: HTTP {ex.code} {detail[:160]}".strip())
                # wrong ID / key, or the free daily limit is used up: stop asking this one for the rest of the run
                if name == "cloudflare" and ex.code in (400, 401, 403, 429) and "prompt" not in detail.lower():
                    self.cf_dead = True
                elif name == "pollinations" and ex.code in (401, 402, 403, 429):
                    self.poll_dead = True
            except Exception as ex:
                self.errors.append(f"{name}: {str(ex)[:80]}")
        return None

    def make(self, story_id, prompt):
        """Create, upload and return the public link of a cover picture, or None."""
        jpg = self.picture(prompt)
        if not jpg:
            return None
        path = f"{story_id}-{int(time.time())}.jpg"
        store = self.db.storage.from_(BUCKET)
        store.upload(path, jpg, {"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
        return store.get_public_url(path).rstrip("?")


def covers_made_today(db, day_start):
    try:
        res = (db.table("stories").select("id", count="exact")
               .like("image_url", "%/object/public/covers/%").gte("created_at", day_start).execute())
        return res.count or 0
    except Exception:
        return 0


def cleanup_old_covers(db, days=120, limit=50):
    """Delete AI pictures of stories older than `days`, so free storage never fills up.
    History cards are skipped: their dates are years old on purpose and their pictures are kept for good."""
    from datetime import datetime, timedelta, timezone
    before = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = (db.table("stories").select("id,image_url").like("image_url", "%/object/public/covers/%")
            .or_("category.is.null,category.neq.History").lt("published_at", before).limit(limit).execute().data)
    if not rows:
        return 0
    paths = [r["image_url"].split("/object/public/covers/", 1)[1].split("?")[0] for r in rows]
    db.storage.from_(BUCKET).remove(paths)
    for r in rows:
        db.table("stories").update({"image_url": None}).eq("id", r["id"]).execute()
    return len(rows)
