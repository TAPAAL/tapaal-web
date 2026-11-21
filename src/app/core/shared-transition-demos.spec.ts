// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import {
  parseSharedTapn,
  serializeSharedTapn,
  serializeSharedJson,
  parseSharedJson,
} from './shared-files';
import { validateSharedSource } from './authored-shared';
import { SharedNetworkSimulation } from './shared-network-simulation';
it.each(['train-level-crossing', 'workflow-advanced', 'workflow-complaint', 'workflow-medical'])(
  'unchanged native %s preserves source on saves and executes synchronization',
  (name) => {
    const input = readFileSync(`../src/main/resources/Example nets/${name}.tapn`, 'utf8');
    const source = parseSharedTapn(input).network;
    expect(source.shared.transitions.length).toBeGreaterThan(0);
    expect(parseSharedJson(serializeSharedJson(source)).network).toEqual(source);
    const reopened = parseSharedTapn(serializeSharedTapn(source)).network;
    expect(reopened.constants.map((c) => [c.name, c.value])).toEqual(
      source.constants.map((c) => [c.name, c.value]),
    );
    expect(reopened.shared.transitions.map((p) => [p.name, p.urgent])).toEqual(
      source.shared.transitions.map((p) => [p.name, p.urgent]),
    );
    expect(reopened.savedQueries?.xml).toEqual(source.savedQueries?.xml);
    const revision = validateSharedSource(source);
    if (!revision.ok) throw Error();
    const r = new SharedNetworkSimulation(revision.value, () => 0);
    let synchronized = false;
    for (let i = 0; i < 300 && !synchronized; i++) {
      const sync = r.enabled.find((ref) =>
        source.components
          .find((c) => c.id === ref.componentId)!
          .net.nodes.some((n) => n.id === ref.elementId && 'sharedId' in n),
      );
      if (sync) {
        const before = r.cursor;
        r.fire(sync, { mode: 'oldest' });
        expect(r.cursor).toBe(before + 1);
        synchronized = true;
        break;
      }
      const interval = r.delayInterval;
      if (r.enabled.length) r.fire(r.enabled[i % r.enabled.length], { mode: 'oldest' });
      if (interval && (interval.upper === null || Number(interval.upper) > 0)) {
        const current = r.delayInterval!;
        if (current.upper === null || Number(current.upper) > 0)
          r.delay(
            current.upper === null
              ? '1'
              : String(Math.min(1, Number(current.upper) / (current.upperClosed ? 1 : 2))),
          );
      } else if (!r.enabled.length) break;
    }
    expect(synchronized).toBe(true);
    expect(serializeSharedJson(source)).toBe(serializeSharedJson(revision.value.source));
  },
);
