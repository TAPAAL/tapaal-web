import { describe, expect, it } from 'vitest';
import {
  GRID_SPACINGS,
  fitViewport,
  panViewport,
  snapToGrid,
  snapNodeCenter,
  visibleBounds,
  wheelPixels,
  zoomViewport,
} from './viewport';

describe('native canvas viewport', () => {
  it('uses a CSS pixel per model unit at 100%, independent of canvas width', () => {
    expect(visibleBounds({ x: 30, y: 40, zoom: 100 }, { width: 743, height: 426 })).toEqual({
      x: 30,
      y: 40,
      width: 743,
      height: 426,
    });
    expect(visibleBounds({ x: 0, y: 0, zoom: 200 }, { width: 743, height: 426 })).toEqual({
      x: 0,
      y: 0,
      width: 371.5,
      height: 213,
    });
  });
  it('preserves native pixel scroll offsets when the controller changes zoom', () => {
    const result = zoomViewport({ x: 100, y: 60, zoom: 100 }, 200);
    expect(result).toEqual({ x: 50, y: 30, zoom: 200 });
    expect((result.x * result.zoom) / 100).toBe(100);
  });
  it('rejects zoom steps outside native bounds, including partial overshoots', () => {
    const view = { x: 0, y: 0, zoom: 295 };
    expect(zoomViewport(view, 305)).toBe(view);
    for (const zoom of [19, 301, NaN, 20.5]) expect(zoomViewport(view, zoom)).toBe(view);
    expect(zoomViewport(view, 20).zoom).toBe(20);
    expect(zoomViewport(view, 300).zoom).toBe(300);
  });
  it('converts scroll pixels at the current scale and prevents negative scroll positions', () => {
    expect(panViewport({ x: 10, y: 20, zoom: 200 }, { x: 40, y: -80 })).toEqual({
      x: 30,
      y: 0,
      zoom: 200,
    });
  });
  it('normalizes wheel units and supports both forms of horizontal scrolling', () => {
    const size = { width: 800, height: 400 };
    expect(wheelPixels({ deltaX: 2, deltaY: 3, deltaMode: 0, shiftKey: false }, size)).toEqual({
      x: 2,
      y: 3,
    });
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true }, size)).toEqual({
      x: 48,
      y: 0,
    });
    expect(wheelPixels({ deltaX: 48, deltaY: 0, deltaMode: 0, shiftKey: true }, size)).toEqual({
      x: 48,
      y: 0,
    });
    expect(wheelPixels({ deltaX: 1, deltaY: 1, deltaMode: 2, shiftKey: false }, size)).toEqual({
      x: 800,
      y: 400,
    });
  });
  it('fits with native margin and bounds, including very large or small models', () => {
    const size = { width: 800, height: 400 };
    const bounds = { x: 100, y: 100, width: 300, height: 100 };
    const view = fitViewport(bounds, size),
      visible = visibleBounds(view, size);
    expect(view.zoom).toBe(200);
    expect(visible.x).toBeLessThanOrEqual(bounds.x);
    expect(visible.y).toBeLessThanOrEqual(bounds.y);
    expect(visible.x + visible.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(visible.y + visible.height).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    expect(fitViewport({ x: 0, y: 0, width: 10000, height: 10000 }, size).zoom).toBe(20);
    expect(fitViewport({ x: 0, y: 0, width: 1, height: 1 }, size).zoom).toBe(300);
  });
  it('snaps with the native grid sequence, including fractional spacing and off', () => {
    expect(GRID_SPACINGS).toEqual([15, 30, 0, 7.5]);
    expect(GRID_SPACINGS.map((spacing) => snapToGrid(113, spacing))).toEqual([120, 120, 113, 113]);
    expect(snapNodeCenter(113, 30)).toBe(105);
    expect(snapNodeCenter(157, 30)).toBe(165);
    expect(snapNodeCenter(113, 0)).toBe(113);
    expect(snapNodeCenter(262, 7.5)).toBe(263);
    expect(snapNodeCenter(212.4, 0)).toBe(212);
    expect(snapToGrid(22, 7.5)).toBe(23);
  });
  it('does not clip trailing geometry when fitting a distant model below 100%', () => {
    const bounds = { x: 2000, y: 3000, width: 1400, height: 600 };
    const size = { width: 800, height: 400 };
    const visible = visibleBounds(fitViewport(bounds, size), size);
    expect(visible.x).toBeLessThanOrEqual(bounds.x);
    expect(visible.y).toBeLessThanOrEqual(bounds.y);
    expect(visible.x + visible.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(visible.y + visible.height).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  });
});
