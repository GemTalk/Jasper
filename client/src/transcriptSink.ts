import type { GciError } from './gciLibrary';
import type { ActiveSession } from './sessionManager';
import { OOP_ILLEGAL, OOP_NIL } from './gciConstants';
import { logError, logInfo } from './gciLog';

/**
 * Jade-style server-side Transcript sink.
 *
 * At login a small class (`JasperTranscriptSink`) is compiled into the server —
 * never committed, held only via `SessionTemps`, so it survives aborts and
 * disappears at logout (the same pattern as JadeServer's `_installTranscript`).
 * The instance replaces the stream GemStone's `TranscriptStreamPortable` keeps
 * at `SessionTemps at: #'TranscriptStream_SessionStream'`, which is where every
 * `Transcript show:` / `nextPutAll:` in the session ultimately writes. Note the
 * key must be `#TranscriptStream_SessionStream`, not `#Transcript`: an earlier
 * version keyed the sink at `#Transcript`, which no supported version consults,
 * so Transcript output was silently lost — don't reintroduce that.
 *
 * Every write is either buffered or forwarded:
 *
 * - **buffered** (default): writes accumulate server-side and the client
 *   drains them after a call completes ({@link drainTranscript}). This is the
 *   only safe handling for GciTsExecuteFetchBytes-based calls (all queries, MCP
 *   tools): a forwarder send on that path degenerates to rtErrExpectedClass
 *   with no continuable context, killing the call.
 *
 * - **clientForwarder mode**: each write goes through an embedded
 *   `ClientForwarder`, which the VM surfaces to the GCI client as error 2336
 *   (`#clientForwarderSend`) with a continuable GsProcess — *while the code is
 *   still running*. The client displays the text and resumes via
 *   GciTsContinueWith. Only paths prepared to handle 2336 (Execute/Display/
 *   Inspect It, notebook cells) start it, via {@link startClientForwarderMode}.
 *
 * clientForwarder mode belongs to one process, the one running the code the
 * caller started it for, never to the session. A write is forwarded when it
 * comes from that process or from any process while that process is still
 * running; once it completes, halts, or is cleared by a hard break, the next
 * write finds it gone and the mode ends by itself. Left on, a 2336 in the
 * calls that follow would fail a blocking call and hand its answer to the next
 * one ([#665](https://github.com/GemTalk/Jasper/issues/665)).
 *
 * {@link endClientForwarderMode} still ends it explicitly, for the two cases
 * the process check cannot see:
 *
 * - a soft-broken process, suspended for the debugger but still reading as
 *   waiting. The caller's `finally` ends the mode, and succeeds, because the
 *   session is idle.
 * - a hard break that lands in a fork. It stops whichever process is running,
 *   so the process the mode belongs to can be left parked, still reading as
 *   waiting. The `finally`'s end is refused at that point (the cancelled call
 *   is still being collected), so the runner ends the mode again once it has
 *   collected the call (`NbRunOptions.onAbandonedCollected`).
 *
 * ClientForwarder sends bypass Smalltalk exception handlers (verified: an
 * `on: AbstractException do:` around the send still surfaces 2336 to the GCI),
 * so clientForwarder mode works even inside error-trapping wrappers.
 */

/** GemStone error number for a ClientForwarder send (#clientForwarderSend). */
export const CLIENT_FORWARDER_SEND_ERR = 2336;

/**
 * The `clientObject` id our forwarder signals with. Jade reserves 2 for the
 * Transcript; keeping the same id makes the wire behavior mutually intelligible.
 */
export const TRANSCRIPT_CLIENT_OBJECT = 2;

/** Upper bound on a single forwarded/drained transcript chunk. */
const MAX_TRANSCRIPT_FETCH = 1024 * 1024;

