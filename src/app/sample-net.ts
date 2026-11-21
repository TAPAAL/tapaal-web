import { Net } from './core/net';
export const DEMO_NET: Net = {
  name: 'Producer cycle',
  template: 'Producer',
  nodes: [
    { id: 'idle', kind: 'place', name: 'Idle', x: 160, y: 240, tokens: 1 },
    { id: 'start', kind: 'transition', name: 'Start', x: 320, y: 240, tokens: 0 },
    { id: 'busy', kind: 'place', name: 'Processing', x: 500, y: 240, tokens: 0 },
    { id: 'finish', kind: 'transition', name: 'Finish', x: 680, y: 240, tokens: 0 },
    { id: 'done', kind: 'place', name: 'Completed', x: 840, y: 240, tokens: 0 },
    { id: 'reset', kind: 'transition', name: 'Reset', x: 500, y: 380, tokens: 0 },
  ],
  arcs: [
    { id: 'a1', source: 'idle', target: 'start', kind: 'normal', weight: 1 },
    { id: 'a2', source: 'start', target: 'busy', kind: 'normal', weight: 1 },
    { id: 'a3', source: 'busy', target: 'finish', kind: 'normal', weight: 1 },
    { id: 'a4', source: 'finish', target: 'done', kind: 'normal', weight: 1 },
    { id: 'a5', source: 'done', target: 'reset', kind: 'normal', weight: 1 },
    { id: 'a6', source: 'reset', target: 'idle', kind: 'normal', weight: 1 },
  ],
};
