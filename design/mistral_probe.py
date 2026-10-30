"""Read-only: which Mistral models answer with our key. Lists models, then one tiny request each. Never prints the key."""
import os, json, time, urllib.request, urllib.error
KEY = os.getenv("MISTRAL_API_KEY", "")
print("key set:", bool(KEY))
def call(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:150]
st, models = call("https://api.mistral.ai/v1/models")
names = sorted(m["id"] for m in models.get("data", [])) if st == 200 else []
print(f"models {st}: {len(names)} | " + ",".join(n for n in names if "latest" in n)[:600] if st == 200 else f"models {st}: {models}")
for m in ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest", "ministral-8b-latest", "open-mistral-nemo", "codestral-latest"]:
    t = time.time()
    st, out = call("https://api.mistral.ai/v1/chat/completions",
                   {"model": m, "max_tokens": 5, "messages": [{"role": "user", "content": "Say OK"}]})
    print(f"{'OK  ' if st == 200 else 'FAIL'} {m}: {st} {time.time()-t:.1f}s " + ("" if st == 200 else str(out)[:110]))
    time.sleep(2)
