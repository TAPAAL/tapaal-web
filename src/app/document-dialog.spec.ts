// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DocumentDialog } from './document-dialog';

beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('document draft dialog', () => {
  function render(action: 'new' | 'copy' = 'new') {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(DocumentDialog);
    // Vitest loads plain TS without Angular's signal-input/query compiler transform.
    Object.assign(fixture.componentInstance, {
      action: signal(action),
      initial: signal({ name: 'Example', componentName: 'Net' }),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    vi.runAllTimers();
    return fixture;
  }
  it('shows only implemented model capability and submits an isolated trimmed draft', () => {
    const fixture = render();
    const dialog = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Timed P/T net');
    expect(fixture.nativeElement.querySelector('select')).not.toBeNull();
    const saved = vi.fn();
    dialog.saved.subscribe(saved);
    dialog.draft = { name: ' New title ', componentName: ' Worker ' };
    dialog.submit();
    expect(saved).toHaveBeenCalledWith({ name: 'New title', componentName: 'Worker' });
    expect(dialog.initial()).toEqual({ name: 'Example', componentName: 'Net' });
  });
  it('submits the timed choice through the actual form control', async () => {
    const fixture = render(),
      dialog = fixture.componentInstance,
      saved = vi.fn();
    dialog.saved.subscribe(saved);
    await fixture.whenStable();
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    dialog.submit();
    expect(saved).toHaveBeenCalledWith({ name: 'Example', componentName: 'Net', timed: true });
  });
  it('owns Escape and traps keyboard focus within the form', () => {
    const fixture = render('copy');
    const dialog = fixture.componentInstance;
    document.body.append(fixture.nativeElement);
    const cancelled = vi.fn();
    dialog.cancelled.subscribe(cancelled);
    const controls = Array.from(
      fixture.nativeElement.querySelectorAll('input,button'),
    ) as HTMLElement[];
    controls.at(-1)!.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    dialog.key(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    dialog.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toHaveBeenCalledOnce();
    fixture.nativeElement.remove();
  });
});
