"""
Email: confirmation emails for new subscribers, and one morning digest a day (about 08:00 UK time).

Sent from the app Gmail with an "app password" (free, up to about 500 emails a day). Needs SMTP_USER and SMTP_PASS.
Every email has an unsubscribe link, and nothing is sent until the person confirms their address (UK/EU rules).
"""
import html, os, smtplib, ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr
from zoneinfo import ZoneInfo

from tags import matches

SITE = os.getenv("SITE_URL", "https://cybershortapp.github.io/cybershorts").rstrip("/")
DIGEST_HOUR = int(os.getenv("DIGEST_HOUR", "8"))
DAILY_MAX = int(os.getenv("EMAIL_DAILY_MAX", "400"))
RANK = {"Critical": 4, "High": 3, "Medium": 2, "Info": 1}


class Mailer:
    def __init__(self):
        self.user = os.getenv("SMTP_USER", "").strip()
        self.password = os.getenv("SMTP_PASS", "").replace(" ", "").strip()
        self.server = None

    @property
    def ready(self):
        return bool(self.user and self.password)

    def send(self, to, subject, text, html_body, unsubscribe=None):
        try:
            if self.server is None:
                self.server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30)
                self.server.login(self.user, self.password)
            self._send(to, subject, text, html_body, unsubscribe)
        except Exception:
            # a dropped connection is not reused: the next email starts a new one (on 13 Oct 2026 one failure made
            # every later email fail with "please run connect() first")
            self.close()
            raise

    def _send(self, to, subject, text, html_body, unsubscribe=None):
        msg = EmailMessage()
        msg["From"] = formataddr(("CyberSid", self.user))
        msg["To"] = to
        msg["Subject"] = subject
        if unsubscribe:
            msg["List-Unsubscribe"] = f"<{unsubscribe}>"
        msg.set_content(text)
        msg.add_alternative(html_body, subtype="html")
        self.server.send_message(msg)

    def close(self):
        if self.server:
            try:
                self.server.quit()
            except Exception:
                pass
        self.server = None


PLAY = "https://play.google.com/store/apps/details?id=app.cybersid.news"
FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
# light badge colours for each severity: (background, text)
SEV_BADGE = {"Critical": ("#FDE7E7", "#C62F2E"), "High": ("#FFF1DC", "#B4660A"), "Medium": ("#EFE8FF", "#6A3FE0"),
             "Info": ("#EEF1F6", "#5B6478")}


def _page(inner, unsub=None, subtitle="", summary=""):
    """The email frame: colourful header, the content, a button to open the app, and the footer.
    Built from tables with inline styles so it looks the same in Gmail, Outlook and phone mail apps."""
    box = (f'<div style="margin-top:16px;background:rgba(255,255,255,.16);border-radius:12px;padding:12px 14px;'
           f'color:#FFFFFF;font-size:14px;line-height:20px">{summary}</div>') if summary else ""
    foot = ('You get this because you subscribed in the CyberSid app.<br>'
            f'<a href="{unsub}" style="color:#7A8197">Unsubscribe</a> &middot; ') if unsub else ""
    return f'''<!doctype html><html><body style="margin:0;padding:0;background:#F2F4FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4FA"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:{FONT}">
<tr><td style="background-color:#2563F5;background-image:linear-gradient(135deg,#2563F5 0%,#7C3AED 55%,#EC4899 100%);border-radius:20px;padding:26px 24px">
<div style="font-size:26px;font-weight:900;color:#FFFFFF;letter-spacing:-.5px">CyberSid</div>
<div style="font-size:14px;color:#E6ECFF;margin-top:2px">{subtitle}</div>{box}
</td></tr>
<tr><td style="height:18px;line-height:18px">&nbsp;</td></tr>
{inner}
<tr><td style="padding:6px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0F1F;border-radius:16px"><tr><td style="padding:20px 22px">
<div style="color:#FFFFFF;font-size:16px;font-weight:800">See the attack chain and play the 30-second game</div>
<div style="color:#AEB6CC;font-size:13px;line-height:19px;margin:4px 0 14px">Every story in the app shows how the attack happened, step by step.</div>
<a href="{PLAY}" style="background:#FFFFFF;color:#0A0F1F;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:800;text-decoration:none;display:inline-block">Open CyberSid</a>
</td></tr></table></td></tr>
<tr><td style="padding:18px 6px;font-size:12px;line-height:18px;color:#7A8197;text-align:center">
{foot}<a href="{SITE}/" style="color:#7A8197">CyberSid website</a></td></tr>
</table></td></tr></table></body></html>'''


