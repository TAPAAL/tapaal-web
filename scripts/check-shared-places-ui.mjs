#!/usr/bin/env node
// Real-input shared-place smoke. App state is read only, as in the historical harnesses.
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
  await page.goto(base);
  await page.locator('[data-node="idle"]').waitFor();
  await editNode('idle');
  await page.getByRole('button', { name: 'Make shared / use existing pool…', exact: true }).click();
  await dialog().getByLabel('Pool name', { exact: true }).fill('Pool');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  let s = await state();
  check(
    s.source.shared.places[0].name === 'Pool' && !('tokens' in s.source.components[0].net.nodes[0]),
    'source pool authority and geometry-only occurrence',
  );
  check(
    (await page.locator('[data-node="idle"] .shared-ring').count()) === 1,
    'membership glyph renders independently of label',
  );
  await pane().getByRole('button', { name: 'New…', exact: true }).click();
  await dialog().getByLabel('Name', { exact: true }).fill('Unused');
  await dialog().getByLabel('Initial marking', { exact: true }).fill('2');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  check((await state()).source.shared.places.length === 2, 'unused pool creation');
  await editNode('busy');
  await page.getByRole('button', { name: 'Make shared / use existing pool…', exact: true }).click();
  await dialog().getByLabel('Sharing action').selectOption('use');
  const unused = (await state()).source.shared.places.find((p) => p.name === 'Unused').id;
  await dialog().locator('select[name=pool]').selectOption(unused);
  check(
    await dialog().getByRole('button', { name: 'OK', exact: true }).isDisabled(),
    'different values require explicit adoption',
  );
  check(
    (await dialog().innerText()).includes('Tokens are never summed'),
    'adoption preview explains replacement',
  );
  await dialog().getByRole('checkbox').check();
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  check(
    (await state()).source.shared.places.find((p) => p.name === 'Unused').tokens === 2,
    'adoption retains one pool marking',
  );
  await editNode('busy');
  check(
    (await dialog().innerText()).includes('AUTHORED initial marking 2'),
    'detach previews authored values',
  );
  await dialog().getByRole('button', { name: 'Detach as local', exact: true }).click();
  s = await state();
  check(
    s.source.components[0].net.nodes.find((n) => n.id === 'busy').name === 'Unused_local1',
    'detach creates fresh local identity and copies values',
  );
  // Clipboard gate with a seeded system clipboard; actual keyboard copy/cut/duplicate.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('SHARED-SENTINEL'));
  await page.locator('[data-node="idle"] .node-shape').click();
  await page.keyboard.press('Control+c');
  await settle();
  check(
    (await page.evaluate(() => navigator.clipboard.readText())) === 'SHARED-SENTINEL',
    'shared copy refused before clipboard write',
  );
  const before = JSON.stringify((await state()).source);
  await page.keyboard.press('Control+x');
  await settle();
  check(JSON.stringify((await state()).source) === before, 'shared cut refused before mutation');
  await page.keyboard.press('Control+d');
  await settle();
  check(
    JSON.stringify((await state()).source) === before,
    'shared duplicate refused before mutation',
  );
  await editNode('idle');
  await dialog().getByRole('button', { name: 'Edit global pool…', exact: true }).click();
  check(
    (await dialog().getByLabel('Name', { exact: true }).inputValue()) === 'Pool',
    'switching occurrence dialog to global properties resets draft',
  );
  await page.keyboard.press('Escape');
  await settle();
  check((await dialog().count()) === 0, 'Escape closes shared dialog');
  const timing = { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] };
  const source = {
    name: 'SharedSmoke',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [{ id: 'limit', name: 'Limit', value: 7 }],
    shared: {
      places: [
        {
          id: 'pool',
          name: 'Global',
          tokens: 2,
          timing: {
            invariant: { upper: { constantId: 'limit' }, upperClosed: true },
            ages: ['1', '2'],
          },
        },
        {
          id: 'dormant',
          name: 'Dormant',
          tokens: 1,
          timing: { invariant: { upper: '1', upperClosed: true }, ages: ['1'] },
        },
      ],
      transitions: [],
    },
    components: [
      {
        id: 'main',
        active: true,
        net: {
          name: 'SharedSmoke',
          template: 'Main',
          nodes: [
            { id: 'p', kind: 'place', sharedId: 'pool', x: 90, y: 90 },
            { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 240, y: 90 },
            { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 390, y: 90 },
            { id: 'l', kind: 'place', name: 'Local', tokens: 1, x: 90, y: 240 },
          ],
          arcs: [
            { id: 'i', source: 'p', target: 't', kind: 'normal', weight: 1 },
            { id: 'o', source: 't', target: 'q', kind: 'normal', weight: 1 },
          ],
        },
        timing,
      },
      {
        id: 'inactive',
        active: false,
        net: {
          name: 'SharedSmoke',
          template: 'Inactive',
          nodes: [
            { id: 'p', kind: 'place', sharedId: 'pool', x: 90, y: 90 },
            { id: 'l', kind: 'place', name: 'Frozen', tokens: 3, x: 90, y: 240 },
          ],
          arcs: [],
        },
        timing,
      },
    ],
  };
  const file = join(out, 'shared.json');
  writeFileSync(
    file,
    JSON.stringify({ format: 'tapaal-web-network', version: 3, network: source }),
  );
  await open(file);
  check(!(await state()).error, 'V3 opens through real file chooser');
  await mode('Simulate');
  check(
    (await state()).total === 7,
    'physical network total counts pool once, including dormant and frozen locals',
  );
  await page.locator('#delay-amount').fill('0.3');
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  check((await state()).time === '0.3', 'exact global clock ignores dormant pool invariant');
  await page.locator('#token-policy').selectOption('manual');
  await page.locator('.enabled-row', { hasText: 'Main.T' }).press('Enter');
  check(
    (await page.locator('app-token-selection-dialog').innerText()).includes('Global'),
    'manual input displays pool name',
  );
  await page.locator('app-token-selection-dialog input[type=checkbox]').first().check();
  await page
    .locator('app-token-selection-dialog')
    .getByRole('button', { name: 'Fire', exact: true })
    .click();
  check((await state()).marking.p === 1, 'manual fire uses qualified local input');
  await page.locator('.component-row', { hasText: 'Inactive' }).click();
  s = await state();
  check(
    s.marking.p === 1 && s.marking.l === 3 && s.time === '0.3' && s.cursor === 2,
    'inactive occurrence reflects live pool while local marking freezes and run survives component switch',
  );
  check(
    s.ages.p[0] === '2.3' && s.ages.l.every((age) => age === '0'),
    'shared ages advance once and inactive local ages freeze',
  );
  const saved = await saveJson();
  check(
    saved.version === 3 && JSON.stringify(saved.network) === JSON.stringify(source),
    'midrun JSON saves exact whole authored initial source',
  );
  check(errors.length === 0, 'no browser runtime errors');
  await page.screenshot({ path: join(out, 'shared-inactive.png') });
  writeFileSync(
    join(out, 'results.json'),
    JSON.stringify({ assertions, errors, status: 'pass' }, null, 2),
  );
  console.log(`${assertions} shared UI assertions passed`);
} catch (error) {
  await page.screenshot({ path: join(out, 'failure.png') });
  writeFileSync(
    join(out, 'results.json'),
    JSON.stringify({ assertions, errors, error: error.stack, status: 'failed' }, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
