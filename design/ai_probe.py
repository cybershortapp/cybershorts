"""Read-only check of free AI models: lists what each service offers and tries one tiny JSON call per candidate.
Prints model names and results only (never keys). Writes probe.txt into the folder given."""
import json, os, sys, time, urllib.error, urllib.request

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
UA = {"User-Agent": "CyberSid/1.0 (+news summariser)", "Accept": "application/json", "Content-Type": "application/json"}
log = []

def http(url, headers=None, body=None, method=None, timeout=40):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={**UA, **(headers or {})}, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}"), dict(r.headers)
    except urllib.error.HTTPError as ex:
        return ex.code, ex.read().decode("utf-8", "ignore")[:220], dict(ex.headers or {})
    except Exception as ex:
        return 0, str(ex)[:200], {}

SYSTEM = 'Reply with ONLY JSON: {"ok": true, "word": "<one word>"}'
USER = "Say hello in one word."

def try_openai(name, url, key, model):
    t0 = time.time()
    code, data, head = http(url, {"Authorization": f"Bearer {key}"}, {"model": model, "temperature": 0.2, "max_tokens": 60,
                            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]})
    lim = {k: v for k, v in head.items() if "ratelimit" in k.lower()}
    txt = data["choices"][0]["message"]["content"][:60] if code == 200 else data
    log.append(f"{name} {model}: {code} in {time.time()-t0:.1f}s -> {txt} | limits {lim}")

# ---- Gemini (Google AI Studio) ----
gk = os.getenv("GEMINI_API_KEY", "")
if gk:
    code, data, _ = http(f"https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {"x-goog-api-key": gk})
    names = [m["name"].split("/", 1)[1] for m in data.get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])] if code == 200 else []
    log.append(f"gemini models ({code}): " + ", ".join(names))
    for model in [n for n in names if ("flash" in n or "gemma" in n) and "image" not in n and "tts" not in n and "audio" not in n][:14]:
        t0 = time.time()
        c, d, _ = http(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", {"x-goog-api-key": gk},
                       {"contents": [{"role": "user", "parts": [{"text": SYSTEM + "\n" + USER}]}],
                        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 200}})
        txt = ""
        if c == 200:
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            txt = "".join(p.get("text", "") for p in parts if not p.get("thought"))[:60]
        log.append(f"gemini {model}: {c} in {time.time()-t0:.1f}s -> {txt if c == 200 else str(d)[:140]}")
else:
    log.append("gemini: no key")

# ---- Groq ----
qk = os.getenv("GROQ_API_KEY", "")
if qk:
    code, data, _ = http("https://api.groq.com/openai/v1/models", {"Authorization": f"Bearer {qk}"})
    ids = sorted(m["id"] for m in data.get("data", []) if m.get("active", True)) if code == 200 else []
    log.append(f"groq models ({code}): " + ", ".join(ids))
    for model in [i for i in ids if not any(k in i for k in ("whisper", "tts", "guard", "playai", "orpheus", "compound"))][:10]:
        try_openai("groq", "https://api.groq.com/openai/v1/chat/completions", qk, model)
else:
    log.append("groq: no key")

# ---- Cerebras ----
ck = os.getenv("CEREBRAS_API_KEY", "")
if ck:
    code, data, _ = http("https://api.cerebras.ai/v1/models", {"Authorization": f"Bearer {ck}"})
    ids = [m["id"] for m in data.get("data", [])] if code == 200 else []
    log.append(f"cerebras models ({code}): " + ", ".join(ids) + ("" if code == 200 else f" {data}"))
    for model in ids[:4]:
        try_openai("cerebras", "https://api.cerebras.ai/v1/chat/completions", ck, model)

# ---- Mistral ----
mk = os.getenv("MISTRAL_API_KEY", "")
log.append("mistral: key " + ("present" if mk else "MISSING"))

# ---- GitHub Models (free with the workflow's own token) ----
tk = os.getenv("GITHUB_TOKEN", "")
code, data, _ = http("https://models.github.ai/catalog/models", {"Authorization": f"Bearer {tk}", "X-GitHub-Api-Version": "2022-11-28"})
cat = data if isinstance(data, list) else []
log.append(f"github models catalog ({code}): " + ", ".join(f"{m.get('id')}[{m.get('rate_limit_tier')}]" for m in cat[:60]))
for model in [m["id"] for m in cat if m.get("rate_limit_tier") == "low" and "chat" in str(m.get("supported_output_modalities", "text")) or m.get("rate_limit_tier") == "low"][:6]:
    try_openai("github", "https://models.github.ai/inference/chat/completions", tk, model)

open(os.path.join(out, "probe.txt"), "w").write("\n".join(log) + "\n")
print("\n".join(log))
