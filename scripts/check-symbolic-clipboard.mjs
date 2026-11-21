#!/usr/bin/env node
// Browser validation of the authored symbolic clipboard v3 (see design/SYMBOLIC-CLIPBOARD-VALIDATION.md).
// Drives a running development build with real Playwright keyboard, mouse, context-menu and
// file-chooser input. App signals and rendered DOM are only read; no App method or signal setter is
// invoked. System clipboard contents are set through the browser clipboard API (as another
// application would); denial, missing read() and slow clipboard I/O are injected into
// navigator.clipboard by init scripts.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-symbolic-clipboard.mjs http://127.0.0.1:4431 /tmp/tapaal-symclip/run
//
// ONLY=S01,S02 restricts checks. Exit status 1 when any check fails or errors.
// Results: <out>/results.json, generated fixtures, envelopes and screenshots.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4431';
const OUT = resolve(process.argv[3] ?? '/tmp/tapaal-symclip/run');
const ONLY = process.env.ONLY?.split(',');
mkdirSync(OUT, { recursive: true });

// ---- fixtures (web JSON v2: the only file format carrying initial ages and constant refs) -----
const TIMED = { timed: true, colored: false, game: false, stochastic: false };
const UNTIMED = { ...TIMED, timed: false };
const ref = (constantId) => ({ constantId });
const place = (id, name, x, y, tokens = 0, extra = {}) => ({
  id,
  name,
  kind: 'place',
  tokens,
  x,
  y,
  ...extra,
});
const transition = (id, name, x, y, extra = {}) => ({
  id,
  name,
  kind: 'transition',
  tokens: 0,
  x,
  y,
  ...extra,
});
const arc = (id, source, target, weight = 1, extra = {}) => ({
  id,
  source,
  target,
  kind: 'normal',
  weight,
  ...extra,
});
const iv = (lower, upper, lowerClosed = true, upperClosed = true) => ({
  lower,
  upper,
  lowerClosed,
  upperClosed,
});
const inv = (upper, upperClosed = true) => ({ upper, upperClosed });
const timing = (t = {}) => ({
  intervals: {},
  invariants: {},
  ages: {},
  urgent: [],
  transports: [],
  ...t,
});
const write = (file, text) => {
  const path = join(OUT, file);
  writeFileSync(path, text);
  return path;
};
const network = (name, type, constants, components) =>
  JSON.stringify({
    format: 'tapaal-web-network',
    version: 2,
    network: {
      name,
      type,
      constants,
      components: components.map((c) => ({ ...c, net: { ...c.net, name } })),
    },
  });

