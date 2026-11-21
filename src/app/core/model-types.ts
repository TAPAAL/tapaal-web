/** Native TAPNLens dimensions; metadata alone does not grant execution support. */
export interface ModelType {
  readonly timed: boolean;
  readonly colored: boolean;
  readonly game: boolean;
  readonly stochastic: boolean;
}

export const SUPPORTED_MODEL_TYPE: ModelType = Object.freeze({
  timed: false,
  colored: false,
  game: false,
  stochastic: false,
});

/** TAPNLens.java constructor: incompatible stochastic is cleared, not time/game. */
export function normalizeModelType(input: ModelType): ModelType {
  for (const key of ['timed', 'colored', 'game', 'stochastic'] as const) {
    if (typeof input[key] !== 'boolean') throw new Error(`Model type ${key} must be boolean.`);
  }
  return Object.freeze({
    timed: input.timed,
    colored: input.colored,
    game: input.game,
    stochastic: input.stochastic && input.timed && !input.game,
  });
}

/** NewTAPNPanel.java listeners: the last user choice wins. */
export function selectModelDimension(
  type: ModelType,
  dimension: keyof ModelType,
  value: boolean,
): ModelType {
  const next = { ...normalizeModelType(type), [dimension]: value };
  if (dimension === 'stochastic' && value) {
    next.timed = true;
    next.game = false;
  }
  return normalizeModelType(next);
}

export function validateModelType(type: ModelType): void {
  const normalized = normalizeModelType(type);
  if (normalized.stochastic !== type.stochastic) {
    throw new Error('Stochastic models require timed, nongame semantics.');
  }
}

/** Timed-only metadata: the single type that `timedModelForNetwork` can execute. */
export const TIMED_MODEL_TYPE: ModelType = Object.freeze({
  timed: true,
  colored: false,
  game: false,
  stochastic: false,
});

/**
 * Explicit caller opt-ins. Defaults keep every gate untimed: only a UI that edits timing metadata
 * and executes through `timedModelForNetwork` may pass `timed: true`.
 */
export interface CapabilityOptions {
  readonly timed?: boolean;
  readonly game?: boolean;
}

export function modelCapabilities(
  type: ModelType,
  options: CapabilityOptions = {},
): {
  readonly editable: boolean;
  readonly executable: boolean;
  readonly reason: string | null;
} {
  validateModelType(type);
  const unsupported = (['timed', 'colored', 'game', 'stochastic'] as const).filter(
    (key) =>
      type[key] &&
      !((key === 'timed' && options.timed === true) || (key === 'game' && options.game === true)),
  );
  if (unsupported.length)
    return Object.freeze({
      editable: false,
      executable: false,
      reason: `Unsupported ${unsupported.join(', ')} semantics: only uncoloured, ${options.timed === true ? '' : 'untimed, '}${options.game === true ? '' : 'nongame, '}nonstochastic P/T models can currently be edited or executed. Metadata does not implement these semantics.`,
    });
  if (type.game)
    return Object.freeze({
      editable: true,
      executable: false,
      reason:
        'Games require the explicit manual game adapter; strategy synthesis/verification is unavailable.',
    });
  // The untimed simulators cannot enforce intervals, invariants, urgency or token ages.
  if (type.timed)
    return Object.freeze({
      editable: true,
      executable: false,
      reason:
        'Timed models cannot run in the untimed simulator; execute them through timedModelForNetwork and TimedSimulation.',
    });
  return Object.freeze({ editable: true, executable: true, reason: null });
}

export function requireEditableModelType(type: ModelType, options: CapabilityOptions = {}): void {
  const capabilities = modelCapabilities(type, options);
  if (!capabilities.editable) throw new Error(capabilities.reason!);
}
