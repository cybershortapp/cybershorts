"""Read-only: why NVIDIA answers fail in the news run. Calls NVIDIA's free API with a tiny prompt per model
and prints the exact error (never the key). Also checks the model names exist."""
import json, os, sys, time, urllib.request, urllib.error
sys.path.insert(0, "pipeline")
import ai as A

key = os.environ.get("NVIDIA_API_KEY", "")
print("key set:", bool(key), "starts with nvapi-:", key.startswith("nvapi-"))
try:
    req = urllib.request.Request("https://integrate.api.nvidia.com/v1/models", headers={"Authorization": f"Bearer {key}", "User-Agent": "CyberSid/1.0"})
    ids = [m["id"] for m in json.load(urllib.request.urlopen(req, timeout=30))["data"]]
    print("models listed:", len(ids))
    for want in A.NVIDIA_MODELS:
        print("  ", want, "->", "listed" if want in ids else "NOT LISTED")
    print("  similar:", [i for i in ids if "llama-3.3" in i or "gpt-oss" in i or "llama-4" in i][:12])
except Exception as ex:
    print("model list failed:", str(ex)[:300])

ai = A.AI.__new__(A.AI)
ai.last = {}
system = "Reply with ONLY a JSON object."
user = 'Return {"ok": true, "word": "hello"}'
for model in A.NVIDIA_MODELS:
    for attempt in ("json mode", "no json mode"):
        url, key_name, _ = A.OPENAI_STYLE["nvidia"]
        body = {"model": model, "temperature": 0.2, "max_tokens": 1500,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if attempt == "json mode":
            body["response_format"] = {"type": "json_object"}
        t = time.time()
        try:
            data = A._post(url, {"Authorization": f"Bearer {key}"}, body, timeout=60)
            msg = data["choices"][0]["message"]
            print(f"[{model} | {attempt}] OK in {time.time()-t:.1f}s content={str(msg.get('content'))[:160]!r} reasoning={'yes' if msg.get('reasoning_content') or msg.get('reasoning') else 'no'}")
        except Exception as ex:
            print(f"[{model} | {attempt}] FAILED in {time.time()-t:.1f}s: {type(ex).__name__}: {str(ex)[:400]}")
        time.sleep(2)