def _section(title, icon, inner):
    return (f'<tr><td style="padding:10px 4px;font-size:13px;font-weight:800;letter-spacing:1px;color:#5B6478">'
            f'{icon} {title}</td></tr>{inner}')


def _panel(inner):
    """A white rounded box in the email body."""
    return (f'<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:#FFFFFF;border-radius:16px;border:1px solid #E6E9F2"><tr><td style="padding:18px 20px">'
            f'{inner}</td></tr></table></td></tr>')


def send_confirmations(db, mailer, limit=20):
    rows = (db.table("subscribers").select("email,token").eq("confirmed", False).is_("confirm_sent_at", "null")
            .limit(limit).execute().data)
    sent = 0
    for r in rows:
        link = f"{SITE}/confirm.html?t={r['token']}"
        text = f"Please confirm you want CyberSid news by email:\n{link}\n\nIf this wasn't you, ignore this email and nothing will be sent."
        body = _page(_panel(
            '<div style="font-size:18px;font-weight:800;color:#0A0F1F">One tap to confirm</div>'
            '<div style="font-size:14px;line-height:21px;color:#3A4256;margin:6px 0 16px">Please confirm you want the '
            'CyberSid daily digest by email: the top cyber stories and the ones about your products, every morning.</div>'
            f'<a href="{link}" style="background:#2563F5;color:#FFFFFF;padding:11px 18px;border-radius:10px;font-size:14px;'
            'font-weight:800;text-decoration:none;display:inline-block">Confirm my email</a>'
            '<div style="color:#7A8197;font-size:13px;margin-top:14px">If this wasn\'t you, ignore this email and nothing '
            'will be sent.</div>'), subtitle="Confirm your daily cyber briefing")
        try:
            mailer.send(r["email"], "Confirm your CyberSid email digest", text, body)
            sent += 1
        except Exception as ex:
            print(f"[warn] confirmation email failed: {str(ex)[:80]}")
        # marked either way, so a bad address is never retried again and again
        db.table("subscribers").update({"confirm_sent_at": datetime.now(timezone.utc).isoformat()}).eq("email", r["email"]).execute()
    return sent


def _digest_for(sub, stories):
    mine = [s for s in stories if matches(s, sub.get("products"), sub.get("terms"))]
    top = [s for s in stories if RANK.get(s.get("severity") or "Info", 1) >= 3 and s not in mine]
    top.sort(key=lambda s: -RANK.get(s.get("severity") or "Info", 1))
    return mine[:8], top[:5]


def _item(s, hit=None):
    sev = s.get("severity") or "Info"
    bg, fg = SEV_BADGE.get(sev, SEV_BADGE["Info"])
    badge = (f'<span style="background:{bg};color:{fg};border-radius:20px;padding:3px 10px;font-size:11px;'
             f'font-weight:800;letter-spacing:.4px">{html.escape(sev.upper())}</span>')
    if hit:
        badge += (f' <span style="background:#E6F0FF;color:#1D4ED8;border-radius:20px;padding:3px 10px;font-size:11px;'
                  f'font-weight:700">For you: {html.escape(hit)}</span>')
    why = (f'<div style="font-size:14px;line-height:21px;color:#3A4256"><b style="color:#0A0F1F">Why it matters:</b> '
           f'{html.escape(s["why_it_matters"])}</div>') if s.get("why_it_matters") else ""
    url = html.escape(s["url"])
    return _panel(
        f'{badge}<div style="font-size:18px;line-height:24px;font-weight:800;margin:10px 0 6px">'
        f'<a href="{url}" style="color:#0A0F1F;text-decoration:none">{html.escape(s["headline"])}</a></div>{why}'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>'
        f'<td style="font-size:12px;color:#7A8197">{html.escape(s["source"])}</td>'
        f'<td align="right"><a href="{url}" style="color:#2563F5;font-size:13px;font-weight:700;text-decoration:none">'
        f'Read the story &rarr;</a></td></tr></table>')


