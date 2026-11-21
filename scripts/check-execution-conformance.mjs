#!/usr/bin/env node
// Differential execution check against released native TAPAAL (see design/EXECUTION-CONFORMANCE.md).
// Runs scripts/native-reference/scenarios.txt through the web cores (timed.ts, network-simulation.ts)
// and through ExecutionReference.java on the native jars, then compares observations line by line.
// Also asserts web-only properties (history, snapshots, type rejection) that native has no headless API for.
//
//   TAPAAL_LIB=/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib \
//   node scripts/check-execution-conformance.mjs /tmp/tapaal-exec-conformance
//
// Exit status 1 on any divergence or failed property. Results: <out>/results.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const OUT = process.argv[2] ?? '/tmp/tapaal-exec-conformance';
const SCENARIOS = join(WEB, 'scripts/native-reference/scenarios.txt');
mkdirSync(join(OUT, 'classes'), { recursive: true });

// ---- native observations ------------------------------------------------------
execFileSync('javac', [
  '-cp',
  `${LIB}/*`,
  '-d',
  join(OUT, 'classes'),
  join(WEB, 'scripts/native-reference/ExecutionReference.java'),
]);
const native = execFileSync(
  'java',
  [
    '-Djava.awt.headless=true',
    '-cp',
    `${join(OUT, 'classes')}:${LIB}/*`,
    'ExecutionReference',
    SCENARIOS,
  ],
  { encoding: 'utf8' },
)
  .replace(/\n$/, '')
  .split('\n');

// ---- web observations ---------------------------------------------------------
execFileSync(join(WEB, 'node_modules/.bin/esbuild'), [
  join(WEB, 'src/app/core/timed.ts'),
  join(WEB, 'src/app/core/network-simulation.ts'),
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--log-level=warning',
  `--outdir=${join(OUT, 'web')}`,
]);
const timed = await import(pathToFileURL(join(OUT, 'web/timed.js')).href);
const networks = await import(pathToFileURL(join(OUT, 'web/network-simulation.js')).href);

function parseCases(text) {
  const cases = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const a = line.split(/\s+/);
    if (a[0] === 'case') cases.push({ name: a[1], mode: a[2], components: [], ops: [] });
    else if (a[0] === 'component')
      cases.at(-1).components.push({ name: a[1], active: a[2] === 'active', lines: [] });
    else if (['place', 'trans', 'in', 'out', 'inh', 'transport'].includes(a[0]))
      cases.at(-1).components.at(-1).lines.push(a);
    else if (a[0] === 'token') {
      const [component, place] = a[1].split('.');
      cases
        .at(-1)
        .components.find((c) => c.name === component)
        .lines.push(['token', place, a[2]]);
    } else cases.at(-1).ops.push(a);
  }
  return cases;
}
const interval = (s) => {
  const [lower, upper] = s.slice(1, -1).split(',');
  return {
    lower,
    upper: upper === 'inf' ? null : upper,
    lowerClosed: s[0] === '[',
    upperClosed: s.at(-1) === ']',
  };
};
const invariant = (s) =>
  s === 'inf' ? undefined : { upper: s.replace(/^<=?/, ''), upperClosed: s.startsWith('<=') };
const age = (s) => timed.addAges(s, '0');

