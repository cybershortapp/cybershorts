"""Awareness games and trending decks (release 1.0.4).

Games: a 30 second game written from one story, only for stories where readers can do something
(scams, breaches, serious flaws in everyday apps). Six styles. A new question that is too close to one
used in the last 60 days is thrown away, so readers never get the same game twice.

Trending deck: once a day, if a threat group or a product is in several stories at once, a few
swipeable slides about it, written only from those stories (and the group's MITRE profile), each slide
with a picture from the news.
"""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

GAMES_PER_RUN = 1       # one at a time, so games keep coming all day for the newest stories
GAMES_PER_DAY = 12      # a pool to pick from; each phone shows at most 3 a day
SIMILAR = 0.72          # a new game this close to a recent one is a repeat
REPEAT_DAYS = 60

# everyday products people have on their own phones and computers: their Critical flaws get a quiz
CONSUMER = {
    "Google Chrome", "Chrome", "Windows", "Microsoft 365", "Microsoft Edge", "Firefox", "Safari", "iOS", "iPadOS",
    "macOS", "Android", "WhatsApp", "Telegram", "Signal", "Zoom", "Samsung", "Pixel", "Outlook", "Microsoft Office",
}

# official sites for "Which link is real?": the real answer always comes from this list, never from the AI
OFFICIAL = {
    "paypal": "www.paypal.com", "amazon": "www.amazon.co.uk", "hmrc": "www.gov.uk", "dvla": "www.gov.uk",
    "royal mail": "www.royalmail.com", "evri": "www.evri.com", "dpd": "www.dpd.co.uk", "microsoft": "login.microsoftonline.com",
    "outlook": "outlook.live.com", "apple": "www.apple.com", "icloud": "www.icloud.com", "google": "accounts.google.com",
    "gmail": "mail.google.com", "netflix": "www.netflix.com", "facebook": "www.facebook.com", "instagram": "www.instagram.com",
    "whatsapp": "www.whatsapp.com", "linkedin": "www.linkedin.com", "ebay": "www.ebay.co.uk", "booking.com": "www.booking.com",
    "barclays": "www.barclays.co.uk", "lloyds": "www.lloydsbank.com", "hsbc": "www.hsbc.co.uk", "natwest": "www.natwest.com",
    "santander": "www.santander.co.uk", "monzo": "monzo.com", "nhs": "www.nhs.uk", "tv licence": "www.tvlicensing.co.uk",
    "sbi": "onlinesbi.sbi", "state bank of india": "onlinesbi.sbi", "income tax": "www.incometax.gov.in",
    "india post": "www.indiapost.gov.in", "aadhaar": "uidai.gov.in", "uidai": "uidai.gov.in", "paytm": "paytm.com",
    "flipkart": "www.flipkart.com", "hdfc": "www.hdfcbank.com", "icici": "www.icicibank.com",
}

COMMON = """Rules:
- British English, short, friendly and a little funny, but every fact must be correct.
- Use only facts from the story below plus general safety advice that is always true. Never invent numbers,
  company statements or dates.
- No real phone numbers. Fake web addresses must look plausible but must not be the brand's real site
  (use typos, extra words or odd endings like .help .info .co, e.g. paypa1-secure.help).
- Any people need made-up, unusual names, never real people, and never Dave, David, John, Sarah or Mike.
- No em dashes. Reply with JSON only."""

