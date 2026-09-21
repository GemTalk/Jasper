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
import * as path from 'path';
import { fileInChannel, FileInNote } from './fileIn';
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
 * Deliberately a closed set. An unrecognised type is an error, not a fall back to
 * `subclass:` — silently creating a normal class for a type we do not understand
 * produces a class of the wrong shape that looks like it filed in cleanly.
 */
const CREATION_SELECTOR: Record<string, string> = {
  normal: 'subclass:',
  variable: 'indexableSubclass:',
  bytes: 'byteSubclass:',
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `#('a' 'b')` — a Smalltalk literal array of strings. */
const stringArray = (names: string[]): string =>
  `#(${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(' ')})`;

/** `#(Foo Bar)` — pool dictionaries are named, not quoted. */
const symbolArray = (names: string[]): string => `#(${names.join(' ')})`;

/** The class-definition expression for this description. */
function definitionSource(tonelClass: TonelClass, dictionary: string): string {
  const creation = CREATION_SELECTOR[tonelClass.type];
  return (
    `${tonelClass.superclass} ${creation} '${tonelClass.name}' ` +
    `instVarNames: ${stringArray(tonelClass.instVars)} ` +
    `classVars: ${stringArray(tonelClass.classVars)} ` +
    `classInstVars: ${stringArray(tonelClass.classInstVars)} ` +
    `poolDictionaries: ${symbolArray(tonelClass.pools)} ` +
    `inDictionary: ${dictionary}`
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
  const existing = queries.dictionariesContainingClass(session, tonelClass.name);
  if (existing.length > 0 && !queries.canClassBeWritten(session, tonelClass.name)) {
    return fail(`${tonelClass.name} cannot be written (read-only repository segment)`);
  }

  try {
    queries.compileClassDefinition(session, definitionSource(tonelClass, dictionary));
  } catch (e) {
    return fail(`Could not define ${tonelClass.name}: ${message(e)}`);
  }

  // The comment is part of the class, and part of the replace: a file carrying no
  // comment means the class has none, not "leave whatever was there". Reported but
  // not fatal — a missing comment is not worth losing the methods over.
  try {
    queries.setClassComment(session, tonelClass.name, tonelClass.comment);
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
      queries.removeAllMethods(session, tonelClass.name, isMeta);
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
 * File one Tonel `.st` file into the image.
 *
 * Reads and parses BEFORE writing anything, so a file that cannot be read cannot
 * half-modify a class.
 *
 * Every failure goes to the shared **GemStone File In** output channel — the same
 * one chunk file in uses, so a developer has one place to look whichever format
 * the file was in — and the toast names the first failure with a button that
 * reveals the log. A toast alone is not enough: it disappears, and the errors a
 * file in produces are exactly the ones worth re-reading.
 */
export async function fileInTonelFile(
  session: ActiveSession,
  filePath: string,
): Promise<TonelApplyOutcome | undefined> {
  if (!requireTonelAvailable(session)) return undefined;

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return reportTonelFileIn(filePath, {
      className: path.basename(filePath),
      dictionary: '',
      compiled: 0,
      errors: [{ file: filePath, line: 1, message: `Could not read: ${message(e)}` }],
    });
  }

  const read = readTonelClass((code) => queries.executeFetchString(session, code), text);
  if (!read.ok) {
    return reportTonelFileIn(filePath, {
      className: path.basename(filePath),
      dictionary: '',
      compiled: 0,
      errors: [{ file: filePath, line: 1, message: read.error }],
    });
  }

  const dictionary = await chooseTonelDictionary(session, read.tonelClass.name);
  // Dismissing the prompt files nothing in — and is not a failure worth logging.
  if (dictionary === undefined) return undefined;

  return reportTonelFileIn(filePath, applyTonelClass(session, read.tonelClass, dictionary));
}

/** Write the outcome to the shared log, then summarise it. */
function reportTonelFileIn(filePath: string, outcome: TonelApplyOutcome): TonelApplyOutcome {
  const log = fileInChannel();
  if (log) {
    log.appendLine(`Tonel File In: ${filePath}`);
    log.appendLine(
      `  ${outcome.className}${outcome.dictionary ? ` into ${outcome.dictionary}` : ''}, ` +
        `${outcome.compiled} method(s) compiled`,
    );
    for (const note of outcome.errors) {
      log.appendLine(`  ERROR ${note.file}:${note.line} — ${note.message}`);
    }
    log.appendLine('');
  }

  const SHOW_LOG = 'Show Log';
  const summary =
    `${outcome.className}${outcome.dictionary ? ` into ${outcome.dictionary}` : ''}, ` +
    `${outcome.compiled} method(s)`;

  if (outcome.errors.length > 0) {
    void vscode.window
      .showErrorMessage(
        `Tonel file in finished with ${outcome.errors.length} error(s) — ${summary}. ` +
          `First: ${outcome.errors[0].message}`,
        SHOW_LOG,
      )
      .then((choice) => {
        if (choice === SHOW_LOG) fileInChannel()?.show(true);
      });
    return outcome;
  }

  // Said every time, as the chunk path does: a file in that is not committed
  // disappears at the next abort, and Jasper never commits on the user's behalf.
  void vscode.window.showInformationMessage(
    `Filed in ${summary}. Not committed — commit the session to keep it.`,
  );
  return outcome;
}
