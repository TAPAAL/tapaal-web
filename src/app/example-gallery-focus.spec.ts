// @vitest-environment jsdom
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { ElementRef, signal, ɵresolveComponentResources } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ExampleGallery, EXAMPLES } from './example-gallery';

beforeAll(async () => {
  await ɵresolveComponentResources(async (file) =>
    readFileSync(new URL(file, import.meta.url), 'utf8'),
  );
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});
afterEach(() => TestBed.resetTestingModule());

it('keeps focus on search while Open becomes disabled, including a failed fetch', () => {
  const fixture = TestBed.createComponent(ExampleGallery);
  const loading = signal(false),
    error = signal('');
  Object.assign(fixture.componentInstance, {
    loading,
    error,
    panel: () => new ElementRef(fixture.nativeElement.querySelector('section')),
  });
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  try {
    const search = fixture.nativeElement.querySelector('input');
    const button = fixture.nativeElement.querySelector(
      'button[aria-label="Open home-construction"]',
    );
    fixture.componentInstance.selected.subscribe(() => {
      loading.set(true);
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(document.activeElement).toBe(search);
    });
    button.focus();
    button.click();
    expect(button.disabled).toBe(true);
    loading.set(false);
    error.set('Could not load example.');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(document.activeElement).toBe(search);
    const cancelled: void[] = [];
    fixture.componentInstance.cancelled.subscribe((value) => cancelled.push(value));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toHaveLength(1);
  } finally {
    fixture.nativeElement.remove();
  }
});

it('labels raw XML node statistics as occurrences', () => {
  const fixture = TestBed.createComponent(ExampleGallery);
  Object.assign(fixture.componentInstance, {
    panel: () => new ElementRef(fixture.nativeElement.querySelector('section')),
  });
  fixture.componentInstance.search = 'alternating-bit-protocol-components';
  fixture.detectChanges();
  const text = fixture.nativeElement.querySelector('article button').title;
  const entry = EXAMPLES.find((e) => e.label === 'alternating-bit-protocol-components')!;
  expect(text).toContain(`${entry.stats.places} place occurrences`);
  expect(text).toContain(`${entry.stats.transitions} transition occurrences`);
});

it('finds and identifies examples with synchronized transitions', () => {
  const fixture = TestBed.createComponent(ExampleGallery);
  Object.assign(fixture.componentInstance, {
    panel: () => new ElementRef(fixture.nativeElement.querySelector('section')),
  });
  fixture.componentInstance.search = 'shared transitions';
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Train level crossing');
  expect(fixture.nativeElement.querySelector('article').textContent).toContain(
    'Shared transitions',
  );
});
