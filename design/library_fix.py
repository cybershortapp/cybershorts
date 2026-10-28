"""Removes backup pictures that came out with a brand logo, and lists what's left. Writes left.txt."""
import os, sys
from supabase import create_client
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
store = db.storage.from_("covers")
bad = ["library/vulnerabilities-11.jpg", "library/vulnerabilities-12.jpg"]   # laptops with a brand-like logo
store.remove(bad)
names = sorted(f["name"] for f in (store.list("library", {"limit": 1000}) or []))
counts = {}
for n in names:
    counts[n.rsplit("-", 1)[0]] = counts.get(n.rsplit("-", 1)[0], 0) + 1
text = f"removed {bad}\nleft {len(names)}: {counts}\n" + "\n".join(names) + "\n"
open(os.path.join(out, "left.txt"), "w").write(text)
print(text)
print(f"::notice::left {len(names)}: {counts}")
