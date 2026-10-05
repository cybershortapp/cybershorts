"""
One tip card a day for each region, posted at 8am local time (or the first run after it), shown in the main feed:
  GB    readers in the UK (8am UK time): UK tips (Action Fraud, 7726...) and tips for everyone
  IN    readers in India (8am India time): Indian tips (1930, cybercrime.gov.in, Sanchar Saathi...) and tips for everyone
  INTL  everyone else (8am UTC): tips for everyone only. These cards are tagged XX (not INTL), so readers in the
        UK and India don't also get them: each reader gets exactly one tip a day, and never the same one twice.
Each tip in tips.json has "country": GB, IN or ALL (for everyone). The card's country tells the app who sees it.

The hand-written tips in tips.json come first, each used once only. After that the AI writes a new tip
every day: it picks a topic that hasn't been covered and names an official guide (NCSC, CISA, Action Fraud...)
or a Wikipedia article, and the card is written only from that page once the pipeline has read it.
Tips are ordinary stories with category "Tips", so saving, sharing and pictures just work, but they never
trigger phone alerts or appear in the daily email.
"""
import json, os, urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from daily import (UK, card_ok, due, is_repeat, missing_pictures, page_text, posted_today, slug, story_row,
                   too_similar, wikipedia)

SOURCE = "CyberSid Tips"
POST_HOUR = 8
TRUSTED = ("ncsc.gov.uk", "cisa.gov", "actionfraud.police.uk", "getsafeonline.org", "ico.org.uk", "gov.uk",
           "consumer.ftc.gov", "ftc.gov", "nist.gov", "owasp.org", "haveibeenpwned.com", "support.google.com",
           "support.apple.com", "support.microsoft.com", "learn.microsoft.com", "which.co.uk", "en.wikipedia.org",
           "cybercrime.gov.in", "cert-in.org.in", "sancharsaathi.gov.in", "rbi.org.in", "npci.org.in", "uidai.gov.in",
           "mha.gov.in", "pib.gov.in", "econsumer.gov", "enisa.europa.eu", "europol.europa.eu")

# who each region's tip is for, when it goes out, and which official sites the AI should name
REGIONS = {
    "GB": {"tz": UK, "who": "people in the UK", "sites": "ncsc.gov.uk, actionfraud.police.uk, getsafeonline.org, ico.org.uk or gov.uk"},
    "IN": {"tz": ZoneInfo("Asia/Kolkata"), "who": "people in India",
           "sites": "cybercrime.gov.in, cert-in.org.in, sancharsaathi.gov.in, rbi.org.in, npci.org.in or uidai.gov.in"},
    "INTL": {"tz": timezone.utc, "who": "people anywhere in the world (no country-specific phone numbers or agencies)",
             "sites": "cisa.gov, owasp.org, enisa.europa.eu, support.google.com, support.apple.com or support.microsoft.com"},
}

# a different theme each day keeps the tips varied once the AI is writing them
THEMES = ["scams and fraud", "phones and apps", "home Wi-Fi and smart devices", "online shopping and payments",
          "social media and privacy", "children and families online", "email and phishing", "backups and ransomware",
          "travel and public Wi-Fi", "small business security", "explainer of an attack technique for security staff",
          "cloud and Microsoft 365 or Google accounts", "browsers and updates", "identity theft and data breaches",
          "explainer of a security idea for IT staff", "older relatives and vulnerable people", "work from home",
          "gaming and young people", "money, banking and crypto scams", "explainer of a famous malware family"]

PICK_PROMPT = """You choose the daily security tip for CyberSid, a cyber security news app read by everyday people
and IT/security staff. The tip is for the readers the user names. Pick ONE useful, specific topic within the theme
the user gives. It must NOT give the same advice as any tip already used (listed by the user): passwords, password
managers and two-factor/2-step verification are already well covered, so avoid them unless the advice is clearly different.
Reply with ONLY JSON:
{"topic": "short topic", "url": "an official page about it you are confident exists, from one of the sites the user
lists", "wikipedia": "exact English Wikipedia article title on the topic"}"""