/**
 * The install doit. Compiles the sink class, instantiates it, carries over any
 * text already buffered in the default session stream, and installs it at the
 * two SessionTemps keys: the kernel's stream hook and our own lookup key.
 * Idempotent per session. Never commits — everything lives in temporary object
 * memory, referenced from SessionTemps (a transient root), so it survives
 * aborts and vanishes at logout.
 *
 * The sink implements the four messages TranscriptStreamPortable actually
 * delegates to its session stream — `nextPutAll:`, `nextPut:`, `contents`,
 * `reset` (3.6.2 and 3.7.x verified) — plus the `jasper…` control protocol.
 * `contents` answers an empty string so `endEntry` doesn't ALSO echo everything
 * to the gem log via `GsFile gciLogServer:`.
 *
 * How the sink finds clientForwarder mode's process: the start call records the
 * source about to run and its own process's `_stackSerialNum`. Each GCI call
 * gets a larger serial, and a fork inherits its parent's. On the first write
 * after the start, the sink follows `parentProcess` from the writer to the
 * process its GCI call started, and claims that process if it is newer than the
 * start call and still running that source. Execute It sends its code
 * unwrapped, so nothing inside the code can mark the process. Once claimed,
 * every write is forwarded while the process runs. A newer process that is not
 * running the source means the call is over, and clears the mode as well.
 * Anything the check raises means "buffer": a Transcript write must never fail
 * because of it.
 *
 * "Running" means any status but `debug`, `terminated` or
 * `terminationStarted`, so `suspended` and `on delayQueue` count as running
 * too; both only occur while the call is still in flight. Once its call has
 * returned to the client its status reads `debug` (the scheduler's own word
 * for "the GCI application holds it"), or `terminated` once a hard break has
 * been cleared. A completed process is not
 * marked terminated, and one resumed by GciTsContinueWith even keeps its
 * frames, so neither `_isTerminated` nor the stack depth can tell. A process
 * that returned soft-broken, or that a hard break left parked because it
 * stopped a fork instead, can still read as waiting, which is why the explicit
 * end is kept.
 *
 * No String literal is compared with a runtime String: this doit is sent as
 * UTF-8, so its literals compile as Unicode strings, and comparing one with a
 * plain String raises (swallowed above, so the write would quietly buffer).
 */
export const TRANSCRIPT_SINK_INSTALL_CODE = `| tmps dict cls sink old symList |
tmps := SessionTemps current.
(tmps at: #JasperTranscriptSink otherwise: nil) ifNotNil: [:s | ^'already installed'].
symList := System myUserProfile symbolList.
dict := SymbolDictionary new.
cls := Object
  subclass: 'JasperTranscriptSink'
  instVarNames: #('buffer' 'forwarder' 'owner' 'ownerSource' 'ownerAfter')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: dict
  options: #(#instancesNonPersistent).
cls compileMethod: 'jasperSetup
  buffer := WriteStream on: String new.
  forwarder := ClientForwarder new clientObject: ${TRANSCRIPT_CLIENT_OBJECT}'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'nextPutAll: aCollection
  | str |
  str := (aCollection isKindOf: CharacterCollection)
    ifTrue: [aCollection] ifFalse: [aCollection printString].
  self jasperForwarding
    ifTrue: [forwarder nextPutAll: str]
    ifFalse: [buffer nextPutAll: str].
  ^aCollection'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'nextPut: aCharacter
  self nextPutAll: aCharacter asString.
  ^aCharacter'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'contents
  ^String new'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'reset
  ^self'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperDrain
  | c |
  c := buffer contents.
  buffer := WriteStream on: String new.
  ^c'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperStartClientForwarderModeFor: aSource
  owner := nil.
  ownerSource := aSource asUnicodeString.
  ownerAfter := GsProcess _current _stackSerialNum.
  ^self jasperDrain'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperEndClientForwarderMode
  owner := nil.
  ownerSource := nil.
  ^self jasperDrain'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperForwarding
  ^[owner == nil ifTrue: [owner := self jasperClaimOwner].
    owner ~~ nil and: [(self jasperIsRunning: owner)
      or: [owner := nil. ownerSource := nil. false]]]
    on: Error do: [:e | false]'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperClaimOwner
  | root |
  ownerSource == nil ifTrue: [^nil].
  root := GsProcess _current.
  [root isForked and: [root parentProcess ~~ nil]] whileTrue: [root := root parentProcess].
  root _stackSerialNum > ownerAfter ifFalse: [^nil].
  ((self jasperIsRunning: root) and: [self jasperRunsOwnerSource: root]) ifTrue: [^root].
  ownerSource := nil.
  ^nil'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperIsRunning: aProcess
  aProcess == GsProcess _current ifTrue: [^true].
  ^(#(#debug #terminated #terminationStarted) includesIdentical: aProcess _statusString asSymbol) not'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperIsOwnerSource: aMethod
  | src |
  aMethod == nil ifTrue: [^false].
  src := aMethod sourceString.
  ^src size = ownerSource size and: [src asUnicodeString = ownerSource]'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'jasperRunsOwnerSource: aProcess
  | level frame |
  aProcess == GsProcess _current ifFalse: [
    1 to: aProcess stackDepth do: [:i |
      (self jasperIsOwnerSource: (aProcess methodAt: i)) ifTrue: [^true]].
    ^false].
  level := 1.
  [(frame := GsProcess _frameContentsAt: level) ~~ nil] whileTrue: [
    (self jasperIsOwnerSource: (frame at: 1)) ifTrue: [^true].
    level := level + 1].
  ^false'
  dictionaries: symList category: 'jasper' environmentId: 0.
sink := cls new.
sink jasperSetup.
old := tmps at: #TranscriptStream_SessionStream otherwise: nil.
(old ~~ nil and: [old isKindOf: Stream]) ifTrue: [
  [sink nextPutAll: old contents] on: AbstractException do: [:e | ]].
tmps at: #TranscriptStream_SessionStream put: sink.
tmps at: #JasperTranscriptSink put: sink.
'installed'`;

