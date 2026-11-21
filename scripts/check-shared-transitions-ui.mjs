#!/usr/bin/env node
// Real-input synchronized-transition smoke. App state is read only, as in the historical harnesses.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const base = process.argv[2] ?? 'http://127.0.0.1:4417';
const out = process.argv[3] ?? '/tmp/tapaal-shared-ui-1029';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let assertions = 0;
const check = (condition, label) => {
  if (!condition) throw new Error(label);
  assertions++;
  console.log('PASS ' + label);
};
const settle = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = async () => {
  await settle();
  return page.evaluate(() => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const doc = app.activeDocument();
    return {
      source: JSON.parse(JSON.stringify(doc.network)),
      past: doc.past.length,
      marking: app.marking(),
      time: app.globalTime(),
      total: app.physicalTokens(),
      cursor: app.cursor(),
      error: app.error(),
      ages: app.currentAges(),
      sharedError: app.sharedError(),
    };
  });
};
const dialog = () => page.locator('app-shared-place-dialog form');
const pane = () => page.locator('app-shared-places-pane');
async function editNode(id) {
  await page.locator(`[data-node="${id}"] .node-shape`).dblclick();
}
async function mode(name) {
  await page
    .locator('[aria-label="Workspace mode"]')
    .getByRole('button', { name, exact: true })
    .click();
}
async function open(path) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page
      .locator('[aria-label="Document toolbar"]')
      .getByRole('button', { name: 'Open model', exact: true })
      .click(),
  ]);
  await chooser.setFiles(path);
  await settle();
  const accept = page.getByRole('button', { name: 'Open in new tab', exact: true });
  if (await accept.isVisible()) await accept.click();
  await settle();
}
async function saveJson() {
  await page.locator('summary', { hasText: /^File$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as web JSON…', exact: true }).click(),
  ]);
  const path = join(out, 'initial.json');
  await download.saveAs(path);
  return JSON.parse(readFileSync(path, 'utf8'));
}
try {
  const source = {
    name: 'Synchronization',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [],
    shared: { places: [], transitions: [{ id: 'sync', name: 'Sync', urgent: false }] },
    components: ['A', 'B', 'Inactive'].map((id) => ({
      id,
      active: id !== 'Inactive',
      net: {
        name: 'Synchronization',
        template: id,
        nodes: [
          { id: 'p', kind: 'place', name: 'P', tokens: 2, x: 90, y: 90 },
          { id: 't', kind: 'transition', sharedId: 'sync', x: 240, y: 90 },
          { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 390, y: 90 },
        ],
        arcs: [
          { id: 'in', kind: 'normal', source: 'p', target: 't', weight: 1 },
          { id: 'out', kind: 'normal', source: 't', target: 'q', weight: 1 },
        ],
      },
      timing: {
        ages: { p: ['1', '2'] },
        invariants: {},
        intervals: {},
        transports: [],
        urgent: [],
      },
    })),
  };
  const path = join(out, 'sync.json');
  writeFileSync(
    path,
    JSON.stringify({ format: 'tapaal-web-network', version: 3, network: source }),
  );
  await page.goto(base);
  await open(path);
  const syncPane = page.locator('app-shared-transitions-pane');
  check((await syncPane.innerText()).includes('Sync'), 'source pool listed');
  await syncPane.locator('summary').click();
  check(
    (await syncPane.innerText()).includes('2 active / 3 total members'),
    'active and total member counts',
  );
  await page.screenshot({ path: join(out, 'synchronized-pane.png') });
  await syncPane.getByRole('button', { name: 'Properties…', exact: true }).click();
  const sd = page.locator('app-shared-transition-dialog');
  await sd.locator('input[name=name]').fill('invalid name');
  await sd.getByRole('button', { name: 'OK', exact: true }).click();
  check(
    (await sd.locator('input[name=name]').inputValue()) === 'invalid name' &&
      (await state()).source.shared.transitions[0].name === 'Sync',
    'rejected draft stays editable without source mutation',
  );
  await sd.locator('input[name=name]').fill('Together');
  await sd.getByRole('button', { name: 'OK', exact: true }).click();
  check(
    (await state()).source.shared.transitions[0].name === 'Together',
    'rename commits one global authority',
  );
  const json = await saveJson();
  check(
    json.network.components.every((c) => !('urgent' in c.net.nodes[1])),
    'save keeps member semantics out of occurrences',
  );
  await mode('Simulate');
  await page.locator('#delay-amount').fill('0.5');
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  await page.locator('#token-policy').selectOption('manual');
  check(
    (await page.locator('.enabled-row').count()) === 1,
    'one enabled event for two active members',
  );
  await page.locator('.enabled-row').press('Enter');
  const modal = page.locator('app-token-selection-dialog');
  check(
    (await modal.innerText()).includes('A.P') && (await modal.innerText()).includes('B.P'),
    'manual groups use component and local arc provenance',
  );
  await modal.locator('fieldset').nth(0).locator('input').first().check();
  await modal.locator('fieldset').nth(1).locator('input').last().check();
  await page.screenshot({ path: join(out, 'synchronized-manual.png') });
  await modal.getByRole('button', { name: 'Fire', exact: true }).click();
  let st = await state();
  check(st.marking.p === 1 && st.marking.q === 1 && st.cursor === 2, 'one atomic history entry');
  await page.locator('.component-row', { hasText: 'B' }).click();
  st = await state();
  check(st.marking.p === 1 && st.marking.q === 1, 'other active member fired atomically');
  await page.locator('#token-policy').selectOption('oldest');
  await page.locator('[data-node="t"] .node-shape').click();
  st = await state();
  check(
    st.marking.q === 2 && st.cursor === 3,
    'noncanonical member canvas click dispatches the same event once',
  );
  await page.locator('.component-row', { hasText: 'Inactive' }).click();
  st = await state();
  check(st.marking.p === 2 && st.marking.q === 0, 'inactive member frozen');
  await mode('Edit');
  await open(join(process.cwd(), 'web/public/examples/train-level-crossing.tapn'));
  check((await state()).source.shared.transitions.length > 0, 'unchanged native train demo opens');
  await page.screenshot({ path: join(out, 'train-shared-demo.png') });
  const protectedSource = JSON.stringify((await state()).source);
  await syncPane.locator('summary').first().click();
  await syncPane.getByRole('button', { name: 'Properties…', exact: true }).first().click();
  await sd.locator('input[name=name]').fill('BlockedGlobalRename');
  await sd.getByRole('button', { name: 'OK', exact: true }).click();
  check(
    JSON.stringify((await state()).source) === protectedSource &&
      (await sd.locator('[role=alert]').innerText()).includes('queries protect'),
    'native query metadata protects global transition rename without changing source',
  );
  await sd.getByRole('button', { name: 'Cancel', exact: true }).click();
  check(errors.length === 0, 'no browser page errors');
  console.log(JSON.stringify({ assertions, out }));
} catch (e) {
  await page.screenshot({ path: join(out, 'failure.png') });
  throw e;
} finally {
  await browser.close();
}
