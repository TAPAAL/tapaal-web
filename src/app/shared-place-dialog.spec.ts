// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SharedPlaceDialog } from './shared-place-dialog';
import { SharedPlacesPane } from './shared-places-pane';
import * as w from './editor-workspace';
beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
function source() {
  let doc = w.createTimedDocument({ name: 'Test' });
  doc = w.commitComponentNet(doc, {
    ...w.activeNet(doc),
    nodes: [{ id: 'p', kind: 'place', name: 'P', tokens: 1, x: 90, y: 90 }],
  });
  doc = w.sharedTransact(doc, {
    kind: 'createPool',
    pool: { id: 'pool', name: 'Global', tokens: 2, timing: { ages: ['1'], invariant: null } },
  });
  return doc.network;
}
async function render() {
  const fixture = TestBed.createComponent(SharedPlaceDialog),
    network = source();
  Object.assign(fixture.componentInstance, {
    source: signal(network),
    target: signal({ kind: 'place', componentId: network.components[0].id, elementId: 'p' }),
    form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
  });
  fixture.componentInstance.ngOnChanges({ target: {} as any });
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  return fixture;
}
describe('shared place dialog and pane', () => {
  it('isolates drafts, gates different adoption and resets consent when pool changes', async () => {
    const fixture = await render(),
      component = fixture.componentInstance,
      source = component.source();
    const action = fixture.nativeElement.querySelector('select[name=action]') as HTMLSelectElement;
    action.value = 'use';
    action.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    component.draft.poolId = 'pool';
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type=submit]').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Local: 1 tokens');
    const consent = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type=submit]').disabled).toBe(false);
    const select = fixture.nativeElement.querySelector('select[name=pool]') as HTMLSelectElement;
    select.dispatchEvent(new Event('change'));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.draft.accept).toBe(false);
    expect(source.shared.places[0].tokens).toBe(2);
  });
  it('focuses the first field, traps Tab, closes on Escape and resets a changed target', async () => {
    const fixture = await render(),
      component = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    const fields = [...fixture.nativeElement.querySelectorAll('input,select,button')].filter(
      (e: any) => !e.disabled,
    ) as HTMLElement[];
    fields.at(-1)!.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    component.key(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fields[0]);
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    component.key(escape);
    expect(cancelled).toHaveBeenCalledOnce();
    Object.assign(component, { target: signal({ kind: 'pool', poolId: 'pool' }) });
    component.ngOnChanges({ target: {} as any });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.draft.name).toBe('Global');
    expect(component.draft.action).toBe('pool');
    fixture.nativeElement.remove();
  });
  it('lists unused pools without fake component locations and renders occurrence counts and navigation', () => {
    let network = source();
    let doc = w.openNetworkDocument(network, { timed: true });
    doc = w.sharedTransact(doc, {
      kind: 'usePool',
      componentId: doc.session.componentId,
      elementId: 'p',
      poolId: 'pool',
      acceptPoolValues: true,
    });
    doc = w.copyComponent(doc, doc.session.componentId, 'Copy');
    doc = w.setComponentActive(doc, doc.session.componentId, false);
    const fixture = TestBed.createComponent(SharedPlacesPane);
    Object.assign(fixture.componentInstance, { source: signal(doc.network) });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 occurrences · 1 active components');
    expect(fixture.nativeElement.querySelector('summary').textContent).toContain('initial 2');
    const target = fixture.nativeElement.querySelector('button.occurrence') as HTMLButtonElement;
    const navigate = vi.fn();
    fixture.componentInstance.navigate.subscribe(navigate);
    target.click();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: doc.network.components[0].id, elementId: 'p' }),
    );
    expect(fixture.nativeElement.querySelectorAll('button')[2].disabled).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('pool /');
  });
});
