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
SEV_COLOUR = {"Critical": "#C62F2E", "High": "#C77A0E", "Medium": "#6A3FE0", "Info": "#7A8197"}


class Mailer:
    def __init__(self):
        self.user = os.getenv("SMTP_USER", "").strip()
        self.password = os.getenv("SMTP_PASS", "").replace(" ", "").strip()
        self.server = None

    @property
    def ready(self):
        return bool(self.user and self.password)

    def send(self, to, subject, text, html_body, unsubscribe=None):
        if self.server is None:
            self.server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30)
            self.server.login(self.user, self.password)
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


def _page(inner, unsub=None):
    foot = (f'<p style="color:#7A8197;font-size:12px;margin-top:28px">You get this because you subscribed in the CyberSid app. '
            f'<a href="{unsub}" style="color:#7A8197">Unsubscribe</a></p>') if unsub else ""
    return (f'<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#0A0F1F">'
            f'<h2 style="margin:0 0 4px">Cyber<span style="color:#2563F5">Sid</span></h2>{inner}{foot}</div>')


def send_confirmations(db, mailer, limit=20):
    rows = (db.table("subscribers").select("email,token").eq("confirmed", False).is_("confirm_sent_at", "null")
            .limit(limit).execute().data)
    sent = 0
    for r in rows:
        link = f"{SITE}/confirm.html?t={r['token']}"
        text = f"Please confirm you want CyberSid news by email:\n{link}\n\nIf this wasn't you, ignore this email and nothing will be sent."
        body = _page(f'<p>Please confirm you want the CyberSid daily digest by email.</p>'
                     f'<p><a href="{link}" style="background:#2563F5;color:#fff;padding:10px 18px;border-radius:8px;'
                     f'text-decoration:none;display:inline-block">Confirm my email</a></p>'
                     f'<p style="color:#7A8197;font-size:13px">If this wasn\'t you, ignore this email and nothing will be sent.</p>')
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
    label = f"{sev}" + (f" &middot; {html.escape(hit)}" if hit else "")
    why = f'<div style="color:#3A4256;font-size:14px;margin-top:3px">{html.escape(s["why_it_matters"])}</div>' if s.get("why_it_matters") else ""
    return (f'<div style="border-left:3px solid {SEV_COLOUR.get(sev, "#7A8197")};padding:4px 12px;margin:14px 0">'
            f'<div style="font-size:12px;color:{SEV_COLOUR.get(sev, "#7A8197")};font-weight:bold">{label}</div>'
            f'<a href="{html.escape(s["url"])}" style="color:#0A0F1F;font-size:16px;font-weight:bold;text-decoration:none">'
            f'{html.escape(s["headline"])}</a>{why}'
            f'<div style="color:#7A8197;font-size:12px;margin-top:3px">{html.escape(s["source"])}</div></div>')


def send_digests(db, mailer, force=False):
    now = datetime.now(timezone.utc)
    uk_hour = now.astimezone(ZoneInfo("Europe/London")).hour
    # the first run at or after 8am sends it (GitHub's hourly timer is often late, so never rely on one exact hour)
    if not force and not (DIGEST_HOUR <= uk_hour < 21):
        return 0
    stories = (db.table("stories").select("id,headline,technical,why_it_matters,severity,products,source,url,category")
               .gte("created_at", (now - timedelta(hours=24)).isoformat()).order("created_at", desc=True)
               .limit(200).execute().data)
    stories = [s for s in stories if s.get("category") not in ("Tips", "History")]   # news only in the email
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
            parts.append('<h3 style="margin:22px 0 0">Your products</h3>' +
                         "".join(_item(s, matches(s, sub.get("products"), sub.get("terms"))) for s in mine))
        if top:
            parts.append('<h3 style="margin:22px 0 0">Top stories</h3>' + "".join(_item(s) for s in top))
        date = now.astimezone(ZoneInfo("Europe/London")).strftime("%a %d %b")
        subject = f"CyberSid daily: {len(mine)} for your products" if mine else f"CyberSid daily: {top[0]['headline'][:60]}"
        text = "\n\n".join(f"[{s.get('severity')}] {s['headline']}\n{s['url']}" for s in mine + top) + f"\n\nUnsubscribe: {unsub}"
        try:
            mailer.send(sub["email"], subject, text, _page(f'<p style="color:#7A8197;margin:0">{date}</p>' + "".join(parts), unsub), unsub)
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
