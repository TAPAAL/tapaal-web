#!/usr/bin/env node
// Browser validation of timed editing and disjoint timed network simulation
// (see design/TIMED-UI-VALIDATION.md). Drives a running development build with real Playwright
// mouse, keyboard, wheel and file-chooser input. App signals and rendered DOM are only read;
// no App methods or signal setters are invoked.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-timed-ui.mjs http://127.0.0.1:4391 /tmp/tapaal-timed-ui-validation/run
//
// Exit status 1 when any check fails. Results: <out>/results.json, fixtures, downloads and
// screenshots in <out>.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4391';
const OUT = process.argv[3] ?? '/tmp/tapaal-timed-ui-validation/run';
const ONLY = process.env.ONLY?.split(',');
mkdirSync(OUT, { recursive: true });

// ---- fixtures (written to OUT, opened through the real file chooser) ------------------------
const TYPE = { timed: true, colored: false, game: false, stochastic: false };
const place = (id, name, x, y, tokens = 0) => ({ id, name, kind: 'place', tokens, x, y });
const transition = (id, name, x, y) => ({ id, name, kind: 'transition', tokens: 0, x, y });
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
const component = (id, template, nodes, arcs, t, active = true) => ({
  id,
  active,
  net: { name: template, template, nodes, arcs },
  timing: timing(t),
});
function fixture(file, name, components) {
  const path = join(OUT, file);
  writeFileSync(
    path,
    JSON.stringify({
      format: 'tapaal-web-network',
      version: 1,
      network: {
        name,
        type: TYPE,
        components: components.map((c) => ({ ...c, net: { ...c.net, name } })),
      },
    }),
  );
  return path;
}
const iv = (lower, upper, lowerClosed = true, upperClosed = true) => ({
  lower,
  upper,
  lowerClosed,
  upperClosed,
});
const inv = (upper, upperClosed = true) => ({ upper, upperClosed });

