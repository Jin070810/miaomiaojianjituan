import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

assert.equal(process.env.CI, "true");
assert.equal(process.env.POSTGRES_DB, "miaomiao_staging");
const evidence = process.argv[2];
assert.ok(evidence);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
    const response = await page.goto("https://localhost/login");
    assert.equal(response.status(), 503);
    assert.equal(response.headers()["cache-control"], "no-store");
    assert.equal(response.headers()["x-miaomiao-maintenance"], "1");
    await page.getByRole("heading", { name: "系统正在更新" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const button = page.getByRole("button", { name: "刷新页面" });
    assert.ok((await button.boundingBox()).height >= 44);
    await Promise.all([page.waitForNavigation(), button.click()]);
    await page.getByRole("heading", { name: "系统正在更新" }).waitFor();
    const api = await page.request.post("https://localhost/api/__release_gate_probe");
    assert.equal(api.status(), 503);
    assert.equal((await api.json()).maintenance, true);
    assert.equal((await page.request.get("https://localhost/api/health/ready")).status(), 503);
    assert.equal((await page.request.get("https://localhost/api/health")).status(), 200);
    await page.screenshot({ path: `${evidence}/maintenance-${viewport.width}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Maintenance page, reload and gate passed at 390×844 and 1440×900");
