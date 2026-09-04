import { describe, expect, it, vi } from 'vitest';
import { GciLibrary } from '../gciLibrary';
import { GciTestContext, useIntegrationTest } from './useIntegrationTest';
import { GciLibraryError } from '../gciLibraryError';
import {
  expectUtf8OopToBeCached,
  expectUtf8OopToResolveViaSymbolLookup,
} from './support/utf8OopCache';
import {
  expectEventLoopToBeBlockedDuringDefault,
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
   * Asserts that evaluating `codeToEvaluate` and fetching its result as an
   * integer yields `expectedResult`.
   *
   * @param codeToEvaluate - Smalltalk source to evaluate.
   * @param expectedResult - The integer the evaluated result is expected to decode to.
   */
  function expectEvaluatedIntegerToBe(codeToEvaluate: string, expectedResult: bigint) {
    expect(gciLibrary.executeAndFetchInteger(session, codeToEvaluate)).toBe(expectedResult);
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
      await expectToBeRejectedWithGciLibraryError(
        gciLibrary.executeAndFetchOop(session, `self error: 'oops'`),
        'a UserDefinedError occurred (error 2318), reason:halt, oops',
      );
    });

    it('does not block the event loop while GemStone evaluates the code', async () => {
      await expectEventLoopToRemainResponsiveDuring(100, 800, () =>
        gciLibrary.executeAndFetchOop(session, `(Delay forSeconds: 1) wait. true`),
      );
    });

    it('does not allow to execute a new operation while another is in progress', async () => {
      const firstOperation = gciLibrary.executeAndFetchOop(
        session,
        `(Delay forSeconds: 1) wait. true`,
      );

      try {
        await expectToBeRejectedWithGciLibraryError(
          gciLibrary.executeAndFetchOop(session, ``),
          'session has a GciTsNb operation in progress',
        );
      } finally {
        await firstOperation;
      }
    });

    it('does not affect the result of an ongoing operation when trying to execute another one', async () => {
      const firstOperation = gciLibrary.executeAndFetchOop(
        session,
        `(Delay forSeconds: 1) wait. true`,
      );

      await gciLibrary.executeAndFetchOop(session, `false`).catch(() => {});

      expectOopToBeTrue(await firstOperation);
    });

    /** Makes the next readiness check on the session's socket throw. */
    function simulatePollFailure() {
      vi.spyOn(testContext.nativeSocketLibrary, 'isReadable').mockThrowOnce('oops');
    }

    it('returns the result when polling for it fails', async () => {
      simulatePollFailure();

      const result = await gciLibrary.executeAndFetchOop(session, `true`);

      expectOopToBeTrue(result);
    });

    it('returns the result synchronously when polling for it fails', async () => {
      simulatePollFailure();

      await expectEventLoopToBeBlockedDuringDefault(100, () =>
        gciLibrary.executeAndFetchOop(session, `(Delay forSeconds: 1) wait. true`),
      );
    });
  });

  describe('identifying the socket for a session', () => {
    it('returns the file descriptor of the session socket', () => {
      expect(gciLibrary.socketFor(session)).toBeGreaterThanOrEqual(0);
    });

    it('throws when the session socket cannot be identified', () => {
      testContext.logout();

      expectToThrowGciLibraryError(
        () => gciLibrary.socketFor(session),
        'argument is not a valid GciSession pointer',
      );
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
