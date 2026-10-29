"""Read-only: the latest trending decks, one game per style and the newest stories (all card fields),
plus small copies of their pictures, for design and app testing. Writes extras.json and pics/."""
import hashlib, io, json, os, sys, urllib.request
from PIL import Image
from supabase import create_client
out = sys.argv[1]
os.makedirs(os.path.join(out, "pics"), exist_ok=True)
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
FIELDS = ("id,source,url,headline,technical,why_it_matters,severity,action,cves,attack_chain,also_reported,"
          "incident,actor_group,category,image_url,published_at,created_at,products,zero_day,tint")
decks = db.table("decks").select("id,topic,title,slides,story_ids,country,created_at").order("created_at", desc=True).limit(4).execute().data
games = db.table("games").select("id,story_id,style,data,created_at").order("created_at", desc=True).limit(200).execute().data
by_style = {}
for g in games:
    by_style.setdefault(g["style"], g)
sids = list({g["story_id"] for g in by_style.values()})
stories = db.table("stories").select("id,headline,category,image_url").in_("id", sids).execute().data if sids else []
latest = db.table("stories").select(FIELDS).order("published_at", desc=True).limit(24).execute().data
pics = {}
def grab(url):
    if not url or url in pics:
        return
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CyberSid design test)"})
        raw = urllib.request.urlopen(req, timeout=15).read(6_000_000)
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((900, 900))
        name = hashlib.sha1(url.encode()).hexdigest()[:16] + ".jpg"
        im.save(os.path.join(out, "pics", name), "JPEG", quality=78)
        pics[url] = name
    except Exception as ex:
        print("picture failed", url[:80], str(ex)[:60])
for s in latest + stories:
    grab(s.get("image_url"))
for d in decks:
    for sl in d["slides"]:
        grab(sl.get("image"))
json.dump({"decks": decks, "games": list(by_style.values()), "stories": stories, "latest": latest, "pics": pics},
          open(os.path.join(out, "extras.json"), "w"), indent=1, ensure_ascii=False)
print("decks", len(decks), "games styles", sorted(by_style), "latest", len(latest), "pics", len(pics))
print("::notice::decks %d, game styles %s, stories %d, pictures %d" % (len(decks), sorted(by_style), len(latest), len(pics)))
