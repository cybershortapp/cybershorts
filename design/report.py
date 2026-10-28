"""
Read-only picture report: which recent stories have no picture, or a picture the app can't load.
Writes report.txt into the folder given as the first argument. Changes nothing in the database.
"""
import os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
from supabase import create_client
from covers import image_problem
from pictures import is_ours

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
since = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
rows = (db.table("stories").select("id,source,headline,category,severity,created_at,image_url")
        .gte("created_at", since).order("created_at", desc=True).limit(400).execute().data)

none_, ai, copies, news = [], 0, 0, []
for r in rows:
    u = r.get("image_url") or ""
    if not u:
        none_.append(r)
    elif "/object/public/covers/" in u:
        ai += 1
    elif is_ours(u):
        copies += 1
    else:
        news.append(r)
with ThreadPoolExecutor(12) as pool:
    problems = list(pool.map(lambda r: image_problem(r["image_url"]), news))
broken = [(r, p) for r, p in zip(news, problems) if p]

lines = [f"Stories in the last 3 days: {len(rows)}",
         f"  our AI pictures: {ai}",
         f"  our copies of news pictures: {copies}",
         f"  news-site pictures (not copied yet): {len(news)}, of which the app can't load: {len(broken)}",
         f"  NO picture at all: {len(none_)}", ""]
lines.append("No picture:")
for r in none_:
    lines.append(f"  {r['created_at'][:16]} [{r.get('severity') or '-'}] {r['source']}: {r['headline'][:90]}")
lines.append("")
lines.append("Picture the app can't load:")
for r, p in broken:
    lines.append(f"  {r['created_at'][:16]} {r['source']}: {r['headline'][:70]}  ({p})")
open(os.path.join(out, "report.txt"), "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
