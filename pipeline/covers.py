"""
AI cover pictures for stories that have no usable photo of their own.

Every picture uses the same house style (dark navy, cyan / blue / violet glow) so the feed looks like one brand.
Pictures are saved in Supabase Storage (bucket "covers") and shown in the app as "AI illustration".

Providers, tried in order:
  1. Cloudflare Workers AI (FLUX.1 schnell). Free: 10,000 "neurons" a day.
     Needs CF_ACCOUNT_ID and CF_API_TOKEN.
  2. AI Horde (aihorde.net), free and run by volunteers. No card, no watermark, but slow (about 1 to 3
     minutes a picture). Works without a key; a free key in AI_HORDE_KEY gets a faster place in the queue.
     Set HORDE=false to turn it off.
  3. Pollinations.ai. Free, slow, and adds a small watermark unless POLLINATIONS_TOKEN is set.
     Set POLLINATIONS=false to turn it off.
If all three fail, the story gets a ready-made picture from the backup library (covers/library/<category>-NN.jpg,
made once by design/library.py), so a card is never left without a picture. Library pictures are shared by
many stories, so they are never deleted with a story.
"""
import base64, io, json, os, random, re, time, urllib.error, urllib.parse, urllib.request

from PIL import Image

UA = "CyberSid/1.0 (+news cover pictures)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
BUCKET = "covers"
W, H = 1024, 576
LIBRARY = "library/"
HORDE_API = "https://aihorde.net/api/v2"
HORDE_MODELS = ["Juggernaut XL", "AlbedoBase XL (SDXL)"]   # safe, well-supported picture models (no adult models)
HORDE_AVOID = " ### text, letters, words, numbers, logo, watermark, brand, signature, nsfw, nude"


def is_library(url_or_path):
    """A shared ready-made picture from the backup library (never deleted with a story)."""
    v = str(url_or_path or "")
    return v.startswith(LIBRARY) or f"/object/public/{BUCKET}/{LIBRARY}" in v

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


