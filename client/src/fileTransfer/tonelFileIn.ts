// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf`.)
//
// Full statement, and the reasoning: ../queries/tonel/tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// Writing a parsed Tonel class into the image — the second half of file in, and
// the only part of this feature that MODIFIES anything.
//
// Parsing happens first and separately (`queries/tonel/readTonelClass.ts`), so a
// file that cannot be read cannot half-modify a class.
//
// REPLACE, not merge
// -------------------
// A file-in is an explicit instruction from the developer: the file is the
// intended state of the class, so a method the image has that the file does not
// carry is REMOVED. That is `removeAllMethods` on both sides, which exists for
// exactly this — its own comment says a file-out emits it "so that filing it in
// REPLACES the class's behaviour instead of merging into whatever was already
// there". Chunk file-in has always worked this way; Tonel matches it.
//
// Order matters and is not obvious: DEFINE, then CLEAR, then COMPILE. If the
// file's shape differs from the image's, defining creates a new class version,
// and a clear issued beforehand would empty the OLD version while the new one
// kept nothing anyway. Defining first means the clear always lands on the version
// the file describes.
//
// Refusing to do half a job
// --------------------------
// Each guard below exists so a failure leaves the image alone rather than
// partly-written: an unresolvable superclass creates nothing, a read-only class
// removes nothing, and a class definition that fails compiles no methods. The one
// deliberate exception is a single method that will not compile — that does not
// cost the other twenty, because a developer fixing one bad method wants the rest
// in.
//
// Nothing here commits. The session is left dirty and the developer decides,
// exactly as compiling a method from the Explorer does.
import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import * as fs from 'fs';
import { FileInNote, FileInOutcome } from './fileIn';
import { readTonelClass } from '../queries/tonel/readTonelClass';
import { requireTonelAvailable } from '../tonelAvailability';
import type { TonelClass } from '../queries/tonel/tonelWire';

/** What applying one Tonel class did. */
export interface TonelApplyOutcome {
  className: string;
  /** The symbol dictionary written to. */
  dictionary: string;
  /** Methods compiled. */
  compiled: number;
  /** Everything that went wrong, in the order it was found. */
  errors: FileInNote[];
}

/**
 * Rowan's class type → the GemStone creation selector.
 *
 * The keys are the strings Rowan's parser actually answers from `clsDef classType`,
 * measured on a 3.7.5 rowan3 stone by parsing a filed-out class of each shape — NOT
 * the GemStone selector names, which they resemble but do not match. `byteSubclass`
 * is the one that reads like a mistake and is correct: a byte class's Tonel header
 * says `#type : 'byteSubclass'`, so keying this map on `bytes` made every byte class
 * fail file-in with "Unsupported class type 'byteSubclass'".
 *
 * A class with no `#type` key is `normal`; the reader defaults it (readTonelClass.ts).
 *
 * `immediate` is deliberately absent. It is a real type — 29 classes in the shipped
 * 3.7.5 corpus carry it — but GemStone exposes no `immediateSubclass:` creation
 * selector (verified: `Object class canUnderstand:` answers false), so there is no
 * way to honour it. Refusing names it; guessing `subclass:` would silently build a
 * non-immediate class of the same name.
 *
 * Deliberately a closed set. An unrecognised type is an error, not a fall back to
 * `subclass:` — silently creating a normal class for a type we do not understand
 * produces a class of the wrong shape that looks like it filed in cleanly.
 */
