import { type ComponentTiming, validateComponentTiming } from './documents';
import type { Net } from './net';

/** Strict clipboard schema, separate from the more permissive in-memory timing validator. */
export function checkClipboardTiming(net: Net, value: unknown): asserts value is ComponentTiming {
  const object = (value: unknown, keys?: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Clipboard timing must contain objects.');
    const record = value as Record<string, unknown>;
    if (
      keys &&
      (Object.keys(record).some((k) => !keys.includes(k)) ||
        keys.some((k) => !Object.hasOwn(record, k)))
    )
      throw new Error('Clipboard timing has missing or unsupported fields.');
    return record;
  };
  const timing = object(value, ['intervals', 'invariants', 'urgent', 'transports', 'ages']);
  for (const item of Object.values(object(timing['intervals'])))
    object(item, ['lower', 'upper', 'lowerClosed', 'upperClosed']);
  for (const item of Object.values(object(timing['invariants'])))
    object(item, ['upper', 'upperClosed']);
  object(timing['ages']);
  if (!Array.isArray(timing['transports'])) throw new Error('Clipboard transports must be a list.');
  for (const pair of timing['transports']) object(pair, ['inputArc', 'outputArc']);
  validateComponentTiming(net, value as ComponentTiming);
}

/** Copy only model timing, never the simulator marking. Refuse any touched incomplete pair. */
export function selectionTiming(
  net: Net,
  timing: ComponentTiming,
  nodes: readonly string[],
  arcs: readonly string[],
  selected: readonly string[],
): ComponentTiming {
  checkClipboardTiming(net, timing);
  const kept = new Set([...nodes, ...arcs]);
  const touched = new Set(selected);
  for (const pair of timing.transports) {
    const halves = net.arcs.filter((a) => a.id === pair.inputArc || a.id === pair.outputArc);
    if (
      halves.some((a) => touched.has(a.id) || touched.has(a.source) || touched.has(a.target)) &&
      (!kept.has(pair.inputArc) || !kept.has(pair.outputArc))
    )
      throw new Error(
        'Select both transport halves and all three endpoints to copy, cut or duplicate this transport. Nothing was changed.',
      );
  }
  const keep = <T>(values: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(values).filter(([id]) => kept.has(id)));
  return structuredClone({
    intervals: keep(timing.intervals),
    invariants: keep(timing.invariants),
    ages: keep(timing.ages),
    urgent: timing.urgent.filter((id) => kept.has(id)),
    transports: timing.transports.filter((p) => kept.has(p.inputArc)),
  });
}

/** Merge only after geometry and fresh identities have been allocated. */
export function pasteTiming(
  target: ComponentTiming,
  source: ComponentTiming | undefined,
  ids: Record<string, string>,
): ComponentTiming {
  if (!source) return structuredClone(target);
  const map = <T>(values: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(values).map(([id, value]) => [ids[id], structuredClone(value)]),
    );
  return {
    intervals: { ...target.intervals, ...map(source.intervals) },
    invariants: { ...target.invariants, ...map(source.invariants) },
    ages: { ...target.ages, ...map(source.ages) },
    urgent: [...target.urgent, ...source.urgent.map((id) => ids[id])],
    transports: [
      ...target.transports,
      ...source.transports.map((p) => ({ inputArc: ids[p.inputArc], outputArc: ids[p.outputArc] })),
    ],
  };
}
