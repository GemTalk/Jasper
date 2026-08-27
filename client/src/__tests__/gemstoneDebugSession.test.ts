import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getSourceOffsets: vi.fn(() => [0, 12]),
  setBreakAtStepPoint: vi.fn(),
  clearBreakAtStepPoint: vi.fn(),
  clearAllBreaks: vi.fn(),
}));

// Factory defaults for the mocks that individual tests override with sticky
// mockReturnValue/mockImplementation. Shared (via vi.hoisted, so it's available
// inside the hoisted vi.mock factory) with the global beforeEach below, which
// re-applies them before every test. Without that restore, a sticky override in
// one test (e.g. setBreakpointsRequest's getMethodSource) leaks into later tests
// under sequence.shuffle and produces order-dependent failures.
const mockDefaults = vi.hoisted(() => ({
  getMethodSource: () => '/ aNumber\n  ^ self _primitiveDivide: aNumber',
  getMethodInfo: (_session: unknown, methodOop: bigint) => ({
    className: 'SmallInteger',
    selector: methodOop === 1001n ? '/' : methodOop === 1002n ? '_errorExec' : 'perform:',
  }),
}));

vi.mock('../debugQueries', () => ({
  getStackDepth: vi.fn(() => 3),
  getFrameInfo: vi.fn((session: unknown, gsProcess: bigint, level: number) => ({
    methodOop: BigInt(1000 + level),
    ipOffset: 10 * level,
    receiverOop: 500n,
    argAndTempNames: ['arg1', 'temp1'],
    argAndTempOops: [100n, 200n],
  })),
  getMethodInfo: vi.fn(mockDefaults.getMethodInfo),
  getMethodUriInfo: vi.fn((session: unknown, methodOop: bigint) => ({
    dictName: 'Globals',
    className: 'SmallInteger',
    isMeta: false,
    category: 'arithmetic',
    selector: methodOop === 1001n ? '/' : methodOop === 1002n ? '_errorExec' : 'perform:',
  })),
  getMethodSource: vi.fn(mockDefaults.getMethodSource),
  getLineForIp: vi.fn(() => 2),
  getObjectPrintString: vi.fn((session: unknown, oop: bigint) => {
    if (oop === 100n) return '42';
    if (oop === 200n) return 'nil';
    if (oop === 500n) return 'anObject';
    return `OOP(${oop})`;
  }),
  getObjectClassName: vi.fn((session: unknown, oop: bigint) => {
    if (oop === 100n) return 'SmallInteger';
    if (oop === 200n) return 'UndefinedObject';
    if (oop === 500n) return 'SmallInteger';
    return 'Object';
  }),
  isSpecialOop: vi.fn((session: unknown, oop: bigint) => {
    // SmallIntegers and nil are special
    return oop === 100n || oop === 200n || oop === 0x14n;
  }),
  getInstVarNames: vi.fn(() => []),
  getNamedInstVarOops: vi.fn(() => []),
  getIndexedSize: vi.fn(() => 0),
  getIndexedOops: vi.fn(() => []),
  clearStack: vi.fn(),
  continueExecution: vi.fn(() => ({ completed: true })),
  stepOver: vi.fn(() => ({ completed: false })),
  stepInto: vi.fn(() => ({ completed: false })),
  stepOut: vi.fn(() => ({ completed: false })),
  trimStackToLevel: vi.fn(),
  evaluateInFrame: vi.fn(() => '42'),
}));

import { GemStoneDebugSession } from '../gemstoneDebugSession';
import { SessionManager } from '../sessionManager';
import { BreakpointManager } from '../breakpointManager';
import * as debugQueries from '../debugQueries';
import * as browserQueries from '../browserQueries';

// Capture DAP messages sent by the debug session
interface DapMessage {
  type: string;
  event?: string;
  command?: string;
  body?: Record<string, unknown>;
  success?: boolean;
  message?: string;
}

