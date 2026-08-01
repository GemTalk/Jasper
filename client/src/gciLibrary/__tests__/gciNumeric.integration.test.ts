import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Round-trips through the GCI's numeric conversions, which turn host doubles
 * and 64-bit integers into OOPs and back. Both directions are exercised on the
 * same value so a lossy conversion can't hide behind a matching bug in its
 * inverse.
 */
describe('GCI numeric OOP conversions (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  describe('GciTsDoubleToOop / GciTsOopToDouble', () => {
    const expectDoubleRoundTrip = (value: number) => {
      const { result: oop, err } = gci.GciTsDoubleToOop(session, value);
      expect(err.number).toBe(0);

      const { success, value: fetched } = gci.GciTsOopToDouble(session, oop);

      expect(success).toBe(true);
      expect(fetched).toBe(value);
    };

    it('round-trips a value representable as a SmallDouble', () => {
      expectDoubleRoundTrip(1.5);
    });

    it('round-trips a value needing a full Float object', () => {
      expectDoubleRoundTrip(Math.PI);
    });

    it('round-trips zero', () => {
      expectDoubleRoundTrip(0.0);
    });

    it('round-trips a negative value', () => {
      expectDoubleRoundTrip(-42.5);
    });

    it('reports failure for an OOP that is not a number', () => {
      const { success } = gci.GciTsOopToDouble(session, OOP_NIL);

      expect(success).toBe(false);
    });
  });

  describe('GciTsI64ToOop / GciTsOopToI64', () => {
    const expectIntegerRoundTrip = (value: bigint) => {
      const { result: oop, err } = gci.GciTsI64ToOop(session, value);
      expect(err.number).toBe(0);

      const { success, value: fetched } = gci.GciTsOopToI64(session, oop);

      expect(success).toBe(true);
      expect(fetched).toBe(value);
    };

    it('round-trips a value representable as a SmallInteger', () => {
      expectIntegerRoundTrip(42n);
    });

    it('round-trips zero', () => {
      expectIntegerRoundTrip(0n);
    });

    it('round-trips a negative value', () => {
      expectIntegerRoundTrip(-1000n);
    });

    it('round-trips a value beyond the SmallInteger range', () => {
      expectIntegerRoundTrip(2n ** 60n);
    });

    it('round-trips a negative value beyond the SmallInteger range', () => {
      expectIntegerRoundTrip(-(2n ** 60n));
    });

    it('reports failure for an OOP that is not an integer', () => {
      const { success } = gci.GciTsOopToI64(session, OOP_NIL);

      expect(success).toBe(false);
    });
  });
});
