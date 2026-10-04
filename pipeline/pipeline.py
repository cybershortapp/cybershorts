"""CyberShorts news pipeline.
Fetch RSS -> skip seen/old/adverts -> merge duplicates -> AI card -> save -> health report.

Settings (.env on laptop, GitHub secrets online):
  TEST_MODE=true     only test sources, 5 stories each, max 20 AI calls
  USE_AI=true        false = no AI cost, uses the feed's own text (testing only)
  DRY_RUN=true       does everything except saving to the database
  MAX_AI_CALLS=60    hard stop on AI calls per run
  DAILY_AI_CAP=500   hard stop on AI calls per day across all runs

Exit code is 1 when the run looks broken, so GitHub emails you.
"""
import os, re, sys, json, hashlib, time, html
import urllib.request
from urllib.parse import urljoin
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

import feedparser
from dotenv import load_dotenv

from sources import SOURCES
from data_feeds import READERS
from tags import tag_products, is_zero_day
from covers import CoverMaker, cleanup_old_covers, cover_prompt, covers_made_today, image_problem, usable_image

load_dotenv()

import socket
socket.setdefaulttimeout(30)   # safety net: no network call may hang forever

def flag(name, default):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")

TEST_MODE = flag("TEST_MODE", "true")
USE_AI = flag("USE_AI", "false")
DRY_RUN = flag("DRY_RUN", "false")
MAX_AI_CALLS = int(os.getenv("MAX_AI_CALLS", "20" if TEST_MODE else "60"))      # per run
DAILY_AI_CAP = int(os.getenv("DAILY_AI_CAP", "50" if TEST_MODE else "500"))     # per UTC day, all runs
PER_SOURCE = 5 if TEST_MODE else 15
PER_VENDOR = 5 if TEST_MODE else 6
FEED_TIMEOUT = int(os.getenv("FEED_TIMEOUT", "15"))   # seconds per feed
FEED_RETRY_TIMEOUT = int(os.getenv("FEED_RETRY_TIMEOUT", "45"))   # second try for slow feeds
FEED_READER_UA = "Mozilla/5.0 (compatible; CyberSidReader/1.0; +https://cybershortapp.github.io/cybershorts/)"
RESEARCH_PER_RUN = int(os.getenv("RESEARCH_PER_RUN", "2" if TEST_MODE else "4"))   # web research for chains
RESEARCH_PER_DAY = int(os.getenv("RESEARCH_PER_DAY", "10" if TEST_MODE else "40"))
COVERS = flag("COVERS", "true")                                                   # AI pictures for stories without one
COVERS_PER_RUN = int(os.getenv("COVERS_PER_RUN", "3" if TEST_MODE else "12"))
COVERS_PER_DAY = int(os.getenv("COVERS_PER_DAY", "140"))    # Cloudflare free tier is about 150 a day
RUN_SECONDS = int(os.getenv("RUN_SECONDS", "540"))           # stop making pictures after 9 minutes (Actions limit is 12)   # vendor blogs post less often and include more marketing

MODEL = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")   # change model here only
RESEARCH_MODEL = os.getenv("RESEARCH_MODEL", MODEL)
CATEGORIES = ["Breaches", "Scams", "Vulnerabilities", "Ransomware", "Tools", "Policy", "Other"]
SIMILARITY_LIMIT = 0.72
MAX_AGE_DAYS = int(os.getenv("MAX_AGE_DAYS", "7"))   # ignore stories older than this

SEVERITIES = ["Critical", "High", "Medium", "Info"]
ACTIONS = ["patch", "check_breach", "report_scam", "none"]



# MITRE ATT&CK Enterprise tactics (checked on attack.mitre.org, 26 Sep 2026)
TACTICS = {
    "Reconnaissance": "TA0043", "Resource Development": "TA0042", "Initial Access": "TA0001",
    "Execution": "TA0002", "Persistence": "TA0003", "Privilege Escalation": "TA0004",
    "Stealth": "TA0005", "Defense Impairment": "TA0112", "Credential Access": "TA0006",
    "Discovery": "TA0007", "Lateral Movement": "TA0008", "Collection": "TA0009",
    "Command and Control": "TA0011", "Exfiltration": "TA0010", "Impact": "TA0040",
}
TACTIC_ALIASES = {"Defense Evasion": "Stealth", "Defence Evasion": "Stealth", "C2": "Command and Control"}
TECHNIQUE_RE = re.compile(r"\bT1\d{3}(?:\.\d{3})?\b")


def clean_chain(raw, source_text):
    """Keep only steps that use a real MITRE tactic. Technique IDs are kept only if the article itself names them."""
    if not isinstance(raw, list):
        return None
    steps = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        stage = str(item.get("stage", "")).strip()
        stage = TACTIC_ALIASES.get(stage, stage)
        detail = str(item.get("detail", "")).strip()
        if stage not in TACTICS or not detail:
            continue
        step = {"stage": stage, "tactic": TACTICS[stage], "detail": detail[:140]}
        tech = str(item.get("technique", "") or "").strip().upper()
        if TECHNIQUE_RE.fullmatch(tech) and tech in (source_text or ""):
            step["technique"] = tech
        steps.append(step)
    return steps if len(steps) >= 3 else None


PROMPT = f"""You write short cyber security news cards for a UK mobile app read by IT and security people.
Given an article title and excerpt, reply with ONLY a JSON object:
{{"is_news": true or false. false if this is an advert, webinar, product launch, promotion, podcast, event, job post, opinion piece with no new facts, a roundup of several unrelated stories, an open thread or off-topic blog post, or not about cyber security,
  "headline": "max 12 words, your own wording",
  "technical": "about 55 words for a security professional. Include CVE IDs, threat actors, affected products and versions if present",
  "why": "max 15 words. One practical line telling the reader what to do or why it matters, e.g. 'Patch FortiOS now if your VPN is internet-facing'",
  "severity": one of {SEVERITIES},
  "action": one of {ACTIONS},
  "category": one of {CATEGORIES},
  "chain": [ {{"stage": one MITRE ATT&CK tactic name, "detail": "max 15 words, what the attackers did", "technique": "T-number only if written in the text, else empty"}} ],
  "victim": "who was attacked, max 8 words, only if stated, else empty",
  "victim_country": "country of the victim, only if stated, else empty",
  "actor": "name of the attacker group exactly as written in the text, else empty",
  "actor_country": "country the attackers are linked to, ONLY if the text says an agency or security firm attributed it, else empty",
  "attributed_by": "who made that attribution (e.g. NCSC, FBI, Microsoft), else empty",
  "products": ["up to 5 affected software products or vendors named in the text, e.g. 'Microsoft Exchange', 'Fortinet FortiGate'. Empty list if none"],
  "zero_day": true only if the text says a flaw was exploited before a fix existed, or is being actively exploited in the wild, else false,
  "scene": "max 20 words: one simple visual scene that illustrates this story as a picture, using objects only (servers, locks, phones, shields, buildings, data). No people, no brand names, no logos, no text" }}

Chain rules:
- Only fill "chain" when the text itself describes at least 3 separate steps of how the attackers got in and what they did next, in order.
- Use only these stage names: {", ".join(TACTICS)}.
- Never guess or add steps the text does not describe. If unsure, return "chain": [].
- Never guess a country or attacker. Leave those fields empty unless the text states them.

Severity rules:
- Critical: the text says a flaw is actively exploited / zero-day being used, or a breach affecting millions
- High: serious flaw or breach with patch/response needed, not stated as exploited
- Medium: limited impact, research findings, smaller incidents
- Info: guidance, policy, reports, arrests, industry news

Action rules:
- patch: a software flaw where updating fixes it
- check_breach: people's emails or personal data were leaked
- report_scam: a phishing or scam campaign aimed at the public
- none: anything else

Use only facts from the text given. Never invent details, names, numbers or links. Do not copy sentences from the source. No hype.
Use British English spelling."""


