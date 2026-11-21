#!/usr/bin/env node
// Browser validation of the timed web clipboard (see design/TIMED-CLIPBOARD-VALIDATION.md).
// Drives a running development build with real Playwright keyboard, mouse and file-chooser input.
// App signals and rendered DOM are only read; no App methods or signal setters are invoked.
// System clipboard contents are set through the browser clipboard API (as another application
// would), and permission denial / slow I/O are injected into navigator.clipboard by init scripts.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-timed-clipboard.mjs http://127.0.0.1:4397 /tmp/tapaal-timed-clipboard/run
//
// Exit status 1 when any check fails. Results: <out>/results.json, fixtures and screenshots.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4397';
const OUT = process.argv[3] ?? '/tmp/tapaal-timed-clipboard/run';
const ONLY = process.env.ONLY?.split(',');
mkdirSync(OUT, { recursive: true });

// ---- fixtures ---------------------------------------------------------------------------------
const TIMED = { timed: true, colored: false, game: false, stochastic: false };
const UNTIMED = { ...TIMED, timed: false };
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
const timing = (t = {}) => ({
  intervals: {},
  invariants: {},
  urgent: [],
  transports: [],
  ages: {},
  ...t,
});
const iv = (lower, upper, lowerClosed = true, upperClosed = true) => ({
  lower,
  upper,
  lowerClosed,
  upperClosed,
});
const inv = (upper, upperClosed = true) => ({ upper, upperClosed });
function fixture(file, name, type, components) {
  const path = join(OUT, file);
  writeFileSync(
    path,
    JSON.stringify({
      format: 'tapaal-web-network',
      version: 1,
      network: {
        name,
        type,
        components: components.map(({ timing: t, annotations, ...c }) => ({
          ...c,
          net: { ...c.net, name, ...(annotations ? { annotations } : {}) },
          ...(type.timed ? { timing: timing(t) } : {}),
        })),
      },
    }),
  );
  return path;
}
const component = (id, template, nodes, arcs, t, extra = {}) => ({
  id,
  active: true,
  net: { name: template, template, nodes, arcs },
  timing: t,
  ...extra,
});

