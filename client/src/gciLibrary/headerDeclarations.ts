import * as fs from 'fs';
import * as path from 'path';
import { compareGemStoneVersions } from '../gemStoneVersion.js';

/**
 * Parses `gcits.hf` from the vendored GCI headers to determine, per vendored
 * revision, which `GciTs*`/`Gci*` entry points are declared and whether each
 * sits inside `#if defined(FLG_UNIX)`.
 *
 * This reads `vendor/`, which `.vscodeignore:37` excludes from the packaged
 * `.vsix` — it has no production caller by design. Importing it from shipped
 * code would break packaging.
 */

export interface DeclaredFunction {
  unixOnly: boolean;
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const headersRoot = path.join(repoRoot, 'vendor', 'gci-headers');

/**
 * The vendored revision directories, oldest first. `root` is a seam for tests,
 * which point it at a fixture tree rather than faking `fs`; production has
 * exactly one headers root.
 */
export function vendoredRevisions(root: string = headersRoot): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareGemStoneVersions);
}

/**
 * Strips C block and line comments, preserving line breaks so line numbers stay
 * stable. One pass over every form, so whichever opens first wins: a `//` inside
 * a block comment stays commentary, and a `/*` inside a line comment does not
 * open a block. A commented-out declaration must not be read as a live one.
 *
 * String and character literals are matched by the same pass and returned
 * untouched, so a comment marker inside one (`#define PATTERN "/*"`) cannot open
 * a comment that swallows the declarations after it. That failure would be
 * invisible to the occurrence-count check below, which counts the *stripped*
 * source — it catches declarations the capture loop misses, not text this
 * function wrongly removed. Both literal forms stop at a newline, so an
 * unterminated quote costs one line rather than the rest of the file.
 */
const COMMENT_OR_LITERAL_RE =
  /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function stripComments(source: string): string {
  return source.replace(COMMENT_OR_LITERAL_RE, (match) =>
    match.startsWith('"') || match.startsWith("'") ? match : match.replace(/[^\n]/g, ''),
  );
}

const DECLARATION_MACRO = 'EXTERN_GCI_DEC';
const DECLARATION_RE = new RegExp(
  String.raw`${DECLARATION_MACRO}\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(`,
);
const DECLARATION_OCCURRENCE_RE = new RegExp(DECLARATION_MACRO, 'g');

/**
 * Every conditional directive, not just `#if` — `#ifdef`/`#ifndef` open a frame
 * that a later `#endif` closes, so missing them desynchronizes the stack and
 * lets an inner `#endif` pop an enclosing `FLG_UNIX` frame early. Longest
 * alternative first within each pair, so `#ifdef` isn't read as `#if` followed
 * by junk and `#elif` isn't read as `#else`.
 */
const DIRECTIVE_RE = /^#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/;

interface Directive {
  keyword: string;
  condition: string;
}

function directiveOn(line: string): Directive | undefined {
  const match = DIRECTIVE_RE.exec(line);
  return match ? { keyword: match[1], condition: match[2] } : undefined;
}

/**
 * `#if defined(FOO) && \` continues its condition onto the next physical
 * line(s). `directiveOn` only ever sees one line, so a condition split this
 * way must be joined before classification — otherwise a platform flag
 * mentioned only on a continuation line is invisible to it and the frame
 * falls through as fully unconstrained, the same silent-wrong-default the
 * unclassifiable machinery below exists to prevent.
 */
function withContinuations(condition: string, lines: string[], index: number): string {
  let joined = condition;
  let i = index;
  while (/\\\s*$/.test(joined) && i + 1 < lines.length) {
    i++;
    joined = joined.replace(/\\\s*$/, ' ') + lines[i];
  }
  return joined;
}

/**
 * A condition is read as UNIX-only only when `FLG_UNIX` is the *whole* of it.
 * Substring matching would classify `#if defined(FLG_UNIX) || defined(FLG_MSWIN32)`
 * as UNIX-only, and would read the `#else` of `#if A && !defined(FLG_UNIX)` as the
 * UNIX branch — both wrong, and both wrong silently. Anything else that mentions
 * `FLG_UNIX` is a shape we have not taught the parser: it is unclassifiable.
 */
