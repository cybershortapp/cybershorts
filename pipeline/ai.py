"""AI providers for the pipeline. Free by default.

AI_PROVIDER   order to try, comma separated. Default "gemini,cerebras,groq,mistral" (all have free plans).
              Any provider without a key in .env is skipped automatically.
              Use "claude" (paid) if you ever want Claude instead, or "gemini,groq,claude" as a last resort.
GEMINI_MODELS models to try in order (free tier). Change here if Google renames them.
GROQ_MODELS   models to try in order (free tier).
If a model hits its free limit, the next one is used automatically for the rest of the run.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

GEMINI_MODELS = [m.strip() for m in os.getenv("GEMINI_MODELS", "gemini-3.8-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
GROQ_MODELS = [m.strip() for m in os.getenv("GROQ_MODELS", "openai/gpt-oss-120b,llama-3.3-70b-versatile").split(",") if m.strip()]
CEREBRAS_MODELS = [m.strip() for m in os.getenv("CEREBRAS_MODELS", "gpt-oss-120b").split(",") if m.strip()]
MISTRAL_MODELS = [m.strip() for m in os.getenv("MISTRAL_MODELS", "mistral-small-latest").split(",") if m.strip()]

# OpenAI-style providers: (web address, key name in .env, models)
OPENAI_STYLE = {
    "groq": ("https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", GROQ_MODELS),
    "cerebras": ("https://api.cerebras.ai/v1/chat/completions", "CEREBRAS_API_KEY", CEREBRAS_MODELS),
    "mistral": ("https://api.mistral.ai/v1/chat/completions", "MISTRAL_API_KEY", MISTRAL_MODELS),
}
CLAUDE_MODEL = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")

# pause between calls so we stay inside free per-minute limits
GAP_SECONDS = {
    "gemini": float(os.getenv("GEMINI_GAP", "4.5")),
    "cerebras": float(os.getenv("CEREBRAS_GAP", "12.5")),   # free plan: 5 requests a minute
    "groq": float(os.getenv("GROQ_GAP", "2.5")),
    "mistral": float(os.getenv("MISTRAL_GAP", "2")),
    "claude": 0.3,
}


class LimitHit(Exception):
    """Free limit reached for this model (HTTP 429) or model not available."""


def _post(url, headers, body, timeout=90):
    # a proper User-Agent: some AI services' security walls block the default Python one (error 1010)
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "CyberSid/1.0 (+news summariser)", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        if e.code in (429, 404, 403, 503):
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
        order = [p.strip() for p in os.getenv("AI_PROVIDER", "gemini,cerebras,groq,mistral").lower().split(",") if p.strip()]
        self.chain = []
        for p in order:
            if p == "gemini" and os.getenv("GEMINI_API_KEY"):
                self.chain += [("gemini", m) for m in GEMINI_MODELS]
            elif p in OPENAI_STYLE and os.getenv(OPENAI_STYLE[p][1]):
                self.chain += [(p, m) for m in OPENAI_STYLE[p][2]]
            elif p == "claude" and os.getenv("ANTHROPIC_API_KEY"):
                self.chain.append(("claude", CLAUDE_MODEL))
        if not self.chain:
            raise SystemExit("No AI key found. Add GEMINI_API_KEY, CEREBRAS_API_KEY or GROQ_API_KEY (all free) to .env")
        self.dead = set()
        self.last = {}
        self._anthropic = None
        self.used = {}

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

    def _wait(self, provider):
        gap = GAP_SECONDS.get(provider, 1)
        since = time.time() - self.last.get(provider, 0)
        if since < gap:
            time.sleep(gap - since)
        self.last[provider] = time.time()

    def json(self, system, user, max_tokens=800):
        """Ask for a JSON reply. Tries each provider/model in order until one works."""
        errors = []
        for provider, model in self.chain:
            if (provider, model) in self.dead:
                continue
            self._wait(provider)
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
                reason = "free limit reached" if "429" in str(ex) else "not available"
                print(f"[limit] {provider}:{model} {reason}, using the next model for the rest of this run")
                self.dead.add((provider, model))
            except Exception as ex:
                errors.append(f"{provider}:{model}: {ex}")
                continue
        raise RuntimeError("All AI options failed: " + " | ".join(e[:120] for e in errors[-3:]))

    def _gemini(self, model, system, user, max_tokens):
        data = _post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            {"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": max(max_tokens, 2048),
                                     "responseMimeType": "application/json"},
            },
        )
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
        headers = {"Authorization": f"Bearer {os.environ[key_name]}"}
        try:
            data = _post(url, headers, body)
        except RuntimeError as ex:
            if "HTTP 400" not in str(ex):
                raise
            body.pop("response_format")   # some models don't support JSON mode; the prompt still asks for JSON
            data = _post(url, headers, body)
        return data["choices"][0]["message"]["content"]

    def _claude(self, model, system, user, max_tokens):
        msg = self.anthropic.messages.create(model=model, max_tokens=max_tokens, system=system,
                                             messages=[{"role": "user", "content": user}])
        return msg.content[0].text
