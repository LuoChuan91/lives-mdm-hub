"""End-to-end check in a real browser (Playwright + Chromium).

Serves the repo, opens every page, walks the demo path, fails on any page error, and saves
screenshots to docs/screenshots/. Run:

    python tests/e2e.py
    python tests/e2e.py /dist/mdm-request-hub-standalone.html   # test a bundled build instead
"""
from __future__ import annotations

import functools
import http.server
import os
import socketserver
import sys
import threading
from pathlib import Path

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
ROUTES = ["home", "request", "approvals", "tracker", "desk", "admin", "regional", "inbox", "case"]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def shot(page, name, full=True):
    """Full-page captures resize the page under the hood; settle afterwards so later clicks land."""
    page.evaluate("(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.scrollTo(0, 0); })()")
    page.wait_for_timeout(60)
    page.screenshot(path=str(SHOTS / name), full_page=full)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(120)


def main(target: str | None = None):
    SHOTS.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    local = f"http://127.0.0.1:{httpd.server_address[1]}"
    base = (local + target if target and target.startswith("/") else target) or f"{local}/index.html"
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def page_for(scheme="light", width=1366, height=900):
            ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme, device_scale_factor=1)
            ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
            ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and "fonts" not in m.text and "Failed to load resource" not in m.text else None)
            return pg

        pg = page_for()
        pg.goto(base)
        pg.wait_for_selector("#view h1")
        for r in ROUTES:
            pg.evaluate(f"App.go('{r}')")
            pg.wait_for_timeout(150)
            assert pg.locator("#view h1").count() == 1, f"{r}: no heading"
            shot(pg, f"{r}.png")
            width = pg.evaluate("document.documentElement.scrollWidth")
            assert width <= 1366, f"{r}: horizontal overflow {width}px"

        # Demo path
        pg.evaluate("App.go('home')")
        pg.click("text=Start as Amy")
        pg.select_option("#f-bu", "SPD")
        pg.fill("#f-description", "HbA1c Reagent Kit, 200 tests")
        pg.select_option("#f-product_line", "A")
        pg.select_option("#f-category", "IVD reagent")
        assert pg.locator("#f-licence_no").count() == 1, "licence field should appear for IVD reagent"
        assert "Dr Siti" in pg.inner_text("#route-panel"), "Quality/Regulatory should join the route"
        assert "Possible duplicate" in pg.inner_text("#dup-panel"), "pack-size near-duplicate should be flagged"
        pg.click("text=None of these: it is different")
        pg.fill("#f-dup-reason", "New 200-test pack, different item")
        pg.fill("#f-licence_no", "DE5512093")
        pg.select_option("#f-storage", "2-8 °C")
        pg.fill("#f-manufacturer", "Meridian Dx")
        pg.fill("#f-mfr_part_no", "MER-60211")
        pg.select_option("#f-uom", "kit")
        pg.fill("#f-list_price", "240")
        shot(pg, "demo-1-amy-form.png")
        pg.click("text=Submit request")
        pg.wait_for_function("App.getUI().lastSubmitted !== null", timeout=5000)
        new_id = pg.evaluate("App.getUI().lastSubmitted")
        assert new_id and new_id.startswith("REQ-"), "request should be created"

        pg.evaluate("App.go('home')")
        pg.click("text=Start as Marcus")
        pg.wait_for_selector("#dup-panel .dup.likely")
        assert "National University Hospital" in pg.inner_text("#dup-panel")
        shot(pg, "demo-2-marcus-duplicate.png")
        pg.click("#dup-panel >> text=Use this record")
        assert pg.evaluate("App.getState().stats.duplicatesStopped") >= 2

        pg.evaluate("App.go('home')")
        pg.click("text=Open as Wei Jie")
        pg.wait_for_selector(".teams-card")
        shot(pg, "demo-3-weijie-approvals.png")
        before = pg.locator(".teams-card").count()
        reveal = pg.locator(".teams-card >> text=Show").first
        if reveal.count():
            reveal.click()
        pg.locator(".teams-card .btn.teams").first.click()
        pg.wait_for_timeout(100)
        assert pg.locator(".teams-card").count() == before - 1, "approved card should leave the queue"

        pg.click("text=Next working day")
        pg.wait_for_timeout(100)
        assert "Fri 2 Oct" in pg.inner_text(".clock-time")

        pg.evaluate("App.go('home')")
        pg.click("text=Open Settings as Priya")
        pg.fill("#bu-code", "QTV")
        pg.fill("#bu-name", "Vietnam clinical solutions")
        pg.fill("#bu-head", "Linh")
        pg.click("text=Add business unit")
        pg.wait_for_timeout(100)
        assert pg.evaluate("App.getState().config.businessUnits.some(b => b.code === 'QTV')")
        shot(pg, "demo-5-priya-settings.png")

        pg.evaluate("App.go('desk')")
        pg.locator("text=Pass check and assign SAP code").first.click()
        pg.evaluate("App.getUI().deskTab = 'import'; App.render()")
        shot(pg, "demo-6-import-file.png")
        pg.locator("text=Mark as imported into SAP B1").first.click()
        pg.evaluate("App.getUI().deskTab = 'health'; App.render()")
        shot(pg, "desk-health.png")
        pg.evaluate("App.getUI().deskTab = 'audit'; App.render()")
        shot(pg, "desk-audit.png")

        pg.evaluate("App.go('regional')")
        pg.click("text=As in SAP B1 today")
        pg.wait_for_timeout(100)
        shot(pg, "regional-raw.png")
        pg.click("text=Duplicates merged")
        pg.click("text=By country")
        pg.click("[data-action='product'][data-product='C']")
        shot(pg, "regional-by-country.png")

        pg.evaluate("App.go('inbox')")
        pg.locator("[data-action='inbox-example']").nth(4).click()
        shot(pg, "inbox-example.png")

        pg.evaluate("App.go('case')")
        pg.locator("#sim-appr").fill("3")
        pg.wait_for_timeout(300)
        shot(pg, "case-slider.png")

        # reload keeps state
        pg.reload()
        pg.wait_for_selector("#view h1")
        assert pg.evaluate(f"App.getState().requests.some(r => r.id === '{new_id}')"), "state should persist across reload"

        # dark mode and phone width
        dk = page_for("dark")
        dk.goto(base)
        dk.wait_for_selector("#view h1")
        for r in ["home", "regional", "approvals", "case"]:
            dk.evaluate(f"App.go('{r}')")
            dk.wait_for_timeout(120)
            shot(dk, f"dark-{r}.png")
        ph = page_for("light", 390, 844)
        ph.goto(base)
        ph.wait_for_selector("#view h1")
        for r in ["home", "request", "approvals", "regional", "tracker"]:
            ph.evaluate(f"App.go('{r}')")
            ph.wait_for_timeout(120)
            w = ph.evaluate("document.documentElement.scrollWidth")
            if w > 390:
                errors.append(f"phone {r}: page is {w}px wide")
            shot(ph, f"phone-{r}.png", full=False)
        browser.close()
    httpd.shutdown()
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print("e2e passed; screenshots in docs/screenshots/")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