const UNIX_TEST = String.raw`(?:defined\s*\(\s*FLG_UNIX\s*\)|defined\s+FLG_UNIX|FLG_UNIX)`;
const UNIX_CONDITION_RE = new RegExp(String.raw`^\s*${UNIX_TEST}\s*$`);
const NEGATED_UNIX_CONDITION_RE = new RegExp(String.raw`^\s*!\s*${UNIX_TEST}\s*$`);
/**
 * The vendor's naming convention for every platform/build flag it defines
 * (`FLG_UNIX`, `FLG_MSWIN32`, `FLG_LINUX_UNIX`, `FLG_DEBUG`, ... — see the
 * full vendored tree, not just `gcits.hf`). Matching the convention rather
 * than an enumerated list means a flag this parser has never seen still
 * counts as unclassifiable instead of silently falling through as
 * unconstrained — e.g. a declaration moved into a Windows-only
 * `#if defined(FLG_MSWIN32)` block must not be read as available everywhere.
 */
const MENTIONS_PLATFORM_FLAG_RE = /\bFLG_[A-Z0-9_]+\b/;

/**
 * `#if 0` is the other idiomatic way a vendor retires a declaration in place —
 * the same hazard as commenting it out, through a different door — and `#if 1`
 * makes every later branch of its chain unreachable. Only the bare literals are
 * recognized: anything more (`#if 0 && FLG_FOO`) is left to the general path,
 * which treats it as an ordinary condition rather than guessing.
 */
const ALWAYS_FALSE_CONDITION_RE = /^\s*0\s*$/;
const ALWAYS_TRUE_CONDITION_RE = /^\s*1\s*$/;

/** The operand of `#ifdef`/`#ifndef` is a bare macro name, so it must match exactly. */
const GUARDS_UNIX_RE = /^\s*FLG_UNIX\s*$/;

/**
 * What one branch's condition says, on its own, about the two things the parser
 * tracks. `excludesUnix` and `canFail` describe *falling past* the branch, which
 * is what later branches of the same chain inherit.
 */
interface ConditionEffect {
  /** Holding implies `FLG_UNIX` is defined. */
  requiresUnix: boolean;
  /** Holding implies `FLG_UNIX` is not defined — so falling past it implies it is. */
  excludesUnix: boolean;
  /** The branch is compiled somewhere, i.e. the condition is not `0`. */
  canHold: boolean;
  /** Later branches are reachable, i.e. the condition is not `1`. */
  canFail: boolean;
  /**
   * The condition mentions a platform flag in a shape this parser cannot
   * classify, so whether it requires or excludes `FLG_UNIX` is unknown — not
   * "neither", which `requiresUnix`/`excludesUnix` both `false` would
   * otherwise claim. A region carrying this can still hold zero declarations
   * without incident; it is only an error if a declaration lands inside one
   * and nothing else already pins `unixOnly` — see `Capture.unclassifiable`.
   */
  unclassifiable: boolean;
  /** Set together with `unclassifiable`; explains which condition and where. */
  unclassifiableReason?: string;
}

/** A condition that constrains nothing: the common case. */
const UNCONSTRAINED: ConditionEffect = {
  requiresUnix: false,
  excludesUnix: false,
  canHold: true,
  canFail: true,
  unclassifiable: false,
};

/** Where a directive was found, for error messages. */
interface SourceLocation {
  label: string;
  lineNumber: number;
}

/** The shared unclassifiable result: `#if`/`#elif`/`#ifdef`/`#ifndef` alike. */
function unclassifiable(condition: string, where: SourceLocation): ConditionEffect {
  return {
    ...UNCONSTRAINED,
    unclassifiable: true,
    unclassifiableReason:
      `unsupported platform-flag condition \`${condition.trim()}\` in ${where.label} ` +
      `at line ${where.lineNumber} — no branch can be classified, so teach conditionEffect ` +
      `this shape rather than guessing`,
  };
}

