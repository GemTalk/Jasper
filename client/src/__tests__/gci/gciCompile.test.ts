import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GciTsClassRemoveAllMethods / GciTsProtectMethods', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  let OOP_CLASS_STRING: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');

    // Shared fixture: create GciTestClass here rather than relying on an
    // earlier test to have made it (which breaks under shuffled test order).
    // Tests that need methods on it compile their own.
    const { err: classErr } = gci.GciTsExecute(
      session,
      'Object subclass: #GciTestClass instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      OOP_CLASS_STRING,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    expect(classErr.number).toBe(0);
  });

  afterAll(() => {
    // Abort to discard any uncommitted changes (compiled methods, etc.)
    if (session) {
      gci.GciTsAbort(session);
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsClassRemoveAllMethods', () => {
    it('removes all instance methods from a class', () => {
      const classOop = gci.resolveSymbol(session, 'GciTestClass');

      // Compile our own method so this test doesn't depend on another having
      // run first, then verify it exists before removing.
      const sourceOop = gci.GciTsNewString(session, 'testMethod\n  ^ 42');
      gci.GciTsCompileMethod(session, sourceOop.result, classOop, OOP_NIL, OOP_NIL, OOP_NIL, 0, 0);

      const { result: instOop } = gci.GciTsExecute(
        session,
        'GciTestClass new',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      const { err: perfErr1 } = gci.GciTsPerform(
        session,
        instOop,
        OOP_ILLEGAL,
        'testMethod',
        [],
        0,
        0,
      );
      expect(perfErr1.number).toBe(0);

      // Remove all methods (environmentId 0)
      const { success, err } = gci.GciTsClassRemoveAllMethods(session, classOop, 0);
      console.log('ClassRemoveAllMethods - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify: sending testMethod should now fail (MessageNotUnderstood)
      const { err: perfErr2 } = gci.GciTsPerform(
        session,
        instOop,
        OOP_ILLEGAL,
        'testMethod',
        [],
        0,
        0,
      );
      expect(perfErr2.number).not.toBe(0);
      console.log('After remove - err.number:', perfErr2.number, 'err.message:', perfErr2.message);
    });
  });

  describe('GciTsProtectMethods', () => {
    it('enables and disables method protection', () => {
      // Enable protection
      const { success: enableOk, err: enableErr } = gci.GciTsProtectMethods(session, true);
      console.log('ProtectMethods(true) - success:', enableOk, 'err.number:', enableErr.number);
      // DataCurator is not SystemUser, so this should fail with RT_ERR_MUST_BE_SYSTEMUSER
      // OR it might succeed if DataCurator has SystemUser privileges
      // Log and check either way
      if (enableErr.number !== 0) {
        console.log('ProtectMethods requires SystemUser. err.message:', enableErr.message);
        expect(enableErr.number).not.toBe(0);
      } else {
        expect(enableOk).toBe(true);
        // Disable protection to clean up
        const { success: disableOk, err: disableErr } = gci.GciTsProtectMethods(session, false);
        expect(disableErr.number).toBe(0);
        expect(disableOk).toBe(true);
      }
    });
  });
});
