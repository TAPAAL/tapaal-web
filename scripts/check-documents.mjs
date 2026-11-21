#!/usr/bin/env node
// Browser validation of document tabs, components and whole-network files
// (see design/DOCUMENT-VALIDATION.md). Drives a running development build with real Playwright
// mouse, keyboard and file-chooser input; app state is only read, never driven through app methods.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   node scripts/check-documents.mjs http://127.0.0.1:4327 /tmp/tapaal-documents
//
// Exit status 1 when any check fails. Results: <out>/results.json, screenshots, saved/opened files.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4327';
const OUT = process.argv[3] ?? '/tmp/tapaal-documents';
mkdirSync(OUT, { recursive: true });

const results = [];
let page;

// ---- fixtures (query-free, supported untimed P/T content) ---------------------
const TYPE = { timed: false, colored: false, game: false, stochastic: false };
const fixtureNet = (template, extra = 0) => ({
  name: 'Two part model',
  template,
  nodes: [
    { id: 'p', kind: 'place', name: 'Ready', x: 120, y: 120, tokens: 2 + extra },
    { id: 't', kind: 'transition', name: 'Go', x: 300, y: 120, tokens: 0 },
    { id: 'q', kind: 'place', name: 'Done', x: 480, y: 120, tokens: 0 },
  ],
  arcs: [
    { id: 'a', source: 'p', target: 't', kind: 'normal', weight: 3 },
    {
      id: 'b',
      source: 't',
      target: 'q',
      kind: 'normal',
      weight: 1,
      bends: [
        { x: 390, y: 60, curved: false },
        { x: 420, y: 90, curved: true },
      ],
      curvedEnd: true,
    },
    { id: 'c', source: 'q', target: 't', kind: 'inhibitor', weight: 2 },
  ],
});
const FIXTURE = {
  format: 'tapaal-web-network',
  version: 1,
  network: {
    name: 'Two part model',
    type: TYPE,
    components: [
      { id: 'tapn:Main', active: true, net: fixtureNet('Main') },
      { id: 'tapn:Spare', active: false, net: fixtureNet('Spare', 5) },
    ],
  },
};
const FIXTURE_PATH = join(OUT, 'fixture-two-components.json');
writeFileSync(FIXTURE_PATH, JSON.stringify(FIXTURE, null, 2));
const GARBAGE_PATH = join(OUT, 'garbage.tapn');
writeFileSync(GARBAGE_PATH, '<pnml><net id="x" type="P/T net"><place');
const TIMED_PATH = join(OUT, 'timed.tapn');
writeFileSync(
  TIMED_PATH,
  `<?xml version="1.0" encoding="UTF-8"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <net active="true" id="TA" type="P/T net">
    <place displayName="true" id="P0" initialMarking="1" invariant="&lt;= 5" name="P0" nameOffsetX="0" nameOffsetY="0" positionX="90" positionY="90"/>
  </net>
  <k-bound bound="3"/>
  <feature isColored="false" isGame="false" isTimed="true" isStochastic="false"/>
</pnml>`,
);

