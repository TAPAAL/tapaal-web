import { newId } from './core/ids';
import { Arc, NetNode } from './core/net';
import {
  AuthoredInterval,
  AuthoredInvariant,
  BoundTerm,
  WeightTerm,
  AuthoredNetwork,
  ConstantDecl,
} from './core/authored-model';
import * as workspace from './editor-workspace';
import type { TimingDraft } from './timed-ui';
export function termText(
  network: Pick<AuthoredNetwork, 'constants'>,
  term: BoundTerm | WeightTerm | null,
): string {
  if (term === null) return 'inf';
  if (typeof term !== 'object') return String(term);
  const declaration = network.constants.find((c) => c.id === term.constantId);
  if (!declaration) throw new Error('Unbound constant.');
  return declaration.name;
}
function integer(text: string): string {
  if (!/^\d+$/.test(text) || BigInt(text) > 2147483647n)
    throw new Error(
      'Use an integer from 0 to 2147483647 or one declared constant name. Arithmetic is not supported.',
    );
  return String(BigInt(text));
}
export function parseTerm(network: Pick<AuthoredNetwork, 'constants'>, text: string): BoundTerm {
  text = text.trim();
  const constant = network.constants.find((c) => c.name === text);
  return constant ? { constantId: constant.id } : integer(text);
}
export function parseWeight(network: Pick<AuthoredNetwork, 'constants'>, text: string): WeightTerm {
  text = text.trim();
  const constant = network.constants.find((c) => c.name === text);
  if (constant) return { constantId: constant.id };
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new Error(
      'Use a positive safe integer or one declared constant name. Arithmetic is not supported.',
    );
  return Number(text);
}
export function intervalText(
  network: Pick<AuthoredNetwork, 'constants'>,
  interval?: AuthoredInterval,
): string {
  return interval
    ? `${interval.lowerClosed ? '[' : '('}${termText(network, interval.lower)},${termText(network, interval.upper)}${interval.upperClosed ? ']' : ')'}`
    : '[0,inf)';
}
export function invariantText(
  network: Pick<AuthoredNetwork, 'constants'>,
  invariant?: AuthoredInvariant,
): string {
  return invariant
    ? `${invariant.upperClosed ? '<=' : '<'} ${termText(network, invariant.upper)}`
    : '< inf';
}
export function parseInterval(
  network: Pick<AuthoredNetwork, 'constants'>,
  text: string,
): AuthoredInterval | null {
  const match = /^(\[|\()\s*([^,]+?)\s*,\s*([^,]+?)\s*(\]|\))$/.exec(text.trim());
  if (!match) throw new Error('Use an interval such as [0,Deadline) or [Start,End].');
  const interval = {
    lower: parseTerm(network, match[2]),
    upper: match[3] === 'inf' ? null : parseTerm(network, match[3]),
    lowerClosed: match[1] === '[',
    upperClosed: match[4] === ']',
  };
  return interval.lower === '0' &&
    interval.lowerClosed &&
    interval.upper === null &&
    !interval.upperClosed
    ? null
    : interval;
}
export function parseInvariant(
  network: Pick<AuthoredNetwork, 'constants'>,
  text: string,
): AuthoredInvariant | null {
  const match = /^(<=|<)\s*(\S+)$/.exec(text.trim());
  if (!match) throw new Error('Use < inf, < Deadline or <= Deadline.');
  if (match[1] === '<' && match[2] === 'inf') return null;
  return {
    upper: match[2] === 'inf' ? null : parseTerm(network, match[2]),
    upperClosed: match[1] === '<=',
  };
}
export function timingDraft(doc: workspace.NetworkDocument, element: NetNode | Arc): TimingDraft {
  const timing = workspace.sourceComponent(doc).timing!;
  const own = <T>(map: Readonly<Record<string, T>>) =>
    Object.hasOwn(map, element.id) ? map[element.id] : undefined;
  return {
    invariant: invariantText(doc.network, own(timing.invariants)),
    interval: intervalText(doc.network, own(timing.intervals)),
    ages: (own(timing.ages) ?? []).join(', '),
    urgent: timing.urgent.includes(element.id),
    outputArc: timing.transports.find((p) => p.inputArc === element.id)?.outputArc ?? '',
  };
}
export interface ElementEdit {
  actor?: import('./core/authored-shared').TransitionActor;
  element: NetNode | Arc;
  weightText: string;
  timing: TimingDraft | null;
}
/** Explicit property intent; untouched decimal bounds and symbolic defaults retain source terms. */
export function editElement(
  doc: workspace.NetworkDocument,
  edit: ElementEdit,
): workspace.NetworkDocument {
  const component = workspace.sourceComponent(doc),
    original = [...component.net.nodes, ...component.net.arcs].find(
      (e) => e.id === edit.element.id,
    );
  if (!original) throw new Error('The edited element no longer exists.');
  const element =
    'name' in edit.element
      ? edit.element
      : { ...edit.element, weight: parseWeight(doc.network, edit.weightText) };
  let timing = null;
  if (component.timing) {
    if (!edit.timing) throw new Error('Timing draft is missing.');
    const previous = timingDraft(doc, edit.element),
      draft = edit.timing;
    timing = {
      invariant:
        draft.invariant === previous.invariant
          ? Object.hasOwn(component.timing.invariants, element.id)
            ? component.timing.invariants[element.id]
            : null
          : parseInvariant(doc.network, draft.invariant),
      interval:
        draft.interval === previous.interval
          ? Object.hasOwn(component.timing.intervals, element.id)
            ? component.timing.intervals[element.id]
            : null
          : parseInterval(doc.network, draft.interval),
      ages: draft.ages.trim() ? draft.ages.split(',').map((s) => s.trim()) : [],
      urgent: draft.urgent,
      outputArc: draft.outputArc,
    };
  }
  const command = {
    kind: 'editElement' as const,
    componentId: component.id,
    element,
    timing,
  };
  return edit.actor !== undefined
    ? workspace.sharedTransact(doc, { kind: 'localActorEdit', edit: command, actor: edit.actor })
    : workspace.transact(doc, command);
}
export function editDeclaration(
  doc: workspace.NetworkDocument,
  draft: { id?: string; name: string; value: string },
): workspace.NetworkDocument {
  const value = Number(integer(draft.value.trim()));
  const constant: ConstantDecl = {
    id: draft.id ?? newId(),
    name: draft.name.trim(),
    value,
  };
  return workspace.transact(
    doc,
    draft.id ? { kind: 'updateConstant', ...constant } : { kind: 'addConstant', constant },
  );
}
