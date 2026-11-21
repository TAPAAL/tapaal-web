#!/usr/bin/env node
// Run through worker-job; owns and cleans only its own temporary directory.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const out = mkdtempSync(join(tmpdir(), 'tapaal-shared-files-'));
try {
  const dom = new JSDOM();
  for (const key of ['DOMParser', 'XMLSerializer']) globalThis[key] = dom.window[key];
  execFileSync(
    join(WEB, 'node_modules/.bin/esbuild'),
    [
      'src/app/core/shared-files.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${out}/codec.mjs`,
      '--log-level=warning',
    ],
    { cwd: WEB },
  );
  const codec = await import(pathToFileURL(join(out, 'codec.mjs')));
  execFileSync('javac', [
    '-J-Xmx128m',
    '-cp',
    `${LIB}/*`,
    '-d',
    out,
    join(WEB, 'scripts/native-reference/SharedFilesReference.java'),
  ]);
  const fixture = readFileSync(
    join(WEB, 'src/app/core/test-fixtures/shared-files/timed.tapn'),
    'utf8',
  );
  for (const [name, xml] of [
    ['original', fixture],
    ['web-written', codec.serializeSharedTapn(codec.parseSharedTapn(fixture).network)],
  ]) {
    const input = join(out, `${name}.tapn`),
      resaved = join(out, `${name}.native.tapn`);
    writeFileSync(input, xml);
    process.stdout.write(
      execFileSync(
        'xvfb-run',
        [
          '-a',
          'java',
          '-Xmx128m',
          '-cp',
          `${out}:${LIB}/*`,
          'SharedFilesReference',
          input,
          resaved,
        ],
        { encoding: 'utf8', timeout: 30000 },
      ),
    );
    const reopened = codec.parseSharedTapn(readFileSync(resaved, 'utf8')).network;
    assert.equal(reopened.shared.places.length, 2);
    assert.equal(reopened.shared.places.find((p) => p.name === 'Pool').tokens, 3);
    assert.equal(
      reopened.components[0].net.arcs.find((a) => a.id === 'ti').weight.constantId,
      reopened.constants[0].id,
    );
    const before = codec.parseSharedTapn(xml).network;
    assert.deepEqual(reopened.shared, before.shared);
    assert.deepEqual(
      reopened.components.map((c) => c.active),
      before.components.map((c) => c.active),
    );
    for (const [i, c] of reopened.components.entries()) {
      // Released writer rewrites member wire IDs to pool names. Establish an
      // explicit correspondence, then compare geometry and arc endpoints.
      const original = before.components[i];
      const wire = new Map(
        original.net.nodes.map((node) => {
          const matches = c.net.nodes.filter((candidate) =>
            'sharedId' in node
              ? candidate.sharedId === node.sharedId
              : candidate.kind === node.kind && candidate.name === node.name,
          );
          assert.equal(matches.length, 1);
          return [node.id, matches[0].id];
        }),
      );
      assert.equal(new Set(wire.values()).size, original.net.nodes.length);
      assert.deepEqual(
        c.net.nodes,
        original.net.nodes.map((n) => ({ ...n, id: wire.get(n.id) })),
      );
      const arcIds = new Map(
        original.net.arcs.map((arc) => {
          const matches = c.net.arcs.filter(
            (a) =>
              a.source === wire.get(arc.source) &&
              a.target === wire.get(arc.target) &&
              a.kind === arc.kind,
          );
          assert.equal(matches.length, 1);
          return [arc.id, matches[0].id];
        }),
      );
      assert.deepEqual(
        c.net.arcs,
        original.net.arcs.map((a) => ({
          ...a,
          id: arcIds.get(a.id),
          source: wire.get(a.source),
          target: wire.get(a.target),
        })),
      );
      assert.deepEqual(c.timing, before.components[i].timing);
      // Released Swing annotation constructor adds one to each rectangle field.
      // Record that loader/writer behavior explicitly; web self-reopen is exact.
      assert.deepEqual(
        c.net.annotations,
        original.net.annotations?.map((n) => ({
          ...n,
          x: n.x + 1,
          y: n.y + 1,
          width: n.width + 1,
          height: n.height + 1,
        })),
      );
    }
    console.log(`PASS ${name} -> released writer -> opt-in web reader`);
  }
  console.log(
    'Zero-age released file conformance only. Native writer renames member/inhibitor IDs and grows annotation rectangles by one; explicit correspondence checked. No GUI or nonzero-age compatibility claim.',
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
