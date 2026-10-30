"""AI providers for the pipeline. Free by default.

AI_PROVIDER   order to try, comma separated. Default "gemini,nvidia,ovh,gemini-lite,groq,mistral,cerebras" (free plans).
              "gemini" is the full-size Gemini models, "gemini-lite" the lite and Gemma ones. NVIDIA sits in
              between: when the strong Gemini models run out for the day, a strong NVIDIA model answers
              before the lite ones (the lite models rarely write attack chains).
              Any provider without a key in .env is skipped automatically (no NVIDIA_API_KEY: no NVIDIA).
              Use "claude" (paid) if you ever want Claude instead, or "gemini,groq,claude" as a last resort.
GEMINI_MODELS models to try in order (free tier). Change here if Google renames them.
              Each Gemini and Gemma model has its OWN free daily limit, so a longer list means more free calls a day.
GROQ_MODELS   models to try in order (free tier). Each has its own limit too.
NVIDIA_MODELS models on NVIDIA's free developer API (build.nvidia.com, about 40 requests a minute for the
              whole account). Free key starting "nvapi-", saved as the NVIDIA_API_KEY secret.
OVH_MODELS    models on OVHcloud AI Endpoints (France). Needs no key: anyone may make 2 requests a minute per model,
              so the models take turns and a model that is resting is skipped, never waited for.
              An optional OVH_AI_ENDPOINTS_ACCESS_TOKEN raises the limits (that one is paid per use).
If a model hits its free limit (or is retired, or the account needs payment), the next one is used
automatically for the rest of the run.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

# checked 28 Oct 2026: these all answer on the free tier (newest and best first, Gemma last: big free limits)
GEMINI_MODELS = [m.strip() for m in os.getenv(
    "GEMINI_MODELS", "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,"
                     "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemma-4-26b-a4b-it,gemma-4-31b-it").split(",") if m.strip()]
GROQ_MODELS = [m.strip() for m in os.getenv("GROQ_MODELS", "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b").split(",") if m.strip()]
CEREBRAS_MODELS = [m.strip() for m in os.getenv("CEREBRAS_MODELS", "gpt-oss-120b").split(",") if m.strip()]
# checked 30 Oct 2026 on the free API with our news prompt and an attack article: these two answered with good
# JSON and a full attack chain in about 20 seconds. (Llama 3.3 70B and gpt-oss-120b were retired; DeepSeek, GLM,
# Gemma and Mistral Large took over 40 seconds; Nemotron Super/Ultra and Kimi aren't on the free plan.)
NVIDIA_MODELS = [m.strip() for m in os.getenv("NVIDIA_MODELS", "minimaxai/minimax-m3.1-flash,openai/gpt-oss-20b").split(",") if m.strip()]


def is_lite(model):
    """The smaller Gemini models and Gemma: big free limits, but weaker (they rarely write attack chains)."""
    return "lite" in model or model.startswith("gemma")
# OVHcloud AI Endpoints with no key. Checked 30 Oct 2026 with our news prompt: these two answered with good JSON
# and a full attack chain in 7 to 10 seconds. (gpt-oss and Qwen took over 40 seconds or gave no answer, Llama 3.3
# 70B took 40 seconds with a short chain.)
OVH_MODELS = [m.strip() for m in os.getenv(
    "OVH_MODELS", "Mistral-Small-3.2-24B-Instruct-2506,Mistral-Nemo-Instruct-2407").split(",") if m.strip()]
# Mistral's own free mode (checked 30 Oct 2026): Small and Medium say "rate limit" from the first request and Large
# isn't included, but these two answer with full attack chains (ministral-14b in about 7 seconds)
MISTRAL_MODELS = [m.strip() for m in os.getenv("MISTRAL_MODELS", "ministral-14b-latest,open-mistral-nemo").split(",") if m.strip()]

# OpenAI-style providers: (web address, key name in .env, models)
OPENAI_STYLE = {
    "groq": ("https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", GROQ_MODELS),
    "cerebras": ("https://api.cerebras.ai/v1/chat/completions", "CEREBRAS_API_KEY", CEREBRAS_MODELS),
    "mistral": ("https://api.mistral.ai/v1/chat/completions", "MISTRAL_API_KEY", MISTRAL_MODELS),
    "nvidia": ("https://integrate.api.nvidia.com/v1/chat/completions", "NVIDIA_API_KEY", NVIDIA_MODELS),
    "ovh": ("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", "OVH_AI_ENDPOINTS_ACCESS_TOKEN", OVH_MODELS),
}
# providers that work without a key (the key only raises their limits)
NO_KEY_NEEDED = {"ovh"}
# providers whose models each have a small per-minute limit: the models take turns, one that is resting
# (or just said "too many requests") is skipped for this story instead of waited for
TAKE_TURNS = {"ovh"}
CLAUDE_MODEL = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")

# pause between calls so we stay inside free per-minute limits
GAP_SECONDS = {
    "gemini": float(os.getenv("GEMINI_GAP", "4.5")),
    "cerebras": float(os.getenv("CEREBRAS_GAP", "12.5")),   # free plan: 5 requests a minute
    "groq": float(os.getenv("GROQ_GAP", "2.5")),
    "mistral": float(os.getenv("MISTRAL_GAP", "2")),
    "nvidia": float(os.getenv("NVIDIA_GAP", "2")),   # free plan: about 40 requests a minute, whole account
    "ovh": float(os.getenv("OVH_GAP", "31")),        # no key: 2 requests a minute per model
    "claude": 0.3,
}


class LimitHit(Exception):
    """Free limit reached for this model (HTTP 429) or model not available."""


def _post(url, headers, body, timeout=40):
    # a proper User-Agent: some AI services' security walls block the default Python one (error 1010)
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "CyberSid/1.0 (+news summariser)", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        if e.code in (429, 404, 410, 403, 503, 401, 402):   # 402: the account now needs payment; 410: model retired
            raise LimitHit(f"HTTP {e.code}: {detail}")
        raise RuntimeError(f"HTTP {e.code}: {detail}")


def extract_json(text):
    """Pull the JSON object out of a reply, even if the model wrapped it in ``` or extra words."""
    text = re.sub(r"^```(json)?|```$", "", (text or "").strip()).strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError("AI reply had no JSON")
        return json.loads(m.group(0))


class AI:
    def __init__(self):
        order = [p.strip() for p in os.getenv("AI_PROVIDER", "gemini,nvidia,ovh,gemini-lite,groq,mistral,cerebras").lower().split(",") if p.strip()]
        # an older setting with just "gemini" keeps all Gemini models together, as before
        split = "gemini-lite" in order
        self.chain = []
        for p in order:
            if p == "gemini" and os.getenv("GEMINI_API_KEY"):
                self.chain += [("gemini", m) for m in GEMINI_MODELS if not (split and is_lite(m))]
            elif p == "gemini-lite" and os.getenv("GEMINI_API_KEY"):
                self.chain += [("gemini", m) for m in GEMINI_MODELS if is_lite(m)]
            elif p in OPENAI_STYLE and (os.getenv(OPENAI_STYLE[p][1]) or p in NO_KEY_NEEDED):
                self.chain += [(p, m) for m in OPENAI_STYLE[p][2]]
            elif p == "claude" and os.getenv("ANTHROPIC_API_KEY"):
                self.chain.append(("claude", CLAUDE_MODEL))
        if not self.chain:
            raise SystemExit("No AI key found. Add GEMINI_API_KEY, CEREBRAS_API_KEY or GROQ_API_KEY (all free) to .env")
        self.dead = set()
        self.last = {}
        self._anthropic = None
        self.used = {}
        self.strikes = {}

    def _turns(self):
        """The chain for one story. Models that take turns go least recently used first, in the same place."""
        rest = {}
        for p in TAKE_TURNS:
            rest[p] = iter(sorted((c for c in self.chain if c[0] == p), key=lambda c: self.last.get(c, 0)))
        return [next(rest[c[0]]) if c[0] in rest else c for c in self.chain]

    @property
    def can_research(self):
        """Web research needs Claude (not free), so it only runs when Claude is set up and allowed."""
        return os.getenv("RESEARCH", "false").lower() == "true" and bool(os.getenv("ANTHROPIC_API_KEY"))

    @property
    def anthropic(self):
        if self._anthropic is None:
            from anthropic import Anthropic
            self._anthropic = Anthropic()
        return self._anthropic

    def describe(self):
        return " -> ".join(f"{p}:{m}" for p, m in self.chain)

    def _wait(self, provider, model=""):
        # Gemini and Groq count their per-minute limits per model, so moving on to the next model needs no pause
        key = (provider, model) if provider in ("gemini", "groq") or provider in TAKE_TURNS else provider
        gap = GAP_SECONDS.get(provider, 1)
        since = time.time() - self.last.get(key, 0)
        if since < gap:
            time.sleep(gap - since)
        self.last[key] = time.time()

    def json(self, system, user, max_tokens=800):
        """Ask for a JSON reply. Tries each provider/model in order until one works."""
        errors = []
        for provider, model in self._turns():
            if (provider, model) in self.dead:
                continue
            if provider in TAKE_TURNS and time.time() - self.last.get((provider, model), 0) < GAP_SECONDS[provider]:
                continue   # this model is resting: try the next one instead of waiting
            self._wait(provider, model)
            try:
                try:
                    text = self._call(provider, model, system, user, max_tokens)
                except LimitHit as ex:
                    if "HTTP 503" not in str(ex):
                        raise
                    time.sleep(5)   # "busy" usually clears in a few seconds, try once more
                    text = self._call(provider, model, system, user, max_tokens)
                data = extract_json(text)
                self.used[f"{provider}:{model}"] = self.used.get(f"{provider}:{model}", 0) + 1
                return data
            except LimitHit as ex:
                errors.append(str(ex))
                if "503" in str(ex):
                    # busy right now: use the next model for this story only, try this one again next time
                    print(f"[busy]  {provider}:{model} busy, using the next model for this story")
                    continue
                if provider in TAKE_TURNS and "HTTP 429" in str(ex):
                    # per-minute limit: rest this model and try it again later, unless it keeps saying no
                    self.strikes[(provider, model)] = self.strikes.get((provider, model), 0) + 1
                    if self.strikes[(provider, model)] < 3:
                        print(f"[rest]  {provider}:{model} too many requests, resting it for a minute")
                        continue
                reason = ("free limit reached" if "429" in str(ex) else
                          "needs payment" if "HTTP 402" in str(ex) else
                          "retired" if "HTTP 410" in str(ex) else "not available")
                print(f"[limit] {provider}:{model} {reason}, using the next model for the rest of this run")
                self.dead.add((provider, model))
            except Exception as ex:
                errors.append(f"{provider}:{model}: {ex}")
                if "timed out" in str(ex).lower() or isinstance(ex, TimeoutError):
                    # a model that hangs would eat the whole run: skip it for the rest of this run
                    print(f"[slow]  {provider}:{model} timed out, using the next model for the rest of this run")
                    self.dead.add((provider, model))
                continue
        raise RuntimeError("All AI options failed: " + " | ".join(e[:120] for e in errors[-3:]))

    def _gemini(self, model, system, user, max_tokens):
        if model.startswith("gemma"):
            # Gemma (open models on the same free key): no system instruction or JSON mode, so the
            # instructions go into the message and the reply's JSON is picked out by extract_json
            body = {"contents": [{"role": "user", "parts": [{"text": f"{system}\n\n{user}"}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": max(max_tokens, 2048)}}
        else:
            body = {"systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": max(max_tokens, 2048),
                                         "responseMimeType": "application/json"}}
        data = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                     {"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, body)
        cands = data.get("candidates") or []
        if not cands:
            raise RuntimeError(f"no answer ({data.get('promptFeedback', {})})")
        parts = cands[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))

    def _call(self, provider, model, system, user, max_tokens):
        if provider in OPENAI_STYLE:
            return self._openai_style(provider, model, system, user, max_tokens)
        return getattr(self, f"_{provider}")(model, system, user, max_tokens)

    def _openai_style(self, provider, model, system, user, max_tokens):
        url, key_name, _ = OPENAI_STYLE[provider]
        body = {"model": model, "temperature": 0.2, "max_tokens": max(max_tokens, 1500),
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"}}
        key = os.getenv(key_name)
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            data = _post(url, headers, body)
        except RuntimeError as ex:
            if "HTTP 400" not in str(ex):
                raise
            body.pop("response_format")   # some models don't support JSON mode; the prompt still asks for JSON
            data = _post(url, headers, body)
        return data["choices"][0]["message"].get("content") or ""   # thinking models can run out before answering

    def _claude(self, model, system, user, max_tokens):
        msg = self.anthropic.messages.create(model=model, max_tokens=max_tokens, system=system,
                                             messages=[{"role": "user", "content": user}])
        return msg.content[0].text
