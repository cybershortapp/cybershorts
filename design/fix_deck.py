"""One-off: the live WhatsApp scams deck (5 Indian stories, 1 worldwide) was saved as worldwide.
Set it to India so UK readers stop seeing it. Changes this one row only."""
import os
from supabase import create_client
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
DECK = "ea939e651f97cd20153c"
before = db.table("decks").select("id,title,country").eq("id", DECK).execute().data
print("before:", before)
if before and before[0]["country"] == "INTL" and "WhatsApp" in before[0]["title"]:
    db.table("decks").update({"country": "IN"}).eq("id", DECK).execute()
print("after:", db.table("decks").select("id,title,country").eq("id", DECK).execute().data)