// Every timed field the clipboard claims to carry, plus routes, rotation, hidden name and a note.
// P(2: 0.1, 2.50, <=3) =[1,4] w2 transport=> T(45°) => Q;  Z(1, implicit zero, hidden) -(1,5)-> U;
// R(3: 1.5 + two implicit zeros) -> W(urgent) -> S(<=4); Z -o T inhibitor.
const RICH_COMPONENT = component(
  'main',
  'Main',
  [
    place('p', 'P', 150, 150, 2),
    transition('t', 'T', 350, 150, { angle: 45 }),
    place('q', 'Q', 550, 150),
    place('z', 'Z', 150, 330, 1, { nameVisible: false, nameOffsetX: 12, nameOffsetY: -7 }),
    transition('u', 'U', 350, 330),
    place('r', 'R', 150, 500, 3),
    transition('w', 'W', 350, 500),
    place('s', 'S', 550, 500),
  ],
  [
    arc('i', 'p', 't', 2, { bends: [{ x: 250, y: 110, curved: false }] }),
    arc('o', 't', 'q', 2, { bends: [{ x: 450, y: 200, curved: true }], curvedEnd: true }),
    arc('zu', 'z', 'u'),
    arc('zt', 'z', 't', 1, { kind: 'inhibitor' }),
    arc('rw', 'r', 'w'),
    arc('ws', 'w', 's'),
  ],
  {
    invariants: { p: inv('3'), s: inv('4', false) },
    ages: { p: ['0.1', '2.50'], r: ['1.5'] },
    intervals: { i: iv('1', '4'), zu: iv('1', '5', false, false) },
    urgent: ['w'],
    transports: [{ inputArc: 'i', outputArc: 'o' }],
  },
  { annotations: [{ id: 'n1', text: 'Note', x: 600, y: 300, width: 120, height: 40 }] },
);
const RICH = fixture('rich.json', 'Rich timed', TIMED, [RICH_COMPONENT]);
// Same local IDs as RICH, with its own timing on p; second component Beta for cross-component paste.
const CLASH = fixture('clash.json', 'Clash timed', TIMED, [
  component(
    'main',
    'Main',
    [place('p', 'P', 700, 600, 1), transition('t', 'T', 800, 600), place('n1', 'N', 900, 600)],
    [arc('i', 'p', 't'), arc('o', 't', 'n1')],
    { invariants: { p: inv('9') }, ages: { p: ['7'] } },
  ),
  component('beta', 'Beta', [place('b', 'B', 700, 600)], [], {}),
]);
const PLAIN = fixture('plain.json', 'Plain untimed', UNTIMED, [
  component(
    'main',
    'Main',
    [place('p', 'P', 150, 150, 2), transition('t', 'T', 350, 150), place('q', 'Q', 550, 150)],
    [arc('i', 'p', 't', 3, { bends: [{ x: 250, y: 110, curved: false }] }), arc('o', 't', 'q')],
  ),
]);
// Saved query references Moved; the transport targets it.
const QUERY_TAPN = join(OUT, 'query.tapn');
writeFileSync(
  QUERY_TAPN,
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <net active="true" id="Clock" type="P/T net">
    <place displayName="true" id="P0" initialMarking="3" invariant="&lt;= 5" name="Start" nameOffsetX="0" nameOffsetY="0" positionX="90" positionY="60"/>
    <place displayName="true" id="P1" initialMarking="0" invariant="&lt; inf" name="Moved" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="60"/>
    <transition angle="0" displayName="true" id="T0" infiniteServer="false" name="Go" nameOffsetX="0" nameOffsetY="0" player="0" positionX="195" positionY="60" priority="0" urgent="false"/>
    <arc id="A0" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" transportID="1" type="transport" weight="2"/>
    <arc id="A1" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" transportID="1" type="transport" weight="2"/>
  </net>
  <query active="true" name="Moved" type="Default" query="EF Clock.Moved &gt;= 2"/>
  <k-bound bound="3"/>
  <feature isGame="false" isTimed="true" isColored="false" isStochastic="false"/>
</pnml>
`,
);

// ---- canonical fragment: compares pasted elements with the original selection ----------------
// Nodes are keyed by shifted position, so the comparison is independent of IDs and names.
function fragment(net, t, ids, shift = 0) {
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
const allIds = (net) => [...net.nodes, ...net.arcs, ...(net.annotations ?? [])].map((e) => e.id);

// ---- browser ----------------------------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
let context, page;
const results = [];
async function fresh({ permissions = true, init } = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: permissions ? ['clipboard-read', 'clipboard-write'] : [],
  });
  if (init) await context.addInitScript(init);
  page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
}
const settle = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = async () => {
  await settle();
  return page.evaluate(() => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const ws = app.workspace();
    const doc = ws.documents.find((d) => d.id === ws.activeDocumentId);
    const comp = doc?.network.components.find((c) => c.id === doc.session.componentId);
    return {
      docs: ws.documents.map((d) => JSON.stringify(d.network)),
      docPast: ws.documents.map((d) => d.past.length),
      network: doc && JSON.parse(JSON.stringify(doc.network)),
      componentId: doc?.session.componentId,
      past: doc?.past.length,
      future: doc?.future.length,
      timed: app.timed(),
      net: JSON.parse(JSON.stringify(app.net())),
      timing: comp?.timing && JSON.parse(JSON.stringify(comp.timing)),
      selected: [...app.selectedIds()],
      mode: app.mode(),
      ages: app.mode() === 'Simulate' ? JSON.parse(JSON.stringify(app.currentAges())) : null,
      error: app.error(),
      notice: app.notice(),
      polluted: Object.prototype.hasOwnProperty('polluted') || {}.polluted !== undefined,
    };
  });
};
const persistent = (s) => JSON.stringify(s.network);
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const setClip = (text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
const key = async (k) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(60);
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
async function arcPoint(id, fraction = 0.25) {
  await settle();
  return page.evaluate(
    ([id, fraction]) => {
      const path = document.querySelector(`[data-arc="${CSS.escape(id)}"] .arc-hit`);
      const p = path
        .getPointAtLength(path.getTotalLength() * fraction)
        .matrixTransform(path.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [id, fraction],
  );
}
// page.mouse.click has no modifier option: hold Shift on the real keyboard instead.
async function shiftClick(point) {
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
}
async function select(ids) {
  await page.mouse.click(1150, 760); // empty canvas clears the previous selection
  for (const [n, id] of ids.entries())
    n ? await shiftClick(await nodePoint(id)) : await clickNode(id);
  await focusCanvas();
}
async function openFile(path) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page
      .locator('.command-toolbar, [aria-label="Document toolbar"]')
      .getByRole('button', { name: 'Open model' })
      .click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForTimeout(150);
  const accept = page.getByRole('button', { name: 'Open in new tab', exact: true });
  if (await accept.isVisible().catch(() => false)) await accept.click();
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
  await page.waitForTimeout(120);
  return !disabled;
}
async function contextItem(nodeId, label) {
  await clickNode(nodeId, { button: 'right' });
  await page.getByRole('menu', { name: 'Canvas actions' }).waitFor();
  const item = page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first();
  const disabled = !(await item.count()) || (await item.isDisabled());
  if (disabled) await key('Escape');
  else await item.click();
  await page.waitForTimeout(120);
  return !disabled;
}
async function tab(name) {
  await page.locator('.document-tab button:first-child', { hasText: `${name}.tapn` }).click();
  await focusCanvas();
}
async function mode(name) {
  await page.locator('[aria-label="Workspace mode"]').getByRole('button', { name }).click();
}
async function check(id, title, fn, options) {
  if (ONLY && !ONLY.includes(id)) return;
  const r = { id, title, status: 'pass', observations: [] };
  const expect = (ok, message, detail) => {
    r.observations.push({ ok: !!ok, message, ...(detail === undefined ? {} : { detail }) });
    if (!ok) r.status = 'fail';
  };
  try {
    await fresh(options);
    await fn(expect);
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
            `\n   ${o.ok ? 'ok  ' : 'FAIL'} ${o.message}${o.ok || o.detail === undefined ? '' : ' ' + JSON.stringify(o.detail)}`,
        )
        .join(''),
  );
}
const RICH_ALL = allIds({ ...RICH_COMPONENT.net, annotations: RICH_COMPONENT.annotations });
// The selection fragment expected after paste (+30,+30), computed from the fixture itself.
const RICH_EXPECTED = fragment(
  { ...RICH_COMPONENT.net, annotations: RICH_COMPONENT.annotations },
  timing(RICH_COMPONENT.timing),
  RICH_ALL,
);
const pastedFragment = (before, after) => {
  const old = new Set(allIds(before.net));
  return fragment(
    after.net,
    after.timing,
    allIds(after.net).filter((id) => !old.has(id)),
    30,
  );
};
let ENVELOPE = null;

try {
  await check(
    'C01',
    'Keyboard copy/paste carries all timing, layout and fresh IDs',
    async (expect) => {
      await openFile(RICH);
      await setClip('SENTINEL');
      const base = await state();
      await key('Control+a');
      await key('Control+c');
      const text = await clip();
      let env = null;
      try {
        env = JSON.parse(text);
      } catch {}
      ENVELOPE = text;
      writeFileSync(join(OUT, 'C01-envelope.json'), text);
      expect(
        env?.format === 'tapaal-web-clipboard' &&
          env.version === 2 &&
          env.modelType === 'timed' &&
          env.native === '',
        'Ctrl+C writes the version 2 timed web envelope to text/plain',
        text.slice(0, 200),
      );
      expect(
        JSON.stringify(env?.timing?.ages) === JSON.stringify({ p: ['0.1', '2.50'], r: ['1.5'] }),
        'Envelope ages are the saved nonzero initial ages (zero ages implicit)',
        env?.timing?.ages,
      );
      const copied = await state();
      expect(
        persistent(copied) === persistent(base) && copied.past === 0,
        'Copy does not change the document',
      );
      expect(
        /Web envelope preserves .*timing.*desktop TAPAAL clipboard transfer is unavailable/.test(
          copied.notice,
        ),
        'Copy notice says the transfer is web-only',
        copied.notice,
      );
      await key('Control+v');
      const after = await state();
      expect(after.past === 1 && !after.error, 'Paste is one history entry', after.error);
      expect(
        pastedFragment(base, after) === RICH_EXPECTED,
        'Pasted fragment equals the selection at +30,+30 with all timing remapped',
        { pasted: pastedFragment(base, after), expected: RICH_EXPECTED },
      );
      const old = new Set(allIds(base.net));
      const newIds = allIds(after.net).filter((id) => !old.has(id));
      const names = after.net.nodes.map((n) => n.name);
      expect(
        newIds.length === RICH_ALL.length &&
          new Set(names).size === names.length &&
          JSON.stringify([...after.selected].sort()) === JSON.stringify([...newIds].sort()),
        'Fresh IDs and unique names; pasted elements selected',
        { newIds, names },
      );
      expect(
        Object.keys(after.timing.ages).length === 4 &&
          after.timing.transports.length === 2 &&
          after.timing.urgent.length === 2,
        'Original timing retained beside pasted timing',
        after.timing,
      );
      await key('Control+z');
      let s = await state();
      expect(persistent(s) === persistent(base), 'One undo restores graph and timing together');
      await key('Control+y');
      s = await state();
      expect(persistent(s) === persistent(after), 'Redo restores the complete paste');
      await key('Control+v');
      s = await state();
      const ids = allIds(s.net);
      expect(
        new Set(ids).size === ids.length &&
          new Set(s.net.nodes.map((n) => n.name)).size === s.net.nodes.length,
        'Second paste allocates fresh IDs/names again',
      );
    },
  );

  await check(
    'C02',
    'Menu, context and duplicate paths match the keyboard result',
    async (expect) => {
      await openFile(RICH);
      const base = await state();
      await key('Control+a');
      const paths = {
        'Edit menu Copy+Paste': async () => {
          await menu('Copy');
          await menu('Paste');
        },
        'Context Copy+Paste': async () => {
          await setClip('SENTINEL');
          if (!(await contextItem('p', 'Copy'))) throw new Error('Context Copy unavailable');
          if (!/"version":2/.test(await clip())) throw new Error('Context Copy wrote no envelope');
          await page.mouse.click(1100, 700, { button: 'right' });
          await page
            .getByRole('menuitem', { name: /^Paste/ })
            .first()
            .click();
          await page.waitForTimeout(120);
        },
        'Ctrl+D': () => key('Control+d'),
        'Edit menu Duplicate': () => menu('Duplicate'),
        'Context Duplicate selection': async () => {
          if (!(await contextItem('p', 'Duplicate selection')))
            throw new Error('Context Duplicate unavailable');
        },
      };
      for (const [label, run] of Object.entries(paths)) {
        await key('Control+a');
        const before = await state();
        await run();
        const s = await state();
        expect(
          s.past === before.past + 1 &&
            pastedFragment(before, s) === fragment(before.net, before.timing, before.selected),
          `${label}: one history entry, same faithful fragment`,
          {
            error: s.error,
            past: [before.past, s.past],
            selectedBefore: before.selected.length,
            pasted: pastedFragment(before, s).slice(0, 300),
          },
        );
        await key('Control+z');
        const u = await state();
        expect(persistent(u) === persistent(before), `${label}: one undo restores`);
      }
      expect(persistent(await state()) === persistent(base), 'Document back at base');
    },
  );

  await check(
    'C03',
    'Copied ages are the frozen initial ages, never simulated ones',
    async (expect) => {
      await openFile(RICH);
      await setClip('SENTINEL');
      await mode('Simulate');
      await page.locator('#delay-amount').fill('1');
      await page
        .locator('[aria-label="Time and token selection"]')
        .getByRole('button', { name: 'Delay' })
        .click();
      let s = await state();
      const simAges = s.ages;
      await focusCanvas();
      for (const k of ['Control+a', 'Control+c', 'Control+x', 'Control+d', 'Control+v'])
        await key(k);
      const t = await state();
      expect(
        (await clip()) === 'SENTINEL' && persistent(t) === persistent(s) && t.past === s.past,
        'Simulation mode: Ctrl+C/X/D/V change neither clipboard nor document',
        { notice: t.notice, error: t.error },
      );
      const menuCopy = await menu('Copy');
      expect(!menuCopy, 'Edit menu Copy disabled in Simulate');
      await mode('Edit');
      await focusCanvas();
      await key('Control+a');
      await key('Control+c');
      const env = JSON.parse(await clip());
      expect(
        JSON.stringify(env.timing.ages) === JSON.stringify({ p: ['0.1', '2.50'], r: ['1.5'] }),
        'Ages copied after simulation are the saved initial ages',
        { copied: env.timing.ages, simulated: simAges },
      );
    },
  );

  await check(
    'C04',
    'Fresh context pastes a plain-text envelope (no internal copy)',
    async (expect) => {
      if (!ENVELOPE) throw new Error('C01 envelope missing');
      await openFile(CLASH);
      await setClip(ENVELOPE);
      const base = await state();
      await key('Control+v');
      let s = await state();
      expect(
        s.past === 1 && pastedFragment(base, s) === RICH_EXPECTED,
        'Keyboard paste of external envelope is faithful',
        { error: s.error, past: s.past, notice: s.notice, pasted: pastedFragment(base, s) },
      );
      const ownP = base.timing.invariants.p;
      expect(
        JSON.stringify(s.timing.invariants.p) === JSON.stringify(ownP) &&
          JSON.stringify(s.timing.ages.p) === '["7"]' &&
          !allIds(s.net)
            .filter((id) => !allIds(base.net).includes(id))
            .some((id) => ['p', 't', 'q', 'i', 'o', 'n1'].includes(id)),
        'Local ID clashes: target timing untouched, pasted IDs fresh',
      );
      await key('Control+z');
      await menu('Paste');
      s = await state();
      expect(
        s.past === 1 && pastedFragment(base, s) === RICH_EXPECTED,
        'Menu paste (navigator.clipboard.read) of external envelope is faithful',
        { error: s.error, notice: s.notice },
      );
      await page.locator('.component-row', { hasText: 'Beta' }).click();
      await focusCanvas();
      const beta = await state();
      await key('Control+v');
      s = await state();
      expect(
        s.componentId === 'beta' && pastedFragment(beta, s) === RICH_EXPECTED,
        'Cross-component paste into Beta is faithful',
        s.error,
      );
    },
  );

  await check('C05', 'Cross-document copy; timed/untimed direction gates', async (expect) => {
    await openFile(RICH);
    await openFile(PLAIN);
    await newModel('Fresh timed', true);
    await tab('Rich timed');
    await select(['u']); // all-default timing selection
    await key('Control+c');
    await tab('Plain untimed');
    let base = await state();
    await key('Control+v');
    let s = await state();
    expect(
      persistent(s) === persistent(base) &&
        s.past === base.past &&
        /Cannot paste a timed selection into an untimed model/.test(s.error),
      'Timed (all-default) selection refused in untimed model',
      s.error,
    );
    await tab('Rich timed');
    await key('Control+a');
    await key('Control+c');
    await tab('Fresh timed');
    base = await state();
    await key('Control+v');
    s = await state();
    expect(
      s.past === 1 && pastedFragment(base, s) === RICH_EXPECTED,
      'Cross-document timed paste is faithful',
      s.error,
    );
    await tab('Plain untimed');
    await key('Control+a');
    await key('Control+c');
    const text = await clip();
    expect(
      /^\{"places"/.test(text) && !/tapaal-web-clipboard/.test(text),
      'Untimed copy still writes native TAPAALCopyPastModel JSON',
      text.slice(0, 80),
    );
    await tab('Fresh timed');
    base = await state();
    await key('Control+v');
    s = await state();
    const fresh = allIds(s.net).filter((id) => !allIds(base.net).includes(id));
    expect(
      s.past === base.past + 1 &&
        fresh.length === 5 &&
        JSON.stringify(s.timing) === JSON.stringify(base.timing),
      'Untimed → timed paste receives default timing',
      { error: s.error, timing: s.timing },
    );
    await tab('Plain untimed');
    base = await state();
    await key('Control+v');
    s = await state();
    expect(s.past === base.past + 1 && !s.error, 'Untimed → untimed paste unchanged', s.error);
  });

  await check('C06', 'Partial transport selections refuse before any change', async (expect) => {
    await openFile(RICH);
    await setClip('SENTINEL');
    const base = await state();
    const attempts = [
      ['source place + transition', ['p', 't']],
      ['transition + destination', ['t', 'q']],
      ['lone destination place', ['q']],
    ];
    for (const [label, ids] of attempts) {
      await select(ids);
      for (const k of ['Control+c', 'Control+x', 'Control+d']) {
        await key(k);
        const s = await state();
        expect(
          persistent(s) === persistent(base) &&
            s.past === 0 &&
            (await clip()) === 'SENTINEL' &&
            /Select both transport halves/.test(s.error),
          `${label}: ${k} refused, document and clipboard unchanged`,
          s.error,
        );
      }
      const menuCut = await menu('Cut');
      const s = await state();
      expect(
        persistent(s) === persistent(base) && (!menuCut || /transport/.test(s.error)),
        `${label}: Edit menu Cut refused`,
      );
    }
    // All three endpoints selected, then explicitly deselect one half.
    await select(['p', 't', 'q']);
    await shiftClick(await arcPoint('o'));
    await focusCanvas();
    const s0 = await state();
    await key('Control+c');
    const s = await state();
    expect(
      !s0.selected.includes('o') &&
        (await clip()) === 'SENTINEL' &&
        /Select both transport halves/.test(s.error),
      'Explicitly deselected half refused',
      { selected: s0.selected, error: s.error },
    );
    // Paste of the internal copy after a refused copy must not paste anything stale.
    expect(persistent(s) === persistent(base), 'No silent metadata removal');
  });

  await check('C07', 'Cut is one recoverable step; saved-query cut is atomic', async (expect) => {
    await openFile(RICH);
    const base = await state();
    await select(['p', 't', 'q']);
    await key('Control+x');
    let s = await state();
    expect(
      s.past === 1 &&
        !s.net.nodes.some((n) => ['p', 't', 'q'].includes(n.id)) &&
        !s.timing.transports.length &&
        !s.timing.ages.p &&
        !s.timing.invariants.p,
      'Ctrl+X removes nodes, arcs and their timing in one entry',
      { error: s.error, selected: s.selected },
    );
    const cut = await state();
    await key('Control+v');
    s = await state();
    const fresh = allIds(s.net).filter((id) => !allIds(cut.net).includes(id));
    expect(
      fragment(s.net, s.timing, fresh, 30) ===
        fragment(base.net, base.timing, ['p', 't', 'q', 'i', 'o']),
      'Paste after cut restores the transport, ages, interval and routes',
    );
    await key('Control+z');
    await key('Control+z');
    s = await state();
    expect(persistent(s) === persistent(base), 'Two undos restore the original');

    await openFile(QUERY_TAPN);
    const q = await state();
    await setClip('SENTINEL');
    await key('Control+a');
    await key('Control+x');
    s = await state();
    expect(
      persistent(s) === persistent(q) && s.past === q.past && /quer/i.test(s.error),
      'Cut of saved-query node refused atomically',
      s.error,
    );
    const clipText = await clip();
    expect(
      /"version":2/.test(clipText),
      'The refused cut left a recoverable timed copy',
      clipText.slice(0, 60),
    );
    await newModel('Recover', true);
    await key('Control+v');
    s = await state();
    expect(
      s.past === 1 &&
        s.timing.transports.length === 1 &&
        Object.keys(s.timing.invariants).length === 1,
      'Recoverable copy pastes with its transport and invariant',
      s.error,
    );
  });

  await check(
    'C08',
    'Denied system clipboard uses the internal copy and says so; stale content is not used',
    async (expect) => {
      await openFile(RICH);
      await key('Control+a');
      await menu('Copy');
      let s = await state();
      expect(
        /inside TAPAAL Web only; system clipboard unavailable/.test(s.notice),
        'Denied copy reported as web-internal',
        s.notice,
      );
      const base = await state();
      await menu('Paste');
      s = await state();
      expect(
        s.past === 1 &&
          pastedFragment(base, s) === RICH_EXPECTED &&
          /pasted internal TAPAAL Web copy/.test(s.notice),
        'Denied paste uses the internal timed copy and reports it',
        { error: s.error, notice: s.notice },
      );
    },
    {
      init: () => {
        const deny = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
        Object.defineProperty(navigator, 'clipboard', {
          value: { read: deny, readText: deny, write: deny, writeText: deny },
        });
      },
    },
  );

  await check(
    'C09',
    'Readable unrelated clipboard text is not replaced by stale memory',
    async (expect) => {
      await openFile(RICH);
      await key('Control+a');
      await key('Control+c');
      await setClip('hello from another app');
      const base = await state();
      await key('Control+v');
      let s = await state();
      expect(
        persistent(s) === persistent(base) && /does not contain a TAPAAL selection/.test(s.error),
        'Keyboard paste refuses unrelated text',
        s.error,
      );
      await menu('Paste');
      s = await state();
      expect(
        persistent(s) === persistent(base) && /does not contain a TAPAAL selection/.test(s.error),
        'Menu paste refuses unrelated text',
        s.error,
      );
    },
  );

  await check('C10', 'Malformed and hostile timed envelopes change nothing', async (expect) => {
    if (!ENVELOPE) throw new Error('C01 envelope missing');
    await openFile(CLASH);
    const base = await state();
    const env = () => JSON.parse(ENVELOPE);
    const mut = (fn) => {
      const e = env();
      fn(e);
      return JSON.stringify(e);
    };
    const cases = {
      'unknown timing key': mut((e) => (e.timing.extra = {})),
      'unknown interval key': mut((e) => (e.timing.intervals.i.note = 1)),
      'missing ages': mut((e) => delete e.timing.ages),
      'transport with unknown key': mut((e) => (e.timing.transports[0].weight = 2)),
      'half of transport removed from arcs': mut(
        (e) => (e.arcs = e.arcs.filter((a) => a.id !== 'o')),
      ),
      'transport weight mismatch': mut((e) => (e.arcs.find((a) => a.id === 'o').weight = 1)),
      'interval on output arc': mut((e) => (e.timing.intervals.o = e.timing.intervals.i)),
      'explicit zero age': mut((e) => (e.timing.ages.z = ['0'])),
      'age beyond invariant': mut((e) => (e.timing.ages.p = ['0.1', '3.5'])),
      'more ages than tokens': mut((e) => (e.timing.ages.p = ['1', '1', '1'])),
      'urgent with restricted input': mut((e) => e.timing.urgent.push('u')),
      'non-empty native projection': mut((e) => (e.native = '{"places":[]}')),
      'modelType untimed': mut((e) => (e.modelType = 'untimed')),
      'version 3': mut((e) => (e.version = 3)),
      'version 1 with timing': mut((e) => (e.version = 1)),
      'timing on version 2 missing': mut((e) => delete e.timing),
      '__proto__ in timing': ENVELOPE.replace(
        '"timing":{',
        '"timing":{"__proto__":{"polluted":1},',
      ),
      '__proto__ in ages': ENVELOPE.replace('"ages":{', '"ages":{"__proto__":["1"],'),
      '__proto__ in envelope': ENVELOPE.replace(
        '{"format"',
        '{"__proto__":{"polluted":1},"format"',
      ),
      'constructor key in invariants': ENVELOPE.replace(
        '"invariants":{',
        '"invariants":{"constructor":{"upper":"1","upperClosed":true},',
      ),
      'oversized text': ENVELOPE.replace(
        '"native":""',
        `"native":"","pad":"${'x'.repeat(4_000_001)}"`,
      ),
      'truncated JSON': ENVELOPE.slice(0, ENVELOPE.length - 5),
    };
    for (const [label, text] of Object.entries(cases)) {
      await setClip(text);
      await key('Control+v');
      const s = await state();
      expect(
        persistent(s) === persistent(base) && s.past === 0 && s.error && !s.polluted,
        `${label}: refused, nothing changed, no prototype pollution`,
        { error: s.error.slice(0, 160), polluted: s.polluted },
      );
    }
    // A node literally identified as __proto__ is ordinary data: either refused or remapped.
    const protoId = env();
    protoId.nodes.find((n) => n.id === 'p').id = '__proto__';
    for (const a of protoId.arcs) if (a.source === 'p') a.source = '__proto__';
    protoId.timing.ages = { __proto__: ['0.1', '2.50'], r: ['1.5'] };
    protoId.timing.invariants = {
      __proto__: { upper: '3', upperClosed: true },
      s: protoId.timing.invariants.s,
    };
    const text = JSON.stringify(protoId).replace('"ages":{', '"ages":{"__proto__":["0.1","2.50"],');
    await setClip(
      text.replace('"invariants":{', '"invariants":{"__proto__":{"upper":"3","upperClosed":true},'),
    );
    await key('Control+v');
    const s = await state();
    expect(
      !s.polluted &&
        (s.past === 0 ||
          (pastedFragment(base, s) === RICH_EXPECTED && !allIds(s.net).includes('__proto__'))),
      '__proto__ node ID is remapped faithfully or refused; no pollution',
      { error: s.error, past: s.past, pasted: pastedFragment(base, s), expected: RICH_EXPECTED },
    );
  });

  await check('C11', 'Text focus and open dialogs keep their own clipboard', async (expect) => {
    await openFile(RICH);
    await key('Control+a');
    await key('Control+c');
    const base = await state();
    await clickNode('q', { clickCount: 2 });
    await page.locator('app-element-dialog form').waitFor();
    const name = page.locator('app-element-dialog #dialog-name');
    await name.focus();
    await key('Control+a');
    await key('Control+c');
    await key('Control+v');
    await key('Control+x');
    await key('Control+d');
    const s = await state();
    expect(
      persistent(s) === persistent(base) && s.past === 0 && (await clip()) === 'Q',
      'Dialog text field uses the browser text clipboard',
      { clip: await clip(), error: s.error },
    );
  });

  await check(
    'C12',
    'Async races: selection, tab and edit changes during slow clipboard I/O',
    async (expect) => {
      await openFile(RICH);
      await openFile(CLASH);
      await tab('Rich timed');
      // Menu cut U, then click node S while the system write is pending.
      const base = await state();
      await select(['u']);
      await menu('Cut');
      await clickNode('s');
      await page.waitForTimeout(1200);
      let s = await state();
      const kept = (id) => s.net.nodes.some((n) => n.id === id);
      const copied = JSON.parse(await clip());
      expect(
        copied.nodes.map((n) => n.id).join() === 'u' &&
          (kept('s') || s.past === 0) &&
          (!kept('u') || s.past === 0),
        'Cut deletes exactly what it copied, or cancels',
        {
          copied: copied.nodes.map((n) => n.id),
          deletedU: !kept('u'),
          deletedS: !kept('s'),
          past: s.past,
          notice: s.notice,
        },
      );
      if (s.past) await key('Control+z');
      // Menu paste, then switch tab while reading.
      await key('Control+a');
      await key('Control+c');
      const before = await state();
      await menu('Paste');
      await tab('Clash timed');
      await page.waitForTimeout(1200);
      s = await state();
      expect(
        JSON.stringify(s.docs) === JSON.stringify(before.docs) &&
          /Clipboard action cancelled/.test(s.notice),
        'Paste cancelled after tab switch; neither document changed',
        s.notice,
      );
      // Menu paste, then edit (keyboard delete) while reading.
      await tab('Rich timed');
      await select(['u']);
      await menu('Paste');
      await key('Delete');
      await page.waitForTimeout(1200);
      s = await state();
      expect(
        s.past === before.past + 1 &&
          !s.net.nodes.some((n) => n.id === 'u') &&
          /Clipboard action cancelled/.test(s.notice),
        'Paste cancelled after an intervening edit; only the edit committed',
        { past: s.past, notice: s.notice },
      );
      expect(base.past === 0, 'Base untouched before races');
    },
    {
      init: () => {
        const c = navigator.clipboard;
        const slow =
          (fn) =>
          (...args) =>
            new Promise((r) => setTimeout(r, 700)).then(() => fn.apply(c, args));
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            read: slow(c.read),
            readText: slow(c.readText),
            write: slow(c.write),
            writeText: c.writeText.bind(c),
          },
        });
      },
    },
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
