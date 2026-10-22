"""Bundle the prototype into one self-contained HTML file.

GitHub Pages serves index.html and assets/ as they are; this script is only for hosts that take a
single page (for example a Claude artifact). It inlines the stylesheet and every script, keeps the
Google Fonts link, and sets HUB_ENV so the page hides the "Download CSV" buttons, which such hosts
block (the "Copy CSV" buttons still work).

    python scripts/build_single_file.py            ->  dist/mdm-request-hub.html
    python scripts/build_single_file.py --document ->  a full HTML document (doctype, head, body)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SCRIPTS = ["assets/data.js", "assets/engine.js", "assets/charts.js", "assets/app.js", "assets/insights.js"]
FONTS = ("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600"
         "&family=IBM+Plex+Sans:wght@400;500;600&display=swap")


def body_markup() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    return re.sub(r'\s*<script src="[^"]+"></script>', "", body).strip()


def inline_js(path: str) -> str:
    code = (ROOT / path).read_text(encoding="utf-8")
    return code.replace("</script", "<\\/script")  # a literal end tag inside a string would close the block


def build(document: bool = False) -> Path:
    css = (ROOT / "assets" / "app.css").read_text(encoding="utf-8")
    parts = [
        "<title>MDM Request Hub</title>",
        '<meta name="claude:viewport-fit-sides" content="cover">',
        '<meta name="description" content="Prototype for the SMU DSA 2026 Data Case Competition: a master data '
        'request hub and regional purchasing view for Lives Group (synthetic data).">',
        f'<link rel="stylesheet" href="{FONTS}">',
        f"<style>\n{css}\n</style>",
    ]
    # a hosted single page blocks downloads; a standalone file opened from disk does not
    scripts = [] if document else ["<script>window.HUB_ENV = 'single';</script>"]
    scripts += [f"<script>\n{inline_js(p)}\n</script>" for p in SCRIPTS]
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