function buildComponent(component) {
  const net = { name: component.name, template: component.name, nodes: [], arcs: [] };
  const extra = { intervals: {}, invariants: {}, urgent: [], transports: [], initial: [] };
  const node = (id, kind) =>
    net.nodes.push({ id, name: id, kind, x: 100 * net.nodes.length, y: 0, tokens: 0 });
  const arc = (source, target, kind, weight) => {
    const id = `a${net.arcs.length}`;
    net.arcs.push({ id, source, target, kind, weight: Number(weight) });
    return id;
  };
  for (const a of component.lines) {
    if (a[0] === 'place') {
      node(a[1], 'place');
      if (invariant(a[2])) extra.invariants[a[1]] = invariant(a[2]);
    } else if (a[0] === 'trans') {
      node(a[1], 'transition');
      if (a[2] === 'urgent') extra.urgent.push(a[1]);
    } else if (a[0] === 'in') {
      const id = arc(a[1], a[2], 'normal', a[4]);
      if (a[3] !== '[0,inf)') extra.intervals[id] = interval(a[3]);
    } else if (a[0] === 'out') arc(a[1], a[2], 'normal', a[3]);
    else if (a[0] === 'inh') arc(a[1], a[2], 'inhibitor', a[3]);
    else if (a[0] === 'transport') {
      const inputArc = arc(a[1], a[2], 'normal', a[5]);
      const outputArc = arc(a[2], a[3], 'normal', a[5]);
      if (a[4] !== '[0,inf)') extra.intervals[inputArc] = interval(a[4]);
      extra.transports.push({ inputArc, outputArc });
    } else if (a[0] === 'token') {
      net.nodes.find((n) => n.id === a[1]).tokens++;
      extra.initial.push({ id: `${a[1]}#${extra.initial.length}`, place: a[1], age: a[2] });
    }
  }
  return { net, ...extra };
}

function runTimed(c) {
  const [component] = c.components;
  const built = buildComponent(component);
  const model = {
    ...built,
    type: { timed: true, colored: false, game: false, stochastic: false },
    componentCount: 1,
    sharedElementIds: [],
  };
  const sim = new timed.TimedSimulation(model);
  const transitions = model.net.nodes.filter((n) => n.kind === 'transition').map((n) => n.id);
  const lines = [`case ${c.name}`];
  for (const a of c.ops) {
    if (a[0] === 'enabled') {
      const on = transitions.filter((t) => timed.isTimedEnabled(model, sim.marking, t));
      lines.push(
        `enabled ${on
          .map((t) => `${component.name}.${t}`)
          .sort()
          .join(',')}`,
      );
    } else if (a[0] === 'delay') {
      try {
        sim.delay(a[1]);
        lines.push(`delay ${a[1]} ok`);
      } catch {
        lines.push(`delay ${a[1]} blocked`);
      }
    } else if (a[0] === 'fire') {
      const t = a[1].split('.')[1];
      try {
        let selection = { mode: a[2] };
        if (a[2].startsWith('manual:')) {
          const bindings = {};
          const used = new Set();
          for (const ref of a[2].slice(7).split(';')) {
            const [place, value] = ref.split('@');
            const input = model.net.arcs.find(
              (x) => x.source === place && x.target === t && x.kind === 'normal',
            );
            const token = sim.marking.tokens.find(
              (k) => k.place === place && !used.has(k.id) && timed.compareAges(k.age, value) === 0,
            );
            if (!input || !token) throw new Error('absent manual token');
            used.add(token.id);
            (bindings[input.id] ??= []).push(token.id);
          }
          selection = { mode: 'manual', bindings };
        }
        sim.fire(t, selection);
        lines.push(`fire ${a[1]} ok`);
      } catch {
        lines.push(`fire ${a[1]} error`);
      }
    } else if (a[0] === 'marking') {
      const tokens = sim.marking.tokens;
      const places = model.net.nodes.filter((n) => n.kind === 'place');
      lines.push(
        `marking ${places
          .map((p) => {
            const ages = tokens
              .filter((k) => k.place === p.id)
              .map((k) => age(k.age))
              .sort(timed.compareAges);
            return `${component.name}.${p.id}=${ages.join(',')}`;
          })
          .join(' ')}`,
      );
    }
  }
  return lines;
}

