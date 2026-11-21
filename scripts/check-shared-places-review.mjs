#!/usr/bin/env node
// Independent UI review. Mutations exclusively through real browser input/file chooser.
// Read-only Angular signals are observations, never action shortcuts.
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4429';
const OUT = process.argv[3] ?? '/tmp/tapaal-independent-shared-review-1029/browser';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(6500);
const results = [],
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const eq = isDeepStrictEqual;
const settle = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function state() {
  await settle();
  return page.evaluate(() => {
    const a = window.ng.getComponent(document.querySelector('app-root')),
      d = a.activeDocument();
    return JSON.parse(
      JSON.stringify({
        source: d.network,
        past: d.past,
        future: d.future,
        saved: d.saved,
        dirty: a.dirty(),
        mode: a.mode(),
        marking: a.marking(),
        ages: a.currentAges(),
        time: a.globalTime(),
        total: a.physicalTokens(),
        cursor: a.cursor(),
        error: a.error(),
        sharedError: a.sharedError(),
        notice: a.notice(),
        selected: [...a.selectedIds()],
        componentId: d.session.componentId,
        session: d.session,
        trace: a.trace(),
      }),
    );
  });
}
const node = (id) => page.locator(`[data-node="${id}"] .node-shape`);
const pane = () => page.locator('app-shared-places-pane');
const dlg = () => page.locator('app-shared-place-dialog form');
const shot = (name) => page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
const key = async (k) => {
  await settle();
  await page.keyboard.press(k);
  await settle();
};
const mode = (name) =>
  page.locator('[aria-label="Workspace mode"]').getByRole('button', { name, exact: true }).click();
