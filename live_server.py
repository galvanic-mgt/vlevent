import traceback
import json
import queue
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request


HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).resolve().parent
LOG_PATH = ROOT / "live-server.log"
FIREBASE_BASE = "https://eva-lucky-draw-default-rtdb.asia-southeast1.firebasedatabase.app"
STREAM_CLIENTS = []
STREAM_LOCK = threading.Lock()


def normalize_firebase_path(raw_path):
    if not raw_path:
        return ""
    if not raw_path.startswith("/"):
        raw_path = "/" + raw_path
    return raw_path.rstrip("/") or "/"


def relative_stream_update(watch_path, changed_path, data):
    if watch_path == changed_path:
        return "/", data
    if watch_path != "/" and changed_path.startswith(watch_path + "/"):
        return changed_path[len(watch_path):], data
    if changed_path != "/" and watch_path.startswith(changed_path + "/"):
        node = data
        for part in watch_path[len(changed_path):].strip("/").split("/"):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return None, None
        return "/", node
    return None, None


def broadcast_local_update(changed_path, event_name, data):
    with STREAM_LOCK:
        clients = list(STREAM_CLIENTS)
    for client in clients:
        rel_path, rel_data = relative_stream_update(client["path"], changed_path, data)
        if rel_path is not None:
            client["queue"].put(("event", event_name, rel_path, rel_data))


class QuietHandler(SimpleHTTPRequestHandler):
    def firebase_path(self):
        parsed = parse.urlparse(self.path)
        params = parse.parse_qs(parsed.query)
        return normalize_firebase_path(params.get("path", [""])[0])

    def firebase_url(self):
        raw_path = self.firebase_path()
        if not raw_path:
            return ""
        return f"{FIREBASE_BASE}{raw_path}.json"

    def proxy_firebase(self):
        target = self.firebase_url()
        if not target:
            self.send_error(400, "Missing Firebase path")
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else None
        body_json = json.loads(body.decode("utf-8")) if body else None
        firebase_path = self.firebase_path()
        should_echo_ui = self.command in {"PUT", "DELETE"} and "/ui/" in firebase_path
        if should_echo_ui:
            broadcast_local_update(firebase_path, "put", body_json if self.command == "PUT" else None)
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
                if self.command == "PUT" and not should_echo_ui:
                    broadcast_local_update(self.firebase_path(), "put", body_json)
                elif self.command == "DELETE" and not should_echo_ui:
                    broadcast_local_update(self.firebase_path(), "put", None)
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

    def proxy_firebase_stream(self):
        target = self.firebase_url()
        if not target:
            self.send_error(400, "Missing Firebase path")
            return

        req = request.Request(target, headers={"Accept": "text/event-stream"})
        watch_path = self.firebase_path()
        client = {"path": watch_path, "queue": queue.Queue()}
        with STREAM_LOCK:
            STREAM_CLIENTS.append(client)

        def pump_remote_stream():
            try:
                with request.urlopen(req) as res:
                    while True:
                        line = res.readline()
                        if not line:
                            break
                        client["queue"].put(("raw", line))
            except Exception:
                client["queue"].put(("close",))

        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            threading.Thread(target=pump_remote_stream, daemon=True).start()
            while True:
                item = client["queue"].get()
                if not item or item[0] == "close":
                    break
                if item[0] == "raw":
                    self.wfile.write(item[1])
                elif item[0] == "event":
                    _, event_name, rel_path, rel_data = item
                    payload = json.dumps({"path": rel_path, "data": rel_data}, ensure_ascii=False).encode("utf-8")
                    self.wfile.write(f"event: {event_name}\n".encode("utf-8"))
                    self.wfile.write(b"data: " + payload + b"\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            try:
                payload = json.dumps({"error": str(exc)}).encode("utf-8")
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(payload)
            except Exception:
                return
        finally:
            with STREAM_LOCK:
                if client in STREAM_CLIENTS:
                    STREAM_CLIENTS.remove(client)

    def proxy_asset(self):
        parsed = parse.urlparse(self.path)
        params = parse.parse_qs(parsed.query)
        target = params.get("url", [""])[0]
        parsed_target = parse.urlparse(target)
        if parsed_target.scheme not in {"http", "https"} or not parsed_target.netloc:
            self.send_error(400, "Invalid asset URL")
            return

        req = request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with request.urlopen(req, timeout=20) as res:
                data = res.read()
                self.send_response(res.status)
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/octet-stream"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except error.HTTPError as exc:
            data = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type", "text/plain"))
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
        if self.path.startswith("/__firebase_stream"):
            self.proxy_firebase_stream()
            return
        if self.path.startswith("/__asset"):
            self.proxy_asset()
            return
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
