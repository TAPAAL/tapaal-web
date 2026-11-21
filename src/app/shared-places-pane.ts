import { Component, input, output } from '@angular/core';
import { SharedSource } from './core/authored-shared';
import { invariantText } from './constants-editor';
import { isSharedOccurrence } from './editor-workspace';
@Component({
  selector: 'app-shared-places-pane',
  template: `<section aria-label="Shared Places">
    <header>
      <strong>Shared Places</strong
      ><button [disabled]="disabled()" (click)="edit.emit(undefined)">New…</button>
    </header>
    @for (pool of source().shared.places; track pool.id) {
      <details [open]="selected() === pool.id">
        <summary>◇ {{ pool.name }} · initial {{ pool.tokens }} · {{ invariant(pool) }}</summary>
        <p>
          {{ occurrences(pool.id).length }} occurrences · {{ activeCount(pool.id) }} active
          components
        </p>
        <button [disabled]="disabled()" (click)="edit.emit(pool.id)">Properties…</button>
        <button
          [disabled]="disabled() || occurrences(pool.id).length > 0"
          (click)="remove.emit(pool.id)"
        >
          Delete unused
        </button>
        @for (ref of occurrences(pool.id); track ref.componentId) {
          <button class="occurrence" (click)="navigate.emit(ref)">{{ ref.label }}</button>
        }
      </details>
    } @empty {
      <p>No shared places. Create an unused pool here or share a place from its properties.</p>
    }
  </section>`,
  styles: `
    section {
      padding: 12px 16px;
      border-bottom: 1px solid #ddd;
      font-size: 12px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    details {
      margin: 10px 0;
    }
    summary {
      cursor: pointer;
    }
    button {
      font: inherit;
      cursor: pointer;
      margin: 3px 3px 3px 0;
    }
    .occurrence {
      display: block;
      text-align: left;
    }
    p {
      color: #5c6974;
      line-height: 1.5;
    }
  `,
})
export class SharedPlacesPane {
  readonly source = input.required<SharedSource>();
  readonly selected = input<string>();
  readonly disabled = input(false);
  readonly edit = output<string | undefined>();
  readonly remove = output<string>();
  readonly navigate = output<{ componentId: string; elementId: string }>();
  invariant(pool: SharedSource['shared']['places'][number]) {
    return this.source().type.timed
      ? invariantText(this.source(), pool.timing?.invariant ?? undefined)
      : 'untimed';
  }
  occurrences(poolId: string) {
    return this.source().components.flatMap((c) =>
      c.net.nodes
        .filter((n) => isSharedOccurrence(n) && n.sharedId === poolId)
        .map((n) => ({
          componentId: c.id,
          elementId: n.id,
          label: c.net.template + (c.active ? '' : ' (inactive)'),
        })),
    );
  }
  activeCount(poolId: string) {
    return this.source().components.filter(
      (c) => c.active && c.net.nodes.some((n) => isSharedOccurrence(n) && n.sharedId === poolId),
    ).length;
  }
}
