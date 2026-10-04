"""Temporary: check which news search feeds work from GitHub's servers and what they contain."""
import urllib.request, feedparser, urllib.parse
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
URLS = [
    "https://www.bing.com/news/search?q=cyber+attack+UK&format=rss&setlang=en-GB&cc=GB",
    "https://www.bing.com/news/search?q=%22scam%22+warning+UK&format=rss&cc=GB",
    "https://news.google.com/rss/search?q=cyber+attack+when:1d&hl=en-GB&gl=GB&ceid=GB:en",
    "https://www.ransomware.live/rss",
    "https://www.ransomlook.io/rss",
]
for u in URLS:
    try:
        raw = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=20).read()
        f = feedparser.parse(raw)
        print(f"\n### {u}\n  {len(f.entries)} entries; keys: {sorted(f.entries[0].keys()) if f.entries else '-'}")
        for e in f.entries[:6]:
            print("  -", e.get("title", "")[:100], "|", e.get("link", "")[:160], "|", e.get("published", ""),
                  "|", e.get("source", {}).get("title") if isinstance(e.get("source"), dict) else e.get("news_source"))
    except Exception as ex:
        print(f"\n### {u}\n  FAILED {ex}")
