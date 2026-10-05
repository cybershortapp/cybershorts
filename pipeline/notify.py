"""
Phone alerts. Runs at the end of every pipeline run (every 30 minutes).

Rules:
  - every new card gets an alert: news, the daily tip and the daily history card, as long as the story itself
    is recent (published in the last 24 hours); older stories found late go in the feed quietly
  - more than 4 new cards in one run: the 3 most important get their own alert, the rest come as one
    "more new stories" alert, so a busy moment doesn't buzz the phone ten times
  - quiet hours 22:00-07:00 UK time: only Critical stories about the person's products, or zero-days;
    everything else from the night arrives as one "overnight" alert at 7am
Sent through Expo's free push service. Phones that uninstalled the app are removed automatically.
"""
import json, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from tags import matches

EXPO_URL = "https://exp.host/--/api/v2/push/send"
RANK = {"Critical": 4, "High": 3, "Medium": 2, "Info": 1}
UK = ZoneInfo("Europe/London")
LOOKBACK = timedelta(hours=12)      # far enough back to cover the whole night
FRESH = timedelta(hours=24)         # only alert about stories published in the last day
NEW_PHONE = timedelta(hours=1)      # a phone that never had an alert gets only the last hour's cards
MAX_SINGLE = 4                      # up to this many cards per run each get their own alert


