"""Read-only: why a story shows no picture. Looks up the story and today's picture state."""
import os, urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from supabase import create_client
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
out = []
p = out.append
r = db.table("stories").select("id,source,url,image_url,category,severity,created_at,published_at,country").ilike("headline", "%Visual Studio Certificate%").execute().data
for s in r:
    p(f"STORY {s['id']} created {s['created_at'][:16]} source {s['source']} image_url={s['image_url']!r}")
    if s.get("image_url"):
        try:
            req = urllib.request.Request(s["image_url"], headers={"User-Agent": "okhttp/4.12.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                p(f"  picture loads: HTTP {resp.status} {resp.headers.get('Content-Type')} {len(resp.read(2_000_000))} bytes")
        except Exception as ex:
            p(f"  picture FAILS to load: {str(ex)[:150]}")
since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
rows = db.table("stories").select("id,source,image_url,created_at,headline").gte("created_at", since).order("created_at", desc=True).limit(300).execute().data
kind = lambda u: "none" if not u else "library" if "/covers/library/" in u else "ai" if "/object/public/covers/" in u else "copy" if "/object/public/pictures/" in u else "news-site"
p(f"LAST 24H {len(rows)} stories, pictures: {dict(Counter(kind(x['image_url']) for x in rows))}")
for x in rows:
    if not x["image_url"]:
        p(f"  NO PICTURE {x['created_at'][11:16]} {x['source'][:28]:<28} {x['headline'][:60]}")
print("\n".join(out))
open("pic.txt", "w").write("#".join(out))
# 19:26
