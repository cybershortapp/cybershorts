"""
Weekly backup of the database (the free Supabase plan has no backups of its own).

Saves each table as a compressed JSON file in ./backup/. The GitHub workflow keeps them for 90 days.
Tables with personal data (subscribers' email addresses, phones' push addresses) are encrypted in the
workflow before upload, because this repository is public. Run: python backup.py
"""
import gzip, json, os

TABLES = {
    # table: (order column, personal data?)
    "stories": ("created_at", False),
    "seen_links": ("id", False),
    "pipeline_runs": ("id", False),
    "threat_groups": ("id", False),
    "reports": ("id", False),
    "subscribers": ("email", True),
    "devices": ("token", True),
}


def main():
    from supabase import create_client
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    os.makedirs("backup/private", exist_ok=True)
    for table, (order, private) in TABLES.items():
        rows, start = [], 0
        while True:
            chunk = db.table(table).select("*").order(order).range(start, start + 999).execute().data
            rows += chunk
            if len(chunk) < 1000:
                break
            start += 1000
        path = f"backup/{'private/' if private else ''}{table}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, default=str)
        print(f"{table}: {len(rows)} rows -> {path}")
    print(f"::notice title=Backup::" + ", ".join(f"{t}" for t in TABLES) + " saved")


if __name__ == "__main__":
    main()
