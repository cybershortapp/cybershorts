"""News sources.
name     shown on the card
url      RSS or Atom feed (feed addresses change; the health report flags dead ones)
country  who the stories are for: INTL (everyone, the default), or a country code (GB, IN) for local
         news like a UK scam warning or an Indian UPI fraud. The app shows INTL plus the reader's own country.
kind     news | vendor | gov | general | search
         general = not a security-only site (BBC, Guardian...). Only stories with
         cyber words in the title are kept, so we don't pay the AI to read sport or gadgets.
         search = a news search feed (Bing News); same headline check as general, and the card shows
         the real publisher instead of the feed name.
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
Tried 3 Oct 2026 and not added: teiss (404), Computing (403), Trend Micro (404), Fortinet threat blog (empty),
Bitdefender Labs and Red Canary (no posts for 6+ weeks), JPCERT (English feed rarely updated).
"""

def s(name, url, kind="news", test=False, country="INTL", reader=None):
    """reader: a data source handled in data_feeds.py instead of an RSS feed."""
    return {"name": name, "url": url, "kind": kind, "test": test, "country": country, "reader": reader}


SOURCES = [
    # ---- news searches (Bing News): national and local press that the security sites don't cover.
    # Only headlines with security words are read; the card shows the real publisher. Searches that
    # are about one country are tagged with it, so only readers there see them. ----
    # UK edition
    s("UK news: cyber attacks", "https://www.bing.com/news/search?q=%22cyber+attack%22+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    s("UK news: data breaches", "https://www.bing.com/news/search?q=%22data+breach%22+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    s("UK news: scam warnings", "https://www.bing.com/news/search?q=scam+warning+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    s("UK news: ransomware", "https://www.bing.com/news/search?q=ransomware&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="INTL"),
    s("UK news: hackers", "https://www.bing.com/news/search?q=hackers+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    s("UK news: fraud and phishing", "https://www.bing.com/news/search?q=phishing+OR+%22online+fraud%22+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    s("UK news: cyber security", "https://www.bing.com/news/search?q=%22cyber+security%22+UK&format=rss&setlang=en-GB&cc=GB&qft=sortbydate%3d%221%22", "search", country="GB"),
    # worldwide (English, international edition)
    s("World news: cyberattacks", "https://www.bing.com/news/search?q=cyberattack&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: data breaches", "https://www.bing.com/news/search?q=%22data+breach%22&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: ransomware attacks", "https://www.bing.com/news/search?q=%22ransomware+attack%22&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: hackers", "https://www.bing.com/news/search?q=hackers+arrested+OR+hacker+group&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: Europe", "https://www.bing.com/news/search?q=cyberattack+Europe&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: Asia Pacific", "https://www.bing.com/news/search?q=cyberattack+Asia+OR+Australia+OR+Japan&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    s("World news: Middle East and Africa", "https://www.bing.com/news/search?q=cyberattack+%22Middle+East%22+OR+Africa&format=rss&setlang=en&cc=US&qft=sortbydate%3d%221%22", "search"),
    # India edition: shown to readers in India only
    s("India news: cyber fraud", "https://www.bing.com/news/search?q=%22cyber+fraud%22+India&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),
    s("India news: cyber attacks", "https://www.bing.com/news/search?q=cyber+attack+India&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),
    s("India news: data breaches", "https://www.bing.com/news/search?q=%22data+breach%22+India&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),
    s("India news: digital arrest scams", "https://www.bing.com/news/search?q=digital+arrest+scam&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),
    s("India news: UPI fraud", "https://www.bing.com/news/search?q=UPI+fraud&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),
    s("India news: cyber crime police", "https://www.bing.com/news/search?q=cyber+crime+police&format=rss&setlang=en-IN&cc=IN&qft=sortbydate%3d%221%22", "search", country="IN"),

    # ---- UK security and tech press ----
    s("NCSC", "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", "gov", test=True, country="GB"),
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
    # added 3 Oct 2026: more UK business tech press
    s("IT Pro", "https://www.itpro.com/security/feed", "general"),
    s("The Stack", "https://www.thestack.technology/rss/", "general"),
    s("Risky Bulletin", "https://news.risky.biz/rss/"),

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

    # added 3 Oct 2026: research teams that publish their own findings
    s("Zscaler ThreatLabz", "https://www.zscaler.com/blogs/feeds/security-research", "vendor"),
    s("Recorded Future", "https://www.recordedfuture.com/feed", "vendor"),
    s("Proofpoint", "https://www.proofpoint.com/us/rss.xml", "vendor"),
    s("Sophos", "https://www.sophos.com/en-us/blog/feed", "vendor"),
    s("Sekoia", "https://blog.sekoia.io/feed/", "vendor"),
    s("Volexity", "https://www.volexity.com/feed/", "vendor"),
    s("The DFIR Report", "https://thedfirreport.com/feed/", "vendor"),

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