/**
 * Reads one conditional directive's condition. `#ifdef`/`#ifndef` take a bare
 * macro name; every other keyword — `#if` and `#elif` alike — takes a full
 * expression, and they are classified identically.
 */
function conditionEffect(
  directive: string,
  condition: string,
  where: SourceLocation,
): ConditionEffect {
  if (directive === 'ifdef') {
    if (GUARDS_UNIX_RE.test(condition)) return { ...UNCONSTRAINED, requiresUnix: true };
    if (MENTIONS_PLATFORM_FLAG_RE.test(condition)) return unclassifiable(condition, where);
    return UNCONSTRAINED;
  }
  if (directive === 'ifndef') {
    if (GUARDS_UNIX_RE.test(condition)) return { ...UNCONSTRAINED, excludesUnix: true };
    if (MENTIONS_PLATFORM_FLAG_RE.test(condition)) return unclassifiable(condition, where);
    return UNCONSTRAINED;
  }
  if (ALWAYS_FALSE_CONDITION_RE.test(condition)) return { ...UNCONSTRAINED, canHold: false };
  if (ALWAYS_TRUE_CONDITION_RE.test(condition)) return { ...UNCONSTRAINED, canFail: false };
  if (UNIX_CONDITION_RE.test(condition)) return { ...UNCONSTRAINED, requiresUnix: true };
  if (NEGATED_UNIX_CONDITION_RE.test(condition)) return { ...UNCONSTRAINED, excludesUnix: true };
  if (MENTIONS_PLATFORM_FLAG_RE.test(condition)) return unclassifiable(condition, where);
  return UNCONSTRAINED;
}

/**
 * One open conditional region: what the branch currently taken says, plus what
 * *reaching* a later branch of the same chain would say. The fall-through halves
 * accumulate across `#elif`s, which is the whole reason a frame is not just an
 * invertible `unixOnly` flag. `#if !defined(FLG_UNIX) / #elif X / #else` puts
 * both the `#elif` and the `#else` inside a UNIX-only region, because reaching
 * either one means the opening condition was false.
 */
interface ConditionalFrame {
  /** The branch currently open is compiled only where `FLG_UNIX` is defined. */
  unixOnly: boolean;
  /** The branch currently open is compiled at all. */
  live: boolean;
  /** Reaching a later branch of this chain implies `FLG_UNIX` is defined. */
  fallThroughUnixOnly: boolean;
  /** A later branch of this chain is reachable at all. */
  fallThroughLive: boolean;
  /**
   * Whether the branch currently open requires/excludes `FLG_UNIX` is
   * unknown, per `ConditionEffect.unclassifiable`. Propagates the way
   * `unixOnly` does — falling past an unclassifiable branch leaves later
   * branches just as unknown, since what it excluded is unknown too.
   */
  unclassifiable: boolean;
  /** Reaching a later branch of this chain inherits the same unknown. */
  fallThroughUnclassifiable: boolean;
  /** Set together with `unclassifiable`/`fallThroughUnclassifiable`. */
  unclassifiableReason?: string;
}

/** The frame a `#if`/`#ifdef`/`#ifndef` opens. */
function openedBy(effect: ConditionEffect): ConditionalFrame {
  return {
    unixOnly: effect.requiresUnix,
    live: effect.canHold,
    fallThroughUnixOnly: effect.excludesUnix,
    fallThroughLive: effect.canFail,
    unclassifiable: effect.unclassifiable,
    fallThroughUnclassifiable: effect.unclassifiable,
    unclassifiableReason: effect.unclassifiableReason,
  };
}

/** The same frame, advanced onto the `#elif` branch `effect` guards. */
function continuedBy(frame: ConditionalFrame, effect: ConditionEffect): ConditionalFrame {
  const unclassifiable = frame.fallThroughUnclassifiable || effect.unclassifiable;
  return {
    unixOnly: frame.fallThroughUnixOnly || effect.requiresUnix,
    live: frame.fallThroughLive && effect.canHold,
    fallThroughUnixOnly: frame.fallThroughUnixOnly || effect.excludesUnix,
    fallThroughLive: frame.fallThroughLive && effect.canFail,
    unclassifiable,
    fallThroughUnclassifiable: unclassifiable,
    unclassifiableReason: frame.unclassifiableReason ?? effect.unclassifiableReason,
  };
}

