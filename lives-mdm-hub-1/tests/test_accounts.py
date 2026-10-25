"""Exercise account persistence, session checks, and private-file protection."""
import http.cookiejar
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
import server

class AccountsTest(unittest.TestCase):
    def test_account_lifecycle(self):
        with tempfile.TemporaryDirectory() as folder:
            original = server.ACCOUNTS
            server.ACCOUNTS = Path(folder) / 'test_users.json'
            server.ACCOUNTS.write_text((server.ROOT / 'test_users.json').read_text())
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            base = f'http://127.0.0.1:{httpd.server_port}'
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            def request(path, data=None):
                req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type': 'application/json'})
                try:
                    with client.open(req) as response:
                        return response.status, response.read()
                except urllib.error.HTTPError as error:
                    return error.code, error.read()
            try:
                credentials = dict(username='tester', password='test-password-42', role='finance')
                self.assertEqual(request('/api/me')[0], 401)
                self.assertEqual(request('/api/login', dict(username='testuser', password='TestUser123!', role='requester'))[0], 200)
                self.assertEqual(request('/api/logout', {})[0], 200)
                self.assertEqual(request('/api/register', credentials)[0], 200)
                self.assertEqual(json.loads(request('/api/me')[1])['persona'], 'weijie')
                self.assertNotIn(credentials['password'], server.ACCOUNTS.read_text())
                self.assertEqual(request('/api/register', credentials)[0], 409)
                self.assertEqual(request('/test_users.json')[0], 404)
                self.assertEqual(request('/server.py')[0], 404)
                self.assertEqual(request('/api/logout', {})[0], 200)
                self.assertEqual(request('/api/me')[0], 401)
                self.assertEqual(request('/api/login', {**credentials, 'role': 'mdm'})[0], 401)
                self.assertEqual(request('/api/login', credentials)[0], 200)
                self.assertEqual(request('/api/register', {**credentials, 'username': 'other', 'role': 'invalid'})[0], 400)
                server.ACCOUNTS.write_text('')
                status, body = request('/api/login', credentials)
                self.assertEqual(status, 500)
                self.assertIn('test_users.json', json.loads(body)['error'])
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.ACCOUNTS = original

if __name__ == '__main__':
    unittest.main()
