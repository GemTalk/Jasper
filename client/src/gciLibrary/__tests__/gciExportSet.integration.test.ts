import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Export Set and Free OOPs', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;
  });

  afterAll(() => {
    if (session) {
      gci.GciTsAbort(session);
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsGetFreeOops', () => {
    it('allocates free OOPs', () => {
      const { result, oops, err } = gci.GciTsGetFreeOops(session, 3);
      console.log(
        'GetFreeOops(3) - result:',
        result,
        'oops:',
        oops.map((o) => o.toString(16)),
      );
      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect(oops).toHaveLength(3);

      // Each OOP should be unique and not OOP_ILLEGAL
      for (const oop of oops) {
        expect(oop).not.toBe(OOP_ILLEGAL);
        expect(oop).not.toBe(OOP_NIL);
      }
      const unique = new Set(oops.map((o) => o.toString()));
      expect(unique.size).toBe(3);
    });

    it('allocates a single free OOP', () => {
      const { result, oops, err } = gci.GciTsGetFreeOops(session, 1);
      expect(err.number).toBe(0);
      expect(result).toBe(1);
      expect(oops).toHaveLength(1);
      expect(oops[0]).not.toBe(OOP_ILLEGAL);
    });
  });

  describe('GciTsSaveObjs / GciTsReleaseObjs', () => {
    it('saves objects to the export set and releases them', () => {
      // Create some objects
      const str1 = gci.GciTsNewString(session, 'export-test-1');
      const str2 = gci.GciTsNewString(session, 'export-test-2');
      expect(str1.result).not.toBe(OOP_ILLEGAL);
      expect(str2.result).not.toBe(OOP_ILLEGAL);

      // Save to export set
      const { success: saveOk, err: saveErr } = gci.GciTsSaveObjs(session, [
        str1.result,
        str2.result,
      ]);
      console.log('SaveObjs - success:', saveOk, 'err.number:', saveErr.number);
      expect(saveErr.number).toBe(0);
      expect(saveOk).toBe(true);

      // Objects should still be accessible after save
      const fetched = gci.GciTsFetchUtf8(session, str1.result, 1024);
      expect(fetched.data).toBe('export-test-1');

      // Release from export set
      const { success: relOk, err: relErr } = gci.GciTsReleaseObjs(session, [
        str1.result,
        str2.result,
      ]);
      console.log('ReleaseObjs - success:', relOk, 'err.number:', relErr.number);
      expect(relErr.number).toBe(0);
      expect(relOk).toBe(true);
    });
  });

  describe('GciTsReleaseAllObjs', () => {
    it('releases all objects from the export set', () => {
      // Create and save some objects
      const str = gci.GciTsNewString(session, 'release-all-test');
      expect(str.result).not.toBe(OOP_ILLEGAL);

      gci.GciTsSaveObjs(session, [str.result]);

      // Release all
      const { success, err } = gci.GciTsReleaseAllObjs(session);
      console.log('ReleaseAllObjs - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });
  });
});
