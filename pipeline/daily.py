"""
Shared helpers for the daily cards (one tip and one cyber history card a day).

The hand-written lists (tips.json, history.json) are used first, each card once only. When a list runs out,
the AI writes a new card every day, but only from a real page it has just read (an official guide or the
Wikipedia article), so the facts come from that page and not from the AI's memory. Every card ever posted
stays in the database, which is how the pipeline knows what has been used and never repeats one.
"""
import json, re, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")
WIKI_UA = "CyberSid/1.0 (https://cybershortapp.github.io/cybershorts/; daily cyber history card)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
STOP = set("the a an and or of to in on for with is are was were be by at as from this that it its your you how what "
           "why when use using into after before about over new".split())
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def uk_today_start(now, tz=UK):
    """Midnight (local time, UK unless another time zone is given) at the start of today, in UTC."""
    local = now.astimezone(tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def due(now, hour, tz=UK):
    """True from `hour` o'clock local time until midnight, so a late or missed run still posts the card."""
    return now.astimezone(tz).hour >= hour


def posted_today(db, source, now, tz=UK, country=None):
    q = db.table("stories").select("id").eq("source", source).gte("created_at", uk_today_start(now, tz).isoformat())
    if country:
        q = q.eq("country", country)
    return bool(q.limit(1).execute().data)


def missing_pictures(db, source, now, days=3):
    """Recent daily cards that still have no picture (the picture service failed or was busy)."""
    rows = (db.table("stories").select("id,headline,category").eq("source", source).is_("image_url", "null")
            .gte("created_at", (now - timedelta(days=days)).isoformat()).execute().data)
    return rows


SAME = {"2fa": "mfa", "2sv": "mfa", "two-factor": "mfa", "2-step": "mfa", "multi-factor": "mfa", "verification": "mfa",
        "authentication": "mfa", "passwords": "password", "passphrase": "password", "texts": "sms", "text": "sms"}


def key_words(text):
    """Key words of a headline, with plurals and common synonyms folded together (2FA, 2SV, MFA...)."""
    out = set()
    for w in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", (text or "").lower()):
        w = SAME.get(w, w)
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        if len(w) > 2 and w not in STOP:
            out.add(w)
    return out


def wiki_title(url):
    """'https://en.wikipedia.org/wiki/WannaCry_ransomware_attack' -> 'WannaCry ransomware attack'"""
    return urllib.parse.unquote((url or "").rsplit("/wiki/", 1)[-1]).replace("_", " ") if "/wiki/" in (url or "") else ""


REPEAT_PROMPT = """You check that a new card for a news app does not repeat an earlier one. Reply with ONLY JSON:
{"repeat": true} if the new card gives the same main advice or covers the same event as any earlier card,
otherwise {"repeat": false}."""


def is_repeat(ai, card, earlier):
    """Ask the AI whether a new card says the same thing as an earlier card (headlines differ, ideas may not)."""
    try:
        reply = ai.json(REPEAT_PROMPT, f"New card: {card['headline']}. {card['technical']}\n\nEarlier cards:\n- "
                        + "\n- ".join(earlier[-400:]), 60)
        return reply.get("repeat") is not False
    except Exception:
        return True


def too_similar(headline, others, limit=0.5):
    """Same topic as an earlier card? Compares the key words of the headlines."""
    a = key_words(headline)
    if not a:
        return True
    for o in others:
        b = key_words(o)
        if b and len(a & b) / len(a | b) >= limit:
            return True
    return False


def slug(text, size=48):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:size].strip("-")


def norm_url(url):
    u = urllib.parse.unquote((url or "").split("#")[0]).strip().rstrip("/")
    return u.replace("http://", "https://").replace(" ", "_").lower()


def _get(url, ua, timeout=15, limit=900_000):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit).decode("utf-8", errors="ignore"), r.geturl()


