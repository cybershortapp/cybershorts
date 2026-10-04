"""
Cyber history cards for the History tab: famous attacks, breaches and turning points, hand-written
in history.json (no AI) with the real date and a link to read more.

Each run checks the database has every entry; anything new in history.json is added (with an AI picture
on the next runs). The cards are ordinary stories with category "History" and their real date, so they
never appear in the main feed, alerts or the daily email; the app's History tab sorts them by anniversary.
"""
import json, os

SOURCE = "CyberSid History"


def load_history():
    with open(os.path.join(os.path.dirname(__file__), "history.json"), encoding="utf-8") as f:
        return json.load(f)


def sync_history(db):
    """Add any history entries the database doesn't have yet.
    Returns [(id, scene, headline)] for history cards that still need a picture."""
    entries = load_history()
    rows = db.table("stories").select("id,image_url").eq("category", "History").execute().data
    have = {r["id"] for r in rows}
    by_id = {f"history:{e['key']}": e for e in entries}
    # existing cards still waiting for a picture (pictures are made a few per run, news first)
    added = [(r["id"], by_id[r["id"]].get("scene", ""), by_id[r["id"]]["headline"])
             for r in rows if not r["image_url"] and r["id"] in by_id]
    for e in entries:
        sid = f"history:{e['key']}"
        if sid in have:
            continue
        db.table("stories").upsert({
            "id": sid, "source": SOURCE, "url": e["url"], "orig_title": e["headline"], "headline": e["headline"],
            "technical": e["technical"], "why_it_matters": e["why"], "severity": "Info", "action": "none", "cves": [],
            "attack_chain": None, "chain_checked": True, "also_reported": [], "incident": None, "actor_group": None,
            "category": "History", "country": "GB", "language": "en", "image_url": None,
            "published_at": f"{e['date']}T12:00:00+00:00", "products": [], "zero_day": False,
        }).execute()
        added.append((sid, e.get("scene", ""), e["headline"]))
    return added
