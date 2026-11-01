"""Dry run (4) of the chain-catchup branch's chain_catchup on the live database: nothing is written (updates are printed)."""
import os, sys
ROOT = os.path.abspath("pipeline")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
from datetime import datetime, timedelta, timezone
import pipeline as P
from ai import AI
from supabase import create_client

real = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
class Q:
    def __init__(self, q, name): self.q, self.name = q, name
    def __getattr__(self, k):
        attr = getattr(self.q, k)
        def call(*a, **kw):
            r = attr(*a, **kw)
            return Q(r, self.name) if hasattr(r, "execute") else r
        return call
class Upd:
    def __init__(self, data): self.data = data
    def eq(self, col, val): self.id = val; return self
    def execute(self):
        ch = self.data.get("attack_chain")
        print("   WOULD WRITE", self.id[:10], "chain:", " -> ".join(f"{s['stage']}: {s['detail']}" for s in ch) if ch else "none (marked tried)")
class T:
    def __init__(self, name): self.name = name
    def select(self, *a, **kw): return Q(real.table(self.name).select(*a, **kw), self.name)
    def update(self, data): return Upd(data)
class DB:
    def table(self, name): return T(name)

P.CHAIN_RETRY_PER_RUN = 10
ai = AI()
print("AI:", ai.describe()[:300])
note, calls = P.chain_catchup(DB(), ai, 25, datetime.now(timezone.utc) + timedelta(minutes=10))
print("RESULT", note, "| calls", calls, "| used", ai.used)

# how many chains already saved in the last 7 days would the new rules turn down?
rows = real.table("stories").select("id,headline,attack_chain").gte("created_at", (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()).not_.is_("attack_chain", "null").limit(500).execute().data
bad = [r for r in rows if not P.clean_chain(r["attack_chain"], "")]
print(f"RESULT old chains, last 7 days: {len(rows)}, {len(bad)} would now be turned down: " + " / ".join(f"{r['headline'][:40]} ({', '.join(s['stage'] for s in r['attack_chain'])})" for r in bad[:4]))
