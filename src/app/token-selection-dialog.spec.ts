// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenSelectionDialog } from './token-selection-dialog';
import { completeTokenSelection, initialTokenSelection, TokenInputChoice } from './token-selection';
beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  document.body.replaceChildren();
});
const inputs: TokenInputChoice[] = [
  {
    arcId: 'i',
    place: 'p',
    placeName: 'P',
    destination: 'q',
    destinationName: 'Q',
    weight: 2,
    tokens: [
      { id: 'secret-1', place: 'p', age: '2' },
      { id: 'secret-2', place: 'p', age: '2' },
      { id: 'secret-3', place: 'p', age: '3' },
    ],
  },
  {
    arcId: 'j',
    place: 'r',
    placeName: 'R',
    weight: 1,
    tokens: [{ id: 'other', place: 'r', age: '0' }],
  },
];
describe('manual token selection draft and dialog', () => {
  it('requires every exact weight, distinct eligible identities and no extra inputs', () => {
    const bindings = initialTokenSelection(inputs);
    expect(bindings).toEqual({ i: [], j: ['other'] });
    for (const i of [
      [],
      ['secret-1'],
      ['secret-1', 'secret-1'],
      ['secret-1', 'missing'],
      ['secret-1', 'secret-2', 'secret-3'],
    ])
      expect(completeTokenSelection(inputs, { ...bindings, i })).toBe(false);
    expect(completeTokenSelection(inputs, { i: ['secret-1', 'secret-2'], j: ['other'] })).toBe(
      true,
    );
    expect(
      completeTokenSelection(inputs, { i: ['secret-1', 'secret-2'], j: ['other'], extra: [] }),
    ).toBe(false);
  });
  it('renders equal-age choices separately, handles checkbox input, submits a detached draft and traps keyboard focus', () => {
    vi.useFakeTimers();
    const previous = document.createElement('button');
    document.body.append(previous);
    previous.focus();
    const fixture = TestBed.createComponent(TokenSelectionDialog),
      dialog = fixture.componentInstance;
    Object.assign(dialog, {
      inputs: signal(inputs),
      transition: signal('T'),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    document.body.append(fixture.nativeElement);
    vi.runAllTimers();
    const checkboxes = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    expect(document.activeElement).toBe(checkboxes[0]);
    expect(checkboxes.at(-1)!.disabled).toBe(true);
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      const selectAll = new KeyboardEvent('keydown', {
        key: 'a',
        ...modifiers,
        bubbles: true,
        cancelable: true,
      });
      checkboxes[0].dispatchEvent(selectAll);
      expect(selectAll.defaultPrevented).toBe(true);
    }
    expect(fixture.nativeElement.textContent).toContain('Token 1 · age 2');
    expect(fixture.nativeElement.textContent).toContain('Token 2 · age 2');
    expect(fixture.nativeElement.textContent).not.toContain('secret-');
    const saved = vi.fn(),
      cancelled = vi.fn();
    dialog.saved.subscribe(saved);
    dialog.cancelled.subscribe(cancelled);
    dialog.submit();
    expect(saved).not.toHaveBeenCalled();
    checkboxes[0].click();
    checkboxes[1].click();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons[1].disabled).toBe(false);
    buttons[1].focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    buttons[1].dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(checkboxes[0]);
    checkboxes[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saved).toHaveBeenCalledWith({ i: ['secret-1', 'secret-2'], j: ['other'] });
    dialog.toggle('i', 'secret-1', false);
    expect(saved.mock.calls[0][0].i).toHaveLength(2);
    const global = vi.fn();
    window.addEventListener('keydown', global);
    checkboxes[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(global).not.toHaveBeenCalled();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    checkboxes[0].dispatchEvent(escape);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
    window.removeEventListener('keydown', global);
    fixture.destroy();
    vi.runAllTimers();
    expect(document.activeElement).toBe(previous);
    expect(inputs[0].tokens).toHaveLength(3);
  });
  it('restores canvas focus when the opening control cannot take focus', () => {
    vi.useFakeTimers();
    const canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    canvas.setAttribute('class', 'net-canvas');
    canvas.setAttribute('tabindex', '0');
    const previous = document.createElement('button');
    document.body.append(canvas, previous);
    previous.focus();
    const fixture = TestBed.createComponent(TokenSelectionDialog);
    Object.assign(fixture.componentInstance, {
      inputs: signal(inputs),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    document.body.append(fixture.nativeElement);
    vi.runAllTimers();
    vi.spyOn(previous, 'focus').mockImplementation(() => {});
    fixture.destroy();
    vi.runAllTimers();
    expect(document.activeElement).toBe(canvas);
  });
  it('falls back after the parent removes a fired transition row during rendering', () => {
    vi.useFakeTimers();
    const canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    canvas.setAttribute('class', 'net-canvas');
    canvas.setAttribute('tabindex', '0');
    const row = document.createElement('button');
    row.className = 'enabled-row';
    document.body.append(canvas, row);
    row.focus();
    const fixture = TestBed.createComponent(TokenSelectionDialog);
    Object.assign(fixture.componentInstance, {
      inputs: signal(inputs),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    document.body.append(fixture.nativeElement);
    vi.runAllTimers();
    fixture.destroy();
    // The app finishes updating its enabled list after destroying the modal.
    row.remove();
    vi.runAllTimers();
    expect(document.activeElement).toBe(canvas);
  });
});