const component = async (name) => {
  await page.locator('.component-row').filter({ hasText: name }).click();
  await settle();
};
async function undo() {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
}
async function redo() {
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settle();
}
async function properties(name) {
  const row = pane()
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: new RegExp('◇ ' + name + ' ·') }) });
  if (!(await row.getAttribute('open'))) {
    if (!(await row.locator('button').first().isVisible())) await row.locator('summary').click();
  }
  await row.getByRole('button', { name: 'Properties…', exact: true }).click();
}
async function ok() {
  await dlg().getByRole('button', { name: 'OK', exact: true }).click();
  await settle();
}
async function openSource(source, name = 'fixture') {
  const path = join(OUT, name + '.json');
  writeFileSync(
    path,
    JSON.stringify({ format: 'tapaal-web-network', version: 3, network: source }, null, 2),
  );
  await openFile(path);
}
async function openFile(path) {
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
async function fresh(source = fixture()) {
  await page.goto(BASE);
  await node('idle').waitFor();
  await openSource(source);
}
async function save(kind, name) {
  await page.locator('summary', { hasText: /^File$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('[aria-label="File actions"]')
      .getByRole('button', { name: kind === 'json' ? 'Save as web JSON…' : /^Save TAPAAL file/ })
      .click(),
  ]);
  const path = join(OUT, name + '.' + (kind === 'json' ? 'json' : 'tapn'));
  await download.saveAs(path);
  return readFileSync(path, 'utf8');
}
async function drag(loc, dx, dy) {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await settle();
}
const timing = () => ({ intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] });
function fixture() {
  return {
    name: 'Independent',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [{ id: 'k', name: 'K', value: 5 }],
    shared: {
      places: [
        {
          id: 'pool',
          name: 'Pool',
          tokens: 2,
          timing: {
            invariant: { upper: { constantId: 'k' }, upperClosed: true },
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
    components: ['Main', 'Side', 'Inactive'].map((name, i) => ({
      id: name.toLowerCase(),
      active: i < 2,
      net: {
        name: 'Independent',
        template: name,
        nodes: [
          { id: 'p', kind: 'place', sharedId: 'pool', x: 90, y: 90 },
          { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 240, y: 90 },
          { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 390, y: 90 },
          { id: 'l', kind: 'place', name: 'Local', tokens: 2, x: 90, y: 270 },
          { id: 'u', kind: 'transition', name: 'U', tokens: 0, x: 240, y: 270 },
          { id: 'r', kind: 'place', name: 'R', tokens: 0, x: 390, y: 270 },
        ],
        arcs: [
          { id: 'i', source: 'p', target: 't', kind: 'normal', weight: 1 },
          { id: 'o', source: 't', target: 'q', kind: 'normal', weight: 1 },
          { id: 'li', source: 'l', target: 'u', kind: 'normal', weight: { constantId: 'k' } },
          { id: 'lo', source: 'u', target: 'r', kind: 'normal', weight: 1 },
        ],
      },
      timing: {
        ...timing(),
        invariants: { l: { upper: '5', upperClosed: true } },
        ages: { l: ['1', '2'] },
      },
    })),
  };
}
async function scenario(id, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  const r = { id, status: 'pass', assertions: [] };
  const check = (ok, message) => {
    r.assertions.push({ ok: !!ok, message });
    if (!ok) r.status = 'fail';
  };
  try {
    await fn(check);
  } catch (e) {
    r.status = 'error';
    r.error = e.stack;
  }
  if (r.status !== 'pass') await shot(id + '-failure').catch(() => {});
  writeFileSync(join(OUT, id + '-state.json'), JSON.stringify(await state(), null, 2));
  results.push(r);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify(r));
}
try {
  await scenario('R01-adoption-history', async (check) => {
    await fresh();
    const before = await state();
    await node('l').dblclick();
    await page
      .getByRole('button', { name: 'Make shared / use existing pool…', exact: true })
      .click();
    await dlg().getByLabel('Sharing action').selectOption('use');
    await dlg().locator('[name=pool]').selectOption('pool');
    check(
      await dlg().getByRole('button', { name: 'OK', exact: true }).isDisabled(),
      'equal numerical invariant literal 5 versus reference K requires consent',
    );
    check(
      (await dlg().innerText()).includes('Tokens are never summed'),
      'explicit adoption explanation',
    );
    await shot('adoption-preview');
    await dlg().getByRole('checkbox').check();
    await ok();
    // Main already contains a pool occurrence: duplicate membership must refuse atomically.
    check(
      eq((await state()).source, before.source) && !!(await state()).sharedError,
      'duplicate occurrence in same component refused atomically',
    );
    await key('Escape');
    await node('p').click();
    await key('Delete');
    await settle();
    const removed = await state();
    check(
      !removed.source.components[0].net.nodes.some((n) => n.id === 'p') &&
        removed.source.shared.places[0].tokens === 2,
      'remove occurrence retains pool',
    );
    await node('l').dblclick();
    await page
      .getByRole('button', { name: 'Make shared / use existing pool…', exact: true })
      .click();
    await dlg().getByLabel('Sharing action').selectOption('use');
    await dlg().locator('[name=pool]').selectOption('pool');
    await dlg().getByRole('checkbox').check();
    await ok();
    const joined = await state();
    check(
      joined.source.components[0].net.nodes.find((n) => n.id === 'l').sharedId === 'pool' &&
        joined.source.shared.places[0].tokens === 2,
      'join replaces local semantics without sum',
    );
    check(
      !('l' in joined.source.components[0].timing.invariants) &&
        !('l' in joined.source.components[0].timing.ages),
      'no member timing in source',
    );
    check(joined.past.length === removed.past.length + 1, 'join one history step');
    await undo();
    check(eq((await state()).source, removed.source), 'whole source undo join');
    await redo();
    check(eq((await state()).source, joined.source), 'whole source redo join');
    await undo();
    await undo();
    check(
      eq((await state()).source, before.source) && !(await state()).dirty,
      'undo to saved checkpoint restores source and clean state',
    );
  });
  await scenario('R02-pool-edit-constants', async (check) => {
    await fresh();
    await properties('Pool');
    await dlg().getByLabel('Initial marking', { exact: true }).fill('3');
    await dlg().getByLabel('Initial ages', { exact: true }).fill('1, 2, 3');
    await shot('pool-property-dialog');
    await ok();
    let s = await state();
    check(
      s.source.shared.places[0].tokens === 3 &&
        s.source.components.every((c) => !('tokens' in c.net.nodes[0])),
      'global edit updates one source across inactive occurrences',
    );
    await properties('Pool');
    const before = await state();
    await dlg().getByLabel('Name', { exact: true }).fill('Local');
    await ok();
    check(
      eq((await state()).source, before.source) && (await dlg().isVisible()),
      'global local-name collision rejected and dialog remains',
    );
    await key('Escape');
    const c = page.locator('app-constants-pane details').first();
    await c.locator('summary').click();
    const uses = c.locator('li button').filter({ hasText: 'Pool' });
    check((await uses.count()) === 1, 'pool constant use counted once');
    check((await uses.innerText()).includes('2 active'), 'active-member count readable');
    await uses.click();
    await settle();
    check(
      (await dlg().isVisible()) &&
        (await dlg().getByLabel('Name', { exact: true }).inputValue()) === 'Pool',
      'constant use opens global pool',
    );
    await key('Escape');
    await c.getByRole('button', { name: 'Edit…', exact: true }).click();
    await page.locator('#constant-value').fill('1');
    await page.locator('app-constant-dialog button[type=submit]').click();
    check(
      eq((await state()).source, before.source) &&
        (await page.locator('app-constant-dialog [role=alert]').isVisible()),
      'invalid constant value atomic, dialog remains',
    );
    await key('Escape');
    await pane().getByRole('button', { name: 'New…', exact: true }).click();
    await dlg().getByLabel('Name', { exact: true }).fill('Unused');
    await dlg().getByLabel('Invariant', { exact: true }).fill('<= K');
    await ok();
    await properties('Unused');
    await key('Escape');
    const row = pane().locator('details').filter({ hasText: '◇ Unused' });
    await row.getByRole('button', { name: 'Delete unused', exact: true }).click();
    check(
      !(await state()).source.shared.places.some((p) => p.name === 'Unused'),
      'unused pool deletion',
    );
    await undo();
    check(
      (await state()).source.shared.places.some((p) => p.name === 'Unused'),
      'undo unused deletion',
    );
    await properties('Pool');
    await key('Escape');
    check(
      await pane()
        .locator('details')
        .filter({ hasText: '◇ Pool' })
        .getByRole('button', { name: 'Delete unused', exact: true })
        .isDisabled(),
      'used pool delete disabled',
    );
    await shot('sharing-pane');
  });
  await scenario('R03-local-adapter', async (check) => {
    await fresh();
    const before = await state();
    await drag(node('p'), 60, 30);
    let s = await state();
    check(
      s.source.components[0].net.nodes[0].x !== before.source.components[0].net.nodes[0].x,
      'shared occurrence geometry editable',
    );
    check(
      eq(s.source.shared, before.source.shared) &&
        eq(s.source.components[0].net.arcs, before.source.components[0].net.arcs),
      'geometry retains pool semantics and arc references',
    );
    await undo();
    check(eq((await state()).source, before.source), 'geometry whole-source undo');
    await node('l').dblclick();
    await page.locator('#dialog-name').fill('EditedLocal');
    await page.locator('app-element-dialog button[type=submit]').click();
    check(
      (await state()).source.components[0].net.nodes.find((n) => n.id === 'l').name ===
        'EditedLocal',
      'local property editing still works',
    );
    check(
      eq((await state()).source.components[0].net.arcs, before.source.components[0].net.arcs),
      'unrelated dialog retains symbolic arc',
    );
    await page.locator('[data-arc="li"] .arc-line').dblclick();
    check(
      (await page.locator('#dialog-weight').inputValue()) === 'K',
      'arc dialog displays source reference',
    );
    await page.locator('#dialog-weight').fill('5');
    await page.locator('app-element-dialog button[type=submit]').click();
    check(
      (await state()).source.components[0].net.arcs.find((a) => a.id === 'li').weight === 5,
      'explicit literal typing replaces equal reference',
    );
    await undo();
    check(
      eq((await state()).source.components[0].net.arcs.find((a) => a.id === 'li').weight, {
        constantId: 'k',
      }),
      'undo restores reference',
    );
    await node('p').click();
    check(await page.locator('#tokens').isDisabled(), 'member inline marking disabled');
    await node('p').dblclick();
    await settle();
    check(
      await dlg().getByRole('button', { name: 'Edit global pool…', exact: true }).isVisible(),
      'member global properties available',
    );
    await key('Escape');
    await node('l').click();
    const b = await node('l').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(150);
    check(
      (await state()).source.components[0].net.nodes.find((n) => n.id === 'l').tokens === 3,
      'local token wheel in shared model',
    );
    await shot('canvas-local-edit');
  });
  await scenario('R04-simulation-files', async (check) => {
    await fresh();
    const initial = (await state()).source;
    const jsonBefore = await save('json', 'initial');
    await mode('Simulate');
    await page.locator('.inspector').hover();
    await page.mouse.wheel(0, -10000);
    await settle();
    const controlsInView = await page.evaluate(() => {
      const sidebar = document.querySelector('.inspector').getBoundingClientRect();
      return [
        'Time and token selection',
        'Enabled transitions',
        'Simulation control',
        'Simulation history',
      ].map((label) => {
        const section = document.querySelector(`section[aria-label="${label}"]`);
        const target = label === 'Simulation history' ? section.querySelector('h2') : section;
        const box = target.getBoundingClientRect();
        return { label, visible: box.top >= sidebar.top && box.bottom <= sidebar.bottom };
      });
    });
    check(
      controlsInView.every((c) => c.visible),
      `essential controls in first sidebar viewport: ${JSON.stringify(controlsInView)}`,
    );
    check(
      (await pane().locator('summary').first().innerText()).includes('initial 2'),
      'pool count explicitly labels its authored initial value during simulation',
    );
    check((await state()).total === 9, 'physical total includes each pool once and frozen locals');
    for (const amount of ['0.1', '0.2']) {
      await page.locator('#delay-amount').fill(amount);
      await page.getByRole('button', { name: 'Delay', exact: true }).click();
    }
    let s = await state();
    check(s.time === '0.3' && eq(s.ages.p, ['1.3', '2.3']), 'exact 0.1+0.2 and pool ages once');
    await page.locator('#token-policy').selectOption('oldest');
    await page.locator('.enabled-row', { hasText: 'Main.T' }).dblclick();
    await component('Side');
    check(
      (await state()).marking.p === 1 && eq((await state()).ages.p, ['1.3']),
      'other active component competes for same oldest pool token',
    );
    await page.locator('#token-policy').selectOption('manual');
    await page.locator('.enabled-row', { hasText: 'Side.T' }).press('Enter');
    check(
      (await page.locator('app-token-selection-dialog').innerText()).includes('Pool'),
      'manual chooser names physical pool',
    );
    await page.locator('app-token-selection-dialog input[type=checkbox]').check();
    await page
      .locator('app-token-selection-dialog')
      .getByRole('button', { name: 'Fire', exact: true })
      .click();
    await component('Inactive');
    s = await state();
    check(
      s.marking.p === 0 && eq(s.ages.l, ['1', '2']) && s.time === '0.3',
      'inactive shared live but inactive local frozen',
    );
    check(
      (await page.locator('.enabled-row').filter({ hasText: /\.T/ }).count()) === 0,
      'pool consumption disables both competing transitions',
    );
    await shot('simulation-inactive');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check((await state()).marking.p === 1, 'back restores shared pool in inactive view');
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    check((await state()).marking.p === 0, 'forward replays pool marking');
    await page.locator('.history-row').nth(2).click();
    check(
      (await state()).time === '0.3' && (await state()).marking.p === 2,
      'history jump keeps global clock',
    );
    await page.locator('#delay-amount').fill('0.1');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    check(
      (await state()).cursor === 3 && (await state()).trace.length === 4,
      'branch discards future',
    );
    const jsonAfter = await save('json', 'midrun');
    check(
      jsonBefore === jsonAfter && eq(JSON.parse(jsonAfter).network, initial),
      'midrun JSON byte-identical authored initial source',
    );
    await mode('Edit');
    await node('p').dblclick();
    await dlg().getByRole('button', { name: 'Detach as local', exact: true }).click();
    s = await state();
    const detached = s.source.components[2].net.nodes.find((n) => n.id === 'p');
    check(
      detached.tokens === 2 &&
        detached.name === 'Pool_local1' &&
        eq(s.source.components[2].timing.ages.p, ['1', '2']),
      'detach copies authored values with fresh name',
    );
  });
  await scenario('R05-clipboard-gate', async (check) => {
    await fresh();
    await node('l').click();
    await key('Control+c');
    await settle();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    check(clipboard.includes('Local'), 'real local copy creates clipboard payload');
    const before = await state();
    await node('p').click();
    for (const k of ['Control+c', 'Control+x', 'Control+d']) {
      await key(k);
      await settle();
      check(
        eq((await state()).source, before.source) && eq((await state()).past, before.past),
        'shared ' + k + ' preserves source/history',
      );
      check(
        (await page.evaluate(() => navigator.clipboard.readText())) === clipboard,
        'shared ' + k + ' preserves system clipboard',
      );
    }
    await page.locator('[data-arc="i"] .arc-line').click();
    await key('Control+x');
    await settle();
    check(
      eq((await state()).source, before.source) &&
        (await page.evaluate(() => navigator.clipboard.readText())) === clipboard,
      'selected incident arc alone cut refused before write',
    );
    await node('l').click();
    await key('Control+c');
    await component('Side');
    const b = await state();
    await key('Control+v');
    await settle();
    check(
      (await state()).source.components[1].net.nodes.length ===
        b.source.components[1].net.nodes.length + 1,
      'local subset paste in same shared model',
    );
    await undo();
    check(eq((await state()).source, b.source), 'local paste atomic undo');
  });
  await scenario('R06-make-shared', async (check) => {
    await fresh();
    await node('l').dblclick();
    await page
      .getByRole('button', { name: 'Make shared / use existing pool…', exact: true })
      .click();
    await dlg().getByLabel('Pool name', { exact: true }).fill('Made');
    await ok();
    const s = await state(),
      p = s.source.shared.places.find((p) => p.name === 'Made');
    check(
      p?.tokens === 2 && eq(p.timing.ages, ['1', '2']) && p.timing.invariant.upper === '5',
      'makeShared transfers exact source semantics',
    );
    check(
      s.source.components[0].net.nodes.find((n) => n.id === 'l').sharedId === p?.id,
      'makeShared replaces node by occurrence',
    );
  });

  await scenario('R07-copy-transport', async (check) => {
    const f = fixture();
    f.components[0].timing.transports = [{ inputArc: 'i', outputArc: 'o' }];
    await fresh(f);
    const before = await state();
    await page
      .locator('.component-actions')
      .getByRole('button', { name: 'Copy…', exact: true })
      .click();
    await page.locator('app-document-dialog button[type=submit]').click();
    let s = await state();
    check(
      s.source.components.length === 4 &&
        s.source.shared.places.length === 2 &&
        s.source.shared.places[0].tokens === 2,
      'component copy retains one pool',
    );
    const copy = s.source.components.find((c) => c.net.template === 'Main_copy');
    check(copy?.net.nodes[0].sharedId === 'pool', 'copied component retains explicit membership');
    await drag(node('p'), 30, 30);
    s = await state();
    writeFileSync(
      join(OUT, 'copy-geometry-state.json'),
      JSON.stringify({ before: before.source, after: s.source }, null, 2),
    );
    check(
      eq(
        s.source.components.find((c) => c.id === 'main'),
        before.source.components[0],
      ),
      'copy geometry independently editable',
    );
    await node('p').click();
    await key('Delete');
    s = await state();
    const c = s.source.components.find((c) => c.id === copy.id);
    check(
      !c.net.arcs.some((a) => ['i', 'o'].includes(a.id)) &&
        !c.timing.transports.length &&
        s.source.shared.places.length === 2,
      'occurrence deletion removes both transport halves and retains pool',
    );
    await undo();
    check(
      (await state()).source.components.find((c) => c.id === copy.id).timing.transports.length ===
        1,
      'undo restores transport pair',
    );
  });
  await scenario('R08-query-protections', async (check) => {
    const f = fixture();
    f.savedQueries = {
      xml: ['<query active="true" name="Q" type="Default" query="EF Pool &gt;= 1"/>'],
      protectedConstants: f.constants.map(({ id, name }) => ({ id, name })),
      protectedComponents: f.components.map((c) => ({
        id: c.id,
        name: c.net.template,
        nodes: c.net.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name ?? 'Pool' })),
      })),
      protectedSharedPlaces: f.shared.places.map(({ id, name }) => ({ id, name })),
      protectedMembership: f.components.flatMap((c) =>
        c.net.nodes.map((n) => ({
          componentId: c.id,
          elementId: n.id,
          sharedId: n.sharedId ?? null,
        })),
      ),
    };
    await fresh(f);
    const before = await state();
    check(eq(before.source.savedQueries, f.savedQueries), 'query metadata opens unchanged');
    await properties('Pool');
    await dlg().getByLabel('Name', { exact: true }).fill('Renamed');
    await ok();
    check(
      eq((await state()).source, before.source) && !!(await state()).sharedError,
      'query-protected rename refused atomically',
    );
    await key('Escape');
    await node('p').dblclick();
    await dlg().getByRole('button', { name: 'Detach as local', exact: true }).click();
    await settle();
    check(
      eq((await state()).source, before.source) && !!(await state()).sharedError,
      'query-protected detach refused',
    );
    await key('Escape');
    await node('p').click();
    await key('Delete');
    check(eq((await state()).source, before.source), 'query-protected removal refused');
    await properties('Dormant');
    await key('Escape');
    await pane()
      .locator('details')
      .filter({ hasText: '◇ Dormant' })
      .getByRole('button', { name: 'Delete unused', exact: true })
      .click();
    check(eq((await state()).source, before.source), 'query-protected unused deletion refused');
    await node('l').dblclick();
    await page
      .getByRole('button', { name: 'Make shared / use existing pool…', exact: true })
      .click();
    await dlg().getByLabel('Pool name', { exact: true }).fill('NewPool');
    await ok();
    check(
      eq((await state()).source, before.source) && !!(await state()).sharedError,
      'query-protected conversion refused',
    );
    await key('Escape');
    await properties('Pool');
    await dlg().getByLabel('Initial marking', { exact: true }).fill('3');
    await ok();
    check(
      (await state()).source.shared.places[0].tokens === 3 &&
        eq((await state()).source.savedQueries, f.savedQueries),
      'value edit allowed without query metadata change',
    );
    await undo();
    await drag(node('p'), 30, 30);
    check(
      !eq((await state()).source, before.source) &&
        eq((await state()).source.savedQueries, f.savedQueries),
      'geometry edit allowed under protections',
    );
    await undo();
    await page.locator('summary', { hasText: 'Remove saved queries…' }).click();
    await page.getByRole('button', { name: 'Remove all queries', exact: true }).click();
    check(!(await state()).source.savedQueries, 'explicit remove queries');
    await undo();
    check(eq((await state()).source, before.source), 'undo restores exact protections');
    await node('p').click();
    await key('Delete');
    check(eq((await state()).source, before.source), 'restored protections refuse removal');
  });
  await scenario('R09-TAPN-and-gates', async (check) => {
    await fresh();
    const before = await save('tapn', 'authored-before');
    await mode('Simulate');
    await page.locator('#delay-amount').fill('0.3');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    await page.locator('.enabled-row', { hasText: 'Main.T' }).dblclick();
    const after = await save('tapn', 'authored-midrun');
    check(before === after, 'TAPN midrun byte-identical authored source');
    await openFile(join(OUT, 'authored-midrun.tapn'));
    let s = await state();
    check(
      s.source.shared.places.length === 2 &&
        s.source.shared.places[0].tokens === 2 &&
        s.source.components.length === 3 &&
        !s.source.components[2].active,
      'TAPN reopen preserves initial pool and inactive/unused meaning',
    );
    check(
      s.source.shared.places[0].timing.invariant.upper.constantId === s.source.constants[0].id,
      'TAPN retains symbolic pool invariant',
    );
    check(
      (await page.locator('body').innerText()).includes('4.0.4'),
      'nonzero-age native release warning visible',
    );
    for (const feature of ['colored', 'game', 'stochastic', 'sharedTransitions', 'v2']) {
      const f = fixture();
      if (feature === 'sharedTransitions') f.shared.transitions = [{ id: 'x', name: 'Sync' }];
      else if (feature !== 'v2') f.type[feature] = true;
      const path = join(OUT, 'rejected-' + feature + '.json');
      writeFileSync(
        path,
        JSON.stringify({
          format: 'tapaal-web-network',
          version: feature === 'v2' ? 2 : 3,
          network: f,
        }),
      );
      const old = (await state()).source;
      await openFile(path);
      check(
        eq((await state()).source, old) && !!(await state()).error,
        feature + ' refused without flattening or replacement',
      );
    }
  });
  await scenario('R10-dormant-empty-urgent', async (check) => {
    const f = fixture();
    f.components.forEach((c) => (c.active = false));
    await fresh(f);
    await mode('Simulate');
    check((await page.locator('.enabled-row').count()) === 0, 'all inactive exposes no events');
    await page.locator('#delay-amount').fill('10');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    check(
      (await state()).time === '10' &&
        eq((await state()).ages.p, ['11', '12']) &&
        eq((await state()).ages.l, ['1', '2']),
      'all-inactive pool ages past invariant while local frozen',
    );
    await mode('Edit');
    await page.getByLabel('Include Main in network', { exact: true }).check();
    await mode('Simulate');
    check(
      (await state()).time === '0' && eq((await state()).ages.p, ['1', '2']),
      'activation starts at authored initial state',
    );
    await page.locator('#delay-amount').fill('4');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    check(
      (await state()).time === '0' && !!(await state()).error,
      'occupied active pool invariant blocks delay',
    );
    const empty = fixture();
    empty.shared.places[0].tokens = 0;
    empty.shared.places[0].timing = { invariant: { upper: '0', upperClosed: true }, ages: [] };
    empty.components.forEach((c) => {
      c.net.nodes.find((n) => n.id === 'l').tokens = 0;
      c.timing.ages = {};
    });
    await fresh(empty);
    await mode('Simulate');
    await page.locator('#delay-amount').fill('10');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    check((await state()).time === '10', 'empty invariant does not block global time');
    const urgent = fixture();
    urgent.components[0].timing.urgent = ['t'];
    await fresh(urgent);
    await mode('Simulate');
    await page.locator('#delay-amount').fill('0.1');
    await page.getByRole('button', { name: 'Delay', exact: true }).click();
    check((await state()).time === '0', 'enabled urgent transition blocks delay');
  });
  await scenario('R11-untimed-capacity-help', async (check) => {
    const f = fixture();
    f.type.timed = false;
    f.shared.places.forEach((p) => delete p.timing);
    f.components.forEach((c) => delete c.timing);
    await fresh(f);
    await mode('Simulate');
    check(
      (await page.locator('#delay-amount').count()) === 0,
      'untimed shared model exposes no delay',
    );
    await mode('Edit');
    const large = fixture();
    large.shared.places[0].tokens = 100001;
    await fresh(large);
    const saved = await save('json', 'oversized');
    check(
      JSON.parse(saved).network.shared.places[0].tokens === 100001,
      'oversized source saveable',
    );
    await mode('Simulate');
    check(
      /100.?000|capacity|Reduce|reduce/.test((await state()).error),
      'capacity error actionable',
    );
    await page.getByRole('button', { name: 'New model', exact: true }).first().click();
    await settle();
    await shot('new-model-help');
    check(
      !(await page.locator('app-document-dialog').innerText()).includes('Shared, coloured'),
      'new-model help does not falsely claim all sharing refused',
    );
  });

  await scenario('R12-geometry-keyboard', async (check) => {
    await fresh();
    const initial = (await state()).source;
    await node('p').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Hide place name', exact: true }).click();
    check(
      (await state()).source.components[0].net.nodes[0].nameVisible === false &&
        (await page.locator('[data-node="p"] .shared-ring').count()) === 1,
      'hidden shared name retains ring',
    );
    await undo();
    await drag(page.locator('[data-node="p"] .node-name'), 30, 15);
    check(
      !eq((await state()).source.components[0].net.nodes[0], initial.components[0].net.nodes[0]) &&
        eq((await state()).source.shared, initial.shared),
      'member label drag preserves semantics',
    );
    await undo();
    await node('t').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rotate +45°', exact: true }).click();
    check(
      (await state()).source.components[0].net.nodes.find((n) => n.id === 't').angle === 45,
      'transition rotation works in shared model',
    );
    await undo();
    await page.getByRole('button', { name: 'Annotation', exact: true }).click();
    const canvas = await page.locator('svg.net-canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 70);
    await page.locator('#annotation-text').fill('Independent shared review');
    await page.locator('app-annotation-dialog button[type=submit]').click();
    check(
      (await state()).source.components[0].net.annotations?.[0].text ===
        'Independent shared review',
      'annotation create in shared model',
    );
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await undo();
    await page.locator('svg.net-canvas').focus();
    await key('a');
    await page.keyboard.down('Control');
    try {
      for (const dx of [250, 400, 550])
        await page.mouse.click(canvas.x + dx, canvas.y + canvas.height - 60);
    } finally {
      await page.keyboard.up('Control');
    }
    await key('Escape');
    let s = await state();
    check(
      s.source.components[0].net.nodes.length === 9 && s.source.components[0].net.arcs.length === 6,
      'Quick Draw adds local P/T/P and arcs',
    );
    check(
      eq(s.source.shared, initial.shared) &&
        eq(s.source.components[0].net.arcs.find((a) => a.id === 'li').weight, { constantId: 'k' }),
      'Quick Draw retains pool authority and unrelated reference',
    );
    await properties('Pool');
    await settle();
    check(
      await dlg()
        .getByLabel('Name', { exact: true })
        .evaluate((e) => e === document.activeElement),
      'dialog initial focus',
    );
    await key('Shift+Tab');
    check(
      await dlg()
        .getByRole('button', { name: 'OK', exact: true })
        .evaluate((e) => e === document.activeElement),
      'Shift Tab wraps to last dialog control',
    );
    await key('Tab');
    check(
      await dlg()
        .getByLabel('Name', { exact: true })
        .evaluate((e) => e === document.activeElement),
      'Tab wraps to first dialog control',
    );
    await key('Escape');
    check(!(await dlg().count()), 'Escape closes modal');
    await shot('canvas-geometry');
  });
  await scenario('R13-weighted-transport-inhibitor', async (check) => {
    const f = fixture(),
      c = f.components[0];
    c.net.arcs.find((a) => a.id === 'i').weight = 2;
    c.net.arcs.find((a) => a.id === 'o').weight = 2;
    c.timing.transports = [{ inputArc: 'i', outputArc: 'o' }];
    c.timing.intervals.i = { lower: '1', upper: '3', lowerClosed: true, upperClosed: true };
    c.timing.invariants.q = { upper: '3', upperClosed: true };
    c.net.arcs.push({ id: 'inhibit', source: 'p', target: 'u', kind: 'inhibitor', weight: 2 });
    c.net.arcs.find((a) => a.id === 'li').weight = 1;
    await fresh(f);
    await mode('Simulate');
    check(
      !(await page.locator('.enabled-row', { hasText: 'Main.U' }).count()),
      'global inhibitor sees physical pool count',
    );
    await page.locator('#token-policy').selectOption('manual');
    await page.locator('.enabled-row', { hasText: 'Main.T' }).press('Enter');
    await settle();
    const boxes = page.locator('app-token-selection-dialog input[type=checkbox]');
    check((await boxes.count()) === 2, 'weighted transport offers eligible token identities');
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
    await page
      .locator('app-token-selection-dialog')
      .getByRole('button', { name: 'Fire', exact: true })
      .click();
    let s = await state();
    check(
      s.marking.p === 0 && s.marking.q === 2 && eq(s.ages.q, ['1', '2']),
      'weighted pool to local transport preserves ages',
    );
    check(
      (await page.locator('.enabled-row', { hasText: 'Main.U' }).count()) === 1,
      'inhibitor enables after shared pool emptied',
    );
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('#token-policy').selectOption('youngest');
    await page.locator('.enabled-row', { hasText: 'Side.T' }).dblclick();
    await component('Side');
    check(eq((await state()).ages.p, ['2']), 'youngest consumes youngest physical shared token');
  });
  await scenario('R14-symbolic-paste-pool-collision', async (check) => {
    const f = fixture();
    f.components[0].timing.invariants.l = { upper: { constantId: 'k' }, upperClosed: true };
    await fresh(f);
    await node('l').click();
    await key('Control+c');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(clip.includes('K'), 'symbolic local copy includes dependency');
    const target = fixture();
    target.constants = [];
    target.shared.places[0].timing.invariant = { upper: '5', upperClosed: true };
    target.components.forEach((c) => (c.net.arcs.find((a) => a.id === 'li').weight = 1));
    await openSource(target, 'paste-target');
    const before = await state();
    await page.locator('svg.net-canvas').focus();
    await key('Control+v');
    let s = await state();
    check(
      s.source.constants.length === 1 && s.source.components[0].net.nodes.length === 7,
      'cross-document symbolic paste imports declaration and local node',
    );
    await undo();
    check(
      eq((await state()).source, before.source),
      'undo symbolic paste restores entire source/declarations',
    );
    const collision = structuredClone(target);
    collision.shared.places.push({
      id: 'collision',
      name: 'P0',
      tokens: 0,
      timing: { invariant: null, ages: [] },
    });
    collision.components.forEach((c) => {
      c.net.nodes.find((n) => n.id === 'l').name = 'Other';
    });
    await openSource(collision, 'pool-name-collision');
    const old = await state();
    await page.locator('svg.net-canvas').focus();
    await key('Control+v');
    s = await state();
    const added = s.source.components[0].net.nodes.filter(
      (n) => !old.source.components[0].net.nodes.some((o) => o.id === n.id),
    );
    check(
      added.length === 1 &&
        added[0].name !== 'P0' &&
        !('sharedId' in added[0]) &&
        eq(s.source.shared, old.source.shared),
      'UI name allocator avoids global pool name without implicit binding',
    );
    check(
      (await page.evaluate(() => navigator.clipboard.readText())) === clip,
      'collision preserves copied data',
    );
  });
  await scenario('R15-migration', async (check) => {
    await page.goto(BASE);
    await node('idle').waitFor();
    const newSource = (await state()).source;
    check(Array.isArray(newSource.shared.places), 'initial document owns V3 source');
    await page.getByRole('button', { name: 'New model', exact: true }).first().click();
    await page.locator('app-document-dialog button[type=submit]').click();
    check((await state()).source.shared.places.length === 0, 'New owns V3 source');
    const old = fixture();
    old.components = old.components.slice(0, 1);
    const p = old.components[0].net.nodes[0];
    delete p.sharedId;
    p.name = 'Legacy';
    p.tokens = 2;
    delete old.shared;
    for (const version of [2, 1]) {
      const n = structuredClone(old);
      if (version === 1) {
        delete n.constants;
        n.components[0].net.arcs.find((a) => a.id === 'li').weight = 5;
      }
      const path = join(OUT, 'legacy-v' + version + '.json');
      writeFileSync(path, JSON.stringify({ format: 'tapaal-web-network', version, network: n }));
      await openFile(path);
      const s = await state();
      check(
        !s.error &&
          s.source.shared.places.length === 0 &&
          s.source.components[0].net.nodes[0].name === 'Legacy',
        'numeric/scalar v' + version + ' migrates to empty-pool V3',
      );
    }
  });
} finally {
  await context.close();
  await browser.close();
}
console.log(
  JSON.stringify({
    scenarios: results.length,
    assertions: results.reduce((n, r) => n + r.assertions.length, 0),
    failed: results.filter((r) => r.status !== 'pass').map((r) => r.id),
    errors,
  }),
);
process.exitCode = results.some((r) => r.status !== 'pass') || errors.length ? 1 : 0;
