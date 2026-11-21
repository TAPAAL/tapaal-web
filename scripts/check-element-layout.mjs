#!/usr/bin/env node
// Real-input browser validation. App signals and rendered DOM are read only.
// PLAYWRIGHT_CORE=/absolute/path/to/playwright-core node web/scripts/check-element-layout.mjs URL OUT
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const base = process.argv[2] ?? 'http://127.0.0.1:4187';
const out = process.argv[3] ?? '/tmp/tapaal-element-layout-validation';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const results = [];
const settle = async () => {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
};
const state = async () => {
  await settle();
  return page.evaluate(() => {
    const a = ng.getComponent(document.querySelector('app-root'));
    return {
      net: a.net(),
      view: a.viewport(),
      selected: a.selectedIds(),
      undo: a.canUndo(),
      redo: a.canRedo(),
      notice: a.notice(),
      error: a.error(),
    };
  });
};
const node = (id) => page.locator(`[data-node="${id}"] .node-shape`);
const label = (id) => page.locator(`[data-node="${id}"] .node-name`);
const note = () => page.locator('[data-note] > rect').first();
const near = (a, b) => Math.abs(a - b) < 1.1;
const key = (k) => page.keyboard.press(k);
const undo = async () => {
  await key('Control+z');
  await settle();
};
const shot = (name) => page.screenshot({ path: join(out, name + '.png') });
async function fresh() {
  await page.goto(base);
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  await page.locator('svg.net-canvas').focus();
}
async function drag(loc, dx, dy, cancel = false) {
  const b = await loc.boundingBox();
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
  if (cancel) await key('Escape');
  await page.mouse.up();
  await settle();
}
async function wheel(loc, dy, modifier) {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  if (modifier) await page.keyboard.down(modifier);
  try {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(100);
  } finally {
    if (modifier) await page.keyboard.up(modifier);
  }
}
async function addNote(text = 'Layout validation\nsecond line') {
  await page.getByRole('button', { name: 'Annotation', exact: true }).click();
  await page.mouse.click(500, 570);
  await page.locator('#annotation-text').fill(text);
  await page.locator('app-annotation-dialog button[type=submit]').click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
}
async function menu(loc, text) {
  await loc.click({ button: 'right' });
  await page.getByRole('menuitem', { name: text, exact: true }).click();
}
async function check(id, fn) {
  const r = { id, status: 'pass', observations: [] };
  const expect = (ok, msg) => {
    r.observations.push({ ok, ...(typeof msg === 'string' ? { message: msg } : msg) });
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
  console.log(JSON.stringify(r));
}
try {
  await check('A1-create-edit-delete', async (expect) => {
    await addNote('   ');
    expect(!(await state()).net.annotations?.length, 'Blank creation adds nothing');
    await addNote();
    let s = await state();
    const original = s.net.annotations[0];
    expect(original.x === 195 && original.y === 480 && original.height === 32, {
      message: 'Grid-snapped multiline creation',
      actual: original,
    });
    await note().dblclick();
    await page.locator('#annotation-text').fill('Edited <&> annotation\nsecond line');
    await page.locator('app-annotation-dialog button[type=submit]').click();
    expect(
      (await state()).net.annotations[0].text === 'Edited <&> annotation\nsecond line',
      'Double-click editor saves literal escaped text',
    );
    await shot('A1-edited');
    await key('Delete');
    expect(!(await state()).net.annotations?.length, 'Delete removes selected note');
    await undo();
    expect((await state()).net.annotations[0].text.startsWith('Edited <&>'), 'Undo restores note');
    await note().dblclick();
    await page.locator('#annotation-text').fill('cancelled');
    await key('Escape');
    expect(
      (await state()).net.annotations[0].text.startsWith('Edited <&>'),
      'Escape cancels text draft',
    );
  });
  await check('A2-move-resize-undo', async (expect) => {
    await addNote();
    const original = (await state()).net.annotations[0];
    await drag(note(), 60, -45);
    let moved = (await state()).net.annotations[0];
    expect(moved.x === original.x + 60 && moved.y === original.y - 45, {
      message: 'Move commits grid delta',
      actual: moved,
    });
    await undo();
    expect(
      JSON.stringify((await state()).net.annotations[0]) === JSON.stringify(original),
      'One undo restores whole move',
    );
    await drag(note(), 60, -45, true);
    expect(
      JSON.stringify((await state()).net.annotations[0]) === JSON.stringify(original),
      'Escape cancels move',
    );
    for (const handle of [
      'top-left',
      'top',
      'top-right',
      'right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'left',
    ]) {
      const dx = handle.includes('left') ? -30 : handle.includes('right') ? 30 : 0;
      const dy = handle.includes('top') ? -20 : handle.includes('bottom') ? 20 : 0;
      await drag(page.locator(`[data-resize="${handle}"]`), dx, dy);
      const n = (await state()).net.annotations[0];
      expect(
        n.width === original.width + Math.abs(dx) &&
          n.height === original.height + Math.abs(dy) &&
          n.x === original.x + Math.min(0, dx) &&
          n.y === original.y + Math.min(0, dy),
        { message: `Resize ${handle} preserves opposite edges`, actual: n },
      );
      await undo();
      expect(
        JSON.stringify((await state()).net.annotations[0]) === JSON.stringify(original),
        `One undo restores ${handle}`,
      );
    }
    await drag(page.locator('[data-resize="right"]'), -90, 0);
    expect((await state()).net.annotations[0].width === 40, 'Width clamps to native minimum 40');
    const wrapped = await page.locator('[data-note] svg').evaluate((e) => ({
      height: +e.getAttribute('height'),
      lines: [...e.querySelectorAll('tspan')].map((t) => ({
        text: t.textContent,
        y: +t.getAttribute('y'),
      })),
    }));
    expect(
      wrapped.lines.every((line) => line.y <= wrapped.height),
      {
        message:
          'Narrowing annotation keeps every wrapped line visible (native Note.updateBounds grows to preferred height)',
        actual: wrapped,
      },
    );
    await shot('A2-minimum-width');
  });
  await check('L1-label-drag-visibility', async (expect) => {
    const before = (await state()).net.nodes[0];
    const geometry = await label('idle').evaluate((e) => ({
      x: e.getAttribute('x'),
      y: e.getAttribute('y'),
      anchor: e.getAttribute('text-anchor'),
    }));
    expect(geometry.x === '-15' && geometry.y === '18' && geometry.anchor === 'end', {
      message: 'Native right-anchor placement; baseline 18 gives top near 8',
      actual: geometry,
    });
    await drag(label('idle'), 90, 0);
    let n = (await state()).net.nodes[0];
    expect(n.x === before.x && n.y === before.y && n.nameOffsetX === 90, {
      message: 'Horizontal label drag moves label only',
      actual: n,
    });
    await undo();
    expect(
      !(await state()).net.nodes[0].nameOffsetX,
      'Horizontal-only drag undo works (intentional native bug fix)',
    );
    await drag(label('idle'), 45, 30);
    n = (await state()).net.nodes[0];
    expect(n.nameOffsetX === 45 && n.nameOffsetY === 65, 'Two-axis label drag retains offsets');
    await menu(node('idle'), 'Hide place name');
    expect(
      (await state()).net.nodes[0].nameVisible === false && (await label('idle').count()) === 0,
      'Context hide removes label',
    );
    await menu(node('idle'), 'Show place name');
    expect(
      (await state()).net.nodes[0].nameVisible !== false && (await label('idle').count()) === 1,
      'Context show restores label',
    );
    await shot('L1-offset-label');
  });
  await check('R1-rotation-ports', async (expect) => {
    const paths = () =>
      page
        .locator('[data-arc] .arc-line')
        .evaluateAll((es) => es.slice(0, 2).map((e) => e.getAttribute('d')));
    const initial = await paths();
    await menu(node('start'), 'Rotate +45°');
    let s = await state();
    const rotated = await paths();
    expect(s.net.nodes[1].angle === 45, { message: 'Context rotation +45', actual: rotated });
    expect(
      rotated[0] === 'M 175 240 L 316 237' && rotated[1] === 'M 323 244 L 485 240',
      'Both attached arc endpoints follow native rounded rotated ports',
    );
    await shot('R1-rotated');
    await undo();
    expect(
      JSON.stringify(await paths()) === JSON.stringify(initial),
      'Rotation undo restores both arc paths',
    );
    await node('start').click();
    await wheel(node('start'), -100);
    expect((await state()).net.nodes[1].angle === 135, 'Selected transition wheel up +135');
    await wheel(node('start'), 100, 'Control');
    s = await state();
    expect(
      s.net.nodes[1].angle === 180 && s.view.zoom === 100,
      'Selected transition Ctrl+wheel +45 takes precedence over zoom',
    );
    await wheel(node('start'), 100, 'Shift');
    s = await state();
    expect(
      s.net.nodes[1].angle === 225 && s.view.x === 0,
      'Selected transition Shift+wheel rotates without horizontal pan',
    );
    await node('start').dblclick();
    await page.locator('#dialog-rotation').selectOption({ label: '−45° (native +135°)' });
    await page.locator('app-element-dialog button[type=submit]').click();
    expect(!(await state()).net.nodes[1].angle, 'Editor native +135 increment wraps 225 to zero');
  });
  await check('T1-token-wheel-precedence', async (expect) => {
    await page.getByRole('button', { name: 'Add token', exact: true }).click();
    await node('idle').click();
    expect((await state()).net.nodes[0].tokens === 2, 'Add-token tool adds exactly one');
    await page.getByRole('button', { name: 'Remove token', exact: true }).click();
    for (let i = 0; i < 3; i++) await node('idle').click();
    expect((await state()).net.nodes[0].tokens === 0, 'Remove-token tool clamps at zero');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await node('idle').click();
    await wheel(node('idle'), -100, 'Control');
    let s = await state();
    expect(
      s.net.nodes[0].tokens === 1 && s.view.zoom === 100,
      'Selected place Ctrl+wheel adds token without zoom',
    );
    await wheel(node('idle'), 100, 'Shift');
    s = await state();
    expect(
      s.net.nodes[0].tokens === 0 && s.view.x === 0,
      'Selected place Shift+wheel removes token without pan',
    );
    for (let i = 0; i < 5; i++)
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await node('idle').click();
    await wheel(node('idle'), -100);
    s = await state();
    expect(
      s.net.nodes[0].tokens === 1 && s.view.zoom === 150,
      'Selected-place wheel works at 150%',
    );
    await shot('T1-tokens-150');
  });
  await check('C1-clipboard-layout', async (expect) => {
    await addNote('Clipboard <&>\nsecond line');
    await drag(label('idle'), 45, 30);
    await menu(node('idle'), 'Hide place name');
    await menu(node('start'), 'Rotate +45°');
    await page.locator('svg.net-canvas').focus();
    await key('Control+a');
    const before = await state();
    await key('Control+c');
    await key('Control+v');
    await page.waitForTimeout(250);
    const after = await state();
    expect(
      after.net.nodes.length === 12 &&
        after.net.arcs.length === 12 &&
        after.net.annotations?.length === 2,
      {
        message: 'Keyboard clipboard pastes whole layout',
        notice: after.notice,
        counts: [after.net.nodes.length, after.net.arcs.length, after.net.annotations?.length],
      },
    );
    const copied = after.net.nodes.find((n) => n.id !== 'idle' && n.nameVisible === false);
    const rotated = after.net.nodes.find((n) => n.id !== 'start' && n.angle === 45);
    expect(copied?.nameOffsetX === 45 && copied?.nameOffsetY === 65 && !!rotated, {
      message: 'Pasted hidden name, offsets, rotation preserved',
      copied,
      rotated,
    });
    const [a, b] = after.net.annotations ?? [];
    expect(
      b?.text === a?.text && b?.width === a?.width && b?.height === a?.height && b?.id !== a?.id,
      {
        message: 'Annotation clipboard preserves text/size and remaps id',
        annotations: after.net.annotations,
      },
    );
    expect(
      !!copied &&
        near(copied.x - before.net.nodes[0].x, b.x - a.x) &&
        near(copied.y - before.net.nodes[0].y, b.y - a.y),
      'Node and annotation share paste translation',
    );
    await shot('C1-pasted');
    const receiver = await context.newPage();
    try {
      await receiver.goto(base);
      await receiver.waitForFunction(() =>
        window.ng?.getComponent(document.querySelector('app-root')),
      );
      await receiver.locator('svg.net-canvas').focus();
      await receiver.keyboard.press('Control+v');
      await receiver.waitForTimeout(250);
      const received = await receiver.evaluate(() => {
        const a = ng.getComponent(document.querySelector('app-root'));
        return { net: a.net(), notice: a.notice() };
      });
      expect(
        received.net.nodes.length === 12 &&
          received.net.annotations?.length === 1 &&
          received.net.nodes.some((n) => n.nameVisible === false && n.nameOffsetX === 45) &&
          received.net.nodes.some((n) => n.angle === 45),
        {
          message: 'Fresh tab with no internal clipboard receives system clipboard layout',
          notice: received.notice,
        },
      );
      await receiver.screenshot({ path: join(out, 'C1-system-clipboard-receiver.png') });
    } finally {
      await receiver.close();
    }
    await page.bringToFront();
    await undo();
    expect(
      (await state()).net.nodes.length === 6 && (await state()).net.annotations.length === 1,
      'One undo removes complete paste',
    );
  });
  await check('N1-navigation-fit', async (expect) => {
    const svg = page.locator('svg.net-canvas');
    const b = await svg.boundingBox();
    await page.mouse.move(b.x + 200, b.y + 50);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    let s = await state();
    expect(s.view.y === 100 && s.view.zoom === 100, {
      message: 'Plain blank-canvas wheel scrolls',
      view: s.view,
    });
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
    s = await state();
    expect(s.view.x === 100, 'Shift wheel scrolls horizontally');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    s = await state();
    expect(s.view.zoom === 110, 'Blank Ctrl+wheel zooms in');
    await page.mouse.move(b.x + 200, b.y + 50);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(b.x + 160, b.y + 10, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const pan = (await state()).view;
    expect(pan.x > s.view.x && pan.y > s.view.y, { message: 'Middle drag pans', view: pan });
    await page.getByRole('button', { name: 'Fit model', exact: true }).click();
    s = await state();
    const boxes = await page
      .locator('[data-node] .node-shape,[data-node] .node-name')
      .evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
    expect(
      boxes.every(
        (r) =>
          r.x >= b.x - 1 &&
          r.y >= b.y - 1 &&
          r.right <= b.x + b.width + 1 &&
          r.bottom <= b.y + b.height + 1,
      ),
      { message: 'Fit contains all sample outlines and labels', view: s.view },
    );
    await page.getByRole('button', { name: 'Restore zoom (100%)', exact: true }).click();
    expect((await state()).view.zoom === 100, 'Fit toggle restores 100%');
    await addNote();
    await drag(label('idle'), -110, -120);
    await page.getByRole('button', { name: 'Fit model', exact: true }).click();
    await settle();
    const elements = await page
      .locator('[data-note]>rect,[data-node] .node-shape,[data-node] .node-name')
      .evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
    expect(
      elements.every(
        (r) =>
          r.x >= b.x - 1 &&
          r.y >= b.y - 1 &&
          r.right <= b.x + b.width + 1 &&
          r.bottom <= b.y + b.height + 1,
      ),
      { message: 'Fit includes annotation and moved label', view: (await state()).view },
    );
    await shot('N1-fit-layout');
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(
  `${results.filter((r) => r.status === 'pass').length}/${results.length} scenarios passed; artifacts ${out}`,
);
process.exitCode = results.some((r) => r.status !== 'pass') ? 1 : 0;