/** The same frame, advanced onto its `#else` — the branch nothing follows. */
function elseBranchOf(frame: ConditionalFrame): ConditionalFrame {
  return {
    unixOnly: frame.fallThroughUnixOnly,
    live: frame.fallThroughLive,
    fallThroughUnixOnly: frame.fallThroughUnixOnly,
    fallThroughLive: false,
    unclassifiable: frame.fallThroughUnclassifiable,
    fallThroughUnclassifiable: frame.fallThroughUnclassifiable,
    unclassifiableReason: frame.unclassifiableReason,
  };
}

/**
 * The declared name inside one captured `EXTERN_GCI_DEC` statement.
 */
function declaredNameIn(statement: string, label: string): string {
  const match = DECLARATION_RE.exec(statement);
  if (!match) {
    throw new Error(
      `headerDeclarations: could not parse an ${DECLARATION_MACRO} declaration in ${label} — ` +
        `expected \`${DECLARATION_MACRO}(<return type>) <name>(\`, and a return type of its own ` +
        `containing parentheses (a function pointer) is the usual reason it does not fit:` +
        `\n${statement}`,
    );
  }
  return match[1];
}

/** How far one line opens (positive) or closes (negative) parentheses. */
function netParens(line: string): number {
  let depth = 0;
  for (const character of line) {
    if (character === '(') depth++;
    else if (character === ')') depth--;
  }
  return depth;
}

/**
 * A declaration being read. It can span lines, and its argument list can be
 * interrupted by directives, so text accumulates until the parentheses balance
 * and a `;` closes it. `unixOnly` is snapshotted where the declaration *starts*,
 * so a platform branch inside its argument list does not reclassify it.
 */
interface Capture {
  text: string;
  parenDepth: number;
  unixOnly: boolean;
  /**
   * Snapshotted the same way `unixOnly` is: true when an enclosing frame's
   * platform gating could not be classified *and* nothing else already
   * pins `unixOnly` true. A `FLG_SOLARIS` sub-branch nested inside a proven
   * `FLG_UNIX` block does not need to be understood — the declaration is
   * unix-only regardless of what the inner condition turns out to mean — so
   * this stays false in that case even though the inner frame itself is
   * unclassifiable.
   */
  unclassifiable: boolean;
  unclassifiableReason?: string;
}

/**
 * Core parser, operating on already-read header text. Exported (in addition
 * to `declaredFunctions`) so unit tests can exercise parsing behavior against
 * small inline fixtures without touching `vendor/`.
 */
