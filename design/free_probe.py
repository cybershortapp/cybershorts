"""Read-only: do the no-key free text AIs answer from GitHub Actions? AI Horde (volunteers), OVHcloud anonymous, LLM7."""
import json, time, urllib.request, urllib.error
def call(url, body=None, headers=None, timeout=60):
    h = {"Content-Type": "application/json", "User-Agent": "CyberSid-probe/1.0", **(headers or {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:160]
    except Exception as e:
        return 0, str(e)[:160]
PROMPT = "Summarise in one sentence: Hackers used a phishing email and an old VPN flaw to put ransomware on a hospital network."
# AI Horde text
st, models = call("https://aihorde.net/api/v2/status/models?type=text")
if st == 200:
    top = sorted(models, key=lambda m: -m.get("count", 0))[:6]
    print("HORDE models: " + ", ".join(f"{m['name'].split('/')[-1][:40]} x{m['count']} q{m.get('queued',0)} eta{m.get('eta',0)}s" for m in top))
    t = time.time()
    st, job = call("https://aihorde.net/api/v2/generate/text/async",
                   {"prompt": PROMPT + "\nSummary:", "params": {"max_length": 80, "max_context_length": 1024}},
                   {"apikey": "0000000000", "Client-Agent": "CyberSid-probe:1.0:cybershort.app"})
    if st in (200, 202):
        for _ in range(60):
            time.sleep(5)
            s2, r = call(f"https://aihorde.net/api/v2/generate/text/status/{job['id']}")
            if s2 == 200 and r.get("done"):
                g = r["generations"][0]
                print(f"HORDE OK {time.time()-t:.0f}s via {g.get('model','?')[:40]}: {g['text'].strip()[:90]}")
                break
        else:
            print(f"HORDE WAIT still queued after {time.time()-t:.0f}s")
    else:
        print(f"HORDE FAIL {st} {job}")
else:
    print(f"HORDE models FAIL {st} {models}")
# OVHcloud AI Endpoints, anonymous
base = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"
st, ms = call(base + "/models")
names = [m["id"] for m in ms.get("data", [])] if st == 200 else []
print(f"OVH models {st}: " + ", ".join(names)[:400])
for m in [n for n in names if any(k in n.lower() for k in ("gpt-oss-120b", "llama-3_3-70b", "qwen3", "mistral-small"))][:3]:
    t = time.time()
    st, r = call(base + "/chat/completions", {"model": m, "max_tokens": 60, "messages": [{"role": "user", "content": PROMPT}]})
    print(f"OVH {'OK' if st == 200 else 'FAIL'} {m} {st} {time.time()-t:.1f}s " + (r["choices"][0]["message"]["content"][:70].replace("\n", " ") if st == 200 else str(r)[:100]))
    time.sleep(31)
# LLM7, anonymous
st, ms = call("https://api.llm7.io/v1/models")
names = [m.get("id") for m in (ms.get("data", ms) if isinstance(ms, dict) else ms)] if st == 200 else []
print(f"LLM7 models {st}: " + ", ".join(map(str, names))[:300])
t = time.time()
st, r = call("https://api.llm7.io/v1/chat/completions", {"model": "default", "max_tokens": 60, "messages": [{"role": "user", "content": PROMPT}]})
print(f"LLM7 {'OK' if st == 200 else 'FAIL'} {st} {time.time()-t:.1f}s " + (r["choices"][0]["message"]["content"][:70].replace("\n", " ") if st == 200 else str(r)[:100]))