// The drained text is re-encoded as UTF-8 server-side (encodeAsUTF8, present
// since 3.6.2) because the raw fetch below decodes bytes as UTF-8 — a plain
// 8-bit String with high characters would otherwise mis-decode.

/** Fetch-and-clear the buffer; empty string when no sink or nothing buffered. */
const DRAIN_CODE = `| sink |
sink := SessionTemps current at: #JasperTranscriptSink otherwise: nil.
sink == nil ifTrue: [''] ifFalse: [sink jasperDrain encodeAsUTF8]`;

/**
 * Starting clientForwarder mode also drops `TranscriptStreamPortable`'s
 * per-session mutex, because this runs at the start of every interactive
 * execute and is therefore the one place that reliably precedes a Transcript
 * write.
 *
 * That semaphore guards every `Transcript` write. A GsProcess left suspended
 * inside its `critical:` block holds it for the life of the session, and from
 * then on every write raises 2366 (rtErrSchedulerDeadlocked) rather than
 * printing — [#646](https://github.com/GemTalk/Jasper/issues/646).
 * {@link settleNbResult} clears such a process as it goes, which releases the
 * semaphore properly; this is the backstop for the states that cannot reach,
 * chiefly a write that already queued behind the dead holder, after which the
 * signal goes to that dead waiter and clearing the stack no longer helps.
 * Dropping the key is the only repair verified to work from there.
 *
 * Deliberately NOT done at login: SessionTemps is empty in a fresh session, so
 * the key does not exist yet and removing it there is a no-op (verified). The
 * repair is only ever needed mid-session.
 *
 * What a reset can cost, given it now runs while the session may be busy: a
 * process still *waiting* on the old semaphore is left waiting on an object
 * nothing will signal, and a holder that later completes signals an orphan.
 * Both were already deadlocked against the holder, so neither loses anything
 * that was going to work. Writes racing the swap can interleave.
 */
function startClientForwarderModeCode(source: string): string {
  return `| sink |
SessionTemps current removeKey: #TranscriptStream_SessionMutex ifAbsent: [nil].
sink := SessionTemps current at: #JasperTranscriptSink otherwise: nil.
sink == nil ifTrue: [''] ifFalse: [(sink jasperStartClientForwarderModeFor: ${smalltalkString(source)}) encodeAsUTF8]`;
}

