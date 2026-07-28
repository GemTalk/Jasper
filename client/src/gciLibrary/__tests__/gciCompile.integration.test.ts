import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Compiling methods through the GCI, the call every method save in the
 * extension goes through. Each test defines the class it needs, and the
 * harness aborts afterward, so nothing here is ever committed and no test
 * depends on another having run.
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
});