def _summary(mine, top):
    """'1 story for your products, 1 critical, 2 high' for the header."""
    parts = [f"{len(mine)} {'story' if len(mine) == 1 else 'stories'} for your products"] if mine else []
    for sev in ("Critical", "High"):
        n = sum(1 for s in mine + top if s.get("severity") == sev)
        if n:
            parts.append(f"{n} {sev.lower()}")
    return "<b>Today:</b> " + ", ".join(parts) if parts else ""


def send_digests(db, mailer, force=False):
    now = datetime.now(timezone.utc)
    uk_hour = now.astimezone(ZoneInfo("Europe/London")).hour
    # the first run at or after 8am sends it (GitHub's hourly timer is often late, so never rely on one exact hour)
    if not force and not (DIGEST_HOUR <= uk_hour < 21):
        return 0
    stories = (db.table("stories").select("id,headline,technical,why_it_matters,severity,products,source,url,category,country")
               .gte("created_at", (now - timedelta(hours=24)).isoformat()).order("created_at", desc=True)
               .limit(200).execute().data)
    # news only in the email, and only news for everyone or for the UK (the email goes out at 8am UK time)
    stories = [s for s in stories if s.get("category") not in ("Tips", "History")
               and (s.get("country") or "INTL") in ("INTL", "GB")]
    if not stories:
        return 0
    subs = (db.table("subscribers").select("email,token,products,terms,last_sent_at").eq("confirmed", True)
            .limit(DAILY_MAX).execute().data)
    sent = 0
    for sub in subs:
        last = sub.get("last_sent_at")
        if not force and last and now - datetime.fromisoformat(last.replace("Z", "+00:00")) < timedelta(hours=20):
            continue
        mine, top = _digest_for(sub, stories)
        if not mine and not top:
            continue
        unsub = f"{SITE}/unsubscribe.html?t={sub['token']}"
        parts = []
        if mine:
            parts.append(_section("FOR YOUR PRODUCTS", "&#127919;",
                                  "".join(_item(s, matches(s, sub.get("products"), sub.get("terms"))) for s in mine)))
        if top:
            parts.append(_section("TOP STORIES", "&#128293;", "".join(_item(s) for s in top)))
        date = now.astimezone(ZoneInfo("Europe/London")).strftime("%a %d %b")
        subject = f"CyberSid daily: {len(mine)} for your products" if mine else f"CyberSid daily: {top[0]['headline'][:60]}"
        text = "\n\n".join(f"[{s.get('severity')}] {s['headline']}\n{s['url']}" for s in mine + top) + f"\n\nUnsubscribe: {unsub}"
        try:
            body = _page("".join(parts), unsub, f"Your daily cyber briefing &middot; {date}", _summary(mine, top))
            mailer.send(sub["email"], subject, text, body, unsub)
            db.table("subscribers").update({"last_sent_at": now.isoformat()}).eq("email", sub["email"]).execute()
            sent += 1
        except Exception as ex:
            print(f"[warn] digest to one subscriber failed: {str(ex)[:80]}")
    return sent


def run_email(db, force=False):
    mailer = Mailer()
    if not mailer.ready:
        return "off (no SMTP_USER / SMTP_PASS)"
    try:
        c = send_confirmations(db, mailer)
        d = send_digests(db, mailer, force)
        return f"{c} confirmations, {d} digests"
    finally:
        mailer.close()
