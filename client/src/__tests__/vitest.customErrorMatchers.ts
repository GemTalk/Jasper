import { expect, type MatcherState } from 'vitest';

// Constructor of an `Error` subclass. `NewableFunction` (not `new (...) => Error`)
// so it also accepts classes with non-public constructors, and still exposes
// `.name` / works with `instanceof`.
type ErrorClass = NewableFunction & { prototype: Error };

expect.extend({
  /**
   * Used to test that a function throws exactly the given error instance,
   * not merely an equal or same-typed one.
   *
   * @param callback - The function expected to throw.
   * @param expectedError - The exact `Error` instance `callback` must throw.
   */
  toThrowExactly(callback: () => unknown, expectedError: Error) {
    try {
      callback();
      return {
        pass: false,
        message: () => `Expected callback to throw ${expectedError}, but it did not throw.`,
      };
    } catch (error) {
      if (error !== expectedError) {
        return {
          pass: false,
          message: () =>
            `Expected callback to throw exactly ${expectedError}, but it threw ${error}.`,
          actual: error,
          expected: expectedError,
        };
      }
    }

    return {
      pass: true,
      message: () => `Expected callback not to throw ${expectedError}, but it did.`,
    };
  },

  /**
   * Used to test that a function throws, or a promise rejects with, an
   * instance of the given class with the given message.
   *
   * Two call shapes: direct on a callback (`expect(callback)...`), invoked
   * and caught here; or via `.rejects` (`expect(promise).rejects...`),
   * where vitest hands this the already-awaited rejection reason instead of
   * a callback -- detected via `this.promise`. `.resolves` is deliberately
   * unsupported (no thrown error to inspect) and throws loudly rather than
   * misinterpreting the resolved value.
   *
   * @param received - The function expected to throw, or (via `.rejects`) the already-caught rejection reason.
   * @param ExpectedClass - The `Error` subclass that must have been thrown.
   * @param expectedMessage - The exact `message` the thrown error must have.
   */
  toThrowInstanceOf(
    this: MatcherState,
    received: unknown,
    ExpectedClass: ErrorClass,
    expectedMessage: string,
  ) {
    if (this.promise === 'resolves') {
      throw new Error('toThrowInstanceOf does not support .resolves; use .rejects instead.');
    }

    let error: unknown;

    if (this.promise === 'rejects') {
      error = received;
    } else {
      const callback = received as () => unknown;
      try {
        callback();
        return {
          pass: false,
          message: () =>
            `Expected callback to throw a ${ExpectedClass.name} with message '${expectedMessage}', but it did not throw.`,
        };
      } catch (thrown) {
        error = thrown;
      }
    }

    if (!(error instanceof ExpectedClass)) {
      return {
        pass: false,
        message: () => `Expected callback to throw a ${ExpectedClass.name}, but it threw ${error}.`,
        actual: error,
        expected: ExpectedClass,
      };
    }

    const thrownError = error as Error;
    if (thrownError.message !== expectedMessage) {
      return {
        pass: false,
        message: () =>
          `Expected callback to throw a ${ExpectedClass.name} with message '${expectedMessage}', but got '${thrownError.message}'.`,
      };
    }

    return {
      pass: true,
      message: () =>
        `Expected callback not to throw a ${ExpectedClass.name} with message '${expectedMessage}', but it did.`,
    };
  },
});

declare module 'vitest' {
  interface Assertion {
    /**
     * Used to test that a function throws exactly the given error instance,
     * not merely an equal or same-typed one.
     *
     * @param expectedError - The exact `Error` instance the received function must throw.
     */
    toThrowExactly(expectedError: Error): void;
    /**
     * Used to test that a function throws, or (via `.rejects`) a promise
     * rejects with, an instance of the given class with the given message.
     *
     * @param ExpectedClass - The `Error` subclass that must have been thrown.
     * @param expectedMessage - The exact `message` the thrown error must have.
     */
    toThrowInstanceOf(ExpectedClass: ErrorClass, expectedMessage: string): void;
  }
}