function createTestSession(breakpointManager?: BreakpointManager) {
  const sent: DapMessage[] = [];

  const mockSessionManager = {
    getSessions: vi.fn(() => [
      { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' },
    ]),
    getSelectedSession: vi.fn(),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;

  const session = new GemStoneDebugSession(mockSessionManager, breakpointManager);

  // Intercept DAP output by overriding sendResponse and sendEvent
  (session as unknown as Record<string, unknown>).sendResponse = vi.fn((resp: DapMessage) => {
    sent.push({
      type: 'response',
      command: resp.command,
      body: resp.body,
      success: resp.success,
      message: resp.message,
    });
  });
  (session as unknown as Record<string, unknown>).sendEvent = vi.fn(
    (evt: { event: string; body?: unknown }) => {
      sent.push({ type: 'event', event: evt.event, body: evt.body as Record<string, unknown> });
    },
  );

  return { session, sent, mockSessionManager };
}

// Helper to invoke protected DAP request handlers
function callRequest(
  session: GemStoneDebugSession,
  method: string,
  response: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  const fn = (session as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
  return fn.call(session, response, args);
}

function makeResponse(command: string): Record<string, unknown> {
  return { command, seq: 0, type: 'response', request_seq: 0, success: true, body: {} };
}

describe('GemStoneDebugSession', () => {
  // Restore the factory defaults of the mocks that individual tests override
  // with sticky mockReturnValue/mockImplementation (which survive
  // vi.clearAllMocks()). This makes the suite order-independent under
  // sequence.shuffle — otherwise an override set in one describe block leaks
  // into tests that happen to run after it.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(debugQueries.getMethodSource).mockImplementation(mockDefaults.getMethodSource);
    vi.mocked(debugQueries.getMethodInfo).mockImplementation(mockDefaults.getMethodInfo);
  });

  describe('initializeRequest', () => {
    it('reports capabilities and sends InitializedEvent', () => {
      const { session, sent } = createTestSession();
      const response = makeResponse('initialize');
      callRequest(session, 'initializeRequest', response, { adapterID: 'gemstone' });

      expect(response.body).toMatchObject({
        supportsRestartFrame: true,
        supportsEvaluateForHovers: true,
        supportsTerminateRequest: true,
      });
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'initialized' }));
    });
  });

  describe('attachRequest', () => {
    it('attaches to a session and sends StoppedEvent', () => {
      const { session, sent } = createTestSession();
      const response = makeResponse('attach');
      callRequest(session, 'attachRequest', response, {
        sessionId: 1,
        gsProcess: '12345',
        errorMessage: 'a]ZeroDivide',
      });

      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'event',
          event: 'stopped',
        }),
      );
    });

    it('fails when session not found', () => {
      const { session } = createTestSession();
      const response = makeResponse('attach');
      callRequest(session, 'attachRequest', response, {
        sessionId: 999,
        gsProcess: '12345',
      });

      expect(response.success).toBe(false);
      expect(response.message).toContain('999');
    });
  });

  describe('threadsRequest', () => {
    it('returns a single GsProcess thread', () => {
      const { session } = createTestSession();
      const response = makeResponse('threads');
      callRequest(session, 'threadsRequest', response, {});

      expect(response.body).toMatchObject({
        threads: [expect.objectContaining({ id: 1, name: 'GsProcess' })],
      });
    });
  });

  describe('stackTraceRequest (after attach)', () => {
    let session: GemStoneDebugSession;
    let sent: DapMessage[];

    beforeEach(() => {
      const test = createTestSession();
      session = test.session;
      sent = test.sent;
      // Attach first
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
        errorMessage: 'ZeroDivide',
      });
      sent.length = 0; // clear attach events
    });

    it('returns stack frames with class>>selector names', () => {
      const response = makeResponse('stackTrace');
      callRequest(session, 'stackTraceRequest', response, { threadId: 1 });

      const body = response.body as {
        stackFrames: Array<{ id: number; name: string }>;
        totalFrames: number;
      };
      expect(body.totalFrames).toBe(3);
      expect(body.stackFrames).toHaveLength(3);
      expect(body.stackFrames[0].id).toBe(1);
      expect(body.stackFrames[0].name).toBe('SmallInteger>>#/');
      expect(body.stackFrames[1].name).toBe('SmallInteger>>#_errorExec');
      expect(body.stackFrames[2].name).toBe('SmallInteger>>#perform:');
    });

    it('respects startFrame and levels', () => {
      const response = makeResponse('stackTrace');
      callRequest(session, 'stackTraceRequest', response, {
        threadId: 1,
        startFrame: 1,
        levels: 1,
      });

      const body = response.body as { stackFrames: Array<{ id: number }>; totalFrames: number };
      expect(body.totalFrames).toBe(3);
      expect(body.stackFrames).toHaveLength(1);
      expect(body.stackFrames[0].id).toBe(2);
    });

    it('assigns source references for each method', () => {
      const response = makeResponse('stackTrace');
      callRequest(session, 'stackTraceRequest', response, { threadId: 1 });

      const body = response.body as {
        stackFrames: Array<{ source?: { sourceReference?: number } }>;
      };
      const refs = body.stackFrames.map((f) => f.source?.sourceReference).filter(Boolean);
      expect(refs.length).toBe(3);
      // Each unique methodOop gets a unique sourceReference
      expect(new Set(refs).size).toBe(3);
    });

    it('provides gemstone:// URI as source path', () => {
      const response = makeResponse('stackTrace');
      callRequest(session, 'stackTraceRequest', response, { threadId: 1 });

      const body = response.body as { stackFrames: Array<{ source?: { path?: string } }> };
      const path = body.stackFrames[0].source?.path;
      expect(path).toBe('gemstone://1/Globals/SmallInteger/instance/arithmetic/%2F');
    });

    it('still provides source reference when getMethodUriInfo returns undefined (doit frame)', () => {
      // Simulate a "doit" method where the query can't resolve the method
      vi.mocked(debugQueries.getMethodUriInfo).mockReturnValueOnce(undefined);
      vi.mocked(debugQueries.getMethodInfo).mockImplementationOnce(() => {
        throw new Error('does not understand #inClass');
      });

      const response = makeResponse('stackTrace');
      callRequest(session, 'stackTraceRequest', response, { threadId: 1 });

      const body = response.body as {
        stackFrames: Array<{
          id: number;
          name: string;
          source?: { sourceReference?: number; name?: string };
        }>;
        totalFrames: number;
      };
      expect(body.totalFrames).toBe(3);
      expect(body.stackFrames).toHaveLength(3);

      // The first frame (where getMethodInfo threw) should still have a source reference
      const doitFrame = body.stackFrames[0];
      expect(doitFrame.name).toBe('Executed Code');
      expect(doitFrame.source).toBeDefined();
      expect(doitFrame.source!.sourceReference).toBeGreaterThan(0);
    });
  });

  describe('sourceRequest (after attach + stackTrace)', () => {
    let session: GemStoneDebugSession;

    beforeEach(() => {
      const test = createTestSession();
      session = test.session;
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      // Trigger stackTrace to populate sourceRefMap
      callRequest(session, 'stackTraceRequest', makeResponse('stackTrace'), { threadId: 1 });
    });

    it('returns method source for a valid sourceReference', () => {
      const response = makeResponse('source');
      callRequest(session, 'sourceRequest', response, { sourceReference: 1 });

      const body = response.body as { content: string; mimeType?: string };
      expect(body.content).toContain('_primitiveDivide');
    });

    it('withholds the mime type, so no breakpoint gutter is offered here', () => {
      // package.json registers 'text/x-gemstone-smalltalk' as the mime type of
      // the gemstone-smalltalk language, and `contributes.breakpoints` names
      // that language — so returning it resolved this read-only frame source to
      // a language VS Code will offer the breakpoint gutter for, on a frame that
      // cannot hold a breakpoint. The cost is syntax highlighting in this view,
      // which the debugger panel's own source pane provides.
      const response = makeResponse('source');
      callRequest(session, 'sourceRequest', response, { sourceReference: 1 });

      const body = response.body as { content: string; mimeType?: string };
      expect(body.mimeType).toBeUndefined();
      expect(body.content).toContain('_primitiveDivide');
    });

    it('returns placeholder for unknown sourceReference', () => {
      const response = makeResponse('source');
      callRequest(session, 'sourceRequest', response, { sourceReference: 999 });

      const body = response.body as { content: string };
      expect(body.content).toContain('Source not available');
    });
  });

  describe('scopesRequest', () => {
    let session: GemStoneDebugSession;

    beforeEach(() => {
      const test = createTestSession();
      session = test.session;
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
    });

    it('returns Arguments & Temps and Receiver scopes', () => {
      const response = makeResponse('scopes');
      callRequest(session, 'scopesRequest', response, { frameId: 1 });

      const body = response.body as { scopes: Array<{ name: string; variablesReference: number }> };
      expect(body.scopes).toHaveLength(2);
      expect(body.scopes[0].name).toBe('Arguments & Temps');
      expect(body.scopes[0].variablesReference).toBeGreaterThan(0);
      expect(body.scopes[1].name).toBe('Receiver');
      expect(body.scopes[1].variablesReference).toBeGreaterThan(0);
    });
  });

  describe('variablesRequest', () => {
    let session: GemStoneDebugSession;

    beforeEach(() => {
      const test = createTestSession();
      session = test.session;
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
    });

    it('returns arg/temp variables for a frame scope', () => {
      // First get scopes to get variable references
      const scopesResp = makeResponse('scopes');
      callRequest(session, 'scopesRequest', scopesResp, { frameId: 1 });
      const scopes = (scopesResp.body as { scopes: Array<{ variablesReference: number }> }).scopes;
      const argsRef = scopes[0].variablesReference;

      const response = makeResponse('variables');
      callRequest(session, 'variablesRequest', response, { variablesReference: argsRef });

      const body = response.body as {
        variables: Array<{ name: string; value: string; type: string }>;
      };
      expect(body.variables).toHaveLength(2);
      expect(body.variables[0]).toMatchObject({ name: 'arg1', value: '42', type: 'SmallInteger' });
      expect(body.variables[1]).toMatchObject({
        name: 'temp1',
        value: 'nil',
        type: 'UndefinedObject',
      });
    });

    it('returns empty for unknown variablesReference', () => {
      const response = makeResponse('variables');
      callRequest(session, 'variablesRequest', response, { variablesReference: 9999 });

      const body = response.body as { variables: unknown[] };
      expect(body.variables).toEqual([]);
    });

    it('does not give expandable refs to special OOPs', () => {
      // Get the args scope
      const scopesResp = makeResponse('scopes');
      callRequest(session, 'scopesRequest', scopesResp, { frameId: 1 });
      const argsRef = (scopesResp.body as { scopes: Array<{ variablesReference: number }> })
        .scopes[0].variablesReference;

      const response = makeResponse('variables');
      callRequest(session, 'variablesRequest', response, { variablesReference: argsRef });

      const body = response.body as { variables: Array<{ variablesReference: number }> };
      // SmallInteger (100n) and nil (200n) are special — should have variablesReference: 0
      expect(body.variables[0].variablesReference).toBe(0);
      expect(body.variables[1].variablesReference).toBe(0);
    });
  });

  describe('continueRequest', () => {
    it('sends TerminatedEvent when execution completes', () => {
      const { session, sent } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      sent.length = 0;

      const response = makeResponse('continue');
      callRequest(session, 'continueRequest', response, { threadId: 1 });

      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'terminated' }));
    });

    it('sends StoppedEvent when continue hits another error', () => {
      vi.mocked(debugQueries.continueExecution).mockReturnValueOnce({
        completed: false,
        errorMessage: 'another error',
        errorContext: 999n,
      });

      const { session, sent } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      sent.length = 0;

      const response = makeResponse('continue');
      callRequest(session, 'continueRequest', response, { threadId: 1 });

      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'stopped' }));
      expect(sent).not.toContainEqual(
        expect.objectContaining({ type: 'event', event: 'terminated' }),
      );
    });
  });

  describe('stepping', () => {
    let session: GemStoneDebugSession;
    let sent: DapMessage[];

    beforeEach(() => {
      const test = createTestSession();
      session = test.session;
      sent = test.sent;
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      sent.length = 0;
    });

    it('stepOver sends StoppedEvent with reason step', async () => {
      const response = makeResponse('next');
      await callRequest(session, 'nextRequest', response, { threadId: 1 });

      expect(debugQueries.stepOver).toHaveBeenCalled();
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'stopped' }));
    });

    it('stepIn sends StoppedEvent with reason step', async () => {
      const response = makeResponse('stepIn');
      await callRequest(session, 'stepInRequest', response, { threadId: 1 });

      expect(debugQueries.stepInto).toHaveBeenCalled();
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'stopped' }));
    });

    it('stepOut sends StoppedEvent with reason step', async () => {
      const response = makeResponse('stepOut');
      await callRequest(session, 'stepOutRequest', response, { threadId: 1 });

      expect(debugQueries.stepOut).toHaveBeenCalled();
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'stopped' }));
    });
  });

  describe('evaluateRequest', () => {
    it('returns evaluated result string', () => {
      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('evaluate');
      callRequest(session, 'evaluateRequest', response, {
        expression: 'self + 1',
        frameId: 1,
      });

      const body = response.body as { result: string; variablesReference: number };
      expect(body.result).toBe('42');
      expect(body.variablesReference).toBe(0);
    });

    it('returns error message when evaluation fails', () => {
      vi.mocked(debugQueries.evaluateInFrame).mockImplementationOnce(() => {
        throw new Error('Compile error');
      });

      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('evaluate');
      callRequest(session, 'evaluateRequest', response, {
        expression: 'bad code',
        frameId: 1,
      });

      const body = response.body as { result: string };
      expect(body.result).toContain('Error: Compile error');
    });
  });

  describe('restartFrameRequest', () => {
    it('trims stack and sends StoppedEvent with reason restart', () => {
      const { session, sent } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      sent.length = 0;

      const response = makeResponse('restartFrame');
      callRequest(session, 'restartFrameRequest', response, { frameId: 2 });

      expect(debugQueries.trimStackToLevel).toHaveBeenCalledWith(expect.anything(), 12345n, 2);
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'stopped' }));
    });

    it('reports failure when trimStackToLevel throws', () => {
      vi.mocked(debugQueries.trimStackToLevel).mockImplementationOnce(() => {
        throw new Error('Cannot trim');
      });

      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('restartFrame');
      callRequest(session, 'restartFrameRequest', response, { frameId: 2 });

      expect(response.success).toBe(false);
      expect(response.message).toContain('Cannot trim');
    });
  });

  describe('disconnectRequest', () => {
    it('clears the stack on disconnect', () => {
      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('disconnect');
      callRequest(session, 'disconnectRequest', response, {});

      expect(debugQueries.clearStack).toHaveBeenCalledWith(expect.anything(), 12345n);
    });

    it('does not clear stack if already cleared', () => {
      const { session } = createTestSession();
      // No attach — gsProcess is 0n
      vi.mocked(debugQueries.clearStack).mockClear();

      const response = makeResponse('disconnect');
      callRequest(session, 'disconnectRequest', response, {});

      expect(debugQueries.clearStack).not.toHaveBeenCalled();
    });
  });

  describe('terminateRequest', () => {
    it('clears stack and sends TerminatedEvent', () => {
      const { session, sent } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      sent.length = 0;

      const response = makeResponse('terminate');
      callRequest(session, 'terminateRequest', response, {});

      expect(debugQueries.clearStack).toHaveBeenCalled();
      expect(sent).toContainEqual(expect.objectContaining({ type: 'event', event: 'terminated' }));
    });
  });

  describe('configurationDoneRequest', () => {
    it('sends response without error', () => {
      const { session, sent } = createTestSession();
      const response = makeResponse('configurationDone');
      callRequest(session, 'configurationDoneRequest', response, {});

      expect(sent).toContainEqual(
        expect.objectContaining({ type: 'response', command: 'configurationDone' }),
      );
    });
  });

  describe('initializeRequest capabilities', () => {
    it('reports supportsConfigurationDoneRequest', () => {
      const { session } = createTestSession();
      const response = makeResponse('initialize');
      callRequest(session, 'initializeRequest', response, { adapterID: 'gemstone' });

      expect(response.body).toMatchObject({
        supportsConfigurationDoneRequest: true,
      });
    });
  });

  describe('setBreakpointsRequest', () => {
    beforeEach(() => {
      vi.mocked(browserQueries.getSourceOffsets).mockReset();
      vi.mocked(browserQueries.setBreakAtStepPoint).mockReset();
      vi.mocked(browserQueries.clearAllBreaks).mockReset();
      vi.mocked(browserQueries.getSourceOffsets).mockReturnValue([0, 12]);
    });

    it('returns empty breakpoints when no session is attached', () => {
      const { session } = createTestSession();
      const response = makeResponse('setBreakpoints');
      callRequest(session, 'setBreakpointsRequest', response, {
        source: { path: 'gemstone://1/Globals/Array/instance/accessing/at%3A' },
        breakpoints: [{ line: 1 }],
      });

      const body = response.body as { breakpoints: unknown[] };
      expect(body.breakpoints).toHaveLength(0);
    });

    // A frame with no gemstone:// path is an ad-hoc execution ('Executed Code')
    // or a method whose class is not in the symbol list. Neither is a saved,
    // compiled method the developer can point at, so the request is refused with
    // a reason rather than reported as a verified breakpoint that never fires.
    it('refuses a breakpoint on a frame that has no method source of its own', () => {
      vi.mocked(debugQueries.getMethodSource).mockReturnValue('at: index\n  ^ self basicAt: index');
      vi.mocked(debugQueries.getMethodInfo).mockReturnValue({
        className: 'Array',
        selector: 'at:',
      });

      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });
      // Trigger stackTrace to populate sourceRefMap
      callRequest(session, 'stackTraceRequest', makeResponse('stackTrace'), { threadId: 1 });

      const response = makeResponse('setBreakpoints');
      callRequest(session, 'setBreakpointsRequest', response, {
        source: { sourceReference: 1 },
        breakpoints: [{ line: 1 }, { line: 2 }],
      });

      const body = response.body as {
        breakpoints: Array<{ verified: boolean; line: number; reason?: string; message?: string }>;
      };
      expect(body.breakpoints).toHaveLength(2);
      for (const bp of body.breakpoints) {
        expect(bp.verified).toBe(false);
        expect(bp.reason).toBe('failed');
        expect(bp.message).toMatch(/compiled method/i);
      }
      // The marker stays where the developer put it, so the refusal is legible.
      expect(body.breakpoints.map((bp) => bp.line)).toEqual([1, 2]);

      // Nothing is armed in the gem, and nothing already armed is cleared.
      expect(browserQueries.clearAllBreaks).not.toHaveBeenCalled();
      expect(browserQueries.setBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('refuses rather than answering nothing when the sourceReference is unknown', () => {
      const { session } = createTestSession();
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('setBreakpoints');
      callRequest(session, 'setBreakpointsRequest', response, {
        source: { sourceReference: 999 },
        breakpoints: [{ line: 1 }],
      });

      // One answer per request: a silent empty list leaves VS Code showing a
      // solid marker as though the breakpoint had been accepted.
      const body = response.body as { breakpoints: Array<{ verified: boolean; reason?: string }> };
      expect(body.breakpoints).toHaveLength(1);
      expect(body.breakpoints[0].verified).toBe(false);
      expect(body.breakpoints[0].reason).toBe('failed');
    });

    it('delegates to breakpointManager for gemstone:// path', () => {
      const mockBPManager = {
        setBreakpointsForSource: vi.fn(() => [
          { stepPoint: 1, actualLine: 1, verified: true },
          { stepPoint: 2, actualLine: 3, verified: true },
        ]),
      } as unknown as BreakpointManager;

      const { session } = createTestSession(mockBPManager);
      callRequest(session, 'attachRequest', makeResponse('attach'), {
        sessionId: 1,
        gsProcess: '12345',
      });

      const response = makeResponse('setBreakpoints');
      callRequest(session, 'setBreakpointsRequest', response, {
        source: { path: 'gemstone://1/Globals/Array/instance/accessing/at%3A' },
        breakpoints: [{ line: 1 }, { line: 2 }],
      });

      const body = response.body as { breakpoints: Array<{ verified: boolean; line: number }> };
      expect(body.breakpoints).toHaveLength(2);
      expect(body.breakpoints[0]).toMatchObject({ verified: true, line: 1 });
      expect(body.breakpoints[1]).toMatchObject({ verified: true, line: 3 });
      expect(mockBPManager.setBreakpointsForSource).toHaveBeenCalledTimes(1);
    });
  });
});
