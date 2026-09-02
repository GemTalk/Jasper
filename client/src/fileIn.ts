// Reading a Topaz file back into GemStone — the other half of File Out (issue #539).
// The file is on the user's own machine and is executed chunk by chunk over the GCI,
// rather than handed to `GsFileIn`, which reads a path on the stone's host and so
// cannot see a local file at all.
//
// Takes a hand-written `.tpz` script as readily as a `.gs` file-out. A script's
// preamble addresses the topaz program rather than the image — `login`, `output push`,
// `commit` — and none of it is run here: Jasper files in over the session the user
// picked, and never commits on their behalf. Those lines are reported rather than
// dropped, and a file that asked to commit is called out by name, so a script whose
// work would have been committed does not look as though it was.
//
// Running it here also means every chunk's outcome is known: a failure is reported
// against the line it was on, and the rest of the file still files in, which is what
// a developer fixing one bad method wants. Nothing is committed — a file-in leaves
// the session dirty exactly as compiling a method from the Explorer does, so the user
// decides whether to keep it.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { parseTopazScript } from './topazFileIn';
import { rememberDirectory, rememberedDirectory } from './fileTransferDirectory';

/** File types the open dialog offers. Topaz writes `.gs`; `.tpz` is the same syntax. */
export const FILE_IN_FILTERS: Record<string, string[]> = {
  'GemStone Files': ['gs', 'tpz'],
  'All Files': ['*'],
};

/** Something worth telling the user about one line of one file. */
export interface FileInNote {
  /** Absolute path of the file the line is in — a file-in can span several via `input`. */
  file: string;
  /** 1-based line number, as an editor shows it. */
  line: number;
  message: string;
}

/** What a file-in did. Counts are what went in; the note lists are what didn't. */
export interface FileInOutcome {
  /** `run` / `doit` chunks evaluated. */
  executed: number;
  /** Methods compiled. */
  compiled: number;
  /** `removeAllMethods` directives applied. */
  removed: number;
  /** Files read, including any reached through `input`. */
  files: number;
  /** Topaz commands recognised as the topaz program's own — `login`, `output`,
   *  `commit` — and deliberately not run. Kept apart from {@link skipped} because
   *  these are expected in a hand-written script and are not a sign of trouble. */
  ignored: FileInNote[];
  /** Whether the file asked to commit or abort. Reported prominently: the file
   *  expected a transaction boundary Jasper did not give it. */
  askedToCommit: boolean;
  /** Directives Jasper does not recognise at all. */
  skipped: FileInNote[];
  /** Chunks GemStone refused, with its own words. */
  errors: FileInNote[];
  /** Set by `exit` / `quit`: Topaz stops reading there, and so does everything after
   *  it — the rest of this file, the files it would have `input`, and any further
   *  files the user picked. */
  stopped: boolean;
}

function emptyOutcome(): FileInOutcome {
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
  };
}

