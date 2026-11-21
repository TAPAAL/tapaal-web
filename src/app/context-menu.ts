import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
export interface ContextAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}
@Component({
  selector: 'app-context-menu',
  template: `<div
    #menu
    class="context-menu"
    role="menu"
    aria-label="Canvas actions"
    [style.left.px]="position().x"
    [style.top.px]="position().y"
  >
    @for (action of actions(); track action.id) {
      @if (action.separator) {
        <div class="separator" role="separator"></div>
      }
      <button
        role="menuitem"
        [disabled]="action.disabled"
        [class.danger]="action.danger"
        (click)="chosen.emit(action.id)"
      >
        <span>{{ action.label }}</span
        ><kbd>{{ action.shortcut }}</kbd>
      </button>
    }
  </div>`,
  styles: `
    .context-menu {
      position: fixed;
      z-index: 100;
      width: 216px;
      padding: 5px;
      border: 1px solid #dce2e8;
      border-radius: 2px;
      background: #fff;
      box-shadow: 0 6px 24px #18283926;
      font-size: 12px;
    }
    button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      min-height: 26px;
      padding: 4px 9px;
      border: 0;
      border-radius: 1px;
      background: transparent;
      color: #354455;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    button:hover:not(:disabled),
    button:focus-visible {
      outline: none;
      background: #dfeaf4;
      color: #256799;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button.danger {
      color: #b43f42;
    }
    button.danger:hover {
      background: #fff0f0;
      color: #a03033;
    }
    kbd {
      font: 10px inherit;
      color: #647380;
      white-space: nowrap;
    }
    .separator {
      height: 1px;
      background: #e9edf0;
      margin: 3px 5px;
    }
  `,
})
export class ContextMenu implements AfterViewInit {
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly actions = input.required<ContextAction[]>();
  readonly chosen = output<string>();
  readonly dismissed = output<boolean>();
  readonly menu = viewChild.required<ElementRef<HTMLDivElement>>('menu');
  readonly position = signal({ x: 0, y: 0 });
  ngOnInit() {
    this.position.set({ x: this.x(), y: this.y() });
  }
  ngAfterViewInit() {
    const bounds = this.menu().nativeElement.getBoundingClientRect();
    this.position.set({
      x: Math.max(8, Math.min(this.x(), innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(this.y(), innerHeight - bounds.height - 8)),
    });
    this.menu().nativeElement.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  @HostListener('document:pointerdown', ['$event']) outside(event: PointerEvent) {
    if (!this.menu().nativeElement.contains(event.target as Node)) this.dismissed.emit(false);
  }
  @HostListener('window:resize') resize() {
    this.dismissed.emit(false);
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopPropagation();
      this.dismissed.emit(event.key === 'Escape');
      return;
    }
    const buttons = [
      ...this.menu().nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
}
