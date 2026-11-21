import {
  AfterViewInit,
  OnInit,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface DocumentDraft {
  name: string;
  componentName: string;
  timed?: boolean;
  game?: boolean;
}

@Component({
  selector: 'app-document-dialog',
  imports: [FormsModule],
  template: `<div class="backdrop">
    <form
      #form
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-dialog-title"
      (submit)="$event.preventDefault(); submit()"
    >
      <h2 id="document-dialog-title">
        {{
          action() === 'new'
            ? 'New model'
            : action() === 'add'
              ? 'Add component'
              : action() === 'copy'
                ? 'Copy component'
                : 'Rename component'
        }}
      </h2>
      @if (action() === 'new') {
        <label for="new-model-name">Model name</label
        ><input
          id="new-model-name"
          name="modelName"
          [(ngModel)]="draft.name"
          required
          maxlength="200"
        />
        <label for="new-model-type">Timing</label>
        <select id="new-model-type" name="timed" [(ngModel)]="draft.timed">
          <option [ngValue]="false">Untimed P/T net</option>
          <option [ngValue]="true">Timed P/T net</option>
        </select>
        <label for="new-game">Players</label>
        <select id="new-game" name="game" [(ngModel)]="draft.game">
          <option [ngValue]="false">P/T net</option>
          <option [ngValue]="true">P/T game — Controller and Environment</option>
        </select>
        <p>
          Uncoloured P/T nets support shared places and synchronized transitions. Timed components
          execute with one global clock. Games support manual exploration; strategy
          synthesis/verification is unavailable. Coloured and stochastic models are refused.
        </p>
      }
      <label for="new-component-name">Component name</label
      ><input
        id="new-component-name"
        name="componentName"
        [(ngModel)]="draft.componentName"
        required
      />
      <p>Use letters, digits and underscores; start with a letter or underscore.</p>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <div class="actions">
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button type="submit">{{ action() === 'new' ? 'Create' : 'Apply' }}</button>
      </div>
    </form>
  </div>`,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }
    .backdrop {
      display: grid;
      place-items: center;
      height: 100%;
      background: #0006;
    }
    form {
      width: min(440px, 90vw);
      padding: 24px;
      background: #fff;
      border: 1px solid #aaa;
      box-shadow: 0 8px 40px #0004;
      color: #222;
    }
    h2 {
      margin-top: 0;
      font-size: 20px;
    }
    label {
      display: block;
      margin: 12px 0 5px;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      padding: 8px;
    }
    p {
      font-size: 13px;
      line-height: 1.5;
      color: #555;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }
    button {
      padding: 7px 16px;
      cursor: pointer;
    }
  `,
})
export class DocumentDialog implements AfterViewInit, OnInit {
  readonly action = input.required<'new' | 'add' | 'copy' | 'rename'>();
  readonly initial = input.required<DocumentDraft>();
  readonly error = input('');
  readonly saved = output<DocumentDraft>();
  readonly cancelled = output<void>();
  readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  draft: DocumentDraft = { name: '', componentName: '' };
  ngOnInit() {
    this.draft = { timed: false, game: false, ...this.initial() };
  }
  ngAfterViewInit() {
    setTimeout(() => this.form().nativeElement.querySelector('input')?.focus());
  }
  submit() {
    this.saved.emit({
      name: this.draft.name.trim(),
      ...(this.draft.game ? { game: true } : {}),
      componentName: this.draft.componentName.trim(),
      ...(this.draft.timed !== undefined ? { timed: this.draft.timed } : {}),
    });
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelled.emit();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      this.form().nativeElement.querySelectorAll<HTMLElement>('input,select,button'),
    );
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && index === controls.length - 1) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }
}
