"""
Phone alerts. Runs at the end of every hourly pipeline run.

Rules (so people stay informed without being annoyed):
  - at most ONE alert per phone per hour
  - the best new story since that phone's last alert: their own products / keywords first, then the most serious
  - Info-level stories only alert when they match the person's products
  - quiet hours 22:00-07:00 UK time: only Critical stories about their products, or zero-days
Sent through Expo's free push service. Phones that uninstalled the app are removed automatically.
"""
import json, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from tags import matches

EXPO_URL = "https://exp.host/--/api/v2/push/send"
RANK = {"Critical": 4, "High": 3, "Medium": 2, "Info": 1}
LOOKBACK = timedelta(hours=3)


def _post(messages):
    req = urllib.request.Request(EXPO_URL, data=json.dumps(messages).encode(), method="POST", headers={
        "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "CyberSid/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("data") or []


def _pick(stories, device, since, quiet):
    best, best_score, best_match = None, -1, None
    for s in stories:
        if s["created_at"] <= since:
            continue
        rank = RANK.get(s.get("severity") or "Info", 1)
        hit = matches(s, device.get("products"), device.get("terms"))
        zero = bool(s.get("zero_day"))
        if quiet and not ((hit and rank == 4) or zero):
            continue
        if not hit and rank < 2:
            continue
        score = (100 if hit else 0) + rank * 10 + (5 if zero else 0)
        if score > best_score:
            best, best_score, best_match = s, score, hit
    return best, best_match


def _message(token, story, hit):
    sev = story.get("severity") or "Info"
    if hit:
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


def send_alerts(db):
    now = datetime.now(timezone.utc)
    uk_hour = now.astimezone(ZoneInfo("Europe/London")).hour
    quiet = uk_hour >= 22 or uk_hour < 7
    stories = (db.table("stories")
               .select("id,headline,technical,why_it_matters,severity,category,products,zero_day,created_at")
               .gte("created_at", (now - LOOKBACK).isoformat()).order("created_at", desc=True).limit(100)
               .execute().data)
    if not stories:
        return "no new stories"
    for s in stories:
        s["created_at"] = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))

    # all phones with alerts on, 1000 at a time
    devices, start = [], 0
    while True:
        chunk = (db.table("devices").select("token,products,terms,last_push_at").eq("alerts", True)
                 .range(start, start + 999).execute().data)
        devices += chunk
        if len(chunk) < 1000:
            break
        start += 1000

    messages = []
    for d in devices:
        last = d.get("last_push_at")
        last = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        if last and now - last < timedelta(minutes=50):
            continue            # already had this hour's alert
        story, hit = _pick(stories, d, max(last or now - LOOKBACK, now - LOOKBACK), quiet)
        if story:
            messages.append(_message(d["token"], story, hit))

    sent, gone = [], []
    for i in range(0, len(messages), 100):
        batch = messages[i:i + 100]
        try:
            tickets = _post(batch)
        except Exception as ex:
            return f"push service error: {str(ex)[:80]} ({len(sent)} sent before it)"
        for m, t in zip(batch, tickets):
            if t.get("status") == "ok":
                sent.append(m["to"])
            elif (t.get("details") or {}).get("error") == "DeviceNotRegistered":
                gone.append(m["to"])

    for i in range(0, len(sent), 100):
        db.table("devices").update({"last_push_at": now.isoformat()}).in_("token", sent[i:i + 100]).execute()
    for i in range(0, len(gone), 100):
        db.table("devices").delete().in_("token", gone[i:i + 100]).execute()
    return f"{len(sent)} sent to {len(devices)} phones" + (" (quiet hours)" if quiet else "") + \
        (f", {len(gone)} uninstalled phones removed" if gone else "")
