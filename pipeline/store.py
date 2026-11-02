"""Where card pictures are saved: Cloudflare R2 when it is set up, otherwise Supabase storage (growth plan step 1).

Pictures are most of what the app downloads. On Supabase every picture a reader sees counts towards the monthly
data allowance (5 GB of cached data on the free plan, roughly 40 readers a day). Cloudflare R2 charges nothing for
data sent out, and behind our own web address Cloudflare's cache serves the pictures, so more readers cost nothing.

R2 is used when these are set (GitHub secrets):
  CF_ACCOUNT_ID          the Cloudflare account (already there for the AI pictures)
  R2_ACCESS_KEY_ID       an R2 API token's access key
  R2_SECRET_ACCESS_KEY   and its secret
  PICTURES_URL           the bucket's public web address, e.g. https://img.example.com
  R2_BUCKET              optional, the bucket's name (default cybersid-pictures)
Without them, or if R2 fails, pictures go to Supabase storage exactly as before, so nothing breaks.

Picture addresses keep the same shape on both, <host>/storage/v1/object/public/<bucket>/<file>, so everything that
recognises our own pictures (and the app) works unchanged; only saving and deleting need to know which is which.
Pictures already on Supabase stay there until their stories are cleaned up.
"""
import os

PREFIX = "storage/v1/object/public/"
_client = None
_failed = False


def _cfg():
    return {
        "account": os.getenv("CF_ACCOUNT_ID", "").strip(),
        "key": os.getenv("R2_ACCESS_KEY_ID", "").strip(),
        "secret": os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
        "bucket": os.getenv("R2_BUCKET", "").strip() or "cybersid-pictures",
        "url": os.getenv("PICTURES_URL", "").strip().rstrip("/"),
    }


def r2_on():
    c = _cfg()
    return bool(c["account"] and c["key"] and c["secret"] and c["url"].startswith("https://")) and not _failed


def public_base():
    return _cfg()["url"]


def _s3():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        c = _cfg()
        _client = boto3.client(
            "s3", endpoint_url=f"https://{c['account']}.r2.cloudflarestorage.com",
            aws_access_key_id=c["key"], aws_secret_access_key=c["secret"], region_name="auto",
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=10, read_timeout=30))
    return _client


def on_r2(url):
    base = public_base()
    return bool(url and base and url.startswith(base + "/"))


def put(db, bucket, path, data, content_type="image/jpeg"):
    """Save a picture and return its public address (R2 if set up, else Supabase)."""
    global _failed
    if r2_on():
        try:
            _s3().put_object(Bucket=_cfg()["bucket"], Key=PREFIX + f"{bucket}/{path}", Body=data, ContentType=content_type,
                             CacheControl="public, max-age=31536000, immutable")
            return f"{public_base()}/{PREFIX}{bucket}/{path}"
        except Exception as ex:
            # one failure (wrong key, bucket missing) switches R2 off for the rest of this run
            _failed = True
            print(f"::warning title=Pictures on R2 failed, using Supabase storage::{str(ex)[:200]}")
            if db is None:
                raise
    store = db.storage.from_(bucket)
    store.upload(path, data, {"content-type": content_type, "cache-control": "31536000", "upsert": "true"})
    return store.get_public_url(path).rstrip("?")


def _split(url):
    """(bucket, file) of one of our picture addresses, or None."""
    if not url or "/" + PREFIX not in url:
        return None
    rest = url.split("/" + PREFIX, 1)[1].split("?")[0]
    if "/" not in rest:
        return None
    bucket, path = rest.split("/", 1)
    return bucket, path


def remove(db, urls):
    """Delete these pictures wherever they are saved. Errors are only printed: a picture left behind costs little."""
    r2_keys, sb = [], {}
    for u in urls:
        parts = _split(u)
        if not parts:
            continue
        if on_r2(u):
            r2_keys.append(PREFIX + "/".join(parts))
        else:
            sb.setdefault(parts[0], []).append(parts[1])
    for bucket, paths in sb.items():
        for i in range(0, len(paths), 100):
            try:
                db.storage.from_(bucket).remove(paths[i:i + 100])
            except Exception as ex:
                print(f"[warn] delete pictures from {bucket}: {str(ex)[:80]}")
    if r2_keys:
        c = _cfg()
        if not (c["account"] and c["key"] and c["secret"]):
            print(f"[warn] {len(r2_keys)} pictures on R2 not deleted: no R2 key in this job")
            return
        for i in range(0, len(r2_keys), 500):
            try:
                _s3().delete_objects(Bucket=c["bucket"], Delete={"Objects": [{"Key": k} for k in r2_keys[i:i + 500]], "Quiet": True})
            except Exception as ex:
                print(f"[warn] delete pictures from R2: {str(ex)[:80]}")


def r2_size():
    """(files, bytes) in the R2 bucket, or None when R2 isn't set up."""
    c = _cfg()
    if not (c["account"] and c["key"] and c["secret"]):
        return None
    files = size = 0
    token = None
    while True:
        args = {"Bucket": c["bucket"], "MaxKeys": 1000}
        if token:
            args["ContinuationToken"] = token
        page = _s3().list_objects_v2(**args)
        for o in page.get("Contents", []):
            files += 1
            size += o.get("Size", 0)
        if not page.get("IsTruncated"):
            return files, size
        token = page.get("NextContinuationToken")


def check():
    """python store.py --check: save, read back and delete a test picture on R2 (used after setting it up)."""
    import urllib.request
    if not r2_on():
        print("R2 is not set up: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and PICTURES_URL are needed.")
        return False
    data = b"\xff\xd8\xff\xe0" + b"cybersid r2 check" * 20
    try:
        url = put(None, "check", "test.jpg", data)
    except Exception:
        print("Saving to R2 failed (see the warning above): check the key, the secret and the bucket name.")
        return False
    ok = False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "okhttp/4.12.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ok = r.read() == data
            print(f"Saved and read back from {url.split('/' + PREFIX)[0]}: {'OK' if ok else 'different bytes'} "
                  f"(cache: {r.headers.get('cf-cache-status') or 'n/a'})")
    except Exception as ex:
        body = ""
        try:
            body = ex.read().decode(errors="ignore")[:300]   # an HTTP error's own message
        except Exception:
            pass
        base = public_base()
        kind = ("the bucket's private S3 API address (r2.cloudflarestorage.com): use the custom domain instead, "
                "e.g. https://img.yourdomain" if "r2.cloudflarestorage.com" in base else
                "an r2.dev address (for testing only): use the custom domain instead" if ".r2.dev" in base else
                "has a path after the domain: it should be only https://img.yourdomain" if base.count("/") > 2 else
                "a custom domain (check it shows Active in the bucket's Custom Domains)")
        print(f"Saved to R2, but the public address doesn't serve it yet: {str(ex)[:150]}")
        print(f"PICTURES_URL looks like {kind}. Reply: {body}")
    remove(None, [url])
    return ok


if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        sys.exit(0 if check() else 1)
    # offline checks of the address handling
    os.environ.update({"CF_ACCOUNT_ID": "", "PICTURES_URL": "https://img.example.com"})
    u = "https://img.example.com/storage/v1/object/public/pictures/abc.jpg"
    s = "https://x.supabase.co/storage/v1/object/public/covers/library/a-1.jpg"
    assert _split(u) == ("pictures", "abc.jpg") and on_r2(u) and not on_r2(s)
    assert _split(s) == ("covers", "library/a-1.jpg") and _split("https://news.example/a.jpg") is None
    assert not r2_on()
    print("store.py offline checks passed")
