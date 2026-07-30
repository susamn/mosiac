import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:47500",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: ".venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 47500",
    cwd: "..",
    url: "http://localhost:47500/mosaic/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
