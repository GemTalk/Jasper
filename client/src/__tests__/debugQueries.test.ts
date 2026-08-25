import { describe, it, expect, vi } from 'vitest';
import { OOP_ILLEGAL } from '../gciConstants';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as debug from '../debugQueries';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0,
  fatal: false,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
};
const METHOD_OOP = 5000n;
const CLASS_OOP = 6000n;
const RECEIVER_OOP = 7000n;

/**
 * Creates a mock GCI that behaves like GemStone: single-word selectors work,
 * multi-word selectors (containing spaces) cause "does not understand" errors.
 *
 * This catches a class of bugs where GciTsPerform / GciTsPerformFetchBytes
 * are called with chained unary messages like 'inClass name' instead of
 * sending each message separately.
 */
function createMockSession(): ActiveSession {
  const mockGci = {
    GciTsPerform: vi.fn(
      (
        handle: unknown,
        receiver: bigint,
        selectorOop: bigint,
        selectorStr: string | null,
        _args: bigint[],
      ) => {
        if (selectorStr && selectorStr.includes(' ')) {
          return {
            result: 0n,
            err: {
              ...noErr,
              number: 2010,
              message: `a ${receiverClassName(receiver)} does not understand #'${selectorStr}'`,
            },
          };
        }
        if (selectorStr === 'inClass' && receiver === METHOD_OOP) {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'class') {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'allInstVarNames') {
          return { result: 8000n, err: { ...noErr } };
        }
        return { result: 0n, err: { ...noErr } };
      },
    ),
    GciTsPerformFetchBytes: vi.fn(
      (handle: unknown, receiver: bigint, selector: string, _args: bigint[], _maxBytes: number) => {
        if (selector.includes(' ')) {
          return {
            data: '',
            err: {
              ...noErr,
              number: 2010,
              message: `a ${receiverClassName(receiver)} does not understand #'${selector}'`,
            },
          };
        }
        if (selector === 'name' && receiver === CLASS_OOP) {
          return { data: 'SmallInteger', err: { ...noErr } };
        }
        if (selector === 'selector' && receiver === METHOD_OOP) {
          return { data: 'sizee', err: { ...noErr } };
        }
        if (selector === 'asString') {
          return { data: 'instVarName', err: { ...noErr } };
        }
        return { data: '', err: { ...noErr } };
      },
    ),
    GciTsFetchSize: vi.fn(() => ({ result: 0n, err: { ...noErr } })),
    GciTsFetchOops: vi.fn(() => ({ oops: [], err: { ...noErr } })),
    GciTsOopIsSpecial: vi.fn(() => false),
    executeAndFetchString: vi.fn(() => ''),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

function receiverClassName(oop: bigint): string {
  if (oop === METHOD_OOP) return 'GsNMethod';
  if (oop === CLASS_OOP) return 'Metaclass';
  return 'Object';
}

function expectNoMultiWordSelectors(session: ActiveSession): void {
  const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
  const selectorStrs = performCalls
    .map((call) => call[3] as string | null)
    .filter((s): s is string => s !== null);
  expect(selectorStrs.length).toBeGreaterThan(0);
  for (const selector of selectorStrs) {
    expect(selector).not.toContain(' ');
  }

  const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock
    .calls;
  for (const call of fetchBytesCalls) {
    const selector = call[2] as string;
    expect(selector).not.toContain(' ');
  }
}

describe('debugQueries', () => {
  describe('getStepPoint', () => {
    const GS_PROCESS = 9000n;
    const LEVEL_OOP = 0xaan;
    const STEP_POINT_OOP = 0xbbn;

    function stepPointSession(stepPointResultOop: bigint) {
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsI64ToOop: vi.fn(() => ({ result: LEVEL_OOP, err: { ...noErr } })),
          GciTsPerform: vi.fn(() => ({ result: stepPointResultOop, err: { ...noErr } })),
          oopToInteger: vi.fn(() => 2n),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('sends _stepPointAt: with the frame level and returns the step point', () => {
      const session = stepPointSession(STEP_POINT_OOP);
      const result = debug.getStepPoint(session, GS_PROCESS, 3);

      expect(result).toBe(2);
      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(performCalls[0][1]).toBe(GS_PROCESS); // receiver is the process
      expect(performCalls[0][3]).toBe('_stepPointAt:'); // selector
      expect(performCalls[0][4]).toEqual([LEVEL_OOP]); // level arg
    });

    it('returns undefined (without converting) when the step point is nil', () => {
      const session = stepPointSession(0x14n /* OOP_NIL */);
      const result = debug.getStepPoint(session, GS_PROCESS, 3);

      expect(result).toBeUndefined();
      expect(session.gci.oopToInteger).not.toHaveBeenCalled();
    });
  });

  describe('getMethodBlockInfo', () => {
    const BLOCK_METHOD_OOP = 5100n;
    const HOME_METHOD_OOP = 5200n;

    function blockSession(isBlockOop: bigint, homeOop: bigint) {
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsPerform: vi.fn((_h: unknown, _r: bigint, _s: bigint, selector: string) => {
            if (selector === 'isMethodForBlock') return { result: isBlockOop, err: { ...noErr } };
            if (selector === 'homeMethod') return { result: homeOop, err: { ...noErr } };
            return { result: 0n, err: { ...noErr } };
          }),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('reports a block method and its distinct home method', () => {
      const session = blockSession(0x10cn /* OOP_TRUE */, HOME_METHOD_OOP);
      const result = debug.getMethodBlockInfo(session, BLOCK_METHOD_OOP);

      expect(result.isBlock).toBe(true);
      expect(result.homeMethodOop).toBe(HOME_METHOD_OOP);
    });

    it('reports a non-block method with homeMethod returning self', () => {
      const session = blockSession(0x0cn /* OOP_FALSE */, BLOCK_METHOD_OOP);
      const result = debug.getMethodBlockInfo(session, BLOCK_METHOD_OOP);

      expect(result.isBlock).toBe(false);
      expect(result.homeMethodOop).toBe(BLOCK_METHOD_OOP);
    });
  });

  describe('getMethodInfo', () => {
    it('returns class name and selector by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getMethodInfo(session, METHOD_OOP);

      expect(result.className).toBe('SmallInteger');
      expect(result.selector).toBe('sizee');
    });

    it('does not send multi-word selectors to GciTsPerformFetchBytes', () => {
      const session = createMockSession();
      debug.getMethodInfo(session, METHOD_OOP);

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock
        .calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  describe('getObjectClassName', () => {
    it('returns class name by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getObjectClassName(session, RECEIVER_OOP);

      expect(result).toBe('SmallInteger');
    });

    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getObjectClassName(session, RECEIVER_OOP);

      expectNoMultiWordSelectors(session);
    });
  });

  describe('getMethodUriInfo', () => {
    it('parses tab-separated result into MethodUriInfo', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(
        () => 'Globals\tSmallInteger\tinstance\tarithmetic\t/',
      );

      const result = debug.getMethodUriInfo(session, METHOD_OOP);

      expect(result).toEqual({
        dictName: 'Globals',
        className: 'SmallInteger',
        isMeta: false,
        category: 'arithmetic',
        selector: '/',
      });
    });

    it('returns undefined when the execute fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => {
        throw new Error('error');
      });

      expect(debug.getMethodUriInfo(session, METHOD_OOP)).toBeUndefined();
    });

    it('parses class-side methods correctly', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(
        () => 'Globals\tArray\tclass\tinstance creation\tnew',
      );

      const result = debug.getMethodUriInfo(session, METHOD_OOP);

      expect(result).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: true,
        category: 'instance creation',
        selector: 'new',
      });
    });
  });

  describe('getDoesNotUnderstandInfo', () => {
    const GS_PROCESS = 0x123n;

    function sessionReturning(data: string): ActiveSession {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => data);
      return session;
    }

    it('parses an instance-side DNU (keyword selector) into DnuInfo', () => {
      const session = sessionReturning('SmallInteger\tinstance\tGlobals\tfourtyTwo:bar:\t2');
      expect(debug.getDoesNotUnderstandInfo(session, GS_PROCESS)).toEqual({
        className: 'SmallInteger',
        isMeta: false,
        dictName: 'Globals',
        selector: 'fourtyTwo:bar:',
        argCount: 2,
      });
    });

    it('parses a class-side DNU (message sent to a class)', () => {
      const session = sessionReturning('JasperDebugDemo\tclass\tUserGlobals\tmakeWidget\t0');
      expect(debug.getDoesNotUnderstandInfo(session, GS_PROCESS)).toEqual({
        className: 'JasperDebugDemo',
        isMeta: true,
        dictName: 'UserGlobals',
        selector: 'makeWidget',
        argCount: 0,
      });
    });

    it('returns undefined when the process is not parked on a doesNotUnderstand:', () => {
      // The doit returns '' when no DNU frame is found.
      expect(debug.getDoesNotUnderstandInfo(sessionReturning(''), GS_PROCESS)).toBeUndefined();
    });

    it('returns undefined when the execute fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => {
        throw new Error('boom');
      });
      expect(debug.getDoesNotUnderstandInfo(session, GS_PROCESS)).toBeUndefined();
    });
  });

  describe('getReceiverClassChain', () => {
    const RECEIVER_OOP = 0x456n;

    function sessionReturning(data: string): ActiveSession {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => data);
      return session;
    }

    it('parses the full chain (most-specific first), flagging the class that implements the selector', () => {
      // Interval -> SequenceableCollection -> Collection (implements it) -> Object (implements it).
      const session = sessionReturning(
        'Interval\tinstance\tGlobals\t0\n' +
          'SequenceableCollection\tinstance\tKernel\t0\n' +
          'Collection\tinstance\tKernel\t1\n' +
          'Object\tinstance\tKernel\t1',
      );
      expect(debug.getReceiverClassChain(session, RECEIVER_OOP, 'asOrderedCollection')).toEqual([
        { className: 'Interval', isMeta: false, dictName: 'Globals', implementsSelector: false },
        {
          className: 'SequenceableCollection',
          isMeta: false,
          dictName: 'Kernel',
          implementsSelector: false,
        },
        { className: 'Collection', isMeta: false, dictName: 'Kernel', implementsSelector: true },
        { className: 'Object', isMeta: false, dictName: 'Kernel', implementsSelector: true },
      ]);
    });

    it('parses a single-class chain', () => {
      const session = sessionReturning('SmallInteger\tinstance\tGlobals\t0');
      expect(debug.getReceiverClassChain(session, RECEIVER_OOP, 'foo')).toEqual([
        {
          className: 'SmallInteger',
          isMeta: false,
          dictName: 'Globals',
          implementsSelector: false,
        },
      ]);
    });

    it('marks a class-side chain (class receiver) and a blank dict for a non-symbol-list class', () => {
      const session = sessionReturning('Loner\tclass\t\t1');
      expect(debug.getReceiverClassChain(session, RECEIVER_OOP, 'foo')).toEqual([
        { className: 'Loner', isMeta: true, dictName: '', implementsSelector: true },
      ]);
    });

    it('returns [] when the chain is empty', () => {
      expect(debug.getReceiverClassChain(sessionReturning(''), RECEIVER_OOP, 'foo')).toEqual([]);
    });

    it('returns [] when the execute fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => {
        throw new Error('boom');
      });
      expect(debug.getReceiverClassChain(session, RECEIVER_OOP, 'Object')).toEqual([]);
    });
  });

  describe('getBrowseTarget', () => {
    const RECEIVER_OOP = 0x456n;

    function sessionReturning(data: string): ActiveSession {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => data);
      return session;
    }

    it('parses the defining class, dictionary, and category for an instance-side method', () => {
      const session = sessionReturning('Collection\tinstance\tKernel\taccessing');
      expect(debug.getBrowseTarget(session, RECEIVER_OOP, 'asOrderedCollection')).toEqual({
        className: 'Collection',
        isMeta: false,
        dictName: 'Kernel',
        category: 'accessing',
      });
    });

    it('parses a class-side method', () => {
      const session = sessionReturning('Array\tclass\tGlobals\tinstance creation');
      expect(debug.getBrowseTarget(session, RECEIVER_OOP, 'new')).toEqual({
        className: 'Array',
        isMeta: true,
        dictName: 'Globals',
        category: 'instance creation',
      });
    });

    it('reports a blank dictionary and category when the class is outside the symbol list and the method is uncategorized', () => {
      const session = sessionReturning('Loner\tinstance\t\t');
      expect(debug.getBrowseTarget(session, RECEIVER_OOP, 'foo')).toEqual({
        className: 'Loner',
        isMeta: false,
        dictName: '',
        category: '',
      });
    });

    it('returns undefined when the selector is not found in the chain', () => {
      expect(debug.getBrowseTarget(sessionReturning(''), RECEIVER_OOP, 'foo')).toBeUndefined();
    });

    it('returns undefined when the execute fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(() => {
        throw new Error('boom');
      });
      expect(debug.getBrowseTarget(session, RECEIVER_OOP, 'foo')).toBeUndefined();
    });
  });

  describe('tab separators in generated Smalltalk (3.6.2-compatible via Character tab)', () => {
    const GS_PROCESS = 0x123n;

    /**
     * Runs a generator against a session that captures the Smalltalk handed to it
     * instead of evaluating it, and returns that source for inspection.
     */
    function generatedSmalltalkFrom(run: (session: ActiveSession) => void): string {
      const session = createMockSession();
      let generated = '';
      (session.gci as unknown as Record<string, unknown>).executeAndFetchString = vi.fn(
        (_handle: unknown, code: string) => {
          generated = code;
          return '';
        },
      );

      run(session);

      return generated;
    }

    it('delimits the fields of a stack frame method location lookup', () => {
      const code = generatedSmalltalkFrom((session) => debug.getMethodUriInfo(session, METHOD_OOP));

      expect(code).toContain('(String with: Character tab)');
      expect(code).not.toContain('String tab');
    });

    it('delimits the fields of an implementation-candidate class chain lookup', () => {
      const code = generatedSmalltalkFrom((session) =>
        debug.getReceiverClassChain(session, RECEIVER_OOP, 'foo'),
      );

      expect(code).toContain('(String with: Character tab)');
      expect(code).not.toContain('String tab');
    });

    it('delimits the fields of a lookup for where a running method is defined', () => {
      const code = generatedSmalltalkFrom((session) =>
        debug.getBrowseTarget(session, RECEIVER_OOP, 'foo'),
      );

      expect(code).toContain('(String with: Character tab)');
      expect(code).not.toContain('String tab');
    });

    it('delimits the fields of a missing-method details lookup', () => {
      const code = generatedSmalltalkFrom((session) =>
        debug.getDoesNotUnderstandInfo(session, GS_PROCESS),
      );

      expect(code).toContain('(String with: Character tab)');
      expect(code).not.toContain('String tab');
    });
  });

  describe('getInstVarNames', () => {
    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getInstVarNames(session, RECEIVER_OOP);

      expectNoMultiWordSelectors(session);
    });
  });

  // These two used to call GciTsFetchNamedOops / GciTsFetchVaryingOops, which
  // don't exist in 3.6.2. They now use absolute GciTsFetchOops (present in
  // 3.6.2), so debugger/inspector variable display works on both 3.6.2 and 3.7.5.
  describe('instance variable fetch (3.6.2-compatible via GciTsFetchOops)', () => {
    function sessionWith(gci: Record<string, unknown>): ActiveSession {
      return {
        id: 1,
        handle: { h: 1 },
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.6.2',
        gci: gci as unknown as ActiveSession['gci'],
      };
    }

    it('getNamedInstVarOops fetches absolute OOPs starting at index 1', () => {
      const fetchOops = vi.fn(() => ({ result: 2, oops: [11n, 22n], err: { ...noErr } }));
      const session = sessionWith({ GciTsFetchOops: fetchOops });

      expect(debug.getNamedInstVarOops(session, 100n, 2)).toEqual([11n, 22n]);
      expect(fetchOops).toHaveBeenCalledWith(session.handle, 100n, 1n, 2);
    });

    it('getNamedInstVarOops returns [] for non-positive count without calling GCI', () => {
      const fetchOops = vi.fn();
      const session = sessionWith({ GciTsFetchOops: fetchOops });

      expect(debug.getNamedInstVarOops(session, 100n, 0)).toEqual([]);
      expect(fetchOops).not.toHaveBeenCalled();
    });

    it('getIndexedOops offsets the 1-based varying index by namedSize', () => {
      const fetchObjInfo = vi.fn(() => ({ info: { namedSize: 3 }, err: { ...noErr } }));
      const fetchOops = vi.fn(() => ({ result: 2, oops: [7n, 8n], err: { ...noErr } }));
      const session = sessionWith({ GciTsFetchObjInfo: fetchObjInfo, GciTsFetchOops: fetchOops });

      // First varying element (startIndex 1) of an object with 3 named instVars
      // is at absolute index 4.
      expect(debug.getIndexedOops(session, 100n, 1, 2)).toEqual([7n, 8n]);
      expect(fetchObjInfo).toHaveBeenCalledWith(session.handle, 100n, false, 0);
      expect(fetchOops).toHaveBeenCalledWith(session.handle, 100n, 4n, 2);
    });

    it('getIndexedOops returns [] (and skips the fetch) when GciTsFetchObjInfo errors', () => {
      const fetchObjInfo = vi.fn(() => ({
        info: { namedSize: 0 },
        err: { ...noErr, number: 2418 },
      }));
      const fetchOops = vi.fn();
      const session = sessionWith({ GciTsFetchObjInfo: fetchObjInfo, GciTsFetchOops: fetchOops });

      expect(debug.getIndexedOops(session, 100n, 1, 2)).toEqual([]);
      expect(fetchOops).not.toHaveBeenCalled();
    });

    it('neither path calls the post-3.6.2 GciTsFetchNamedOops / GciTsFetchVaryingOops', () => {
      const named = vi.fn();
      const varying = vi.fn();
      const session = sessionWith({
        GciTsFetchNamedOops: named,
        GciTsFetchVaryingOops: varying,
        GciTsFetchObjInfo: vi.fn(() => ({ info: { namedSize: 0 }, err: { ...noErr } })),
        GciTsFetchOops: vi.fn(() => ({ result: 0, oops: [], err: { ...noErr } })),
      });

      debug.getNamedInstVarOops(session, 100n, 2);
      debug.getIndexedOops(session, 100n, 1, 2);
      expect(named).not.toHaveBeenCalled();
      expect(varying).not.toHaveBeenCalled();
    });
  });

  // Regression for the eval-bar bug: typing "3 + 4" raised
  //   NameError 2404, _framePerform:withArgs:onLevel:, There is no Symbol …
  // because evaluateInFrame called a primitive that does NOT exist on 3.7.x (so
  // GciTsPerform couldn't resolve the selector). The fix evaluates the
  // expression via String>>evaluateInContext: with self = the frame receiver.
  // (We can't run real Smalltalk in unit tests — the live image confirms
  // `'3 + 4' evaluateInContext: nil` => 7 — so the mock supplies the printString
  // and we assert the *right call* is made, which is what regressed.)
  describe('evaluateInFrame ("3 + 4" regression)', () => {
    const GS_PROCESS = 9000n;
    const FRAME_ARRAY = 0xf0n;
    const FRAME_RECEIVER = 0x77n; // becomes `self` for the evaluation
    const EXPR_STRING = 0xe0n;
    const EVAL_RESULT = 0x07n; // the oop the evaluation returned

    function evalSession() {
      const gci = {
        GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
        oopToInteger: vi.fn(() => 5n),
        GciTsNewString: vi.fn(() => ({ result: EXPR_STRING, err: { ...noErr } })),
        GciTsFetchSize: vi.fn(() => ({ result: 10n, err: { ...noErr } })),
        // getFrameInfo reads [10]=receiver (0-indexed 9); [9]=names (0-indexed 8) = nil → skip names.
        GciTsFetchOops: vi.fn(() => ({
          oops: [1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0x14n /* OOP_NIL names */, FRAME_RECEIVER],
          err: { ...noErr },
        })),
        GciTsPerform: vi.fn((_h: unknown, _r: bigint, _sOop: bigint, sel: string | null) => {
          if (sel === '_frameContentsAt:') return { result: FRAME_ARRAY, err: { ...noErr } };
          if (sel === 'evaluateInContext:') return { result: EVAL_RESULT, err: { ...noErr } };
          return { result: 0n, err: { ...noErr } };
        }),
        // printString of the evaluation result (the EVAL_RESULT oop) is "7".
        GciTsPerformFetchBytes: vi.fn((_h: unknown, oop: bigint) =>
          oop === EVAL_RESULT
            ? { bytesReturned: 1, data: '7', err: { ...noErr } }
            : { bytesReturned: 0, data: '', err: { ...noErr } },
        ),
      };
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('returns the result printString ("7") for "3 + 4" instead of raising', () => {
      const session = evalSession();
      expect(debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3)).toBe('7');
    });

    it('evaluates via String>>evaluateInContext: with self = the frame receiver', () => {
      const session = evalSession();
      debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3);

      expect(session.gci.GciTsNewString).toHaveBeenCalledWith({}, '3 + 4');
      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      const evalCall = performCalls.find((c: unknown[]) => c[3] === 'evaluateInContext:');
      expect(evalCall).toBeDefined();
      expect(evalCall![1]).toBe(EXPR_STRING); // receiver of evaluateInContext: is the expr String
      expect(evalCall![4]).toEqual([FRAME_RECEIVER]); // arg is the frame's receiver (self)
    });

    it('never sends the removed _framePerform:withArgs:onLevel: primitive (the original bug)', () => {
      const session = evalSession();
      debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(performCalls.some((c: unknown[]) => c[3] === '_framePerform:withArgs:onLevel:')).toBe(
        false,
      );
    });
  });

  // When the frame has *named* args/temps, evaluateInFrame must bind them so a
  // bare identifier like `amount` resolves — by prepending a transient
  // SymbolDictionary {name → value} to the user's symbol list and evaluating via
  // `evaluateInContext:symbolList:` (NOT the self-only `evaluateInContext:`).
  describe('evaluateInFrame — binds named temps via a symbol-list dictionary', () => {
    const GS_PROCESS = 9000n;
    const FRAME_ARRAY = 0xf0n;
    const NAMES_ARRAY = 0xa1n;
    const FRAME_RECEIVER = 0x77n;
    const AMOUNT_NAME = 0xb1n; // the name string 'amount' in the names array
    const AMOUNT_VALUE = 0x96n; // oop of the temp's value (75)
    const AMOUNT_SYMBOL = 0xc1n; // interned #amount
    const EXPR_STRING = 0xe0n;
    const EVAL_RESULT = 0x07n;

    function tempSession() {
      const gci = {
        GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
        oopToInteger: vi.fn(() => 5n),
        GciTsNewString: vi.fn(() => ({ result: EXPR_STRING, err: { ...noErr } })),
        GciTsNewSymbol: vi.fn(() => ({ result: AMOUNT_SYMBOL, err: { ...noErr } })),
        resolveSymbol: vi.fn((_h: unknown, name: string) =>
          name === 'SymbolDictionary' ? 0xd1n : name === 'SymbolList' ? 0xd2n : 0xd3n,
        ),
        // Frame array size = 11 (so values start at slot 11); names array size = 1.
        GciTsFetchSize: vi.fn((_h: unknown, oop: bigint) => ({
          result: oop === NAMES_ARRAY ? 1n : 11n,
          err: { ...noErr },
        })),
        GciTsFetchOops: vi.fn((_h: unknown, oop: bigint) =>
          oop === NAMES_ARRAY
            ? { oops: [AMOUNT_NAME], err: { ...noErr } }
            : {
                // frame contents: [9]=names (idx8), [10]=receiver (idx9), [11+]=values
                oops: [1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, NAMES_ARRAY, FRAME_RECEIVER, AMOUNT_VALUE],
                err: { ...noErr },
              },
        ),
        GciTsPerform: vi.fn((_h: unknown, _r: bigint, _s: bigint, sel: string | null) => {
          if (sel === '_frameContentsAt:') return { result: FRAME_ARRAY, err: { ...noErr } };
          if (sel === 'new') return { result: 0xdd0n, err: { ...noErr } }; // SymbolDictionary new
          if (sel === 'at:put:') return { result: 0n, err: { ...noErr } };
          if (sel === 'myUserProfile') return { result: 0xdddn, err: { ...noErr } };
          if (sel === 'symbolList') return { result: 0xddan, err: { ...noErr } };
          if (sel === 'with:') return { result: 0xddfn, err: { ...noErr } };
          if (sel === ',') return { result: 0xddcn, err: { ...noErr } };
          if (sel === 'evaluateInContext:symbolList:')
            return { result: EVAL_RESULT, err: { ...noErr } };
          return { result: 0n, err: { ...noErr } };
        }),
        GciTsPerformFetchBytes: vi.fn((_h: unknown, oop: bigint) =>
          oop === AMOUNT_NAME
            ? { bytesReturned: 6, data: 'amount', err: { ...noErr } }
            : oop === EVAL_RESULT
              ? { bytesReturned: 3, data: '150', err: { ...noErr } }
              : { bytesReturned: 0, data: '', err: { ...noErr } },
        ),
      };
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('evaluates via evaluateInContext:symbolList: (not the self-only path)', () => {
      const session = tempSession();
      expect(debug.evaluateInFrame(session, GS_PROCESS, 'amount * 2', 3)).toBe('150');

      const calls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      const sels = calls.map((c: unknown[]) => c[3]);
      expect(sels).toContain('evaluateInContext:symbolList:');
      expect(sels).not.toContain('evaluateInContext:');
    });

    it('interns each temp name and stores its value in the dictionary', () => {
      const session = tempSession();
      debug.evaluateInFrame(session, GS_PROCESS, 'amount * 2', 3);

      expect(session.gci.GciTsNewSymbol).toHaveBeenCalledWith({}, 'amount');
      const atPut = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[3] === 'at:put:',
      );
      expect(atPut).toBeDefined();
      expect(atPut![4]).toEqual([AMOUNT_SYMBOL, AMOUNT_VALUE]); // dict at: #amount put: value
    });

    it('degrades to self-only evaluateInContext: when a required global will not resolve', () => {
      const session = tempSession();
      // SymbolDictionary fails to resolve → no temp dictionary can be built, so
      // buildFrameSymbolList returns null and the eval falls back to self-only.
      (session.gci.resolveSymbol as ReturnType<typeof vi.fn>).mockImplementation(
        (_h: unknown, name: string) => {
          if (name === 'SymbolDictionary') throw new Error('not resolved');
          return 0xd2n;
        },
      );
      debug.evaluateInFrame(session, GS_PROCESS, 'amount * 2', 3);

      const sels = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[3],
      );
      expect(sels).toContain('evaluateInContext:');
      expect(sels).not.toContain('evaluateInContext:symbolList:');
    });
  });

  // Non-blocking sibling of evaluateInFrame (#9 cancel): same frame-setup +
  // evaluateInContext: dispatch, but issued via GciTsNbPerform and polled, so a
  // runaway expression can be cancelled. We can't run real Smalltalk, so the mock
  // supplies the result + printString and we assert the right (non-blocking) calls.
  describe('evaluateInFrameNb (non-blocking eval)', () => {
    const GS_PROCESS = 9000n;
    const FRAME_ARRAY = 0xf0n;
    const FRAME_RECEIVER = 0x77n;
    const EXPR_STRING = 0xe0n;
    const EVAL_RESULT = 0x07n;

    // Self-only frame (no named temps → evaluateInContext:), with the non-blocking
    // calls wired to report "ready immediately" and hand back EVAL_RESULT.
    function nbEvalSession() {
      const gci = {
        GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
        oopToInteger: vi.fn(() => 5n),
        GciTsNewString: vi.fn(() => ({ result: EXPR_STRING, err: { ...noErr } })),
        GciTsFetchSize: vi.fn(() => ({ result: 10n, err: { ...noErr } })),
        GciTsFetchOops: vi.fn(() => ({
          oops: [1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0x14n /* OOP_NIL names */, FRAME_RECEIVER],
          err: { ...noErr },
        })),
        GciTsPerform: vi.fn((_h: unknown, _r: bigint, _s: bigint, sel: string | null) =>
          sel === '_frameContentsAt:'
            ? { result: FRAME_ARRAY, err: { ...noErr } }
            : { result: 0n, err: { ...noErr } },
        ),
        // printString of the evaluation result is "7".
        GciTsPerformFetchBytes: vi.fn((_h: unknown, oop: bigint) =>
          oop === EVAL_RESULT
            ? { bytesReturned: 1, data: '7', err: { ...noErr } }
            : { bytesReturned: 0, data: '', err: { ...noErr } },
        ),
        isAvailable: (n: string) => n === 'GciTsNbPoll',
        GciTsNbPerform: vi.fn(() => ({ success: true, err: { ...noErr } })),
        GciTsNbPoll: vi.fn(() => ({ result: 1, err: { ...noErr } })), // ready on first poll
        GciTsNbResult: vi.fn(() => ({ result: EVAL_RESULT, err: { ...noErr } })),
      };
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('resolves with the result printString once the non-blocking call is ready', async () => {
      const session = nbEvalSession();
      await expect(debug.evaluateInFrameNb(session, GS_PROCESS, '3 + 4', 3)).resolves.toBe('7');
    });

    it('issues the evaluation via GciTsNbPerform (evaluateInContext:) on the expression string', async () => {
      const session = nbEvalSession();
      await debug.evaluateInFrameNb(session, GS_PROCESS, '3 + 4', 3);

      const nbCalls = (session.gci.GciTsNbPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(nbCalls).toHaveLength(1);
      expect(nbCalls[0][1]).toBe(EXPR_STRING); // receiver = the expression String
      expect(nbCalls[0][3]).toBe('evaluateInContext:'); // self-only selector (no named temps)
      expect(nbCalls[0][4]).toEqual([FRAME_RECEIVER]); // arg = the frame's receiver (self)
    });

    it('rejects when the expression string cannot be created', async () => {
      const session = nbEvalSession();
      (session.gci.GciTsNewString as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 0n,
        err: { ...noErr, number: 2101, message: 'bad string' },
      });

      await expect(debug.evaluateInFrameNb(session, GS_PROCESS, '3 + 4', 3)).rejects.toThrow(
        /bad string|Cannot create expression string/,
      );
    });

    it('rejects with the GCI error when the non-blocking result reports a failure (e.g. an interrupt)', async () => {
      const session = nbEvalSession();
      (session.gci.GciTsNbResult as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 0n,
        err: { ...noErr, number: 6004, message: 'the operation was interrupted' },
      });

      await expect(
        debug.evaluateInFrameNb(session, GS_PROCESS, '[true] whileTrue', 3),
      ).rejects.toThrow(/the operation was interrupted/);
    });

    // When the frame has named temps, the nb eval must bind them via a symbol list
    // (evaluateInContext:symbolList:), exactly like the blocking evaluateInFrame.
    it('binds named temps via evaluateInContext:symbolList: (not the self-only path)', async () => {
      const NAMES_ARRAY = 0xa1n;
      const AMOUNT_NAME = 0xb1n;
      const AMOUNT_VALUE = 0x96n;
      const AMOUNT_SYMBOL = 0xc1n;
      const gci = {
        GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
        oopToInteger: vi.fn(() => 5n),
        GciTsNewString: vi.fn(() => ({ result: EXPR_STRING, err: { ...noErr } })),
        GciTsNewSymbol: vi.fn(() => ({ result: AMOUNT_SYMBOL, err: { ...noErr } })),
        resolveSymbol: vi.fn((_h: unknown, name: string) =>
          name === 'SymbolDictionary' ? 0xd1n : name === 'SymbolList' ? 0xd2n : 0xd3n,
        ),
        GciTsFetchSize: vi.fn((_h: unknown, oop: bigint) => ({
          result: oop === NAMES_ARRAY ? 1n : 11n,
          err: { ...noErr },
        })),
        GciTsFetchOops: vi.fn((_h: unknown, oop: bigint) =>
          oop === NAMES_ARRAY
            ? { oops: [AMOUNT_NAME], err: { ...noErr } }
            : {
                oops: [1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, NAMES_ARRAY, FRAME_RECEIVER, AMOUNT_VALUE],
                err: { ...noErr },
              },
        ),
        GciTsPerform: vi.fn((_h: unknown, _r: bigint, _s: bigint, sel: string | null) => {
          if (sel === '_frameContentsAt:') return { result: FRAME_ARRAY, err: { ...noErr } };
          if (sel === 'new') return { result: 0xdd0n, err: { ...noErr } };
          if (sel === 'at:put:') return { result: 0n, err: { ...noErr } };
          if (sel === 'myUserProfile') return { result: 0xdddn, err: { ...noErr } };
          if (sel === 'symbolList') return { result: 0xddan, err: { ...noErr } };
          if (sel === 'with:') return { result: 0xddfn, err: { ...noErr } };
          if (sel === ',') return { result: 0xddcn, err: { ...noErr } };
          return { result: 0n, err: { ...noErr } };
        }),
        GciTsPerformFetchBytes: vi.fn((_h: unknown, oop: bigint) =>
          oop === AMOUNT_NAME
            ? { bytesReturned: 6, data: 'amount', err: { ...noErr } }
            : oop === EVAL_RESULT
              ? { bytesReturned: 3, data: '150', err: { ...noErr } }
              : { bytesReturned: 0, data: '', err: { ...noErr } },
        ),
        isAvailable: (n: string) => n === 'GciTsNbPoll',
        GciTsNbPerform: vi.fn(() => ({ success: true, err: { ...noErr } })),
        GciTsNbPoll: vi.fn(() => ({ result: 1, err: { ...noErr } })),
        GciTsNbResult: vi.fn(() => ({ result: EVAL_RESULT, err: { ...noErr } })),
      };
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;

      await expect(debug.evaluateInFrameNb(session, GS_PROCESS, 'amount * 2', 3)).resolves.toBe(
        '150',
      );

      const nbCalls = (session.gci.GciTsNbPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(nbCalls[0][3]).toBe('evaluateInContext:symbolList:'); // symbol-list selector
      expect(nbCalls[0][4][0]).toBe(FRAME_RECEIVER); // self
      expect(nbCalls[0][4]).toHaveLength(2); // [receiver, symbolList]
    });
  });

  describe('completion result oop', () => {
    const GS_PROCESS = 9000n;
    const RESULT = 0x99n;

    it('continueExecution returns the result oop when the process completes', () => {
      const continueWith = vi.fn(() => ({ result: RESULT, err: { ...noErr } }));
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: { GciTsContinueWith: continueWith } as unknown as ActiveSession['gci'],
      } as ActiveSession;

      expect(debug.continueExecution(session, GS_PROCESS)).toEqual({
        completed: true,
        resultOop: RESULT,
      });
      // Resume as-is: replaceTopOfStack must be OOP_ILLEGAL, NOT OOP_NIL — forcing
      // TOS := nil corrupts a frame re-entered by trimStackToLevel: and hangs the
      // gem. (3rd positional arg to GciTsContinueWith.)
      const args = continueWith.mock.calls[0] as unknown as bigint[];
      expect(args[2]).toBe(OOP_ILLEGAL);
      expect(args[2]).not.toBe(0x14n /* OOP_NIL */);
    });

    it('continueExecution reports the error (no result oop) when it stops again', () => {
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsContinueWith: vi.fn(() => ({
            result: 0n,
            err: { ...noErr, number: 2010, message: 'next error', context: 0xabn },
          })),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;

      const r = debug.continueExecution(session, GS_PROCESS);
      expect(r.completed).toBe(false);
      expect(r.resultOop).toBeUndefined();
      expect(r.errorMessage).toBe('next error');
      // The error NUMBER must propagate — the webview's uncontinuable (6011)
      // guard keys off StepResult.errorNumber, not the (localizable) message.
      expect(r.errorNumber).toBe(2010);
    });

    it('stepOver returns the result oop when the step completes the process', () => {
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
          GciTsPerform: vi.fn(() => ({ result: RESULT, err: { ...noErr } })),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;

      expect(debug.stepOver(session, GS_PROCESS, 1)).toEqual({
        completed: true,
        resultOop: RESULT,
      });
    });

    it('stepOver (blocking) propagates the GemStone error number when the step stops on an error', () => {
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
          GciTsPerform: vi.fn(() => ({
            result: 0n,
            err: { ...noErr, number: 6011, message: 'uncontinuable', context: 0xabn },
          })),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;

      const r = debug.stepOver(session, GS_PROCESS, 1);
      expect(r.completed).toBe(false);
      expect(r.errorNumber).toBe(6011);
      expect(r.errorContext).toBe(0xabn);
    });

    it('stepOverNb (non-blocking) propagates the error number on a stop (e.g. 6011 uncontinuable)', async () => {
      const session = {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          isAvailable: (n: string) => n === 'GciTsNbPoll',
          GciTsI64ToOop: vi.fn(() => ({ result: 0xaan, err: { ...noErr } })),
          GciTsNbPerform: vi.fn(() => ({ success: true, err: { ...noErr } })),
          GciTsNbPoll: vi.fn(() => ({ result: 1, err: { ...noErr } })), // ready immediately
          GciTsNbResult: vi.fn(() => ({
            result: 0n,
            err: {
              ...noErr,
              number: 6011,
              message: 'a UncontinuableError occurred (error 6011)',
              context: 0xabn,
            },
          })),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;

      const r = await debug.stepOverNb(session, GS_PROCESS, 1);
      expect(r.completed).toBe(false);
      expect(r.errorNumber).toBe(6011);
      expect(r.errorContext).toBe(0xabn);
    });
  });

  // Stepping runs interpreted via GCI_PERFORM_FLAG_INTERPRETED on the perform
  // itself (GemStone can't step native code, error 6014) — there is no
  // session-global toggle to manage. Assert every step/continue variant
  // carries the flag.
  describe('stepping interpreted-mode flag', () => {
    const FLAG_INTERPRETED = 0x20;

    function makeSession(): { session: ActiveSession; perform: ReturnType<typeof vi.fn> } {
      const perform = vi.fn(() => ({ result: 0n, err: { ...noErr } }));
      const gci = {
        GciTsPerform: perform,
        GciTsContinueWith: perform,
        GciTsI64ToOop: vi.fn(() => ({ result: 10n, err: { ...noErr } })),
      };
      const session = {
        id: 1,
        gci: gci as unknown as ActiveSession['gci'],
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
      } as ActiveSession;
      return { session, perform };
    }

    it('sends every step message with native code disabled', () => {
      const { session, perform } = makeSession();

      debug.stepOver(session, 0xaan, 1);
      debug.stepInto(session, 0xaan, 1);
      debug.stepOut(session, 0xaan, 1);

      for (const call of perform.mock.calls) {
        const flags = call[5] as number;
        expect(flags & FLAG_INTERPRETED).toBe(FLAG_INTERPRETED);
      }
      expect(perform.mock.calls.length).toBe(3);
    });

    it('continues a suspended process with native code disabled', () => {
      const { session, perform } = makeSession();

      debug.continueExecution(session, 0xaan);

      const flags = perform.mock.calls[0][4] as number;
      expect(flags & FLAG_INTERPRETED).toBe(FLAG_INTERPRETED);
    });
  });
});

