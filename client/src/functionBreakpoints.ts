import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { MethodSearchResult } from './browserQueries';
import { buildLineStarts, lineOfOffset } from './stepPointModel';
import { logInfo } from './gciLog';

/** A method name typed into the Breakpoints panel, taken apart. */
export interface ParsedFunctionName {
  /** Class the name named, or undefined when it named a bare selector. */
  className?: string;
  isMeta: boolean;
  selector: string;
}

/**
 * Read a name typed into VS Code's Breakpoints panel as Smalltalk method
 * coordinates.
 *
 * Accepts what a Smalltalker would actually type: `Account>>balance`,
 * `Account class>>new`, either with a `#` on the selector, and a bare `balance`
 * meaning "whoever implements it". The selector half is taken verbatim rather
 * than pattern-matched, because binary selectors (`+`, `,`, `//`) and keyword
 * selectors (`at:put:`) are all legal and none of them look like an identifier.
 *
 * Returns null for something that can't be a method name at all.
 */
export function parseFunctionName(raw: string): ParsedFunctionName | null {
  const name = raw.trim();
  if (name.length === 0) return null;

  // `Account class >> new` — metaclass first, since its class name half would
  // otherwise match the instance-side pattern with 'Account class' left over.
  const meta = name.match(/^([A-Za-z_]\w*)\s+class\s*>>\s*#?\s*(.+)$/);
  if (meta) return { className: meta[1], isMeta: true, selector: meta[2].trim() };

  const inst = name.match(/^([A-Za-z_]\w*)\s*>>\s*#?\s*(.+)$/);
  if (inst) return { className: inst[1], isMeta: false, selector: inst[2].trim() };

  // A bare selector. Reject anything holding '>>', which was a qualified name
  // the patterns above failed on — a malformed class half, most likely.
  if (name.includes('>>')) return null;
  return { isMeta: false, selector: name.replace(/^#\s*/, '') };
}

/** How a name should be shown once it has been pinned to one class. */
export function qualifiedName(target: MethodSearchResult): string {
  return `${target.className}${target.isMeta ? ' class' : ''}>>${target.selector}`;
}

/**
 * Turns a *function* breakpoint — the kind VS Code's `+` button creates, named
 * rather than located — into an ordinary breakpoint on the method's entry.
 *
 * Function breakpoints are the natural way to say "stop when this method runs"
 * without going and finding it first, and GemStone can honour that: break at
 * step point 1 and execution stops on entry. But VS Code leaves resolving the
 * *name* entirely to the debugger, so unresolved it is inert.
 *
 * Rather than carry a second, parallel kind of breakpoint through the whole
 * model, each one is **converted**: resolve the name to a class, work out where
 * that method's first step point is, and replace it with a `SourceBreakpoint`
 * there. It then behaves like every other breakpoint — a real red dot with a
 * location, enable/disable, dying with its session, and showing up in the
 * GemStone Breakpoints view — with no chance of the two kinds fighting over
 * which one owns a method's breakpoints.
 */
export class FunctionBreakpointResolver {
  /**
   * Names being resolved right now. Choosing a class is a prompt, so a second
   * change event can arrive mid-await; without this the same name would be
   * resolved twice and set two breakpoints.
   */
  private inFlight = new Set<string>();

  constructor(private sessionManager: SessionManager) {}

  /**
   * Resolve and convert every function breakpoint among `breakpoints`.
   *
   * Callers must pass **both** the added and the changed breakpoints. VS Code's
   * `+` button creates the breakpoint *first*, with an empty name, and only then
   * opens it for editing — so the name a developer types arrives as a *change*,
   * not as an addition. Watching additions alone sees nothing but the blank.
   *
   * A blank name is therefore left strictly alone: it means "still being typed",
   * and treating it as unresolvable deleted the row out from under the developer
   * before they could type into it.
   *
   * Never rejects. The caller fires this without awaiting (resolution can
   * prompt), so a thrown error would otherwise vanish into an unhandled
   * rejection and the breakpoint would just sit there doing nothing — the exact
   * failure this class exists to remove.
   */
  async handle(breakpoints: readonly vscode.Breakpoint[]): Promise<void> {
    const named = breakpoints.filter(
      (bp): bp is vscode.FunctionBreakpoint =>
        bp instanceof vscode.FunctionBreakpoint && bp.functionName.trim().length > 0,
    );
    for (const bp of named) {
      if (this.inFlight.has(bp.functionName)) continue;
      this.inFlight.add(bp.functionName);
      try {
        await this.convert(bp);
      } catch (e) {
        logInfo(`[breakpoints] resolving "${bp.functionName}" failed: ${message(e)}`);
        this.reject(bp, `Could not set a breakpoint for ${bp.functionName}: ${message(e)}`);
      } finally {
        this.inFlight.delete(bp.functionName);
      }
    }
  }

  private async convert(bp: vscode.FunctionBreakpoint): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      this.reject(bp, 'No active GemStone session — log in, then add the breakpoint again.');
      return;
    }

    const parsed = parseFunctionName(bp.functionName);
    if (!parsed) {
      this.reject(
        bp,
        `"${bp.functionName}" is not a method name. Use a selector (balance), ` +
          'or qualify it (Account>>balance, Account class>>new).',
      );
      return;
    }

    let candidates: MethodSearchResult[];
    try {
      candidates = this.findCandidates(session, parsed);
    } catch (e) {
      this.reject(bp, `Could not look up ${bp.functionName}: ${message(e)}`);
      return;
    }

    logInfo(
      `[breakpoints] "${bp.functionName}" parsed as ${describe(parsed)}; ` +
        `${candidates.length} candidate(s): ${candidates.map(qualifiedName).join(', ') || 'none'}`,
    );

    if (candidates.length === 0) {
      this.reject(bp, `Nothing implements ${describe(parsed)}.`);
      return;
    }

    const target =
      candidates.length === 1 ? candidates[0] : await this.chooseClass(candidates, parsed.selector);
    if (!target) {
      // The developer dismissed the picker. Drop the breakpoint rather than
      // leave an unresolved one sitting in the panel looking live.
      this.reject(bp, `No class chosen — breakpoint for ${parsed.selector} not set.`);
      return;
    }

    const entry = this.entryPosition(session, target);
    if (!entry) {
      this.reject(bp, `${qualifiedName(target)} has no step points to break at.`);
      return;
    }

    // implementorsOf reports no dictionary for a class not bound under its own
    // name in the symbol list. The method URI needs one, and an empty segment
    // builds a URI the file system provider cannot resolve — so say so rather
    // than hand back a breakpoint that silently points nowhere.
    if (target.dictName === '') {
      this.reject(
        bp,
        `Could not tell which dictionary holds ${target.className} — ` +
          'set the breakpoint from the method source instead.',
      );
      return;
    }

    const uri = buildMethodUri({
      kind: 'method',
      sessionId: session.id,
      dictName: target.dictName,
      className: target.className,
      isMeta: target.isMeta,
      category: target.category || 'other',
      selector: target.selector,
      environmentId: entry.environmentId,
    });

    logInfo(
      `[breakpoints] ${qualifiedName(target)} entry is line ${entry.line} col ${entry.character}; ` +
        `converting to ${uri.toString()}`,
    );

    // Replace, don't add alongside: the function breakpoint has done its job as
    // a way of naming a method, and leaving it would show two rows for one break.
    vscode.debug.removeBreakpoints([bp]);
    vscode.debug.addBreakpoints([
      new vscode.SourceBreakpoint(
        new vscode.Location(uri, new vscode.Position(entry.line - 1, entry.character)),
        bp.enabled,
        bp.condition,
        bp.hitCondition,
        bp.logMessage,
      ),
    ]);
  }

  /**
   * Every method the name could mean. A qualified name is taken at its word — a
   * developer who wrote `Account>>balance` does not want a list — while a bare
   * selector is looked up across the image.
   */
  private findCandidates(session: ActiveSession, parsed: ParsedFunctionName): MethodSearchResult[] {
    // Sweep environments 0..maxEnvironment rather than searching the maximum
    // alone. `gemstone.maxEnvironment` is a ceiling, not a selection — querying
    // only that number skips environment 0, where practically every method
    // lives, so on a stone configured above 0 nothing would ever be found.
    const maxEnv = maxEnvironment();
    const found: MethodSearchResult[] = [];
    const seen = new Set<string>();

    for (let environmentId = 0; environmentId <= maxEnv; environmentId++) {
      for (const m of queries.implementorsOf(session, parsed.selector, environmentId)) {
        if (m.selector !== parsed.selector) continue;
        // Confirm a named class really implements it, rather than trusting the
        // typing and setting a breakpoint that silently never fires.
        if (parsed.className !== undefined) {
          if (m.className !== parsed.className || m.isMeta !== parsed.isMeta) continue;
        }
        // Deliberately NOT `dedupeMethodResults`, which counts the environment as
        // part of a method's identity because a reference list has to account for
        // every method. This is a chooser, not a list: one class is one entry, and
        // asking "which Account did you mean?" about the same class twice is no
        // question at all. The lowest environment to implement it wins, and the row
        // carries that environment on to where the breakpoint is set. The scan in
        // __tests__/methodResultDedupe.manifest.test.ts allows this file for that
        // reason — keep the two in step.
        const key = `${m.className}|${m.isMeta}|${m.selector}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(m);
      }
    }
    return found;
  }

  private async chooseClass(
    candidates: MethodSearchResult[],
    selector: string,
  ): Promise<MethodSearchResult | undefined> {
    const items = candidates
      .map((target) => ({
        label: `${target.className}${target.isMeta ? ' class' : ''}`,
        description: target.dictName,
        detail: target.category,
        target,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const picked = await vscode.window.showQuickPick(items, {
      title: `Break on entry to #${selector}`,
      placeHolder: `${candidates.length} classes implement #${selector} — choose one`,
      matchOnDescription: true,
    });
    return picked?.target;
  }

  /**
   * Where the method's first step point sits, as a 1-based line and a 0-based
   * column. Computed against the *stone's* source, which is the only copy
   * available for a method whose editor was never opened.
   */
  private entryPosition(
    session: ActiveSession,
    target: MethodSearchResult,
  ): { line: number; character: number; environmentId: number } | null {
    // The environment the method was actually found in — not the configured
    // ceiling, which is very likely a different one.
    const environmentId = target.environmentId;
    try {
      const offsets = queries.getSourceOffsets(
        session,
        target.className,
        target.isMeta,
        target.selector,
        environmentId,
      );
      if (offsets.length === 0) return null;

      const source = queries.getMethodSource(
        session,
        target.className,
        target.isMeta,
        target.selector,
        environmentId,
      );
      const lineStarts = buildLineStarts(source);
      const offset = offsets[0] - 1; // _sourceOffsets is 1-based
      const line = lineOfOffset(lineStarts, offset);
      return { line, character: offset - lineStarts[line], environmentId };
    } catch {
      return null;
    }
  }

  /** Drop a function breakpoint that cannot be honoured, and say why. */
  private reject(bp: vscode.FunctionBreakpoint, reason: string): void {
    vscode.debug.removeBreakpoints([bp]);
    vscode.window.showWarningMessage(reason);
  }
}

function describe(parsed: ParsedFunctionName): string {
  return parsed.className === undefined
    ? `#${parsed.selector}`
    : `${parsed.className}${parsed.isMeta ? ' class' : ''}>>${parsed.selector}`;
}

function maxEnvironment(): number {
  return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
