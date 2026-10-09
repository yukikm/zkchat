import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.ZKCHAT_TEST_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid test port");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
