"""Read-only: the real news prompt (pipeline.summarise_ai) on OVHcloud with no key, from the ai-ovh branch.
1) each model on its own, 2) six stories back to back to check the models take turns."""
import os, sys, time
ROOT = os.path.abspath("pipeline")
sys.path.insert(0, ROOT)
os.chdir(ROOT)
for k in [k for k in os.environ if k.endswith("_API_KEY")]:
    del os.environ[k]
import functools
import ai as A
A._post = functools.partial(A._post, timeout=75)   # measure the real time, not our 40s cut-off
import pipeline as P
TITLE = "Ransomware gang breaches regional hospital through phishing email and old VPN flaw"
TEXT = ("Investigators say the attack on the hospital began with a phishing email sent to an accounts worker, "
        "which carried a booby-trapped invoice. Opening it installed a loader that gave the criminals remote access. "
        "They then used an unpatched flaw in the hospital's VPN appliance to get a second way in, dumped staff "
        "passwords from a domain controller with Mimikatz and moved across the network to backup servers, which they "
        "deleted. Over two days they copied about 400 GB of patient records to a cloud storage account, and finally "
        "launched the ransomware, encrypting 1,200 machines and forcing ambulances to be diverted. The gang has "
        "posted a sample of the stolen data and is demanding $4 million. The hospital says it has not paid.")
os.environ["AI_PROVIDER"] = "ovh"
for model in os.environ["CANDIDATES"].split(","):
    ai = A.AI(); ai.chain = [("ovh", model)]
    t = time.time()
    try:
        s = P.summarise_ai(ai, TITLE, TEXT)
        chain = P.clean_chain(s.get("chain"), f"{TITLE} {TEXT}") if s.get("chain") else None
        print(f"OK   {model}: {time.time()-t:.1f}s | {s.get('category')}/{s.get('severity')} | chain {len(chain or [])} | {s.get('headline','')[:55]}")
    except Exception as ex:
        print(f"FAIL {model}: {time.time()-t:.1f}s | {str(ex)[:140]}")
