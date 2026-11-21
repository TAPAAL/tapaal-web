#!/usr/bin/env node
// Independent review harness (design/SHARED-TRANSITIONS-REVIEW.md). Real input only; Angular
// state is READ, never written. Usage: node review-shared-transitions-ui.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const base = process.argv[2] ?? 'http://127.0.0.1:4517';
const out = process.argv[3] ?? '/tmp/tapaal-st-review-ui';
const web = resolve(import.meta.dirname, '..');
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
const results = [];
let assertions = 0;
const check = (condition, label, detail = '') => {
  results.push({ ok: !!condition, label, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (condition) assertions++;
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
      component: doc.session.componentId,
      past: doc.past.length,
      future: doc.future.length,
      marking: app.marking(),
      cursor: app.cursor(),
      error: app.error(),
      sharedError: app.sharedError(),
      selected: app.selectedIds(),
      enabled: app.enabledTransitions(),
      legalDelay: app.legalDelay?.(),
      time: app.globalTime?.(),
    };
  });
};
const shot = (name) => page.screenshot({ path: join(out, name) });
const pane = () => page.locator('app-shared-transitions-pane');
const dialog = () => page.locator('app-shared-transition-dialog form');
const poolProps = async () => {
  const details = pane().locator('details').first();
  if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click();
  await pane().getByRole('button', { name: 'Properties…', exact: true }).first().click();
  await settle();
};
const node = (id) => page.locator(`[data-node="${id}"] .node-shape`);
const component = (name) =>
  page.locator('.component-row').filter({ hasText: new RegExp(`^\\s*${name}(\\s|$)`) });
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
async function saveTapn(name) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('[aria-label="Document toolbar"]')
      .getByRole('button', { name: 'Save TAPAAL file', exact: true })
      .click(),
  ]);
  const path = join(out, name);
  await download.saveAs(path);
  return readFileSync(path, 'utf8');
}
const local = (template, transition, urgent) => ({
  id: template,
  active: template !== 'C',
  net: {
    name: 'Fresh',
    template,
    nodes: [
      { id: 'p', kind: 'place', name: 'P', tokens: 2, x: 90, y: 120 },
      { id: 't', kind: 'transition', name: transition, tokens: 0, x: 260, y: 120 },
      { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 430, y: 120 },
    ],
    arcs: [
      { id: 'in', kind: 'normal', source: 'p', target: 't', weight: 1 },
      { id: 'out', kind: 'normal', source: 't', target: 'q', weight: 1 },
    ],
  },
  timing: {
    ages: { p: ['1', '2'] },
    invariants: {},
    intervals: {},
    transports: [],
    urgent: urgent ? ['t'] : [],
  },
});
try {
  // ---------- S1 fresh document: three LOCAL transitions, A/B active, C inactive ----------
  const fresh = {
    name: 'Fresh',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [],
    shared: { places: [], transitions: [] },
    components: [local('A', 'TA', false), local('B', 'TB', true), local('C', 'TC', false)],
  };
  const freshPath = join(out, 'fresh.json');
  writeFileSync(
    freshPath,
    JSON.stringify({ format: 'tapaal-web-network', version: 3, network: fresh }),
  );
  await page.goto(base);
  await open(freshPath);
  check((await state()).source.components.length === 3, 'S1 fresh three-component source opens');

  // A: local properties -> Make shared -> create pool "Sync"
  await component('A').click();
  await node('t').dblclick();
  await page.getByRole('button', { name: 'Make shared / use existing pool…' }).click();
  await settle();
  check(
    await dialog().isVisible(),
    'S1 element dialog routes transition to synchronization dialog',
  );
  await dialog().locator('input[name=name]').fill('Sync');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  let st = await state();
  check(
    st.source.shared.transitions.length === 1 &&
      st.source.shared.transitions[0].name === 'Sync' &&
      st.source.shared.transitions[0].urgent === false &&
      st.source.components[0].net.nodes[1].sharedId === st.source.shared.transitions[0].id &&
      !('name' in st.source.components[0].net.nodes[1]),
    'S1 create pool from local transition: geometry-only occurrence, one global authority',
  );
  const poolId = st.source.shared.transitions[0].id;
  // B (local URGENT): use existing nonurgent pool WITHOUT acceptance must refuse.
  await component('B').click();
  await node('t').dblclick();
  await page.getByRole('button', { name: 'Make shared / use existing pool…' }).click();
  await dialog().locator('select[name=action]').selectOption('use');
  const beforeRefusal = JSON.stringify((await state()).source);
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(
    JSON.stringify(st.source) === beforeRefusal &&
      (await dialog().isVisible()) &&
      /urgency differs/i.test(await dialog().innerText()),
    'S1 differing urgency requires explicit adoption; refusal leaves source and dialog intact',
    st.sharedError,
  );
  await dialog().locator('input[name=accept]').check();
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(
    st.source.components[1].net.nodes[1].sharedId === poolId &&
      st.source.components[1].timing.urgent.length === 0 &&
      st.source.shared.transitions[0].urgent === false,
    'S1 explicit adoption joins B and drops its local urgency',
  );
  const pastAfterB = st.past;
  // C (inactive): join without acceptance (same urgency).
  await component('C').click();
  await node('t').dblclick();
  await page.getByRole('button', { name: 'Make shared / use existing pool…' }).click();
  await dialog().locator('select[name=action]').selectOption('use');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(st.source.components[2].net.nodes[1].sharedId === poolId, 'S1 inactive C joins pool');
  await pane().locator('summary').first().click();
  check(
    (await pane().innerText()).includes('2 active / 3 total members'),
    'S1 pane reports 2 active / 3 total',
    await pane().innerText(),
  );
  await shot('S1-pane.png');
  // One undo removes exactly C's membership (compound command = one history entry).
  await page
    .locator('[aria-label="Document toolbar"]')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  st = await state();
  check(
    st.past === pastAfterB &&
      'name' in st.source.components[2].net.nodes[1] &&
      st.source.components[1].net.nodes[1].sharedId === poolId,
    'S1 one undo restores only C local transition',
  );
  await page
    .locator('[aria-label="Document toolbar"]')
    .getByRole('button', { name: 'Redo', exact: true })
    .click();
  st = await state();
  check(st.source.components[2].net.nodes[1].sharedId === poolId, 'S1 redo restores C membership');
  const stillOpen = await pane()
    .locator('details')
    .first()
    .evaluate((d) => d.open);
  check(stillOpen, 'S1 (UX) pool details stay expanded across undo/redo', String(stillOpen));

  // ---------- S2 local geometry: rotate A occurrence only ----------
  await component('A').click();
  await node('t').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rotate +45°' }).click();
  st = await state();
  check(
    st.source.components[0].net.nodes[1].angle === 45 &&
      (st.source.components[1].net.nodes[1].angle ?? 0) === 0 &&
      st.source.components[0].net.nodes[1].sharedId === poolId,
    'S2 rotation is occurrence-local and keeps membership',
  );
  // Drag A's occurrence; B geometry unchanged.
  const box = await node('t').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  st = await state();
  check(
    st.source.components[0].net.nodes[1].x !== 260 &&
      st.source.components[1].net.nodes[1].x === 260,
    'S2 moving one occurrence never moves another member',
    `${st.source.components[0].net.nodes[1].x}/${st.source.components[1].net.nodes[1].x}`,
  );

  // ---------- S3 clipboard guard ----------
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await node('t').click();
  await page.keyboard.press('Control+c');
  await settle();
  st = await state();
  const clip1 = await page.evaluate(() => navigator.clipboard.readText());
  check(
    /cannot be copied/i.test(st.error) && clip1 === 'sentinel',
    'S3 shared-transition selection copy refused before payload creation',
    st.error,
  );
  check(
    /place occurrences/i.test(st.error) === false,
    'S3 refusal message names transitions, not only places (wording)',
    st.error,
  );
  await page
    .locator('[aria-label="Dismiss error"]')
    .click()
    .catch(() => {});
  await node('p').click();
  await page.keyboard.press('Control+c');
  await settle();
  st = await state();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  check(!st.error && clip2 !== 'sentinel', 'S3 unrelated local selection still copies');

  // ---------- S4 keyboard: Escape closes and restores focus; Tab is trapped ----------
  await poolProps();
  await settle();
  await page.waitForTimeout(50);
  const fields = await dialog().locator('input:not(:disabled),select,button').count();
  for (let i = 0; i < fields + 1; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(
    () => !!document.activeElement?.closest('app-shared-transition-dialog'),
  );
  check(inside, 'S4 Tab focus stays trapped in the dialog');
  await page.keyboard.press('Escape');
  await settle();
  await page.waitForTimeout(50);
  const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(
    !(await dialog().isVisible()) && focus === 'Properties…',
    'S4 Escape closes and returns focus to the opener',
    focus,
  );
  // Make the pool urgent via pool properties.
  await poolProps();
  await dialog().locator('input[name=urgent]').check();
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(st.source.shared.transitions[0].urgent === true, 'S4 pool urgency edited once globally');
  await component('A').click();
  const urgentLabel = await page.locator('[data-node="t"] .timing-label').textContent();
  const sharedMarker = await page
    .locator('[data-node="t"] .shared-ring, [data-node="t"] [class*=shared]')
    .count();
  check(
    sharedMarker > 0,
    'S4 (UX) shared transition occurrence has a canvas sharing marker like shared places',
    String(sharedMarker),
  );
  check(/urgent/i.test(urgentLabel), 'S4 member canvas shows pool urgency', urgentLabel);

  // ---------- S5 simulate: one event, urgency, manual rows, noncanonical/inactive clicks ----------
  await mode('Simulate');
  st = await state();
  check(
    st.enabled.length === 1,
    'S5 one enabled event for two active members',
    JSON.stringify(st.enabled),
  );
  check(
    String(st.legalDelay).match(/^0|\[0, 0\]|0\b/) !== null,
    'S5 urgent enabled event blocks delay',
    String(st.legalDelay),
  );
  await page.locator('#delay-amount').fill('1');
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  st = await state();
  check(
    st.cursor === 0 && st.time === '0',
    'S5 delay refused while urgent event enabled',
    `${st.cursor} ${st.time} ${st.error}`,
  );
  await page
    .locator('[aria-label="Dismiss error"]')
    .click()
    .catch(() => {});
  await page.locator('#token-policy').selectOption('manual');
  await page.locator('.enabled-row').press('Enter');
  const modal = page.locator('app-token-selection-dialog');
  const modalText = await modal.innerText();
  check(
    modalText.includes('A.P (in)') && modalText.includes('B.P (in)') && !modalText.includes('C.P'),
    'S5 manual groups name both active members with repeated local arc IDs, not inactive',
    modalText.replace(/\s+/g, ' ').slice(0, 200),
  );
  await shot('S5-manual.png');
  await modal.locator('fieldset').nth(0).locator('input').first().check();
  await modal.locator('fieldset').nth(1).locator('input').last().check();
  await modal.getByRole('button', { name: 'Fire', exact: true }).click();
  st = await state();
  check(st.cursor === 1 && st.marking.p === 1 && st.marking.q === 1, 'S5 manual fire is one step');
  const history = await page.locator('.history-row').allInnerTexts();
  check(
    history.length === 2 && /Sync \[A, B\]/.test(history[1]),
    'S5 history shows one global event with active members',
    history.join(' | '),
  );
  await page.locator('#token-policy').selectOption('oldest');
  await component('C').click();
  const beforeInactive = await state();
  await node('t').click();
  st = await state();
  check(
    st.cursor === beforeInactive.cursor && st.marking.p === 2,
    'S5 inactive member click neither fires nor changes frozen locals',
  );
  await component('B').click();
  await node('t').click();
  st = await state();
  check(
    st.cursor === 2 && st.marking.p === 0 && st.marking.q === 2,
    'S5 noncanonical B click fires once',
  );
  await component('A').click();
  st = await state();
  check(st.marking.p === 0 && st.marking.q === 2, 'S5 A view reflects the same atomic event');
  await shot('S5-after-fire.png');
  await page.getByRole('button', { name: /^Back$/ }).click();
  st = await state();
  check(st.cursor === 1 && st.marking.q === 1, 'S5 Back uses stored state');
  await page.getByRole('button', { name: /Reset/ }).first().click();
  st = await state();
  check(st.cursor === 0 && st.marking.p === 2, 'S5 Reset returns to initial marking');

  // ---------- S6 native save after simulation is initial source ----------
  await mode('Edit');
  const saved = await saveTapn('fresh-saved.tapn');
  const roots = saved.match(/<shared-transition [^>]*>/g) ?? [];
  const members = saved.match(/<transition [^>]*name="Sync"[^>]*>/g) ?? [];
  check(
    roots.length === 1 &&
      /urgent="true"/.test(roots[0]) &&
      members.length === 3 &&
      members.every((m) => /urgent="true"/.test(m)) &&
      (saved.match(/initialMarking="2"/g) ?? []).length === 3,
    'S6 TAPN save: one urgent root, three agreeing members, initial markings (not runtime)',
    `${roots.join()} members=${members.length}`,
  );
  await open(join(out, 'fresh-saved.tapn'));
  st = await state();
  check(
    st.source.shared.transitions.length === 1 &&
      st.source.components.filter((c) => c.net.nodes.some((n) => 'sharedId' in n)).length === 3 &&
      st.source.components.map((c) => c.active).join() === 'true,true,false' &&
      st.source.components[0].net.nodes.find((n) => 'sharedId' in n).angle === 45,
    'S6 reopen preserves membership, activity and local rotation',
  );

  // ---------- S7 query guard on unchanged native example with urgent shared transition ----------
  await open(join(web, 'public/examples/workflow-complaint.tapn'));
  st = await state();
  const original = st.source.shared.transitions[0];
  check(original?.urgent === true, 'S7 workflow-complaint opens with urgent synchronized pool');
  await poolProps();
  await dialog().locator('input[name=name]').fill('collect2');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(
    st.source.shared.transitions[0].name === original.name &&
      /queries protect/i.test(await dialog().innerText()),
    'S7 rename refused while saved queries protect the global name',
  );
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.saved-query-group summary').click();
  await page.getByRole('button', { name: 'Remove all queries', exact: true }).click();
  await poolProps();
  await dialog().locator('input[name=name]').fill('collect2');
  await dialog().getByRole('button', { name: 'OK', exact: true }).click();
  st = await state();
  check(
    st.source.shared.transitions[0].name === 'collect2' && !st.source.savedQueries,
    'S7 rename after explicit query removal',
  );
  const undo = page
    .locator('[aria-label="Document toolbar"]')
    .getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await undo.click();
  st = await state();
  check(
    st.source.shared.transitions[0].name === original.name &&
      st.source.savedQueries?.protectedSharedTransitions?.some((p) => p.name === original.name),
    'S7 undo restores name and query protections',
  );
  await mode('Simulate');
  st = await state();
  check(st.error === '', 'S7 example simulates', st.error);
  await mode('Edit');

  // ---------- S8 gallery: four targets openable ----------
  await page.locator('summary', { hasText: /^File$/ }).click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  await settle();
  const gallery = page.locator('app-example-gallery');
  const enabledOpen = await gallery.locator('button[aria-label^="Open "]:not([disabled])').count();
  const disabledOpen = await gallery.locator('button[aria-label^="Open "][disabled]').count();
  check(
    enabledOpen === 16 && disabledOpen === 13,
    'S8 gallery 16 openable / 13 gated',
    `${enabledOpen}/${disabledOpen}`,
  );
  const galleryText = await gallery.innerText();
  check(
    /Shared transitions|Synchroni/i.test(galleryText),
    'S8 gallery cards flag synchronized transitions (UX)',
    '',
  );
  await shot('S8-gallery.png');
  await gallery.getByRole('button', { name: 'Close example nets', exact: true }).click();
  // ---------- S9 four target examples: gallery open, legal synchronized fire, save/reopen ----------
  for (const name of [
    'train-level-crossing',
    'workflow-advanced',
    'workflow-complaint',
    'workflow-medical',
  ]) {
    await page.locator('summary', { hasText: /^File$/ }).click();
    await page
      .locator('[aria-label="File actions"]')
      .getByRole('button', { name: 'Example nets…', exact: true })
      .click();
    await page
      .locator('app-example-gallery')
      .getByRole('button', { name: `Open ${name}`, exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector('app-example-gallery'), null, {
      timeout: 15000,
    });
    await settle();
    const opened = await state();
    const pools = opened.source.shared.transitions.map((p) => [p.name, p.urgent]);
    await mode('Simulate');
    await page
      .locator('#token-policy')
      .selectOption('oldest')
      .catch(() => {});
    let fired = '';
    const trail = [];
    for (let i = 0; i < 300 && !fired; i++) {
      const now = await state();
      const rows = page.locator('.enabled-row');
      const n = await rows.count();
      const syncRow = now.enabled.findIndex((ref) =>
        now.source.components
          .find((c) => c.id === ref.componentId)
          .net.nodes.some((x) => x.id === ref.elementId && 'sharedId' in x),
      );
      trail.push(`${now.cursor}:${n}:${syncRow}:${now.legalDelay}:${now.error.slice(0, 40)}`);
      if (syncRow >= 0) {
        await rows.nth(syncRow).dblclick();
        const after = await state();
        const labels = await page.locator('.history-row').allInnerTexts();
        if (after.cursor === now.cursor + 1 && /\[.*\]/.test(labels.at(-1)))
          fired = labels.at(-1).replace(/\s+/g, ' ');
        else trail.push('sync-click-failed:' + after.error);
        break;
      }
      // Same legal strategy as the focused unit test: fire round-robin, then a legal delay.
      if (n) await rows.nth(i % n).dblclick();
      const legal = (await state()).legalDelay;
      const m = /^\[(\d+(?:\.\d+)?),\s*(inf|\d+(?:\.\d+)?)([\])])$/.exec(String(legal));
      if (m && m[2] !== '0') {
        // Closed upper bound: delay exactly to it (no Zeno halving / exponent strings).
        const amount = m[2] === 'inf' ? '1' : m[3] === ']' ? m[2] : (Number(m[2]) / 2).toFixed(6);
        await page.locator('#delay-amount').fill(amount);
        await page.getByRole('button', { name: 'Delay', exact: true }).click();
      } else if (!n) break;
      await settle();
    }
    if (!fired) writeFileSync(join(out, `${name}-trail.txt`), trail.join('\n'));
    check(!!fired, `S9 ${name}: legal UI actions reach one synchronized history event`, fired);
    await mode('Edit');
    const text = await saveTapn(`${name}-saved.tapn`);
    const original = readFileSync(join(web, `public/examples/${name}.tapn`), 'utf8');
    const queries = (t) => (t.match(/<query [^>]*>/g) ?? []).length;
    await open(join(out, `${name}-saved.tapn`));
    const reopened = await state();
    check(
      JSON.stringify(reopened.source.shared.transitions.map((p) => [p.name, p.urgent])) ===
        JSON.stringify(pools) &&
        queries(text) === queries(original) &&
        JSON.stringify(reopened.source.constants.map((k) => [k.name, k.value])) ===
          JSON.stringify(opened.source.constants.map((k) => [k.name, k.value])) &&
        JSON.stringify(
          reopened.source.components.map((c) => c.net.nodes.filter((x) => 'sharedId' in x).length),
        ) ===
          JSON.stringify(
            opened.source.components.map((c) => c.net.nodes.filter((x) => 'sharedId' in x).length),
          ),
      `S9 ${name}: initial save after simulation reopens with same pools/urgency/membership/constants/queries`,
    );
  }
  check(errors.length === 0, 'no browser page errors', errors.join(' | '));
} catch (e) {
  results.push({ ok: false, label: 'harness exception', detail: String(e?.stack ?? e) });
  console.log('EXCEPTION ' + (e?.stack ?? e));
  await shot('failure.png').catch(() => {});
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ assertions, results }, null, 2));
  console.log(JSON.stringify({ assertions, failed: results.filter((r) => !r.ok).length, out }));
  await browser.close();
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
