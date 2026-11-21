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
import { withLabel, normalizeAngle, EDITOR_ROTATIONS } from './core/element-layout';
import { TimingDraft, TimedElementEdit } from './timed-ui';
import type { ElementEdit } from './constants-editor';
import { Arc, NetNode } from './core/net';

/** Draft fields are isolated until the parent validates and commits one edit. */
@Component({
  selector: 'app-element-dialog',
  imports: [FormsModule],
  template: ` <div class="backdrop">
    <form
      #form
      class="editor-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-title"
      (submit)="$event.preventDefault(); submit()"
    >
      <header>
        <div>
          <h2 id="editor-title">{{ isNode() ? element().kind : 'arc' }} properties</h2>
        </div>
        <button type="button" class="close" aria-label="Close editor" (click)="cancelled.emit()">
          ×
        </button>
      </header>
      <p class="subtitle">{{ description() }}</p>
      @if (isNode()) {
        <label for="dialog-name">Name</label
        ><input
          id="dialog-name"
          type="text"
          name="name"
          [(ngModel)]="draft.name"
          required
          autocomplete="off"
        />
        @if (element().kind === 'place') {
          <label for="dialog-tokens">Marking</label
          ><input
            id="dialog-tokens"
            name="tokens"
            type="number"
            min="0"
            step="1"
            [(ngModel)]="draft.tokens"
            required
          />
          <p class="hint">Number of tokens in this place before simulation.</p>
        }
        <label for="dialog-visible">Show name</label
        ><input id="dialog-visible" name="visible" type="checkbox" [(ngModel)]="draft.visible" />
        @if (element().kind === 'transition') {
          @if (game()) {
            <label for="dialog-actor">Player</label>
            <select id="dialog-actor" name="actor" [(ngModel)]="actorDraft">
              <option value="controller">Controller (controllable)</option>
              <option value="environment">Environment (uncontrollable)</option>
            </select>
          }
          <label for="dialog-rotation">Rotate by</label
          ><select id="dialog-rotation" name="rotation" [(ngModel)]="draft.rotation">
            @for (angle of rotations; track angle) {
              <option [ngValue]="angle">
                {{ angle === 135 ? '−45° (native +135°)' : '+' + angle + '°' }}
              </option>
            }
          </select>
          <p class="hint">Current angle: {{ draft.angle ?? 0 }}°</p>
        }
        <details class="position-details">
          <summary>Position</summary>
          <fieldset>
            <legend class="sr-only">Position</legend>
            <div class="coordinates">
              <div>
                <label for="dialog-x">X</label
                ><input
                  id="dialog-x"
                  name="x"
                  type="number"
                  step="any"
                  [(ngModel)]="draft.x"
                  required
                />
              </div>
              <div>
                <label for="dialog-y">Y</label
                ><input
                  id="dialog-y"
                  name="y"
                  type="number"
                  step="any"
                  [(ngModel)]="draft.y"
                  required
                />
              </div>
            </div>
          </fieldset>
        </details>
      } @else {
        <label for="dialog-kind">Type</label
        ><select id="dialog-kind" name="kind" [(ngModel)]="draft.kind">
          <option value="normal">Normal arc</option>
          <option value="inhibitor" [disabled]="!canInhibit()">Inhibitor arc</option>
        </select>
        <label for="dialog-weight">{{
          draft.kind === 'inhibitor' ? 'Inhibitor threshold' : 'Weight'
        }}</label
        ><input
          id="dialog-weight"
          name="weight"
          type="text"
          list="arc-constant-choices"
          aria-describedby="weight-help"
          [(ngModel)]="draft.weight"
          required
        />
        <datalist id="arc-constant-choices">
          @for (name of constantNames(); track name) {
            <option [value]="name"></option>
          }
        </datalist>
        <p id="weight-help" class="hint">
          Enter a positive integer or a declared constant name. Manage names in Constants.
        </p>
        <p class="hint">
          {{
            draft.kind === 'inhibitor'
              ? 'Enabled when the source has fewer tokens than this threshold. No tokens are consumed.'
              : 'Number of tokens consumed or produced when the transition fires.'
          }}
        </p>
      }
      @if (timing()) {
        @if (isNode() && element().kind === 'place') {
          <label for="dialog-invariant">Invariant</label>
          <input id="dialog-invariant" name="invariant" [(ngModel)]="timingFields.invariant" />
          <label for="dialog-ages">Initial ages</label>
          <input id="dialog-ages" name="ages" [(ngModel)]="timingFields.ages" />
          <p class="hint">
            Comma-separated exact decimal ages for the first tokens; remaining tokens have age 0. To
            remove aged tokens, edit this list and the marking together. Ages require native
            repository HEAD support when reopening TAPN files.
          </p>
        } @else if (isNode()) {
          <label for="dialog-urgent">Urgent</label>
          <input
            id="dialog-urgent"
            name="urgent"
            type="checkbox"
            [(ngModel)]="timingFields.urgent"
          />
          <p class="hint">
            An enabled urgent transition blocks positive delay. Inputs must use [0,inf); transport
            destinations must have no finite invariant.
          </p>
        } @else if (canInhibit()) {
          <label for="dialog-interval">Input interval</label>
          <input id="dialog-interval" name="interval" [(ngModel)]="timingFields.interval" />
          <label for="dialog-transport">Transport output</label>
          <select id="dialog-transport" name="transport" [(ngModel)]="timingFields.outputArc">
            <option value="">Ordinary input (remove pairing)</option>
            @for (option of transportOutputs(); track option.id) {
              <option [value]="option.id">{{ option.label }}</option>
            }
          </select>
          <p class="hint">
            Draw both normal arcs first, then pair the input with an output of the same transition.
            Pairing and weight edits are atomic; both routes stay intact. Inhibitors require [0,inf)
            and no transport.
          </p>
        } @else {
          <p class="hint">
            Transport output intervals are edited on the paired input. Editing either half's weight
            updates both halves. Delete either half to delete the pair.
          </p>
        }
        <p class="hint">
          Weights and bounds accept one declared constant name or an integer 0–2147483647; inf has
          an open endpoint. Delays and ages may be decimal. Existing decimal JSON bounds are
          preserved if unchanged; native TAPN save refuses them.
        </p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (isNode()) {
        <button type="button" (click)="share.emit(element().id)">
          Make shared / use existing pool…
        </button>
      }
      <footer>
        <button type="button" (click)="cancelled.emit()">Cancel</button
        ><button class="primary" type="submit">OK</button>
      </footer>
    </form>
  </div>`,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 110;
      background: #16253544;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .editor-dialog {
      width: min(420px, 100%);
      max-height: 90dvh;
      overflow: auto;
      box-sizing: border-box;
      background: #fff;
      padding: 16px;
      border: 1px solid #e1e7eb;
      border-radius: 3px;
      box-shadow: 0 18px 65px #142b4030;
      font-size: 12px;
      color: #344454;
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr);
      align-items: center;
      gap: 9px 12px;
    }
    .editor-dialog > * {
      grid-column: 1 / -1;
      min-width: 0;
    }
    header,
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    header span {
      font-size: 9px;
      letter-spacing: 0.8px;
      color: #96a2ac;
    }
    h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 3px 0 0;
      text-transform: capitalize;
    }
    .subtitle {
      color: #85929f;
      margin: 0 0 10px;
      font-size: 11px;
    }
    .close {
      font-size: 22px;
      padding: 0;
      width: 28px;
      height: 28px;
      border: 0;
      color: #91a0ac;
    }
    label {
      display: block;
      margin: 0;
      font-size: 12px;
      font-weight: 400;
      color: #465460;
    }
    .editor-dialog > label {
      grid-column: 1;
    }
    .editor-dialog > input,
    .editor-dialog > select {
      grid-column: 2;
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 28px;
      border: 1px solid #bdc7d0;
      border-radius: 2px;
      padding: 0 9px;
      background: #fff;
      color: inherit;
      font: inherit;
      transition:
        border-color 0.12s,
        background 0.12s;
    }
    input:hover,
    select:hover {
      border-color: #e1e7eb;
    }
    input:focus,
    select:focus {
      outline: none;
      border-color: #75b5b5;
      background: white;
      box-shadow: 0 0 0 2px #25679912;
    }
    .hint {
      font-size: 11px;
      color: #95a1ac;
      line-height: 1.55;
      margin: 0 0 4px;
    }
    .position-details {
      margin-top: 3px;
    }
    .position-details summary {
      cursor: pointer;
      color: #536270;
      font-size: 12px;
    }
    input[type='checkbox'] {
      width: 16px;
    }
    input[type='number']::-webkit-inner-spin-button {
      opacity: 1;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
    fieldset {
      margin: 9px 0 0;
      border: 0;
      border-top: 1px solid #edf1f3;
      padding: 12px 0 0;
    }
    legend {
      font-size: 10px;
      color: #95a1ac;
      padding-right: 10px;
    }
    .coordinates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .coordinates > div {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .coordinates label {
      flex-shrink: 0;
    }
    footer {
      justify-content: flex-end;
      margin-top: 12px;
      padding-top: 14px;
      border-top: 1px solid #edf1f3;
      gap: 8px;
    }
    button {
      cursor: pointer;
      border: 1px solid #e1e7eb;
      background: white;
      color: inherit;
      font: inherit;
      padding: 7px 12px;
      border-radius: 2px;
    }
    button:hover {
      background: #f6f8f9;
    }
    .primary {
      background: #256799;
      border-color: #256799;
      color: white;
      font-weight: 500;
    }
    .primary:hover {
      background: #1c557f;
    }
    .error {
      color: #a53232;
      background: #fff2f2;
      padding: 9px;
      border-radius: 2px;
      line-height: 1.55;
      margin: 0;
    }
    button:focus-visible {
      outline: 2px solid #256799;
      outline-offset: 3px;
    }
    .editor-dialog {
      width: min(440px, 100%);
      padding: 12px 16px;
      grid-template-columns: 82px minmax(0, 1fr);
      gap: 8px 10px;
    }
    header {
      margin-bottom: 0;
    }
    h2 {
      margin: 0;
      font-size: 14px;
    }
    .subtitle {
      margin: 0 0 3px;
      color: #54616c;
    }
    .editor-dialog > label {
      text-align: right;
    }
    #dialog-tokens,
    #dialog-weight {
      max-width: 110px;
    }
    input:focus,
    select:focus {
      border-color: #256799;
      box-shadow: 0 0 0 2px #25679930;
    }
    .hint {
      color: #5c6974;
      font-size: 11px;
      margin: 0;
    }
    footer {
      margin-top: 2px;
      padding-top: 8px;
    }
    footer button {
      min-width: 70px;
      padding: 5px 12px;
    }
    @media (max-width: 440px) {
      .editor-dialog {
        padding: 18px;
        grid-template-columns: 95px minmax(0, 1fr);
        gap: 8px;
      }
      .backdrop {
        padding: 14px;
      }
    }
  `,
})
export class ElementDialog implements AfterViewInit {
  readonly share = output<string>();
  readonly authored = input(false);
  readonly constantNames = input<readonly string[]>([]);
  readonly weightText = input('');
  readonly authoredSaved = output<ElementEdit>();
  readonly element = input.required<NetNode | Arc>();
  readonly description = input('');
  readonly canInhibit = input(false);
  readonly error = input('');
  readonly timing = input<TimingDraft | null>(null);
  readonly transportOutputs = input<readonly { id: string; label: string }[]>([]);
  readonly timedSaved = output<TimedElementEdit>();
  timingFields: TimingDraft = {
    invariant: '< inf',
    ages: '',
    urgent: false,
    interval: '[0,inf)',
    outputArc: '',
  };
  readonly saved = output<NetNode | Arc>();
  readonly cancelled = output<void>();
  readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  readonly rotations = EDITOR_ROTATIONS;
  draft: {
    visible?: boolean;
    angle?: number;
    rotation?: number;
    name?: string;
    tokens?: number | null;
    x?: number | null;
    y?: number | null;
    kind?: string;
    weight?: number | string | null;
  } = {};
  readonly game = input(false);
  readonly actor = input<'controller' | 'environment'>('controller');
  actorDraft: 'controller' | 'environment' = 'controller';
  isNode() {
    return 'name' in this.element();
  }
  ngOnInit() {
    const element = this.element();
    this.actorDraft = this.actor();
    if (this.timing()) this.timingFields = { ...this.timing()! };
    this.draft = {
      ...element,
      ...('name' in element
        ? { visible: element.nameVisible !== false, rotation: 0 }
        : this.authored()
          ? { weight: this.weightText() }
          : {}),
    };
  }
  ngAfterViewInit() {
    // NgModel writes the initial value after view creation; select it once that write settles.
    setTimeout(() => {
      const field = this.form().nativeElement.querySelector<HTMLInputElement>('input,select');
      if (!field?.isConnected) return;
      field.focus();
      if (field.tagName === 'INPUT' && field.type === 'text') field.select();
    });
  }

  private emit(element: NetNode | Arc) {
    if (this.authored()) {
      this.authoredSaved.emit({
        ...(this.game() && element.kind === 'transition' ? { actor: this.actorDraft } : {}),
        element,
        weightText: String(this.draft.weight ?? ''),
        timing: this.timing() ? { ...this.timingFields } : null,
      });
      return;
    }
    if (this.timing()) this.timedSaved.emit({ element, timing: { ...this.timingFields } });
    else this.saved.emit(element);
  }
  submit() {
    const element = this.element();
    if ('name' in element) {
      const angle = normalizeAngle((element.angle ?? 0) + (this.draft.rotation ?? 0));
      const { angle: _angle, ...node } = element;
      this.emit(
        withLabel(
          {
            ...node,
            ...(angle ? { angle } : {}),
            name: this.draft.name?.trim() ?? '',
            tokens: this.draft.tokens ?? NaN,
            x: this.draft.x ?? NaN,
            y: this.draft.y ?? NaN,
          },
          undefined,
          this.draft.visible,
        ),
      );
      return;
    }
    this.emit({ ...element, kind: this.draft.kind, weight: Number(this.draft.weight ?? NaN) } as
      NetNode | Arc);
  }
  @HostListener('keydown', ['$event']) key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
    }
    if (event.key === 'Tab') {
      const fields = [
        ...this.form().nativeElement.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
        ),
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
