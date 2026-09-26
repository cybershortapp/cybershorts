"""CyberShorts news pipeline.
Fetch RSS -> skip duplicates -> AI summary -> save to Supabase -> health report.

Settings (.env on laptop, GitHub secrets online):
  TEST_MODE=true   only test sources, 5 stories each, max 20 AI calls
  USE_AI=true      false = no AI cost, uses the feed's own text (testing only)
  DRY_RUN=true     does everything except saving to the database
  MAX_AI_CALLS=20  hard stop on AI calls per run
"""
import os, re, json, hashlib, time, html
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

import feedparser
from dotenv import load_dotenv

from sources import SOURCES

load_dotenv()

def flag(name, default):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")

TEST_MODE = flag("TEST_MODE", "true")
USE_AI = flag("USE_AI", "false")
DRY_RUN = flag("DRY_RUN", "false")
MAX_AI_CALLS = int(os.getenv("MAX_AI_CALLS", "20" if TEST_MODE else "400"))
PER_SOURCE = 5 if TEST_MODE else 15

MODEL = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")   # change model here only
CATEGORIES = ["Breaches", "Scams", "Vulnerabilities", "Ransomware", "Tools", "Policy", "Other"]
SIMILARITY_LIMIT = 0.72
MAX_AGE_DAYS = int(os.getenv("MAX_AGE_DAYS", "7"))   # ignore stories older than this

PROMPT = f"""You write short cyber security news cards for a UK mobile app.
Given an article title and excerpt, reply with ONLY a JSON object:
{{"headline": "max 12 words, your own wording",
  "simple": "about 55 words, plain English for a non-technical reader, say why it matters to them",
  "technical": "about 55 words for a security professional, include CVE IDs, threat actors, affected products if present",
  "category": one of {CATEGORIES}}}
Use only facts from the text given. Never invent details. Do not copy sentences from the source. No hype.
Use British English spelling."""


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def shorten(text, words):
    parts = text.split()
    return " ".join(parts[:words]) + ("..." if len(parts) > words else "")


def image_of(entry):
    for key in ("media_content", "media_thumbnail"):
        for m in entry.get(key, []) or []:
            if m.get("url"):
                return m["url"]
    for enc in entry.get("enclosures", []) or []:
        if str(enc.get("type", "")).startswith("image") and enc.get("href"):
            return enc["href"]
    m = re.search(r'<img[^>]+src="([^"]+)"', entry.get("summary", "") or "")
    return m.group(1) if m else None


def published_of(entry):
    t = entry.get("published_parsed") or entry.get("updated_parsed")
    return datetime(*t[:6], tzinfo=timezone.utc) if t else datetime.now(timezone.utc)


def is_duplicate(title, recent_titles):
    t = title.lower()
    return any(SequenceMatcher(None, t, r.lower()).ratio() > SIMILARITY_LIMIT for r in recent_titles)


def summarise_ai(client, title, excerpt):
    msg = client.messages.create(
        model=MODEL, max_tokens=500, system=PROMPT,
        messages=[{"role": "user", "content": f"Title: {title}\nExcerpt: {excerpt[:1500]}"}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"^```(json)?|```$", "", raw).strip()
    data = json.loads(raw)
    for key in ("headline", "simple", "technical"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f"AI reply missing {key}")
    if data.get("category") not in CATEGORIES:
        data["category"] = "Other"
    return data


def summarise_free(title, excerpt):
    text = shorten(excerpt or title, 60)
    return {"headline": shorten(title, 12), "simple": text, "technical": text, "category": "Other"}


def main():
    print(f"\n=== CyberShorts pipeline | TEST_MODE={TEST_MODE} USE_AI={USE_AI} DRY_RUN={DRY_RUN} ===\n")

    db = None
    if not DRY_RUN:
        from supabase import create_client
        db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    ai = None
    if USE_AI:
        from anthropic import Anthropic
        ai = Anthropic()

    seen_ids, recent_titles = set(), []
    if db:
        # titles saved in the last 3 days, for similar-headline checks
        since = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        recent = db.table("stories").select("id,orig_title").gte("created_at", since).execute().data
        seen_ids = {r["id"] for r in recent}
        recent_titles = [r["orig_title"] for r in recent]
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)

    sources = [s for s in SOURCES if s["test"]] if TEST_MODE else SOURCES
    health, ai_calls, stopped = [], 0, False
    totals = {"added": 0, "duplicates": 0, "old": 0, "failed": 0}

    for src in sources:
        row = {"source": src["name"], "found": 0, "added": 0, "dupes": 0, "old": 0, "failed": 0, "status": "OK"}
        try:
            feed = feedparser.parse(src["url"], agent="CyberShortsBot/1.0")
            entries = feed.entries[:PER_SOURCE]
            row["found"] = len(entries)
            if not entries:
                row["status"] = "NO STORIES (check URL)"
        except Exception as ex:
            row["status"] = f"FEED ERROR: {ex}"[:60]
            entries = []

        # check every link against the whole database, not just recent rows
        ids = [hashlib.sha1(e.get("link").encode()).hexdigest()[:16] for e in entries if e.get("link")]
        if db and ids:
            found = db.table("stories").select("id").in_("id", ids).execute().data
            seen_ids.update(r["id"] for r in found)

        for e in entries:
            if stopped:
                break
            link, title = e.get("link"), clean(e.get("title"))
            if not link or not title:
                continue
            sid = hashlib.sha1(link.encode()).hexdigest()[:16]
            if sid in seen_ids or is_duplicate(title, recent_titles):
                row["dupes"] += 1
                continue
            if published_of(e) < cutoff:
                row["old"] += 1
                continue
            excerpt = clean(e.get("summary") or e.get("description"))
            try:
                if USE_AI:
                    if ai_calls >= MAX_AI_CALLS:
                        stopped = True
                        print(f"[stop] reached MAX_AI_CALLS={MAX_AI_CALLS}")
                        break
                    ai_calls += 1
                    s = summarise_ai(ai, title, excerpt)
                    time.sleep(0.3)
                else:
                    s = summarise_free(title, excerpt)

                story = {
                    "id": sid, "source": src["name"], "url": link, "orig_title": title,
                    "headline": s["headline"], "simple": s["simple"], "technical": s["technical"],
                    "category": s["category"], "country": src["country"], "language": "en",
                    "image_url": image_of(e), "published_at": published_of(e).isoformat(),
                }
                if db:
                    db.table("stories").upsert(story).execute()
                seen_ids.add(sid)
                recent_titles.append(title)
                row["added"] += 1
                print(f"[ok]  {src['name']}: {s['headline']}")
                if DRY_RUN or TEST_MODE:
                    print(f"      simple: {s['simple']}\n")
            except Exception as ex:
                row["failed"] += 1
                print(f"[fail] {src['name']}: {title[:50]} -> {ex}")

        totals["added"] += row["added"]
        totals["duplicates"] += row["dupes"]
        totals["failed"] += row["failed"]
        totals["old"] += row["old"]
        health.append(row)

    print("\n=== Health report ===")
    print(f"{'Source':<24}{'Found':>6}{'New':>6}{'Dupes':>7}{'Old':>5}{'Fail':>6}  Status")
    for r in health:
        print(f"{r['source']:<24}{r['found']:>6}{r['added']:>6}{r['dupes']:>7}{r['old']:>5}{r['failed']:>6}  {r['status']}")
    print(f"\nTotal: {totals['added']} new, {totals['duplicates']} duplicates, {totals['old']} too old, "
          f"{totals['failed']} failed, {ai_calls} AI calls\n")


if __name__ == "__main__":
    main()
