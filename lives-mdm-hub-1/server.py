"""Local JSON-backed account server. Run: python3 server.py."""
import hashlib
import hmac
import json
import secrets
import threading
import time
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
ACCOUNTS = ROOT / 'test_users.json'
LOCK = threading.Lock()
SESSIONS = {}
ROLES = {'requester': 'amy', 'finance': 'weijie', 'quality': 'siti',
         'bu_head': 'daniel', 'business_support': 'grace', 'procurement': 'hafiz', 'mdm': 'priya'}

def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def reply(self, status, data, cookie=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def account(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie['session'].value if 'session' in cookie else ''
        except Exception:
            return None
        session = SESSIONS.get(token)
        return session[0] if session and session[1] > time.time() else None

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/me':
            user = self.account()
            return self.reply(200 if user else 401, user or {'error': 'Please sign in.'})
        # Only the web app is served. Accounts, source and repository files stay private.
        resolved = (ROOT / path.lstrip('/')).resolve()
        public = resolved in [ROOT, ROOT / 'index.html', ROOT / 'login.html'] or (resolved.parent == ROOT / 'assets' and resolved.suffix in {'.js', '.css'})
        if not public:
            return self.send_error(404)
        if path.startswith('/assets/') and resolved.suffix == '.js' and resolved.name not in {'auth.js', 'login.js'} and not self.account():
            return self.reply(401, {'error': 'Please sign in.'})
        return super().do_GET()

    def do_HEAD(self):
        return self.do_GET()

    def do_POST(self):
        if self.headers.get('Origin') and self.headers['Origin'] != 'http://' + self.headers.get('Host', ''):
            return self.reply(403, {'error': 'Invalid origin.'})
        path = urlsplit(self.path).path
        if path == '/api/logout':
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            if 'session' in cookie:
                SESSIONS.pop(cookie['session'].value, None)
            return self.reply(200, {}, 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        if path not in {'/api/login', '/api/register'}:
            return self.reply(404, {'error': 'Not found.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096:
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            username = data['username'].strip().lower()
            password = data['password']
            role = data['role']
            if not isinstance(password, str) or not 3 <= len(username) <= 40 or not all(c.isalnum() or c in '._-' for c in username) or role not in ROLES or not 8 <= len(password) <= 128:
                raise ValueError()
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.reply(400, {'error': 'Use a 3–40 character username, an 8–128 character password and a valid role.'})
        with LOCK:
            try:
                users = json.loads(ACCOUNTS.read_text())
                if not isinstance(users, list):
                    raise ValueError('Expected an account list')
                for account in users:
                    if not isinstance(account, dict) or not all(isinstance(account.get(key), str) for key in ('username', 'role', 'salt', 'password_hash')):
                        raise ValueError('Invalid account record')
                    if len(bytes.fromhex(account['salt'])) != 16 or len(bytes.fromhex(account['password_hash'])) != 32:
                        raise ValueError('Invalid password hash')
            except (OSError, ValueError):
                return self.reply(500, {'error': 'Unable to read test_users.json. Restore the valid test account file and try again.'})
            user = next((u for u in users if u['username'] == username), None)
            if path == '/api/register':
                if user:
                    return self.reply(409, {'error': 'Username already registered.'})
                salt = secrets.token_hex(16)
                user = dict(username=username, role=role, salt=salt, password_hash=password_hash(password, salt))
                users.append(user)
                temporary = ACCOUNTS.with_suffix('.tmp')
                temporary.write_text(json.dumps(users, indent=2) + '\n')
                temporary.chmod(0o600)
                temporary.replace(ACCOUNTS)
            elif not user or user['role'] != role or not hmac.compare_digest(user['password_hash'], password_hash(password, user['salt'])):
                return self.reply(401, {'error': 'Username, password or role is incorrect.'})
        public = dict(username=username, role=role, persona=ROLES[role])
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = (public, time.time() + 28800)
        self.reply(200, public, f'session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')

if __name__ == '__main__':
    if not ACCOUNTS.exists():
        ACCOUNTS.write_text('[]\n')
        ACCOUNTS.chmod(0o600)
    print('MDM Hub: http://localhost:8000')
    ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
