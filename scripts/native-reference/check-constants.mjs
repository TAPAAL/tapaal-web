#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const OUT = resolve(process.argv[2] ?? '/tmp/tapaal-constants-oracle');
mkdirSync(join(OUT, 'classes'), { recursive: true });
const dom = new JSDOM();
for (const key of ['DOMParser', 'XMLSerializer']) globalThis[key] = dom.window[key];
execFileSync(
  join(WEB, 'node_modules/.bin/esbuild'),
  [
    'src/app/core/authored-files.ts',
    'src/app/core/authored-model.ts',
    'src/app/core/timed-network-simulation.ts',
    'src/app/core/authored-documents.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--out-extension:.js=.mjs',
    `--outdir=${OUT}`,
    '--log-level=warning',
  ],
  { cwd: WEB },
);
const files = await import(pathToFileURL(join(OUT, 'authored-files.mjs')));
const model = await import(pathToFileURL(join(OUT, 'authored-model.mjs')));
const { TimedNetworkSimulation } = await import(
  pathToFileURL(join(OUT, 'timed-network-simulation.mjs'))
);
execFileSync('javac', [
  '-cp',
  `${LIB}/*`,
  '-d',
  join(OUT, 'classes'),
  join(WEB, 'scripts/native-reference/ConstantsReference.java'),
]);
const fixture = readFileSync(
  join(WEB, 'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn'),
  'utf8',
);
function native(name, source, change = false) {
  const path = join(OUT, `${name}.tapn`);
  writeFileSync(path, source);
  const output = execFileSync(
    'xvfb-run',
    [
      '-a',
      'java',
      '-cp',
      `${OUT}/classes:${LIB}/*`,
      'ConstantsReference',
      path,
      join(OUT, `${name}.native.tapn`),
      ...(change ? [join(OUT, `${name}.changed.native.tapn`)] : []),
    ],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  writeFileSync(join(OUT, `${name}.txt`), output);
  return output;
}
function web(source) {
  try {
    return { accepted: true, network: files.parseAuthoredTapn(source).network };
  } catch (error) {
    return { accepted: false, error: error.message };
  }
}
const bare = fixture.replace(/<hlinscription>[\s\S]*?<\/hlinscription>/g, '');
const missingExpression = native('transport-no-expression', bare);
assert.match(missingExpression, /WEIGHT transport IntWeight 1 1/);
const baseline = native('scalar', fixture, true);
for (const kind of ['input', 'output', 'inhibitor', 'transport'])
  assert.match(baseline, new RegExp(`WEIGHT ${kind} ConstantWeight K 2`));
assert.match(baseline, /BOUND lower ConstantBound K 2/);
assert.match(baseline, /BOUND transport-lower ConstantBound Zero 0/);
assert.match(baseline, /BOUND invariant ConstantBound D 5/);
assert.match(baseline, /BEFORE[\s\S]*ENABLED t true[\s\S]*AFTER[\s\S]*ENABLED t false/);
const source = files.parseAuthoredTapn(fixture).network;
const changed = {
  ...source,
  constants: source.constants.map((c) => (c.name === 'K' ? { ...c, value: 4 } : c)),
};
function enabled(network) {
  const result = model.resolveAuthored(network);
  assert.equal(result.ok, true);
  return new TimedNetworkSimulation(structuredClone(result.value.numeric))
    .enabledFor(network.components[0].id)
    .includes('t');
}
assert.equal(enabled(source), true);
assert.equal(enabled(changed), false);
function execution(network) {
  const result = model.resolveAuthored(network);
  assert.equal(result.ok, true);
  const sim = new TimedNetworkSimulation(structuredClone(result.value.numeric));
  const componentId = network.components[0].id;
  sim.delay('2');
  const enabled = sim.enabledFor(componentId).includes('o');
  if (enabled) sim.fire({ componentId, elementId: 'o' });
  const marking = sim.markingFor(componentId);
  return [
    `EXEC delay2 true o ${enabled}`,
    `EXEC marking p=${marking.p.length} q=${marking.q.length}`,
  ];
}
assert.deepEqual(baseline.match(/^EXEC.*$/gm), [...execution(source), ...execution(changed)]);
for (const [name, n] of [
  ['web', source],
  ['web-changed', changed],
]) {
  const output = files.serializeAuthoredTapn(n);
  writeFileSync(join(OUT, `${name}.web.tapn`), output);
  assert.match(output, /weight="K"/);
  assert.doesNotMatch(output, /NaN/);
  const observed = native(name, output);
  assert.match(observed, new RegExp(`WEIGHT transport ConstantWeight K ${name === 'web' ? 2 : 4}`));
  const reread = files.parseAuthoredTapn(
    readFileSync(join(OUT, `${name}.native.tapn`), 'utf8'),
  ).network;
  assert.equal(enabled(reread), name === 'web');
}
for (const name of ['scalar.native.tapn', 'scalar.changed.native.tapn'])
  assert.equal(web(readFileSync(join(OUT, name), 'utf8')).accepted, true);
const variants = [
  ['set', 'value="2"', 'value="2,3"'],
  ['real', 'value="2"', 'value="2.5"'],
  ['real-type', 'name="K" value="2"', 'name="K" value="2" type="real"'],
  ['underscore', 'K', '_K'],
  ['inf', 'K', 'inf'],
  ['Inf', 'K', 'Inf'],
  ['max', '</pnml>', '<constant name="Max" value="2147483647"/></pnml>'],
  ['overflow', 'value="2"', 'value="2147483648"'],
  ['negative', 'value="2"', 'value="-1"'],
  ['duplicate', '</pnml>', '<constant name="K" value="3"/></pnml>'],
  ['arithmetic', 'weight="K"', 'weight="K+1"'],
  ['zero-declaration', '</pnml>', '<constant name="UnusedZero" value="0"/></pnml>'],
  ['closed-equal', '[K,D]', '[K,K]'],
  ['open-equal', '[K,D]', '(K,K)'],
  ['strict-zero', '&lt;= D', '&lt; Zero'],
  ['weight-zero', 'weight="K"', 'weight="Zero"'],
  ['undefined', 'weight="K"', 'weight="Missing"'],
  ['urgent-zero', '[Zero,D]:1', '[Zero,inf):1'],
  [
    'distinct-halves',
    'id="to" source="t" target="q" type="transport" weight="K"',
    'id="to" source="t" target="q" type="transport" weight="Other"',
  ],
];
const results = [];
for (const [name, from, to] of variants) {
  let text = ['underscore', 'inf', 'Inf'].includes(name)
    ? fixture.replaceAll(from, to)
    : fixture.replace(from, to);
  if (name === 'urgent-zero')
    text = text
      .replaceAll('[Zero,D]:1', '[Zero,inf):1')
      .replace('angle="90" urgent="false"', 'angle="90" urgent="true"');
  if (name === 'distinct-halves')
    text = text.replace(
      '<constant name="D"',
      '<constant name="Other" value="2"/><constant name="D"',
    );
  let observation;
  try {
    observation = native(name, text);
  } catch (error) {
    observation = `PROCESS FAILURE ${error.message}`;
  }
  const w = web(text);
  const expected = ['underscore', 'Inf', 'max', 'closed-equal', 'zero-declaration'].includes(name);
  assert.equal(w.accepted, expected, `${name}: ${w.error}`);
  results.push({ name, native: observation, web: { accepted: w.accepted, error: w.error } });
}
const candidate = readFileSync(
  join(WEB, '../src/main/resources/Example nets/webserver.tapn'),
  'utf8',
);
const candidateWeb = web(candidate);
if (candidateWeb.accepted) {
  const output = files.serializeAuthoredTapn(candidateWeb.network);
  writeFileSync(join(OUT, 'webserver.web.tapn'), output);
  results.push({ name: 'webserver', web: { accepted: true }, native: native('webserver', output) });
} else results.push({ name: 'webserver', web: candidateWeb });
const report = {
  missingExpression,
  jarSha256: createHash('sha256')
    .update(readFileSync(join(LIB, 'tapaal.jar')))
    .digest('hex'),
  baseline,
  results,
  limitations: [
    'Headless: no GUI command undo/rename claim. Web transactions cover undo/rename separately.',
    'No query execution or native nonzero age IO compatibility claim.',
    'Native observations are permissive in places where web deliberately refuses.',
  ],
};
writeFileSync(join(OUT, 'results.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out: OUT,
      jarSha256: report.jarSha256,
      cases: results.map((r) => ({
        name: r.name,
        web: r.web,
        nativeRefused: r.native?.includes('REFUSED'),
      })),
    },
    null,
    2,
  ),
);