describe('parseStackDump (#10/#11 whole-stack dump payload)', () => {
  const TAB = '\t';
  const line = (...fields: string[]) => fields.join(TAB);

  it('parses level / group / name / value / oop from each tab-separated line', () => {
    const payload = [
      line('1', 'receiver', 'self', 'a JasperFoo', '100'),
      line('1', 'instvars', 'count', '7', '14'),
      line('2', 'argtemps', 'x', 'nil', '20'),
    ].join('\n');

    expect(debug.parseStackDump(payload)).toEqual([
      { serverLevel: 1, group: 'receiver', name: 'self', value: 'a JasperFoo', oop: '100' },
      { serverLevel: 1, group: 'instvars', name: 'count', value: '7', oop: '14' },
      { serverLevel: 2, group: 'argtemps', name: 'x', value: 'nil', oop: '20' },
    ]);
  });

  it('un-escapes \\\\ \\t \\n \\r in name and value (so printStrings can hold delimiters/newlines)', () => {
    // value carries an escaped tab, newline, CR and backslash — none break framing.
    const payload = line('3', 'argtemps', 'aString', 'a\\tb\\nc\\rd\\\\e', '42');
    const [row] = debug.parseStackDump(payload);
    expect(row.value).toBe('a\tb\nc\rd\\e');
    expect(row.serverLevel).toBe(3);
  });

  it('skips blank lines and malformed records (fewer than 5 fields)', () => {
    const payload = ['', line('1', 'receiver', 'self', 'x', '1'), 'junk\twith\tthree', ''].join(
      '\n',
    );
    expect(debug.parseStackDump(payload)).toEqual([
      { serverLevel: 1, group: 'receiver', name: 'self', value: 'x', oop: '1' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(debug.parseStackDump('')).toEqual([]);
  });

  it('round-trips non-ASCII names/values without corruption', () => {
    // Unicode class/var names and accented printString content must survive
    // (the escaper only touches \\ \t \n \r, so these pass through untouched).
    const rec = ['1', 'instvars', 'café', 'a Größe «42» — €', '99'].join('\t');
    expect(debug.parseStackDump(rec)).toEqual([
      { serverLevel: 1, group: 'instvars', name: 'café', value: 'a Größe «42» — €', oop: '99' },
    ]);
  });
});

describe('parseFrameVars (#5 single-frame one-trip payload)', () => {
  const line = (...fields: string[]) => fields.join('\t');

  it('parses group / name / value / oop / index from each line', () => {
    const payload = [
      line('receiver', 'self', 'a JasperFoo', '100', '0'),
      line('instvars', 'count', '7', '14', '1'),
      line('argtemps', 'x', 'nil', '20', '2'),
      line('stacktemps', '.t1', 'true', '26', '0'),
    ].join('\n');

    expect(debug.parseFrameVars(payload)).toEqual([
      { group: 'receiver', name: 'self', value: 'a JasperFoo', oop: '100', index: 0 },
      { group: 'instvars', name: 'count', value: '7', oop: '14', index: 1 },
      { group: 'argtemps', name: 'x', value: 'nil', oop: '20', index: 2 },
      { group: 'stacktemps', name: '.t1', value: 'true', oop: '26', index: 0 },
    ]);
  });

  it('un-escapes delimiters in name/value and skips malformed lines', () => {
    const payload = ['', line('argtemps', 's', 'a\\tb\\nc', '42', '1'), 'junk\ttoo\tfew'].join(
      '\n',
    );
    expect(debug.parseFrameVars(payload)).toEqual([
      { group: 'argtemps', name: 's', value: 'a\tb\nc', oop: '42', index: 1 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(debug.parseFrameVars('')).toEqual([]);
  });
});