export function parseDeclarations(rawSource: string, label: string): Map<string, DeclaredFunction> {
  const source = stripComments(rawSource);
  const lines = source.split('\n');

  const declared = new Map<string, DeclaredFunction>();
  const frames: ConditionalFrame[] = [];

  let lineNumber = 0;
  let capture: Capture | undefined;
  let occurrences = 0;

  const currentlyUnixOnly = () => frames.some((frame) => frame.unixOnly);
  const currentlyLive = () => frames.every((frame) => frame.live);
  const currentlyUnclassifiable = () => frames.find((frame) => frame.unclassifiable);

  /**
   * An unbalanced directive means the frame stack no longer describes the file,
   * so every classification after it is suspect — fail loudly rather than
   * silently mis-attributing declarations.
   */
  const unbalanced = (directive: string) =>
    new Error(
      `headerDeclarations: ${directive} with no matching #if in ${label} at line ${lineNumber}.`,
    );

  /** The innermost open conditional, which `#elif` and `#else` advance. */
  const innermostFrame = (directive: string): ConditionalFrame => {
    const frame = frames.at(-1);
    if (!frame) throw unbalanced(directive);
    return frame;
  };

  const replaceInnermostFrame = (frame: ConditionalFrame) => {
    frames[frames.length - 1] = frame;
  };

  /*
   * Directives are handled before the capture buffer, so a directive that lands
   * *inside* a declaration (an argument list branching on the platform) never
   * reaches the buffer, while still opening and closing frames on the stack.
   * That is deliberate: the declaration's own `unixOnly` is snapshotted from the
   * frames in force where it started, so a branch on its arguments does not make
   * the declaration itself platform-specific.
   */
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex];
    lineNumber++;
    const line = rawLine.trim();

    const directive = directiveOn(line);
    if (directive) {
      const { keyword, condition: firstLineCondition } = directive;
      const condition = withContinuations(firstLineCondition, lines, lineIndex);
      const effect = () => conditionEffect(keyword, condition, { label, lineNumber });

      if (keyword === 'endif') {
        if (frames.pop() === undefined) throw unbalanced('#endif');
      } else if (keyword === 'else') {
        replaceInnermostFrame(elseBranchOf(innermostFrame('#else')));
      } else if (keyword === 'elif') {
        replaceInnermostFrame(continuedBy(innermostFrame('#elif'), effect()));
      } else {
        frames.push(openedBy(effect()));
      }
      continue;
    }

    /*
     * A region the preprocessor never compiles holds no declarations, so it is
     * skipped whole — before the occurrence counter, which would otherwise count
     * what the capture loop deliberately did not take and report a phantom miss.
     * A half-written declaration parked behind `#if 0` never opens a capture
     * either, so it cannot surface later as a truncation error.
     */
    if (!currentlyLive()) continue;

    occurrences += (line.match(DECLARATION_OCCURRENCE_RE) ?? []).length;

    if (!capture) {
      if (!line.includes(DECLARATION_MACRO)) continue;
      const unixOnly = currentlyUnixOnly();
      const unclassifiableFrame = unixOnly ? undefined : currentlyUnclassifiable();
      capture = {
        text: '',
        parenDepth: 0,
        unixOnly,
        unclassifiable: unclassifiableFrame !== undefined,
        unclassifiableReason: unclassifiableFrame?.unclassifiableReason,
      };
    }

    capture.text += rawLine + '\n';
    capture.parenDepth += netParens(rawLine);
    if (capture.parenDepth > 0 || !rawLine.includes(';')) continue;

    const name = declaredNameIn(capture.text, label);
    if (declared.has(name)) {
      throw new Error(
        `headerDeclarations: ${name} is declared more than once in ${label} — ` +
          `the last declaration would silently win, so decide which one binds.`,
      );
    }
    if (capture.unclassifiable) {
      throw new Error(
        `headerDeclarations: ${name} sits inside an ${capture.unclassifiableReason}.`,
      );
    }
    declared.set(name, { unixOnly: capture.unixOnly });
    capture = undefined;
  }

  if (frames.length > 0) {
    throw new Error(
      `headerDeclarations: ${frames.length} unclosed #if directive(s) at end of ${label}.`,
    );
  }

  if (capture) {
    throw new Error(
      `headerDeclarations: truncated ${DECLARATION_MACRO} declaration in ${label}:\n${capture.text}`,
    );
  }

  if (declared.size !== occurrences) {
    throw new Error(
      `headerDeclarations: parsed ${declared.size} declarations but saw ${occurrences} ` +
        `${DECLARATION_MACRO} occurrences in ${label} — the parser silently missed one.`,
    );
  }

  return declared;
}

export function declaredFunctions(revision: string): Map<string, DeclaredFunction> {
  const headerPath = path.join(headersRoot, revision, 'gcits.hf');
  let source: string;
  try {
    source = fs.readFileSync(headerPath, 'utf-8');
  } catch (cause) {
    throw new Error(
      `headerDeclarations: no vendored gcits.hf for revision ${revision} at ${headerPath} — ` +
        `the vendored revisions are ${vendoredRevisions().join(', ')}.`,
      { cause },
    );
  }
  return parseDeclarations(source, `${revision}/gcits.hf`);
}