def page_text(url, limit=5000):
    """The readable paragraphs of a web page, or "" if it can't be read."""
    import html as htmllib
    try:
        raw, _ = _get(url, BROWSER_UA)
    except Exception:
        return ""
    raw = re.sub(r"<(script|style|nav|aside|footer|header|form)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    parts = []
    for p in re.findall(r"<(?:p|li|h2|h3)[^>]*>(.*?)</(?:p|li|h2|h3)>", raw, flags=re.S | re.I):
        t = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", p))).strip()
        if len(t) >= 40:
            parts.append(t)
    return " ".join(parts)[:limit]


def wikipedia(title):
    """Look up an English Wikipedia article. Returns (url, title, plain text) or None if there's no such page.
    Follows redirects, so 'WannaCry' and 'WannaCry ransomware attack' give the same article."""
    api = "https://en.wikipedia.org/w/api.php?"
    q = {"action": "query", "format": "json", "prop": "extracts|info", "inprop": "url", "explaintext": 1,
         "redirects": 1, "titles": title}
    try:
        data = json.loads(_get(api + urllib.parse.urlencode(q), WIKI_UA)[0])
        pages = list((data.get("query") or {}).get("pages", {}).values())
        if not pages or "missing" in pages[0]:
            # not an exact title: take the best search match instead
            s = {"action": "query", "format": "json", "list": "search", "srsearch": title, "srlimit": 1}
            hits = json.loads(_get(api + urllib.parse.urlencode(s), WIKI_UA)[0])["query"]["search"]
            if not hits:
                return None
            q["titles"] = hits[0]["title"]
            data = json.loads(_get(api + urllib.parse.urlencode(q), WIKI_UA)[0])
            pages = list(data["query"]["pages"].values())
            if not pages or "missing" in pages[0]:
                return None
        p = pages[0]
        text = re.sub(r"\n{2,}", "\n", p.get("extract") or "")
        # drop the reference sections at the end
        text = re.split(r"\n=+ (See also|References|Notes|External links|Further reading) =+", text)[0]
        return p.get("fullurl") or "https://en.wikipedia.org/wiki/" + p["title"].replace(" ", "_"), p["title"], text
    except Exception:
        return None


def date_in_text(date, text):
    """Check the AI's date against the article. Returns ("2017-05-12", True) when the day is in the text,
    ("2017-05", False) when only the month and year are, or (None, False) when the date can't be confirmed."""
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", (date or "").strip())
    if not m:
        return None, False
    y, mo, d = int(m.group(1)), int(m.group(2)), m.group(3)
    if not (1 <= mo <= 12) or str(y) not in text:
        return None, False
    month = MONTHS[mo - 1]
    near = r"[^\n]{0,80}?"     # the year has to be close by, in the same paragraph
    if d:
        day = int(d)
        for pat in (rf"\b{day} {month},? {y}\b", rf"\b{month} {day},? {y}\b",
                    rf"\b{day} {month}\b{near}\b{y}\b", rf"\b{month} {day}\b{near}\b{y}\b",
                    rf"\b{y}\b{near}\b{day} {month}\b", rf"\b{y}\b{near}\b{month} {day}\b"):
            if re.search(pat, text):
                return f"{y:04d}-{mo:02d}-{day:02d}", True
    if re.search(rf"\b{month}\b{near}\b{y}\b", text) or re.search(rf"\b{y}\b{near}\b{month}\b", text):
        return f"{y:04d}-{mo:02d}", False
    return None, False


def card_ok(card):
    """The AI's card has everything a card needs, at a size that fits on the phone."""
    if not isinstance(card, dict):
        return False
    for k in ("headline", "technical", "why"):
        if not isinstance(card.get(k), str) or len(card[k].strip()) < 10:
            return False
    return len(card["headline"].split()) <= 16 and 20 <= len(card["technical"].split()) <= 90


def story_row(sid, source, category, url, card, now, country="INTL"):
    return {
        "id": sid, "source": source, "url": url, "orig_title": card["headline"].strip(),
        "headline": card["headline"].strip(), "technical": card["technical"].strip(),
        "why_it_matters": card["why"].strip(), "severity": "Info", "action": "none", "cves": [],
        "attack_chain": None, "chain_checked": True, "also_reported": [], "incident": None, "actor_group": None,
        "category": category, "country": country, "language": "en", "image_url": None,
        "published_at": now.isoformat(), "products": [], "zero_day": False,
    }
