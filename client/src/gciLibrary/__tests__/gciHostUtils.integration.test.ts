import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The GCI library's host-side utilities: allocation, clock, sleep and
 * timestamp formatting. None of them take a session, but they are real native
 * calls, so they run against the loaded library under the harness.
 *
 * GciHostCallDebuggerMsg is deliberately not called — it blocks for 60
 * seconds waiting for a C debugger to attach. Its binding is non-optional
 * (gciLibrary.ts binds it via this.lib.func), so constructing the real
 * GciLibrary — as this suite does — already fails if the symbol is absent.
 */
describe('GCI host utilities (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  describe('GciShutdown', () => {
    it('is a no-op in the thread-safe GCI', () => {
      expect(() => gci.GciShutdown()).not.toThrow();
    });
  });

  describe('GciMalloc / GciFree', () => {
    it('allocates a buffer and frees it again', () => {
      const pointer = gci.GciMalloc(256);

      expect(pointer).not.toBeNull();
      expect(() => gci.GciFree(pointer)).not.toThrow();
    });
  });

  describe('GciHostFtime', () => {
    it('reports the current time as seconds plus milliseconds', () => {
      const { seconds, milliSeconds } = gci.GciHostFtime();

      // Any plausible clock is well past 2020-01-01.
      expect(seconds).toBeGreaterThan(1577836800);
      expect(milliSeconds).toBeGreaterThanOrEqual(0);
      expect(milliSeconds).toBeLessThan(1000);
    });
  });

  describe('GciHostMilliSleep', () => {
    it('sleeps for at least about the requested duration', () => {
      const start = Date.now();

      gci.GciHostMilliSleep(50);

      // Some tolerance: the host clock's resolution can under-report a sleep.
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });
  });

  describe('GciTimeStampMsStr', () => {
    it('formats the values GciHostFtime reports', () => {
      const { seconds, milliSeconds } = gci.GciHostFtime();

      const formatted = gci.GciTimeStampMsStr(seconds, milliSeconds);

      expect(formatted.length).toBeGreaterThan(0);
    });

    it('includes the milliseconds it was given', () => {
      const formatted = gci.GciTimeStampMsStr(1704067200, 500);

      expect(formatted).toContain('.500');
    });
  });
});
