// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnnotationDialog } from './annotation-dialog';
import { ElementDialog } from './element-dialog';
beforeAll(() => TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
describe('annotation and layout dialogs', () => {
  it('isolates text, renders markup literally, owns Escape and traps focus', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AnnotationDialog),
      dialog = fixture.componentInstance;
    Object.assign(dialog, {
      text: signal('<img src=x onerror=bad()>'),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    document.body.append(fixture.nativeElement);
    vi.runAllTimers();
    expect(dialog.draft).toContain('<img');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    const cancelled = vi.fn();
    dialog.cancelled.subscribe(cancelled);
    dialog.draft = 'Changed';
    dialog.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toHaveBeenCalledOnce();
    expect(dialog.text()).toContain('<img');
    fixture.nativeElement.querySelectorAll('button')[1].focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    dialog.key(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    fixture.nativeElement.remove();
  });
  it('submits visibility and native rotation increment as one isolated node draft', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ElementDialog),
      dialog = fixture.componentInstance;
    const node = {
      id: 't',
      kind: 'transition' as const,
      name: 'T',
      x: 45,
      y: 45,
      tokens: 0,
      angle: 270,
    };
    Object.assign(dialog, {
      element: signal(node),
      form: () => new ElementRef(fixture.nativeElement.querySelector('form')),
    });
    fixture.detectChanges();
    vi.runAllTimers();
    expect(fixture.nativeElement.querySelectorAll('#dialog-rotation option')).toHaveLength(4);
    const saved = vi.fn();
    dialog.saved.subscribe(saved);
    dialog.draft.rotation = 135;
    dialog.draft.visible = false;
    dialog.submit();
    expect(saved).toHaveBeenCalledWith({ ...node, angle: 45, nameVisible: false });
    expect(node.angle).toBe(270);
  });
});