// ---- read-only state probes -------------------------------------------------
const settle = () =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
const state = async () => {
  await settle();
  return page.evaluate(() => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const ws = app.workspace();
    return {
      activeId: ws.activeDocumentId,
      docs: ws.documents.map((d) => ({
        id: d.id,
        name: d.network.name,
        dirty: app.isDocumentDirty(d),
        past: d.past.length,
        future: d.future.length,
        componentId: d.session.componentId,
        views: d.session.views,
        network: d.network,
        components: d.network.components.map((c) => ({
          id: c.id,
          name: c.net.template,
          active: c.active,
          nodes: c.net.nodes.map((n) => n.name),
        })),
      })),
      net: app.net(),
      view: app.viewport(),
      selected: app.selectedIds(),
      arcStart: app.arcStart(),
      tool: app.tool(),
      mode: app.mode(),
      cursor: app.cursor(),
      marking: app.marking(),
      traceLength: app.trace().length,
      dirty: app.dirty(),
      canUndo: app.canUndo(),
      error: app.error(),
      notice: app.notice(),
      tabs: [...document.querySelectorAll('.document-tab button:first-child')].map((b) =>
        b.getAttribute('aria-label'),
      ),
      componentRows: [...document.querySelectorAll('.component-row')].map((b) =>
        b.textContent.trim(),
      ),
      dialog: document.querySelector('[role=dialog] h2')?.textContent.trim() ?? null,
      dialogAlert: document.querySelector('[role=dialog] [role=alert]')?.textContent.trim() ?? null,
      banner: document.querySelector('.error-banner')?.textContent.trim() ?? null,
      empty: !!document.querySelector('.empty-workspace'),
      focusedId: document.activeElement?.id ?? '',
    };
  });
};
const active = (s) => s.docs.find((d) => d.id === s.activeId);
const toClient = async (x, y) =>
  (await settle()) ??
  page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('svg.net-canvas');
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
const nodeBox = async (name) =>
  (await settle()) ??
  page.evaluate((name) => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const id = app.net().nodes.find((n) => n.name === name).id;
    const r = document
      .querySelector(`[data-node="${CSS.escape(id)}"] .node-shape`)
      .getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
async function clickModel(x, y) {
  const p = await toClient(x, y);
  await page.mouse.click(p.x, p.y);
}
async function clickNode(name) {
  const b = await nodeBox(name);
  await page.mouse.click(b.x, b.y);
}

// ---- real controls ---------------------------------------------------------
const btn = (name, exact = true) => page.getByRole('button', { name, exact });
const dialog = () => page.getByRole('dialog');
const tab = (title) => page.locator('.document-tab').filter({ hasText: `${title}.tapn` });
async function clickTab(title) {
  await tab(title).locator('button').first().click();
}
async function closeTab(title) {
  await page.getByRole('button', { name: `Close ${title}`, exact: true }).click();
}
async function componentRow(name) {
  await page
    .locator('.component-row', { hasText: new RegExp(`^\\s*${name}( \\(inactive\\))?\\s*$`) })
    .click();
}
async function addPlaceAt(x, y) {
  await page.locator('svg.net-canvas').focus();
  await page.keyboard.press('p');
  await clickModel(x, y);
  await page.keyboard.press('s');
}
async function newModel(name, componentName) {
  await btn('New model').first().click();
  await dialog().waitFor();
  if (name !== undefined) await dialog().getByLabel('Model name', { exact: true }).fill(name);
  if (componentName !== undefined)
    await dialog().getByLabel('Component name', { exact: true }).fill(componentName);
  await dialog().getByRole('button', { name: 'Create' }).click();
}
async function componentAction(label, componentName) {
  await page.locator('.component-actions').getByRole('button', { name: label }).click();
  await dialog().waitFor();
  await dialog().getByLabel('Component name', { exact: true }).fill(componentName);
  await dialog().getByRole('button', { name: 'Apply' }).click();
}
async function openFile(path) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.command-toolbar').getByRole('button', { name: 'Open model' }).click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForTimeout(150);
}
async function download(trigger, name) {
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 3000 }).catch(() => null),
    trigger(),
  ]);
  if (!file) return null;
  const path = join(OUT, name ?? file.suggestedFilename());
  await file.saveAs(path);
  return { path, suggested: file.suggestedFilename(), text: readFileSync(path, 'utf8') };
}
const ctrlS = (name) => download(() => page.keyboard.press('Control+s'), name);
async function saveJson(name) {
  return download(async () => {
    await page.locator('summary', { hasText: 'File' }).click();
    await btn('Save as web JSON…').click();
  }, name);
}
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}
// Persistent content only; component IDs from TAPN are derived from names.
const canonical = (network) =>
  JSON.stringify({
    name: network.name,
    type: network.type,
    components: network.components.map((c) => ({
      name: c.net.template,
      active: c.active,
      nodes: [...c.net.nodes]
        .map(({ id, kind, name, x, y, tokens }) => ({ id, kind, name, x, y, tokens }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      arcs: [...c.net.arcs]
        .map(({ id, source, target, kind, weight, bends, curvedEnd }) => ({
          id,
          source,
          target,
          kind,
          weight,
          bends: bends ?? [],
          curvedEnd: !!curvedEnd,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })),
  });

async function fresh() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  await page.locator('svg.net-canvas').focus();
}

async function check(id, title, fn) {
  const record = { id, title, status: 'pass', observations: [] };
  const note = (line) => record.observations.push(line);
  const expect = (cond, line) => {
    note(`${cond ? 'OK  ' : 'FAIL'} ${line}`);
    if (!cond) record.status = 'fail';
  };
  try {
    await fresh();
    await fn({ note, expect });
  } catch (error) {
    record.status = 'error';
    note(`ERROR ${error.stack ?? error}`);
    await shot(`${id}-error`).catch(() => {});
  }
  results.push(record);
  console.log(`${record.status.toUpperCase().padEnd(5)} ${id} ${title}`);
  for (const line of record.observations) console.log(`      ${line}`);
}

// ---- scenarios -------------------------------------------------------------
const CHECKS = [
  [
    'T1',
    'New: Cancel and Escape leave the dirty document and its history unchanged',
    async ({ expect, note }) => {
      await addPlaceAt(300, 480);
      const before = await state();
      expect(before.dirty && before.docs.length === 1, `demo edited: dirty ${before.dirty}`);
      await btn('New model').first().click();
      let s = await state();
      expect(s.dialog === 'New model', `dialog "${s.dialog}", focus #${s.focusedId}`);
      await page.keyboard.type('Ignored');
      await dialog().getByRole('button', { name: 'Cancel' }).click();
      s = await state();
      expect(
        !s.dialog &&
          s.docs.length === 1 &&
          canonical(s.docs[0].network) === canonical(before.docs[0].network) &&
          s.docs[0].past === before.docs[0].past &&
          s.dirty,
        `Cancel: ${s.docs.length} tab, history ${s.docs[0].past}, dirty ${s.dirty}`,
      );
      await btn('New model').first().click();
      await page.keyboard.press('Escape');
      s = await state();
      note(
        `Escape pressed immediately after the click (focus not yet moved): dialog ${s.dialog ?? 'closed'}, focus #${s.focusedId}`,
      );
      if (s.dialog) {
        await page.keyboard.press('Escape');
        s = await state();
      }
      expect(!s.dialog && s.docs.length === 1, `Escape closes dialog, tabs ${s.docs.length}`);
      await page.locator('summary', { hasText: 'File' }).click();
      await btn('New model').first().click();
      await dialog().getByRole('button', { name: 'Cancel' }).click();
      s = await state();
      expect(!s.dialog && s.docs.length === 1, 'File > New model > Cancel also unchanged');
    },
  ],
  [
    'T2',
    'New creates a second tab; the dirty first tab is kept intact',
    async ({ expect, note }) => {
      await addPlaceAt(300, 480);
      const first = active(await state());
      await newModel('Second model', 'Worker');
      const s = await state();
      note(`tabs: ${s.tabs.join(' | ')}`);
      expect(s.docs.length === 2, `two tabs (${s.docs.length})`);
      const second = active(s);
      expect(
        second.name === 'Second model' &&
          second.components.length === 1 &&
          second.components[0].name === 'Worker' &&
          second.components[0].nodes.length === 0,
        `active is new empty "${second.name}"/${second.components[0].name}`,
      );
      expect(second.dirty, 'a new unsaved document is dirty (native: unsaved new tab)');
      const kept = s.docs.find((d) => d.id === first.id);
      expect(
        kept.dirty && canonical(kept.network) === canonical(first.network),
        `first tab still dirty with its edit (${kept.components[0].nodes.length} nodes)`,
      );
      expect(s.net.nodes.length === 0, `canvas shows new empty net (${s.net.nodes.length})`);
      await newModel('   ');
      const blank = await state();
      expect(
        blank.dialog && blank.dialogAlert && blank.docs.length === 2,
        `blank model name refused inside dialog: "${blank.dialogAlert}"`,
      );
      await page.keyboard.press('Escape');
      await shot('T2-two-tabs');
    },
  ],
  [
    'T3',
    'Undo/redo histories and save checkpoints stay independent across tab switches',
    async ({ expect }) => {
      await addPlaceAt(300, 480);
      await newModel('Second model');
      await addPlaceAt(200, 200);
      await addPlaceAt(320, 200);
      let s = await state();
      const second = active(s);
      expect(second.past === 2, `second tab history ${second.past}`);
      await clickTab('Producer cycle');
      s = await state();
      expect(
        active(s).name === 'Producer cycle' && s.net.nodes.length === 7,
        `switched to first: ${s.net.nodes.length} nodes`,
      );
      await btn('Undo').click();
      s = await state();
      const first = active(s);
      expect(
        first.past === 0 && first.future === 1 && !first.dirty && s.net.nodes.length === 6,
        `Undo in first: past ${first.past}, future ${first.future}, dirty ${first.dirty}`,
      );
      const other = s.docs.find((d) => d.id === second.id);
      expect(
        other.past === 2 && other.components[0].nodes.length === 2,
        `second untouched: past ${other.past}, nodes ${other.components[0].nodes.join()}`,
      );
      await btn('Redo').click();
      await page.locator('svg.net-canvas').focus();
      const tapn = await ctrlS('T3-first.tapn');
      s = await state();
      expect(!!tapn, `Ctrl+S downloads TAPN (banner "${s.banner}")`);
      const saved = tapn ?? (await saveJson('T3-first.json'));
      s = await state();
      expect(
        !active(s).dirty && s.docs.find((d) => d.id === second.id).dirty,
        `after Ctrl+S on first: first dirty ${active(s).dirty}, second dirty ${s.docs.find((d) => d.id === second.id).dirty}`,
      );
      expect(
        /^Producer_cycle\.(tapn|json)$/.test(saved.suggested),
        `download name ${saved.suggested}`,
      );
      expect(
        s.tabs.some((t) => t === 'Producer cycle (saved)') &&
          s.tabs.some((t) => t === 'Second model (modified)'),
        `tab labels: ${s.tabs.join(' | ')}`,
      );
      await clickTab('Second model');
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('Control+z');
      s = await state();
      expect(
        active(s).past === 1 && s.net.nodes.length === 1,
        `Ctrl+Z in second: past ${active(s).past}`,
      );
      await clickTab('Producer cycle');
      s = await state();
      expect(
        !active(s).dirty && active(s).past === 1,
        `first still saved after second's undo (past ${active(s).past})`,
      );
      await btn('Undo').click();
      s = await state();
      expect(active(s).dirty, 'undo past the save checkpoint makes first dirty again');
      await btn('Redo').click();
      s = await state();
      expect(!active(s).dirty, 'redo back to the checkpoint is clean again');
    },
  ],
  [
    'T4',
    'Dirty close: Cancel/Escape keep everything; explicit Discard closes',
    async ({ expect }) => {
      await addPlaceAt(300, 480);
      const before = active(await state());
      await closeTab('Producer cycle');
      let s = await state();
      expect(s.dialog === 'Close model?', `dialog "${s.dialog}", focus #${s.focusedId}`);
      await dialog().getByRole('button', { name: 'Cancel' }).click();
      s = await state();
      expect(
        !s.dialog &&
          s.docs.length === 1 &&
          canonical(active(s).network) === canonical(before.network) &&
          active(s).past === before.past,
        'Cancel retains tab, content and history',
      );
      await closeTab('Producer cycle');
      await page.keyboard.press('Escape');
      s = await state();
      expect(!s.dialog && s.docs.length === 1, 'Escape retains tab');
      await closeTab('Producer cycle');
      await dialog().getByRole('button', { name: 'Discard changes and close' }).click();
      s = await state();
      expect(s.docs.length === 0 && s.empty, `discarded: ${s.docs.length} tabs, empty ${s.empty}`);
    },
  ],
  [
    'T5',
    'Close all leaves a usable empty workspace; New and Open work from it',
    async ({ expect, note }) => {
      await closeTab('Producer cycle');
      let s = await state();
      expect(!s.dialog && s.docs.length === 0, 'clean tab closes without prompt');
      expect(s.empty && s.activeId === null, 'empty workspace shown');
      note(`canvas net "${s.net.name}", ${s.net.nodes.length} nodes; error "${s.error}"`);
      await shot('T5-empty');
      // Keys and controls in the empty workspace must not throw or create content.
      await page
        .locator('svg.net-canvas')
        .focus()
        .catch(() => {});
      for (const key of ['p', 'Control+z', 'Control+a', 'm', 'Delete'])
        await page.keyboard.press(key);
      await btn('Undo')
        .click({ force: true })
        .catch(() => {});
      s = await state();
      expect(
        s.docs.length === 0 && !s.banner,
        `keys in empty workspace harmless (banner ${s.banner})`,
      );
      let save = null;
      page.once('download', (d) => (save = d));
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(300);
      expect(!save, 'Ctrl+S with no model downloads nothing');
      await page.locator('.empty-workspace').getByRole('button', { name: 'New model' }).click();
      await dialog().getByLabel('Model name', { exact: true }).fill('From empty');
      await dialog().getByRole('button', { name: 'Create' }).click();
      s = await state();
      expect(s.docs.length === 1 && active(s).name === 'From empty' && !s.empty, 'New from empty');
      await addPlaceAt(200, 200);
      s = await state();
      expect(
        s.net.nodes.length === 1,
        `editable after New (${s.net.nodes.join?.() ?? s.net.nodes.length})`,
      );
      await closeTab('From empty');
      await dialog().getByRole('button', { name: 'Discard changes and close' }).click();
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('.empty-workspace').getByRole('button', { name: 'Open model…' }).click(),
      ]);
      await chooser.setFiles(FIXTURE_PATH);
      await page.waitForTimeout(150);
      s = await state();
      expect(
        s.docs.length === 1 && active(s).name === 'Two part model' && !active(s).dirty,
        `Open from empty: ${s.tabs.join(' | ')}`,
      );
    },
  ],
  [
    'T6',
    'Components: add, copy, rename, reorder, remove; all-inactive source; undo',
    async ({ expect, note }) => {
      await componentAction('Add…', 'Worker');
      let s = await state();
      expect(
        s.componentRows.join() === 'Producer,Worker' && s.net.template === 'Worker',
        `add: rows ${s.componentRows.join()}, viewing ${s.net.template}`,
      );
      await componentRow('Producer');
      await componentAction('Copy…', 'Producer_2');
      s = await state();
      expect(
        s.componentRows.join() === 'Producer,Worker,Producer_2' && s.net.nodes.length === 6,
        `copy: rows ${s.componentRows.join()}, viewing ${s.net.template} with ${s.net.nodes.length} nodes`,
      );
      await componentAction('Copy…', 'Producer_2');
      s = await state();
      expect(
        !!s.dialogAlert && s.componentRows.length === 3,
        `duplicate name refused in dialog: "${s.dialogAlert}"`,
      );
      await dialog().getByLabel('Component name', { exact: true }).fill('2bad');
      await dialog().getByRole('button', { name: 'Apply' }).click();
      s = await state();
      expect(
        !!s.dialogAlert && s.componentRows.length === 3,
        `invalid name refused: "${s.dialogAlert}"`,
      );
      await dialog().getByRole('button', { name: 'Cancel' }).click();
      await componentAction('Rename…', 'Consumer');
      s = await state();
      const consumerId = active(s).componentId;
      expect(
        s.componentRows.join() === 'Producer,Worker,Consumer',
        `rename: ${s.componentRows.join()} (id kept ${consumerId})`,
      );
      await btn('Move component up').click();
      s = await state();
      expect(
        s.componentRows.join() === 'Producer,Consumer,Worker',
        `up: ${s.componentRows.join()}`,
      );
      await btn('Move component up').click();
      await btn('Move component up').click();
      s = await state();
      expect(
        s.componentRows.join() === 'Consumer,Producer,Worker' &&
          active(s).componentId === consumerId,
        `up at top is a no-op: ${s.componentRows.join()}`,
      );
      const pastAtTop = active(s).past;
      // V3 permits an all-inactive source; it remains editable and undoable.
      await page.getByRole('checkbox', { name: 'Include Producer in network' }).click();
      await page.getByRole('checkbox', { name: 'Include Worker in network' }).click();
      s = await state();
      expect(
        s.componentRows.join() === 'Consumer,Producer (inactive),Worker (inactive)',
        `deactivated: ${s.componentRows.join()}`,
      );
      const lastBox = page.getByRole('checkbox', { name: 'Include Consumer in network' });
      await lastBox.click();
      s = await state();
      expect(
        !(await lastBox.isChecked()) && s.docs[0].components.every((c) => !c.active),
        'deactivating the last active component preserves an all-inactive source',
      );
      // Removing a component must preserve the remaining inactive components.
      await page.locator('.component-actions').getByRole('button', { name: 'Remove' }).click();
      s = await state();
      expect(
        s.componentRows.join() === 'Producer (inactive),Worker (inactive)',
        `removed Consumer without activating another component: ${s.componentRows.join()}`,
      );
      await componentRow('Worker');
      await page.locator('.component-actions').getByRole('button', { name: 'Remove' }).click();
      s = await state();
      expect(
        s.componentRows.join() === 'Producer (inactive)' && s.net.template === 'Producer',
        `removed inactive Worker; viewing ${s.net.template}`,
      );
      note(`history entries: ${active(s).past} (reorder no-op at top added none: ${pastAtTop})`);
      await btn('Undo').click();
      s = await state();
      expect(
        s.componentRows.includes('Worker (inactive)'),
        `undo restores Worker: ${s.componentRows.join()}`,
      );
      for (let i = 0; i < 20 && (await state()).canUndo; i++) await btn('Undo').click();
      s = await state();
      expect(
        s.componentRows.join() === 'Producer' && !active(s).dirty,
        `undo all back to saved: ${s.componentRows.join()}, dirty ${active(s).dirty}`,
      );
      await shot('T6-components');
    },
  ],
  [
    'T7',
    'Copied component keeps the same local IDs but edits stay isolated',
    async ({ expect }) => {
      await componentAction('Copy…', 'Copy');
      await clickNode('Idle');
      const name = page.locator('#element-name');
      await name.fill('CopyIdle');
      await name.press('Enter');
      const idle = await nodeBox('CopyIdle');
      await page.mouse.move(idle.x, idle.y);
      await page.mouse.down();
      await page.mouse.move(idle.x + 40, idle.y + 60, { steps: 5 });
      await page.mouse.up();
      let s = await state();
      const [orig, copy] = active(s).network.components;
      const oi = orig.net.nodes.find((n) => n.id === 'idle');
      const ci = copy.net.nodes.find((n) => n.id === 'idle');
      expect(orig.id !== copy.id, `component ids differ (${orig.id} vs ${copy.id})`);
      expect(
        ci.name === 'CopyIdle' && oi.name === 'Idle' && oi.x === 160 && oi.y === 240,
        `copy idle "${ci.name}" at ${ci.x},${ci.y}; original "${oi.name}" at ${oi.x},${oi.y}`,
      );
      await componentRow('Producer');
      s = await state();
      expect(
        s.net.nodes.find((n) => n.id === 'idle').name === 'Idle',
        'canvas of original shows Idle',
      );
      await clickNode('Idle');
      await page.keyboard.press('Delete');
      s = await state();
      const after = active(s).network.components;
      expect(
        !after[0].net.nodes.some((n) => n.id === 'idle') &&
          after[1].net.nodes.some((n) => n.id === 'idle') &&
          after[1].net.arcs.length === 6,
        'deleting idle in original leaves the copy intact',
      );
    },
  ],
  [
    'T8',
    'Per-component viewport and selection restore; naming high-water survives switches',
    async ({ expect }) => {
      await btn('Zoom in').click();
      await btn('Zoom in').click();
      const c = await toClient(400, 300);
      await page.mouse.move(c.x, c.y);
      await page.mouse.wheel(0, 120);
      await clickNode('Processing');
      let s = await state();
      const viewA = s.view;
      const selA = s.selected;
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('p');
      await clickModel(160, 520);
      await clickModel(260, 520);
      await page.keyboard.press('s');
      s = await state();
      const created = s.net.nodes.slice(6).map((n) => n.name);
      expect(created.join() === 'P0,P1', `created ${created.join()}`);
      await clickNode('P1');
      await page.keyboard.press('Delete');
      await clickNode('Processing');
      s = await state();
      const viewA2 = s.view;
      await componentAction('Add…', 'Other');
      s = await state();
      expect(
        s.view.zoom === 100 && s.view.x === 0 && s.view.y === 0 && s.selected.length === 0,
        `new component default view ${JSON.stringify(s.view)}, selection ${s.selected.length}`,
      );
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('p');
      await clickModel(200, 200);
      await page.keyboard.press('s');
      s = await state();
      expect(
        s.net.nodes[0]?.name === 'P0',
        `naming in Other starts at P0 (${s.net.nodes[0]?.name})`,
      );
      await componentRow('Producer');
      s = await state();
      expect(
        JSON.stringify(s.view) === JSON.stringify(viewA2) &&
          s.selected.length === 1 &&
          s.net.nodes.find((n) => n.id === s.selected[0])?.name === 'Processing',
        `restored view ${JSON.stringify(s.view)} (was ${JSON.stringify(viewA2)}, first ${JSON.stringify(viewA)}), selection ${s.selected}`,
      );
      void selA;
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('p');
      await clickModel(360, 520);
      await page.keyboard.press('s');
      s = await state();
      expect(
        s.net.nodes.at(-1).name === 'P2',
        `after switch, next name ${s.net.nodes.at(-1).name} (native high-water: P2, not reused P1)`,
      );
      // Across a document switch too.
      await newModel('Other doc');
      await clickTab('Producer cycle');
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('p');
      await clickModel(460, 520);
      await page.keyboard.press('s');
      s = await state();
      expect(
        s.net.nodes.at(-1).name === 'P3',
        `after tab switch, next name ${s.net.nodes.at(-1).name}`,
      );
      expect(s.view.zoom === viewA2.zoom, `tab switch restores zoom ${s.view.zoom}`);
    },
  ],
  [
    'T9',
    'Pending arc and inspector edits are safely handled before switching',
    async ({ expect, note }) => {
      await componentAction('Add…', 'Second');
      await componentRow('Producer');
      let s = await state();
      const past = active(s).past;
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('a');
      await clickNode('Idle');
      s = await state();
      expect(!!s.arcStart, `arc pending from ${s.arcStart}`);
      await componentRow('Second');
      s = await state();
      expect(!s.arcStart && s.tool === 'select', `component switch cancels arc (tool ${s.tool})`);
      await componentRow('Producer');
      s = await state();
      expect(
        s.net.arcs.length === 6 && active(s).past === past && !s.arcStart,
        `no stray arc, history ${active(s).past}`,
      );
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('a');
      await clickNode('Idle');
      await newModel('Tab B');
      s = await state();
      expect(!s.arcStart, 'New tab cancels pending arc');
      await clickTab('Producer cycle');
      s = await state();
      expect(!s.arcStart && s.net.arcs.length === 6, 'returning shows no pending arc');
      // Arc drafted with a bend point (click on blank canvas) then switch tabs.
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('a');
      await clickNode('Idle');
      await clickModel(240, 120);
      await clickTab('Tab B');
      await clickTab('Producer cycle');
      s = await state();
      expect(
        !s.arcStart && s.net.arcs.length === 6 && active(s).past === past,
        `draft with bend discarded (arcs ${s.net.arcs.length}, history ${active(s).past})`,
      );
      // Inspector edit committed by blur when the switch control is clicked.
      await clickNode('Completed');
      const field = page.locator('#element-name');
      await field.fill('Finished');
      await componentRow('Second');
      await componentRow('Producer');
      s = await state();
      note(
        `uncommitted inspector text then component click -> names ${s.net.nodes.map((n) => n.name).join()}`,
      );
      expect(
        s.net.nodes.some((n) => n.name === 'Finished') && active(s).past === past + 1,
        'typed name committed (blur/change) as one edit to the right component',
      );
      const second = active(s).network.components.find((c) => c.net.template === 'Second');
      expect(second.net.nodes.length === 0, 'Second component unaffected');
      note(
        'Drag-then-switch is not reachable with a real mouse: the switch click needs a button release, which ends the drag first.',
      );
    },
  ],
  [
    'T10',
    'Network simulation survives component switching and excludes inactive components',
    async ({ expect }) => {
      await componentAction('Add…', 'Second');
      await page.getByRole('button', { name: 'Simulate', exact: true }).click();
      let s = await state();
      expect(s.mode === 'Simulate' && !s.banner, 'multi-component simulation starts');
      await componentRow('Producer');
      await clickNode('Start');
      s = await state();
      const fired = s.marking;
      expect(s.cursor === 1, 'firing in Producer advances the network history');
      await componentRow('Second');
      s = await state();
      expect(
        s.mode === 'Simulate' && s.cursor === 1 && s.traceLength === 2,
        'view switch preserves the run and history',
      );
      await componentRow('Producer');
      s = await state();
      expect(
        JSON.stringify(s.marking) === JSON.stringify(fired),
        'return restores simulated marking',
      );
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Include Second in network' }).click();
      await componentRow('Second');
      await page.getByRole('button', { name: 'Simulate', exact: true }).click();
      s = await state();
      expect(
        s.mode === 'Simulate' && !s.banner,
        'inactive viewed component does not prevent network simulation',
      );
      expect(
        (await page.locator('[data-node].enabled').count()) === 0,
        'inactive component has no fireable canvas transitions',
      );
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await componentRow('Producer');
      s = await state();
      expect(
        s.net.nodes.find((n) => n.name === 'Idle').tokens === 1,
        'leaving simulation keeps initial model marking',
      );
    },
  ],
  [
    'T11',
    'Open adds a tab; invalid and unsupported files never replace state',
    async ({ expect, note }) => {
      await addPlaceAt(300, 480);
      const before = await state();
      await openFile(FIXTURE_PATH);
      let s = await state();
      expect(
        s.docs.length === 2 &&
          active(s).name === 'Two part model' &&
          !active(s).dirty &&
          s.docs[0].dirty,
        `Open added tab: ${s.tabs.join(' | ')}`,
      );
      expect(
        s.componentRows.join() === 'Main,Spare (inactive)',
        `components ${s.componentRows.join()}`,
      );
      for (const [path, label] of [[GARBAGE_PATH, 'malformed']]) {
        const prior = await state();
        await openFile(path);
        s = await state();
        note(`${label}: banner "${s.banner}", dialog ${s.dialog}`);
        expect(
          s.docs.length === prior.docs.length &&
            s.activeId === prior.activeId &&
            !!s.banner &&
            !s.dialog &&
            JSON.stringify(s.docs.map((d) => d.network)) ===
              JSON.stringify(prior.docs.map((d) => d.network)),
          `${label} file refused without changing tabs or content`,
        );
      }
      const beforeTimed = await state();
      await openFile(TIMED_PATH);
      s = await state();
      expect(
        s.docs.length === beforeTimed.docs.length + 1 &&
          active(s).network.type.timed &&
          active(s).network.components[0].timing.invariants.P0.upper === '5' &&
          !s.banner &&
          !s.dialog &&
          JSON.stringify(s.docs.slice(0, -1).map((d) => d.network)) ===
            JSON.stringify(beforeTimed.docs.map((d) => d.network)),
        'supported timed file opts into a new tab and preserves all existing documents',
      );
      await closeTab(active(s).name);
      await clickTab('Producer cycle');
      s = await state();
      expect(
        canonical(active(s).network) === canonical(before.docs[0].network) && active(s).dirty,
        'first tab still has its unsaved edit',
      );
      await openFile(FIXTURE_PATH);
      s = await state();
      expect(
        s.docs.length === 3 && new Set(s.docs.map((d) => d.id)).size === 3,
        `opening the same file again adds an independent tab (${s.docs.length})`,
      );
    },
  ],
  [
    'T12',
    'TAPN save writes all components, activation, bends and markings; reopens identically',
    async ({ expect, note }) => {
      await openFile(FIXTURE_PATH);
      await componentRow('Spare');
      await clickNode('Ready');
      const tokens = page.locator('#tokens');
      await tokens.fill('9');
      await tokens.press('Enter');
      let s = await state();
      const network = active(s).network;
      await page.locator('svg.net-canvas').focus();
      const file = await ctrlS('T12-two-part.tapn');
      s = await state();
      expect(!!file, `Ctrl+S downloads TAPN (banner "${s.banner}", dirty ${active(s).dirty})`);
      if (!file) return;
      writeFileSync(join(OUT, 'T12-expected-network.json'), JSON.stringify(network, null, 2));
      const nets = [...file.text.matchAll(/<net [^>]*>/g)].map((m) => m[0]);
      note(`net elements: ${nets.join(' ')}`);
      expect(
        nets.length === 2 &&
          /id="Main"/.test(nets[0]) &&
          /active="true"/.test(nets[0]) &&
          /id="Spare"/.test(nets[1]) &&
          /active="false"/.test(nets[1]),
        'both components in order with active flags',
      );
      expect(
        (file.text.match(/initialMarking="9"/g) ?? []).length === 1 &&
          (file.text.match(/initialMarking="2"/g) ?? []).length === 1,
        'markings 2 (Main) and edited 9 (Spare inactive) written',
      );
      expect(
        (file.text.match(/arcPointType="true"/g) ?? []).length === 4 &&
          (file.text.match(/xCoord="390" yCoord="60"/g) ?? []).length === 2,
        'bends (incl. curved point and curved end) written for both components',
      );
      expect(
        (file.text.match(/<feature /g) ?? []).length === 1 &&
          /isTimed="false"/.test(file.text) &&
          !/<query/.test(file.text),
        'single untimed feature; no queries in a query-free model',
      );
      expect(!active(await state()).dirty, 'saved tab clean');
      await openFile(file.path);
      s = await state();
      expect(
        s.docs.length === 3 && canonical(active(s).network) === canonical(network),
        `reopened TAPN equals saved network (${active(s).name}, ${s.componentRows.join()})`,
      );
      if (canonical(active(s).network) !== canonical(network))
        writeFileSync(join(OUT, 'T12-reopened.json'), JSON.stringify(active(s).network, null, 2));
      note('Not opened in desktop TAPAAL; native binary compatibility is not claimed.');
    },
  ],
  [
    'T13',
    'Save as web JSON downloads the whole network and reopens to the same network',
    async ({ expect }) => {
      await componentAction('Copy…', 'Mirror');
      await page.getByRole('checkbox', { name: 'Include Producer in network' }).click();
      await clickNode('Idle');
      await page.keyboard.press('Delete');
      let s = await state();
      const network = active(s).network;
      const file = await saveJson('T13-producer.json');
      const parsed = JSON.parse(file.text);
      expect(
        parsed.format === 'tapaal-web-network' && parsed.network.components.length === 2,
        `JSON format ${parsed.format}, ${parsed.network.components.length} components`,
      );
      expect(
        JSON.stringify(parsed.network.components) === JSON.stringify(network.components),
        'component IDs, activation and nets identical in file',
      );
      s = await state();
      expect(!active(s).dirty, 'JSON save marks clean');
      await openFile(file.path);
      s = await state();
      expect(
        s.docs.length === 2 &&
          JSON.stringify(active(s).network) === JSON.stringify(network) &&
          s.componentRows.join() === 'Producer (inactive),Mirror',
        `reopened JSON equals network: ${s.componentRows.join()}`,
      );
    },
  ],
  [
    'T14',
    'Ctrl+S from a focused field saves the typed (committed) value',
    async ({ expect }) => {
      await clickNode('Idle');
      const field = page.locator('#element-name');
      await field.click();
      await field.press('End');
      await page.keyboard.type('Now');
      const file = await ctrlS('T14-field.tapn');
      let s = await state();
      expect(
        s.net.nodes.some((n) => n.name === 'IdleNow') && s.focusedId !== 'element-name',
        `Ctrl+S committed the typed name to the model (focus #${s.focusedId})`,
      );
      expect(!!file, `Ctrl+S downloads TAPN (banner "${s.banner}", dirty ${active(s).dirty})`);
      if (!file) return;
      expect(/name="IdleNow"/.test(file.text), 'downloaded file contains IdleNow');
      expect(
        s.net.nodes.some((n) => n.name === 'IdleNow') && !active(s).dirty && !s.dirty,
        `model has IdleNow, clean (doc ${active(s).dirty}, footer ${s.dirty})`,
      );
      await page.locator('svg.net-canvas').click({ position: { x: 900, y: 560 } });
      const model = page.locator('#model-name');
      await model.click();
      await model.fill('Renamed model');
      const second = await ctrlS('T14-model-name.tapn');
      s = await state();
      expect(
        second.suggested === 'Renamed_model.tapn' && /name="Renamed model"/.test(second.text),
        `model-name field: download ${second.suggested}`,
      );
      expect(!active(s).dirty && s.tabs[0] === 'Renamed model (saved)', `tab label ${s.tabs[0]}`);
      await clickNode('Processing');
      await field.click();
      await field.fill('');
      let saved = null;
      page.once('download', (d) => (saved = d));
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(300);
      s = await state();
      expect(
        !saved && s.net.nodes.some((n) => n.name === 'Processing') && !active(s).dirty,
        `invalid empty name: no download (${!!saved}), banner "${s.banner}"`,
      );
    },
  ],
  [
    'T15',
    'Save and close of a background tab saves that tab only; the other keeps its newer edits',
    async ({ expect, note }) => {
      await addPlaceAt(300, 480);
      await newModel('Background');
      await addPlaceAt(200, 200);
      await clickTab('Producer cycle');
      await addPlaceAt(400, 480);
      let s = await state();
      const first = active(s);
      const bg = s.docs.find((d) => d.name === 'Background');
      await closeTab('Background');
      const file = await download(
        () => dialog().getByRole('button', { name: 'Save and close' }).click(),
        'T15-background.tapn',
      );
      s = await state();
      if (!file) {
        expect(
          false,
          `Save and close produced no download (dialog "${s.dialog}", alert "${s.dialogAlert}", banner "${s.banner}")`,
        );
        expect(
          s.docs.length === 2 &&
            s.docs.find((d) => d.id === bg.id)?.dirty &&
            canonical(s.docs.find((d) => d.id === first.id).network) === canonical(first.network),
          'no data loss: both tabs remain with their edits and Background stays dirty',
        );
        note(`active tab after failed save: ${active(s).name}`);
        return;
      }
      expect(
        file.suggested === 'Background.tapn' &&
          /name="P0"/.test(file.text) &&
          !/Idle/.test(file.text),
        `downloaded ${file.suggested} contains only Background content`,
      );
      expect(
        s.docs.length === 1 && !s.docs.some((d) => d.id === bg.id),
        `Background closed (${s.tabs.join(' | ')})`,
      );
      const kept = s.docs[0];
      expect(
        kept.id === first.id &&
          kept.dirty &&
          canonical(kept.network) === canonical(first.network) &&
          kept.past === first.past,
        `first stays dirty with both edits (past ${kept.past})`,
      );
      expect(s.activeId === first.id, 'focus returns to the remaining tab');
      note(
        'Save is synchronous (snapshot captured, checkpoint keyed by document ID); no async writer to race.',
      );
    },
  ],
  [
    'T16',
    'Leaving the page with any dirty tab asks; all clean does not',
    async ({ expect }) => {
      await newModel('Dirty bg');
      await clickTab('Producer cycle');
      let asked = false;
      page.once('dialog', async (d) => {
        asked = d.type() === 'beforeunload';
        await d.dismiss();
      });
      await page.reload({ timeout: 1500 }).catch(() => {});
      expect(asked, 'reload asks while a background tab is dirty');
      const s = await state();
      expect(s.docs.length === 2, 'dismiss keeps the page and both tabs');
      await closeTab('Dirty bg');
      await dialog().getByRole('button', { name: 'Discard changes and close' }).click();
      let askedAgain = false;
      page.once('dialog', async (d) => {
        askedAgain = true;
        await d.accept();
      });
      await page.reload();
      await page.waitForTimeout(300);
      expect(!askedAgain, 'reload with only clean tabs does not ask');
    },
  ],
];

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
  const only = process.env.ONLY?.split(',');
  for (const [id, title, fn] of CHECKS) if (!only || only.includes(id)) await check(id, title, fn);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status !== 'pass');
console.log(`\n${results.length - failed.length}/${results.length} passed; output ${OUT}`);
process.exit(failed.length ? 1 : 0);
