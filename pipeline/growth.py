"""Growth watch: emails the owner before CyberSid outgrows a free limit, with the best action to take.

Checked every day at 9am UK time by the health watch (monitor.py):
  - data sent to phones by Supabase this month (estimated: readers x data per visit), cached and uncached
  - database size and file storage (exact, from the usage_sizes() function in growth.sql)
  - email subscribers against Gmail's ~500 emails a day
  - Cloudflare R2 storage, once pictures are there
Each limit is green (under 70%), amber (70-90%) or red (90% or more).
Emails: red, every day until fixed; amber, Mondays and Thursdays; all green, a short summary on Mondays.
No state is stored. Run: python growth.py --preview (prints the email without sending it).

Readers are counted from the app itself: each time it opens, a phone with alerts on refreshes its row in the
devices table (updated_at), so phones seen in the last day = readers that day (times 1.5 for phones with
alerts off, a guess). Data per visit uses the real average picture sizes from storage.
"""
import html
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import store

GB = 1024 ** 3
MB = 1024 ** 2
CARDS_PER_VISIT = 30          # cards a reader looks at in one visit (a guess, on the high side)
ALERTS_OFF_FACTOR = 1.5       # readers per phone with alerts on
TEXT_PER_VISIT = 0.1 * MB     # card text, games and decks (measured: 40 cards are ~20 KB compressed)
GUESS_PICTURE = 120 * 1024    # used until growth.sql is run
GUESS_DEPTH = 20 * 1024
GMAIL_PER_DAY = 500
# the app loads 3D depth maps from next to the picture from build 7 of 1.0.6 on; set DEPTH_FROM_R2=true in
# monitor.yml once most readers have that version, so the estimate stops counting them on Supabase
DEPTH_FROM_R2 = os.getenv("DEPTH_FROM_R2", "").lower() == "true"

# the free limits, per month where it's data (Supabase free plan, Cloudflare R2 free tier)
FREE = {"cached": 5 * GB, "uncached": 5 * GB, "database": 500 * MB, "files": 1 * GB, "email": GMAIL_PER_DAY,
        "r2": 10 * GB}
PRO_NOTE = "Supabase Pro: $25 a month, 250 GB cached + 250 GB uncached data, 8 GB database, 100 GB files"


def _count(db, table, since=None):
    q = db.table(table).select("*", count="exact").limit(1)
    if since:
        q = q.gte("updated_at", since)
    return q.execute().count or 0


def measure(db, now):
    m = {"now": now}
    # readers: phones (alerts on) that opened the app in the last day
    m["phones"] = _count(db, "devices")
    m["active"] = _count(db, "devices", (now - timedelta(days=1)).isoformat())
    m["readers"] = round(m["active"] * ALERTS_OFF_FACTOR)
    # where the last 2 days' card pictures are
    rows = (db.table("stories").select("image_url").gte("created_at", (now - timedelta(days=2)).isoformat())
            .not_.is_("image_url", "null").limit(500).execute().data)
    urls = [r["image_url"] for r in rows if r.get("image_url")]
    on_r2 = sum(store.on_r2(u) for u in urls)
    on_sb = sum("/storage/v1/object/public/" in u and not store.on_r2(u) for u in urls)
    m["pictures_recent"] = len(urls)
    m["r2_share"] = on_r2 / max(1, on_r2 + on_sb)
    # sizes (exact) from growth.sql
    m["sizes_ok"] = False
    avg_pic, avg_depth = GUESS_PICTURE, GUESS_DEPTH
    try:
        s = db.rpc("usage_sizes").execute().data or {}
        m["database"] = int(s.get("db_bytes") or 0)
        folders = s.get("storage") or []
        m["files"] = sum(int(f.get("bytes") or 0) for f in folders)
        pics = [f for f in folders if f.get("bucket") in ("pictures", "covers") and f.get("folder") not in ("depth", "library")]
        n = sum(int(f.get("files") or 0) for f in pics)
        if n:
            avg_pic = sum(int(f.get("bytes") or 0) for f in pics) / n
        dep = [f for f in folders if f.get("folder") == "depth"]
        n = sum(int(f.get("files") or 0) for f in dep)
        if n:
            avg_depth = sum(int(f.get("bytes") or 0) for f in dep) / n
        m["sizes_ok"] = True
    except Exception as ex:
        m["sizes_error"] = str(ex)[:120]
    m["avg_picture"], m["avg_depth"] = avg_pic, avg_depth
    # data per visit from Supabase: pictures still saved there, the 3D depth maps (still on Supabase), card text
    depth_share = (1 - m["r2_share"]) if DEPTH_FROM_R2 else 1
    m["visit_cached"] = CARDS_PER_VISIT * ((1 - m["r2_share"]) * avg_pic + depth_share * avg_depth)
    m["visit_uncached"] = TEXT_PER_VISIT
    m["cached"] = m["readers"] * m["visit_cached"] * 30
    m["uncached"] = m["readers"] * m["visit_uncached"] * 30
    m["email"] = (db.table("subscribers").select("email", count="exact").eq("confirmed", True).limit(1).execute().count or 0)
    m["r2_on"] = store.r2_on()
    try:
        r2 = store.r2_size()
        m["r2"] = r2[1] if r2 else None
    except Exception as ex:
        m["r2"] = None
        m["r2_error"] = str(ex)[:120]
    return m


