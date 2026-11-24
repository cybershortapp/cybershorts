"""
Read-only usage numbers for CyberSid, printed as totals only (no phone tokens, emails or other personal details).
Each phone with alerts on refreshes its row every time the app opens, so updated_at shows when it last opened.
python app_stats.py
"""
import os
from collections import Counter
from datetime import datetime, timedelta, timezone

from supabase import create_client


def rows(db, table, cols):
    out, start = [], 0
    while True:
        r = db.table(table).select(cols).range(start, start + 999).execute().data
        out += r
        if len(r) < 1000:
            return out
        start += 1000


def when(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
now = datetime.now(timezone.utc)
lines = []

phones = rows(db, "devices", "country,updated_at,products")
seen = [when(p["updated_at"]) for p in phones]
lines.append(f"Phones with alerts on: {len(phones)} ({', '.join(f'{k} {v}' for k, v in Counter(p['country'] for p in phones).most_common())})")
for label, days in (("today (24h)", 1), ("this week (7 days)", 7), ("this month (30 days)", 30)):
    lines.append(f"Opened the app {label}: {sum(1 for t in seen if t and now - t <= timedelta(days=days))}")
lines.append(f"Follow at least one product: {sum(1 for p in phones if p.get('products'))}")

subs = rows(db, "subscribers", "confirmed,created_at")
lines.append(f"Email digest: {sum(1 for s in subs if s['confirmed'])} confirmed, {sum(1 for s in subs if not s['confirmed'])} not confirmed")

errs = rows(db, "app_errors", "fatal,app_version,created_at")
recent = [e for e in errs if now - when(e["created_at"]) <= timedelta(days=7)]
lines.append(f"App errors in the last 7 days: {len(recent)} ({sum(1 for e in recent if e['fatal'])} crashes); "
             f"by version: {dict(Counter(e['app_version'] for e in recent))}")

reps = rows(db, "reports", "created_at")
lines.append(f"Stories reported by readers: {len(reps)} in total, {sum(1 for r in reps if now - when(r['created_at']) <= timedelta(days=7))} this week")

for l in lines:
    print(l)
with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
    f.write("## CyberSid usage\n\n" + "\n".join(f"- {l}" for l in lines) + "\n")
print("::notice title=CyberSid usage::" + " | ".join(lines))
