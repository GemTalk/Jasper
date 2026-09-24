import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { requireGciCapability } from './requireGciCapability';

describe('GCI debug functions (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  describe('GciTsDebugConnectToGem', () => {
    it('returns null session and error for a non-existent gem PID', (ctx) => {
      requireGciCapability('GciTsDebugConnectToGem', ctx, gci);

      // Use a PID that almost certainly doesn't correspond to a GemStone gem
      const { session, err } = gci.GciTsDebugConnectToGem(999999);
      expect(session).toBeNull();
      expect(err.number).not.toBe(0);
    });
  });

  // GciTsDebugStartDebugService requires a valid debug session from
  // GciTsDebugConnectToGem, which requires a gem listening for debug
  // connections (GEM_LISTEN_FOR_DEBUG config). The binding is verified
  // to load correctly via the constructor.
});
