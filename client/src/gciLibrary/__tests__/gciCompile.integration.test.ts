import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The GCI's method-dictionary calls: compiling a method — the call every
 * method save in the extension goes through — plus wholesale removal and the
 * method-protection switch, neither of which has a caller outside these tests.
 * Each test defines the class it needs, and the harness aborts afterward, so
 * nothing here is ever committed and no test depends on another having run.
 */
describe('GCI method compilation (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  const TEST_CLASS = 'GciTestClass';

  const execute = (source: string) =>
    gci.GciTsExecute(session, source, OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0);

  /** Defines the (transient) class the tests compile methods into. */
  const defineTestClass = (): bigint => {
    const { err } = execute(
      `Object subclass: #${TEST_CLASS} instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    expect(err.number).toBe(0);

    return gci.resolveSymbol(session, TEST_CLASS);
  };

  const compileMethod = (classOop: bigint, source: string, compileFlags = 0) => {
    const sourceOop = gci.GciTsNewString(session, source);
    expect(sourceOop.result).not.toBe(OOP_ILLEGAL);

    return gci.GciTsCompileMethod(
      session,
      sourceOop.result,
      classOop,
      OOP_NIL, // category: nil means "as yet unclassified"
      OOP_NIL, // symbolList: nil uses the default
      OOP_NIL, // overrideSelector: none
      compileFlags,
      0, // environmentId
    );
  };

  describe('GciTsCompileMethod', () => {
    it('compiles an instance method the instances then understand', () => {
      const classOop = defineTestClass();

      const { result, err } = compileMethod(classOop, 'testMethod\n  ^ 42');

      expect(err.number).toBe(0);
      // Success answers nil; a non-nil, legal OOP is a warnings string.
      expect(result).not.toBe(OOP_ILLEGAL);
      const { result: instance } = execute(`${TEST_CLASS} new`);
      const sent = gci.GciTsPerform(session, instance, OOP_ILLEGAL, 'testMethod', [], 0, 0);
      expect(sent.err.number).toBe(0);
      expect(gci.GciTsOopToI64(session, sent.result).value).toBe(42n);
    });

    it('compiles a class method when given the class-method flag', () => {
      const classOop = defineTestClass();
      const GCI_COMPILE_CLASS_METH = 1;

      const { result, err } = compileMethod(
        classOop,
        'classTestMethod\n  ^ #classResult',
        GCI_COMPILE_CLASS_METH,
      );

      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);
      const sent = gci.GciTsPerformFetchBytes(session, classOop, 'classTestMethod', [], 1024);
      expect(sent.err.number).toBe(0);
      expect(sent.data).toBe('classResult');
    });

    it('reports an error for source that is not a valid method', () => {
      const classOop = defineTestClass();

      const { result, err } = compileMethod(classOop, '!!! not valid smalltalk method !!!');

      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).not.toBe(0);
    });
  });

  describe('GciTsClassRemoveAllMethods', () => {
    it('leaves instances no longer understanding the methods their class defined', () => {
      const classOop = defineTestClass();
      compileMethod(classOop, 'testMethod\n  ^ 42');
      const { result: instance } = execute(`${TEST_CLASS} new`);
      // Without this the assertion below is vacuous: a method that never
      // compiled is also one the instance doesn't understand.
      expect(
        gci.GciTsPerform(session, instance, OOP_ILLEGAL, 'testMethod', [], 0, 0).err.number,
      ).toBe(0);
      const DEFAULT_ENVIRONMENT_ID = 0;

      const { success, err } = gci.GciTsClassRemoveAllMethods(
        session,
        classOop,
        DEFAULT_ENVIRONMENT_ID,
      );

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      const sent = gci.GciTsPerform(session, instance, OOP_ILLEGAL, 'testMethod', [], 0, 0);
      expect(sent.err.number).not.toBe(0);
    });
  });

  describe('GciTsProtectMethods', () => {
    /** From gcierr.ht — what turning protection on answers to a non-SystemUser session. */
    const RT_ERR_MUST_BE_SYSTEMUSER = 2213;

    /** The GemStone user the harness is logged in as. */
    const currentUserId = () => {
      const { data, err } = gci.GciTsExecuteFetchBytes(
        session,
        'System myUserProfile userId',
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        1024,
      );
      expect(err.number).toBe(0);

      return data;
    };

    it('refuses to turn method protection on for a session without SystemUser rights', (ctx) => {
      // Only SystemUser may switch method protection on, so whether this test
      // has a refusal to observe depends on the user of the stone it runs
      // against — VITE_GEMSTONE_USER, DataCurator on a stone provisioned by
      // `npm run test:server:start`, but overridable via `.env.test.local`.
      if (currentUserId() === 'SystemUser') {
        return ctx.skip('this stone logs in as SystemUser, so there is no refusal to observe');
      }

      const { success, err } = gci.GciTsProtectMethods(session, true);

      try {
        expect(success).toBe(false);
        expect(err.number).toBe(RT_ERR_MUST_BE_SYSTEMUSER);
      } finally {
        // Protection is session state the harness's abort can't roll back, so
        // undo it if this stone did let us through.
        if (success) gci.GciTsProtectMethods(session, false);
      }
    });
  });
});
