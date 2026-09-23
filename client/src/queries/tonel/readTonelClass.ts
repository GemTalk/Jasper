// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf` — NOT
//   `extent0.rowan.dbf`, which installs the older Rowan.)
//
// Full statement, and the reasoning: ./tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// Parse Tonel text into a description of the class it defines. The FIRST half of
// file in: this reads, it changes nothing. Applying the result is a separate
// step, so a file that cannot be parsed cannot half-modify the image.
//
// We write no parser. Rowan's is the reference implementation — the same code
// that reads the base image's own source tree.
//
// Why the parser is driven directly instead of through readClassFile:
// --------------------------------------------------------------------
// Rowan's public entry point, `RwRepositoryResolvedProjectTonelReaderVisitorV2
// class >> readClassFile:`, takes a PATH and does `file asFileReference
// readStreamDo:`. Our Tonel text is on the USER'S machine, not the gem's host —
// the two are not the same filesystem for a remote stone — so that route would
// mean writing a temp file somewhere the gem can write, and cleaning it up.
//
// Instead we assemble the visitor the way `readClassFiles:projectName:packageName:`
// assembles it (a throwaway resolved project, one package, `_packageConvention:`)
// and hand `RwTonelParser` a `ReadStream` on the text. Verified against a live
// rowan3 stone: no filesystem, and none of the `validateClassCategory:` trouble
// that the file path route runs into, because that validation lives in
// `readClassFile:inPackage:` rather than in the parser.
//
// The throwaway project name is deliberately unlovely. It exists for the length
// of one doit and is never loaded, but it would be visible if anything ever
// listed it, so it says what it is.
import { QueryExecutor } from '../types';
import { escapeString } from '../util';
import {
  ROWAN_LOOKUP_PRELUDE,
  rowanLookupExpr,
  TONEL_ERROR_PREFIX,
  TONEL_NO_ROWAN,
} from './rowanLookup';
import { decodeTonelClass, TonelClass } from './tonelWire';

/** What the parse produced, or why it did not. */
export type TonelReadResult =
  | { ok: true; tonelClass: TonelClass }
  | {
      ok: false;
      error: string;
      /**
       * 1-based line the parse stopped on, as an editor shows it.
       *
       * A parse failure with no line is nearly useless on a 500-line class file —
       * the developer is told it is broken and left to find where. Rowan's own
       * reader enriches its errors the same way; it reads the file back to count
       * lines, and since we parse from a string we count them here instead.
       * Falls back to 1 when the stone reports no position.
       */
      line: number;
    };

/**
 * The largest Tonel file this reader will send to the stone.
 *
 * The whole file becomes one Smalltalk string literal inside one doit, so the gem
 * holds the text, the parse tree and the resulting definitions in TEMPORARY OBJECT
 * MEMORY at once. Measured on a 3.7.5 rowan3 stone with the stock gem
 * configuration, feeding synthetic Tonel files of increasing size:
 *
 *     2.6 MB  parsed fine (10,000 methods, 327 ms)
 *     5.2 MB  "VM temporary object memory is full" — and the gem DIED, taking the
 *             session with it (GciTsLogout failed, socket EOF)
 *
 * That failure mode is why this is a guard and not a documented caveat: past the
 * ceiling the user does not get an error against their file, they lose their
 * session and whatever uncommitted work was in it.
 *
 * 2 MB sits under the proven-good measurement and an order of magnitude above
 * anything real: the largest class in the 3.7.5 base image is `Object`, which
 * files out at 218 KB — and this feature's file-out is class-complete, so it is
 * already larger than the shipped `Object.class.st`. A file above this limit is
 * far more likely to be a mistake than a class.
 */
export const MAX_TONEL_CHARACTERS = 2 * 1024 * 1024;

/**
 * Parse one Tonel class file's text.
 *
 * Never throws: every caller is a menu command, and a parse failure is a thing
 * to report against the file, not an exception to surface as a broken command.
 */
