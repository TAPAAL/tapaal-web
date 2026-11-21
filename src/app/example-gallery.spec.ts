// @vitest-environment jsdom
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { EXAMPLES } from './example-gallery';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const example = EXAMPLES.find((e) => e.label === 'home-construction')!;
const response = () => ({
  ok: true,
  text: async () => readFileSync('public/' + example.url, 'utf8'),
});
const app = () => {
  const a = new App();
  vi.spyOn(a, 'fit').mockImplementation(() => {});
  a.showExamples();
  return a;
};
it('closes command menus without collapsing component property sections', () => {
  const menu = document.createElement('details');
  menu.className = 'folded-menu';
  const section = document.createElement('details');
  menu.open = section.open = true;
  document.body.append(menu, section);
  try {
    new App().closeMenus();
    expect(menu.open).toBe(false);
    expect(section.open).toBe(true);
  } finally {
    menu.remove();
    section.remove();
  }
});
it('returns menu-launched gallery focus to the visible File summary after dismissal', () => {
  vi.useFakeTimers();
  const menu = document.createElement('details');
  menu.open = true;
  menu.innerHTML = '<summary tabindex="0">File</summary><button>Example nets</button>';
  document.body.append(menu);
  try {
    const trigger = menu.querySelector('button')!;
    trigger.focus();
    const a = new App();
    a.showExamples();
    menu.open = false;
    a.closeExamples();
    vi.runAllTimers();
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  } finally {
    menu.remove();
  }
});
it('opens original example in an independent tab through normal loading', async () => {
  const a = app(),
    original = a.workspace();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  await a.openExample(example);
  expect(a.workspace().documents.length).toBe(original.documents.length + 1);
  expect(a.workspace().documents[0].network).toEqual(original.documents[0].network);
  expect(a.workspace().documents[0].past).toEqual(original.documents[0].past);
  expect(a.workspace().documents[0].future).toEqual(original.documents[0].future);
  expect(a.galleryOpen()).toBe(false);
  expect(a.net().nodes.length).toBe(example.stats.places + example.stats.transitions);
});
it('refuses gated examples without fetching or changing workspace', async () => {
  const a = app(),
    original = a.workspace(),
    fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await a.openExample(EXAMPLES.find((e) => e.reason)!);
  expect(fetch).not.toHaveBeenCalled();
  expect(a.workspace()).toBe(original);
});
it('keeps gallery open on failed fetch with no partial document', async () => {
  const a = app(),
    original = a.workspace();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await a.openExample(example);
  expect(a.galleryError()).toContain('Could not load');
  expect(a.galleryOpen()).toBe(true);
  expect(a.workspace()).toBe(original);
});
it('ignores cancelled asynchronous loads', async () => {
  const a = app(),
    original = a.workspace();
  let finish!: (v: unknown) => void;
  vi.stubGlobal('fetch', () => new Promise((resolve) => (finish = resolve)));
  const loading = a.openExample(example);
  a.closeExamples();
  finish(response());
  await loading;
  expect(a.workspace()).toBe(original);
  expect(a.galleryLoading()).toBe(false);
});
it('rejects stale asynchronous loads without replacing edited workspace', async () => {
  const a = app();
  let finish!: (v: unknown) => void;
  vi.stubGlobal('fetch', () => new Promise((resolve) => (finish = resolve)));
  const loading = a.openExample(example);
  a.workspace.update((w) => ({ ...w }));
  const changed = a.workspace();
  finish(response());
  await loading;
  expect(a.workspace()).toBe(changed);
  expect(a.galleryOpen()).toBe(true);
  expect(a.galleryError()).toContain('workspace changed');
});

it('keeps malformed fetched examples out of the workspace', async () => {
  const a = app(),
    original = a.workspace();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<broken>' }));
  await a.openExample(example);
  expect(a.workspace()).toBe(original);
  expect(a.galleryOpen()).toBe(true);
  expect(a.galleryError()).not.toBe('');
});
it('opens every advertised supported original through the normal warning and document pipeline', async () => {
  const a = app();
  for (const entry of EXAMPLES.filter((e) => !e.reason)) {
    a.showExamples();
    const count = a.workspace().documents.length;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => readFileSync('public/' + entry.url, 'utf8'),
      }),
    );
    await a.openExample(entry);
    if (a.pending()) a.acceptPending();
    expect(a.galleryError(), entry.filename).toBe('');
    expect(a.error(), entry.filename).toBe('');
    expect(a.workspace().documents.length, entry.filename).toBe(count + 1);
  }
});
