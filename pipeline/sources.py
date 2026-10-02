"""News sources.
name     shown on the card
url      RSS or Atom feed (feed addresses change; the health report flags dead ones)
country  main audience (GB for now)
kind     news | vendor | gov | general
         general = not a security-only site (BBC, Guardian...). Only stories with
         cyber words in the title are kept, so we don't pay the AI to read sport or gadgets.
test     used when TEST_MODE is on
Checked by health report only. Remove any that show NO STORIES for a few days in a row.

Removed after the first full test (27 Sep 2026): Security Boulevard, Tripwire and CISA (block
automated readers, HTTP 403), Ars Technica and ENISA (feed address gone, 404), Microsoft MSRC and
Google Threat Intelligence (feed returned no stories). CISA's exploited-vulnerabilities list will be
read from its official GitHub data instead (Round 2).
Removed 1 Oct 2026: Sophos News (old blog address times out; Sophos research is covered by the news
sites) and Australian Cyber Security Centre (times out even with 45s; Australia-only alerts).
Removed 2 Oct 2026 after the GitHub source check: The Cyber Express (blocks GitHub's servers, 403),
GBHackers (bot check page, no stories) and Cybernews (feed address gone, 404).
"""

def s(name, url, kind="news", test=False, country="GB", reader=None):
    """reader: a data source handled in data_feeds.py instead of an RSS feed."""
    return {"name": name, "url": url, "kind": kind, "test": test, "country": country, "reader": reader}


SOURCES = [
    # ---- UK security and tech press ----
    s("NCSC", "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", "gov", test=True),
    s("Infosecurity Magazine", "https://www.infosecurity-magazine.com/rss/news/", test=True),
    s("The Register", "https://www.theregister.com/security/headlines.atom"),
    s("Computer Weekly", "https://www.computerweekly.com/rss/IT-security.xml"),
    s("Graham Cluley", "https://grahamcluley.com/feed/"),
    s("IT Security Guru", "https://www.itsecurityguru.org/feed/"),
    s("Silicon UK", "https://www.silicon.co.uk/feed", "general"),
    s("Troy Hunt", "https://www.troyhunt.com/rss/"),
    s("BBC Technology", "https://feeds.bbci.co.uk/news/technology/rss.xml", "general"),
    s("The Guardian", "https://www.theguardian.com/technology/data-computer-security/rss"),
    s("ESET WeLiveSecurity", "https://www.welivesecurity.com/en/rss/feed/", "vendor"),

    # ---- Global security news ----
    s("BleepingComputer", "https://www.bleepingcomputer.com/feed/", test=True),
    s("The Record", "https://therecord.media/feed"),
    s("The Hacker News", "https://feeds.feedburner.com/TheHackersNews"),
    s("SecurityWeek", "https://feeds.feedburner.com/securityweek"),
    s("Dark Reading", "https://www.darkreading.com/rss.xml"),
    s("Help Net Security", "https://www.helpnetsecurity.com/feed/"),
    s("Krebs on Security", "https://krebsonsecurity.com/feed/"),
    s("CyberScoop", "https://cyberscoop.com/feed/"),
    s("Security Affairs", "https://securityaffairs.com/feed"),
    s("Hackread", "https://www.hackread.com/feed/"),
    s("Cybersecurity Dive", "https://www.cybersecuritydive.com/feeds/news/"),
    s("SC Media", "https://www.scworld.com/rss"),
    s("CSO Online", "https://www.csoonline.com/feed/"),
    s("DataBreaches.net", "https://databreaches.net/feed/"),
    s("Schneier on Security", "https://www.schneier.com/feed/atom/"),
    s("Wired Security", "https://www.wired.com/feed/category/security/latest/rss"),
    s("TechCrunch Security", "https://techcrunch.com/category/security/feed/"),
    s("ZDNET Security", "https://www.zdnet.com/topic/security/rss.xml"),
    s("Malwarebytes", "https://www.malwarebytes.com/blog/feed/index.xml", "vendor"),
    # added 2 Oct 2026: high-volume daily security news
    s("Cyber Security News", "https://cybersecuritynews.com/feed/"),

    # ---- Vendor and research labs ----
    s("Microsoft Security", "https://www.microsoft.com/en-us/security/blog/feed/", "vendor"),
    s("Cisco Talos", "https://blog.talosintelligence.com/rss/", "vendor"),
    s("Unit 42", "https://unit42.paloaltonetworks.com/feed/", "vendor"),
    s("Google Project Zero", "https://googleprojectzero.blogspot.com/feeds/posts/default", "vendor"),
    s("CrowdStrike", "https://www.crowdstrike.com/blog/feed/", "vendor"),
    s("SentinelLabs", "https://www.sentinelone.com/labs/feed/", "vendor"),
    s("Check Point Research", "https://research.checkpoint.com/feed/", "vendor"),
    s("Kaspersky Securelist", "https://securelist.com/feed/", "vendor"),
    s("Rapid7", "https://www.rapid7.com/blog/rss/", "vendor"),
    s("Tenable", "https://www.tenable.com/blog/feed", "vendor"),
    s("Huntress", "https://www.huntress.com/blog/rss.xml", "vendor"),
    s("Qualys", "https://blog.qualys.com/feed", "vendor"),
    s("Elastic Security Labs", "https://www.elastic.co/security-labs/rss/feed.xml", "vendor"),
    s("Wiz", "https://www.wiz.io/feed/rss.xml", "vendor"),
    s("Cloudflare Security", "https://blog.cloudflare.com/tag/security/rss/", "vendor"),
    s("Zero Day Initiative", "https://www.zerodayinitiative.com/blog?format=rss", "vendor"),
    s("SANS Internet Storm Center", "https://isc.sans.edu/rssfeed_full.xml", "vendor"),
    s("FortiGuard PSIRT", "https://filestore.fortinet.com/fortiguard/rss/ir.xml", "vendor"),
    # added 2 Oct 2026: vendor security advisories (what to patch)
    s("Cisco Security Advisories", "https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml", "vendor"),
    s("Palo Alto Networks Advisories", "https://security.paloaltonetworks.com/rss.xml", "vendor"),
    s("Microsoft Security Response Center", "https://api.msrc.microsoft.com/update-guide/rss", "vendor"),

    # ---- Government and CERT alerts ----
    # added 2 Oct 2026: data sources (see data_feeds.py)
    s("CISA Known Exploited", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "gov", reader="kev"),
    s("Have I Been Pwned", "https://haveibeenpwned.com/PwnedWebsites", reader="hibp"),
    s("Canadian Cyber Centre", "https://www.cyber.gc.ca/api/cccs/rss/v1/get?feed=alerts_advisories&lang=en", "gov"),
    s("CERT-EU", "https://cert.europa.eu/publications/security-advisories-rss", "gov"),

    # ---- Consumer tech, filtered to cyber stories only ----
    s("The Verge", "https://www.theverge.com/rss/index.xml", "general"),
    s("TechRadar", "https://www.techradar.com/rss", "general"),
    s("Engadget", "https://www.engadget.com/rss.xml", "general"),
]
