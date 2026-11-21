import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Text stays in this draft until OK; interpolation in the canvas always escapes markup. */
@Component({
  selector: 'app-annotation-dialog',
  imports: [FormsModule],
  template: `<div class="backdrop">
    <form
      #form
      role="dialog"
      aria-modal="true"
      aria-labelledby="annotation-title"
      (submit)="$event.preventDefault(); saved.emit(draft)"
    >
      <h2 id="annotation-title">Annotation text</h2>
      <label for="annotation-text">Text</label
      ><textarea
        id="annotation-text"
        name="text"
        [(ngModel)]="draft"
        maxlength="100000"
        rows="8"
      ></textarea>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <footer>
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button type="submit">OK</button>
      </footer>
    </form>
  </div>`,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: #16253544;
      z-index: 110;
      display: grid;
      place-items: center;
    }
    form {
      box-sizing: border-box;
      background: white;
      border: 1px solid #bdc7d0;
      padding: 18px;
      width: min(440px, 95vw);
      display: grid;
      gap: 12px;
      color: #344454;
      font: 12px Arial;
    }
    h2 {
      margin: 0;
      font-size: 15px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      font:
        12px Helvetica,
        Arial,
        sans-serif;
      resize: vertical;
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    button {
      padding: 6px 18px;
      background: white;
      border: 1px solid #bdc7d0;
      cursor: pointer;
    }
    p {
      color: #a53232;
    }
    button:focus-visible,
    textarea:focus-visible {
      outline: 2px solid #256799;
      outline-offset: 2px;
    }
  `,
})
export class AnnotationDialog implements AfterViewInit {
  readonly text = input('');
  readonly error = input('');
  readonly saved = output<string>();
  readonly cancelled = output<void>();
  readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  draft = '';
  ngOnInit() {
    this.draft = this.text();
  }
  ngAfterViewInit() {
    setTimeout(() => this.form().nativeElement.querySelector('textarea')?.focus());
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
    }
    if (event.key === 'Tab') {
      const fields = [
        ...this.form().nativeElement.querySelectorAll<HTMLElement>('textarea,button'),
      ];
      const index = fields.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        fields.at(-1)?.focus();
      } else if (!event.shiftKey && index === fields.length - 1) {
        event.preventDefault();
        fields[0]?.focus();
      }
    }
  }
}
