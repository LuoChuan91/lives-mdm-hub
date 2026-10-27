"""Bundle the prototype into one HTML file.

    python3 scripts/build_single_file.py             -> dist/mdm-request-hub.html
    python3 scripts/build_single_file.py --document  -> dist/mdm-request-hub-standalone.html
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SCRIPTS = ["assets/session.js", "assets/demo-accounts.js", "assets/accounts.js", "assets/data.js", "assets/engine.js",
           "assets/charts.js", "assets/app.js", "assets/insights.js", "assets/market.js", "assets/login.js"]
# shows the login card, or the app when this browser already has a session
BOOT = """(function () {
  var authRoot = document.getElementById('auth-root');
  var appRoot = document.getElementById('app-root');
  function open(user) {
    window.HUB_USER = user; window.HUB_AUTH = 'browser';
    authRoot.hidden = true; appRoot.hidden = false;
    window.App.start();
  }
  window.HUB_ON_LOGIN = open;
  var user = window.HubSession.read();
  if (user) open(user); else authRoot.hidden = false;
})();"""
FONTS = ("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600"
         "&family=IBM+Plex+Sans:wght@400;500;600&display=swap")


def inner_body(name: str) -> str:
    html = (ROOT / name).read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*?)</body>", html, re.S).group(1)
    body = re.sub(r"\s*<!--.*?-->", "", body, flags=re.S)
    return re.sub(r'\s*<script src="[^"]+"></script>', "", body).strip()


def body_markup() -> str:
    return (f'<div id="auth-root" class="auth-page" hidden>\n{inner_body("login.html")}\n</div>\n'
            f'<div id="app-root" hidden>\n{inner_body("index.html")}\n</div>')


def inline_js(path: str) -> str:
    code = (ROOT / path).read_text(encoding="utf-8")
    return code.replace("</script", "<\\/script")  # a literal end tag inside a string would close the block


def build(document: bool = False) -> Path:
    css = (ROOT / "assets" / "app.css").read_text(encoding="utf-8")
    parts = [
        "<title>MDM Request Hub</title>",
        '<meta name="description" content="Lives Group master data workspace: requests, approvals, the SAP '
        'Business One import file and the regional purchasing view.">',
        f'<link rel="stylesheet" href="{FONTS}">',
        f"<style>\n{css}\n</style>",
    ]
    # a hosted single page blocks downloads; a standalone file opened from disk does not
    scripts = [] if document else ["<script>window.HUB_ENV = 'single';</script>"]
    scripts += ["<script>window.HUB_SINGLE = true; window.HUB_DEFER_START = true;</script>"]
    scripts += [f"<script>\n{inline_js(p)}\n</script>" for p in SCRIPTS]
    scripts += [f"<script>\n{BOOT}\n</script>"]
    if document:
        page = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
                + "\n".join(parts) + "\n</head>\n<body>\n" + body_markup() + "\n" + "\n".join(scripts)
                + "\n</body>\n</html>\n")
        out = DIST / "mdm-request-hub-standalone.html"
    else:
        page = "\n".join(parts) + "\n" + body_markup() + "\n" + "\n".join(scripts) + "\n"
        out = DIST / "mdm-request-hub.html"
    DIST.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out


if __name__ == "__main__":
    path = build(document="--document" in sys.argv)
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} KB")
