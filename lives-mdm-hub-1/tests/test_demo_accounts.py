"""The demo accounts on the login page work, through the server and in the browser copy."""
import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server

ROOT = Path(__file__).resolve().parents[1]


def demo_accounts():
    text = (ROOT / 'assets' / 'demo-accounts.js').read_text()
    password = re.search(r"password: '([^']+)'", text).group(1)
    people = re.findall(r"username: '([^']+)', role: '([^']+)'", text)
    return password, people


def browser_accounts():
    text = (ROOT / 'assets' / 'accounts.js').read_text()
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


class DemoAccountsTest(unittest.TestCase):
    def test_every_demo_account_is_on_file_with_its_role(self):
        password, people = demo_accounts()
        users = {u['username']: u for u in json.loads((ROOT / 'test_users.json').read_text())}
        self.assertGreaterEqual(len(people), 8)
        for username, role in people:
            self.assertIn(username, users)
            self.assertEqual(users[username]['role'], role)
            self.assertIn(role, server.ROLES)
            self.assertEqual(server.password_hash(password, users[username]['salt']), users[username]['password_hash'], username)
        # Marcus has his own role, so his steps can be shown signed in as him
        self.assertEqual(server.ROLES['requester_new'], 'marcus')

    def test_browser_copy_matches_the_account_file(self):
        copy = browser_accounts()
        self.assertEqual(copy['roles'], server.ROLES)
        self.assertEqual(copy['iterations'], server.ITERATIONS)
        on_file = json.loads((ROOT / 'test_users.json').read_text())
        strip = lambda u: {k: u[k] for k in ('username', 'role', 'salt', 'password_hash')}
        self.assertEqual(copy['users'], [strip(u) for u in on_file],
                         'assets/accounts.js is out of date: run python3 server.py --export')

    def test_demo_accounts_sign_in_through_the_server(self):
        password, people = demo_accounts()
        with tempfile.TemporaryDirectory() as folder:
            original = server.ACCOUNTS
            server.ACCOUNTS = Path(folder) / 'test_users.json'
            server.ACCOUNTS.write_text((ROOT / 'test_users.json').read_text())
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                for username, role in people:
                    body = json.dumps(dict(username=username, password=password, role=role)).encode()
                    req = urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}/api/login', data=body, headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req) as response:
                        self.assertEqual(json.loads(response.read())['persona'], server.ROLES[role])
                # the demo-account list loads before sign-in; the hashes do not
                for name, status in [('demo-accounts.js', 200), ('session.js', 200), ('accounts.js', 401)]:
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/assets/{name}') as response:
                            code = response.status
                    except urllib.error.HTTPError as error:
                        code = error.code
                    self.assertEqual(code, status, name)
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.ACCOUNTS = original


if __name__ == '__main__':
    unittest.main()
