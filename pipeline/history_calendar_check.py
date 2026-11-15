"""
Checks every event in history_calendar.json against its Wikipedia article: the article exists, is about cyber
security, and states the exact day. Runs on pull requests that change the calendar. Needs no keys.
python history_calendar_check.py
"""
import sys, time

from daily import date_in_text, norm_url, wikipedia
from history import CYBER, load_calendar, load_history

bad, used = [], {norm_url(e["url"]) for e in load_history()}
rows = load_calendar()
for e in rows:
    w = wikipedia(e["wikipedia"])
    time.sleep(0.3)   # gentle on Wikipedia
    if not w:
        bad.append(f"{e['date']} {e['wikipedia']}: no Wikipedia article")
        continue
    url, title, text = w
    if title.lower() != e["wikipedia"].lower():
        print(f"note: {e['wikipedia']} -> {title}")
    if norm_url(url) in used:
        bad.append(f"{e['date']} {e['wikipedia']}: already in history.json")
    elif len(CYBER.findall(text[:6000])) < 2:
        bad.append(f"{e['date']} {e['wikipedia']}: not a cyber security article")
    elif not date_in_text(e["date"], text)[1]:
        bad.append(f"{e['date']} {e['wikipedia']}: the exact day isn't in the article")
print(f"{len(rows) - len(bad)} of {len(rows)} events confirmed")
for b in bad:
    print(f"::error title=Calendar event not confirmed::{b}")
sys.exit(1 if bad else 0)
