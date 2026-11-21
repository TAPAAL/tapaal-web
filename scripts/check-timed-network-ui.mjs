#!/usr/bin/env node
// Independent browser validation of disjoint timed multi-component simulation in the UI
// (see design/TIMED-NETWORK-UI-VALIDATION.md). Drives a running development build with real
// Playwright mouse, keyboard, checkbox and file-chooser input. App signals and rendered DOM are
// only read; no App methods or signal setters are invoked. The only non-pointer focus move is
// `locator.focus()` on an enabled-row button before a real Enter key, because clicking a row
// deliberately switches the view and the Enter path is the UI's non-switching fire route.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-timed-network-ui.mjs http://127.0.0.1:4397 /tmp/tapaal-timed-network-ui/run
//
// Exit status 1 when any check fails. Results: <out>/results.json, fixtures, downloads and
// screenshots in <out>. ONLY=N01,N05 restricts the run.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4397';
const OUT = process.argv[3] ?? '/tmp/tapaal-timed-network-ui/run';
const ONLY = process.env.ONLY?.split(',');
mkdirSync(OUT, { recursive: true });

// ---- fixtures --------------------------------------------------------------------------------
const TYPE = { timed: true, colored: false, game: false, stochastic: false };
const place = (id, name, x, y, tokens = 0) => ({ id, name, kind: 'place', tokens, x, y });
const transition = (id, name, x, y) => ({ id, name, kind: 'transition', tokens: 0, x, y });
const arc = (id, source, target, weight = 1) => ({ id, source, target, kind: 'normal', weight });
const timing = (t = {}) => ({
  intervals: {},
  invariants: {},
  urgent: [],
  transports: [],
  ages: {},
  ...t,
});
const inv = (upper, upperClosed = true) => ({ upper, upperClosed });
function network(name, components, type = TYPE, extra = {}) {
  return {
    format: 'tapaal-web-network',
    version: 1,
    network: {
      name,
      type,
      components: components.map(([id, template, nodes, arcs, t, active = true]) => ({
        id,
        active,
        net: { name, template, nodes, arcs },
        timing: timing(t),
      })),
      ...extra,
    },
  };
}
function write(file, value) {
  const path = join(OUT, file);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}
// Every component reuses local IDs p/t/q/i/o and names P/T/Q.
// Alpha (active):  P(0.1, 2.50, <=5) -i-> T -o-> Q.
// Beta (active):   P(0.5, 1, 1.5, 3) =2=> T =2=> Q(<=2) weighted transport;
//                  S(0.5, <2) occupied strict invariant; R(empty, <1); Z -> U urgent.
// Gamma (inactive): P(0.25, <1) -i-> T urgent -o-> Q.
// Expected initial legal delay: [0,1.5) — Beta.S only; R, Gamma and Beta.U must not restrict it.
function trio(name, zTokens) {
  return network(name, [
    [
      'a',
      'Alpha',
      [place('p', 'P', 150, 150, 2), transition('t', 'T', 350, 150), place('q', 'Q', 550, 150)],
      [arc('i', 'p', 't'), arc('o', 't', 'q')],
      { invariants: { p: inv('5') }, ages: { p: ['0.1', '2.50'] } },
    ],
    [
      'b',
      'Beta',
      [
        place('p', 'P', 150, 150, 4),
        transition('t', 'T', 350, 150),
        place('q', 'Q', 550, 150),
        place('s', 'S', 150, 330, 1),
        place('r', 'R', 350, 330),
        place('z', 'Z', 150, 480, zTokens),
        transition('u', 'U', 350, 480),
      ],
      [arc('i', 'p', 't', 2), arc('o', 't', 'q', 2), arc('zu', 'z', 'u')],
      {
        invariants: { q: inv('2'), s: inv('2', false), r: inv('1', false) },
        ages: { p: ['0.5', '1', '1.5', '3'], s: ['0.5'] },
        transports: [{ inputArc: 'i', outputArc: 'o' }],
        urgent: ['u'],
      },
    ],
    [
      'c',
      'Gamma',
      [place('p', 'P', 150, 150, 1), transition('t', 'T', 350, 150), place('q', 'Q', 550, 150)],
      [arc('i', 'p', 't'), arc('o', 't', 'q')],
      { invariants: { p: inv('1', false) }, ages: { p: ['0.25'] }, urgent: ['t'] },
      false,
    ],
  ]);
}
const TRIO = write('trio.json', trio('Trio', 0));
const URGENT = write('trio-urgent.json', trio('Trio urgent', 1));
const SECOND = write('second.json', trio('Second', 0));
const flags = (over) => ({ ...TYPE, ...over });
const one = [
  [
    'a',
    'Alpha',
    [place('p', 'P', 150, 150, 1), transition('t', 'T', 350, 150)],
    [arc('i', 'p', 't')],
    {},
  ],
  [
    'b',
    'Beta',
    [place('p', 'P', 150, 150, 1), transition('t', 'T', 350, 150)],
    [arc('i', 'p', 't')],
    {},
  ],
];
const UNSUPPORTED = {
  colored: write('colored.json', network('Coloured', one, flags({ colored: true }))),
  game: write('game.json', network('Game', one, flags({ game: true }))),
  stochastic: write('stochastic.json', network('Stochastic', one, flags({ stochastic: true }))),
  shared: write('shared.json', network('Shared', one, TYPE, { sharedPlaces: [] })),
  constants: write('constants.json', network('Constants', one, TYPE, { constants: [] })),
};

