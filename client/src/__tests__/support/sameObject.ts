/**
 * An argument matcher for `toHaveBeenCalledWith` that accepts only `expected` itself.
 *
 * @remarks
 * `toHaveBeenCalledWith` compares arguments by deep equality, so a fake GCI handle such as
 * `{}` matches every other `{}`: another session's handle would pass. Wrapping it in this
 * matcher makes the assertion prove which object the call received.
 *
 * @param expected - The object the argument must be.
 * @returns A matcher to put in that argument's position.
 */
export function sameObject(expected: unknown) {
  return {
    asymmetricMatch: (actual: unknown) => actual === expected,
    toAsymmetricMatcher: () => 'sameObject(<the expected instance>)',
  };
}
