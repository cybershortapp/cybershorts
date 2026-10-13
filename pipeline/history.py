"""
One cyber history card a day, posted at 9am UK time (or the first run after it), shown in the main feed:
a famous attack, breach or turning point, with its real date and a link to read more.

The hand-written events in history.json come first, each used once only. An event whose anniversary is today
is posted on its day ("On this day" in the app); otherwise the event whose anniversary is furthest away is used,
so the others are kept for their own day. When the list runs out, the AI suggests an event (preferring today's
date), the pipeline reads its Wikipedia article, and the card is written only from that article. The date is
checked against the article text too. The card id carries the event date: history:<YYYY-MM-DD>:<key>.
History cards never trigger phone alerts or appear in the daily email.

The summary itself says when it happened, so nobody mistakes it for today's news: it starts with
"Nine years ago, ..." or, on the anniversary, "On this day in 2017, ...". The date shows on the card too.
"""
import json, os, re
from datetime import date, datetime, timezone

from daily import (MONTHS, UK, card_ok, date_in_text, due, is_repeat, missing_pictures, norm_url, posted_today,
                   slug, story_row, too_similar, wiki_title, wikipedia)

SOURCE = "CyberSid History"
POST_HOUR = 9
CYBER = re.compile(r"\b(cyber|hack|malware|ransomware|virus|worm|trojan|breach|exploit|vulnerab|phishing|botnet|"
                   r"denial-of-service|ddos|encryption|cryptograph|spyware|backdoor|data leak|intrusion|security|"
                   r"unauthori[sz]ed access|computer fraud|password|stolen data|personal data|attacker)", re.I)

PICK_PROMPT = """You choose the daily "cyber history" card for CyberSid, a UK cyber security news app.
Suggest 8 well-documented cyber security events (famous attacks, breaches, malware outbreaks, major vulnerabilities,
arrests, laws, firsts) that each have their OWN English Wikipedia article. Prefer events that happened on the date
the user gives (any year), then the same week, then any time. None of them may be in the user's list of events
already used, and the famous ones are mostly used already, so look wider: lesser-known but well-documented
attacks, arrests, takedowns, malware, breaches, laws and milestones from any country. Reply with ONLY JSON:
{"events": [{"wikipedia": "exact article title", "date": "YYYY-MM-DD"}]}"""

WRITE_PROMPT = """Write a cyber history card for CyberSid using ONLY facts from the Wikipedia article text the user
gives you. UK English, plain words, no hype, no em dashes. The card is about ONE moment with a date: the headline,
the summary and the date must all be about that same moment (for malware or a group, pick its best-known dated
event, e.g. its discovery or takedown). If the article is not about a cyber security event, reply
{"ok": false}. Reply with ONLY JSON:
{"ok": true,
 "headline": "what happened, max 12 words, e.g. 'WannaCry ransomware hits the NHS and the world'",
 "technical": "40 to 55 words: what happened, how, and what it led to",
 "why": "one sentence, max 18 words, the lesson for today",
 "date": "the date it happened as stated in the article: YYYY-MM-DD, or YYYY-MM if the day isn't given",
 "scene": "one simple picture idea, max 20 words, objects only, no people, no text, no logos"}"""


WHEN_PROMPT = """Rewrite the summary of a cyber history card so it starts with the exact words the user gives,
followed by a comma, and still reads naturally as one flowing text. Keep every fact and about the same length.
UK English, plain words, no em dashes. Reply with ONLY JSON: {"technical": "the rewritten summary"}"""

NUMBERS = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
           "seventeen eighteen nineteen").split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
# first words that are ordinary words (lower-cased after "Nine years ago, "); anything else is kept as written,
# because it is usually a name (WannaCry, Google, Heartbleed...)
COMMON = set("a an the after before when during while released security hackers attackers researchers criminals "
             "police in on at for over more some many two three four five it this that one an unknown".split())


