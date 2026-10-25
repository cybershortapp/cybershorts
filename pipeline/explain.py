"""Attack chain explainers (release 1.0.4).

For stories that have an attack chain, the AI writes the extra words the premium chain page needs:
a short explainer headline, the damage in numbers (only numbers that are in the story), a plain title and
"what would have stopped it" for every step, the lesson, and up to three "Your move" questions for the
Play defender game. Saved inside the story's incident (incident.explainer), so no database change is needed.
Older apps simply ignore it.
"""
import re
from datetime import datetime, timedelta, timezone

PER_RUN = 3            # AI calls per run; chains arrive a few at a time
LOOKBACK_DAYS = 7      # also fills in recent stories that came before this feature

PROMPT = """You explain how a cyber attack happened, for ordinary readers of a security news app.
You get a news story and its attack chain (the steps the attackers took, in order).
Rules:
- British English, plain words, short sentences. No em dashes. No jargon without explaining it.
- Use only facts from the story and the chain, plus safety advice that is always true.
- Never invent numbers, money amounts, dates, victims or quotes. Impact numbers must appear in the story text.
- If people appear in "Your move" scenes, use clearly made-up first names that are unusual, never real people,
  never the victim's real staff, and never Dave, David, John, Sarah or Mike.
Reply with JSON only:
{"title": "a gripping explainer headline about how it happened, max 60 chars",
 "impact": [{"value": "a number from the story, max 12 chars, e.g. 6 weeks or £300m", "label": "what it measures, max 34 chars"}],
 "lesson": "the one move that would have stopped the attack at its entry point, max 120 chars",
 "steps": [{"title": "plain title for this step, max 34 chars", "stop": "what would have stopped this step, max 120 chars"}],
 "defend": [{"step": 0, "situation": "the same moment happening at the reader's company, max 140 chars",
             "options": ["option, max 64 chars", "option", "option"], "answer": 1,
             "good": "what happens when they pick the right one, max 100 chars",
             "bad": ["why option 0 fails, max 100 chars", "", "why option 2 fails"]}],
 "checks": ["a yes or no question about the reader's real setup, max 80 chars", "...", "..."]}
"impact": 0 to 2 items. "steps": exactly one per chain step, in order. "defend": 1 to 3 decision moments in
chain order, starting at the entry point, "step" is the chain step number from 0; exactly one right answer each;
"bad" has an empty string at the right answer. "checks": exactly 3."""


