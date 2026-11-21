// Independent review: only real UI actions; ng reads are assertions only.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const out =
  process.env.REVIEW_OUT ??
  (process.env.SKIP_MODELS
    ? '/tmp/tapaal-independent-review/modal'
    : '/tmp/tapaal-independent-review/gallery');
mkdirSync(out, { recursive: true });
const catalog = JSON.parse(
  readFileSync(new URL('../src/app/example-catalog.json', import.meta.url)),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const results = [];
const state = () =>
  page.evaluate(() => {
    const a = window.ng.getComponent(document.querySelector('app-root'));
    return {
      workspace: a.workspace(),
      net: a.net(),
      pending: !!a.pending(),
      cursor: a.cursor(),
      counts: a.modelCounts(),
      dirty: a.dirty(),
    };
  });
const show = async (name) => {
  await page.locator('.file-menu summary').click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  await page.getByRole('searchbox').fill(name);
};
const accept = async () => {
  await page.waitForTimeout(100);
  if (await page.locator('#cancel-open').count())
    await page.getByRole('button', { name: 'Open in new tab', exact: true }).click();
};
const stable = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4427');
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  // Make a dirty original through real input, then preserve its history on every gallery open.
  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  const box = await page.locator('svg.net-canvas').boundingBox();
  await page.mouse.click(box.x + 410, box.y + 390, { button: 'middle' });
  await page.keyboard.press('Escape');
  const original = (await state()).workspace.documents[0];
  assert(original.past.length > 0);
  for (const entry of catalog.filter((e) => !e.reason && !process.env.SKIP_MODELS)) {
    const before = await state();
    await show(entry.label);
    await page.getByRole('button', { name: 'Open ' + entry.label, exact: true }).click();
    await page.locator('app-example-gallery').waitFor({ state: 'detached' });
    await accept();
    const opened = await state();
    assert.equal(opened.workspace.documents.length, before.workspace.documents.length + 1);
    for (const key of ['network', 'past', 'future'])
      assert.deepEqual(opened.workspace.documents[0][key], original[key]);
    const doc = opened.workspace.documents.at(-1);
    assert.equal(doc.past.length, 0);
    assert.equal(doc.future.length, 0);
    assert.equal(opened.cursor, 0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save TAPAAL file', exact: true }).click();
    const d = await downloadPromise;
    const file = out + '/' + entry.filename;
    await d.saveAs(file);
    await page.locator('input[type=file]').setInputFiles(file);
    await accept();
    const reopened = (await state()).workspace.documents.at(-1);
    assert.equal(
      stable(reopened.network),
      stable(doc.network),
      entry.label + ' semantic save/reopen',
    );
    assert.equal((await state()).cursor, 0);
    results.push({
      name: entry.label,
      independent: true,
      initialNetworkSaveReopen: true,
      counts: opened.counts,
      xml: entry.stats,
    });
    console.log('PASS save/reopen ' + entry.label);
    writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
  }
  // Modal keyboard wrapping and focus return, with real key input.
  await show('alternating-bit-protocol-components');
  assert.match(
    await page.locator('app-example-gallery article button').getAttribute('title'),
    /24 place occurrences/,
  );
  await page.keyboard.press('Escape');
  await show('this example does not exist');
  assert(await page.getByText('No examples match your filters.').isVisible());
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page
    .locator('app-example-gallery article')
    .nth(catalog.length - 1)
    .waitFor({ state: 'attached' });
  assert.equal(await page.locator('app-example-gallery article').count(), catalog.length);
  assert.equal(await page.locator('app-example-gallery [download]').count(), 0);
  await page.keyboard.press('Escape');
  await show('referendum');
  assert(await page.getByRole('searchbox').evaluate((e) => e === document.activeElement));
  console.log('PASS modal search focused');
  const disabled = await page
    .locator('app-example-gallery article button')
    .evaluateAll((bs) => bs.every((b) => b.disabled));
  assert(disabled);
  const galleryBefore = await state();
  await page.keyboard.press('Escape');
  assert.deepEqual((await state()).workspace, galleryBefore.workspace);
  assert.equal(await page.locator('.command-toolbar').getByText('Example nets…').count(), 0);
  assert(await page.locator('.file-menu summary').evaluate((e) => e === document.activeElement));
  await page.locator('.file-menu summary').click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  await page.getByRole('searchbox').waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('input[type=search]'));
  await page.keyboard.press('Escape');
  await page.locator('app-example-gallery').waitFor({ state: 'detached' });
  console.log('PASS menu close');
  assert(
    await page.locator('.file-menu summary').evaluate((e) => e === document.activeElement),
    'File summary must regain focus',
  );
  results.push({
    fileMenuFocusAfterClose: await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      text: document.activeElement.textContent.slice(0, 60),
    })),
  });
  // Failed response and late cancellation: no document or history mutation.
  await page.route('**/examples/home-construction.tapn', (r) =>
    r.fulfill({ status: 503, body: 'down' }),
  );
  const beforeFailure = await state();
  await show('home-construction');
  await page.getByRole('button', { name: 'Open home-construction', exact: true }).click();
  await page.locator('app-example-gallery [role=alert]').waitFor();
  assert.deepEqual((await state()).workspace, beforeFailure.workspace);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  results.push({
    failedFetchEscapeClosed: !(await page.locator('app-example-gallery').count()),
    failedFetchFocus: await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      text: document.activeElement.textContent.slice(0, 40),
    })),
  });
  assert(results.at(-1).failedFetchEscapeClosed, 'Escape must close gallery after failed fetch');
  if (await page.locator('app-example-gallery').count())
    await page.getByRole('button', { name: 'Close example nets' }).click();
  await page.unroute('**/examples/home-construction.tapn');
  let release;
  const gate = new Promise((r) => (release = r));
  let arrived;
  const arrival = new Promise((r) => (arrived = r));
  await page.route('**/examples/home-construction.tapn', async (r) => {
    arrived();
    await gate;
    await r.continue();
  });
  await show('home-construction');
  const beforeCancel = await state();
  await page.getByRole('button', { name: 'Open home-construction', exact: true }).click();
  await arrival;
  await page.keyboard.press('Tab');
  results.push({
    loadingTabFocusInGallery: await page.evaluate(
      () => !!document.activeElement.closest('app-example-gallery'),
    ),
  });
  assert(results.at(-1).loadingTabFocusInGallery, 'Tab must remain inside loading gallery');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  results.push({ loadingEscapeClosed: !(await page.locator('app-example-gallery').count()) });
  assert(results.at(-1).loadingEscapeClosed, 'Escape must close loading gallery');
  if (await page.locator('app-example-gallery').count())
    await page.getByRole('button', { name: 'Close example nets' }).click();
  release();
  await page.waitForTimeout(400);
  assert.deepEqual((await state()).workspace, beforeCancel.workspace);
  results.push({ failedFetchNoMutation: true, cancelledFetchNoMutation: true });
  await page.screenshot({ path: out + '/final.png' });
  console.log(JSON.stringify(results, null, 2));
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
} finally {
  await page.screenshot({ path: out + '/final.png' }).catch(() => {});
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
  await browser.close();
}