/** Fold `from` into `into`, so a nested `input` and a multi-file pick add up the same way. */
function absorb(into: FileInOutcome, from: FileInOutcome): void {
  into.executed += from.executed;
  into.compiled += from.compiled;
  into.removed += from.removed;
  into.files += from.files;
  into.ignored.push(...from.ignored);
  into.skipped.push(...from.skipped);
  into.errors.push(...from.errors);
  into.askedToCommit ||= from.askedToCommit;
  into.stopped ||= from.stopped;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * File one `.gs` file in, following any `input` lines it carries.
 *
 * `input` is how the System Browser's "file out as many files" export names the
 * per-class files beside its loader, so a dictionary filed out that way has to be
 * filed back in the same way. Paths resolve relative to the file naming them, as
 * Topaz resolves them. `seen` breaks a cycle — two files that `input` each other
 * would otherwise recurse until the stack gave out.
 */
export function fileInFile(
  session: ActiveSession,
  filePath: string,
  seen: Set<string> = new Set(),
): FileInOutcome {
  const outcome = emptyOutcome();
  const absolute = path.resolve(filePath);
  if (seen.has(absolute)) return outcome;
  seen.add(absolute);

  let text: string;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch (e) {
    outcome.errors.push({ file: absolute, line: 1, message: `Could not read: ${message(e)}` });
    return outcome;
  }
  outcome.files++;

  // A file written by an editor that stamps a byte-order mark would otherwise put one
  // in front of the first directive, and nothing would recognise it.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (const step of parseTopazScript(text)) {
    // parseTopazScript counts lines from 0; every note reports the line as an editor
    // numbers it.
    const note = (msg: string): FileInNote => ({
      file: absolute,
      line: step.line + 1,
      message: msg,
    });

    try {
      switch (step.kind) {
        case 'execute':
          queries.fileInChunk(session, step.code);
          outcome.executed++;
          break;
        case 'method':
          queries.compileMethod(
            session,
            step.className,
            step.isMeta,
            step.category,
            step.source,
            step.environmentId,
          );
          outcome.compiled++;
          break;
        case 'removeAllMethods':
          queries.removeAllMethods(session, step.className, step.isMeta);
          outcome.removed++;
          break;
        case 'input': {
          absorb(
            outcome,
            fileInFile(session, path.resolve(path.dirname(absolute), step.file), seen),
          );
          break;
        }
        case 'sessionCommand':
          outcome.ignored.push(note(`Topaz command not run: ${step.directive}`));
          if (step.transaction) outcome.askedToCommit = true;
          break;
        case 'stop':
          outcome.stopped = true;
          break;
        case 'unsupported':
          outcome.skipped.push(note(`Jasper does not recognise this directive: ${step.directive}`));
          break;
      }
    } catch (e) {
      outcome.errors.push(note(describeStep(step) + message(e)));
    }
    // `exit` in the file, or in a file it pulled in — Topaz reads no further, and
    // neither does this.
    if (outcome.stopped) break;
  }

  return outcome;
}

/** How a failing step is named in the log, so a line number isn't the only clue. */
function describeStep(step: ReturnType<typeof parseTopazScript>[number]): string {
  switch (step.kind) {
    case 'method':
      return `${step.className}${step.isMeta ? ' class' : ''}>>${firstLine(step.source)}: `;
    case 'removeAllMethods':
      return `removeAllMethods ${step.className}: `;
    default:
      return '';
  }
}

const firstLine = (source: string): string => source.split('\n')[0]?.trim() ?? '';

/**
 * The File In command: pick one or more `.gs` files and read them into the session.
 *
 * Several files run in the order they were picked, into one combined report, so a
 * class and the classes it depends on can go in together.
 */
export async function fileInCommand(
  sessionManager: SessionManager,
  store?: vscode.Memento,
  // The session to file into, when the command was invoked from a row that names one
  // (the File In button on a session in Logins & Sessions). Without it the user is
  // asked, as any other write is.
  session?: ActiveSession,
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    title: 'File In',
    openLabel: 'File In',
    canSelectMany: true,
    defaultUri: vscode.Uri.file(rememberedDirectory(store)),
    filters: FILE_IN_FILTERS,
  });
  if (!uris || uris.length === 0) return;
  await fileInUris(sessionManager, uris, store, session);
}

/**
 * File in files already chosen — the entry point for the commands that act on a file
 * the user right-clicked or has open, where there is nothing to pick.
 */
