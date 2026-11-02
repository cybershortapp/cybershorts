"""Read-only: app problems reported by phones in the last 30 days (full messages)."""
import os, json
from datetime import datetime, timedelta, timezone
from supabase import create_client
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
rows = db.table("app_errors").select("*").gte("created_at", since).order("created_at", desc=True).limit(60).execute().data
print(f"{len(rows)} reports")
for r in rows:
    print(json.dumps({k: (str(v)[:900] if v is not None else None) for k, v in r.items() if k not in ("id",)}, ensure_ascii=False))