// ---- browser and read-only state -------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
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
    const text = (sel) => document.querySelector(sel)?.textContent.trim().replace(/\s+/g, ' ');
    const all = (sel) =>
      [...document.querySelectorAll(sel)].map((e) => e.textContent.trim().replace(/\s+/g, ' '));
    const dialog = document.querySelector('app-token-selection-dialog form');
    return {
      docCount: ws.documents.length,
      docNames: ws.documents.map((d) => d.network.name),
      network: doc && JSON.stringify(doc.network),
      past: doc?.past.length,
      componentId: doc?.session.componentId,
      mode: app.mode(),
      error: app.error(),
      notice: app.notice(),
      selectedIds: app.selectedIds(),
      cursor: app.cursor(),
      canForward: app.canForward(),
      time: text('[aria-label="Time and token selection"] h2'),
      legal: text('[aria-label="Time and token selection"] [role=status]'),
      ages: all('[aria-label="Time and token selection"] p').filter((t) => /^\S+: /.test(t)),
      enabled: all('.enabled-row'),
      inactiveNote: text('.inactive-note'),
      deadlock: text('.deadlock-note'),
      count: text('.simulation-count'),
      history: all('.history-row'),
      // Whole-network marking of the current history entry (title = every component's ages).
      marking: document.querySelector('.history-row.current')?.getAttribute('title') ?? null,
      components: all('.component-row'),
      activeRow: text('.component-row.active'),
      checkboxes: [...document.querySelectorAll('.component-entry input[type=checkbox]')].map(
        (c) => ({ checked: c.checked, disabled: c.disabled }),
      ),
      ageWarning: [...document.querySelectorAll('p')].some((p) =>
        /TAPAAL 4\.0\.4 (loses|resets)/.test(p.textContent),
      ),
      banner: text('.error-banner'),
      dialog: dialog && {
        title: dialog.querySelector('h2')?.textContent.trim(),
        legends: [...dialog.querySelectorAll('legend')].map((l) =>
          l.textContent.trim().replace(/\s+/g, ' '),
        ),
        counts: [...dialog.querySelectorAll('fieldset > p')].map((p) => p.textContent.trim()),
        tokens: [...dialog.querySelectorAll('label')].map((l) => ({
          text: l.textContent.trim().replace(/\s+/g, ' '),
          checked: l.querySelector('input').checked,
          disabled: l.querySelector('input').disabled,
        })),
        fireDisabled: dialog.querySelector('button[type=submit]').disabled,
        alert: dialog.querySelector('[role=alert]')?.textContent.trim() ?? null,
      },
      focus: (() => {
        const a = document.activeElement;
        if (!a || a === document.body) return 'body';
        return (
          (a.closest('app-token-selection-dialog') ? 'dialog:' : '') +
          a.tagName.toLowerCase() +
          (a.getAttribute('type') ? `[${a.getAttribute('type')}]` : '') +
          (a.classList.length ? '.' + [...a.classList].join('.') : '') +
          ' ' +
          a.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)
        ).trim();
      })(),
      domSelection: String(window.getSelection()),
    };
  });
};

// ---- real input helpers ----------------------------------------------------------------------
const btn = (name) => page.getByRole('button', { name, exact: true });
const key = (k) => page.keyboard.press(k);
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const sim = (name) =>
  page.locator('[aria-label="Simulation control"]').getByRole('button', { name });
