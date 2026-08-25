import { ActiveSession } from './sessionManager';
import {
  OOP_NIL,
  OOP_TRUE,
  OOP_ILLEGAL,
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
} from './gciConstants';
import { logInfo, logError } from './gciLog';
import { runNbCall, NbRunOptions } from './nbRunner';

const MAX_RESULT = 256 * 1024;

// ── Helpers ─────────────────────────────────────────────

function gciPerform(
  session: ActiveSession,
  receiver: bigint,
  selector: string,
  args: bigint[] = [],
): bigint {
  const { result, err } = session.gci.GciTsPerform(
    session.handle,
    receiver,
    OOP_ILLEGAL,
    selector,
    args,
    0,
    0,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return result;
}

function gciPerformFetchString(
  session: ActiveSession,
  receiver: bigint,
  selector: string,
  args: bigint[] = [],
): string {
  const { data, err } = session.gci.GciTsPerformFetchBytes(
    session.handle,
    receiver,
    selector,
    args,
    MAX_RESULT,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return data;
}

function oopToInt(session: ActiveSession, oop: bigint): number {
  return Number(session.gci.oopToInteger(session.handle, oop));
}

function intToOop(session: ActiveSession, n: number): bigint {
  const { result, err } = session.gci.GciTsI64ToOop(session.handle, BigInt(n));
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in I64ToOop`);
  }
  return result;
}

function executeAndFetchString(session: ActiveSession, code: string): string {
  try {
    return session.gci.executeAndFetchString(session.handle, code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(session.id, msg);
    throw e;
  }
}

// ── Frame info ──────────────────────────────────────────

export interface FrameInfo {
  methodOop: bigint;
  ipOffset: number;
  receiverOop: bigint;
  argAndTempNames: string[];
  argAndTempOops: bigint[];
}

export interface MethodInfo {
  className: string;
  selector: string;
}

export interface MethodBlockInfo {
  /** True when the frame's method is the compiled method of a block. */
  isBlock: boolean;
  /**
   * Oop of the home (enclosing) method. GsNMethod>>homeMethod returns self for
   * non-block methods, so this is always safe to use for naming. A block
   * method's own inClass/selector are NOT the displayable class/selector
   * (inClass returns the home method), so resolve names from this oop.
   */
  homeMethodOop: bigint;
}

export interface MethodUriInfo {
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
}

/**
 * Returns the number of stack frames in the suspended process.
 */
export function getStackDepth(session: ActiveSession, gsProcess: bigint): number {
  const oop = gciPerform(session, gsProcess, 'localStackDepth');
  return oopToInt(session, oop);
}

/**
 * Returns frame details at the given level (1-based, 1 = top).
 *
 * GsProcess>>_frameContentsAt: returns an Array:
 *   [1] method (GsNMethod)
 *   [2] ipOffset (SmallInteger)
 *   [3..7] internal details
 *   [8] self
 *   [9] argAndTempNames (Array of Strings)
 *   [10] receiver
 *   [11..] arg and temp values
 */
export function getFrameInfo(session: ActiveSession, gsProcess: bigint, level: number): FrameInfo {
  const levelOop = intToOop(session, level);
  const arrayOop = gciPerform(session, gsProcess, '_frameContentsAt:', [levelOop]);

  // Fetch the size of the returned array
  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, arrayOop);
  if (sizeErr.number !== 0) {
    throw new Error(sizeErr.message || `Cannot fetch array size`);
  }
  const size = Number(sizeRaw);

  // Fetch all OOPs from the array (1-based indexing in GemStone, 0-based in GciTsFetchOops)
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(session.handle, arrayOop, 1n, size);
  if (fetchErr.number !== 0) {
    throw new Error(fetchErr.message || `Cannot fetch frame contents`);
  }

  const methodOop = oops[0]; // [1] method
  const ipOffsetOop = oops[1]; // [2] ipOffset
  const receiverOop = oops[9]; // [10] receiver (0-indexed: 9)
  const namesArrayOop = oops[8]; // [9] argAndTempNames (0-indexed: 8)

  const ipOffset = oopToInt(session, ipOffsetOop);

  // Fetch arg and temp names from the names array
  const argAndTempNames: string[] = [];
  if (namesArrayOop !== OOP_NIL) {
    const { result: namesSizeRaw } = session.gci.GciTsFetchSize(session.handle, namesArrayOop);
    const namesSize = Number(namesSizeRaw);
    if (namesSize > 0) {
      const { oops: nameOops } = session.gci.GciTsFetchOops(
        session.handle,
        namesArrayOop,
        1n,
        namesSize,
      );
      for (const nameOop of nameOops) {
        const name = gciPerformFetchString(session, nameOop, 'asString');
        argAndTempNames.push(name);
      }
    }
  }

  // Arg and temp values start at index 10 (0-indexed) = Smalltalk index 11
  const argAndTempOops = oops.slice(10);

  return { methodOop, ipOffset, receiverOop, argAndTempNames, argAndTempOops };
}

/**
 * Returns class name and selector for a method OOP.
 */
export function getMethodInfo(session: ActiveSession, methodOop: bigint): MethodInfo {
  const classOop = gciPerform(session, methodOop, 'inClass');
  const className = gciPerformFetchString(session, classOop, 'name');
  const selector = gciPerformFetchString(session, methodOop, 'selector');
  return { className, selector };
}

/**
 * Reports whether a frame's method is a block method, plus the oop of its home
 * (enclosing) method. Used to render block frames as `[] in Class>>selector`,
 * mirroring GsNMethod>>printOn:. Resolve the displayed class/selector from
 * homeMethodOop, not the block method itself.
 */
export function getMethodBlockInfo(session: ActiveSession, methodOop: bigint): MethodBlockInfo {
  const isBlock = gciPerform(session, methodOop, 'isMethodForBlock') === OOP_TRUE;
  const homeMethodOop = gciPerform(session, methodOop, 'homeMethod');
  return { isBlock, homeMethodOop };
}

/**
 * Returns everything needed to construct a gemstone:// URI for a method.
 * Uses a single Smalltalk execution to minimise GCI round-trips.
 */
export function getMethodUriInfo(
  session: ActiveSession,
  methodOop: bigint,
): MethodUriInfo | undefined {
  try {
    const code = `| method class baseClass dictName category |
method := Object _objectForOop: ${methodOop}.
class := method inClass.
baseClass := class theNonMetaClass.
dictName := ''.
System myUserProfile symbolList do: [:d |
  (d includesKey: baseClass name asSymbol) ifTrue: [dictName := d name]].
category := (class categoryOfSelector: method selector environmentId: 0) ifNil: ['as yet unclassified'].
dictName, (String with: Character tab),
  baseClass name, (String with: Character tab),
  (class isMeta ifTrue: ['class'] ifFalse: ['instance']), (String with: Character tab),
  category, (String with: Character tab),
  method selector asString`;

    const data = executeAndFetchString(session, code);

    const parts = data.split('\t');
    if (parts.length < 5) return undefined;
    return {
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === 'class',
      category: parts[3],
      selector: parts[4],
    };
  } catch {
    return undefined;
  }
}

/**
 * Returns the source code of a method.
 */
export function getMethodSource(session: ActiveSession, methodOop: bigint): string {
  return gciPerformFetchString(session, methodOop, 'sourceString');
}

/**
 * Where to add a method on a given object's class. `className` is the (non-meta)
 * class name; `isMeta` is true when the object IS a class (so a class-side
 * method is wanted). `dictName` is the dictionary that class lives in (for the
 * gemstone:// new-method URI); '' when the class isn't in the user's symbol
 * list. Mirrors the class-resolution tail of DnuInfo, but for an arbitrary
 * object (a debugger frame's receiver) rather than a doesNotUnderstand: send.
 */
export interface ClassHomeInfo {
  className: string;
  isMeta: boolean;
  dictName: string;
  /** True when this class ALREADY implements the selector (it's an edit target,
   *  and — if more specific than the chosen target — a shadowing implementation). */
  implementsSelector?: boolean;
}

/**
 * The receiver's full class chain — its class and every superclass up to Object
 * — as candidate places to implement (override) `selector`. Ordered
 * most-specific first (the receiver's class), so callers can pre-select it. A
 * class receiver walks its class-side chain (isMeta true throughout). For each
 * class: its home dictionary (found by NAME key in the user's symbol list — see
 * the symbol-list home-dict gotcha; '' when not in the symbol list, so not an
 * editable target) and whether it ALREADY implements `selector` (so the caller
 * can open the existing source instead of clobbering it with a stub, and warn
 * about a subclass implementation shadowing a superclass override). Returns []
 * on any failure so callers degrade gracefully.
 */
export function getReceiverClassChain(
  session: ActiveSession,
  receiverOop: bigint,
  selector: string,
): ClassHomeInfo[] {
  try {
    // selector is a method selector (no quotes), but guard the quote anyway.
    const sel = selector.replace(/'/g, "''");
    const code = `| rcvr meta cls sel rows nm dn impl |
rcvr := Object _objectForOop: ${receiverOop}.
(rcvr isKindOf: Class)
  ifTrue: [ cls := rcvr. meta := true ]
  ifFalse: [ cls := rcvr class. meta := false ].
sel := '${sel}' asSymbol.
rows := OrderedCollection new.
[ cls notNil ] whileTrue: [
  nm := cls theNonMetaClass name asString.
  dn := ''.
  System myUserProfile symbolList do: [:d |
    (d includesKey: nm asSymbol) ifTrue: [ dn := d name ]].
  impl := cls includesSelector: sel.
  rows add: nm, (String with: Character tab),
    (meta ifTrue: ['class'] ifFalse: ['instance']), (String with: Character tab),
    dn, (String with: Character tab), (impl ifTrue: ['1'] ifFalse: ['0']).
  cls := cls superclass ].
rows inject: '' into: [:acc :r | acc isEmpty ifTrue: [r] ifFalse: [acc, (String with: Character lf), r]]`;

    const data = executeAndFetchString(session, code);

    return data
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split('\t');
        return {
          className: parts[0],
          isMeta: parts[1] === 'class',
          dictName: parts[2] ?? '',
          implementsSelector: parts[3] === '1',
        };
      });
  } catch {
    return [];
  }
}

/** Where a frame's running method actually lives — for the "Browse" action. */
export interface BrowseTarget {
  /** The class (non-meta name) that DEFINES the running method (via method lookup
   *  on the receiver), which may be a superclass of the receiver's class. */
  className: string;
  /** True when the method is class-side (the receiver is a class). */
  isMeta: boolean;
  /** The defining class's home dictionary, '' when not in the user's symbol list. */
  dictName: string;
  /** The method's category in the defining class ('' when uncategorized). */
  category: string;
}

/**
 * Resolve where a frame's running `selector` is actually DEFINED — the class
 * method lookup finds for the receiver (the receiver's own class or a superclass
 * for an inherited method), so "Browse" lands on the source that is really
 * executing. Walks the receiver's class chain for the first class that
 * `includesSelector:` (the lookup result), then reports that class's home
 * dictionary (by NAME key in the user's symbol list — see the symbol-list
 * home-dict gotcha) and the selector's method category. A class receiver walks
 * its class-side chain (isMeta true). Returns undefined when the selector can't
 * be found anywhere in the chain or on any failure, so the caller degrades to a
 * clear message rather than opening a misleading browser.
 */
export function getBrowseTarget(
  session: ActiveSession,
  receiverOop: bigint,
  selector: string,
): BrowseTarget | undefined {
  try {
    const sel = selector.replace(/'/g, "''");
    const code = `| rcvr meta cls sel def dn |
rcvr := Object _objectForOop: ${receiverOop}.
(rcvr isKindOf: Class)
  ifTrue: [ cls := rcvr. meta := true ]
  ifFalse: [ cls := rcvr class. meta := false ].
sel := '${sel}' asSymbol.
def := nil.
[ cls notNil and: [ def isNil ] ] whileTrue: [
  (cls includesSelector: sel) ifTrue: [ def := cls ].
  cls := cls superclass ].
def isNil ifTrue: [ '' ] ifFalse: [
  dn := ''.
  System myUserProfile symbolList do: [:d |
    (d includesKey: def theNonMetaClass name asSymbol) ifTrue: [ dn := d name ]].
  def theNonMetaClass name asString, (String with: Character tab),
    (meta ifTrue: ['class'] ifFalse: ['instance']), (String with: Character tab),
    dn, (String with: Character tab),
    ((def categoryOfSelector: sel environmentId: 0) ifNil: ['']) ]`;

    const data = executeAndFetchString(session, code);

    if (data.length === 0) return undefined; // selector not found in the chain

    const parts = data.split('\t');
    return {
      className: parts[0],
      isMeta: parts[1] === 'class',
      dictName: parts[2] ?? '',
      category: parts[3] ?? '',
    };
  } catch {
    return undefined;
  }
}

/**
 * The pieces needed to create the method a `doesNotUnderstand:` is asking for.
 * `className` is the (non-meta) name of the class the method should be added to;
 * `isMeta` is true when the unknown message was sent to a *class* (so a
 * class-side method is wanted). `dictName` is the dictionary that class lives in
 * (for the gemstone:// new-method URI); '' when the class isn't in the user's
 * symbol list. `selector` / `argCount` come straight from the failed send.
 */
export interface DnuInfo {
  className: string;
  isMeta: boolean;
  dictName: string;
  selector: string;
  argCount: number;
}

/**
 * If the suspended process is parked on a `doesNotUnderstand:` (a
 * MessageNotUnderstood), return what's needed to create the missing method;
 * otherwise undefined. Walks the process's frames top-down for the
 * `Object>>doesNotUnderstand: aMessageDescriptor` frame, then reads the receiver
 * and the descriptor (`aMessageDescriptor at: 1` is the selector, `at: 2` the
 * args — see Object>>doesNotUnderstand:). A class receiver means the missing
 * method is class-side.
 *
 * One Smalltalk round-trip (mirrors getMethodUriInfo's execute-and-split shape);
 * returns undefined on any failure so callers degrade to "no Create button".
 */
export function getDoesNotUnderstandInfo(
  session: ActiveSession,
  gsProcess: bigint,
): DnuInfo | undefined {
  try {
    // Walk all frames for the doesNotUnderstand:/_doesNotUnderstand:… machinery
    // (selectors containing 'doesNotUnderstand'). `dnuTop` is the `doesNotUnderstand:`
    // frame (it carries `aMessageDescriptor` — `at: 1` selector, `at: 2` args);
    // `dnuBot` is the deepest such frame, so `dnuBot + 1` is the sender frame that
    // made the failing send (the one to restart). A class receiver ⇒ class-side.
    const code = `| p depth dnuTop dnuBot |
p := Object _objectForOop: ${gsProcess}.
depth := p localStackDepth.
dnuTop := nil. dnuBot := nil.
1 to: depth do: [:i | | m sel |
  m := (p _frameContentsAt: i) at: 1.
  sel := m isNil ifTrue: [nil] ifFalse: [m selector].
  (sel notNil and: [ (sel asString indexOfSubCollection: 'doesNotUnderstand') > 0 ]) ifTrue: [
    dnuTop isNil ifTrue: [ dnuTop := i ].
    dnuBot := i ] ].
dnuTop isNil
  ifTrue: [ '' ]
  ifFalse: [ | arr rcvr descr sel base meta dn |
    arr := p _frameContentsAt: dnuTop.
    rcvr := arr at: 10.
    descr := arr at: 11.
    sel := descr at: 1.
    (rcvr isKindOf: Class)
      ifTrue: [ base := rcvr. meta := true ]
      ifFalse: [ base := rcvr class. meta := false ].
    dn := ''.
    System myUserProfile symbolList do: [:d |
      (d includesKey: base name asSymbol) ifTrue: [ dn := d name ] ].
    base name asString, (String with: Character tab),
      (meta ifTrue: ['class'] ifFalse: ['instance']), (String with: Character tab),
      dn, (String with: Character tab),
      sel asString, (String with: Character tab),
      (descr at: 2) size printString ]`;

    const data = executeAndFetchString(session, code);
    if (data === '') return undefined; // not parked on a doesNotUnderstand:

    const parts = data.split('\t');
    if (parts.length < 5) return undefined;
    const argCount = parseInt(parts[4], 10);
    return {
      className: parts[0],
      isMeta: parts[1] === 'class',
      dictName: parts[2],
      selector: parts[3],
      argCount: Number.isNaN(argCount) ? 0 : argCount,
    };
  } catch {
    return undefined;
  }
}

/**
 * Maps an IP offset to a source line number.
 */
export function getLineForIp(session: ActiveSession, methodOop: bigint, ipOffset: number): number {
  const ipOop = intToOop(session, ipOffset);
  const lineOop = gciPerform(session, methodOop, '_lineNumberForIp:', [ipOop]);
  return oopToInt(session, lineOop);
}

/**
 * Returns a method's source offsets — GemStone `_sourceOffsets`, a 1-based array
 * where index i holds the source-string character offset of step point i. Mirrors
 * queries.getSourceOffsets but works straight from the method OOP, so it serves
 * executed-code (doit) frames, which have no class>>selector to look up. Returns
 * an empty array on any failure (best-effort; callers fall back to line-level).
 */
export function getSourceOffsetsForMethod(session: ActiveSession, methodOop: bigint): number[] {
  const arrayOop = gciPerform(session, methodOop, '_sourceOffsets');
  if (arrayOop === OOP_NIL) return [];
  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, arrayOop);
  if (sizeErr.number !== 0) return [];
  const size = Number(sizeRaw);
  if (size <= 0) return [];
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(session.handle, arrayOop, 1n, size);
  if (fetchErr.number !== 0) return [];
  return oops.map((oop) => oopToInt(session, oop));
}

/**
 * Set a step-point breakpoint on a method addressed by its OOP — for "Run to
 * Cursor" on an Executed Code (doit) frame, whose anonymous `GsNMethod` has no
 * class>>selector to resolve. `setBreakAtStepPoint:` is method-wide (it resolves
 * the step point to the owning block via `_meth_ip_ForStepPoint:`), so a break at
 * a user-code step point in a nested block halts when reached. Performed straight
 * on the method OOP — the same way `getSourceOffsetsForMethod` reads
 * `_sourceOffsets`.
 */
export function setBreakAtStepPointByOop(
  session: ActiveSession,
  methodOop: bigint,
  stepPoint: number,
): void {
  gciPerform(session, methodOop, 'setBreakAtStepPoint:', [intToOop(session, stepPoint)]);
}

/** Clear a step-point breakpoint set by OOP (see setBreakAtStepPointByOop). */
export function clearBreakAtStepPointByOop(
  session: ActiveSession,
  methodOop: bigint,
  stepPoint: number,
): void {
  gciPerform(session, methodOop, 'clearBreakAtStepPoint:', [intToOop(session, stepPoint)]);
}

/**
 * Returns the step point for the frame at the given level (1-based, 1 = top),
 * or undefined when the frame has no step point. Uses GsProcess>>_stepPointAt:,
 * the same primitive the topaz debugger uses — it accounts for native-stack
 * and async-callee frames, which a raw ipOffset→stepPoint mapping would not.
 */
export function getStepPoint(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
): number | undefined {
  const levelOop = intToOop(session, level);
  const resultOop = gciPerform(session, gsProcess, '_stepPointAt:', [levelOop]);
  if (resultOop === OOP_NIL) return undefined;
  return oopToInt(session, resultOop);
}

// ── Variables ───────────────────────────────────────────

/**
 * Returns the printString of an object together with a truncation flag.
 * truncated is true when the GCI fetch hit maxBytes exactly, meaning the
 * full printString is longer than what was returned.
 */
/**
 * Returns the printString of an object limited to maxBytes display characters,
 * together with a truncation flag.
 *
 * Truncation can happen two ways:
 *  1. GemStone's own collection limit fires first (ends with '...' or ', ...)').
 *  2. The GCI byte limit fires (data.length or bytesReturned exceeds maxBytes).
 * We detect both.
 */
export function fetchPrintString(
  session: ActiveSession,
  oop: bigint,
  maxBytes: number,
): { value: string; truncated: boolean } {
  try {
    const { bytesReturned, data, err } = session.gci.GciTsPerformFetchBytes(
      session.handle,
      oop,
      'printString',
      [],
      maxBytes + 2,
    );
    if (err.number !== 0) return { value: `<error: ${err.message}>`, truncated: false };
    const gciTruncated = data.length > maxBytes || bytesReturned > maxBytes;
    // GemStone appends '...' (optionally followed by ')') when printString hits
    // its own internal collection size cap.
    const gemstoneTruncated = /\.\.\.\s*\)?\s*$/.test(data);
    const truncated = gciTruncated || gemstoneTruncated;
    return { value: gciTruncated ? data.slice(0, maxBytes) : data, truncated };
  } catch {
    return { value: '<error getting printString>', truncated: false };
  }
}

/**
 * Returns the full output of printOn: for an object, bypassing GemStone's
 * internal printString size cap.  printString uses a LimitedWriteStream
 * internally; calling printOn: directly with a plain WriteStream has no limit.
 */
export function fetchFullPrintString(session: ActiveSession, oop: bigint): string {
  try {
    const code = `| s |
s := WriteStream on: String new.
(Object _objectForOop: ${oop}) printOn: s.
s contents`;
    return executeAndFetchString(session, code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<error: ${msg}>`;
  }
}

/**
 * Returns a printString representation of an object (truncated to maxBytes).
 */
export function getObjectPrintString(
  session: ActiveSession,
  oop: bigint,
  maxBytes: number = 1024,
): string {
  return fetchPrintString(session, oop, maxBytes).value;
}

/** One variable row of a whole-stack dump (#10/#11): which frame, which group. */
export interface StackDumpRow {
  /** Server frame level (1 = top) the row belongs to. */
  serverLevel: number;
  /** Variable group: matches the Variables-pane grouping. */
  group: 'receiver' | 'instvars' | 'argtemps' | 'stacktemps';
  name: string;
  /** printString (truncated server-side), already un-escaped. */
  value: string;
  /** The object's OOP as a decimal string. */
  oop: string;
}

// Reverse the server-side escaping (see fetchStackDump's doit): \\ \t \n \r.
// Single pass so an introduced backslash can't be re-interpreted.
function unescapeDumpField(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[++i];
      out += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : n;
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Parse the tab/newline payload produced by fetchStackDump's doit into rows.
 * One record per line; fields are `level <tab> group <tab> name <tab> value <tab>
 * oop`. `name`/`value` are escaped (the only fields that can contain delimiters),
 * so splitting on raw tab/newline is unambiguous. Exported for unit testing.
 */
export function parseStackDump(data: string): StackDumpRow[] {
  const rows: StackDumpRow[] = [];
  if (!data) return rows;
  for (const line of data.split('\n')) {
    if (line.length === 0) continue;
    const f = line.split('\t');
    if (f.length < 5) continue;
    const serverLevel = parseInt(f[0], 10);
    if (Number.isNaN(serverLevel)) continue;
    rows.push({
      serverLevel,
      group: f[1] as StackDumpRow['group'],
      name: unescapeDumpField(f[2]),
      value: unescapeDumpField(f[3]),
      oop: f[4],
    });
  }
  return rows;
}

/**
 * Fetch EVERY frame's variables (receiver, instVars, args/temps) for the whole
 * suspended process in ONE round trip — for the Copy Stack / Dump Stack detail
 * (#10/#11). A single server doit walks the stack and streams a tab/newline
 * payload (printStrings escaped + capped) which we parse client-side; this
 * replaces the old one-`fetchVariables`-call-per-frame approach (F×(1+vars) GCI
 * round trips → 1). Mirrors the Variables pane's grouping so Copy/Dump match it.
 *
 * Best-effort: a frame the server can't introspect contributes no rows; a failed
 * fetch returns [] (the dump then shows headings without variables).
 */
export function fetchStackDump(session: ActiveSession, gsProcess: bigint): StackDumpRow[] {
  // self of each row is built server-side; names/printStrings are escaped (\\ \t
  // \n \r) so the tab/newline framing is safe, and printStrings are capped so one
  // huge object can't blow the payload. `_frameContentsAt:` layout matches
  // getFrameInfo: [9]=argAndTempNames, [10]=receiver, [10+i]=ith arg/temp value.
  // `row` writes one record: level, group, escaped name, escaped printString,
  // and oop — a 4-arg block (GemStone ExecBlocks cap at 4 value: args, so it
  // takes the object and derives printString+oop rather than passing 5 fields).
  // Frame-contents indexing (at:9 names, at:10 receiver, at:10+i values) matches
  // the kernel's own GsProcess>>stackReportToLevel:… so it's correct on a
  // suspended process (it is NOT indexable on the running process).
  const code = `| proc out tab esc psOf row depth |
proc := Object _objectForOop: ${gsProcess}.
out := WriteStream on: String new.
tab := String with: Character tab.
esc := [:str | | s |
  s := str.
  s size > 2000 ifTrue: [s := (s copyFrom: 1 to: 2000), '...'].
  s := s copyReplaceAll: (String with: $\\) with: '\\\\'.
  s := s copyReplaceAll: tab with: '\\t'.
  s := s copyReplaceAll: (String with: Character lf) with: '\\n'.
  s := s copyReplaceAll: (String with: Character cr) with: '\\r'.
  s].
psOf := [:obj | esc value: ([obj printString] on: Error do: [:e | '<unprintable>'])].
row := [:lvl :grp :nm :obj |
  out nextPutAll: lvl printString; nextPutAll: tab;
      nextPutAll: grp; nextPutAll: tab;
      nextPutAll: (esc value: nm); nextPutAll: tab;
      nextPutAll: (psOf value: obj); nextPutAll: tab;
      nextPutAll: obj asOop printString; nextPut: Character lf].
depth := proc localStackDepth.
1 to: depth do: [:lvl |
  [ | arr receiver names |
    arr := proc _frameContentsAt: lvl.
    receiver := arr at: 10.
    names := arr at: 9.
    row value: lvl value: 'receiver' value: 'self' value: receiver.
    [ receiver class allInstVarNames keysAndValuesDo: [:i :nm |
        row value: lvl value: 'instvars' value: nm asString value: (receiver instVarAt: i) ]
    ] on: Error do: [:e | ].
    names isNil ifFalse: [
      1 to: names size do: [:i | | nm |
        nm := (names at: i) asString.
        (nm startsWith: '__vsc') ifFalse: [
          row value: lvl
              value: ((nm startsWith: '.') ifTrue: ['stacktemps'] ifFalse: ['argtemps'])
              value: nm value: (arr at: 10 + i) ] ] ]
  ] on: Error do: [:e | ] ].
out contents`;

  try {
    const data = executeAndFetchString(session, code);
    return parseStackDump(data);
  } catch {
    return [];
  }
}

/** One variable of a single frame (receiver / instVar / arg-temp / stack-temp). */
export interface FrameVarRow {
  group: 'receiver' | 'instvars' | 'argtemps' | 'stacktemps';
  name: string;
  /** printString (escaped server-side then un-escaped here, capped). */
  value: string;
  /** The object's OOP as a decimal string. */
  oop: string;
  /**
   * 1-based write index for an editable slot: instVar index (`instVarAt:put:`) or
   * arg/temp index into the frame's `argAndTempNames` (`_frameAt:tempAt:put:`).
   * 0 for the receiver and stack temps (not editable).
   */
  index: number;
}

/**
 * Parse the tab/newline payload from `fetchFrameVariables`'s doit: one record per
 * line, fields `group <tab> name <tab> value <tab> oop <tab> index`. Exported for
 * unit testing.
 */
export function parseFrameVars(data: string): FrameVarRow[] {
  const rows: FrameVarRow[] = [];
  if (!data) return rows;
  for (const line of data.split('\n')) {
    if (line.length === 0) continue;
    const f = line.split('\t');
    if (f.length < 5) continue;
    rows.push({
      group: f[0] as FrameVarRow['group'],
      name: unescapeDumpField(f[1]),
      value: unescapeDumpField(f[2]),
      oop: f[3],
      index: parseInt(f[4], 10) || 0,
    });
  }
  return rows;
}

/**
 * Fetch ALL of one frame's variables — receiver, instVars, args/temps — in ONE
 * round trip (a single server doit streams an escaped tab/newline payload),
 * replacing the old per-variable approach (1 getFrameInfo + getInstVarNames +
 * getNamedInstVarOops + N getObjectPrintString → 1 call). Mirrors fetchStackDump
 * but for a single level and additionally emits each editable slot's write index.
 * Best-effort: a frame the server can't introspect returns []. The `row` block
 * takes 4 args (GemStone ExecBlocks cap value: at 4): group, name, object, index.
 */
export function fetchFrameVariables(
  session: ActiveSession,
  gsProcess: bigint,
  serverLevel: number,
): FrameVarRow[] {
  const code = `| proc out tab esc psOf row arr receiver names |
proc := Object _objectForOop: ${gsProcess}.
out := WriteStream on: String new.
tab := String with: Character tab.
esc := [:str | | s |
  s := str.
  s size > 2000 ifTrue: [s := (s copyFrom: 1 to: 2000), '...'].
  s := s copyReplaceAll: (String with: $\\) with: '\\\\'.
  s := s copyReplaceAll: tab with: '\\t'.
  s := s copyReplaceAll: (String with: Character lf) with: '\\n'.
  s := s copyReplaceAll: (String with: Character cr) with: '\\r'.
  s].
psOf := [:obj | esc value: ([obj printString] on: Error do: [:e | '<unprintable>'])].
row := [:grp :nm :obj :idx |
  out nextPutAll: grp; nextPutAll: tab;
      nextPutAll: (esc value: nm); nextPutAll: tab;
      nextPutAll: (psOf value: obj); nextPutAll: tab;
      nextPutAll: obj asOop printString; nextPutAll: tab;
      nextPutAll: idx printString; nextPut: Character lf].
[ arr := proc _frameContentsAt: ${serverLevel}.
  receiver := arr at: 10.
  names := arr at: 9.
  row value: 'receiver' value: 'self' value: receiver value: 0.
  [ receiver class allInstVarNames keysAndValuesDo: [:i :nm |
      row value: 'instvars' value: nm asString value: (receiver instVarAt: i) value: i ]
  ] on: Error do: [:e | ].
  names isNil ifFalse: [
    1 to: names size do: [:i | | nm |
      nm := (names at: i) asString.
      (nm startsWith: '__vsc') ifFalse: [
        row value: ((nm startsWith: '.') ifTrue: ['stacktemps'] ifFalse: ['argtemps'])
            value: nm value: (arr at: 10 + i) value: i ] ] ]
] on: Error do: [:e | ].
out contents`;

  try {
    const data = executeAndFetchString(session, code);
    return parseFrameVars(data);
  } catch {
    return [];
  }
}

/**
 * Returns the class name of an object.
 */
export function getObjectClassName(session: ActiveSession, oop: bigint): string {
  try {
    const classOop = gciPerform(session, oop, 'class');
    return gciPerformFetchString(session, classOop, 'name');
  } catch {
    return '<Unknown>';
  }
}

/**
 * Returns true if the OOP is a special (immediate) value — SmallInteger, Character, etc.
 */
export function isSpecialOop(session: ActiveSession, oop: bigint): boolean {
  return session.gci.GciTsOopIsSpecial(oop);
}

/**
 * Returns named instvar names for an object's class.
 */
export function getInstVarNames(session: ActiveSession, oop: bigint): string[] {
  const classOop = gciPerform(session, oop, 'class');
  const namesArrayOop = gciPerform(session, classOop, 'allInstVarNames');
  const { result: sizeRaw } = session.gci.GciTsFetchSize(session.handle, namesArrayOop);
  const size = Number(sizeRaw);
  const names: string[] = [];
  if (size > 0) {
    const { oops } = session.gci.GciTsFetchOops(session.handle, namesArrayOop, 1n, size);
    for (const nameOop of oops) {
      names.push(gciPerformFetchString(session, nameOop, 'asString'));
    }
  }
  return names;
}

/**
 * Fetches OOPs of named instance variables.
 *
 * Uses absolute GciTsFetchOops rather than GciTsFetchNamedOops (which does not
 * exist in GemStone 3.6.2). Named instance variables are the first slots of an
 * object, so the absolute 1-based index of named var N is simply N.
 */
export function getNamedInstVarOops(session: ActiveSession, oop: bigint, count: number): bigint[] {
  if (count <= 0) return [];
  const { oops, err } = session.gci.GciTsFetchOops(session.handle, oop, 1n, count);
  if (err.number !== 0) return [];
  return oops;
}

/**
 * Returns the varying (indexed) size of an object.
 */
export function getIndexedSize(session: ActiveSession, oop: bigint): number {
  const { result, err } = session.gci.GciTsFetchVaryingSize(session.handle, oop);
  if (err.number !== 0) return 0;
  return Number(result);
}

/**
 * Fetches OOPs of varying (indexed) elements. `startIndex` is 1-based within
 * the varying region.
 *
 * Uses absolute GciTsFetchOops rather than GciTsFetchVaryingOops (which does
 * not exist in GemStone 3.6.2). Varying elements follow the named instance
 * variables, so varying element `startIndex` is at absolute index
 * namedSize + startIndex.
 */
export function getIndexedOops(
  session: ActiveSession,
  oop: bigint,
  startIndex: number,
  count: number,
): bigint[] {
  if (count <= 0) return [];
  const { info, err: infoErr } = session.gci.GciTsFetchObjInfo(session.handle, oop, false, 0);
  if (infoErr.number !== 0) return [];
  const { oops, err } = session.gci.GciTsFetchOops(
    session.handle,
    oop,
    BigInt(info.namedSize + startIndex),
    count,
  );
  if (err.number !== 0) return [];
  return oops;
}

/**
 * Returns sorted key-value entries for a SymbolDictionary.
 */
export function getDictionaryEntries(
  session: ActiveSession,
  oop: bigint,
): { key: string; valueOop: bigint }[] {
  const keysOop = gciPerform(session, oop, 'keys');
  const sortedOop = gciPerform(session, keysOop, 'asSortedCollection');
  const keyArrayOop = gciPerform(session, sortedOop, 'asArray');

  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, keyArrayOop);
  if (sizeErr.number !== 0) return [];
  const count = Number(sizeRaw);
  if (count === 0) return [];

  const { oops: keyOops, err: fetchErr } = session.gci.GciTsFetchOops(
    session.handle,
    keyArrayOop,
    1n,
    count,
  );
  if (fetchErr.number !== 0) return [];

  const entries: { key: string; valueOop: bigint }[] = [];
  for (const keyOop of keyOops) {
    const key = gciPerformFetchString(session, keyOop, 'asString');
    const valueOop = gciPerform(session, oop, 'at:', [keyOop]);
    entries.push({ key, valueOop });
  }
  return entries;
}

// ── Stepping ────────────────────────────────────────────

/**
 * Outcome of a step/continue. `completed` means the process ran to completion
 * (not stopped at another step point/error); when it does, `resultOop` is the
 * process's result — for a wrapped doit, the user code's value — which the
 * caller can display (e.g. a halted Display It that the user resumes).
 */
export interface StepResult {
  completed: boolean;
  resultOop?: bigint;
  errorMessage?: string;
  errorContext?: bigint;
  /** GemStone error number when the op stopped on an error (0/undefined otherwise). */
  errorNumber?: number;
}

// ── Interpreted execution for stepping ───────────────────────────────────────
//
// GemStone cannot single-step or set breakpoints in NATIVE code (error 6014):
// a `halt`/error parks execution in native signal machinery that can't be
// stepped while the gem runs native code (GemNativeCodeEnabled, on by default
// where supported). A process must START interpreted to be steppable, so every
// execution that may end up in the debugger passes GCI_PERFORM_FLAG_INTERPRETED
// (see codeExecutor), and the step/continue performs below carry it too so
// resumed execution stays interpreted. This replaces the previous scheme of
// toggling a breakpoint on a benign kernel method (topaz-style), which relied
// on session-global state and on that method existing in every stone version.

const STEP_FLAGS = GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED;

/**
 * Sends a step message (e.g. gciStepOverFromLevel:) to the GsProcess
 * via blocking GciTsPerform. The step message both configures and
 * executes the step — it blocks until the process stops at the next
 * step point, breakpoint, or error.
 */
function performStep(
  session: ActiveSession,
  gsProcess: bigint,
  selector: string,
  args: bigint[],
): StepResult {
  const { result, err } = session.gci.GciTsPerform(
    session.handle,
    gsProcess,
    OOP_ILLEGAL,
    selector,
    args,
    STEP_FLAGS,
    0,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
      errorNumber: err.number,
    };
  }
  // gciStep…FromLevel: returns the completion result when the process finishes.
  return { completed: true, resultOop: result };
}

