"""
Sources that publish data instead of an RSS feed. Each one is turned into feed-style entries
(title, link, summary, date), so the rest of the pipeline treats them exactly like news:
AI summary, duplicate merging, tags, pictures, alerts.

  kev   CISA Known Exploited Vulnerabilities: flaws that attackers are actively using right now.
        Read from CISA's official copy on GitHub (cisa.gov blocks automated readers).
  hibp  Have I Been Pwned: newly added data breaches. Free breach list, no key needed.
        Licensed CC BY 4.0, so every card names "Have I Been Pwned" as its source.
"""
import html, json, re, time, urllib.request
from datetime import datetime, timedelta, timezone

import feedparser

UA = "CyberSidReader/1.0 (+https://cybershortapp.github.io/cybershorts/)"
DAYS = 7          # only recent additions; older ones are already known
MAX_ITEMS = 15


def _get_json(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(20_000_000))


def _entry(title, link, summary, when):
    return feedparser.FeedParserDict({
        "title": title, "link": link, "summary": summary,
        "published_parsed": when.astimezone(timezone.utc).timetuple(),
    })


def _date(text):
    """'2026-10-02' or '2026-10-02T14:05:00Z' -> aware datetime (date-only means start of that day, UTC)."""
    text = str(text or "").strip()
    try:
        if "T" in text:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        return datetime.strptime(text[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def kev(timeout):
    data = _get_json("https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json", timeout)
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    rows = [v for v in data.get("vulnerabilities", []) if (_date(v.get("dateAdded")) or since) >= since]
    rows.sort(key=lambda v: v.get("dateAdded", ""), reverse=True)
    out = []
    for v in rows[:MAX_ITEMS]:
        cve = v.get("cveID", "")
        who = " ".join(x for x in (v.get("vendorProject"), v.get("product")) if x)
        ransomware = str(v.get("knownRansomwareCampaignUse", "")).lower() == "known"
        summary = (f"{v.get('vulnerabilityName', '')} ({cve}). {v.get('shortDescription', '')} "
                   f"CISA has added it to its Known Exploited Vulnerabilities catalogue, meaning attackers are using it now. "
                   f"Required action: {v.get('requiredAction', '')} US federal agencies must act by {v.get('dueDate', '')}."
                   + (" It is known to be used in ransomware campaigns." if ransomware else ""))
        title = f"{who} {cve} is being actively exploited, CISA warns"
        out.append(_entry(title, f"https://nvd.nist.gov/vuln/detail/{cve}", summary, _date(v.get("dateAdded"))))
    return feedparser.FeedParserDict({"entries": out})


def hibp(timeout):
    data = _get_json("https://haveibeenpwned.com/api/v3/breaches", timeout)
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    rows = [b for b in data
            if b.get("IsVerified") and not b.get("IsFabricated") and not b.get("IsSpamList")
            and (_date(b.get("AddedDate")) or since) >= since]
    rows.sort(key=lambda b: b.get("AddedDate", ""), reverse=True)
    out = []
    for b in rows[:MAX_ITEMS]:
        desc = html.unescape(re.sub(r"<[^>]+>", " ", b.get("Description", "")))
        desc = re.sub(r"\s+", " ", desc).strip()
        leaked = ", ".join((b.get("DataClasses") or [])[:8]).lower()
        count = b.get("PwnCount") or 0
        summary = (f"{desc} The breach happened on {b.get('BreachDate', 'an unknown date')} and affects {count:,} accounts. "
                   f"Exposed data: {leaked}. Source: Have I Been Pwned.")
        title = f"{b.get('Title', b.get('Name'))} data breach exposes {count:,} accounts"
        out.append(_entry(title, f"https://haveibeenpwned.com/PwnedWebsites#{b.get('Name')}", summary,
                          _date(b.get("AddedDate")) or datetime.now(timezone.utc)))
    return feedparser.FeedParserDict({"entries": out})


READERS = {"kev": kev, "hibp": hibp}
