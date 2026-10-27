"""Browser test (Playwright): signs in as each person, opens every page and walks the demo path.

    python tests/e2e.py
    python tests/e2e.py /dist/mdm-request-hub-standalone.html
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
ROUTES = ["home", "request", "approvals", "tracker", "desk", "admin", "regional", "market", "inbox", "case"]


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


def sign_in(page, url, user, role=None):
    """Open the login form and sign in with a demo account (the login page fills in the password)."""
    page.goto(url)
    page.wait_for_selector("#auth-form", state="visible")
    page.click(f"[data-user='{user}']")
    page.click("#auth-submit")
    page.wait_for_selector("#view h1")
    assert page.inner_text("#account-name") == user, f"should be signed in as {user}"


def switch_to(page, user):
    """Log out from the top bar and sign in as the next person, as the demo video does."""
    page.click(".topbar [data-action='logout']")
    page.wait_for_selector("#auth-form", state="visible")
    page.click(f"[data-user='{user}']")
    page.click("#auth-submit")
    page.wait_for_selector("#view h1")
    assert page.inner_text("#account-name") == user


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
        pg.wait_for_selector("#auth-form", state="visible")
        shot(pg, "login.png", full=False)
        # wrong password is refused
        pg.fill("input[name=username]", "priya")
        pg.fill("input[name=password]", "not-the-password")
        pg.select_option("select[name=role]", "mdm")
        pg.click("#auth-submit")
        pg.wait_for_selector("#auth-error", state="visible")
        assert "incorrect" in pg.inner_text("#auth-error")

        sign_in(pg, base, "priya")
        pg.evaluate("App.go('request')")
        assert pg.evaluate("App.getUI().route") == "home", "only requesters open the request form"
        for r in [r for r in ROUTES if r != "request"]:
            pg.evaluate(f"App.go('{r}')")
            pg.wait_for_timeout(150)
            assert pg.locator("#view h1").count() == 1, f"{r}: no heading"
            shot(pg, f"{r}.png")
            width = pg.evaluate("document.documentElement.scrollWidth")
            assert width <= 1366, f"{r}: horizontal overflow {width}px"

        # Demo path: each step signed in as the person who does it
        switch_to(pg, "amy")
        assert pg.query_selector(".nav a[data-route='desk']") is None, "requesters do not see the MDM desk"
        assert "Your requests" in pg.inner_text("#view"), "requesters see their own requests on the home page"
        pg.click(".nav a[data-route='request']")
        pg.click("[data-action='domain'][data-domain='item']")
        shot(pg, "request.png")
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

        switch_to(pg, "marcus")
        pg.click(".nav a[data-route='request']")
        pg.click("[data-action='domain'][data-domain='customer']")
        pg.locator("#f-legal_name").press_sequentially("Natl Univ Hosp", delay=20)
        pg.wait_for_selector("#dup-panel .dup.likely")
        assert "National University Hospital" in pg.inner_text("#dup-panel")
        shot(pg, "demo-2-marcus-duplicate.png")
        pg.click("#dup-panel >> text=Use this record")
        assert pg.evaluate("App.getState().stats.duplicatesStopped") >= 2

        switch_to(pg, "weijie")
        assert "Waiting for you" in pg.inner_text("#view"), "approvers see their open steps on the home page"
        pg.click(".nav a[data-route='approvals']")
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

        switch_to(pg, "priya")
        assert "Fri 2 Oct" in pg.inner_text(".clock-time"), "the clock Wei Jie moved should carry over to Priya"
        pg.click(".nav a[data-route='admin']")
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

        pg.evaluate("App.go('market')")
        pg.click("[data-action='mk-preset'][data-key='none']")
        pg.wait_for_timeout(100)
        assert "+SGD 0" in pg.inner_text("#mk-tiles") or "SGD 0" in pg.inner_text("#mk-tiles"), "no-change scenario should show no change"
        pg.click("[data-action='mk-preset'][data-key='stress']")
        pg.wait_for_timeout(100)
        assert "−" in pg.inner_text("#mk-tiles"), "stress scenario should lower order value"
        pg.locator("#mk-fx-ID").fill("10")
        pg.wait_for_timeout(150)
        assert "IDR 10% weaker" in pg.inner_text("#view")
        shot(pg, "market-stress.png")

        pg.evaluate("App.go('inbox')")
        pg.locator("[data-action='inbox-example']").nth(4).click()
        shot(pg, "inbox-example.png")

        pg.evaluate("App.go('case')")
        pg.locator("#sim-appr").fill("3")
        pg.wait_for_timeout(300)
        shot(pg, "case-slider.png")

        # reload keeps the session and the state
        pg.reload()
        pg.wait_for_selector("#view h1")
        assert pg.inner_text("#account-name") == "priya", "session should survive a reload"
        assert pg.evaluate(f"App.getState().requests.some(r => r.id === '{new_id}')"), "state should persist across reload"
        pg.click(".topbar [data-action='logout']")
        pg.wait_for_selector("#auth-form", state="visible")

        # dark mode and phone width
        dk = page_for("dark")
        sign_in(dk, base, "priya")
        for r in ["home", "regional", "approvals", "case"]:
            dk.evaluate(f"App.go('{r}')")
            dk.wait_for_timeout(120)
            shot(dk, f"dark-{r}.png")
        ph = page_for("light", 390, 844)
        ph.goto(base)
        ph.wait_for_selector("#auth-form", state="visible")
        w = ph.evaluate("document.documentElement.scrollWidth")
        if w > 390:
            errors.append(f"phone login: page is {w}px wide")
        shot(ph, "phone-login.png", full=False)
        sign_in(ph, base, "amy")
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