async function openFile(path) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page
      .locator('[aria-label="Document toolbar"]')
      .getByRole('button', { name: 'Open model' })
      .click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForTimeout(150);
  const accept = btn('Open in new tab');
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await settle();
}
async function download(trigger, name) {
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 3000 }).catch(() => null),
    trigger(),
  ]);
  if (!file) return null;
  const path = join(OUT, name);
  await file.saveAs(path);
  return { path, text: readFileSync(path, 'utf8') };
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
const simulate = () => modeButton('Simulate').click();
const edit = () => modeButton('Edit').click();
async function delay(amount) {
  const field = page.locator('#delay-amount');
  await field.click({ clickCount: 3 });
  await page.keyboard.type(amount);
  await page
    .locator('[aria-label="Time and token selection"]')
    .getByRole('button', { name: 'Delay' })
    .click();
}
const policy = (value) => page.locator('#token-policy').selectOption(value);
const view = (template) =>
  page.locator('.component-row', { hasText: new RegExp(`^\\s*${template}\\b`) }).click();
const row = (name) => page.locator('.enabled-row', { hasText: name });
/** Fires from the current view without switching: focus the global enabled row, real Enter. */
async function enterRow(name) {
  await row(name).focus();
  await key('Enter');
  await settle();
}
const dialog = () => page.locator('app-token-selection-dialog form');
const tokenBox = (n) => dialog().locator('label').nth(n).locator('input');
async function fresh() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (s, part) => typeof s === 'string' && s.includes(part);
async function openTrio(path = TRIO) {
  await openFile(path);
  await simulate();
  await view('Alpha');
  await policy('oldest');
}
const INITIAL_MARKING =
  'Alpha.P: 0.1 · Alpha.P: 2.50 · Beta.P: 0.5 · Beta.P: 1 · Beta.P: 1.5 · Beta.P: 3 · Beta.S: 0.5 · Gamma.P: 0.25';