PROMPTS = {
    "scam_or_legit": """Write a "Scam or legit?" game for readers of this cyber news story. Players drag each message
left (scam) or right (legit). Make 4 short messages people might really get that relate to the story: 3 scams
that copy the tricks in the story and 1 real, safe message (for example a check inside the real app).
JSON: {"items":[{"from":"sender name, max 24 chars","msg":"the message, max 140 chars","scam":true,
"why":"one sentence on the giveaway, max 110 chars"}]}""",
    "patch_or_panic": """Write a 3 question "Patch or panic" quiz for readers of this story about a serious flaw.
Each question has 3 short options and exactly one right answer about what an ordinary person should do or know.
JSON: {"questions":[{"q":"max 90 chars","options":["max 60 chars","...","..."],"answer":0,
"why":"one sentence, max 120 chars"}]}""",
    "red_flags": """Write a fake message for a "Spot the red flags" game, in the style of the scam in this story.
Split it into 6 to 7 short lines (sender line, subject, greeting, body lines, a button or link). Exactly 4 lines
are red flags (odd sender, rush or threat, no name, fake link, odd request). Give each red flag a one sentence
explanation.
JSON: {"lines":[{"text":"max 90 chars","flag":true,"why":"max 110 chars"}]}""",
    "real_link": """Write fake web addresses for a "Which link is real?" game about the brand in this story.
Give 2 fake addresses that copy the brand in different ways (a letter swap like rn for m or 0 for o, the brand name
as a sub-part of another site, wrong ending). Mark the part that gives it away.
JSON: {"ask":"one line question, max 70 chars, e.g. Your parcel. Which link is really Royal Mail?",
"fakes":[{"url":"address without https://","odd":"the exact part of the address that gives it away",
"why":"max 100 chars"}]}""",
    "order_steps": """Write a "What do you do first?" game for readers who may be caught up in this data breach.
Give the 4 most useful steps in the right order, each max 60 chars, and one sentence on why the first step comes first.
JSON: {"ask":"max 90 chars, e.g. Your email and password were in this breach. Tap the steps in order.",
"steps":["first","second","third","fourth"],"why":"max 120 chars"}""",
    "hot_seat": """Write a "Help desk hot seat" game for this story about tricking staff. The player works on a company
IT help desk. An attacker phones pretending to be a colleague, using the same trick as the story. Write 3 rounds;
in each the caller says something (more pushy each round) and the player has 3 replies:
one "good" (refuses and checks safely, e.g. calls back on the number on file, or checks with a manager in the
ticket system), one "bad" (gives in: resets the password, adds a new phone, reads out a code), and one "weak"
(a check attackers can pass, like asking for a date of birth or the manager's name) with the caller's quick
"reply" that passes it.
JSON: {"caller":{"name":"made-up first and last name","role":"their team, max 20 chars"},
"rounds":[{"say":"max 150 chars","options":[{"t":"max 80 chars","kind":"good"},{"t":"max 80 chars","kind":"bad"},
{"t":"max 80 chars","kind":"weak","reply":"max 70 chars"}]}],
"win":"one sentence when the player keeps the caller out, max 110 chars",
"lose":"one sentence on what the attackers did next, from the story, max 120 chars"}""",
    "approve": """Write a "Don't tap Approve" game for this story about stolen passwords or sign-in prompts. The
player's phone is flooded with sign-in approval requests from attackers who have their password. Write 3 ordinary,
harmless notifications that arrive in between (a message from family or a friend, a small card payment, a calendar
reminder; one may mention the odd login alerts), the place the sign-in requests come from, and the final call from
someone pretending to be IT who asks the player to approve one more prompt.
JSON: {"place":"city, country, max 24 chars","real":[{"app":"MESSAGES, BANK, CALENDAR or EMAIL","title":"max 24 chars",
"body":"max 60 chars"}],"call":{"name":"who they claim to be, max 24 chars","say":"max 170 chars"}}""",
    "home": """Write a "Lock up your digital home" game inspired by this story. A burglar tries 5 ways into someone's
digital life, each in one line in his voice, and the story's trick must be one of them. Each try has a spot and a
kind. Spots: email, bank, router, phone, social (each once). Kinds: "reused" (a password leaked from another site),
"stolen" (they already have the password: tricked, phished or bought), "old_bug" (an old unpatched bug), "default"
(the password printed on the device). Router must be default or old_bug; phone must be old_bug or stolen; email,
bank and social must be reused or stolen.
JSON: {"rounds":[{"spot":"email","kind":"reused","say":"the burglar's line, max 110 chars",
"fail":"what happens if he is not stopped, max 80 chars"}]}""",
    "overshare": """Write an "Overshare detective" game inspired by this story. Make up a person, their social media
handle, a made-up employer and job. Write a short bio that overshares one thing, and 7 posts: 5 overshare something a
scammer could use (birthday, pet's name, mother's maiden name, holiday dates, work badge or staff number, first car,
school, home street) and 2 are harmless. Pick overshares that fit the story's scam. Use no real people or companies.
JSON: {"name":"...","handle":"@...","job":"job at company, max 40 chars",
"bio":{"text":"max 90 chars","what":"the overshare, max 24 chars","why":"how a scammer uses it, max 100 chars"},
"posts":[{"emoji":"one or two emoji","caption":"max 60 chars","risky":true,"what":"max 24 chars","why":"max 100 chars"},
{"emoji":"..","caption":"..","risky":false}]}""",
}

