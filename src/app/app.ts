import { moveArcLabel, arcLabelPosition } from './core/arc-geometry';
import { transitionActor } from './core/authored-shared';
import {
  SharedTransitionsPane,
  SharedTransitionDialog,
  TransitionTarget,
  TransitionDraft,
  transitionCommand,
} from './shared-transitions';
import { ExampleGallery, ExampleEntry } from './example-gallery';
import { SharedPlacesPane } from './shared-places-pane';
import { SharedPlaceDialog } from './shared-place-dialog';
import { SharedPlaceTarget, SharedPlaceDraft, sharedPlaceCommand } from './shared-places';
import {
  SelectionPayload,
  isAuthoredClipboard,
  readSelectionClipboard,
} from './core/authored-clipboard';
import { ConstantsPane } from './constants-pane';
import { ConstantDialog } from './constant-dialog';
import { ConstantDecl, Use } from './core/authored-model';
import * as constants from './constants-editor';
import { TokenSelectionDialog } from './token-selection-dialog';
import { TokenBindings, TokenInputChoice } from './token-selection';
import { pasteTiming } from './core/timed-clipboard';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { Icon } from './icon';
import {
  Viewport,
  GRID_SPACINGS,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  visibleBounds,
  zoomViewport,
  panViewport,
  wheelPixels,
  snapToGrid,
  snapNodeCenter,
  fitViewport,
} from './core/viewport';
import { AnnotationDialog } from './annotation-dialog';
import {
  annotationBox,
  annotationTextBox,
  annotationHandles,
  createAnnotation,
  editAnnotationText,
  resizeAnnotation,
  moveNodeLabel,
  nodeLabelBox,
  layoutBounds,
  rotateTransitions,
  wheelRotation,
  setNodeNameVisible,
  setAnnotationBorder,
  setAnnotationFilled,
  type ResizeHandle,
} from './core/element-layout';
import { ElementDialog } from './element-dialog';
import { ContextMenu, ContextAction } from './context-menu';
import { selectInRectangle, moveSelection } from './core/selection';
import { quickDrawPress, isQuickDrawCancelKey, type QuickDrawPress } from './core/quick-draw';
import {
  netArcGeometry,
  insertArcBend,
  moveArcBend,
  splitArcBend,
  deleteArcBend,
  toggleArcBendCurved,
  toggleArcEndCurved,
  withBends,
} from './core/arc-geometry';
import { DEMO_NET } from './sample-net';
import {
  Annotation,
  Arc,
  ArcBend,
  Net,
  NetNode,
  Tool,
  initialMarking,
  isEnabled,
} from './core/net';
import {
  type NetworkSimulationState,
  type NetworkMarking,
  type ElementRef as NetworkElementRef,
} from './core/network-simulation';
import { ImportResult } from './core/files';
import * as docs from './editor-workspace';
import type { Network as NumericNetwork } from './core/documents';
import {
  parseSharedModel as parseNetworkModel,
  serializeSharedTapn as serializeNetworkTapn,
  serializeSharedJson as serializeNetworkJson,
  SharedImportResult as NetworkImportResult,
} from './core/shared-files';
import { pasteClipboard, WEB_CLIPBOARD_TYPE } from './core/clipboard';
import { requireEditableModelType } from './core/model-types';
import { DocumentSimulation, TokenPolicy, TimedElementEdit } from './timed-ui';
import { DocumentDialog, DocumentDraft } from './document-dialog';

