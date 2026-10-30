"""Read-only: which NVIDIA free models work for our news summaries and attack chains.
For each candidate: the real news prompt (pipeline.summarise_ai) on one test article that describes attack
steps. Prints time taken, whether the JSON was usable and how many chain steps came back. Never prints the key."""
import os, sys, time
ROOT = os.path.abspath("pipeline")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import ai as A
import pipeline as P

TITLE = "Ransomware gang breaches regional hospital through phishing email and old VPN flaw"
TEXT = ("Investigators say the attack on the hospital began with a phishing email sent to an accounts worker, "
        "which carried a booby-trapped invoice. Opening it installed a loader that gave the criminals remote access. "
        "They then used an unpatched flaw in the hospital's VPN appliance to get a second way in, dumped staff "
        "passwords from a domain controller with Mimikatz and moved across the network to backup servers, which they "
        "deleted. Over two days they copied about 400 GB of patient records to a cloud storage account, and finally "
        "launched the ransomware, encrypting 1,200 machines and forcing ambulances to be diverted. The gang has "
        "posted a sample of the stolen data and is demanding $4 million. The hospital says it has not paid.")
CANDIDATES = [m for m in os.getenv("CANDIDATES", "").split(",") if m]
url, key_name, _ = A.OPENAI_STYLE["nvidia"]
for model in CANDIDATES:
    A.OPENAI_STYLE["nvidia"] = (url, key_name, [model])
    os.environ["AI_PROVIDER"] = "nvidia"
    ai = A.AI()
    ai.chain = [("nvidia", model)]
    t = time.time()
    try:
        s = P.summarise_ai(ai, TITLE, TEXT)
        chain = P.clean_chain(s.get("chain"), f"{TITLE} {TEXT}") if s.get("chain") else None
        print(f"OK   {model}: {time.time()-t:.1f}s | {s.get('category')}/{s.get('severity')} | chain steps: {len(chain or [])} | headline: {s.get('headline','')[:70]}")
    except Exception as ex:
        print(f"FAIL {model}: {time.time()-t:.1f}s | {type(ex).__name__}: {str(ex)[:220]}")
    time.sleep(2)