def _level(p):
    return "red" if p >= 0.9 else "amber" if p >= 0.7 else "green"


def assess(m):
    """[(key, name, used text, limit text, share, level, best action)], worst first."""
    items = []

    def add(key, name, used, limit, used_txt, limit_txt, action):
        if used is None:
            return
        p = used / limit if limit else 0
        items.append((key, name, used_txt, limit_txt, p, _level(p), action))

    r2_ready = m["r2_share"] > 0.5      # most new card pictures are already on R2
    add("cached", "Pictures sent to phones (Supabase, estimate)", m["cached"], FREE["cached"],
        f"{m['cached'] / GB:.1f} GB a month", "5 GB",
        (("Upgrade Supabase to Pro ($25 a month) and turn the spend cap off." if DEPTH_FROM_R2 else
          "Release the app update that loads 3D depth maps from R2, or upgrade Supabase to Pro ($25 a month) "
          "and turn the spend cap off.")
         if r2_ready else
         "Do step 1 now: move card pictures to Cloudflare R2 (free). Ask Claude, the code is ready."))
    add("uncached", "Card text sent to phones (Supabase, estimate)", m["uncached"], FREE["uncached"],
        f"{m['uncached'] / GB:.1f} GB a month", "5 GB",
        "Upgrade Supabase to Pro ($25 a month) and turn the spend cap off.")
    add("database", "Database size", m.get("database"), FREE["database"],
        f"{m.get('database', 0) / MB:.0f} MB", "500 MB",
        "Ask Claude to delete old stories sooner, or upgrade Supabase to Pro (8 GB).")
    add("files", "Supabase file storage", m.get("files"), FREE["files"],
        f"{m.get('files', 0) / MB:.0f} MB", "1 GB",
        "Ask Claude to delete old pictures sooner." if r2_ready else
        "Move card pictures to Cloudflare R2 (step 1). Ask Claude.")
    add("email", "Daily email subscribers (Gmail)", m["email"], FREE["email"],
        f"{m['email']} people", "about 500 a day",
        "Move the daily email to a proper email service before 500 subscribers. Ask Claude.")
    add("r2", "Cloudflare R2 storage", m.get("r2"), FREE["r2"],
        f"{(m.get('r2') or 0) / GB:.1f} GB", "10 GB free",
        "Fine to go over (it costs a few pence a GB), or ask Claude to delete old pictures sooner.")
    order = {"red": 0, "amber": 1, "green": 2}
    items.sort(key=lambda i: (order[i[5]], -i[4]))
    return items


