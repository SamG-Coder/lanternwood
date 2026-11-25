"""Static file server for the viewer, plus POST /save?name=x.png that writes the request body
(a PNG) to out/<name>. Used to grab native-resolution frames from the viewer (localhost only).

    python tools/devserver.py [port]
"""
import http.server, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        name = urllib.parse.parse_qs(u.query).get("name", ["grab.png"])[0]
        if u.path != "/save" or not re.fullmatch(r"[\w\-]+\.png", name):
            self.send_error(400)
            return
        n = int(self.headers.get("Content-Length", 0))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
