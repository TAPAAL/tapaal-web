#!/usr/bin/env node
// New opt-in wrapper vs released model classes; existing harnesses are read-only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../..');
const LIB = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const OUT = process.argv[2] ?? '/tmp/tapaal-timed-network';
mkdirSync(join(OUT, 'classes'), { recursive: true });
execFileSync(join(WEB, 'node_modules/.bin/esbuild'), [
  join(WEB, 'src/app/core/timed-network-simulation.ts'),
  join(WEB, 'src/app/core/timed.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--out-extension:.js=.mjs',
  `--outdir=${OUT}`,
  '--log-level=warning',
]);
const { TimedNetworkSimulation } = await import(
  pathToFileURL(join(OUT, 'timed-network-simulation.mjs'))
);
const { compareAges, addAges } = await import(pathToFileURL(join(OUT, 'timed.mjs')));
const cases = [];
function component(
  id,
  {
    ages = ['1', '2', '4'],
    active = true,
    urgent = false,
    upper,
    closed = true,
    transport = false,
    selfloop = false,
    weight = 1,
    inhibitor = false,
    interval,
  } = {},
) {
  return {
    id,
    active,
    net: {
      name: 'Differential',
      template: id,
      nodes: [
        { id: 'p', name: 'p', kind: 'place', x: 0, y: 0, tokens: ages.length },
        { id: 'q', name: 'q', kind: 'place', x: 100, y: 0, tokens: 0 },
        { id: 't', name: 't', kind: 'transition', x: 50, y: 0, tokens: 0 },
      ],
      arcs: [
        { id: 'in', source: 'p', target: 't', kind: inhibitor ? 'inhibitor' : 'normal', weight },
        { id: 'out', source: 't', target: selfloop ? 'p' : 'q', kind: 'normal', weight },
      ],
    },
    timing: {
      ages: ages.some((a) => a !== '0') ? { p: ages.filter((a) => a !== '0') } : {},
      invariants: upper
        ? { [transport ? (selfloop ? 'p' : 'q') : 'p']: { upper, upperClosed: closed } }
        : {},
      intervals: interval ? { in: interval } : {},
      urgent: urgent ? ['t'] : [],
      transports: transport ? [{ inputArc: 'in', outputArc: 'out' }] : [],
    },
  };
}
const inspect = ['enabled', 'marking'];
function add(name, components, ops) {
  cases.push({
    name,
    network: {
      name: 'Differential',
      type: { timed: true, colored: false, game: false, stochastic: false },
      components,
    },
    ops: [...inspect, ...ops.flatMap((op) => [op, ...inspect])],
  });
}
for (const closed of [false, true])
  for (const weight of [1, 2]) {
    add(
      `transport_${closed}_${weight}`,
      [
        component('A', { transport: true, upper: '4', closed, weight }),
        component('B', { ages: ['1'] }),
        component('I', { ages: ['2'], active: false, urgent: true, upper: '2' }),
      ],
      [
        ['delay', '0.1'],
        ['delay', '0.2'],
        ['fire', 'A.t', 'youngest'],
        ['delay', '0.7'],
        ['fire', 'B.t', 'oldest'],
        ['delay', '2'],
        ['fire', 'I.t', 'oldest'],
      ],
    );
    add(
      `ordinary_${closed}_${weight}`,
      [
        component('A', {
          ages: ['0', '1', '2'],
          weight,
          interval: { lower: '1', upper: '3', lowerClosed: closed, upperClosed: closed },
        }),
        component('B', { ages: ['2'], upper: '3', closed }),
      ],
      [
        ['fire', 'A.t', 'oldest'],
        ['delay', '1'],
        ['fire', 'B.t', 'oldest'],
        ['delay', '1'],
        ['fire', 'A.t', 'youngest'],
      ],
    );
  }
add(
  'urgent_global',
  [
    component('A'),
    component('B', { ages: ['1'], urgent: true }),
    component('I', { active: false, urgent: true }),
  ],
  [
    ['delay', '0'],
    ['delay', '0.1'],
    ['fire', 'B.t', 'oldest'],
    ['delay', '0.1'],
    ['delay', '0.2'],
  ],
);
add(
  'manual_transport',
  [
    component('A', { transport: true, weight: 2 }),
    component('B', { transport: true, selfloop: true }),
  ],
  [
    ['fire', 'A.t', 'manual:p@1;p@4'],
    ['fire', 'B.t', 'oldest'],
    ['delay', '0.3'],
    ['fire', 'A.t', 'manual:p@99'],
  ],
);
for (const weight of [2, 3])
  add(
    `inhibitor_${weight}`,
    [component('A', { inhibitor: true, ages: ['1', '2'], weight }), component('B')],
    [
      ['fire', 'A.t', 'oldest'],
      ['delay', '0.1'],
      ['fire', 'B.t', 'oldest'],
    ],
  );

const script = [],
  web = [];
const formatInterval = (i) =>
  `${i.lowerClosed ? '[' : '('}${i.lower},${i.upper ?? 'inf'}${i.upperClosed ? ']' : ')'}`;
for (const c of cases) {
  script.push(`case ${c.name}`);
  web.push(`case ${c.name}`);
  for (const comp of c.network.components) {
    script.push(`component ${comp.id} ${comp.active ? 'active' : 'inactive'}`);
    for (const node of comp.net.nodes) {
      const invariant = comp.timing.invariants[node.id];
      script.push(
        node.kind === 'place'
          ? `place ${node.id} ${invariant ? `${invariant.upperClosed ? '<=' : '<'}${invariant.upper}` : 'inf'}`
          : `trans ${node.id} ${comp.timing.urgent.includes(node.id) ? 'urgent' : 'normal'}`,
      );
    }
    const [input, output] = comp.net.arcs;
    const interval = comp.timing.intervals.in
      ? formatInterval(comp.timing.intervals.in)
      : '[0,inf)';
    if (comp.timing.transports.length)
      script.push(`transport p t ${output.target} ${interval} ${input.weight}`);
    else {
      script.push(
        input.kind === 'inhibitor'
          ? `inh p t ${input.weight}`
          : `in p t ${interval} ${input.weight}`,
      );
      script.push(`out t ${output.target} ${output.weight}`);
    }
    for (const node of comp.net.nodes.filter((n) => n.kind === 'place'))
      for (let i = 0; i < node.tokens; i++)
        script.push(`token ${comp.id}.${node.id} ${comp.timing.ages[node.id]?.[i] ?? '0'}`);
  }
  const sim = new TimedNetworkSimulation(c.network);
  for (const op of c.ops) {
    if (op === 'enabled') {
      script.push(op);
      web.push(
        `enabled ${sim.enabled
          .map((r) => `${r.componentId}.${r.elementId}`)
          .sort()
          .join(',')}`,
      );
    } else if (op === 'marking') {
      script.push(op);
      web.push(
        `marking ${c.network.components
          .filter((c) => c.active)
          .flatMap((c) =>
            c.net.nodes
              .filter((n) => n.kind === 'place')
              .map(
                (n) =>
                  `${c.id}.${n.id}=${sim.marking[c.id][n.id]
                    .map((t) => addAges(t.age, '0'))
                    .sort(compareAges)
                    .join(',')}`,
              ),
          )
          .join(' ')}`,
      );
    } else {
      script.push(op.join(' '));
      try {
        if (op[0] === 'delay') {
          sim.delay(op[1]);
          web.push(`delay ${op[1]} ok`);
        } else {
          const [componentId, elementId] = op[1].split('.');
          const ref = { componentId, elementId };
          let selection = { mode: op[2] };
          if (op[2].startsWith('manual:')) {
            const bindings = {},
              used = new Set();
            for (const item of op[2].slice(7).split(';')) {
              const [place, age] = item.split('@');
              const input = sim.eligibleInputs(ref).find((i) => i.place === place);
              const token = input?.tokens.find(
                (t) => !used.has(t.id) && compareAges(t.age, age) === 0,
              );
              assert(token);
              used.add(token.id);
              (bindings[input.arcId] ??= []).push(token.id);
            }
            selection = { mode: 'manual', bindings };
          }
          sim.fire(ref, selection);
          web.push(`fire ${op[1]} ok`);
        }
      } catch {
        web.push(`${op[0]} ${op[1]} ${op[0] === 'delay' ? 'blocked' : 'error'}`);
      }
    }
  }
}
writeFileSync(join(OUT, 'scenarios.txt'), script.join('\n'));
execFileSync('javac', [
  '-cp',
  `${LIB}/*`,
  '-d',
  join(OUT, 'classes'),
  join(HERE, 'ExecutionReference.java'),
]);
const native = execFileSync(
  'java',
  [
    '-Djava.awt.headless=true',
    '-cp',
    `${join(OUT, 'classes')}:${LIB}/*`,
    'ExecutionReference',
    join(OUT, 'scenarios.txt'),
  ],
  { encoding: 'utf8' },
)
  .trimEnd()
  .split('\n');
writeFileSync(join(OUT, 'native.txt'), native.join('\n'));
writeFileSync(join(OUT, 'web.txt'), web.join('\n'));
assert.deepEqual(web, native);
const results = {
  cases: cases.length,
  observations: web.length - cases.length,
  passed: true,
  library: LIB,
  note: 'Released model API execution; urgency mirrors repository Animator. No file IO or GUI parity claim.',
};
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