# names the AI likes too much (and that readers asked us not to use)
BANNED_NAMES = {"dave", "david", "john", "sarah", "mike", "michael", "wilson", "smith", "jane", "doe"}
HOME_KINDS = {"router": {"default", "old_bug"}, "phone": {"old_bug", "stolen"}, "email": {"reused", "stolen"},
              "bank": {"reused", "stolen"}, "social": {"reused", "stolen"}}

WORDS = ["Teapot", "Purple", "Rocket", "Pickle", "Lantern", "Otter", "Glacier", "Biscuit", "Cactus", "Marble",
         "Puffin", "Thunder", "Waffle", "Comet", "Saffron", "Ladder", "Kettle", "Mango", "Falcon", "Velvet", "42", "77"]


def _norm(text):
    return re.sub(r"[^a-z0-9 ]", "", (text or "").lower()).strip()


def _core(style, data):
    """The words that make one game what it is, for spotting repeats."""
    if style == "scam_or_legit":
        return " | ".join(i["msg"] for i in data["items"])
    if style == "patch_or_panic":
        return " | ".join(q["q"] for q in data["questions"])
    if style == "red_flags":
        return " | ".join(l["text"] for l in data["lines"])
    if style == "real_link":
        return data["ask"] + " | " + " | ".join(f["url"] for f in data["options"])
    if style == "order_steps":
        return " | ".join(data["steps"])
    if style == "hot_seat":
        return " | ".join(r["say"] for r in data["rounds"])
    if style == "approve":
        return data["call"]["say"] + " | " + " | ".join(r["title"] for r in data["real"])
    if style == "home":
        return " | ".join(r["say"] for r in data["rounds"])
    if style == "overshare":
        return data["bio"]["text"] + " | " + " | ".join(p["caption"] for p in data["posts"])
    return style


