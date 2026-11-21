#!/usr/bin/env node
// Validation of timed Random/Oldest/Youngest/Manual token selection
// (see design/TOKEN-SELECTION-VALIDATION.md). Two parts:
//
// - P cases bundle src/app/timed-ui.ts with esbuild and drive DocumentSimulation directly with an
//   injected random source. They cover sampling without replacement, invalid sources and invalid
//   manual bindings, which the browser cannot produce without mutating the app.
// - B cases drive a running development build with real Playwright mouse, keyboard, checkbox and
//   file-chooser input. App signals and rendered DOM are only read; no App methods or signal
//   setters are invoked. Math.random is wrapped by an init script only to count calls.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-token-selection.mjs http://127.0.0.1:4393 /tmp/tapaal-token-selection/run
//
// ONLY=P01,B03 selects cases; a missing BASE url (`-`) runs only the P cases.
// Exit status 1 when any check fails. Results: <out>/results.json plus fixtures, downloads and
// screenshots in <out>.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const BASE = process.argv[2] ?? 'http://127.0.0.1:4393';
const OUT = process.argv[3] ?? '/tmp/tapaal-token-selection/run';
const ONLY = process.env.ONLY?.split(',');
mkdirSync(OUT, { recursive: true });

// ---- fixtures ------------------------------------------------------------------------------
const TYPE = { timed: true, colored: false, game: false, stochastic: false };
const place = (id, name, x, y, tokens = 0) => ({ id, name, kind: 'place', tokens, x, y });
const transition = (id, name, x, y) => ({ id, name, kind: 'transition', tokens: 0, x, y });
const arc = (id, source, target, weight = 1, kind = 'normal') => ({
  id,
  source,
  target,
  kind,
  weight,
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
const network = (name, components) => ({
  name,
  type: TYPE,
  components: components.map((c) => ({ ...c, net: { ...c.net, name } })),
});
function fixture(file, value) {
  const path = join(OUT, file);
  writeFileSync(path, JSON.stringify({ format: 'tapaal-web-network', version: 1, network: value }));
  return path;
}
// T: P -(2,6)-> T (strict: ages 2 and 6 ineligible), weight-2 transport R => D (<3: age 4
// ineligible, three equal age-1 tokens eligible), inhibitor H -o T, ordinary output T -> Q.
// S is a source transition; U has only an inhibitor; F has a forced weight-2 input from X.
const SELECTION_NET = network('Token selection', [
  component(
    'main',
    'Main',
    [
      transition('t', 'T', 320, 260),
      place('p', 'P', 120, 120, 5),
      place('r', 'R', 120, 260, 4),
      place('h', 'H', 120, 400),
      place('d', 'D', 520, 260),
      place('q', 'Q', 520, 120),
      transition('s', 'S', 320, 60),
      transition('u', 'U', 320, 400),
      place('x', 'X', 120, 520, 2),
      transition('f', 'F', 320, 520),
    ],
    [
      arc('pi', 'p', 't'),
      arc('ri', 'r', 't', 2),
      arc('do', 't', 'd', 2),
      arc('ht', 'h', 't', 1, 'inhibitor'),
      arc('tq', 't', 'q'),
      arc('sq', 's', 'q'),
      arc('hu', 'h', 'u', 1, 'inhibitor'),
      arc('uq', 'u', 'q'),
      arc('xf', 'x', 'f', 2),
      arc('fq', 'f', 'q'),
    ],
    {
      intervals: { pi: { lower: '2', upper: '6', lowerClosed: false, upperClosed: false } },
      invariants: { d: { upper: '3', upperClosed: false } },
      ages: { p: ['0.5', '2', '2.5', '3', '6'], r: ['1', '1', '1', '4'] },
      transports: [{ inputArc: 'ri', outputArc: 'do' }],
    },
  ),
]);
const SELECTION = fixture('token-selection.json', SELECTION_NET);
const MULTI = fixture(
  'two-components.json',
  network('Two timed components', [
    component(
      'a',
      'Alpha',
      [place('p', 'P', 120, 120, 1), transition('t', 'T', 320, 120)],
      [arc('i', 'p', 't')],
    ),
    component(
      'b',
      'Beta',
      [place('p', 'P', 120, 120, 1), transition('t', 'T', 320, 120)],
      [arc('i', 'p', 't')],
    ),
  ]),
);

// ---- result recording --------------------------------------------------------------------------
const results = [];
async function record(id, title, fn, before) {
  if (ONLY && !ONLY.includes(id)) return;
  const r = { id, title, status: 'pass', observations: [] };
  const expect = (ok, message, detail) => {
    r.observations.push({ ok: !!ok, message, ...(detail === undefined ? {} : { detail }) });
    if (!ok) r.status = 'fail';
  };
  try {
    if (before) await before();
    await fn(expect);
  } catch (e) {
    r.status = 'error';
    r.error = e.stack;
    await shot?.(id + '-error').catch(() => {});
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...list].sort();

// ---- P: pure DocumentSimulation checks ------------------------------------------------------
const esbuild = require('esbuild');
const bundle = join(OUT, 'timed-ui.bundle.mjs');
await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../src/app/timed-ui.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: bundle,
  logLevel: 'error',
});
const { DocumentSimulation } = await import(pathToFileURL(bundle).href);
const snapshot = (sim) => JSON.stringify({ cursor: sim.cursor, trace: sim.timed.trace });
const tokenAges = (sim, placeId) => sim.ages(placeId);
// Deterministic uniform source (mulberry32).
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sequence(values) {
  let i = 0;
  const source = () => values[i++ % values.length];
  source.calls = () => i;
  return source;
}

await record(
  'P01',
  'Random samples eligible tokens without replacement per input',
  async (expect) => {
    const initial = new DocumentSimulation(SELECTION_NET).eligibleInputs({
      componentId: SELECTION_NET.components[0].id,
      elementId: 't',
    });
    const rIds = initial.find((i) => i.arcId === 'ri').tokens.map((t) => t.id);
    const pIds = initial.find((i) => i.arcId === 'pi').tokens.map((t) => t.id);
    const pairs = new Map(),
      pChoices = new Map();
    const random = seeded(20261029);
    let calls = 0;
    const counted = () => (calls++, random());
    const trials = 6000;
    for (let n = 0; n < trials; n++) {
      const sim = new DocumentSimulation(SELECTION_NET, counted);
      sim.fire('main', 't');
      const bindings = sim.timed.trace[1].bindings;
      const key = sorted(bindings.ri).join('+');
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
      pChoices.set(bindings.pi[0], (pChoices.get(bindings.pi[0]) ?? 0) + 1);
      if (new Set(bindings.ri).size !== 2 || !bindings.ri.every((id) => rIds.includes(id)))
        throw new Error('Random chose a duplicate or ineligible transport token ' + bindings.ri);
      if (!pIds.includes(bindings.pi[0])) throw new Error('Random chose ineligible P token');
    }
    expect(calls === trials * 3, 'Exactly one sample per required token (1 + 2) per firing', calls);
    expect(
      pairs.size === 3 && [...pairs.values()].every((c) => Math.abs(c / trials - 1 / 3) < 0.03),
      'All three equal-age transport pairs occur with ~1/3 frequency',
      Object.fromEntries(pairs),
    );
    expect(
      pChoices.size === 2 &&
        [...pChoices.values()].every((c) => Math.abs(c / trials - 1 / 2) < 0.03),
      'Both strict-interval P choices (2.5, 3) occur with ~1/2 frequency',
      Object.fromEntries(pChoices),
    );
    // Native RandomFiringMode: index = nextInt(size) on the remaining list; web floor(r * size).
    const grid = [0, 0.34, 0.67, 0.99];
    const reachable = new Set();
    for (const a of grid)
      for (const b of grid) {
        const sim = new DocumentSimulation(SELECTION_NET, sequence([0, a, b]));
        sim.fire('main', 't');
        reachable.add(sim.timed.trace[1].bindings.ri.join('+'));
      }
    expect(
      same(
        sorted(reachable),
        sorted([
          `${rIds[0]}+${rIds[1]}`,
          `${rIds[0]}+${rIds[2]}`,
          `${rIds[1]}+${rIds[0]}`,
          `${rIds[1]}+${rIds[2]}`,
          `${rIds[2]}+${rIds[0]}`,
          `${rIds[2]}+${rIds[1]}`,
        ]),
      ),
      'Index sequence floor(r*remaining) reaches every ordered pair exactly like nextInt(size)',
      [...reachable],
    );
    const zero = new DocumentSimulation(SELECTION_NET, () => 0);
    zero.fire('main', 't');
    expect(
      same(tokenAges(zero, 'p'), ['0.5', '2', '3', '6']) &&
        same(zero.timed.trace[1].bindings.ri, rIds.slice(0, 2)),
      'r=0 picks the first eligible token in marking order (2.5, then R tokens 1 and 2)',
      zero.timed.trace[1].bindings,
    );
  },
);

await record(
  'P02',
  'Invalid random samples fail atomically and keep the future',
  async (expect) => {
    for (const bad of [1, -0.1, Number.NaN, Infinity, '0.5', undefined]) {
      for (const at of [0, 2]) {
        const values = [0, 0, 0];
        values[at] = bad;
        const sim = new DocumentSimulation(SELECTION_NET, sequence(values));
        sim.fire('main', 's');
        sim.back();
        const before = snapshot(sim);
        let message = '';
        try {
          sim.fire('main', 't');
        } catch (e) {
          message = e.message;
        }
        expect(
          /Random source must return a finite number in \[0,1\)/.test(message) &&
            snapshot(sim) === before &&
            sim.canForward,
          `Sample ${at + 1} = ${String(bad)} refused; cursor, trace and future unchanged`,
          message,
        );
      }
    }
  },
);

await record('P03', 'Oldest/youngest/Forward never call random', async (expect) => {
  const random = sequence([0.5]);
  const sim = new DocumentSimulation(SELECTION_NET, random);
  sim.fire('main', 't', 'oldest');
  expect(same(sim.ages('p'), ['0.5', '2', '2.5', '6']), 'Oldest eligible P token is 3, not 6');
  sim.back();
  sim.fire('main', 't', 'youngest');
  expect(same(sim.ages('p'), ['0.5', '2', '3', '6']), 'Youngest eligible P token is 2.5, not 2');
  expect(
    same(sim.ages('d'), ['1', '1']) && same(sim.ages('r'), ['1', '4']),
    'Transport keeps age 1',
  );
  sim.back();
  sim.forward();
  expect(random.calls() === 0, 'No random calls for deterministic policies or Forward');
  sim.back();
  sim.fire('main', 't');
  const after = random.calls();
  sim.back();
  sim.forward();
  expect(after === 3 && random.calls() === 3, 'Random firing samples 3 times; Forward replays');
});

await record('P04', 'Manual bindings are revalidated by the engine', async (expect) => {
  const sim = new DocumentSimulation(SELECTION_NET, () => 0);
  sim.fire('main', 's');
  sim.back();
  const inputs = sim.eligibleInputs({
    componentId: SELECTION_NET.components[0].id,
    elementId: 't',
  });
  const p = inputs.find((i) => i.arcId === 'pi').tokens.map((t) => t.id);
  const r = inputs.find((i) => i.arcId === 'ri').tokens.map((t) => t.id);
  const all = Object.values(sim.timed.markingFor('main')).flat();
  const id = (placeId, age) => all.find((t) => t.place === placeId && t.age === age).id;
  const before = snapshot(sim);
  const cases = [
    ['missing input', { pi: [p[0]] }],
    ['extra inhibitor key', { pi: [p[0]], ri: r.slice(0, 2), ht: [] }],
    ['too few', { pi: [p[0]], ri: [r[0]] }],
    ['too many', { pi: [p[0]], ri: r }],
    ['duplicate', { pi: [p[0]], ri: [r[0], r[0]] }],
    ['strict lower bound age 2', { pi: [id('p', '2')], ri: r.slice(0, 2) }],
    ['strict upper bound age 6', { pi: [id('p', '6')], ri: r.slice(0, 2) }],
    ['destination invariant age 4', { pi: [p[0]], ri: [r[0], id('r', '4')] }],
    ['token from another place', { pi: [r[0]], ri: r.slice(1, 3) }],
    ['unknown identity', { pi: ['@timed:999'], ri: r.slice(0, 2) }],
  ];
  for (const [name, bindings] of cases) {
    let message = '';
    try {
      sim.fire('main', 't', { mode: 'manual', bindings });
    } catch (e) {
      message = e.message;
    }
    expect(message && snapshot(sim) === before && sim.canForward, `Refused: ${name}`, message);
  }
  sim.fire('main', 't', { mode: 'manual', bindings: { pi: [p[1]], ri: [r[0], r[2]] } });
  const step = sim.timed.trace[1];
  expect(
    same(step.bindings, { pi: [p[1]], ri: [r[0], r[2]] }) &&
      same(
        Object.values(sim.timed.markingFor('main'))
          .flat()
          .filter((t) => t.place === 'r')
          .map((t) => t.id),
        [r[1], id('r', '4')],
      ) &&
      !sim.canForward,
    'Exact equal-age identities are consumed; old future truncated',
    step.bindings,
  );
});

await record(
  'P05',
  'Eligible input projection matches firing rules and is detached',
  async (expect) => {
    const sim = new DocumentSimulation(SELECTION_NET);
    const inputs = sim.eligibleInputs({
      componentId: SELECTION_NET.components[0].id,
      elementId: 't',
    });
    expect(
      same(
        inputs.map((i) => [
          i.arcId,
          i.weight,
          i.destinationName ?? null,
          i.tokens.map((t) => t.age),
        ]),
        [
          ['pi', 1, null, ['2.5', '3']],
          ['ri', 2, 'D', ['1', '1', '1']],
        ],
      ),
      'Strict (2,6) excludes 2 and 6; D < 3 excludes 4; inhibitor omitted',
      inputs,
    );
    inputs[0].tokens[0].age = '99';
    inputs[0].tokens.push({ id: 'x', place: 'p', age: '3' });
    expect(
      same(
        sim
          .eligibleInputs({ componentId: SELECTION_NET.components[0].id, elementId: 't' })[0]
          .tokens.map((t) => t.age),
        ['2.5', '3'],
      ) && same(sim.ages('p'), ['0.5', '2', '2.5', '3', '6']),
      'Mutating the returned projection does not affect the simulation',
    );
    expect(
      sim.eligibleInputs({ componentId: SELECTION_NET.components[0].id, elementId: 's' }).length ===
        0 &&
        sim.eligibleInputs({ componentId: SELECTION_NET.components[0].id, elementId: 'u' })
          .length === 0,
      'Source and inhibitor-only transitions have no consuming inputs',
    );
    const multi = new DocumentSimulation(JSON.parse(readFileSync(MULTI, 'utf8')).network);
    expect(
      multi.trace.length === 1 && multi.enabled.length > 0,
      'Two-component disjoint timed network executes with qualified references',
      multi.enabled,
    );
  },
);

// ---- B: browser ----------------------------------------------------------------------------
let shot;
if (BASE !== '-') {
  const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Counting wrapper only; the values still come from the browser's Math.random.
  await context.addInitScript(() => {
    const original = Math.random;
    window.__randomCalls = 0;
    Math.random = () => (window.__randomCalls++, original());
  });
  const page = await context.newPage();
  shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const settle = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const state = async () => {
    await settle();
    return page.evaluate(() => {
      const app = window.ng.getComponent(document.querySelector('app-root'));
      const ws = app.workspace();
      const doc = ws.documents.find((d) => d.id === ws.activeDocumentId);
      const sim = app.simulator;
      const draft = app.tokenDraft();
      const dialog = document.querySelector('app-token-selection-dialog form');
      const active = document.activeElement;
      return {
        network: doc && JSON.stringify(doc.network),
        past: doc?.past.length,
        future: doc?.future.length,
        dirty: app.dirty(),
        mode: app.mode(),
        policy: app.tokenPolicy(),
        selectValue: document.querySelector('#token-policy')?.value ?? null,
        cursor: app.cursor(),
        traceLength: app.trace().length,
        steps: sim?.timed ? JSON.stringify(sim.timed.trace) : null,
        bindings: sim?.timed?.trace[sim.cursor]?.bindings ?? null,
        tokens: sim?.timed
          ? Object.values(sim.timed.marking).flatMap((places) => Object.values(places).flat())
          : null,
        ages: app.currentAges(),
        error: app.error(),
        notice: app.notice(),
        random: window.__randomCalls,
        draft: draft && {
          transition: draft.transition,
          inputs: draft.inputs.map((i) => ({ arc: i.arcId, ids: i.tokens.map((t) => t.id) })),
        },
        dialog: dialog && {
          title: dialog.querySelector('h2').textContent.trim(),
          text: dialog.textContent.replace(/\s+/g, ' ').trim(),
          legends: [...dialog.querySelectorAll('legend')].map((l) =>
            l.textContent.replace(/\s+/g, ' ').trim(),
          ),
          labels: [...dialog.querySelectorAll('fieldset')].map((f) =>
            [...f.querySelectorAll('label')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
          ),
          checked: [...dialog.querySelectorAll('fieldset')].map((f) =>
            [...f.querySelectorAll('input')].map((i) => i.checked),
          ),
          disabledBoxes: [...dialog.querySelectorAll('input')].filter((i) => i.disabled).length,
          status: [...dialog.querySelectorAll('[aria-live]')].map((p) => p.textContent.trim()),
          fireDisabled: dialog.querySelector('button[type=submit]').disabled,
          alert: dialog.querySelector('[role=alert]')?.textContent.trim() ?? null,
        },
        focus: active
          ? `${active.tagName.toLowerCase()}${active.className && typeof active.className === 'string' ? '.' + active.className.split(' ')[0] : ''}|${(active.getAttribute('aria-label') ?? active.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`
          : null,
        focusInDialog: !!dialog?.contains(active),
        history: [...document.querySelectorAll('.history-row')].map((e) =>
          [...e.querySelectorAll('span')].map((t) => t.textContent.trim()).join(' '),
        ),
        zoom: app.zoom?.(),
        context: !!app.context(),
        stepLabel: [
          ...document.querySelectorAll(
            '[aria-label="Simulation control"] .simulation-buttons button',
          ),
        ][1]?.textContent.trim(),
      };
    });
  };
  // Simulation-visible state that must not change on cancel/blocked actions.
  const stable = (s) =>
    JSON.stringify([s.network, s.past, s.future, s.mode, s.cursor, s.steps, s.ages, s.policy]);
  const btn = (name, exact = true) => page.getByRole('button', { name, exact });
  const key = (k) => page.keyboard.press(k);
  const dialog = page.locator('app-token-selection-dialog form');
  const box = (fieldset, index) =>
    dialog.locator('fieldset').nth(fieldset).getByRole('checkbox').nth(index);
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
    return readFileSync(path, 'utf8');
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
  const modeButton = (name) =>
    page.locator('[aria-label="Workspace mode"]').getByRole('button', { name });
  const sim = (name) =>
    page.locator('[aria-label="Simulation control"]').getByRole('button', { name });
  const row = (name) => page.locator('.enabled-row', { hasText: name });
  const sidebarFire = () => page.locator('[aria-label="Enabled transitions"] .fire-button');
  async function policy(value) {
    await page.locator('#token-policy').selectOption(value);
  }
  async function start(selectionPolicy) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
    await openFile(SELECTION);
    await modeButton('Simulate').click();
    if (selectionPolicy) await policy(selectionPolicy);
  }
  const check = (id, title, fn, selectionPolicy) =>
    record(id, title, fn, () => start(selectionPolicy));
  const ids = (s, arcId) => s.draft.inputs.find((i) => i.arc === arcId).ids;

  try {
    await check(
      'B01',
      'Random is the native default and samples eligible tokens',
      async (expect) => {
        let s = await state();
        expect(
          s.policy === 'random' && s.selectValue === 'random',
          'Policy select defaults to Random (Animator.java:77 RandomFiringMode)',
          s.selectValue,
        );
        const seen = new Map(),
          pairs = new Set();
        let ok = true;
        for (let trial = 0; trial < 20; trial++) {
          const before = s.random;
          await row('Main.T').click();
          await sidebarFire().click();
          s = await state();
          const consumed = ['2.5', '3'].filter((age) => !s.ages.p.includes(age));
          seen.set(consumed[0], (seen.get(consumed[0]) ?? 0) + 1);
          pairs.add(sorted(s.bindings.ri).join('+'));
          ok &&=
            !s.dialog &&
            s.cursor === 1 &&
            consumed.length === 1 &&
            s.ages.p.length === 4 &&
            same(sorted(s.ages.r), ['1', '4']) &&
            same(s.ages.d, ['1', '1']) &&
            same(s.ages.q, ['0']) &&
            s.random - before === 3;
          await sim('Reset').click();
          s = await state();
          ok &&= s.cursor === 0 && s.traceLength === 1;
        }
        expect(ok, '20 Random firings: no dialog, 1 eligible P + 2 eligible R, 3 samples each');
        expect(
          seen.size === 2,
          'Both eligible P tokens (2.5 and 3) were chosen',
          Object.fromEntries(seen),
        );
        expect(pairs.size >= 2, 'More than one equal-age R pair was chosen', [...pairs]);
      },
    );

    await check(
      'B02',
      'Explicit Oldest/Youngest respect strict bounds and invariants',
      async (expect) => {
        await policy('oldest');
        let s = await state();
        const before = s.random;
        await row('Main.T').click();
        await sidebarFire().click();
        s = await state();
        expect(
          same(s.ages.p, ['0.5', '2', '2.5', '6']) && same(s.ages.d, ['1', '1']) && !s.dialog,
          'Oldest eligible: P 3 (6 excluded by strict upper bound); R age 4 excluded by D < 3',
          s.ages,
        );
        await sim('Back').click();
        await policy('youngest');
        // T became disabled after the first firing, so the selection moved to S.
        await row('Main.T').click();
        await sidebarFire().click();
        s = await state();
        expect(
          same(s.ages.p, ['0.5', '2', '3', '6']) &&
            same(
              s.ages.r.filter((a) => a === '4'),
              ['4'],
            ),
          'Youngest eligible: P 2.5 (2 excluded by strict lower bound)',
          s.ages,
        );
        expect(s.random === before, 'Deterministic policies made no random calls');
      },
    );

    await check(
      'B03',
      'Manual dialog: per-input exact weights, equal-age identities, chosen IDs',
      async (expect) => {
        const initial = await state();
        await clickNode('t');
        await dialog.waitFor();
        await page.waitForTimeout(50);
        let s = await state();
        await shot('B03-dialog');
        expect(s.dialog.title === 'Select tokens for Main.T', 'Dialog names the transition');
        expect(
          same(s.dialog.legends, ['P → Main.T', 'R → Main.T → D (transport)']),
          'Two consuming groups, transport destination named, inhibitor H omitted',
          s.dialog.legends,
        );
        expect(
          same(s.dialog.labels, [
            ['Token 1 · age 2.5', 'Token 2 · age 3'],
            ['Token 1 · age 1', 'Token 2 · age 1', 'Token 3 · age 1'],
          ]),
          'Only eligible tokens: strict (2,6) and D < 3 filtering; equal ages numbered',
          s.dialog.labels,
        );
        expect(!/@timed|timed:/.test(s.dialog.text), 'No raw engine identities in dialog text');
        expect(
          s.dialog.fireDisabled &&
            same(s.dialog.status, ['Selected 0 of 1 required', 'Selected 0 of 2 required']),
          'Fire disabled until every input is exact',
          s.dialog,
        );
        expect(
          s.focusInDialog && /^input/.test(s.focus),
          'Focus starts on the first checkbox',
          s.focus,
        );
        expect(s.cursor === 0 && s.traceLength === 1, 'Opening the draft changes nothing');
        await box(1, 0).click();
        await box(1, 2).click();
        s = await state();
        expect(s.dialog.fireDisabled, 'R complete but P empty: Fire still disabled');
        await box(0, 1).click();
        await box(1, 1).click();
        s = await state();
        expect(
          s.dialog.fireDisabled && s.dialog.status[1] === 'Selected 3 of 2 required',
          'Over-selection (3 of 2) keeps Fire disabled',
          s.dialog.status,
        );
        await box(1, 1).click();
        s = await state();
        expect(!s.dialog.fireDisabled, 'Exactly 1 + 2 enables Fire');
        const p = ids(s, 'pi'),
          r = ids(s, 'ri');
        await dialog.getByRole('button', { name: 'Fire' }).click();
        s = await state();
        expect(
          !s.dialog &&
            s.cursor === 1 &&
            same(s.bindings, { pi: [p[1]], ri: [r[0], r[2]] }) &&
            same(
              s.tokens
                .filter((t) => t.place === 'r')
                .map((t) => t.id)
                .slice(0, 1),
              [r[1]],
            ),
          'Engine binding is exactly P token 2 and R tokens 1 and 3; R token 2 remains',
          s.bindings,
        );
        expect(
          same(s.ages.p, ['0.5', '2', '2.5', '6']) &&
            same(s.ages.d, ['1', '1']) &&
            same(s.ages.q, ['0']) &&
            same(sorted(s.ages.r), ['1', '4']),
          'Marking: P age 3 consumed, two age-1 tokens transported, Q age 0',
          s.ages,
        );
        expect(
          s.history.at(-1) === '1 Fire Main.T · time 0' && s.notice === 'Fired Main.T.' && !s.error,
          'History and notice record the firing',
          [s.history, s.notice],
        );
        expect(s.network === initial.network && !s.dirty, 'Document unchanged by simulation');
      },
      'manual',
    );

    await check(
      'B04',
      'Back/Forward/Step/history/keyboard replay without prompting or sampling',
      async (expect) => {
        await row('Main.T').dblclick();
        await dialog.waitFor();
        await box(0, 0).click();
        await box(1, 1).click();
        await box(1, 2).click();
        await dialog.getByRole('button', { name: 'Fire' }).click();
        let s = await state();
        const fired = s.steps;
        const random = s.random;
        await sim('Back').click();
        s = await state();
        expect(
          s.cursor === 0 && s.stepLabel === 'Forward',
          'Back keeps the future; Step reads Forward',
        );
        await sim('Forward').click();
        s = await state();
        expect(
          s.cursor === 1 && !s.dialog && s.steps === fired,
          'Forward replays without a dialog',
        );
        await page.locator('.history-row').nth(0).click();
        await page.locator('.history-row').nth(1).click();
        s = await state();
        expect(
          s.cursor === 1 && !s.dialog && s.steps === fired,
          'History jumps replay the snapshot',
        );
        await page.locator('svg.net-canvas').focus();
        await key('ArrowLeft');
        await key('ArrowRight');
        s = await state();
        expect(s.cursor === 1 && !s.dialog && s.steps === fired, 'Arrow keys replay the snapshot');
        await sim('Back').click();
        await page.locator('summary', { hasText: /^Simulator$/ }).click();
        await btn('Next marking').click();
        s = await state();
        expect(
          s.cursor === 1 && !s.dialog && s.steps === fired,
          'Simulator menu Next marking replays',
        );
        await sim('Back').click();
        await policy('random');
        await sim('Forward').click();
        s = await state();
        expect(
          s.cursor === 1 && s.steps === fired && s.random === random,
          'Random policy Forward replays the manual snapshot without sampling',
          s.random - random,
        );
        await sim('Back').click();
        await policy('manual');
        await row('Main.T').click();
        await sidebarFire().click();
        await dialog.waitFor();
        s = await state();
        expect(
          s.cursor === 0 && s.traceLength === 2,
          'New draft at cursor 0 keeps the future while open',
        );
        await box(0, 1).click();
        await box(1, 0).click();
        await box(1, 1).click();
        const p = ids(s, 'pi'),
          r = ids(s, 'ri');
        await dialog.getByRole('button', { name: 'Fire' }).click();
        s = await state();
        expect(
          s.cursor === 1 &&
            s.traceLength === 2 &&
            same(s.bindings, { pi: [p[1]], ri: [r[0], r[1]] }) &&
            s.steps !== fired,
          'Confirm after Back truncates the old future and stores the new choice',
          s.bindings,
        );
      },
      'manual',
    );

    await check(
      'B05',
      'Cancel and Escape leave marking, cursor, history and future unchanged',
      async (expect) => {
        await row('Main.S').dblclick();
        await sim('Back').click();
        let before = await state();
        expect(before.cursor === 0 && before.traceLength === 2, 'Setup: future step exists');
        await row('Main.T').dblclick();
        await dialog.waitFor();
        await box(0, 0).click();
        await box(1, 0).click();
        await box(1, 1).click();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        let s = await state();
        expect(
          !s.dialog && stable(s) === stable(before) && !s.error && s.traceLength === 2,
          'Cancel (complete selection) changes nothing; future kept (native clears it, see doc)',
        );
        expect(/enabled-row\|.*Main\.T/.test(s.focus), 'Focus returns to the Main.T row', s.focus);
        await key('Enter');
        await dialog.waitFor();
        await page.waitForTimeout(50);
        await key('Space');
        await key('Escape');
        s = await state();
        expect(
          !s.dialog && stable(s) === stable(before),
          'Keyboard Enter row, Space, Escape: unchanged',
        );
        expect(/enabled-row/.test(s.focus), 'Focus returns to the row after Escape', s.focus);
        await sim('Forward').click();
        s = await state();
        expect(
          s.cursor === 1 && s.history.at(-1) === '1 Fire Main.S · time 0',
          'Retained future still replays',
        );
      },
      'manual',
    );

    await check(
      'B06',
      'Dialog focus trap, global keyboard and clipboard isolation',
      async (expect) => {
        await page.evaluate(() => navigator.clipboard.writeText('sentinel-before-dialog'));
        await clickNode('p');
        await clickNode('t');
        await dialog.waitFor();
        await page.waitForTimeout(50);
        const before = await state();
        const order = [];
        for (let i = 0; i < 7; i++) {
          order.push((await state()).focus);
          await key('Tab');
        }
        expect(
          same(
            order.map((f) => f.split('|')[0]),
            ['input', 'input', 'input', 'input', 'input', 'button', 'input'],
          ),
          'Tab cycles 5 checkboxes, Cancel (disabled Fire skipped) and wraps',
          order,
        );
        await box(0, 0).focus();
        await key('Shift+Tab');
        let s = await state();
        expect(
          /^button\|Cancel/.test(s.focus),
          'Shift+Tab from first wraps to the last enabled control',
          s.focus,
        );
        await box(0, 0).focus();
        for (const k of ['Control+c', 'Control+x', 'Control+v']) await key(k);
        await page.waitForTimeout(150);
        s = await state();
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        expect(
          clip === 'sentinel-before-dialog' && stable(s) === stable(before) && s.dialog,
          'Ctrl+C/X/V in the dialog leave the clipboard and document untouched',
          clip.slice(0, 80),
        );
        for (const k of [
          'm',
          'g',
          'v',
          'a',
          'ArrowLeft',
          'ArrowRight',
          'Delete',
          'Backspace',
          'F2',
          'Control+z',
          'Control+Shift+z',
          'Control+y',
          'Control+d',
          'Control+j',
        ])
          await key(k);
        const saved = await download(() => key('Control+s'), 'B06-ctrl-s.tapn');
        s = await state();
        expect(
          s.dialog &&
            stable(s) === stable(before) &&
            s.mode === 'Simulate' &&
            !saved &&
            s.zoom === before.zoom,
          'Global shortcuts (mode, grid, tools, back/forward, delete, undo, zoom, save) inert',
          { focus: s.focus, saved: !!saved },
        );
        // Ctrl+A outside text controls must not select page text behind the modal.
        await box(0, 0).focus();
        await key('Control+a');
        await key('Control+c');
        await page.waitForTimeout(150);
        const selected = await page.evaluate(() => getSelection().toString().length);
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        s = await state();
        expect(
          stable(s) === stable(before) &&
            s.dialog &&
            selected === 0 &&
            copied === 'sentinel-before-dialog',
          'Ctrl+A then Ctrl+C leaves page text unselected and system clipboard unchanged',
          { selectedChars: selected, copied: copied.slice(0, 60) },
        );
        await page.mouse.click(5, 795);
        await box(0, 0).click();
        await box(1, 0).click();
        await box(1, 1).focus();
        await key('Space');
        s = await state();
        expect(!s.dialog.fireDisabled, 'Keyboard Space toggles a checkbox; Fire enabled');
        await key('Enter');
        s = await state();
        expect(
          !s.dialog && s.cursor === 1,
          'Enter on a checkbox submits the complete form (implicit submission)',
          s.cursor,
        );
      },
      'manual',
    );

    await check(
      'B07',
      'Modal backdrop blocks pointer access to sidebar, menus and canvas',
      async (expect) => {
        await row('Main.S').dblclick();
        await sim('Back').click();
        const targets = {};
        for (const [name, locator] of [
          ['Back', sim('Back')],
          ['Forward', sim('Forward')],
          ['Reset', sim('Reset')],
          ['policy', page.locator('#token-policy')],
          ['Edit mode', modeButton('Edit')],
          ['history', page.locator('.history-row').nth(1)],
          [
            'Delay',
            page
              .locator('[aria-label="Time and token selection"]')
              .getByRole('button', { name: 'Delay' }),
          ],
          ['Simulator menu', page.locator('summary', { hasText: /^Simulator$/ })],
        ])
          targets[name] = await locator.boundingBox();
        targets.U = await nodePoint('u').then((p) => ({
          x: p.x - 1,
          y: p.y - 1,
          width: 2,
          height: 2,
        }));
        await clickNode('t');
        await dialog.waitFor();
        const before = await state();
        const missed = [];
        for (const [name, b] of Object.entries(targets)) {
          if (!b) {
            missed.push(name);
            continue;
          }
          const x = b.x + b.width / 2,
            y = b.y + b.height / 2;
          const inside = await dialog
            .boundingBox()
            .then((d) => x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height);
          if (inside) {
            missed.push(name + ' (under dialog)');
            continue;
          }
          await page.mouse.click(x, y);
          await page.mouse.click(x, y, { button: 'right' });
          await page.mouse.wheel(0, -200);
        }
        const s = await state();
        expect(
          s.dialog && stable(s) === stable(before) && !s.context && s.zoom === before.zoom,
          'Clicks, right-clicks and wheel outside the dialog are inert',
          { missed },
        );
      },
      'manual',
    );

    await check(
      'B08',
      'Forced choices are prechecked and disabled (native skips an entirely forced dialog)',
      async (expect) => {
        await row('Main.F').dblclick();
        await dialog.waitFor();
        let s = await state();
        await shot('B08-forced');
        expect(
          same(s.dialog.checked, [[true, true]]) &&
            !s.dialog.fireDisabled &&
            s.dialog.disabledBoxes === 2,
          'Both X tokens prechecked and disabled, Fire enabled immediately',
          s.dialog,
        );
        expect(
          (await box(0, 0).isDisabled()) && (await box(0, 1).isDisabled()),
          'Forced tokens cannot be unchecked',
        );
        await dialog.getByRole('button', { name: 'Fire' }).click();
        s = await state();
        expect(
          !s.dialog &&
            same(s.ages.x, []) &&
            same(s.ages.q, ['0']) &&
            s.history.at(-1) === '1 Fire Main.F · time 0',
          'Forced firing consumes both X tokens',
          s.ages,
        );
        await sim('Back').click();
        await clickNode('t');
        await dialog.waitFor();
        s = await state();
        expect(
          same(s.dialog.checked, [
            [false, false],
            [false, false, false],
          ]),
          'Unforced inputs start unchecked',
          s.dialog.checked,
        );
      },
      'manual',
    );

    await check(
      'B09',
      'Source and inhibitor-only transitions fire immediately in Manual',
      async (expect) => {
        const random = (await state()).random;
        await row('Main.S').dblclick();
        let s = await state();
        expect(
          !s.dialog && s.cursor === 1 && s.history.at(-1) === '1 Fire Main.S · time 0',
          'Source S: no dialog',
        );
        await clickNode('u');
        s = await state();
        expect(
          !s.dialog &&
            s.cursor === 2 &&
            s.history.at(-1) === '2 Fire Main.U · time 0' &&
            same(s.ages.q, ['0', '0']),
          'Inhibitor-only U: no dialog',
          s.history,
        );
        expect(s.random === random, 'No random calls');
      },
      'manual',
    );

    await check(
      'B10',
      'Every fire entry point opens the same draft and Escape restores focus',
      async (expect) => {
        const before = await state();
        const entries = [
          ['canvas click', () => clickNode('t')],
          [
            'canvas Enter',
            async () => {
              await page.locator('[data-node="t"]').focus();
              await key('Enter');
            },
          ],
          [
            'canvas Space',
            async () => {
              await page.locator('[data-node="t"]').focus();
              await key('Space');
            },
          ],
          [
            'inspector Fire',
            async () => {
              await row('Main.T').click();
              await page.locator('.inspector .fire-button, aside .fire-button').last().click();
            },
          ],
          [
            'sidebar Fire',
            async () => {
              await row('Main.T').click();
              await sidebarFire().click();
            },
          ],
          ['row double-click', () => row('Main.T').dblclick()],
          [
            'row Enter',
            async () => {
              await row('Main.T').focus();
              await key('Enter');
            },
          ],
          ['Step', () => sim('Step').click()],
          [
            'Simulator menu Next marking',
            async () => {
              await page.locator('summary', { hasText: /^Simulator$/ }).click();
              await btn('Next marking').click();
            },
          ],
          [
            'context menu Fire transition',
            async () => {
              const p = await nodePoint('t');
              await page.mouse.click(p.x, p.y, { button: 'right' });
              await page
                .getByRole('menuitem', { name: 'Fire transition' })
                .or(btn('Fire transition').last())
                .first()
                .click();
            },
          ],
        ];
        for (const [name, open] of entries) {
          await open();
          const opened = await dialog.waitFor({ timeout: 2000 }).then(
            () => true,
            () => false,
          );
          await page.waitForTimeout(60);
          let s = await state();
          expect(
            opened &&
              s.draft?.transition === 't' &&
              s.focusInDialog &&
              same(s.dialog.checked, [
                [false, false],
                [false, false, false],
              ]),
            `${name}: draft for T, focus inside, nothing pre-toggled by the triggering input`,
            { opened, focus: s.focus, checked: s.dialog?.checked, error: s.error },
          );
          const focusBefore = name;
          await key('Escape');
          s = await state();
          expect(
            !s.dialog && stable(s) === stable(before),
            `${name}: Escape cancels with no state change`,
            { focus: s.focus },
          );
          if (name === 'context menu Fire transition' || name === 'Simulator menu Next marking')
            expect(
              s.focus && !/^body/.test(s.focus),
              `${focusBefore}: focus lands on a connected control after Escape`,
              s.focus,
            );
        }
      },
      'manual',
    );

    await check(
      'B11',
      'Persisted data, saves and copy never include simulated ages',
      async (expect) => {
        await modeButton('Edit').click();
        const tapn = await saveTapn('B11-before.tapn');
        const json = await saveJson('B11-before.json');
        const warning = await page
          .locator('text=TAPAAL 4.0.4')
          .first()
          .textContent()
          .catch(() => null);
        await modeButton('Simulate').click();
        await policy('manual');
        await clickNode('t');
        await dialog.waitFor();
        await box(0, 0).click();
        await box(1, 0).click();
        await box(1, 1).click();
        await dialog.getByRole('button', { name: 'Fire' }).click();
        await page.locator('#delay-amount').fill('0.5');
        await page
          .locator('[aria-label="Time and token selection"]')
          .getByRole('button', { name: 'Delay' })
          .click();
        let s = await state();
        expect(
          same(s.ages.p, ['1', '2.5', '3.5', '6.5']) && s.cursor === 2,
          'Simulated ages advanced',
          s.ages,
        );
        const tapnAfter = await saveTapn('B11-during.tapn');
        const jsonAfter = await saveJson('B11-during.json');
        expect(
          tapn && tapn === tapnAfter && json && json === jsonAfter,
          'TAPN and JSON saved mid-simulation are byte-identical to the pre-simulation saves',
        );
        expect(
          /initialMarking="5"/.test(tapnAfter) && /0\.5/.test(jsonAfter) && /"6"/.test(jsonAfter),
          'Saved files carry initial marking and initial ages',
        );
        s = await state();
        expect(
          /4\.0\.4/.test(warning ?? '') || /4\.0\.4/.test(s.notice ?? ''),
          'Existing initial-age loss warning remains visible',
          [warning, s.notice],
        );
        await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
        await clickNode('p');
        await page.locator('svg.net-canvas').focus();
        await key('Control+c');
        await page.waitForTimeout(200);
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        s = await state();
        expect(
          clip === 'sentinel' || (!/6\.5|3\.5/.test(clip) && /2\.5/.test(clip)),
          'Copy in Simulate does not carry simulated ages (either refused or initial ages only)',
          { clip: clip.slice(0, 200), notice: s.notice },
        );
        expect(s.cursor === 2 && s.mode === 'Simulate', 'Copy leaves the simulation untouched');
      },
    );

    await record('B12', 'Two-component disjoint timed execution is supported', async (expect) => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
      await openFile(MULTI);
      await modeButton('Simulate').click();
      const s = await state();
      expect(s.mode === 'Simulate' && !s.error, 'Simulate enters the timed network run', s.error);
      expect(
        (await page.locator('#token-policy').count()) === 1,
        'Global token policy control shown',
      );
    });
  } finally {
    await browser.close();
  }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status !== 'pass');
const obs = results.flatMap((r) => r.observations);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed; ${obs.filter((o) => o.ok).length}/${obs.length} assertions; output ${OUT}`,
);
process.exit(failed.length ? 1 : 0);