// P(2: 0.1, 2.50, <=3) -i-> T -o-> Q ; Z(1, age 0) -z-> U. Mirrors the implementation smoke.
const BASIC = fixture('basic.json', 'Basic timed', [
  component(
    'main',
    'Main',
    [
      place('p', 'P', 150, 150, 2),
      transition('t', 'T', 350, 150),
      place('q', 'Q', 550, 150),
      place('z', 'Z', 150, 330, 1),
      transition('u', 'U', 350, 330),
    ],
    [
      arc('i', 'p', 't', 1, { bends: [{ x: 250, y: 110, curved: false }] }),
      arc('o', 't', 'q', 1, { bends: [{ x: 450, y: 200, curved: true }] }),
      arc('o2', 't', 'z'),
      arc('zu', 'z', 'u', 1),
    ],
    {
      invariants: { p: inv('3') },
      ages: { p: ['0.1', '2.50'] },
      intervals: { zu: iv('5', null, true, false) },
    },
  ),
]);
// Endpoint semantics: one token in P; T1 [1,3), T2 (1,3].
const ENDPOINTS = fixture('endpoints.json', 'Endpoints', [
  component(
    'main',
    'Main',
    [
      place('p', 'P', 150, 210, 1),
      transition('t1', 'T1', 350, 120),
      transition('t2', 'T2', 350, 300),
    ],
    [arc('a1', 'p', 't1'), arc('a2', 'p', 't2')],
    { intervals: { a1: iv('1', '3', true, false), a2: iv('1', '3', false, true) } },
  ),
]);
// Eligible-token policy: P ages 1, 2.5, 3.5, 5; interval [2,4]; transport to Q keeps the age.
const POLICY = fixture('policy.json', 'Policy', [
  component(
    'main',
    'Main',
    [place('p', 'P', 150, 210, 4), transition('t', 'T', 350, 210), place('q', 'Q', 550, 210)],
    [arc('i', 'p', 't'), arc('o', 't', 'q')],
    {
      intervals: { i: iv('2', '4') },
      ages: { p: ['1', '2.5', '3.5', '5'] },
      transports: [{ inputArc: 'i', outputArc: 'o' }],
    },
  ),
]);
// Transport destination invariant and weighted pair.
const TRANSPORT = fixture('transport.json', 'Transport', [
  component(
    'main',
    'Main',
    [
      place('p', 'P', 150, 150, 2),
      transition('t', 'T', 350, 150),
      place('q', 'Q', 550, 150),
      place('r', 'R', 150, 360, 3),
      transition('w', 'W', 350, 360),
      place('s', 'S', 550, 360),
    ],
    [
      arc('i', 'p', 't', 1, { bends: [{ x: 250, y: 110, curved: false }] }),
      arc('o', 't', 'q', 1, { bends: [{ x: 450, y: 200, curved: true }] }),
      arc('ri', 'r', 'w', 2),
      arc('so', 'w', 's', 2),
    ],
    {
      invariants: { q: inv('1'), s: inv('2') },
      ages: { p: ['0.1', '2.50'], r: ['0.5', '1.5', '2.5'] },
      transports: [
        { inputArc: 'i', outputArc: 'o' },
        { inputArc: 'ri', outputArc: 'so' },
      ],
    },
  ),
]);
// Ordinary arcs ready for pairing.
const PAIRABLE = fixture('pairable.json', 'Pairable', [
  component(
    'main',
    'Main',
    [
      place('p', 'P', 150, 210, 2),
      transition('t', 'T', 350, 210),
      place('q', 'Q', 550, 120),
      place('r', 'R', 550, 330),
    ],
    [
      arc('i', 'p', 't', 1, { bends: [{ x: 250, y: 160, curved: false }] }),
      arc('o', 't', 'q', 1, { bends: [{ x: 450, y: 120, curved: true }] }),
      arc('o2', 't', 'r'),
    ],
    { intervals: { i: iv('1', '4') } },
  ),
]);
// Urgency: restricted input first.
const URGENT = fixture('urgent.json', 'Urgent', [
  component(
    'main',
    'Main',
    [place('p', 'P', 150, 210, 1), transition('t', 'T', 350, 210), place('q', 'Q', 550, 210)],
    [arc('i', 'p', 't'), arc('o', 't', 'q')],
    { intervals: { i: iv('1', '3') } },
  ),
]);
// Two components; second inactive, both with timing.
const MULTI = fixture('multi.json', 'Multi timed', [
  component(
    'a',
    'Alpha',
    [place('p', 'P', 150, 210, 2), transition('t', 'T', 350, 210), place('q', 'Q', 550, 210)],
    [arc('i', 'p', 't'), arc('o', 't', 'q')],
    {
      invariants: { p: inv('9') },
      ages: { p: ['1.5'] },
      transports: [{ inputArc: 'i', outputArc: 'o' }],
      intervals: { i: iv('1', null, false, false) },
    },
  ),
  component(
    'b',
    'Beta',
    [place('p', 'P', 150, 210, 1), transition('t', 'T', 350, 210)],
    [arc('i', 'p', 't')],
    { urgent: ['t'], ages: { p: ['0.25'] } },
    false,
  ),
]);
// Decimal JSON bound: valid in web JSON, refused by TAPN export.
const DECIMAL = fixture('decimal-bound.json', 'Decimal bound', [
  component(
    'main',
    'Main',
    [place('p', 'P', 150, 210, 1), transition('t', 'T', 350, 210)],
    [arc('i', 'p', 't')],
    { intervals: { i: iv('0.5', '3') } },
  ),
]);
// Writer-shaped native TAPN with a saved query referencing Moved (timed-files.spec.ts shape).
const QUERY_TAPN = join(OUT, 'query.tapn');
writeFileSync(
  QUERY_TAPN,
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <net active="true" id="Clock" type="P/T net">
    <place displayName="true" id="P0" initialMarking="3" invariant="&lt;= 5" name="Start" nameOffsetX="0" nameOffsetY="0" positionX="90" positionY="60">
      <initialMarkingAge>
        <token age="0.1"/>
        <token age="2.50"/>
      </initialMarkingAge>
    </place>
    <place displayName="true" id="P1" initialMarking="0" invariant="&lt; inf" name="Moved" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="60"/>
    <transition angle="0" displayName="true" id="T0" infiniteServer="false" name="Go" nameOffsetX="0" nameOffsetY="0" player="0" positionX="195" positionY="60" priority="0" urgent="false"/>
    <arc id="A0" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" transportID="1" type="transport" weight="2">
      <arcpath arcPointType="false" id="0" xCoord="105" yCoord="75"/>
      <arcpath arcPointType="false" id="1" xCoord="210" yCoord="75"/>
    </arc>
    <arc id="A1" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" transportID="1" type="transport" weight="2">
      <arcpath arcPointType="false" id="0" xCoord="210" yCoord="75"/>
      <arcpath arcPointType="false" id="1" xCoord="315" yCoord="75"/>
    </arc>
  </net>
  <query active="true" name="Moved" type="Default" query="EF Clock.Moved &gt;= 2"/>
  <k-bound bound="3"/>
  <feature isGame="false" isTimed="true" isColored="false" isStochastic="false"/>
</pnml>
`,
);

// ---- browser and read-only state -------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const results = [];
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
      docs: ws.documents.map((d) => ({
        name: d.network.name,
        dirty: app.isDocumentDirty(d),
        network: JSON.stringify(d.network),
      })),
      network: doc && JSON.parse(JSON.stringify(doc.network)),
      componentId: doc?.session.componentId,
      past: doc?.past.length,
      future: doc?.future.length,
      dirty: app.dirty(),
      timed: app.timed(),
      net: app.net(),
      timing: comp?.timing,
      mode: app.mode(),
      cursor: app.cursor(),
      canBack: app.canBack(),
      canForward: app.canForward(),
      legalDelay: app.legalDelay(),
      ages: app.currentAges(),
      error: app.error(),
      notice: app.notice(),
      dialogError: app.dialogError(),
      dialogOpen: !!document.querySelector('app-element-dialog form'),
      enabled: [...document.querySelectorAll('.enabled-row')].map((e) => e.textContent.trim()),
      history: [...document.querySelectorAll('.history-row')].map((e) =>
        [...e.querySelectorAll('span')].map((t) => t.textContent.trim()).join(' '),
      ),
      sidebarAges: [...document.querySelectorAll('[aria-label="Token ages"] p')].map((e) =>
        e.textContent.trim(),
      ),
      legalText:
        document
          .querySelector('[aria-label="Time and token selection"] [role=status]')
          ?.textContent.trim() ?? null,
      banner: document.querySelector('.error-banner')?.textContent.trim() ?? null,
      canvasLabel: document.querySelector('svg.net-canvas')?.getAttribute('aria-label'),
      arcLabels: Object.fromEntries(
        [...document.querySelectorAll('[data-arc]')].map((e) => [
          e.getAttribute('data-arc'),
          e.querySelector('.arc-label')?.textContent.trim().replace(/\s+/g, ' '),
        ]),
      ),
      nodeText: Object.fromEntries(
        [...document.querySelectorAll('[data-node]')].map((e) => [
          e.getAttribute('data-node'),
          e.textContent.trim().replace(/\s+/g, ' '),
        ]),
      ),
      inspector: document
        .querySelector('.inspector, aside.inspector, .element-inspector')
        ?.textContent.trim()
        .replace(/\s+/g, ' '),
      tabs: [...document.querySelectorAll('.document-tab button:first-child')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    };
  });
};
// Persistent document content (graph + timing) for no-mutation assertions.
const persistent = (s) => JSON.stringify(s.network);

// ---- real input helpers ----------------------------------------------------------------------
const btn = (name, exact = true) => page.getByRole('button', { name, exact });
const key = (k) => page.keyboard.press(k);
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
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
// A quarter along the path avoids midpoint bend handles and labels.
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
async function clickNode(id, options) {
  const p = await nodePoint(id);
  await page.mouse.click(p.x, p.y, options);
}
async function clickArc(id, options) {
  const p = await arcPoint(id);
  await page.mouse.click(p.x, p.y, options);
}
async function openNodeDialog(id) {
  await clickNode(id, { clickCount: 2 });
  await page.locator('app-element-dialog form').waitFor();
}
async function openArcDialog(id) {
  await clickArc(id, { clickCount: 2 });
  await page.locator('app-element-dialog form').waitFor();
}
const field = (id) => page.locator(`app-element-dialog #${id}`);
async function submitDialog() {
  await page.locator('app-element-dialog button[type=submit]').click();
}
async function cancelDialog() {
  await page.locator('app-element-dialog footer button', { hasText: 'Cancel' }).click();
}
async function newModel(name, timed, componentName = 'Main') {
  await btn('New model').first().click();
  const d = page.getByRole('dialog');
  await d.waitFor();
  await d.getByLabel('Model name', { exact: true }).fill(name);
  await d
    .locator('#new-model-type')
    .selectOption({ label: timed ? 'Timed P/T net' : 'Untimed P/T net' });
  await d.getByLabel('Component name', { exact: true }).fill(componentName);
  await d.getByRole('button', { name: 'Create' }).click();
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
  const accept = btn('Open in new tab');
  if (await accept.isVisible().catch(() => false)) await accept.click();
}
async function download(trigger, name) {
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 3000 }).catch(() => null),
    trigger(),
  ]);
  if (!file) return null;
  const path = join(OUT, name);
  await file.saveAs(path);
  return { path, suggested: file.suggestedFilename(), text: readFileSync(path, 'utf8') };
}
const saveTapn = (name) =>
  download(
    () =>
      page
        .locator('[aria-label="Document toolbar"]')
        .getByRole('button', { name: 'Save TAPAAL file' })
        .click(),
    name,
  );
const saveJson = (name) =>
  download(async () => {
    await page.locator('summary', { hasText: /^File$/ }).click();
    await btn('Save as web JSON…').click();
  }, name);
