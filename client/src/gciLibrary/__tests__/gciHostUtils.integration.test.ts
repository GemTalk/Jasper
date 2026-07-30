import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH } from '../../__tests__/gci/gciTestConfig';

describe('GCI Host Utility Functions', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  describe('GciShutdown', () => {
    it('completes without error (no-op)', () => {
      // GciShutdown has no effect in the thread-safe GCI
      expect(() => gci.GciShutdown()).not.toThrow();
    });
  });

  describe('GciMalloc / GciFree', () => {
    it('allocates and frees memory', () => {
      const ptr = gci.GciMalloc(256);
      console.log('GciMalloc(256) - ptr:', ptr);
      expect(ptr).not.toBeNull();

      // Free should not throw
      expect(() => gci.GciFree(ptr)).not.toThrow();
    });
  });

  // GciHostCallDebuggerMsg blocks for 60 seconds waiting for a C debugger
  // to attach. The binding is verified to load correctly via the constructor.

  describe('GciHostFtime', () => {
    it('returns current time with seconds and milliseconds', () => {
      const { seconds, milliSeconds } = gci.GciHostFtime();
      console.log('GciHostFtime - seconds:', seconds, 'milliSeconds:', milliSeconds);
      // seconds should be a reasonable Unix timestamp (after 2020-01-01)
      expect(seconds).toBeGreaterThan(1577836800);
      expect(milliSeconds).toBeGreaterThanOrEqual(0);
      expect(milliSeconds).toBeLessThan(1000);
    });
  });

  describe('GciHostMilliSleep', () => {
    it('sleeps for approximately the requested duration', () => {
      const start = Date.now();
      gci.GciHostMilliSleep(50);
      const elapsed = Date.now() - start;
      console.log('GciHostMilliSleep(50) - elapsed:', elapsed, 'ms');
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow some tolerance
    });
  });

  describe('GciTimeStampMsStr', () => {
    it('formats a timestamp string from GciHostFtime values', () => {
      const { seconds, milliSeconds } = gci.GciHostFtime();
      const str = gci.GciTimeStampMsStr(seconds, milliSeconds);
      console.log('GciTimeStampMsStr - result:', JSON.stringify(str));
      expect(str.length).toBeGreaterThan(0);
    });

    it('formats a known epoch timestamp', () => {
      // 2024-01-01 00:00:00.000 UTC = 1704067200
      const str = gci.GciTimeStampMsStr(1704067200, 500);
      console.log('GciTimeStampMsStr(2024-01-01) - result:', JSON.stringify(str));
      expect(str.length).toBeGreaterThan(0);
      // Should contain the milliseconds and date components
      expect(str).toContain('.500');
    });
  });
});