def _post(messages):
    req = urllib.request.Request(EXPO_URL, data=json.dumps(messages).encode(), method="POST", headers={
        "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "CyberSid/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("data") or []


def _quiet(t):
    h = t.astimezone(UK).hour
    return h >= 22 or h < 7


def _urgent(s, hit):
    """Important enough to wake someone: critical news about their products, or a zero-day."""
    return bool(s.get("zero_day")) or (bool(hit) and s.get("severity") == "Critical")


def _score(s, hit):
    return (100 if hit else 0) + RANK.get(s.get("severity") or "Info", 1) * 10 + (5 if s.get("zero_day") else 0)


def _message(token, story, hit):
    sev = story.get("severity") or "Info"
    cat = story.get("category")
    if cat == "Tips":
        title = "Today's tip"
    elif cat == "History":
        title = "Cyber history"
    elif hit:
        title = f"For you: {hit}"
    elif story.get("zero_day"):
        title = "Zero-day alert"
    else:
        title = {"Critical": "Critical alert", "High": "High priority"}.get(sev, "Cyber news")
    body = story["headline"]
    if story.get("why_it_matters"):
        body += f"\n{story['why_it_matters']}"
    return {"to": token, "title": title, "body": body[:230], "sound": "default", "channelId": "news",
            "priority": "high" if sev == "Critical" or hit else "default", "data": {"storyId": story["id"]}}


def _summary(token, stories, title):
    lines = [f"- {s['headline']}" for s in stories[:4]]
    if len(stories) > 4:
        lines.append(f"and {len(stories) - 4} more")
    return {"to": token, "title": title, "body": "\n".join(lines)[:230], "sound": "default", "channelId": "news",
            "priority": "default", "data": {"storyId": stories[0]["id"]}}


def plan(stories, device, now):
    """The alerts one phone should get from this run. Stories must be oldest first."""
    last = device.get("last_push_at")
    last = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else now - NEW_PHONE
    token = device["token"]
    hits = {s["id"]: matches(s, device.get("products"), device.get("terms")) for s in stories}
    if _quiet(now):
        return [_message(token, s, hits[s["id"]]) for s in stories
                if s["created_at"] > last and _urgent(s, hits[s["id"]])]

    uk_now = now.astimezone(UK)
    morning = uk_now.replace(hour=7, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    night_start = morning - timedelta(hours=9, minutes=30)      # 21:30 the evening before
    messages = []
    # first run after quiet hours: one alert for everything from the night that wasn't urgent enough to send
    if last < morning:
        night = [s for s in stories if night_start <= s["created_at"] < morning
                 and not (_quiet(s["created_at"]) and _urgent(s, hits[s["id"]]))]
        if len(night) == 1:
            messages.append(_message(token, night[0], hits[night[0]["id"]]))
        elif night:
            night.sort(key=lambda s: -_score(s, hits[s["id"]]))
            messages.append(_summary(token, night, f"{len(night)} new stories overnight"))
    fresh = [s for s in stories if s["created_at"] > max(last, morning)]
    if len(fresh) > MAX_SINGLE:
        ranked = sorted(fresh, key=lambda s: -_score(s, hits[s["id"]]))
        top, rest = ranked[:MAX_SINGLE - 1], ranked[MAX_SINGLE - 1:]
        messages.append(_summary(token, rest, f"{len(rest)} more new stories"))
        fresh = [s for s in fresh if s in top]
    messages += [_message(token, s, hits[s["id"]]) for s in fresh]
    return messages


def send_alerts(db):
    now = datetime.now(timezone.utc)
    quiet = _quiet(now)
    stories = (db.table("stories")
               .select("id,headline,technical,why_it_matters,severity,category,products,zero_day,created_at,published_at,country")
               .gte("created_at", (now - LOOKBACK).isoformat()).order("created_at").limit(300)
               .execute().data)
    for s in stories:
        s["created_at"] = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))
    # a story published days ago but only picked up now is old news: it goes in the feed, no alert
    stories = [s for s in stories if datetime.fromisoformat(s["published_at"].replace("Z", "+00:00")) >= now - FRESH]

    # all phones with alerts on, 1000 at a time (country: where the reader is; older phones count as UK)
    devices, start, fields = [], 0, "token,products,terms,last_push_at,country"
    while True:
        try:
            chunk = (db.table("devices").select(fields).eq("alerts", True)
                     .range(start, start + 999).execute().data)
        except Exception:
            if fields.endswith(",country"):     # the country column hasn't been added yet
                fields = "token,products,terms,last_push_at"
                continue
            raise
        devices += chunk
        if len(chunk) < 1000:
            break
        start += 1000

    messages, handled = [], []
    for d in devices:
        # each reader gets news for everyone plus their own country's local news and tips
        home = d.get("country") or "GB"
        mine = {"INTL", home} | ({"XX"} if home == "INTL" else set())   # XX: the rest-of-the-world tip
        m = plan([s for s in stories if (s.get("country") or "INTL") in mine], d, now)
        messages += m
        # remember what this phone has been sent; in quiet hours only when something was sent, so the
        # rest of the night still goes into the 7am alert
        if m or not quiet:
            handled.append(d["token"])

    sent, gone, problems = set(), [], []
    for i in range(0, len(messages), 100):
        batch = messages[i:i + 100]
        try:
            tickets = _post(batch)
        except Exception as ex:
            problems.append(f"push service error: {str(ex)[:80]}")
            handled = [t for t in handled if t in sent]
            break
        for m, t in zip(batch, tickets):
            if t.get("status") == "ok":
                sent.add(m["to"])
            elif (t.get("details") or {}).get("error") == "DeviceNotRegistered":
                gone.append(m["to"])
            else:
                problems.append(f"{(t.get('details') or {}).get('error', '')} {t.get('message', '')}".strip()[:120])

    handled = [t for t in handled if t not in gone]
    for i in range(0, len(handled), 100):
        db.table("devices").update({"last_push_at": now.isoformat()}).in_("token", handled[i:i + 100]).execute()
    for i in range(0, len(gone), 100):
        db.table("devices").delete().in_("token", gone[i:i + 100]).execute()
    regions = {}
    for d in devices:
        k = d.get("country") or ("GB?" if "country" not in d else "GB")
        regions[k] = regions.get(k, 0) + 1
    where = ", ".join(f"{k} {v}" for k, v in sorted(regions.items()))
    return f"{len(messages)} alerts to {len(sent)} of {len(devices)} phones ({where})" + (" (quiet hours)" if quiet else "") + \
        (f", {len(gone)} uninstalled phones removed" if gone else "") + \
        (f", problems: {' | '.join(dict.fromkeys(problems))}" if problems else "")


def _receipts(ids):
    req = urllib.request.Request("https://exp.host/--/api/v2/push/getReceipts", data=json.dumps({"ids": ids}).encode(),
                                 method="POST", headers={"Accept": "application/json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("data") or {}


def test_alert(db):
    """Send one test alert to every registered phone right now, then check Google actually delivered it.
    Run: python pipeline.py --test-alert"""
    import time
    devices = db.table("devices").select("token,alerts,updated_at").execute().data
    print(f"\n=== Test alert: {len(devices)} phone(s) registered ===")
    for d in devices:
        print(f"  phone ...{d['token'][-10:]}  alerts on: {d['alerts']}  last updated: {str(d.get('updated_at'))[:16]}")
    if not devices:
        print("\nNo phones registered. Open CyberSid, go to Preferences, and check the Phone alerts status line.\n")
        return
    story = (db.table("stories").select("id,headline").order("created_at", desc=True).limit(1).execute().data or [{}])[0]
    msgs = [{"to": d["token"], "title": "CyberSid test alert", "body": "If you can read this, alerts work. Tap to open the latest story.",
             "sound": "default", "channelId": "news", "priority": "high", "data": {"storyId": story.get("id")}} for d in devices]
    tickets = _post(msgs)
    ids = []
    for m, t in zip(msgs, tickets):
        tail = m["to"][-10:]
        if t.get("status") == "ok":
            ids.append(t["id"])
            print(f"  ...{tail}: accepted by Expo")
        else:
            print(f"  ...{tail}: REFUSED by Expo: {t.get('message')} {(t.get('details') or {}).get('error', '')}")
    if not ids:
        return
    print("\nWaiting 15 seconds, then asking Google whether it was delivered...")
    time.sleep(15)
    for tid, rc in _receipts(ids).items():
        if rc.get("status") == "ok":
            print("  Delivered to Google OK. The phone should show it now.")
        else:
            print(f"  NOT delivered: {rc.get('message')}  [{(rc.get('details') or {}).get('error', '')}]")
    print()
