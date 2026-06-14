import traceback
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request


HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).resolve().parent
LOG_PATH = ROOT / "live-server.log"
FIREBASE_BASE = "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app"


class QuietHandler(SimpleHTTPRequestHandler):
    def firebase_url(self):
        parsed = parse.urlparse(self.path)
        params = parse.parse_qs(parsed.query)
        raw_path = params.get("path", [""])[0]
        if not raw_path:
            return ""
        if not raw_path.startswith("/"):
            raw_path = "/" + raw_path
        return f"{FIREBASE_BASE}{raw_path}.json"

    def proxy_firebase(self):
        target = self.firebase_url()
        if not target:
            self.send_error(400, "Missing Firebase path")
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else None
        headers = {"Content-Type": "application/json"}
        req = request.Request(target, data=body, headers=headers, method=self.command)
        try:
            with request.urlopen(req, timeout=20) as res:
                data = res.read()
                self.send_response(res.status)
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except error.HTTPError as exc:
            data = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json"))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            payload = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/__firebase"):
            self.proxy_firebase()
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.startswith("/__firebase"):
            self.proxy_firebase()
            return
        self.send_error(405)

    def do_PATCH(self):
        if self.path.startswith("/__firebase"):
            self.proxy_firebase()
            return
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith("/__firebase"):
            self.proxy_firebase()
            return
        self.send_error(405)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        with LOG_PATH.open("a", encoding="utf-8") as log:
            log.write("%s - %s\n" % (self.log_date_time_string(), format % args))


def main():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    with LOG_PATH.open("a", encoding="utf-8") as log:
        log.write(f"Serving {ROOT} at http://{HOST}:{PORT}/\n")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        with LOG_PATH.open("a", encoding="utf-8") as log:
            log.write(traceback.format_exc())
        raise