def _short(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip().replace("—", "-").replace("–", "-")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _numbers(text):
    return set(re.findall(r"\d+(?:[.,]\d+)?", text.replace(",", "")))


def check(raw, chain, source_text):
    """Tidy the AI's answer into the exact shape the app draws, or None if the essentials are missing."""
    if not isinstance(raw, dict):
        return None
    n = len(chain)
    steps = raw.get("steps")
    if not isinstance(steps, list) or len(steps) != n:
        return None
    out_steps = []
    for s in steps:
        if not isinstance(s, dict) or not s.get("title") or not s.get("stop"):
            return None
        out_steps.append({"title": _short(s["title"], 40), "stop": _short(s["stop"], 130)})
    title = _short(raw.get("title"), 70)
    if not title:
        return None
    # numbers only if every digit group really appears in the story (never an invented figure)
    have = _numbers(source_text)
    impact = []
    for it in (raw.get("impact") or [])[:2]:
        if not isinstance(it, dict):
            continue
        value, label = _short(it.get("value"), 14), _short(it.get("label"), 38)
        nums = _numbers(value)
        if value and label and nums and nums <= have:
            impact.append({"value": value, "label": label})
    defend, last = [], -1
    for d in (raw.get("defend") or [])[:3]:
        try:
            step, ans = int(d.get("step")), int(d.get("answer"))
            opts = [_short(o, 70) for o in d.get("options", [])]
            bad = [_short(b, 110) for b in d.get("bad", [])]
        except (TypeError, ValueError, AttributeError):
            continue
        if not (last < step < n) or len(opts) != 3 or not all(opts) or not 0 <= ans < 3 or len(bad) != 3:
            continue
        if not d.get("situation") or not d.get("good") or any(not bad[k] for k in range(3) if k != ans):
            continue
        bad[ans] = ""
        defend.append({"step": step, "situation": _short(d["situation"], 150), "options": opts, "answer": ans,
                       "good": _short(d["good"], 110), "bad": bad})
        last = step
    checks = [_short(c, 86) for c in (raw.get("checks") or []) if isinstance(c, str) and c.strip()][:3]
    return {"v": 1, "title": title, "impact": impact, "lesson": _short(raw.get("lesson"), 130),
            "steps": out_steps, "defend": defend, "checks": checks if len(checks) == 3 else []}


def explain_chains(db, ai, budget, deadline):
    """Write explainers for recent stories with an attack chain. Returns (note, ai_calls)."""
    if budget < 1:
        return "skipped (no AI left)", 0
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    rows = (db.table("stories").select("id,headline,technical,why_it_matters,attack_chain,incident")
            .gte("created_at", since).not_.is_("attack_chain", "null").not_.is_("incident", "null")
            .order("created_at", desc=True).limit(120).execute().data)
    todo = [r for r in rows if isinstance(r.get("attack_chain"), list) and len(r["attack_chain"]) >= 2
            and isinstance(r.get("incident"), dict) and "explainer" not in r["incident"]]
    made, failed, calls = 0, 0, 0
    for r in todo:
        if calls >= min(budget, PER_RUN) or datetime.now(timezone.utc) > deadline:
            break
        chain = r["attack_chain"]
        listing = "\n".join(f"{i}. {s.get('stage')}: {s.get('detail')}" for i, s in enumerate(chain))
        text = f"{r['headline']}\n{r.get('technical') or ''}\n{r.get('why_it_matters') or ''}"
        inc = r["incident"]
        facts = ", ".join(f"{k}: {v}" for k, v in inc.items() if k in ("victim", "victim_country", "actor") and v)
        try:
            calls += 1
            raw = ai.json(PROMPT, f"Story: {text[:1800]}\nFacts: {facts}\nAttack chain:\n{listing}", 1500)
        except Exception as ex:
            print(f"[warn] explainer for {r['id'][:10]}: {str(ex)[:80]}")
            continue
        try:
            ex = check(raw, chain, text)
        except Exception:
            ex = None
        # a failed answer is remembered, so the same story isn't retried every run
        db.table("stories").update({"incident": {**inc, "explainer": ex or {"v": 1, "failed": True}}}).eq("id", r["id"]).execute()
        if ex:
            made += 1
            print(f"[explain] {r['headline'][:70]} ({len(ex['defend'])} moves, {len(ex['impact'])} numbers)")
        else:
            failed += 1
    left = max(0, len(todo) - made - failed)
    return f"{made} written" + (f", {failed} unusable" if failed else "") + (f", {left} waiting" if left else ""), calls


if __name__ == "__main__":
    # offline check of the answer checks (no database, no AI)
    chain = [{"stage": "Reconnaissance", "detail": "Studied staff online"}, {"stage": "Initial Access", "detail": "Rang the help desk"},
             {"stage": "Impact", "detail": "Ransomware locked servers"}]
    raw = {"title": "How one phone call took down the shop", "impact": [{"value": "£300m", "label": "expected hit to profit"}, {"value": "£9bn", "label": "made up"}],
           "lesson": "Call staff back on a known number before any reset.",
           "steps": [{"title": "They studied staff", "stop": "Share less online."}, {"title": "One phone call", "stop": "Call back first."}, {"title": "Servers locked", "stop": "Offline backups."}],
           "defend": [{"step": 1, "situation": "A caller says he is locked out.", "options": ["Reset it", "Call back on the number on file", "Ask his birthday"], "answer": 1,
                       "good": "Blocked.", "bad": ["They're in.", "", "Birthdays are online."]},
                      {"step": 0, "situation": "out of order", "options": ["a", "b", "c"], "answer": 0, "good": "x", "bad": ["", "y", "z"]}],
           "checks": ["Do you call back?", "Do you alert on copies?", "Do you test backups?"]}
    import json
    print(json.dumps(check(raw, chain, "M&S expects a £300m hit after the attack"), indent=1))
