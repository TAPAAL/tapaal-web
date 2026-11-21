import { newId } from './core/ids';
/** UI drafts retain authored values; simulation marking never enters these commands. */
import { SharedEdit, SharedPlace, SharedSource } from './core/authored-shared';
import { authoredFingerprint } from './core/authored-model';
import { parseInvariant, invariantText } from './constants-editor';
import { isSharedOccurrence } from './editor-workspace';
export type SharedPlaceTarget =
  { kind: 'pool'; poolId?: string } | { kind: 'place'; componentId: string; elementId: string };
export interface SharedPlaceDraft {
  action: 'pool' | 'create' | 'use' | 'detach';
  name: string;
  tokens: number;
  invariant: string;
  ages: string;
  poolId: string;
  accept: boolean;
}
export function placePool(
  source: SharedSource,
  target: SharedPlaceTarget,
): SharedPlace | undefined {
  if (target.kind === 'pool') return source.shared.places.find((p) => p.id === target.poolId);
  const node = source.components
    .find((c) => c.id === target.componentId)
    ?.net.nodes.find((n) => n.id === target.elementId);
  return node && isSharedOccurrence(node)
    ? source.shared.places.find((p) => p.id === node.sharedId)
    : undefined;
}
export function sharedDraft(source: SharedSource, target: SharedPlaceTarget): SharedPlaceDraft {
  const pool = placePool(source, target);
  const component =
    target.kind === 'place'
      ? source.components.find((c) => c.id === target.componentId)
      : undefined;
  const local =
    target.kind === 'place'
      ? component?.net.nodes.find((n) => n.id === target.elementId)
      : undefined;
  const timing =
    pool?.timing ??
    (local && component?.timing
      ? {
          invariant: component.timing.invariants[local.id],
          ages: component.timing.ages[local.id] ?? [],
        }
      : undefined);
  let name = pool?.name ?? (local && 'name' in local ? local.name : 'SharedPlace');
  if (target.kind === 'place' && pool) {
    const taken = new Set([
      ...source.shared.places.map((p) => p.name),
      ...source.components.flatMap((c) =>
        c.net.nodes.flatMap((n) => ('name' in n ? [n.name] : [])),
      ),
    ]);
    let i = 1;
    while (taken.has(`${pool.name}_local${i}`)) i++;
    name = `${pool.name}_local${i}`;
  }
  return {
    action: target.kind === 'pool' ? 'pool' : pool ? 'detach' : 'create',
    name,
    tokens: pool?.tokens ?? (local && 'tokens' in local ? local.tokens : 0),
    invariant: invariantText(source, timing?.invariant ?? undefined),
    ages: timing?.ages.join(', ') ?? '',
    poolId: source.shared.places[0]?.id ?? '',
    accept: false,
  };
}
export function adoptionDiffers(
  source: SharedSource,
  target: SharedPlaceTarget,
  poolId: string,
): boolean {
  if (target.kind !== 'place') return false;
  const c = source.components.find((c) => c.id === target.componentId)!;
  const n = c.net.nodes.find((n) => n.id === target.elementId)!;
  const pool = source.shared.places.find((p) => p.id === poolId);
  if (!pool || isSharedOccurrence(n)) return false;
  return (
    authoredFingerprint({
      tokens: n.tokens,
      timing: c.timing
        ? { invariant: c.timing.invariants[n.id] ?? null, ages: c.timing.ages[n.id] ?? [] }
        : undefined,
    }) !== authoredFingerprint({ tokens: pool.tokens, timing: pool.timing })
  );
}
export function sharedPlaceCommand(
  source: SharedSource,
  target: SharedPlaceTarget,
  draft: SharedPlaceDraft,
): SharedEdit {
  if (target.kind === 'place') {
    if (draft.action === 'detach')
      return {
        kind: 'detach',
        componentId: target.componentId,
        elementId: target.elementId,
        name: draft.name.trim(),
      };
    if (draft.action === 'use')
      return {
        kind: 'usePool',
        componentId: target.componentId,
        elementId: target.elementId,
        poolId: draft.poolId,
        acceptPoolValues: draft.accept,
      };
    return {
      kind: 'makeShared',
      componentId: target.componentId,
      elementId: target.elementId,
      poolId: newId(),
      name: draft.name.trim(),
    };
  }
  const old = placePool(source, target);
  const pool: SharedPlace = {
    id: old?.id ?? newId(),
    name: draft.name.trim(),
    tokens: Number(draft.tokens),
    ...(source.type.timed
      ? {
          timing: {
            invariant:
              old && invariantText(source, old.timing?.invariant ?? undefined) === draft.invariant
                ? old.timing!.invariant
                : parseInvariant(source, draft.invariant),
            ages: draft.ages.trim() ? draft.ages.split(',').map((a) => a.trim()) : [],
          },
        }
      : {}),
  };
  return { kind: old ? 'editPool' : 'createPool', pool };
}