const CREATION_SELECTOR: Record<string, string> = {
  normal: 'subclass:',
  variable: 'indexableSubclass:',
  byteSubclass: 'byteSubclass:',
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `#('a' 'b')` — a Smalltalk literal array of strings. */
const stringArray = (names: string[]): string =>
  `#(${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(' ')})`;

/**
 * `#(Foo Bar)` — pool dictionaries and class options are named, not quoted.
 *
 * Both come from a file on disk, so the names are checked rather than trusted: a
 * Smalltalk identifier only, or the doit built around it changes shape. An invalid
 * name is dropped here and refused by {@link checkedSymbols} before it is used.
 */
const symbolArray = (names: string[]): string => `#(${names.join(' ')})`;

/** A Smalltalk identifier — what a pool-dictionary or class-option name may be. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The names in `values` that are not usable as Smalltalk identifiers. */
const invalidSymbols = (values: string[]): string[] => values.filter((v) => !IDENTIFIER.test(v));

/**
 * The class-definition expression for this description.
 *
 * `byteSubclass:` takes NO `instVarNames:` — a byte class has no named instance
 * variables, and GemStone ships no such variant (verified on a 3.7.5 rowan3 stone:
 * `byteSubclass:instVarNames:…` is not understood, `byteSubclass:classVars:…` is).
 * Emitting the keyword anyway made every byte class fail to define, on top of the
 * type-key bug above.
 *
 * `options:` is appended only when the file carries `#gs_options`, because the
 * 6-keyword forms are the ones used everywhere else and the `options:` variants
 * take an extra argument we would otherwise be inventing.
 */
function definitionSource(tonelClass: TonelClass, dictionary: string): string {
  const creation = CREATION_SELECTOR[tonelClass.type];
  const instVars =
    creation === 'byteSubclass:' ? '' : `instVarNames: ${stringArray(tonelClass.instVars)} `;
  const options =
    tonelClass.options.length > 0 ? ` options: ${symbolArray(tonelClass.options)}` : '';
  return (
    `${tonelClass.superclass} ${creation} '${tonelClass.name.replace(/'/g, "''")}' ` +
    instVars +
    `classVars: ${stringArray(tonelClass.classVars)} ` +
    `classInstVars: ${stringArray(tonelClass.classInstVars)} ` +
    `poolDictionaries: ${symbolArray(tonelClass.pools)} ` +
    `inDictionary: ${dictionary}` +
    options
  );
}

/**
 * Write `tonelClass` into `dictionary`, replacing whatever is there.
 *
 * Never throws: every caller is a menu command, so a failure is something to
 * report against the file.
 */
export function applyTonelClass(
  session: ActiveSession,
  tonelClass: TonelClass,
  dictionary: string,
): TonelApplyOutcome {
  const outcome: TonelApplyOutcome = {
    className: tonelClass.name,
    dictionary,
    compiled: 0,
    errors: [],
  };
  const fail = (text: string): TonelApplyOutcome => {
    outcome.errors.push({ file: tonelClass.name, line: 1, message: text });
    return outcome;
  };

  if (CREATION_SELECTOR[tonelClass.type] === undefined) {
    return fail(`Unsupported class type '${tonelClass.type}' for ${tonelClass.name}`);
  }

  // Pool and option names are spliced into the definition doit unquoted, so they
  // must be identifiers. They come from a file on disk; refusing a name that is not
  // one is what keeps a malformed file from changing the shape of the generated
  // Smalltalk rather than just failing to compile.
  const badNames = invalidSymbols([...tonelClass.pools, ...tonelClass.options]);
  if (badNames.length > 0) {
    return fail(`${tonelClass.name}: not usable as a name: ${badNames.join(', ')}`);
  }

  // A root class legitimately has no superclass; anything else must resolve, or
  // the class would be silently rooted at Object.
  if (tonelClass.superclass !== 'nil') {
    const holders = queries.dictionariesContainingClass(session, tonelClass.superclass);
    if (holders.length === 0) {
      return fail(
        `Superclass ${tonelClass.superclass} is not in this session's symbol list — ` +
          `${tonelClass.name} was not created`,
      );
    }
  }

  // Only ask of a class that already exists: `canBeWritten` answers false for a
  // class that is not there yet, which would refuse every new class.
  //
  // Both questions are asked of the CHOSEN dictionary, not of the bare name. A
  // read-only `Foo` in another dictionary is not the class being written, and
  // refusing because of it blocks filing a new `Foo` into a dictionary the user
  // can perfectly well write.
  const existing = queries.dictionariesContainingClass(session, tonelClass.name);
  if (
    existing.includes(dictionary) &&
    !queries.canClassBeWritten(session, tonelClass.name, dictionary)
  ) {
    return fail(
      `${tonelClass.name} cannot be written in ${dictionary} (read-only repository segment)`,
    );
  }

  try {
    queries.compileClassDefinition(session, definitionSource(tonelClass, dictionary));
  } catch (e) {
    return fail(`Could not define ${tonelClass.name}: ${message(e)}`);
  }

  // Tonel's #category is not carried by any creation selector — GemStone ships no
  // `…inDictionary:category:` form (verified on a 3.7.5 rowan3 stone) — so it is
  // applied separately, exactly as the class-definition save path does. Without
  // this a filed-out class comes back with no category and moves in the Explorer's
  // Categories pane.
  //
  // For a Rowan-loaded class #category is the package name, which is also what
  // `Class>>category` already answers for it, so the round trip is a fixpoint. For
  // an unloaded class Rowan writes no category and the file-out falls back to the
  // dictionary name, so filing in sets the category to that name.
  if (tonelClass.category.length > 0) {
    try {
      queries.recategorizeClass(session, tonelClass.name, tonelClass.category, dictionary);
    } catch (e) {
      outcome.errors.push({
        file: tonelClass.name,
        line: 1,
        message: `Could not set the class category: ${message(e)}`,
      });
    }
  }

  // Properties the file carries that this reader does not apply. Reported so the
  // loss is stated rather than silent — see UNCARRIED_PROPERTIES in tonelWire.ts.
  if (tonelClass.uncarried.length > 0) {
    outcome.errors.push({
      file: tonelClass.name,
      line: 1,
      message:
        `${tonelClass.name}: ${tonelClass.uncarried.join(', ')} ` +
        `${tonelClass.uncarried.length === 1 ? 'is' : 'are'} in the file but not applied on file in`,
    });
  }

  // The comment is part of the class, and part of the replace: a file carrying no
  // comment means the class has none, not "leave whatever was there". Reported but
  // not fatal — a missing comment is not worth losing the methods over.
  try {
    queries.setClassComment(session, tonelClass.name, tonelClass.comment, dictionary);
  } catch (e) {
    outcome.errors.push({
      file: tonelClass.name,
      line: 1,
      message: `Could not set the class comment: ${message(e)}`,
    });
  }

  // The replace. After defining, so it lands on the version the file describes.
  for (const isMeta of [false, true]) {
    try {
      queries.removeAllMethods(session, tonelClass.name, isMeta, dictionary);
    } catch (e) {
      outcome.errors.push({
        file: tonelClass.name,
        line: 1,
        message: `Could not clear ${isMeta ? 'class-side' : 'instance-side'} methods: ${message(e)}`,
      });
    }
  }

  for (const method of tonelClass.methods) {
    try {
      queries.compileMethod(
        session,
        tonelClass.name,
        method.isMeta,
        method.category,
        method.source,
        0,
        dictionary,
      );
      outcome.compiled += 1;
    } catch (e) {
      outcome.errors.push({
        file: tonelClass.name,
        line: 1,
        message:
          `${tonelClass.name}${method.isMeta ? ' class' : ''} >> ${method.selector}: ` + message(e),
      });
    }
  }

  return outcome;
}

/**
 * Which symbol dictionary to file this class into.
 *
 * Tonel carries no dictionary — its `#category` is a PACKAGE, not a
 * SymbolDictionary — so the target has to come from the image or from the user.
 *
 *   * already in exactly one dictionary → use it, no prompt. This is what makes
 *     filing a class back where it came from a one-click operation.
 *   * in several → ASK. A shadowed name resolved by guess would silently write to
 *     whichever dictionary happens to come first in the symbol list.
 *   * nowhere yet (a new class) → ask, offering every dictionary.
 *
 * Answers undefined when the user dismisses the prompt, which must file nothing in
 * rather than fall back to a default.
 */
export async function chooseTonelDictionary(
  session: ActiveSession,
  className: string,
): Promise<string | undefined> {
  const existing = queries.dictionariesContainingClass(session, className);
  if (existing.length === 1) return existing[0];

  const choices = existing.length > 1 ? existing : queries.getDictionaryNames(session);
  return vscode.window.showQuickPick(choices, {
    title: `File in ${className}`,
    placeHolder:
      existing.length > 1
        ? `${className} is in ${existing.length} dictionaries — choose one`
        : `Choose the symbol dictionary for ${className}`,
  });
}

/**
 * File one Tonel `.st` file in, answering the SAME outcome shape the chunk path
 * uses so a mixed selection reports once.
 *
 * Reads and parses before writing anything, so a file that cannot be read cannot
 * half-modify a class. Reports nothing itself — `fileIn.ts` owns the toast and the
 * log, which is what keeps one place to look whichever format the file was in.
 */
export async function fileInTonelUri(
  session: ActiveSession,
  filePath: string,
): Promise<FileInOutcome> {
  const outcome = emptyTonelOutcome();
  outcome.files = 1;

  if (!requireTonelAvailable(session)) {
    // The guard has already explained itself; record it so the log agrees.
    outcome.errors.push({
      file: filePath,
      line: 1,
      message: 'Tonel file in needs GemStone 3.7.5 or later on a rowan3 extent',
    });
    return outcome;
  }

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    outcome.errors.push({ file: filePath, line: 1, message: `Could not read: ${message(e)}` });
    return outcome;
  }

  const read = readTonelClass((code) => queries.executeFetchString(session, code), text);
  if (!read.ok) {
    // read.line is where the parser stopped, so the log points at the real problem.
    outcome.errors.push({ file: filePath, line: read.line, message: read.error });
    return outcome;
  }

  const dictionary = await chooseTonelDictionary(session, read.tonelClass.name);
  if (dictionary === undefined) {
    // Dismissing the prompt is not a failure, but it is not nothing either: with
    // several files picked it is the only way to stop, and a user who dismisses one
    // prompt should not have to dismiss the rest one at a time. Recorded so the log
    // says which file was not filed in, and why.
    outcome.cancelled = true;
    outcome.skipped.push({
      file: filePath,
      line: 1,
      message: `No dictionary chosen for ${read.tonelClass.name} — not filed in`,
    });
    return outcome;
  }

  const applied = applyTonelClass(session, read.tonelClass, dictionary);
  outcome.compiled = applied.compiled;
  outcome.errors.push(
    ...applied.errors.map((e) => ({
      ...e,
      file: e.file === applied.className ? filePath : e.file,
    })),
  );
  return outcome;
}

/** A FileInOutcome with the chunk-only counters left at zero. */
function emptyTonelOutcome(): FileInOutcome {
  return {
    executed: 0,
    compiled: 0,
    removed: 0,
    files: 0,
    ignored: [],
    askedToCommit: false,
    skipped: [],
    errors: [],
    stopped: false,
    cancelled: false,
  };
}
