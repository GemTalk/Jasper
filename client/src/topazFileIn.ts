/**
 * Reading Topaz file-out text: splitting it into chunks, and turning those chunks
 * into work.
 *
 * Two consumers, with different reach. `fileInClass` / `fileInChangedRegions` serve
 * the `.gemstone` class mirror, where a file is known to hold one class and saving it
 * recompiles that class. `parseTopazScript` serves the File In command (issue #539),
 * where the file is whatever the user picked and every directive in it has to be
 * accounted for — so it reads the class comment, `removeAllMethods`, the compile
 * environment and `input` as well, and reports anything it will not run.
 *
 * `parseTopazDocument` (the chunk splitter both build on) is copied from
 * server/src/topaz/topazParser.ts because the server and client have separate
 * tsconfig roots and cannot share imports without build configuration changes.
 */
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';

// ── Topaz Parser (copied from server) ──────────────────────────

type RegionKind = 'topaz' | 'smalltalk-code' | 'smalltalk-method' | 'tonel-header';

interface TopazRegion {
  kind: RegionKind;
  startLine: number;
  endLine: number;
  text: string;
  className?: string;
  command?: string;
}

const CODE_COMMANDS = ['run', 'doit', 'print', 'printit'];
const METHOD_COMMANDS = ['method', 'classmethod'];

function matchCommand(line: string, commands: string[]): { command: string; rest: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const match = trimmed.match(/^([a-zA-Z]+)(:?\s*)(.*)/);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const sep = match[2];
  const rest = match[3];

  for (const cmd of commands) {
    if (cmd.startsWith(word) && word.length >= minAbbrev(cmd)) {
      return { command: cmd, rest: (sep + rest).trim() };
    }
  }

  return null;
}

function minAbbrev(cmd: string): number {
  switch (cmd) {
    case 'run':
      return 3;
    case 'doit':
      return 2;
    case 'print':
      return 2;
    case 'printit':
      return 7;
    case 'method':
      return 3;
    case 'classmethod':
      return 6;
    default:
      return 3;
  }
}