// Every symbolic scalar position: transport weights W (both halves), interval [Z, D] with Zero
// lower bound, open interval [L, inf), invariants <= X, <= Z (Zero) and < D, weights K. Spare is
// declared and only used by the inactive Side component. The n-island is numeric-only.
const SYM_CONSTANTS = [
  { id: 'cK', name: 'K', value: 2 },
  { id: 'cD', name: 'D', value: 5 },
  { id: 'cZ', name: 'Z', value: 0 },
  { id: 'cL', name: 'L', value: 1 },
  { id: 'cW', name: 'W', value: 3 },
  { id: 'cX', name: 'X', value: 4 },
  { id: 'cS', name: 'Spare', value: 9 },
];
const SYM_MAIN = {
  id: 'main',
  active: true,
  net: {
    name: 'Main',
    template: 'Main',
    nodes: [
      place('p', 'P', 150, 150, 2),
      transition('t', 'T', 350, 150, { angle: 45 }),
      place('q', 'Q', 550, 150),
      place('z', 'Zp', 150, 330, 1, { nameVisible: false, nameOffsetX: 12, nameOffsetY: -7 }),
      transition('u', 'U', 350, 330),
      place('s', 'S', 550, 330),
      place('n1', 'N1', 150, 520, 1),
      transition('nt', 'NT', 350, 520),
      place('n2', 'N2', 550, 520),
    ],
    arcs: [
      arc('i', 'p', 't', ref('cW'), { bends: [{ x: 250, y: 110, curved: false }] }),
      arc('o', 't', 'q', ref('cW'), {
        bends: [{ x: 450, y: 200, curved: true }],
        curvedEnd: true,
      }),
      arc('zu', 'z', 'u', ref('cK')),
      arc('us', 'u', 's', ref('cK')),
      arc('n1nt', 'n1', 'nt', 2),
      arc('ntn2', 'nt', 'n2'),
    ],
    annotations: [{ id: 'note', text: 'Note', x: 700, y: 300, width: 120, height: 40 }],
  },
  timing: timing({
    intervals: { i: iv(ref('cZ'), ref('cD')), zu: iv(ref('cL'), null, true, false) },
    invariants: {
      p: inv(ref('cX')),
      z: inv(ref('cZ')),
      q: inv(ref('cD'), false),
      n2: inv('4'),
    },
    ages: { p: ['0.1', '2.50'], n1: ['1.5'] },
    urgent: ['nt'],
    transports: [{ inputArc: 'i', outputArc: 'o' }],
  }),
};
const SYM_SIDE = {
  id: 'side',
  active: false,
  net: {
    name: 'Side',
    template: 'Side',
    nodes: [place('sp', 'SP', 150, 150, 1), transition('st', 'ST', 350, 150)],
    arcs: [arc('spst', 'sp', 'st', ref('cS'))],
  },
  timing: timing(),
};
const SYM = write('symbolic.json', network('Symbolic', TIMED, SYM_CONSTANTS, [SYM_MAIN, SYM_SIDE]));
// Same names; D differs (7) and an extra non-colliding declaration exists.
const UNEQUAL = write(
  'unequal.json',
  network(
    'Unequal',
    TIMED,
    [
      { id: 'tO', name: 'Other', value: 1 },
      { id: 'tD', name: 'D', value: 7 },
    ],
    [
      {
        id: 'main',
        active: true,
        net: { name: 'Main', template: 'Main', nodes: [place('x', 'X1', 700, 600)], arcs: [] },
        timing: timing({ invariants: { x: inv(ref('tO')) } }),
      },
    ],
  ),
);
const UNT = write(
  'untimed.json',
  network(
    'Untimed',
    UNTIMED,
    [
      { id: 'uW', name: 'UW', value: 2 },
      { id: 'uH', name: 'UH', value: 1 },
    ],
    [
      {
        id: 'plain',
        active: true,
        net: {
          name: 'Plain',
          template: 'Plain',
          nodes: [
            place('a', 'A', 150, 150, 2),
            transition('t', 'T', 350, 150),
            place('b', 'B', 550, 150),
            place('c', 'C', 350, 330),
            place('m1', 'M1', 150, 520, 1),
            transition('mt', 'MT', 350, 520),
          ],
          arcs: [
            arc('at', 'a', 't', ref('uW')),
            arc('tb', 't', 'b', ref('uW')),
            arc('ct', 'c', 't', ref('uH'), { kind: 'inhibitor' }),
            arc('m', 'm1', 'mt', 3),
          ],
        },
      },
    ],
  ),
);
// Prototype-looking constant ID/name and node IDs as own data.
const PROTO = write(
  'proto.json',
  network(
    'Proto',
    TIMED,
    [{ id: '__proto__', name: 'constructor', value: 4 }],
    [
      {
        id: 'main',
        active: true,
        net: {
          name: 'Main',
          template: 'Main',
          nodes: [place('__proto__', 'hasOwnProperty', 150, 150, 1)],
          arcs: [],
        },
        timing: timing({ invariants: { ['__proto__']: inv(ref('__proto__')) } }),
      },
    ],
  ),
);
// Saved query protects place Moved (cut must refuse) and, on import, every declaration (Q).
const QRY = write(
  'query.tapn',
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <constant name="Q" value="3"/>
  <net active="true" id="Clock" type="P/T net">
    <place displayName="true" id="P0" initialMarking="1" invariant="&lt;= Q" name="Start" nameOffsetX="0" nameOffsetY="0" positionX="90" positionY="60"/>
    <place displayName="true" id="P1" initialMarking="0" invariant="&lt; inf" name="Moved" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="60"/>
    <transition angle="0" displayName="true" id="T0" infiniteServer="false" name="Go" nameOffsetX="0" nameOffsetY="0" player="0" positionX="195" positionY="60" priority="0" urgent="false"/>
    <arc id="A0" inscription="[0,Q]" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" type="timed" weight="1"/>
    <arc id="A1" inscription="1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" type="normal" weight="1"/>
  </net>
  <query active="true" name="Moved" type="Default" query="EF Clock.Moved &gt;= 1"/>
  <k-bound bound="3"/>
  <feature isGame="false" isTimed="true" isColored="false" isStochastic="false"/>
</pnml>
`,
);

// ---- canonical fragment ------------------------------------------------------------------------
// Constant refs are spelled @name via the given network, so fragments from different documents
// compare by declaration name/value rather than by (necessarily different) IDs.
function named(net, value) {
  if (Array.isArray(value)) return value.map((v) => named(net, v));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'constantId') {
      const c = net.constants.find((d) => d.id === value.constantId);
      return c ? `@${c.name}=${c.value}` : `@UNBOUND(${value.constantId})`;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, named(net, v)]));
  }
  return value;
}
function fragment(network, componentId, ids, shift = 0) {
  const comp = network.components.find((c) => c.id === componentId);
  const net = named(network, comp.net);
  const t = comp.timing && named(network, comp.timing);
  const keep = new Set(ids);
  const nodes = net.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, x: n.x - shift, y: n.y - shift }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const key = new Map(nodes.map((n) => [n.id, `${n.kind}@${n.x},${n.y}`]));
  const arcs = net.arcs
    .filter((a) => keep.has(a.id))
    .map((a) => ({
      id: a.id,
      key: `${key.get(a.source)}->${key.get(a.target)}:${a.kind}`,
      weight: a.weight,
      bends: (a.bends ?? []).map((b) => [b.x - shift, b.y - shift, b.curved]),
      curvedEnd: !!a.curvedEnd,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const arcKey = new Map(arcs.map((a) => [a.id, a.key]));
  const any = (id) => key.get(id) ?? arcKey.get(id);
  const map = (record = {}) =>
    Object.fromEntries(
      Object.entries(record)
        .filter(([id]) => keep.has(id))
        .map(([id, v]) => [any(id), v])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return JSON.stringify({
    nodes: nodes.map(({ id: _id, name: _name, ...n }) =>
      Object.fromEntries(Object.entries(n).sort(([a], [b]) => a.localeCompare(b))),
    ),
    arcs: arcs.map(({ id: _id, ...a }) => a),
    notes: (net.annotations ?? [])
      .filter((n) => keep.has(n.id))
      .map(({ id: _id, ...n }) => ({ ...n, x: n.x - shift, y: n.y - shift })),
    timing: t && {
      intervals: map(t.intervals),
      invariants: map(t.invariants),
      ages: map(t.ages),
      urgent: t.urgent
        .filter((id) => keep.has(id))
        .map(any)
        .sort(),
      transports: t.transports
        .filter((p) => keep.has(p.inputArc) || keep.has(p.outputArc))
        .map((p) => `${any(p.inputArc)}=>${any(p.outputArc)}`)
        .sort(),
    },
  });
}
const idsOf = (net) => [...net.nodes, ...net.arcs, ...(net.annotations ?? [])].map((e) => e.id);
const SYM_FIXTURE = { constants: SYM_CONSTANTS, components: [SYM_MAIN, SYM_SIDE] };
const ISLAND_A = ['p', 't', 'q', 'i', 'o'];
const ISLAND_A_NODES = ['p', 't', 'q'];
const ALL_MAIN = idsOf(SYM_MAIN.net);
const EXPECT_ALL = fragment(SYM_FIXTURE, 'main', ALL_MAIN);
const EXPECT_A = fragment(SYM_FIXTURE, 'main', ISLAND_A);
// Fragment of elements new since `before`, shifted back by the native +30,+30 paste offset.
const pasted = (before, after, componentId) => {
  const old = new Set(idsOf(before.network.components.find((c) => c.id === componentId).net));
  const now = after.network.components.find((c) => c.id === componentId).net;
  return fragment(
    after.network,
    componentId,
    idsOf(now).filter((id) => !old.has(id)),
    30,
  );
};
const newIds = (before, after, componentId) => {
  const old = new Set(idsOf(before.network.components.find((c) => c.id === componentId).net));
  return idsOf(after.network.components.find((c) => c.id === componentId).net).filter(
    (id) => !old.has(id),
  );
};
const refsIn = (value, out = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.constantId === 'string') out.add(value.constantId);
    Object.values(value).forEach((v) => refsIn(v, out));
  }
  return out;
};

// ---- browser ----------------------------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
let context, page;
const results = [];
const pageErrors = [];
async function fresh({ permissions = true, init, delay } = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: permissions ? ['clipboard-read', 'clipboard-write'] : [],
  });
  if (init) await context.addInitScript(init, delay);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
}
const settle = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// Read-only App/DOM state.
const state = async () => {
  await settle();
  return page.evaluate(() => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const ws = app.workspace();
    const doc = ws.documents.find((d) => d.id === ws.activeDocumentId);
    const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      docId: doc?.id,
      docs: ws.documents.map((d) => ({
        id: d.id,
        source: JSON.stringify(d.network),
        saved: JSON.stringify(d.saved),
        past: d.past.length,
        future: d.future.length,
      })),
      network: plain(doc?.network),
      source: JSON.stringify(doc?.network),
      saved: JSON.stringify(doc?.saved),
      pastSources: doc?.past.map((p) => JSON.stringify(p)),
      futureSources: doc?.future.map((p) => JSON.stringify(p)),
      componentId: doc?.session.componentId,
      past: doc?.past.length,
      future: doc?.future.length,
      selected: [...app.selectedIds()],
      mode: app.mode(),
      error: app.error(),
      notice: app.notice(),
      pane: document.querySelector('app-constants-pane')?.innerText ?? null,
      polluted:
        Object.prototype.hasOwnProperty('polluted') ||
        {}.polluted !== undefined ||
        typeof {}.constantId !== 'undefined' ||
        Object.getPrototypeOf({}) !== Object.prototype,
    };
  });
};
const frozen = (s) => JSON.stringify([s.source, s.saved, s.pastSources, s.futureSources]);
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const setClip = (text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const key = async (k) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(80);
};
async function focusCanvas() {
  await page.locator('svg.net-canvas').focus();
}
async function nodePoint(id) {
  await settle();
  return page.evaluate((id) => {
    const r = document
      .querySelector(`[data-node="${CSS.escape(id)}"] .node-shape`)
      .getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
}
async function clickNode(id, options) {
  const p = await nodePoint(id);
  await page.mouse.click(p.x, p.y, options);
}
async function shiftClick(point) {
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
}
// Pause so consecutive clicks are never read as a double-click (which opens a dialog).
async function clearSelection() {
  await page.mouse.click(1150, 760);
  await page.waitForTimeout(450);
}
async function select(ids) {
  await clearSelection();
  for (const [n, id] of ids.entries()) {
    n ? await shiftClick(await nodePoint(id)) : await clickNode(id);
    await page.waitForTimeout(450);
  }
  await focusCanvas();
}
async function openFile(path) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page
      .locator('[aria-label="Document toolbar"]')
      .getByRole('button', { name: 'Open model' })
      .click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForTimeout(200);
  const accept = page.getByRole('button', { name: 'Open in new tab', exact: true });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await settle();
  await focusCanvas();
}
async function newModel(name, timed) {
  await page.getByRole('button', { name: 'New model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.waitFor();
  await d.getByLabel('Model name', { exact: true }).fill(name);
  await d
    .locator('#new-model-type')
    .selectOption({ label: timed ? 'Timed P/T net' : 'Untimed P/T net' });
  await d.getByLabel('Component name', { exact: true }).fill('Main');
  await d.getByRole('button', { name: 'Create' }).click();
  await focusCanvas();
}
async function menu(label) {
  await page.locator('summary', { hasText: /^Edit$/ }).click();
  const item = page
    .locator('[aria-label="Edit actions"] button', { hasText: new RegExp(`^\\s*${label}`) })
    .first();
  const disabled = await item.isDisabled();
  if (disabled) await page.locator('summary', { hasText: /^Edit$/ }).click();
  else await item.click();
  await page.waitForTimeout(150);
  return !disabled;
}
async function contextItem(nodeId, label) {
  if (nodeId) await clickNode(nodeId, { button: 'right' });
  else await page.mouse.click(1100, 700, { button: 'right' });
  await page.getByRole('menu', { name: 'Canvas actions' }).waitFor();
  const item = page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first();
  const disabled = !(await item.count()) || (await item.isDisabled());
  if (disabled) await key('Escape');
  else await item.click();
  await page.waitForTimeout(150);
  return !disabled;
}
async function tab(name) {
  await page.locator('.document-tab button:first-child', { hasText: name }).first().click();
  await focusCanvas();
}
async function mode(name) {
  await page.locator('[aria-label="Workspace mode"]').getByRole('button', { name }).click();
}
const pane = () => page.locator('app-constants-pane');
async function editDeclaration(name, newName, value) {
  const d = pane()
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name} = `) }) });
  if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click();
  await d.getByRole('button', { name: 'Edit…' }).click();
  await page.locator('app-constant-dialog form').waitFor();
  if (newName !== undefined) await page.locator('#constant-name').fill(newName);
  if (value !== undefined) await page.locator('#constant-value').fill(value);
  await page.locator('app-constant-dialog button[type=submit]').click();
  await settle();
}
async function deleteDeclaration(name) {
  const d = pane()
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name} = `) }) });
  if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click();
  await d.getByRole('button', { name: 'Delete' }).click();
  await settle();
}
async function dismissError() {
  const b = page.getByRole('button', { name: 'Dismiss error', exact: true });
  if (await b.isVisible().catch(() => false)) await b.click();
}
async function check(id, title, fn, options) {
  if (ONLY && !ONLY.includes(id)) return;
  const r = { id, title, status: 'pass', observations: [] };
  const expect = (ok, message, detail) => {
    r.observations.push({ ok: !!ok, message, ...(detail === undefined ? {} : { detail }) });
    if (!ok) r.status = 'fail';
  };
  pageErrors.length = 0;
  try {
    await fresh(options);
    await fn(expect);
    const s = await state();
    expect(!s.polluted, 'No prototype pollution');
    expect(!pageErrors.length, 'No uncaught page errors', pageErrors);
  } catch (e) {
    r.status = 'error';
    r.error = e.stack;
    await page?.screenshot({ path: join(OUT, `${id}-error.png`) }).catch(() => {});
  }
  results.push(r);
  console.log(
    `${r.status === 'pass' ? 'PASS' : r.status.toUpperCase()} ${id} ${title}` +
      r.observations
        .map(
          (o) =>
            `\n   ${o.ok ? 'ok  ' : 'FAIL'} ${o.message}${o.ok || o.detail === undefined ? '' : ' ' + JSON.stringify(o.detail).slice(0, 1500)}`,
        )
        .join('') +
      (r.error ? `\n   ${r.error.split('\n').slice(0, 5).join('\n   ')}` : ''),
  );
}
// Slow navigator.clipboard (configurable delay); keyboard events still use event.clipboardData.
function slowClipboard(ms) {
  const c = navigator.clipboard;
  const slow =
    (fn) =>
    (...args) =>
      new Promise((r) => setTimeout(r, ms)).then(() => fn.apply(c, args));
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      read: slow(c.read),
      readText: slow(c.readText),
      write: slow(c.write),
      writeText: slow(c.writeText),
    },
  });
}
function deniedClipboard() {
  const deny = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  Object.defineProperty(navigator, 'clipboard', {
    value: { read: deny, readText: deny, write: deny, writeText: deny },
  });
}
function textOnlyClipboard() {
  const c = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText: c.readText.bind(c), writeText: c.writeText.bind(c) },
  });
}
const V3_TOP = ['constants', 'format', 'fragment', 'modelType', 'sourceDocumentId', 'version'];

// ---- checks -----------------------------------------------------------------------------------
try {
  await check(
    'S01',
    'Keyboard copy: exact v3 closure; same-document paste/undo/redo',
    async (expect) => {
      await openFile(SYM);
      let s = await state();
      expect(!s.error && s.network?.constants.length === 7, 'Symbolic fixture opened', s.error);
      await setClip('SENTINEL');
      const base = await state();
      await key('Control+a');
      await key('Control+c');
      const text = await clip();
      writeFileSync(join(OUT, 'S01-envelope.json'), text);
      const env = parse(text);
      expect(
        env?.format === 'tapaal-web-clipboard' && env.version === 3 && env.modelType === 'timed',
        'Ctrl+C writes a timed v3 envelope to text/plain',
        text.slice(0, 200),
      );
      expect(
        JSON.stringify(Object.keys(env ?? {}).sort()) === JSON.stringify(V3_TOP) &&
          JSON.stringify(Object.keys(env?.fragment ?? {}).sort()) ===
            JSON.stringify(['annotations', 'arcs', 'nodes', 'timing']),
        'Closed envelope keys; no native/numeric/simulation snapshot',
        [Object.keys(env ?? {}), Object.keys(env?.fragment ?? {})],
      );
      expect(env?.sourceDocumentId === base.docId, 'sourceDocumentId is the document ID');
      const deps = (env?.constants ?? []).map((c) => c.id).sort();
      expect(
        JSON.stringify(deps) === JSON.stringify(['cD', 'cK', 'cL', 'cW', 'cX', 'cZ']) &&
          env.constants.every(
            (c) => JSON.stringify(c) === JSON.stringify(SYM_CONSTANTS.find((d) => d.id === c.id)),
          ),
        'Exactly the six referenced declarations (Zero included, Spare excluded), unchanged',
        env?.constants,
      );
      expect(
        JSON.stringify([...refsIn(env?.fragment)].sort()) === JSON.stringify(deps),
        'Every declaration is referenced by the fragment',
      );
      expect(
        JSON.stringify(env?.fragment?.timing?.ages) ===
          JSON.stringify({ p: ['0.1', '2.50'], n1: ['1.5'] }),
        'Initial age spelling preserved; no simulated ages',
        env?.fragment?.timing?.ages,
      );
      const copied = await state();
      expect(
        frozen(copied) === frozen(base),
        'Copy leaves source, checkpoint and history untouched',
      );
      expect(
        /Copied selection\. Web envelope preserves constant references.*desktop TAPAAL clipboard transfer is unavailable/.test(
          copied.notice,
        ),
        'Copy notice states web-only symbolic transfer',
        copied.notice,
      );
      await key('Control+v');
      const after = await state();
      expect(
        !after.error && after.past === base.past + 1 && after.future === 0,
        'Same-document paste is one history entry',
        after.error,
      );
      expect(
        JSON.stringify(after.network.constants) === JSON.stringify(base.network.constants),
        'Same-document paste adds no declarations',
      );
      expect(
        pasted(base, after, 'main') === EXPECT_ALL,
        'Pasted fragment equals the selection at +30,+30 with refs bound to current IDs',
        { pasted: pasted(base, after, 'main'), expected: EXPECT_ALL },
      );
      const fresh = newIds(base, after, 'main');
      expect(
        fresh.length === ALL_MAIN.length &&
          JSON.stringify([...after.selected].sort()) === JSON.stringify([...fresh].sort()),
        'Fresh element IDs, pasted elements selected',
        { fresh, selected: after.selected },
      );
      await key('Control+z');
      s = await state();
      expect(
        s.source === base.source && s.past === base.past && s.future === 1,
        'One undo removes the whole paste',
      );
      await key('Control+y');
      s = await state();
      expect(s.source === after.source && s.past === after.past, 'Redo restores identical source');
    },
  );

  await check(
    'S02',
    'Every copy/cut/paste/duplicate entry point matches the keyboard result',
    async (expect) => {
      await openFile(SYM);
      const base = await state();
      const runs = {
        'Edit menu Copy + Paste': async () => {
          await key('Control+a');
          await menu('Copy');
          await menu('Paste');
        },
        'Context Copy + canvas Paste': async () => {
          await key('Control+a');
          if (!(await contextItem('p', 'Copy'))) throw new Error('Context Copy unavailable');
          if (!(await contextItem(null, 'Paste'))) throw new Error('Context Paste unavailable');
        },
        'Ctrl+D': async () => {
          await key('Control+a');
          await key('Control+d');
        },
        'Edit menu Duplicate': async () => {
          await key('Control+a');
          await menu('Duplicate');
        },
        'Context Duplicate selection': async () => {
          await key('Control+a');
          if (!(await contextItem('p', 'Duplicate')))
            throw new Error('Context Duplicate unavailable');
        },
      };
      for (const [name, run] of Object.entries(runs)) {
        await setClip('SENTINEL');
        await focusCanvas();
        await run();
        await page.waitForTimeout(150);
        const s = await state();
        expect(
          !s.error && s.past === base.past + 1 && pasted(base, s, 'main') === EXPECT_ALL,
          `${name}: one entry, same symbolic fragment`,
          { error: s.error, past: s.past, got: pasted(base, s, 'main') },
        );
        expect(
          JSON.stringify(s.network.constants) === JSON.stringify(base.network.constants),
          `${name}: no declarations added`,
        );
        if (/Duplicate|Ctrl\+D/.test(name))
          expect((await clip()) === 'SENTINEL', `${name}: system clipboard untouched`);
        await key('Control+z');
        const u = await state();
        expect(u.source === base.source, `${name}: undo restores source`);
        await clearSelection();
      }
      // Cut: Ctrl+X and Edit menu Cut keep all declarations; paste rebinds them.
      for (const [name, cut] of [
        ['Ctrl+X', () => key('Control+x')],
        ['Edit menu Cut', () => menu('Cut')],
        ['Context Cut', () => contextItem('p', 'Cut')],
      ]) {
        await focusCanvas();
        await key('Control+a');
        await cut();
        await page.waitForTimeout(150);
        let s = await state();
        const main = s.network.components.find((c) => c.id === 'main');
        expect(
          !s.error &&
            main.net.nodes.length === 0 &&
            JSON.stringify(s.network.constants) === JSON.stringify(base.network.constants) &&
            s.past === base.past + 1,
          `${name}: elements removed, every declaration (now unused) retained, one entry`,
          { error: s.error, nodes: main.net.nodes.length, constants: s.network.constants.length },
        );
        expect(/^Cut selection\./.test(s.notice), `${name}: cut notice`, s.notice);
        await key('Control+v');
        await page.waitForTimeout(150);
        s = await state();
        const cutState = {
          network: { components: [{ id: 'main', net: { nodes: [], arcs: [] } }] },
        };
        expect(
          !s.error && pasted(cutState, s, 'main') === EXPECT_ALL,
          `${name}: paste after cut restores the symbolic fragment at +30`,
          s.error,
        );
        await key('Control+z');
        await key('Control+z');
        s = await state();
        expect(s.source === base.source, `${name}: two undos restore source`);
      }
    },
  );

  await check(
    'S03',
    'Dependency closure per selection; numeric-only stays v2; partial transport refused',
    async (expect) => {
      await openFile(SYM);
      const base = await state();
      const cases = [
        [['z'], ['cZ'], 'Zero invariant place'],
        [['z', 'u'], ['cK', 'cL', 'cZ'], 'weight K plus [L,inf) interval plus Zero invariant'],
        [['u', 's'], ['cK'], 'output weight only'],
      ];
      for (const [ids, want, label] of cases) {
        await setClip('SENTINEL');
        await select(ids);
        await key('Control+c');
        const env = parse(await clip());
        const got = (env?.constants ?? []).map((c) => c.id).sort();
        expect(
          env?.version === 3 && JSON.stringify(got) === JSON.stringify(want),
          `${label}: v3 with exactly ${want.join(',')}`,
          { got, version: env?.version, selected: (await state()).selected },
        );
      }
      // A lone transport endpoint touches a transport half: refused, as for timed v2.
      for (const id of ['p', 't', 'q']) {
        await setClip('SENTINEL');
        await select([id]);
        await key('Control+c');
        const s = await state();
        expect(
          /both transport halves/.test(s.error) && (await clip()) === 'SENTINEL',
          `Lone transport endpoint ${id}: copy refused, nothing written`,
          s.error,
        );
        await dismissError();
      }
      // U's symbolic arcs have outside endpoints and are dropped: no references remain.
      await select(['u']);
      await setClip('SENTINEL');
      await key('Control+c');
      let text = await clip();
      let env = parse(text);
      expect(
        env?.version === 2 && !Object.hasOwn(env ?? {}, 'constants') && !/constantId/.test(text),
        'Transition alone (symbolic arcs not copied): legacy timed v2, no declaration export',
        text.slice(0, 160),
      );
      await select(['n1', 'nt', 'n2']);
      await setClip('SENTINEL');
      await key('Control+c');
      text = await clip();
      env = parse(text);
      expect(
        env?.version === 2 &&
          !/constantId|"constants"/.test(text) &&
          env.timing?.urgent?.length === 1,
        'Numeric island: timed v2 with urgency, no constants',
        text.slice(0, 160),
      );
      await key('Control+v');
      let s = await state();
      expect(!s.error && s.past === base.past + 1, 'Numeric v2 paste still works', s.error);
      await key('Control+z');
      // Partial transport: p + t selects i but not o/q.
      await select(['p', 't']);
      await setClip('SENTINEL');
      const pre = await state();
      for (const [name, run] of [
        ['Ctrl+C', () => key('Control+c')],
        ['Ctrl+X', () => key('Control+x')],
        ['Ctrl+D', () => key('Control+d')],
      ]) {
        await run();
        s = await state();
        expect(
          /both transport halves/.test(s.error) &&
            frozen(s) === frozen(pre) &&
            (await clip()) === 'SENTINEL',
          `${name} of partial transport refused before any write or mutation`,
          s.error,
        );
        await dismissError();
      }
      // Untimed document: closure and v1-compatibility.
      await openFile(UNT);
      await key('Control+a');
      await setClip('SENTINEL');
      await key('Control+c');
      env = parse(await clip());
      expect(
        env?.version === 3 &&
          env.modelType === 'untimed' &&
          !Object.hasOwn(env.fragment, 'timing') &&
          JSON.stringify(env.constants.map((c) => c.name).sort()) === JSON.stringify(['UH', 'UW']),
        'Untimed v3 has no timing and exactly UW,UH (inhibitor weight included)',
        env,
      );
      await select(['m1', 'mt']);
      await setClip('SENTINEL');
      await key('Control+c');
      text = await clip();
      expect(
        !/tapaal-web-clipboard/.test(text) && text !== 'SENTINEL' && !/constantId/.test(text),
        'Untimed numeric-only selection still writes the legacy native text',
        text.slice(0, 120),
      );
    },
  );

  await check(
    'S04',
    'Same document binds current IDs after rename/value change; deleted binding refuses',
    async (expect) => {
      await openFile(SYM);
      const base = await state();
      await select(ISLAND_A_NODES);
      await key('Control+c');
      const env = parse(await clip());
      expect(env?.constants?.length === 4, 'Island copied with W, Z, D, X', env?.constants);
      await editDeclaration('D', 'Dur');
      await editDeclaration('X', undefined, '3');
      let s = await state();
      const edited = s;
      expect(
        !s.error &&
          s.network.constants.find((c) => c.id === 'cD')?.name === 'Dur' &&
          s.network.constants.find((c) => c.id === 'cX')?.value === 3,
        'Rename D→Dur and X 4→3 through the constants pane',
        s.error,
      );
      await focusCanvas();
      await key('Control+v');
      s = await state();
      const pastedArcs = s.network.components[0].net.arcs.filter(
        (a) => !base.network.components[0].net.arcs.some((b) => b.id === a.id),
      );
      expect(
        !s.error &&
          JSON.stringify(s.network.constants) === JSON.stringify(edited.network.constants) &&
          pastedArcs.length === 2 &&
          pastedArcs.every((a) => a.weight.constantId === 'cW'),
        'Paste binds current IDs; no declaration added or restored to copied name/value',
        s.error,
      );
      const newT = newIds(edited, s, 'main');
      const t = s.network.components[0].timing;
      const pi = newT.find((id) => t.invariants[id]?.upper?.constantId === 'cX');
      expect(
        pi && newT.some((id) => t.intervals[id]?.upper?.constantId === 'cD'),
        'Pasted invariant/interval refer to current cX/cD (named X=3, Dur=5)',
      );
      expect(/Dur/.test(s.pane ?? ''), 'Constants pane lists the renamed declaration');
      await key('Control+z');
      // Cut the only users of X (place p), delete X, paste must refuse.
      await select(['p']);
      await key('Control+c');
      await select(['p', 't', 'q']);
      await key('Control+x');
      s = await state();
      expect(!s.error && s.network.constants.some((c) => c.id === 'cX'), 'Cut keeps X', s.error);
      await deleteDeclaration('X');
      s = await state();
      expect(
        !s.error && !s.network.constants.some((c) => c.id === 'cX'),
        'Unused X deleted through the pane',
        s.error,
      );
      // Clipboard now holds the cut island (W,Z,D,X); keyboard paste must refuse atomically.
      await focusCanvas();
      const pre = await state();
      await key('Control+v');
      s = await state();
      expect(
        /Constant X no longer exists in the source document/.test(s.error) &&
          frozen(s) === frozen(pre) &&
          !s.network.constants.some((c) => c.name === 'X'),
        'Missing binding refuses; never resurrected; source/history/checkpoint untouched',
        s.error,
      );
      expect(
        JSON.stringify(s.selected) === JSON.stringify(pre.selected),
        'Refused paste keeps selection',
      );
      await dismissError();
      await key('Control+z'); // restores X with the same ID
      await focusCanvas();
      await key('Control+v');
      s = await state();
      expect(
        !s.error && s.network.constants.filter((c) => c.id === 'cX').length === 1,
        'After undoing the deletion the same ID binds again',
        s.error,
      );
    },
  );

  await check(
    'S05',
    'Cross-document: fresh IDs, remap, undo/redo; repeated paste collides; target recopy works',
    async (expect) => {
      await openFile(SYM);
      const src = await state();
      await select(ISLAND_A_NODES);
      await key('Control+c');
      await newModel('Fresh', true);
      const base = await state();
      await key('Control+v');
      let s = await state();
      const after = s;
      const added = s.network.constants;
      expect(
        !s.error && s.past === base.past + 1 && added.length === 4,
        'Paste adds four declarations and the island in one entry',
        s.error,
      );
      expect(
        added.every((c) => !['cW', 'cZ', 'cD', 'cX'].includes(c.id)) &&
          JSON.stringify(added.map((c) => `${c.name}=${c.value}`).sort()) ===
            JSON.stringify(['D=5', 'W=3', 'X=4', 'Z=0']),
        'Fresh declaration IDs, copied names/values',
        added,
      );
      const comp = s.network.components[0].id;
      expect(
        pasted(base, s, comp) === EXPECT_A,
        'Every term remapped to the fresh declarations (fidelity by name/value)',
        { got: pasted(base, s, comp), want: EXPECT_A },
      );
      expect(
        [...refsIn(s.network.components[0])].every((id) => added.some((c) => c.id === id)),
        'No reference to source IDs remains',
      );
      await key('Control+z');
      s = await state();
      expect(
        s.source === base.source && s.network.constants.length === 0,
        'Undo removes declarations and elements together',
      );
      await key('Control+y');
      s = await state();
      expect(s.source === after.source, 'Redo restores the same fresh bindings');
      // Repeated external paste: names now taken.
      let pre = await state();
      await key('Control+v');
      s = await state();
      expect(
        /already declares constant/.test(s.error) && frozen(s) === frozen(pre),
        'Repeated external paste refuses atomically',
        s.error,
      );
      await dismissError();
      // Target recopy then repeated local paste.
      await key('Control+a');
      await key('Control+c');
      const env = parse(await clip());
      expect(env?.sourceDocumentId === s.docId, 'Recopy is sourced from the target document');
      pre = await state();
      await key('Control+v');
      await key('Control+v');
      s = await state();
      expect(
        !s.error && s.past === pre.past + 2 && s.network.constants.length === 4,
        'Repeated local paste succeeds without new declarations',
        s.error,
      );
      await tab('Symbolic');
      s = await state();
      expect(s.source === src.source && s.past === 0, 'Source document untouched');
    },
  );

  await check(
    'S06',
    'Same-name collisions (equal and unequal) refuse atomically',
    async (expect) => {
      await openFile(SYM);
      await key('Control+a');
      await key('Control+c');
      await openFile(SYM); // second tab, same names and values, different document ID
      let pre = await state();
      await key('Control+v');
      let s = await state();
      expect(
        /already declares constant \w+\. Same-name constants cannot be merged, even when their values match/.test(
          s.error,
        ) &&
          frozen(s) === frozen(pre) &&
          JSON.stringify(s.selected) === JSON.stringify(pre.selected),
        'Equal-value same-name collision refuses; no history, checkpoint or selection change',
        s.error,
      );
      await dismissError();
      await openFile(UNEQUAL);
      pre = await state();
      await menu('Paste');
      s = await state();
      expect(
        /already declares constant D/.test(s.error) &&
          frozen(s) === frozen(pre) &&
          s.network.constants.length === 2,
        'Unequal D collision refuses; no partial declaration additions',
        s.error,
      );
      await dismissError();
      pre = await state();
      await contextItem(null, 'Paste');
      s = await state();
      expect(
        /already declares constant D/.test(s.error) && frozen(s) === frozen(pre),
        'Context Paste refuses identically',
      );
    },
  );

  await check('S07', 'Timed→untimed refusal; untimed→timed default timing', async (expect) => {
    await openFile(SYM);
    await select(ISLAND_A_NODES);
    await key('Control+c');
    await openFile(UNT);
    let pre = await state();
    await key('Control+v');
    let s = await state();
    expect(
      /Cannot paste a timed selection into an untimed model/.test(s.error) &&
        frozen(s) === frozen(pre),
      'Timed v3 into untimed refuses atomically',
      s.error,
    );
    await dismissError();
    await key('Control+a');
    await key('Control+c');
    await newModel('Timed target', true);
    pre = await state();
    await key('Control+v');
    s = await state();
    const comp = s.network.components[0];
    const ids = newIds(pre, s, comp.id);
    expect(
      !s.error && ids.length === 10 && s.network.constants.length === 2,
      'Untimed v3 pastes into timed (6 nodes, 4 arcs, UW/UH)',
      [s.error, ids.length],
    );
    expect(
      ids.every(
        (id) =>
          !Object.hasOwn(comp.timing.intervals, id) &&
          !Object.hasOwn(comp.timing.invariants, id) &&
          !Object.hasOwn(comp.timing.ages, id),
      ) &&
        comp.timing.urgent.length === 0 &&
        comp.timing.transports.length === 0,
      'Pasted elements get default timing',
      comp.timing,
    );
    expect(
      comp.net.arcs.filter((a) => a.kind === 'inhibitor').length === 1 &&
        comp.net.arcs.filter((a) => typeof a.weight === 'object').length === 3,
      'Inhibitor kind and three symbolic weights retained',
    );
  });

  await check(
    'S08',
    'Fresh context plain v3; readable unrelated/malformed text never uses stale internal copy',
    async (expect) => {
      await openFile(SYM);
      await key('Control+a');
      await key('Control+c');
      const text = await clip();
      await setClip('hello world');
      let pre = await state();
      await key('Control+v');
      let s = await state();
      expect(
        s.error && frozen(s) === frozen(pre),
        'Unrelated readable text refuses (no stale internal fallback)',
        s.error,
      );
      await dismissError();
      const bad = parse(text);
      bad.extra = 1;
      await setClip(JSON.stringify(bad));
      await key('Control+v');
      s = await state();
      expect(s.error && frozen(s) === frozen(pre), 'Malformed v3 text refuses', s.error);
      await dismissError();
      // Custom MIME holds v3 while text/plain is unrelated: must refuse, not use either stale copy.
      const mixed = await page.evaluate(async (t) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob(['unrelated'], { type: 'text/plain' }),
              'web application/x-tapaal-clipboard+json': new Blob([t], {
                type: 'application/x-tapaal-clipboard+json',
              }),
            }),
          ]);
          return true;
        } catch (e) {
          return String(e);
        }
      }, text);
      if (mixed === true) {
        await menu('Paste');
        s = await state();
        expect(
          s.error && frozen(s) === frozen(pre),
          'Custom-MIME v3 with mismatched text/plain refuses',
          s.error,
        );
        await dismissError();
      } else expect(true, `Custom web format unsupported here: ${mixed}`);
      // Custom MIME round trip through menu Copy/Paste.
      await key('Control+a');
      await menu('Copy');
      const types = await page.evaluate(async () =>
        (await navigator.clipboard.read()).flatMap((i) => i.types),
      );
      expect(types.includes('text/plain'), `Menu Copy wrote ${types.join(', ')}`, types);
      pre = await state();
      await menu('Paste');
      s = await state();
      expect(
        !s.error && s.past === pre.past + 1 && /^Pasted\./.test(s.notice),
        'Menu Paste via read()',
        [s.error, s.notice],
      );
      // Fresh browser context: no internal payload, plain text only.
      await fresh();
      await newModel('Elsewhere', true);
      await setClip(text);
      pre = await state();
      await key('Control+v');
      s = await state();
      const comp = s.network.components[0].id;
      expect(
        !s.error &&
          s.past === pre.past + 1 &&
          s.network.constants.length === 6 &&
          pasted(pre, s, comp) === EXPECT_ALL,
        'Fresh context pastes plain-text v3 with full fidelity and six fresh declarations',
        s.error,
      );
    },
  );

  await check(
    'S09',
    'Denied system clipboard: internal-only notices and recovery',
    async (expect) => {
      await openFile(SYM);
      await key('Control+a');
      await menu('Copy');
      let s = await state();
      expect(
        /Copied inside TAPAAL Web only; system clipboard unavailable/.test(s.notice) && !s.error,
        'Denied write: internal-only notice',
        s.notice,
      );
      await newModel('Denied target', true);
      const pre = await state();
      await menu('Paste');
      s = await state();
      expect(
        !s.error &&
          s.past === pre.past + 1 &&
          s.network.constants.length === 6 &&
          /System clipboard unavailable .*pasted internal TAPAAL Web copy/.test(s.notice),
        'Denied read recovers the internal v3 copy (fresh IDs in other document)',
        [s.error, s.notice],
      );
    },
    { init: deniedClipboard },
  );

  await check(
    'S10',
    'readText fallback (no read()) round-trips v3',
    async (expect) => {
      await openFile(SYM);
      await key('Control+a');
      await menu('Copy');
      let s = await state();
      expect(
        /^Copied selection\./.test(s.notice),
        'writeText fallback reports system copy',
        s.notice,
      );
      await newModel('Text target', true);
      const pre = await state();
      await menu('Paste');
      s = await state();
      const comp = s.network.components[0].id;
      expect(
        !s.error && pasted(pre, s, comp) === EXPECT_ALL && /^Pasted\./.test(s.notice),
        'readText v3 paste has full fidelity',
        [s.error, s.notice],
      );
    },
    { init: textOnlyClipboard },
  );

  await check(
    'S11',
    'Hostile/malformed envelopes through the public paste interface change nothing',
    async (expect) => {
      await openFile(SYM);
      await select(ISLAND_A_NODES);
      await key('Control+c');
      const good = parse(await clip());
      await newModel('Hostile', true);
      const base = await state();
      const clone = () => structuredClone(good);
      const cut = (f) => {
        const e = clone();
        f(e);
        return JSON.stringify(e);
      };
      const W = (e) => e.constants.find((c) => c.name === 'W');
      const iArc = (e) => e.fragment.arcs.find((a) => a.id === 'i');
      const mutants = {
        'unknown top-level key': cut((e) => (e.extra = 1)),
        'own __proto__ key': JSON.stringify(clone()).replace('{', '{"__proto__":{"polluted":1},'),
        'version 4': cut((e) => (e.version = 4)),
        'version "3"': cut((e) => (e.version = '3')),
        'unknown fragment key': cut((e) => (e.fragment.extra = [])),
        'unknown constant key': cut((e) => (W(e).note = 'x')),
        'unknown ref key': cut((e) => (iArc(e).weight.extra = 1)),
        'missing dependency': cut((e) => (e.constants = e.constants.filter((c) => c.name !== 'W'))),
        'unreferenced extra declaration': cut((e) =>
          e.constants.push({ id: 'cS', name: 'Spare', value: 9 }),
        ),
        'duplicate dependency declaration': cut((e) => e.constants.push({ ...W(e) })),
        'duplicate name, different IDs': cut((e) =>
          e.constants.push({ id: 'dup', name: 'W', value: 3 }),
        ),
        'empty constantId': cut((e) => (iArc(e).weight = { constantId: '' })),
        'ref to undeclared ID': cut((e) => (iArc(e).weight = { constantId: 'nope' })),
        'weight as name string': cut((e) => (iArc(e).weight = 'W')),
        'arithmetic weight text': cut((e) => (iArc(e).weight = '1+2')),
        'value as string': cut((e) => (W(e).value = '3')),
        'value arithmetic': cut((e) => (W(e).value = '1+2')),
        'negative value': cut((e) => (W(e).value = -1)),
        'fractional value': cut((e) => (W(e).value = 1.5)),
        'Zero weight term': cut((e) => {
          const z = e.constants.find((c) => c.name === 'Z');
          iArc(e).weight = { constantId: z.id };
          e.fragment.arcs.find((a) => a.id === 'o').weight = { constantId: z.id };
          e.constants = e.constants.filter((c) => c.name !== 'W');
        }),
        'invalid name': cut((e) => (W(e).name = '1W')),
        'reserved name inf': cut((e) => (W(e).name = 'inf')),
        'mismatched transport weights': cut((e) => (iArc(e).weight = 3)),
        'partial transport (output arc removed)': cut((e) => {
          e.fragment.arcs = e.fragment.arcs.filter((a) => a.id !== 'o');
        }),
        'transport pair to unknown arc': cut(
          (e) => (e.fragment.timing.transports[0].outputArc = 'zz'),
        ),
        'timed without timing': cut((e) => delete e.fragment.timing),
        'untimed with timing': cut((e) => (e.modelType = 'untimed')),
        'unknown timing key': cut((e) => (e.fragment.timing.extra = {})),
        'age violating Zero-style invariant': cut((e) => {
          const x = e.constants.find((c) => c.name === 'X');
          x.value = 0;
        }),
        'empty sourceDocumentId': cut((e) => (e.sourceDocumentId = '')),
        'too large text': JSON.stringify({ ...clone(), pad: 'x'.repeat(4_000_001) }),
        'no nodes': cut((e) => {
          e.fragment.nodes = [];
          e.fragment.arcs = [];
          e.fragment.timing = {
            intervals: {},
            invariants: {},
            ages: {},
            urgent: [],
            transports: [],
          };
          e.constants = [];
        }),
      };
      for (const [name, text] of Object.entries(mutants)) {
        await setClip(text);
        await focusCanvas();
        await key('Control+v');
        const s = await state();
        expect(
          !!s.error && frozen(s) === frozen(base),
          `${name}: refused, nothing changed`,
          s.error || 'ACCEPTED',
        );
        await dismissError();
      }
      // Valid positive control after hostile inputs.
      await setClip(JSON.stringify(good));
      await key('Control+v');
      const s = await state();
      expect(
        !s.error && s.network.constants.length === 4,
        'Unmodified envelope still pastes',
        s.error,
      );
    },
  );

  await check(
    'S12',
    'Prototype-looking constant/node IDs and names are own data',
    async (expect) => {
      await openFile(PROTO);
      let s = await state();
      expect(
        !s.error && s.network?.constants[0]?.name === 'constructor',
        'Proto fixture opened',
        s.error,
      );
      await key('Control+a');
      await key('Control+c');
      const text = await clip();
      const env = parse(text);
      expect(
        env?.version === 3 &&
          env.constants.length === 1 &&
          Object.hasOwn(env.fragment.timing.invariants, '__proto__'),
        'Envelope keeps __proto__ invariant key and constructor declaration as own data',
        text.slice(0, 300),
      );
      await key('Control+v');
      s = await state();
      // Playwright's object transfer turns an own __proto__ key into a prototype: reparse source JSON.
      const t = JSON.parse(s.source).components[0].timing;
      expect(
        !s.error && s.past === 1 && Object.keys(t.invariants).length === 2,
        'Same-document paste binds __proto__ ID',
        s.error,
      );
      await newModel('Proto target', true);
      await setClip(text);
      await key('Control+v');
      s = await state();
      expect(
        !s.error &&
          s.network.constants[0]?.name === 'constructor' &&
          s.network.constants[0].id !== '__proto__',
        'Cross-document fresh ID for prototype-looking declaration',
        s.error,
      );
    },
  );

  await check(
    'S13',
    'Query protection: refused cut is recoverable; protections never transferred',
    async (expect) => {
      await openFile(QRY);
      let s = await state();
      const base = s;
      const protectedBefore = JSON.stringify(s.network.savedQueries?.protectedConstants);
      expect(
        !s.error && protectedBefore?.includes('"Q"'),
        'Query fixture protects Q',
        protectedBefore,
      );
      await key('Control+a');
      await setClip('SENTINEL');
      await key('Control+x');
      s = await state();
      expect(
        s.error && frozen(s) === frozen(base),
        'Cut of query-referenced place refused atomically',
        s.error,
      );
      const env = parse(await clip());
      expect(
        env?.version === 3 && env.constants[0]?.name === 'Q',
        'Refused cut still wrote recoverable v3 copy',
      );
      await dismissError();
      await newModel('Unprotected', true);
      await key('Control+v');
      s = await state();
      expect(
        !s.error &&
          s.network.constants.length === 1 &&
          !(s.network.savedQueries?.protectedConstants ?? []).length,
        'Pasted Q is not protected in the target',
        [s.error, s.network.savedQueries],
      );
      await tab('query');
      await focusCanvas();
      await key('Control+v');
      s = await state();
      expect(
        !s.error && JSON.stringify(s.network.savedQueries?.protectedConstants) === protectedBefore,
        'Same-document paste keeps existing protections exactly',
        s.error,
      );
      // Cross-doc into a protected target: target protections retained, pasted ones not added.
      await openFile(SYM);
      await select(ISLAND_A_NODES);
      await key('Control+c');
      await tab('query');
      const pre = await state();
      await key('Control+v');
      s = await state();
      expect(
        !s.error &&
          JSON.stringify(s.network.savedQueries?.protectedConstants) ===
            JSON.stringify(pre.network.savedQueries?.protectedConstants) &&
          s.network.constants.length === pre.network.constants.length + 4,
        'Protected target keeps its protections; pasted W/Z/D/X unprotected',
        s.error,
      );
    },
  );

  await check(
    'S14',
    'Text fields and Simulate block model clipboard; no simulated ages copied',
    async (expect) => {
      await openFile(SYM);
      await key('Control+a');
      await key('Control+c');
      const text = await clip();
      const d = pane();
      await d.locator('header').getByRole('button', { name: 'Add…' }).click();
      await page.locator('app-constant-dialog form').waitFor();
      const pre = await state();
      await page.locator('#constant-name').click();
      await key('Control+v');
      const value = await page.locator('#constant-name').inputValue();
      let s = await state();
      expect(
        frozen(s) === frozen(pre) && value.length > 0,
        'Paste in dialog text field stays in the field',
        value.slice(0, 60),
      );
      await page.locator('app-constant-dialog footer button', { hasText: 'Cancel' }).click();
      await mode('Simulate');
      await page.waitForTimeout(150);
      const sim = await state();
      await focusCanvas();
      await key('Control+v');
      s = await state();
      expect(frozen(s) === frozen(sim), 'Ctrl+V in Simulate changes nothing');
      expect(
        !(await menu('Paste')) || frozen(await state()) === frozen(sim),
        'Menu Paste blocked/no-op in Simulate',
      );
      const delayField = page.locator('#delay-amount');
      if (await delayField.count()) {
        await delayField.fill('1');
        await page
          .locator('[aria-label="Time and token selection"]')
          .getByRole('button', { name: 'Delay' })
          .click()
          .catch(() => {});
      }
      await mode('Edit');
      await focusCanvas();
      await key('Control+a');
      await key('Control+c');
      const after = parse(await clip());
      expect(
        JSON.stringify(after?.fragment?.timing?.ages) ===
          JSON.stringify(parse(text).fragment.timing.ages),
        'Copy after simulating delay still carries authored initial ages only',
        after?.fragment?.timing?.ages,
      );
    },
  );

  await check(
    'S15',
    'Races: delayed cut/paste cancelled by reselect, constant rename, undo/redo ABA, tab switch, newer op',
    async (expect) => {
      await openFile(SYM);
      const base = await state();
      // Delayed menu Cut, selection away and back to the same IDs.
      await key('Control+a');
      await setClip('SENTINEL');
      await menu('Cut');
      await clearSelection();
      await focusCanvas();
      await key('Control+a');
      await page.waitForTimeout(1800);
      let s = await state();
      expect(
        frozen(s) === frozen(base) && /Clipboard action cancelled/.test(s.notice),
        'Cut cancelled after selection away-and-back; no mutation',
        s.notice,
      );
      const written = parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(written?.version === 3, 'Cut payload retained on the system clipboard');
      // Delayed paste then rename (same resolved values).
      await menu('Paste');
      await editDeclaration('L', 'L2');
      await page.waitForTimeout(1800);
      s = await state();
      const renamed = s;
      expect(
        s.past === base.past + 1 &&
          /Clipboard action cancelled/.test(s.notice) &&
          s.network.components[0].net.nodes.length === 9,
        'Paste cancelled by an intervening constant rename; only the rename committed',
        [s.past, s.notice],
      );
      // Undo/redo ABA.
      await focusCanvas();
      await menu('Paste');
      await key('Control+z');
      await key('Control+y');
      await page.waitForTimeout(1800);
      s = await state();
      expect(
        s.source === renamed.source &&
          s.past === renamed.past &&
          s.future === 0 &&
          /Clipboard action cancelled/.test(s.notice),
        'Undo/redo ABA cancels the delayed paste',
        [s.past, s.future, s.notice],
      );
      // Tab switch away and back.
      await newModel('Other', true);
      await tab('Symbolic');
      await menu('Paste');
      await tab('Other');
      await tab('Symbolic');
      await page.waitForTimeout(1800);
      s = await state();
      expect(
        s.source === renamed.source && /Clipboard action cancelled/.test(s.notice),
        'Tab switch away and back cancels the delayed paste',
        s.notice,
      );
      // Newer operation supersedes an older one.
      await menu('Paste');
      await page.waitForTimeout(300);
      await menu('Paste');
      await page.waitForTimeout(2500);
      s = await state();
      expect(
        !s.error && s.past === renamed.past + 1 && s.docs.find((d) => d.id === s.docId),
        'Two overlapping pastes commit exactly once',
        [s.error, s.past],
      );
    },
    { init: slowClipboard, delay: 1200 },
  );

  await check('S16', 'Orphan and wrong-kind timing keys in v3 envelopes refuse', async (expect) => {
    await openFile(SYM);
    await key('Control+a');
    await key('Control+c');
    const good = parse(await clip());
    await newModel('Orphans', true);
    const base = await state();
    const mutate = (f) => {
      const e = structuredClone(good);
      f(e);
      return JSON.stringify(e);
    };
    const X = (e) => ({ constantId: e.constants.find((c) => c.name === 'X').id });
    const mutants = {
      'orphan invariant key': mutate(
        (e) => (e.fragment.timing.invariants.ghost = { upper: '1', upperClosed: true }),
      ),
      'orphan invariant key with symbolic bound': mutate(
        (e) => (e.fragment.timing.invariants.ghost = { upper: X(e), upperClosed: true }),
      ),
      'orphan interval key': mutate(
        (e) =>
          (e.fragment.timing.intervals.ghost = {
            lower: '0',
            upper: null,
            lowerClosed: true,
            upperClosed: false,
          }),
      ),
      'orphan age key': mutate((e) => (e.fragment.timing.ages.ghost = ['1'])),
      'orphan urgent ID': mutate((e) => e.fragment.timing.urgent.push('ghost')),
      'invariant on a transition': mutate(
        (e) => (e.fragment.timing.invariants.t = { upper: '1', upperClosed: true }),
      ),
      'interval on a node': mutate(
        (e) =>
          (e.fragment.timing.intervals.p = {
            lower: '0',
            upper: null,
            lowerClosed: true,
            upperClosed: false,
          }),
      ),
      'ages on a transition': mutate((e) => (e.fragment.timing.ages.t = ['1'])),
      'urgent place': mutate((e) => e.fragment.timing.urgent.push('p')),
      'more ages than tokens': mutate((e) => (e.fragment.timing.ages.p = ['0.1', '0.2', '0.3'])),
      'negative age': mutate((e) => (e.fragment.timing.ages.p = ['-1', '2.50'])),
      'non-decimal age': mutate((e) => (e.fragment.timing.ages.p = ['1e1', '2.50'])),
      'numeric (non-string) age': mutate((e) => (e.fragment.timing.ages.p = [0.1, '2.50'])),
      'duplicate node ID': mutate((e) => e.fragment.nodes.push({ ...e.fragment.nodes[0] })),
      'arc to missing node': mutate((e) => (e.fragment.arcs[0].target = 'ghost')),
      'token count as ref': mutate((e) => (e.fragment.nodes[0].tokens = X(e))),
    };
    for (const [name, text] of Object.entries(mutants)) {
      await setClip(text);
      await focusCanvas();
      await key('Control+v');
      const s = await state();
      const comp = JSON.parse(s.source).components[0];
      expect(
        !!s.error && frozen(s) === frozen(base),
        `${name}: refused, nothing changed`,
        s.error ||
          `ACCEPTED; timing keys ${JSON.stringify({
            inv: Object.keys(comp.timing?.invariants ?? {}),
            int: Object.keys(comp.timing?.intervals ?? {}),
            ages: Object.keys(comp.timing?.ages ?? {}),
            urgent: comp.timing?.urgent,
          })}`,
      );
      if (!s.error) await key('Control+z');
      await dismissError();
    }
  });

  await check(
    'S17',
    'Component switch during delayed paste cancels; cross-component same-document binding',
    async (expect) => {
      await openFile(SYM);
      await select(['z', 'u']);
      await key('Control+c');
      const env = parse(await clip());
      const base = await state();
      await page.locator('.component-row', { hasText: /^\s*Side/ }).click();
      await focusCanvas();
      let s = await state();
      expect(
        s.componentId === 'side',
        'Switched to Side through the component list',
        s.componentId,
      );
      await key('Control+v');
      s = await state();
      const side = s.network.components.find((c) => c.id === 'side');
      expect(
        !s.error &&
          JSON.stringify(s.network.constants) === JSON.stringify(base.network.constants) &&
          side.net.arcs.filter((a) => a.weight?.constantId === 'cK').length === 1 &&
          side.timing.intervals[side.net.arcs.find((a) => a.weight?.constantId === 'cK').id]?.lower
            ?.constantId === 'cL',
        'Cross-component paste binds the same-document IDs (K, L, Z) without new declarations',
        [s.error, env?.constants?.map((c) => c.name)],
      );
      expect(
        JSON.stringify(s.network.components.find((c) => c.id === 'main')) ===
          JSON.stringify(base.network.components.find((c) => c.id === 'main')),
        'Source component untouched',
      );
    },
  );

  await check(
    'S18',
    'Delayed copy/paste races: component switch, copy then constant edit',
    async (expect) => {
      await openFile(SYM);
      const base = await state();
      await key('Control+a');
      await key('Control+c'); // keyboard copy is synchronous
      await menu('Paste');
      await page.locator('.component-row', { hasText: /^\s*Side/ }).click();
      await page.locator('.component-row', { hasText: /^\s*Main/ }).click();
      await page.waitForTimeout(1800);
      let s = await state();
      expect(
        s.componentId === 'main' &&
          JSON.stringify(s.network.components) === JSON.stringify(base.network.components) &&
          /Clipboard action cancelled/.test(s.notice),
        'Component switch away and back cancels the delayed paste',
        [s.componentId, s.notice, s.past],
      );
      // Delayed menu Copy, then a constant rename before the write resolves.
      await setClip('SENTINEL-COPY');
      await focusCanvas();
      await key('Control+a');
      await menu('Copy');
      await editDeclaration('Spare', 'Spare2');
      await page.waitForTimeout(1800);
      s = await state();
      const text = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
      expect(
        true,
        `Observed: copy notice "${s.notice}"; system clipboard ${text === 'SENTINEL-COPY' ? 'unchanged' : parse(text)?.version === 3 ? 'holds the v3 copy' : String(text).slice(0, 40)}`,
      );
      expect(
        /Copied from the earlier state/.test(s.notice) && parse(text)?.version === 3,
        'Completed copy reports its earlier snapshot accurately after a model edit',
        { notice: s.notice, clipboardVersion: parse(text)?.version },
      );
    },
    { init: slowClipboard, delay: 1200 },
  );
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
const failed = results.filter((r) => r.status !== 'pass');
const obs = results.flatMap((r) => r.observations);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed; ${obs.filter((o) => o.ok).length}/${obs.length} assertions; output ${OUT}`,
);
process.exit(failed.length ? 1 : 0);
