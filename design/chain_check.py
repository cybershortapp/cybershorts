"""Read-only: why serious stories from the last 48 hours have no attack chain.
For each one: can we read the article (how much text), and does a strong free model (NVIDIA, then OVH) write a
chain from the full text now? Also tries the other outlets that reported the same story (also_reported).
Nothing is written to the database. Writes chain_check.txt."""
import os, sys, time
from datetime import datetime, timedelta, timezone
ROOT = os.path.abspath("pipeline")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import ai as A
import pipeline as P
from supabase import create_client

out = open(os.path.join(sys.argv[1], "chain_check.txt"), "w")
def p(*a):
    print(*a); print(*a, file=out); out.flush()

db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
now = datetime.now(timezone.utc)
rows = (db.table("stories").select("id,created_at,source,url,headline,category,severity,attack_chain,also_reported,actor_group,incident")
        .gte("created_at", (now - timedelta(hours=48)).isoformat()).order("created_at", desc=True).limit(400).execute().data)
rows = [r for r in rows if not (r["source"] or "").startswith("CyberSid")]
serious = [r for r in rows if r["category"] in ("Ransomware", "Breaches", "Vulnerabilities") and r["severity"] in ("Critical", "High")]
have = [r for r in serious if r.get("attack_chain")]
p(f"== Last 48 hours: {len(rows)} news stories, {sum(1 for r in rows if r.get('attack_chain'))} with a chain. "
  f"Serious ransomware/breach/vulnerability: {len(serious)}, {len(have)} with a chain ==")
by_cat = {}
for r in serious:
    c = by_cat.setdefault(r["category"], [0, 0]); c[0] += 1; c[1] += bool(r.get("attack_chain"))
p("   by category (serious): " + ", ".join(f"{k} {v[1]}/{v[0]}" for k, v in by_cat.items()))

ai = A.AI()
p(f"AI for this check: {ai.describe()}")
missing = [r for r in serious if not r.get("attack_chain")][:14]
calls = 0
tally = {"no_text": 0, "short": 0, "now_chain": 0, "still_none": 0, "other_outlet_chain": 0}
for r in missing:
    page, final = P.fetch_article(r["url"])
    body = P.article_text(page)
    p(f"\n-- {r['created_at'][5:16]} {r['category']}/{r['severity']} {r['source'][:22]} | {r['headline'][:80]}")
    p(f"   article text read: {len(body)} chars{' (could not read the page)' if not page else ''}; also reported by {len(r.get('also_reported') or [])}")
    texts = [("main", r["url"], body)]
    for a in (r.get("also_reported") or [])[:2]:
        pg, _ = P.fetch_article(a.get("url", ""))
        texts.append((a.get("source", "?"), a.get("url", ""), P.article_text(pg)))
    got_any = False
    for who, url, text in texts:
        if len(text) < 400:
            p(f"   {who[:20]}: only {len(text)} chars, AI would see the feed summary only")
            if who == "main":
                tally["no_text" if not text else "short"] += 1
            continue
        try:
            calls += 1
            s = P.summarise_ai(ai, r["headline"], text)
            n = len(s.get("chain") or [])
            p(f"   {who[:20]}: {len(text)} chars -> chain now: {n} steps" + (f" ({', '.join(x['stage'] for x in s['chain'])})" if n else ""))
            if n:
                got_any = True
                if who != "main":
                    tally["other_outlet_chain"] += 1
        except Exception as ex:
            p(f"   {who[:20]}: AI failed {str(ex)[:100]}")
        time.sleep(1)
    tally["now_chain" if got_any else "still_none"] += 1
p(f"\n== Summary of {len(missing)} serious stories without a chain: {tally}; AI used {ai.used} in {calls} calls ==")