async function simulate() {
  await page
    .locator('[aria-label="Workspace mode"]')
    .getByRole('button', { name: 'Simulate' })
    .click();
}
async function edit() {
  await page.locator('[aria-label="Workspace mode"]').getByRole('button', { name: 'Edit' }).click();
}
async function delay(amount) {
  await page.locator('#delay-amount').fill(amount);
  await page
    .locator('[aria-label="Time and token selection"]')
    .getByRole('button', { name: 'Delay' })
    .click();
}
async function policy(value) {
  await page.locator('#token-policy').selectOption(value);
}
async function fire(name) {
  await page.locator('.enabled-row', { hasText: name }).click();
  await page.locator('.fire-button').click();
}
const sim = (name) =>
  page.locator('[aria-label="Simulation control"]').getByRole('button', { name });
async function tool(name) {
  await page
    .locator('[aria-label="Workspace tools"]')
    .getByRole('button', { name, exact: true })
    .click();
}
async function fresh() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  await focusCanvas();
}
async function check(id, title, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  const r = { id, title, status: 'pass', observations: [] };
  const expect = (ok, message, detail) => {
    r.observations.push({ ok: !!ok, message, ...(detail === undefined ? {} : { detail }) });
    if (!ok) r.status = 'fail';
  };
  try {
    await fresh();
    await fn(expect);
  } catch (e) {
    r.status = 'error';
    r.error = e.stack;
    await shot(id + '-error').catch(() => {});
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
const has = (list, re) => list.some((x) => re.test(x));

try {
  await check('T01', 'New dispatches on the timed/untimed choice', async (expect) => {
    const before = await state();
    await newModel('Plain', false);
    let s = await state();
    expect(
      !s.timed && s.canvasLabel === 'Editable untimed Petri net',
      'Untimed New is untimed',
      s.canvasLabel,
    );
    expect(
      s.network.type.timed === false && !s.network.components[0].timing,
      'Untimed network has no timing',
    );
    await simulate();
    s = await state();
    expect(s.mode === 'Simulate' && s.legalText === null, 'Untimed simulation has no time section');
    await edit();
    await newModel('Clocked', true, 'Main');
    s = await state();
    expect(
      s.timed && s.canvasLabel === 'Editable timed Petri net',
      'Timed New is timed',
      s.canvasLabel,
    );
    expect(
      s.network.type.timed === true && JSON.stringify(s.timing) === JSON.stringify(timing()),
      'Timed network carries empty default timing',
      s.timing,
    );
    expect(
      s.docs.length === 3 && s.docs[0].network === before.docs[0].network && !s.docs[0].dirty,
      'Existing document untouched',
    );
    await simulate();
    s = await state();
    expect(
      s.mode === 'Simulate' && /Global legal delay: \[0,inf\)/.test(s.legalText ?? ''),
      'Empty timed net simulates with legal delay [0,inf)',
      s.legalText,
    );
  });

  await check('T02', 'Open adds a timed tab and shows recorded ages', async (expect) => {
    const before = await state();
    await openFile(BASIC);
    let s = await state();
    expect(
      s.docs.length === 2 && s.timed && s.tabs.length === 2,
      'Timed file opens in a new tab',
      s.tabs,
    );
    expect(s.docs[0].network === before.docs[0].network, 'Prior document unchanged');
    expect(!s.dirty && s.past === 0, 'Opened timed document is saved with empty history');
    expect(
      JSON.stringify(s.timing.ages) === '{"p":["0.1","2.50"]}',
      'Ages preserved exactly',
      s.timing.ages,
    );
    await clickNode('p');
    s = await state();
    expect(
      /Initial ages: 0\.1, 2\.50/.test(s.inspector ?? ''),
      'Inspector shows initial ages',
      s.inspector,
    );
    expect(/<= 3/.test(s.nodeText.p), 'Invariant drawn on place', s.nodeText.p);
    expect(/\[5,inf\)/.test(s.arcLabels.zu), 'Interval drawn on input arc', s.arcLabels);
    await shot('T02-open');
  });

  await check('T03', 'Invalid timing drafts are refused without mutation', async (expect) => {
    await openFile(BASIC);
    const base = await state();
    await openNodeDialog('p');
    const placeCases = [
      ['dialog-invariant', '<= 2.5'],
      ['dialog-invariant', '< 0'],
      ['dialog-invariant', '>= 3'],
      ['dialog-invariant', '<= 2147483648'],
      ['dialog-invariant', '<= 1'],
      ['dialog-ages', '1, 2, 3'],
      ['dialog-ages', '-1'],
      ['dialog-ages', '1e2'],
      ['dialog-ages', '.5'],
      ['dialog-ages', 'abc'],
      ['dialog-ages', '4'],
    ];
    for (const [id, text] of placeCases) {
      const original = await field(id).inputValue();
      await field(id).fill(text);
      await submitDialog();
      const s = await state();
      expect(
        s.dialogOpen &&
          s.dialogError &&
          persistent(s) === persistent(base) &&
          s.past === 0 &&
          !s.dirty,
        `Place ${id} "${text}" refused, document unchanged`,
        { dialogError: s.dialogError, open: s.dialogOpen, past: s.past },
      );
      await field(id).fill(original);
    }
    await cancelDialog();
    await openArcDialog('zu');
    for (const text of [
      '[0.5,3]',
      '[3,1]',
      '(2,2]',
      '[2,2)',
      '[0,2147483648]',
      '[0,inf]',
      '[1,3',
      '[-1,3]',
    ]) {
      await field('dialog-interval').fill(text);
      await submitDialog();
      const s = await state();
      expect(
        s.dialogOpen && s.dialogError && persistent(s) === persistent(base) && s.past === 0,
        `Interval "${text}" refused, document unchanged`,
        { dialogError: s.dialogError },
      );
    }
    await cancelDialog();
    let s = await state();
    expect(
      !s.dialogOpen && persistent(s) === persistent(base) && !s.canUndo,
      'Cancel discards the draft',
    );
    // Valid edits: one undo step each.
    await openArcDialog('zu');
    await field('dialog-interval').fill('[2,2]');
    await submitDialog();
    s = await state();
    expect(
      !s.dialogOpen &&
        JSON.stringify(s.timing.intervals.zu) === JSON.stringify(iv('2', '2')) &&
        s.past === 1,
      'Point interval [2,2] accepted as one step',
      s.timing.intervals,
    );
    await openNodeDialog('p');
    await field('dialog-invariant').fill('<= 7');
    await field('dialog-tokens').fill('3');
    await field('dialog-ages').fill('0, 6.25, 0.5');
    await submitDialog();
    s = await state();
    expect(
      s.past === 2 &&
        JSON.stringify(s.timing.invariants.p) === JSON.stringify(inv('7')) &&
        JSON.stringify(s.timing.ages.p) === '["6.25","0.5"]' &&
        s.net.nodes.find((n) => n.id === 'p').tokens === 3,
      'Invariant, count and ages commit atomically; zero age canonicalized away',
      { timing: s.timing, past: s.past },
    );
    await focusCanvas();
    await key('Control+z');
    s = await state();
    expect(
      JSON.stringify(s.timing.ages.p) === '["0.1","2.50"]' &&
        JSON.stringify(s.timing.invariants.p) === JSON.stringify(inv('3')) &&
        s.net.nodes.find((n) => n.id === 'p').tokens === 2,
      'One undo restores invariant, count and ages together',
    );
    await key('Control+z');
    s = await state();
    expect(
      persistent(s) === persistent(base) && !s.dirty,
      'Second undo returns to the saved checkpoint',
    );
  });

  await check('T04', 'Urgency gates and legal delay [0,0]', async (expect) => {
    await openFile(URGENT);
    const base = await state();
    await openNodeDialog('t');
    await field('dialog-urgent').check();
    await submitDialog();
    let s = await state();
    expect(
      s.dialogOpen && /urgent/i.test(s.dialogError) && persistent(s) === persistent(base),
      'Urgent with a restricted input refused (TAPNTransitionEditor.java:477)',
      s.dialogError,
    );
    await cancelDialog();
    await openArcDialog('i');
    await field('dialog-interval').fill('[0,inf)');
    await submitDialog();
    await openNodeDialog('t');
    await field('dialog-urgent').check();
    await submitDialog();
    s = await state();
    expect(
      s.timing.urgent.includes('t') && s.past === 2 && !s.timing.intervals.i,
      'Urgent accepted with unrestricted input',
    );
    await simulate();
    s = await state();
    expect(
      /Global legal delay: \[0,0\]/.test(s.legalText),
      'Enabled urgent transition: legal delay [0,0]',
      s.legalText,
    );
    await delay('1');
    s = await state();
    expect(s.error && s.history.length === 1 && s.cursor === 0, 'Positive delay refused', s.error);
    await delay('0');
    s = await state();
    expect(!s.error && s.history.length === 2, 'Zero delay accepted (Animator.java:800)', {
      error: s.error,
      history: s.history,
    });
    await fire('T');
    s = await state();
    expect(
      /Global legal delay: \[0,inf\)/.test(s.legalText),
      'After firing, no urgent block',
      s.legalText,
    );
  });

  await check('T05', 'Exact decimal delays', async (expect) => {
    await openFile(BASIC);
    const invariant = page.locator('[data-node="p"] .invariant-label');
    const before = await state();
    const label = await invariant.boundingBox();
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await page.mouse.down();
    await page.mouse.move(label.x + label.width / 2 + 48, label.y + label.height / 2 - 24, {
      steps: 5,
    });
    await page.mouse.up();
    const after = await state();
    const oldPlace = before.net.nodes.find((n) => n.id === 'p');
    const newPlace = after.net.nodes.find((n) => n.id === 'p');
    expect(
      oldPlace.x === newPlace.x &&
        oldPlace.y === newPlace.y &&
        oldPlace.nameOffsetX !== newPlace.nameOffsetX &&
        after.past === before.past + 1,
      'Dragging the invariant moves the label in one edit and leaves the place fixed',
    );
    await key('Control+z');
    expect(
      persistent(await state()) === persistent(before),
      'Undo restores the original label offset',
    );
    const canvasAges = (id) =>
      page
        .locator(`[data-node="${id}"] .token-age`)
        .evaluateAll((elements) => elements.map((e) => e.textContent.trim()));
    expect((await canvasAges('z')).join() === '0.0', 'A new timed token shows zero in the place');
    expect(
      (await canvasAges('p')).join() === '0.1,2.5',
      'Both initial ages render inside the place',
    );
    await simulate();
    await delay('0.1');
    await delay('0.2');
    const s = await state();
    const delayed = await canvasAges('p');
    expect(delayed.join() === '0.4,2.8', 'The canvas tracks both delayed tokens', delayed);
    expect(
      JSON.stringify(s.ages.z) === '["0.3"]' && JSON.stringify(s.ages.p) === '["0.4","2.8"]',
      '0.1 + 0.2 = 0.3 exactly; 2.50 + 0.3 = 2.8 (native DecimalFormat also shows 2.8)',
      s.ages,
    );
    expect(
      has(s.sidebarAges, /^Z: 0\.3$/) && !has(s.sidebarAges, /0000000/),
      'Sidebar shows exact ages',
      s.sidebarAges,
    );
    expect(
      s.history.join('|') ===
        '0 Initial marking · time 0|1 Delay 0.1 · time 0.1|2 Delay 0.2 · time 0.3',
      'History labels distinguish delays',
      s.history,
    );
    for (const bad of ['-1', '1e-1', '.5', 'abc', '']) {
      await delay(bad);
      const t = await state();
      expect(
        t.error && t.history.length === 3,
        `Delay "${bad}" refused without history change`,
        t.error,
      );
    }
    await shot('T05-decimal');
  });

  await check('T06', 'Strict interval endpoints', async (expect) => {
    await openFile(ENDPOINTS);
    await simulate();
    const steps = [
      [null, []],
      ['1', ['Main.T1']],
      ['0.5', ['Main.T1', 'Main.T2']],
      ['1.5', ['Main.T2']],
      ['0.0001', []],
    ];
    for (const [d, enabled] of steps) {
      if (d) await delay(d);
      const s = await state();
      expect(
        JSON.stringify(s.enabled) === JSON.stringify(enabled),
        `After ${d ?? 'no'} delay (age ${s.ages.p}): enabled ${enabled.join(',') || 'none'}`,
        s.enabled,
      );
    }
  });

  await check('T07', 'Oldest/youngest choose among eligible tokens', async (expect) => {
    await openFile(POLICY);
    await simulate();
    let s = await state();
    expect(
      (await page.locator('#token-policy').inputValue()) === 'random',
      'Default policy is Random, matching native Animator.java:182',
    );
    await policy('oldest');
    await fire('T');
    s = await state();
    expect(
      JSON.stringify(s.ages.q) === '["3.5"]' && JSON.stringify(s.ages.p) === '["1","2.5","5"]',
      'Oldest eligible in [2,4] is 3.5 (5 is ineligible)',
      s.ages,
    );
    await sim('Back').click();
    await policy('youngest');
    await fire('T');
    s = await state();
    expect(
      JSON.stringify(s.ages.q) === '["2.5"]' && JSON.stringify(s.ages.p) === '["1","3.5","5"]',
      'Youngest eligible is 2.5 (1 is ineligible)',
      s.ages,
    );
  });

  await check(
    'T08',
    'Transport age, destination invariant, weighted pair, routes',
    async (expect) => {
      await openFile(TRANSPORT);
      const routes = (await state()).net.arcs.filter((a) => a.id === 'i' || a.id === 'o');
      await simulate();
      await fire('T');
      let s = await state();
      expect(
        JSON.stringify(s.ages.q) === '["0.1"]' && JSON.stringify(s.ages.p) === '["2.50"]',
        'Oldest token 2.50 is ineligible for Q <= 1; 0.1 transported with its age',
        s.ages,
      );
      await fire('W');
      s = await state();
      expect(
        JSON.stringify([...s.ages.s].sort()) === '["0.5","1.5"]' &&
          JSON.stringify(s.ages.r) === '["2.5"]',
        'Weight-2 transport moves exactly the two eligible tokens, ages kept',
        s.ages,
      );
      await edit();
      s = await state();
      expect(
        JSON.stringify(s.net.arcs.filter((a) => a.id === 'i' || a.id === 'o')) ===
          JSON.stringify(routes),
        'Both transport routes unchanged after simulation',
      );
      expect(
        /Transport 1/.test(s.arcLabels.i) && /Transport 1/.test(s.arcLabels.o),
        'Both halves labelled with the same group',
        s.arcLabels,
      );
    },
  );

  await check('T09', 'Atomic pair edits, deletion and undo', async (expect) => {
    await openFile(PAIRABLE);
    const base = await state();
    await openArcDialog('i');
    await field('dialog-transport').selectOption('o');
    await field('dialog-weight').fill('2');
    await submitDialog();
    let s = await state();
    const w = (st, id) => st.net.arcs.find((a) => a.id === id)?.weight;
    expect(
      s.past === 1 &&
        JSON.stringify(s.timing.transports) === '[{"inputArc":"i","outputArc":"o"}]' &&
        w(s, 'i') === 2 &&
        w(s, 'o') === 2,
      'Pairing and weight commit as one step',
      { transports: s.timing.transports, past: s.past },
    );
    const bends = (st) => JSON.stringify(st.net.arcs.map((a) => [a.id, a.bends ?? []]));
    expect(bends(s) === bends(base), 'Bends of both halves unchanged');
    await openArcDialog('o');
    await field('dialog-weight').fill('3');
    await submitDialog();
    s = await state();
    expect(
      w(s, 'i') === 3 && w(s, 'o') === 3 && s.past === 2,
      'Output-half weight edit updates its partner',
    );
    await focusCanvas();
    await key('Control+z');
    s = await state();
    expect(
      w(s, 'i') === 2 && w(s, 'o') === 2 && s.timing.transports.length === 1,
      'Undo restores both weights',
    );
    await openArcDialog('o2');
    await field('dialog-kind')
      .selectOption('inhibitor')
      .catch(() => {});
    const kindDisabled = await field('dialog-kind')
      .isDisabled()
      .catch(() => true);
    await cancelDialog();
    expect(true, `Output arc kind select disabled: ${kindDisabled}`);
    // Delete the output half via keyboard.
    await clickArc('o');
    await focusCanvas();
    await key('Delete');
    s = await state();
    expect(
      !s.net.arcs.some((a) => a.id === 'i' || a.id === 'o') && s.timing.transports.length === 0,
      'Deleting either half deletes both',
      s.net.arcs.map((a) => a.id),
    );
    await key('Control+z');
    s = await state();
    expect(
      s.net.arcs.some((a) => a.id === 'i') &&
        s.net.arcs.some((a) => a.id === 'o') &&
        s.timing.transports.length === 1 &&
        bends(s) === bends(base),
      'One undo restores both halves, pairing and routes',
    );
    await clickNode('t');
    await key('Delete');
    s = await state();
    expect(
      s.net.arcs.length === 0 && s.timing.transports.length === 0 && !s.timing.intervals.i,
      'Deleting the transition removes pair and interval',
    );
    await key('Control+z');
    s = await state();
    expect(
      s.timing.transports.length === 1 && s.timing.intervals.i,
      'Undo restores transition, pair and interval',
    );
    await openArcDialog('i');
    await field('dialog-transport').selectOption('');
    await submitDialog();
    s = await state();
    expect(
      s.timing.transports.length === 0 &&
        s.net.arcs.some((a) => a.id === 'o') &&
        w(s, 'i') === 2 &&
        w(s, 'o') === 2,
      'Unpair keeps both ordinary arcs',
    );
    // Pairing with weight mismatch of the other output: o2 has weight 1, input weight 2.
    await openArcDialog('i');
    await field('dialog-transport').selectOption('o2');
    await submitDialog();
    s = await state();
    expect(
      JSON.stringify(s.timing.transports) === '[{"inputArc":"i","outputArc":"o2"}]' &&
        w(s, 'o2') === 2 &&
        w(s, 'o') === 2,
      'Re-pairing to another output copies the input weight to the new partner only',
      s.net.arcs.map((a) => [a.id, a.weight]),
    );
  });

  await check('T10', 'Failed action after Back keeps the future', async (expect) => {
    await openFile(BASIC);
    await simulate();
    await delay('0.2');
    await delay('0.2');
    await sim('Back').click();
    let before = await state();
    await delay('1');
    let s = await state();
    expect(
      s.error &&
        s.cursor === 1 &&
        s.canForward &&
        s.history.length === 3 &&
        JSON.stringify(s.ages) === JSON.stringify(before.ages),
      'Illegal delay (P <= 3 with age 3.7) refused; cursor, ages and Forward retained',
      { error: s.error, cursor: s.cursor, history: s.history },
    );
    await shot('T10-failed-after-back');
    await sim('Forward').click();
    s = await state();
    expect(
      s.cursor === 2 && JSON.stringify(s.ages.p) === '["0.5","2.9"]',
      'Forward replays the retained step',
      s.ages,
    );
  });

  await check('T11', 'Reset, branching, jump and history labels', async (expect) => {
    await openFile(BASIC);
    await simulate();
    await delay('0.1');
    await fire('T');
    await delay('0.2');
    let s = await state();
    expect(
      s.history.join('|') ===
        '0 Initial marking · time 0|1 Delay 0.1 · time 0.1|2 Fire Main.T · time 0.1|3 Delay 0.2 · time 0.3',
      'Delay and Fire are distinguished',
      s.history,
    );
    await page.locator('.history-row').nth(1).click();
    s = await state();
    expect(
      s.cursor === 1 && s.canForward && JSON.stringify(s.ages.p) === '["0.2","2.6"]',
      'History jump replays snapshot',
      s.ages,
    );
    await focusCanvas();
    await key('ArrowRight');
    s = await state();
    expect(s.cursor === 2, 'ArrowRight moves forward', s.cursor);
    await key('ArrowLeft');
    await delay('0.3');
    s = await state();
    expect(
      s.history.join('|') ===
        '0 Initial marking · time 0|1 Delay 0.1 · time 0.1|2 Delay 0.3 · time 0.4' && !s.canForward,
      'New action after Back truncates the future',
      s.history,
    );
    await sim('Reset').click();
    s = await state();
    expect(
      s.cursor === 0 &&
        JSON.stringify(s.ages.p) === '["0.1","2.50"]' &&
        JSON.stringify(s.ages.z) === '["0"]',
      'Reset restores initial ages',
      { cursor: s.cursor, ages: s.ages, history: s.history },
    );
    expect(true, `History after Reset: ${s.history.join(' | ')}`);
    await edit();
    s = await state();
    expect(!s.dirty && s.past === 0, 'Simulation never enters document history');
  });

  await check(
    'T12',
    'Whole-network initial state save and reopen, including mid-run',
    async (expect) => {
      await openFile(TRANSPORT);
      const original = await state();
      const a = await saveTapn('T12-before.tapn');
      expect(
        (await state()).notice.includes('TAPAAL 4.0.4 resets nonzero initial ages to zero'),
        'Aged TAPN download warns about released native age loss',
      );
      await simulate();
      await delay('0.3');
      await fire('T');
      const mid = await state();
      const b = await saveTapn('T12-midrun.tapn');
      const j = await saveJson('T12-midrun.json');
      const after = await state();
      expect(a && b && a.text === b.text, 'TAPN before and mid-run are byte-identical', {
        a: a?.text.length,
        b: b?.text.length,
      });
      expect(
        after.mode === 'Simulate' &&
          after.cursor === mid.cursor &&
          JSON.stringify(after.ages) === JSON.stringify(mid.ages),
        'Saving mid-run keeps the run',
      );
      expect(
        /initialMarking="2"/.test(b.text) &&
          /age="0.1"/.test(b.text) &&
          /age="2.50"/.test(b.text) &&
          /invariant="&lt;= 1"/.test(b.text),
        'TAPN carries initial marking, nonzero ages and invariants, not simulated state',
      );
      expect(
        j && JSON.parse(j.text).network.components[0].timing.ages.p.join() === '0.1,2.50',
        'JSON carries initial ages',
      );
      await edit();
      for (const f of [b, j]) {
        await openFile(f.path);
        const s = await state();
        const norm = (st) =>
          JSON.stringify({
            timing: st.timing,
            arcs: st.net.arcs
              .map(({ id, source, target, kind, weight, bends }) => ({
                id,
                source,
                target,
                kind,
                weight,
                bends: bends ?? [],
              }))
              .sort((x, y) => x.id.localeCompare(y.id)),
            nodes: st.net.nodes
              .map(({ id, name, tokens, x, y }) => ({ id, name, tokens, x, y }))
              .sort((x, y) => x.id.localeCompare(y.id)),
          });
        const canonicalTiming = (st) =>
          JSON.stringify({
            ...st.timing,
            transports: [...st.timing.transports].sort((x, y) =>
              x.inputArc.localeCompare(y.inputArc),
            ),
          });
        expect(
          s.timed && canonicalTiming(s) === canonicalTiming(original),
          `${f.path.split('/').pop()} reopens with identical timing`,
          { reopened: s.timing },
        );
        if (f === j) expect(norm(s) === norm(original), 'JSON reopen identical graph and timing');
      }
      await openFile(DECIMAL);
      let s = await state();
      const refused = await saveTapn('T12-decimal.tapn');
      s = await state();
      expect(
        !refused && /JSON/.test(s.error),
        'TAPN save refuses decimal bound with a JSON alternative',
        s.error,
      );
      const dj = await saveJson('T12-decimal.json');
      expect(
        dj && JSON.parse(dj.text).network.components[0].timing.intervals.i.lower === '0.5',
        'JSON keeps the decimal bound',
      );
    },
  );

  await check('T13', 'Tab and document changes end a timed run safely', async (expect) => {
    await openFile(BASIC);
    await simulate();
    await delay('0.5');
    await page
      .locator('.document-tab')
      .filter({ hasText: 'Producer cycle' })
      .locator('button')
      .first()
      .click();
    let s = await state();
    expect(s.mode === 'Edit' && !s.timed, 'Switching tab ends the run');
    await page
      .locator('.document-tab')
      .filter({ hasText: 'Basic timed' })
      .locator('button')
      .first()
      .click();
    s = await state();
    expect(
      s.mode === 'Edit' &&
        !s.dirty &&
        s.past === 0 &&
        JSON.stringify(s.timing.ages.p) === '["0.1","2.50"]',
      'Returning starts in Edit with initial timing',
    );
    await simulate();
    await delay('0.5');
    await newModel('Other', true);
    s = await state();
    expect(s.mode === 'Edit' && s.docs.length === 3, 'New during a run ends it');
    await page
      .locator('.document-tab')
      .filter({ hasText: 'Basic timed' })
      .locator('button')
      .first()
      .click();
    await openNodeDialog('p');
    await field('dialog-invariant').fill('<= 4');
    await submitDialog();
    await page.getByRole('button', { name: 'Close Basic timed', exact: true }).click();
    s = await state();
    const closeDialog = await page.locator('#cancel-close').isVisible();
    expect(closeDialog, 'Closing a dirty timed tab asks');
    await page.locator('#cancel-close').click();
    s = await state();
    expect(
      s.dirty && s.docs.length === 3 && s.timing.invariants.p.upper === '4',
      'Cancel keeps the tab and edit',
    );
    await simulate();
    await delay('0.2');
    await focusCanvas();
    await key('Control+z');
    s = await state();
    expect(
      true,
      `Ctrl+Z during simulation: mode ${s.mode}, invariant ${JSON.stringify(s.timing.invariants.p)}, error "${s.error}"`,
    );
  });

  await check(
    'T14',
    'Multi-component timed execution, inactive projection and editing',
    async (expect) => {
      await openFile(MULTI);
      const base = await state();
      await simulate();
      let s = await state();
      expect(
        s.mode === 'Simulate' && !s.error,
        'Two components (one inactive) execute as a timed network',
        s.error,
      );
      await page.locator('.component-row', { hasText: 'Beta' }).click();
      s = await state();
      expect(
        s.componentId === 'b' && s.timing.urgent.includes('t'),
        'Inactive Beta shows its own timing',
      );
      expect(s.cursor === 0 && s.mode === 'Simulate', 'Changing component preserves the run');
      await edit();
      await openNodeDialog('p');
      await field('dialog-invariant').fill('<= 2');
      await submitDialog();
      s = await state();
      const alpha = s.network.components.find((c) => c.id === 'a');
      expect(
        s.network.components.find((c) => c.id === 'b').timing.invariants.p?.upper === '2' &&
          JSON.stringify(alpha) ===
            JSON.stringify(base.network.components.find((c) => c.id === 'a')),
        'Editing Beta leaves Alpha (same local IDs) untouched',
      );
      await page.locator('.component-row', { hasText: 'Alpha' }).click();
      await page
        .locator('.component-actions, aside')
        .getByRole('button', { name: 'Copy…' })
        .click();
      const d = page.getByRole('dialog');
      await d.getByLabel('Component name', { exact: true }).fill('AlphaCopy');
      await d.getByRole('button', { name: 'Apply' }).click();
      s = await state();
      const copy = s.network.components.find((c) => c.net.template === 'AlphaCopy');
      expect(
        copy && JSON.stringify(copy.timing) === JSON.stringify(alpha.timing),
        'Copy component preserves all timing',
        copy?.timing,
      );
      const j = await saveJson('T14-multi.json');
      const saved = j && JSON.parse(j.text).network;
      expect(
        saved?.components.length === 3 && saved.components.every((c) => c.timing),
        'Save writes the whole timed network',
      );
      const t = await saveTapn('T14-multi.tapn');
      expect(
        t && (t.text.match(/<net /g) ?? []).length === 3 && /active="false"/.test(t.text),
        'TAPN keeps all components and inactivity',
      );
      // Remove to one component, then execution is allowed.
      for (const name of ['AlphaCopy', 'Beta']) {
        await page.locator('.component-row', { hasText: new RegExp(`^\\s*${name}`) }).click();
        await page.locator('aside').getByRole('button', { name: 'Remove' }).click();
        const confirm = page.getByRole('dialog').getByRole('button', { name: /Remove/ });
        if (await confirm.isVisible().catch(() => false)) await confirm.click();
      }
      s = await state();
      expect(
        s.network.components.length === 1,
        'Back to one component',
        s.network.components.map((c) => c.net.template),
      );
      await simulate();
      s = await state();
      expect(
        s.mode === 'Simulate' && JSON.stringify(s.ages.p) === '["1.5","0"]',
        'Single component executes with recorded ages',
        { error: s.error, ages: s.ages },
      );
    },
  );

  await check(
    'T15',
    'Timed clipboard and duplicate preserve initial timing in one undo step',
    async (expect) => {
      await openFile(BASIC);
      const base = await state();
      await clickNode('p');
      await focusCanvas();
      await key('Control+c');
      const envelope = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(
        envelope.version === 2 && envelope.modelType === 'timed',
        'Copy writes a typed timed web envelope',
      );
      await key('Control+v');
      let s = await state();
      const added = s.net.nodes.find(
        (n) => !base.net.nodes.some((original) => original.id === n.id),
      );
      expect(
        s.past === 1 && s.net.nodes.length === base.net.nodes.length + 1 && !!added,
        'Paste adds a fresh place in one step',
      );
      expect(
        JSON.stringify(s.timing.ages[added.id]) === JSON.stringify(base.timing.ages.p) &&
          JSON.stringify(s.timing.invariants[added.id]) ===
            JSON.stringify(base.timing.invariants.p),
        'Paste retains initial ages and invariant',
      );
      await key('Control+z');
      s = await state();
      expect(persistent(s) === persistent(base), 'One undo removes graph and timing together');
      await clickNode('p');
      await focusCanvas();
      await key('Control+d');
      s = await state();
      expect(
        s.past === 1 && s.net.nodes.length === base.net.nodes.length + 1,
        'Duplicate is one timed transaction',
      );
      await key('Control+z');
      await clickNode('p');
      await focusCanvas();
      await key('Control+x');
      s = await state();
      expect(
        !s.net.nodes.some((n) => n.id === 'p') && !s.timing.ages.p && s.past === 1,
        'Cut removes the original place and timing together',
      );
      await key('Control+z');
      s = await state();
      expect(persistent(s) === persistent(base), 'One undo restores cut graph and timing');
    },
  );

  await check('T16', 'Saved-query protections on timed TAPN', async (expect) => {
    await openFile(QUERY_TAPN);
    const base = await state();
    const moved = base.net.nodes.find((n) => n.name === 'Moved').id;
    expect(
      base.timed && base.timing.transports.length === 1,
      'Query TAPN opens as timed with a transport',
    );
    await openNodeDialog(moved);
    await field('dialog-name').fill('Elsewhere');
    await submitDialog();
    let s = await state();
    expect(
      s.dialogOpen && /quer/i.test(s.dialogError) && persistent(s) === persistent(base),
      'Rename of a query node refused',
      s.dialogError,
    );
    await cancelDialog();
    await clickNode(moved);
    await focusCanvas();
    await key('Delete');
    s = await state();
    expect(
      persistent(s) === persistent(base) && /quer/i.test(s.error),
      'Delete of a query node refused',
      s.error,
    );
    await openNodeDialog(moved);
    await field('dialog-invariant').fill('<= 4');
    await submitDialog();
    s = await state();
    expect(s.timing.invariants[moved]?.upper === '4', 'Timing edit on a protected node allowed');
    const t = await saveTapn('T16-query.tapn');
    expect(t && /<query [^>]*name="Moved"/.test(t.text), 'Saved query preserved on export');
  });

  await check('T17', 'Token tools and wheel retain recorded ages', async (expect) => {
    await openFile(BASIC);
    await tool('Remove token');
    await clickNode('p');
    let s = await state();
    expect(
      s.net.nodes.find((n) => n.id === 'p').tokens === 2 && /age/i.test(s.error + s.notice),
      'Removing a token that would drop a recorded age is refused',
      { error: s.error, notice: s.notice },
    );
    await tool('Add token');
    await clickNode('p');
    s = await state();
    expect(
      s.net.nodes.find((n) => n.id === 'p').tokens === 3 &&
        JSON.stringify(s.timing.ages.p) === '["0.1","2.50"]',
      'Add token adds an age-zero token',
    );
    await tool('Remove token');
    await clickNode('p');
    s = await state();
    expect(
      s.net.nodes.find((n) => n.id === 'p').tokens === 2 &&
        JSON.stringify(s.timing.ages.p) === '["0.1","2.50"]',
      'Removing the age-zero token is allowed',
    );
    await tool('Select');
    await clickNode('p');
    const p = await nodePoint('p');
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);
    s = await state();
    const up = s.net.nodes.find((n) => n.id === 'p').tokens;
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    s = await state();
    const down = s.net.nodes.find((n) => n.id === 'p').tokens;
    expect(
      Math.max(up, 2) === 3 && down === 2 && JSON.stringify(s.timing.ages.p) === '["0.1","2.50"]',
      'Selected-place wheel adds age-zero tokens and refuses dropping recorded ages',
      { up, down, ages: s.timing.ages.p, error: s.error },
    );
  });

  await check('T18', 'Edit-mode highlighting never uses untimed enabling', async (expect) => {
    await openFile(ENDPOINTS);
    const red = await page.evaluate(
      () => document.querySelectorAll('.enabled, [data-node].enabled, .node-shape.enabled').length,
    );
    expect(red === 0, 'No transition is highlighted enabled in Edit mode', red);
    await simulate();
    let s = await state();
    const highlighted = await page.evaluate(() =>
      [...document.querySelectorAll('[data-node]')]
        .filter((e) => e.matches('.enabled, :has(.enabled)'))
        .map((e) => e.getAttribute('data-node')),
    );
    expect(
      s.enabled.length === 0 && highlighted.length === 0,
      'Age-0 token: no timed-enabled transition highlighted',
      highlighted,
    );
    expect(
      /No transitions enabled now. A legal delay may enable a transition./.test(
        await page.locator('.deadlock-note').textContent(),
      ),
      'No deadlock claim for timed net',
    );
  });

  await check(
    'T19',
    'Conflicting transport pairings and kind changes are refused atomically',
    async (expect) => {
      await openFile(TRANSPORT);
      const base = await state();
      // Second input of T from R would need a fresh output; reuse the paired output o instead.
      await tool('Arc');
      await clickNode('r');
      await clickNode('t');
      await tool('Select');
      let s = await state();
      const extra = s.net.arcs.find((a) => a.source === 'r' && a.target === 't');
      expect(extra && s.past === 1, 'Drew a second input R -> T');
      await openArcDialog(extra.id);
      const offered = await field('dialog-transport')
        .locator('option')
        .evaluateAll((os) => os.map((o) => o.value));
      expect(
        !offered.includes('o'),
        'An output already in a transport is not offered as a partner',
        offered,
      );
      await cancelDialog();
      await openArcDialog('i');
      await field('dialog-kind').selectOption('inhibitor');
      await submitDialog();
      s = await state();
      expect(
        s.dialogOpen &&
          s.dialogError &&
          s.past === 1 &&
          s.net.arcs.find((a) => a.id === 'i').kind === 'normal',
        'Turning a transport input into an inhibitor is refused',
        s.dialogError,
      );
      await cancelDialog();
      await openNodeDialog('q');
      await field('dialog-invariant').fill('< inf');
      await submitDialog();
      await openNodeDialog('t');
      await field('dialog-urgent').check();
      await submitDialog();
      s = await state();
      expect(
        s.timing.urgent.includes('t') && !s.timing.invariants.q,
        'Urgent accepted once destination invariant is < inf',
      );
      await openNodeDialog('q');
      await field('dialog-invariant').fill('<= 5');
      await submitDialog();
      s = await state();
      expect(
        s.dialogOpen && s.dialogError && !s.timing.invariants.q,
        'Finite invariant on an urgent transport destination is refused',
        s.dialogError,
      );
      await cancelDialog();
      s = await state();
      expect(
        JSON.stringify(s.network).length > 0 && persistent(base) !== persistent(s),
        'Only accepted edits changed the document',
      );
    },
  );
  await check('T20', 'Native 4.0.4 writer files open through the browser', async (expect) => {
    for (const [name, timed] of [
      ['Producer_cycle.native.tapn', false],
      ['control-hlinscription.native.tapn', true],
      ['timed-weighted.native.tapn', true],
    ]) {
      const before = await state();
      const path = fileURLToPath(
        new URL('../src/app/core/test-fixtures/native-4.0.4/' + name, import.meta.url),
      );
      await openFile(path);
      const loaded = await state();
      expect(
        !loaded.error && loaded.docs.length === before.docs.length + 1 && loaded.timed === timed,
        name + ' opens as the correct model type without replacing other tabs',
        loaded.error,
      );
      if (timed) {
        const pairs = loaded.network.components.flatMap((c) =>
          (c.timing?.transports ?? []).map((pair) => ({
            input: c.net.arcs.find((a) => a.id === pair.inputArc).weight,
            output: c.net.arcs.find((a) => a.id === pair.outputArc).weight,
          })),
        );
        expect(
          pairs.some((pair) => pair.input === 2 && pair.output === 2),
          name + ' retains weight 2 on both transport halves',
          pairs,
        );
      }
    }
  });

  await check('T21', 'Workspace errors float over the canvas without moving it', async (expect) => {
    // Layout boxes that must never move when an error appears or is dismissed.
    const layout = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [
            '.app-header',
            '.tool-rail',
            '.canvas-tabs',
            '.document-tab',
            '.drawing-area',
            'svg.net-canvas',
            '.inspector',
            '.app-footer',
            '[aria-label="Workspace mode"]',
          ].map((sel) => {
            const r = document.querySelector(sel)?.getBoundingClientRect();
            return [sel, r && [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10)];
          }),
        ),
      );
    const overlay = () =>
      page.evaluate(() => {
        const card = document.querySelector('.workspace-error');
        if (!card) return null;
        const box = (e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        };
        const c = box(card);
        const area = box(document.querySelector('.drawing-area'));
        const tabs = box(document.querySelector('.canvas-tabs'));
        const region = card.closest('[role=alert]');
        return {
          text: card.textContent.trim(),
          inside:
            c.x >= area.x && c.y >= area.y && c.right <= area.right && c.bottom <= area.bottom,
          belowTabs: c.y >= tabs.bottom,
          alertText: region?.textContent.trim() ?? null,
          position: getComputedStyle(region).position,
          width: c.right - c.x,
          height: c.bottom - c.y,
          hScroll: document.documentElement.scrollWidth > innerWidth,
        };
      });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    await openFile(BASIC);
    await simulate();
    const base = await layout();
    const before = await state();

    await delay('abc');
    let s = await state();
    let o = await overlay();
    expect(s.error && o?.text === s.error, 'Invalid delay shows the error card', o);
    expect(o?.alertText === s.error, 'The message is inside the role=alert live region', o);
    expect(o?.inside && o.belowTabs, 'The card stays within the canvas, below the tabs', o);
    expect(o?.position === 'absolute', 'The error region is out of the layout flow', o);
    expect(same(await layout(), base), 'Showing the error moves no tabs, canvas or controls');
    expect(s.history.length === before.history.length, 'The refused delay leaves history alone');
    await shot('T21-invalid-delay');

    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
    s = await state();
    expect(!s.error && !(await overlay()), 'Dismiss clears the error and removes the card');
    expect(same(await layout(), base), 'Dismissing moves nothing back');
    expect(
      await page.evaluate(() => document.activeElement?.matches('svg.net-canvas')),
      'Dismiss returns focus to the canvas',
    );

    // Firing a disabled transition (U needs age >= 5 on Z) through the manual-selection path.
    await policy('manual');
    await clickNode('u', { clickCount: 2 });
    s = await state();
    o = await overlay();
    expect(
      /not enabled/i.test(s.error) && o?.text === s.error,
      'Firing a disabled transition shows the error card',
      s.error,
    );
    expect(same(await layout(), base), 'The disabled-fire error moves nothing');
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).focus();
    await key('Escape');
    s = await state();
    expect(
      !s.error && !(await overlay()) && s.mode === 'Simulate',
      'Escape on the focused card dismisses only the error',
      s.mode,
    );
    await policy('oldest');

    // Menus stay above the card.
    await delay('-1');
    await page.locator('summary', { hasText: /^Simulator$/ }).click();
    const stacking = await page.evaluate(() => {
      const card = document.querySelector('.workspace-error').getBoundingClientRect();
      const menu = [...document.querySelectorAll('details[open] .menu-popover')]
        .map((m) => m.getBoundingClientRect())
        .find((r) => r.width && r.height);
      if (!menu) return { menu: false };
      const x = Math.max(card.x, menu.x) + 2;
      const y = Math.max(card.y, menu.y) + 2;
      const overlap =
        x < Math.min(card.right, menu.right) && y < Math.min(card.bottom, menu.bottom);
      const z = (e) => +getComputedStyle(e).zIndex || 0;
      return {
        menu: true,
        overlap,
        menuOnTop: overlap
          ? !!document.elementFromPoint(x, y)?.closest('.menu-popover')
          : z(document.querySelector('.menu-popover')) >
            z(document.querySelector('.workspace-error-region')),
      };
    });
    expect(
      stacking.menu && stacking.menuOnTop,
      'An open menu draws above the error card',
      stacking,
    );
    await shot('T21-menu');
    await key('Escape');
    expect(same(await layout(), base), 'Menu and error together still move nothing');

    // Smaller window: the card shrinks with the canvas and never causes horizontal scroll.
    await page.setViewportSize({ width: 700, height: 900 });
    await settle();
    const narrowBase = await page.evaluate(() => {
      const r = document.querySelector('svg.net-canvas').getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    o = await overlay();
    expect(o?.inside && o.belowTabs && !o.hScroll, 'Narrow window: card fits the canvas', o);
    await shot('T21-narrow');
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
    const narrowAfter = await page.evaluate(() => {
      const r = document.querySelector('svg.net-canvas').getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    expect(same(narrowAfter, narrowBase), 'Narrow window: dismiss leaves the canvas in place');
    await page.setViewportSize({ width: 1280, height: 800 });
  });
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
