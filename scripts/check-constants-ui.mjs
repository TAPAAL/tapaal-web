#!/usr/bin/env node
// Browser validation of the authored constants workspace (see design/CONSTANTS-UI-VALIDATION.md).
// Drives a running development build with real Playwright mouse, keyboard, file-chooser and
// download input. App signals and rendered DOM are only read; no App method or signal setter is
// invoked. The system clipboard is seeded through the browser clipboard API, as another
// application would, to detect whether a refused copy wrote anything.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/check-constants-ui.mjs http://127.0.0.1:4411 /tmp/tapaal-constants-ui-validation/run
//
// ONLY=C01,C02 restricts checks. Exit status 1 when any check fails or errors.
// Results: <out>/results.json, generated fixtures, downloads and screenshots.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4411';
const OUT = resolve(process.argv[3] ?? '/tmp/tapaal-constants-ui-validation/run');
const ONLY = process.env.ONLY?.split(',');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(OUT, { recursive: true });

// ---- fixtures ---------------------------------------------------------------------------------
// Unchanged repository example and the unchanged native 4.0.4 scalar fixture.
const WEBSERVER = join(ROOT, 'public/examples/webserver.tapn');
const SCALAR = join(ROOT, 'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn');
const write = (name, text) => {
  const path = join(OUT, name);
  writeFileSync(path, text);
  return path;
};
const FEATURE = (timed) =>
  `<feature isTimed="${timed}" isColored="false" isGame="false" isStochastic="false"/>`;
// Two components; Side is inactive. D appears in both, so D=7 conflicts only with Side.
// Main also has a numeric-only island (n1 -> nt -> n2) for the clipboard boundary.
const MULTI = write(
  'multi.tapn',
  `<?xml version="1.0" encoding="UTF-8"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <constant name="K" value="2"/>
  <constant name="D" value="5"/>
  <constant name="Spare" value="9"/>
  <net active="true" id="Main" type="P/T net">
    <place id="p" name="p" positionX="90" positionY="90" initialMarking="2" invariant="&lt;= D"/>
    <transition id="t" name="t" positionX="240" positionY="90" urgent="false"/>
    <place id="q" name="q" positionX="390" positionY="90" initialMarking="0" invariant="&lt; inf"/>
    <place id="n1" name="n1" positionX="90" positionY="300" initialMarking="1" invariant="&lt;= 4"/>
    <transition id="nt" name="nt" positionX="240" positionY="300" urgent="false"/>
    <place id="n2" name="n2" positionX="390" positionY="300" initialMarking="0" invariant="&lt; inf"/>
    <arc id="pt" source="p" target="t" type="timed" weight="K" inscription="[0,D]"/>
    <arc id="tq" source="t" target="q" type="normal" weight="1" inscription="1"/>
    <arc id="n1nt" source="n1" target="nt" type="timed" weight="2" inscription="[1,3]"/>
    <arc id="ntn2" source="nt" target="n2" type="normal" weight="1" inscription="1"/>
  </net>
  <net active="false" id="Side" type="P/T net">
    <place id="s" name="s" positionX="90" positionY="90" initialMarking="1" invariant="&lt;= K"/>
    <transition id="u" name="u" positionX="240" positionY="90" urgent="false"/>
    <arc id="su" source="s" target="u" type="timed" weight="1" inscription="[D,6]"/>
  </net>
  ${FEATURE(true)}
</pnml>
`,
);
// Untimed constants document: ordinary input/output and inhibitor weight W.
const UNTIMED = write(
  'untimed.tapn',
  `<?xml version="1.0" encoding="UTF-8"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <constant name="W" value="2"/>
  <constant name="H" value="1"/>
  <net active="true" id="Plain" type="P/T net">
    <place id="a" name="a" positionX="90" positionY="90" initialMarking="2"/>
    <transition id="t" name="t" positionX="240" positionY="90"/>
    <place id="b" name="b" positionX="390" positionY="90" initialMarking="0"/>
    <place id="c" name="c" positionX="240" positionY="260" initialMarking="0"/>
    <arc id="at" source="a" target="t" type="timed" weight="W" inscription="[0,inf)"/>
    <arc id="tb" source="t" target="b" type="normal" weight="W" inscription="1"/>
    <arc id="ct" source="c" target="t" type="tapnInhibitor" weight="H" inscription="[0,inf)"/>
  </net>
  ${FEATURE(false)}
</pnml>
`,
);

