"""
Health watch: emails the owner when CyberSid stops working, before users notice.

Runs every hour on its own GitHub schedule (separate from the news pipeline) and checks:
  - the last successful pipeline run (should be within the last 40 minutes)
  - the newest news story added (should be within the last 6 hours, 12 at weekends)
One email when a problem starts (it has just crossed its limit), then a reminder once a day while it lasts.
No state is stored: the timing works from how long the problem has lasted.
If GitHub Actions itself is down this check can't run either, but GitHub emails failed runs on its own.
Sends from the app Gmail to ALERT_EMAIL (default: the app Gmail itself). Run: python monitor.py
"""
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
    if age is None or limit is None:
        return now.astimezone(ZoneInfo("Europe/London")).hour == 9      # no clock: once a day at 9am
    over = age - limit
    return over < timedelta(hours=1) or (over.total_seconds() // 3600) % 24 == 0


def main():
    from supabase import create_client
    now = datetime.now(timezone.utc)
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
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
    mailer.send(to, "CyberSid problem: " + lines[0][:70], text, html_body)
    mailer.close()
    print(f"Emailed {to}")


if __name__ == "__main__":
    main()
