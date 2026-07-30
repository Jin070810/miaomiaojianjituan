import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "output/playwright/results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3213",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "member-mobile",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: [/member-weekly-challenge\.spec\.ts/, /member-growth\.spec\.ts/],
    },
    {
      name: "member-growth-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /member-growth\.spec\.ts/,
    },
    {
      name: "admin-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /admin-weekly-challenge\.spec\.ts/,
    },
    {
      name: "admin-mobile",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: /admin-mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3213",
    url: "http://127.0.0.1:3213/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
