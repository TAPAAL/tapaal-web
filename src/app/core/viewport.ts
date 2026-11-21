export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Viewport extends Point {
  zoom: number;
}
export interface Bounds extends Point, Size {}

// pipe.gui.Constants and canvas/Zoomer.java.
export const MIN_ZOOM = 20;
export const MAX_ZOOM = 300;
export const ZOOM_STEP = 10;
// Grid starts at count 1, then cycles 2 -> 3 (off) -> 0 -> 1.
export const GRID_SPACINGS = [15, 30, 0, 7.5] as const;

export function visibleBounds(view: Viewport, size: Size): Bounds {
  return {
    x: view.x,
    y: view.y,
    width: (size.width * 100) / view.zoom,
    height: (size.height * 100) / view.zoom,
  };
}

export function zoomViewport(view: Viewport, percent: number): Viewport {
  if (!Number.isInteger(percent) || percent < MIN_ZOOM || percent > MAX_ZOOM) return view;
  // Native zoomTo sets the controller before zoomToMidPoint reads it. The
  // resulting anchor is the existing pixel scroll offset, not the pointer.
  return { x: (view.x * view.zoom) / percent, y: (view.y * view.zoom) / percent, zoom: percent };
}

export function panViewport(view: Viewport, pixels: Point): Viewport {
  return {
    ...view,
    x: Math.max(0, view.x + (pixels.x * 100) / view.zoom),
    y: Math.max(0, view.y + (pixels.y * 100) / view.zoom),
  };
}

export function wheelPixels(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>,
  size: Size,
): Point {
  const xUnit = event.deltaMode === 2 ? size.width : event.deltaMode === 1 ? 16 : 1;
  const yUnit = event.deltaMode === 2 ? size.height : event.deltaMode === 1 ? 16 : 1;
  // Some browsers already translate Shift+wheel to deltaX; don't translate twice.
  return event.shiftKey && event.deltaX === 0
    ? { x: event.deltaY * xUnit, y: 0 }
    : { x: event.deltaX * xUnit, y: event.deltaY * yUnit };
}

export function snapToGrid(value: number, spacing: number): number {
  // Grid.align returns an integer even for the 7.5-unit grid.
  return spacing > 0 ? Math.round(Math.round(value / spacing) * spacing) : Math.round(value);
}

// Native positions describe a 30-unit node's upper-left corner; the web model
// stores its center. Keep that conversion at the snapping boundary.
export function snapNodeCenter(value: number, spacing: number): number {
  return Math.max(15, snapToGrid(value - 15, spacing) + 15);
}

export function fitViewport(bounds: Bounds, size: Size): Viewport {
  const margin = 50;
  const left = Math.max(0, bounds.x - margin),
    top = Math.max(0, bounds.y - margin);
  const width = bounds.x + bounds.width + margin - left;
  const height = bounds.y + bounds.height + margin - top;
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, Math.floor(Math.min(size.width / width, size.height / height) * 100)),
  );
  return {
    // Keep native's leading pixel margin where it fits, without clipping the
    // trailing geometry when zoomed below 100%.
    x: Math.max(
      0,
      left - (margin * 100) / zoom,
      bounds.x + bounds.width - (size.width * 100) / zoom,
    ),
    y: Math.max(
      0,
      top - (margin * 100) / zoom,
      bounds.y + bounds.height - (size.height * 100) / zoom,
    ),
    zoom,
  };
}
