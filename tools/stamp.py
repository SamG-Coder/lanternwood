"""Stamp content hashes onto the site's file URLs so browsers never mix cached old files with new
ones after a deploy (GitHub Pages lets browsers cache for ~10 minutes).

    python tools/stamp.py        (run before committing a change to docs/)

Rewrites in docs/index.html:   js/ui.js?v=<hash>, js/rtpack.js?v=..., js/game.js?v=...
and docs/js/game.js reads its own ?v and passes a per-file version map (window.LW_V) on to the
worker (decoder.js, rtpack.js) and the world pack (data/world.rtp).
"""
import hashlib, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
FILES = sorted("js/" + f for f in os.listdir(os.path.join(DOCS, "js")) if f.endswith(".js")) + ["data/world.rtp"]


def h(path):
    with open(os.path.join(DOCS, path), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def main():
    vers = {p: h(p) for p in FILES}
    p = os.path.join(DOCS, "index.html")
    s = open(p, encoding="utf-8").read()
    for f in FILES:
        if not f.endswith(".js"):
            continue
        s = re.sub(r'src="%s(\?v=[0-9a-f]*)?"' % re.escape(f), 'src="%s?v=%s"' % (f, vers[f]), s)
    s = re.sub(r"<script>window\.LW_V = .*?</script>\n?", "", s)
    s = s.replace('<script src="js/ui.js', "<script>window.LW_V = %s;</script>\n<script src=\"js/ui.js" % json.dumps(vers, separators=(",", ":")), 1)
    open(p, "w", encoding="utf-8").write(s)
    print("stamped:", ", ".join(f"{k}={v}" for k, v in vers.items()))


if __name__ == "__main__":
    main()
