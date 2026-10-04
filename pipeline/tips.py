"""
One tip card a day, posted at 8am UK time (or the first run after it), shown in the main feed.

The hand-written tips in tips.json come first, each used once only. After that the AI writes a new tip
every day: it picks a topic that hasn't been covered and names an official guide (NCSC, CISA, Action Fraud...)
or a Wikipedia article, and the card is written only from that page once the pipeline has read it.
Tips are ordinary stories with category "Tips", so saving, sharing and pictures just work, but they never
trigger phone alerts or appear in the daily email.
"""
import json, os, urllib.parse
from datetime import datetime, timezone

from daily import (card_ok, due, is_repeat, missing_pictures, page_text, posted_today, slug, story_row, too_similar,
                   wikipedia)

SOURCE = "CyberSid Tips"
POST_HOUR = 8
TRUSTED = ("ncsc.gov.uk", "cisa.gov", "actionfraud.police.uk", "getsafeonline.org", "ico.org.uk", "gov.uk",
           "consumer.ftc.gov", "ftc.gov", "nist.gov", "owasp.org", "haveibeenpwned.com", "support.google.com",
           "support.apple.com", "support.microsoft.com", "learn.microsoft.com", "which.co.uk", "en.wikipedia.org")

# a different theme each day keeps the tips varied once the AI is writing them
THEMES = ["scams and fraud", "phones and apps", "home Wi-Fi and smart devices", "online shopping and payments",
          "social media and privacy", "children and families online", "email and phishing", "backups and ransomware",
          "travel and public Wi-Fi", "small business security", "explainer of an attack technique for security staff",
          "cloud and Microsoft 365 or Google accounts", "browsers and updates", "identity theft and data breaches",
          "explainer of a security idea for IT staff", "older relatives and vulnerable people", "work from home",
          "gaming and young people", "money, banking and crypto scams", "explainer of a famous malware family"]

PICK_PROMPT = """You choose the daily security tip for CyberSid, a UK cyber security news app read by everyday people
and IT/security staff. Pick ONE useful, specific topic within the theme the user gives. It must NOT give the same
advice as any tip already used (listed by the user): passwords, password managers and two-factor/2-step verification
are already well covered, so avoid them unless the advice is clearly different.
Reply with ONLY JSON:
{"topic": "short topic", "url": "an official page about it you are confident exists, from ncsc.gov.uk, cisa.gov,
actionfraud.police.uk, getsafeonline.org, ico.org.uk or gov.uk", "wikipedia": "exact English Wikipedia article title on the topic"}"""

WRITE_PROMPT = """Write a tip card for CyberSid using ONLY facts from the page text the user gives you. UK English,
plain words, no hype, no em dashes. If the page doesn't support a useful tip on the topic, reply {"ok": false}.
Reply with ONLY JSON:
{"ok": true,
 "headline": "the tip in max 12 words, e.g. 'Turn on 2-step verification for your email first'",
 "technical": "40 to 55 words: what to do and why, specific and practical",
 "why": "one sentence, max 18 words, why it matters",
 "scene": "one simple picture idea, max 20 words, objects only, no people, no text, no logos"}"""


def load_tips():
    with open(os.path.join(os.path.dirname(__file__), "tips.json"), encoding="utf-8") as f:
        return json.load(f)


def _used(db):
    rows = db.table("stories").select("id,headline").eq("source", SOURCE).limit(5000).execute().data
    keys = {r["id"].split(":")[1] for r in rows if r["id"].startswith("tip:")}
    return keys, [r["headline"] for r in rows if r.get("headline")]


def _trusted(url):
    host = urllib.parse.urlparse(url or "").netloc.lower()
    return url.startswith("https://") and any(host == d or host.endswith("." + d) for d in TRUSTED)


def new_ai_tip(ai, used_headlines, now, tries=3):
    """Ask the AI for a new tip, written from a page the pipeline has read. Returns (tip or None, ai_calls)."""
    calls, avoid = 0, list(used_headlines)
    for attempt in range(tries):
        theme = THEMES[(now.toordinal() + attempt * 7) % len(THEMES)]
        calls += 1
        try:
            pick = ai.json(PICK_PROMPT, f"Theme: {theme}\nTips already used (do not repeat these):\n- " +
                           "\n- ".join(avoid[-300:]), 300)
        except Exception as ex:
            print(f"  [tip] AI pick failed: {str(ex)[:80]}")
            continue
        topic = str(pick.get("topic") or "").strip()
        print(f"  [tip] theme '{theme}' -> topic '{topic}' | {pick.get('url')} | wiki '{pick.get('wikipedia')}'")
        if not topic or too_similar(topic, avoid, 0.6):
            print("  [tip] topic already covered")
            avoid.append(topic)
            continue
        url, text = "", ""
        if _trusted(str(pick.get("url") or "")):
            text = page_text(pick["url"])
            url = pick["url"] if len(text) >= 400 else ""
        if not url and pick.get("wikipedia"):
            w = wikipedia(str(pick["wikipedia"]))
            if w and len(w[2]) >= 400:
                url, text = w[0], w[2][:5000]
        if not url:
            print("  [tip] no readable page for it")
            avoid.append(topic)
            continue
        calls += 1
        try:
            card = ai.json(WRITE_PROMPT, f"Topic: {topic}\nPage: {url}\nPage text:\n{text[:5000]}", 600)
        except Exception:
            continue
        if card.get("ok") is False or not card_ok(card) or too_similar(card["headline"], avoid):
            print(f"  [tip] card rejected: {str(card)[:120]}")
            avoid.append(topic)
            continue
        calls += 1
        if is_repeat(ai, card, avoid):
            print(f"  [tip] repeats an earlier tip: {card['headline']}")
            avoid.append(card["headline"])
            continue
        card["url"], card["key"] = url, "ai-" + slug(card["headline"], 40)
        return card, calls
    return None, calls


def post_daily_tip(db, ai=None, now=None, dry_run=False):
    """Post today's tip if it's due and not posted yet.
    Returns (story or None, note for the run summary, ai_calls, [(id, scene, headline)] needing a picture)."""
    now = now or datetime.now(timezone.utc)
    retry = [(r["id"], "", r["headline"]) for r in missing_pictures(db, SOURCE, now)]
    if not dry_run and (not due(now, POST_HOUR) or posted_today(db, SOURCE, now)):
        return None, "none due", 0, retry
    keys, headlines = _used(db)
    fresh = [t for t in load_tips() if t["key"] not in keys]
    calls, origin = 0, "list"
    if fresh and not (dry_run and ai):
        t = fresh[0]
    else:
        if not ai:
            return None, "list used up, AI off", 0, retry
        origin = "AI"
        t, calls = new_ai_tip(ai, headlines + [x["headline"] for x in load_tips()], now.date())
        if not t:
            return None, f"AI could not write a new tip ({calls} calls)", calls, retry
    story = story_row(f"tip:{t['key']}:{now.strftime('%Y%m%d%H')}", SOURCE, "Tips", t["url"], t, now)
    if not dry_run:
        db.table("stories").upsert(story).execute()
    note = f"posted ({origin}{f', {len(fresh) - 1} left in list' if origin == 'list' else ''}): {t['headline']}"
    return story, note, calls, [(story["id"], t.get("scene", ""), t["headline"])] + retry
