import { Component, computed, input, output } from '@angular/core';
import { ConstantDecl, Use } from './core/authored-model';
import { Network, constantUses, useLabel } from './editor-workspace';
@Component({
  selector: 'app-constants-pane',
  template: `<section aria-label="Constants">
    <header>
      <strong>Constants</strong
      ><button [disabled]="disabled()" (click)="edit.emit(null)">Add…</button>
    </header>
    @for (item of declarations(); track item.constant.id) {
      <details>
        <summary>{{ item.constant.name }} = {{ item.constant.value }}</summary>
        <div class="actions">
          <button [disabled]="disabled()" (click)="edit.emit(item.constant)">Edit…</button
          ><button [disabled]="disabled()" (click)="remove.emit(item.constant.id)">Delete</button>
        </div>
        @if (!item.groups.length) {
          <p>No model uses.</p>
        }
        @for (group of item.groups; track group.componentId) {
          <strong>{{ group.label }}</strong>
          <ul>
            @for (use of group.uses; track $index) {
              <li>
                <button (click)="navigate.emit(use)">{{ label(network(), use) }}</button>
              </li>
            }
          </ul>
        }
        @if (item.protected) {
          <p>
            Protected by saved queries. Rename and removal require the explicit Remove saved queries
            action. This is separate from model uses.
          </p>
        }
      </details>
    } @empty {
      <p>No declarations. Fields accept integers or a declared name.</p>
    }
  </section>`,
  styles: `
    section {
      padding: 12px 16px;
      border-bottom: 1px solid #ddd;
      font-size: 12px;
    }
    header,
    .actions {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    details {
      margin: 8px 0;
    }
    summary {
      cursor: pointer;
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    li button {
      text-align: left;
    }
    ul {
      padding-left: 16px;
    }
    p {
      color: #5c6974;
      line-height: 1.5;
    }
  `,
})
export class ConstantsPane {
  readonly network = input.required<Network>();
  readonly disabled = input(false);
  readonly edit = output<ConstantDecl | null>();
  readonly remove = output<string>();
  readonly navigate = output<Use>();
  readonly label = useLabel;
  readonly declarations = computed(() =>
    this.network().constants.map((constant) => {
      const uses = constantUses(this.network(), constant.id);
      return {
        constant,
        protected: uses.some((u) => u.field === 'saved-query-protection'),
        groups: [
          {
            componentId: 'shared-pools',
            label: 'Shared Places',
            uses: uses.filter((u) => u.poolId),
          },
          ...this.network()
            .components.map((c) => ({
              componentId: c.id,
              label: c.net.template + (c.active ? '' : ' (inactive)'),
              uses: uses.filter((u) => u.componentId === c.id),
            }))
            .filter((g) => g.uses.length),
        ],
      };
    }),
  );
}
