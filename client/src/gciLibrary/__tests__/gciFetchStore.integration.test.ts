import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { requireGciCapability } from './requireGciCapability';

/**
 * The GCI's direct-access family: reading and writing an object's bytes and
 * slots without sending it a message. Every store here mutates an object in
 * the stone, which is safe because the harness aborts each test's transaction.
 */
describe('GCI byte and OOP fetch/store (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  const classOop = (name: string): bigint => gci.resolveSymbol(session, name);

  /**
   * Evaluates `source` and answers the OOP it produced. Every use here is
   * setting up an object to fetch from or store into, so a failure is a broken
   * fixture rather than a result worth asserting on — fail on it in one place
   * instead of leaving it to surface as a puzzling mismatch further down.
   */
  const execute = (source: string): bigint => {
    const { result, err } = gci.GciTsExecute(
      session,
      source,
      OOP_CLASS_STRING,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    expect(err.number).toBe(0);

    return result;
  };

  const integerAt = (oops: bigint[], index: number): bigint =>
    gci.GciTsOopToI64(session, oops[index]).value;

  describe('GciTsFetchBytes', () => {
    it('fetches every byte of a String', () => {
      const string = gci.GciTsNewString(session, 'Hello GCI');

      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, string.result, 1n, 9);

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(9n);
      expect(data.toString('utf8', 0, 9)).toBe('Hello GCI');
    });

    it('fetches a run of bytes starting at a one-based index', () => {
      const string = gci.GciTsNewString(session, 'abcdefghij');

      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, string.result, 4n, 3);

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(3n);
      expect(data.toString('utf8', 0, 3)).toBe('def');
    });

    it('fetches raw bytes from a ByteArray unchanged', () => {
      const bytes = Buffer.from([0x01, 0x02, 0xff, 0x00, 0xab]);
      const byteArray = gci.GciTsNewByteArray(session, bytes);

      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, byteArray.result, 1n, 5);

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data.subarray(0, 5)).toEqual(bytes);
    });
  });

  describe('GciTsFetchChars', () => {
    it('fetches a String as a null-terminated C string', () => {
      const string = gci.GciTsNewString(session, 'GemStone');

      const { bytesReturned, data, err } = gci.GciTsFetchChars(session, string.result, 1n, 1024);

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(8n);
      expect(data).toBe('GemStone');
    });

    it('truncates to make room for the terminator when the buffer is too small', () => {
      const string = gci.GciTsNewString(session, 'Hello World');

      const { bytesReturned, data, err } = gci.GciTsFetchChars(session, string.result, 1n, 6);

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data).toBe('Hello');
    });
  });

  describe('GciTsFetchUtf8Bytes', () => {
    it('fetches a String re-encoded as UTF-8', () => {
      const string = gci.GciTsNewString(session, 'hello');

      const { bytesReturned, data, err } = gci.GciTsFetchUtf8Bytes(
        session,
        string.result,
        1n,
        1024,
      );

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data.toString('utf8', 0, 5)).toBe('hello');
    });
  });

  describe('GciTsStoreBytes', () => {
    it('overwrites part of a String in place', () => {
      const string = gci.GciTsNewString(session, 'aaaaa');

      const { success, err } = gci.GciTsStoreBytes(
        session,
        string.result,
        2n,
        Buffer.from('XYZ', 'utf8'),
        OOP_CLASS_STRING,
      );

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      expect(gci.GciTsFetchChars(session, string.result, 1n, 1024).data).toBe('aXYZa');
    });

    it('overwrites part of a ByteArray in place', () => {
      const byteArray = gci.GciTsNewByteArray(session, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      const { success, err } = gci.GciTsStoreBytes(
        session,
        byteArray.result,
        2n,
        Buffer.from([0xde, 0xad]),
        classOop('ByteArray'),
      );

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      const fetched = gci.GciTsFetchBytes(session, byteArray.result, 1n, 4);
      expect(fetched.data.subarray(0, 4)).toEqual(Buffer.from([0x00, 0xde, 0xad, 0x00]));
    });
  });

  describe('GciTsFetchOops', () => {
    it('fetches every slot of an Array', () => {
      const array = execute('Array with: 10 with: 20 with: 30');

      const { result, oops, err } = gci.GciTsFetchOops(session, array, 1n, 3);

      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect([integerAt(oops, 0), integerAt(oops, 1), integerAt(oops, 2)]).toEqual([10n, 20n, 30n]);
    });

    it('fetches a run of slots starting at a one-based index', () => {
      const array = execute('#(100 200 300 400 500)');

      const { result, oops, err } = gci.GciTsFetchOops(session, array, 3n, 2);

      expect(err.number).toBe(0);
      expect(result).toBe(2);
      expect([integerAt(oops, 0), integerAt(oops, 1)]).toEqual([300n, 400n]);
    });
  });

  describe('GciTsStoreOops', () => {
    it('stores into consecutive slots of an Array', () => {
      const array = execute('Array new: 3');
      const values = [100n, 200n, 300n].map((v) => gci.GciTsI64ToOop(session, v).result);

      const { success, err } = gci.GciTsStoreOops(session, array, 1n, values);

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      const fetched = gci.GciTsFetchOops(session, array, 1n, 3);
      expect(fetched.oops.map((oop) => gci.GciTsOopToI64(session, oop).value)).toEqual([
        100n,
        200n,
        300n,
      ]);
    });
  });

  describe('GciTsFetchNamedOops', () => {
    it('fetches named inst vars from an Association', (ctx) => {
      requireGciCapability('GciTsFetchNamedOops', ctx, gci);

      const assoc = execute('Association new key: #myKey value: 42');

      const { result, oops, err } = gci.GciTsFetchNamedOops(session, assoc, 1n, 2);

      expect(err.number).toBe(0);
      expect(result).toBe(2);
      expect(oops[0]).toBe(execute('#myKey'));
      expect(integerAt(oops, 1)).toBe(42n);
    });
  });

  describe('GciTsFetchVaryingOops', () => {
    it('fetches varying elements from an Array', (ctx) => {
      requireGciCapability('GciTsFetchVaryingOops', ctx, gci);

      const array = execute('#(7 8 9)');

      const { result, oops, err } = gci.GciTsFetchVaryingOops(session, array, 1n, 3);

      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect(oops.map((oop) => gci.GciTsOopToI64(session, oop).value)).toEqual([7n, 8n, 9n]);
    });
  });

  describe('GciTsStoreNamedOops', () => {
    it('stores into named inst vars of an Association', (ctx) => {
      requireGciCapability('GciTsStoreNamedOops', ctx, gci);

      const assoc = execute('Association new');
      const key = gci.GciTsNewSymbol(session, 'testKey').result;
      const value = gci.GciTsI64ToOop(session, 77n).result;

      const { success, err } = gci.GciTsStoreNamedOops(session, assoc, 1n, [key, value]);

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      const { data: keyData } = gci.GciTsPerformFetchBytes(session, assoc, 'key', [], 1024);
      expect(keyData).toBe('testKey');
      const valueResult = gci.GciTsPerform(session, assoc, OOP_ILLEGAL, 'value', [], 0, 0);
      expect(gci.GciTsOopToI64(session, valueResult.result).value).toBe(77n);
    });
  });

  describe('GciTsStoreIdxOops', () => {
    it('stores into varying (indexed) slots of an Array', (ctx) => {
      requireGciCapability('GciTsStoreIdxOops', ctx, gci);
      requireGciCapability('GciTsFetchVaryingOops', ctx, gci);

      const array = execute('Array new: 4');
      const oop10 = gci.GciTsI64ToOop(session, 10n).result;
      const oop20 = gci.GciTsI64ToOop(session, 20n).result;

      // Store at varying index 2 and 3
      const { success, err } = gci.GciTsStoreIdxOops(session, array, 2n, [oop10, oop20]);

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      // Verify: slot 1=nil, 2=10, 3=20, 4=nil
      const fetched = gci.GciTsFetchVaryingOops(session, array, 1n, 4);
      expect(fetched.oops[0]).toBe(OOP_NIL);
      expect(gci.GciTsOopToI64(session, fetched.oops[1]).value).toBe(10n);
      expect(gci.GciTsOopToI64(session, fetched.oops[2]).value).toBe(20n);
      expect(fetched.oops[3]).toBe(OOP_NIL);
    });
  });

  describe('GciTsAddOopsToNsc / GciTsRemoveOopsFromNsc', () => {
    it('adds OOPs to an IdentityBag and removes them', (ctx) => {
      requireGciCapability('GciTsAddOopsToNsc', ctx, gci);

      const bag = execute('IdentityBag new');
      const string1 = gci.GciTsNewString(session, 'nsc-test-1').result;
      const string2 = gci.GciTsNewString(session, 'nsc-test-2').result;

      const { success: addOk, err: addErr } = gci.GciTsAddOopsToNsc(session, bag, [
        string1,
        string2,
      ]);

      expect(addErr.number).toBe(0);
      expect(addOk).toBe(true);
      const size = gci.GciTsPerform(session, bag, OOP_ILLEGAL, 'size', [], 0, 0).result;
      expect(gci.GciTsOopToI64(session, size).value).toBe(2n);

      const { result: removeResult, err: removeErr } = gci.GciTsRemoveOopsFromNsc(session, bag, [
        string1,
        string2,
      ]);

      expect(removeErr.number).toBe(0);
      expect(removeResult).toBe(1); // 1 = all elements were present
      const sizeAfter = gci.GciTsPerform(session, bag, OOP_ILLEGAL, 'size', [], 0, 0).result;
      expect(gci.GciTsOopToI64(session, sizeAfter).value).toBe(0n);
    });

    it('returns 0 when removing OOPs not present in the NSC', () => {
      const bag = execute('IdentityBag new');
      const string = gci.GciTsNewString(session, 'not-in-bag').result;

      const { result, err } = gci.GciTsRemoveOopsFromNsc(session, bag, [string]);

      expect(err.number).toBe(0);
      expect(result).toBe(0); // 0 = not all elements were present
    });
  });
});