@Component({
  selector: 'app-root',
  imports: [
    ExampleGallery,
    SharedPlacesPane,
    SharedTransitionsPane,
    SharedTransitionDialog,
    SharedPlaceDialog,
    ConstantsPane,
    ConstantDialog,
    TokenSelectionDialog,
    Icon,
    ElementDialog,
    AnnotationDialog,
    ContextMenu,
    DocumentDialog,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvas!: ElementRef<SVGSVGElement>;
  private resizeObserver?: ResizeObserver;
  readonly workspace = signal(
    docs.openDocument(
      docs.createWorkspace(),
      docs.openNetworkDocument(docs.networkFromLegacyNet(DEMO_NET), { saved: true }),
    ),
  );
  readonly documents = computed(() => this.workspace().documents);
  readonly activeDocument = computed(() =>
    this.workspace().activeDocumentId ? docs.getDocument(this.workspace()) : null,
  );
  readonly savedQueryNames = computed(() =>
    (this.activeDocument()?.network.savedQueries?.xml ?? []).map(
      (xml, index) =>
        new DOMParser()
          .parseFromString(xml, 'application/xml')
          .documentElement.getAttribute('name') || `Query ${index + 1}`,
    ),
  );
  readonly components = computed(() => this.activeDocument()?.network.components ?? []);
  readonly documentDialog = signal<{
    action: 'new' | 'add' | 'copy' | 'rename';
    name: string;
    componentName: string;
  } | null>(null);
  private documentOrigin?: docs.DocumentWorkspace;
  readonly documentDialogError = signal('');
  readonly closingDocument = signal<string | null>(null);
  readonly isDocumentDirty = docs.isDirty;
  private readonly componentSessions = new Map<string, { grid: number; fitted: boolean }>();
  private readonly naming = new Map<string, { place: bigint; transition: bigint }>();
  private simulator?: DocumentSimulation;
  readonly timed = computed(() => !!this.activeDocument()?.network.type.timed);
  readonly hasInitialAges = computed(
    () =>
      this.activeDocument()?.network.shared.places.some((p) => (p.timing?.ages.length ?? 0) > 0) ||
      this.components().some((component) =>
        Object.values(component.timing?.ages ?? {}).some((ages) => ages.length > 0),
      ),
  );
  readonly timing = computed(
    () =>
      this.components().find((c) => c.id === this.activeDocument()?.session.componentId)?.timing,
  );
  readonly editorTiming = computed(() =>
    this.timed() && this.editingElement()
      ? constants.timingDraft(this.activeDocument()!, this.editingElement()!)
      : null,
  );
  readonly globalTime = signal('0');
  readonly legalDelay = signal('');
  readonly delayAmount = signal('0.1');
  readonly tokenPolicy = signal<TokenPolicy>('random');
  readonly tokenDraft = signal<{
    simulator: DocumentSimulation;
    version: number;
    documentId: string;
    componentId: string;
    transition: string;
    inputs: readonly TokenInputChoice[];
  } | null>(null);
  readonly tokenSelectionError = signal('');
  setTokenPolicy(policy: TokenPolicy) {
    this.cancelTokenSelection();
    this.tokenPolicy.set(policy);
  }
  cancelTokenSelection() {
    this.tokenDraft.set(null);
    this.tokenSelectionError.set('');
  }
  confirmTokenSelection(bindings: TokenBindings, draft = this.tokenDraft()) {
    if (!draft || draft !== this.tokenDraft()) return;
    if (
      !this.currentSimulation() ||
      draft.simulator !== this.simulator ||
      draft.version !== this.simulator.version ||
      draft.documentId !== this.activeDocument()?.id ||
      this.tokenPolicy() !== 'manual'
    ) {
      this.cancelTokenSelection();
      this.error.set('Token selection expired because the simulation changed.');
      return;
    }
    try {
      this.simulator.fire(draft.componentId, draft.transition, { mode: 'manual', bindings });
      this.publishSimulation();
      this.error.set('');
      this.notice.set(
        `Fired ${this.transitionName({ componentId: draft.componentId, elementId: draft.transition })}.`,
      );
    } catch (error) {
      this.tokenSelectionError.set((error as Error).message);
      this.error.set((error as Error).message);
    }
  }
  readonly sharedDialog = signal<{
    target: SharedPlaceTarget;
    origin: docs.DocumentWorkspace;
  } | null>(null);
  readonly transitionDialog = signal<{
    target: TransitionTarget;
    origin: docs.DocumentWorkspace;
  } | null>(null);
  openSharedTransition(target: TransitionTarget) {
    if (this.mode() !== 'Edit') return;
    this.closeEditor();
    this.finishDrag();
    this.sharedFocus = document.activeElement as HTMLElement;
    this.sharedError.set('');
    this.transitionDialog.set({ target, origin: this.workspace() });
  }
  closeSharedTransition() {
    this.transitionDialog.set(null);
    this.sharedError.set('');
    setTimeout(() =>
      (this.sharedFocus?.isConnected ? this.sharedFocus : this.canvas?.nativeElement)?.focus(),
    );
  }
  saveSharedTransition(draft: TransitionDraft) {
    const dialog = this.transitionDialog();
    if (!dialog) return;
    try {
      if (this.mode() !== 'Edit' || dialog.origin !== this.workspace())
        throw new Error('The document changed; cancel and reopen this shared transition edit.');
      this.updateActive((doc) =>
        docs.sharedTransact(doc, transitionCommand(doc.network, dialog.target, draft)),
      );
      this.publish();
      this.closeSharedTransition();
      this.error.set('');
    } catch (e) {
      this.sharedError.set((e as Error).message);
    }
  }
  deleteSharedTransition(poolId: string) {
    this.documentOperation((doc) =>
      docs.sharedTransact(doc, { kind: 'deleteTransitionPool', poolId }),
    );
  }
  readonly sharedError = signal('');
  readonly selectedPool = signal<string | undefined>(undefined);
  // Session view state survives pane recreation after whole-document undo/redo.
  readonly expandedTransitionPools = signal<ReadonlySet<string>>(new Set());
  private sharedFocus?: HTMLElement;
  poolForOccurrence(id: string) {
    const doc = this.activeDocument();
    const node = doc && docs.sourceComponent(doc).net.nodes.find((n) => n.id === id);
    return node && docs.isSharedOccurrence(node)
      ? doc!.network.shared.places.find((p) => p.id === node.sharedId)
      : undefined;
  }
  sharedTransitionOccurrence(id: string) {
    const doc = this.activeDocument();
    const node = doc && docs.sourceComponent(doc).net.nodes.find((n) => n.id === id);
    return !!node && node.kind === 'transition' && docs.isSharedOccurrence(node);
  }
  openSharedPool(poolId?: string) {
    if (this.mode() !== 'Edit') return;
    this.openSharedDialog({ kind: 'pool', ...(poolId ? { poolId } : {}) });
    this.selectedPool.set(poolId);
  }
  openSharedPlace(id: string) {
    if (this.net().nodes.find((n) => n.id === id)?.kind === 'transition') {
      this.openSharedTransition({
        componentId: this.activeDocument()!.session.componentId,
        elementId: id,
      });
      return;
    }
    this.closeEditor();
    this.openSharedDialog({
      kind: 'place',
      componentId: this.activeDocument()!.session.componentId,
      elementId: id,
    });
  }
  private openSharedDialog(target: SharedPlaceTarget) {
    this.finishDrag();
    this.sharedFocus = document.activeElement as HTMLElement;
    this.sharedError.set('');
    this.sharedDialog.set({ target, origin: this.workspace() });
  }
  closeSharedDialog() {
    this.sharedDialog.set(null);
    this.sharedError.set('');
    setTimeout(() =>
      (this.sharedFocus?.isConnected ? this.sharedFocus : this.canvas?.nativeElement)?.focus(),
    );
  }
  saveSharedPlace(draft: SharedPlaceDraft) {
    const dialog = this.sharedDialog();
    if (!dialog) return;
    try {
      if (this.mode() !== 'Edit' || dialog.origin !== this.workspace())
        throw new Error('The document changed; cancel and reopen this shared place edit.');
      const command = sharedPlaceCommand(this.activeDocument()!.network, dialog.target, draft);
      this.updateActive((doc) => docs.sharedTransact(doc, command));
      this.publish();
      this.closeSharedDialog();
      this.error.set('');
    } catch (error) {
      this.sharedError.set((error as Error).message);
    }
  }
  deleteSharedPool(poolId: string) {
    this.documentOperation((doc) => docs.sharedTransact(doc, { kind: 'deletePool', poolId }));
  }
  navigateOccurrence(ref: { componentId: string; elementId: string }) {
    this.switchComponent(ref.componentId);
    this.selectElement(ref.elementId);
    this.fit();
  }
  readonly physicalTokens = signal(0);
  readonly currentAges = signal<Record<string, string[]>>({});
  readonly invariantText = (value?: import('./core/authored-model').AuthoredInvariant) =>
    constants.invariantText(this.activeDocument()!.network, value);
  transitionUrgent(id: string) {
    const source = this.activeDocument()?.network,
      node =
        this.activeDocument() &&
        docs.sourceComponent(this.activeDocument()!).net.nodes.find((n) => n.id === id);
    return node && docs.isSharedOccurrence(node)
      ? (source!.shared.transitions.find((p) => p.id === node.sharedId)?.urgent ?? false)
      : (this.timing()?.urgent.includes(id) ?? false);
  }
  placeInvariantText(id: string) {
    const pool = this.poolForOccurrence(id);
    if (pool) return this.invariantText(pool.timing?.invariant ?? undefined);
    const invariants = this.timing()?.invariants;
    return this.invariantText(
      invariants && Object.hasOwn(invariants, id) ? invariants[id] : undefined,
    );
  }
  readonly constantDraft = signal<{
    declaration: ConstantDecl | null;
    origin: docs.DocumentWorkspace;
  } | null>(null);
  readonly constantError = signal('');
  private elementOrigin?: docs.DocumentWorkspace;
  weightText(arc: Arc) {
    const source =
      this.activeDocument() &&
      docs.sourceComponent(this.activeDocument()!).net.arcs.find((a) => a.id === arc.id);
    return source
      ? constants.termText(this.activeDocument()!.network, source.weight)
      : String(arc.weight);
  }
  readonly modelCounts = computed(() => {
    const network = this.activeDocument()?.network;
    const components = network?.components ?? [];
    const nodes = components.flatMap((c) => c.net.nodes);
    return {
      places:
        nodes.filter((n) => n.kind === 'place' && !docs.isSharedOccurrence(n)).length +
        (network?.shared.places.length ?? 0),
      transitions:
        nodes.filter((n) => n.kind === 'transition' && !docs.isSharedOccurrence(n)).length +
        (network?.shared.transitions.length ?? 0),
      components: components.length,
      active: components.filter((c) => c.active).length,
    };
  });
  readonly viewedCounts = computed(() => ({
    places: this.net().nodes.filter((n) => n.kind === 'place').length,
    transitions: this.net().nodes.filter((n) => n.kind === 'transition').length,
  }));
  readonly constantNames = computed(
    () => this.activeDocument()?.network.constants.map((c) => c.name) ?? [],
  );
  arcWeightLabel(arc: Arc) {
    const text = this.weightText(arc);
    return /^\d+$/.test(text) ? (text === '1' ? '' : text + 'x') : text + ' x';
  }
  openConstant(declaration: ConstantDecl | null) {
    this.finishDrag();
    this.constantError.set('');
    this.constantDraft.set({ declaration, origin: this.workspace() });
  }
  closeConstant() {
    this.constantDraft.set(null);
    this.constantError.set('');
    setTimeout(() => this.canvas.nativeElement.focus());
  }
  saveConstant(value: { name: string; value: string }) {
    const draft = this.constantDraft();
    if (!draft) return;
    try {
      if (draft.origin !== this.workspace())
        throw new Error('The document changed; cancel and reopen this constant edit.');
      this.updateActive((doc) =>
        constants.editDeclaration(doc, {
          ...value,
          ...(draft.declaration ? { id: draft.declaration.id } : {}),
        }),
      );
      this.publish();
      this.closeConstant();
    } catch (error) {
      this.constantError.set((error as Error).message);
    }
  }
  deleteConstant(id: string) {
    this.documentOperation((doc) => docs.transact(doc, { kind: 'deleteConstant', id }));
  }
  navigateConstantUse(use: Use) {
    if (use.poolId) {
      this.selectedPool.set(use.poolId);
      this.openSharedPool(use.poolId);
      return;
    }
    if (!use.componentId || !use.elementId) return;
    this.switchComponent(use.componentId);
    this.selectElement(use.elementId);
    this.fit();
  }
  applyAuthoredElement(edit: constants.ElementEdit) {
    if (this.mode() !== 'Edit') return;
    try {
      if (this.elementOrigin !== this.workspace())
        throw new Error('The document changed; reopen the properties dialog.');
      this.updateActive((doc) => constants.editElement(doc, edit));
      this.publish();
      this.error.set('');
      this.closeEditor();
    } catch (error) {
      this.dialogError.set((error as Error).message);
    }
  }
  private sourceGeneration = 0;
  private simulationSource?: { documentId: string; network: docs.Network; generation: number };
  readonly net = signal<Net>(docs.activeNet(docs.getDocument(this.workspace())));
  readonly dirty = signal(false);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly canvasSize = signal({ width: 1000, height: 600 });
  readonly gridIndex = signal(0);
  readonly gridSpacing = computed(() => GRID_SPACINGS[this.gridIndex()]);
  readonly fitted = signal(false);
  readonly minZoom = MIN_ZOOM;
  readonly maxZoom = MAX_ZOOM;
  readonly panning = signal(false);
  private readonly wheelListener = (event: WheelEvent) => this.wheel(event);
  readonly explorerOpen = signal(false);
  readonly selection = signal<string | null>(null);
  readonly selectedIds = signal<string[]>([]);
  readonly selectionCount = computed(() => this.selectedIds().length);
  readonly selectedNodes = computed(() => this.net().nodes.filter((n) => this.isSelected(n.id)));
  readonly marquee = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  readonly editingElement = signal<NetNode | Arc | null>(null);
  readonly annotationEditor = signal<{ id?: string; x: number; y: number; text: string } | null>(
    null,
  );
  readonly annotationBox = annotationBox;
  readonly annotationTextBox = annotationTextBox;
  readonly nodeLabelBox = nodeLabelBox;
  invariantLabel(node: NetNode) {
    if (node.kind !== 'place' || !this.timed()) return '';
    const bound = this.placeInvariantText(node.id);
    return bound === '< inf' ? '' : 'Inv: ' + bound;
  }
  noteHandles(note: Annotation) {
    return Object.entries(annotationHandles(note)).map(([handle, point]) => ({ handle, ...point }));
  }
  noteLines(note: Annotation) {
    const columns = Math.max(1, Math.floor(note.width / 7));
    return note.text.split('\n').flatMap((line) => {
      const lines: string[] = [];
      while (line.length > columns) {
        const space = line.lastIndexOf(' ', columns);
        const end = space > 0 ? space + 1 : columns;
        lines.push(line.slice(0, end));
        line = line.slice(end);
      }
      return [...lines, line];
    });
  }
  makeNoteSolid(id: string) {
    this.commit(setAnnotationFilled(this.net(), id, true));
  }
  readonly selectedNotes = computed(() =>
    (this.net().annotations ?? []).filter((n) => this.isSelected(n.id)),
  );
  readonly canCopySelection = computed(
    () => !!(this.selectedNodes().length || this.selectedNotes().length),
  );
  readonly dialogError = signal('');
  readonly editorDescription = computed(() => {
    const element = this.editingElement();
    return element && 'name' in element
      ? `${element.name} · ${this.net().template}`
      : element
        ? `${this.nodeName(element.source)} → ${this.nodeName(element.target)}`
        : '';
  });
  readonly transportOutputs = computed(() => {
    const element = this.editingElement();
    if (!element || !('source' in element)) return [];
    return this.net()
      .arcs.filter(
        (a) =>
          a.source === element.target &&
          a.kind === 'normal' &&
          !this.timing()?.transports.some((p) => p.outputArc === a.id && p.inputArc !== element.id),
      )
      .map((a) => ({ id: a.id, label: this.nodeName(a.target) }));
  });
  readonly editorCanInhibit = computed(() => {
    const element = this.editingElement();
    return (
      !!element &&
      'source' in element &&
      this.net().nodes.some((n) => n.id === element.source && n.kind === 'place')
    );
  });
  private editorFocus?: HTMLElement;
  readonly selected = computed(() =>
    this.selectionCount() === 1
      ? this.net().nodes.find((n) => n.id === this.selection())
      : undefined,
  );
  readonly selectedNote = computed(() =>
    this.selectionCount() === 1
      ? this.net().annotations?.find((note) => note.id === this.selection())
      : undefined,
  );
  readonly selectedArc = computed(() =>
    this.selectionCount() === 1
      ? this.net().arcs.find((a) => a.id === this.selection())
      : undefined,
  );
  readonly tool = signal<Tool>('select');
  readonly mode = signal<'Edit' | 'Simulate'>('Edit');
  readonly traceOpen = signal(false);
  readonly context = signal<{
    x: number;
    y: number;
    point: { x: number; y: number };
    id: string | null;
    bend?: number;
    endpoint?: boolean;
  } | null>(null);
  readonly contextActions = computed<ContextAction[]>(() => {
    const context = this.context();
    if (!context) return [];
    const node = this.net().nodes.find((n) => n.id === context.id);
    const arc = this.net().arcs.find((a) => a.id === context.id);
    const note = this.net().annotations?.find((n) => n.id === context.id);
    if (this.mode() === 'Simulate')
      return [
        ...(node?.kind === 'transition'
          ? [{ id: 'fire', label: 'Fire transition', disabled: !this.enabled(node) }]
          : []),
        { id: 'back', label: 'Previous marking', disabled: !this.canBack() },
        {
          id: 'step',
          label: this.canForward() ? 'Next marking' : 'Fire next enabled transition',
          disabled: !this.canForward() && !this.enabledTransitions().length,
        },
        { id: 'reset', label: 'Reset simulation', separator: true },
      ];
    if (arc && (context.bend !== undefined || context.endpoint)) {
      const curved = context.endpoint ? arc.curvedEnd : arc.bends?.[context.bend!]?.curved;
      return [
        { id: 'toggle-bend', label: curved ? 'Change to Straight' : 'Change to Curved' },
        ...(!context.endpoint
          ? [
              { id: 'split-bend', label: 'Split Point' },
              { id: 'delete-bend', label: 'Delete', danger: true },
            ]
          : []),
      ];
    }
    if (node || arc || note)
      return [
        {
          id: 'edit',
          label:
            this.selectionCount() > 1
              ? 'Edit this element…'
              : node
                ? `Edit ${node.kind}…`
                : 'Properties…',
          shortcut: 'Enter',
        },
        ...(node
          ? [
              {
                id: 'name-visible',
                label: `${node.nameVisible === false ? 'Show' : 'Hide'} ${node.kind} name`,
              },
              ...(node.kind === 'transition' ? [{ id: 'rotate', label: 'Rotate +45°' }] : []),
            ]
          : []),
        ...(note
          ? [
              {
                id: 'note-border',
                label: note.border === false ? 'Enable border' : 'Disable border',
              },
              ...(note.filled === false
                ? [{ id: 'note-solid', label: 'Solid background (enable TAPN save)' }]
                : []),
            ]
          : []),
        ...(arc ? [{ id: 'insert-bend', label: 'Insert Point' }] : []),
        ...(node?.kind === 'place' && this.selectionCount() === 1
          ? [
              { id: 'add-token', label: 'Add token', separator: true },
              { id: 'remove-token', label: 'Remove token', disabled: node.tokens === 0 },
            ]
          : []),
        {
          id: 'copy',
          label: 'Copy',
          shortcut: 'Ctrl C',
          disabled: !this.canCopySelection(),
          separator: true,
        },
        { id: 'cut', label: 'Cut', shortcut: 'Ctrl X', disabled: !this.canCopySelection() },
        { id: 'paste', label: 'Paste', shortcut: 'Ctrl V' },
        {
          id: 'duplicate',
          label: this.selectionCount() > 1 ? 'Duplicate selection' : 'Duplicate',
          shortcut: 'Ctrl D',
          disabled: !this.canCopySelection(),
          separator: true,
        },
        {
          id: 'delete',
          separator: true,
          label: this.selectionCount() > 1 ? 'Delete selection' : 'Delete',
          shortcut: 'Del',
          danger: true,
        },
      ];
    return [
      { id: 'paste', label: 'Paste', shortcut: 'Ctrl V' },
      { id: 'place', label: 'Add place here' },
      { id: 'transition', label: 'Add transition here' },
      { id: 'annotation', label: 'Add annotation here' },
      {
        id: 'select-all',
        label: 'Select all',
        shortcut: 'Ctrl A',
        separator: true,
        disabled: !this.net().nodes.length,
      },
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl Z', separator: true, disabled: !this.canUndo() },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl Shift Z', disabled: !this.canRedo() },
      { id: 'fit', label: 'Fit model', separator: true },
    ];
  });
  readonly notice = signal('Create places and transitions, connect them, then simulate your net.');
  readonly error = signal('');
  readonly trace = signal<readonly NetworkSimulationState[]>([]);
  readonly cursor = signal(0);
  readonly canBack = signal(false);
  readonly canForward = signal(false);
  readonly marking = signal(initialMarking(this.net()));
  readonly enabledTransitions = signal<readonly NetworkElementRef[]>([]);
  readonly inactiveView = computed(
    () =>
      this.mode() === 'Simulate' &&
      !this.components().find((item) => item.id === this.activeDocument()?.session.componentId)
        ?.active,
  );
  readonly enabledIds = computed(() =>
    this.mode() === 'Simulate'
      ? (this.enabledTransitions(),
        this.simulator?.enabledFor(this.activeDocument()!.session.componentId) ?? [])
      : this.timed()
        ? []
        : this.net()
            .nodes.filter(
              (n) => n.kind === 'transition' && isEnabled(this.net(), this.marking(), n.id),
            )
            .map((n) => n.id),
  );
  readonly deadlocked = computed(
    () => this.mode() === 'Simulate' && this.enabledTransitions().length === 0,
  );
  readonly pending = signal<((ImportResult | NetworkImportResult) & { action: string }) | null>(
    null,
  );
  readonly arcStart = signal<string | null>(null);
  readonly arcPointer = signal<{ x: number; y: number; nodeId?: string } | null>(null);
  private nameHighWater = { place: 0n, transition: 0n };
  readonly arcGeometries = computed(() => netArcGeometry(this.net()));
  readonly draftBends = signal<ArcBend[]>([]);
  readonly draftCurvedEnd = signal(false);
  readonly prototypeArcPath = computed(() => {
    const source = this.net().nodes.find((node) => node.id === this.arcStart());
    if (!source) return '';
    const pointer = this.arcPointer() ?? source;
    const hovered = this.net().nodes.find(
      (node) => node.id === ('nodeId' in pointer ? pointer.nodeId : undefined),
    );
    const attached = hovered && hovered.kind !== source.kind ? hovered : undefined;
    if (!attached && pointer.x === source.x && pointer.y === source.y && !this.draftBends().length)
      return '';
    // A private two-node net gives the draft the same controls/anchors without adding history.
    const target: NetNode = {
      ...(attached ?? source),
      id: 'draft-target',
      name: 'DraftTarget',
      kind: source.kind === 'place' ? 'transition' : 'place',
      tokens: 0,
      x: (attached ?? pointer).x,
      y: (attached ?? pointer).y,
    };
    const arc = withBends(
      {
        id: 'draft-arc',
        source: 'draft-source',
        target: target.id,
        kind: this.tool() === 'inhibitor' ? 'inhibitor' : 'normal',
        weight: 1,
      },
      this.draftBends(),
      this.draftCurvedEnd(),
    );
    const geometry = netArcGeometry({
      name: 'Draft',
      template: 'Draft',
      nodes: [{ ...source, id: 'draft-source', name: 'DraftSource' }, target],
      arcs: [arc],
    }).get(arc.id)!;
    if (attached) return geometry.d;
    const vertices = geometry.vertices;
    Object.assign(vertices[vertices.length - 1], { x: pointer.x, y: pointer.y });
    return (
      `M ${vertices[0].x} ${vertices[0].y}` +
      vertices
        .slice(1)
        .map((v) =>
          v.curved
            ? ` C ${v.control1.x} ${v.control1.y} ${v.control2.x} ${v.control2.y} ${v.x} ${v.y}`
            : ` L ${v.x} ${v.y}`,
        )
        .join('')
    );
  });
  readonly viewport = signal<Viewport>({ x: 0, y: 0, zoom: 100 });
  readonly zoom = computed(() => this.viewport().zoom);
  readonly visible = computed(() => visibleBounds(this.viewport(), this.canvasSize()));
  readonly viewBox = computed(() => {
    const v = this.visible();
    return `${v.x} ${v.y} ${v.width} ${v.height}`;
  });
  readonly places = computed(() => this.net().nodes.filter((n) => n.kind === 'place'));
  readonly transitions = computed(() => this.net().nodes.filter((n) => n.kind === 'transition'));
  readonly tokenCount = computed(() => this.places().reduce((sum, n) => sum + this.tokens(n), 0));
  readonly tools: { id: Tool; icon: string; label: string; key: string }[] = [
    { id: 'select', icon: 'cursor', label: 'Select', key: 'S' },
    { id: 'pan', icon: 'hand', label: 'Pan', key: 'H' },
    { id: 'place', icon: 'circle', label: 'Place', key: 'P' },
    { id: 'transition', icon: 'transition', label: 'Transition', key: 'T' },
    { id: 'arc', icon: 'arrow', label: 'Arc', key: 'A' },
    { id: 'inhibitor', icon: 'inhibitor', label: 'Inhibitor arc', key: 'I' },
    { id: 'annotation', icon: 'note', label: 'Annotation', key: 'N' },
    { id: 'add-token', icon: 'plus', label: 'Add token', key: '+' },
    { id: 'remove-token', icon: 'minus', label: 'Remove token', key: '-' },
  ];
  private drag?: {
    start: { x: number; y: number };
    node?: NetNode;
    label?: string;
    arcLabel?: string;
    note?: string;
    resize?: { id: string; handle: ResizeHandle };
    bend?: { arcId: string; index: number };
    before: Net;
    marquee?: boolean;
    selectedBefore: string[];
    additiveIds?: string[];
    moved?: boolean;
    pan?: { clientX: number; clientY: number; view: Viewport };
  };
  private nextId = 0;
  private pendingFocus?: HTMLElement;
  constructor() {
    this.publish();
    this.observeNodeNames(this.net());
  }
  changeTokens(id: string, delta: number) {
    if (this.mode() !== 'Edit') return;
    const node = this.net().nodes.find((n) => n.id === id);
    if (node?.kind !== 'place') return;
    const tokens = node.tokens + delta;
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens === node.tokens) return;
    this.commit({
      ...this.net(),
      nodes: this.net().nodes.map((n) => (n.id === id ? { ...n, tokens } : n)),
    });
  }
  openAnnotation(draft: { id?: string; x: number; y: number; text: string }) {
    if (this.mode() !== 'Edit') return;
    this.finishDrag();
    this.editorFocus = document.activeElement as HTMLElement;
    this.dialogError.set('');
    this.annotationEditor.set(draft);
    this.closeMenus();
  }
  closeAnnotation() {
    this.annotationEditor.set(null);
    this.closeEditor();
  }
  applyAnnotation(text: string) {
    const draft = this.annotationEditor();
    if (!draft || this.mode() !== 'Edit') return;
    if (!draft.id && !text.trim()) {
      this.closeAnnotation();
      return;
    }
    try {
      const size = {
        width: Math.max(
          100,
          Math.min(600, Math.max(...text.split('\n').map((line) => line.length)) * 7),
        ),
        height: Math.max(16, text.split('\n').length * 16),
      };
      const result = draft.id
        ? { net: editAnnotationText(this.net(), draft.id, text), id: draft.id }
        : createAnnotation(this.net(), draft, text, size);
      if (this.commit(result.net)) {
        this.selectElement(result.id);
        this.closeAnnotation();
      } else this.dialogError.set(this.error());
    } catch (error) {
      this.dialogError.set((error as Error).message);
    }
  }
  transitionKey(ref: NetworkElementRef): string {
    return JSON.stringify([ref.componentId, ref.elementId]);
  }
  transitionName(ref: NetworkElementRef | null) {
    if (!ref) return 'Initial marking';
    const component = this.simulator?.revision.components.find(
      (item) => item.id === ref.componentId,
    );
    const node = component?.net.nodes.find((item) => item.id === ref.elementId);
    if (node && 'sharedId' in node)
      return this.activeDocument()!.network.shared.transitions.find((p) => p.id === node.sharedId)!
        .name;
    return `${component?.net.template ?? ref.componentId}.${(node && 'name' in node ? node.name : undefined) ?? ref.elementId}`;
  }
  actorLabel(id: string, componentId = this.activeDocument()!.session.componentId): string {
    const source = this.activeDocument()?.network;
    if (!source?.type.game) return '';
    return transitionActor(source, componentId, id) === 'environment'
      ? 'Environment'
      : 'Controller';
  }
  markingText(marking: NetworkMarking) {
    return (this.simulator?.revision.components ?? [])
      .flatMap((component) =>
        component.net.nodes
          .filter((node) => node.kind === 'place')
          .map(
            (node) =>
              `${component.net.template}.${'sharedId' in node ? this.activeDocument()!.network.shared.places.find((p) => p.id === node.sharedId)!.name : node.name}=${marking[component.id][node.id]}`,
          ),
      )
      .join(' · ');
  }
  selectEnabled(ref: NetworkElementRef) {
    if (!this.currentSimulation()) return;
    this.switchComponent(ref.componentId);
    this.selectElement(ref.elementId);
  }
  fireEnabled(ref: NetworkElementRef) {
    if (!this.currentSimulation()) return;
    try {
      if (this.tokenDraft()) return;
      const policy = this.tokenPolicy();
      if (
        (this.activeDocument()!.network.type.game ||
          this.timed() ||
          this.activeDocument()!.network.shared.places.length > 0 ||
          this.activeDocument()!.network.shared.transitions.length > 0) &&
        policy === 'manual'
      ) {
        if (!this.simulator!.enabledFor(ref.componentId).includes(ref.elementId))
          throw new Error('Transition is not enabled.');
        const inputs = this.simulator!.eligibleInputs(ref);
        if (inputs.length) {
          this.tokenSelectionError.set('');
          this.tokenDraft.set({
            simulator: this.simulator!,
            version: this.simulator!.version,
            documentId: this.activeDocument()!.id,
            componentId: ref.componentId,
            transition: ref.elementId,
            inputs,
          });
          this.closeMenus();
          return;
        }
        this.simulator!.fire(ref.componentId, ref.elementId, { mode: 'manual', bindings: {} });
      } else
        this.simulator!.fire(
          ref.componentId,
          ref.elementId,
          policy === 'manual' ? 'oldest' : policy,
        );
      this.publishSimulation();
      this.error.set('');
      this.notice.set(`Fired ${this.transitionName(ref)}.`);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  activateNode(node: NetNode) {
    this.selectElement(node.id);
    if (this.mode() === 'Simulate' && node.kind === 'transition') this.fire(node);
    else if (this.mode() === 'Edit' && (this.tool() === 'arc' || this.tool() === 'inhibitor'))
      this.connect(node);
    else if (this.mode() === 'Edit') this.openEditor(node.id);
  }
  isSelected(id: string) {
    return this.selectedIds().includes(id);
  }
  private selectionGeneration = 0;
  private setSelection(ids: string[], selectInternalArcs = true) {
    // Native selects internal arcs only when a node becomes selected. Repeated publication or
    // explicitly toggling an arc must not undo the user's arc deselection.
    const previous = new Set(this.selectedIds());
    const selected = new Set(ids);
    const addedNodes = new Set(
      this.net()
        .nodes.filter((n) => selected.has(n.id) && !previous.has(n.id))
        .map((n) => n.id),
    );
    for (const arc of this.net().arcs) {
      if (
        selectInternalArcs &&
        selected.has(arc.source) &&
        selected.has(arc.target) &&
        (addedNodes.has(arc.source) || addedNodes.has(arc.target))
      )
        selected.add(arc.id);
    }
    ids = [...selected];
    if (ids.length !== previous.size || ids.some((id) => !previous.has(id)))
      this.selectionGeneration++;
    this.selectedIds.set(ids);
    this.selection.set(ids.at(-1) ?? null);
  }
  selectElement(id: string | null, additive = false) {
    this.setSelection(
      id === null
        ? []
        : additive
          ? this.isSelected(id)
            ? this.selectedIds().filter((value) => value !== id)
            : [...this.selectedIds(), id]
          : [id],
    );
  }
  openEditor(id = this.selection()) {
    if (this.mode() !== 'Edit' || !id) return;
    this.finishDrag();
    const note = this.net().annotations?.find((n) => n.id === id);
    if (note) {
      this.openAnnotation({ ...note });
      return;
    }
    const element =
      this.net().nodes.find((n) => n.id === id) ?? this.net().arcs.find((a) => a.id === id);
    if (!element) return;
    if (
      this.activeDocument() &&
      docs
        .sourceComponent(this.activeDocument()!)
        .net.nodes.some((n) => n.id === id && docs.isSharedOccurrence(n))
    ) {
      this.openSharedPlace(id);
      return;
    }
    this.selectElement(id);
    this.editorFocus = document.activeElement as HTMLElement;
    this.dialogError.set('');
    this.editingElement.set(structuredClone(element));
    this.elementOrigin = this.workspace();
    this.closeMenus();
  }
  closeEditor() {
    this.editingElement.set(null);
    this.dialogError.set('');
    setTimeout(() => {
      const target = this.editorFocus;
      if (target && target !== document.body && target.isConnected) target.focus();
      else this.canvas.nativeElement.focus();
    });
  }
  applyTimedElement(edit: TimedElementEdit) {
    if (this.mode() !== 'Edit') return;
    try {
      this.updateActive((doc) =>
        constants.editElement(doc, {
          ...edit,
          weightText: 'weight' in edit.element ? String(edit.element.weight) : '',
        }),
      );
      this.publish();
      this.error.set('');
      this.closeEditor();
    } catch (error) {
      this.dialogError.set((error as Error).message);
    }
  }
  arcTimingLabel(arc: Arc) {
    const timing = this.timing();
    const pair = timing?.transports.find((p) => p.inputArc === arc.id || p.outputArc === arc.id);
    const transition = pair
      ? this.net().arcs.find((a) => a.id === pair.inputArc)?.target
      : undefined;
    const index = pair
      ? timing!.transports
          .filter((p) => this.net().arcs.find((a) => a.id === p.inputArc)?.target === transition)
          .findIndex((p) => p.inputArc === pair.inputArc)
      : -1;
    const input = this.net().nodes.some((n) => n.id === arc.source && n.kind === 'place');
    return `${index >= 0 ? 'Transport ' + (index + 1) + ' ' : ''}${input && arc.kind !== 'inhibitor' && timing ? constants.intervalText(this.activeDocument()!.network, Object.hasOwn(timing.intervals, arc.id) ? timing.intervals[arc.id] : undefined) : ''}`;
  }
  private placeAges(place: string): readonly string[] {
    if (this.mode() === 'Simulate') return this.currentAges()[place] ?? [];
    const pool = this.poolForOccurrence(place);
    if (pool) return pool.timing?.ages ?? [];
    const recorded = this.timing()?.ages;
    return recorded && Object.hasOwn(recorded, place) ? recorded[place] : [];
  }
  canvasAge(place: string, index: number) {
    const age = this.placeAges(place)[index] ?? '0';
    // Desktop draws one fractional digit, truncating without changing the marking.
    const [whole, fraction] = age.split('.');
    return whole + '.' + (fraction?.[0] ?? '0');
  }
  agesText(place: string) {
    const ages = this.placeAges(place);
    if (this.mode() === 'Simulate') return ages.join(', ') || 'empty';
    const node = this.net().nodes.find((n) => n.id === place)!;
    return (
      `${ages.join(', ')}${node.tokens > ages.length ? (ages.length ? '; ' : '') + (node.tokens - ages.length) + ' × 0' : ''}` ||
      'empty'
    );
  }
  historyLabel(index: number, state: NetworkSimulationState) {
    return this.simulator?.label(index) ?? this.transitionName(state.transition);
  }
  historyMarkingText(index: number, state: NetworkSimulationState) {
    return this.simulator?.historyAges(index) ?? this.markingText(state.marking);
  }
  delay() {
    if (!this.currentSimulation() || !this.timed()) return;
    try {
      this.simulator!.delay(this.delayAmount());
      this.publishSimulation();
      this.error.set('');
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  applyElement(element: NetNode | Arc) {
    try {
      this.updateActive((doc) =>
        constants.editElement(doc, {
          element,
          weightText: 'weight' in element ? String(element.weight) : '',
          timing: this.timed() ? constants.timingDraft(doc, element) : null,
        }),
      );
      this.publish();
      this.closeEditor();
    } catch (error) {
      this.dialogError.set((error as Error).message);
    }
  }
  editFromCanvas(event: MouseEvent) {
    if (this.mode() !== 'Edit' || this.tool() !== 'select') return;
    const target = event.target as Element;
    const id =
      target.closest('[data-node]')?.getAttribute('data-node') ??
      target.closest('[data-arc]')?.getAttribute('data-arc') ??
      target.closest('[data-note]')?.getAttribute('data-note');
    if (
      id &&
      event.ctrlKey &&
      target.closest('[data-arc]') &&
      !target.closest('[data-bend], [data-endpoint]')
    ) {
      event.preventDefault();
      this.commit(
        insertArcBend(this.net(), id, this.snapBend(this.point(event)), event.altKey).net,
      );
      return;
    }
    if (target.closest('[data-bend], [data-endpoint]')) return;
    if (id) {
      event.preventDefault();
      this.openEditor(id);
    }
  }
  openContext(event: MouseEvent) {
    event.preventDefault();
    if (
      this.mode() === 'Edit' &&
      (this.tool() === 'arc' || this.tool() === 'inhibitor') &&
      event.ctrlKey
    )
      return;
    this.finishDrag();
    this.closeMenus();
    const target = event.target as Element;
    const id =
      target.closest('[data-node]')?.getAttribute('data-node') ??
      target.closest('[data-arc]')?.getAttribute('data-arc') ??
      target.closest('[data-note]')?.getAttribute('data-note') ??
      null;
    if (id && !this.isSelected(id)) this.selectElement(id);
    this.context.set({
      x: event.clientX,
      y: event.clientY,
      point: this.point(event),
      id,
      ...(target.closest('[data-bend]')
        ? { bend: Number(target.closest('[data-bend]')!.getAttribute('data-bend')) }
        : {}),
      ...(target.closest('[data-endpoint]') ? { endpoint: true } : {}),
    });
  }
  closeContext(restoreFocus = false) {
    this.context.set(null);
    if (restoreFocus) setTimeout(() => this.canvas.nativeElement.focus());
  }
  contextAction(action: string) {
    const context = this.context();
    if (!context) return;
    this.context.set(null);
    const node = this.net().nodes.find((n) => n.id === context.id);
    switch (action) {
      case 'name-visible':
        if (node)
          this.commit(setNodeNameVisible(this.net(), [node.id], node.nameVisible === false));
        break;
      case 'rotate':
        if (node?.kind === 'transition') this.commit(rotateTransitions(this.net(), [node.id], 45));
        break;
      case 'note-border': {
        const note = this.net().annotations?.find((n) => n.id === context.id);
        if (note) this.commit(setAnnotationBorder(this.net(), note.id, note.border === false));
        break;
      }
      case 'note-solid':
        if (context.id) this.commit(setAnnotationFilled(this.net(), context.id, true));
        break;
      case 'annotation':
        this.openAnnotation({ ...this.snapBend(context.point), text: '' });
        return;
      case 'copy':
      case 'cut':
      case 'paste':
        void this.clipboardAction(action);
        break;
      case 'insert-bend':
        if (context.id)
          this.commit(insertArcBend(this.net(), context.id, this.snapBend(context.point)).net);
        break;
      case 'toggle-bend':
        if (context.id)
          this.commit(
            context.endpoint
              ? toggleArcEndCurved(this.net(), context.id)
              : toggleArcBendCurved(this.net(), context.id, context.bend!),
          );
        break;
      case 'split-bend':
        if (context.id) this.commit(splitArcBend(this.net(), context.id, context.bend!));
        break;
      case 'delete-bend':
        if (context.id) this.commit(deleteArcBend(this.net(), context.id, context.bend!));
        break;
      case 'edit':
        this.openEditor(context.id);
        return;
      case 'delete':
        this.remove();
        break;
      case 'duplicate':
        this.duplicate();
        break;
      case 'add-token':
      case 'remove-token':
        if (node?.kind === 'place') this.changeTokens(node.id, action === 'add-token' ? 1 : -1);
        break;
      case 'place':
      case 'transition':
        this.createNode(action, context.point);
        break;
      case 'select-all':
        this.selectAll();
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'fit':
        this.fit();
        break;
      case 'fire':
        if (node) this.fire(node);
        break;
      case 'back':
        this.back();
        break;
      case 'step':
        this.step();
        break;
      case 'reset':
        this.resetSimulation();
        break;
    }
    setTimeout(() => this.canvas.nativeElement.focus());
  }
  private createNode(kind: 'place' | 'transition', point: { x: number; y: number }) {
    const node: NetNode = {
      id: this.newId(),
      kind,
      name: this.nextNodeName(this.net(), kind),
      x: snapNodeCenter(point.x, this.gridSpacing()),
      y: snapNodeCenter(point.y, this.gridSpacing()),
      tokens: 0,
    };
    if (this.commit({ ...this.net(), nodes: [...this.net().nodes, node] }))
      this.selectElement(node.id);
  }
  private observeNodeNames(net: Net) {
    for (const node of net.nodes) {
      const match = /^(P|T)(\d+)$/i.exec(node.name);
      if (!match) continue;
      const kind = match[1].toUpperCase() === 'P' ? 'place' : 'transition';
      const next = BigInt(match[2]) + 1n;
      if (next > this.nameHighWater[kind]) this.nameHighWater[kind] = next;
    }
  }
  private nextNodeName(net: Net, kind: NetNode['kind']) {
    this.observeNodeNames(net);
    const prefix = kind === 'place' ? 'P' : 'T';
    let name: string;
    do {
      name = `${prefix}${this.nameHighWater[kind]++}`;
    } while (
      net.nodes.some((node) => node.name === name) ||
      [
        ...(this.activeDocument()?.network.shared.places ?? []),
        ...(this.activeDocument()?.network.shared.transitions ?? []),
      ].some((p) => p.name === name)
    );
    return name;
  }
  @HostListener('document:pointerdown', ['$event']) outsideMenus(event: PointerEvent) {
    if (!(event.target as Element).closest('details')) this.closeMenus();
  }
  prepareMenu(event: Event) {
    const current = (event.target as Element).closest('details');
    document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
      if (menu !== current && menu.classList.contains('folded-menu')) menu.open = false;
    });
  }
  private menuKey(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const menu = target.closest<HTMLDetailsElement>('.folded-menu');
    if (!menu) return false;
    const summary = menu.querySelector<HTMLElement>('summary')!;
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(target as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenus();
      summary.focus();
      return true;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.prepareMenu(event);
      menu.open = true;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % buttons.length
              : index <= 0
                ? buttons.length - 1
                : index - 1;
      buttons[next]?.focus();
      return true;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const menus = Array.from(
        document.querySelectorAll<HTMLDetailsElement>('.menubar .folded-menu'),
      );
      const next =
        menus[
          (menus.indexOf(menu) + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length
        ];
      this.closeMenus();
      next?.querySelector<HTMLElement>('summary')?.focus();
      return true;
    }
    return false;
  }
  closeMenus() {
    document
      .querySelectorAll<HTMLDetailsElement>('details.folded-menu[open]')
      .forEach((menu) => (menu.open = false));
  }
  private internalClipboard: SelectionPayload | null = null;
  private clipboardOperation = 0;
  private clipboardBlocked(target?: EventTarget | null) {
    return !!(
      this.galleryOpen() ||
      this.transitionDialog() ||
      this.sharedDialog() ||
      this.tokenDraft() ||
      this.constantDraft() ||
      this.editingElement() ||
      this.annotationEditor() ||
      this.pending() ||
      this.documentDialog() ||
      this.closingDocument() ||
      (target instanceof Element &&
        target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
    );
  }
  /** Keyboard shortcuts use the browser's clipboard events, never a second keydown action. */
  @HostListener('document:copy', ['$event'])
  @HostListener('document:cut', ['$event'])
  @HostListener('document:paste', ['$event'])
  clipboardEvent(event: ClipboardEvent) {
    if (this.clipboardBlocked(event.target) || !this.activeDocument()) return;
    if (!['copy', 'cut', 'paste'].includes(event.type)) return;
    event.preventDefault();
    void this.clipboardAction(event.type as 'copy' | 'cut' | 'paste', event);
  }
  async clipboardAction(action: 'copy' | 'cut' | 'paste', event?: ClipboardEvent) {
    if (this.clipboardBlocked(event?.target) || !this.activeDocument()) return;
    if (this.mode() !== 'Edit') return;
    this.finishDrag();
    const origin = this.workspace(),
      operation = ++this.clipboardOperation,
      selectionGeneration = this.selectionGeneration,
      selection = [...this.selectedIds()];
    const unchanged = () => {
      if (
        this.workspace() === origin &&
        operation === this.clipboardOperation &&
        (action !== 'cut' ||
          (selectionGeneration === this.selectionGeneration &&
            this.selectedIds().length === selection.length &&
            selection.every((id) => this.selectedIds().includes(id)))) &&
        this.mode() === 'Edit' &&
        !this.clipboardBlocked()
      )
        return true;
      this.notice.set(
        'Clipboard action cancelled because the document, component, selection, or edits changed.',
      );
      return false;
    };
    try {
      if (this.activeDocument()!.network.type.game)
        throw new Error(
          'Game subnet clipboard transfers are unavailable; copy a component to preserve roles. Nothing was changed.',
        );
      if (action !== 'copy')
        requireEditableModelType(this.activeDocument()!.network.type, { timed: true, game: true });
      if (action === 'paste') {
        let text: string | null = null,
          webText: string | null = null,
          denied = false;
        const internal = this.internalClipboard;
        try {
          if (event?.clipboardData) {
            text = event.clipboardData.getData('text/plain');
          } else if (navigator.clipboard?.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              if (item.types.includes('text/plain'))
                text = await (await item.getType('text/plain')).text();
              if (item.types.includes(WEB_CLIPBOARD_TYPE))
                webText = await (await item.getType(WEB_CLIPBOARD_TYPE)).text();
            }
          } else if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
          else denied = true;
        } catch {
          denied = true;
        }
        if (!unchanged()) return;
        const result = readSelectionClipboard({ text, webText, internal });
        if (this.pasteSelectionContent(result.content)) {
          this.notice.set(
            `${denied ? (result.source === 'internal' ? 'System clipboard unavailable (permission denied or insecure context); pasted internal TAPAAL Web copy. ' : 'System clipboard partly unavailable; pasted readable clipboard content. ') : 'Pasted. '}${result.droppedArcs ? `${result.droppedArcs} arcs were not pasted because their endpoints were not copied.` : ''}`,
          );
        }
      } else {
        const cut = action === 'cut';
        const payload = docs.copySelection(docs.getDocument(origin), selection);
        this.internalClipboard = payload;
        let system = false;
        try {
          if (event?.clipboardData) {
            event.clipboardData.setData('text/plain', payload.nativeText);
            system = true;
          } else {
            if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({
                    'text/plain': new Blob([payload.nativeText], { type: 'text/plain' }),
                    [WEB_CLIPBOARD_TYPE]: new Blob([payload.webText], {
                      type: 'application/x-tapaal-clipboard+json',
                    }),
                  }),
                ]);
                system = true;
              } catch {
                /* Unsupported custom formats fall back to the same text/plain payload. */
              }
            }
            if (!system && navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(payload.nativeText);
              system = true;
            }
          }
        } catch {
          /* The immutable internal payload remains recoverable, including after cut. */
        }
        const transferNote =
          payload.nativeText === payload.webText ||
          payload.nativeText.includes('tapaal-web-clipboard')
            ? ' Web envelope preserves constant references, timing, annotations, hidden names and arc label offsets where present; desktop TAPAAL clipboard transfer is unavailable for this selection.'
            : '';
        if (!unchanged()) {
          if (!cut)
            this.notice.set(
              system
                ? `Copied from the earlier state; the document or view changed while copying.${transferNote}`
                : 'Copied from the earlier state inside TAPAAL Web only; system clipboard unavailable (permission denied or insecure context). Other apps cannot paste it.',
            );
          return;
        }
        if (cut) {
          this.updateActive((doc) => docs.removeComponentElements(doc, selection));
          this.publish();
        }
        this.error.set('');
        if (cut) this.setSelection([]);
        this.notice.set(
          system
            ? `${cut ? 'Cut' : 'Copied'} selection.${transferNote}`
            : `${cut ? 'Cut' : 'Copied'} inside TAPAAL Web only; system clipboard unavailable (permission denied or insecure context). Other apps cannot paste it.`,
        );
      }
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  duplicate() {
    if (this.mode() !== 'Edit' || this.clipboardBlocked()) return;
    this.finishDrag();
    try {
      const payload = docs.copySelection(this.activeDocument()!, [...this.selectedIds()]);
      this.pasteSelectionContent(payload.content);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  private pasteSelectionContent(content: SelectionPayload['content']): boolean {
    const options = {
      nodeName: (net: Net, kind: NetNode['kind']) => this.nextNodeName(net, kind),
      elementId: () => this.newId(),
    };
    if (isAuthoredClipboard(content)) {
      const pasted = docs.pasteAuthoredSelection(this.activeDocument()!, content, options);
      this.updateActive(() => pasted.document);
      this.publish();
      this.setSelection(pasted.selectedIds);
      this.error.set('');
      return true;
    }
    const pasted = pasteClipboard(this.net(), content, { ...options, timedTarget: this.timed() });
    if (!this.commitClipboardPaste(pasted, content.timing)) return false;
    this.setSelection(pasted.selectedIds);
    return true;
  }
  private numericTiming() {
    const doc = this.activeDocument();
    return doc
      ? docs.displayNumeric(doc.network).components.find((c) => c.id === doc.session.componentId)
          ?.timing
      : undefined;
  }
  private commitClipboardPaste(
    result: ReturnType<typeof pasteClipboard>,
    timing?: docs.ComponentTiming,
  ): boolean {
    if (!this.timed()) return this.commit(result.net);
    this.updateActive((doc) =>
      docs.commitTimedComponent(
        doc,
        result.net,
        pasteTiming(this.numericTiming()!, timing, result.idMap),
      ),
    );
    this.publish();
    this.error.set('');
    return true;
  }
  selectAll() {
    this.setSelection(
      [...this.net().nodes, ...this.net().arcs, ...(this.net().annotations ?? [])].map(
        (element) => element.id,
      ),
    );
  }
  align(axis: 'x' | 'y') {
    if (this.mode() !== 'Edit' || this.selectedNodes().length < 2) return;
    this.finishDrag();
    const nodes = this.selectedNodes();
    const position = nodes.reduce((sum, node) => sum + node[axis], 0) / nodes.length;
    this.commit({
      ...this.net(),
      nodes: this.net().nodes.map((node) =>
        this.isSelected(node.id) ? { ...node, [axis]: position } : node,
      ),
    });
  }
  cancelPending() {
    this.pending.set(null);
    this.pendingFocus?.focus();
  }

  private newId() {
    let id: string;
    do {
      id = `web-${++this.nextId}`;
    } while (
      this.net().nodes.some((n) => n.id === id) ||
      this.net().arcs.some((a) => a.id === id) ||
      this.net().annotations?.some((n) => n.id === id)
    );
    return id;
  }
  ngAfterViewInit() {
    document.title = 'TAPAAL — Petri net editor';
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        this.canvasSize.set({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    // Observe the HTML viewport: SVG contentRect can report drawing-space bounds.
    this.resizeObserver.observe(this.canvas.nativeElement.parentElement!);
    // Explicitly non-passive: Ctrl+wheel must not zoom the browser page as well.
    this.canvas.nativeElement.addEventListener('wheel', this.wheelListener, { passive: false });
  }
  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.canvas.nativeElement.removeEventListener('wheel', this.wheelListener);
  }
  private publish() {
    if (this.mode() === 'Simulate') this.currentSimulation();
    const doc = this.activeDocument();
    this.net.set(
      doc ? docs.activeNet(doc) : { name: 'No model open', template: 'Net', nodes: [], arcs: [] },
    );
    const key = doc ? `${doc.id}/${doc.session.componentId}` : '';
    this.nameHighWater = this.naming.get(key) ?? { place: 0n, transition: 0n };
    if (doc) this.naming.set(key, this.nameHighWater);
    this.observeNodeNames(this.net());
    this.dirty.set(doc ? docs.isDirty(doc) : false);
    this.canUndo.set(!!doc?.past.length);
    this.canRedo.set(!!doc?.future.length);
    if (this.mode() === 'Edit') {
      this.marking.set(initialMarking(this.net()));
      this.physicalTokens.set(
        doc
          ? doc.network.shared.places.reduce((sum, p) => sum + p.tokens, 0) +
              doc.network.components.reduce(
                (sum, c) =>
                  sum +
                  c.net.nodes.reduce(
                    (count, n) =>
                      count + (!docs.isSharedOccurrence(n) && n.kind === 'place' ? n.tokens : 0),
                    0,
                  ),
                0,
              )
          : 0,
      );
    }
    this.setSelection(
      this.selectedIds().filter((id) =>
        [...this.net().nodes, ...this.net().arcs, ...(this.net().annotations ?? [])].some(
          (element) => element.id === id,
        ),
      ),
      false,
    );
  }
  private commit(next: Net): boolean {
    if (this.mode() !== 'Edit') return false;
    try {
      if (!this.activeDocument()) return false;
      this.updateActive((doc) => docs.commitComponentNet(doc, next));
      this.publish();
      this.error.set('');
      return true;
    } catch (e) {
      this.error.set(
        (e as Error).message.replace(
          'use setPlaceTokenAges to choose which tokens to remove',
          'open Edit place and change Initial ages and Marking together to choose which tokens to remove',
        ),
      );
      return false;
    }
  }
  tokens(node: NetNode) {
    return node.kind === 'place' ? this.marking()[node.id] : 0;
  }
  nodeName(id: string | null) {
    return this.net().nodes.find((n) => n.id === id)?.name || '';
  }
  private cancelDraft() {
    this.arcStart.set(null);
    this.arcPointer.set(null);
    this.draftBends.set([]);
    this.draftCurvedEnd.set(false);
  }
  private snapBend(point: { x: number; y: number }) {
    return {
      x: snapToGrid(point.x, this.gridSpacing()),
      y: snapToGrid(point.y, this.gridSpacing()),
    };
  }
  setTool(tool: Tool) {
    this.tool.set(tool);
    this.cancelDraft();
    this.notice.set(
      tool === 'arc' || tool === 'inhibitor'
        ? 'Click the source, then the target. Inhibitors go from places to transitions.'
        : `${tool} tool selected.`,
    );
  }
  setMode(mode: 'Edit' | 'Simulate') {
    this.cancelTokenSelection();
    if (this.mode() === mode) return;
    let nextSimulation: DocumentSimulation | undefined;
    if (mode === 'Simulate') {
      const doc = this.activeDocument();
      if (!doc) return;
      this.finishDrag();
      try {
        // Construction validates the exact type flags and the whole network.
        nextSimulation = new DocumentSimulation(this.activeDocument()!.network);
      } catch (error) {
        this.error.set((error as Error).message);
        return;
      }
      this.rememberView();
    }
    this.finishDrag();
    this.context.set(null);
    this.mode.set(mode);
    this.cancelDraft();
    this.tool.set('select');
    this.error.set('');
    if (mode === 'Simulate') {
      this.simulator = nextSimulation!;
      this.simulationSource = {
        documentId: this.activeDocument()!.id,
        network: this.activeDocument()!.network,
        generation: this.sourceGeneration,
      };
      this.traceOpen.set(false);
      this.publishSimulation();
      this.notice.set(
        'Click an enabled transition to fire it. Use Back, Forward and Reset to explore the trace.',
      );
    } else {
      this.simulator = undefined;
      this.simulationSource = undefined;
      this.enabledTransitions.set([]);
      const view = this.activeDocument()?.session.views[this.activeDocument()!.session.componentId];
      if (view) this.setSelection([...view.selectedIds], false);
      this.marking.set(initialMarking(this.net()));
      this.trace.set([]);
      this.cursor.set(0);
      this.canBack.set(false);
      this.canForward.set(false);
      this.notice.set(
        'Editing initial marking. S select · P place · T transition · A arc · I inhibitor · H pan',
      );
    }
  }
  undo() {
    if (this.mode() !== 'Edit') return;
    this.finishDrag();
    this.rememberView();
    const componentId = this.activeDocument()?.session.componentId;
    this.updateActive(docs.undoDocument);
    this.cancelDraft();
    if (componentId !== this.activeDocument()?.session.componentId) this.restoreView();
    else this.publish();
    this.error.set('');
  }
  redo() {
    if (this.mode() !== 'Edit') return;
    this.finishDrag();
    this.rememberView();
    const componentId = this.activeDocument()?.session.componentId;
    this.updateActive(docs.redoDocument);
    this.cancelDraft();
    if (componentId !== this.activeDocument()?.session.componentId) this.restoreView();
    else this.publish();
    this.error.set('');
  }
  edit(field: 'name' | 'tokens' | 'x' | 'y', event: Event) {
    const input = event.target as HTMLInputElement,
      node = this.selected();
    if (!node) return;
    const raw = input.value.trim();
    const value = field === 'name' ? raw : raw === '' ? NaN : Number(raw);
    this.commit({
      ...this.net(),
      nodes: this.net().nodes.map((n) => (n.id === node.id ? { ...n, [field]: value } : n)),
    });
    input.value = String(this.selected()?.[field] ?? node[field]);
  }
  editDocument(field: 'name' | 'template', event: Event) {
    const input = event.target as HTMLInputElement;
    if (this.mode() !== 'Edit') return;
    this.documentOperation((doc) =>
      field === 'name'
        ? docs.renameDocument(doc, input.value.trim())
        : docs.renameComponent(doc, doc.session.componentId, input.value.trim()),
    );
    input.value = this.net()[field];
  }
  editArc(field: 'weight' | 'kind', event: Event) {
    const input = event.target as HTMLInputElement,
      arc = this.selectedArc();
    if (!arc) return;
    try {
      const element = field === 'kind' ? { ...arc, kind: input.value as Arc['kind'] } : arc;
      this.updateActive((doc) =>
        constants.editElement(doc, {
          element,
          weightText: field === 'weight' ? input.value : this.weightText(arc),
          timing: this.timed() ? constants.timingDraft(doc, arc) : null,
        }),
      );
      this.publish();
      this.error.set('');
    } catch (error) {
      this.error.set((error as Error).message);
    }
    input.value =
      field === 'weight' ? this.weightText(arc) : (this.selectedArc()?.kind ?? arc.kind);
  }

  remove() {
    if (!this.selectionCount() || this.mode() !== 'Edit') return;
    this.finishDrag();
    try {
      this.updateActive((doc) => docs.removeComponentElements(doc, this.selectedIds()));
      this.publish();
      this.error.set('');
      this.setSelection([]);
      this.cancelDraft();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  point(event: PointerEvent | WheelEvent | MouseEvent) {
    const svg = event.currentTarget as SVGSVGElement,
      point = new DOMPoint(event.clientX, event.clientY),
      matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }
  private middlePress?: { x: number; y: number; nodeId?: string; moved: boolean };
  pointerDown(event: PointerEvent) {
    if (
      !this.activeDocument() ||
      this.galleryOpen() ||
      this.transitionDialog() ||
      this.sharedDialog() ||
      this.tokenDraft() ||
      this.constantDraft() ||
      this.editingElement() ||
      this.annotationEditor() ||
      this.pending() ||
      this.documentDialog() ||
      this.closingDocument()
    )
      return;
    if (event.button === 1 || (event.button === 0 && this.tool() === 'pan')) {
      this.finishDrag();
      if (
        event.button === 1 &&
        this.mode() === 'Edit' &&
        this.tool() === 'arc' &&
        !(event.target as Element).closest('[data-arc],[data-note],[data-bend]')
      ) {
        const nodeId =
          (event.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? undefined;
        this.middlePress = { x: event.clientX, y: event.clientY, nodeId, moved: false };
      }
      event.preventDefault();
      this.canvas.nativeElement.focus({ preventScroll: true });
      this.drag = {
        start: this.point(event),
        before: this.net(),
        selectedBefore: this.selectedIds(),
        pan: { clientX: event.clientX, clientY: event.clientY, view: this.viewport() },
      };
      this.panning.set(true);
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as Element,
      id = target.closest('[data-node]')?.getAttribute('data-node'),
      node = this.net().nodes.find((n) => n.id === id),
      point = this.point(event);
    if (this.mode() === 'Edit' && (this.tool() === 'arc' || this.tool() === 'inhibitor')) {
      if (!node && target.closest('[data-arc]')) return;
      event.preventDefault();
      this.canvas.nativeElement.focus({ preventScroll: true });
      this.drawArcPress(
        node
          ? { target: 'node', nodeId: node.id, ctrlKey: event.ctrlKey }
          : { target: 'canvas', point, ctrlKey: event.ctrlKey },
        event.shiftKey,
      );
      return;
    }
    if (this.mode() === 'Edit' && (this.tool() === 'add-token' || this.tool() === 'remove-token')) {
      if (node?.kind === 'place') this.changeTokens(node.id, this.tool() === 'add-token' ? 1 : -1);
      return;
    }
    const noteId = target.closest('[data-note]')?.getAttribute('data-note');
    if (noteId && this.mode() === 'Edit' && this.tool() === 'select') {
      this.canvas.nativeElement.focus({ preventScroll: true });
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        this.selectElement(noteId, true);
        if (!this.isSelected(noteId)) return;
      } else if (!this.isSelected(noteId)) this.selectElement(noteId);
      const handle = target
        .closest('[data-resize]')
        ?.getAttribute('data-resize') as ResizeHandle | null;
      this.drag = {
        start: point,
        before: this.net(),
        selectedBefore: this.selectedIds(),
        note: noteId,
        ...(handle ? { resize: { id: noteId, handle } } : {}),
      };
      return;
    }
    const labelArc = target.closest('.arc-label')?.closest('[data-arc]')?.getAttribute('data-arc');
    if (labelArc && this.mode() === 'Edit' && this.tool() === 'select') {
      this.canvas.nativeElement.focus({ preventScroll: true });
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        this.selectElement(labelArc, true);
        if (!this.isSelected(labelArc)) return;
      } else if (!this.isSelected(labelArc)) this.selectElement(labelArc);
      this.drag = {
        start: point,
        before: this.net(),
        selectedBefore: this.selectedIds(),
        arcLabel: labelArc,
      };
      event.preventDefault();
      return;
    }
    const bendHandle = target.closest('[data-bend]');
    if (bendHandle && this.mode() === 'Edit' && this.tool() === 'select') {
      this.canvas.nativeElement.focus({ preventScroll: true });
      const arcId = target.closest('[data-arc]')!.getAttribute('data-arc')!;
      this.drag = {
        start: point,
        before: this.net(),
        selectedBefore: this.selectedIds(),
        bend: { arcId, index: Number(bendHandle.getAttribute('data-bend')) },
      };
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      return;
    }
    if (target.closest('[data-endpoint]')) return;
    if (node) {
      if (this.mode() === 'Edit' && this.tool() === 'select') {
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          this.selectElement(node.id, true);
          if (!this.isSelected(node.id)) return;
        } else if (!this.isSelected(node.id)) this.selectElement(node.id);
      } else this.selectElement(node.id);
      if (this.mode() === 'Simulate') {
        if (node.kind === 'transition') this.fire(node);
        return;
      }
      if (this.tool() === 'arc' || this.tool() === 'inhibitor') {
        this.connect(node);
        return;
      }
      if (this.tool() === 'select') {
        this.canvas.nativeElement.focus({ preventScroll: true });
        this.drag = {
          start: point,
          node: { ...node },
          ...(target.closest('.node-name, .invariant-label') ? { label: node.id } : {}),
          before: structuredClone(this.net()),
          selectedBefore: this.selectedIds(),
        };
        // Capture only after movement so native double-click still targets the node.
      }
      return;
    }
    const arc = target.closest('[data-arc]')?.getAttribute('data-arc');
    if (arc) {
      this.selectElement(arc, event.shiftKey || event.ctrlKey || event.metaKey);
      return;
    }
    if (this.mode() === 'Edit' && this.tool() === 'select') {
      const selectedBefore = [...this.selectedIds()];
      if (!event.shiftKey) this.setSelection([]);
      this.drag = {
        start: point,
        before: this.net(),
        marquee: true,
        selectedBefore,
        additiveIds: event.shiftKey ? selectedBefore : [],
      };
      this.marquee.set({ x: point.x, y: point.y, width: 0, height: 0 });
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      return;
    }
    this.setSelection([]);
    if (this.mode() === 'Edit' && this.tool() === 'annotation') {
      this.openAnnotation({ ...this.snapBend(point), text: '' });
      return;
    }
    if (this.mode() === 'Edit' && (this.tool() === 'place' || this.tool() === 'transition')) {
      this.createNode(this.tool() as 'place' | 'transition', point);
    }
  }
  pointerMove(event: PointerEvent) {
    if (
      this.middlePress &&
      Math.hypot(event.clientX - this.middlePress.x, event.clientY - this.middlePress.y) > 4
    )
      this.middlePress.moved = true;
    if (this.arcStart() && !this.drag?.pan) {
      const id = (event.target as Element).closest('[data-node]')?.getAttribute('data-node');
      this.draftCurvedEnd.set(event.shiftKey);
      const point = this.point(event);
      this.arcPointer.set({ x: point.x, y: point.y, ...(id ? { nodeId: id } : {}) });
    }
    if (!this.drag) return;
    if (this.drag.pan) {
      const pan = this.drag.pan;
      this.viewport.set(
        panViewport(pan.view, { x: pan.clientX - event.clientX, y: pan.clientY - event.clientY }),
      );
      return;
    }
    const point = this.point(event),
      dx = point.x - this.drag.start.x,
      dy = point.y - this.drag.start.y;
    if (this.drag.marquee) {
      this.marquee.set({
        x: Math.min(point.x, this.drag.start.x),
        y: Math.min(point.y, this.drag.start.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
      this.setSelection([
        ...new Set([
          ...(this.drag.additiveIds ?? []),
          ...selectInRectangle(this.net(), {
            x1: this.drag.start.x,
            y1: this.drag.start.y,
            x2: point.x,
            y2: point.y,
          }),
        ]),
      ]);
    } else if (this.drag.bend) {
      const { arcId, index } = this.drag.bend;
      const bend = this.drag.before.arcs.find((a) => a.id === arcId)!.bends![index];
      this.drag.moved = true;
      this.net.set(
        moveArcBend(
          this.drag.before,
          arcId,
          index,
          this.snapBend({ x: bend.x + dx, y: bend.y + dy }),
        ),
      );
    } else if (this.drag.label || this.drag.arcLabel || this.drag.note) {
      if (!this.drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!this.drag.moved) (event.currentTarget as Element).setPointerCapture(event.pointerId);
      this.drag.moved = true;
      const delta = { x: Math.round(dx), y: Math.round(dy) };
      this.net.set(
        this.drag.arcLabel
          ? moveArcLabel(this.drag.before, this.drag.arcLabel, {
              x: Math.trunc(dx),
              y: Math.trunc(dy),
            })
          : this.drag.label
            ? moveNodeLabel(this.drag.before, this.drag.label, delta)
            : this.drag.resize
              ? resizeAnnotation(
                  this.drag.before,
                  this.drag.resize.id,
                  this.drag.resize.handle,
                  delta,
                  (width) =>
                    this.noteLines({
                      ...this.drag!.before.annotations!.find((n) => n.id === this.drag!.note)!,
                      width,
                    }).length * 16,
                )
              : moveSelection(this.drag.before, this.drag.selectedBefore, {
                  x: Math.round(snapToGrid(dx, this.gridSpacing())),
                  y: Math.round(snapToGrid(dy, this.gridSpacing())),
                }),
      );
    } else if (this.drag.node) {
      if (!this.drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!this.drag.moved) (event.currentTarget as Element).setPointerCapture(event.pointerId);
      this.drag.moved = true;
      this.net.set(
        moveSelection(this.drag.before, this.drag.selectedBefore, {
          x: Math.round(snapToGrid(dx, this.gridSpacing())),
          y: Math.round(snapToGrid(dy, this.gridSpacing())),
        }),
      );
    }
  }
  private finishDrag(cancel = false) {
    this.middlePress = undefined;
    if (
      (this.drag?.node || this.drag?.bend || this.drag?.arcLabel || this.drag?.note) &&
      this.drag.moved
    ) {
      const preview = this.net();
      this.net.set(this.drag.before);
      if (!cancel) this.commit(preview);
    }
    if (cancel && this.drag?.marquee) this.setSelection(this.drag.selectedBefore, false);
    this.marquee.set(null);
    this.panning.set(false);
    this.drag = undefined;
  }
  pointerUp(event: PointerEvent) {
    const middle = this.middlePress;
    if (middle && Math.hypot(event.clientX - middle.x, event.clientY - middle.y) > 4)
      middle.moved = true;
    if (middle && !middle.moved && this.drag?.pan) this.viewport.set(this.drag.pan.view);
    this.middlePress = undefined;
    this.finishDrag(event.type === 'pointercancel');
    if (
      middle &&
      !middle.moved &&
      event.type !== 'pointercancel' &&
      this.mode() === 'Edit' &&
      this.tool() === 'arc'
    ) {
      this.drawArcPress(
        middle.nodeId
          ? { target: 'node', nodeId: middle.nodeId, ctrlKey: true }
          : { target: 'canvas', point: this.point(event), ctrlKey: true },
      );
    }
    const svg = event.currentTarget as Element;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  connect(node: NetNode) {
    this.drawArcPress({ target: 'node', nodeId: node.id, ctrlKey: false });
  }
  private drawArcPress(press: QuickDrawPress, curved = false) {
    const before = this.net();
    try {
      let result = quickDrawPress(before, this.tool(), this.arcStart(), press, {
        gridSpacing: this.gridSpacing() || null,
        nodeName: (net, kind) => this.nextNodeName(net, kind),
      });
      if (
        result.plan.action === 'ignore' &&
        result.plan.reason === 'bend-points-unsupported' &&
        press.target === 'canvas'
      ) {
        this.addPendingArcBend(press.point, curved);
        return;
      }
      if (result.createdArcIds.length) {
        result = {
          ...result,
          net: {
            ...result.net,
            arcs: result.net.arcs.map((arc) =>
              result.createdArcIds.includes(arc.id)
                ? withBends(arc, this.draftBends(), press.ctrlKey ? false : curved)
                : arc,
            ),
          },
        };
      }
      if (result.changed) {
        // Native GuiModelManager records node creation before arc creation.
        if (
          result.createdNodeIds.length &&
          result.createdArcIds.length &&
          !this.commit({ ...result.net, arcs: before.arcs })
        )
          return;
        if (!this.commit(result.net)) return;
      }
      if (result.plan.action !== 'ignore') {
        this.draftBends.set([]);
        this.draftCurvedEnd.set(false);
      }
      this.arcStart.set(result.sourceId);
      const source = result.net.nodes.find((node) => node.id === result.sourceId);
      this.arcPointer.set(source ? { x: source.x, y: source.y } : null);
      if (result.error) this.error.set(result.error);
      else if (result.plan.action !== 'ignore') this.error.set('');
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
  addPendingArcBend(point: { x: number; y: number }, curved: boolean): boolean {
    if (!this.arcStart() || this.mode() !== 'Edit') return false;
    const bend = this.snapBend(point);
    if (
      ![bend.x, bend.y].every(Number.isFinite) ||
      this.draftBends().length >= 1000 ||
      Math.max(Math.abs(bend.x), Math.abs(bend.y)) > 1_000_000
    )
      return false;
    this.draftBends.update((bends) => [...bends, { ...bend, curved }]);
    this.draftCurvedEnd.set(curved);
    return true;
  }
  toolHint() {
    const hints: Record<string, string> = {
      select: 'Select: drag to select; drag selected objects to move.',
      annotation: 'Annotation: click the canvas to add text. N annotation · +/− token tools.',
      'add-token': 'Add token: click a place to add one initial token.',
      'remove-token': 'Remove token: click a place to remove one initial token.',
      pan: 'Pan: drag the canvas to move the view.',
      place: 'Place: click the canvas to add a place.',
      transition: 'Transition: click the canvas to add a transition.',
      arc: 'Arc: click source and target; middle-click or Ctrl+click to chain nodes. Middle-drag pans.',
      inhibitor: 'Inhibitor: click place then transition; Ctrl+click creates nodes.',
    };
    return hints[this.tool()] ?? 'Select an editing tool.';
  }
  arcPath(arc: Arc) {
    return this.arcGeometries().get(arc.id)!.d;
  }
  arcLabel(arc: Arc) {
    const point = this.arcGeometries().get(arc.id)!.midpoint;
    return arcLabelPosition(arc, point);
  }
  zoomTo(percent: number) {
    this.finishDrag();
    this.viewport.update((view) => zoomViewport(view, percent));
    this.fitted.set(false);
  }
  zoomBy(direction: number) {
    this.zoomTo(this.zoom() + (direction > 0 ? ZOOM_STEP : -ZOOM_STEP));
  }
  changeZoom(event: Event) {
    this.zoomTo(Number((event.target as HTMLInputElement).value));
  }
  wheel(event: WheelEvent) {
    if (
      !this.activeDocument() ||
      this.galleryOpen() ||
      this.transitionDialog() ||
      this.sharedDialog() ||
      this.tokenDraft() ||
      this.constantDraft() ||
      this.editingElement() ||
      this.annotationEditor() ||
      this.pending() ||
      this.documentDialog() ||
      this.closingDocument()
    )
      return;
    event.preventDefault();
    if (this.drag) return;
    const nodeId = (event.target as Element | null)
      ?.closest('[data-node]')
      ?.getAttribute('data-node');
    const node = this.net().nodes.find((n) => n.id === nodeId);
    // Native dispatches selected-element wheel actions before forwarding modifiers to canvas.
    if (this.mode() === 'Edit' && node && this.isSelected(node.id) && event.deltaY !== 0) {
      if (node.kind === 'transition')
        this.commit(
          rotateTransitions(this.net(), [node.id], wheelRotation(Math.sign(event.deltaY))),
        );
      else this.changeTokens(node.id, event.deltaY < 0 ? 1 : -1);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.deltaY !== 0) this.zoomBy(event.deltaY > 0 ? 1 : -1);
    } else {
      this.viewport.update((view) => panViewport(view, wheelPixels(event, this.canvasSize())));
    }
  }
  actualSize() {
    this.zoomTo(100);
  }
  toggleFit() {
    if (this.fitted()) this.actualSize();
    else this.fit();
  }
  fit() {
    this.finishDrag();
    const bounds = layoutBounds(
      this.net(),
      undefined,
      (id) => {
        const arc = this.net().arcs.find((a) => a.id === id)!;
        const group = Array.from(this.canvas.nativeElement.querySelectorAll('.net-arc')).find(
          (element) => element.getAttribute('data-arc') === id,
        );
        const text = group?.querySelector<SVGTextElement>('.arc-label');
        const measured = text?.getBBox?.();
        return {
          width: Math.max(
            measured?.width ?? 0,
            (this.arcWeightLabel(arc) + ' ' + this.arcTimingLabel(arc)).length * 8 + 8,
          ),
          height: Math.max(18, measured?.height ?? 0),
        };
      },
      (node) => this.invariantLabel(node),
    );
    if (bounds)
      this.viewport.set(
        fitViewport(
          {
            x: bounds.minX,
            y: bounds.minY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
          },
          this.canvasSize(),
        ),
      );
    this.fitted.set(true);
  }
  cycleGrid() {
    this.finishDrag();
    this.gridIndex.update((index) => (index + 1) % GRID_SPACINGS.length);
    this.notice.set(
      this.gridSpacing()
        ? `Grid: ${this.gridSpacing()} units; snapping enabled.`
        : 'Grid off; snapping disabled.',
    );
  }
  alignToGrid() {
    if (this.mode() !== 'Edit' || !this.gridSpacing()) return;
    this.finishDrag();
    const nodes = this.net().nodes.map((node) => ({
      ...node,
      x: snapNodeCenter(node.x, this.gridSpacing()),
      y: snapNodeCenter(node.y, this.gridSpacing()),
    }));
    // Native's Quadtree checks a 45-pixel square around each aligned node.
    if (
      nodes.some((node, i) =>
        nodes
          .slice(i + 1)
          .some(
            (other) =>
              (Math.abs(node.x - other.x) * this.zoom()) / 100 <= 45 &&
              (Math.abs(node.y - other.y) * this.zoom()) / 100 <= 45,
          ),
      )
    ) {
      this.notice.set('Cannot align: nodes would fall within the native 45-pixel clearance.');
      return;
    }
    this.commit({ ...this.net(), nodes });
  }
  private currentSimulation(): boolean {
    if (!this.simulator) return false;
    const doc = this.activeDocument();
    // Session/checkpoint updates preserve source identity. Generation also rejects undo/redo ABA.
    if (
      doc?.id === this.simulationSource?.documentId &&
      doc?.network === this.simulationSource?.network &&
      this.sourceGeneration === this.simulationSource?.generation
    ) {
      this.simulator.assertRevision(doc!.network);
      return true;
    }
    this.setMode('Edit');
    this.publish();
    this.notice.set('Simulation ended because the document revision changed.');
    return false;
  }
  private publishSimulation() {
    this.cancelTokenSelection();
    if (!this.currentSimulation()) return;
    this.physicalTokens.set(this.simulator!.totalTokens);
    this.marking.set(this.simulator!.markingFor(this.activeDocument()!.session.componentId));
    this.legalDelay.set(this.simulator!.legalDelay);
    this.globalTime.set(this.simulator!.time);
    this.currentAges.set(
      Object.fromEntries(
        this.places().map((n) => [
          n.id,
          this.simulator!.ages(n.id, this.activeDocument()!.session.componentId),
        ]),
      ),
    );
    this.trace.set(this.simulator!.trace);
    this.cursor.set(this.simulator!.cursor);
    this.canBack.set(this.simulator!.canBack);
    this.canForward.set(this.simulator!.canForward);
    this.enabledTransitions.set(this.simulator!.enabled);
    const enabled = this.enabledIds();
    if (!enabled.includes(this.selection() ?? ''))
      this.setSelection(
        !this.activeDocument()?.network.type.game && enabled.length ? [enabled[0]] : [],
      );
  }
  enabled(node: NetNode) {
    return this.enabledIds().includes(node.id);
  }
  fire(node: NetNode) {
    const componentId = this.activeDocument()?.session.componentId;
    if (componentId) this.fireEnabled({ componentId, elementId: node.id });
  }
  step() {
    if (!this.currentSimulation()) return;
    if (this.simulator!.canForward) {
      this.simulator!.forward();
      this.publishSimulation();
      return;
    }
    if (this.activeDocument()?.network.type.game) {
      this.fireSelected();
      return;
    }
    const ref = this.enabledTransitions()[0];
    if (ref) this.fireEnabled(ref);
    else this.notice.set('Deadlock: no enabled transitions in the active network.');
  }
  fireSelected() {
    const node = this.selected();
    if (node?.kind === 'transition' && this.enabled(node)) this.fire(node);
    else if (this.activeDocument()?.network.type.game)
      this.notice.set('Choose a Controller or Environment transition.');
    else {
      const ref = this.enabledTransitions()[0];
      if (ref) this.fireEnabled(ref);
    }
  }
  jumpToMarking(index: number) {
    if (
      !this.currentSimulation() ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.trace().length
    )
      return;
    while (this.simulator!.cursor > index) this.simulator!.back();
    while (this.simulator!.cursor < index) this.simulator!.forward();
    this.publishSimulation();
    this.error.set('');
  }
  back() {
    if (!this.currentSimulation()) return;
    this.simulator!.back();
    this.publishSimulation();
    this.error.set('');
  }
  resetSimulation() {
    if (!this.currentSimulation()) return;
    this.simulator!.reset();
    this.publishSimulation();
    this.error.set('');
  }
  private updateActive(edit: (doc: docs.NetworkDocument) => docs.NetworkDocument) {
    const id = this.workspace().activeDocumentId;
    if (id)
      this.workspace.update((workspace) => {
        const before = docs.getDocument(workspace, id).network;
        const next = docs.updateDocument(workspace, id, edit);
        if (docs.getDocument(next, id).network !== before) this.sourceGeneration++;
        return next;
      });
  }
  private rememberView() {
    const doc = this.activeDocument();
    if (!doc) return;
    this.updateActive((current) =>
      docs.setComponentView(current, {
        viewport: this.viewport(),
        selectedIds:
          this.mode() === 'Edit'
            ? this.selectedIds()
            : (current.session.views[current.session.componentId]?.selectedIds ?? []),
      }),
    );
    this.componentSessions.set(`${doc.id}/${doc.session.componentId}`, {
      grid: this.gridIndex(),
      fitted: this.fitted(),
    });
  }
  private leaveView(preserveSimulation = false) {
    this.cancelTokenSelection();
    this.finishDrag(true);
    this.rememberView();
    this.cancelDraft();
    this.context.set(null);
    this.editingElement.set(null);
    this.constantDraft.set(null);
    this.documentDialog.set(null);
    this.annotationEditor.set(null);
    if (!preserveSimulation) this.setMode('Edit');
    this.tool.set('select');
  }
  private restoreView() {
    const doc = this.activeDocument();
    const view = doc?.session.views[doc.session.componentId];
    const session = doc && this.componentSessions.get(`${doc.id}/${doc.session.componentId}`);
    this.viewport.set(view ? { ...view.viewport } : { x: 0, y: 0, zoom: 100 });
    this.gridIndex.set(session?.grid ?? 0);
    this.fitted.set(session?.fitted ?? false);
    this.setSelection(view ? [...view.selectedIds] : [], false);
    this.publish();
    if (this.mode() === 'Simulate') this.publishSimulation();
  }
  switchDocument(id: string) {
    if (id === this.workspace().activeDocumentId) return;
    this.leaveView();
    this.workspace.update((workspace) => docs.switchDocument(workspace, id));
    this.restoreView();
  }
  switchComponent(id: string) {
    if (id === this.activeDocument()?.session.componentId) return;
    this.leaveView(true);
    this.updateActive((doc) => docs.switchComponent(doc, id));
    this.restoreView();
  }
  private documentOperation(edit: (doc: docs.NetworkDocument) => docs.NetworkDocument) {
    if (!this.activeDocument() || this.mode() !== 'Edit') return false;
    this.finishDrag(true);
    this.cancelDraft();
    this.rememberView();
    try {
      this.updateActive(edit);
      this.restoreView();
      this.error.set('');
      return true;
    } catch (error) {
      this.error.set((error as Error).message);
      return false;
    }
  }
  discardSavedQueries() {
    if (this.mode() !== 'Edit' || !this.savedQueryNames().length) return;
    if (this.documentOperation(docs.removeSavedQueries))
      this.notice.set('Saved queries removed. Undo restores the queries and their references.');
  }
  componentDialog(action: 'add' | 'copy' | 'rename') {
    if (!this.activeDocument() || this.mode() !== 'Edit') return;
    this.pendingFocus = document.activeElement as HTMLElement;
    this.documentDialogError.set('');
    this.documentOrigin = this.workspace();
    this.documentDialog.set({
      action,
      name: this.net().name,
      componentName:
        action === 'rename'
          ? this.net().template
          : action === 'copy'
            ? `${this.net().template}_copy`
            : 'Component',
    });
  }
  newModel() {
    this.pendingFocus = document.activeElement as HTMLElement;
    this.documentDialogError.set('');
    this.documentOrigin = this.workspace();
    this.documentDialog.set({ action: 'new', name: 'Untitled model', componentName: 'Net' });
  }
  cancelDocumentDialog() {
    this.documentDialog.set(null);
    this.documentDialogError.set('');
    this.pendingFocus?.focus();
  }
  submitDocumentDialog(draft: DocumentDraft) {
    const action = this.documentDialog()?.action;
    if (!action) return;
    try {
      if (this.documentOrigin !== this.workspace())
        throw new Error('The document changed; cancel and reopen this dialog.');
      if (action === 'new') {
        const doc = draft.game
          ? docs.createGameDocument({ ...draft })
          : draft.timed
            ? docs.createTimedDocument({ name: draft.name, componentName: draft.componentName })
            : docs.createDocument({ name: draft.name, componentName: draft.componentName });
        this.leaveView();
        this.workspace.update((workspace) =>
          docs.openDocument(workspace, doc, { timed: true, game: true }),
        );
        this.restoreView();
      } else {
        const ok = this.documentOperation((doc) =>
          action === 'add'
            ? docs.addComponent(doc, draft.componentName)
            : action === 'copy'
              ? docs.copyComponent(doc, doc.session.componentId, draft.componentName)
              : docs.renameComponent(doc, doc.session.componentId, draft.componentName),
        );
        if (!ok) {
          this.documentDialogError.set(this.error());
          return;
        }
      }
      this.cancelDocumentDialog();
    } catch (error) {
      this.documentDialogError.set((error as Error).message);
    }
  }
  toggleComponent(id: string, event: Event) {
    this.documentOperation((doc) =>
      docs.setComponentActive(doc, id, (event.target as HTMLInputElement).checked),
    );
    (event.target as HTMLInputElement).checked = this.components().find(
      (item) => item.id === id,
    )!.active;
  }
  moveComponent(direction: number) {
    this.documentOperation((doc) => {
      const ids = doc.network.components.map((item) => item.id),
        index = ids.indexOf(doc.session.componentId),
        next = index + direction;
      if (next < 0 || next >= ids.length) return doc;
      [ids[index], ids[next]] = [ids[next], ids[index]];
      return docs.reorderComponents(doc, ids);
    });
  }
  removeCurrentComponent() {
    this.documentOperation((doc) => docs.removeComponent(doc, doc.session.componentId));
  }
  closeDocument(id: string, discard = false) {
    const doc = docs.getDocument(this.workspace(), id);
    if (docs.isDirty(doc) && !discard) {
      this.pendingFocus = document.activeElement as HTMLElement;
      this.closingDocument.set(id);
      setTimeout(() => document.getElementById('cancel-close')?.focus());
      return;
    }
    this.leaveView();
    this.workspace.update((workspace) => docs.closeDocument(workspace, id, { discard }));
    this.closingDocument.set(null);
    this.restoreView();
  }
  saveAndClose(id: string) {
    this.switchDocument(id);
    this.save();
    if (!docs.isDirty(docs.getDocument(this.workspace(), id))) this.closeDocument(id);
  }
  cancelClose() {
    this.closingDocument.set(null);
    this.pendingFocus?.focus();
  }
  private offer(result: NetworkImportResult, action: string) {
    if (result.warnings.length) {
      this.pendingFocus = document.activeElement as HTMLElement;
      this.pending.set({ ...result, action });
      setTimeout(() => document.getElementById('cancel-open')?.focus());
    } else this.loadNetwork(result.network);
  }
  acceptPending() {
    const pending = this.pending();
    if (pending) {
      try {
        this.loadNetwork(
          'network' in pending ? pending.network : docs.networkFromLegacyNet(pending.net),
        );
        this.pending.set(null);
      } catch (error) {
        this.cancelPending();
        this.error.set((error as Error).message);
      }
    }
  }
  private loadNetwork(network: docs.Network | NumericNetwork) {
    const doc = docs.openNetworkDocument(network, { saved: true, timed: true, game: true });
    this.leaveView();
    this.workspace.update((workspace) =>
      docs.openDocument(workspace, doc, { timed: true, game: true }),
    );
    this.restoreView();
    this.error.set('');
    this.notice.set(`Opened ${network.name}.`);
    this.fit();
  }
  readonly galleryOpen = signal(false);
  readonly galleryError = signal('');
  readonly galleryLoading = signal(false);
  private galleryFocus?: HTMLElement;
  showExamples() {
    const trigger = document.activeElement as HTMLElement | null;
    this.galleryFocus =
      trigger?.closest('details')?.querySelector<HTMLElement>('summary') ?? trigger ?? undefined;
    this.closeMenus();
    this.galleryError.set('');
    this.galleryOpen.set(true);
  }
  closeExamples() {
    ++this.fileOperation;
    this.galleryOpen.set(false);
    this.galleryLoading.set(false);
    const trigger = this.galleryFocus;
    setTimeout(() => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (trigger?.isConnected) trigger.focus();
      if (document.activeElement !== trigger) this.canvas?.nativeElement.focus();
    });
  }
  async openExample(entry: ExampleEntry) {
    if (entry.reason || this.galleryLoading()) return;
    const origin = this.workspace(),
      operation = ++this.fileOperation;
    this.galleryLoading.set(true);
    this.galleryError.set('');
    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error('Could not load example. Please try again.');
      const text = await response.text();
      if (operation !== this.fileOperation || !this.galleryOpen()) return;
      if (origin !== this.workspace())
        throw new Error('The workspace changed. Please open the example again.');
      const result = parseNetworkModel(text, entry.filename);
      this.closeExamples();
      this.offer(result, 'Open example');
    } catch (error) {
      if (operation === this.fileOperation) this.galleryError.set((error as Error).message);
    } finally {
      if (operation === this.fileOperation) this.galleryLoading.set(false);
    }
  }
  private fileOperation = 0;
  async openFile(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    const origin = this.workspace(),
      operation = ++this.fileOperation;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Files must be smaller than 5 MB.');
      const text = await file.text();
      if (origin !== this.workspace() || operation !== this.fileOperation) {
        this.notice.set(
          'Open cancelled because the workspace changed. Please open the file again.',
        );
        return;
      }
      const result = parseNetworkModel(text, file.name);
      this.offer(result, 'Open model');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      input.value = '';
    }
  }
  save(format: 'tapn' | 'json' = 'tapn') {
    this.error.set('');
    (document.activeElement as HTMLElement | null)?.blur();
    this.finishDrag();
    if (this.error()) return;
    try {
      const doc = this.activeDocument();
      if (!doc) return;
      const snapshot = doc.network,
        content =
          format === 'tapn' ? serializeNetworkTapn(snapshot) : serializeNetworkJson(snapshot),
        url = URL.createObjectURL(
          new Blob([content], { type: format === 'tapn' ? 'application/xml' : 'application/json' }),
        ),
        link = document.createElement('a');
      link.href = url;
      link.download = `${snapshot.name.replace(/[^\w-]/g, '_')}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.workspace.update((workspace) =>
        docs.updateDocument(workspace, doc.id, (current) => ({ ...current, saved: snapshot })),
      );
      this.publish();
      this.error.set('');
      this.notice.set(
        `Downloaded ${link.download} with the initial marking.` +
          (format === 'tapn' && this.hasInitialAges()
            ? ' TAPAAL 4.0.4 resets nonzero initial ages to zero. Use a loader supporting initial token ages or keep the web JSON file.'
            : ''),
      );
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    (document.activeElement as HTMLElement | null)?.blur();
    this.finishDrag();
    if (this.documents().some(docs.isDirty)) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  private trapFileDialog(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.file-dialog button'),
    );
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && index === controls.length - 1) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }
  @HostListener('window:keydown', ['$event']) key(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (this.tokenDraft()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelTokenSelection();
      }
      return;
    }
    if (
      this.galleryOpen() ||
      this.transitionDialog() ||
      this.sharedDialog() ||
      this.documentDialog() ||
      this.constantDraft()
    )
      return;
    if (this.closingDocument()) {
      if (event.key === 'Escape') this.cancelClose();
      this.trapFileDialog(event);
      return;
    }
    if (this.context()) return;
    if (this.editingElement() || this.annotationEditor()) return;
    if (this.pending()) {
      if (event.key === 'Escape') this.cancelPending();
      this.trapFileDialog(event);
      return;
    }
    // Focused text controls own Delete and text undo. Only the canvas-level binding
    // cancels pending drawing; it must still precede document undo/delete shortcuts.
    const editingText = !!target.closest('input,textarea,select,[contenteditable]');
    if (!editingText && this.arcStart() && isQuickDrawCancelKey(event)) {
      event.preventDefault();
      this.cancelDraft();
      this.arcPointer.set(null);
      return;
    }
    if (this.menuKey(event)) return;
    if (target instanceof HTMLInputElement && target.closest('.inspector')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        target.blur();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        const node = this.selected();
        const arc = this.selectedArc();
        const values: Record<string, string | number | undefined> = {
          'element-name': node?.name,
          tokens: node?.tokens,
          'position-x': node?.x,
          'position-y': node?.y,
          'model-name': this.net().name,
          'template-name': this.net().template,
          'arc-weight': arc ? this.weightText(arc) : undefined,
        };
        if (values[target.id] !== undefined) target.value = String(values[target.id]);
        target.blur();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
      return;
    }
    if (editingText) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicate();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k' || key === 'y' || (key === 'f' && event.shiftKey)) {
        event.preventDefault();
        if (key === 'j' || key === 'k') this.zoomBy(key === 'j' ? 1 : -1);
        else if (key === 'y') this.redo();
        else this.toggleFit();
        return;
      }
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.setMode(this.mode() === 'Edit' ? 'Simulate' : 'Edit');
      return;
    }
    if (event.key.toLowerCase() === 'g') {
      event.preventDefault();
      event.shiftKey ? this.alignToGrid() : this.cycleGrid();
      return;
    }
    if (this.mode() === 'Simulate' && !target.closest('button,a,summary,[role=button]')) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.key === 'ArrowLeft') this.back();
        else if (this.canForward()) this.step();
        return;
      }
    }
    if (event.key.toLowerCase() === 'v') {
      this.setTool('select');
      return;
    }
    if (
      (event.key === 'F2' || event.key === 'Enter') &&
      !target.closest('button,a,summary,[role=button]')
    ) {
      event.preventDefault();
      if (this.selectionCount() === 1) this.openEditor();
      return;
    }
    if (event.key === 'Escape') {
      this.closeMenus();
      this.finishDrag(true);
      this.setTool('select');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.remove();
      return;
    }
    const tool = this.tools.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (tool && (this.mode() === 'Edit' || tool.id === 'pan' || tool.id === 'select'))
      this.setTool(tool.id);
  }
}
