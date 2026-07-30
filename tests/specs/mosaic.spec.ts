import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, cpSync, lstatSync, realpathSync } from "node:fs";
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
    await expect(tile).toBeVisible();
    await expect(tile.locator(".tdesc")).toHaveText("Playwright fixture app for exercising mosaic's contract");
    await expect(tile.locator(".tver")).toHaveText("v0.1.0");
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
