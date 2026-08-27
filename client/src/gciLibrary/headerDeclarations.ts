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

export function vendoredRevisions(): string[] {
  return fs
    .readdirSync(headersRoot, { withFileTypes: true })
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

const DECLARATION_RE = /EXTERN_GCI_DEC\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

/**
 * Every conditional-opening directive, not just `#if` — `#ifdef`/`#ifndef` open
 * a frame that a later `#endif` closes, so missing them desynchronizes the
 * stack and lets an inner `#endif` pop an enclosing `FLG_UNIX` frame early.
 * Longest alternative first, so `#ifdef` isn't read as `#if` followed by junk.
 */
const IF_RE = /^#\s*(ifdef|ifndef|if)\b(.*)$/;
const ELIF_RE = /^#\s*elif\b(.*)$/;
const ELSE_RE = /^#\s*else\b/;
const ENDIF_RE = /^#\s*endif\b/;

/**
 * A condition is read as UNIX-only only when `FLG_UNIX` is the *whole* of it.
 * Substring matching would classify `#if defined(FLG_UNIX) || defined(FLG_MSWIN32)`
 * as UNIX-only, and would read the `#else` of `#if A && !defined(FLG_UNIX)` as the
 * UNIX branch — both wrong, and both wrong silently. Anything else that mentions
 * `FLG_UNIX` is a shape we have not taught the parser: it throws rather than guess.
 */
const UNIX_CONDITION_RE = /^\s*(?:defined\s*\(\s*FLG_UNIX\s*\)|FLG_UNIX)\s*$/;
const NEGATED_UNIX_CONDITION_RE = /^\s*!\s*(?:defined\s*\(\s*FLG_UNIX\s*\)|FLG_UNIX)\s*$/;
const MENTIONS_UNIX_RE = /\bFLG_UNIX\b/;

/** The operand of `#ifdef`/`#ifndef` is a bare macro name, so it must match exactly. */
const GUARDS_UNIX_RE = /^\s*FLG_UNIX\s*$/;

/**
 * One open conditional region. A frame carries both branches because `#else`
 * cannot be modelled as an inversion of `unixOnly`: `#if defined(FLG_SOMETHING)`
 * is not UNIX-only, and neither is its `#else`.
 */
interface ConditionalFrame {
  /** Whether the branch currently open guards a UNIX-only region. */
  unixOnly: boolean;
  /** What an `#else` on this frame switches `unixOnly` to. */
  elseUnixOnly: boolean;
}

/** Where a directive was found, for error messages. */
interface SourceLocation {
  label: string;
  lineNumber: number;
}

/** Classifies both branches of a conditional directive against `FLG_UNIX`. */
function conditionalFrame(
  directive: string,
  condition: string,
  where: SourceLocation,
): ConditionalFrame {
  if (directive === 'ifdef') {
    return { unixOnly: GUARDS_UNIX_RE.test(condition), elseUnixOnly: false };
  }
  if (directive === 'ifndef') {
    return { unixOnly: false, elseUnixOnly: GUARDS_UNIX_RE.test(condition) };
  }
  if (UNIX_CONDITION_RE.test(condition)) return { unixOnly: true, elseUnixOnly: false };
  if (NEGATED_UNIX_CONDITION_RE.test(condition)) return { unixOnly: false, elseUnixOnly: true };
  if (MENTIONS_UNIX_RE.test(condition)) {
    throw new Error(
      `headerDeclarations: unsupported FLG_UNIX condition \`${condition.trim()}\` in ` +
        `${where.label} at line ${where.lineNumber} — neither branch can be classified, ` +
        `so teach conditionalFrame this shape rather than guessing.`,
    );
  }
  return { unixOnly: false, elseUnixOnly: false };
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
  let buffer = '';
  let capturing = false;
  let parenDepth = 0;
  let bufferUnixOnly = false;
  let occurrences = 0;

  const currentlyUnixOnly = () => frames.some((frame) => frame.unixOnly);

  /**
   * The innermost open conditional. An unbalanced directive means the frame
   * stack no longer describes the file, so every classification after it is
   * suspect — fail loudly rather than silently mis-attributing declarations.
   */
  const openFrame = (directive: string): ConditionalFrame => {
    const frame = frames.at(-1);
    if (!frame) {
      throw new Error(
        `headerDeclarations: ${directive} with no matching #if in ${label} at line ${lineNumber}.`,
      );
    }
    return frame;
  };

  /*
   * Directives are handled before the capture buffer, so a directive that lands
   * *inside* a declaration (an argument list branching on the platform) never
   * reaches the buffer, while still opening and closing frames on the stack.
   * That is deliberate: the declaration's own `unixOnly` is snapshotted from the
   * frames in force where it started, so a branch on its arguments does not make
   * the declaration itself platform-specific.
   */
  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();

    const ifMatch = IF_RE.exec(line);
    const elifMatch = ELIF_RE.exec(line);
    const elseMatch = ELSE_RE.exec(line);
    const endifMatch = ENDIF_RE.exec(line);

    if (ifMatch) {
      frames.push(conditionalFrame(ifMatch[1], ifMatch[2], { label, lineNumber }));
      continue;
    }
    if (elifMatch) {
      Object.assign(
        openFrame('#elif'),
        conditionalFrame('if', elifMatch[1], { label, lineNumber }),
      );
      continue;
    }
    if (elseMatch) {
      const frame = openFrame('#else');
      Object.assign(frame, { unixOnly: frame.elseUnixOnly, elseUnixOnly: false });
      continue;
    }
    if (endifMatch) {
      openFrame('#endif');
      frames.pop();
      continue;
    }

    occurrences += (line.match(/EXTERN_GCI_DEC/g) ?? []).length;

    if (!capturing) {
      if (!line.includes('EXTERN_GCI_DEC')) continue;
      capturing = true;
      buffer = '';
      parenDepth = 0;
      bufferUnixOnly = currentlyUnixOnly();
    }

    buffer += rawLine + '\n';
    for (const ch of rawLine) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }

    if (parenDepth <= 0 && /;/.test(rawLine)) {
      const match = DECLARATION_RE.exec(buffer);
      if (!match) {
        throw new Error(
          `headerDeclarations: could not parse an EXTERN_GCI_DEC declaration in ${label}:\n${buffer}`,
        );
      }
      const name = match[1];
      if (declared.has(name)) {
        throw new Error(
          `headerDeclarations: ${name} is declared more than once in ${label} — ` +
            `the last declaration would silently win, so decide which one binds.`,
        );
      }
      declared.set(name, { unixOnly: bufferUnixOnly });
      capturing = false;
      buffer = '';
    }
  }

  if (frames.length > 0) {
    throw new Error(
      `headerDeclarations: ${frames.length} unclosed #if directive(s) at end of ${label}.`,
    );
  }

  if (capturing) {
    throw new Error(
      `headerDeclarations: truncated EXTERN_GCI_DEC declaration in ${label}:\n${buffer}`,
    );
  }

  if (declared.size !== occurrences) {
    throw new Error(
      `headerDeclarations: parsed ${declared.size} declarations but saw ${occurrences} ` +
        `EXTERN_GCI_DEC occurrences in ${label} — the parser silently missed one.`,
    );
  }

  return declared;
}

export function declaredFunctions(revision: string): Map<string, DeclaredFunction> {
  const headerPath = path.join(headersRoot, revision, 'gcits.hf');
  return parseDeclarations(fs.readFileSync(headerPath, 'utf-8'), `${revision}/gcits.hf`);
}
