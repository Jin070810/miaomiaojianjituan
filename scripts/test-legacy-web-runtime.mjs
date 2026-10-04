// Original-image qualification only: internal Docker network, synthetic DB.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

assert.equal(process.env.CI, 'true');
assert.equal(process.env.LEGACY_INTERNAL_NETWORK, 'true');
const directory = process.argv[2];
assert.ok(directory?.startsWith(`${process.env.RUNNER_TEMP}/legacy-qualification.`));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    let responses = 0, failedRequests = 0, serverErrors = 0;
    page.on('response', response => { responses++; if (response.status() >= 500) serverErrors++; });
    page.on('requestfailed', () => failedRequests++);
    const response = await page.goto('http://app:3000/login', { waitUntil: 'networkidle', timeout: 30_000 });
    assert.equal(response.status(), 200);
    results.push({ viewport, status: response.status(), responses, failedRequests, serverErrors });
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${directory}/web-runtime.json`, JSON.stringify({ isolatedSyntheticData: true, results }));
