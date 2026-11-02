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

# growth.sql check (2 Nov): the sizes the growth email uses
try:
    s = db.rpc("usage_sizes").execute().data or {}
    print(f"usage_sizes OK: database {int(s.get('db_bytes') or 0) / 2**20:.0f} MB")
    for f in s.get("storage") or []:
        print(f"  storage {f['bucket']}/{f['folder'] or '(top)'}: {f['files']} files, {int(f['bytes']) / 2**20:.0f} MB, avg {int(f['bytes']) / max(1, int(f['files'])) / 1024:.0f} KB")
except Exception as ex:
    print("usage_sizes failed:", str(ex)[:200])
