# -*- coding: utf-8 -*-
# 試すためのサーバー。python3 serve.py → 表示されたアドレスを Mac や iPad で開く
# （オフライン機能は https か localhost でしか動かないので、家のアドレスでは無効）
# 配るのは tools/publish.json に書いたアプリのファイルだけ（ROADMAP.md・設計図.md・tools などは 404）
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json, os, socket
ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8765'))
RULE = json.loads((ROOT / 'tools' / 'publish.json').read_text(encoding='utf-8'))
EXT = set(RULE['extensions'])

def allowed(rel):
    parts = Path(rel).parts
    if not parts or any(p.startswith('.') for p in parts):
        return False
    if rel in RULE['files']:
        return True
    return parts[0] in RULE['dirs'] and Path(rel).suffix in EXT

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        rel = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        target = (ROOT / rel).resolve()
        if not allowed(rel) or not target.is_relative_to(ROOT) or not target.is_file():
            self.send_error(404); return None
        return super().send_head()
    def list_directory(self, path):
        self.send_error(404); return None
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *args): pass

if __name__ == '__main__':
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(('192.0.2.1', 1)); addr = s.getsockname()[0]
    except OSError: addr = '127.0.0.1'
    finally: s.close()
    print(f'http://{addr}:{PORT}/', flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), partial(Handler, directory=str(ROOT))).serve_forever()
