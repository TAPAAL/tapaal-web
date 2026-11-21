#!/usr/bin/env node
// Independent review harness (game nets + arc labels). Real pointer/keyboard input; app state is
// read only through window.ng (no signal writes). Serves the existing dev bundle in-process so a
// single finite worker-job owns server + browser lifetime.
//   PLAYWRIGHT_CORE=... CHROMIUM_PATH=... node scripts/check-game-label-review-ui.mjs [outDir]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const root = process.env.DEV_BUILD ?? resolve(import.meta.dirname, '../dist/tapaal-web/browser');
const out = process.argv[2] ?? '/tmp/tapaal-game-label-review-ui';
mkdirSync(out, { recursive: true });
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.tapn': 'application/xml',
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || path === '/') file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
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
const results = [];
let assertions = 0;
const check = (condition, label, detail) => {
  results.push({ label, pass: !!condition, ...(detail !== undefined ? { detail } : {}) });
  if (!condition)
    throw new Error(label + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  assertions++;
  console.log('PASS ' + label);
};
const observe = (label, detail) => {
  results.push({ label, observation: detail });
  console.log('OBSERVE ' + label + ' ' + JSON.stringify(detail));
};
const shots = [];
const shot = async (name) => {
  const path = join(out, name + '.png');
  await page.screenshot({ path });
  shots.push(path);
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
      component: doc.session.componentId,
      cursor: app.cursor(),
      error: app.error(),
      notice: app.notice(),
      zoom: app.zoom(),
      sharedError: app.sharedError(),
      footer: document.querySelector('footer.app-footer')?.textContent ?? '',
      alerts: Array.from(document.querySelectorAll('[role=alert]')).map((e) => e.textContent),
      selection: app.selectedIds(),
    };
  });
};
const comp = (s, id = s.component) => s.source.components.find((c) => c.id === id);
const node = (s, id, c) => comp(s, c).net.nodes.find((n) => n.id === id);
const arc = (s, id, c) => comp(s, c).net.arcs.find((a) => a.id === id);
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
async function saveNative(name) {
  await page.locator('svg.net-canvas').focus();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  const path = join(out, name);
  await download.saveAs(path);
  return path;
}
async function saveJson(name) {
  await page.locator('summary', { hasText: /^File$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as web JSON…', exact: true }).click(),
  ]);
  const path = join(out, name);
  await download.saveAs(path);
  return JSON.parse(readFileSync(path, 'utf8'));
}
const elementDialog = () => page.locator('app-element-dialog');
const syncDialog = () => page.locator('app-shared-transition-dialog');
async function openNode(id) {
  await page.locator(`[data-node="${id}"] .node-shape`).dblclick();
  await settle();
}
async function labelBox(id) {
  await settle();
  return page.locator(`.net-arc[data-arc="${id}"] .arc-label`).boundingBox();
}
async function newModel(name, timed, game) {
  await page
    .locator('[aria-label="Document toolbar"]')
    .getByRole('button', { name: 'New model', exact: true })
    .click();
  await page.locator('#new-model-name').fill(name);
  await page
    .locator('#new-model-type')
    .selectOption({ label: timed ? 'Timed P/T net' : 'Untimed P/T net' });
  await page
    .locator('#new-game')
    .selectOption({ label: game ? 'P/T game — Controller and Environment' : 'P/T net' });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await settle();
}
const T = (id, name, x, y, actor) => ({
  id,
  name,
  kind: 'transition',
  tokens: 0,
  x,
  y,
  ...(actor ? { actor } : {}),
});
const P = (id, name, tokens, x, y) => ({ id, name, kind: 'place', tokens, x, y });
const fixture = {
  format: 'tapaal-web-network',
  version: 3,
  network: {
    name: 'Review game',
    type: { timed: true, game: true, colored: false, stochastic: false },
    constants: [{ id: 'k', name: 'K', value: 1 }],
    shared: { places: [], transitions: [] },
    components: [
      {
        id: 'C',
        active: true,
        net: {
          name: 'Review game',
          template: 'C',
          nodes: [
            P('p', 'P', 3, 120, 160),
            T('e', 'E', 330, 120, 'environment'),
            T('u', 'U', 330, 260),
            P('q', 'Q', 0, 520, 160),
          ],
          arcs: [
            { id: 'a', source: 'p', target: 'e', kind: 'normal', weight: { constantId: 'k' } },
            { id: 'b', source: 'p', target: 'u', kind: 'normal', weight: 1 },
            { id: 'o', source: 'e', target: 'q', kind: 'normal', weight: 1 },
          ],
        },
        timing: { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] },
      },
      {
        id: 'D',
        active: true,
        net: {
          name: 'Review game',
          template: 'D',
          nodes: [P('r', 'R', 1, 120, 160), T('v', 'V', 330, 160, 'environment')],
          arcs: [{ id: 'rv', source: 'r', target: 'v', kind: 'normal', weight: 1 }],
        },
        timing: { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] },
      },
    ],
  },
};
async function component(name) {
  await page.locator('.component-row').filter({ hasText: name }).first().click();
  await settle();
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  const bundle = createHash('sha256')
    .update(readFileSync(join(root, 'main.js')))
    .digest('hex');
  observe('dev bundle main.js sha256', bundle);

  // A. Both new lenses.
  for (const timed of [false, true]) {
    await newModel(timed ? 'Timed lens' : 'Untimed lens', timed, true);
    const s = await state();
    check(
      s.source.type.game && s.source.type.timed === timed,
      `new ${timed ? 'timed' : 'untimed'} game lens`,
    );
  }
  await newModel('Plain net', false, false);
  check(!(await state()).source.type.game, 'new default P/T net stays nongame');

  // B. Local/global role authoring.
  const fixturePath = join(out, 'review-game.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  await open(fixturePath);
  let s = await state();
  const past0 = s.past;
  await openNode('e');
  check(
    (await page.locator('#dialog-actor').inputValue()) === 'environment',
    'dialog shows Environment',
  );
  await elementDialog().locator('#dialog-name, input[name=name]').first().fill('E2');
  await page.locator('#dialog-actor').selectOption('controller');
  await elementDialog().getByRole('button', { name: 'OK', exact: true }).click();
  s = await state();
  check(
    node(s, 'e').name === 'E2' && node(s, 'e').actor === 'controller' && s.past === past0 + 1,
    'name+actor commit as one history entry',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  s = await state();
  check(
    node(s, 'e').name === 'E' && node(s, 'e').actor === 'environment' && s.past === past0,
    'one undo restores name and actor',
  );

  // Make U shared (Controller pool), then try E (Environment) into it.
  await openNode('u');
  await elementDialog()
    .getByRole('button', { name: /Make shared/ })
    .click();
  await syncDialog().locator('select[name=action]').selectOption('create');
  await syncDialog().locator('input[name=name]').fill('Sync');
  await syncDialog().getByRole('button', { name: 'OK', exact: true }).click();
  s = await state();
  const pool = s.source.shared.transitions[0];
  check(
    pool?.actor === 'controller' && !('actor' in node(s, 'u')) && node(s, 'u').sharedId === pool.id,
    'make shared transfers Controller to pool; member geometry-only',
  );
  await component('D');
  await openNode('v');
  await elementDialog()
    .getByRole('button', { name: /Make shared/ })
    .click();
  await syncDialog().locator('select[name=action]').selectOption('use');
  const adoptText = await syncDialog().innerText();
  observe('use-pool dialog copy (game)', adoptText.replace(/\s+/g, ' ').slice(0, 400));
  // F3 regression: adoption explicitly includes the player as well as urgency.
  check(
    /Adopt this pool's urgency and player/.test(adoptText.replace(/\s+/g, ' ')),
    'F3 adoption control identifies both urgency and player',
  );
  const beforeUse = JSON.stringify((await state()).source);
  await syncDialog().getByRole('button', { name: 'OK', exact: true }).click();
  s = await state();
  check(
    JSON.stringify(s.source) === beforeUse &&
      /player differs/i.test(s.sharedError) &&
      !/acceptPoolValues/.test(s.sharedError),
    'use-pool refuses role mismatch without explicit adoption',
    s.sharedError,
  );
  await syncDialog().locator('input[name=accept]').check();
  await syncDialog().getByRole('button', { name: 'OK', exact: true }).click();
  s = await state();
  check(
    node(s, 'v').sharedId === pool.id && s.source.shared.transitions[0].actor === 'controller',
    'explicit adoption joins pool, pool role wins',
    {
      v: node(s, 'v'),
      pools: s.source.shared.transitions,
      err: s.sharedError,
      dialog: await syncDialog().count(),
    },
  );
  // Change global role via pane properties.
  const pane = page.locator('app-shared-transitions-pane');
  await pane.locator('summary').first().click();
  await pane.getByRole('button', { name: 'Properties…', exact: true }).click();
  await syncDialog().locator('select[name=actor]').selectOption('environment');
  await syncDialog().getByRole('button', { name: 'OK', exact: true }).click();
  s = await state();
  const labels = await page.locator('[data-node="v"]').getAttribute('aria-label');
  check(
    s.source.shared.transitions[0].actor === 'environment' &&
      !('actor' in node(s, 'u', 'C')) &&
      !('actor' in node(s, 'v')) &&
      /Environment/.test(labels ?? ''),
    'global role edit cascades by ownership; canvas description updates',
    labels,
  );
  await shot('roles-shared');
  // Detach E copies global role.
  await openNode('v');
  await syncDialog().locator('input[name=name]').fill('Vdetached');
  await syncDialog().getByRole('button', { name: 'Detach as local', exact: true }).click();
  s = await state();
  check(
    node(s, 'v').actor === 'environment' && !node(s, 'v').sharedId,
    'detach copies global Environment role',
  );
  await component('C');

  // C. Manual exploration.
  await mode('Simulate');
  let sim = await state();
  const rows = await page.locator('.enabled-row').allInnerTexts();
  check(
    rows.some((r) => /Environment/.test(r)),
    'enabled list labels actors',
    rows,
  );
  observe('selection carried into Simulate', {
    selection: sim.selection,
    rowsSelected: await page.locator('.enabled-row.selected').count(),
  });
  if (sim.selection.length) {
    // Clear by real input: Escape on the canvas (Edit-mode selection is carried into Simulate).
    await page.locator('svg.net-canvas').focus();
    await page.keyboard.press('Escape');
    observe('selection after Escape', (await state()).selection);
    const cbx = await page.locator('svg.net-canvas').boundingBox();
    await page.mouse.click(cbx.x + cbx.width - 40, cbx.y + cbx.height - 40);
    sim = await state();
    observe('selection after empty-canvas click', sim.selection);
  }
  const stepCursor = sim.cursor;
  await page.getByRole('button', { name: /^(Step|Forward)$/ }).click();
  sim = await state();
  check(
    sim.cursor === stepCursor || (await state()).selection.length === 0,
    'game Step does not choose without a selection',
    { stepCursor, cursor: sim.cursor, selection: sim.selection },
  );
  if (sim.cursor !== stepCursor) observe('Step fired a carried selection', sim.cursor);
  if (await page.getByRole('button', { name: 'Reset', exact: true }).isEnabled())
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
  sim = await state();
  observe('F2 feedback after unselected Step', {
    notice: sim.notice,
    footer: sim.footer.replace(/\s+/g, ' ').slice(0, 200),
    alerts: sim.alerts,
  });
  await page.getByRole('button', { name: 'Fire transition', exact: true }).click();
  sim = await state();
  check(sim.cursor === 0, 'game Fire with no selection does not auto-fire');
  observe('F2 feedback after unselected Fire', {
    notice: sim.notice,
    visibleFooterHasNotice: sim.footer.includes(sim.notice) && !!sim.notice,
  });
  // F2 regression: an unselected game action explains how to continue.
  check(
    sim.notice === 'Choose a Controller or Environment transition.' &&
      (await page.locator('footer.app-footer').innerText()).includes(sim.notice),
    'F2 unselected game Step/Fire guidance is visible in Simulate',
  );
  await page.locator('#token-policy').selectOption('manual');
  await page.locator('.enabled-row').filter({ hasText: 'Environment' }).first().click();
  await page.getByRole('button', { name: 'Fire transition', exact: true }).click();
  await page.locator('app-token-selection-dialog form').waitFor();
  for (const f of await page.locator('app-token-selection-dialog fieldset').all())
    await f.locator('input').first().check();
  await page
    .locator('app-token-selection-dialog')
    .getByRole('button', { name: 'Fire', exact: true })
    .click();
  sim = await state();
  check(sim.cursor === 1, 'selected Environment fires through manual token choice');
  observe(
    'selection after firing (retained only if user-selected and still enabled)',
    sim.selection,
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  check((await state()).cursor === 0, 'back restores initial');
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  check((await state()).cursor === 1, 'forward replays stored step');
  const runSource = JSON.stringify((await state()).source);
  await shot('game-manual');
  await mode('Edit');
  await openNode('e');
  await page.locator('#dialog-actor').selectOption('controller');
  await elementDialog().getByRole('button', { name: 'OK', exact: true }).click();
  await mode('Simulate');
  sim = await state();
  check(
    sim.cursor === 0 && JSON.stringify(sim.source) !== runSource,
    'role edit invalidates previous run',
  );
  await mode('Edit');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  // D. Arc label drag on the constant-weighted arc (a: p -> e).
  await open(fixturePath);
  s = await state();
  const restore0 = page.getByRole('button', { name: 'Restore zoom (100%)', exact: true });
  if (await restore0.count()) await restore0.first().click();
  s = await state();
  observe('zoom before first drag', s.zoom);
  const z0 = s.zoom / 100;
  const pastA = s.past;
  let box = await labelBox('a');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 4 });
  await page.mouse.up();
  s = await state();
  const ox = Math.trunc(40 / z0),
    oy = Math.trunc(25 / z0);
  check(
    arc(s, 'a').nameOffsetX === ox && arc(s, 'a').nameOffsetY === oy && s.past === pastA + 1,
    `${s.zoom}% drag stores truncated total model delta once`,
    { got: arc(s, 'a'), ox, oy },
  );
  check(
    typeof arc(s, 'a').weight === 'object' &&
      node(s, 'e').actor === 'environment' &&
      s.source.type.game,
    'label drag keeps constant weight, actor and game type',
  );
  await shot('label-100');
  // Escape cancel.
  box = await labelBox('a');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  s = await state();
  check(
    arc(s, 'a').nameOffsetX === ox && arc(s, 'a').nameOffsetY === oy && s.past === pastA + 1,
    'Escape cancels label preview without history',
  );
  // pointercancel (synthetic: real devices cannot be scripted to cancel).
  box = await labelBox('a');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2 - 30, { steps: 5 });
  await page
    .locator('svg.net-canvas')
    .dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
  s = await state();
  check(
    arc(s, 'a').nameOffsetX === ox && s.past === pastA + 1,
    'pointercancel restores label (synthetic event)',
  );
  // 150% zoom.
  for (let i = 0; i < 20 && (await state()).zoom < 150; i++)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = (await state()).zoom;
  box = await labelBox('a');
  const canvasBox = await page.locator('svg.net-canvas').boundingBox();
  observe('zoom and label box at 150', { zoom, box, canvasBox });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 31, box.y + box.height / 2 - 29, { steps: 6 });
  await page.mouse.up();
  s = await state();
  const ex = ox + Math.trunc(31 / (zoom / 100)),
    ey = oy + Math.trunc(-29 / (zoom / 100));
  check(
    zoom === 150 &&
      Math.abs(arc(s, 'a').nameOffsetX - ex) <= 1 &&
      Math.abs(arc(s, 'a').nameOffsetY - ey) <= 1 &&
      Number.isInteger(arc(s, 'a').nameOffsetX),
    '150% drag unzooms and truncates',
    { got: arc(s, 'a'), ex, ey },
  );
  await shot('label-150');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  // Far positive drag then Fit includes the label.
  await page
    .getByRole('button', { name: /Fit model|Restore zoom/ })
    .first()
    .click();
  if ((await state()).zoom !== 100)
    await page
      .getByRole('button', { name: /Restore zoom/ })
      .first()
      .click();
  box = await labelBox('a');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 520, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Fit model', exact: true }).first().click();
  box = await labelBox('a');
  const cb = await page.locator('svg.net-canvas').boundingBox();
  check(
    box.x >= cb.x &&
      box.y >= cb.y &&
      box.x + box.width <= cb.x + cb.width &&
      box.y + box.height <= cb.y + cb.height,
    'fit includes far moved label',
    { box, cb },
  );
  await shot('label-fit');
  // Initial native save from the game keeps offset + roles; reopen.
  const nativePath = await saveNative('review-game.tapn');
  const nativeText = readFileSync(nativePath, 'utf8');
  check(
    nativeText.includes('isGame="true"') && /player="1"/.test(nativeText),
    'native save writes game feature and Environment player',
  );
  await open(nativePath);
  s = await state();
  const reArc = comp(s).net.arcs.find((x) => typeof x.weight === 'object');
  check(
    reArc && reArc.nameOffsetX !== undefined && Math.abs(reArc.nameOffsetX) > 100,
    'native reopen keeps moved label and constant weight',
    reArc,
  );

  // E. Web clipboard keeps offsets in a nongame net; game clipboard refuses atomically.
  const plain = structuredClone(fixture);
  plain.network.type.game = false;
  plain.network.name = 'Plain review';
  for (const c of plain.network.components) c.net.name = 'Plain review';
  for (const c of plain.network.components) c.net.nodes = c.net.nodes.map(({ actor, ...n }) => n);
  plain.network.components[0].net.arcs[1] = {
    ...plain.network.components[0].net.arcs[1],
    nameOffsetX: -17,
    nameOffsetY: 9,
  };
  const plainPath = join(out, 'plain.json');
  writeFileSync(plainPath, JSON.stringify(plain));
  await open(plainPath);
  s = await state();
  observe('plain open', {
    game: s.source.type.game,
    name: s.source.name,
    error: s.error,
    notice: s.notice,
  });
  await page.locator('svg.net-canvas').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page
    .waitForFunction(
      () =>
        /clipboard|Copied/i.test(
          window.ng.getComponent(document.querySelector('app-root')).notice(),
        ),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  s = await state();
  observe('copy notice/error', { notice: s.notice, error: s.error, selected: s.selection.length });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(
    /arc label offsets/.test(s.notice) &&
      clip.includes('tapaal-web-clipboard') &&
      /"nameOffsetX":\s*-17/.test(clip),
    'copy uses web envelope with explicit desktop-unavailable notice',
    s.notice,
  );
  const arcsBefore = comp(s).net.arcs.length;
  await page.keyboard.press('Control+v');
  s = await state();
  const pasted = comp(s).net.arcs.filter((x) => x.nameOffsetX === -17 && x.nameOffsetY === 9);
  check(
    comp(s).net.arcs.length === arcsBefore * 2 && pasted.length === 2,
    'web paste preserves relative offsets exactly',
  );

  // F. Three unchanged game originals: open, roles, simulate, initial-source native save.
  for (const name of ['package-delivery', 'untimedGame', 'game-harddisk']) {
    await gallery(name);
    const initial = await state();
    const roles = (st) =>
      st.source.shared.transitions
        .map((p) => p.actor ?? 'controller')
        .concat(
          st.source.components.flatMap((c) =>
            c.net.nodes
              .filter((n) => n.kind === 'transition' && !n.sharedId)
              .map((n) => n.actor ?? 'controller'),
          ),
        )
        .sort()
        .join(',');
    check(
      initial.source.type.game && roles(initial).includes('environment'),
      `${name} opens as game with Environment roles`,
    );
    await mode('Simulate');
    const first = page.locator('.enabled-row').first();
    if (await first.count()) {
      await page.locator('#token-policy').selectOption('oldest');
      await first.click();
      await page.getByRole('button', { name: 'Fire transition', exact: true }).click();
    }
    const fired = (await state()).cursor;
    const path = await saveNative(`${name}-after-step.tapn`);
    await mode('Edit');
    await open(path);
    const reopened = await state();
    const tokens = (st) =>
      st.source.components
        .map((c) =>
          c.net.nodes
            .filter((n) => n.kind === 'place' && !n.sharedId)
            .map((n) => n.tokens)
            .join(','),
        )
        .join('|') +
      '#' +
      st.source.shared.places.map((p) => p.tokens).join(',');
    check(
      roles(reopened) === roles(initial) &&
        tokens(reopened) === tokens(initial) &&
        (reopened.source.savedQueries?.xml.length ?? 0) ===
          (initial.source.savedQueries?.xml.length ?? 0),
      `${name} save after ${fired} step(s) keeps initial source, roles and queries`,
    );
    await shot(`original-${name}`);
  }
  // Query-protected original: role edit keeps opaque queries.
  await gallery('package-delivery');
  s = await state();
  const env = s.source.components
    .flatMap((c) => c.net.nodes.map((n) => ({ c: c.id, n })))
    .find((x) => x.n.actor === 'environment' && x.c === s.component);
  if (env) {
    await openNode(env.n.id);
    await page.locator('#dialog-actor').selectOption('controller');
    await elementDialog().getByRole('button', { name: 'OK', exact: true }).click();
    const after = await state();
    check(
      JSON.stringify(after.source.savedQueries) === JSON.stringify(s.source.savedQueries) &&
        node(after, env.n.id).actor === 'controller',
      'role change on query-bearing original keeps opaque queries',
    );
  } else
    observe('package-delivery active component has no local Environment transition', s.component);
  check(!errors.length, 'no uncaught browser errors', errors);
} finally {
  const shotHashes = Object.fromEntries(
    shots
      .filter(existsSync)
      .map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
  );
  writeFileSync(
    join(out, 'results.json'),
    JSON.stringify({ assertions, results, shots: shotHashes, errors }, null, 2),
  );
  console.log(JSON.stringify({ assertions, out }));
  await context.close();
  await browser.close();
  server.close();
}
