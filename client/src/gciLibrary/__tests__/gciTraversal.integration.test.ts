import { describe, it, expect } from 'vitest';
import { GciLibrary, type GciObjReport } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The GCI's traversal family: reading an object graph into a flat buffer of
 * object reports, and writing modified reports back. Nothing outside these
 * tests calls the wrappers yet — what the tests protect is the binding itself,
 * above all the hand-rolled packing and unpacking of the traversal buffer,
 * which no other test exercises. Stores ride the harness's aborted transaction.
 */
describe('GCI object traversal (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  /** GciTsFetchTraversal / GciTsStoreTravDoTravRefs status: the graph fit in the buffer. */
  const TRAVERSAL_COMPLETE = 0;
  /** ...and: more reports are waiting for a GciTsMoreTraversal call. */
  const TRAVERSAL_INCOMPLETE = 1;
  /**
   * GciTsMoreTraversal's status: no more reports are waiting. Beware that its
   * encoding is the inverse of the two above — gcits.hf documents it as
   * "function result 1 if traversal completed, 0 if data returned but traversal
   * not complete, -1 if an error was returned in *err".
   */
  const MORE_TRAVERSAL_COMPLETE = 1;

  const execute = (source: string) =>
    gci.GciTsExecute(session, source, OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0);

  /** The bytes a report carries for its object, as text. */
  const bodyText = (report: GciObjReport): string =>
    report.body.toString('utf8', 0, report.valueBuffSize);

  /** The bytes every report in a traversal buffer carries, as one string. */
  const travText = (travBuf: Buffer): string =>
    GciLibrary.parseTravBuffer(travBuf).map(bodyText).join('');

  describe('GciTsFetchTraversal', () => {
    it('reports the bytes of the object it traversed', () => {
      const { result: oop } = gci.GciTsNewString(session, 'traverse-me');

      const { status, travBuf, err } = gci.GciTsFetchTraversal(session, [oop]);

      expect(err.number).toBe(0);
      expect(status).toBe(TRAVERSAL_COMPLETE);
      const [report] = GciLibrary.parseTravBuffer(travBuf);
      expect(report.objId).toBe(oop);
      expect(report.oclass).toBe(OOP_CLASS_STRING);
      expect(bodyText(report)).toBe('traverse-me');
    });

    it('reports the object it was asked about before the objects it references', () => {
      const { result: arrayOop } = execute('#(10 20 30)');

      const { status, travBuf, err } = gci.GciTsFetchTraversal(session, [arrayOop], 1);

      expect(err.number).toBe(0);
      expect(status).toBe(TRAVERSAL_COMPLETE);
      const reports = GciLibrary.parseTravBuffer(travBuf);
      expect(reports[0].objId).toBe(arrayOop);
    });
  });

  describe('GciTsMoreTraversal', () => {
    it('returns the reports that did not fit in the first traversal buffer', () => {
      // GCI_MIN_TRAV_BUFF_SIZE is 2048 bytes, of which a 40-byte object report
      // header is overhead — so a String this long is split across exactly two
      // buffers: 2008 bytes of it in the first, the remaining 1992 in the
      // second, which the two calls together have to hand back intact.
      const contents = 'X'.repeat(4000);
      const { result: oop } = gci.GciTsNewString(session, contents);
      const MIN_TRAV_BUFF_SIZE = 2048;

      const first = gci.GciTsFetchTraversal(session, [oop], 1, 0, OOP_NIL, MIN_TRAV_BUFF_SIZE);
      const rest = gci.GciTsMoreTraversal(session, MIN_TRAV_BUFF_SIZE);

      expect(first.err.number).toBe(0);
      expect(first.status).toBe(TRAVERSAL_INCOMPLETE);
      expect(rest.err.number).toBe(0);
      expect(rest.status).toBe(MORE_TRAVERSAL_COMPLETE);
      expect(travText(first.travBuf) + travText(rest.travBuf)).toBe(contents);
    });
  });

  describe('GciTsStoreTrav', () => {
    it('writes the bytes of a report back into the object it describes', () => {
      const { result: oop } = gci.GciTsNewString(session, 'AAAA');
      const [original] = GciLibrary.parseTravBuffer(
        gci.GciTsFetchTraversal(session, [oop]).travBuf,
      );

      const { success, err } = gci.GciTsStoreTrav(
        session,
        GciLibrary.buildTravBuffer([{ ...original, body: Buffer.from('BBBB') }]),
      );

      expect(err.number).toBe(0);
      expect(success).toBe(true);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe('BBBB');
    });
  });

  describe('GciTsStoreTravDoTravRefs', () => {
    it('sends a message and traverses its result in a single call', () => {
      // Dirty-object tracking has to be initialized before the call, and only
      // once per session — the harness gives this file a session of its own.
      expect(gci.GciTsDirtyObjsInit(session).err.number).toBe(0);
      const { result: receiver } = gci.GciTsNewString(session, 'GemStone');

      const { status, resultOop, travBuf, err } = gci.GciTsStoreTravDoTravRefs(
        session,
        null,
        null,
        performArgs(receiver, 'asUppercase'),
      );

      expect(err.number).toBe(0);
      expect(status).toBe(TRAVERSAL_COMPLETE);
      const reports = GciLibrary.parseTravBuffer(travBuf);
      const result = reports.find((report) => report.objId === resultOop);
      expect(result).toBeDefined();
      expect(bodyText(result!)).toBe('GEMSTONE');
    });

    /**
     * A `GciStoreTravDoArgsSType` asking for `selector` to be sent to
     * `receiver`, with nothing to store beforehand.
     */
    function performArgs(receiver: bigint, selector: string): Record<string, unknown> {
      return {
        doPerform: 1,
        doFlags: 0,
        alteredNumOops: 0,
        alteredCompleted: 0,
        u: {
          perform: {
            receiver,
            _pad: new Array(24).fill(0),
            selector,
            args: null,
            numArgs: 0,
            environmentId: 0,
          },
        },
        storeTravBuff: null,
        alteredTheOops: null,
        storeTravFlags: 0,
      };
    }
  });
});