WRITE_PROMPT = """Write a tip card for CyberSid using ONLY facts from the page text the user gives you. UK English,
plain words, no hype, no em dashes. The tip must help the reader stay safe from scams, hacking, fraud or data theft,
or explain a security idea. If the page has no such advice (for example it only covers how a service works), reply {"ok": false}.
Reply with ONLY JSON:
{"ok": true,
 "headline": "the tip in max 12 words, e.g. 'Turn on 2-step verification for your email first'",
 "technical": "40 to 55 words: what to do and why, specific and practical",
 "why": "one sentence, max 18 words, why it matters",
 "scene": "one simple picture idea, max 20 words, objects only, no people, no text, no logos"}"""


def load_tips():
    with open(os.path.join(os.path.dirname(__file__), "tips.json"), encoding="utf-8") as f:
        return json.load(f)


def card_country(region):
    """Country tag on the card: the region itself, except the rest-of-the-world tip (XX), which must not
    show up for UK or India readers on top of their own tip."""
    return "XX" if region == "INTL" else region


def _used(db, region):
    rows = (db.table("stories").select("id,headline").eq("source", SOURCE).eq("country", card_country(region))
            .limit(5000).execute().data)
    keys = {r["id"].split(":")[1] for r in rows if r["id"].startswith("tip:")}
    return keys, [r["headline"] for r in rows if r.get("headline")]


def _trusted(url):
    host = urllib.parse.urlparse(url or "").netloc.lower()
    return url.startswith("https://") and any(host == d or host.endswith("." + d) for d in TRUSTED)


def new_ai_tip(ai, used_headlines, now, region="GB", tries=3):
    """Ask the AI for a new tip, written from a page the pipeline has read. Returns (tip or None, ai_calls)."""
    calls, avoid = 0, list(used_headlines)
    for attempt in range(tries):
        theme = THEMES[(now.toordinal() + attempt * 7) % len(THEMES)]
        calls += 1
        try:
            r = REGIONS[region]
            pick = ai.json(PICK_PROMPT, f"Readers: {r['who']}\nOfficial sites to use: {r['sites']}\nTheme: {theme}\n"
                           "Tips already used (do not repeat these):\n- " + "\n- ".join(avoid[-300:]), 300)
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


def post_region_tip(db, region, ai=None, now=None, dry_run=False):
    """Post today's tip for one region if it's due and not posted yet. Returns (story or None, note, ai_calls)."""
    now = now or datetime.now(timezone.utc)
    tz = REGIONS[region]["tz"]
    if not dry_run and (not due(now, POST_HOUR, tz) or posted_today(db, SOURCE, now, tz, card_country(region))):
        return None, "none due", 0
    keys, headlines = _used(db, region)
    pool = [t for t in load_tips() if t.get("country", "ALL") in (region, "ALL")]
    fresh = [t for t in pool if t["key"] not in keys]
    calls, origin = 0, "list"
    if fresh and not (dry_run and ai):
        t = fresh[0]
    else:
        if not ai:
            return None, "list used up, AI off", 0
        origin = "AI"
        t, calls = new_ai_tip(ai, headlines + [x["headline"] for x in pool], now.date(), region)
        if not t:
            return None, f"AI could not write a new tip ({calls} calls)", calls
    story = story_row(f"tip:{t['key']}:{region}{now.strftime('%Y%m%d%H')}", SOURCE, "Tips", t["url"], t, now, card_country(region))
    if not dry_run:
        db.table("stories").upsert(story).execute()
    story["scene"] = t.get("scene", "")
    note = f"posted ({origin}{f', {len(fresh) - 1} left' if origin == 'list' else ''}): {t['headline']}"
    return story, note, calls


def post_daily_tip(db, ai=None, now=None, dry_run=False, regions=None):
    """Post each region's tip when it's due.
    Returns (last story or None, note for the run summary, ai_calls, [(id, scene, headline)] needing a picture)."""
    now = now or datetime.now(timezone.utc)
    if not dry_run:
        # rest-of-the-world tips posted before the XX tag existed were shown to everyone; hide them from UK/India
        db.table("stories").update({"country": "XX"}).eq("source", SOURCE).eq("country", "INTL").execute()
    retry = [(r["id"], "", r["headline"]) for r in missing_pictures(db, SOURCE, now)]
    notes, calls, story, new = [], 0, None, []
    for region in regions or REGIONS:
        st, note, c = post_region_tip(db, region, ai, now, dry_run)
        calls += c
        if st:
            story = st
            new.append((st["id"], st.get("scene", ""), st["headline"]))
        if note != "none due":
            notes.append(f"{region} {note}")
    return story, "; ".join(notes) or "none due", calls, new + retry
