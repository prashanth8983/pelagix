"""The app in a real browser, against a running stack (`make api`, `make zero`, `make app`).

    E2E_BASE_URL=http://localhost:3000 make e2e

Needs an empty scorebase_auth.users table (it creates the first admin), or E2E_ADMIN_EMAIL and
E2E_ADMIN_PASSWORD for an existing admin. It creates a viewer account named e2e-viewer-<random>.
"""
import os
import secrets

import pytest

pw = pytest.importorskip("playwright.sync_api")
BASE = os.environ.get("E2E_BASE_URL")
pytestmark = pytest.mark.skipif(not BASE, reason="set E2E_BASE_URL to run browser tests")

ADMIN = os.environ.get("E2E_ADMIN_EMAIL", "admin@scorebase.test")
ADMIN_PW = os.environ.get("E2E_ADMIN_PASSWORD", secrets.token_urlsafe(12))


@pytest.fixture(scope="module")
def page():
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        # A fetch aborted because a test navigated away mid-request isn't an app error.
        pg.on("console", lambda m: m.type == "error" and "Failed to fetch" not in m.text and errors.append(m.text))
        pg.goto(BASE + "/")
        pw.expect(pg).to_have_url(BASE + "/login?next=%2F")
        if pg.get_by_text("Create the admin account").is_visible():
            pw.expect(pg.get_by_role("button", name="Create account")).to_be_enabled()
            pg.get_by_label("Name").fill("E2E Admin")
            pg.get_by_label("Email").fill(ADMIN)
            for el in pg.locator("input[type=password]").all():
                el.fill(ADMIN_PW)
            pg.get_by_role("button", name="Create account").click()
        else:
            sign_in(pg, ADMIN, ADMIN_PW)
        pw.expect(pg).to_have_url(BASE + "/", timeout=15000)
        yield pg
        assert errors == [], f"console errors: {errors[:5]}"
        browser.close()


def sign_in(pg, email, password):
    pw.expect(pg.get_by_role("button", name="Sign in")).to_be_enabled()
    pg.get_by_label("Email").fill(email)
    pg.get_by_label("Password").fill(password)
    pg.get_by_role("button", name="Sign in").click()


def visit(pg, path):
    pg.goto(BASE + path)
    pg.wait_for_selector("html[data-hydrated]", state="attached", timeout=15000)


def test_overview_syncs_live(page):
    visit(page, "/")
    pw.expect(page.get_by_role("tab", name="Never bought")).to_be_visible(timeout=20000)
    pw.expect(page.locator("tbody tr").first).to_be_visible()
    page.locator("tbody tr").first.click()
    pw.expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")


def test_verified_answer(page):
    visit(page, "/")
    page.get_by_placeholder("Ask a question").fill("Who are my VIP customers?")
    page.keyboard.press("Enter")
    pw.expect(page.get_by_text("Verified", exact=True)).to_be_visible(timeout=10000)


def test_guard_blocks_writes_in_the_workspace(page):
    visit(page, "/explore")
    page.locator("textarea").fill("COPY (SELECT 1) TO '/tmp/x.csv'")
    page.get_by_role("button", name="Run", exact=True).click()
    pw.expect(page.get_by_text("blocked: only SELECT queries are allowed")).to_be_visible()


def test_editing_shows_the_save_bar_and_live_size(page):
    visit(page, "/configure/segments")
    page.get_by_text("At risk", exact=True).first.click()
    page.locator("input[type=number]").first.fill("0.5")
    pw.expect(page.get_by_text("Unsaved changes")).to_be_visible()
    pw.expect(page.get_by_text("WHERE churn_risk > 0.5")).to_be_visible()
    page.get_by_role("button", name="Discard").click()


def test_command_palette_navigates(page):
    visit(page, "/")
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_placeholder("Search pages and actions").fill("pipeline runs")
    page.keyboard.press("Enter")
    pw.expect(page).to_have_url(BASE + "/runs")


def test_viewer_is_limited(page):
    email = f"e2e-viewer-{secrets.token_hex(3)}@scorebase.test"
    visit(page, "/admin/users")
    page.get_by_label("Email").fill(email)
    page.get_by_role("button", name="Add user").click()
    temp = page.locator("code").first.inner_text()
    page.context.clear_cookies()
    page.goto(BASE + "/login")
    sign_in(page, email, temp)
    pw.expect(page).to_have_url(BASE + "/account", timeout=15000)
    new = secrets.token_urlsafe(12)
    page.get_by_label("Current password").fill(temp)
    page.locator("input[autocomplete=new-password]").first.fill(new)
    page.get_by_label("Confirm new password").fill(new)
    page.get_by_role("button", name="Change password").click()
    pw.expect(page.get_by_text("Password changed")).to_be_visible()
    visit(page, "/configure/scores")
    pw.expect(page).to_have_url(BASE + "/")
    assert page.get_by_role("link", name="Scores").count() == 0
    assert page.get_by_role("button", name="Run pipeline").count() == 0
    page.context.clear_cookies()
    page.goto(BASE + "/login")
    sign_in(page, ADMIN, ADMIN_PW)
    pw.expect(page).to_have_url(BASE + "/", timeout=15000)


def test_wrong_password_is_refused(page):
    page.context.clear_cookies()
    page.goto(BASE + "/login")
    sign_in(page, ADMIN, "not-the-password")
    pw.expect(page.get_by_text("Wrong email or password")).to_be_visible()
    sign_in(page, ADMIN, ADMIN_PW)
    pw.expect(page).to_have_url(BASE + "/", timeout=15000)


def test_health_and_security_headers(page):
    r = page.request.get(BASE + "/api/health")
    assert r.status == 200 and r.json()["ok"]
    h = page.request.get(BASE + "/login").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and h["x-request-id"]
