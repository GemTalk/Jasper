import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import {
  GCI_LIBRARY_PATH,
  STONE_NRS,
  GEM_NRS,
  GS_USER,
  GS_PASSWORD,
} from '../../__tests__/gci/gciTestConfig';

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() + 'n' : value;
}

describe('GciTsDoubleToOop / GciTsOopToDouble / GciTsI64ToOop / GciTsOopToI64', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsDoubleToOop and GciTsOopToDouble', () => {
    it('round-trips a SmallDouble (1.5)', () => {
      const { result: oop, err } = gci.GciTsDoubleToOop(session, 1.5);
      console.log(
        'DoubleToOop(1.5) - oop:',
        oop.toString(16),
        'err:',
        JSON.stringify(err, bigIntReplacer, 2),
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToDouble(session, oop);
      console.log('OopToDouble - success:', success, 'value:', value);
      expect(success).toBe(true);
      expect(value).toBe(1.5);
    });

    it('round-trips a non-SmallDouble (Math.PI)', () => {
      const { result: oop, err } = gci.GciTsDoubleToOop(session, Math.PI);
      console.log(
        'DoubleToOop(PI) - oop:',
        oop.toString(16),
        'err:',
        JSON.stringify(err, bigIntReplacer, 2),
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToDouble(session, oop);
      console.log('OopToDouble(PI) - success:', success, 'value:', value);
      expect(success).toBe(true);
      expect(value).toBe(Math.PI);
    });

    it('round-trips zero', () => {
      const { result: oop, err } = gci.GciTsDoubleToOop(session, 0.0);
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToDouble(session, oop);
      expect(success).toBe(true);
      expect(value).toBe(0.0);
    });

    it('round-trips a negative number', () => {
      const { result: oop, err } = gci.GciTsDoubleToOop(session, -42.5);
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToDouble(session, oop);
      expect(success).toBe(true);
      expect(value).toBe(-42.5);
    });

    it('OopToDouble returns false for OOP_NIL', () => {
      const OOP_NIL = 0x14n;
      const { success } = gci.GciTsOopToDouble(session, OOP_NIL);
      expect(success).toBe(false);
    });
  });

  describe('GciTsI64ToOop and GciTsOopToI64', () => {
    it('round-trips a SmallInteger (42)', () => {
      const { result: oop, err } = gci.GciTsI64ToOop(session, 42n);
      console.log(
        'I64ToOop(42) - oop:',
        oop.toString(16),
        'err:',
        JSON.stringify(err, bigIntReplacer, 2),
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, oop);
      console.log('OopToI64 - success:', success, 'value:', value);
      expect(success).toBe(true);
      expect(value).toBe(42n);
    });

    it('round-trips zero', () => {
      const { result: oop, err } = gci.GciTsI64ToOop(session, 0n);
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, oop);
      expect(success).toBe(true);
      expect(value).toBe(0n);
    });

    it('round-trips a negative number (-1000)', () => {
      const { result: oop, err } = gci.GciTsI64ToOop(session, -1000n);
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, oop);
      expect(success).toBe(true);
      expect(value).toBe(-1000n);
    });

    it('round-trips a large 64-bit value', () => {
      const big = 2n ** 60n;
      const { result: oop, err } = gci.GciTsI64ToOop(session, big);
      console.log(
        'I64ToOop(2^60) - oop:',
        oop.toString(16),
        'err:',
        JSON.stringify(err, bigIntReplacer, 2),
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, oop);
      console.log('OopToI64(2^60) - success:', success, 'value:', value);
      expect(success).toBe(true);
      expect(value).toBe(big);
    });

    it('round-trips a negative large 64-bit value', () => {
      const big = -(2n ** 60n);
      const { result: oop, err } = gci.GciTsI64ToOop(session, big);
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, oop);
      expect(success).toBe(true);
      expect(value).toBe(big);
    });

    it('OopToI64 returns false for OOP_NIL', () => {
      const OOP_NIL = 0x14n;
      const { success } = gci.GciTsOopToI64(session, OOP_NIL);
      expect(success).toBe(false);
    });
  });
});
