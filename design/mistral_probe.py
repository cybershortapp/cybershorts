"""Read-only: is the Mistral key working? One real news summary with mistral-small-latest. Never prints the key."""
import os, sys, time
ROOT = os.path.abspath("pipeline")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import ai as A
import pipeline as P

print("key set:", bool(os.getenv("MISTRAL_API_KEY")))
TITLE = "Ransomware gang breaches regional hospital through phishing email and old VPN flaw"
TEXT = ("Investigators say the attack began with a phishing email carrying a booby-trapped invoice, which installed a "
        "loader. The criminals then used an unpatched VPN flaw, dumped passwords with Mimikatz, deleted backups, copied "
        "400 GB of patient records and launched ransomware on 1,200 machines. The gang demands $4 million.")
os.environ["AI_PROVIDER"] = "mistral"
for attempt in (1, 2):
    if attempt == 2:
        time.sleep(45)
    ai = A.AI()
    ai.chain = [("mistral", m) for m in A.MISTRAL_MODELS]
    t = time.time()
    try:
        s = P.summarise_ai(ai, TITLE, TEXT)
        chain = P.clean_chain(s.get("chain"), f"{TITLE} {TEXT}") if s.get("chain") else None
        print(f"OK   mistral try {attempt}: {time.time()-t:.1f}s | {s.get('category')}/{s.get('severity')} | chain steps: {len(chain or [])} | headline: {s.get('headline','')[:70]}")
        break
    except Exception as ex:
        print(f"FAIL mistral try {attempt}: {time.time()-t:.1f}s | {str(ex)[:160]}")
