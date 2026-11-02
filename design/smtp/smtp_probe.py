"""(re-run 2 Nov) Which step of sending through Gmail fails? Prints only steps and Gmail's replies, never the address or password."""
import os, smtplib, socket, ssl
user = os.getenv("SMTP_USER", "").strip()
pw = os.getenv("SMTP_PASS", "").replace(" ", "").strip()
print(f"settings: user set={bool(user)} ({'gmail.com' if user.endswith('@gmail.com') else 'not a gmail.com address'}), "
      f"password set={bool(pw)}, password length={len(pw)} (an app password is 16 letters)")
for host, port, mode in [("smtp.gmail.com", 465, "ssl"), ("smtp.gmail.com", 587, "starttls")]:
    print(f"\n== {host}:{port} ({mode})")
    try:
        ip = socket.gethostbyname(host)
        print("dns ok", ip)
        if mode == "ssl":
            s = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30)
        else:
            s = smtplib.SMTP(host, port, timeout=30)
            print("ehlo", s.ehlo()[0])
            s.starttls(context=ssl.create_default_context())
        print("connected; ehlo", s.ehlo()[0])
        try:
            s.login(user, pw)
            print("LOGIN OK")
        except Exception as ex:
            print("LOGIN FAILED:", type(ex).__name__, str(ex)[:300].replace(user, "<user>") if user else str(ex)[:300])
        try:
            s.quit()
        except Exception:
            pass
    except Exception as ex:
        print("FAILED:", type(ex).__name__, str(ex)[:300])