def picture_width(url):
    """(width, None) when the app can show the picture, else (0, why not).
    Checks: https, a format every phone can show, and the site lets an app load it
    (some sites only serve pictures to browsers coming from their own pages)."""
    if not url:
        return 0, "no picture"
    if not url.lower().startswith("https://"):
        return 0, "plain http (Android blocks it)"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": APP_UA, "Accept": "image/webp,image/*"})
        with urllib.request.urlopen(req, timeout=8) as r:
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if ctype not in PHONE_FORMATS:
                return 0, f"format {ctype or 'unknown'}"
            data = r.read(600_000)
    except urllib.error.HTTPError as ex:
        return 0, f"site refused the app (HTTP {ex.code})"
    except Exception as ex:
        return 0, f"could not load ({str(ex)[:40]})"
    if len(data) < 4000:
        return 0, "too small"
    try:
        w, _ = Image.open(io.BytesIO(data)).size   # the size is in the header, so a cut-off big file is fine
    except Exception:
        return 0, "not a readable picture"
    return w, None


def image_problem(url, min_width=480):
    """Why the story's own picture would NOT show well in the app, or None if it's fine."""
    w, why = picture_width(url)
    if why:
        return why
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
        self.use_horde = os.getenv("HORDE", "true").lower() != "false"
        self.horde_key = os.getenv("AI_HORDE_KEY", "").strip().strip("'\"").strip() or "0000000000"   # 0000000000 = anonymous
        self.horde_wait = int(os.getenv("HORDE_WAIT", "200"))   # seconds to wait for one picture
        self.use_pollinations = os.getenv("POLLINATIONS", "true").lower() != "false"
        self.poll_token = os.getenv("POLLINATIONS_TOKEN", "").strip()
        self.deadline = None   # time.time() after which no slow picture is started (set by the pipeline)
        self.cf_dead = False
        self.horde_dead = False
        self.poll_dead = False
        self._last_poll = 0.0
        self.used = {}
        self.errors = []

    def describe(self):
        parts = []
        if self.cf_account and self.cf_token:
            parts.append("cloudflare")
        if self.use_horde:
            parts.append("horde")
        if self.use_pollinations:
            parts.append("pollinations")
        return " > ".join(parts) or "none"

    @property
    def available(self):
        return ((self.cf_account and self.cf_token and not self.cf_dead) or (self.use_horde and not self.horde_dead)
                or (self.use_pollinations and not self.poll_dead))

    def _time_left(self):
        return 10_000 if self.deadline is None else self.deadline - time.time()

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

    def _horde_call(self, method, path, body=None):
        head = {"apikey": self.horde_key, "Client-Agent": "CyberSid:1.0:cybershortapp.github.io",
                "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA}
        req = urllib.request.Request(HORDE_API + path, method=method, headers=head,
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")

    def horde_submit(self, prompt, seed=None):
        """Queue one picture on AI Horde and return its job id (the picture is made while we do other work)."""
        job = self._horde_call("POST", "/generate/async", {
            "prompt": prompt + HORDE_AVOID, "models": HORDE_MODELS, "nsfw": False, "censor_nsfw": True,
            "r2": True, "shared": False, "slow_workers": True,
            "params": {"width": W, "height": H, "steps": 25, "n": 1, "sampler_name": "k_euler_a",
                       "cfg_scale": 6, "seed": str(seed or random.randint(1, 999_999))}})
        return job["id"]

    def horde_result(self, jid):
        """The picture's bytes if the job is finished, None if it's still waiting. Raises if it can't be made."""
        st = self._horde_call("GET", f"/generate/check/{jid}")
        if st.get("faulted") or not st.get("is_possible", True):
            raise ValueError("no volunteer can make this picture right now")
        if not st.get("done"):
            return None
        gens = self._horde_call("GET", f"/generate/status/{jid}").get("generations") or []
        if not gens or gens[0].get("censored"):
            raise ValueError("picture was blocked by the safety filter")
        with urllib.request.urlopen(urllib.request.Request(gens[0]["img"], headers={"User-Agent": UA}), timeout=60) as r:
            return r.read(8_000_000)

    def horde_cancel(self, jid):
        try:
            self._horde_call("DELETE", f"/generate/status/{jid}")   # give the place in the queue back
        except Exception:
            pass

    def _horde(self, prompt, seed):
        """AI Horde, one picture, waiting for it (used when there was no early start for this story)."""
        wait = min(self.horde_wait, self._time_left() - 20)
        if wait < 60:
            raise TimeoutError("not enough time left in this run")
        jid, t0 = self.horde_submit(prompt, seed), time.time()
        while time.time() - t0 < wait:
            time.sleep(6)
            raw = self.horde_result(jid)
            if raw:
                return raw
        self.horde_cancel(jid)
        raise TimeoutError(f"queue too long (waited {int(time.time() - t0)}s)")

    def collect_early(self, jobs, until, cancel=True):
        """Pictures started on AI Horde (jobs = {story_id: job_id}): wait for them until the given time and upload
        the finished ones. Returns ({story_id: public link}, {story_id: job_id still waiting}).
        With cancel=True the jobs still waiting are cancelled (their place in the queue is given back)."""
        links, pending = {}, dict(jobs)
        while pending and time.time() < until:
            for sid, jid in list(pending.items()):
                try:
                    raw = self.horde_result(jid)
                except Exception as ex:
                    self.errors.append(f"horde: {str(ex)[:80]}")
                    del pending[sid]
                    continue
                if raw is None:
                    continue
                del pending[sid]
                jpg = _finish(raw)
                if not jpg:
                    self.errors.append("horde: blank picture")
                    continue
                links[sid] = self._upload(sid, jpg)
                self.used["horde"] = self.used.get("horde", 0) + 1
            if pending:
                time.sleep(6)
        if cancel:
            for jid in pending.values():
                self.horde_cancel(jid)
            if pending:
                self.errors.append(f"horde: {len(pending)} pictures not ready in time")
        return links, pending

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
        if self.use_horde and not self.horde_dead:
            providers.append(("horde", self._horde))
        if self.use_pollinations and not self.poll_dead:
            providers.append(("pollinations", self._pollinations))
        for name, fn in providers:
            if name != "cloudflare" and self._time_left() < 45:
                self.errors.append(f"{name}: no time left in this run")
                continue
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
                elif name == "horde" and ex.code in (401, 403, 429):
                    self.horde_dead = True
                elif name == "pollinations" and ex.code in (401, 402, 403, 429):
                    self.poll_dead = True
            except Exception as ex:
                self.errors.append(f"{name}: {str(ex)[:80]}")
                if name == "horde" and isinstance(ex, TimeoutError):
                    self.horde_dead = True   # a long queue now usually stays long for the rest of this run
        return None

    def make(self, story_id, prompt):
        """Create, upload and return the public link of a cover picture, or None."""
        jpg = self.picture(prompt)
        if not jpg:
            return None
        return self._upload(story_id, jpg)

    def _upload(self, story_id, jpg):
        path = f"{story_id}-{int(time.time())}.jpg"
        store = self.db.storage.from_(BUCKET)
        store.upload(path, jpg, {"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
        return store.get_public_url(path).rstrip("?")


def covers_made_today(db, day_start):
    try:
        res = (db.table("stories").select("id", count="exact")
               .like("image_url", "%/object/public/covers/%").not_.like("image_url", f"%/covers/{LIBRARY}%")
               .gte("created_at", day_start).execute())
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
    paths = [p for p in paths if not is_library(p)]   # shared by many stories: kept
    if paths:
        db.storage.from_(BUCKET).remove(paths)
    for r in rows:
        db.table("stories").update({"image_url": None}).eq("id", r["id"]).execute()
    return len(rows)


class Library:
    """The backup pictures: 20 ready-made pictures per category, used only when no service could make one."""

    def __init__(self, db):
        self.db = db
        self.files = None
        self.recent = []

    def _load(self):
        if self.files is not None:
            return
        self.files = {}
        try:
            for f in self.db.storage.from_(BUCKET).list(LIBRARY.rstrip("/"), {"limit": 1000}) or []:
                name = f.get("name") or ""
                if name.endswith(".jpg") and "-" in name:
                    self.files.setdefault(name.rsplit("-", 1)[0], []).append(name)
        except Exception as ex:
            print(f"[warn] backup pictures: {str(ex)[:80]}")
        try:   # pictures used most recently are picked last, so the feed doesn't repeat itself
            rows = (self.db.table("stories").select("image_url").like("image_url", f"%/covers/{LIBRARY}%")
                    .order("created_at", desc=True).limit(40).execute().data)
            self.recent = [r["image_url"].rsplit("/", 1)[-1].split("?")[0] for r in rows]
        except Exception:
            self.recent = []

    def pick(self, category):
        """Public link of a backup picture for this category, or None if the library is empty."""
        self._load()
        key = (category or "other").lower()
        names = self.files.get(key) or self.files.get("other") or [n for v in self.files.values() for n in v]
        if not names:
            return None
        fresh = [n for n in names if n not in self.recent]
        name = random.choice(fresh or names)
        self.recent.insert(0, name)
        return self.db.storage.from_(BUCKET).get_public_url(LIBRARY + name).rstrip("?")
