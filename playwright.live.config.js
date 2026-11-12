import { defineConfig, devices } from "@playwright/test";

// Smoke-tests the published cabinet; there is no local server to start.
const baseURL = process.env.LIVE_BASE_URL ?? "https://jdooley-clt.github.io/arcade/";

export default defineConfig({
  testDir: "test/browser",
  testMatch: /live-smoke\.spec\.js$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "live-smoke/playwright.json" }]],
  outputDir: "live-smoke/test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
