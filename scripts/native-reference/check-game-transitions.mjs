import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const web = resolve(import.meta.dirname, '../..'),
  out = mkdtempSync(join(tmpdir(), 'tapaal-sync-')),
  lib = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
try {
  execFileSync(join(web, 'node_modules/.bin/esbuild'), [
    join(web, 'src/app/core/shared-network-simulation.ts'),
    join(web, 'src/app/core/authored-shared.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--out-extension:.js=.mjs',
    `--outdir=${out}`,
    '--log-level=warning',
  ]);
  const { SharedNetworkSimulation } = await import(
      pathToFileURL(join(out, 'shared-network-simulation.mjs'))
    ),
    { validateSharedSource } = await import(pathToFileURL(join(out, 'authored-shared.mjs')));
  execFileSync('javac', [
    '-J-Xmx128m',
    '-cp',
    `${lib}/*`,
    '-d',
    out,
    join(import.meta.dirname, 'GameTransitionReference.java'),
  ]);
  const native = execFileSync(
    'java',
    ['-Xmx128m', '-Djava.awt.headless=true', '-cp', `${out}:${lib}/*`, 'GameTransitionReference'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  const observations = [];
  for (const environment of [false, true])
    for (const transport of [false, true])
      for (const weight of [1, 2])
        for (const policy of ['oldest', 'youngest', 'manual', 'random'])
          for (const second of [false, true]) {
            if (policy === 'random' && weight !== 2) continue;
            const timing = () => ({
              ages: { p: ['1', '2'] },
              invariants: {},
              intervals: {},
              urgent: [],
              transports: transport ? [{ inputArc: 'in', outputArc: 'out' }] : [],
            });
            const source = {
              name: 'Sync',
              type: { timed: true, colored: false, game: true, stochastic: false },
              constants: [],
              shared: {
                places: [],
                transitions: [
                  {
                    id: 'sync',
                    name: 'Sync',
                    urgent: false,
                    actor: environment ? 'environment' : 'controller',
                  },
                ],
              },
              components: [0, 1, 2].map((i) => ({
                id: `C${i}`,
                active: i === 0 || (i === 1 && second),
                net: {
                  name: 'Sync',
                  template: `C${i}`,
                  nodes: [
                    { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 0, y: 0 },
                    { id: 'q', name: 'Q', kind: 'place', tokens: 0, x: 2, y: 0 },
                    { id: 't', sharedId: 'sync', kind: 'transition', x: 1, y: 0 },
                  ],
                  arcs: [
                    { id: 'in', source: 'p', target: 't', weight, kind: 'normal' },
                    { id: 'out', source: 't', target: 'q', weight, kind: 'normal' },
                  ],
                },
                timing: timing(),
              })),
            };
            const revision = validateSharedSource(source);
            assert(revision.ok, JSON.stringify(revision));
            const s = new SharedNetworkSimulation(revision.value),
              ref = { componentId: 'C0', elementId: 't' };
            assert.equal(s.actor(ref), environment ? 'environment' : 'controller');
            assert.equal(s.enabled.length, 1);
            assert.notEqual(s.delayInterval, null);
            const urgent = structuredClone(source);
            urgent.shared.transitions[0].urgent = true;
            const u = validateSharedSource(urgent);
            assert(u.ok);
            const us = new SharedNetworkSimulation(u.value);
            assert.throws(() => us.delay('1'));
            urgent.components[0].net.nodes[0].tokens = 0;
            urgent.components[0].timing.ages = {};
            const blocked = validateSharedSource(urgent);
            assert(blocked.ok);
            const bs = new SharedNetworkSimulation(blocked.value);
            assert.equal(bs.enabled.length, 0);
            bs.delay('1');
            s.delay('0');
            if (policy === 'manual')
              s.fire(ref, {
                mode: 'manual',
                bindings: Object.fromEntries(
                  s.eligibleInputs(ref).map((i) => [
                    i.arcId,
                    [...i.tokens]
                      .sort((a, b) => Number(b.age) - Number(a.age))
                      .slice(0, weight)
                      .map((t) => t.id),
                  ]),
                ),
              });
            else
              s.fire(
                ref,
                policy === 'random' ? { mode: 'random', random: () => 0 } : { mode: policy },
              );
            const ages = (t) =>
              `[${t
                .map((t) => t.age)
                .sort()
                .join(', ')}]`;
            observations.push(
              `case ${environment} ${transport} ${weight} ${policy} ${second}` +
                [0, 1, 2]
                  .map((i) => {
                    const m = s.markingFor(`C${i}`);
                    return ` | ${ages(m.p)}/${ages(m.q)}`;
                  })
                  .join(''),
            );
          }
  assert.deepEqual(native.slice(0, -1), observations);
  console.log(`${observations.length} synchronized native/web cases agree; ${native.at(-1)}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
