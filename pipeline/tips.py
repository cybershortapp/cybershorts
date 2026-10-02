"""
Tip and explainer cards, mixed into the feed so it never feels empty on quiet evenings and weekends.

Written by hand in tips.json (no AI, so they're always accurate), each linking to an official guide.
Schedule (UK time): weekdays at 8am and 7pm, weekends also at 1pm. One tip per slot, never repeated
within 90 days. They are ordinary stories with category "Tips", so saving, sharing and pictures just work,
but they never trigger phone alerts or appear in the daily email (both skip low-severity stories).
"""
import json, os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SOURCE = "CyberSid Tips"
WEEKDAY_SLOTS, WEEKEND_SLOTS = (8, 19), (8, 13, 19)
SLOT_HOURS = 3          # a late GitHub run still posts the tip, as long as it's within 3 hours
REPEAT_AFTER_DAYS = 90


def load_tips():
    with open(os.path.join(os.path.dirname(__file__), "tips.json"), encoding="utf-8") as f:
        return json.load(f)


def current_slot(now):
    """Start of the tip slot we're in right now (UK time), or None outside the slots."""
    uk = now.astimezone(ZoneInfo("Europe/London"))
    for h in (WEEKEND_SLOTS if uk.weekday() >= 5 else WEEKDAY_SLOTS):
        start = uk.replace(hour=h, minute=0, second=0, microsecond=0)
        if start <= uk < start + timedelta(hours=SLOT_HOURS):
            return start.astimezone(timezone.utc)
    return None


def post_due_tip(db, now=None):
    """Post the next tip if this slot doesn't have one yet. Returns the story dict, or None."""
    now = now or datetime.now(timezone.utc)
    slot = current_slot(now)
    if not slot:
        return None
    posted = (db.table("stories").select("id,created_at").eq("source", SOURCE)
              .gte("created_at", (now - timedelta(days=REPEAT_AFTER_DAYS)).isoformat()).execute().data)
    if any(r["created_at"] >= slot.isoformat() for r in posted):
        return None     # this slot already has its tip
    used = {r["id"].split(":")[1] for r in posted if r["id"].startswith("tip:")}
    tips = load_tips()
    fresh = [t for t in tips if t["key"] not in used]
    if not fresh:
        return None     # every tip shown in the last 90 days; wait until they become fresh again
    t = fresh[0]
    story = {
        "id": f"tip:{t['key']}:{now.strftime('%Y%m%d%H')}", "source": SOURCE, "url": t["url"],
        "orig_title": t["headline"], "headline": t["headline"], "technical": t["technical"],
        "why_it_matters": t["why"], "severity": "Info", "action": "none", "cves": [],
        "attack_chain": None, "chain_checked": True, "also_reported": [], "incident": None, "actor_group": None,
        "category": "Tips", "country": "GB", "language": "en", "image_url": None,
        "published_at": now.isoformat(), "products": [], "zero_day": False,
    }
    db.table("stories").upsert(story).execute()
    story["scene"] = t.get("scene", "")
    return story