def email(m, items, weekly=False):
    """(subject, text, html), or None when nothing needs saying today."""
    worst = items[0][5] if items else "green"
    london = m["now"].astimezone(ZoneInfo("Europe/London"))
    day = london.weekday()
    if worst == "red":
        pass
    elif worst == "amber" and day not in (0, 3) and not weekly:
        return None
    elif worst == "green" and day != 0 and not weekly:
        return None
    todo = [i for i in items if i[5] != "green"]
    if todo:
        best = todo[0][6]
        subject = f"CyberSid growth: {'ACTION NEEDED' if worst == 'red' else 'plan ahead'}: {todo[0][1].split(' (')[0].lower()}"
    else:
        best = ("Nothing to do. Next step when it turns amber: "
                + ("Supabase Pro ($25 a month)." if m["r2_share"] > 0.5 else "move card pictures to Cloudflare R2 (free)."))
        subject = "CyberSid growth: all fine (weekly check)"
    readers = (f"{m['active']} phones opened CyberSid in the last day (with alerts on), so about {m['readers']} readers. "
               f"{m['phones']} phones have alerts on in total.")
    pics = f"{round(m['r2_share'] * 100)}% of new card pictures are on Cloudflare R2" + (
        " (R2 not set up yet)" if not m["r2_on"] and m["r2_share"] == 0 else "")
    sizes = ("" if m["sizes_ok"] else
             "Database and file storage sizes need growth.sql run once in the Supabase SQL Editor.")
    lines = [f"Best action now: {best}", "", readers, pics + ".", ""]
    for _, name, used, limit, p, level, action in items:
        lines.append(f"[{level.upper()}] {name}: {used} of {limit} ({round(p * 100)}%)" + (f"\n    -> {action}" if level != "green" else ""))
    if sizes:
        lines += ["", sizes]
    lines += ["", f"Estimates: {CARDS_PER_VISIT} cards a visit, about {m['visit_cached'] / MB:.1f} MB of pictures and "
              f"{m['visit_uncached'] / MB:.1f} MB of text from Supabase per visit. Real figures: Supabase, your project, Usage.",
              PRO_NOTE + "."]
    text = "\n".join(lines)
    dot = {"red": "#E5484D", "amber": "#F5A524", "green": "#22C55E"}
    rows = "".join(
        f"<tr><td style='padding:6px 8px'><span style='display:inline-block;width:10px;height:10px;border-radius:5px;"
        f"background:{dot[level]}'></span></td><td style='padding:6px 8px'><b>{html.escape(name)}</b>"
        + (f"<br><span style='color:#8A4B00'>{html.escape(action)}</span>" if level != "green" else "")
        + f"</td><td style='padding:6px 8px;white-space:nowrap'>{html.escape(used)}<br><span style='color:#6B7389'>of "
        f"{html.escape(limit)}</span></td><td style='padding:6px 8px;text-align:right'><b>{round(p * 100)}%</b></td></tr>"
        for _, name, used, limit, p, level, action in items)
    banner = dot[worst]
    body = (f"<div style='font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#0A0F1F'>"
            f"<h2 style='margin:0 0 10px'>Cyber<span style='color:#2563F5'>Sid</span> growth check</h2>"
            f"<div style='border-left:5px solid {banner};background:#F6F8FC;padding:12px 14px;margin:0 0 14px'>"
            f"<b>Best action now:</b> {html.escape(best)}</div>"
            f"<p style='margin:0 0 4px'>{html.escape(readers)}</p><p style='margin:0 0 12px'>{html.escape(pics)}.</p>"
            f"<table style='border-collapse:collapse;width:100%;font-size:14px'>{rows}</table>"
            + (f"<p style='color:#8A4B00'>{html.escape(sizes)}</p>" if sizes else "")
            + f"<p style='color:#6B7389;font-size:12px'>Estimates: {CARDS_PER_VISIT} cards a visit, about "
            f"{m['visit_cached'] / MB:.1f} MB of pictures and {m['visit_uncached'] / MB:.1f} MB of text from Supabase per "
            f"visit. Real figures: Supabase, your project, Usage. {html.escape(PRO_NOTE)}.</p></div>")
    return subject, text, body


def growth_email(db, now, weekly=False):
    m = measure(db, now)
    return email(m, assess(m), weekly)


if __name__ == "__main__":
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    e = growth_email(db, datetime.now(timezone.utc), weekly=True)
    print(e[0] + "\n\n" + e[1])
