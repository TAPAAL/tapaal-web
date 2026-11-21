import type { EligibleTimedInput } from './core/timed';

export interface TokenInputChoice extends EligibleTimedInput {
  readonly placeName: string;
  readonly destinationName?: string;
}
export type TokenBindings = Record<string, string[]>;
/** Only draft validation; the engine revalidates eligibility and exact counts on commit. */
export function completeTokenSelection(
  inputs: readonly TokenInputChoice[],
  bindings: TokenBindings,
): boolean {
  return (
    Object.keys(bindings).length === inputs.length &&
    inputs.every((input) => {
      const ids = bindings[input.arcId];
      return (
        Array.isArray(ids) &&
        ids.length === input.weight &&
        new Set(ids).size === ids.length &&
        ids.every((id) => input.tokens.some((token) => token.id === id))
      );
    })
  );
}
export function initialTokenSelection(inputs: readonly TokenInputChoice[]): TokenBindings {
  return Object.fromEntries(
    inputs.map((input) => [
      input.arcId,
      input.tokens.length === input.weight ? input.tokens.map((token) => token.id) : [],
    ]),
  );
}
