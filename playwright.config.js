import { defineConfig, devices } from "@playwright/test";

// A dedicated port keeps the gate away from `npm start` (4173) and other previews.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4180);
const baseURL = `http://127.0.0.1:${port}/`;

export default defineConfig({
  testDir: "test/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve.mjs",
    url: baseURL,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 30_000
  }
});