// ---- browser ----------------------------------------------------------------------------------
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const results = [];
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
      docCount: ws.documents.length,
      network: plain(doc?.network),
      source: JSON.stringify(doc?.network),
      saved: JSON.stringify(doc?.saved),
      pastSources: doc?.past.map((p) => JSON.stringify(p)),
      futureSources: doc?.future.map((p) => JSON.stringify(p)),
      componentId: doc?.session.componentId,
      past: doc?.past.length,
      future: doc?.future.length,
      dirty: app.dirty(),
      net: plain(app.net()),
      selected: [...app.selectedIds()],
      mode: app.mode(),
      error: app.error(),
      notice: app.notice(),
      dialogError: app.dialogError(),
      constantError: app.constantError(),
      elementDialog: !!document.querySelector('app-element-dialog form'),
      constantDialog: !!document.querySelector('app-constant-dialog form'),
      constantDialogAlert:
        document.querySelector('app-constant-dialog [role=alert]')?.textContent.trim() ?? null,
      elementDialogAlert:
        document.querySelector('app-element-dialog [role=alert]')?.textContent.trim() ?? null,
      banner: document.querySelector('.error-banner')?.textContent.trim() ?? null,
      pane: document.querySelector('app-constants-pane')?.innerText ?? null,
      enabled: [...document.querySelectorAll('.enabled-row')].map((e) => e.textContent.trim()),
      legalText:
        document
          .querySelector('[aria-label="Time and token selection"] [role=status]')
          ?.textContent.trim() ?? null,
      arcLabels: Object.fromEntries(
        [...document.querySelectorAll('[data-arc]')].map((e) => [
          e.getAttribute('data-arc'),
          e.querySelector('.arc-label')?.textContent.trim().replace(/\s+/g, ' ') ?? '',
        ]),
      ),
      nodeText: Object.fromEntries(
        [...document.querySelectorAll('[data-node]')].map((e) => [
          e.getAttribute('data-node'),
          e.textContent.trim().replace(/\s+/g, ' '),
        ]),
      ),
      svgText: [...document.querySelectorAll('svg.net-canvas text')].map((t) =>
        t.textContent.trim(),
      ),
      components: [...document.querySelectorAll('.component-row button, .component-list button')]
        .map((b) => b.textContent.trim())
        .filter(Boolean),
    };
  });
};
const comp = (s, id) => s.network.components.find((c) => c.net.template === id || c.id === id);
const arcOf = (s, componentName, id) => comp(s, componentName).net.arcs.find((a) => a.id === id);
const nameOf = (s, ref) =>
  typeof ref === 'object' && ref
    ? `@${s.network.constants.find((c) => c.id === ref.constantId)?.name}`
    : String(ref);

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
async function arcPoint(id, fraction = 0.3) {
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
const submitDialog = () => page.locator('app-element-dialog button[type=submit]').click();
const cancelDialog = () =>
  page.locator('app-element-dialog footer button', { hasText: 'Cancel' }).click();
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
const toolbar = (name) =>
  page.locator('[aria-label="Document toolbar"]').getByRole('button', { name, exact: true });
async function simulate() {
  await page
    .locator('[aria-label="Workspace mode"]')
    .getByRole('button', { name: 'Simulate' })
    .click();
}
async function editMode() {
  await page.locator('[aria-label="Workspace mode"]').getByRole('button', { name: 'Edit' }).click();
}
async function delay(amount) {
  await page.locator('#delay-amount').fill(amount);
  await page
    .locator('[aria-label="Time and token selection"]')
    .getByRole('button', { name: 'Delay' })
    .click();
}
// Constants pane: expand a declaration, then use its own buttons.
const pane = () => page.locator('app-constants-pane');
const declaration = (name) =>
  pane()
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name} = `) }) });
async function expand(name) {
  const d = declaration(name);
  if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click();
  return d;
}
async function openDeclaration(name) {
  const d = await expand(name);
  await d.getByRole('button', { name: 'Edit…' }).click();
  await page.locator('app-constant-dialog form').waitFor();
}
async function addDeclaration() {
  await pane().locator('header').getByRole('button', { name: 'Add…' }).click();
  await page.locator('app-constant-dialog form').waitFor();
}
async function fillDeclaration(name, value) {
  if (name !== undefined) await page.locator('#constant-name').fill(name);
  if (value !== undefined) await page.locator('#constant-value').fill(value);
  await page.locator('app-constant-dialog button[type=submit]').click();
  await settle();
}
const cancelDeclaration = () =>
  page.locator('app-constant-dialog footer button', { hasText: 'Cancel' }).click();
async function deleteDeclaration(name) {
  const d = await expand(name);
  await d.getByRole('button', { name: 'Delete' }).click();
  await settle();
}
async function dismissError() {
  const b = btn('Dismiss error');
  if (await b.isVisible().catch(() => false)) await b.click();
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
  pageErrors.length = 0;
  try {
    await fresh();
    await fn(expect);
    expect(!pageErrors.length, 'No uncaught page errors', pageErrors);
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
        .join('') +
      (r.error ? `\n   ${r.error.split('\n').slice(0, 4).join('\n   ')}` : ''),
  );
}
// Snapshot of everything an invalid edit must leave untouched.
const frozen = (s) => JSON.stringify([s.source, s.saved, s.pastSources, s.futureSources]);

// ---- checks -----------------------------------------------------------------------------------
try {
  await check(
    'C01',
    'Unchanged webserver.tapn opens with constants, query and symbolic labels',
    async (expect) => {
      await openFile(WEBSERVER);
      const s = await state();
      expect(s.docCount >= 1 && s.network.name, 'Document opened', s.banner);
      expect(
        JSON.stringify(s.network.constants.map((c) => [c.name, c.value])) ===
          JSON.stringify([
            ['deadline', 5],
            ['min', 3],
            ['periodA', 7],
            ['periodB', 5],
          ]),
        'Four declarations in source order with values',
        s.network.constants,
      );
      expect(!!s.network.savedQueries?.xml?.length, 'Saved query retained on source');
      expect(
        s.network.savedQueries.protectedConstants.length === 4,
        'All four declarations captured as query-protected',
        s.network.savedQueries.protectedConstants,
      );
      for (const label of [
        '[deadline,deadline]',
        '[periodA,periodA]',
        '[periodB,periodB]',
        '[min,inf)',
        'Transport 1 [0,deadline)',
        'Transport 1 [0,deadline]',
        '<= deadline',
        '<= periodA',
        '<= periodB',
      ])
        expect(s.svgText.includes(label), `Canvas shows ${label}`);
      expect(!s.dirty && s.past === 0, 'Opened clean with empty history');
      expect(/deadline = 5/.test(s.pane) && /periodB = 5/.test(s.pane), 'Pane lists declarations');
      const d = await expand('deadline');
      const text = await d.innerText();
      expect(
        /WebServer \/ Requests \/ invariant/.test(text) &&
          /Processing → SendReply \/ upper/.test(text),
        'Uses labelled by component/element/field',
        text,
      );
      expect(
        /Protected by saved queries/.test(text) && !/saved-query-protection/.test(text),
        'Query protection shown separately from model uses',
        text,
      );
      // Navigation to a use selects the element.
      await d.getByRole('button', { name: 'WebServer / Processing / invariant' }).click();
      const n = await state();
      expect(
        JSON.stringify(n.selected) === '["Processing"]',
        'Use navigation selects the place',
        n.selected,
      );
      expect(n.source === s.source && n.past === 0, 'Navigation does not edit source');
      await shot('C01-webserver');
    },
  );

  await check(
    'C02',
    'Declaration dialog validation: grammar, reserved inf, duplicates, range',
    async (expect) => {
      await openFile(WEBSERVER);
      const before = await state();
      const cases = [
        ['inf', '1', /reserved|inf/i],
        ['min', '1', /duplicate|already/i],
        ['1abc', '1', /name|letter|identifier/i],
        ['a-b', '1', /name|letter|identifier/i],
        ['', '1', /name|letter|identifier|required/i],
        ['ok', '-1', /integer|0 to/i],
        ['ok', '2147483648', /integer|0 to/i],
        ['ok', '1.5', /integer|0 to/i],
        ['ok', '1+1', /integer|arith/i],
      ];
      await addDeclaration();
      for (const [name, value, re] of cases) {
        await fillDeclaration(name, value);
        const s = await state();
        expect(
          s.constantDialog && re.test(s.constantDialogAlert ?? '') && frozen(s) === frozen(before),
          `Add ${JSON.stringify(name)}=${JSON.stringify(value)} refused, draft open, source/history unchanged`,
          s.constantDialogAlert,
        );
      }
      expect(
        (await page.locator('#constant-name').inputValue()) === 'ok',
        'Draft text retained after refusal',
      );
      await fillDeclaration('Inf', '2147483647');
      let s = await state();
      expect(
        !s.constantDialog &&
          s.network.constants.some((c) => c.name === 'Inf' && c.value === 2147483647),
        'Inf (case-distinct) with max value accepted',
        s.constantDialogAlert,
      );
      expect(s.past === 1 && s.dirty, 'One history entry');
      await addDeclaration();
      await fillDeclaration('inf2', '0');
      s = await state();
      expect(
        s.network.constants.some((c) => c.name === 'inf2' && c.value === 0),
        'Name beginning with inf accepted, value 0',
      );
      // Unused, unprotected declarations can be renamed and deleted.
      await openDeclaration('inf2');
      await fillDeclaration('_x9', undefined);
      s = await state();
      const x = s.network.constants.find((c) => c.name === '_x9');
      expect(
        x && x.value === 0 && s.past === 3,
        'Rename unused declaration keeps value',
        s.network.constants,
      );
      await deleteDeclaration('_x9');
      s = await state();
      expect(
        !s.network.constants.some((c) => c.name === '_x9') && s.past === 4,
        'Unused declaration deleted',
      );
      await toolbar('Undo').click();
      s = await state();
      expect(
        s.network.constants.find((c) => c.name === '_x9')?.id === x.id,
        'Undo restores deleted declaration with same ID',
      );
      // Escape cancels without change.
      await openDeclaration('min');
      await page.locator('#constant-value').fill('99');
      await key('Escape');
      const e = await state();
      expect(!e.constantDialog && e.source === s.source, 'Escape cancels draft');
    },
  );

  await check(
    'C03',
    'Value edit: conflict refused unchanged; valid edit one entry; undo/redo',
    async (expect) => {
      await openFile(WEBSERVER);
      const before = await state();
      await openDeclaration('deadline');
      await fillDeclaration(undefined, '0');
      let s = await state();
      expect(
        s.constantDialog && /deadline|Uses/i.test(s.constantDialogAlert ?? ''),
        'deadline=0 refused with message',
        s.constantDialogAlert,
      );
      expect(
        /WebServer/.test(s.constantDialogAlert ?? ''),
        'Refusal names use locations',
        s.constantDialogAlert,
      );
      expect(
        frozen(s) === frozen(before) && !s.dirty,
        'Source, saved checkpoint and history unchanged',
      );
      await shot('C03-deadline-zero-refused');
      await fillDeclaration(undefined, '4');
      s = await state();
      expect(
        !s.constantDialog && s.network.constants.find((c) => c.name === 'deadline').value === 4,
        'deadline=4 accepted',
      );
      expect(s.past === 1, 'Exactly one history entry', s.past);
      expect(
        s.svgText.includes('<= deadline') && s.svgText.includes('[deadline,deadline]'),
        'Labels still symbolic',
      );
      expect(/deadline = 4/.test(s.pane), 'Pane shows new value');
      const changed = s.source;
      await toolbar('Undo').click();
      s = await state();
      expect(s.source === before.source && !s.dirty, 'Undo restores exact source and clean state');
      await toolbar('Redo').click();
      s = await state();
      expect(s.source === changed && s.dirty, 'Redo restores edit');
      // Keyboard undo/redo from canvas
      await focusCanvas();
      await key('Control+z');
      s = await state();
      expect(s.source === before.source, 'Ctrl+Z undoes declaration edit');
      await key('Control+y');
      s = await state();
      expect(s.source === changed, 'Ctrl+Y redoes declaration edit', s.past);
    },
  );

  await check(
    'C04',
    'Query protection: rename/delete refused, value allowed, removal undo restores',
    async (expect) => {
      await openFile(WEBSERVER);
      const before = await state();
      await openDeclaration('min');
      await fillDeclaration('minimum', '3');
      let s = await state();
      expect(
        s.constantDialog && /Saved queries protect min/.test(s.constantDialogAlert ?? ''),
        'Rename refused for query-protected declaration',
        s.constantDialogAlert,
      );
      expect(frozen(s) === frozen(before), 'Refused rename leaves source/history unchanged');
      await fillDeclaration('min', '2');
      s = await state();
      expect(
        !s.constantDialog && s.network.constants.find((c) => c.name === 'min').value === 2,
        'Value change allowed under protection',
      );
      expect(
        s.network.savedQueries.xml.join('') === before.network.savedQueries.xml.join(''),
        'Query XML untouched by value change',
      );
      // Delete of an in-use + protected declaration is refused.
      await deleteDeclaration('min');
      s = await state();
      expect(
        s.network.constants.some((c) => c.name === 'min') && /protect|use/i.test(s.error),
        'Delete refused',
        s.error,
      );
      await dismissError();
      // Explicit removal of saved queries.
      const withQueries = s.source;
      await page.locator('[aria-label="Saved queries"] summary').click();
      await page.getByRole('button', { name: 'Remove all queries' }).click();
      s = await state();
      expect(
        !s.network.savedQueries,
        'Remove saved queries removes protections',
        s.network.savedQueries,
      );
      await openDeclaration('min');
      await fillDeclaration('minimum', undefined);
      s = await state();
      expect(
        !s.constantDialog && s.network.constants.some((c) => c.name === 'minimum'),
        'Rename allowed after explicit query removal',
        s.constantDialogAlert,
      );
      expect(s.svgText.includes('[minimum,inf)'), 'Canvas label follows rename');
      await toolbar('Undo').click();
      await toolbar('Undo').click();
      s = await state();
      expect(
        s.source === withQueries && s.network.savedQueries.protectedConstants.length === 4,
        'Undo restores queries and all protections',
      );
      await openDeclaration('min');
      await fillDeclaration('minimum', undefined);
      s = await state();
      expect(
        s.constantDialog && /protect/.test(s.constantDialogAlert ?? ''),
        'Rename refused again after undo',
      );
      await cancelDeclaration();
    },
  );

  await check(
    'C05',
    'Inactive component: uses listed/navigable; conflict refused with location',
    async (expect) => {
      await openFile(MULTI);
      const before = await state();
      expect(
        before.network.components.length === 2 && before.network.components[1].active === false,
        'Side imported inactive',
        before.network.components.map((c) => c.active),
      );
      const d = await expand('D');
      const text = await d.innerText();
      expect(/Side \(inactive\)/.test(text), 'Pane groups inactive component use', text);
      expect(
        text.includes('s → u') && !text.includes('/ su /'),
        'Arc use displays endpoint names instead of its internal ID',
        text,
      );
      await d.getByRole('button', { name: /Side \(inactive\) \/ .* \/ lower/ }).click();
      let s = await state();
      expect(
        comp(s, 'Side').id === s.componentId && JSON.stringify(s.selected) === '["su"]',
        'Navigation switches to inactive component and selects arc',
        [s.componentId, s.selected],
      );
      expect(s.source === before.source, 'Navigation leaves source unchanged');
      await openDeclaration('D');
      await fillDeclaration(undefined, '7');
      s = await state();
      expect(
        s.constantDialog && /Side/.test(s.constantDialogAlert ?? ''),
        'D=7 refused naming inactive Side use',
        s.constantDialogAlert,
      );
      expect(frozen(s) === frozen(before), 'Source/history/checkpoint unchanged');
      await fillDeclaration(undefined, '6');
      s = await state();
      expect(!s.constantDialog && s.past === 1, 'D=6 accepted in one entry', s.constantDialogAlert);
      // K is used by Main weight and Side invariant; one value edit updates both.
      await openDeclaration('K');
      await fillDeclaration(undefined, '3');
      s = await state();
      expect(
        s.past === 2 &&
          typeof arcOf(s, 'Main', 'pt').weight === 'object' &&
          typeof comp(s, 'Side').timing.invariants.s.upper === 'object',
        'K edit keeps both refs, one entry',
      );
      // Delete in-use refused, Spare (unused) deletable.
      await deleteDeclaration('K');
      s = await state();
      expect(
        s.network.constants.some((c) => c.name === 'K') && /K/.test(s.error),
        'In-use delete refused',
        s.error,
      );
      await dismissError();
      await deleteDeclaration('Spare');
      s = await state();
      expect(!s.network.constants.some((c) => c.name === 'Spare'), 'Unused declaration deleted');
    },
  );

  await check(
    'C06',
    'Symbolic property dialogs: all weight positions, endpoints, invariant, Zero',
    async (expect) => {
      await openFile(SCALAR);
      let s = await state();
      const before = s;
      expect(
        s.network.constants.map((c) => c.name).join() === 'K,D,Zero',
        'Scalar fixture declarations',
      );
      // Ordinary input arc: weight K, interval [K,D].
      await openArcDialog('in');
      expect((await field('dialog-weight').inputValue()) === 'K', 'Input weight shows K');
      expect((await field('dialog-interval').inputValue()) === '[K,D]', 'Interval shows [K,D]');
      await field('dialog-interval').fill('[Zero,D]');
      await submitDialog();
      s = await state();
      const iv = comp(s, 'Scalar').timing.intervals.in;
      expect(
        !s.elementDialog && nameOf(s, iv.lower) === '@Zero' && nameOf(s, iv.upper) === '@D',
        'Interval stored as [Zero,D] refs',
        iv,
      );
      expect(nameOf(s, arcOf(s, 'Scalar', 'in').weight) === '@K', 'Untouched weight keeps K ref');
      // Invalid name keeps dialog, no history.
      const mid = await state();
      await openArcDialog('in');
      await field('dialog-weight').fill('Nope');
      await submitDialog();
      s = await state();
      expect(
        s.elementDialog && frozen(s) === frozen(mid),
        'Unknown name refused, dialog open, unchanged',
        s.elementDialogAlert,
      );
      await field('dialog-weight').fill('2*K');
      await submitDialog();
      s = await state();
      expect(
        s.elementDialog && /Arithmetic/.test(s.elementDialogAlert ?? ''),
        'Arithmetic refused',
        s.elementDialogAlert,
      );
      await field('dialog-weight').fill('D');
      await submitDialog();
      s = await state();
      expect(
        !s.elementDialog && nameOf(s, arcOf(s, 'Scalar', 'in').weight) === '@D',
        'Input weight now D',
      );
      // Output arc
      await openArcDialog('out');
      expect((await field('dialog-weight').inputValue()) === 'K', 'Output weight shows K');
      await field('dialog-weight').fill('Zero');
      await submitDialog();
      s = await state();
      expect(
        s.elementDialog && /weight|1/i.test(s.elementDialogAlert ?? ''),
        'Zero-valued output weight refused',
        s.elementDialogAlert,
      );
      await field('dialog-weight').fill('3');
      await submitDialog();
      s = await state();
      expect(
        !s.elementDialog && arcOf(s, 'Scalar', 'out').weight === 3,
        'Explicit literal replaces ref',
        arcOf(s, 'Scalar', 'out').weight,
      );
      // Inhibitor
      await openArcDialog('inh');
      expect((await field('dialog-weight').inputValue()) === 'K', 'Inhibitor threshold shows K');
      await field('dialog-weight').fill('D');
      await submitDialog();
      s = await state();
      expect(nameOf(s, arcOf(s, 'Scalar', 'inh').weight) === '@D', 'Inhibitor weight D ref');
      // Transport pair weight: both halves atomically.
      const p0 = s.past;
      await openArcDialog('ti');
      expect((await field('dialog-weight').inputValue()) === 'K', 'Transport weight shows K');
      expect(
        (await field('dialog-interval').inputValue()) === '[Zero,D]',
        'Transport interval shows [Zero,D]',
      );
      await field('dialog-weight').fill('D');
      await submitDialog();
      s = await state();
      expect(
        nameOf(s, arcOf(s, 'Scalar', 'ti').weight) === '@D' &&
          nameOf(s, arcOf(s, 'Scalar', 'to').weight) === '@D' &&
          s.past === p0 + 1,
        'Transport weight change updates both halves in one entry',
        [arcOf(s, 'Scalar', 'ti').weight, arcOf(s, 'Scalar', 'to').weight, s.past - p0],
      );
      const tiv = comp(s, 'Scalar').timing.intervals.ti;
      expect(
        nameOf(s, tiv.lower) === '@Zero',
        'Zero lower bound retained as ref (not canonicalised away)',
        tiv,
      );
      // Invariant
      await openNodeDialog('p');
      expect((await field('dialog-invariant').inputValue()) === '<= D', 'Invariant shows <= D');
      await field('dialog-invariant').fill('< K');
      await submitDialog();
      s = await state();
      const inv = comp(s, 'Scalar').timing.invariants.p;
      expect(nameOf(s, inv.upper) === '@K' && inv.upperClosed === false, 'Invariant < K ref', inv);
      expect(s.svgText.includes('< K'), 'Canvas shows < K');
      // Unrelated node edit (name) keeps all refs.
      const refsBefore = JSON.stringify([
        comp(s, 'Scalar').net.arcs.map((a) => a.weight),
        comp(s, 'Scalar').timing,
      ]);
      await openNodeDialog('o');
      await field('dialog-name').fill('o2');
      await submitDialog();
      s = await state();
      expect(
        JSON.stringify([
          comp(s, 'Scalar').net.arcs.map((a) => a.weight),
          comp(s, 'Scalar').timing,
        ]) === refsBefore,
        'Renaming a transition keeps every authored term',
      );
      // Undo back to the opened source.
      for (let i = s.past; i > 0; i--) await toolbar('Undo').click();
      s = await state();
      expect(s.source === before.source && !s.dirty, 'Undo chain returns to exact opened source');
      await shot('C06-scalar');
    },
  );

  await check(
    'C07',
    'Dialogs without semantic changes and canvas edits never flatten refs',
    async (expect) => {
      await openFile(SCALAR);
      const before = await state();
      const terms = (s) =>
        JSON.stringify([
          comp(s, 'Scalar').net.arcs.map((a) => [a.id, a.weight]),
          comp(s, 'Scalar').timing.intervals,
          comp(s, 'Scalar').timing.invariants,
        ]);
      // OK on an untouched arc dialog.
      await openArcDialog('ti');
      await submitDialog();
      let s = await state();
      expect(terms(s) === terms(before), 'OK without changes keeps refs', s.past);
      // Change only transport arc rotation-free property: open place dialog, rotate nothing, change tokens? -> change X.
      await openNodeDialog('t');
      await field('dialog-rotation').selectOption({ index: 1 });
      await submitDialog();
      s = await state();
      expect(terms(s) === terms(before), 'Transition rotation keeps refs');
      // Mouse drag of a node.
      const p = await nodePoint('q');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 60, p.y + 40, { steps: 5 });
      await page.mouse.up();
      s = await state();
      const q0 = comp(before, 'Scalar').net.nodes.find((n) => n.id === 'q');
      const q1 = comp(s, 'Scalar').net.nodes.find((n) => n.id === 'q');
      expect(q1.x !== q0.x || q1.y !== q0.y, 'Drag moved q', [q0.x, q0.y, q1.x, q1.y]);
      expect(terms(s) === terms(before), 'Drag keeps refs');
      // Grid alignment shortcut
      await focusCanvas();
      await key('Shift+G');
      s = await state();
      expect(terms(s) === terms(before), 'Align-to-grid keeps refs');
      // Inline inspector focus/blur on timed arc (fields disabled in timed) and place name edit.
      await clickNode('b');
      const name = page.locator('#element-name');
      await name.click();
      await key('Control+a');
      await page.keyboard.type('bb');
      const typed = await name.inputValue();
      await name.press('Enter');
      await focusCanvas();
      s = await state();
      expect(
        comp(s, 'Scalar').net.nodes.find((n) => n.id === 'b').name === 'bb',
        'Inline rename applied',
        [typed, s.error, s.selected, comp(s, 'Scalar').net.nodes.map((n) => n.name), s.past],
      );
      expect(terms(s) === terms(before), 'Inline place rename keeps refs');
      // Draw a new place and arc with tools.
      await page
        .locator('[aria-label="Workspace tools"]')
        .getByRole('button', { name: 'Place', exact: true })
        .click();
      const box = await page.locator('svg.net-canvas').boundingBox();
      await page.mouse.click(box.x + box.width - 120, box.y + box.height - 120);
      s = await state();
      expect(
        comp(s, 'Scalar').net.nodes.length === comp(before, 'Scalar').net.nodes.length + 1,
        'New place drawn',
      );
      expect(terms(s) === terms(before), 'Drawing keeps refs');
      await key('s');
      // Component copy retains bindings and layout.
      const cBefore = await state();
      await page.locator('.component-actions').getByRole('button', { name: 'Copy…' }).click();
      await page.locator('#new-component-name').fill('ScalarCopy');
      await page.locator('app-document-dialog button[type=submit]').click();
      s = await state();
      const copy = comp(s, 'ScalarCopy');
      const src = comp(cBefore, 'Scalar');
      expect(
        !!copy && s.componentId === copy.id && copy.active,
        'Copy component active and selected',
        s.network.components.map((c) => c.net.template),
      );
      expect(
        copy &&
          JSON.stringify(copy.net.arcs) === JSON.stringify(src.net.arcs) &&
          JSON.stringify(copy.net.nodes) === JSON.stringify(src.net.nodes) &&
          JSON.stringify(copy.timing) === JSON.stringify(src.timing),
        'Copy retains nodes/arcs/bindings/timing exactly',
      );
      expect(s.past === cBefore.past + 1, 'Copy component is one entry');
      const k = await expand('K');
      expect(/ScalarCopy/.test(await k.innerText()), 'Copy listed among K uses');
    },
  );

  await check(
    'C08',
    'Untimed inline arc fields parse names; blur without change does not edit',
    async (expect) => {
      await openFile(UNTIMED);
      let s = await state();
      const before = s;
      expect(
        !s.network.type.timed && s.network.constants.length === 2,
        'Untimed constants document opened',
        s.banner,
      );
      expect(
        s.arcLabels.at === 'W' || /W/.test(s.arcLabels.at),
        'Weight label W on canvas',
        s.arcLabels,
      );
      await clickArc('at');
      const w = page.locator('#arc-weight');
      expect((await w.inputValue()) === 'W', 'Inline weight shows W');
      await w.focus();
      await focusCanvas();
      s = await state();
      expect(s.source === before.source && s.past === 0, 'Focus/blur without change keeps source');
      // Simulation: a has 2 tokens, W=2 so t enabled. Change W to 3 -> disabled.
      await simulate();
      s = await state();
      expect(
        s.enabled.some((e) => /^t\b/.test(e) || e.includes('t')),
        'W=2: t enabled',
        s.enabled,
      );
      await editMode();
      await openDeclaration('W');
      await fillDeclaration(undefined, '3');
      await simulate();
      s = await state();
      expect(!s.enabled.length, 'W=3: t disabled (resolved value used)', s.enabled);
      await editMode();
      await clickArc('at');
      await page.locator('#arc-weight').fill('1');
      await page.locator('#arc-weight').press('Enter');
      await focusCanvas();
      s = await state();
      expect(
        arcOf(s, 'Plain', 'at').weight === 1,
        'Inline literal replaces ref',
        arcOf(s, 'Plain', 'at').weight,
      );
      await clickArc('at');
      await page.locator('#arc-weight').fill('H');
      await page.locator('#arc-weight').press('Enter');
      await focusCanvas();
      s = await state();
      expect(nameOf(s, arcOf(s, 'Plain', 'at').weight) === '@H', 'Inline name parses to ref');
      await clickArc('at');
      const p0 = (await state()).past;
      await page.locator('#arc-weight').fill('Q');
      await page.locator('#arc-weight').press('Enter');
      s = await state();
      expect(
        s.past === p0 && /Q|constant|integer/i.test(s.error),
        'Unknown inline name refused',
        s.error,
      );
      expect(
        (await page.locator('#arc-weight').inputValue()) === 'H',
        'Inline field restored to source text',
      );
      await dismissError();
      // Inhibitor kind switch keeps ref
      await clickArc('tb');
      await page
        .locator('#arc-kind')
        .selectOption('inhibitor')
        .catch(() => {});
      s = await state();
      expect(
        nameOf(s, arcOf(s, 'Plain', 'tb').weight) === '@W',
        'Kind change (refused or applied) keeps W ref',
        [arcOf(s, 'Plain', 'tb'), s.error],
      );
      await dismissError();
    },
  );

  await check('C09', 'Resolved timed behaviour follows constant edits', async (expect) => {
    await openFile(SCALAR);
    // p has 3 tokens age 0, <= D(5). o needs K=2 tokens aged [K,D]=[2,5].
    await simulate();
    let s = await state();
    expect(!s.enabled.some((e) => /\.o$/.test(e)), 'At time 0 o disabled', s.enabled);
    await delay('2');
    s = await state();
    expect(
      s.enabled.some((e) => /\.o$/.test(e)),
      'At age 2 o enabled (K=2)',
      s.enabled,
    );
    await editMode();
    await openDeclaration('K');
    await fillDeclaration(undefined, '3');
    await simulate();
    await delay('2');
    s = await state();
    expect(!s.enabled.some((e) => /\.o$/.test(e)), 'K=3: at age 2 o disabled', s.enabled);
    await delay('1');
    s = await state();
    expect(
      s.enabled.some((e) => /\.o$/.test(e)),
      'K=3: at age 3 o enabled',
      s.enabled,
    );
    // Invariant <= D: max delay from age 3 is 2.
    expect(/2/.test(s.legalText ?? ''), 'Legal delay bound reflects D=5', s.legalText);
    await editMode();
  });

  await check(
    'C10',
    'Saves: mid-run TAPN byte-equal, symbolic native output, JSON v3 reopen',
    async (expect) => {
      await openFile(MULTI);
      await openDeclaration('D');
      await fillDeclaration(undefined, '6');
      const pre = await saveTapn('multi-pre.tapn');
      expect(!!pre, 'Pre-run TAPN downloaded');
      let s = await state();
      const source = s.source;
      expect(!s.dirty, 'Save clears dirty');
      expect(
        /<constant name="D" value="6"\/>/.test(pre.text) &&
          /weight="K"/.test(pre.text) &&
          /inscription="\[0,D\]"/.test(pre.text) &&
          /invariant="&lt;= K"/.test(pre.text),
        'Native output symbolic',
        pre.text.slice(0, 400),
      );
      expect(/<net id="Side" active="false"/.test(pre.text), 'Inactive component saved');
      await simulate();
      await delay('1.5');
      const mid = await saveTapn('multi-mid.tapn');
      expect(mid && mid.text === pre.text, 'Mid-run TAPN byte-equal to pre-run save');
      await editMode();
      s = await state();
      expect(s.source === source, 'Source unchanged after simulation');
      const json = await saveJson('multi.json');
      const parsed = JSON.parse(json.text);
      expect(
        parsed.version === 3 &&
          parsed.network.constants.length === 3 &&
          parsed.network.shared.places.length === 0 &&
          parsed.network.shared.transitions.length === 0,
        'JSON v3 with constants and empty shared declarations',
        [parsed.version],
      );
      await openFile(json.path);
      s = await state();
      expect(s.source === source, 'JSON v3 reopen is deep-equal to authored source', s.banner);
      await openFile(mid.path);
      s = await state();
      const reopened = s.network;
      expect(
        JSON.stringify(reopened.constants.map((c) => [c.name, c.value])) ===
          JSON.stringify(JSON.parse(source).constants.map((c) => [c.name, c.value])) &&
          nameOf(s, arcOf(s, 'Main', 'pt').weight) === '@K' &&
          reopened.components[1].active === false,
        'TAPN reopen retains authored meaning',
      );
    },
  );

  await check(
    'C11',
    'Clipboard v3 fidelity, collision refusal and numeric compatibility',
    async (expect) => {
      await openFile(MULTI);
      await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
      const before = await state();
      // Rubber-band select the symbolic p -> t region from empty canvas.
      const a = await nodePoint('p');
      const b = await nodePoint('t');
      await page.mouse.move(a.x - 45, a.y - 60);
      await page.mouse.down();
      await page.mouse.move(b.x + 30, b.y + 30, { steps: 6 });
      await page.mouse.up();
      let s = await state();
      expect(s.selected.includes('pt'), 'Symbolic arc selected', s.selected);
      await focusCanvas();
      await key('Control+c');
      await page.waitForTimeout(150);
      const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(
        copied.version === 3 && copied.constants.length === 2,
        'V3 copies exactly K and D dependencies',
        copied,
      );
      expect(
        copied.fragment.arcs[0].weight.constantId === arcOf(before, 'Main', 'pt').weight.constantId,
        'Symbolic weight identity retained',
      );
      await key('Control+v');
      s = await state();
      expect(
        !s.error && comp(s, 'Main').net.nodes.length === 8 && s.past === before.past + 1,
        'Symbolic paste adds two nodes in one entry',
        s.error,
      );
      expect(
        JSON.stringify(s.network.constants) === JSON.stringify(before.network.constants),
        'Same-document paste adds no declarations',
      );
      expect(
        comp(s, 'Main').net.arcs.at(-1).weight.constantId ===
          copied.fragment.arcs[0].weight.constantId,
        'Pasted weight remains a reference',
      );
      await key('Control+z');
      s = await state();
      expect(s.source === before.source, 'Undo restores exact symbolic source');
      // A single place with a symbolic invariant is independently transferable.
      await clickNode('p');
      await key('Control+c');
      await page.waitForTimeout(150);
      const placeCopy = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(
        placeCopy.version === 3 &&
          placeCopy.constants.length === 1 &&
          placeCopy.constants[0].name === 'D',
        'Invariant-only dependency closure',
      );
      await key('Control+d');
      s = await state();
      expect(
        !s.error && comp(s, 'Main').net.nodes.length === 7,
        'Symbolic invariant duplicate succeeds',
        s.error,
      );
      await key('Control+z');
      // A new document has the same names and values: cross-document merge still refuses.
      await openFile(MULTI);
      const collisionBefore = await state();
      await focusCanvas();
      await key('Control+v');
      s = await state();
      expect(
        /already declares constant D/.test(s.error),
        'Equal-value same-name collision refused',
        s.error,
      );
      expect(
        s.source === collisionBefore.source &&
          s.past === collisionBefore.past &&
          s.saved === collisionBefore.saved,
        'Collision leaves source, history and checkpoint unchanged',
      );
      await dismissError();
      // Numeric-only island in the same constants document
      const c = await nodePoint('n1');
      const d = await nodePoint('n2');
      await page.mouse.move(c.x - 45, c.y - 60);
      await page.mouse.down();
      await page.mouse.move(d.x + 45, d.y + 45, { steps: 6 });
      s = await state();
      expect(
        ['n1', 'nt', 'n2', 'n1nt', 'ntn2'].every((id) => s.selected.includes(id)) &&
          s.selected.length === 5,
        'Numeric island selected',
        s.selected,
      );
      await page.mouse.up();
      await focusCanvas();
      await key('Control+c');
      await page.waitForTimeout(200);
      s = await state();
      expect(!s.error && /Copied/.test(s.notice), 'Numeric-only copy succeeds', [
        s.error,
        s.notice,
      ]);
      expect(
        (await page.evaluate(() => navigator.clipboard.readText())) !== 'SENTINEL',
        'System clipboard written for numeric copy',
      );
      await key('Control+v');
      await page.waitForTimeout(200);
      s = await state();
      expect(
        comp(s, 'Main').net.nodes.length === 9 && s.past === before.past + 1,
        'Numeric paste adds 3 nodes in one entry',
        [comp(s, 'Main').net.nodes.length, s.past, s.error],
      );
      expect(
        nameOf(s, arcOf(s, 'Main', 'pt').weight) === '@K',
        'Existing refs retained after paste',
      );
      await key('Control+d');
      s = await state();
      expect(
        s.past === before.past + 2 && !s.error,
        'Duplicate of numeric selection works',
        s.error,
      );
      await key('Control+x');
      await page.waitForTimeout(200);
      s = await state();
      expect(s.past === before.past + 3 && !s.error, 'Cut of numeric selection works', s.error);
    },
  );
  // The dialogs are modal, but the toolbar may stay reachable by mouse. Whatever route exists,
  // an undo/redo ABA (same source content, new workspace) must not apply a stale draft.
  await check(
    'C12',
    'Undo/redo ABA by mouse cannot apply stale constant or element drafts',
    async (expect) => {
      await openFile(SCALAR);
      await openDeclaration('D');
      await fillDeclaration(undefined, '6');
      const undo = await toolbar('Undo').boundingBox();
      const redo = await toolbar('Redo').boundingBox();
      const click = (b) => page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      // What sits on top of the Undo button while a dialog is open (read-only DOM probe).
      const hit = () =>
        page.evaluate(
          ([x, y]) => {
            const e = document.elementFromPoint(x, y);
            return e?.closest('button')?.getAttribute('aria-label') ?? e?.className ?? e?.tagName;
          },
          [undo.x + undo.width / 2, undo.y + undo.height / 2],
        );
      // Constant draft
      await openDeclaration('K');
      let s0 = await state();
      const topConstant = await hit();
      await click(undo);
      let mid = await state();
      await click(redo);
      let s = await state();
      const reached = mid.source !== s0.source;
      expect(
        true,
        `Constant dialog: element under Undo is ${topConstant}; undo ${reached ? 'reached' : 'did not reach'} the document`,
      );
      await page.locator('#constant-value').fill('4');
      await page.locator('app-constant-dialog button[type=submit]').click();
      s = await state();
      const k = s.network.constants.find((c) => c.name === 'K').value;
      expect(
        reached ? k === 2 && s.constantDialog : k === 4,
        reached
          ? 'Stale constant draft refused after undo/redo ABA'
          : 'Constant draft applies (no ABA possible)',
        [s.constantDialogAlert, k],
      );
      if (s.constantDialog) await cancelDeclaration();
      // Element draft
      s0 = await state();
      await openArcDialog('in');
      const topElement = await hit();
      await click(undo);
      mid = await state();
      await click(redo);
      const reachedElement = mid.source !== s0.source;
      expect(
        true,
        `Element dialog: element under Undo is ${topElement}; undo ${reachedElement ? 'reached' : 'did not reach'} the document`,
      );
      await field('dialog-weight').fill('D');
      await submitDialog();
      s = await state();
      const w = nameOf(s, arcOf(s, 'Scalar', 'in').weight);
      expect(
        reachedElement ? w === '@K' && s.elementDialog : w === '@D',
        reachedElement
          ? 'Stale element draft refused after undo/redo ABA'
          : 'Element draft applies (no ABA possible)',
        [s.elementDialogAlert, w],
      );
      // Keyboard shortcuts inside a dialog do not undo.
      if (s.elementDialog) await cancelDialog();
      s0 = await state();
      await openDeclaration('K');
      await page.locator('#constant-value').press('Control+z');
      s = await state();
      expect(
        s.past === s0.past && s.source === s0.source,
        'Ctrl+Z inside constant dialog does not undo the document',
      );
      await cancelDeclaration();
    },
  );

  await check(
    'C13',
    'Simulation lifecycle with tabs; histories and checkpoints per tab',
    async (expect) => {
      await openFile(SCALAR);
      await openDeclaration('K');
      await fillDeclaration(undefined, '1');
      const a = await state();
      await openFile(MULTI);
      const b = await state();
      const tab = (n) =>
        page.locator('.document-tab').filter({ hasText: n }).locator('button').first();
      expect(
        b.docCount === a.docCount + 1 && b.past === 0,
        'Second document opened with its own history',
      );
      await tab(a.network.name).click();
      let s = await state();
      expect(
        s.source === a.source && s.past === 1 && s.dirty,
        'First tab keeps edited source/history/dirty',
      );
      await simulate();
      await delay('1');
      s = await state();
      expect(s.mode === 'Simulate', 'Simulating first tab');
      await tab(b.network.name).click();
      s = await state();
      expect(s.source === b.source, 'Switched to second tab', s.mode);
      await tab(a.network.name).click();
      s = await state();
      expect(
        s.source === a.source && s.past === 1,
        'First tab source/history intact after tab switches',
        s.mode,
      );
      if (s.mode === 'Simulate') await editMode();
      s = await state();
      expect(s.mode === 'Edit' && s.source === a.source, 'Back in Edit with unchanged source');
      await toolbar('Undo').click();
      s = await state();
      expect(
        s.network.constants.find((c) => c.name === 'K').value === 2 && !s.dirty,
        'Undo after simulation restores clean source',
      );
    },
  );

  await check(
    'C14',
    'Legacy v1 JSON imports migrate to authored and save as v3',
    async (expect) => {
      const v1 = write(
        'legacy-v1.json',
        JSON.stringify({
          format: 'tapaal-web-network',
          version: 1,
          network: {
            name: 'Legacy',
            type: { timed: true, colored: false, game: false, stochastic: false },
            components: [
              {
                id: 'main',
                active: true,
                net: {
                  name: 'Legacy',
                  template: 'Main',
                  nodes: [
                    { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 100, y: 100 },
                    { id: 't', name: 'T', kind: 'transition', tokens: 0, x: 250, y: 100 },
                  ],
                  arcs: [{ id: 'a', source: 'p', target: 't', kind: 'normal', weight: 2 }],
                },
                timing: {
                  intervals: {
                    a: { lower: '1', upper: '4', lowerClosed: true, upperClosed: false },
                  },
                  invariants: { p: { upper: '5', upperClosed: true } },
                  urgent: [],
                  transports: [],
                  ages: { p: ['0.5', '1.25'] },
                },
              },
            ],
          },
        }),
      );
      await openFile(v1);
      let s = await state();
      expect(
        s.network && s.network.constants.length === 0 && s.past === 0,
        'v1 opened with empty constants',
        s.banner,
      );
      expect(
        JSON.stringify(comp(s, 'Main').timing.ages.p) === '["0.5","1.25"]',
        'Exact ages retained',
      );
      const json = await saveJson('legacy-v2.json');
      expect(
        JSON.parse(json.text).version === 3 &&
          JSON.parse(json.text).network.shared.places.length === 0,
        'Saved as JSON v3 with explicit empty pool authority',
      );
      const tapn = await saveTapn('legacy.tapn');
      s = await state();
      expect(
        /4\.0\.4 resets nonzero initial ages/.test(s.notice),
        'Nonzero-age TAPN warning retained',
        s.notice,
      );
      expect(
        !!tapn && !/<constant /.test(tapn.text),
        'No declarations emitted for a constant-free document',
      );
      // Constants added to a migrated document.
      await addDeclaration();
      await fillDeclaration('W', '2');
      await clickArc('a', { clickCount: 2 });
      await page.locator('app-element-dialog form').waitFor();
      await field('dialog-weight').fill('W');
      await field('dialog-interval').fill('[1,W)');
      await submitDialog();
      s = await state();
      expect(
        nameOf(s, arcOf(s, 'Main', 'a').weight) === '@W' &&
          nameOf(s, comp(s, 'Main').timing.intervals.a.upper) === '@W',
        'Weight and interval upper reference W',
        s.elementDialogAlert,
      );
      expect(
        JSON.stringify(comp(s, 'Main').timing.ages.p) === '["0.5","1.25"]',
        'Ages retained across symbolic edit',
      );
    },
  );

  await check(
    'C15',
    'Paired timed edits: marking/ages, urgency, transport pairing atomic and guarded',
    async (expect) => {
      await openFile(SCALAR);
      let s = await state();
      const before = s;
      // Marking and ages together on p (symbolic invariant <= D retained).
      await openNodeDialog('p');
      await field('dialog-tokens').fill('4');
      await field('dialog-ages').fill('0, 1, 2, 3');
      await submitDialog();
      s = await state();
      const sc = comp(s, 'Scalar');
      expect(
        !s.elementDialog &&
          sc.net.nodes.find((n) => n.id === 'p').tokens === 4 &&
          JSON.stringify(sc.timing.ages.p) === '["1","2","3"]',
        'Marking+ages applied atomically',
        [s.elementDialogAlert, sc.timing.ages.p],
      );
      expect(nameOf(s, sc.timing.invariants.p.upper) === '@D', 'Symbolic invariant retained');
      expect(s.past === 1, 'One history entry');
      // Age beyond invariant D=5 refused.
      await openNodeDialog('p');
      await field('dialog-ages').fill('0, 1, 2, 6');
      await submitDialog();
      s = await state();
      expect(
        s.elementDialog && s.past === 1,
        'Age beyond symbolic invariant refused',
        s.elementDialogAlert,
      );
      await cancelDialog();
      // Mismatched token count and ages refused.
      await openNodeDialog('p');
      await field('dialog-tokens').fill('2');
      await submitDialog();
      s = await state();
      expect(
        (s.elementDialog && s.past === 1) || (!s.elementDialog && s.past === 2),
        'Token count edit either refused or applied as one entry',
        [s.elementDialogAlert, s.past],
      );
      if (s.elementDialog) await cancelDialog();
      // Urgent transition o has symbolic input interval [K,D]: documented gate rejects.
      const p0 = (await state()).past;
      await openNodeDialog('o');
      await field('dialog-urgent').check();
      await submitDialog();
      s = await state();
      expect(
        s.elementDialog && s.past === p0,
        'Urgent with symbolic input interval refused (documented gate)',
        s.elementDialogAlert,
      );
      await cancelDialog();
      // Changing transport pairing on ti is atomic and keeps refs or is refused unchanged.
      await openArcDialog('ti');
      const options = await field('dialog-transport').locator('option').allTextContents();
      await field('dialog-transport').selectOption({ index: 0 });
      await submitDialog();
      s = await state();
      const t = comp(s, 'Scalar').timing.transports;
      expect(
        (s.elementDialog && s.past === p0) || (!s.elementDialog && s.past === p0 + 1),
        'Transport unpairing is a single atomic edit or refusal',
        [options, t, s.elementDialogAlert],
      );
      if (s.elementDialog) await cancelDialog();
      expect(
        nameOf(s, arcOf(s, 'Scalar', 'ti').weight) === '@K',
        'Transport input weight ref retained',
      );
    },
  );

  await check(
    'C16',
    'Component activation, rename and reorder keep authored terms',
    async (expect) => {
      await openFile(MULTI);
      const before = await state();
      const terms = (s) =>
        JSON.stringify(
          s.network.components.map((c) => [c.id, c.net.arcs.map((a) => a.weight), c.timing]),
        );
      await page.locator('input[aria-label="Include Side in network"]').check();
      let s = await state();
      expect(
        comp(s, 'Side').active === true && terms(s) === terms(before),
        'Activate Side keeps terms',
        s.error,
      );
      await page.getByRole('button', { name: 'Move component down' }).click();
      s = await state();
      expect(
        terms(s) !== '' &&
          JSON.stringify(s.network.constants) === JSON.stringify(before.network.constants),
        'Reorder keeps declarations',
      );
      // D=7 now conflicts in an active component as well.
      await openDeclaration('D');
      await fillDeclaration(undefined, '7');
      s = await state();
      expect(
        s.constantDialog && /Side/.test(s.constantDialogAlert ?? ''),
        'Conflict still refused after activation',
        s.constantDialogAlert,
      );
      await cancelDeclaration();
    },
  );
  await check(
    'C17',
    'Delete key, new arcs, inf endpoints and use labels in a constants document',
    async (expect) => {
      await openFile(MULTI);
      const before = await state();
      // Plain Delete is not a clipboard transfer; it may remove a symbolic arc undoably.
      await clickArc('pt');
      await focusCanvas();
      await key('Delete');
      let s = await state();
      expect(
        !arcOf(s, 'Main', 'pt') && s.past === 1 && s.network.constants.some((c) => c.name === 'K'),
        'Delete removes symbolic arc; declaration kept',
        s.error,
      );
      const k = await expand('K');
      expect(
        /Side \(inactive\)/.test(await k.innerText()) && !/Main \//.test(await k.innerText()),
        'Uses view drops deleted Main use',
        await k.innerText(),
      );
      await toolbar('Undo').click();
      s = await state();
      expect(s.source === before.source, 'Undo restores the symbolic arc exactly');
      // Draw a new arc q -> nt (literal default).
      await page
        .locator('[aria-label="Workspace tools"]')
        .getByRole('button', { name: 'Arc', exact: true })
        .click();
      await clickNode('q');
      await clickNode('nt');
      await key('s');
      s = await state();
      const added = comp(s, 'Main').net.arcs.find((a) => a.source === 'q' && a.target === 'nt');
      expect(added && added.weight === 1, 'New arc gets literal weight 1', [added, s.error]);
      expect(
        nameOf(s, arcOf(s, 'Main', 'pt').weight) === '@K',
        'Existing ref retained after drawing',
      );
      // Interval/invariant inf forms.
      const p0 = s.past;
      await openArcDialog('pt');
      await field('dialog-interval').fill('[0,inf]');
      await submitDialog();
      s = await state();
      expect(s.elementDialog && s.past === p0, 'Closed inf upper refused', s.elementDialogAlert);
      await field('dialog-interval').fill('[inf,D]');
      await submitDialog();
      s = await state();
      expect(s.elementDialog && s.past === p0, 'inf lower refused', s.elementDialogAlert);
      await field('dialog-interval').fill('[K,inf)');
      await submitDialog();
      s = await state();
      const iv = comp(s, 'Main').timing.intervals.pt;
      expect(
        !s.elementDialog && nameOf(s, iv.lower) === '@K' && iv.upper === null,
        'Symbolic lower with inf upper accepted',
        [s.elementDialogAlert, iv],
      );
      await openNodeDialog('p');
      await field('dialog-invariant').fill('<= inf');
      await submitDialog();
      s = await state();
      expect(s.elementDialog, 'Invariant <= inf refused', s.elementDialogAlert);
      await cancelDialog();
      // Use labels for arcs: report the label text actually shown.
      const d = await expand('D');
      expect(
        true,
        `Arc use labels shown as: ${(await d.innerText())
          .split('\n')
          .filter((l) => / \/ (lower|upper|weight)$/.test(l))
          .join(' | ')}`,
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
