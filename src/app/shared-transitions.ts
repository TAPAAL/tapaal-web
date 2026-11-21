import {
  Component,
  input,
  output,
  HostListener,
  AfterViewInit,
  ElementRef,
  viewChild,
  SimpleChanges,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharedSource, SharedEdit } from './core/authored-shared';
import { newId } from './core/ids';
export interface TransitionTarget {
  poolId?: string;
  componentId?: string;
  elementId?: string;
}
export interface TransitionDraft {
  action: string;
  name: string;
  urgent: boolean;
  actor?: 'controller' | 'environment';
  poolId: string;
  accept: boolean;
}
export function transitionPool(source: SharedSource, target: TransitionTarget) {
  const node = source.components
    .find((c) => c.id === target.componentId)
    ?.net.nodes.find((n) => n.id === target.elementId);
  return source.shared.transitions.find(
    (p) => p.id === (node && 'sharedId' in node ? node.sharedId : target.poolId),
  );
}
export function transitionDraft(source: SharedSource, target: TransitionTarget): TransitionDraft {
  const pool = transitionPool(source, target),
    c = source.components.find((c) => c.id === target.componentId),
    n = c?.net.nodes.find((n) => n.id === target.elementId);
  let name = pool?.name ?? (n && 'name' in n ? n.name : 'Sync');
  if (pool && n) {
    const taken = new Set(
      [...source.shared.places, ...source.shared.transitions]
        .map((p) => p.name)
        .concat(
          source.components.flatMap((c) =>
            c.net.nodes.flatMap((n) => ('name' in n ? [n.name] : [])),
          ),
        ),
    );
    name += '_local';
    while (taken.has(name)) name += '_';
  }
  return {
    action: n ? (pool ? 'detach' : 'create') : 'pool',
    name,
    urgent: pool?.urgent ?? c?.timing?.urgent.includes(n?.id ?? '') ?? false,
    actor: pool?.actor ?? (n && 'actor' in n ? n.actor : undefined) ?? 'controller',
    poolId: source.shared.transitions[0]?.id ?? '',
    accept: false,
  };
}
export function transitionCommand(
  source: SharedSource,
  target: TransitionTarget,
  d: TransitionDraft,
): SharedEdit {
  if (target.componentId && target.elementId) {
    const ref = { componentId: target.componentId, elementId: target.elementId };
    if (d.action === 'detach') return { kind: 'detach', ...ref, name: d.name.trim() };
    if (d.action === 'use')
      return { kind: 'usePool', ...ref, poolId: d.poolId, acceptPoolValues: d.accept };
    return { kind: 'makeShared', ...ref, poolId: newId(), name: d.name.trim() };
  }
  const pool = transitionPool(source, target);
  return {
    kind: pool ? 'editTransitionPool' : 'createTransitionPool',
    pool: {
      id: pool?.id ?? newId(),
      name: d.name.trim(),
      urgent: d.urgent,
      ...(source.type.game ? { actor: d.actor ?? 'controller' } : {}),
    },
  };
}
@Component({
  selector: 'app-shared-transitions-pane',
  template: `<section aria-label="Shared Transitions">
    <header>
      <strong>Shared Transitions</strong
      ><button [disabled]="disabled()" (click)="edit.emit({})">New…</button>
    </header>
    @for (p of source().shared.transitions; track p.id) {
      <details
        [open]="expanded().has(expansionKey(p.id))"
        (toggle)="rememberExpansion(p.id, $event)"
      >
        <summary>
          ◇ {{ p.name }} · {{ p.urgent ? 'urgent' : 'nonurgent' }}
          {{ source().type.game ? (p.actor === 'environment' ? 'Environment' : 'Controller') : '' }}
        </summary>
        <p>{{ active(p.id) }} active / {{ members(p.id).length }} total members</p>
        <button [disabled]="disabled()" (click)="edit.emit({ poolId: p.id })">Properties…</button>
        <button [disabled]="disabled() || members(p.id).length > 0" (click)="remove.emit(p.id)">
          Delete unused
        </button>
        @for (r of members(p.id); track r.componentId) {
          <button class="member" (click)="navigate.emit(r)">{{ r.label }}</button>
        }
      </details>
    } @empty {
      <p>Share a transition from its properties or create an unused pool.</p>
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
      border: 1px solid #bdc9d2;
      border-radius: 7px;
      background: #fff;
      padding: 5px 8px;
      margin: 3px;
      cursor: pointer;
    }
    .member {
      display: block;
    }
    p {
      color: #5c6974;
      line-height: 1.5;
    }
  `,
})
export class SharedTransitionsPane {
  readonly source = input.required<SharedSource>();
  readonly documentId = input('');
  readonly expanded = model<ReadonlySet<string>>(new Set());
  expansionKey(id: string) {
    return JSON.stringify([this.documentId(), id]);
  }
  rememberExpansion(id: string, event: Event) {
    const details = event.target as HTMLDetailsElement;
    if (!details.isConnected) return;
    const key = this.expansionKey(id);
    this.expanded.update((current) => {
      const next = new Set(current);
      if (details.open) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  readonly disabled = input(false);
  readonly edit = output<TransitionTarget>();
  readonly remove = output<string>();
  readonly navigate = output<{ componentId: string; elementId: string }>();
  members(id: string) {
    return this.source().components.flatMap((c) =>
      c.net.nodes
        .filter((n) => 'sharedId' in n && n.sharedId === id)
        .map((n) => ({
          componentId: c.id,
          elementId: n.id,
          label: c.net.template + (c.active ? '' : ' (inactive)'),
        })),
    );
  }
  active(id: string) {
    return this.members(id).filter(
      (r) => this.source().components.find((c) => c.id === r.componentId)!.active,
    ).length;
  }
}
@Component({
  selector: 'app-shared-transition-dialog',
  imports: [FormsModule],
  template: `<div class="backdrop">
    <form
      #form
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-title"
      (submit)="$event.preventDefault(); saved.emit(draft)"
    >
      <h2 id="sync-title">
        {{
          target().elementId
            ? pool()
              ? 'Shared transition occurrence'
              : 'Make transition shared'
            : 'Shared transition properties'
        }}
      </h2>
      @if (draft.action === 'pool') {
        @if (source().type.game) {
          <label
            >Player
            <select name="actor" [(ngModel)]="draft.actor">
              <option value="controller">Controller (controllable)</option>
              <option value="environment">Environment (uncontrollable)</option>
            </select></label
          >
        }
        <label>Name <input name="name" [(ngModel)]="draft.name" required /></label>
        <label
          ><input
            type="checkbox"
            name="urgent"
            [(ngModel)]="draft.urgent"
            [disabled]="!source().type.timed"
          />
          Urgent</label
        >
        <p>
          Urgency belongs to the pool and applies to all members, including inactive components.
        </p>
      } @else if (pool(); as p) {
        <p>
          {{ p.name }} · {{ p.urgent ? 'urgent' : 'nonurgent' }}
          {{
            source().type.game ? (p.actor === 'environment' ? 'Environment' : 'Controller') : ''
          }}. Detach copies source urgency{{ source().type.game ? ' and player' : '' }} and retains
          geometry and arcs.
        </p>
        <button type="button" (click)="editPool.emit({ poolId: p.id })">Edit global pool…</button>
        <label>Fresh local name <input name="name" [(ngModel)]="draft.name" required /></label>
      } @else {
        <label
          >Sharing action
          <select name="action" [(ngModel)]="draft.action">
            <option value="create">Create pool from this transition</option>
            <option value="use" [disabled]="!source().shared.transitions.length">
              Use existing pool
            </option>
          </select></label
        >
        @if (draft.action === 'create') {
          <label>Pool name <input name="name" [(ngModel)]="draft.name" required /></label>
          <p>Source urgency {{ draft.urgent ? 'urgent' : 'nonurgent' }} transfers to the pool.</p>
        } @else {
          <label
            >Pool
            <select name="pool" [(ngModel)]="draft.poolId" (ngModelChange)="draft.accept = false">
              @for (p of source().shared.transitions; track p.id) {
                <option [value]="p.id">
                  {{ p.name }} · {{ p.urgent ? 'urgent' : 'nonurgent' }}
                  {{
                    source().type.game
                      ? p.actor === 'environment'
                        ? 'Environment'
                        : 'Controller'
                      : ''
                  }}
                </option>
              }
            </select></label
          ><label
            ><input type="checkbox" name="accept" [(ngModel)]="draft.accept" /> Adopt this pool's
            {{
              source().type.game ? 'urgency and player if they differ' : 'urgency if it differs'
            }}</label
          >
        }
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <footer>
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button type="submit">{{ draft.action === 'detach' ? 'Detach as local' : 'OK' }}</button>
      </footer>
    </form>
  </div>`,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: #172b3c66;
      z-index: 1500;
      display: grid;
      place-items: center;
    }
    form {
      background: white;
      border-radius: 14px;
      padding: 24px;
      width: min(480px, 90vw);
      box-shadow: 0 12px 50px #15283755;
    }
    label {
      display: block;
      margin: 14px 0;
    }
    input,
    select,
    button {
      font: inherit;
      border: 1px solid #aab8c4;
      border-radius: 7px;
      padding: 7px;
    }
    input[type='checkbox'] {
      margin-right: 8px;
    }
    p {
      line-height: 1.5;
      color: #52616d;
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }
    [role='alert'] {
      color: #a82222;
    }
  `,
})
export class SharedTransitionDialog implements AfterViewInit {
  readonly source = input.required<SharedSource>();
  readonly target = input.required<TransitionTarget>();
  readonly error = input('');
  readonly saved = output<TransitionDraft>();
  readonly cancelled = output<void>();
  readonly editPool = output<TransitionTarget>();
  readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  draft!: TransitionDraft;
  ngOnChanges(changes: SimpleChanges) {
    if (!changes['target']) return;
    this.draft = transitionDraft(this.source(), this.target());
    setTimeout(() =>
      this.form()?.nativeElement.querySelector<HTMLElement>('input,select,button')?.focus(),
    );
  }
  pool() {
    return transitionPool(this.source(), this.target());
  }
  ngAfterViewInit() {
    setTimeout(() =>
      this.form()?.nativeElement.querySelector<HTMLElement>('input,select,button')?.focus(),
    );
  }
  @HostListener('keydown', ['$event']) key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancelled.emit();
    }
    if (e.key === 'Tab') {
      const fields = [
          ...(this.form()?.nativeElement.querySelectorAll<HTMLElement>(
            'input:not(:disabled),select:not(:disabled),button:not(:disabled)',
          ) ?? []),
        ],
        i = fields.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        fields.at(-1)?.focus();
      } else if (!e.shiftKey && i === fields.length - 1) {
        e.preventDefault();
        fields[0]?.focus();
      }
    }
  }
}
