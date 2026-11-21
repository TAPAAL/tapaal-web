#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const HERE = dirname(fileURLToPath(import.meta.url)),
  WEB = resolve(HERE, '../..');
const LIB = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const OUT = mkdtempSync(join(tmpdir(), 'tapaal-shared-execution-'));
try {
  mkdirSync(join(OUT, 'classes'));
  execFileSync(join(WEB, 'node_modules/.bin/esbuild'), [
    join(WEB, 'src/app/core/shared-network-simulation.ts'),
    join(WEB, 'src/app/core/authored-shared.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--out-extension:.js=.mjs',
    `--outdir=${OUT}`,
    '--log-level=warning',
  ]);
  const { SharedNetworkSimulation } = await import(
    pathToFileURL(join(OUT, 'shared-network-simulation.mjs'))
  );
  const { validateSharedSource } = await import(pathToFileURL(join(OUT, 'authored-shared.mjs')));
  const cases = [];
  for (const route of ['local-local', 'local-share', 'share-local', 'share-share', 'share-self'])
    for (const weight of [1, 2])
      for (const policy of ['oldest', 'youngest', 'manual'])
        for (const strict of [false, true])
          cases.push({ route, weight, policy, strict, transport: true });
  for (const policy of ['oldest', 'youngest', 'manual'])
    for (const self of [false, true])
      cases.push({
        route: self ? 'share-self' : 'share-local',
        weight: 2,
        policy,
        strict: false,
        transport: false,
      });
  for (const active of [false, true])
    for (const urgent of [false, true])
      for (const inhibitor of [false, true])
        cases.push({
          route: 'share-local',
          weight: 1,
          policy: 'oldest',
          strict: false,
          transport: false,
          active,
          urgent,
          inhibitor,
        });
  // Random sequences are intentionally not compared. Consuming all three eligible
  // tokens makes age/multiplicity deterministic while using native RandomFiringMode.
  for (const route of ['local-local', 'local-share', 'share-local', 'share-share', 'share-self'])
    cases.push({ route, weight: 3, policy: 'random', strict: false, transport: true });
  const script = [],
    web = [];
  const inv = (upper, closed = true) => ({ upper, upperClosed: closed });
  const node = (id, tokens = 0) => ({ id, name: id, kind: 'place', tokens, x: 0, y: 0 });
  const member = (id) => ({ id, kind: 'place', sharedId: id, x: 0, y: 0 });
  for (const [index, c] of cases.entries()) {
    const { route, weight, policy, strict, transport } = c,
      active = c.active ?? true,
      urgent = c.urgent ?? false,
      inhibitor = c.inhibitor ?? false;
    const from = route.startsWith('local') ? 'L' : 'P',
      to = route.endsWith('local') ? 'Q' : route.endsWith('self') ? 'P' : 'R';
    const timing = () => ({ ages: {}, invariants: {}, intervals: {}, transports: [], urgent: [] });
    const t = timing();
    if (from === 'L') t.ages.L = ['1', '2', '2'];
    t.invariants.Q = inv('3', !strict);
    if (!urgent) t.intervals.in = { lower: '1', upper: '4', lowerClosed: true, upperClosed: true };
    if (urgent) t.urgent = ['t'];
    // Native/web urgent transport finite-destination restriction is structural.
    if (transport) t.transports = [{ inputArc: 'in', outputArc: 'out' }];
    const source = {
      name: 'Differential',
      type: { timed: true, colored: false, game: false, stochastic: false },
      constants: [],
      shared: {
        places: [
          { id: 'P', name: 'P', tokens: 3, timing: { invariant: inv('5'), ages: ['1', '2', '2'] } },
          { id: 'R', name: 'R', tokens: 0, timing: { invariant: inv('3', !strict), ages: [] } },
          { id: 'D', name: 'D', tokens: 1, timing: { invariant: inv('1'), ages: ['1'] } },
        ],
        transitions: [],
      },
      components: [
        {
          id: 'A',
          active,
          net: {
            name: 'Differential',
            template: 'A',
            nodes: [
              member('P'),
              member('R'),
              node('L', from === 'L' ? 3 : 0),
              node('Q'),
              { id: 't', name: 't', kind: 'transition', tokens: 0, x: 0, y: 0 },
            ],
            arcs: [
              { id: 'in', source: from, target: 't', kind: 'normal', weight },
              { id: 'out', source: 't', target: to, kind: 'normal', weight },
            ],
          },
          timing: t,
        },
        {
          id: 'B',
          active,
          net: {
            name: 'Differential',
            template: 'B',
            nodes: [member('P'), { id: 't', name: 't', kind: 'transition', tokens: 0, x: 0, y: 0 }],
            arcs: [
              {
                id: 'in',
                source: 'P',
                target: 't',
                kind: inhibitor ? 'inhibitor' : 'normal',
                weight: 2,
              },
            ],
          },
          timing: timing(),
        },
      ],
    };
    const validated = validateSharedSource(source);
    assert(validated.ok, JSON.stringify(validated));
    const sim = new SharedNetworkSimulation(validated.value);
    script.push(
      `case c${index}`,
      'shared P <=5',
      `shared R ${strict ? '<' : '<='}3`,
      'shared D <=1',
    );
    for (const p of source.shared.places)
      for (const age of p.timing.ages) script.push(`token global.${p.id} ${age}`);
    script.push(
      `component A ${active ? 'active' : 'inactive'}`,
      'member P',
      'member R',
      `place L inf`,
      `place Q ${strict ? '<' : '<='}3`,
      `trans t ${urgent ? 'urgent' : 'normal'}`,
    );
    if (from === 'L') for (const age of ['1', '2', '2']) script.push(`token A.L ${age}`);
    const interval = urgent ? '[0,inf)' : '[1,4]';
    if (transport) script.push(`transport ${from} t ${to} ${interval} ${weight}`);
    else script.push(`in ${from} t ${interval} ${weight}`, `out t ${to} ${weight}`);
    script.push(
      `component B ${active ? 'active' : 'inactive'}`,
      'member P',
      'trans t normal',
      `${inhibitor ? 'inh' : 'in'} P t ${inhibitor ? '' : '[0,inf) '}2`,
    );
    web.push(`case c${index}`);
    const observe = () => {
      script.push('enabled', 'marking');
      web.push(
        `enabled ${sim.enabled
          .map((r) => `${r.componentId}.${r.elementId}`)
          .sort()
          .join(',')}`,
      );
      const fields = sim.pools.map(
        (p) =>
          `global.${p.id}=${p.tokens
            .map((t) => t.age)
            .sort((a, b) => Number(a) - Number(b))
            .join(',')}`,
      );
      if (active)
        for (const id of ['L', 'Q'])
          fields.push(
            `A.${id}=${sim
              .markingFor('A')
              [id].map((t) => t.age)
              .sort((a, b) => Number(a) - Number(b))
              .join(',')}`,
          );
      web.push(`marking ${fields.join(' ')}`);
    };
    const delay = (amount) => {
      script.push(`delay ${amount}`);
      let result = 'ok';
      try {
        sim.delay(amount);
      } catch {
        result = 'blocked';
      }
      web.push(`delay ${amount} ${result}`);
      observe();
    };
    const fire = (component, mode) => {
      const ref = { componentId: component, elementId: 't' };
      let nativeMode = mode,
        selection = mode === 'random' ? { mode, random: Math.random } : { mode };
      if (mode === 'manual') {
        const input = sim.eligibleInputs(ref)[0],
          chosen = input.tokens.slice(0, weight);
        selection = { mode, bindings: { in: chosen.map((t) => t.id) } };
        nativeMode = `manual:${chosen.map((t) => `${input.place}@${t.age}`).join(';')}`;
      }
      script.push(`fire ${component}.t ${nativeMode}`);
      let result = 'ok';
      try {
        sim.fire(ref, selection);
      } catch {
        result = 'error';
      }
      web.push(`fire ${component}.t ${result}`);
      observe();
    };
    observe();
    delay('0.5');
    if (active) fire('A', policy);
    else fire('A', 'oldest');
    fire('B', 'oldest');
    delay('2');
    delay('0');
  }
  writeFileSync(join(OUT, 'scenarios.txt'), script.join('\n'));
  execFileSync('javac', [
    '-J-Xmx128m',
    '-cp',
    `${LIB}/*`,
    '-d',
    join(OUT, 'classes'),
    join(HERE, 'SharedExecutionReference.java'),
  ]);
  const native = execFileSync(
    'java',
    [
      '-Xmx128m',
      '-Djava.awt.headless=true',
      '-cp',
      `${join(OUT, 'classes')}:${LIB}/*`,
      'SharedExecutionReference',
      join(OUT, 'scenarios.txt'),
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .trimEnd()
    .split('\n');
  assert.equal(web.length, native.length);
  for (let i = 0; i < web.length; i++)
    assert.equal(
      web[i],
      native[i],
      `observation ${i}: ${script.filter((s) => s.startsWith('case ')).length} cases`,
    );
  console.log(
    JSON.stringify({
      cases: cases.length,
      observations: web.length - cases.length,
      passed: true,
      library: LIB,
      note: 'Released 4.0.4 model classes. Only GUI delay predicate substituted; independent native invariants and urgency checked. Age/multiplicity comparison, no Java identity, GUI or nonzero-age file IO claim.',
    }),
  );
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