STAGE_ORDER = list(TACTICS)


def short(v, n=60):
    v = str(v or "").strip()
    return v[:n] if v else ""


def clean_incident(data, source_text):
    """Facts about who/where. Attacker names must appear in the article; countries need a named attributor."""
    text = (source_text or "").lower()
    inc = {
        "victim": short(data.get("victim")),
        "victim_country": short(data.get("victim_country"), 40),
        "actor": short(data.get("actor")),
        "actor_country": short(data.get("actor_country"), 40),
        "attributed_by": short(data.get("attributed_by"), 40),
    }
    if inc["actor"] and inc["actor"].lower() not in text:
        inc["actor"] = ""
    if not inc["attributed_by"] or inc["attributed_by"].lower() not in text:
        inc["actor_country"] = inc["attributed_by"] = ""
    return {k: v for k, v in inc.items() if v} or None


# ---- threat groups (MITRE ATT&CK, free public data) ----
MITRE_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json"


def plain(desc):
    desc = re.sub(r"\(Citation:[^)]*\)", "", desc or "")
    desc = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", desc)
    sentences = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", desc).strip())
    return " ".join(sentences[:2])[:400]


def refresh_groups(db):
    """Download MITRE ATT&CK threat groups and save a small profile for each one."""
    print("Updating threat group profiles from MITRE ATT&CK...")
    req = urllib.request.Request(MITRE_URL, headers={"User-Agent": "CyberShortsBot/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    objs = data["objects"]
    by_id = {o["id"]: o for o in objs}
    live = lambda o: not o.get("revoked") and not o.get("x_mitre_deprecated")
    groups = {o["id"]: o for o in objs if o.get("type") == "intrusion-set" and live(o)}
    methods, campaigns = {}, {}
    for r in objs:
        if r.get("type") != "relationship" or not live(r):
            continue
        src, tgt = r.get("source_ref"), by_id.get(r.get("target_ref"))
        if r.get("relationship_type") == "uses" and src in groups and tgt and tgt.get("type") == "attack-pattern" and live(tgt):
            if not tgt.get("x_mitre_is_subtechnique"):
                methods.setdefault(src, []).append(tgt["name"])
        if r.get("relationship_type") == "attributed-to" and r.get("target_ref") in groups:
            c = by_id.get(src)
            if c and c.get("type") == "campaign" and live(c) and not re.fullmatch(r"C\d{4}", c["name"]):
                campaigns.setdefault(r["target_ref"], []).append(c["name"])
    rows = []
    for gid, g in groups.items():
        ref = next((x for x in g.get("external_references", []) if x.get("source_name") == "mitre-attack"), None)
        if not ref:
            continue
        rows.append({
            "id": ref["external_id"], "name": g["name"],
            "aliases": sorted(set(g.get("aliases") or [g["name"]])),
            "summary": plain(g.get("description")),
            "methods": sorted(set(methods.get(gid, [])))[:8],
            "campaigns": sorted(set(campaigns.get(gid, [])))[:4],
            "url": ref.get("url") or f"https://attack.mitre.org/groups/{ref['external_id']}/",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    for i in range(0, len(rows), 100):
        db.table("threat_groups").upsert(rows[i:i + 100]).execute()
    print(f"Saved {len(rows)} threat group profiles.\n")


def load_group_index(db):
    rows = db.table("threat_groups").select("id,aliases,updated_at").execute().data
    stale = not rows or min(r["updated_at"] for r in rows) < (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    if stale:
        try:
            refresh_groups(db)
            rows = db.table("threat_groups").select("id,aliases,updated_at").execute().data
        except Exception as ex:
            print(f"[warn] could not update threat groups: {ex}")
    index = []
    for r in rows:
        for a in r["aliases"] or []:
            if len(a) >= 4:
                index.append((re.compile(r"\b" + re.escape(a) + r"\b", re.I), r["id"], a))
    index.sort(key=lambda x: -len(x[2]))   # longer names first
    return index


def match_group(index, *texts):
    """Link a MITRE group only if one of its names is written in the article."""
    blob = " ".join(t or "" for t in texts)
    for rx, gid, _ in index:
        if rx.search(blob):
            return gid
    return None


# ---- research: fill in the attack chain from trusted sources ----
TRUSTED_DOMAINS = [
    "cisa.gov", "ncsc.gov.uk", "fbi.gov", "ic3.gov", "cyber.gov.au", "cert.europa.eu", "attack.mitre.org",
    "microsoft.com", "cloud.google.com", "mandiant.com", "blog.talosintelligence.com", "unit42.paloaltonetworks.com",
    "crowdstrike.com", "sentinelone.com", "research.checkpoint.com", "securelist.com", "welivesecurity.com",
    "sophos.com", "huntress.com", "rapid7.com", "thedfirreport.com", "proofpoint.com", "trendmicro.com",
    "elastic.co", "bleepingcomputer.com", "therecord.media",
]

RESEARCH_PROMPT = f"""You research how one specific cyber attack happened, for an attack chain diagram.
Search only for reports about THIS exact incident. Ignore other incidents, even by the same group.
Then reply with ONLY a JSON object:
{{"steps": [{{"stage": one of {STAGE_ORDER}, "detail": "max 15 words, what the attackers did", "source_url": "the exact URL of the page that says it"}}]}}
Rules: every step must be stated in a page you found. If you are not sure a report is about this exact incident, leave it out.
If nothing reliable is found, reply {{"steps": []}}. Use British English."""


def domain_ok(url):
    host = re.sub(r"^https?://", "", url or "").split("/")[0].lower()
    return any(host == d or host.endswith("." + d) for d in TRUSTED_DOMAINS)


def research_chain(ai, title, text, incident):
    facts = ", ".join(f"{k}: {v}" for k, v in (incident or {}).items())
    msg = ai.anthropic.messages.create(
        model=RESEARCH_MODEL, max_tokens=1200, system=RESEARCH_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3, "allowed_domains": TRUSTED_DOMAINS}],
        messages=[{"role": "user", "content": f"Incident: {title}\n{facts}\nArticle extract: {text[:1200]}"}],
    )
    found_urls, answer = set(), ""
    for block in msg.content:
        if getattr(block, "type", "") == "web_search_tool_result" and isinstance(getattr(block, "content", None), list):
            for r in block.content:
                if getattr(r, "url", None):
                    found_urls.add(r.url.split("#")[0])
        if getattr(block, "type", "") == "text":
            answer += block.text
    m = re.search(r"\{.*\}", answer, re.S)
    if not m:
        return []
    steps = []
    for s in (json.loads(m.group(0)).get("steps") or [])[:8]:
        stage = TACTIC_ALIASES.get(str(s.get("stage", "")).strip(), str(s.get("stage", "")).strip())
        url = str(s.get("source_url", "")).split("#")[0]
        detail = short(s.get("detail"), 140)
        # the URL must be a trusted site AND one the search actually returned
        if stage in TACTICS and detail and domain_ok(url) and url in found_urls:
            host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
            steps.append({"stage": stage, "tactic": TACTICS[stage], "detail": detail, "source": host, "source_url": url})
    return steps


def merge_chain(article_steps, research_steps):
    """Article steps first; research only adds stages the article doesn't cover. Result in attack order."""
    steps = [dict(s, source="article") for s in (article_steps or [])]
    have = {s["stage"] for s in steps}
    for s in research_steps:
        if s["stage"] not in have:
            steps.append(s)
            have.add(s["stage"])
    steps.sort(key=lambda s: STAGE_ORDER.index(s["stage"]))
    return steps if len(steps) >= 3 else None


def worth_researching(s):
    return s["category"] in ("Ransomware", "Breaches", "Vulnerabilities") and s["severity"] in ("Critical", "High") and (
        s.get("chain") or (s.get("incident") or {}).get("actor") or (s.get("incident") or {}).get("victim"))


CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.I)


def find_cves(*texts):
    """CVE IDs taken straight from the source text, never from the AI, so links are always real."""
    seen = []
    for t in texts:
        for c in CVE_RE.findall(t or ""):
            c = c.upper()
            if c not in seen:
                seen.append(c)
    return seen[:3]


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def shorten(text, words):
    parts = text.split()
    return " ".join(parts[:words]) + ("..." if len(parts) > words else "")


BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# images that are usually a site logo or placeholder, not a real story picture
BORING_IMAGE = re.compile(
    r"(logo|favicon|default|placeholder|avatar|gravatar|blank|spacer|pixel|icon|badge|sprite|\.svg|\.gif)",
    re.I,
)


def good_image(url):
    return bool(url) and url.startswith("http") and not BORING_IMAGE.search(url)


def feed_image(entry):
    """Image included in the RSS feed itself (free, no extra request)."""
    for key in ("media_content", "media_thumbnail"):
        for m in entry.get(key, []) or []:
            if good_image(m.get("url")):
                return m["url"]
    for enc in entry.get("enclosures", []) or []:
        if str(enc.get("type", "")).startswith("image") and good_image(enc.get("href")):
            return enc["href"]
    for field in ("summary", "content"):
        raw = entry.get(field) or ""
        if isinstance(raw, list):
            raw = " ".join(c.get("value", "") for c in raw)
        m = re.search(r'<img[^>]+src="([^"]+)"', raw)
        if m and good_image(m.group(1)):
            return m.group(1)
    return None


META_PATTERNS = [
    r'<meta[^>]+(?:property|name)=["\'](?:og:image:secure_url|og:image|twitter:image(?::src)?)["\'][^>]*content=["\']([^"\']+)',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\'](?:og:image:secure_url|og:image|twitter:image(?::src)?)',
]


def image_from_html(page_html, base_url):
    """Pick the article's main preview image (the one shown when a link is shared)."""
    for pattern in META_PATTERNS:
        for found in re.findall(pattern, page_html, re.I):
            url = urljoin(base_url, html.unescape(found.strip()))
            if good_image(url):
                return url
    return None


def fetch_article(link):
    """Download the article page once. Returns (html, final_url) or ("", link) on failure."""
    try:
        req = urllib.request.Request(link, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.read(600_000).decode("utf-8", errors="ignore"), resp.geturl()
    except Exception:
        return "", link


def article_text(page_html, limit=3000):
    """The article's own paragraphs (skips menus, sidebars and scripts). Used for the AI and for CVE IDs."""
    page_html = re.sub(r"<(script|style|nav|aside|footer|header|form)[^>]*>.*?</\1>", " ", page_html, flags=re.S | re.I)
    paras = [clean(x) for x in re.findall(r"<p[^>]*>(.*?)</p>", page_html, flags=re.S | re.I)]
    paras = [x for x in paras if len(x) >= 60]
    return " ".join(paras)[:limit]


def article_image(link):
    page, final_url = fetch_article(link)
    return image_from_html(page, final_url) if page else None


def published_of(entry):
    t = entry.get("published_parsed") or entry.get("updated_parsed")
    now = datetime.now(timezone.utc)
    # a few sites put future dates on posts; never let one sit on top of the feed
    return min(datetime(*t[:6], tzinfo=timezone.utc), now) if t else now


def summarise_ai(client, title, excerpt):
    data = client.json(PROMPT, f"Title: {title}\nExcerpt: {excerpt[:3000]}", 800)
    if data.get("is_news") is False:
        # not security news: nothing else is needed, the story is skipped
        return {"is_news": False, "headline": "", "technical": "", "why": "", "severity": "Info",
                "action": "none", "category": "Other", "chain": None, "incident": None}
    for key in ("headline", "technical"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f"AI reply missing {key}")
    if data.get("category") not in CATEGORIES:
        data["category"] = "Other"
    if data.get("severity") not in SEVERITIES:
        data["severity"] = "Info"
    if data.get("action") not in ACTIONS:
        data["action"] = "none"
    if not isinstance(data.get("why"), str):
        data["why"] = ""
    data["is_news"] = data.get("is_news") is not False
    data["technical"] = fit_summary(data["technical"])
    data["products"] = [str(x) for x in data.get("products") or [] if isinstance(x, str)][:5]
    data["zero_day"] = data.get("zero_day") is True
    data["chain"] = clean_chain(data.get("chain"), f"{title} {excerpt}")
    data["incident"] = clean_incident(data, f"{title} {excerpt}")
    return data


def fit_summary(text, max_words=70):
    """Backup models sometimes write far more than the ~55 words asked for, which can't fit on a card.
    Cut long summaries at the last full sentence within max_words (or at max_words with "...")."""
    text = re.sub(r"\s+", " ", text).strip()
    parts = text.split(" ")
    if len(parts) <= max_words:
        return text
    cut = " ".join(parts[:max_words])
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > len(cut) * 0.5 else cut.rstrip(",;:") + "..."


def summarise_free(title, excerpt):
    text = shorten(excerpt or title, 60)
    return {"headline": shorten(title, 12), "technical": text, "why": "", "severity": "Info",
            "action": "none", "category": "Other", "chain": None, "is_news": True, "incident": None,
            "products": [], "zero_day": False}


NOT_NEWS_TITLE = re.compile(
    r"\b(webinar|podcast|sponsored|partner content|register now|join us|live demo|on-demand|whitepaper|"
    r"e-?book|we'?re hiring|job opening|press release|awards?\b|conference|summit|top \d+ |best .* tools|"
    r"newsletter|round ?\d+|roundup|round-up|week in review|weekly update|this week in|recap|"
    r"in other news|squid blogging|news digest|weekly digest|daily digest|links? of the week|open thread)",
    re.I,
)
CYBER_WORDS = re.compile(
    r"\b(cyber|hack|hacker|hacked|breach|leak|leaked|ransomware|malware|phishing|scam|scammer|fraud|"
    r"spyware|vulnerab|exploit|zero-day|0-day|cve-|patch|botnet|ddos|data theft|stolen data|password|"
    r"security flaw|attack|infosec|encryption|surveillance|trojan|backdoor)",
    re.I,
)
STOPWORDS = set("""the a an and or of to in on for with by from at as is are was were be been has have had it its
this that these those new after over into via amid says said warns warn warning report reports how why what
who more than about up out off just now your you their they them our we can could may might will would""".split())


def words(text):
    """Key words for matching. Splits 'Iran-linked' into 'iran' + 'linked' and drops plural s."""
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if len(w) > 4 and w.endswith("s"):
            w = w[:-1]
        if len(w) >= 4 and w not in STOPWORDS:
            out.add(w)
    return out


def overlap(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


SAME_EVENT_PROMPT = """You check if a new cyber security news story reports the SAME real-world event as one of the existing stories.
Different news sites cover the same event with different headlines, wording, angles and details (one mentions the attacker,
another the software flaw, another the victims). If the victim AND the incident match (e.g. the same breach of the same
organisation, the same flaw being exploited, the same arrest, the same report), it IS the same event, even if the headlines differ.
It is NOT the same event if the victim is different, or it is a separate incident by the same attacker, or only the topic is similar.
Reply with ONLY a JSON object: {"match": <number of the matching existing story> or null}"""


def same_event(ai, title, excerpt, candidates):
    listing = "\n".join(f"{i + 1}. {c['orig_title']} :: {(c.get('technical') or '')[:220]}" for i, c in enumerate(candidates))
    data = ai.json(SAME_EVENT_PROMPT, f"NEW: {title}\n{excerpt[:500]}\n\nEXISTING:\n{listing}", 60)
    n = data.get("match")
    if isinstance(n, str) and n.isdigit():
        n = int(n)
    return candidates[n - 1] if isinstance(n, int) and 1 <= n <= len(candidates) else None


def rare_words(recent):
    """Words that appear in only a few recent stories, e.g. 'shinyhunter', 'peoplesoft', 'fbijob'.
    Sharing several of these is a strong sign two stories are about the same event; words like 'data' or 'breach' are not."""
    from collections import Counter
    df = Counter(x for r in recent for x in r["_words"])
    limit = max(3, int(len(recent) * 0.04))
    return {x for x, n in df.items() if n <= limit}


def find_duplicate(title, excerpt, cves, recent, rare=None):
    """Cheap checks first. Returns (story, None) for a sure match, (None, candidates) when the AI should decide."""
    t = title.lower()
    w = words(f"{title} {excerpt[:300]}")
    rare = rare_words(recent) if rare is None else rare
    scored = []
    for r in recent:
        if cves and set(cves) & set(r.get("cves") or []):
            return r, None
        if SequenceMatcher(None, t, r["orig_title"].lower()).ratio() > SIMILARITY_LIMIT:
            return r, None
        common = w & r["_words"]
        shared = len(common)
        rare_shared = len(common & rare)
        # very strong overlap (rare names in both headlines AND the text): the same event without asking the AI
        title_rare = len(words(title) & words(r["orig_title"]) & rare)
        if rare_shared >= 5 and title_rare >= 2:
            return r, None
        score = overlap(w, r["_words"])
        if rare_shared >= 2 or shared >= 3 or (shared >= 2 and score >= 0.3):
            scored.append((rare_shared * 3 + shared + score, r))
    scored.sort(key=lambda x: -x[0])
    return None, [r for _, r in scored[:5]]


def gh_note(title, text):
    """On GitHub Actions, attach a short note to the run that can be read without opening the logs."""
    if os.getenv("GITHUB_ACTIONS") == "true":
        text = str(text).replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print(f"::notice title={title}::{text}")


def read_feed(src, timeout=None, ua=None):
    """Download one feed with a hard time limit, so one slow website can't freeze the whole run."""
    try:
        if src.get("reader"):          # a data source (CISA, Have I Been Pwned...), not an RSS feed
            return src["name"], READERS[src["reader"]](timeout or FEED_RETRY_TIMEOUT), None
        req = urllib.request.Request(src["url"], headers={
            "User-Agent": ua or BROWSER_UA,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            "Accept-Language": "en-GB,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=timeout or FEED_TIMEOUT) as resp:
            raw = resp.read(4_000_000)
        return src["name"], feedparser.parse(raw), None
    except Exception as ex:
        return src["name"], None, ex

def read_again(src):
    """Second try for a feed that failed: much more time (far-away or slow sites), and a plain
    feed-reader name, which some sites' bot filters accept when they block browser-looking requests."""
    name, feed, err = read_feed(src, FEED_RETRY_TIMEOUT, FEED_READER_UA)
    if err:
        time.sleep(2)
        name, feed, err = read_feed(src, FEED_RETRY_TIMEOUT)
    return name, feed, err


def main():
    # Python 3.14 prints harmless "Exception ignored while finalizing file" noise after network timeouts; hide it
    sys.unraisablehook = lambda unraisable: None
    print(f"\n=== CyberSid pipeline | TEST_MODE={TEST_MODE} USE_AI={USE_AI} DRY_RUN={DRY_RUN} ===\n")
    started = datetime.now(timezone.utc)

    db = None
    if not DRY_RUN:
        from supabase import create_client
        db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    ai = None
    if USE_AI:
        from ai import AI
        ai = AI()
        print(f"AI: {ai.describe()} | chain research: {'on' if ai.can_research else 'off (free mode)'}")

    # stories from the last 3 days, for duplicate checks
    recent = []
    ai_used_today = research_used_today = 0
    group_index = load_group_index(db) if db else []
    if db:
        since = (started - timedelta(days=3)).isoformat()
        recent = (db.table("stories").select("id,orig_title,technical,cves,source,url,also_reported,published_at")
                  .gte("created_at", since).or_("category.is.null,category.not.in.(Tips,History)").execute().data)
        day_start = started.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        runs = db.table("pipeline_runs").select("ai_calls,research").gte("started_at", day_start).execute().data
        ai_used_today = sum(r["ai_calls"] or 0 for r in runs)
        research_used_today = sum(r.get("research") or 0 for r in runs)
    for r in recent:
        r["_words"] = words(f"{r['orig_title']} {(r.get('technical') or '')[:300]}")
    ai_budget = max(0, min(MAX_AI_CALLS, DAILY_AI_CAP - ai_used_today)) if USE_AI else 0
    if USE_AI:
        print(f"AI budget this run: {ai_budget} calls ({ai_used_today} used today, daily cap {DAILY_AI_CAP})\n")
    cutoff = started - timedelta(days=MAX_AGE_DAYS)

    def remember(sid, reason, story_id=None):
        if db:
            db.table("seen_links").upsert({"id": sid, "reason": reason, "story_id": story_id}).execute()

    sources = [s for s in SOURCES if s["test"]] if TEST_MODE else SOURCES

    # read all feeds at the same time (much faster than one by one, keeps each run short)
    from concurrent.futures import ThreadPoolExecutor

    print(f"Reading {len(sources)} feeds (max {FEED_TIMEOUT}s each)...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=16) as pool:
        feeds = {name: (feed, err) for name, feed, err in pool.map(read_feed, sources)}
    retry = [src for src in sources if feeds[src["name"]][1] or feeds[src["name"]][0] is None]
    if retry:
        print(f"Trying {len(retry)} slow or blocked feed(s) again with more time: {', '.join(r['name'] for r in retry)}")
        with ThreadPoolExecutor(max_workers=8) as pool:
            for name, feed, err in pool.map(read_again, retry):
                feeds[name] = (feed, err)
                print(f"  {name}: {'OK on second try' if not err else 'still failing: ' + str(err)[:80]}")
    bad = sum(1 for f, e in feeds.values() if e or f is None)
    print(f"Feeds read in {time.time() - t0:.0f}s ({len(feeds) - bad} ok, {bad} not reachable)\n")

    health, ai_calls, stopped, research_count = [], 0, False, 0
    research_budget = max(0, min(RESEARCH_PER_RUN, RESEARCH_PER_DAY - research_used_today)) if USE_AI else 0
    totals = {"added": 0, "merged": 0, "seen": 0, "old": 0, "skipped": 0, "failed": 0}
    need_cover = []

    # ---- 1. collect everything new from every feed ----
    rows, candidates, seen_ids = {}, [], set()
    for src in sources:
        row = {"source": src["name"], "found": 0, "added": 0, "merged": 0, "seen": 0, "old": 0,
               "skipped": 0, "failed": 0, "status": "OK"}
        rows[src["name"]] = row
        limit = PER_VENDOR if src.get("kind") == "vendor" else PER_SOURCE
        feed, err = feeds[src["name"]]
        if err or feed is None:
            row["status"] = f"FEED ERROR: {err}"[:60]
            continue
        # newest first: some feeds (e.g. Microsoft's) list thousands of items in date order, oldest at the top
        entries = sorted((e for e in feed.entries if e.get("link") and e.get("title")),
                         key=published_of, reverse=True)[:limit]
        row["found"] = len(entries)
        if not entries:
            row["status"] = "NO STORIES (check URL)"
            continue
        # links already saved as a story, or already merged / skipped before
        ids = [hashlib.sha1(e.get("link").encode()).hexdigest()[:16] for e in entries]
        if db:
            seen_ids |= {r["id"] for r in db.table("stories").select("id").in_("id", ids).execute().data}
            seen_ids |= {r["id"] for r in db.table("seen_links").select("id").in_("id", ids).execute().data}
        for e, sid in zip(entries, ids):
            if sid in seen_ids:
                row["seen"] += 1
            elif published_of(e) < cutoff:
                row["old"] += 1
            else:
                candidates.append((published_of(e), src, e, sid))

    # ---- 2. newest stories first, across all sources, so the AI budget goes to the freshest news ----
    candidates.sort(key=lambda c: c[0], reverse=True)
    print(f"{len(candidates)} new stories to check (newest first)\n")

    for published, src, e, sid in candidates:
        if stopped:
            break
        row = rows[src["name"]]
        if sid in seen_ids:          # a link can appear in two feeds
            row["seen"] += 1
            continue
        link, title = e.get("link"), clean(e.get("title"))
        excerpt = clean(e.get("summary") or e.get("description"))

        # 1. obvious adverts, webinars and off-topic stories (no AI cost)
        if NOT_NEWS_TITLE.search(title) or (src.get("kind") == "general" and not CYBER_WORDS.search(title)):
            remember(sid, "not_news")
            seen_ids.add(sid)
            row["skipped"] += 1
            continue

        page, final_url = ("", link) if src.get("reader") else fetch_article(link)
        body = article_text(page)
        text_for_ai = body if len(body) > len(excerpt) else excerpt
        cves = find_cves(title, excerpt, body)

        try:
            # 2. same story already on another card? merge it as "also reported by"
            match, similar = find_duplicate(title, excerpt, cves, recent, rare_words(recent))
            if not match and similar and USE_AI:
                if ai_calls >= ai_budget:
                    stopped = True
                    break
                ai_calls += 1
                match = same_event(ai, title, text_for_ai, similar)
            if match:
                also = match.get("also_reported") or []
                if match["source"] != src["name"] and all(a.get("source") != src["name"] for a in also):
                    also = also + [{"source": src["name"], "url": link}]
                    match["also_reported"] = also
                    if db:
                        db.table("stories").update({"also_reported": also}).eq("id", match["id"]).execute()
                remember(sid, "duplicate", match["id"])
                seen_ids.add(sid)
                row["merged"] += 1
                print(f"[merge] {src['name']}: {title[:60]}\n        -> same as: {match['orig_title'][:60]}")
                continue

            # 3. write the card
            if USE_AI:
                if ai_calls >= ai_budget:
                    stopped = True
                    break
                ai_calls += 1
                s = summarise_ai(ai, title, text_for_ai)
            else:
                s = summarise_free(title, text_for_ai)

            if not s["is_news"]:
                remember(sid, "not_news")
                seen_ids.add(sid)
                row["skipped"] += 1
                print(f"[skip] {src['name']}: not news -> {title[:60]}")
                continue

            chain, incident = s["chain"], s["incident"]
            research_steps = []
            if ai and ai.can_research and worth_researching(s) and research_count < research_budget and ai_calls < ai_budget:
                research_count += 1
                ai_calls += 1
                try:
                    research_steps = research_chain(ai, title, text_for_ai, incident)
                except Exception as ex:
                    print(f"[warn] research failed: {ex}")
            chain = merge_chain(chain, research_steps)
            if research_steps and chain:
                incident = dict(incident or {}, researched=True,
                                sources=sorted({x["source"] for x in chain if x.get("source") != "article"}))
            group = match_group(group_index, title, text_for_ai)

            image = feed_image(e) or (image_from_html(page, final_url) if page else None)
            if image and COVERS and not usable_image(image):
                image = None   # broken or tiny picture: an AI picture looks better
            story = {
                "id": sid, "source": src["name"], "url": link, "orig_title": title,
                "headline": s["headline"], "technical": s["technical"],
                "why_it_matters": s["why"].strip() or None, "severity": s["severity"],
                "action": s["action"], "cves": cves,
                "attack_chain": chain, "chain_checked": True, "also_reported": [],
                "incident": incident, "actor_group": group,
                "category": s["category"], "country": src["country"], "language": "en",
                "image_url": image, "published_at": published_of(e).isoformat(),
                "products": tag_products(title, s["headline"], s["technical"], body[:3000], ai_products=s.get("products")),
                "zero_day": is_zero_day(title, s["technical"], excerpt, ai_flag=s.get("zero_day")),
            }
            if db:
                db.table("stories").upsert(story).execute()
            seen_ids.add(sid)
            if not image:
                need_cover.append((sid, cover_prompt(s.get("scene"), s["category"]), s["headline"]))
            recent.append({"id": sid, "orig_title": title, "cves": cves, "source": src["name"], "technical": s["technical"],
                           "url": link, "also_reported": [], "_words": words(f"{title} {s['technical'][:300]}")})
            row["added"] += 1
            print(f"[ok]  {src['name']}: {s['headline']}")
            if DRY_RUN or TEST_MODE:
                extra = f" | attack chain: {len(chain)} steps" if chain else ""
                extra += f" (+{len(research_steps)} researched)" if research_steps else ""
                extra += f" | group: {group}" if group else ""
                print(f"      [{s['severity']}] {s['why']}{extra}\n")
        except Exception as ex:
            row["failed"] += 1
            print(f"[fail] {src['name']}: {title[:50]} -> {ex}")


    if stopped:
        left = sum(1 for c in candidates if c[3] not in seen_ids)
        print(f"[stop] AI budget used up ({ai_budget} calls). {left} older stories wait for the next run.")

    # ---- 2b. the daily cards: one tip (8am UK) and one cyber history card (12pm UK), never repeated ----
    # Their pictures go to the front of the queue, so they always have one, even on busy news days.
    daily_cover, tip_note, history_note = [], "off", "off"
    if db and not TEST_MODE:
        for name, module, func, category in (("tip", "tips", "post_daily_tip", "Tips"),
                                             ("history", "history", "post_daily_history", "Other")):
            try:
                story, note, calls, waiting = getattr(__import__(module), func)(db, ai)
                ai_calls += calls
                daily_cover += [(sid, cover_prompt(scene, category), headline) for sid, scene, headline in waiting]
                if story:
                    print(f"[{name}] {note}")
            except Exception as ex:
                note = f"failed: {str(ex)[:80]}"
                print(f"[warn] {name} card: {note}")
            if name == "tip":
                tip_note = note
            else:
                history_note = note

    # ---- 2c. recent stories that still have no picture (the picture service was busy or failed last time) ----
    if db and COVERS and not TEST_MODE:
        try:
            have = {c[0] for c in need_cover + daily_cover}
            since = (started - timedelta(days=2)).isoformat()
            missing = (db.table("stories").select("id,headline,category").is_("image_url", "null")
                       .gte("created_at", since).order("created_at", desc=True).limit(20).execute().data)
            for r in [r for r in missing if r["id"] not in have][:int(os.getenv("COVERS_RETRY", "6"))]:
                need_cover.append((r["id"], cover_prompt("", r["category"] or "Other"), r["headline"]))
        except Exception as ex:
            print(f"[warn] picture retry list: {str(ex)[:80]}")
    need_cover = daily_cover + need_cover

    # ---- 3. AI pictures for new stories that have no usable picture ----
    covers_made, covers_note = 0, "off"
    if COVERS and db and need_cover:
        maker = CoverMaker(db)
        day_start = started.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        allowed = max(0, min(COVERS_PER_RUN, COVERS_PER_DAY - covers_made_today(db, day_start)))
        print(f"\nAI pictures: {len(need_cover)} stories need one, making up to {allowed} ({maker.describe()})")
        for sid, prompt, headline in need_cover[:allowed]:
            if (datetime.now(timezone.utc) - started).total_seconds() > RUN_SECONDS or not maker.available:
                break
            try:
                url = maker.make(sid, prompt)
            except Exception as ex:
                url = None
                maker.errors.append(str(ex)[:80])
            if url:
                db.table("stories").update({"image_url": url}).eq("id", sid).execute()
                covers_made += 1
                print(f"[pic] {headline[:70]}")
        covers_note = f"{covers_made} made ({maker.used})" + (f", problems: {' | '.join(dict.fromkeys(maker.errors))[:300]}" if maker.errors else "")
        try:
            removed = cleanup_old_covers(db)
            if removed:
                print(f"Removed {removed} old AI pictures to save storage.")
        except Exception as ex:
            print(f"[warn] old picture clean-up failed: {ex}")

    # ---- 4. phone alerts (max one per phone per hour) and email ----
    alerts_note = email_note = "off"
    if db and not TEST_MODE:
        try:
            from notify import send_alerts
            alerts_note = send_alerts(db)
        except Exception as ex:
            alerts_note = f"problem: {str(ex)[:100]}"
        try:
            from mailer import run_email
            email_note = run_email(db)
        except Exception as ex:
            email_note = f"problem: {str(ex)[:100]}"

    health = [rows[s["name"]] for s in sources]
    for r in health:
        for k in ("added", "merged", "seen", "old", "skipped", "failed"):
            totals[k] += r[k]

    ok_sources = sum(1 for r in health if r["status"] == "OK")
    print("\n=== Health report ===")
    print(f"{'Source':<30}{'Found':>6}{'New':>5}{'Merged':>7}{'Seen':>6}{'Old':>5}{'Skip':>6}{'Fail':>6}  Status")
    for r in health:
        print(f"{r['source'][:29]:<30}{r['found']:>6}{r['added']:>5}{r['merged']:>7}{r['seen']:>6}"
              f"{r['old']:>5}{r['skipped']:>6}{r['failed']:>6}  {r['status']}")
    print(f"\nTotal: {totals['added']} new, {totals['merged']} merged as duplicates, {totals['seen']} already seen, "
          f"{totals['old']} too old, {totals['skipped']} not news, {totals['failed']} failed, {ai_calls} AI calls "
          f"({research_count} chain research)")
    print(f"Sources working: {ok_sources} of {len(health)}")
    if ai and ai.used:
        print("AI used: " + ", ".join(f"{k} x{v}" for k, v in ai.used.items()))
    print(f"AI pictures: {covers_note}")
    titles = [r["source"] for r in health if r["added"]]
    gh_note("Run summary", f"{totals['added']} new, {totals['merged']} merged, {totals['seen']} already seen, "
            f"{totals['old']} too old, {totals['skipped']} not news, {totals['failed']} failed | "
            f"{ai_calls} AI calls | sources {ok_sources}/{len(health)} | new from: {', '.join(titles) or 'none'} | "
            f"tip: {tip_note} | history: {history_note} | pictures: {covers_note[:160]} | stopped early: {stopped}")
    print(f"Tip card: {tip_note}")
    print(f"Phone alerts: {alerts_note}")
    print(f"Email: {email_note}")
    print()

    # a run is "broken" if no source worked, or most attempted stories failed
    attempted = totals["added"] + totals["merged"] + totals["skipped"] + totals["failed"]
    broken = ok_sources == 0 or (totals["failed"] >= 3 and totals["failed"] > attempted / 2)

    if db:
        db.table("pipeline_runs").insert({
            "started_at": started.isoformat(), "finished_at": datetime.now(timezone.utc).isoformat(),
            "added": totals["added"], "merged": totals["merged"], "skipped": totals["skipped"],
            "failed": totals["failed"], "ai_calls": ai_calls, "research": research_count, "sources_ok": ok_sources,
            "sources_total": len(health), "ok": not broken,
        }).execute()

    if broken:
        print("RUN LOOKS BROKEN: check the lines marked [fail] and the feed statuses above.")
        sys.exit(1)


def backfill_images():
    """Find images for stories already saved without one. Run: python pipeline.py --images"""
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    rows = db.table("stories").select("id,url,source").is_("image_url", "null").limit(200).execute().data
    print(f"\n=== Image backfill: {len(rows)} stories without an image ===\n")
    fixed = 0
    for r in rows:
        img = article_image(r["url"])
        if img:
            db.table("stories").update({"image_url": img}).eq("id", r["id"]).execute()
            fixed += 1
            print(f"[ok]   {r['source']}: {img[:80]}")
        else:
            print(f"[none] {r['source']}: {r['url'][:80]}")
    print(f"\nDone. Added images to {fixed} of {len(rows)} stories.\n")


def enrich_existing():
    """Add severity, why-it-matters and action to stories saved before they existed.
    Run: python pipeline.py --enrich   (uses 1 AI call per story, capped by MAX_AI_CALLS)"""
    from ai import AI
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ai = AI()
    rows = (db.table("stories").select("id,source,orig_title,technical")
            .is_("severity", "null").limit(MAX_AI_CALLS).execute().data)
    print(f"\n=== Enrich: {len(rows)} stories (max {MAX_AI_CALLS} AI calls) ===\n")
    for r in rows:
        try:
            s = summarise_ai(ai, r["orig_title"], r["technical"])
            db.table("stories").update({
                "why_it_matters": s["why"].strip() or None, "severity": s["severity"],
                "action": s["action"], "cves": find_cves(r["orig_title"]),
            }).eq("id", r["id"]).execute()
            print(f"[ok]   [{s['severity']}] {r['source']}: {s['why']}")
            time.sleep(0.3)
        except Exception as ex:
            print(f"[fail] {r['source']}: {ex}")
    print("\nDone.\n")


def backfill_cves():
    """Find CVE IDs in the article text for stories saved without any. No AI cost.
    Run: python pipeline.py --cves"""
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    rows = db.table("stories").select("id,url,source,orig_title").eq("cves", "{}").limit(200).execute().data
    print(f"\n=== CVE backfill: {len(rows)} stories to check ===\n")
    found = 0
    for r in rows:
        page, _ = fetch_article(r["url"])
        cves = find_cves(r["orig_title"], article_text(page, limit=20000))
        if cves:
            db.table("stories").update({"cves": cves}).eq("id", r["id"]).execute()
            found += 1
            print(f"[ok]   {r['source']}: {', '.join(cves)}")
        else:
            print(f"[none] {r['source']}: {r['orig_title'][:60]}")
    print(f"\nDone. {found} of {len(rows)} stories have CVE IDs.\n")


def backfill_chains():
    """Build attack chains, incident facts and group links for stories saved before these features.
    Uses 1 AI call per story, plus a web research call for serious incidents. Run: python pipeline.py --chains"""
    from ai import AI
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ai = AI()
    index = load_group_index(db)
    rows = (db.table("stories").select("id,url,source,orig_title,category,severity")
            .in_("category", ["Ransomware", "Breaches", "Vulnerabilities"])
            .is_("incident", "null").limit(MAX_AI_CALLS).execute().data)
    print(f"\n=== Attack chain check: {len(rows)} stories (max {MAX_AI_CALLS}, research max {RESEARCH_PER_RUN}) ===\n")
    researched = 0
    for r in rows:
        page, _ = fetch_article(r["url"])
        text = article_text(page)
        if not text:
            print(f"[skip] {r['source']}: article not readable")
            db.table("stories").update({"incident": {}}).eq("id", r["id"]).execute()
            continue
        try:
            s = summarise_ai(ai, r["orig_title"], text)
            s["category"], s["severity"] = r["category"], r["severity"]
            steps = []
            if ai.can_research and worth_researching(s) and researched < RESEARCH_PER_RUN:
                researched += 1
                try:
                    steps = research_chain(ai, r["orig_title"], text, s["incident"])
                except Exception as ex:
                    print(f"[warn] research failed: {ex}")
            chain = merge_chain(s["chain"], steps)
            incident = s["incident"] or {}
            if steps and chain:
                incident = dict(incident, researched=True, sources=sorted({x["source"] for x in chain if x.get("source") != "article"}))
            group = match_group(index, r["orig_title"], text)
            db.table("stories").update({"attack_chain": chain, "chain_checked": True, "incident": incident,
                                        "actor_group": group}).eq("id", r["id"]).execute()
            label = f"CHAIN {len(chain)}" if chain else "none   "
            print(f"[{label}] {r['source']}: {r['orig_title'][:55]}" + (f" | group {group}" if group else "")
                  + (f" | +{len(steps)} researched" if steps else ""))
            time.sleep(0.3)
        except Exception as ex:
            print(f"[fail] {r['source']}: {ex}")
    print("\nDone.\n")


SCENE_PROMPT = """Describe ONE simple visual scene (max 20 words) that illustrates this cyber security news headline as a picture.
Use objects only (servers, locks, phones, shields, buildings, laptops, data). No people, no brand names, no logos, no text.
Reply with ONLY JSON: {"scene": "..."}"""


def backfill_covers():
    """Give recent stories without a usable picture an AI picture. Run: python pipeline.py --covers"""
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ai = None
    if USE_AI:
        from ai import AI
        ai = AI()
    maker = CoverMaker(db)
    limit = int(os.getenv("COVERS_BACKFILL", "40"))
    rows = (db.table("stories").select("id,source,headline,category,image_url")
            .order("published_at", desc=True).limit(int(os.getenv("COVERS_CHECK", "150"))).execute().data)
    todo, reasons = [], {}
    for r in rows:
        if r["image_url"] and "/object/public/covers/" in r["image_url"]:
            continue    # already one of our AI pictures
        why = image_problem(r["image_url"])
        if why:
            todo.append(r)
            key = f"{r['source']}: {why}"
            reasons[key] = reasons.get(key, 0) + 1
    if reasons:
        print("\nPictures that won't show in the app:")
        for k, n in sorted(reasons.items(), key=lambda x: -x[1]):
            print(f"  {n:>3} x {k}")
    print(f"\n=== AI pictures: {len(todo)} of the latest {len(rows)} stories need one, making up to {limit} "
          f"({maker.describe()}) ===\n")
    made = 0
    for r in todo[:limit]:
        if not maker.available:
            print("No picture service left for today (limit reached or key problem). Stopping.")
            break
        scene = ""
        if ai:
            try:
                scene = ai.json(SCENE_PROMPT, f"Headline: {r['headline']}", 80).get("scene", "")
            except Exception:
                pass
        url = maker.make(r["id"], cover_prompt(scene, r["category"]))
        if url:
            db.table("stories").update({"image_url": url}).eq("id", r["id"]).execute()
            made += 1
            print(f"[pic]  {r['source']}: {r['headline'][:60]}")
        else:
            print(f"[fail] {r['source']}: {'; '.join(maker.errors[-2:])}")
    print(f"\nDone. Made {made} pictures. Used: {maker.used or 'nothing'}")
    if maker.errors:
        print("Problems seen: " + " | ".join(dict.fromkeys(maker.errors))[:400])
    print()


def dedupe_existing():
    """Merge duplicate cards already in the feed (last 4 days). The oldest card stays; later copies are removed
    and their links remembered, so they are never added again. Run: python pipeline.py --dedupe"""
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ai = None
    if USE_AI:
        from ai import AI
        ai = AI()
    since = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    rows = (db.table("stories").select("id,orig_title,technical,cves,source,url,also_reported,published_at,headline,image_url")
            .gte("published_at", since).order("published_at").execute().data)
    for r in rows:
        r["_words"] = words(f"{r['orig_title']} {(r.get('technical') or '')[:300]}")
    rare = rare_words(rows)
    kept, removed, calls = [], 0, 0
    print(f"\n=== Duplicate check: {len(rows)} stories from the last 4 days ===\n")
    for r in rows:
        match, similar = find_duplicate(r["orig_title"], r.get("technical") or "", r.get("cves") or [], kept, rare)
        if not match and similar and ai and calls < MAX_AI_CALLS:
            calls += 1
            try:
                match = same_event(ai, r["orig_title"], r.get("technical") or "", similar)
            except Exception as ex:
                print(f"[warn] AI check failed: {ex}")
        if not match:
            kept.append(r)
            continue
        also = match.get("also_reported") or []
        if match["source"] != r["source"] and all(a.get("source") != r["source"] for a in also):
            also = also + [{"source": r["source"], "url": r["url"]}]
        also += [a for a in (r.get("also_reported") or []) if all(b.get("url") != a.get("url") for b in also)]
        match["also_reported"] = also
        db.table("stories").update({"also_reported": also}).eq("id", match["id"]).execute()
        db.table("seen_links").upsert({"id": r["id"], "reason": "duplicate", "story_id": match["id"]}).execute()
        if r.get("image_url") and "/object/public/covers/" in r["image_url"]:
            try:   # its AI picture is no longer needed
                db.storage.from_("covers").remove([r["image_url"].split("/object/public/covers/", 1)[1].split("?")[0]])
            except Exception:
                pass
        db.table("stories").delete().eq("id", r["id"]).execute()
        removed += 1
        print(f"[merged] {r['source']}: {r['orig_title'][:60]}\n         -> kept: {match['source']}: {match['orig_title'][:60]}")
    print(f"\nDone. Removed {removed} duplicate cards ({calls} AI checks).\n")


def backfill_tags():
    """Tag recent stories with products and zero-days (no AI cost). Run: python pipeline.py --tag"""
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    rows = (db.table("stories").select("id,orig_title,headline,technical")
            .order("published_at", desc=True).limit(int(os.getenv("TAG_LIMIT", "500"))).execute().data)
    zero = tagged = 0
    for r in rows:
        prods = tag_products(r["orig_title"], r["headline"], r["technical"])
        z = is_zero_day(r["orig_title"], r["technical"])
        db.table("stories").update({"products": prods, "zero_day": z}).eq("id", r["id"]).execute()
        tagged += bool(prods)
        zero += z
        if prods or z:
            print(f"[tag] {r['headline'][:55]:<56} {', '.join(prods)[:60]}{'  ZERO-DAY' if z else ''}")
    print(f"\nDone. {tagged} of {len(rows)} stories name a product, {zero} are zero-days.\n")


def update_groups():
    """Refresh MITRE threat group profiles now. Run: python pipeline.py --groups"""
    from supabase import create_client
    refresh_groups(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]))



def check_tips():
    """Make sure every hand-written tip links to a page that still exists. Run: python pipeline.py --check-tips"""
    from tips import load_tips
    from history import load_history
    tips, bad = load_tips() + load_history(), 0
    print(f"\n=== Tip and history cards: {len(tips)} ===\n")
    for t in tips:
        for k in ("key", "headline", "technical", "why", "url"):
            if not t.get(k):
                print(f"  MISSING {k}: {t.get('key')}")
                bad += 1
    for url in sorted({t["url"] for t in tips}):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=20) as r:
                print(f"  OK     {r.status}  {url}")
        except Exception as ex:
            code = getattr(ex, "code", None)
            # some sites block automated checks (403/429) but work in a browser; only 404/410 mean the page is gone
            gone = code in (404, 410)
            bad += gone
            print(f"  {'GONE ' if gone else 'CHECK'}  {code or ''}  {url}  {'' if gone else '(blocked check, likely fine)'}")
    print(f"\n{'All tip links look fine.' if not bad else f'{bad} problem(s) to fix.'}\n")
    return bad


def try_daily():
    """Let the AI write one new tip and one new history card, without posting them, to check it works.
    Run: python pipeline.py --try-daily"""
    from supabase import create_client
    from ai import AI
    from tips import post_daily_tip
    from history import post_daily_history
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ai = AI()
    for name, func in (("Tip", post_daily_tip), ("History", post_daily_history)):
        story, note, calls, _ = func(db, ai, dry_run=True)
        print(f"\n=== {name} written by AI (not posted): {note} | {calls} AI calls ===")
        if story:
            for k in ("id", "headline", "technical", "why_it_matters", "url"):
                print(f"  {k}: {story[k]}")
        gh_note(f"{name} trial", f"{note} | {story['technical'] if story else ''} | {story['url'] if story else ''}")
    print()


def health_check():
    """Check every news source and the AI picture service, without changing anything.
    Run: python pipeline.py --health"""
    from concurrent.futures import ThreadPoolExecutor
    from supabase import create_client
    now = datetime.now(timezone.utc)
    print(f"\n=== News sources: reading all {len(SOURCES)} ===\n")
    with ThreadPoolExecutor(max_workers=16) as pool:
        res = {n: (f, e) for n, f, e in pool.map(read_feed, SOURCES)}
    slow = [s for s in SOURCES if res[s["name"]][1] or res[s["name"]][0] is None]
    if slow:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for n, f, e in pool.map(read_again, slow):
                res[n] = (f, e)
    ok, note_lines = 0, []
    for src in SOURCES:
        f, e = res[src["name"]]
        if e or f is None:
            print(f"  FAIL   {src['name'][:32]:<33} {str(e)[:70]}")
            note_lines.append(f"FAIL {src['name']}: {str(e)[:50]}")
            continue
        items = f.entries or []
        if not items:
            print(f"  EMPTY  {src['name'][:32]:<33} feed works but has no stories (address may have moved)")
            note_lines.append(f"EMPTY {src['name']}")
            continue
        ok += 1
        newest = max(published_of(x) for x in items)
        age = (now - newest).total_seconds() / 3600
        tag = "QUIET " if age > 24 * 7 else "OK    "
        extra = "  (2nd try)" if src in slow else ""
        print(f"  {tag} {src['name'][:32]:<33} {len(items):>3} stories, newest {age:.0f}h ago{extra}")
        note_lines.append(f"{src['name']}: newest {age:.0f}h ago")
    print(f"\n{ok} of {len(SOURCES)} sources working.  QUIET = nothing new for over a week.\n")
    gh_note("Source check", "\n".join(note_lines))

    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    maker = CoverMaker(db)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    print(f"=== AI pictures ({maker.describe()}) ===")
    print(f"  Made today so far: {covers_made_today(db, day_start)} (daily limit {COVERS_PER_DAY})")
    rows = (db.table("stories").select("image_url").gte("created_at", (now - timedelta(hours=24)).isoformat())
            .execute().data)
    missing = sum(1 for r in rows if not r["image_url"])
    print(f"  Stories in the last 24h: {len(rows)}, without any picture: {missing}")
    if "--no-picture" in sys.argv:
        print("  Test picture: skipped (--no-picture)\n")
        return
    jpg = maker.picture(cover_prompt("a glowing padlock over a city network at night, cyber security", "Tools"))
    if jpg:
        with open("test-cover.jpg", "wb") as fh:
            fh.write(jpg)
        print(f"  Test picture: OK via {', '.join(maker.used)}. Saved as test-cover.jpg in this folder (not uploaded).")
    else:
        print(f"  Test picture: FAILED. {' | '.join(maker.errors)[:300]}")
    print()

if __name__ == "__main__":
    if "--chains" in sys.argv:
        backfill_chains()
    elif "--groups" in sys.argv:
        update_groups()
    elif "--cves" in sys.argv:
        backfill_cves()
    elif "--health" in sys.argv:
        health_check()
    elif "--check-tips" in sys.argv:
        sys.exit(1 if check_tips() else 0)
    elif "--try-daily" in sys.argv:
        try_daily()
    elif "--test-alert" in sys.argv:
        from supabase import create_client
        from notify import test_alert
        test_alert(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]))
    elif "--test-email" in sys.argv:
        from supabase import create_client
        from mailer import run_email
        print("\nEmail: " + run_email(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]), force=True) + "\n")
    elif "--tag" in sys.argv:
        backfill_tags()
    elif "--dedupe" in sys.argv:
        dedupe_existing()
    elif "--covers" in sys.argv:
        backfill_covers()
    elif "--images" in sys.argv:
        backfill_images()
    elif "--enrich" in sys.argv:
        enrich_existing()
    else:
        main()
