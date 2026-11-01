"""
Health watch: emails the owner when CyberSid stops working, before users notice.

Runs every hour on its own GitHub schedule (separate from the news pipeline) and checks:
  - the last successful pipeline run (should be within the last 40 minutes)
  - the newest news story added (should be within the last 6 hours, 12 at weekends)
One email when a problem starts (it has just crossed its limit), then a reminder once a day while it lasts.
No state is stored: the timing works from how long the problem has lasted.
If GitHub Actions itself is down this check can't run either, but GitHub emails failed runs on its own.
Sends from the app Gmail to ALERT_EMAIL (default: the app Gmail itself). Run: python monitor.py

Card reports ("Report an error" in the app) are emailed too:
  - every morning at 9am UK time: the cards reported in the last 24 hours, with the reasons and links
  - straight away (within the hour): a card that 2 or more people have reported, when a new report arrives
python monitor.py --reports-preview prints the morning email without sending it.
"""
import html
import os, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from mailer import Mailer

RUN_LIMIT = timedelta(minutes=40)


def news_limit(now):
    weekend = now.astimezone(ZoneInfo("Europe/London")).weekday() >= 5
    return timedelta(hours=12 if weekend else 6)


def check(db, now):
    problems = []
    runs = (db.table("pipeline_runs").select("started_at,finished_at,ok,sources_ok,sources_total")
            .order("started_at", desc=True).limit(20).execute().data)
    good = [r for r in runs if r.get("ok")]
    last_good = datetime.fromisoformat(good[0]["finished_at"] or good[0]["started_at"]) if good else None
    if not last_good or now - last_good > RUN_LIMIT:
        age = (now - last_good) if last_good else None
        problems.append(("runs", age, RUN_LIMIT,
                         f"No successful news run for {fmt(age)}. Check GitHub Actions (news-pipeline) "
                         "and githubstatus.com." if age else "No successful news run found."))
    # the AI's daily allowance used up: news waits until midnight UTC (happened 7 Oct, 12 hours with no news)
    cap = int(os.getenv("DAILY_AI_CAP", "2000"))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = db.table("pipeline_runs").select("ai_calls").gte("started_at", day_start.isoformat()).execute().data
    used = sum(r["ai_calls"] or 0 for r in today)
    if used >= cap * 0.98:
        problems.append(("ai", None, None, f"The AI daily limit is used up ({used} of {cap} calls). New stories wait "
                         "until midnight UTC. Raise DAILY_AI_CAP in .github/workflows/pipeline.yml if this repeats."))
    if runs:
        r = runs[0]
        if r.get("sources_total") and r["sources_ok"] < r["sources_total"] * 0.8:
            problems.append(("sources", None, None, f"Only {r['sources_ok']} of {r['sources_total']} sources worked in the last run."))
    top = (db.table("stories").select("created_at,headline,source")
           .or_("category.is.null,category.not.in.(Tips,History)")
           .order("created_at", desc=True).limit(1).execute().data)
    if top:
        age = now - datetime.fromisoformat(top[0]["created_at"])
        if age > news_limit(now):
            problems.append(("news", age, news_limit(now), f"No new news story for {fmt(age)} "
                             f"(last: {top[0]['source']}: {top[0]['headline'][:80]})."))
    return problems


