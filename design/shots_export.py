"""Read-only: today's real cards for the Play Store screenshots, exactly as the app gets them (public key),
with each card's own picture, the games, the trending deck, the daily cards and the hacker groups for chains."""
import json, os, sys, hashlib, urllib.request
from datetime import datetime, timedelta, timezone
from supabase import create_client
out = sys.argv[1]
os.makedirs(os.path.join(out, "pics"), exist_ok=True)
eas = json.load(open("app/eas.json"))["build"]["preview"]["env"]
app = create_client(eas["EXPO_PUBLIC_SUPABASE_URL"], eas["EXPO_PUBLIC_SUPABASE_KEY"])
now = datetime.now(timezone.utc)
FIELDS = ("id,source,url,headline,technical,why_it_matters,severity,action,cves,attack_chain,also_reported,incident,"
          "actor_group,category,image_url,published_at,created_at,products,zero_day,tint")
countries = ["INTL", "GB"]
snap = {}
snap["stories"] = (app.table("stories").select(FIELDS).in_("country", countries).order("published_at", desc=True)
                   .order("created_at", desc=True).range(0, 79).execute().data)
snap["games"] = (app.table("games").select("id,story_id,style,data,created_at,stories!inner(headline,country,image_url)")
                 .gte("created_at", (now - timedelta(days=4)).isoformat()).in_("stories.country", countries)
                 .order("created_at", desc=True).limit(60).execute().data)
snap["decks"] = (app.table("decks").select("id,topic,title,slides,story_ids,country,created_at,expires_at").gt("expires_at", now.isoformat())
                 .in_("country", countries).order("created_at", desc=True).limit(3).execute().data)
midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
snap["daily"] = (app.table("stories").select(FIELDS).in_("source", ["CyberSid Tips", "CyberSid History"]).in_("country", countries)
                 .gte("created_at", (midnight - timedelta(hours=26)).isoformat()).order("created_at", desc=True).limit(6).execute().data)
groups = sorted({s["actor_group"] for s in snap["stories"] if s.get("actor_group")})
try:
    snap["threat_groups"] = app.table("threat_groups").select("*").in_("name", groups).execute().data if groups else []
except Exception as ex:
    snap["threat_groups"] = []
    print("threat_groups:", str(ex)[:120])
index = {}
urls = [s["image_url"] for s in snap["stories"] + snap["daily"] if s.get("image_url")]
urls += [g["stories"]["image_url"] for g in snap["games"] if (g.get("stories") or {}).get("image_url")]
for u in dict.fromkeys(urls):
    name = hashlib.sha1(u.encode()).hexdigest()[:16] + ".jpg"
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "okhttp/4.12.0"})
        data = urllib.request.urlopen(req, timeout=20).read(6_000_000)
        open(os.path.join(out, "pics", name), "wb").write(data)
        index[u] = name
    except Exception as ex:
        print("no picture:", u[:80], str(ex)[:80])
snap["pictures"] = index
json.dump(snap, open(os.path.join(out, "shots_snapshot.json"), "w"), ensure_ascii=False)
print(f"{len(snap['stories'])} stories ({sum(1 for s in snap['stories'] if s.get('attack_chain'))} with chains), {len(snap['games'])} games, "
      f"{len(snap['decks'])} decks, {len(snap['daily'])} daily, {len(snap['threat_groups'])} groups, {len(index)} pictures")
