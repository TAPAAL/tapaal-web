// @vitest-environment jsdom
import '@angular/compiler';
import { signal, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { SharedTransitionDialog, SharedTransitionsPane } from './shared-transitions';
import { SharedSource } from './core/authored-shared';
beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => TestBed.resetTestingModule());
it('keeps expanded transition pools through source edits and undo/redo', () => {
  const initial: SharedSource = {
    name: 'Model',
    type: { timed: false, colored: false, game: false, stochastic: false },
    constants: [],
    components: [],
    shared: { places: [], transitions: [{ id: 'sync', name: 'Sync', urgent: false }] },
  };
  const source = signal(initial);
  const fixture = TestBed.createComponent(SharedTransitionsPane);
  Object.assign(fixture.componentInstance, { source, documentId: signal('doc') });
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  try {
    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    source.set({ ...initial, shared: { places: [], transitions: [] } });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('details')).toBeNull();
    source.set(structuredClone(initial));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('details').open).toBe(true);
    source.set({
      ...initial,
      shared: { places: [], transitions: [{ ...initial.shared.transitions[0], urgent: true }] },
    });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('details').open).toBe(true);
  } finally {
    fixture.nativeElement.remove();
  }
});
it('keeps a rejected transition draft while updating its diagnostic', async () => {
  const source: SharedSource = {
    name: 'Model',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [],
    shared: { places: [], transitions: [] },
    components: [],
  };
  const fixture = TestBed.createComponent(SharedTransitionDialog);
  const error = signal('');
  Object.assign(fixture.componentInstance, { source: signal(source), target: signal({}), error });
  fixture.componentInstance.ngOnChanges({ target: new SimpleChange(undefined, {}, true) });
  fixture.detectChanges();
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector('input[name=name]') as HTMLInputElement;
  input.value = 'invalid name';
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
  error.set('Invalid global name.');
  fixture.componentInstance.ngOnChanges({ error: new SimpleChange('', error(), false) });
  fixture.detectChanges();
  expect(fixture.componentInstance.draft.name).toBe('invalid name');
  expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
    'Invalid global name.',
  );
  expect(fixture.nativeElement.querySelector('input[name=name]').value).toBe('invalid name');
});
