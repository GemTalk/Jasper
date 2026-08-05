import type { GciError } from './gciLibrary';
import type { ActiveSession } from './sessionManager';
import { OOP_ILLEGAL } from './gciConstants';
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
 * The sink runs in one of two modes:
 *
 * - **buffered** (default): writes accumulate server-side and the client
 *   drains them after a call completes ({@link drainTranscript}). This is the
 *   only safe mode for GciTsExecuteFetchBytes-based calls (all queries, MCP
 *   tools): a forwarder send on that path degenerates to rtErrExpectedClass
 *   with no continuable context, killing the call.
 *
 * - **live**: each write goes through an embedded `ClientForwarder`, which the
 *   VM surfaces to the GCI client as error 2336 (`#clientForwarderSend`) with a
 *   continuable GsProcess — *while the code is still running*. The client
 *   displays the text and resumes via GciTsContinueWith. Only paths prepared to
 *   handle 2336 (Execute/Display/Inspect It, notebook cells) turn this on, via
 *   {@link setTranscriptLive}.
 *
 * ClientForwarder sends bypass Smalltalk exception handlers (verified: an
 * `on: AbstractException do:` around the send still surfaces 2336 to the GCI),
 * so live forwarding works even inside error-trapping wrappers.
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
 */
export const TRANSCRIPT_SINK_INSTALL_CODE = `| tmps dict cls sink old symList |
tmps := SessionTemps current.
(tmps at: #JasperTranscriptSink otherwise: nil) ifNotNil: [:s | ^'already installed'].
symList := System myUserProfile symbolList.
dict := SymbolDictionary new.
cls := Object
  subclass: 'JasperTranscriptSink'
  instVarNames: #('buffer' 'live' 'forwarder')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: dict
  options: #(#instancesNonPersistent).
cls compileMethod: 'jasperSetup
  buffer := WriteStream on: String new.
  live := false.
  forwarder := ClientForwarder new clientObject: ${TRANSCRIPT_CLIENT_OBJECT}'
  dictionaries: symList category: 'jasper' environmentId: 0.
cls compileMethod: 'nextPutAll: aCollection
  | str |
  str := (aCollection isKindOf: CharacterCollection)
    ifTrue: [aCollection] ifFalse: [aCollection printString].
  live == true
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
cls compileMethod: 'jasperLive: aBoolean
  live := aBoolean == true.
  ^self jasperDrain'
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

function setLiveCode(live: boolean): string {
  return `| sink |
sink := SessionTemps current at: #JasperTranscriptSink otherwise: nil.
sink == nil ifTrue: [''] ifFalse: [(sink jasperLive: ${live}) encodeAsUTF8]`;
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
 * Switch the sink's mode and return any text drained in the transition, so a
 * buffered residue is displayed the moment a live execute starts, and writes
 * that raced the switch-off are not lost. Empty string when no sink installed.
 */
export function setTranscriptLive(session: ActiveSession, live: boolean): string {
  return runFetchString(session, setLiveCode(live));
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
 * arrive: on 2336, display the text via `onTranscript` and resume with an
 * async GciTsContinueWith (worker thread — the extension host stays free even
 * if the resumed code runs for minutes), looping until a real result or error.
 *
 * A 2336 that is NOT ours (unknown clientObject) is still continued — there is
 * no meaningful reply we can give, but abandoning it would strand the user's
 * execution; its text is simply not displayed.
 *
 * Errors other than 2336 are returned to the caller untouched, preserving the
 * DebuggableError flow (halts, breaks) of the calling path.
 */
export async function settleNbResult(
  session: ActiveSession,
  onTranscript: (text: string) => void,
): Promise<{ result: bigint; err: GciError }> {
  let { result, err } = session.gci.GciTsNbResult(session.handle);
  while (isForwarderSendError(err)) {
    const text = decodeTranscriptForwarderSend(session, err);
    if (text !== null && text.length > 0) onTranscript(text);
    ({ result, err } = await session.gci.GciTsContinueWithAsync(
      session.handle,
      toBigInt(err.context),
      OOP_ILLEGAL,
      null,
      0,
    ));
  }
  return { result, err };
}
