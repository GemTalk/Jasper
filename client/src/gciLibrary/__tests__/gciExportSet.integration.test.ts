import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The export set — the gem-side set of objects the client has pinned so the
 * garbage collector leaves them alone — plus the allocation of free OOPs.
 * Pinning and unpinning is how the debugger keeps a variable's original value
 * alive across a revert; `GciTsGetFreeOops` has no caller outside these tests.
 */
describe('GCI export set (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  describe('GciTsGetFreeOops', () => {
    it('allocates as many distinct, usable OOPs as were asked for', () => {
      const { result, oops, err } = gci.GciTsGetFreeOops(session, 3);

      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect(oops).toHaveLength(3);
      expect(oops).not.toContain(OOP_ILLEGAL);
      expect(oops).not.toContain(OOP_NIL);
      expect(new Set(oops).size).toBe(3);
    });

    it('allocates a single OOP when asked for just one', () => {
      const { result, oops, err } = gci.GciTsGetFreeOops(session, 1);

      expect(err.number).toBe(0);
      expect(result).toBe(1);
      expect(oops).toHaveLength(1);
      expect(oops).not.toContain(OOP_ILLEGAL);
    });
  });

  describe('GciTsSaveObjs / GciTsReleaseObjs', () => {
    it('pins objects into the export set and lets them go again', () => {
      const first = gci.GciTsNewString(session, 'export-test-1').result;
      const second = gci.GciTsNewString(session, 'export-test-2').result;

      const saved = gci.GciTsSaveObjs(session, [first, second]);

      expect(saved.err.number).toBe(0);
      expect(saved.success).toBe(true);
      expect(gci.GciTsFetchUtf8(session, first, 1024).data).toBe('export-test-1');
      const released = gci.GciTsReleaseObjs(session, [first, second]);
      expect(released.err.number).toBe(0);
      expect(released.success).toBe(true);
    });
  });

  describe('GciTsReleaseAllObjs', () => {
    it('empties the export set in one call', () => {
      const oop = gci.GciTsNewString(session, 'release-all-test').result;
      gci.GciTsSaveObjs(session, [oop]);

      const { success, err } = gci.GciTsReleaseAllObjs(session);

      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });
  });
});
