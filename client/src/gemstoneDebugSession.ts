import {
  DebugSession,
  InitializedEvent,
  StoppedEvent,
  TerminatedEvent,
  OutputEvent,
  Thread,
  StackFrame,
  Scope,
  Source,
  Variable,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import type * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { OOP_NIL } from './gciConstants';
import * as debug from './debugQueries';
import { BreakpointManager } from './breakpointManager';
import { logInfo, logError } from './gciLog';

const THREAD_ID = 1;
/** Why a breakpoint on a frame with no method source of its own is refused. */
const UNBREAKABLE_SOURCE =
  'Breakpoints can only be set in the source of a compiled method. ' +
  'Ad-hoc executed code cannot be broken at — set the breakpoint in the method instead.';
const MAX_PRINT_STRING = 1024;

// Variable reference kinds
type VarRefKind =
  | { kind: 'frame'; level: number }
  | { kind: 'receiver'; oop: bigint }
  | { kind: 'named'; oop: bigint }
  | { kind: 'indexed'; oop: bigint; totalSize: number };

export class GemStoneDebugSession extends DebugSession {
  private session: ActiveSession | undefined;
  private gsProcess: bigint = 0n;
  private errorMessage: string = '';

  private varRefMap = new Map<number, VarRefKind>();
  private nextVarRef = 1;

  private sourceRefMap = new Map<number, bigint>(); // sourceRef → methodOop
  private methodToSourceRef = new Map<string, number>(); // methodOop.toString() → sourceRef
  private nextSourceRef = 1;

  private breakpointManager?: BreakpointManager;

  constructor(
    private sessionManager: SessionManager,
    breakpointManager?: BreakpointManager,
  ) {
    super();
    this.breakpointManager = breakpointManager;
  }

  // ── Allocators ──────────────────────────────────────────

  private allocVarRef(info: VarRefKind): number {
    const ref = this.nextVarRef++;
    this.varRefMap.set(ref, info);
    return ref;
  }

  private allocSourceRef(methodOop: bigint): number {
    const key = methodOop.toString();
    const existing = this.methodToSourceRef.get(key);
    if (existing !== undefined) return existing;
    const ref = this.nextSourceRef++;
    this.sourceRefMap.set(ref, methodOop);
    this.methodToSourceRef.set(key, ref);
    return ref;
  }

  // ── DAP Lifecycle ───────────────────────────────────────

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments,
  ): void {
    response.body = response.body || {};
    response.body.supportsRestartFrame = true;
    response.body.supportsEvaluateForHovers = true;
    response.body.supportsTerminateRequest = true;
    response.body.supportsSingleThreadExecutionRequests = true;
    response.body.supportsConfigurationDoneRequest = true;
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    _args: DebugProtocol.ConfigurationDoneArguments,
  ): void {
    this.sendResponse(response);
  }

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: DebugProtocol.AttachRequestArguments & {
      sessionId: number;
      gsProcess: string;
      errorMessage?: string;
    },
  ): void {
    const sessions = this.sessionManager.getSessions();
    this.session = sessions.find((s) => s.id === args.sessionId);
    if (!this.session) {
      response.success = false;
      response.message = `Session ${args.sessionId} not found`;
      this.sendResponse(response);
      return;
    }

    this.gsProcess = BigInt(args.gsProcess);
    this.errorMessage = args.errorMessage || 'GemStone error';

    logInfo(`[Session ${this.session.id}] Debug: attached to GsProcess OOP ${this.gsProcess}`);

    this.sendResponse(response);
    this.sendEvent(new StoppedEvent('exception', THREAD_ID, this.errorMessage));
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments,
  ): void {
    if (this.session && this.gsProcess !== 0n) {
      debug.clearStack(this.session, this.gsProcess);
      this.gsProcess = 0n;
    }
    this.sendResponse(response);
  }

  protected terminateRequest(
    response: DebugProtocol.TerminateResponse,
    _args: DebugProtocol.TerminateArguments,
  ): void {
    if (this.session && this.gsProcess !== 0n) {
      debug.clearStack(this.session, this.gsProcess);
      this.gsProcess = 0n;
    }
    this.sendResponse(response);
    this.sendEvent(new TerminatedEvent());
  }

  // ── Breakpoints ────────────────────────────────────────

  protected setBreakpointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
  ): void {
    const breakpoints: DebugProtocol.Breakpoint[] = [];

    if (!this.session || !args.breakpoints) {
      response.body = { breakpoints };
      this.sendResponse(response);
      return;
    }

    const requestedLines = args.breakpoints.map((bp) => bp.line);
    // DAP carries an optional column for an inline breakpoint; forwarding it is what
    // lets a breakpoint mid-line resolve to the step point the developer clicked
    // rather than the leftmost one on the line.
    const requestedColumns = args.breakpoints.map((bp) => bp.column);

    // Try to resolve from source path (gemstone:// URI) if available
    if (args.source.path && this.breakpointManager) {
      try {
        // Parse the path as a URI
        const parsed = args.source.path.match(/^gemstone:\/\/(\d+)(\/[^?]*?)(?:\?(.*))?$/);
        if (parsed) {
          // A partial, hand-built Uri: breakpointManager only reads scheme/path/query
          // (parseMethodUri) and toString() (tracking key). The path is kept *encoded*
          // on purpose — parseMethodUri decodeURIComponent's it — so a real
          // vscode.Uri.parse (which decodes .path) would double-decode. Cast honestly.
          const actualUri = {
            scheme: 'gemstone',
            authority: parsed[1],
            path: parsed[2],
            query: parsed[3] || '',
            toString: () => args.source.path!,
          } as unknown as vscode.Uri;
          const results = this.breakpointManager.setBreakpointsForSource(
            this.session,
            actualUri,
            requestedLines,
            requestedColumns,
          );
          for (let i = 0; i < results.length; i++) {
            breakpoints.push({
              verified: results[i].verified,
              line: results[i].actualLine,
              id: i + 1,
              // Set when the manager refused rather than merely failed to
              // resolve — the developer can act on the reason.
              ...(results[i].message
                ? { reason: 'failed' as const, message: results[i].message }
                : {}),
            });
          }
          response.body = { breakpoints };
          this.sendResponse(response);
          return;
        }
      } catch (e) {
        logError(this.session.id, `setBreakpoints path error: ${e}`);
      }
    }

    // No gemstone:// path means the frame is not a saved, compiled method the
    // developer can point at: either an ad-hoc execution ('Executed Code') or a
    // method whose class is not bound in the symbol list. Neither has anything
    // durable to arm — a doit's compiled method is gone once the execution ends,
    // so a breakpoint here could never be hit again. Refuse it out loud rather
    // than report a verified breakpoint that silently never fires.
    //
    // `sourceRequest` withholds the mime type that used to resolve this document
    // to the gemstone-smalltalk language, so VS Code no longer offers the gutter
    // here. This stays as the backstop for the ways a request can still arrive —
    // `debug.allowBreakpointsEverywhere`, or a client that is not VS Code.
    if (args.source.sourceReference && args.source.sourceReference > 0) {
      for (let i = 0; i < requestedLines.length; i++) {
        breakpoints.push({
          verified: false,
          reason: 'failed',
          line: requestedLines[i],
          id: i + 1,
          message: UNBREAKABLE_SOURCE,
        });
      }
    }

    response.body = { breakpoints };
    this.sendResponse(response);
  }

  // ── Threads ─────────────────────────────────────────────

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [new Thread(THREAD_ID, 'GsProcess')],
    };
    this.sendResponse(response);
  }

  // ── Stack Trace ─────────────────────────────────────────

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments,
  ): void {
    if (!this.session) {
      response.body = { stackFrames: [], totalFrames: 0 };
      this.sendResponse(response);
      return;
    }

    try {
      const depth = debug.getStackDepth(this.session, this.gsProcess);
      const startFrame = args.startFrame || 0;
      const levels = args.levels || depth;
      const endFrame = Math.min(startFrame + levels, depth);

      const frames: StackFrame[] = [];
      for (let level = startFrame + 1; level <= endFrame; level++) {
        try {
          const info = debug.getFrameInfo(this.session, this.gsProcess, level);
          const sourceRef = this.allocSourceRef(info.methodOop);

          let frameName: string;
          let sourcePath: string | undefined;
          try {
            const uriInfo = debug.getMethodUriInfo(this.session, info.methodOop);
            if (uriInfo && uriInfo.dictName) {
              const baseClass = uriInfo.className;
              const side = uriInfo.isMeta ? 'class' : 'instance';
              frameName = `${baseClass}${uriInfo.isMeta ? ' class' : ''}>>#${uriInfo.selector}`;
              sourcePath =
                `gemstone://${this.session.id}` +
                `/${encodeURIComponent(uriInfo.dictName)}` +
                `/${encodeURIComponent(baseClass)}` +
                `/${side}` +
                `/${encodeURIComponent(uriInfo.category)}` +
                `/${encodeURIComponent(uriInfo.selector)}`;
            } else {
              const methodInfo = debug.getMethodInfo(this.session, info.methodOop);
              frameName = `${methodInfo.className}>>#${methodInfo.selector}`;
            }
          } catch {
            frameName = 'Executed Code';
          }

          let line = 0;
          try {
            line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset);
          } catch {
            // Keep line at 0
          }

          frames.push(
            new StackFrame(level, frameName, new Source(frameName, sourcePath, sourceRef), line),
          );
        } catch {
          // getFrameInfo itself failed — no source reference possible
          frames.push(new StackFrame(level, `<frame ${level}>`));
        }
      }

      response.body = { stackFrames: frames, totalFrames: depth };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(this.session.id, `stackTrace error: ${msg}`);
      this.sendEvent(new OutputEvent(`Stack trace error: ${msg}\n`, 'stderr'));
      response.body = { stackFrames: [], totalFrames: 0 };
    }

    this.sendResponse(response);
  }

  // ── Source ──────────────────────────────────────────────

  protected sourceRequest(
    response: DebugProtocol.SourceResponse,
    args: DebugProtocol.SourceArguments,
  ): void {
    if (!this.session || !args.sourceReference) {
      response.body = { content: '' };
      this.sendResponse(response);
      return;
    }

    const methodOop = this.sourceRefMap.get(args.sourceReference);
    if (!methodOop) {
      response.body = { content: '// Source not available' };
      this.sendResponse(response);
      return;
    }

    try {
      const source = debug.getMethodSource(this.session, methodOop);
      // Deliberately no `mimeType`. Returning 'text/x-gemstone-smalltalk' resolved
      // this document to the gemstone-smalltalk language (the language declares
      // that mime type in package.json), and `contributes.breakpoints` names that
      // language — so VS Code offered the breakpoint gutter on a frame that cannot
      // hold a breakpoint. Withholding it costs syntax highlighting in this
      // read-only view, which the debugger panel's own source pane provides
      // anyway, and buys a gutter that never invites a breakpoint it must refuse.
      response.body = { content: source };
    } catch (e) {
      response.body = { content: `// Error fetching source: ${e}` };
    }

    this.sendResponse(response);
  }

  // ── Scopes ──────────────────────────────────────────────

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments,
  ): void {
    const level = args.frameId;

    const argsRef = this.allocVarRef({ kind: 'frame', level });
    const receiverRef = this.allocVarRef({ kind: 'receiver', oop: 0n });
    // Store the level so we can look up the receiver later; we'll resolve it lazily
    // Actually, let's resolve the receiver OOP now
    if (this.session) {
      try {
        const info = debug.getFrameInfo(this.session, this.gsProcess, level);
        // Update the receiver ref with the actual OOP
        this.varRefMap.set(receiverRef, { kind: 'receiver', oop: info.receiverOop });
      } catch {
        // Keep the 0n placeholder
      }
    }

    response.body = {
      scopes: [
        new Scope('Arguments & Temps', argsRef, false),
        new Scope('Receiver', receiverRef, false),
      ],
    };
    this.sendResponse(response);
  }

  // ── Variables ───────────────────────────────────────────

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): void {
    if (!this.session) {
      response.body = { variables: [] };
      this.sendResponse(response);
      return;
    }

    const varRef = this.varRefMap.get(args.variablesReference);
    if (!varRef) {
      response.body = { variables: [] };
      this.sendResponse(response);
      return;
    }

    try {
      switch (varRef.kind) {
        case 'frame':
          response.body = { variables: this.getFrameVariables(varRef.level) };
          break;
        case 'receiver':
          response.body = { variables: this.getReceiverVariables(varRef.oop) };
          break;
        case 'named':
          response.body = { variables: this.getNamedVariables(varRef.oop) };
          break;
        case 'indexed':
          response.body = {
            variables: this.getIndexedVariables(
              varRef.oop,
              varRef.totalSize,
              args.start,
              args.count,
            ),
          };
          break;
      }
    } catch (e) {
      logError(this.session.id, `variables error: ${e}`);
      response.body = { variables: [] };
    }

    this.sendResponse(response);
  }

  private getFrameVariables(level: number): Variable[] {
    if (!this.session) return [];
    const info = debug.getFrameInfo(this.session, this.gsProcess, level);
    const vars: Variable[] = [];

    for (let i = 0; i < info.argAndTempNames.length && i < info.argAndTempOops.length; i++) {
      const oop = info.argAndTempOops[i];
      vars.push(this.makeVariable(info.argAndTempNames[i], oop));
    }

    return vars;
  }

  private getReceiverVariables(receiverOop: bigint): Variable[] {
    if (!this.session || receiverOop === OOP_NIL || receiverOop === 0n) {
      return [{ name: 'self', value: 'nil', variablesReference: 0 }];
    }

    const vars: Variable[] = [];

    // Show "self" as the first entry
    vars.push(this.makeVariable('self', receiverOop));

    // Show named instance variables
    const names = debug.getInstVarNames(this.session, receiverOop);
    if (names.length > 0) {
      const oops = debug.getNamedInstVarOops(this.session, receiverOop, names.length);
      for (let i = 0; i < names.length && i < oops.length; i++) {
        vars.push(this.makeVariable(names[i], oops[i]));
      }
    }

    return vars;
  }

  private getNamedVariables(oop: bigint): Variable[] {
    if (!this.session) return [];
    const names = debug.getInstVarNames(this.session, oop);
    if (names.length === 0) return [];
    const oops = debug.getNamedInstVarOops(this.session, oop, names.length);
    const vars: Variable[] = [];
    for (let i = 0; i < names.length && i < oops.length; i++) {
      vars.push(this.makeVariable(names[i], oops[i]));
    }
    return vars;
  }

  private getIndexedVariables(
    oop: bigint,
    totalSize: number,
    start?: number,
    count?: number,
  ): Variable[] {
    if (!this.session) return [];
    const s = (start ?? 0) + 1; // Convert to 1-based
    const c = count ?? Math.min(totalSize, 100);
    const oops = debug.getIndexedOops(this.session, oop, s, c);
    const vars: Variable[] = [];
    for (let i = 0; i < oops.length; i++) {
      vars.push(this.makeVariable(`[${s + i}]`, oops[i]));
    }
    return vars;
  }

  private makeVariable(name: string, oop: bigint): Variable {
    if (!this.session) {
      return { name, value: '<no session>', variablesReference: 0 };
    }

    const value = debug.getObjectPrintString(this.session, oop, MAX_PRINT_STRING);
    const type = debug.getObjectClassName(this.session, oop);

    // Determine if this value is expandable
    let variablesReference = 0;
    let indexedVariables: number | undefined;
    let namedVariables: number | undefined;

    if (oop !== OOP_NIL && !debug.isSpecialOop(this.session, oop)) {
      // Check for named instVars
      const namedCount = debug.getInstVarNames(this.session, oop).length;
      // Check for indexed elements
      const indexedCount = debug.getIndexedSize(this.session, oop);

      if (namedCount > 0 || indexedCount > 0) {
        if (indexedCount > 0) {
          variablesReference = this.allocVarRef({
            kind: 'indexed',
            oop,
            totalSize: indexedCount,
          });
          indexedVariables = indexedCount;
        }
        if (namedCount > 0 && indexedCount === 0) {
          variablesReference = this.allocVarRef({ kind: 'named', oop });
          namedVariables = namedCount;
        }
      }
    }

    return {
      name,
      value,
      type,
      variablesReference,
      indexedVariables,
      namedVariables,
    } as Variable;
  }

  // ── Stepping ────────────────────────────────────────────

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments,
  ): void {
    if (!this.session) {
      this.sendResponse(response);
      return;
    }

    this.sendResponse(response);
    this.handleStepResult('stepOver', debug.stepOver(this.session, this.gsProcess, 1));
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments,
  ): void {
    if (!this.session) {
      this.sendResponse(response);
      return;
    }

    this.sendResponse(response);
    this.handleStepResult('stepIn', debug.stepInto(this.session, this.gsProcess, 1));
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments,
  ): void {
    if (!this.session) {
      this.sendResponse(response);
      return;
    }

    this.sendResponse(response);
    this.handleStepResult('stepOut', debug.stepOut(this.session, this.gsProcess, 1));
  }

  private handleStepResult(
    label: string,
    result: { completed: boolean; errorMessage?: string; errorContext?: bigint },
  ): void {
    this.clearVarRefs();
    if (result.completed) {
      this.gsProcess = 0n;
      this.sendEvent(new TerminatedEvent());
    } else {
      this.sendEvent(new StoppedEvent('step', THREAD_ID));
    }
  }

  // ── Continue ────────────────────────────────────────────

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments,
  ): void {
    if (!this.session) {
      this.sendResponse(response);
      return;
    }

    response.body = { allThreadsContinued: true };
    this.sendResponse(response);

    const result = debug.continueExecution(this.session, this.gsProcess);
    if (result.completed) {
      this.gsProcess = 0n;
      this.sendEvent(new TerminatedEvent());
    } else {
      // Hit another error — stay in debug mode
      this.errorMessage = result.errorMessage || 'GemStone error';
      this.clearVarRefs();
      this.sendEvent(new StoppedEvent('exception', THREAD_ID, this.errorMessage));
    }
  }

  // ── Evaluate ────────────────────────────────────────────

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): void {
    if (!this.session) {
      response.body = { result: '<no session>', variablesReference: 0 };
      this.sendResponse(response);
      return;
    }

    const level = args.frameId || 1;
    try {
      const result = debug.evaluateInFrame(this.session, this.gsProcess, args.expression, level);
      response.body = { result, variablesReference: 0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      response.body = { result: `Error: ${msg}`, variablesReference: 0 };
    }

    this.sendResponse(response);
  }

  // ── Restart Frame ───────────────────────────────────────

  protected restartFrameRequest(
    response: DebugProtocol.RestartFrameResponse,
    args: DebugProtocol.RestartFrameArguments,
  ): void {
    if (!this.session) {
      this.sendResponse(response);
      return;
    }

    try {
      debug.trimStackToLevel(this.session, this.gsProcess, args.frameId);
      this.clearVarRefs();
      this.sendResponse(response);
      this.sendEvent(new StoppedEvent('restart', THREAD_ID));
    } catch (e) {
      response.success = false;
      response.message = e instanceof Error ? e.message : String(e);
      this.sendResponse(response);
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  private clearVarRefs(): void {
    this.varRefMap.clear();
    this.nextVarRef = 1;
    // Don't clear sourceRefMap — sources don't change between steps
  }
}
