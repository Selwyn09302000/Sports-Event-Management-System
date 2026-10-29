import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end checks against a production build on the local machine.
 * Start the server first (`npm run build && npm run start`) or let Playwright
 * reuse the one already on port 3000.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