function buildNetwork(c) {
  return {
    name: c.name,
    type: { timed: false, colored: false, game: false, stochastic: false },
    components: c.components.map((component) => ({
      id: component.name,
      active: component.active,
      net: { ...buildComponent(component).net, name: c.name },
    })),
  };
}
function runUntimed(c) {
  const network = buildNetwork(c);
  const sim = new networks.NetworkSimulation(network);
  const lines = [`case ${c.name}`];
  for (const a of c.ops) {
    if (a[0] === 'enabled')
      lines.push(
        `enabled ${sim.enabled
          .map((r) => `${r.componentId}.${r.elementId}`)
          .sort()
          .join(',')}`,
      );
    else if (a[0] === 'fire') {
      const [component, t] = a[1].split('.');
      try {
        sim.fire(component, t);
        lines.push(`fire ${a[1]} ok`);
      } catch {
        lines.push(`fire ${a[1]} error`);
      }
    } else if (a[0] === 'marking') {
      const parts = [];
      for (const component of network.components.filter((x) => x.active))
        for (const [place, count] of Object.entries(sim.marking[component.id]))
          parts.push(`${component.id}.${place}=${Array(count).fill('0').join(',')}`);
      lines.push(`marking ${parts.join(' ')}`);
    } else throw new Error(`Untimed op ${a[0]} has no native counterpart.`);
  }
  return lines;
}

const web = parseCases(readFileSync(SCENARIOS, 'utf8')).flatMap((c) =>
  c.mode === 'timed' ? runTimed(c) : runUntimed(c),
);

const results = [];
const length = Math.max(native.length, web.length);
for (let i = 0; i < length; i++)
  if (native[i] !== web[i])
    results.push({ kind: 'divergence', line: i, native: native[i], web: web[i] });

// ---- web-only properties (native Animator history needs the GUI) ---------------
function property(name, fn) {
  try {
    fn();
    results.push({ kind: 'property', name, pass: true });
  } catch (error) {
    results.push({ kind: 'property', name, pass: false, error: String(error) });
  }
}
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const [netCase] = parseCases(readFileSync(SCENARIOS, 'utf8')).filter((c) => c.mode === 'untimed');
property('network rejects timed type without normalizing', () => {
  const network = buildNetwork(netCase);
  let threw = false;
  try {
    new networks.NetworkSimulation({ ...network, type: { ...network.type, timed: true } });
  } catch {
    threw = true;
  }
  assert(threw, 'timed network accepted by untimed engine');
});
property('network firing leaves source document and other components intact', () => {
  const network = buildNetwork(netCase);
  const before = JSON.stringify(network);
  const sim = new networks.NetworkSimulation(network);
  const first = sim.marking;
  sim.fire('A', 'T');
  assert(JSON.stringify(network) === before, 'source mutated');
  assert(JSON.stringify(sim.marking.C) === JSON.stringify(first.C), 'other component changed');
  assert(first.A.P === 1 && sim.marking.A.P === 0, 'snapshot aliasing');
  sim.reset();
  assert(JSON.stringify(sim.marking) === JSON.stringify(first), 'reset differs from initial');
});
property('timed back/forward replays stored snapshot; new action after back truncates', () => {
  const [c] = parseCases(readFileSync(SCENARIOS, 'utf8')).filter(
    (x) => x.name === 'oldest-youngest-weighted',
  );
  const model = {
    ...buildComponent(c.components[0]),
    type: { timed: true, colored: false, game: false, stochastic: false },
    componentCount: 1,
    sharedElementIds: [],
  };
  const sim = new timed.TimedSimulation(model);
  sim.fire('T1', { mode: 'oldest' });
  const afterOldest = JSON.stringify(sim.marking);
  sim.back();
  sim.forward();
  assert(JSON.stringify(sim.marking) === afterOldest, 'forward reselected tokens');
  sim.back();
  sim.delay('1');
  assert(
    !sim.canForward && sim.trace.length === 2 && sim.trace[1].kind === 'delay',
    'branch not truncated',
  );
  const snapshot = JSON.stringify(sim.trace);
  try {
    sim.fire('T1', { mode: 'manual', bindings: { a0: ['absent'] } });
  } catch {}
  assert(JSON.stringify(sim.trace) === snapshot, 'failed fire changed history');
});

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ native, web, results }, null, 2));
const failures = results.filter((r) => r.kind === 'divergence' || !r.pass);
for (const r of results) console.log(JSON.stringify(r));
console.log(
  `${native.length} native / ${web.length} web observations; ${failures.length} failure(s).`,
);
process.exit(failures.length ? 1 : 0);
