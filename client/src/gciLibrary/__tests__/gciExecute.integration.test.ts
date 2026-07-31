import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The GCI's two ways of running code on the stone: GciTsExecute (compile and
 * run a source string) and GciTsPerform (send a selector to an object), plus
 * the fetch-bytes variants that bring the result back in one call. These are
 * the primitives every higher-level query in the extension is built on.
 */
describe('GCI execute and perform (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  const classOop = (name: string): bigint => gci.resolveSymbol(session, name);

  const execute = (source: string) =>
    gci.GciTsExecute(session, source, OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0);

  describe('GciTsExecute', () => {
    it('returns the OOP of the object the source evaluates to', () => {
      const { result, err } = execute('Array new: 4');

      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, result).result).toBe(classOop('Array'));
      expect(gci.GciTsFetchSize(session, result).result).toBe(4n);
    });

    it('returns an immediate OOP for an arithmetic result', () => {
      const { result, err } = execute('3 + 4');
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, result);

      expect(success).toBe(true);
      expect(value).toBe(7n);
    });

    it('reports an error for source that does not compile', () => {
      const { result, err } = execute('!!! invalid syntax !!!');

      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).not.toBe(0);
    });
  });

  describe('GciTsExecute_', () => {
    it('accepts a source size instead of relying on a null terminator', () => {
      const { result, err } = gci.GciTsExecute_(
        session,
        'Array new: 3',
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchSize(session, result).result).toBe(3n);
    });
  });

  describe('GciTsExecuteFetchBytes', () => {
    it('returns the bytes of the result without a second call', () => {
      const { bytesReturned, data, err } = gci.GciTsExecuteFetchBytes(
        session,
        "'hello world' copy",
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        1024,
      );

      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(11);
      expect(data).toBe('hello world');
    });

    it('returns the bytes of a printString', () => {
      const { data, err } = gci.GciTsExecuteFetchBytes(
        session,
        '(3 + 4) printString',
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        1024,
      );

      expect(err.number).toBe(0);
      expect(data).toBe('7');
    });
  });

  describe('GciTsPerform', () => {
    it('sends a keyword message with an OOP argument', () => {
      const argument = gci.GciTsI64ToOop(session, 5n);
      expect(argument.err.number).toBe(0);

      const { result, err } = gci.GciTsPerform(
        session,
        classOop('Array'),
        OOP_ILLEGAL,
        'new:',
        [argument.result],
        0,
        0,
      );

      expect(err.number).toBe(0);
      expect(gci.GciTsFetchClass(session, result).result).toBe(classOop('Array'));
      expect(gci.GciTsFetchSize(session, result).result).toBe(5n);
    });

    it('sends a unary message returning an immediate', () => {
      const receiver = gci.GciTsNewString(session, 'hello');

      const { result, err } = gci.GciTsPerform(
        session,
        receiver.result,
        OOP_ILLEGAL,
        'size',
        [],
        0,
        0,
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, result);

      expect(success).toBe(true);
      expect(value).toBe(5n);
    });

    it('sends a unary message returning an object', () => {
      const receiver = gci.GciTsNewString(session, 'abcdef');

      const { result, err } = gci.GciTsPerform(
        session,
        receiver.result,
        OOP_ILLEGAL,
        'asUppercase',
        [],
        0,
        0,
      );

      expect(err.number).toBe(0);
      expect(gci.GciTsFetchUtf8(session, result, 1024).data).toBe('ABCDEF');
    });

    it('reports an error for a selector the receiver does not understand', () => {
      const receiver = gci.GciTsNewString(session, 'test');

      const { result, err } = gci.GciTsPerform(
        session,
        receiver.result,
        OOP_ILLEGAL,
        'noSuchSelector99',
        [],
        0,
        0,
      );

      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).not.toBe(0);
    });
  });

  describe('GciTsPerformFetchBytes', () => {
    it('returns the bytes of the result of a unary send', () => {
      const receiver = gci.GciTsI64ToOop(session, 42n);
      expect(receiver.err.number).toBe(0);

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        receiver.result,
        'printString',
        [],
        1024,
      );

      expect(err.number).toBe(0);
      expect(data).toBe('42');
    });

    it('returns the bytes of a String the send built', () => {
      const receiver = gci.GciTsNewString(session, 'GemStone');

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        receiver.result,
        'asUppercase',
        [],
        1024,
      );

      expect(err.number).toBe(0);
      expect(data).toBe('GEMSTONE');
    });

    it('returns the bytes of the result of a binary send', () => {
      const receiver = gci.GciTsNewString(session, 'Hello');
      const argument = gci.GciTsNewString(session, ' World');

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        receiver.result,
        ',',
        [argument.result],
        1024,
      );

      expect(err.number).toBe(0);
      expect(data).toBe('Hello World');
    });
  });
});
