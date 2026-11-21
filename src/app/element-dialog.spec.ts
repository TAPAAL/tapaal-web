// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ElementDialog } from './element-dialog';
import { TimingDraft } from './timed-ui';
import { NetNode, Arc } from './core/net';

beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
describe('timed element dialog', () => {
  const timing: TimingDraft = {
    invariant: '<= 5',
    ages: '0.1, 2.50',
    urgent: false,
    interval: '(1,5]',
    outputArc: '',
  };
  async function render(element: NetNode | Arc, canInhibit = false) {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ElementDialog);
    Object.assign(fixture.componentInstance, {
      element: signal(element),
      timing: signal(timing),
      canInhibit: signal(canInhibit),
      transportOutputs: signal([{ id: 'o', label: 'Destination' }]),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    vi.runAllTimers();
    return fixture;
  }
  it('edits invariant and exact ages with marking in an isolated atomic draft', async () => {
    const node: NetNode = { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 100, y: 100 };
    const fixture = await render(node),
      dialog = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('#dialog-invariant')).not.toBeNull();
    const input = fixture.nativeElement.querySelector('#dialog-ages') as HTMLInputElement;
    input.value = '0.3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    const saved = vi.fn(),
      legacy = vi.fn();
    dialog.timedSaved.subscribe(saved);
    dialog.saved.subscribe(legacy);
    dialog.draft.tokens = 1;
    dialog.submit();
    expect(saved).toHaveBeenCalledWith({
      element: { ...node, tokens: 1 },
      timing: { ...timing, ages: '0.3' },
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(timing.ages).toBe('0.1, 2.50');
    expect(node.tokens).toBe(2);
  });
  it('exposes urgency with native restrictions and submits it', async () => {
    const fixture = await render({
      id: 't',
      name: 'T',
      kind: 'transition',
      tokens: 0,
      x: 200,
      y: 100,
    });
    const dialog = fixture.componentInstance,
      saved = vi.fn();
    dialog.timedSaved.subscribe(saved);
    const input = fixture.nativeElement.querySelector('#dialog-urgent') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    dialog.submit();
    expect(saved.mock.calls[0][0].timing.urgent).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('blocks positive delay');
  });
  it('exposes paired output choices and input intervals, with manual limits explicit', async () => {
    const fixture = await render(
      { id: 'i', source: 'p', target: 't', kind: 'normal', weight: 1 },
      true,
    );
    expect(fixture.nativeElement.querySelector('#dialog-interval').value).toBe('(1,5]');
    expect(fixture.nativeElement.querySelectorAll('#dialog-transport option')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('both routes stay intact');
    const dialog = fixture.componentInstance,
      saved = vi.fn();
    dialog.timedSaved.subscribe(saved);
    dialog.timingFields.outputArc = 'o';
    dialog.submit();
    expect(saved.mock.calls[0][0].timing.outputArc).toBe('o');
    expect(timing.outputArc).toBe('');
  });
});
