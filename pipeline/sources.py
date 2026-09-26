"""News sources. country = main audience. test = used when TEST_MODE is on.
Feed URLs can change. The health report after each run shows which ones fail."""

SOURCES = [
        # UK focused
    {"name": "NCSC",                  "url": "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", "country": "GB", "test": True},
    {"name": "Infosecurity Magazine", "url": "https://www.infosecurity-magazine.com/rss/news/",           "country": "GB", "test": True},
    {"name": "The Register",          "url": "https://www.theregister.com/security/headlines.atom",       "country": "GB", "test": False},
    {"name": "Computer Weekly",       "url": "https://www.computerweekly.com/rss/IT-security.xml",        "country": "GB", "test": False},
    {"name": "Graham Cluley",         "url": "https://grahamcluley.com/feed/",                            "country": "GB", "test": False},
    {"name": "Sophos News",           "url": "https://news.sophos.com/en-us/feed/",                       "country": "GB", "test": False},

    # Global, widely read in the UK
    {"name": "BleepingComputer",      "url": "https://www.bleepingcomputer.com/feed/",                    "country": "GB", "test": True},
    {"name": "The Record",            "url": "https://therecord.media/feed",                              "country": "GB", "test": False},
    {"name": "The Hacker News",       "url": "https://feeds.feedburner.com/TheHackersNews",               "country": "GB", "test": False},
    {"name": "SecurityWeek",          "url": "https://feeds.feedburner.com/securityweek",                 "country": "GB", "test": False},
    {"name": "Help Net Security",     "url": "https://www.helpnetsecurity.com/feed/",                     "country": "GB", "test": False},
    {"name": "Krebs on Security",     "url": "https://krebsonsecurity.com/feed/",                         "country": "GB", "test": False},
    {"name": "Malwarebytes",          "url": "https://www.malwarebytes.com/blog/feed/index.xml",          "country": "GB", "test": False},
]