export function parseTopazDocument(text: string): TopazRegion[] {
  const lines = text.split('\n');
  const regions: TopazRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const codeMatch = matchCommand(line, CODE_COMMANDS);
    if (codeMatch) {
      i++;
      const startLine = i;
      const codeLines: string[] = [];

      while (i < lines.length && lines[i].trim() !== '%') {
        codeLines.push(lines[i]);
        i++;
      }

      const endLine = i > startLine ? i - 1 : startLine;

      regions.push({
        kind: 'smalltalk-code',
        startLine,
        endLine,
        text: codeLines.join('\n'),
        command: codeMatch.command,
      });

      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

    const methodMatch = matchCommand(line, METHOD_COMMANDS);
    if (methodMatch) {
      let className: string | undefined;
      const restTrimmed = methodMatch.rest.replace(/^:\s*/, '').trim();
      if (restTrimmed.length > 0) {
        className = restTrimmed;
      }

      i++;
      const startLine = i;
      const methodLines: string[] = [];

      while (i < lines.length && lines[i].trim() !== '%') {
        methodLines.push(lines[i]);
        i++;
      }

      const endLine = i > startLine ? i - 1 : startLine;

      regions.push({
        kind: 'smalltalk-method',
        startLine,
        endLine,
        text: methodLines.join('\n'),
        command: methodMatch.command,
        className,
      });

      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

    const topazStart = i;
    while (i < lines.length) {
      const nextCode = matchCommand(lines[i], CODE_COMMANDS);
      const nextMethod = matchCommand(lines[i], METHOD_COMMANDS);
      if (nextCode || nextMethod) break;
      i++;
    }

    regions.push({
      kind: 'topaz',
      startLine: topazStart,
      endLine: i - 1,
      text: lines.slice(topazStart, i).join('\n'),
    });
  }

  return regions;
}

// ── File-In Logic ──────────────────────────────────────────────

export interface FileInError {
  message: string;
  /** 0-based line in the .gs file */
  line: number;
  className?: string;
  selector?: string;
}

export interface FileInResult {
  success: boolean;
  errors: FileInError[];
  compiledMethods: number;
  compiledClassDef: boolean;
  deletedMethods: number;
}

/**
 * Parse a Topaz file-out and compile each piece (class definition + methods)
 * back into GemStone. Returns per-method error details for diagnostics.
 */
export function fileInClass(
  session: ActiveSession,
  fileContent: string,
  environmentId: number = 0,
): FileInResult {
  const regions = parseTopazDocument(fileContent);
  const errors: FileInError[] = [];
  let compiledMethods = 0;
  let compiledClassDef = false;
  let currentCategory = 'as yet unclassified';

  for (const region of regions) {
    if (region.kind === 'topaz') {
      // Scan for category: 'Name' commands
      for (const line of region.text.split('\n')) {
        const catMatch = line.match(/^category:\s*'([^']*)'/i);
        if (catMatch) {
          currentCategory = catMatch[1];
        }
      }
      continue;
    }

    if (region.kind === 'smalltalk-code') {
      // Check if this is a class definition (contains subclass:)
      if (region.text.includes('subclass:')) {
        try {
          queries.compileClassDefinition(session, region.text);
          compiledClassDef = true;
        } catch (e: unknown) {
          const msg = e instanceof BrowserQueryError ? e.message : String(e);
          errors.push({
            message: msg,
            line: region.startLine,
          });
        }
      }
      continue;
    }

    if (region.kind === 'smalltalk-method') {
      const className = region.className;
      if (!className) {
        errors.push({
          message: 'Method region missing class name',
          line: region.startLine,
        });
        continue;
      }

      const isMeta = region.command === 'classmethod';
      const selector = region.text.split('\n')[0]?.trim();

      try {
        queries.compileMethod(
          session,
          className,
          isMeta,
          currentCategory,
          region.text,
          environmentId,
        );
        compiledMethods++;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({
          message: msg,
          line: region.startLine,
          className,
          selector,
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    compiledMethods,
    compiledClassDef,
    deletedMethods: 0,
  };
}

// ── Topaz script steps (File In) ───────────────────────────────

/**
 * One thing filing a `.gs` file in has to do, in the order the file says to do it.
 *
 * This is the whole-file counterpart of {@link fileInClass}, which only ever looked
 * for a class definition and its methods. A GemStone file-out carries more than that
 * — a class comment in its own `doit`, `removeAllMethods` before the methods are
 * replaced, the compile environment, and (for a dictionary filed out as many files)
 * `input` lines naming the rest — and skipping any of it files the code in wrong
 * rather than not at all.
 */
export type FileInStep =
  /** A `run` / `doit` chunk: class definitions, comments, arbitrary setup. */
  | { kind: 'execute'; code: string; line: number }
  /** A `method:` / `classmethod:` chunk, with the category and compile environment
   *  the directives above it had established. */
  | {
      kind: 'method';
      className: string;
      isMeta: boolean;
      category: string;
      environmentId: number;
      source: string;
      line: number;
    }
  /** `removeAllMethods X` / `removeAllClassMethods X` — a file-out emits these ahead
   *  of a class's methods so filing it in REPLACES them rather than merging into
   *  whatever the class already had. */
  | { kind: 'removeAllMethods'; className: string; isMeta: boolean; line: number }
  /** `input other.gs` — read that file (relative to this one) and file it in here. */
  | { kind: 'input'; file: string; line: number }
  /** A Topaz command that drives the *topaz program* rather than the image — logging
   *  in, setting the output level, committing. Recognised and deliberately not run
   *  (Jasper is already connected, and never commits on the user's behalf), but
   *  reported, because a `commit` the file expected and did not get changes what the
   *  file means. */
  | { kind: 'sessionCommand'; directive: string; line: number; transaction: boolean }
  /** `exit` / `quit` — Topaz stops reading here, so this does too. */
  | { kind: 'stop'; directive: string; line: number }
  /** A directive Jasper does not recognise at all. Reported rather than silently
   *  dropped: it may have been the point of the file. */
  | { kind: 'unsupported'; directive: string; line: number };

// Directives a GemStone/Jadeite file-out writes that genuinely have nothing to do on
// the way in. `fileformat` describes the encoding, which VS Code has already decoded;
// the `expect*` family are Topaz's own assertions about the next chunk's result.
const IGNORED_DIRECTIVES = /^(fileformat|expectvalue|expecterror|expectbug)\b/i;

/**
 * Topaz commands that address the topaz program, not the image — so a `.tpz` script
 * written to be run by topaz can be filed in here without every line of its preamble
 * being reported as something Jasper failed to understand.
 *
 * None of them are run. The connection ones would be wrong to honour (Jasper files in
 * over the session the user picked, not one the file names); the rest govern topaz's
 * own output and debugging, which has no counterpart here.
 *
 * Abbreviations are NOT expanded. Topaz lets most commands be shortened, but guessing
 * which prefix meant which command is a good way to run the wrong one, and an
 * unrecognised line is reported rather than dropped — so a shortened command shows up
 * as something to look at instead of something silently mistaken.
 */
const SESSION_COMMANDS = new Set([
  // Connection and session
  'login',
  'logout',
  'spawngem',
  'disconnect',
  'sessionid',
  'solo',
  // Transaction
  'commit',
  'abort',
  'begin',
  // Output, error handling and debugging
  'display',
  'omit',
  'output',
  'level',
  'limit',
  'iferror',
  'errorcount',
  'time',
  'pause',
  'echo',
  'status',
  'version',
  'help',
  'send',
  'object',
  'obj',
  'list',
  'listw',
  'stack',
  'stk',
  'where',
  'frame',
  'step',
  'continue',
]);

/** Of those, the ones whose not being run changes what the file DOES, rather than
 *  only how topaz would have reported it. Worth saying out loud in the summary. */
const TRANSACTION_COMMANDS = new Set(['commit', 'abort', 'begin']);

/** Topaz stops reading the script here. */
const STOP_COMMANDS = new Set(['exit', 'quit']);

/** The method category a chunk lands in when the file never said. Matches what
 *  GemStone itself uses for an unclassified method. */
const DEFAULT_CATEGORY = 'as yet unclassified';

/**
 * Read a Topaz file into the ordered steps that file it in.
 *
 * Pure — it touches neither GemStone nor the filesystem, so the whole of what a file
 * will do can be asserted without either. `category:` and `set compile_env:` are
 * *state*, not steps: each applies to the method chunks that follow it, so they are
 * folded into those chunks here and cannot go out of step with them later.
 *
 * Handles a hand-written `.tpz` script as well as a file-out: its `login` / `output` /
 * `commit` preamble is recognised as topaz's own (a `sessionCommand`, reported but not
 * run), and `exit` ends the parse where topaz would stop reading.
 */
export function parseTopazScript(text: string): FileInStep[] {
  const steps: FileInStep[] = [];
  let category = DEFAULT_CATEGORY;
  let environmentId = 0;

  for (const region of parseTopazDocument(text)) {
    if (region.kind === 'topaz') {
      region.text.split('\n').forEach((raw, offset) => {
        const line = region.startLine + offset;
        const trimmed = raw.trim();
        // Blank lines and `!` comments carry the file's provenance banner and its
        // section headings — nothing to run.
        if (trimmed.length === 0 || trimmed.startsWith('!')) return;

        const cat = trimmed.match(/^category:\s*'(.*)'\s*$/i);
        if (cat) {
          category = cat[1].replace(/''/g, "'");
          return;
        }
        const env = trimmed.match(/^set\s+compile_env:\s*(\d+)/i);
        if (env) {
          environmentId = parseInt(env[1], 10);
          return;
        }
        const removeAll = trimmed.match(/^removeall(class)?methods\s+(\S+)/i);
        if (removeAll) {
          steps.push({
            kind: 'removeAllMethods',
            className: removeAll[2],
            isMeta: removeAll[1] !== undefined,
            line,
          });
          return;
        }
        const input = trimmed.match(/^input\s+(.+)$/i);
        if (input) {
          steps.push({ kind: 'input', file: input[1].trim(), line });
          return;
        }
        if (IGNORED_DIRECTIVES.test(trimmed)) return;

        const word = (trimmed.match(/^([A-Za-z_]+)/)?.[1] ?? '').toLowerCase();
        if (STOP_COMMANDS.has(word)) {
          steps.push({ kind: 'stop', directive: trimmed, line });
          return;
        }
        // A bare `set <something>` is topaz's environment; `set compile_env:` was
        // already taken above, and it is the only one that reaches the image.
        if (SESSION_COMMANDS.has(word) || word === 'set') {
          steps.push({
            kind: 'sessionCommand',
            directive: trimmed,
            line,
            transaction: TRANSACTION_COMMANDS.has(word),
          });
          return;
        }

        steps.push({ kind: 'unsupported', directive: trimmed, line });
      });
      continue;
    }

    if (region.kind === 'smalltalk-code') {
      if (region.text.trim().length > 0) {
        steps.push({ kind: 'execute', code: region.text, line: region.startLine });
      }
      continue;
    }

    if (region.kind === 'smalltalk-method') {
      if (region.className === undefined) {
        steps.push({
          kind: 'unsupported',
          directive: `${region.command ?? 'method'} (no class named)`,
          line: region.startLine,
        });
        continue;
      }
      steps.push({
        kind: 'method',
        className: region.className,
        isMeta: region.command === 'classmethod',
        category,
        environmentId,
        source: region.text,
        line: region.startLine,
      });
    }
  }

  return steps;
}

// ── Differential File-In ──────────────────────────────────

interface MethodKey {
  className: string;
  isMeta: boolean;
  selector: string;
}

interface ParsedMethod {
  key: MethodKey;
  text: string;
  category: string;
  region: TopazRegion;
}

export interface ParsedFile {
  classDef?: { text: string; region: TopazRegion };
  methods: ParsedMethod[];
}

function methodKeyString(key: MethodKey): string {
  return `${key.className}${key.isMeta ? ' class' : ''}>>${key.selector}`;
}

/**
 * Parse a Topaz file-out into structured class definition and methods,
 * tracking the effective category for each method.
 */
export function parseFileStructure(content: string): ParsedFile {
  const regions = parseTopazDocument(content);
  const methods: ParsedMethod[] = [];
  let classDef: ParsedFile['classDef'];
  let currentCategory = 'as yet unclassified';

  for (const region of regions) {
    if (region.kind === 'topaz') {
      for (const line of region.text.split('\n')) {
        const catMatch = line.match(/^category:\s*'([^']*)'/i);
        if (catMatch) currentCategory = catMatch[1];
      }
      continue;
    }

    if (region.kind === 'smalltalk-code' && region.text.includes('subclass:')) {
      classDef = { text: region.text, region };
      continue;
    }

    if (region.kind === 'smalltalk-method' && region.className) {
      const isMeta = region.command === 'classmethod';
      const selector = region.text.split('\n')[0]?.trim() || '';
      methods.push({
        key: { className: region.className, isMeta, selector },
        text: region.text,
        category: currentCategory,
        region,
      });
    }
  }

  return { classDef, methods };
}

/**
 * Parse old and new file content, compile only changed/new regions,
 * and delete methods that were removed. Falls back to full `fileInClass`
 * when no old content is available.
 */
export function fileInChangedRegions(
  session: ActiveSession,
  oldContent: string | undefined,
  newContent: string,
  environmentId: number = 0,
): FileInResult {
  if (oldContent === undefined) {
    return fileInClass(session, newContent, environmentId);
  }

  const oldFile = parseFileStructure(oldContent);
  const newFile = parseFileStructure(newContent);

  const errors: FileInError[] = [];
  let compiledMethods = 0;
  let compiledClassDef = false;
  let deletedMethods = 0;

  // Compile class definition if changed
  if (newFile.classDef) {
    if (oldFile.classDef?.text !== newFile.classDef.text) {
      try {
        queries.compileClassDefinition(session, newFile.classDef.text);
        compiledClassDef = true;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({ message: msg, line: newFile.classDef.region.startLine });
      }
    }
  }

  // Build map of old methods
  const oldMethodMap = new Map<string, ParsedMethod>();
  for (const m of oldFile.methods) {
    oldMethodMap.set(methodKeyString(m.key), m);
  }

  // Compile changed or new methods
  const newMethodKeys = new Set<string>();
  for (const m of newFile.methods) {
    const keyStr = methodKeyString(m.key);
    newMethodKeys.add(keyStr);
    const oldMethod = oldMethodMap.get(keyStr);

    if (!oldMethod || oldMethod.text !== m.text || oldMethod.category !== m.category) {
      try {
        queries.compileMethod(
          session,
          m.key.className,
          m.key.isMeta,
          m.category,
          m.text,
          environmentId,
        );
        compiledMethods++;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({
          message: msg,
          line: m.region.startLine,
          className: m.key.className,
          selector: m.key.selector,
        });
      }
    }
  }

  // Delete methods removed from file (only if no compilation errors)
  if (errors.length === 0) {
    for (const [keyStr, oldMethod] of oldMethodMap) {
      if (!newMethodKeys.has(keyStr)) {
        try {
          queries.deleteMethod(
            session,
            oldMethod.key.className,
            oldMethod.key.isMeta,
            oldMethod.key.selector,
          );
          deletedMethods++;
        } catch (e: unknown) {
          const msg = e instanceof BrowserQueryError ? e.message : String(e);
          errors.push({
            message: msg,
            line: 0,
            className: oldMethod.key.className,
            selector: oldMethod.key.selector,
          });
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    compiledMethods,
    compiledClassDef,
    deletedMethods,
  };
}