const END_CLIENT_FORWARDER_MODE_CODE = `| sink |
sink := SessionTemps current at: #JasperTranscriptSink otherwise: nil.
sink == nil ifTrue: [''] ifFalse: [sink jasperEndClientForwarderMode encodeAsUTF8]`;

/**
 * A Smalltalk expression answering `text`, kept ASCII: the 3.6.x compiler fails
 * on a non-ASCII literal inside a doit ("ComStrmSetCursor: new cursor out of
 * range"), so such text travels as its UTF-8 bytes in hex instead.
 */
function smalltalkString(text: string): string {
  if (/^\p{ASCII}*$/u.test(text)) return `'${text.replace(/'/g, "''")}'`;
  return `((ByteArray fromHexString: '${Buffer.from(text, 'utf8').toString('hex')}') decodeFromUTF8)`;
}

/**
 * Compile and install the sink on a freshly logged-in session. Failure is
 * non-fatal — the session works exactly as before, just without transcript
 * display — so a user lacking compile privileges still gets a session.
 */
export function installTranscriptSink(session: ActiveSession): boolean {
  try {
    const result = session.gci.executeAndFetchString(session.handle, TRANSCRIPT_SINK_INSTALL_CODE);

    logInfo(`[Session ${session.id}] Transcript sink ${result}`);
    return true;
  } catch (e) {
    logError(
      session.id,
      `Transcript sink install failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * Start clientForwarder mode for the call about to run `source`, which must be
 * the exact source string handed to GciTsNbExecute next: the sink recognises
 * the call's process by it. Returns any buffered residue, so it is displayed
 * the moment the execute starts. Empty string when no sink is installed.
 */
export function startClientForwarderMode(session: ActiveSession, source: string): string {
  return runFetchString(session, startClientForwarderModeCode(source));
}

/**
 * End clientForwarder mode and return anything drained in the transition, so
 * writes that raced the end are not lost. GemStone refuses it while a
 * hard-broken call is still being collected; callers therefore also run it once
 * the call has been collected (see the module doc). Failure is logged, never
 * thrown.
 */
export function endClientForwarderMode(session: ActiveSession): string {
  return runFetchString(session, END_CLIENT_FORWARDER_MODE_CODE);
}

/** Drain buffered transcript output (queries, MCP, debugger-step paths). */
export function drainTranscript(session: ActiveSession): string {
  return runFetchString(session, DRAIN_CODE);
}

function runFetchString(session: ActiveSession, code: string): string {
  try {
    return session.gci.executeAndFetchString(session.handle, code);
  } catch (e) {
    logError(
      session.id,
      `Transcript sink call failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return '';
  }
}

/** True when a GCI error is a ClientForwarder send (candidate transcript write). */
export function isForwarderSendError(err: GciError): boolean {
  return err.number === CLIENT_FORWARDER_SEND_ERR;
}

// koffi returns uint64 as Number when it fits; normalize for comparisons.
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/**
 * Decode a 2336 error into the transcript text it carries, or null when the
 * forwarder send is not ours (different clientObject / selector).
 *
 * GciErrSType args layout for a forwarder send (same as Jade decodes):
 *   args[0] = the ClientForwarder (receiver)
 *   args[1] = its clientObject (SmallInteger)
 *   args[2] = the selector (Symbol)
 *   args[3] = the argument Array
 */
export function decodeTranscriptForwarderSend(
  session: ActiveSession,
  err: GciError,
): string | null {
  try {
    if (!isForwarderSendError(err) || err.argCount < 4) return null;
    const gci = session.gci;
    const clientObject = gci.GciTsOopToI64(session.handle, toBigInt(err.args[1]));
    if (!clientObject.success || clientObject.value !== BigInt(TRANSCRIPT_CLIENT_OBJECT)) {
      return null;
    }
    const selector = gci.GciTsFetchUtf8(session.handle, toBigInt(err.args[2]), 64);
    if (selector.err.number !== 0 || selector.data !== 'nextPutAll:') return null;
    const argArray = gci.GciTsFetchOops(session.handle, toBigInt(err.args[3]), 1n, 1);
    if (argArray.result < 1) return null;
    const text = gci.GciTsFetchUtf8(session.handle, argArray.oops[0], MAX_TRANSCRIPT_FETCH);
    if (text.err.number !== 0) return null;
    return text.data;
  } catch {
    return null;
  }
}

/**
 * Read a non-blocking call's result, forwarding transcript sends as they
 * arrive: on 2336, display the text via `onTranscript` and resume with
 * GciTsContinueWith on a koffi worker thread, so the extension host stays free
 * even if the resumed code runs for minutes, looping until a real result or
 * error.
 *
 * A 2336 that is NOT ours (unknown clientObject) is still continued — there is
 * no meaningful reply we can give, but abandoning it would strand the user's
 * execution; its text is simply not displayed.
 *
 * Errors other than 2336 are returned to the caller untouched, preserving the
 * DebuggableError flow (halts, breaks) of the calling path.
 *
 * A throw anywhere in the loop clears the suspended process's stack before
 * rethrowing. The process we are resuming is, by construction, stopped INSIDE
 * `TranscriptStreamPortable`'s `critical:` block, holding the session's
 * Transcript semaphore. Left suspended it holds that semaphore for the life of
 * the session and every later Transcript write raises 2366
 * (rtErrSchedulerDeadlocked) — the failure mode of
 * [#646](https://github.com/GemTalk/Jasper/issues/646). GciTsClearStack runs
 * the process's `ensure:` blocks, and `critical:` releases the semaphore in
 * one, so clearing it here is what makes the semaphore come back. Verified on
 * a live stone: clear immediately and the next write succeeds; let one other
 * write queue on the semaphore first and clearing is no longer enough, because
 * the signal is handed to that now-dead waiter. Hence "immediately".
 *
 * `abandoned` is the runner's hard-break signal (see `pollNbToCompletion`).
 * Once it fires the caller already has NbCancelledError, so nobody else will
 * clear what the break stopped: a writer caught between sends is cleared
 * rather than resumed, and the process a hard break stops is cleared too —
 * stopped inside a write, it holds the semaphore just the same (measured on
 * 3.6.2 and 3.7.5).
 */
export async function settleNbResult(
  session: ActiveSession,
  onTranscript: (text: string) => void,
  abandoned?: AbortSignal,
): Promise<{ result: bigint; err: GciError }> {
  let { result, err } = session.gci.GciTsNbResult(session.handle);
  while (isForwarderSendError(err)) {
    const suspended = toBigInt(err.context);
    if (abandoned?.aborted) {
      clearSuspendedWriter(session, suspended);
      return { result, err };
    }
    try {
      const text = decodeTranscriptForwarderSend(session, err);
      if (text !== null && text.length > 0) onTranscript(text);
      ({ result, err } = await session.gci.GciTsContinueWithAsync(
        session.handle,
        suspended,
        OOP_ILLEGAL,
        null,
        0,
      ));
    } catch (e) {
      clearSuspendedWriter(session, suspended);
      throw e;
    }
  }
  if (abandoned?.aborted && err.number !== 0) {
    clearSuspendedWriter(session, toBigInt(err.context));
  }
  return { result, err };
}

/**
 * Release the Transcript semaphore held by a process we are about to abandon.
 * Best-effort: the session may already be unusable, and the caller is on its
 * way out with the real error, which must not be replaced by this one.
 */
function clearSuspendedWriter(session: ActiveSession, gsProcess: bigint): void {
  if (gsProcess === OOP_NIL || gsProcess === 0n) return;
  try {
    session.gci.GciTsClearStack(session.handle, gsProcess);
  } catch (e) {
    logError(
      session.id,
      `Could not clear the suspended Transcript writer; later Transcript writes in this ` +
        `session may deadlock until logout: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
