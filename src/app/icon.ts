import { Component, input } from '@angular/core';
@Component({
  selector: 'app-icon',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name()] || paths[\'circle\']" /></svg>',
  styles:
    ':host { display: inline-flex; width: 18px; height: 18px; flex-shrink: 0; } svg { width: 100%; height: 100%; }',
})
export class Icon {
  readonly name = input('circle');
  readonly paths: Record<string, string> = {
    'new-file': 'M5 3h9l5 5v13H5zM14 3v6h5',
    note: 'M4 3h16v18H4zM7 7h10M7 11h10M7 15h6',
    save: 'M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8',
    code: 'M8 5l-6 7 6 7M16 5l6 7-6 7',
    inhibitor: 'M3 19L17 5M21 5a3 3 0 11-6 0 3 3 0 016 0',
    close: 'M6 6l12 12M18 6L6 18',
    cursor: 'M5 3l14 10-7 1-3 7z',
    hand: 'M8 12V6a2 2 0 014 0v5-7a2 2 0 014 0v8-5a2 2 0 014 0v9c0 4-3 6-7 6-3 0-5-2-6-4l-3-5a2 2 0 013-2l1 1',
    circle: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0',
    transition: 'M8 3h8v18H8z',
    arrow: 'M4 19L20 5M10 5h10v10',
    undo: 'M8 4L3 9l5 5M3 9h11a7 7 0 017 7v3',
    redo: 'M16 4l5 5-5 5M21 9H10a7 7 0 00-7 7v3',
    download: 'M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5',
    chevron: 'M9 5l7 7-7 7',
    down: 'M5 9l7 7 7-7',
    plus: 'M12 4v16M4 12h16',
    minus: 'M4 12h16',
    fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    play: 'M7 4l14 8-14 8z',
    step: 'M4 4l12 8-12 8zM20 4v16',
    reset: 'M3 10a9 9 0 119 11M3 3v7h7',
    layers: 'M12 3l10 6-10 6L2 9zM2 14l10 6 10-6',
    folder: 'M3 7V4h7l3 3h8v13H3z',
    sliders: 'M5 3v18M12 3v18M19 3v18M2 8h6m1 8h6m1-9h6',
    server: 'M3 3h18v7H3zM3 14h18v7H3zM6 6h1m-1 11h1',
    monitor: 'M3 3h18v13H3zM8 21h8m-4-5v5',
    check: 'M5 12l4 4L20 5',
    trash: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    search: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0m-2 6l6 6',
    info: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0M12 11v6m0-10v1',
  };
}