export function stepOver(session: ActiveSession, gsProcess: bigint, level: number): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepOver from level ${level}`);
  return performStep(session, gsProcess, 'gciStepOverFromLevel:', [levelOop]);
}

export function stepInto(session: ActiveSession, gsProcess: bigint, level: number): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepInto from level ${level}`);
  return performStep(session, gsProcess, 'gciStepIntoFromLevel:', [levelOop]);
}

export function stepOut(session: ActiveSession, gsProcess: bigint, level: number): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepThru from level ${level}`);
  return performStep(session, gsProcess, 'gciStepThruFromLevel:', [levelOop]);
}

// ── Non-blocking step variants ──────────────────────────
//
// Same step messages as performStep, but issued via GciTsNbPerform and polled to
// completion off the main thread (see nbRunner.ts) so a slow step — crawling
// hidden machinery, or stepping a method that loops — never freezes the whole
// extension host, and can be cancelled. Used by the webview debugger; the DAP
// session keeps the simpler blocking variants (intentionally left alone).

/**
 * Issue a step message non-blocking and resolve with its StepResult. A halt /
 * breakpoint / error stopping the process is a normal outcome (completed=false
 * with errorMessage), NOT a thrown error — only an outright GCI failure rejects.
 */
function performStepNb(
  session: ActiveSession,
  gsProcess: bigint,
  selector: string,
  args: bigint[],
  opts: NbRunOptions,
): Promise<StepResult> {
  return runNbCall(
    session,
    () =>
      session.gci.GciTsNbPerform(
        session.handle,
        gsProcess,
        OOP_ILLEGAL,
        selector,
        args,
        STEP_FLAGS,
        0,
      ),
    () => {
      const { result, err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        return {
          completed: false,
          errorMessage: err.message || `GemStone error ${err.number}`,
          errorContext: err.context,
          errorNumber: err.number,
        };
      }
      return { completed: true, resultOop: result };
    },
    opts,
  );
}

export function stepOverNb(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
  opts: NbRunOptions = {},
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepOver (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepOverFromLevel:', [levelOop], {
    title: 'GemStone: stepping over…',
    ...opts,
  });
}

export function stepIntoNb(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
  opts: NbRunOptions = {},
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepInto (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepIntoFromLevel:', [levelOop], {
    title: 'GemStone: stepping into…',
    ...opts,
  });
}

export function stepThruNb(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
  opts: NbRunOptions = {},
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepThru (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepThruFromLevel:', [levelOop], {
    title: 'GemStone: stepping through…',
    ...opts,
  });
}

// ── Continue / Terminate ────────────────────────────────

/**
 * Continues execution of a suspended process. This is blocking in GCI,
 * so we use it synchronously (the caller should handle UI responsiveness).
 *
 * Returns true if execution completed normally, false if it hit another error.
 */
export function continueExecution(session: ActiveSession, gsProcess: bigint): StepResult {
  logInfo(`[Session ${session.id}] Debug: continue`);
  // replaceTopOfStack = OOP_ILLEGAL means "resume as-is, don't touch the top
  // frame's evaluation stack". Per the GciTsContinueWith contract that is also
  // the right value for a normal halt: when the top frame is AbstractException
  // >>signal it auto-replaces TOS with nil (same as AbstractException>>resume).
  //
  // We previously passed OOP_NIL, which *forces* TOS := nil. That happens to be
  // harmless for a halt (top frame is a signal frame), but after an edit-and-
  // continue / restart-frame `trimStackToLevel:` the top frame is a method reset
  // to its FIRST instruction with a fresh, empty evaluation stack — clobbering
  // its TOS with nil corrupts the frame, so continuing it never returns (the gem
  // hangs). OOP_ILLEGAL handles both cases correctly.
  const { result, err } = session.gci.GciTsContinueWith(
    session.handle,
    gsProcess,
    OOP_ILLEGAL,
    null,
    STEP_FLAGS,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
      errorNumber: err.number,
    };
  }
  // On normal completion GciTsContinueWith returns the process's result oop.
  return { completed: true, resultOop: result };
}

/**
 * Clears the stack of a suspended process (aborts it).
 */
export function clearStack(session: ActiveSession, gsProcess: bigint): void {
  logInfo(`[Session ${session.id}] Debug: clearStack`);
  try {
    session.gci.GciTsClearStack(session.handle, gsProcess);
  } catch {
    // Ignore — process may already be gone
  }
}

/**
 * Trims the stack to just below the given level (for restart frame / edit-and-continue).
 */
export function trimStackToLevel(session: ActiveSession, gsProcess: bigint, level: number): void {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: trimStackToLevel ${level}`);
  gciPerform(session, gsProcess, 'trimStackToLevel:', [levelOop]);
}

