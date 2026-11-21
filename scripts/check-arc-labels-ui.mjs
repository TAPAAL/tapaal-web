#!/usr/bin/env node
// Real-input synchronized-transition smoke. App state is read only, as in the historical harnesses.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const base = process.argv[2] ?? 'http://127.0.0.1:4417';
const out = process.argv[3] ?? '/tmp/tapaal-arc-labels-ui';
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
  await settle();
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

async function gallery(name) {
  await page.locator('.file-menu summary').click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: 'Open ' + name, exact: true }).click();
  if (await page.locator('#cancel-open').count())
    await page.getByRole('button', { name: 'Open in new tab', exact: true }).click();
  await settle();
}

const fixture = {
  format: 'tapaal-web-network',
  version: 3,
  network: {
    name: 'Arc labels',
    type: { timed: false, game: false, colored: false, stochastic: false },
    constants: [{ id: 'w', name: 'W', value: 2 }],
    shared: { places: [], transitions: [] },
    components: [
      {
        id: 'c',
        active: true,
        net: {
          name: 'Arc labels',
          template: 'Main',
          nodes: [
            { id: 'p', name: 'P', kind: 'place', x: 180, y: 180, tokens: 2 },
            { id: 't', name: 'T', kind: 'transition', x: 420, y: 180, tokens: 0 },
          ],
          arcs: [
            {
              id: 'a',
              source: 'p',
              target: 't',
              kind: 'normal',
              weight: { constantId: 'w' },
              bends: [{ x: 300, y: 240, curved: false }],
            },
          ],
        },
      },
    ],
  },
};
const label = () => page.locator('[data-arc="a"] .arc-label');
async function drag(dx, dy, cancel = false) {
  const b = await label().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  writeFileSync(join(out, 'fixture.json'), JSON.stringify(fixture));
  await open(join(out, 'fixture.json'));
  await label().waitFor();
  for (const zoom of [100, 150]) {
    await page.getByRole('slider', { name: 'Canvas zoom percent' }).fill(String(zoom));
    await page.getByRole('slider', { name: 'Canvas zoom percent' }).dispatchEvent('change');
    await page.mouse.move(1000, 800);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(3000, 2800);
    await page.mouse.up({ button: 'middle' });
    await settle();
    const before = await state();
    const start = before.source.components[0].net.arcs[0];
    await page.screenshot({ path: join(out, 'before-' + zoom + '.png') });
    await drag(30, -15);
    const after = await state(),
      arc = after.source.components[0].net.arcs[0];

    check(
      Math.abs(arc.nameOffsetX - (start.nameOffsetX ?? 0) - (30 * 100) / zoom) <= 1,
      'label x delta at ' + zoom,
    );
    check(
      Math.abs(arc.nameOffsetY - (start.nameOffsetY ?? 0) + (15 * 100) / zoom) <= 1,
      'label y delta at ' + zoom,
    );
    check(
      JSON.stringify(arc.weight) === JSON.stringify({ constantId: 'w' }),
      'constant binding preserved',
    );
    check(after.past === before.past + 1, 'one drag one history entry');
    await page.screenshot({ path: join(out, 'after-' + zoom + '.png') });
    await page.keyboard.press('Control+z');
    check(
      JSON.stringify((await state()).source) === JSON.stringify(before.source),
      'undo restores source',
    );
    await page.keyboard.press('Control+Shift+z');
    check(
      JSON.stringify((await state()).source) === JSON.stringify(after.source),
      'redo restores source',
    );
    await drag(25, 20, true);
    check(
      JSON.stringify((await state()).source) === JSON.stringify(after.source),
      'Escape cancels',
    );
  }
  await page.getByRole('button', { name: 'Fit model', exact: true }).click();
  const saved = await saveJson();
  check(saved.network.components[0].net.arcs[0].nameOffsetX > 0, 'JSON saves offsets');
  await page.locator('svg.net-canvas').focus();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  const native = join(out, 'labels.tapn');
  await download.saveAs(native);
  await open(native);
  check(
    (await state()).source.components[0].net.arcs[0].nameOffsetX ===
      saved.network.components[0].net.arcs[0].nameOffsetX,
    'native reopen retains offsets',
  );
  check(errors.length === 0, 'no browser runtime errors');
  writeFileSync(join(out, 'results.json'), JSON.stringify({ assertions, errors }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
