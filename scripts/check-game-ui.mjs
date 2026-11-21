#!/usr/bin/env node
// Real-input synchronized-transition smoke. App state is read only, as in the historical harnesses.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const base = process.argv[2] ?? 'http://127.0.0.1:4417';
const out = process.argv[3] ?? '/tmp/tapaal-game-ui';
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
async function fire(role) {
  await page.locator('.enabled-row').filter({ hasText: role }).first().press('Enter');
  await settle();
  const picker = page.locator('app-token-selection-dialog');
  if ((await page.locator('#token-policy').inputValue()) === 'manual')
    await picker.locator('form').waitFor();
  if (await picker.count()) {
    for (const f of await picker.locator('fieldset').all())
      await f.locator('input').first().check();
    await picker.getByRole('button', { name: 'Fire', exact: true }).click();
  }
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  await gallery('package-delivery');
  check((await state()).source.type.game, 'gallery preserves native game lens');
  const json = await saveJson();
  check(
    json.network.type.game &&
      json.network.components[0].net.nodes.some((n) => n.actor === 'environment'),
    'JSON download retains initial actors',
  );
  await page.locator('svg.net-canvas').focus();
  const [nativeDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  const nativePath = join(out, 'game-native.tapn');
  await nativeDownload.saveAs(nativePath);
  check(
    readFileSync(nativePath, 'utf8').includes('isGame="true"'),
    'native download retains game feature',
  );
  await open(nativePath);
  check(
    (await state()).source.savedQueries.xml.length === json.network.savedQueries.xml.length,
    'native download reopens with opaque queries',
  );
  const env = json.network.components[0].net.nodes.find((n) => n.actor === 'environment');
  await editNode(env.id);
  await page.locator('#dialog-actor').selectOption('controller');
  await page.locator('app-element-dialog').getByRole('button', { name: 'OK', exact: true }).click();
  check(
    (await state()).source.components[0].net.nodes.find((n) => n.id === env.id).actor ===
      'controller',
    'local role edited with real properties control',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check(
    (await state()).source.components[0].net.nodes.find((n) => n.id === env.id).actor ===
      'environment',
    'role undo retains game lens',
  );
  await page.screenshot({ path: join(out, 'game-roles.png') });
  await mode('Simulate');
  check(
    (await page.locator('.simulation-hint').allTextContents())
      .join(' ')
      .includes('manual exploration'),
    'manual strategy scope visible',
  );
  await page.locator('#token-policy').selectOption('oldest');
  await fire('Controller');
  check((await state()).cursor === 1, 'controller fires through actual enabled list');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.locator('#token-policy').selectOption('manual');
  await fire('Environment');
  check((await state()).cursor === 1, 'environment fires through manual token controls');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  check((await state()).cursor === 0, 'game back restores initial runtime');
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  check((await state()).cursor === 1, 'game forward replays stored state');
  await page.screenshot({ path: join(out, 'game-simulation.png') });
  check(
    JSON.stringify((await saveJson()).network) === JSON.stringify(json.network),
    'simulation save retains complete initial source',
  );
  await mode('Edit');
  await open(join(out, 'initial.json'));
  check((await state()).source.type.game, 'JSON download reopens through file input');
  await page.locator('[data-node] .node-shape').first().click();
  const before = JSON.stringify((await state()).source);
  await page.keyboard.press('Control+c');
  check(
    (await state()).error.includes('Game subnet clipboard'),
    'game clipboard refusal is specific',
  );
  check(JSON.stringify((await state()).source) === before, 'clipboard refusal is atomic');
  for (const name of ['untimedGame', 'game-harddisk']) {
    await gallery(name);
    const loaded = await state();
    check(loaded.source.type.game, name + ' retains game lens');
    check(
      loaded.source.components
        .flatMap((c) => c.net.arcs)
        .some((a) => a.nameOffsetX === (name === 'untimedGame' ? 23 : -7)),
      name + ' retains moved arc label',
    );
    const saved = await saveJson();
    check(saved.network.type.game, name + ' JSON retains initial game source');
    await page.locator('svg.net-canvas').focus();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+s'),
    ]);
    const path = join(out, name + '-native.tapn');
    await download.saveAs(path);
    await open(path);
    const reopened = await state();
    check(
      reopened.source.components
        .flatMap((c) => c.net.arcs)
        .some((a) => a.nameOffsetX === (name === 'untimedGame' ? 23 : -7)),
      name + ' native reopen retains offset',
    );
    check(
      reopened.source.components.flatMap((c) => c.net.nodes).some((n) => n.actor === 'environment'),
      name + ' native reopen retains environment',
    );
    await mode('Simulate');
    const rows = page.locator('.enabled-row');
    if (await rows.count()) {
      await fire('');
      check((await state()).cursor === 1, name + ' legally fires');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await mode('Edit');
    const component = reopened.source.components.find((c) =>
      c.net.arcs.some((a) => a.nameOffsetX === (name === 'untimedGame' ? 23 : -7)),
    );
    await page.locator('.component-row').filter({ hasText: component.net.template }).click();
    await settle();
    const geometry = await page.evaluate(() => {
      const app = window.ng.getComponent(document.querySelector('app-root'));
      const arc = app.net().arcs.find((a) => a.nameOffsetX);
      const anchor = app.arcGeometries().get(arc.id).midpoint;
      const text = Array.from(document.querySelectorAll('.net-arc'))
        .find((e) => e.getAttribute('data-arc') === arc.id)
        .querySelector('.arc-label');
      return {
        x: Number(text.getAttribute('x')),
        y: Number(text.getAttribute('y')),
        expectedX: anchor.x + arc.nameOffsetX,
        expectedY: anchor.y - 12 + (arc.nameOffsetY ?? 0),
      };
    });
    check(
      geometry.x === geometry.expectedX && geometry.y === geometry.expectedY,
      name + ' renders source offset at native midpoint',
    );
    const restore = page.getByRole('button', { name: 'Restore zoom (100%)', exact: true });
    if (await restore.count()) await restore.click();
    await page.getByRole('button', { name: 'Fit model', exact: true }).click();
    await settle();
    await page.screenshot({ path: join(out, name + '.png') });
  }
  const sync = {
    name: 'Shared game',
    type: { timed: true, game: true, colored: false, stochastic: false },
    constants: [],
    shared: {
      places: [],
      transitions: [{ id: 'sync', name: 'Sync', urgent: false, actor: 'environment' }],
    },
    components: ['A', 'B', 'Inactive'].map((id) => ({
      id,
      active: id !== 'Inactive',
      net: {
        name: 'Shared game',
        template: id,
        nodes: [
          { id: 'p', name: 'P', kind: 'place', tokens: 1, x: 90, y: 90 },
          { id: 't', kind: 'transition', sharedId: 'sync', x: 240, y: 90 },
          { id: 'q', name: 'Q', kind: 'place', tokens: 0, x: 390, y: 90 },
        ],
        arcs: [
          { id: 'in', source: 'p', target: 't', kind: 'normal', weight: 1 },
          { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 1 },
        ],
      },
      timing: { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] },
    })),
  };
  const syncPath = join(out, 'shared-game.json');
  writeFileSync(syncPath, JSON.stringify({ format: json.format, version: 3, network: sync }));
  await open(syncPath);
  const syncPane = page.locator('app-shared-transitions-pane');
  check(
    (await syncPane.innerText()).includes('Environment'),
    'global source role shown in shared pane',
  );
  await page.screenshot({ path: join(out, 'game-shared-marker.png') });
  await syncPane.locator('summary').click();
  await syncPane.getByRole('button', { name: 'Properties…', exact: true }).click();
  await page.locator('app-shared-transition-dialog select[name=actor]').selectOption('controller');
  await page
    .locator('app-shared-transition-dialog')
    .getByRole('button', { name: 'OK', exact: true })
    .click();
  check(
    (await state()).source.shared.transitions[0].actor === 'controller',
    'global player property changes one pool authority',
  );
  check(
    (await state()).source.components.every((c) => !('actor' in c.net.nodes[1])),
    'shared members remain geometry-only',
  );
  await mode('Simulate');
  check(
    (await page.locator('.enabled-row').count()) === 1,
    'shared game exposes one synchronized actor choice',
  );
  await page.locator('#token-policy').selectOption('manual');
  await fire('Controller');
  check(
    (await state()).cursor === 1 && (await state()).marking.q === 1,
    'qualified manual shared-game firing records once',
  );
  await page.locator('.component-row', { hasText: 'B' }).click();
  check(
    (await state()).cursor === 1 && (await state()).marking.q === 1,
    'game component switch keeps synchronized run',
  );
  await page.locator('.component-row', { hasText: 'Inactive' }).click();
  check(
    (await state()).marking.p === 1 && (await state()).marking.q === 0,
    'inactive game member stays frozen',
  );
  await mode('Edit');
  await page
    .locator('[aria-label="Document toolbar"]')
    .getByRole('button', { name: 'New model', exact: true })
    .click();
  await page.locator('#new-model-name').fill('Timed Game');
  await page.locator('#new-model-type').selectOption({ label: 'Timed P/T net' });
  await page.locator('#new-game').selectOption({ label: 'P/T game — Controller and Environment' });
  await page.screenshot({ path: join(out, 'new-game.png') });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  check(
    (await state()).source.type.game && (await state()).source.type.timed,
    'new timed game retains lens without any pools',
  );
  await mode('Simulate');
  await page.locator('#delay-amount').fill('1.5');
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  check((await state()).time === '1.5', 'timed game permits legal delay through UI');
  check(!errors.length, 'no uncaught browser errors');
  console.log(JSON.stringify({ assertions, out }));
} finally {
  await context.close();
  await browser.close();
}
