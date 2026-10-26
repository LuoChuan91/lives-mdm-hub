"""Render the diagram SVGs to PNG at 2x with a headless browser (Playwright + Chromium).

    python docs/diagrams/render_png.py            # every *.svg in this folder
    python docs/diagrams/render_png.py erd.svg    # one file
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright  # noqa: E402

HERE = Path(__file__).resolve().parent


def render(paths, scale=2):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path in paths:
            svg = path.read_text()
            w, h = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups())
            page = browser.new_page(viewport={"width": int(w), "height": int(h)}, device_scale_factor=scale)
            page.set_content(f"<html><body style='margin:0;background:#fff'>{svg}</body></html>")
            page.wait_for_timeout(150)
            out = path.with_suffix(".png")
            page.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": w, "height": h})
            page.close()
            print(f"{out.name}: {int(w * scale)} x {int(h * scale)}")
        browser.close()


if __name__ == "__main__":
    names = sys.argv[1:] or [p.name for p in sorted(HERE.glob("*.svg"))]
    render([HERE / n for n in names])
