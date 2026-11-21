#!/usr/bin/env node
// Browser validation of native core editing workflows (see design/NATIVE-CORE-VALIDATION.md).
// Drives a running dev server with real Playwright mouse/keyboard input; app state is only read.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   node scripts/check-native-core.mjs http://127.0.0.1:4317 /tmp/tapaal-native-core
//
// Exit status 1 when any check fails. Results: <out>/results.json, screenshots and saved models.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4317';
const OUT = process.argv[3] ?? '/tmp/tapaal-native-core';
mkdirSync(OUT, { recursive: true });

const results = [];
let page;

// ---- read-only state probes -------------------------------------------------
// Signals update synchronously but the SVG renders on the next frame; wait for it.
const settle = () =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
const state = async () => {
  await settle();
  return readState();
};
const readState = () =>
  page.evaluate(() => {
    const app = window.ng.getComponent(document.querySelector('app-root'));
    const proto = document.querySelector('path.prototype-arc');
    return {
      view: app.viewport(),
      net: app.net(),
      selected: app.selectedIds(),
      tool: app.tool(),
      arcStart: app.arcStart(),
      canUndo: app.canUndo(),
      canRedo: app.canRedo(),
      grid: app.gridSpacing(),
      error: app.error(),
      notice: app.notice(),
      dialogOpen: !!app.editingElement(),
      proto: proto?.getAttribute('d') ?? null,
      pageScale: window.visualViewport?.scale ?? 1,
    };
  });
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
const nodeBox = async (id) =>
  (await settle()) ??
  page.evaluate((id) => {
    const r = document.querySelector(`[data-node="${id}"] .node-shape`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
  }, id);
const byName = (s, name) => s.net.nodes.find((n) => n.name === name);
const names = (s) => s.net.nodes.map((n) => n.name);
const arcNames = (s) =>
  s.net.arcs.map(
    (a) =>
      `${s.net.nodes.find((n) => n.id === a.source)?.name}${a.kind === 'inhibitor' ? '-o' : '->'}${s.net.nodes.find((n) => n.id === a.target)?.name}`,
  );
const protoEnd = (d) => {
  const m = d && /L ([-\d.e]+) ([-\d.e]+)\s*$/.exec(d);
  return m ? { x: +m[1], y: +m[2] } : null;
};

async function fresh() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  await page.locator('svg.net-canvas').focus();
}
async function blank(x, y) {
  return toClient(x, y);
}
async function clickModel(x, y, opts = {}) {
  const p = await toClient(x, y);
  await page.mouse.click(p.x, p.y, opts);
}
async function withKey(key, fn) {
  await page.keyboard.down(key);
  try {
    await fn();
  } finally {
    await page.keyboard.up(key);
  }
}
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}
async function saveModel(name) {
  await page.locator('svg.net-canvas').focus();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.keyboard.press('Control+s'),
  ]);
  const path = join(OUT, `${name}.tapn`);
  await download.saveAs(path);
  return readFileSync(path, 'utf8');
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

const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;

