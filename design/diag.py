"""Read-only checks for the app: how often stories get an attack chain, and what the app's games and
deck queries return (run exactly as the app runs them, with the public key). Writes diag.txt."""
import json, os, sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from supabase import create_client

out = open(os.path.join(sys.argv[1], "diag.txt"), "w")
def p(*a):
    print(*a); print(*a, file=out)

db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
now = datetime.now(timezone.utc)
since = (now - timedelta(days=7)).isoformat()
rows = []
start = 0
while True:
    part = (db.table("stories").select("id,created_at,published_at,source,category,severity,attack_chain,chain_checked,headline,country")
            .gte("created_at", since).order("created_at", desc=True).range(start, start + 999).execute().data)
    rows += part
    if len(part) < 1000:
        break
    start += 1000
rows = [r for r in rows if not (r["source"] or "").startswith("CyberSid")]
p(f"== Attack chains, stories added in the last 7 days ({len(rows)}) ==")
day = defaultdict(lambda: [0, 0, 0])
for r in rows:
    d = r["created_at"][:10]
    day[d][0] += 1
    if r.get("attack_chain"):
        day[d][1] += 1
    if r["category"] in ("Ransomware", "Breaches") and r["severity"] in ("Critical", "High"):
        day[d][2] += 1
for d in sorted(day, reverse=True):
    t, c, serious = day[d]
    p(f"{d}: {t} stories, {c} with a chain, {serious} serious ransomware/breach stories")
p("\nNewest stories with a chain:")
for r in [r for r in rows if r.get("attack_chain")][:8]:
    p(f"  {r['created_at'][:16]}  {r['category']:<15} {r['severity']:<8} {len(r['attack_chain'])} steps  {r['headline'][:70]}")
p("\nLast 12 hours, serious ransomware/breach stories (could have had a chain):")
cut = (now - timedelta(hours=12)).isoformat()
for r in rows:
    if r["created_at"] >= cut and r["category"] in ("Ransomware", "Breaches") and r["severity"] in ("Critical", "High"):
        p(f"  {r['created_at'][11:16]}  chain={'yes' if r.get('attack_chain') else 'no '}  {r['source'][:18]:<18} {r['headline'][:70]}")

runs = db.table("pipeline_runs").select("started_at,added,merged,failed,ai_calls,research,ok").gte("started_at", (now - timedelta(hours=24)).isoformat()).order("started_at", desc=True).execute().data
p(f"\n== News runs, last 24 hours: {len(runs)} runs, {sum(1 for r in runs if r['ok'])} ok, "
  f"{sum(r['added'] or 0 for r in runs)} stories added, {sum(r['ai_calls'] or 0 for r in runs)} AI calls, {sum(r['research'] or 0 for r in runs)} chain research ==")
for r in runs[:10]:
    p(f"  {r['started_at'][:16]} added {r['added']} merged {r['merged']} failed {r['failed']} ai {r['ai_calls']} research {r['research']} ok {r['ok']}")

# ---- the app's own queries, with the public key, exactly as the app sends them ----
eas = json.load(open("app/eas.json"))["build"]["preview"]["env"]
app = create_client(eas["EXPO_PUBLIC_SUPABASE_URL"], eas["EXPO_PUBLIC_SUPABASE_KEY"])
for region, countries in (("GB", ["INTL", "GB"]), ("INTL", ["INTL", "XX"])):
    g_since = (now - timedelta(days=4)).isoformat()
    try:
        res = (app.table("games").select("id,story_id,style,data,created_at,stories!inner(headline,country,image_url)")
               .gte("created_at", g_since).in_("stories.country", countries).order("created_at", desc=True).limit(60).execute())
        g = res.data or []
        p(f"\n== App games query, region {region}: {len(g)} games == styles {dict(Counter(x['style'] for x in g))}")
        for x in g[:6]:
            p(f"  {x['created_at'][:16]} {x['style']:<15} {x['stories']['country']} {x['stories']['headline'][:60]}")
    except Exception as ex:
        p(f"\n== App games query, region {region}: FAILED {str(ex)[:300]}")
    try:
        d = (app.table("decks").select("id,topic,title,slides,story_ids,country").gt("expires_at", now.isoformat())
             .in_("country", countries).order("created_at", desc=True).limit(1).execute().data)
        p(f"== App deck query, region {region}: {[(x['title'], len(x['slides'])) for x in d]}")
    except Exception as ex:
        p(f"== App deck query, region {region}: FAILED {str(ex)[:300]}")
all_games = db.table("games").select("style,created_at").gte("created_at", (now - timedelta(days=2)).isoformat()).execute().data
p(f"\n== Games made in the last 2 days: {len(all_games)} {dict(Counter(x['style'] for x in all_games))}")
