import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  completeTokenSelection,
  initialTokenSelection,
  TokenBindings,
  TokenInputChoice,
} from './token-selection';

@Component({
  selector: 'app-token-selection-dialog',
  template: `<div class="backdrop">
    <form
      #form
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-selection-title"
      (submit)="$event.preventDefault(); submit()"
    >
      <h2 id="token-selection-title">Select tokens for {{ transition() }}</h2>
      <p>
        Choose exactly the required number for every input. Token numbers distinguish equal ages
        within this draft.
      </p>
      @for (input of inputs(); track input.arcId) {
        <fieldset>
          <legend>
            {{ input.placeName }} → {{ transition() }}
            @if (input.destinationName) {
              → {{ input.destinationName }} (transport)
            }
          </legend>
          <p aria-live="polite">
            Selected {{ bindings[input.arcId].length }} of {{ input.weight }} required
          </p>
          @for (token of input.tokens; track token.id; let index = $index) {
            <label
              ><input
                type="checkbox"
                [disabled]="input.tokens.length === input.weight"
                [checked]="bindings[input.arcId].includes(token.id)"
                (change)="toggle(input.arcId, token.id, $any($event.target).checked)"
              />
              Token {{ index + 1 }} · age {{ token.age }}</label
            >
          }
        </fieldset>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <footer>
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button type="submit" [disabled]="!complete()">Fire</button>
      </footer>
    </form>
  </div>`,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 120;
      background: #16253566;
      display: grid;
      place-items: center;
    }
    form {
      box-sizing: border-box;
      width: min(560px, 95vw);
      max-height: 90vh;
      overflow: auto;
      background: white;
      border: 1px solid #bdc7d0;
      padding: 20px;
      color: #344454;
      font: 13px Arial;
    }
    h2 {
      margin-top: 0;
      font-size: 17px;
    }
    fieldset {
      margin: 12px 0;
      border: 1px solid #bdc7d0;
    }
    label {
      display: block;
      padding: 5px;
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    button {
      padding: 6px 18px;
    }
    [role='alert'] {
      color: #a53232;
    }
    :focus-visible {
      outline: 2px solid #256799;
      outline-offset: 2px;
    }
  `,
})
export class TokenSelectionDialog implements AfterViewInit, OnDestroy {
  readonly inputs = input.required<readonly TokenInputChoice[]>();
  readonly transition = input('');
  readonly error = input('');
  readonly saved = output<TokenBindings>();
  readonly cancelled = output<void>();
  readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  bindings: TokenBindings = {};
  private previousFocus = document.activeElement as HTMLElement | null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnInit() {
    this.bindings = initialTokenSelection(this.inputs());
  }
  ngAfterViewInit() {
    this.focusTimer = setTimeout(() => this.controls()[0]?.focus());
  }
  ngOnDestroy() {
    clearTimeout(this.focusTimer);
    const closingForm = this.form().nativeElement;
    // A successful Fire can remove the opening row in the parent's remaining render.
    // Restore only after that render, and never steal focus from a newer dialog.
    setTimeout(() => {
      if (
        [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(
          (dialog) => dialog !== closingForm,
        )
      )
        return;
      if (this.previousFocus?.isConnected) this.previousFocus.focus();
      if (
        !this.previousFocus ||
        this.previousFocus === document.body ||
        document.activeElement !== this.previousFocus
      )
        document.querySelector<SVGSVGElement>('svg.net-canvas')?.focus();
    });
  }
  toggle(arc: string, id: string, checked: boolean) {
    this.bindings = {
      ...this.bindings,
      [arc]: checked
        ? [...new Set([...this.bindings[arc], id])]
        : this.bindings[arc].filter((value) => value !== id),
    };
  }
  complete() {
    return completeTokenSelection(this.inputs(), this.bindings);
  }
  submit() {
    if (this.complete()) this.saved.emit(structuredClone(this.bindings));
  }
  private controls() {
    return [
      ...this.form().nativeElement.querySelectorAll<HTMLElement>(
        'input:not(:disabled),button:not(:disabled)',
      ),
    ];
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    event.stopPropagation();
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a' &&
      !(event.target as Element).closest(
        'textarea,input:not([type="checkbox"]):not([type="radio"]),[contenteditable]:not([contenteditable="false"])',
      )
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelled.emit();
    }
    if (event.key === 'Tab') {
      const fields = this.controls(),
        index = fields.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        fields.at(-1)?.focus();
      } else if (!event.shiftKey && (index < 0 || index === fields.length - 1)) {
        event.preventDefault();
        fields[0]?.focus();
      }
    }
  }
}
