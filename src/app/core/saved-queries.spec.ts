// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as d from './documents';
import * as f from './network-files';
import { captureSavedQueries, parseSavedQuery } from './saved-queries';
const fixture = (name = 'two-phase-locking') =>
  f.parseNetworkTapn(readFileSync(`public/examples/${name}.tapn`, 'utf8'), `${name}.tapn`).network;

describe('opaque saved queries', () => {
  for (const name of ['two-phase-locking', 'home-construction'])
    it(`preserves real ${name} CTL/LTL queries and options in both formats`, () => {
      const network = fixture(name);
      expect(network.savedQueries!.xml.length).toBeGreaterThan(0);
      expect(network.savedQueries!.xml.join('')).toContain('type="LTL"');
      expect(network.savedQueries!.xml.join('')).toContain('searchOption=');
      const reopened = f.parseNetworkTapn(f.serializeNetworkTapn(network)).network;
      expect(reopened).toEqual(network);
      expect(f.parseNetworkJson(f.serializeNetworkJson(network)).network).toEqual(network);
      const c = reopened.components[0];
      expect(() => d.renameComponent(d.openNetworkDocument(reopened), c.id, 'Other')).toThrow(
        /Saved queries protect/,
      );
    });
  it('preserves legacy string formulas, nested options, comments and escaped text', () => {
    const network = d.createDocument({ name: 'Model' }).network;
    const xml =
      '<query name="Q &amp; R" query="EF Net.P &gt; 0"><options><future value="&lt;x&gt;"/><!-- note --></options></query>';
    const withQueries = { ...network, savedQueries: captureSavedQueries(network, [xml]) };
    expect(f.parseNetworkJson(f.serializeNetworkJson(withQueries)).network).toEqual(withQueries);
    const reopened = f.parseNetworkTapn(f.serializeNetworkTapn(withQueries)).network;
    expect(parseSavedQuery(reopened.savedQueries!.xml[0]).getAttribute('query')).toBe(
      'EF Net.P > 0',
    );
  });
  it('keeps query metadata through edits, copy, title, undo and redo; blocks protected symbols atomically', () => {
    const original = d.openNetworkDocument(fixture(), { saved: true });
    const id = original.session.componentId;
    const net = d.activeNet(original);
    net.nodes[0].x += 10;
    net.nodes.find((n) => n.kind === 'place')!.tokens += 1;
    net.arcs[0].weight += 1;
    const edited = d.commitComponentNet(original, net);
    expect(edited.network.savedQueries).toEqual(original.network.savedQueries);
    expect(d.undoDocument(edited).network).toEqual(original.network);
    expect(d.redoDocument(d.undoDocument(edited)).network).toEqual(edited.network);
    let copy = d.copyComponent(edited, id, 'Copy');
    copy = d.renameDocument(copy, 'New title');
    expect(copy.network.savedQueries).toEqual(original.network.savedQueries);
    expect(() => d.removeComponent(copy, id)).toThrow(/Saved queries protect/);
    expect(() => d.renameComponent(copy, id, 'Renamed')).toThrow(/Saved queries protect/);
    for (const action of ['rename', 'delete', 'id', 'kind']) {
      const changed = d.activeNet(original);
      if (action === 'rename') changed.nodes[0].name = 'Renamed';
      if (action === 'id') {
        changed.nodes[0].id = 'newId';
        changed.arcs = [];
      }
      if (action === 'kind') {
        changed.nodes[0].kind = 'transition';
        changed.nodes[0].tokens = 0;
        changed.arcs = [];
      }
      if (action === 'delete') {
        changed.nodes.shift();
        changed.arcs = [];
      }
      expect(() => d.commitComponentNet(original, changed)).toThrow(/Saved queries protect/);
    }
    expect(d.isDirty(original)).toBe(false);
    expect(original.past).toHaveLength(0);
    const added = d.activeNet(original);
    added.nodes.push({ id: 'new', name: 'New', kind: 'place', x: 0, y: 0, tokens: 0 });
    expect(d.commitComponentNet(original, added).network.savedQueries).toEqual(
      original.network.savedQueries,
    );
    expect(
      f.parseNetworkTapn(f.serializeNetworkTapn(copy.network)).network.savedQueries!
        .protectedComponents,
    ).toHaveLength(2);
  });
  it('requires explicit query removal and restores protections with undo', () => {
    const doc = d.openNetworkDocument(fixture());
    const { savedQueries: _queries, ...bare } = doc.network;
    expect(() => d.commitNetwork(doc, bare)).toThrow(/removeSavedQueries/);
    expect(() => d.legacyNetFromNetwork(doc.network)).toThrow(/lose saved queries/);
    const removed = d.removeSavedQueries(doc);
    expect(removed.past).toHaveLength(1);
    expect(removed.network.savedQueries).toBeUndefined();
    expect(
      d.renameComponent(removed, removed.session.componentId, 'Renamed').network.components[0].net
        .template,
    ).toBe('Renamed');
    expect(d.undoDocument(removed).network).toEqual(doc.network);
    expect(d.redoDocument(d.undoDocument(removed)).network).toEqual(removed.network);
    const forged = structuredClone(doc.network);
    (forged.savedQueries!.protectedComponents[0].nodes as unknown[]).splice(0);
    expect(() => d.commitNetwork(doc, forged)).toThrow(/retained/);
  });
  it('rejects malformed, oversized and foreign XML/JSON metadata', () => {
    const base = fixture();
    const variants: unknown[] = [
      null,
      {},
      { xml: [], protectedComponents: [] },
      { ...base.savedQueries, xml: [3] },
      { ...base.savedQueries, extra: true },
      { ...base.savedQueries, protectedComponents: [] },
      { ...base.savedQueries, protectedComponents: [{ id: 2, name: 'N', nodes: [] }] },
      { ...base.savedQueries, xml: Array(1001).fill('<query/>') },
      { ...base.savedQueries, xml: ['<query>' + 'x'.repeat(4_000_000) + '</query>'] },
    ];
    for (const xml of [
      '<query/><net/>',
      '&lt;query/&gt;',
      '<query><?hack x?></query>',
      '<!DOCTYPE query><query/>',
      '<!ENTITY x "y"><query/>',
      '<query><net/></query>',
      '<query><constant/></query>',
      '<query xmlns="urn:evil"/>',
      '<query><formula xmlns="urn:evil"/></query>',
      '<query><place id="P"/></query>',
      '<query>' + '<x>'.repeat(130) + '</x>'.repeat(130) + '</query>',
    ])
      variants.push({ ...base.savedQueries, xml: [xml] });
    for (const savedQueries of variants)
      expect(() =>
        f.parseNetworkJson(
          JSON.stringify({
            format: f.NETWORK_JSON_FORMAT,
            version: 1,
            network: { ...base, savedQueries },
          }),
        ),
      ).toThrow();
  });
});