/**
 * Non-blocking trimStackToLevel: (restart-frame / edit-and-continue). The public
 * `trimStackToLevel:` evaluates unwind/ensure: blocks with an INFINITE timeout,
 * so a hung unwind block would freeze the host on the blocking path — running it
 * non-blocking (and cancellable) avoids that. Flags 0, matching the blocking
 * variant (no debug-stop during the trim's unwind).
 */
export function trimStackToLevelNb(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
  opts: NbRunOptions = {},
): Promise<void> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: trimStackToLevel (nb) ${level}`);
  return runNbCall(
    session,
    () =>
      session.gci.GciTsNbPerform(
        session.handle,
        gsProcess,
        OOP_ILLEGAL,
        'trimStackToLevel:',
        [levelOop],
        0,
        0,
      ),
    () => {
      const { err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        throw new Error(err.message || `GemStone error ${err.number} in trimStackToLevel:`);
      }
    },
    { title: 'GemStone: restarting frame…', ...opts },
  );
}

// ── Evaluate ────────────────────────────────────────────

/**
 * Evaluates an expression in the context of a stack frame and returns the
 * printString of the result.
 *
 * `self` is always bound to the frame's receiver (so instVars and globals
 * resolve too), via `String>>evaluateInContext:`. When the frame has named
 * arguments/temps, they are *also* bound: a transient `SymbolDictionary`
 * mapping each name → its current value is prepended to the user's symbol list
 * so a bare identifier like `amount` resolves to the frame's temp
 * (`evaluateInContext:symbolList:`). The dictionary shadows globals, while
 * globals still resolve through the appended user list.
 *
 * Limitation: temps are bound for *reads* only — assigning to a temp in the
 * eval bar writes the transient dictionary, not the live frame.
 *
 * (The earlier `_framePerform:withArgs:onLevel:` primitive does NOT exist on
 * GemStone 3.7.x — and it performed a *selector*, not an expression, so it
 * raised a NameError trying to intern the source as a Symbol.)
 */
export function evaluateInFrame(
  session: ActiveSession,
  gsProcess: bigint,
  expression: string,
  level: number,
): string {
  return getObjectPrintString(session, evaluateInFrameToOop(session, gsProcess, expression, level));
}

/**
 * Like {@link evaluateInFrame} but returns the result *OOP* rather than its
 * printString. Used by the Variables-pane editor (T1) to evaluate the typed
 * expression in the frame, then write the resulting object back into the frame
 * temp / instVar. A compile or runtime error surfaces as a thrown GCI error
 * (same as the eval bar), so the caller can keep the editor open on failure.
 */
/**
 * Non-blocking sibling of {@link evaluateInFrame}: evaluate `expression` in the
 * frame and resolve with the result's printString, issued via GciTsNbPerform and
 * polled off the main thread. The eval-bar uses this so a long/looping/runaway
 * expression neither freezes the panel nor blocks the host — and can be cancelled
 * (see {@link NbRunOptions.onStart}). The frame setup (receiver, symbol list,
 * expression string) is still blocking, but cheap; only the evaluation itself —
 * the part that can run away — is non-blocking.
 */
export function evaluateInFrameNb(
  session: ActiveSession,
  gsProcess: bigint,
  expression: string,
  level: number,
  opts: NbRunOptions = {},
): Promise<string> {
  const { receiverOop, argAndTempNames, argAndTempOops } = getFrameInfo(session, gsProcess, level);

  const { result: exprOop, err: strErr } = session.gci.GciTsNewString(session.handle, expression);
  if (strErr.number !== 0) {
    return Promise.reject(new Error(strErr.message || 'Cannot create expression string'));
  }

  const symbolListOop = buildFrameSymbolList(session, argAndTempNames, argAndTempOops);
  const selector = symbolListOop === null ? 'evaluateInContext:' : 'evaluateInContext:symbolList:';
  const args = symbolListOop === null ? [receiverOop] : [receiverOop, symbolListOop];

  return runNbCall(
    session,
    () => session.gci.GciTsNbPerform(session.handle, exprOop, OOP_ILLEGAL, selector, args, 0, 0),
    () => {
      const { result, err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
      }
      return getObjectPrintString(session, result);
    },
    opts,
  );
}

export function evaluateInFrameToOop(
  session: ActiveSession,
  gsProcess: bigint,
  expression: string,
  level: number,
): bigint {
  // The frame's receiver becomes `self` for the evaluation.
  const { receiverOop, argAndTempNames, argAndTempOops } = getFrameInfo(session, gsProcess, level);

  const { result: exprOop, err: strErr } = session.gci.GciTsNewString(session.handle, expression);
  if (strErr.number !== 0) {
    throw new Error(strErr.message || 'Cannot create expression string');
  }

  // Bind the frame's named args/temps when present; otherwise keep the lean
  // single-arg path (self + instVars + globals via the session's symbol list).
  const symbolListOop = buildFrameSymbolList(session, argAndTempNames, argAndTempOops);
  return symbolListOop === null
    ? gciPerform(session, exprOop, 'evaluateInContext:', [receiverOop])
    : gciPerform(session, exprOop, 'evaluateInContext:symbolList:', [receiverOop, symbolListOop]);
}

/**
 * Writes `valueOop` into a method argument / temporary of the suspended frame,
 * via the kernel `GsProcess>>_frameAt:tempAt:put:` primitive (the same one GBS
 * and GT use). `offset` is the 1-based index into the frame's `argAndTempNames`
 * (so it matches the index `getFrameInfo` reads). Handles method temps,
 * VariableContext temps, copying-block args, and the eval-stack `.tN` temps.
 */
export function setFrameTemp(
  session: ActiveSession,
  gsProcess: bigint,
  level: number,
  offset: number,
  valueOop: bigint,
): void {
  gciPerform(session, gsProcess, '_frameAt:tempAt:put:', [
    intToOop(session, level),
    intToOop(session, offset),
    valueOop,
  ]);
}

/**
 * Writes `valueOop` into the `index`-th (1-based) named instance variable of
 * `receiverOop`, via `instVarAt:put:`.
 */
export function setInstVar(
  session: ActiveSession,
  receiverOop: bigint,
  index: number,
  valueOop: bigint,
): void {
  gciPerform(session, receiverOop, 'instVarAt:put:', [intToOop(session, index), valueOop]);
}

/** Reads the OOP of the `index`-th (1-based) named instance variable. Used by
 *  variable-revert to capture the original value before it's overwritten. */
export function getInstVarOop(session: ActiveSession, receiverOop: bigint, index: number): bigint {
  return gciPerform(session, receiverOop, 'instVarAt:', [intToOop(session, index)]);
}

/**
 * Pins objects against garbage collection by adding them to the session's export
 * set (`GciTsSaveObjs`). Variable-revert uses this to keep a slot's original
 * value alive after the slot is overwritten — otherwise it could be scavenged
 * and its OOP number reused for a different object, so revert would restore the
 * wrong object. No-op for an empty list; immediates need not be saved.
 */
export function saveObjs(session: ActiveSession, oops: bigint[]): void {
  if (oops.length === 0) return;
  const { success, err } = session.gci.GciTsSaveObjs(session.handle, oops);
  if (!success || err.number !== 0) {
    throw new Error(err.message || 'GciTsSaveObjs failed');
  }
}

/** Releases objects previously pinned with {@link saveObjs} (`GciTsReleaseObjs`).
 *  Targeted release only — never ReleaseAllObjs, since a session may host more
 *  than one debugger panel. No-op for an empty list. */
export function releaseObjs(session: ActiveSession, oops: bigint[]): void {
  if (oops.length === 0) return;
  const { success, err } = session.gci.GciTsReleaseObjs(session.handle, oops);
  if (!success || err.number !== 0) {
    throw new Error(err.message || 'GciTsReleaseObjs failed');
  }
}

/** Resolve a global (e.g. a class name) to its OOP; null if it doesn't resolve. */
function resolveGlobalOop(session: ActiveSession, name: string): bigint | null {
  try {
    return session.gci.resolveSymbol(session.handle, name);
  } catch {
    return null;
  }
}

/**
 * Builds a SymbolList whose first entry is a transient SymbolDictionary mapping
 * each *named* (non-synthetic) arg/temp to its current value, prepended to the
 * user's own symbol list — so bare identifiers like `amount` resolve to the
 * frame's temps while globals still resolve through the appended user list.
 * Returns null when the frame has no bindable named temps (the caller then uses
 * the simpler `evaluateInContext:`), or if any of the required globals can't be
 * resolved (degrade to the self-only eval rather than fail).
 *
 * The synthetic `.tN` eval-stack temporaries have no source name (and `.t1`
 * isn't a legal identifier), so they are skipped.
 */
function buildFrameSymbolList(
  session: ActiveSession,
  names: string[],
  oops: bigint[],
): bigint | null {
  const bindings: { name: string; oop: bigint }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const oop = oops[i];
    if (!name || name.startsWith('.') || oop === undefined) continue;
    bindings.push({ name, oop });
  }
  if (bindings.length === 0) return null;

  const symDictClass = resolveGlobalOop(session, 'SymbolDictionary');
  const symListClass = resolveGlobalOop(session, 'SymbolList');
  const systemClass = resolveGlobalOop(session, 'System');
  if (symDictClass === null || symListClass === null || systemClass === null) return null;

  const dictOop = gciPerform(session, symDictClass, 'new');
  for (const { name, oop } of bindings) {
    const { result: symOop, err } = session.gci.GciTsNewSymbol(session.handle, name);
    if (err.number !== 0) continue; // skip un-internable names defensively
    gciPerform(session, dictOop, 'at:put:', [symOop, oop]);
  }

  // (SymbolList with: dict) , (System myUserProfile symbolList)
  const profileOop = gciPerform(session, systemClass, 'myUserProfile');
  const userListOop = gciPerform(session, profileOop, 'symbolList');
  const frontOop = gciPerform(session, symListClass, 'with:', [dictOop]);
  return gciPerform(session, frontOop, ',', [userListOop]);
}
