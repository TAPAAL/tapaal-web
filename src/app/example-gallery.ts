import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';
import { FormsModule } from '@angular/forms';
import catalog from './example-catalog.json';
export type ExampleEntry = (typeof catalog)[number];
export const EXAMPLES = catalog;
@Component({
  selector: 'app-example-gallery',
  imports: [FormsModule, Icon],
  templateUrl: './example-gallery.html',
  styleUrl: './example-gallery.css',
})
export class ExampleGallery implements AfterViewInit {
  readonly selected = output<ExampleEntry>();
  readonly cancelled = output<void>();
  readonly error = input('');
  readonly loading = input(false);
  readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  readonly families = [...new Set(EXAMPLES.map((e) => e.family))];
  search = '';
  family = '';
  title(entry: ExampleEntry) {
    const words = entry.label.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  capabilities(entry: ExampleEntry) {
    return [
      entry.constants && 'Named constants',
      entry.sharedPlaces && 'Shared places',
      entry.sharedTransitions && 'Shared transitions',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  stats(entry: ExampleEntry) {
    const { places, transitions, arcs, components } = entry.stats;
    return `${places} place occurrences · ${transitions} transition occurrences · ${arcs} arc elements · ${components} component${components === 1 ? '' : 's'}`;
  }
  unavailable(entry: ExampleEntry) {
    if (entry.colored || entry.stochastic) return 'Requires desktop TAPAAL';
    return entry.reason;
  }
  get groups() {
    const query = this.search.trim().toLowerCase();
    return this.families
      .filter((f) => !this.family || f === this.family)
      .map((family) => ({
        family,
        entries: EXAMPLES.filter(
          (e) =>
            e.family === family &&
            [this.title(e), e.filename, family, this.capabilities(e)]
              .join(' ')
              .toLowerCase()
              .includes(query),
        ).sort((a, b) => Number(!!a.reason) - Number(!!b.reason)),
      }))
      .filter((group) => group.entries.length);
  }
  ngAfterViewInit() {
    this.panel().nativeElement.querySelector('input')?.focus();
  }
  open(entry: ExampleEntry) {
    // Open is disabled during fetch; keep focus on a stable modal control first.
    this.panel().nativeElement.querySelector('input')?.focus();
    this.selected.emit(entry);
  }
  @HostListener('document:keydown', ['$event']) key(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelled.emit();
    }
    if (event.key !== 'Tab') return;
    const controls = [
      ...this.panel().nativeElement.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,select,a',
      ),
    ];
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }
}
