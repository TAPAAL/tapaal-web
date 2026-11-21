import { AfterViewInit, Component, HostListener, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConstantDecl } from './core/authored-model';
@Component({
  selector: 'app-constant-dialog',
  imports: [FormsModule],
  template: `<div class="backdrop">
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="constant-title"
      (submit)="$event.preventDefault(); saved.emit({ name, value })"
    >
      <h2 id="constant-title">{{ declaration() ? 'Edit constant' : 'Add constant' }}</h2>
      <label for="constant-name">Name</label
      ><input id="constant-name" name="name" [(ngModel)]="name" required autocomplete="off" /><label
        for="constant-value"
        >Value</label
      ><input id="constant-value" name="value" [(ngModel)]="value" required inputmode="numeric" />
      <p>
        Whole number 0–2147483647. Names are case-sensitive, begin with a letter or underscore, and
        contain letters, digits or underscores. The name inf is reserved.
      </p>
      @if (error()) {
        <p role="alert" class="error">{{ error() }}</p>
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
      z-index: 120;
      background: #16253544;
      display: grid;
      place-items: center;
    }
    form {
      background: white;
      padding: 20px;
      width: min(420px, 90vw);
      max-height: 85vh;
      overflow: auto;
      display: grid;
      gap: 10px;
      font-size: 13px;
    }
    h2 {
      font-size: 16px;
      margin: 0;
    }
    input {
      padding: 6px;
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
    p {
      line-height: 1.5;
    }
  `,
})
export class ConstantDialog implements AfterViewInit {
  readonly declaration = input<ConstantDecl | null>(null);
  readonly error = input('');
  readonly saved = output<{ name: string; value: string }>();
  readonly cancelled = output<void>();
  name = '';
  value = '0';
  ngOnInit() {
    this.name = this.declaration()?.name ?? '';
    this.value = String(this.declaration()?.value ?? 0);
  }
  ngAfterViewInit() {
    setTimeout(() => document.getElementById('constant-name')?.focus());
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
    }
    if (event.key === 'Tab') {
      const form = (event.target as HTMLElement).closest('form')!;
      const fields = [...form.querySelectorAll<HTMLElement>('input,button')];
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
