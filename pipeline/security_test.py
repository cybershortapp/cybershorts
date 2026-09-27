"""Security test: checks the PUBLIC app key can only do what the app needs.
Run: python security_test.py
Needs in the top-folder .env (C:/Projects/cybershorts/.env): SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PUBLISHABLE_KEY (the same key as in app/.env)
"""
import os
import uuid

from dotenv import load_dotenv
from postgrest.types import ReturnMethod
from supabase import create_client

load_dotenv()
url = os.environ["SUPABASE_URL"]
public_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
if not public_key:
    raise SystemExit("Add SUPABASE_PUBLISHABLE_KEY=<the sb_publishable_ key from app/.env> to the top-folder .env (C:\\Projects\\cybershorts\\.env) first")
if public_key.startswith("sb_secret") or public_key == os.getenv("SUPABASE_SERVICE_KEY"):
    raise SystemExit("That's the SECRET key. Use the publishable key (sb_publishable_...), the one the app uses.")

app = create_client(url, public_key)                          # what anyone with the app can do
admin = create_client(url, os.environ["SUPABASE_SERVICE_KEY"])  # only used to check and tidy up
results = []


def check(name, passed, detail=""):
    results.append(passed)
    print(f"[{'PASS' if passed else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def blocked(fn):
    """True if the action raised an error or changed nothing."""
    try:
        res = fn()
        return not (res.data or [])
    except Exception:
        return True


story = admin.table("stories").select("id,headline").limit(1).execute().data
if not story:
    raise SystemExit("No stories in the database yet. Run python pipeline.py first.")
sid, headline = story[0]["id"], story[0]["headline"]
fake_id = "sectest-" + uuid.uuid4().hex[:8]

print("\n=== Security test (public app key) ===\n")

# stories: read yes, write no
check("App can read stories", bool(app.table("stories").select("id").limit(1).execute().data))
check("App cannot add a story", blocked(lambda: app.table("stories").insert({
    "id": fake_id, "source": "x", "url": "x", "orig_title": "x", "headline": "HACKED", "technical": "x",
    "category": "Other", "published_at": "2026-01-01T00:00:00Z"}).execute()))
app_update = blocked(lambda: app.table("stories").update({"headline": "HACKED"}).eq("id", sid).execute())
still_same = admin.table("stories").select("headline").eq("id", sid).execute().data[0]["headline"] == headline
check("App cannot change a story", app_update and still_same)
blocked(lambda: app.table("stories").delete().eq("id", sid).execute())
check("App cannot delete a story", bool(admin.table("stories").select("id").eq("id", sid).execute().data))

# reports: add yes, read no (checked with the admin key, since the app itself can't see reports)
marker = "Other"
before = len(admin.table("reports").select("id").eq("story_id", sid).eq("reason", marker).execute().data)
try:
    # same as the app: add the report without asking for it back (the app is not allowed to read reports)
    app.table("reports").insert({"story_id": sid, "reason": marker}, returning=ReturnMethod.minimal).execute()
except Exception as ex:
    print("      ", ex)
after = len(admin.table("reports").select("id").eq("story_id", sid).eq("reason", marker).execute().data)
check("App can send an error report", after == before + 1)
check("App cannot read reports", not app.table("reports").select("id").execute().data)
try:
    app.table("reports").insert({"story_id": sid, "reason": "DROP TABLE"}, returning=ReturnMethod.minimal).execute()
except Exception:
    pass
check("App cannot send a made-up report reason",
      not admin.table("reports").select("id").eq("reason", "DROP TABLE").execute().data)
admin.table("reports").delete().eq("story_id", sid).eq("reason", marker).execute()   # tidy up the test report

# private tables: nothing
for t in ("seen_links", "pipeline_runs"):
    check(f"App cannot read {t}", not app.table(t).select("*").limit(1).execute().data)

# threat groups: read yes, write no
check("App can read attacker profiles", bool(app.table("threat_groups").select("id").limit(1).execute().data), "run python pipeline.py --groups first if this fails")
check("App cannot add attacker profiles", blocked(lambda: app.table("threat_groups").insert({"id": "GX", "name": "x", "url": "x"}).execute()))

# AI pictures: anyone can view them, only the pipeline can add or delete them
def upload_blocked():
    try:
        app.storage.from_("covers").upload(f"{fake_id}.jpg", b"not really a picture", {"content-type": "image/jpeg"})
        return False
    except Exception:
        return True
check("App cannot upload pictures", upload_blocked())
try:
    admin.storage.from_("covers").remove([f"{fake_id}.jpg"])
except Exception:
    pass

# tidy up anything that slipped through
admin.table("stories").delete().eq("id", fake_id).execute()
admin.table("threat_groups").delete().eq("id", "GX").execute()

print(f"\n{sum(results)} of {len(results)} checks passed." + ("  All good." if all(results) else "  FIX THE FAILS BEFORE LAUNCH."))