def _words(n):
    if n < 20:
        return NUMBERS[n]
    return TENS[n // 10] + ("" if n % 10 == 0 else "-" + NUMBERS[n % 10])


def when_phrase(event_date, today):
    """'On this day in 2017' on the anniversary, otherwise 'Nine years ago' (or 'A year ago', 'Earlier this year')."""
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", event_date or "")
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if d and (mo, d) == (today.month, today.day) and y < today.year:
        return f"On this day in {y}"
    years = today.year - y - (1 if (mo, d or 1) > (today.month, today.day) else 0)
    if years < 1:
        return "Earlier this year" if y == today.year else "Last year"
    return "A year ago" if years == 1 else f"{_words(years).capitalize() if years < 100 else years} years ago"


def has_when(text):
    return bool(re.match(r"(On this day in \d{4}|A year ago|Earlier this year|Last year|[A-Z][a-z-]+ years ago|\d+ years ago),",
                         text or ""))


def add_when(ai, technical, phrase):
    """The summary with the 'when' at the start. Asks the AI for a natural rewrite, else simply puts it in front.
    Returns (text, ai_calls)."""
    if not phrase or has_when(technical):
        return technical, 0
    calls = 0
    if ai:
        calls = 1
        try:
            out = str(ai.json(WHEN_PROMPT, f"Start with: {phrase}\n\nSummary: {technical}", 400).get("technical") or "")
            n, m = len(technical.split()), len(out.split())
            if out.startswith(phrase + ",") and n - 8 <= m <= n + 10 and "\u2014" not in out:
                return out.strip(), calls
        except Exception:
            pass
    first = technical.split(" ", 1)[0].strip(",.'\"")
    if first.lower() in COMMON and not first.isupper():
        technical = technical[0].lower() + technical[1:]
    return f"{phrase}, {technical}", calls


def load_history():
    with open(os.path.join(os.path.dirname(__file__), "history.json"), encoding="utf-8") as f:
        return json.load(f)


def _used(db):
    rows = db.table("stories").select("id,headline,url").eq("source", SOURCE).limit(5000).execute().data
    keys = {r["id"].split(":")[-1] for r in rows}
    return keys, {norm_url(r["url"]) for r in rows}, [r["headline"] for r in rows if r.get("headline")]


def remove_old_cards(db):
    """History cards from before the daily cards (id history:<key>, dated years ago) are removed with their
    pictures, so they don't sit at the bottom of the feed. They go back into the list and get posted again."""
    rows = db.table("stories").select("id,image_url").eq("category", "History").limit(500).execute().data
    old = [r for r in rows if r["id"].count(":") == 1]
    files = [r["image_url"].split("/object/public/covers/", 1)[1].split("?")[0]
             for r in old if r.get("image_url") and "/object/public/covers/" in r["image_url"]]
    if files:
        try:
            db.storage.from_("covers").remove(files)
        except Exception:
            pass
    for r in old:
        db.table("stories").delete().eq("id", r["id"]).execute()
    return len(old)


def pick_from_list(entries, today):
    """Today's anniversary if there is one, otherwise the event whose anniversary is furthest away."""
    def days_until(e):
        d = date.fromisoformat(e["date"])
        nxt = date(today.year, d.month, min(d.day, 28) if d.month == 2 and d.day == 29 else d.day)
        if nxt < today:
            nxt = nxt.replace(year=today.year + 1)
        return (nxt - today).days
    on_day = [e for e in entries if days_until(e) == 0]
    return on_day[0] if on_day else max(entries, key=days_until)


def new_ai_event(ai, today, used_urls, used_headlines, rounds=2, per_round=4):
    """Ask the AI for events, then write the card from the Wikipedia article. Returns (card or None, ai_calls)."""
    calls, avoid = 0, list(used_headlines)
    used_titles = sorted({wiki_title(u) for u in used_urls if wiki_title(u)})
    tried = []
    for _ in range(rounds):
        calls += 1
        try:
            picks = ai.json(PICK_PROMPT, f"Date: {today.day} {MONTHS[today.month - 1]}\nArticles already used:\n- " +
                            "\n- ".join(used_titles + tried) + "\nCards already used:\n- " + "\n- ".join(avoid[-300:]),
                            600).get("events") or []
        except Exception as ex:
            print(f"  [history] AI pick failed: {str(ex)[:80]}")
            continue
        picks = [p for p in picks if isinstance(p, dict) and p.get("wikipedia")]
        print(f"  [history] AI suggested: {', '.join(str(p['wikipedia']) for p in picks)}")
        checked = 0
        for p in picks:
            tried.append(str(p["wikipedia"]))
            w = wikipedia(str(p["wikipedia"]))
            if not w:
                print(f"  [history] no Wikipedia article: {p['wikipedia']}")
                continue
            url, title, text = w
            if norm_url(url) in used_urls or too_similar(title, avoid, 0.6):
                print(f"  [history] already used: {title}")
                continue
            if len(text) < 500 or len(CYBER.findall(text[:6000])) < 2:
                print(f"  [history] not a cyber security article: {title}")
                continue
            if checked >= per_round:
                break
            checked += 1
            calls += 1
            try:
                card = ai.json(WRITE_PROMPT, f"Article: {title}\n\n{text[:6000]}", 600)
            except Exception as ex:
                print(f"  [history] AI write failed: {str(ex)[:80]}")
                continue
            if card.get("ok") is False or not card_ok(card) or too_similar(card["headline"], avoid):
                print(f"  [history] card rejected: {str(card)[:120]}")
                continue
            # the exact day if either the card or the suggestion gives one the article confirms, else the month
            found = [date_in_text(str(d or ""), text) for d in (card.get("date"), p.get("date"))]
            when = next((d for d, exact in found if exact), None) or next((d for d, _ in found if d), None)
            if not when:
                print(f"  [history] date {card.get('date')} not confirmed in the article: {title}")
                continue
            calls += 1
            if is_repeat(ai, card, avoid):
                print(f"  [history] repeats an earlier card: {card['headline']}")
                avoid.append(card["headline"])
                continue
            card.update(url=url, date=when, key=slug(title, 40))
            return card, calls
    return None, calls


def add_when_to_old_cards(db, ai=None):
    """One-off: history cards posted before the summary said when it happened get the opening added,
    worked out from the day each card was posted. Returns a note for the log."""
    rows = db.table("stories").select("id,technical,published_at").eq("category", "History").limit(500).execute().data
    done, calls = [], 0
    for r in rows:
        m = re.match(r"history:(\d{4}-\d{2}(?:-\d{2})?):", r["id"])
        if not m or has_when(r["technical"]):
            continue
        posted = datetime.fromisoformat(r["published_at"].replace("Z", "+00:00")).astimezone(UK).date()
        text, c = add_when(ai, r["technical"], when_phrase(m.group(1), posted))
        calls += c
        if text != r["technical"]:
            db.table("stories").update({"technical": text}).eq("id", r["id"]).execute()
            done.append(f"{r['id']}: {text[:90]}")
    return done, calls


def post_daily_history(db, ai=None, now=None, dry_run=False):
    """Post today's history card if it's due and not posted yet.
    Returns (story or None, note for the run summary, ai_calls, [(id, scene, headline)] needing a picture)."""
    now = now or datetime.now(timezone.utc)
    calls = 0
    if not dry_run:
        remove_old_cards(db)
        done, calls = add_when_to_old_cards(db, ai)     # does nothing once every card has it
        for line in done:
            print(f"  [history] wording updated: {line}")
    retry = [(r["id"], "", r["headline"]) for r in missing_pictures(db, SOURCE, now)]
    if not dry_run and (not due(now, POST_HOUR) or posted_today(db, SOURCE, now)):
        return None, "none due", calls, retry
    today = now.astimezone(UK).date()
    keys, urls, headlines = _used(db)
    entries = load_history()
    fresh = [e for e in entries if e["key"] not in keys and norm_url(e["url"]) not in urls]
    origin = "list"
    if fresh and not (dry_run and ai):
        e = pick_from_list(fresh, today)
    else:
        if not ai:
            return None, "list used up, AI off", calls, retry
        origin = "AI"
        e, c = new_ai_event(ai, today, urls | {norm_url(x["url"]) for x in entries},
                                headlines + [x["headline"] for x in entries])
        calls += c
        if not e:
            return None, f"AI could not find a new event ({calls} calls)", calls, retry
    e = dict(e)
    e["technical"], c = add_when(ai, e["technical"], when_phrase(e["date"], today))
    calls += c
    story = story_row(f"history:{e['date']}:{e['key']}", SOURCE, "History", e["url"], e, now)
    if not dry_run:
        db.table("stories").upsert(story).execute()
    note = (f"posted ({origin}{f', {len(fresh) - 1} left in list' if origin == 'list' else ''}): "
            f"{e['date']} {e['headline']}")
    return story, note, calls, [(story["id"], e.get("scene", ""), e["headline"])] + retry
