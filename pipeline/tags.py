"""
Tags each story with the products / vendors it is about (for Preferences and "For you"), and flags zero-days.
No AI cost: plain word matching against products.json, plus whatever product names the AI summary already listed.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCTS = json.load(open(os.path.join(HERE, "products.json"), encoding="utf-8"))

# everyday words that are also product names: only count them when written with a capital letter (Teams, Zoom, Box ...)
CASE_SENSITIVE = {"box", "signal", "arm", "elastic", "git", "teams", "slack", "zoom", "duo", "hp", "abb", "amd", "intel",
                  "windows", "outlook", "chrome", "java", "gemini", "claude", "apple", "safari", "copilot", "workday",
                  "cleo", "stripe", "dell", "ios", "entra", "edge", "exchange", "splunk", "discord", "telegram"}


def _pattern(alias, proper):
    body = re.escape(proper if alias in CASE_SENSITIVE else alias)
    return re.compile(rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])", 0 if alias in CASE_SENSITIVE else re.I)


def _proper(alias, name):
    if alias == name.lower():
        return name
    return alias[:1].upper() + alias[1:]


_MATCHERS = [(p["name"], p["vendor"], [_pattern(a, _proper(a, p["name"])) for a in p["aliases"]]) for p in PRODUCTS]
_BY_LOWER = {a: p["name"] for p in PRODUCTS for a in p["aliases"]}


def tag_products(*texts, ai_products=None, limit=8):
    """Canonical product names (and their vendor) mentioned in the text."""
    text = " ".join(t for t in texts if t)
    found = []
    for name, vendor, pats in _MATCHERS:
        if any(p.search(text) for p in pats):
            for tag in (name, vendor):
                if tag and tag not in found:
                    found.append(tag)
    for raw in ai_products or []:
        raw = re.sub(r"\s+", " ", str(raw)).strip()[:40]
        if len(raw) < 2:
            continue
        canon = _BY_LOWER.get(raw.lower(), raw)
        if canon not in found:
            found.append(canon)
    return found[:limit]


ZERO_DAY = re.compile(
    r"zero[- ]?day|\b0[- ]?day|actively exploited|exploited in the wild|in[- ]the[- ]wild exploitation|"
    r"under active exploitation|exploited as a zero|known exploited vulnerabilit|exploited before a (?:fix|patch)",
    re.I)


def is_zero_day(*texts, ai_flag=None):
    return bool(ai_flag is True or any(t and ZERO_DAY.search(t) for t in texts))


def matches(story, products, terms):
    """Does a story match someone's preferences? Returns the first matching name, or None."""
    tags = set(story.get("products") or [])
    for p in products or []:
        if p in tags:
            return p
    text = f"{story.get('headline') or ''} {story.get('technical') or ''}".lower()
    for t in terms or []:
        if t and t.lower() in text:
            return t
    return None
