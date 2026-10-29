"""Read-only: the latest trending decks and a sample of games (one per style), for design work. Writes extras.json."""
import json, os, sys
from supabase import create_client
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
decks = db.table("decks").select("id,topic,title,slides,story_ids,country,created_at").order("created_at", desc=True).limit(4).execute().data
games = db.table("games").select("id,story_id,style,data,created_at").order("created_at", desc=True).limit(120).execute().data
by_style = {}
for g in games:
    by_style.setdefault(g["style"], g)
sids = list({g["story_id"] for g in by_style.values()})
stories = db.table("stories").select("id,headline,category,image_url").in_("id", sids).execute().data if sids else []
json.dump({"decks": decks, "games": list(by_style.values()), "stories": stories}, open(os.path.join(out, "extras.json"), "w"), indent=1, ensure_ascii=False)
print("decks", len(decks), "games styles", sorted(by_style))
print("::notice::decks %d, game styles %s" % (len(decks), sorted(by_style)))
