import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_MODEL_TYPE,
  TIMED_MODEL_TYPE,
  requireEditableModelType,
  modelCapabilities,
  normalizeModelType,
  selectModelDimension,
  validateModelType,
} from './model-types';
import { createDocument } from './documents';

describe('native lens metadata and honest capabilities', () => {
  it('matches TAPNLens normalization for all sixteen inputs', () => {
    for (let bits = 0; bits < 16; bits++) {
      const input = {
        timed: !!(bits & 1),
        colored: !!(bits & 2),
        game: !!(bits & 4),
        stochastic: !!(bits & 8),
      };
      const lens = normalizeModelType(input);
      expect(lens).toEqual({
        ...input,
        stochastic: input.stochastic && input.timed && !input.game,
      });
      expect(Object.isFrozen(lens)).toBe(true);
      expect(() => validateModelType(lens)).not.toThrow();
      expect(modelCapabilities(lens).executable).toBe(
        !lens.timed && !lens.colored && !lens.game && !lens.stochastic,
      );
    }
  });
  it('implements NewTAPNPanel last-choice normalization without conflating it with lens construction', () => {
    const stochastic = selectModelDimension(
      { ...SUPPORTED_MODEL_TYPE, game: true, colored: true },
      'stochastic',
      true,
    );
    expect(stochastic).toEqual({ timed: true, game: false, colored: true, stochastic: true });
    expect(selectModelDimension(stochastic, 'timed', false)).toEqual({
      ...stochastic,
      timed: false,
      stochastic: false,
    });
    expect(selectModelDimension(stochastic, 'game', true)).toEqual({
      ...stochastic,
      game: true,
      stochastic: false,
    });
  });
  it('rejects illegal or unsupported editable creation without silently normalizing away requested semantics', () => {
    expect(() =>
      createDocument({ name: 'Illegal', type: { ...SUPPORTED_MODEL_TYPE, stochastic: true } }),
    ).toThrow('require timed, nongame');
    for (const dimension of ['timed', 'colored', 'game', 'stochastic'] as const) {
      const type = selectModelDimension(SUPPORTED_MODEL_TYPE, dimension, true);
      expect(modelCapabilities(type)).toMatchObject({ editable: false, executable: false });
      expect(() => createDocument({ name: 'Unsupported', type })).toThrow(
        `Unsupported ${dimension === 'stochastic' ? 'timed, stochastic' : dimension} semantics`,
      );
    }
    expect(modelCapabilities(SUPPORTED_MODEL_TYPE)).toEqual({
      editable: true,
      executable: true,
      reason: null,
    });
  });
  it('grants timed editing only behind an explicit opt-in, never untimed execution', () => {
    expect(modelCapabilities(TIMED_MODEL_TYPE)).toMatchObject({
      editable: false,
      executable: false,
    });
    expect(modelCapabilities(TIMED_MODEL_TYPE, { timed: true })).toEqual({
      editable: true,
      executable: false,
      reason: expect.stringContaining('timedModelForNetwork'),
    });
    expect(() => requireEditableModelType(TIMED_MODEL_TYPE)).toThrow('Unsupported timed');
    expect(() => requireEditableModelType(TIMED_MODEL_TYPE, { timed: true })).not.toThrow();
    for (const dimension of ['colored', 'game', 'stochastic'] as const) {
      const type = selectModelDimension(TIMED_MODEL_TYPE, dimension, true);
      expect(() => requireEditableModelType(type, { timed: true })).toThrow(
        /Unsupported (colored|game|stochastic)/,
      );
    }
    expect(modelCapabilities(SUPPORTED_MODEL_TYPE, { timed: true })).toEqual(
      modelCapabilities(SUPPORTED_MODEL_TYPE),
    );
  });
});