export async function fileInUris(
  sessionManager: SessionManager,
  uris: vscode.Uri[],
  store?: vscode.Memento,
  // See {@link fileInCommand}: a session the caller already knows, from a row that
  // names one.
  target?: ActiveSession,
): Promise<void> {
  if (uris.length === 0) return;
  // resolveSession, not getSelectedSession: filing in is a write, and with several
  // sessions open the user is asked which one it lands in — unless the command came
  // from a session row, which has already answered that.
  const session = target ?? (await sessionManager.resolveSession());
  if (!session) return;

  const total = emptyOutcome();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Filing in...' },
    async (progress) => {
      for (const uri of uris) {
        progress.report({ message: path.basename(uri.fsPath) });
        // Yield so VS Code can paint before this file's work starts. The GCI calls
        // underneath are synchronous, so a single large file still blocks the
        // extension host while it goes in — this only keeps a multi-file pick from
        // looking like nothing is happening.
        await new Promise((resolve) => setTimeout(resolve, 0));
        absorb(total, fileInFile(session, uri.fsPath));
        if (total.stopped) break;
      }
    },
  );

  await rememberDirectory(store, path.dirname(uris[0].fsPath));
  writeLog(uris, total);
  await report(total);

  // New classes and methods are only visible once the panes reload. Best-effort: the
  // file-in itself has already happened, so a refresh that can't run must not turn a
  // successful file-in into a failed command.
  try {
    await vscode.commands.executeCommand('gemstone.explorer.refresh');
  } catch {
    // The Explorer isn't registered (or is mid-teardown) — nothing to refresh.
  }
}

let logChannel: vscode.OutputChannel | undefined;

/** The "GemStone File In" output channel, created on first use. */
function channel(): vscode.OutputChannel | undefined {
  if (!logChannel && vscode.window.createOutputChannel) {
    logChannel = vscode.window.createOutputChannel('GemStone File In');
  }
  return logChannel;
}

function writeLog(uris: vscode.Uri[], outcome: FileInOutcome): void {
  const log = channel();
  if (!log) return;
  log.appendLine(`File In: ${uris.map((u) => u.fsPath).join(', ')}`);
  log.appendLine(
    `  ${outcome.files} file(s), ${outcome.executed} chunk(s) run, ` +
      `${outcome.compiled} method(s) compiled, ${outcome.removed} removeAllMethods` +
      (outcome.stopped ? ', stopped at exit' : ''),
  );
  for (const note of outcome.ignored) {
    log.appendLine(`  ignored ${note.file}:${note.line} — ${note.message}`);
  }
  for (const note of outcome.skipped) {
    log.appendLine(`  skipped ${note.file}:${note.line} — ${note.message}`);
  }
  for (const note of outcome.errors) {
    log.appendLine(`  ERROR ${note.file}:${note.line} — ${note.message}`);
  }
  log.appendLine('');
}

/** Summarise to the user, with a way to the detail when there is any. */
async function report(outcome: FileInOutcome): Promise<void> {
  const counts =
    `${outcome.compiled} method(s), ${outcome.executed} chunk(s) from ` +
    `${outcome.files} file(s)`;
  const SHOW_LOG = 'Show Log';

  if (outcome.errors.length > 0) {
    const first = outcome.errors[0];
    const choice = await vscode.window.showErrorMessage(
      `File in finished with ${outcome.errors.length} error(s) — ${counts} went in. ` +
        `First: ${path.basename(first.file)}:${first.line} ${first.message}`,
      SHOW_LOG,
    );
    if (choice === SHOW_LOG) channel()?.show(true);
    return;
  }

  const notes: string[] = [];
  if (outcome.stopped) notes.push('Stopped where the file said exit.');
  if (outcome.skipped.length > 0) {
    notes.push(`${outcome.skipped.length} directive(s) not recognised.`);
  }
  if (outcome.ignored.length > 0) {
    notes.push(`${outcome.ignored.length} topaz command(s) not run.`);
  }
  // Said every time: a file-in that isn't committed disappears at the next abort, and
  // Jasper never commits on the user's behalf — least of all because a file said to.
  notes.push(
    outcome.askedToCommit
      ? 'The file asked to commit; Jasper did not — commit the session to keep this.'
      : 'Not committed — commit the session to keep it.',
  );

  const hasDetail = outcome.skipped.length > 0 || outcome.ignored.length > 0;
  const choice = await vscode.window.showInformationMessage(
    `Filed in ${counts}. ${notes.join(' ')}`,
    ...(hasDetail ? [SHOW_LOG] : []),
  );
  if (choice === SHOW_LOG) channel()?.show(true);
}