export function readTonelClass(execute: QueryExecutor, tonelText: string): TonelReadResult {
  // Checked before the doit is built, not after: the point is to never send it.
  if (tonelText.length > MAX_TONEL_CHARACTERS) {
    return {
      ok: false,
      error:
        `This file is ${Math.round(tonelText.length / 1024)} KB, over the ` +
        `${MAX_TONEL_CHARACTERS / 1024} KB limit for filing in one Tonel class. ` +
        `Filing it in would exhaust the gem's temporary object memory and end the ` +
        `session. The largest class in the base image files out at about 218 KB.`,
      line: 1,
    };
  }

  const code = `| rwLookup parserCls projectCls visitorCls proj pkg visitor defs clsDef ws emit names slots strm |
${ROWAN_LOOKUP_PRELUDE}
parserCls := ${rowanLookupExpr('RwTonelParser')}.
projectCls := ${rowanLookupExpr('RwResolvedProjectV2')}.
visitorCls := ${rowanLookupExpr('RwRepositoryResolvedProjectTonelReaderVisitorV2')}.
(parserCls isNil or: [projectCls isNil or: [visitorCls isNil]])
  ifTrue: [^'${TONEL_NO_ROWAN}'].
[
  proj := projectCls new
    projectName: '__jasper_tonel_read__';
    packageConvention: 'Rowan';
    gemstoneSetDefaultSymbolDictNameTo: 'Globals';
    yourself.
  proj addLoadComponentNamed: 'Core' comment: 'throwaway; never loaded'.
  pkg := proj addPackageNamed: '__jasper_tonel_read_package__' toComponentNamed: 'Core'.
  visitor := visitorCls new
    currentProjectDefinition: proj;
    currentPackageDefinition: pkg;
    _packageConvention: 'Rowan';
    yourself.
  strm := ReadStream on: '${escapeString(tonelText)}'.
  defs := parserCls on: strm filePath: 'jasper-file-in' forReader: visitor.
  defs := defs start.
  clsDef := defs at: 1.
  clsDef isNil ifTrue: [^'${TONEL_ERROR_PREFIX}No class definition in this file'].

  "Every value length-prefixed: method source contains newlines, tabs, quotes and
   brackets, so no delimiter can be relied on. See tonelWire.ts."
  ws := WriteStream on: String new.
  emit := [:kind :payload | | text |
    text := payload ifNil: [''].
    ws nextPutAll: kind; tab; nextPutAll: text size printString; lf;
       nextPutAll: text; lf].
  names := [:coll |
    coll isNil
      ifTrue: ['']
      ifFalse: [ | s |
        s := WriteStream on: String new.
        coll do: [:n | s nextPutAll: n asString] separatedBy: [s nextPut: $ ].
        s contents]].

  "instvars, classvars, classinstvars and pools are the four definition accessors
   that read their property with a bare at:, so a definition that is missing the
   key raises KeyNotFound instead of answering empty. Every Rowan constructor sets
   all four, so this guards a definition built some other way rather than a path we
   expect; classType and gs_options need no guard because they read with
   at:ifAbsent: and already answer 'normal' and #()."
  slots := [:accessor | names value: ([accessor value] on: Error do: [:e | #()])].

  emit value: 'NAME' value: clsDef name asString.
  emit value: 'SUPER' value: (clsDef superclassName ifNil: ['nil']) asString.
  "asString is load bearing: the Tonel reader stores #type with asSymbol, so this
   answers #normal rather than 'normal', and CREATION_SELECTOR is keyed on strings."
  emit value: 'TYPE' value: clsDef classType asString.
  emit value: 'CATEGORY' value: (clsDef category ifNil: ['']) asString.
  emit value: 'COMMENT' value: (clsDef comment ifNil: ['']) asString.
  emit value: 'IVARS' value: (slots value: [clsDef instVarNames]).
  emit value: 'CVARS' value: (slots value: [clsDef classVarNames]).
  emit value: 'CIVARS' value: (slots value: [clsDef classInstVarNames]).
  emit value: 'POOLS' value: (slots value: [clsDef poolDictionaryNames]).

  "GemStone class options (#gs_options): dbTransient and friends. They change what
   the class IS, so they are carried through to file in rather than dropped."
  emit value: 'OPTIONS' value: (names value: clsDef gs_options).

  "Header properties we understand but do not apply -- reported so the loss is
   stated rather than silent. See UNCARRIED_PROPERTIES in tonelWire.ts.
   Read from the property dictionary because that is the only place presence (as
   opposed to an accessor answering nil) can be told apart."
  emit value: 'UNCARRIED' value: ([ | props s |
    props := clsDef properties.
    s := WriteStream on: String new.
    #('gs_reservedoop' 'gs_constraints' 'gs_foreignKeys') do: [:k | | v |
      v := props at: k asSymbol ifAbsent: [nil].
      (v isNil or: [v isEmpty]) ifFalse: [
        s isEmpty ifFalse: [s nextPut: $ ].
        s nextPutAll: k]].
    s contents ] on: Error do: [:e | '']).

  "The parser answers methods ALONGSIDE the class definition, not attached to it:
   (defs at: 2) at: 1 is the class side, at: 2 the instance side. Rowan own
   readClassFile:inPackage: attaches them to the definition in a separate step,
   so reading clsDef method dictionaries here finds nothing."
  ((defs at: 2) at: 2) do: [:md |
    emit value: 'IMETHOD'
      value: md selector asString , (String with: Character lf)
        , (md protocol ifNil: ['as yet unclassified']) asString , (String with: Character lf)
        , md source asString].
  ((defs at: 2) at: 1) do: [:md |
    emit value: 'CMETHOD'
      value: md selector asString , (String with: Character lf)
        , (md protocol ifNil: ['as yet unclassified']) asString , (String with: Character lf)
        , md source asString].
  ws contents ]
  "Answer where the parser stopped alongside the message: only the stone knows how
   far it got, and the client turns the offset into a line number."
  on: Error do: [:e |
    ^'${TONEL_ERROR_PREFIX}'
      , (strm ifNil: [''] ifNotNil: [:s | s position printString])
      , (String with: Character tab)
      , e messageText]`;

  const answer = execute(code);
  if (answer === TONEL_NO_ROWAN) {
    return { ok: false, error: 'Rowan is not reachable from this session', line: 1 };
  }
  if (answer.startsWith(TONEL_ERROR_PREFIX)) {
    const [offset, ...rest] = answer.slice(TONEL_ERROR_PREFIX.length).split('\t');
    return { ok: false, error: rest.join('\t'), line: lineAt(tonelText, offset) };
  }
  try {
    return { ok: true, tonelClass: decodeTonelClass(answer) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), line: 1 };
  }
}

/**
 * The 1-based line containing `offset` characters into `text`.
 *
 * The offset is where the parser STOPPED, which is at or just past the problem —
 * the same approximation Rowan's own reader makes. Better than no line at all,
 * which is what the developer got before.
 */
function lineAt(text: string, offset: string): number {
  const at = Number(offset);
  if (!Number.isInteger(at) || at < 0) return 1;
  let line = 1;
  for (let i = 0; i < Math.min(at, text.length); i++) if (text[i] === '\n') line += 1;
  return line;
}