def fmt(td):
    if td is None:
        return "a long time"
    h = int(td.total_seconds() // 3600)
    m = int(td.total_seconds() % 3600 // 60)
    return f"{h}h {m}m" if h else f"{m}m"


def due(problem, now):
    """Email when the problem has just started (crossed its limit in the last hour) or once a day after."""
    kind, age, limit, _ = problem
    if kind == "ai":
        return True     # rare and urgent: it stops all new news until midnight UTC
    if age is None or limit is None:
        return now.astimezone(ZoneInfo("Europe/London")).hour == 9      # no clock: once a day at 9am
    over = age - limit
    return over < timedelta(hours=1) or (over.total_seconds() // 3600) % 24 == 0


REPORT_ALERT_AT = 2   # this many reports on one card in a day: email straight away


def reported_cards(db, now, hours=24):
    """Cards reported in the last `hours`, most reported first: [{story, reasons, count, last}]."""
    rows = (db.table("reports").select("story_id,reason,created_at")
            .gte("created_at", (now - timedelta(hours=hours)).isoformat()).order("created_at", desc=True).limit(500).execute().data)
    if not rows:
        return []
    by = {}
    for r in rows:
        c = by.setdefault(r["story_id"], {"reasons": {}, "count": 0, "last": r["created_at"]})
        c["count"] += 1
        c["reasons"][r["reason"]] = c["reasons"].get(r["reason"], 0) + 1
    ids = list(by)
    stories = {}
    for i in range(0, len(ids), 100):
        for st in db.table("stories").select("id,headline,source,url,category,country,created_at").in_("id", ids[i:i + 100]).execute().data:
            stories[st["id"]] = st
    out = [dict(c, story=stories.get(sid, {"id": sid, "headline": f"(card {sid} no longer exists)", "source": "", "url": ""}))
           for sid, c in by.items()]
    return sorted(out, key=lambda c: (-c["count"], c["last"]), reverse=False)


def report_email(cards, title):
    """Plain text and HTML for a list of reported cards."""
    def reasons(c):
        return ", ".join(f"{k} x{v}" if v > 1 else k for k, v in sorted(c["reasons"].items(), key=lambda x: -x[1]))
    text = title + "\n\n" + "\n\n".join(
        f"- {c['story'].get('headline', '')}\n  {c['count']} report{'s' if c['count'] != 1 else ''}: {reasons(c)}\n"
        f"  {c['story'].get('source', '')} {c['story'].get('url', '')}\n  card id: {c['story'].get('id', '')}" for c in cards)
    text += "\n\nTo hide or fix a card, find its card id in Supabase > Table Editor > stories."
    items = "".join(
        f"<li style='margin-bottom:12px'><b>{html.escape(c['story'].get('headline', ''))}</b><br>"
        f"<span style='color:#B42318'>{c['count']} report{'s' if c['count'] != 1 else ''}: {html.escape(reasons(c))}</span><br>"
        f"<span style='color:#6B7389'>{html.escape(c['story'].get('source', ''))} · card id {html.escape(str(c['story'].get('id', '')))}</span>"
        + (f"<br><a href='{html.escape(c['story']['url'])}'>Open the article</a>" if c["story"].get("url") else "") + "</li>"
        for c in cards)
    body = (f"<div style='font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#0A0F1F'><h2 style='margin:0 0 8px'>"
            f"Cyber<span style='color:#2563F5'>Sid</span> card reports</h2><p>{html.escape(title)}</p><ul>{items}</ul>"
            f"<p style='color:#6B7389;font-size:13px'>To hide or fix a card, find its card id in Supabase, Table Editor, stories.</p></div>")
    return text, body


def report_alerts(db, now, force_morning=False):
    """(subject, text, html) emails due now about card reports."""
    emails = []
    london = now.astimezone(ZoneInfo("Europe/London"))
    if force_morning or london.hour == 9:
        cards = reported_cards(db, now, 24)
        if cards:
            n = sum(c["count"] for c in cards)
            title = f"{n} report{'s' if n != 1 else ''} on {len(cards)} card{'s' if len(cards) != 1 else ''} in the last 24 hours."
            emails.append((f"CyberSid: {len(cards)} card{'s' if len(cards) != 1 else ''} reported in the last day", *report_email(cards, title)))
    # straight away: a card several people reported, when a new report came in this past hour
    hot = [c for c in reported_cards(db, now, 24) if c["count"] >= REPORT_ALERT_AT
           and datetime.fromisoformat(c["last"]) > now - timedelta(hours=1)]
    if hot and not force_morning:
        title = f"{len(hot)} card{'s have' if len(hot) != 1 else ' has'} been reported by {REPORT_ALERT_AT} or more people today."
        emails.append((f"CyberSid: card reported by several people: {hot[0]['story'].get('headline', '')[:50]}", *report_email(hot, title)))
    return emails


def send_report_alerts(db, now):
    emails = report_alerts(db, now)
    if not emails:
        return
    mailer = Mailer()
    if not mailer.ready:
        print("No SMTP settings, can't email the card reports.")
        return
    to = os.getenv("ALERT_EMAIL", "").strip() or mailer.user
    try:
        for subject, text, body in emails:
            mailer.send(to, subject, text, body)
            print(f"Emailed {to}: {subject}")
        mailer.close()
    except Exception as ex:
        print(f"::error title=Card report email could not be sent::{str(ex)[:200]}")


def main():
    from supabase import create_client
    now = datetime.now(timezone.utc)
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    if "--reports-preview" in sys.argv:
        for subject, text, _ in report_alerts(db, now, force_morning=True) or [("(no reports in the last 24 hours)", "", "")]:
            print(subject + "\n" + text)
        return
    try:
        send_report_alerts(db, now)
    except Exception as ex:
        print(f"::warning title=Card reports check failed::{str(ex)[:200]}")
    problems = check(db, now)
    for p in problems:
        print(f"PROBLEM: {p[3]}")
    if not problems:
        print("All fine: runs and news are up to date.")
        return
    send = [p for p in problems if due(p, now)]
    if not send:
        print("Already emailed about these; next reminder within the day.")
        return
    mailer = Mailer()
    if not mailer.ready:
        print("No SMTP settings, can't email.")
        sys.exit(1)
    to = os.getenv("ALERT_EMAIL", "").strip() or mailer.user
    lines = [p[3] for p in send]
    text = "CyberSid health check found a problem:\n\n- " + "\n- ".join(lines) + \
        "\n\nRuns: https://github.com/cybershortapp/cybershorts/actions\nThis email repeats once a day until it's fixed."
    html_body = "<p>CyberSid health check found a problem:</p><ul>" + "".join(f"<li>{l}</li>" for l in lines) + \
        "</ul><p><a href='https://github.com/cybershortapp/cybershorts/actions'>Open GitHub Actions</a></p>" \
        "<p>This email repeats once a day until it's fixed.</p>"
    try:
        mailer.send(to, "CyberSid problem: " + lines[0][:70], text, html_body)
        mailer.close()
        print(f"Emailed {to}")
    except Exception as ex:
        # Gmail refused: say so plainly in the run (GitHub also emails the owner about the failed run)
        print(f"::error title=Health watch could not send its email::{str(ex)[:200]} | Problems: {' | '.join(lines)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
