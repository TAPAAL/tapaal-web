import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  SimpleChanges,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharedSource } from './core/authored-shared';
import { invariantText } from './constants-editor';
import {
  SharedPlaceTarget,
  SharedPlaceDraft,
  sharedDraft,
  placePool,
  adoptionDiffers,
} from './shared-places';
@Component({
  selector: 'app-shared-place-dialog',
  imports: [FormsModule],
  template: `<div class="backdrop" (pointerdown)="$event.stopPropagation()">
    <form
      #form
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-title"
      (submit)="$event.preventDefault(); saved.emit(draft)"
    >
      <h2 id="shared-title">
        {{
          target().kind === 'pool'
            ? 'Shared place properties'
            : pool()
              ? 'Shared place occurrence'
              : 'Make place shared'
        }}
      </h2>
      @if (target().kind === 'pool') {
        <label>Name <input name="name" [(ngModel)]="draft.name" required /></label>
        <label
          >Initial marking
          <input name="tokens" type="number" min="0" step="1" [(ngModel)]="draft.tokens" required
        /></label>
        @if (source().type.timed) {
          <label>Invariant <input name="invariant" [(ngModel)]="draft.invariant" required /></label>
          <label>Initial ages <input name="ages" [(ngModel)]="draft.ages" /></label>
          <p>
            Use an integer or declared constant in the invariant. Comma-separated decimal ages;
            remaining tokens start at zero.
          </p>
        }
        <p>
          One pool owns these initial values for every occurrence, including inactive components.
          Unused pools remain in saves.
        </p>
      } @else if (pool(); as p) {
        <p>
          ◇ {{ p.name }} · initial marking {{ p.tokens }} · {{ invariant(p.timing?.invariant) }}.
          Values belong to the global pool.
        </p>
        <button type="button" (click)="editPool.emit(p.id)">Edit global pool…</button>
        <label>Fresh local name <input name="name" [(ngModel)]="draft.name" required /></label>
        <p>
          Detach copies the pool's AUTHORED initial marking {{ p.tokens }}, ages
          {{ p.timing?.ages?.join(', ') || '0' }} and invariant
          {{ invariant(p.timing?.invariant) }} to this local place. The pool and other occurrences
          remain. Runtime tokens are never copied.
        </p>
      } @else {
        <label
          >Sharing action
          <select name="action" [(ngModel)]="draft.action">
            <option value="create">Create pool from this place</option>
            <option value="use" [disabled]="!source().shared.places.length">
              Use existing pool
            </option>
          </select></label
        >
        @if (draft.action === 'create') {
          <label>Pool name <input name="name" [(ngModel)]="draft.name" required /></label>
          <p>
            The place's authored marking {{ draft.tokens }}, ages {{ draft.ages || '0' }} and
            invariant {{ draft.invariant }} become the pool's values. Local geometry and incident
            arcs stay here.
          </p>
        } @else {
          <label
            >Pool
            <select name="pool" [(ngModel)]="draft.poolId" (ngModelChange)="draft.accept = false">
              @for (p of source().shared.places; track p.id) {
                <option [value]="p.id">{{ p.name }}</option>
              }
            </select></label
          >
          @if (adopted(); as p) {
            <p>
              Local: {{ draft.tokens }} tokens · ages {{ draft.ages || '0' }} ·
              {{ draft.invariant }}.<br />Pool: {{ p.tokens }} tokens · ages
              {{ p.timing?.ages?.join(', ') || '0' }} · {{ invariant(p.timing?.invariant) }}.
            </p>
            <p>
              Joining adopts the pool values. Tokens are never summed. The local marking is
              replaced; undo restores it.
            </p>
            @if (differs()) {
              <label
                ><input type="checkbox" name="accept" [(ngModel)]="draft.accept" /> I accept
                replacing the local values with the pool values</label
              >
            }
          }
        }
      }
      @if (error()) {
        <p role="alert" class="error">{{ error() }}</p>
      }
      <footer>
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button type="submit" [disabled]="draft.action === 'use' && differs() && !draft.accept">
          {{ draft.action === 'detach' ? 'Detach as local' : 'OK' }}
        </button>
      </footer>
    </form>
  </div>`,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 125;
      background: #16253544;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    form {
      background: white;
      padding: 20px;
      width: min(440px, 90vw);
      max-height: 85vh;
      overflow: auto;
      display: grid;
      gap: 12px;
      color: #344454;
      font-size: 12px;
    }
    h2 {
      font-size: 16px;
      margin: 0;
    }
    label {
      display: grid;
      gap: 5px;
    }
    input,
    select,
    button {
      font: inherit;
      padding: 6px;
    }
    input[type='checkbox'] {
      justify-self: start;
    }
    p {
      line-height: 1.5;
      margin: 0;
    }
    footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .error {
      color: #a53232;
      white-space: pre-wrap;
    }
  `,
})
export class SharedPlaceDialog implements AfterViewInit {
  readonly source = input.required<SharedSource>();
  readonly target = input.required<SharedPlaceTarget>();
  readonly error = input('');
  readonly saved = output<SharedPlaceDraft>();
  readonly cancelled = output<void>();
  readonly editPool = output<string>();
  readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  draft!: SharedPlaceDraft;
  ngOnChanges(changes: SimpleChanges) {
    if (changes['target']) {
      this.draft = sharedDraft(this.source(), this.target());
      this.focusFirst();
    }
  }
  pool() {
    return placePool(this.source(), this.target());
  }
  adopted() {
    return this.source().shared.places.find((p) => p.id === this.draft.poolId);
  }
  differs() {
    return adoptionDiffers(this.source(), this.target(), this.draft.poolId);
  }
  invariant(value: Parameters<typeof invariantText>[1] | null) {
    return invariantText(this.source(), value ?? undefined);
  }
  ngAfterViewInit() {
    this.focusFirst();
  }
  private focusFirst() {
    setTimeout(() => {
      const field = this.form()?.nativeElement.querySelector<HTMLElement>('input,select,button');
      if (field?.isConnected) field.focus();
    });
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
    }
    if (event.key === 'Tab') {
      const fields = [
        ...(this.form()?.nativeElement.querySelectorAll<HTMLElement>(
          'input:not(:disabled),select:not(:disabled),button:not(:disabled)',
        ) ?? []),
      ];
      const i = fields.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && i <= 0) {
        event.preventDefault();
        fields.at(-1)?.focus();
      } else if (!event.shiftKey && i === fields.length - 1) {
        event.preventDefault();
        fields[0]?.focus();
      }
    }
  }
}
