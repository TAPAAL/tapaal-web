// Real browser input; application signals are read only for assertions.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE);
const out = process.argv[3] ?? '/tmp/tapaal-gallery-evidence';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const results = [];
const state = () =>
  page.evaluate(() => {
    const a = window.ng.getComponent(document.querySelector('app-root'));
    return {
      workspace: a.workspace(),
      net: a.net(),
      mode: a.mode(),
      error: a.error(),
      pending: !!a.pending(),
      step: a.cursor(),
    };
  });
const open = async (name) => {
  await page.locator('.file-menu summary').click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: 'Open ' + name, exact: true }).click();
  await page.locator('app-example-gallery').waitFor({ state: 'detached' });
  if (await page.locator('#cancel-open').count())
    await page.getByRole('button', { name: 'Open in new tab', exact: true }).click();
};
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4419');
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root')));
  // Middle-click is release-only; middle-drag and physical Ctrl still use native behavior.
  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  const canvas = await page.locator('svg.net-canvas').boundingBox();
  const beforeChain = await state();
  await page.mouse.click(canvas.x + 400, canvas.y + 400, { button: 'middle' });
  await page.mouse.click(canvas.x + 550, canvas.y + 400, { button: 'middle' });
  let chained = await state();
  if (
    chained.net.nodes.length !== beforeChain.net.nodes.length + 2 ||
    chained.net.arcs.length !== beforeChain.net.arcs.length + 1
  )
    throw Error('Middle click chain');
  const fingerprint = JSON.stringify(chained.net);
  await page.mouse.move(canvas.x + 600, canvas.y + 450);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(canvas.x + 560, canvas.y + 450);
  await page.mouse.up({ button: 'middle' });
  if (JSON.stringify((await state()).net) !== fingerprint) throw Error('Middle pan created nodes');
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  await page.mouse.click(canvas.x + 700, canvas.y + 400);
  await page.keyboard.up('Control');
  if ((await state()).net.nodes.length !== chained.net.nodes.length + 1)
    throw Error('Ctrl path regressed');
  await page.keyboard.press('Escape');
  results.push({ middleChain: true, middlePan: true, physicalCtrl: true });
  for (const name of [
    'home-construction',
    'intro-example',
    'webserver',
    'alternating-bit-protocol-components',
  ]) {
    const before = await state();
    await open(name);
    const after = await state();
    if (after.workspace.documents.length !== before.workspace.documents.length + 1)
      throw Error('No independent tab ' + name);
    results.push({ name, opened: true, nodes: after.net.nodes.length });
  }
  await page.screenshot({ path: out + '/components.png' });
  await page.locator('.file-menu summary').click();
  await page
    .locator('[aria-label="File actions"]')
    .getByRole('button', { name: 'Example nets…', exact: true })
    .click();
  const before = await state();
  await page.getByRole('searchbox').fill('referendum');
  const disabled = await page
    .locator('app-example-gallery article button')
    .evaluateAll((bs) => bs.every((b) => b.disabled));
  if (!disabled) throw Error('Unsupported entries enabled');
  await page.screenshot({ path: out + '/gallery.png' });
  await page.keyboard.press('Escape');
  if (JSON.stringify((await state()).workspace) !== JSON.stringify(before.workspace))
    throw Error('Gated gallery changed workspace');
  await open('webserver');
  const shape = page.locator('[data-node] .node-shape').first();
  await shape.click();
  await page.locator('[data-node]').first().focus();
  await page.screenshot({ path: out + '/focus.png' });
  // Open an actual arc through mouse double click, choose an existing constant by name.
  const arc = page.locator('[data-arc] .arc-hit').first();
  const point = await arc.evaluate((path) => {
    const p = path
      .getPointAtLength(path.getTotalLength() * 0.3)
      .matrixTransform(path.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.dblclick(point.x, point.y);
  await page.locator('#dialog-weight').waitFor();
  const names = await page
    .locator('#arc-constant-choices option')
    .evaluateAll((os) => os.map((o) => o.value));
  if (!names.length) throw Error('No constant choices');
  await page.locator('#dialog-weight').fill(names[0]);
  await page.screenshot({ path: out + '/constant-arc.png' });
  await page.locator('app-element-dialog').getByRole('button', { name: 'OK', exact: true }).click();
  if (await page.locator('app-element-dialog [role=alert]').count())
    throw Error('Constant assignment rejected');
  await page
    .locator('[aria-label="Workspace mode"]')
    .getByRole('button', { name: 'Simulate', exact: true })
    .click();
  await page.locator('#delay-amount').fill('1');
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  const enabled = page.locator('.enabled-row').first();
  if (await enabled.count()) await enabled.click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save TAPAAL file', exact: true }).click();
  const download = await downloadPromise;
  const file = out + '/saved.tapn';
  await download.saveAs(file);
  const text = readFileSync(file, 'utf8');
  if (!text.includes('<constant')) throw Error('Lost constants on save');
  const count = (await state()).workspace.documents.length;
  await page.locator('input[type=file]').setInputFiles(file);
  if (await page.locator('#cancel-open').count())
    await page.getByRole('button', { name: 'Open in new tab', exact: true }).click();
  await page.waitForFunction(
    (n) =>
      window.ng.getComponent(document.querySelector('app-root')).workspace().documents.length ===
      n + 1,
    count,
  );
  if ((await state()).step !== 0) throw Error('Reopen did not reset simulation');
  results.push({ saveReopen: true, constant: names[0], unsupportedDisabled: disabled });
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
