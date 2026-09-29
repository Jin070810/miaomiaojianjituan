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
      name: "member-android-320",
      use: { viewport: { width: 320, height: 568 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-android-360",
      use: { viewport: { width: 360, height: 800 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-android-390",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-android-412",
      use: { viewport: { width: 412, height: 915 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-ios-375",
      use: { browserName: "webkit", viewport: { width: 375, height: 812 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-ios-390",
      use: { browserName: "webkit", viewport: { width: 390, height: 844 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-ios-430",
      use: { browserName: "webkit", viewport: { width: 430, height: 932 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-mobile-landscape",
      use: { viewport: { width: 568, height: 320 } },
      testMatch: /member-mobile-matrix\.spec\.ts/,
    },
    {
      name: "member-growth-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /member-growth\.spec\.ts/,
    },
    {
      name: "admin-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: [/admin-weekly-challenge\.spec\.ts/, /admin-responsive\.spec\.ts/],
    },
    {
      name: "admin-mobile",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: [/admin-mobile\.spec\.ts/, /admin-responsive\.spec\.ts/],
    },
    {
      name: "birthday-mobile",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: /birthday-system\.spec\.ts/,
    },
    {
      name: "birthday-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /birthday-system\.spec\.ts/,
    },
  ],
  // CI 用生产构建跑 e2e（next start），与发布的 standalone 行为一致；
  // 本地默认仍是 dev server，便于断点调试。生产模式需要先执行 npm run build。
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1" ? undefined : process.env.PLAYWRIGHT_PROD_SERVER === "1" ? {
    command: "npx next start --hostname 127.0.0.1 --port 3213",
    url: "http://127.0.0.1:3213/login",
    reuseExistingServer: false,
    timeout: 300_000,
  } : {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3213",
    url: "http://127.0.0.1:3213/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