try {
  await check(
    'N01',
    'Three components, duplicate local IDs, initial global view',
    async (expect) => {
      await openFile(TRIO);
      let s = await state();
      expect(
        same(s.components, ['Alpha', 'Beta', 'Gamma (inactive)']),
        'Component rows label inactive Gamma',
        s.components,
      );
      const before = s.network;
      await simulate();
      s = await state();
      expect(
        s.mode === 'Simulate' && !s.error,
        'Multi-component timed network enters simulation',
        s.error,
      );
      expect(s.time === 'Global time: 0', 'Global time 0', s.time);
      expect(has(s.legal, '[0,1.5)'), 'Legal delay is Beta.S strict bound only', s.legal);
      expect(
        same(s.enabled, ['Alpha.T', 'Beta.T']),
        'Global enabled refs exclude inactive/urgent-unenabled',
        s.enabled,
      );
      expect(
        s.marking === INITIAL_MARKING,
        'Whole initial marking incl. inactive projection',
        s.marking,
      );
      expect(
        s.checkboxes.every((c) => c.disabled),
        'Activity checkboxes disabled in simulation',
      );
      await view('Gamma');
      s = await state();
      expect(
        s.activeRow === 'Gamma (inactive)' && s.mode === 'Simulate',
        'Viewing inactive Gamma keeps the run',
      );
      expect(has(s.inactiveNote, 'inactive'), 'Inactive note shown', s.inactiveNote);
      expect(same(s.ages, ['P: 0.25', 'Q: empty']), 'Gamma frozen ages', s.ages);
      expect(
        same(s.enabled, ['Alpha.T', 'Beta.T']) && has(s.legal, '[0,1.5)'),
        'Global list/interval unchanged in inactive view',
      );
      await view('Beta');
      s = await state();
      expect(
        same(s.ages, ['P: 0.5, 1, 1.5, 3', 'Q: empty', 'S: 0.5', 'R: empty', 'Z: empty']),
        'Beta local ages despite duplicate IDs',
        s.ages,
      );
      await edit();
      s = await state();
      expect(s.network === before, 'Simulation left document untouched');
      await shot('N01-beta');
    },
  );

  await check(
    'N02',
    'Exact 0.1 + 0.2 global delay; inactive frozen; strict and empty invariants',
    async (expect) => {
      await openTrio();
      await delay('0.1');
      await delay('0.2');
      let s = await state();
      expect(s.time === 'Global time: 0.3', 'Global time exactly 0.3', s.time);
      expect(
        s.marking ===
          'Alpha.P: 0.4 · Alpha.P: 2.8 · Beta.P: 0.8 · Beta.P: 1.3 · Beta.P: 1.8 · Beta.P: 3.3 · Beta.S: 0.8 · Gamma.P: 0.25',
        'All active ages +0.3, inactive unchanged',
        s.marking,
      );
      expect(same(s.ages, ['P: 0.4, 2.8', 'Q: empty']), 'Alpha view ages', s.ages);
      expect(
        same(s.history, [
          '0Initial marking · time 0',
          '1Delay 0.1 · time 0.1',
          '2Delay 0.2 · time 0.3',
        ]),
        'History labels with global time',
        s.history,
      );
      expect(
        has(s.legal, '[0,1.2)'),
        'Legal delay [0,1.2) from remote strict Beta.S (empty R ignored)',
        s.legal,
      );
      await delay('1.2');
      let f = await state();
      expect(
        !!f.error && f.cursor === 2 && f.time === s.time && f.marking === s.marking,
        'Strict bound 1.2 refused immutably',
        f.error,
      );
      await sim('Back').click();
      s = await state();
      await delay('5');
      f = await state();
      expect(
        !!f.error && f.cursor === 1 && f.canForward && f.history.length === 3,
        'Failed delay after Back keeps cursor and future',
        { error: f.error, cursor: f.cursor, history: f.history },
      );
      await delay('abc');
      f = await state();
      expect(
        !!f.error && f.cursor === 1 && f.history.length === 3,
        'Malformed delay refused',
        f.error,
      );
      await delay('1.19');
      f = await state();
      expect(
        f.cursor === 2 && f.history.length === 3 && !f.canForward && f.time === 'Global time: 1.29',
        'Legal delay after Back branches',
        f.history,
      );
    },
  );

  await check(
    'N03',
    'Urgency: enabled active urgent elsewhere blocks; inactive urgent does not',
    async (expect) => {
      await openTrio(URGENT);
      let s = await state();
      expect(same(s.enabled, ['Alpha.T', 'Beta.T', 'Beta.U']), 'Beta.U enabled', s.enabled);
      expect(has(s.legal, '[0,0]'), 'Alpha view shows [0,0] from Beta urgency', s.legal);
      await delay('0.1');
      s = await state();
      expect(!!s.error && s.cursor === 0, 'Positive delay refused', s.error);
      await delay('0');
      s = await state();
      expect(s.cursor === 1 && !s.error, 'Zero delay accepted', s.error);
      await enterRow('Beta.U');
      s = await state();
      expect(
        s.activeRow === 'Alpha' && has(s.history.at(-1), 'Fire Beta.U · time 0'),
        'Beta.U fired from Alpha view',
        s.history,
      );
      expect(
        has(s.legal, '[0,1.5)'),
        'Interval reopens once urgency is gone; inactive urgent Gamma.T ignored',
        s.legal,
      );
      await delay('0.1');
      s = await state();
      expect(s.time === 'Global time: 0.1' && !s.error, 'Positive delay now accepted', s.error);
    },
  );

  await check('N04', 'Local ordinary fire changes only its component', async (expect) => {
    await openTrio();
    await delay('0.1');
    await row('Alpha.T').dblclick();
    const s = await state();
    expect(has(s.history.at(-1), 'Fire Alpha.T · time 0.1'), 'Qualified history', s.history);
    expect(
      s.marking ===
        'Alpha.P: 0.2 · Alpha.Q: 0 · Beta.P: 0.6 · Beta.P: 1.1 · Beta.P: 1.6 · Beta.P: 3.1 · Beta.S: 0.6 · Gamma.P: 0.25',
      'Oldest consumed in Alpha only; fresh age 0 output; Beta/Gamma unchanged',
      s.marking,
    );
  });

  await check(
    'N05',
    'Manual weighted transport from inactive view resolves origin component',
    async (expect) => {
      await openTrio();
      await view('Gamma');
      await policy('manual');
      await enterRow('Beta.T');
      let s = await state();
      expect(
        s.dialog?.title === 'Select tokens for Beta.T',
        'Dialog names Beta.T',
        s.dialog?.title,
      );
      expect(
        same(s.dialog?.legends, ['P → Beta.T → Q (transport)']),
        'Beta place/destination names',
        s.dialog?.legends,
      );
      expect(
        same(
          s.dialog?.tokens.map((t) => t.text),
          ['Token 1 · age 0.5', 'Token 2 · age 1', 'Token 3 · age 1.5'],
        ),
        'Only destination-invariant-eligible Beta tokens (age 3 excluded)',
        s.dialog?.tokens,
      );
      expect(
        s.dialog?.fireDisabled && same(s.dialog.counts, ['Selected 0 of 2 required']),
        'Fire disabled until weight 2',
        s.dialog?.counts,
      );
      expect(s.focus.startsWith('dialog:'), 'Focus moved into dialog', s.focus);
      await tokenBox(1).click();
      await tokenBox(2).click();
      s = await state();
      expect(!s.dialog.fireDisabled, 'Exact selection enables Fire');
      await dialog().getByRole('button', { name: 'Fire' }).click();
      s = await state();
      expect(
        !s.dialog && s.activeRow === 'Gamma (inactive)',
        'Fired without leaving Gamma view',
        s.activeRow,
      );
      expect(
        s.marking ===
          'Alpha.P: 0.1 · Alpha.P: 2.50 · Beta.P: 0.5 · Beta.P: 3 · Beta.Q: 1 · Beta.Q: 1.5 · Beta.S: 0.5 · Gamma.P: 0.25',
        'Chosen Beta ages transported; Alpha and Gamma unchanged',
        s.marking,
      );
      expect(has(s.history.at(-1), 'Fire Beta.T · time 0'), 'Qualified history', s.history);
      expect(has(s.legal, '[0,0.5]'), 'Occupied Beta.Q <=2 now limits to [0,0.5]', s.legal);
      expect(s.focus !== 'body', 'Focus not lost after close', s.focus);
      await sim('Back').click();
      await sim('Forward').click();
      s = await state();
      expect(
        !s.dialog && s.cursor === 1 && has(s.marking, 'Beta.Q: 1 · Beta.Q: 1.5'),
        'Forward replays without dialog',
        s.marking,
      );
      await shot('N05-after');
    },
  );

  await check(
    'N06',
    'Manual cancel/expiry: Escape, cancel after Back keeps future, view change',
    async (expect) => {
      await openTrio();
      await delay('0.1');
      await sim('Back').click();
      await policy('manual');
      await row('Alpha.T').dblclick();
      let s = await state();
      expect(!!s.dialog, 'Dialog opens after Back');
      await key('Escape');
      s = await state();
      expect(
        !s.dialog && s.cursor === 0 && s.canForward && s.history.length === 2,
        'Escape keeps cursor and future',
        s.history,
      );
      // A view change needs the component row, which the modal backdrop covers; try a real click.
      await row('Alpha.T').dblclick();
      const blocked = await page
        .locator('.component-row', { hasText: 'Beta' })
        .click({ timeout: 800 })
        .then(() => 'clicked')
        .catch(() => 'blocked');
      s = await state();
      expect(
        blocked === 'blocked' && !!s.dialog && s.activeRow === 'Alpha',
        'Modal blocks view change while drafting',
        blocked,
      );
      await key('Escape');
      await view('Beta');
      s = await state();
      expect(
        s.activeRow === 'Beta' && s.cursor === 0 && s.canForward && s.history.length === 2,
        'View change preserves run/future',
        s.history,
      );
    },
  );

  await check('N07', 'Oldest / youngest / random policies across views', async (expect) => {
    await openTrio();
    await view('Gamma');
    await policy('oldest');
    await enterRow('Beta.T');
    let s = await state();
    expect(
      has(s.marking, 'Beta.P: 0.5 · Beta.P: 3 · Beta.Q: 1.5 · Beta.Q: 1'),
      'Oldest eligible 1.5,1 (not 3)',
      s.marking,
    );
    await sim('Reset').click();
    await policy('youngest');
    await enterRow('Beta.T');
    s = await state();
    expect(
      has(s.marking, 'Beta.P: 1.5 · Beta.P: 3 · Beta.Q: 0.5 · Beta.Q: 1'),
      'Youngest eligible 0.5,1',
      s.marking,
    );
    await view('Alpha');
    await enterRow('Alpha.T');
    s = await state();
    expect(has(s.marking, 'Alpha.P: 2.50 · Alpha.Q: 0'), 'Youngest Alpha consumes 0.1', s.marking);
    const seen = new Set();
    let bad = [];
    await policy('random');
    for (let k = 0; k < 12; k++) {
      await sim('Reset').click();
      await view(k % 2 ? 'Gamma' : 'Beta');
      await enterRow('Beta.T');
      s = await state();
      const q = /Beta\.Q: [^·]+(?: · Beta\.Q: [^·]+)?/.exec(s.marking)?.[0];
      seen.add(q);
      if (!has(s.marking, 'Beta.P: 3') || has(q, ': 3') || s.dialog) bad.push(s.marking);
      await sim('Back').click();
      const before = (await state()).marking;
      await sim('Forward').click();
      const after = (await state()).marking;
      if (after !== s.marking || before !== INITIAL_MARKING) bad.push({ replay: after, before });
    }
    expect(
      !bad.length,
      'Random never takes ineligible age 3; Forward replays identical choice',
      bad,
    );
    expect(seen.size >= 2, 'Random sampled more than one pair', [...seen]);
  });

  await check(
    'N08',
    'History Back/Forward/Reset/jump/branch keep one global time/marking',
    async (expect) => {
      await openTrio();
      await delay('0.1');
      await row('Alpha.T').dblclick();
      await view('Alpha');
      await policy('manual');
      await enterRow('Beta.T');
      await tokenBox(0).click();
      await tokenBox(2).click();
      await dialog().getByRole('button', { name: 'Fire' }).click();
      await delay('0.2');
      const end = await state();
      expect(
        end.history.length === 5 && end.time === 'Global time: 0.3',
        'Four actions recorded',
        end.history,
      );
      await page.locator('.history-row').nth(1).click();
      let s = await state();
      expect(
        s.cursor === 1 && s.time === 'Global time: 0.1' && s.canForward,
        'Jump to row 1',
        s.time,
      );
      await page.locator('.history-row').nth(4).click();
      s = await state();
      expect(
        s.cursor === 4 && s.marking === end.marking && !s.dialog,
        'Jump forward restores snapshot without prompt',
        s.marking,
      );
      await sim('Back').click();
      await sim('Back').click();
      await sim('Forward').click();
      s = await state();
      expect(!s.dialog && s.cursor === 3, 'Forward over manual fire does not prompt');
      await sim('Reset').click();
      s = await state();
      expect(
        s.time === 'Global time: 0' && s.marking === INITIAL_MARKING && s.cursor === 0,
        'Reset restores initial ages and time',
        s.marking,
      );
      expect(
        s.history.length === 1 && !s.canForward,
        'Reset clears the trace (TimedSimulation.reset)',
        s.history,
      );
      // Rebuild the same run to exercise jump/branch after Reset.
      await policy('oldest');
      await delay('0.1');
      await row('Alpha.T').dblclick();
      await policy('manual');
      await enterRow('Beta.T');
      await tokenBox(0).click();
      await tokenBox(2).click();
      await dialog().getByRole('button', { name: 'Fire' }).click();
      await delay('0.2');
      s = await state();
      expect(
        s.marking === end.marking,
        'Rebuilt run after Reset reaches the same marking',
        s.marking,
      );
      await view('Gamma');
      await policy('oldest');
      await page.locator('.history-row').nth(2).click();
      await delay('0.05');
      s = await state();
      expect(
        s.history.length === 4 && has(s.history[3], 'Delay 0.05 · time 0.15') && !s.canForward,
        'Branch from inactive view truncates future',
        s.history,
      );
      expect(
        s.marking ===
          'Alpha.P: 0.25 · Alpha.Q: 0.05 · Beta.P: 0.65 · Beta.P: 1.15 · Beta.P: 1.65 · Beta.P: 3.15 · Beta.S: 0.65 · Gamma.P: 0.25',
        'Branch ages from the post-Alpha.T snapshot; inactive frozen',
        s.marking,
      );
    },
  );

  await check('N09', 'Step from inactive view fires global first enabled', async (expect) => {
    await openTrio();
    await view('Gamma');
    await sim('Step').click();
    const s = await state();
    expect(
      has(s.history.at(-1), 'Fire Alpha.T') && s.activeRow === 'Gamma (inactive)',
      'Step fired Alpha.T, view stays Gamma',
      s.history,
    );
    expect(has(s.count, 'Network step 1'), 'Network step label', s.count);
    await policy('manual');
    await sim('Back').click();
    await sim('Forward').click();
    const f = await state();
    expect(!f.dialog && f.cursor === 1, 'Step with a future replays (no manual prompt)', f.dialog);
  });

  await check(
    'N10',
    'Mid-run TAPN/JSON saves are the initial whole network; reopen exact',
    async (expect) => {
      await openFile(TRIO);
      const opened = await state();
      expect(opened.ageWarning, '4.0.4 age-loss warning shown');
      const tapn0 = await saveTapn('initial.tapn');
      const json0 = await saveJson('initial.json');
      await simulate();
      await delay('0.1');
      await row('Alpha.T').dblclick();
      await enterRow('Beta.T');
      const mid = await state();
      const tapn1 = await saveTapn('midrun.tapn');
      const json1 = await saveJson('midrun.json');
      const after = await state();
      expect(
        after.mode === 'Simulate' && after.cursor === mid.cursor,
        'Saving keeps the run',
        after.mode,
      );
      expect(tapn0 && tapn1 && tapn0.text === tapn1.text, 'TAPN mid-run byte-identical to initial');
      expect(json0 && json1 && json0.text === json1.text, 'JSON mid-run byte-identical to initial');
      const t = tapn1?.text ?? '';
      expect(/<net id="Gamma" active="false"/.test(t), 'Inactive Gamma written inactive');
      expect(
        (t.match(/<token age="/g) ?? []).length === 8,
        'Eight nonzero initial ages written',
        t.match(/<token age="[^"]+"/g),
      );
      expect(
        /type="transport" weight="2"/.test(t) && (t.match(/type="transport"/g) ?? []).length === 2,
        'Weighted transport pair retained',
      );
      expect(
        /invariant="&lt; 2"/.test(t) && /invariant="&lt;= 2"/.test(t),
        'Strict and non-strict invariants retained',
      );
      expect(/urgent="true"/.test(t), 'Urgency retained');
      const original = JSON.parse(readFileSync(TRIO, 'utf8')).network;
      const saved = JSON.parse(json1.text).network;
      expect(
        same(saved.components, original.components) && same(saved.type, original.type),
        'JSON components/type equal source',
        saved.components,
      );
      await openFile(json1.path);
      let s = await state();
      expect(
        s.docCount === opened.docCount + 1 &&
          same(JSON.parse(s.network).components, original.components),
        'Reopened JSON exact',
        { count: s.docCount, error: s.error, names: s.docNames },
      );
      await openFile(tapn1.path);
      s = await state();
      const reopened = JSON.parse(s.network);
      const semantic = (n) =>
        n.components.map((c) => ({
          template: c.net.template,
          active: c.active,
          nodes: c.net.nodes.map((x) => [x.name, x.kind, x.tokens]).sort(),
          timing: c.timing,
          arcs: c.net.arcs.length,
        }));
      const norm = (n) =>
        semantic(n).map((c) => ({ ...c, timing: { ...c.timing, intervals: {} } }));
      expect(s.docCount === opened.docCount + 2, 'Reopened TAPN in new tab', {
        count: s.docCount,
        error: s.error,
        names: s.docNames,
      });
      expect(
        same(
          norm(reopened).map((c) => [c.template, c.active, c.nodes]),
          norm(original).map((c) => [c.template, c.active, c.nodes]),
        ),
        'TAPN reopen keeps components, activity, names, counts',
        norm(reopened),
      );
      const ageMap = (n) => n.components.map((c) => c.timing.ages);
      const toTemplate = (n, x) => {
        // Native IDs may differ; compare ages/invariants by node name.
        return n.components.map((c) =>
          Object.fromEntries(
            Object.entries(c.timing[x]).map(([id, v]) => [
              c.net.nodes.find((k) => k.id === id)?.name,
              v,
            ]),
          ),
        );
      };
      expect(
        same(toTemplate(reopened, 'ages'), toTemplate(original, 'ages')),
        'TAPN reopen keeps ages incl. inactive',
        ageMap(reopened),
      );
      expect(
        same(toTemplate(reopened, 'invariants'), toTemplate(original, 'invariants')),
        'TAPN reopen keeps invariants',
      );
      expect(
        same(
          reopened.components.map((c) => c.timing.transports.length),
          [0, 1, 0],
        ),
        'TAPN reopen keeps transport',
      );
      const betaArcs = reopened.components[1].net.arcs.filter((a) => a.weight === 2).length;
      expect(betaArcs === 2, 'TAPN reopen keeps weight 2 on both transport halves', betaArcs);
    },
  );

  await check(
    'N11',
    'Tab switch ends run; editing/clipboard shortcuts blocked in simulation',
    async (expect) => {
      await openFile(SECOND);
      await openFile(TRIO);
      await simulate();
      await delay('0.1');
      await view('Beta');
      await page.locator('svg.net-canvas').click({ position: { x: 5, y: 5 } });
      let s = await state();
      const doc = s.network,
        past = s.past;
      for (const k of [
        'Control+a',
        'Control+c',
        'Control+x',
        'Control+v',
        'Control+d',
        'Delete',
        'Control+z',
        'Control+y',
      ])
        await key(k);
      s = await state();
      expect(
        s.mode === 'Simulate' && s.network === doc && s.past === past && s.cursor === 1,
        'Shortcuts leave document and run unchanged',
        { past: s.past, mode: s.mode, notice: s.notice },
      );
      await page.locator('.document-tab button:first-child').first().click();
      s = await state();
      expect(s.mode === 'Edit', 'Switching tab ends simulation', s.mode);
      await page.locator('.document-tab button:first-child').nth(1).click();
      await simulate();
      s = await state();
      expect(
        s.history.length === 1 && s.time === 'Global time: 0',
        'New run has no leaked history',
        s.history,
      );
    },
  );

  await check('N12', 'Saved query references unchanged through a run and save', async (expect) => {
    await openFile(TRIO);
    const base = await state();
    const tapn = await saveTapn('trio-base.tapn');
    const query = '<query active="true" name="BetaQ" type="Default" query="EF Beta.Q &gt;= 2"/>';
    const withQuery = write('trio-query.tapn', tapn.text.replace('</pnml>', `  ${query}\n</pnml>`));
    await openFile(withQuery);
    let s = await state();
    expect(s.docCount === base.docCount + 1 && !s.error, 'Query TAPN opens', {
      count: s.docCount,
      error: s.error,
      names: s.docNames,
      n: s.notice,
    });
    await simulate();
    await view('Gamma');
    await enterRow('Beta.T');
    await delay('0.2');
    const saved = await saveTapn('trio-query-midrun.tapn');
    expect(
      saved?.text.includes('query="EF Beta.Q &gt;= 2"') && saved.text.includes('name="BetaQ"'),
      'Query text retained',
    );
    s = await state();
    expect(s.mode === 'Simulate', 'Run retained after save');
  });

  await check('N13', 'Unsupported flags/fields refused; no untimed fallback', async (expect) => {
    for (const [kind, path] of Object.entries(UNSUPPORTED)) {
      await fresh();
      const before = await state();
      await openFile(path);
      let s = await state();
      if (s.docCount > before.docCount) {
        await simulate();
        s = await state();
        expect(s.mode === 'Edit' && !!s.error, `${kind}: opened but simulation refused`, {
          error: s.error,
          mode: s.mode,
        });
      } else expect(!!(s.error || s.banner), `${kind}: refused on open`, s.error || s.banner);
    }
  });

  await check(
    'N14',
    'Manual dialog: forced choices, Tab trap, Ctrl+A, focus return',
    async (expect) => {
      await openTrio(URGENT);
      await policy('manual');
      await view('Beta');
      await page.locator('svg.net-canvas').click({ position: { x: 5, y: 5 } });
      const sel = (await state()).selectedIds;
      await enterRow('Beta.U');
      let s = await state();
      expect(
        s.dialog?.tokens.length === 1 &&
          s.dialog.tokens[0].checked &&
          s.dialog.tokens[0].disabled &&
          !s.dialog.fireDisabled,
        'Forced choice prechecked and disabled; Fire enabled',
        s.dialog,
      );
      const stops = [];
      for (let k = 0; k < 4; k++) {
        await key('Tab');
        stops.push((await state()).focus);
      }
      expect(
        stops.every((f) => f.startsWith('dialog:button')),
        'Tab stays among enabled dialog buttons',
        stops,
      );
      await key('Shift+Tab');
      s = await state();
      expect(s.focus.startsWith('dialog:'), 'Shift+Tab stays in dialog', s.focus);
      await key('Control+a');
      s = await state();
      expect(
        same(s.selectedIds, sel) && s.domSelection === '' && !!s.dialog,
        'Ctrl+A blocked inside dialog',
        { sel: s.selectedIds, dom: s.domSelection },
      );
      await dialog().getByRole('button', { name: 'Fire' }).click();
      s = await state();
      expect(!s.dialog && has(s.history.at(-1), 'Fire Beta.U'), 'Forced fire succeeded');
      expect(s.focus !== 'body', 'Focus fallback after the fired row disappears', s.focus);
      await enterRow('Alpha.T');
      await key('Escape');
      s = await state();
      expect(
        !s.dialog && s.cursor === 1 && s.focus !== 'body',
        'Escape closes, focus returned',
        s.focus,
      );
    },
  );
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
const failed = results.filter((r) => r.status !== 'pass');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
