"""
The colour of each story's picture, for the app's Vivid theme: the whole card takes this colour,
so a red picture gives a deep red card and a teal picture a deep teal one.

Worked out from the picture itself (no AI): the picture is shrunk to a few pixels, the most colourful
part is picked, and then made deep and dark enough that white text always reads well on it.
Saved in the stories table as "tint" ('#2a0a0d'). A picture that can't be read gets '-', so it isn't tried again.
"""
import colorsys, io, urllib.request
from datetime import datetime, timezone

from PIL import Image

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
MAX_BYTES = 4_000_000


def colour_of(data):
    """'#rrggbb': a deep, rich version of the picture's main colour."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((48, 48))
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for r, g, b in img.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        w = 0.05 + s * v * v          # colourful, bright pixels count most; greys and black hardly at all
        total[0] += r * w
        total[1] += g * w
        total[2] += b * w
        weight += w
    r, g, b = (c / weight / 255 for c in total)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s < 0.08:                      # a black and white picture: a deep slate blue instead of a random tint
        return "#1b2130"
    # deep and rich: dark enough for white text, never grey mush
    l = 0.15
    s = min(0.7, max(0.3, s * 1.3))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))


def _download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read(MAX_BYTES)


def fill_tints(db, until, limit=40):
    """Colour the newest stories that don't have one yet, until the time `until` (a UTC datetime).
    Returns a short note for the run summary."""
    try:
        rows = (db.table("stories").select("id,image_url").is_("tint", "null").not_.is_("image_url", "null")
                .order("created_at", desc=True).limit(limit).execute().data)
    except Exception as ex:
        if "tint" in str(ex):
            return "colour column not added yet"
        raise
    done = failed = 0
    for r in rows:
        if datetime.now(timezone.utc) >= until:
            break
        try:
            tint = colour_of(_download(r["image_url"]))
            done += 1
        except Exception:
            tint = "-"
            failed += 1
        db.table("stories").update({"tint": tint}).eq("id", r["id"]).execute()
    left = max(0, len(rows) - done - failed)
    return f"{done} coloured, {failed} unreadable" + (f", {left}+ waiting" if left else "")
