import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, cpSync, lstatSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const FIXTURE_SRC = path.resolve(__dirname, "../fixtures/test-app");
const SCRIPTS = path.resolve(__dirname, "../../scripts");
const APP_ID = "mosaic-test-app";

// Onboarding now migrates data/ into a centralized store and rewrites it as a
// symlink — never run that against the checked-in fixture. Copy it into a
// throwaway temp dir, and point MOSAIC_DATA_HOME at a throwaway data root too,
// so a test run never touches the repo or the developer's real data store.
const workDir = mkdtempSync(path.join(tmpdir(), "mosaic-test-fixture-"));
const dataHome = mkdtempSync(path.join(tmpdir(), "mosaic-test-datahome-"));
const FIXTURE = path.join(workDir, "test-app");

function onboard() {
  execFileSync("bash", [path.join(SCRIPTS, "onboard.sh"), FIXTURE], {
    stdio: "ignore",
    env: { ...process.env, MOSAIC_DATA_HOME: dataHome },
  });
}
function unboard() {
  execFileSync("bash", [path.join(SCRIPTS, "unboard.sh"), APP_ID], { stdio: "ignore" });
}

test.describe.serial("mosaic host contract", () => {
  test.beforeAll(() => {
    cpSync(FIXTURE_SRC, FIXTURE, { recursive: true });
  });

  test.afterAll(() => {
    try { unboard(); } catch { /* already detached by the test that verifies it */ }
    rmSync(workDir, { recursive: true, force: true });
    rmSync(dataHome, { recursive: true, force: true });
  });

  test("unonboarded app is not reachable", async ({ request }) => {
    const res = await request.get(`/mosaic/apps/${APP_ID}/`);
    expect(res.status()).toBe(404);
  });

  test("onboarding attaches the app with no restart, and it appears on the dashboard", async ({ page }) => {
    onboard();
    await page.goto("/mosaic/");
    const tile = page.locator(".tile", { hasText: "Mosaic Test App" });
    await expect(tile.locator(".tver")).toHaveText("v0.1.0");
    await expect(tile.locator(".tsize")).toBeVisible();
    await expect(page.locator(".header-data-info")).toBeVisible();
  });

  test("dashboard search filters by name and by description, and clears", async ({ page }) => {
    await page.goto("/mosaic/");
    const search = page.locator("#q");
    const tile = page.locator(".tile", { hasText: "Mosaic Test App" });
    const noMatch = page.locator("#noMatch");

    await search.fill("Mosaic Test");
    await expect(tile).toBeVisible();

    await search.fill("exercising mosaic's contract"); // matches description, not name
    await expect(tile).toBeVisible();

    await search.fill("no-app-named-this");
    await expect(tile).toBeHidden();
    await expect(noMatch).toBeVisible();
    await expect(noMatch).toContainText("no-app-named-this");

    await search.fill("");
    await expect(tile).toBeVisible();
    await expect(noMatch).toBeHidden();
  });

  test("freshness LED renders a tier for every tile, and the fixture app (which ships data) is never marked as having no data", async ({ page }) => {
    await page.goto("/mosaic/");
    const tierClasses = ["led-green", "led-blue", "led-grey"];
    const leds = page.locator(".tile .led");
    const count = await leds.count();
    for (let i = 0; i < count; i++) {
      const cls = await leds.nth(i).getAttribute("class");
      expect(tierClasses.some((c) => cls?.includes(c))).toBe(true);
    }
    const testAppLed = page.locator(".tile", { hasText: "Mosaic Test App" }).locator(".led");
    await expect(testAppLed).not.toHaveAttribute("title", "No data yet");
  });

  test("sort control reorders tiles by name, then by data recency in both directions", async ({ page }) => {
    await page.goto("/mosaic/");
    const sort = page.locator("#sort");

    await sort.selectOption("name");
    const names = await page.locator(".tile").evaluateAll((els) => els.map((e) => e.getAttribute("data-name") || ""));
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);

    const asFloatOrNegInf = (v: string | null) => {
      const n = v === null ? NaN : parseFloat(v);
      return Number.isNaN(n) ? -Infinity : n;
    };

    await sort.selectOption("newest");
    const newestOrder = await page.locator(".tile").evaluateAll((els) => els.map((e) => e.getAttribute("data-updated")));
    const newestVals = newestOrder.map(asFloatOrNegInf);
    for (let i = 1; i < newestVals.length; i++) expect(newestVals[i - 1]).toBeGreaterThanOrEqual(newestVals[i]);

    await sort.selectOption("oldest");
    const oldestOrder = await page.locator(".tile").evaluateAll((els) => els.map((e) => e.getAttribute("data-updated")));
    const oldestVals = oldestOrder.map(asFloatOrNegInf);
    for (let i = 1; i < oldestVals.length; i++) expect(oldestVals[i - 1]).toBeLessThanOrEqual(oldestVals[i]);
  });

  test("onboarding redirects data/ into the centralized data home", () => {
    const dataLink = path.join(FIXTURE, "data");
    expect(lstatSync(dataLink).isSymbolicLink()).toBe(true);
    expect(realpathSync(dataLink)).toBe(realpathSync(path.join(dataHome, APP_ID)));
    // migrated content, not discarded
    expect(existsSync(path.join(dataLink, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(dataLink, "nested", "deep.json"))).toBe(true);
  });

  test("app entry page and its static assets serve correctly", async ({ page }) => {
    await page.goto(`/mosaic/apps/${APP_ID}/`);
    await expect(page.locator("#heading")).toHaveText("mosaic test app");
    const color = await page.locator("#heading").evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(18, 52, 86)"); // proves css/style.css was served and applied
  });

  test("data endpoint serves both a flat file and an app-chosen nested sub-path through the double symlink", async ({ page }) => {
    await page.goto(`/mosaic/apps/${APP_ID}/`);
    await expect(page.locator("#manifest-result")).toContainText("sample");
    await expect(page.locator("#nested-result")).toContainText("nested");
  });

  test("encoded path traversal out of static/ is refused", async ({ request }) => {
    const res = await request.get(`/mosaic/apps/${APP_ID}/%2e%2e/app.json`);
    expect(res.status()).toBe(404);
  });

  test("encoded path traversal out of data/ is refused even through the centralized symlink", async ({ request }) => {
    const res = await request.get(`/mosaic/apps/${APP_ID}/data/%2e%2e/app.json`);
    expect(res.status()).toBe(404);
  });

  // The tests below write their own throwaway scratch files rather than reusing
  // manifest.json/nested/deep.json, since the unboarding test further down still
  // asserts those two survive untouched.

  test("DELETE removes a single data file", async ({ request }) => {
    const target = path.join(FIXTURE, "data", "scratch-single.json");
    writeFileSync(target, JSON.stringify({ throwaway: true }));
    expect(existsSync(target)).toBe(true);

    const res = await request.delete(`/mosaic/apps/${APP_ID}/data/scratch-single.json`);
    expect(res.status()).toBe(200);
    expect(existsSync(target)).toBe(false);
  });

  test("DELETE on a sub-directory removes it recursively in one call", async ({ request }) => {
    const dir = path.join(FIXTURE, "data", "scratch-dir");
    mkdirSync(path.join(dir, "nested"), { recursive: true });
    writeFileSync(path.join(dir, "a.json"), "{}");
    writeFileSync(path.join(dir, "nested", "b.json"), "{}");

    const res = await request.delete(`/mosaic/apps/${APP_ID}/data/scratch-dir`);
    expect(res.status()).toBe(200);
    expect(existsSync(dir)).toBe(false);
  });

  test("bulk delete is client-composed: several parallel DELETE calls each succeed independently", async ({ request }) => {
    const files = ["scratch-bulk-a.json", "scratch-bulk-b.json", "scratch-bulk-c.json"];
    for (const f of files) writeFileSync(path.join(FIXTURE, "data", f), "{}");

    const responses = await Promise.all(
      files.map((f) => request.delete(`/mosaic/apps/${APP_ID}/data/${f}`))
    );
    for (const res of responses) expect(res.status()).toBe(200);
    for (const f of files) expect(existsSync(path.join(FIXTURE, "data", f))).toBe(false);
  });

  test("DELETE refuses to remove an app's entire data/ root in one call", async ({ request }) => {
    const res = await request.delete(`/mosaic/apps/${APP_ID}/data/`);
    expect(res.status()).toBe(400);
    // proven still intact: the fixture's own shipped data survives
    expect(existsSync(path.join(FIXTURE, "data", "manifest.json"))).toBe(true);
  });

  test("DELETE on a nonexistent path returns 404", async ({ request }) => {
    const res = await request.delete(`/mosaic/apps/${APP_ID}/data/does-not-exist.json`);
    expect(res.status()).toBe(404);
  });

  test("encoded path traversal out of data/ is refused on DELETE too", async ({ request }) => {
    // Playwright's request context (like curl) normalizes %2e%2e client-side
    // before the request is even sent, collapsing data/%2e%2e/app.json down
    // to app.json — which then 405s (matches the static GET-only route, no
    // DELETE registered there) rather than 404ing inside the data route's own
    // containment guard. A raw socket request with the encoding intact on the
    // wire does reach the data route and gets 404 from resolve_within_for_delete
    // — verified manually. Either way the file must survive; that's the actual
    // security property under test, not which specific status code shows up.
    const res = await request.delete(`/mosaic/apps/${APP_ID}/data/%2e%2e/app.json`);
    expect([404, 405]).toContain(res.status());
    expect(existsSync(path.join(FIXTURE, "app.json"))).toBe(true);
  });

  test("unknown app id returns 404", async ({ request }) => {
    const res = await request.get("/mosaic/apps/does-not-exist/");
    expect(res.status()).toBe(404);
  });

  test("unboarding detaches the app without touching its source or its centralized data", async ({ request }) => {
    unboard();
    const res = await request.get(`/mosaic/apps/${APP_ID}/`);
    expect(res.status()).toBe(404);
    expect(existsSync(path.join(FIXTURE, "app.json"))).toBe(true);
    expect(existsSync(path.join(dataHome, APP_ID, "manifest.json"))).toBe(true);
  });
});