def _short(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip().replace("—", "-").replace("–", "-")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _brand(text):
    t = text.lower()
    for name, site in OFFICIAL.items():
        if re.search(rf"\b{re.escape(name)}\b", t):
            return name, site
    return None, None


HOT_SEAT = re.compile(r"\b(help ?desk|vishing|voice phishing|social engineer\w*|scattered spider|posing as (an? )?(employee|staff|worker|it)|"
                      r"impersonat\w* (it|staff|employees?|support|the help ?desk)|fake it support|called (staff|employees))\b")
APPROVE = re.compile(r"\b(mfa fatigue|push (bombing|spam)|prompt bombing|approval prompts?|mfa bypass|bypass\w* (mfa|2fa|two.factor|multi.factor)|"
                     r"session (hijack\w*|cookies?|tokens?)|account takeovers?|credential stuffing|infostealers?)\b")
OVERSHARE = re.compile(r"\b(romance scams?|pig.butchering|catfish\w*|ceo fraud|business email compromise|fake boss|identity theft|doxx\w*|"
                       r"osint|investment scams?|crypto scams?|social media scams?)\b")
HOME = re.compile(r"\b(routers?|smart (home|tv|camera|doorbell|plug)s?|iot|baby monitors?|default passwords?|home wi.?fi)\b")


def style_for(story, recent_styles):
    """Which game fits this story (None = no game)."""
    text = f"{story['headline']} {story['technical']}".lower()
    cat = story.get("category") or ""
    if cat in ("Tips", "History", "Other") or story.get("source", "").startswith("CyberSid"):
        return None
    turn = lambda options: sorted(options, key=lambda s: recent_styles.count(s))[0]   # take turns
    if HOT_SEAT.search(text):
        return "hot_seat"
    if APPROVE.search(text):
        return "approve"
    if OVERSHARE.search(text):
        return turn(["overshare", "scam_or_legit"])
    scammy = cat == "Scams" or re.search(r"\b(phish\w*|smish\w*|scam\w*|fake (text|email|message|website)s?)\b", text)
    if scammy:
        options = ["scam_or_legit", "red_flags"] + (["real_link"] if _brand(text)[0] else [])
        # take turns with the styles used most recently
        options.sort(key=lambda s: recent_styles.count(s))
        return options[0]
    if cat == "Breaches":
        if re.search(r"\bpasswords?\b", text) and "crack_meter" not in recent_styles[:6]:
            return "crack_meter"
        return turn(["order_steps", "home"])
    serious = story.get("zero_day") or story.get("severity") == "Critical"
    if serious and set(story.get("products") or []) & CONSUMER:
        return turn(["patch_or_panic", "home"])
    if HOME.search(text):
        return "home"
    return None


def _check(style, d, story):
    """Tidy the AI's answer into the exact shape the app draws, or None if it isn't usable."""
    if style == "scam_or_legit":
        items = [{"from": _short(i["from"], 24), "msg": _short(i["msg"], 150), "scam": bool(i["scam"]), "why": _short(i["why"], 120)}
                 for i in d.get("items", []) if i.get("msg") and i.get("from") and i.get("why")][:4]
        if len(items) < 3 or all(i["scam"] for i in items) or not any(i["scam"] for i in items):
            return None
        return {"items": items}
    if style == "patch_or_panic":
        qs = []
        for q in d.get("questions", [])[:3]:
            opts = [_short(o, 64) for o in q.get("options", [])][:3]
            a = q.get("answer")
            if q.get("q") and len(opts) == 3 and isinstance(a, int) and 0 <= a < 3 and q.get("why"):
                qs.append({"q": _short(q["q"], 100), "options": opts, "answer": a, "why": _short(q["why"], 130)})
        return {"questions": qs} if len(qs) == 3 else None
    if style == "red_flags":
        lines = [{"text": _short(l["text"], 100), "flag": bool(l.get("flag")), "why": _short(l.get("why", ""), 120)}
                 for l in d.get("lines", []) if l.get("text")][:7]
        flags = [l for l in lines if l["flag"] and l["why"]]
        return {"lines": lines} if len(lines) >= 5 and len(flags) == 4 else None
    if style == "real_link":
        name, site = _brand(f"{story['headline']} {story['technical']}")
        fakes = []
        for f in d.get("fakes", [])[:2]:
            url = re.sub(r"^https?://", "", str(f.get("url", ""))).strip().strip("/")
            odd = str(f.get("odd", "")).strip()
            # a fake must not be the real site, and the giveaway must really be in it
            if url and odd and odd in url and site not in url.split("/")[0] and f.get("why"):
                fakes.append({"url": url[:60], "odd": odd, "why": _short(f["why"], 110)})
        if len(fakes) != 2 or not d.get("ask"):
            return None
        real = {"url": site + "/", "odd": "", "why": f"The real one. The site is {site}."}
        h = int(hashlib.sha1(story["id"].encode()).hexdigest(), 16)
        options = fakes[:]
        options.insert(h % 3, real)
        return {"ask": _short(d["ask"], 80), "options": options, "answer": options.index(real)}
    h = int(hashlib.sha1(story["id"].encode()).hexdigest(), 16)   # a fixed shuffle per story
    if style == "hot_seat":
        c = d.get("caller") or {}
        name = _short(c.get("name"), 30)
        if not name or set(re.findall(r"[a-z]+", name.lower())) & BANNED_NAMES or not c.get("role"):
            return None
        rounds = []
        for k, r in enumerate((d.get("rounds") or [])[:3]):
            opts = [{"t": _short(o.get("t"), 86), "kind": o.get("kind"), **({"reply": _short(o.get("reply"), 76)} if o.get("kind") == "weak" else {})}
                    for o in (r.get("options") or []) if isinstance(o, dict) and o.get("t")]
            if not r.get("say") or len(opts) != 3 or sorted(o["kind"] for o in opts) != ["bad", "good", "weak"] or not next(o for o in opts if o["kind"] == "weak").get("reply"):
                return None
            rot = (h >> (k * 3)) % 3                 # the right answer isn't always in the same place
            rounds.append({"say": _short(r["say"], 160), "options": opts[rot:] + opts[:rot]})
        if len(rounds) != 3 or not d.get("win") or not d.get("lose"):
            return None
        return {"caller": {"name": name, "role": _short(c["role"], 22)}, "rounds": rounds, "win": _short(d["win"], 120), "lose": _short(d["lose"], 130)}
    if style == "approve":
        real = [{"app": str(r.get("app", "")).upper(), "title": _short(r.get("title"), 26), "body": _short(r.get("body"), 64)}
                for r in (d.get("real") or []) if isinstance(r, dict) and r.get("title") and r.get("body")][:3]
        real = [r for r in real if r["app"] in ("MESSAGES", "BANK", "CALENDAR", "EMAIL")]
        call = d.get("call") or {}
        if len(real) != 3 or not call.get("name") or not call.get("say") or not d.get("place"):
            return None
        return {"place": _short(d["place"], 26), "real": real, "call": {"name": _short(call["name"], 26), "say": _short(call["say"], 180)}}
    if style == "home":
        rounds = [{"spot": r.get("spot"), "kind": r.get("kind"), "say": _short(r.get("say"), 120), "fail": _short(r.get("fail"), 90)}
                  for r in (d.get("rounds") or []) if isinstance(r, dict)]
        ok = [r for r in rounds if r["spot"] in HOME_KINDS and r["kind"] in HOME_KINDS[r["spot"]] and r["say"] and r["fail"]]
        if len(ok) != 5 or len({r["spot"] for r in ok}) != 5:
            return None
        return {"rounds": ok}
    if style == "overshare":
        bio = d.get("bio") or {}
        name = _short(d.get("name"), 30)
        posts = [{"emoji": _short(p.get("emoji"), 6) or "📷", "caption": _short(p.get("caption"), 66), "risky": bool(p.get("risky")),
                  **({"what": _short(p.get("what"), 28), "why": _short(p.get("why"), 110)} if p.get("risky") else {})}
                 for p in (d.get("posts") or []) if isinstance(p, dict) and p.get("caption")][:7]
        risky = [p for p in posts if p["risky"]]
        if (not name or set(re.findall(r"[a-z]+", name.lower())) & BANNED_NAMES or not bio.get("text") or not bio.get("what") or not bio.get("why")
                or len(posts) != 7 or len(risky) != 5 or any(not p["what"] or not p["why"] for p in risky)):
            return None
        rot = h % 7
        return {"name": name, "handle": _short(d.get("handle") or "@" + name.lower().replace(" ", "."), 30), "job": _short(d.get("job"), 44),
                "bio": {"text": _short(bio["text"], 96), "what": _short(bio["what"], 28), "why": _short(bio["why"], 110)},
                "posts": posts[rot:] + posts[:rot]}
    if style == "order_steps":
        steps = [_short(s, 64) for s in d.get("steps", [])][:4]
        return {"ask": _short(d.get("ask", ""), 100), "steps": steps, "why": _short(d.get("why", ""), 130)} \
            if len(steps) == 4 and d.get("ask") else None
    return None


LIST_KEY = {"scam_or_legit": "items", "patch_or_panic": "questions", "red_flags": "lines", "real_link": "fakes", "order_steps": "steps",
            "hot_seat": "rounds", "approve": "real", "home": "rounds", "overshare": "posts"}


def _as_dict(raw, key):
    """Some AI models reply with just the list; put it where we expect it."""
    if isinstance(raw, list):
        if len(raw) == 1 and isinstance(raw[0], dict) and key in raw[0]:
            return raw[0]
        return {key: raw}
    return raw if isinstance(raw, dict) else {}


def make_games(db, ai, budget, deadline):
    """Write games for recent stories that fit one. Returns (note, ai_calls)."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    made_today = len(db.table("games").select("id").gte("created_at", day_start).execute().data)
    # spread over the day (UK news arrives 6am to 11pm): by each hour, only that hour's share of the daily total
    allowed_by_now = min(GAMES_PER_DAY, 1 + (GAMES_PER_DAY * (now.hour + 1)) // 24)
    room = min(GAMES_PER_RUN, allowed_by_now - made_today, budget)
    if room <= 0:
        why = (f"{made_today} made today" if made_today >= GAMES_PER_DAY else
               f"{made_today} made so far today, next one later" if made_today >= allowed_by_now else
               f"no AI left this run (budget {budget})")
        return f"none due ({why})", 0
    recent = (db.table("games").select("story_id,style,data,fingerprint").gte("created_at", (now - timedelta(days=REPEAT_DAYS)).isoformat())
              .order("created_at", desc=True).limit(400).execute().data)
    have = {g["story_id"] for g in recent}
    recent_styles = [g["style"] for g in recent]
    recent_cores = [_norm(_core(g["style"], g["data"])) for g in recent if g["style"] != "crack_meter"]
    stories = (db.table("stories").select("id,source,headline,technical,category,severity,zero_day,products")
               .gte("created_at", (now - timedelta(hours=36)).isoformat()).order("created_at", desc=True).limit(80).execute().data)
    made, calls, skipped = [], 0, 0
    for st in stories:
        if len(made) >= room or datetime.now(timezone.utc) > deadline or calls >= budget:
            break
        if st["id"] in have:
            continue
        style = style_for(st, recent_styles)
        if not style:
            continue
        if style == "crack_meter":
            h = int(hashlib.sha1(st["id"].encode()).hexdigest(), 16)
            pool = WORDS[:]
            words = [pool.pop((h >> (i * 5)) % len(pool)) for i in range(8)]
            data = {"words": words}
        else:
            name, site = _brand(f"{st['headline']} {st['technical']}")
            brand_note = f"\nBrand: {name} (real site {site})" if style == "real_link" else ""
            try:
                calls += 1
                raw = ai.json(PROMPTS[style] + "\n\n" + COMMON,
                              f"Story headline: {st['headline']}\nStory: {st['technical'][:1400]}{brand_note}",
                              1500 if style in ("hot_seat", "approve", "home", "overshare") else 700)
            except Exception as ex:
                print(f"[warn] game for {st['id'][:10]}: {str(ex)[:80]}")
                continue
            try:
                data = _check(style, _as_dict(raw, LIST_KEY[style]), st)
            except Exception as ex:
                print(f"[warn] game answer for {st['id'][:10]} unusable: {str(ex)[:60]}")
                data = None
            if not data:
                skipped += 1
                continue
            core = _norm(_core(style, data))
            if any(SequenceMatcher(None, core, c).ratio() > SIMILAR for c in recent_cores):
                skipped += 1
                print(f"[game] skipped a repeat for: {st['headline'][:60]}")
                continue
            recent_cores.append(core)
        fp = hashlib.sha1(_norm(_core(style, data) + st["id"]).encode()).hexdigest()
        db.table("games").upsert({"id": fp[:20], "story_id": st["id"], "style": style, "data": data, "fingerprint": fp}).execute()
        recent_styles.insert(0, style)
        have.add(st["id"])
        made.append(style)
        print(f"[game] {style}: {st['headline'][:70]}")
    note = f"{len(made)} made ({', '.join(made)})" if made else "none due"
    if skipped:
        note += f", {skipped} skipped (repeat or unusable)"
    return note, calls


# ---------------------------------------------------------------------------------------------------
DECK_PROMPT = """Write a trending deck: 6 swipeable slides that explain a cyber security topic that is in the news
right now, for ordinary readers. Use ONLY the facts in the stories and profile below (plus safety advice that is
always true). Never invent numbers, victims, dates or quotes. British English. No em dashes.
Slides in this order:
1 cover: a punchy title (the group or topic name) and one line on why everyone is talking about it
2 who or what it is
3 how they get in or how it works
4 what happened recently (from the stories, name the victims the stories name)
5 how to stay safe (3 short points)
6 your takeaway (one strong line people remember)
Each slide also has:
- "when": a short time label for a timeline, like a year the stories give, "This week", "Today" or "Now".
  Empty if the stories give no time. Never guess a year.
- "say": two comic speech bubbles telling that slide's part as a tiny scene, max 70 chars each. Bubble 1 is the
  attacker, a victim or the situation talking; bubble 2 is an ordinary person reacting or learning. Plain and fun.
JSON: {"slides":[{"kicker":"max 24 chars, capitals","title":"max 60 chars","text":"max 170 chars or empty",
"points":["max 80 chars each, 0 to 4 of them"],"when":"max 12 chars or empty","say":["bubble 1","bubble 2"]}]}"""

# the look of each new deck: hacker groups take turns between these, products between those
GROUP_LOOKS = ["wanted", "case", "comic", "timeline"]
PRODUCT_LOOKS = ["timeline", "case", "comic"]


def make_trending(db, ai, budget, deadline):
    """At most one new deck a day, about a group or product in several stories. Returns (note, ai_calls)."""
    now = datetime.now(timezone.utc)
    if budget < 1 or datetime.now(timezone.utc) > deadline:
        return "skipped (no AI left)", 0
    if db.table("decks").select("id").gte("created_at", (now - timedelta(hours=20)).isoformat()).execute().data:
        return "none due (one a day)", 0
    recent_topics = {d["topic"] for d in db.table("decks").select("topic").gte("created_at", (now - timedelta(days=7)).isoformat()).execute().data}
    rows = (db.table("stories").select("id,headline,technical,actor_group,products,image_url,country,source,category")
            .gte("created_at", (now - timedelta(hours=48)).isoformat()).order("created_at", desc=True).limit(150).execute().data)
    rows = [r for r in rows if not (r.get("source") or "").startswith("CyberSid")]
    from tags import PRODUCTS
    known = {p["name"] for p in PRODUCTS}   # only real products from our list, never vendors or loose AI words
    by_group, by_product = {}, {}
    for r in rows:
        if r.get("actor_group"):
            by_group.setdefault(r["actor_group"], []).append(r)
        for p in set(r.get("products") or []) & known:
            by_product.setdefault(p, []).append(r)
    topic, kind, picked = None, None, []
    for gid, items in sorted(by_group.items(), key=lambda x: -len(x[1])):
        if len(items) >= 2 and gid not in recent_topics:
            topic, kind, picked = gid, "group", items
            break
    if not topic:
        for p, items in sorted(by_product.items(), key=lambda x: -len(x[1])):
            if len(items) >= 3 and p not in recent_topics:
                topic, kind, picked = p, "product", items
                break
    if not topic:
        return "none due (nothing trending)", 0
    picked = picked[:6]
    name, profile = topic, ""
    if kind == "group":
        g = db.table("threat_groups").select("name,aliases,summary,methods,campaigns").eq("id", topic).limit(1).execute().data
        if g:
            g = g[0]
            name = g["name"]
            profile = (f"\nGroup profile (MITRE ATT&CK): {g['name']}, also called {', '.join((g.get('aliases') or [])[:4])}. "
                       f"{(g.get('summary') or '')[:700]}\nKnown methods: {', '.join((g.get('methods') or [])[:8])}")
    listing = "\n".join(f"- {r['headline']}: {r['technical'][:500]}" for r in picked)
    try:
        raw = ai.json(DECK_PROMPT, f"Topic: {name}{profile}\n\nStories:\n{listing}", 2200)
    except Exception as ex:
        return f"problem: {str(ex)[:80]}", 1
    raw = _as_dict(raw, "slides")
    slides = []
    for s in [x for x in raw.get("slides", []) if isinstance(x, dict)][:6]:
        title = _short(s.get("title"), 70)
        if not title:
            continue
        say = [_short(x, 80) for x in (s.get("say") or []) if isinstance(x, str) and x.strip()][:2]
        slides.append({"kicker": _short(s.get("kicker"), 28).upper(), "title": title, "text": _short(s.get("text"), 190),
                       "points": [_short(p, 90) for p in (s.get("points") or [])[:4] if p],
                       "when": _short(s.get("when"), 14).upper(), "say": say if len(say) == 2 else []})
    if len(slides) < 5:
        return "skipped (AI reply unusable)", 1
    pics = [r["image_url"] for r in picked if r.get("image_url")]
    for i, s in enumerate(slides):
        s["image"] = pics[i % len(pics)] if pics else None
    # the app reads the look from the first slide (no database change needed); older apps just ignore it
    looks = GROUP_LOOKS if kind == "group" else PRODUCT_LOOKS
    look = looks[now.date().toordinal() % len(looks)]
    if look == "comic" and sum(1 for s in slides if s["say"]) < len(slides) - 1:
        look = "case"   # a comic needs its speech bubbles
    slides[0]["style"] = look
    countries = {r.get("country") or "INTL" for r in picked}
    deck = {
        "id": hashlib.sha1(f"{topic}|{now.date()}".encode()).hexdigest()[:20],
        "topic": topic, "title": _short(slides[0]["title"] or name, 60), "slides": slides,
        "story_ids": [r["id"] for r in picked],
        "country": countries.pop() if len(countries) == 1 else "INTL",
        "expires_at": (now + timedelta(days=3)).isoformat(),
    }
    db.table("decks").upsert(deck).execute()
    print(f"[deck] {name}: {len(slides)} slides from {len(picked)} stories, look: {look}")
    return f"new deck: {name}", 1


if __name__ == "__main__":
    # quick offline check of the game picker and the answer checks (no database, no AI)
    s = {"id": "x1", "source": "BBC", "headline": "Fake Royal Mail texts ask for a redelivery fee",
         "technical": "Scam texts pretending to be Royal Mail ask people to pay a small fee.", "category": "Scams",
         "severity": "High", "zero_day": False, "products": []}
    print(style_for(s, []), style_for(s, ["scam_or_legit"]), style_for(s, ["scam_or_legit", "red_flags"]))
    d = {"ask": "Your parcel. Which link is really Royal Mail?",
         "fakes": [{"url": "royalmail-redelivery.info/pay", "odd": "-redelivery.info", "why": "Not royalmail.com."},
                   {"url": "r0yalmail.com/fee", "odd": "0", "why": "A zero instead of an o."}]}
    print(json.dumps(_check("real_link", d, s)))
