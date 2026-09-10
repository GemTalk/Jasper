import { describe, expect, it, vi, beforeEach, type TestContext } from 'vitest';
import { GciLibrary } from '../gciLibrary';
import { GciTestContext, useIntegrationTest } from './useIntegrationTest';
import { GciLibraryError } from '../gciLibraryError';
import { GCI_ERR_BAD_SESSION_ID } from '../gciConstants';
import {
  expectUtf8OopToBeCached,
  expectUtf8OopToResolveViaSymbolLookup,
} from './support/utf8OopCache';
import {
  expectEventLoopToBeBlockedDuring,
  expectEventLoopToRemainResponsiveDuring,
} from './support/timers';

describe('GciLibrary', () => {
  let gciLibrary: GciLibrary;
  let session: unknown;
  let testContext: GciTestContext;

  useIntegrationTest((testContextToUse) => {
    gciLibrary = testContextToUse.gciLibrary;
    session = testContextToUse.session;
    testContext = testContextToUse;
  });

  /** Asserts that `oop` is GemStone's `true` singleton. */
  function expectOopToBeTrue(oop: bigint) {
    expect(gciLibrary.isTrueOop(oop)).toBe(true);
  }

  /** Asserts that `oop` is GemStone's `nil` singleton. */
  function expectOopToBeNil(oop: bigint) {
    expect(gciLibrary.isNilOop(oop)).toBe(true);
  }

  /**
   * Asserts that `callback` throws a {@link GciLibraryError} when given a
   * Smalltalk snippet that signals a user-defined error (`self error: 'oops'`).
   *
   * The callback receives the Smalltalk snippet as its argument so it can
   * embed it in any expression under test (e.g. pass it to `execute`).
   */
  function expectToThrowExpectedGciLibraryError(
    callback: (signalExpectedErrorExpression: string) => unknown,
  ) {
    expectToThrowGciLibraryError(
      () => callback(`self error: 'oops'`),
      'a UserDefinedError occurred (error 2318), reason:halt, oops',
    );
  }

  /**
   * Asserts that `callback` throws exactly the same `Error` instance it's
   * given when given a thunk that throws that error.
   *
   * The callback receives the thunk as its argument so it can invoke it
   * from anywhere in the expression under test (e.g. pass it to
   * `executeAndRelease`).
   */
  function expectToThrowExpectedError(callback: (throwExpectedError: () => never) => unknown) {
    const expectedError = new Error('oops');

    expect(() =>
      callback(() => {
        throw expectedError;
      }),
    ).toThrowExactly(expectedError);
  }

  /** Asserts that `callback` throws a {@link GciLibraryError} with `expectedMessage`. */
  function expectToThrowGciLibraryError(callback: () => unknown, expectedMessage: string) {
    expect(callback).toThrowInstanceOf(GciLibraryError, expectedMessage);
  }

  /**
   * Asserts that `promise` rejects with a {@link GciLibraryError} with
   * `expectedMessage`.
   *
   * @param promise - The promise expected to reject.
   * @param expectedMessage - The expected error message.
   */
  async function expectToBeRejectedWithGciLibraryError(
    promise: Promise<unknown>,
    expectedMessage: string,
  ) {
    await expect(promise).rejects.toThrowInstanceOf(GciLibraryError, expectedMessage);
  }

  /**
   * Asserts that `callback` rejects with a {@link GciLibraryError} when
   * given a Smalltalk snippet that signals a user-defined error (`self
   * error: 'oops'`).
   *
   * The callback receives the Smalltalk snippet as its argument so it can
   * embed it in any expression under test (e.g. pass it to
   * `executeAndFetchOop`).
   */
  async function expectToBeRejectedWithExpectedGciLibraryError(
    callback: (signalExpectedErrorExpression: string) => Promise<unknown>,
  ) {
    await expectToBeRejectedWithGciLibraryError(
      callback(`self error: 'oops'`),
      'a UserDefinedError occurred (error 2318), reason:halt, oops',
    );
  }

  /** Asserts that the session's PureExportSet stays unchanged across `callback`. */
  function expectPureExportSetToStayUnchanged(callback: () => unknown) {
    expectPureExportSetToGainOnlyOopsProvidedBy(true, () => {
      callback();
      return [];
    });
  }

  /** Asserts that the session's PureExportSet gains only the oops `callback` declares, per `shouldGainOnlyProvidedOops`. */
  function expectPureExportSetToGainOnlyOopsProvidedBy(
    shouldGainOnlyProvidedOops: boolean,
    callback: () => bigint[],
  ) {
    const pureExportSetGainedOnlyProvidedOops = gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(
      session,
      callback,
    );

    expect(pureExportSetGainedOnlyProvidedOops).toBe(shouldGainOnlyProvidedOops);
  }

  /** Asserts that `UserGlobals` includes (or does not include) `key`, per `shouldBeIncluded`. */
  function expectUserGlobalsToInclude(key: string, shouldBeIncluded: boolean) {
    expect(gciLibrary.isIncludedInUserGlobals(session, key)).toBe(shouldBeIncluded);
  }

  /**
   * Asserts that the session's PureExportSet gains at least one new oop
   * across `callback`, per `shouldGrow`.
   *
   * @param shouldGrow - Whether the PureExportSet is expected to gain a new oop.
   * @param callback - The operation to observe.
   */
  function expectPureExportSetToGrow(shouldGrow: boolean, callback: () => unknown) {
    expect(gciLibrary.didPureExportSetGrow(session, callback)).toBe(shouldGrow);
  }

  /**
   * Asserts that `session`'s SessionTemps dictionary is (or is not) empty,
   * per `shouldBeEmpty`.
   *
   * @param shouldBeEmpty - Whether SessionTemps is expected to be empty.
   */
  function expectSessionTempsToBeEmpty(shouldBeEmpty: boolean) {
    expect(gciLibrary.isSessionTempsEmpty(session)).toBe(shouldBeEmpty);
  }

  /**
   * Asserts that the session's PureExportSet includes (or does not
   * include) `oop`, per `shouldBeIncluded`.
   *
   * @param shouldBeIncluded - Whether `oop` is expected to be included.
   * @param oop - The oop to check for.
   */
  function expectPureExportSetToIncludeOop(shouldBeIncluded: boolean, oop: bigint) {
    expect(gciLibrary.isOopIncludedInPureExportSet(session, oop)).toBe(shouldBeIncluded);
  }

  /**
   * Forces the next `releaseObject` call to throw for the duration of
   * `callback`, then restores it.
   *
   * @param callback - The operation to run while `releaseObject` is rigged to fail.
   */
  function simulateReleaseObjectFailure(callback: () => void) {
    const spy = vi.spyOn(gciLibrary, 'releaseObject').mockImplementationOnce(() => {
      throw GciLibraryError.withMessage('Simulated releaseObject failure');
    });

    try {
      callback();
    } finally {
      spy.mockRestore();
    }
  }

  /**
   * Makes every readiness check report a failure, for the duration of
   * `callback`, via whichever mechanism this GemStone version's library
   * actually uses: a `GciTsNbPoll` error result if it's available, or a
   * thrown raw-socket read otherwise. Only one of the two mocks below is
   * ever exercised in a given run, per the connected version's own
   * {@link isNbResultReady} branch -- covering both is what makes this
   * version-agnostic. Failing every check, rather than just the next one,
   * is what makes this safe to use around a call that polls more than
   * once, e.g. one composed of several chained non-blocking GCI calls.
   *
   * @param callback - The operation to run while readiness checks are rigged to fail.
   */
  async function simulatePollFailure<T>(callback: () => Promise<T>): Promise<T> {
    const pollSpy = vi.spyOn(gciLibrary, 'GciTsNbPoll').mockReturnValue({
      result: -1,
      err: {
        number: 0,
        message: 'Simulated GciTsNbPoll failure',
        category: 0n,
        context: 0n,
        exceptionObj: 0n,
        args: [],
        argCount: 0,
        fatal: 0,
        reason: '',
      },
    });
    const isReadableSpy = vi.spyOn(testContext.nativeSocketLibrary, 'isReadable').mockThrow('oops');

    try {
      const result = await callback();

      expect(pollSpy.mock.calls.length + isReadableSpy.mock.calls.length).toBeGreaterThan(0);

      return result;
    } finally {
      pollSpy.mockRestore();
      isReadableSpy.mockRestore();
    }
  }

  /**
   * Forces every `socketFor` call to throw for the duration of `callback`,
   * simulating a session whose socket cannot be identified throughout.
   *
   * @param callback - The operation to run while `socketFor` is rigged to fail.
   */
  async function simulateSessionSocketFailure<T>(callback: () => Promise<T>): Promise<T> {
    const spy = vi.spyOn(gciLibrary, 'socketFor').mockThrow('oops');

    try {
      const result = await callback();

      expect(spy).toHaveBeenCalled();

      return result;
    } finally {
      spy.mockRestore();
    }
  }

  /**
   * Skips the current test unless the connected GemStone version exercises
   * the raw-socket polling fallback, i.e. lacks `GciTsNbPoll`.
   */
  function skipUnlessRawSocketPolling(ctx: TestContext) {
    if (gciLibrary.isPollingSupportedByGCI()) {
      ctx.skip(
        'Native socket error handling tests are skipped because the configured GemStone version supports GciTsNbPoll, which is not exercised by these tests.',
      );
    }
  }

  /**
   * Asserts that evaluating `codeToEvaluate` and fetching its result as a
   * string yields `expectedResult`.
   *
   * @param codeToEvaluate - Smalltalk source to evaluate.
   * @param expectedResult - The string the evaluated result is expected to decode to.
   */
  function expectEvaluatedStringToBe(codeToEvaluate: string, expectedResult: string) {
    expect(gciLibrary.executeAndFetchString(session, codeToEvaluate)).toBe(expectedResult);
  }

  /**
   * Asserts that evaluating `codeToEvaluate` and fetching its result as a
   * string via the non-blocking GCI entry point yields `expectedResult`.
   *
   * @param codeToEvaluate - Smalltalk source to evaluate.
   * @param expectedResult - The string the evaluated result is expected to decode to.
   */
  async function expectEvaluatedStringToBeAsync(codeToEvaluate: string, expectedResult: string) {
    await expect(gciLibrary.executeAndFetchStringAsync(session, codeToEvaluate)).resolves.toBe(
      expectedResult,
    );
  }

  /**
   * Asserts that the session's PureExportSet is the same once `callback`'s
   * promise resolves as it was before `callback` started. If `callback`
   * rejects, rethrows its error without comparing.
   *
   * @param callback - The async work expected to leave the PureExportSet unchanged.
   */
  async function expectPureExportSetToStayUnchangedAsync(callback: () => Promise<unknown>) {
    const takeSnapshotExpression = '(GsBitmap newForHiddenSet: #PureExportSet) asArray';
    const snapshotName = gciLibrary.storeInUniqueUserGlobalsKey(session, takeSnapshotExpression);

    try {
      await callback();
    } catch (error) {
      try {
        gciLibrary.removeKeyFromUserGlobals(session, snapshotName);
      } catch (cleanupError) {
        console.warn(
          `Failed to clean up UserGlobals key '${snapshotName}' after callback error:`,
          cleanupError,
        );
      }
      throw error;
    }

    const comparisonResult = gciLibrary.execute(
      session,
      `
        | previousSnapshot currentSnapshot |
        previousSnapshot := UserGlobals removeKey: ${snapshotName}.
        currentSnapshot := ${takeSnapshotExpression}.
        previousSnapshot asIdentityBag = currentSnapshot asIdentityBag
      `,
    );

    expect(gciLibrary.isTrueOop(comparisonResult)).toBe(true);
  }

  /**
   * Makes the next oop release fail while `callback` runs, and restores
   * normal releases only once `callback`'s promise settles, since the release
   * may happen well after `callback` first returns its promise.
   *
   * @param callback - The async work whose next release should fail.
   */
  async function simulateReleaseObjectFailureAsync(callback: () => Promise<void>) {
    const spy = vi.spyOn(gciLibrary, 'releaseObject').mockImplementationOnce(() => {
      throw GciLibraryError.withMessage('Simulated releaseObject failure');
    });

    try {
      await callback();
    } finally {
      spy.mockRestore();
    }
  }

  /**
   * Asserts that evaluating `codeToEvaluate` and fetching its result as an
   * integer yields `expectedResult`.
   *
   * @param codeToEvaluate - Smalltalk source to evaluate.
   * @param expectedResult - The integer the evaluated result is expected to decode to.
   */
  function expectEvaluatedIntegerToBe(codeToEvaluate: string, expectedResult: bigint) {
    expect(gciLibrary.executeAndFetchInteger(session, codeToEvaluate)).toBe(expectedResult);
  }

  /**
   * Asserts that no instance of the class named `className` is left in the
   * session's PureExportSet.
   *
   * Checks for a fixture class's instances rather than for an unchanged
   * PureExportSet: a failed GCI call leaves its exception object in the
   * PureExportSet, and nothing currently releases it, so an unchanged
   * PureExportSet can't be expected after a failure.
   *
   * @param className - The name of a class the test defined in UserGlobals.
   */
  function expectNoInstanceToRemainInPureExportSet(className: string) {
    expectOopToBeTrue(
      gciLibrary.execute(
        session,
        `((GsBitmap newForHiddenSet: #PureExportSet) asArray
            anySatisfy: [:each | each class == ${className}]) not`,
      ),
    );
  }

  /** A call to a non-blocking GCI operation, paired with the value its result decodes to. */
  interface NonBlockingOperation<Result, Decoded> {
    run: () => Promise<Result>;
    expectedResult: Decoded;
  }

  /**
   * Registers the tests that every non-blocking GCI operation must pass:
   * it keeps the event loop free while GemStone works, rejects a second
   * operation started on the same session while it is still in progress,
   * and falls back to waiting synchronously when readiness checks fail.
   *
   * @param operations.slow - An operation that takes about a second in
   *   GemStone, long enough to observe the event loop and to overlap a
   *   second operation.
   * @param operations.quick - An operation that finishes right away. Its
   *   result must differ from `slow`'s, so a test can tell which operation
   *   a result came from.
   * @param operations.decodeResult - Turns an operation's result into the
   *   value compared against its `expectedResult`.
   */
  function itBehavesLikeANonBlockingOperation<Result, Decoded>(operations: {
    slow: NonBlockingOperation<Result, Decoded>;
    quick: NonBlockingOperation<Result, Decoded>;
    decodeResult: (result: Result) => Decoded;
  }) {
    const { slow, quick, decodeResult } = operations;

    if (slow.expectedResult === quick.expectedResult) {
      throw new Error('The slow and quick operations must resolve to different results.');
    }

    function expectOperationToReturn(
      operation: NonBlockingOperation<Result, Decoded>,
      result: Result,
    ) {
      expect(decodeResult(result)).toBe(operation.expectedResult);
    }

    it('does not block the event loop while GemStone works on it', async () => {
      await expectEventLoopToRemainResponsiveDuring(100, 800, slow.run);
    });

    it('does not allow to start a new operation while another is in progress', async () => {
      const firstOperation = slow.run();

      try {
        await expectToBeRejectedWithGciLibraryError(
          quick.run(),
          'session has a GciTsNb operation in progress',
        );
      } finally {
        await firstOperation;
      }
    });

    it('does not affect the result of an ongoing operation when trying to start another one', async () => {
      const firstOperation = slow.run();

      await quick.run().catch(() => {});

      expectOperationToReturn(slow, await firstOperation);
    });

    it('returns the result when polling for it fails', async () => {
      const result = await simulatePollFailure(quick.run);

      expectOperationToReturn(quick, result);
    });

    it('returns the result synchronously when polling for it fails', async () => {
      await simulatePollFailure(() => expectEventLoopToBeBlockedDuring(100, slow.run));
    });

    describe('Native socket error handling', () => {
      beforeEach(skipUnlessRawSocketPolling);

      it('returns the result when the session socket cannot be identified', async () => {
        const result = await simulateSessionSocketFailure(quick.run);

        expectOperationToReturn(quick, result);
      });

      it('returns the result synchronously when the session socket cannot be identified', async () => {
        await simulateSessionSocketFailure(() => expectEventLoopToBeBlockedDuring(100, slow.run));
      });
    });
  }

  describe('evaluating expressions', () => {
    it('returns the result of evaluating an expression', () => {
      const resultOop = gciLibrary.execute(session, `true`);

      expectOopToBeTrue(resultOop);
    });

    it('uses nil as the receiver for evaluated code', () => {
      const resultOop = gciLibrary.execute(session, `self`);

      expectOopToBeNil(resultOop);
    });

    it('has UserGlobals, Globals, and Published on the symbol list', () => {
      // Assert those three standard dictionaries are all on the symbol list, rather
      // than that they are the *only* ones: an optional payload (e.g. the refactoring
      // engine's shared GsRefactoring dictionary) may add more without changing that
      // the standard three resolve.
      const resultOop = gciLibrary.execute(
        session,
        `({UserGlobals. Globals. Published} asSet - System myUserProfile symbolList asSet) isEmpty`,
      );

      expectOopToBeTrue(resultOop);
    });

    it('executes code in the default environment', () => {
      const resultOop = gciLibrary.execute(
        session,
        `
                "Object class does not understand #'new' outside environment 0, so this
                would fail if execute runs code in a non-default environment."
                Object new.
                true`,
      );

      expectOopToBeTrue(resultOop);
    });

    it('throws when the expression signals an error', () => {
      expectToThrowExpectedGciLibraryError((signalExpectedErrorExpression) => {
        gciLibrary.execute(session, signalExpectedErrorExpression);
      });
    });
  });

  describe('evaluating expressions asynchronously', () => {
    it('returns the result of evaluating an expression', async () => {
      const resultOop = await gciLibrary.executeAndFetchOop(session, `true`);

      expectOopToBeTrue(resultOop);
    });

    it('uses nil as the receiver for evaluated code', async () => {
      const resultOop = await gciLibrary.executeAndFetchOop(session, `self`);

      expectOopToBeNil(resultOop);
    });

    it('has UserGlobals, Globals, and Published on the symbol list', async () => {
      // Assert those three standard dictionaries are all on the symbol list, rather
      // than that they are the *only* ones: an optional payload (e.g. the refactoring
      // engine's shared GsRefactoring dictionary) may add more without changing that
      // the standard three resolve.
      const resultOop = await gciLibrary.executeAndFetchOop(
        session,
        `({UserGlobals. Globals. Published} asSet - System myUserProfile symbolList asSet) isEmpty`,
      );

      expectOopToBeTrue(resultOop);
    });

    it('executes code in the default environment', async () => {
      const resultOop = await gciLibrary.executeAndFetchOop(
        session,
        `
                "Object class does not understand #'new' outside environment 0, so this
                would fail if execute runs code in a non-default environment."
                Object new.
                true`,
      );

      expectOopToBeTrue(resultOop);
    });

    it('throws when the expression signals an error', async () => {
      await expectToBeRejectedWithExpectedGciLibraryError((signalExpectedErrorExpression) =>
        gciLibrary.executeAndFetchOop(session, signalExpectedErrorExpression),
      );
    });

    itBehavesLikeANonBlockingOperation({
      slow: {
        run: () => gciLibrary.executeAndFetchOop(session, `(Delay forSeconds: 1) wait. 1`),
        expectedResult: 1n,
      },
      quick: {
        run: () => gciLibrary.executeAndFetchOop(session, `2`),
        expectedResult: 2n,
      },
      decodeResult: (resultOop) => gciLibrary.oopToInteger(session, resultOop),
    });
  });

  describe('identifying the socket for a session', () => {
    it('returns the file descriptor of the session socket', () => {
      expect(gciLibrary.socketFor(session)).toBeGreaterThanOrEqual(0);
    });

    /**
     * Mocks GciTsSocket rather than provoking the error for real: GciTsLogout
     * frees the session, so calling GciTsSocket on a logged-out session is a
     * use-after-free that can segfault the worker rather than return an error.
     */
    function simulateGciTsSocketError() {
      const errorMessage = 'simulated GciTsSocket error';

      vi.spyOn(gciLibrary, 'GciTsSocket').mockReturnValueOnce({
        fd: -1,
        err: {
          number: GCI_ERR_BAD_SESSION_ID,
          message: errorMessage,
          category: 0n,
          context: 0n,
          exceptionObj: 0n,
          args: [],
          argCount: 0,
          fatal: 0,
          reason: '',
        },
      });

      return errorMessage;
    }

    it('throws when the session socket cannot be identified', () => {
      const expectedErrorMessage = simulateGciTsSocketError();

      expectToThrowGciLibraryError(() => gciLibrary.socketFor(session), expectedErrorMessage);
    });
  });

  describe('evaluating expressions for effect only, discarding the result', () => {
    it('evaluates an expression', () => {
      const key = gciLibrary.nextKey();

      gciLibrary.executeDiscardingResult(session, `UserGlobals at: ${key} put: true`);

      expectUserGlobalsToInclude(key, true);
    });

    it('does not retain the discarded result in the PureExportSet', () => {
      expectPureExportSetToStayUnchanged(() => {
        gciLibrary.executeDiscardingResult(session, 'Object new');
      });
    });

    it('throws when the evaluated code signals an error', () => {
      expectToThrowExpectedGciLibraryError((signalExpectedErrorExpression) => {
        gciLibrary.executeDiscardingResult(session, signalExpectedErrorExpression);
      });
    });

    it('does not retain the discarded result in the PureExportSet when evaluating non-local returns', () => {
      expectPureExportSetToStayUnchanged(() => {
        gciLibrary.executeDiscardingResult(session, '^ Object new');
      });
    });
  });

  describe('evaluating an expression and releasing its result automatically', () => {
    it('passes the resulting oop to the callback', () => {
      gciLibrary.executeAndRelease(session, 'true', (resultOop) => {
        expectOopToBeTrue(resultOop);
      });
    });

    it('returns the result of evaluating the callback', () => {
      const expectedResult = 'callback result';

      const result = gciLibrary.executeAndRelease(session, 'true', () => expectedResult);

      expect(result).toBe(expectedResult);
    });

    it('releases the resulting oop after the callback returns', () => {
      let oopToRelease: bigint;

      gciLibrary.executeAndRelease(session, 'Object new', (resultOop) => {
        oopToRelease = resultOop;
      });

      expectPureExportSetToIncludeOop(false, oopToRelease!);
    });

    it('releases the resulting oop even when the callback throws', () => {
      let oopToRelease: bigint;
      const captureResultOopAndFail = (resultOop: bigint) => {
        oopToRelease = resultOop;
        throw new Error();
      };

      expect(() =>
        gciLibrary.executeAndRelease(session, 'Object new', captureResultOopAndFail),
      ).toThrow();

      expectPureExportSetToIncludeOop(false, oopToRelease!);
    });

    it("re-throws the callback's error unchanged", () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.executeAndRelease(session, 'true', () => throwExpectedError());
      });
    });

    it('throws when the evaluated code signals an error', () => {
      expectToThrowExpectedGciLibraryError((signalExpectedErrorExpression) => {
        gciLibrary.executeAndRelease(session, signalExpectedErrorExpression, () => {});
      });
    });

    it('does not evaluate the callback when the evaluated code signals an error', () => {
      let callbackEvaluated = false;

      expect(() =>
        gciLibrary.executeAndRelease(session, `self error: 'oops'`, () => {
          callbackEvaluated = true;
        }),
      ).toThrow();

      expect(callbackEvaluated).toBe(false);
    });

    it("still returns the callback's result when releasing the oop fails", () => {
      simulateReleaseObjectFailure(() => {
        const result = gciLibrary.executeAndRelease(session, 'true', () => 'callback result');

        expect(result).toBe('callback result');
      });
    });

    it('still throws the original error when the callback and its cleanup both fail', () => {
      simulateReleaseObjectFailure(() => {
        expectToThrowExpectedError((throwExpectedError) => {
          gciLibrary.executeAndRelease(session, 'true', () => throwExpectedError());
        });
      });
    });
  });

  describe('sending messages', () => {
    it('returns the result of sending a message', () => {
      const result = gciLibrary.perform(session, gciLibrary.falseOop(), 'not');

      expectOopToBeTrue(result);
    });

    it('throws when the receiver does not understand the selector', () => {
      // 'new' is used because it's a well-known selector that's always
      // already a real Symbol. A made-up selector like 'foo' raises
      // NameError instead, but only until something -- anything, even
      // unrelated to this test -- compiles that exact text as a Symbol
      // literal or send in this session; after that it raises
      // MessageNotUnderstood instead, so a made-up selector's expected
      // error flips depending on what else ran earlier in the file.
      expectToThrowGciLibraryError(
        () => gciLibrary.perform(session, gciLibrary.falseOop(), 'new'),
        "a MessageNotUnderstood occurred (error 2010), a Boolean does not understand  #'new'",
      );
    });
  });

  describe('sending messages asynchronously', () => {
    it('returns the result of sending a message', async () => {
      const result = await gciLibrary.performAsync(session, gciLibrary.falseOop(), 'not');

      expectOopToBeTrue(result);
    });

    it('throws when the receiver does not understand the selector', async () => {
      // 'new' is used because it's a well-known selector that's always
      // already a real Symbol. A made-up selector like 'foo' raises
      // NameError instead, but only until something -- anything, even
      // unrelated to this test -- compiles that exact text as a Symbol
      // literal or send in this session; after that it raises
      // MessageNotUnderstood instead, so a made-up selector's expected
      // error flips depending on what else ran earlier in the file.
      await expectToBeRejectedWithGciLibraryError(
        gciLibrary.performAsync(session, gciLibrary.falseOop(), 'new'),
        "a MessageNotUnderstood occurred (error 2010), a Boolean does not understand  #'new'",
      );
    });

    it('throws when the sent method signals an error', async () => {
      const receiverOop = gciLibrary.execute(
        session,
        `
                | errorClass |
                errorClass := Object subclass: #GciLibraryTestAsyncError instVarNames: {} inDictionary: UserGlobals.
                errorClass compileMethod: 'signalError self error: ''oops'''.
                errorClass new
            `,
      );

      await expectToBeRejectedWithGciLibraryError(
        gciLibrary.performAsync(session, receiverOop, 'signalError'),
        'a UserDefinedError occurred (error 2318), reason:halt, oops',
      );
    });

    /**
     * A fresh instance of a class that understands `waitThenAnswerOne`, a
     * method that waits one second and then answers `1`, so tests can send it
     * a unary message that takes real, observable time to complete. Built
     * outside `run` so defining the class does not land inside the window a
     * test measures.
     */
    let delayedReceiverOop: bigint;

    beforeEach(() => {
      delayedReceiverOop = gciLibrary.execute(
        session,
        `
                | delayingClass |
                delayingClass := Object subclass: #GciLibraryTestAsyncDelay instVarNames: {} inDictionary: UserGlobals.
                delayingClass compileMethod: 'waitThenAnswerOne (Delay forSeconds: 1) wait. ^ 1'.
                delayingClass new
            `,
      );
    });

    itBehavesLikeANonBlockingOperation({
      slow: {
        run: () => gciLibrary.performAsync(session, delayedReceiverOop, 'waitThenAnswerOne'),
        expectedResult: 1n,
      },
      quick: {
        run: () =>
          gciLibrary.performAsync(
            session,
            gciLibrary.GciTsI64ToOop(session, 2n).result,
            'yourself',
          ),
        expectedResult: 2n,
      },
      decodeResult: (resultOop) => gciLibrary.oopToInteger(session, resultOop),
    });
  });

  describe('sending a message and releasing its result automatically', () => {
    it('passes the resulting oop to the callback', () => {
      gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'not', (resultOop) => {
        expectOopToBeTrue(resultOop);
      });
    });

    it('returns the result of evaluating the callback', () => {
      const expectedResult = 'callback result';

      const result = gciLibrary.performAndRelease(
        session,
        gciLibrary.falseOop(),
        'not',
        () => expectedResult,
      );

      expect(result).toBe(expectedResult);
    });

    it('releases the resulting oop after the callback returns', () => {
      let oopToRelease: bigint;

      gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'asString', (resultOop) => {
        oopToRelease = resultOop;
      });

      expectPureExportSetToIncludeOop(false, oopToRelease!);
    });

    it('releases the resulting oop even when the callback throws', () => {
      let oopToRelease: bigint;
      const captureResultOopAndFail = (resultOop: bigint) => {
        oopToRelease = resultOop;
        throw new Error();
      };

      expect(() =>
        gciLibrary.performAndRelease(
          session,
          gciLibrary.falseOop(),
          'asString',
          captureResultOopAndFail,
        ),
      ).toThrow();

      expectPureExportSetToIncludeOop(false, oopToRelease!);
    });

    it("re-throws the callback's error unchanged", () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'not', () =>
          throwExpectedError(),
        );
      });
    });

    it('throws when sending a message signals an error', () => {
      // 'new' is used because it's a well-known selector that's always
      // already a real Symbol. A made-up selector like 'foo' raises
      // NameError instead, but only until something -- anything, even
      // unrelated to this test -- compiles that exact text as a Symbol
      // literal or send in this session; after that it raises
      // MessageNotUnderstood instead, so a made-up selector's expected
      // error flips depending on what else ran earlier in the file.
      expectToThrowGciLibraryError(
        () => gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'new', () => {}),
        "a MessageNotUnderstood occurred (error 2010), a Boolean does not understand  #'new'",
      );
    });

    it('does not evaluate the callback when sending a message signals an error', () => {
      let callbackEvaluated = false;

      expect(() =>
        gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'foo', () => {
          callbackEvaluated = true;
        }),
      ).toThrow();

      expect(callbackEvaluated).toBe(false);
    });

    it("still returns the callback's result when releasing the oop fails", () => {
      simulateReleaseObjectFailure(() => {
        const result = gciLibrary.performAndRelease(
          session,
          gciLibrary.falseOop(),
          'not',
          () => 'callback result',
        );

        expect(result).toBe('callback result');
      });
    });

    it('still throws the original error when the callback and its cleanup both fail', () => {
      simulateReleaseObjectFailure(() => {
        expectToThrowExpectedError((throwExpectedError) => {
          gciLibrary.performAndRelease(session, gciLibrary.falseOop(), 'not', () =>
            throwExpectedError(),
          );
        });
      });
    });
  });

  describe('creating strings', () => {
    it('creates a String object from the given contents', () => {
      const oop = gciLibrary.createString(session, 'hello');

      // The comparison source itself compiles literals as Utf8 (see
      // execute's doc comment) -- String>>= disallows comparing a plain
      // String against a Unicode-kind argument, so convert explicitly.
      expectOopToBeTrue(
        gciLibrary.execute(session, `(Object objectForOop: ${oop}) = 'hello' asString`),
      );
    });
  });

  describe('resolving symbols', () => {
    it('resolves the Utf8 class', () => {
      const expectedOop = gciLibrary.execute(session, 'Utf8');

      const utf8ClassOop = gciLibrary.utf8ClassOop(session);

      expect(utf8ClassOop).toBe(expectedOop);
    });

    it('resolves the Utf8 class via a symbol lookup the first time it is needed', () => {
      expectUtf8OopToResolveViaSymbolLookup(session, gciLibrary);
    });

    it('reuses the cached Utf8 class oop on later lookups', () => {
      gciLibrary.utf8ClassOop(session);

      expectUtf8OopToBeCached(session, gciLibrary);
    });

    it('adds only the resolved oop to the PureExportSet', () => {
      expectPureExportSetToGainOnlyOopsProvidedBy(true, () => [
        gciLibrary.resolveSymbol(session, 'Object'),
      ]);
    });

    it('does not modify the PureExportSet when a symbol lookup fails', () => {
      expectPureExportSetToStayUnchanged(() => {
        expect(() => gciLibrary.resolveSymbol(session, '')).toThrow();
      });
    });

    it('resolves a symbol that exists in the user namespace', () => {
      const expectedOop = gciLibrary.execute(session, 'Object');

      const foundOop = gciLibrary.resolveSymbol(session, 'Object');

      expect(foundOop).equals(expectedOop);
    });

    it('throws when symbols cannot be resolved', () => {
      // Expected message is empty: GciTsResolveSymbolObj's "not found"
      // case leaves *err unpopulated, despite gcits.hf implying it does.
      expectToThrowGciLibraryError(() => gciLibrary.resolveSymbol(session, ''), '');
    });

    it('forces a fresh symbol lookup after releasing the cached oop', () => {
      gciLibrary.utf8ClassOop(session);

      gciLibrary.releaseCachedUtf8Oop(session);

      expectUtf8OopToResolveViaSymbolLookup(session, gciLibrary);
    });

    it('re-resolves the Utf8 oop after a logout/login cycle', () => {
      gciLibrary.utf8ClassOop(session);
      testContext.logout();

      testContext.login();

      expectUtf8OopToResolveViaSymbolLookup(session, gciLibrary);
    });

    it("a new session doesn't have another session's cached Utf8 oop", () => {
      gciLibrary.utf8ClassOop(session);

      testContext.withTransientSession((transientSession) => {
        expectUtf8OopToResolveViaSymbolLookup(transientSession, gciLibrary);
      });
    });

    it("logging out a session does not clear another session's cached Utf8 oop", () => {
      gciLibrary.utf8ClassOop(session);

      testContext.withTransientSession(() => {
        // Intentionally empty: withTransientSession logs it out as soon as this callback returns,
        // which is all this test needs -- it exercises the logout cache-cleanup
        // path for a session other than `session`, so the assertion below can
        // check that `session`'s own cached oop survived it untouched.
      });

      expectUtf8OopToBeCached(session, gciLibrary);
    });
  });

  describe('evaluating expressions and fetching the result as a string', () => {
    it('returns the result of code that evaluates to an empty string', () => {
      expectEvaluatedStringToBe(`''`, '');
    });

    it('returns the result of code that evaluates to a string', () => {
      expectEvaluatedStringToBe(`'a'`, 'a');
    });

    it('returns the result of code that evaluates to an UTF-16 string', () => {
      expectEvaluatedStringToBe(`'a' encodeAsUTF16`, 'a');
    });

    it('returns the result of code that evaluates to a multi-byte Unicode string', () => {
      expectEvaluatedStringToBe(`'—'`, '—');
    });

    it('returns the result of code with variables that evaluates to a string', () => {
      expectEvaluatedStringToBe(`|a| a:= 'a'. a`, 'a');
    });

    it('returns the result of code that evaluates to a string that does not fill a fetch page', () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES - 1);

      expectEvaluatedStringToBe(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that fills exactly one fetch page', () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES);

      expectEvaluatedStringToBe(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that fills exactly more than one fetch page', () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES * 2);

      expectEvaluatedStringToBe(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that slightly exceeds a fetch page', () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES + 1);

      expectEvaluatedStringToBe(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that splits a multi-byte character across a fetch page boundary', () => {
      const asciiPrefixLength = GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES - 1;
      const expectedResult = 'a'.repeat(asciiPrefixLength) + '—';

      // Built via Smalltalk concatenation, not embedded as one giant
      // source literal -- a source literal this size hits an unrelated
      // limit in how execute() transmits multi-byte source code.
      expectEvaluatedStringToBe(
        `((String new: ${asciiPrefixLength}) atAllPut: $a; yourself) , '—'`,
        expectedResult,
      );
    });

    function expectToThrowNonByteStringError() {
      expectToThrowGciLibraryError(
        () =>
          gciLibrary.executeAndFetchString(
            session,
            `
                    "executeAndFetchString sends #encodeAsUTF8 to the evaluated result, then
                    fetches bytes from whatever comes back, assuming it's a byte object. This
                    class's encodeAsUTF8 lies about that -- it answers self, not a byte
                    object -- to exercise what happens when the contract is broken."

                    | encodeAsUTF8LiarClass |
                    encodeAsUTF8LiarClass := Object subclass: #EncodeAsUTF8Liar instVarNames: {} inDictionary: UserGlobals.
                    encodeAsUTF8LiarClass compileMethod: 'encodeAsUTF8 ^ self'.
                    encodeAsUTF8LiarClass new
                `,
          ),
        'a ArgumentTypeError occurred (error 2103), The object anEncodeAsUTF8Liar is not implemented as a byte object.',
      );
    }

    it('fails when trying to fetch a string from a non-string oop', () => {
      expectToThrowNonByteStringError();
    });

    it('still throws the original error when the callback and its cleanup both fail', () => {
      simulateReleaseObjectFailure(() => {
        expectToThrowNonByteStringError();
      });
    });

    it('does not modify PureExportSet', () => {
      expectPureExportSetToStayUnchanged(() => {
        gciLibrary.executeAndFetchString(session, `'a'`);
      });
    });

    it('returns the result of code that uses a non-local return', () => {
      expectEvaluatedStringToBe(`^ 'a' encodeAsUTF16`, 'a');
    });
  });

  describe('evaluating expressions and fetching the result as a string asynchronously', () => {
    it('returns the result of code that evaluates to an empty string', async () => {
      await expectEvaluatedStringToBeAsync(`''`, '');
    });

    it('returns the result of code that evaluates to a string', async () => {
      await expectEvaluatedStringToBeAsync(`'a'`, 'a');
    });

    it('returns the result of code that evaluates to an UTF-16 string', async () => {
      await expectEvaluatedStringToBeAsync(`'a' encodeAsUTF16`, 'a');
    });

    it('returns the result of code that evaluates to a multi-byte Unicode string', async () => {
      await expectEvaluatedStringToBeAsync(`'—'`, '—');
    });

    it('returns the result of code with variables that evaluates to a string', async () => {
      await expectEvaluatedStringToBeAsync(`|a| a:= 'a'. a`, 'a');
    });

    it('returns the result of code that evaluates to a string that does not fill a fetch page', async () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES - 1);

      await expectEvaluatedStringToBeAsync(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that fills exactly one fetch page', async () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES);

      await expectEvaluatedStringToBeAsync(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that fills exactly more than one fetch page', async () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES * 2);

      await expectEvaluatedStringToBeAsync(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that slightly exceeds a fetch page', async () => {
      const expectedResult = 'a'.repeat(GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES + 1);

      await expectEvaluatedStringToBeAsync(`'${expectedResult}'`, expectedResult);
    });

    it('returns the result of code that evaluates to a string that splits a multi-byte character across a fetch page boundary', async () => {
      const asciiPrefixLength = GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES - 1;
      const expectedResult = 'a'.repeat(asciiPrefixLength) + '—';

      // Built via Smalltalk concatenation, not embedded as one giant
      // source literal: a source literal this size hits an unrelated
      // limit in how execute() transmits multi-byte source code.
      await expectEvaluatedStringToBeAsync(
        `((String new: ${asciiPrefixLength}) atAllPut: $a; yourself) , '—'`,
        expectedResult,
      );
    });

    function expectToBeRejectedWithNonByteStringError() {
      return expectToBeRejectedWithGciLibraryError(
        gciLibrary.executeAndFetchStringAsync(
          session,
          `
                    "executeAndFetchStringAsync sends #encodeAsUTF8 to the evaluated result, then
                    fetches bytes from whatever comes back, assuming it's a byte object. This
                    class's encodeAsUTF8 lies about that (it answers a new instance of
                    itself, not a byte object) to exercise what happens when the contract
                    is broken. A new instance, rather than self, keeps the evaluated result
                    and the encoded one distinct oops, so a missed release of either shows up."

                    | encodeAsUTF8LiarClass |
                    encodeAsUTF8LiarClass := Object subclass: #EncodeAsUTF8Liar instVarNames: {} inDictionary: UserGlobals.
                    encodeAsUTF8LiarClass compileMethod: 'encodeAsUTF8 ^ self class new'.
                    encodeAsUTF8LiarClass new
                `,
        ),
        'a ArgumentTypeError occurred (error 2103), The object anEncodeAsUTF8Liar is not implemented as a byte object.',
      );
    }

    it('throws when the evaluated code signals an error', async () => {
      await expectToBeRejectedWithExpectedGciLibraryError((signalExpectedErrorExpression) =>
        gciLibrary.executeAndFetchStringAsync(session, signalExpectedErrorExpression),
      );
    });

    function expectToBeRejectedWithEncodingNotUnderstoodError() {
      return expectToBeRejectedWithGciLibraryError(
        gciLibrary.executeAndFetchStringAsync(
          session,
          `
                    "Defines a class of its own, rather than using e.g. Object, so a test
                    can tell its instances apart from anything else in the PureExportSet."
                    (Object subclass: #EncodeAsUTF8Refuser instVarNames: {} inDictionary: UserGlobals) new
                `,
        ),
        "a MessageNotUnderstood occurred (error 2010), a EncodeAsUTF8Refuser does not understand  #'encodeAsUTF8'",
      );
    }

    it('fails when the result cannot be encoded as UTF-8', async () => {
      await expectToBeRejectedWithEncodingNotUnderstoodError();
    });

    it('releases the evaluated result when it cannot be encoded as UTF-8', async () => {
      await expectToBeRejectedWithEncodingNotUnderstoodError();

      expectNoInstanceToRemainInPureExportSet('EncodeAsUTF8Refuser');
    });

    it('fails when trying to fetch a string from a non-string oop', async () => {
      await expectToBeRejectedWithNonByteStringError();
    });

    it('still throws the original error when the callback and its cleanup both fail', async () => {
      await simulateReleaseObjectFailureAsync(async () => {
        await expectToBeRejectedWithNonByteStringError();
      });
    });

    it('does not modify PureExportSet', async () => {
      await expectPureExportSetToStayUnchangedAsync(() =>
        gciLibrary.executeAndFetchStringAsync(session, `'a'`),
      );
    });

    it('releases the evaluated and encoded results when the result cannot be fetched as a string', async () => {
      await expectToBeRejectedWithNonByteStringError();

      expectNoInstanceToRemainInPureExportSet('EncodeAsUTF8Liar');
    });

    it('returns the result of code that uses a non-local return', async () => {
      await expectEvaluatedStringToBeAsync(`^ 'a' encodeAsUTF16`, 'a');
    });

    it('does not block the event loop while encoding the result as UTF-8', async () => {
      await expectEventLoopToRemainResponsiveDuring(100, 800, () =>
        gciLibrary.executeAndFetchStringAsync(
          session,
          `
                    "The shared non-blocking tests only make evaluating the code slow. This
                    class makes the encodeAsUTF8 send slow instead, so a blocking send
                    would show up."

                    | encodeAsUTF8SleeperClass |
                    encodeAsUTF8SleeperClass := Object subclass: #EncodeAsUTF8Sleeper instVarNames: {} inDictionary: UserGlobals.
                    encodeAsUTF8SleeperClass compileMethod: 'encodeAsUTF8 (Delay forSeconds: 1) wait. ^ ''a'' encodeAsUTF8'.
                    encodeAsUTF8SleeperClass new
                `,
        ),
      );
    });

    itBehavesLikeANonBlockingOperation({
      slow: {
        run: () =>
          gciLibrary.executeAndFetchStringAsync(session, `(Delay forSeconds: 1) wait. 'a'`),
        expectedResult: 'a',
      },
      quick: {
        run: () => gciLibrary.executeAndFetchStringAsync(session, `'b'`),
        expectedResult: 'b',
      },
      decodeResult: (result) => result,
    });
  });

  describe('evaluating expressions and fetching the result as an integer', () => {
    it('decodes a positive SmallInteger', () => {
      expectEvaluatedIntegerToBe('42', 42n);
    });

    it('decodes a negative SmallInteger', () => {
      expectEvaluatedIntegerToBe('-42', -42n);
    });

    it('decodes a LargeInteger within the 64-bit range', () => {
      expectEvaluatedIntegerToBe('2 raisedTo: 62', 2n ** 62n);
    });

    it("preserves precision beyond JS's safe-integer range", () => {
      expectEvaluatedIntegerToBe('(2 raisedTo: 60) - 1', 1152921504606846975n);
    });

    it('throws when the result is a non-integer object', () => {
      expectToThrowGciLibraryError(
        () => gciLibrary.executeAndFetchInteger(session, `'a'`),
        'LargeInteger not representable as int64',
      );
    });

    it('throws when the result is nil', () => {
      expectToThrowGciLibraryError(() => gciLibrary.executeAndFetchInteger(session, 'nil'), '');
    });

    it('throws when the integer exceeds 64 bits', () => {
      expectToThrowGciLibraryError(
        () => gciLibrary.executeAndFetchInteger(session, '2 raisedTo: 100'),
        'LargeInteger not representable as int64',
      );
    });

    it('does not modify PureExportSet', () => {
      expectPureExportSetToStayUnchanged(() => {
        gciLibrary.executeAndFetchInteger(session, '42');
      });
    });

    it('returns the result of code that uses a non-local return', () => {
      expectEvaluatedIntegerToBe('^ 42', 42n);
    });
  });

  describe('UserGlobals management', () => {
    it('retrieves the stored value under the returned key', () => {
      const key = gciLibrary.storeInUniqueUserGlobalsKey(session, 'true');

      const value = gciLibrary.valueOfUserGlobalsKey(session, key);

      expectOopToBeTrue(value);
    });

    it('includes a key after it is stored', () => {
      const key = gciLibrary.storeInUniqueUserGlobalsKey(session, 'true');

      expectUserGlobalsToInclude(key, true);
    });

    it('does not modify the PureExportSet when storing a UserGlobals key', () => {
      expectPureExportSetToStayUnchanged(() =>
        gciLibrary.storeInUniqueUserGlobalsKey(session, 'true'),
      );
    });

    it('stores each value under a distinct key', () => {
      const firstKey = gciLibrary.storeInUniqueUserGlobalsKey(session, 'true');
      const secondKey = gciLibrary.storeInUniqueUserGlobalsKey(session, 'nil');

      expect(firstKey).not.toBe(secondKey);
      expectOopToBeTrue(gciLibrary.valueOfUserGlobalsKey(session, firstKey));
      expectOopToBeNil(gciLibrary.valueOfUserGlobalsKey(session, secondKey));
    });
  });

  describe('SessionTemps management', () => {
    it('empties SessionTemps', () => {
      gciLibrary.storeInUniqueSessionTempsKey(session, 'true');

      gciLibrary.resetSessionTemps(session);

      expectSessionTempsToBeEmpty(true);
    });

    it('does not modify the PureExportSet when resetting SessionTemps', () => {
      expectPureExportSetToStayUnchanged(() => gciLibrary.resetSessionTemps(session));
    });

    it('is empty when nothing has been stored', () => {
      expectSessionTempsToBeEmpty(true);
    });

    it('is not empty once a key has been stored', () => {
      gciLibrary.storeInUniqueSessionTempsKey(session, 'true');

      expectSessionTempsToBeEmpty(false);
    });

    it('retrieves the stored value under the returned key', () => {
      const key = gciLibrary.storeInUniqueSessionTempsKey(session, 'true');

      const value = gciLibrary.valueOfSessionTempsKey(session, key);

      expectOopToBeTrue(value);
    });

    it('stores each value under a distinct key', () => {
      const firstKey = gciLibrary.storeInUniqueSessionTempsKey(session, 'true');
      const secondKey = gciLibrary.storeInUniqueSessionTempsKey(session, 'nil');

      expect(firstKey).not.toBe(secondKey);
      expectOopToBeTrue(gciLibrary.valueOfSessionTempsKey(session, firstKey));
      expectOopToBeNil(gciLibrary.valueOfSessionTempsKey(session, secondKey));
    });
  });

  describe('PureExportSet management', () => {
    it('does not gain only the provided oops when the callback removes an object from the PureExportSet', () => {
      const oopToRemove = gciLibrary.execute(session, 'Object new');

      expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
        gciLibrary.releaseObject(session, oopToRemove);
        return [];
      });
    });

    it('does not gain only the provided oops when the callback swaps objects in the PureExportSet', () => {
      const oopToSwap = gciLibrary.execute(session, 'Object new');

      expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
        gciLibrary.releaseObject(session, oopToSwap);
        gciLibrary.execute(session, 'Object new');
        return [];
      });
    });

    it('does not gain only the provided oops when the callback declares an oop that was already present', () => {
      const oopAlreadyPresent = gciLibrary.execute(session, 'Object new');

      expectPureExportSetToGainOnlyOopsProvidedBy(false, () => [oopAlreadyPresent]);
    });

    it('gains only the provided oops when the callback does not change the PureExportSet', () => {
      expectPureExportSetToGainOnlyOopsProvidedBy(true, () => []);
    });

    it('gains only the provided oops when the callback adds an object to the PureExportSet', () => {
      expectPureExportSetToGainOnlyOopsProvidedBy(true, () => {
        const addedOop = gciLibrary.execute(session, 'Object new');
        return [addedOop];
      });
    });

    it('does not stay unchanged when the callback adds an undeclared object to it', () => {
      expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
        gciLibrary.execute(session, 'Object new');
        return [];
      });
    });

    it('re-throws errors from the callback', () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, throwExpectedError);
      });
    });

    it('cleans up the snapshot key when the callback succeeds', () => {
      let snapshotNameToRemove: string;
      const captureSnapshotName = (snapshotName: string) => {
        snapshotNameToRemove = snapshotName;
        return [];
      };

      gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, captureSnapshotName);

      expectUserGlobalsToInclude(snapshotNameToRemove!, false);
    });

    it('cleans up the snapshot key when the callback throws', () => {
      let snapshotNameToRemove: string;
      const captureSnapshotNameAndFail = (snapshotName: string) => {
        snapshotNameToRemove = snapshotName;
        throw new Error();
      };

      expect(() =>
        gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, captureSnapshotNameAndFail),
      ).toThrow();
      expectUserGlobalsToInclude(snapshotNameToRemove!, false);
    });

    it('still throws the original error when cleaning up the snapshot key also fails', () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, (snapshotName: string) => {
          // Removing the key here means it's already gone by the time
          // didPureExportSetGainOnlyOopsProvidedBy's own cleanup tries to
          // remove it again, so that second removal genuinely fails.
          gciLibrary.removeKeyFromUserGlobals(session, snapshotName);
          return throwExpectedError();
        });
      });
    });

    it('empties the PureExportSet', () => {
      gciLibrary.execute(session, 'Object new');

      gciLibrary.releaseAllObjects(session);

      expectOopToBeTrue(
        gciLibrary.execute(session, '(GsBitmap newForHiddenSet: #PureExportSet) isEmpty'),
      );
    });

    it('includes an oop currently held in it', () => {
      const existingOop = gciLibrary.execute(session, 'Object new');

      expectPureExportSetToIncludeOop(true, existingOop);
    });

    it('does not include an oop after it is released', () => {
      const oopToRelease = gciLibrary.execute(session, 'Object new');

      gciLibrary.releaseObject(session, oopToRelease);

      expectPureExportSetToIncludeOop(false, oopToRelease);
    });

    it('does not include an oop that was never stored', () => {
      expectPureExportSetToIncludeOop(false, gciLibrary.nilOop());
    });
  });

  describe('logging in', () => {
    it('throws a GciLibraryError when the credentials are invalid', () => {
      expectToThrowGciLibraryError(
        () => testContext.login({ user: 'NonExistentUser' }),
        'Login failed:  the userId/password combination is invalid or expired.',
      );
    });
  });

  describe('resetting non-transactional session state', () => {
    it('empties SessionTemps', () => {
      gciLibrary.storeInUniqueSessionTempsKey(session, 'true');

      gciLibrary.resetNonTransactionalSessionState(session);

      expectSessionTempsToBeEmpty(true);
    });

    it('clears the cached Utf8 oop', () => {
      gciLibrary.utf8ClassOop(session);

      gciLibrary.resetNonTransactionalSessionState(session);

      expectUtf8OopToResolveViaSymbolLookup(session, gciLibrary);
    });

    it('releases previously created objects from the PureExportSet', () => {
      const oopToRelease = gciLibrary.execute(session, 'Object new');

      gciLibrary.resetNonTransactionalSessionState(session);

      expectPureExportSetToIncludeOop(false, oopToRelease);
    });

    it('does not add anything new to the PureExportSet', () => {
      expectPureExportSetToGrow(false, () => {
        gciLibrary.resetNonTransactionalSessionState(session);
      });
    });
  });

  describe('checking whether the PureExportSet grew', () => {
    it('does not grow when the callback does not modify the PureExportSet', () => {
      expectPureExportSetToGrow(false, () => {});
    });

    it('grows when the callback adds a new object', () => {
      expectPureExportSetToGrow(true, () => {
        gciLibrary.execute(session, 'Object new');
      });
    });

    it('does not grow when the callback only removes an object', () => {
      const oop = gciLibrary.execute(session, 'Object new');

      expectPureExportSetToGrow(false, () => {
        gciLibrary.releaseObject(session, oop);
      });
    });

    it('stores the snapshot in UserGlobals while the callback runs', () => {
      gciLibrary.didPureExportSetGrow(session, (snapshotName) => {
        expectUserGlobalsToInclude(snapshotName, true);
      });
    });

    it('cleans up the snapshot key when the callback succeeds', () => {
      let snapshotNameToRemove: string;

      gciLibrary.didPureExportSetGrow(session, (snapshotName) => {
        snapshotNameToRemove = snapshotName;
      });

      expectUserGlobalsToInclude(snapshotNameToRemove!, false);
    });

    it('re-throws errors from the callback', () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.didPureExportSetGrow(session, throwExpectedError);
      });
    });

    it('cleans up the snapshot key when the callback throws', () => {
      let snapshotNameToRemove: string;
      const captureSnapshotNameAndFail = (snapshotName: string) => {
        snapshotNameToRemove = snapshotName;
        throw new Error();
      };

      expect(() => gciLibrary.didPureExportSetGrow(session, captureSnapshotNameAndFail)).toThrow();

      expectUserGlobalsToInclude(snapshotNameToRemove!, false);
    });

    it('still throws the original error when cleaning up the snapshot key also fails', () => {
      expectToThrowExpectedError((throwExpectedError) => {
        gciLibrary.didPureExportSetGrow(session, (snapshotName: string) => {
          // Removing the key here means it's already gone by the time
          // didPureExportSetGrow's own cleanup tries to remove it again,
          // so that second removal genuinely fails.
          gciLibrary.removeKeyFromUserGlobals(session, snapshotName);
          return throwExpectedError();
        });
      });
    });
  });
});