// ---- navigation ---------------------------------------------------------------
const NAV = [
  [
    'N1',
    'Plain wheel scrolls, never zooms',
    async ({ expect, note }) => {
      const c = await blank(400, 120);
      await page.mouse.move(c.x, c.y);
      await page.mouse.wheel(0, 100);
      let s = await state();
      expect(s.view.zoom === 100, `zoom stays 100 after wheel down (got ${s.view.zoom})`);
      expect(near(s.view.y, 100) && near(s.view.x, 0), `view y 0 -> ${s.view.y}, x ${s.view.x}`);
      await page.mouse.wheel(0, -300);
      s = await state();
      expect(s.view.y === 0, `wheel up past origin clamps y to 0 (got ${s.view.y})`);
      await withKey('Shift', () => page.mouse.wheel(0, 120));
      s = await state();
      expect(
        near(s.view.x, 120) && s.view.y === 0,
        `Shift+wheel scrolls x to 120 (got ${s.view.x},${s.view.y})`,
      );
      await page.mouse.wheel(80, 0);
      s = await state();
      expect(near(s.view.x, 200), `horizontal wheel deltaX 80 -> x ${s.view.x}`);
      note(`page visual scale ${s.pageScale}`);
    },
  ],
  [
    'N2',
    'Ctrl+wheel: rotation down zooms in, up zooms out, 10 points per notch',
    async ({ expect }) => {
      const c = await blank(400, 120);
      await page.mouse.move(c.x, c.y);
      await withKey('Control', () => page.mouse.wheel(0, 100));
      let s = await state();
      expect(
        s.view.zoom === 110,
        `Ctrl+wheel down 100 -> ${s.view.zoom} (native zoomIn on rotation>0)`,
      );
      expect(s.view.y === 0, `Ctrl+wheel does not scroll (y ${s.view.y})`);
      await withKey('Control', async () => {
        await page.mouse.wheel(0, -100);
        await page.mouse.wheel(0, -100);
      });
      s = await state();
      expect(s.view.zoom === 90, `two Ctrl+wheel up notches 110 -> ${s.view.zoom}`);
      expect(
        s.pageScale === 1,
        `browser page zoom untouched (visualViewport.scale ${s.pageScale})`,
      );
      await withKey('Control', async () => {
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -100);
      });
      s = await state();
      expect(s.view.zoom === 20, `Ctrl+wheel up clamps at 20 (got ${s.view.zoom})`);
      await withKey('Meta', () => page.mouse.wheel(0, 100));
      s = await state();
      expect(
        s.view.zoom === 30,
        `Meta+wheel also zooms (web Cmd affordance; native is Ctrl only): ${s.view.zoom}`,
      );
    },
  ],
  [
    'N3',
    'Ctrl/Cmd J/K zoom by 10 within 20..300, browser defaults prevented',
    async ({ expect }) => {
      await page.evaluate(() => {
        window.__prevented = [];
        window.addEventListener('keydown', (e) =>
          window.__prevented.push(`${e.key}:${e.defaultPrevented}`),
        );
      });
      await page.keyboard.press('Control+j');
      let s = await state();
      expect(s.view.zoom === 110, `Ctrl+J 100 -> ${s.view.zoom}`);
      await page.keyboard.press('Control+k');
      await page.keyboard.press('Control+k');
      s = await state();
      expect(s.view.zoom === 90, `Ctrl+K twice -> ${s.view.zoom}`);
      await page.keyboard.press('Meta+j');
      s = await state();
      expect(s.view.zoom === 100, `Cmd+J -> ${s.view.zoom}`);
      for (let i = 0; i < 25; i++) await page.keyboard.press('Control+j');
      s = await state();
      expect(s.view.zoom === 300, `Ctrl+J clamps at 300 (got ${s.view.zoom})`);
      expect(
        await page.getByRole('button', { name: 'Zoom in' }).isDisabled(),
        'Zoom in button disabled at 300',
      );
      for (let i = 0; i < 40; i++) await page.keyboard.press('Control+k');
      s = await state();
      expect(s.view.zoom === 20, `Ctrl+K clamps at 20 (got ${s.view.zoom})`);
      expect(
        await page.getByRole('button', { name: 'Zoom out' }).isDisabled(),
        'Zoom out button disabled at 20',
      );
      const prevented = await page.evaluate(() => window.__prevented);
      expect(
        prevented.filter((p) => /^[jk]:/i.test(p)).every((p) => p.endsWith(':true')),
        `all J/K keydowns defaultPrevented (${prevented.filter((p) => /^[jk]:/i.test(p)).length} seen)`,
      );
    },
  ],
  [
    'N4',
    'Zoom slider (native JSlider 20..300) by keyboard and pointer',
    async ({ expect, note }) => {
      const slider = page.getByRole('slider', { name: 'Canvas zoom percent' });
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      let s = await state();
      expect(s.view.zoom === 101, `ArrowRight 100 -> ${s.view.zoom}`);
      await page.keyboard.press('End');
      s = await state();
      expect(s.view.zoom === 300, `End -> ${s.view.zoom}`);
      await page.keyboard.press('Home');
      s = await state();
      expect(s.view.zoom === 20, `Home -> ${s.view.zoom}`);
      await page
        .waitForFunction(
          () => document.querySelector('.toolbar-zoom')?.textContent.trim() === '20%',
          null,
          { timeout: 2000 },
        )
        .catch(() => {});
      const label = await page.locator('.toolbar-zoom').textContent();
      expect(label.trim() === '20%', `percent label reads ${label.trim()}`);
      const box = await slider.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      s = await state();
      expect(
        s.view.zoom >= 150 && s.view.zoom <= 170,
        `click slider middle -> ${s.view.zoom} (expect ~160)`,
      );
      await page.keyboard.press('Control+j');
      const before = s.view.zoom;
      s = await state();
      note(`Ctrl+J with slider focused: ${before} -> ${s.view.zoom}`);
      // Native Zoomer rejects a step past the bound instead of clamping.
      await slider.focus();
      await page.keyboard.press('End');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('Control+j');
      s = await state();
      expect(
        s.view.zoom === 295,
        `295 + Ctrl+J is rejected like native setPercent (got ${s.view.zoom})`,
      );
      const numeric = await page.locator('input[type=number][aria-label*="oom" i]').count();
      note(`typed numeric percent field present: ${numeric > 0} (native has slider only)`);
    },
  ],
  [
    'N5',
    '100% and 150% coordinate scale and drawing mapping',
    async ({ expect }) => {
      let box = await nodeBox('idle');
      expect(
        near(box.width, 30, 0.8) && near(box.height, 30, 0.8),
        `place is 30x30 px at 100% (got ${box.width}x${box.height})`,
      );
      const at100 = await toClient(160, 240);
      expect(
        near(box.x, at100.x) && near(box.y, at100.y),
        `model (160,240) renders at client ${at100.x},${at100.y}; node centre ${box.x},${box.y}`,
      );
      const origin = await toClient(0, 0);
      const svgBox = await page.locator('svg.net-canvas').boundingBox();
      expect(
        near(origin.x, svgBox.x) && near(origin.y, svgBox.y),
        `model origin at canvas top-left`,
      );
      await page.keyboard.press('p');
      await clickModel(412, 157);
      let s = await state();
      let made = s.net.nodes.at(-1);
      expect(
        made.x === 405 && made.y === 150,
        `place tool at model (412,157) @100% -> centre (${made.x},${made.y}), expected (405,150)`,
      );
      for (let i = 0; i < 5; i++) await page.keyboard.press('Control+j');
      s = await state();
      expect(s.view.zoom === 150, `zoom 150 (got ${s.view.zoom})`);
      box = await nodeBox('idle');
      expect(near(box.width, 45, 0.8), `place is 45 px wide at 150% (got ${box.width})`);
      const p = await toClient(160, 240);
      expect(
        near(p.x - svgBox.x, 240) && near(p.y - svgBox.y, 360),
        `model (160,240) at canvas pixel (${p.x - svgBox.x},${p.y - svgBox.y}), expected (240,360)`,
      );
      // A real pixel click at canvas pixel (618, 340.5) is model (412, 227) at 150%.
      await page.mouse.click(svgBox.x + 618, svgBox.y + 340.5);
      s = await state();
      made = s.net.nodes.at(-1);
      expect(
        made.x === 405 && made.y === 225 && s.net.nodes.length === 8,
        `place at 150% pixel (618,340.5) -> centre (${made.x},${made.y}), web model grid expects (405,225); native Grid.align double-unzoom would give (420,225)`,
      );
      box = await nodeBox(made.id);
      expect(
        near(box.x - svgBox.x, 607.5) && near(box.y - svgBox.y, 337.5),
        `rendered at canvas pixel (${box.x - svgBox.x},${box.y - svgBox.y}), expected (607.5,337.5)`,
      );
      await shot('N5-150-percent');
    },
  ],
  [
    'N6',
    'Middle drag pans and preserves selection/document',
    async ({ expect }) => {
      const idle = await nodeBox('idle');
      await page.mouse.click(idle.x, idle.y);
      let s = await state();
      expect(s.selected.join() === 'idle', `Idle selected (${s.selected})`);
      const net = JSON.stringify(s.net);
      const c = await blank(600, 120);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(c.x - 60, c.y - 30, { steps: 4 });
      await page.mouse.move(c.x - 100, c.y - 50, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      s = await state();
      expect(
        near(s.view.x, 100) && near(s.view.y, 50),
        `view moved to (${s.view.x},${s.view.y}), expected (100,50)`,
      );
      expect(s.selected.join() === 'idle', `selection preserved (${s.selected})`);
      expect(JSON.stringify(s.net) === net && !s.canUndo, `net unchanged and no history entry`);
      const start = await nodeBox('start');
      await page.mouse.move(start.x, start.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(start.x + 40, start.y + 40, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      s = await state();
      expect(
        byName(s, 'Start').x === 320 && near(s.view.x, 60),
        `middle drag on a node pans (view x ${s.view.x}) and does not move node`,
      );
      expect(
        s.selected.join() === 'idle',
        `selection still Idle after node middle-drag (${s.selected})`,
      );
      for (let i = 0; i < 5; i++) await page.keyboard.press('Control+j');
      const before = (await state()).view;
      const c2 = await blank(before.x + 200, before.y + 100);
      await page.mouse.move(c2.x, c2.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(c2.x - 150, c2.y, { steps: 5 });
      await page.mouse.up({ button: 'middle' });
      s = await state();
      expect(
        near(s.view.x - before.x, 100),
        `at 150% a 150 px drag pans 100 model units (got ${s.view.x - before.x})`,
      );
      await page.keyboard.press('a');
      const a = await nodeBox('idle');
      await page.mouse.click(a.x, a.y);
      const pend = (await state()).arcStart;
      const c3 = await blank(s.view.x + 300, s.view.y + 300);
      await page.mouse.move(c3.x, c3.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(c3.x - 30, c3.y, { steps: 3 });
      await page.mouse.up({ button: 'middle' });
      s = await state();
      expect(
        pend === 'idle' && s.arcStart === 'idle',
        `pending arc survives middle pan (${pend} -> ${s.arcStart})`,
      );
    },
  ],
  [
    'N7',
    'Grid cycle 15 -> 30 -> off -> 7.5 -> 15 with snapping',
    async ({ expect }) => {
      const seen = [(await state()).grid];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('g');
        seen.push((await state()).grid);
      }
      expect(seen.join(',') === '15,30,0,7.5,15', `G cycle observed ${seen.join(',')}`);
      await page.keyboard.press('g');
      await page.keyboard.press('g');
      await page.keyboard.press('t');
      await clickModel(212, 113);
      let s = await state();
      let made = s.net.nodes.at(-1);
      expect(
        made.x === 212 && made.y === 113,
        `grid off: transition at exact (${made.x},${made.y})`,
      );
      const pattern = await page.locator('rect[fill="transparent"]').count();
      expect(pattern > 0, 'grid pattern hidden when off');
      await page.keyboard.press('g');
      await clickModel(262, 163);
      s = await state();
      made = s.net.nodes.at(-1);
      expect(
        made.x === 263 && made.y === 165,
        `grid 7.5 snaps (262,163) to (${made.x},${made.y}), expected (263,165), matching native integer Grid.align`,
      );
      await page.keyboard.press('g');
      await clickModel(352, 163);
      s = await state();
      made = s.net.nodes.at(-1);
      expect(
        made.x === 345 && made.y === 165,
        `grid 15 snaps (352,163) to (${made.x},${made.y}), expected (345,165)`,
      );
    },
  ],
];

// ---- Quick Draw -----------------------------------------------------------------
const QD = [
  [
    'Q1',
    'Arc tool Ctrl canvas P0 -> T0 -> P1 chain, two history entries per node+arc',
    async ({ expect }) => {
      await page.keyboard.press('a');
      await withKey('Control', async () => {
        await clickModel(200, 460);
        await clickModel(300, 460);
        await clickModel(400, 460);
      });
      const s = await state();
      expect(names(s).slice(6).join() === 'P0,T0,P1', `created ${names(s).slice(6).join()}`);
      expect(
        arcNames(s).slice(6).join() === 'P0->T0,T0->P1',
        `arcs ${arcNames(s).slice(6).join()}`,
      );
      expect(s.arcStart === byName(s, 'P1')?.id, `pending continues from P1 (${s.arcStart})`);
      const p0 = byName(s, 'P0');
      expect(
        p0.x === 195 && p0.y === 465,
        `P0 snapped to native grid centre (${p0.x},${p0.y}), expected (195,465)`,
      );
      expect(s.tool === 'arc', `tool remains arc`);
      await shot('Q1-chain');
      const model = await saveModel('Q1-chain');
      const id = (n) => byName(s, n).id;
      expect(
        new RegExp(`<place id="${id('P1')}" name="P1" positionX="390"`).test(model) &&
          new RegExp(`<arc[^>]*source="${id('T0')}" target="${id('P1')}" type="normal"`).test(
            model,
          ),
        'saved .tapn has P1 at top-left 390 and arc T0->P1',
      );
    },
  ],
  [
    'Q2',
    'Plain endpoint completion, same-kind no-op, existing-node Ctrl chain',
    async ({ expect }) => {
      await page.keyboard.press('a');
      const idle = await nodeBox('idle');
      const busy = await nodeBox('busy');
      const reset = await nodeBox('reset');
      await page.mouse.click(idle.x, idle.y);
      let s = await state();
      expect(s.arcStart === 'idle', 'plain click on Idle starts pending arc');
      await page.mouse.click(busy.x, busy.y);
      s = await state();
      expect(
        s.arcStart === 'idle' && s.net.arcs.length === 6,
        'place->place press ignored, pending kept',
      );
      await page.mouse.click(reset.x, reset.y);
      s = await state();
      expect(
        s.arcStart === null && arcNames(s).includes('Idle->Reset'),
        `plain press on Reset completes Idle->Reset, pending cleared (${s.arcStart})`,
      );
      await page.mouse.click(busy.x, busy.y);
      await withKey('Control', () => page.mouse.click(reset.x, reset.y));
      s = await state();
      expect(
        arcNames(s).includes('Processing->Reset') && s.arcStart === 'reset',
        `Ctrl press on Reset chains from Reset (${s.arcStart})`,
      );
      await withKey('Control', () => page.mouse.click(busy.x, busy.y));
      s = await state();
      expect(
        arcNames(s).includes('Reset->Processing') && s.arcStart === 'busy',
        `chain to Processing (${s.arcStart})`,
      );
      await withKey('Control', () => page.mouse.click(reset.x, reset.y));
      s = await state();
      expect(
        s.error &&
          s.arcStart === 'reset' &&
          arcNames(s).filter((a) => a === 'Processing->Reset').length === 1,
        `duplicate rejected with error "${s.error}", Ctrl still continues from Reset`,
      );
    },
  ],
  [
    'Q3',
    'Inhibitor terminates; never starts at a transition',
    async ({ expect }) => {
      await page.keyboard.press('i');
      const start = await nodeBox('start');
      await page.mouse.click(start.x, start.y);
      let s = await state();
      expect(s.arcStart === null, 'press on transition does not start an inhibitor');
      await withKey('Control', async () => {
        await clickModel(200, 460);
        await clickModel(300, 460);
      });
      s = await state();
      expect(names(s).slice(6).join() === 'P0,T0', `created ${names(s).slice(6).join()}`);
      expect(
        arcNames(s).at(-1) === 'P0-oT0' && s.arcStart === null,
        `inhibitor P0-oT0, pending cleared (${s.arcStart})`,
      );
      const idle = await nodeBox('idle');
      const finish = await nodeBox('finish');
      await page.mouse.click(idle.x, idle.y);
      await withKey('Control', () => page.mouse.click(finish.x, finish.y));
      s = await state();
      expect(
        arcNames(s).at(-1) === 'Idle-oFinish' && s.arcStart === null,
        `Ctrl on target does not chain inhibitor (${s.arcStart})`,
      );
      const marker = await page
        .locator('g.net-arc path.arc-line[marker-end="url(#inhibitor-end)"]')
        .count();
      expect(marker === 2, `two inhibitor-headed arcs rendered (${marker})`);
      await shot('Q3-inhibitor');
    },
  ],
  [
    'Q4',
    'Pending preview follows pointer and attaches to opposite-kind hover',
    async ({ expect, note }) => {
      await page.keyboard.press('a');
      const idle = await nodeBox('idle');
      await page.mouse.click(idle.x, idle.y);
      for (const [x, y] of [
        [250, 420],
        [90, 500],
      ]) {
        const c = await toClient(x, y);
        await page.mouse.move(c.x, c.y, { steps: 3 });
        const end = protoEnd((await state()).proto);
        expect(
          end && near(end.x, x, 1) && near(end.y, y, 1),
          `preview end ${JSON.stringify(end)} follows pointer (${x},${y})`,
        );
      }
      const start = await nodeBox('start');
      await page.mouse.move(start.x + 2, start.y + 6, { steps: 3 });
      let end = protoEnd((await state()).proto);
      expect(
        end && near(end.y, 240, 1) && end.x <= 315.5,
        `hover Start: preview snaps to its edge ${JSON.stringify(end)}`,
      );
      const busy = await nodeBox('busy');
      await page.mouse.move(busy.x + 3, busy.y + 3, { steps: 3 });
      end = protoEnd((await state()).proto);
      expect(
        end && near(end.x, 503, 1.5) && near(end.y, 243, 1.5),
        `hover same-kind Processing: preview follows raw pointer ${JSON.stringify(end)}`,
      );
      await withKey('Control', () => clickModel(240, 120));
      const c = await toClient(380, 60);
      await page.mouse.move(c.x, c.y, { steps: 2 });
      end = protoEnd((await state()).proto);
      expect(
        end && near(end.x, 380, 1) && near(end.y, 60, 1),
        `after Ctrl create, preview follows from new T0 ${JSON.stringify(end)}`,
      );
      for (let i = 0; i < 5; i++) await page.keyboard.press('Control+j');
      const c150 = await toClient(420, 90);
      await page.mouse.move(c150.x, c150.y, { steps: 2 });
      end = protoEnd((await state()).proto);
      expect(
        end && near(end.x, 420, 1) && near(end.y, 90, 1),
        `at 150% preview end ${JSON.stringify(end)} matches pointer model (420,90)`,
      );
      await shot('Q4-preview');
      const spread = await page.evaluate(() => JSON.stringify({ ...new DOMPoint(1, 2) }));
      note(
        `root-cause probe: {...new DOMPoint(1, 2)} serialises as ${spread}; arcPointer = ${JSON.stringify(await page.evaluate(() => window.ng.getComponent(document.querySelector('app-root')).arcPointer()))}`,
      );
      // Pending bends are in-flight integration work: record, do not grade.
      await clickModel(470, 60);
      const bends = await page.evaluate(() => {
        const app = window.ng.getComponent(document.querySelector('app-root'));
        return {
          draft: app.draftBends?.().length ?? 'n/a',
          notice: app.notice(),
          pending: app.arcStart(),
        };
      });
      note(
        `plain blank press while pending: ${JSON.stringify(bends)} (known gap: bend hook in progress)`,
      );
    },
  ],
  [
    'Q5',
    'Escape / Delete / Ctrl+Z / Ctrl+Y cancel only the pending arc',
    async ({ expect }) => {
      const idle = await nodeBox('idle');
      await page.mouse.click(idle.x, idle.y);
      await page.keyboard.press('a');
      const finish = await nodeBox('finish');
      await withKey('Control', () => page.mouse.click(finish.x, finish.y));
      await withKey('Control', () => page.mouse.click(idle.x, idle.y));
      let s = await state();
      const net = JSON.stringify(s.net);
      expect(
        s.arcStart === 'idle' && s.canUndo,
        `pending from Idle after Ctrl chain Finish->Idle (${s.arcStart})`,
      );
      for (const key of ['Escape', 'Delete', 'Control+z', 'Control+y', 'Meta+z']) {
        const before = await state();
        await page.mouse.click(idle.x, idle.y);
        s = await state();
        if (s.arcStart !== 'idle') expect(false, `could not re-arm pending before ${key}`);
        await page.keyboard.press(key);
        s = await state();
        expect(
          s.arcStart === null &&
            s.tool === 'arc' &&
            JSON.stringify(s.net) === net &&
            s.selected.join() === before.selected.join() &&
            s.canUndo,
          `${key}: pending cleared, tool ${s.tool}, net unchanged, selection [${s.selected}], canUndo ${s.canUndo}`,
        );
        expect(s.proto === null, `${key}: preview removed`);
      }
      await page.keyboard.press('Control+z');
      s = await state();
      expect(!arcNames(s).includes('Finish->Idle'), 'Ctrl+Z without pending arc undoes document');
      await page.keyboard.press('Escape');
      s = await state();
      expect(s.tool === 'select', `Escape without pending arc returns to Select (${s.tool})`);
    },
  ],
  [
    'Q6',
    'Two-step node/arc undo and redo',
    async ({ expect }) => {
      await page.keyboard.press('a');
      await withKey('Control', async () => {
        await clickModel(200, 460);
        await clickModel(300, 460);
      });
      await page.keyboard.press('Escape');
      const seq = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Control+z');
        const s = await state();
        seq.push(`${names(s).slice(6).join('+') || '-'}|${arcNames(s).slice(6).join('+') || '-'}`);
      }
      expect(seq.join(' ; ') === 'P0+T0|- ; P0|- ; -|-', `undo sequence ${seq.join(' ; ')}`);
      const redo = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Control+Shift+z');
        const s = await state();
        redo.push(`${names(s).slice(6).join('+') || '-'}|${arcNames(s).slice(6).join('+') || '-'}`);
      }
      expect(
        redo.join(' ; ') === 'P0|- ; P0+T0|- ; P0+T0|P0->T0',
        `redo sequence ${redo.join(' ; ')}`,
      );
    },
  ],
  [
    'Q7',
    'High-water names after undo and deletion',
    async ({ expect }) => {
      await page.keyboard.press('a');
      await withKey('Control', async () => {
        await clickModel(200, 460);
        await clickModel(300, 460);
        await clickModel(400, 460);
      });
      await page.keyboard.press('Escape');
      for (let i = 0; i < 2; i++) await page.keyboard.press('Control+z');
      let s = await state();
      expect(
        names(s).slice(6).join() === 'P0,T0',
        `after undo of P1 (${names(s).slice(6).join()})`,
      );
      await withKey('Control', () => clickModel(200, 560));
      s = await state();
      expect(
        byName(s, 'P2') && !byName(s, 'P1'),
        `next Quick Draw place is P2 (got ${names(s).slice(6).join()})`,
      );
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      const t0 = await nodeBox(byName(s, 'T0').id);
      await page.mouse.click(t0.x, t0.y);
      await page.keyboard.press('Delete');
      s = await state();
      expect(!byName(s, 'T0'), 'T0 deleted with Delete in Select');
      await page.keyboard.press('t');
      await clickModel(500, 560);
      s = await state();
      expect(
        names(s).at(-1) === 'T1',
        `next transition after deleting T0 is ${names(s).at(-1)} (native counter: T1)`,
      );
      await page.keyboard.press('p');
      await clickModel(600, 560);
      s = await state();
      expect(names(s).at(-1) === 'P3', `Place tool shares high-water: ${names(s).at(-1)}`);
    },
  ],
  [
    'Q8',
    'Ctrl-select in Select tool toggles, never draws',
    async ({ expect }) => {
      const idle = await nodeBox('idle');
      const start = await nodeBox('start');
      await page.mouse.click(idle.x, idle.y);
      await withKey('Control', () => page.mouse.click(start.x, start.y));
      let s = await state();
      expect(
        s.selected.filter((id) => s.net.nodes.some((n) => n.id === id)).join() === 'idle,start' &&
          s.selected.includes('a1'),
        `Ctrl+click adds Start (${s.selected})`,
      );
      await withKey('Control', () => page.mouse.click(idle.x, idle.y));
      s = await state();
      expect(
        s.selected.filter((id) => s.net.nodes.some((n) => n.id === id)).join() === 'start' &&
          s.selected.includes('a1'),
        `Ctrl+click toggles Idle off (${s.selected})`,
      );
      await withKey('Shift', () => page.mouse.click(idle.x, idle.y));
      s = await state();
      expect(
        s.selected.filter((id) => s.net.nodes.some((n) => n.id === id)).join() === 'start,idle' &&
          s.selected.includes('a1'),
        `Shift+click (native modifier) adds Idle (${s.selected})`,
      );
      await withKey('Control', () => clickModel(250, 520));
      s = await state();
      expect(
        s.net.nodes.length === 6 && !s.canUndo && s.arcStart === null,
        'Ctrl+click blank canvas in Select creates nothing',
      );
      const ctx = await page.locator('.context-menu, [role=menu]').count();
      expect(ctx === 0, `no context menu after Ctrl+click (${ctx})`);
    },
  ],
  [
    'Q9',
    'Dialog and inspector inputs keep their keys',
    async ({ expect, note }) => {
      const idle = await nodeBox('idle');
      await page.mouse.dblclick(idle.x, idle.y);
      await page.locator('#dialog-name').waitFor();
      const input = page.locator('#dialog-name');
      await input.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('gpmsa');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Backspace');
      await page.evaluate(() => {
        window.__dialogKeys = [];
        window.addEventListener('keydown', (e) =>
          window.__dialogKeys.push(`${e.ctrlKey ? 'Ctrl+' : ''}${e.key}:${e.defaultPrevented}`),
        );
      });
      await page.keyboard.press('Control+j');
      await page.keyboard.press('Control+z');
      note(
        `dialog keydowns reaching window: ${(await page.evaluate(() => window.__dialogKeys)).join(' ')}`,
      );
      let s = await state();
      const value = await input.inputValue();
      note(`dialog name value after typing: "${value}"`);
      expect(
        s.dialogOpen &&
          s.tool === 'select' &&
          s.view.zoom === 100 &&
          s.grid === 15 &&
          !s.canUndo &&
          s.net.nodes.length === 6,
        `no app shortcut fired (tool ${s.tool}, zoom ${s.view.zoom}, grid ${s.grid}, nodes ${s.net.nodes.length})`,
      );
      await page.keyboard.press('Escape');
      s = await state();
      expect(!s.dialogOpen && byName(s, 'Idle'), 'Escape cancels dialog without change');
      await page.mouse.click(idle.x, idle.y);
      const field = page.locator('#element-name');
      await field.click();
      await page.keyboard.press('End');
      await page.keyboard.type('Gp');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Delete');
      s = await state();
      expect(
        (await field.inputValue()) === 'Idle' && s.grid === 15 && s.tool === 'select',
        `inspector name "${await field.inputValue()}" (expected Idle), grid ${s.grid}, tool ${s.tool}`,
      );
      await page.keyboard.press('Escape');
      // Pending arc while editing in the inspector: native text fields consume Delete first.
      await page.locator('svg.net-canvas').focus();
      await page.keyboard.press('a');
      const finish = await nodeBox('finish');
      await page.mouse.click(idle.x, idle.y);
      s = await state();
      const pendingBefore = s.arcStart;
      await field.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Delete');
      s = await state();
      expect(
        (await field.inputValue()) === 'Idl',
        `with pending arc, Delete in inspector edits text: "${await field.inputValue()}" (pending ${pendingBefore} -> ${s.arcStart})`,
      );
      void finish;
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
  for (const [id, title, fn] of [...NAV, ...QD])
    if (!only || only.includes(id)) await check(id, title, fn);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status !== 'pass');
console.log(`\n${results.length - failed.length}/${results.length} passed; output ${OUT}`);
process.exit(failed.length ? 1 : 0);
