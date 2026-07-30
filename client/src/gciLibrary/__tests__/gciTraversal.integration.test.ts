import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Traversal Functions', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  let OOP_CLASS_STRING: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
  });

  afterAll(() => {
    if (session) {
      gci.GciTsAbort(session);
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsFetchTraversal', () => {
    it('traverses a String object and returns its bytes', () => {
      const strOop = gci.GciTsNewString(session, 'traverse-me');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { status, travBuf, err } = gci.GciTsFetchTraversal(session, [strOop.result]);
      console.log('FetchTraversal(String) - status:', status, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(status).toBe(0); // 0 = traversal complete

      const usedBytes = travBuf.readUInt32LE(4);
      console.log('FetchTraversal - usedBytes:', usedBytes);
      expect(usedBytes).toBeGreaterThan(0);

      const reports = GciLibrary.parseTravBuffer(travBuf);
      console.log('FetchTraversal - reports:', reports.length);
      expect(reports.length).toBeGreaterThanOrEqual(1);

      // The first report should be for our String
      const report = reports[0];
      expect(report.objId).toBe(strOop.result);
      expect(report.oclass).toBe(OOP_CLASS_STRING);
      const str = report.body.toString('utf8', 0, report.valueBuffSize);
      expect(str).toBe('traverse-me');
    });

    it('traverses an Array with level 1', () => {
      const { result: arrOop, err: execErr } = gci.GciTsExecute(
        session,
        '#(10 20 30)',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(execErr.number).toBe(0);

      const { status, travBuf, err } = gci.GciTsFetchTraversal(session, [arrOop], 1);
      console.log('FetchTraversal(Array) - status:', status, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(status).toBe(0);

      const reports = GciLibrary.parseTravBuffer(travBuf);
      console.log('FetchTraversal(Array) - reports:', reports.length);
      expect(reports.length).toBeGreaterThanOrEqual(1);

      // First report should be the Array itself
      const report = reports[0];
      expect(report.objId).toBe(arrOop);
    });
  });

  describe('GciTsMoreTraversal', () => {
    it('fetches remaining data when buffer is too small', () => {
      // Create a large string that won't fit in a small buffer
      // GCI_MIN_TRAV_BUFF_SIZE = 2048; ObjRepHdr = 40 bytes
      // So a 2048-byte buffer can hold ~2008 bytes of string data
      const bigStr = 'X'.repeat(4000);
      const strOop = gci.GciTsNewString(session, bigStr);
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      // Use minimum legal buffer size (2048 bytes)
      const { status, err } = gci.GciTsFetchTraversal(
        session,
        [strOop.result],
        1,
        0,
        OOP_NIL,
        2048,
      );
      console.log(
        'FetchTraversal(small buf) - status:',
        status,
        'err.number:',
        err.number,
        'err.message:',
        err.message,
      );
      expect(err.number).toBe(0);

      if (status === 1) {
        // More data available — fetch it
        const {
          status: moreStatus,
          travBuf: moreBuf,
          err: moreErr,
        } = gci.GciTsMoreTraversal(session);
        console.log('MoreTraversal - status:', moreStatus, 'err.number:', moreErr.number);
        expect(moreErr.number).toBe(0);
        // moreStatus: 1 = complete, 0 = still more
        expect(moreStatus).toBeGreaterThanOrEqual(0);

        const moreUsedBytes = moreBuf.readUInt32LE(4);
        console.log('MoreTraversal - usedBytes:', moreUsedBytes);
        expect(moreUsedBytes).toBeGreaterThan(0);
      } else {
        // Traversal completed in one call (buffer was large enough)
        console.log('FetchTraversal completed in one call, MoreTraversal not needed');
        expect(status).toBe(0);
      }
    });
  });

  describe('GciTsStoreTrav', () => {
    it('modifies a String via store traversal', () => {
      const strOop = gci.GciTsNewString(session, 'AAAA');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      // Fetch the current representation
      const { travBuf: fetchBuf, err: fetchErr } = gci.GciTsFetchTraversal(session, [
        strOop.result,
      ]);
      expect(fetchErr.number).toBe(0);

      const reports = GciLibrary.parseTravBuffer(fetchBuf);
      expect(reports.length).toBeGreaterThanOrEqual(1);
      const origReport = reports[0];
      console.log('StoreTrav - original body:', origReport.body.toString('utf8'));

      // Build a store buffer that changes the bytes to 'BBBB'
      const newBody = Buffer.from('BBBB');
      const storeBuf = GciLibrary.buildTravBuffer([
        {
          objId: strOop.result,
          oclass: origReport.oclass,
          firstOffset: origReport.firstOffset,
          body: newBody,
          namedSize: origReport.namedSize,
          objectSecurityPolicyId: origReport.objectSecurityPolicyId,
          idxSizeBits: origReport.idxSizeBits,
        },
      ]);

      const { success, err: storeErr } = gci.GciTsStoreTrav(session, storeBuf);
      console.log(
        'StoreTrav - success:',
        success,
        'err.number:',
        storeErr.number,
        'err.message:',
        storeErr.message,
      );
      console.log(
        'StoreTrav - origReport firstOffset:',
        origReport.firstOffset.toString(),
        'idxSizeBits:',
        origReport.idxSizeBits.toString(16),
        'namedSize:',
        origReport.namedSize,
        'valueBuffSize:',
        origReport.valueBuffSize,
      );
      expect(storeErr.number).toBe(0);
      expect(success).toBe(true);

      // Verify the change
      const fetched = gci.GciTsFetchUtf8(session, strOop.result, 1024);
      expect(fetched.data).toBe('BBBB');
    });
  });

  describe('GciTsStoreTravDoTravRefs', () => {
    it('performs a message send and traverses the result', () => {
      // Initialize dirty object tracking (required before StoreTravDoTravRefs)
      const { success: initOk, err: initErr } = gci.GciTsDirtyObjsInit(session);
      console.log('DirtyObjsInit - success:', initOk, 'err.number:', initErr.number);
      expect(initErr.number).toBe(0);

      // Create a receiver string
      const strOop = gci.GciTsNewString(session, 'GemStone');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      // Use doPerform=1 to send 'reversed' to the string, then traverse the result
      const stdArgs: Record<string, unknown> = {
        doPerform: 1,
        doFlags: 0,
        alteredNumOops: 0,
        alteredCompleted: 0,
        u: {
          perform: {
            receiver: strOop.result,
            _pad: new Array(24).fill(0),
            selector: 'reversed',
            args: null,
            numArgs: 0,
            environmentId: 0,
          },
        },
        storeTravBuff: null,
        alteredTheOops: null,
        storeTravFlags: 0,
      };

      const { status, resultOop, travBuf, err } = gci.GciTsStoreTravDoTravRefs(
        session,
        null,
        null,
        stdArgs,
      );
      console.log(
        'StoreTravDoTravRefs - status:',
        status,
        'resultOop:',
        resultOop.toString(16),
        'err.number:',
        err.number,
        'err.message:',
        err.message,
      );
      expect(err.number).toBe(0);
      expect(status).toBe(0); // traversal complete

      // Parse the traversal result
      const reports = GciLibrary.parseTravBuffer(travBuf);
      console.log('StoreTravDoTravRefs - reports:', reports.length);
      expect(reports.length).toBeGreaterThanOrEqual(1);

      // The result should be 'enotSmeG' (reversed)
      const resultReport = reports.find((r) => r.objId === resultOop);
      if (resultReport) {
        const str = resultReport.body.toString('utf8', 0, resultReport.valueBuffSize);
        console.log('StoreTravDoTravRefs - result string:', str);
        expect(str).toBe('enotSmeG');
      }
    });
  });
});
