/** Strict subset of writeTACPN's redundant uncoloured scaffolding; not a colour evaluator. */
const MAX_INT = 2147483647;

function invalid(): never {
  throw new Error('Unsupported or conflicting dot-only structure.');
}
/** Check every node, attribute and namespace, including content the native parser might ignore. */
function shape(
  element: Element | undefined,
  tag: string,
  namespace: string | null,
  attributes: Record<string, string> = {},
  text = false,
): Element[] {
  if (
    !element ||
    element.localName !== tag ||
    element.prefix !== null ||
    element.namespaceURI !== namespace ||
    element.attributes.length !== Object.keys(attributes).length ||
    !Object.entries(attributes).every(
      ([key, value]) =>
        element.getAttributeNode(key)?.namespaceURI === null && element.getAttribute(key) === value,
    )
  )
    invalid();
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === node.TEXT_NODE) {
      if (!text && node.textContent!.trim()) invalid();
    } else if (node.nodeType !== node.ELEMENT_NODE || text) invalid();
  }
  return Array.from(element.children);
}
function one(element: Element, tag: string, namespace: string | null): Element {
  const children = shape(element, tag, namespace);
  if (children.length !== 1) invalid();
  return children[0];
}
function leaf(element: Element, tag: string, ns: string | null, attrs = {}): void {
  if (shape(element, tag, ns, attrs).length) invalid();
}

export function inspectDotDeclaration(element: Element): void {
  const ns = element.namespaceURI;
  const declarations = one(one(element, 'declaration', ns), 'structure', ns);
  const sorts = shape(declarations, 'declarations', ns);
  if (!sorts.length) return;
  if (sorts.length !== 1) invalid();
  const dots = shape(sorts[0], 'namedsort', ns, { id: 'dot', name: 'dot' });
  if (dots.length !== 1) invalid();
  leaf(dots[0], 'dot', ns);
}

/** One numberof, optionally wrapped in the writer's single-term marking add. */
function coefficient(structure: Element, marking: boolean, ns: string | null): number {
  let expression = one(structure, 'structure', ns);
  if (marking && expression.localName === 'add')
    expression = one(one(expression, 'add', ns), 'subterm', ns);
  const terms = shape(expression, 'numberof', ns);
  if (terms.length !== 2) invalid();
  const number = one(terms[0], 'subterm', ns);
  const value = number.getAttribute('value') ?? '';
  if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > MAX_INT) invalid();
  const positive = shape(number, 'numberconstant', ns, { value });
  if (positive.length !== 1) invalid();
  leaf(positive[0], 'positive', ns);
  const dot = one(terms[1], 'subterm', ns);
  if (dot.localName === 'dotconstant') leaf(dot, 'dotconstant', ns);
  else leaf(dot, 'useroperator', ns, { declaration: 'dot' });
  return Number(value);
}

export function inspectDotDependency(element: Element, parent: Element): void {
  const ns = parent.namespaceURI;
  const tag = element.localName;
  const siblings = Array.from(parent.children).filter((e) => e.localName === tag);
  if (siblings.length !== 1) invalid();
  const children = shape(element, tag, ns);
  if (children.length !== 2) invalid();
  shape(children[0], 'text', ns, {}, true);
  const text = children[0].textContent;
  if (tag === 'type') {
    if (text !== 'dot') invalid();
    leaf(one(children[1], 'structure', ns), 'usersort', ns, { declaration: 'dot' });
    return;
  }
  const marking = tag === 'hlinitialMarking';
  const n = coefficient(children[1], marking, ns);
  if (text !== `${n}'dot`) invalid();
  const plain = Number(
    parent.getAttribute(marking ? 'initialMarking' : 'weight') ?? (marking ? '0' : '1'),
  );
  // In uncoloured native arcs the attribute drives execution. Native constructors/writer also
  // produce 1'dot for weighted arcs; accept that default as well as a matching coefficient.
  if (marking ? n !== plain : n < 1 || (n !== 1 && n !== plain)) invalid();
}

export function writeDotDependencies(root: Element): void {
  const document = root.ownerDocument;
  const make = (tag: string, attrs: Record<string, string> = {}, children: Element[] = []) => {
    const e = document.createElementNS(root.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
    e.append(...children);
    return e;
  };
  const text = (value: string) => {
    const e = make('text');
    e.textContent = value;
    return e;
  };
  const expression = (tag: string, n: number, marking: boolean) => {
    const numberof = make('numberof', {}, [
      make('subterm', {}, [make('numberconstant', { value: String(n) }, [make('positive')])]),
      make('subterm', {}, [
        marking ? make('dotconstant') : make('useroperator', { declaration: 'dot' }),
      ]),
    ]);
    return make(tag, {}, [
      text(`${n}'dot`),
      make('structure', {}, [
        marking ? make('add', {}, [make('subterm', {}, [numberof])]) : numberof,
      ]),
    ]);
  };
  root.prepend(
    make('declaration', {}, [
      make('structure', {}, [
        make('declarations', {}, [make('namedsort', { id: 'dot', name: 'dot' }, [make('dot')])]),
      ]),
    ]),
  );
  for (const net of Array.from(root.children).filter((e) => e.localName === 'net')) {
    for (const place of Array.from(net.children).filter((e) => e.localName === 'place')) {
      place.append(
        make('type', {}, [
          text('dot'),
          make('structure', {}, [make('usersort', { declaration: 'dot' })]),
        ]),
      );
      const n = Number(place.getAttribute('initialMarking'));
      // This is the expression synthesized by TapnXmlLoader for a plain marking > 1.
      if (n > 1) place.append(expression('hlinitialMarking', n, true));
    }
    for (const arc of Array.from(net.children).filter((e) => e.localName === 'arc'))
      arc.prepend(expression('hlinscription', Number(arc.getAttribute('weight') ?? '1'), false));
  }
}
