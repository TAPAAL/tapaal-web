// Exercise real startup and ID creation on a non-localhost HTTP origin.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('randomUUID'))
      errors.push(message.text());
  });
  await page.goto(process.argv[2], { waitUntil: 'networkidle' });
  const environment = await page.evaluate(() => ({
    secure: isSecureContext,
    randomUUID: typeof crypto.randomUUID,
    randomBytes: typeof crypto.getRandomValues,
  }));
  console.log(JSON.stringify({ environment, errors }));
  assert.equal(environment.secure, false, 'Regression must run on insecure HTTP');
  assert.equal(environment.randomUUID, 'undefined');
  assert.deepEqual(errors, [], 'Startup must not throw');
  await page.locator('svg.net-canvas').waitFor();
  await page.getByRole('button', { name: 'New model', exact: true }).first().click();
  await page.locator('#new-model-name').fill('HTTP test');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'HTTP test (modified)', exact: true }).waitFor();
  await page
    .locator('.component-actions')
    .getByRole('button', { name: 'Add…', exact: true })
    .click();
  await page.locator('#new-component-name').fill('Extra');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.component-row').filter({ hasText: 'Extra' }).waitFor();
  await page
    .locator('app-constants-pane')
    .getByRole('button', { name: 'Add…', exact: true })
    .click();
  await page.locator('#constant-name').fill('Limit');
  await page.locator('#constant-value').fill('5');
  await page
    .locator('app-constant-dialog')
    .getByRole('button', { name: 'OK', exact: true })
    .click();
  await page.locator('app-constants-pane summary').filter({ hasText: 'Limit = 5' }).waitFor();
  await page
    .locator('app-shared-places-pane')
    .getByRole('button', { name: 'New…', exact: true })
    .click();
  await page.locator('app-shared-place-dialog input[name="name"]').fill('Shared');
  await page
    .locator('app-shared-place-dialog')
    .getByRole('button', { name: 'OK', exact: true })
    .click();
  await page.locator('app-shared-places-pane summary').filter({ hasText: 'Shared' }).waitFor();
  assert.deepEqual(errors, [], 'Creating a document must not throw');
  console.log('PASS insecure HTTP startup, New model, component, constant and shared place');
} finally {
  await browser.close();
}
