import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseMethodUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { GemStoneBreakpoint } from './browserQueries';
import {
  StepPointModel,
  StepPointInfo,
  resolveStepPoint,
  stepPointAtOffset,
  rangesForStepPoint,
} from './stepPointModel';

export interface VerifiedBreakpoint {
  stepPoint: number;
  actualLine: number;
  verified: boolean;
}

/** A breakpoint as it now stands in the gem, for one method. */
export interface AppliedBreakpoint {
  stepPoint: number;
  /** 0-based offset into the stone's source. */
  offset: number;
  /** 1-based line in the stone's source. */
  line: number;
  enabled: boolean;
}

const enabledDecoration = vscode.window.createTextEditorDecorationType({
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  borderRadius: '2px',
  overviewRulerColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

// Dashed and drawn in the "unverified" grey so a disabled breakpoint reads as
// present-but-inert at a glance, the way the gutter dot hollows out.
const disabledDecoration = vscode.window.createTextEditorDecorationType({
  borderWidth: '1px',
  borderStyle: 'dashed',
  borderColor: new vscode.ThemeColor('debugIcon.breakpointDisabledForeground'),
  borderRadius: '2px',
});

/**
 * Applies Jasper's breakpoints to a GemStone session and keeps the two in step.
 *
 * **VS Code's breakpoint list is the working model, for the life of a session.**
 * Expressing breakpoints as `vscode.debug.breakpoints` is what makes the gutter,
 * the per-breakpoint enable checkbox and the built-in Enable/Disable/Remove All
 * commands drive GemStone for free — they arrive here as
 * `onDidChangeBreakpoints`.
 *
 * It is **not** a durable record, though, and deliberately so. GemStone method
 * breakpoints are per-gem VM state: they do not survive logout, and a `commit`
 * does not persist them (verified against 3.6.2 and 3.7.5). A breakpoint that
 * outlived its session would be a marker pointing at a gem that no longer
 * exists — promising to stop execution it cannot stop. So logging out takes the
 * session's breakpoints out of VS Code's list with it, and anything VS Code's
 * own cross-restart persistence brings back is pruned. See `pruneOrphans` and
 * `clearAllForSession`.
 *
 * Step point precision rides on the breakpoint's **column**: a gutter click has
 * none and means "the leftmost step point on this line", while an inline
 * breakpoint or Jasper's toggle-at-cursor carries the exact column and picks the
 * step point nearest it. See `resolveStepPoint`.
 *
 * A *disabled* breakpoint is applied as set-then-disabled rather than left off
 * the stone, so stepping past it is instant to re-arm and the breakpoint
 * manager view can show it. `disableBreakAtStepPoint:` is a no-op on a step
 * point with no breakpoint, hence the two calls.
 */
export class BreakpointManager {
  /** What we last applied, per method URI — drives decorations and re-application. */
  private applied = new Map<string, AppliedBreakpoint[]>();

  private _onDidApply = new vscode.EventEmitter<void>();
  /** Fires after breakpoints are pushed to the gem, so views can refresh. */
  readonly onDidApply = this._onDidApply.event;

  constructor(
    private sessionManager: SessionManager,
    private stepPoints: StepPointModel,
  ) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this._onDidApply,
      vscode.debug.onDidChangeBreakpoints((e) => this.onBreakpointsChanged(e)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.refreshDecorations(editor);
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this.refreshDecorations(editor);
      }),
    );
  }

  // ── Applying ─────────────────────────────────────────────

  /**
   * Push every VS Code breakpoint on `uri` to the gem, replacing whatever the
   * method had. Returns one verified result per requested line, in order, for
   * the debug adapter's `setBreakpoints` response.
   *
   * `requests` carries the raw line/column pairs. When omitted, they are read
   * from `vscode.debug.breakpoints` — the absolute model: whatever is in VS
   * Code's list right now is exactly what the method ends up with.
   */
  applyToUri(
    session: ActiveSession,
    uri: vscode.Uri,
    requests?: { line: number; character?: number; enabled: boolean }[],
  ): VerifiedBreakpoint[] {
    const method = parseMethodUri(uri);
    if (!method || method.diffView) {
      return (requests ?? []).map(() => ({ stepPoint: 0, actualLine: 0, verified: false }));
    }

    const wanted = requests ?? readVsCodeBreakpoints(uri);

    // Always clear first: this is an absolute model, and a step point that used
    // to hold a breakpoint has to lose it even when nothing replaces it.
    //
    // This does take out a breakpoint on this method that Jasper did not set —
    // one from topaz, say. That is the cost of VS Code's list being the record:
    // there is no way to ask GemStone for "the breakpoints other than mine", and
    // leaving stale ones behind would be the worse failure, since a breakpoint
    // the developer removed would keep stopping execution.
    try {
      queries.clearAllBreaks(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
    } catch {
      /* the method may no longer exist — nothing to clear */
    }

    if (wanted.length === 0) {
      this.applied.delete(uri.toString());
      this.refreshEditorsFor(uri);
      this._onDidApply.fire();
      return [];
    }

    const info = this.stepPoints.fetch(session, uri, method);
    if (!info) {
      return wanted.map((r) => ({ stepPoint: 0, actualLine: r.line, verified: false }));
    }

    const results: VerifiedBreakpoint[] = [];
    // Two requests can land on the same step point — a gutter click and an
    // inline breakpoint on the same line, say. The gem has one breakpoint per
    // step point, so they collapse, and the step point stays armed if *any* of
    // them is enabled.
    const byStepPoint = new Map<number, AppliedBreakpoint>();

    for (const req of wanted) {
      const resolved = resolveStepPoint(info, req.line, req.character);
      if (!resolved) {
        results.push({ stepPoint: 0, actualLine: req.line, verified: false });
        continue;
      }
      results.push({
        stepPoint: resolved.stepPoint,
        actualLine: resolved.line,
        verified: true,
      });
      const existing = byStepPoint.get(resolved.stepPoint);
      byStepPoint.set(resolved.stepPoint, {
        stepPoint: resolved.stepPoint,
        offset: resolved.offset,
        line: resolved.line,
        enabled: (existing?.enabled ?? false) || req.enabled,
      });
    }

    const applied: AppliedBreakpoint[] = [];
    for (const bp of byStepPoint.values()) {
      try {
        queries.setBreakAtStepPoint(
          session,
          method.className,
          method.isMeta,
          method.selector,
          bp.stepPoint,
          method.environmentId,
        );
        if (!bp.enabled) {
          queries.disableBreakAtStepPoint(
            session,
            method.className,
            method.isMeta,
            method.selector,
            bp.stepPoint,
            method.environmentId,
          );
        }
        applied.push(bp);
      } catch {
        // Mark every result that resolved to this step point unverified.
        for (const r of results) {
          if (r.stepPoint === bp.stepPoint) r.verified = false;
        }
      }
    }

    if (applied.length > 0) this.applied.set(uri.toString(), applied);
    else this.applied.delete(uri.toString());

    this.refreshEditorsFor(uri);
    this._onDidApply.fire();
    return results;
  }

  /**
   * The debug adapter's entry point: apply breakpoints given as lines (and
   * optional columns), which is all the Debug Adapter Protocol carries.
   */
  setBreakpointsForSource(
    session: ActiveSession,
    uri: vscode.Uri,
    lines: number[],
    columns?: (number | undefined)[],
  ): VerifiedBreakpoint[] {
    return this.applyToUri(
      session,
      uri,
      lines.map((line, i) => ({
        line,
        // DAP columns are 1-based; our resolver takes a 0-based character.
        character: columns?.[i] === undefined ? undefined : Math.max(columns[i] - 1, 0),
        enabled: true,
      })),
    );
  }

  /**
   * Drop every GemStone breakpoint with no live session behind it.
   *
   * VS Code persists its breakpoint list and restores it at startup, which is
   * right for a file but wrong for us: a GemStone breakpoint lives in the gem,
   * so it dies with the session. A restored marker would point at a gem that no
   * longer exists — a red dot promising to stop execution that cannot stop
   * anything. Rather than re-apply it to whatever session logs in next (which
   * would resurrect a breakpoint in a stone nobody asked about), it goes.
   *
   * Method URIs carry the session id, so "live" means a session of that id is
   * logged in right now. Returns how many were dropped.
   */
  pruneOrphans(): number {
    const live = new Set(this.sessionManager.getSessions().map((s) => `gemstone://${s.id}/`));
    const orphans = gemstoneBreakpoints().filter(
      (bp) => ![...live].some((prefix) => bp.location.uri.toString().startsWith(prefix)),
    );
    if (orphans.length > 0) vscode.debug.removeBreakpoints(orphans);
    return orphans.length;
  }

  // ── Editor commands ──────────────────────────────────────

  /**
   * Toggle a breakpoint at the caret's step point.
   *
   * Adds or removes a *native* VS Code breakpoint rather than tracking one
   * privately, so it shows up in the Breakpoints view with its enable checkbox
   * and is picked up by Enable/Disable/Remove All like any other. The position
   * is the step point's own offset, which is what makes it an inline breakpoint
   * VS Code will hand back to us with a column.
   */
  toggleAtCursor(editor: vscode.TextEditor): void {
    const found = this.stepPointAtCursor(editor);
    if (!found) return;
    const { info, resolved } = found;

    const existing = this.vsCodeBreakpointFor(editor.document.uri, info, resolved.stepPoint);
    if (existing) {
      vscode.debug.removeBreakpoints([existing]);
    } else {
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(
          new vscode.Location(editor.document.uri, positionOf(editor.document, resolved.offset)),
        ),
      ]);
    }
  }

  /**
   * Enable or disable the breakpoint at the caret's step point.
   *
   * VS Code makes `Breakpoint.enabled` read-only, so flipping it means removing
   * the breakpoint and adding an equivalent one — carrying the condition, hit
   * condition and log message across so an enable/disable round trip doesn't
   * quietly discard them.
   */
  setEnabledAtCursor(editor: vscode.TextEditor, enabled: boolean): void {
    const found = this.stepPointAtCursor(editor);
    if (!found) return;
    const { info, resolved } = found;

    const existing = this.vsCodeBreakpointFor(editor.document.uri, info, resolved.stepPoint);
    if (!existing) {
      if (!enabled) return; // nothing there to disable
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(
          new vscode.Location(editor.document.uri, positionOf(editor.document, resolved.offset)),
        ),
      ]);
      return;
    }
    if (existing.enabled === enabled) return;
    replaceEnabled([existing], enabled);
  }

  /**
   * Toggle the breakpoint at a step point named outright, rather than found from
   * the caret — what a click on an inlay hint number or a hover link does. The
   * developer pointed at a specific step point, so there is nothing to resolve.
   */
  toggleAtStepPoint(uri: vscode.Uri, stepPoint: number): void {
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    const existing = this.vsCodeBreakpointFor(uri, ctx.info, stepPoint);
    if (existing) {
      vscode.debug.removeBreakpoints([existing]);
      return;
    }
    const at = ctx.info.offsets[stepPoint - 1];
    if (at === undefined) return;
    vscode.debug.addBreakpoints([
      new vscode.SourceBreakpoint(new vscode.Location(uri, ctx.document.positionAt(at))),
    ]);
  }

  /** Enable or disable the breakpoint at a named step point. */
  setEnabledAtStepPoint(uri: vscode.Uri, stepPoint: number, enabled: boolean): void {
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    const existing = this.vsCodeBreakpointFor(uri, ctx.info, stepPoint);
    if (!existing) {
      if (enabled) this.toggleAtStepPoint(uri, stepPoint);
      return;
    }
    if (existing.enabled !== enabled) replaceEnabled([existing], enabled);
  }

  /** Clear the breakpoint at a named step point. */
  clearAtStepPoint(uri: vscode.Uri, stepPoint: number): void {
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    const existing = this.vsCodeBreakpointFor(uri, ctx.info, stepPoint);
    if (existing) vscode.debug.removeBreakpoints([existing]);
  }

  /**
   * The open document for `uri` and its step points. Only an *open* document
   * will do — these entry points are all driven by a click in one, and the
   * document is what turns a step point offset back into a position.
   */
  private contextFor(
    uri: vscode.Uri,
  ): { document: vscode.TextDocument; info: StepPointInfo } | null {
    const uriStr = uri.toString();
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriStr);
    if (!document) return null;
    const info = this.stepPoints.get(document);
    if (!info) return null;
    return { document, info };
  }

  /** Clear every breakpoint in the method the caret is in. */
  clearMethodBreakpoints(editor: vscode.TextEditor): void {
    const uriStr = editor.document.uri.toString();
    const mine = vscode.debug.breakpoints.filter(
      (bp) => bp instanceof vscode.SourceBreakpoint && bp.location.uri.toString() === uriStr,
    );
    if (mine.length > 0) vscode.debug.removeBreakpoints(mine);
  }

  /** The step point under the caret, with the method's step point info. */
  stepPointAtCursor(
    editor: vscode.TextEditor,
  ): { info: StepPointInfo; resolved: NonNullable<ReturnType<typeof stepPointAtOffset>> } | null {
    // Every failure here says so. These commands are invoked deliberately — from
    // a keystroke, a menu, or the palette — and a silent no-op is unreadable:
    // "nothing happened" looks exactly like a broken keybinding, so the developer
    // has no way to tell an unsaved buffer from a command that never fired.
    const result = this.stepPoints.explain(editor.document);
    if ('problem' in result) {
      vscode.window.showWarningMessage(result.problem);
      return null;
    }
    const info = result.info;

    const resolved = stepPointAtOffset(info, editor.document.offsetAt(editor.selection.active));
    if (!resolved) {
      vscode.window.showWarningMessage(
        'No step point at or after the cursor — put it on the code you want to break at.',
      );
      return null;
    }
    return { info, resolved };
  }

  // ── Session-wide operations ──────────────────────────────

  /**
   * Enable or disable every GemStone breakpoint.
   *
   * Flips Jasper's own breakpoints in VS Code's model first — that's the durable
   * record, and it re-applies them through `onDidChangeBreakpoints` — then
   * sweeps the gem, which also catches breakpoints Jasper never set (from topaz,
   * another tool, or a `halt` in the code). "All" has to mean all of them.
   */
  setAllEnabled(enabled: boolean): void {
    const mine = gemstoneBreakpoints().filter((bp) => bp.enabled !== enabled);
    if (mine.length > 0) replaceEnabled(mine, enabled);

    const session = this.sessionManager.getSelectedSession();
    if (!session) return;
    try {
      if (enabled) queries.enableAllBreakpoints(session);
      else queries.disableAllBreakpoints(session);
    } catch (e) {
      vscode.window.showErrorMessage(
        `Could not ${enabled ? 'enable' : 'disable'} breakpoints: ${message(e)}`,
      );
      return;
    }
    this._onDidApply.fire();
  }

  /** Remove every GemStone breakpoint, in VS Code's model and in the gem. */
  removeAll(): void {
    const mine = gemstoneBreakpoints();
    if (mine.length > 0) vscode.debug.removeBreakpoints(mine);

    const session = this.sessionManager.getSelectedSession();
    if (session) {
      try {
        queries.removeAllBreakpoints(session);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not remove breakpoints: ${message(e)}`);
        return;
      }
    }
    this.applied.clear();
    for (const editor of vscode.window.visibleTextEditors) this.refreshDecorations(editor);
    this._onDidApply.fire();
  }

  // ── Acting on what the gem reports ───────────────────────

  /**
   * Enable or disable a breakpoint the gem reported.
   *
   * Prefers to flip the *VS Code* breakpoint behind it, when there is one: that
   * is the durable record, so flipping the gem alone would be undone the next
   * time the method's breakpoints were re-applied. A breakpoint Jasper didn't
   * set has no VS Code counterpart, so it is flipped in the gem by OOP — which
   * also means it reverts at logout, as any gem-only breakpoint does.
   */
  setEnabledForStoneBreakpoint(bp: GemStoneBreakpoint, enabled: boolean): void {
    const owned = this.ownedBreakpoint(bp);
    if (owned) {
      if (owned.enabled !== enabled) replaceEnabled([owned], enabled);
      return;
    }
    this.byOop(bp, enabled ? 'setBreakAtStepPoint:' : 'disableBreakAtStepPoint:');
  }

  /** Remove a breakpoint the gem reported — from VS Code's list when it's ours. */
  removeStoneBreakpoint(bp: GemStoneBreakpoint): void {
    const owned = this.ownedBreakpoint(bp);
    if (owned) {
      vscode.debug.removeBreakpoints([owned]);
      return;
    }
    this.byOop(bp, 'clearBreakAtStepPoint:');
  }

  /**
   * The VS Code breakpoint behind a gem-reported one, or undefined when Jasper
   * didn't set it. Matched on the method coordinates we applied plus the step
   * point, rather than on the gem's dictionary/category strings, so it still
   * matches when the same class name is bound in more than one dictionary.
   */
  private ownedBreakpoint(bp: GemStoneBreakpoint): vscode.SourceBreakpoint | undefined {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return undefined;

    for (const [uriStr, applied] of this.applied) {
      if (!applied.some((a) => a.stepPoint === bp.stepPoint)) continue;
      const uri = vscode.Uri.parse(uriStr);
      const method = parseMethodUri(uri);
      if (!method) continue;
      if (
        method.className !== bp.className ||
        method.isMeta !== bp.isMeta ||
        method.selector !== bp.selector ||
        method.environmentId !== bp.environmentId
      ) {
        continue;
      }
      const info = this.stepPoints.fetch(session, uri, method);
      if (!info) continue;
      return this.vsCodeBreakpointFor(uri, info, bp.stepPoint);
    }
    return undefined;
  }

  private byOop(
    bp: GemStoneBreakpoint,
    op: 'setBreakAtStepPoint:' | 'disableBreakAtStepPoint:' | 'clearBreakAtStepPoint:',
  ): void {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;
    try {
      queries.breakpointByOop(session, bp.methodOop, op, bp.stepPoint);
    } catch (e) {
      vscode.window.showErrorMessage(`Breakpoint operation failed: ${message(e)}`);
      return;
    }
    this._onDidApply.fire();
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Called after a method is recompiled. Recompiling replaces the `GsNMethod`,
   * so the gem's breakpoints on the old one are gone and its step point offsets
   * may have moved — drop the cache and re-apply from VS Code's model.
   */
  invalidateForUri(uri: vscode.Uri): void {
    this.stepPoints.invalidate(uri);
    this.applied.delete(uri.toString());

    const session = this.sessionManager.getSelectedSession();
    if (!session) return;
    if (readVsCodeBreakpoints(uri).length === 0) {
      this.refreshEditorsFor(uri);
      return;
    }
    this.applyToUri(session, uri);
  }

  /** Called when a session logs out — its gem, and our view of it, are gone. */
  clearAllForSession(sessionId: number): void {
    const prefix = `gemstone://${sessionId}/`;

    // The gem is gone, so its breakpoints are gone — including VS Code's record
    // of them. Leaving those behind would show a marker for a breakpoint that no
    // longer exists anywhere, and VS Code would then persist it past this window.
    const stale = gemstoneBreakpoints().filter((bp) =>
      bp.location.uri.toString().startsWith(prefix),
    );
    if (stale.length > 0) vscode.debug.removeBreakpoints(stale);

    for (const key of [...this.applied.keys()]) {
      if (key.startsWith(prefix)) this.applied.delete(key);
    }
    this.stepPoints.invalidateSession(sessionId);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString().startsWith(prefix)) {
        editor.setDecorations(enabledDecoration, []);
        editor.setDecorations(disabledDecoration, []);
      }
    }
    this._onDidApply.fire();
  }

  // ── Decorations ──────────────────────────────────────────

  /**
   * Mark the exact token each breakpoint sits on. The gutter dot already says
   * "this line has a breakpoint"; a Smalltalk line routinely holds several step
   * points, so the token marker is what says *which one*.
   */
  refreshDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== 'gemstone') return;

    const applied = this.applied.get(editor.document.uri.toString());
    if (!applied || applied.length === 0) {
      editor.setDecorations(enabledDecoration, []);
      editor.setDecorations(disabledDecoration, []);
      return;
    }

    const info = this.stepPoints.get(editor.document);
    if (!info) return;

    const on: vscode.Range[] = [];
    const off: vscode.Range[] = [];
    for (const bp of applied) {
      for (const r of rangesForStepPoint(info, bp.stepPoint)) {
        const range = new vscode.Range(
          positionOf(editor.document, r.start),
          positionOf(editor.document, r.end),
        );
        (bp.enabled ? on : off).push(range);
      }
    }
    editor.setDecorations(enabledDecoration, on);
    editor.setDecorations(disabledDecoration, off);
  }

  /** What we last applied to `uri`, for the breakpoint manager view. */
  appliedFor(uri: vscode.Uri): AppliedBreakpoint[] {
    return this.applied.get(uri.toString()) ?? [];
  }

  // ── Internals ────────────────────────────────────────────

  /**
   * The VS Code breakpoint on `uri` that resolves to `stepPoint`. Resolution
   * runs through the same rule the applier uses, so a gutter breakpoint on a
   * line whose leftmost step point is the caret's is recognised as *the same
   * breakpoint* — otherwise toggling at the caret would stack a second
   * breakpoint on a step point that already has one.
   */
  private vsCodeBreakpointFor(
    uri: vscode.Uri,
    info: StepPointInfo,
    stepPoint: number,
  ): vscode.SourceBreakpoint | undefined {
    const uriStr = uri.toString();
    for (const bp of vscode.debug.breakpoints) {
      if (!(bp instanceof vscode.SourceBreakpoint)) continue;
      if (bp.location.uri.toString() !== uriStr) continue;
      const start = bp.location.range.start;
      const resolved = resolveStepPoint(
        info,
        start.line + 1,
        start.character === 0 ? undefined : start.character,
      );
      if (resolved?.stepPoint === stepPoint) return bp;
    }
    return undefined;
  }

  private onBreakpointsChanged(event: vscode.BreakpointsChangeEvent): void {
    // Catches a startup restore that lands after activation, and a gutter click
    // in a stale editor from a session that has since logged out. Pruning is
    // idempotent, and the removal it triggers re-enters here with nothing left
    // to prune, so this does not loop.
    if (event.added.length > 0) this.pruneOrphans();

    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    const affected = new Set<string>();
    for (const bp of [...event.added, ...event.removed, ...event.changed]) {
      if (bp instanceof vscode.SourceBreakpoint && bp.location.uri.scheme === 'gemstone') {
        affected.add(bp.location.uri.toString());
      }
    }
    for (const uriStr of affected) {
      this.applyToUri(session, vscode.Uri.parse(uriStr));
    }
  }

  private refreshEditorsFor(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uriStr) this.refreshDecorations(editor);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

/** Every VS Code source breakpoint on a `gemstone://` URI. */
export function gemstoneBreakpoints(): vscode.SourceBreakpoint[] {
  return vscode.debug.breakpoints.filter(
    (bp) => bp instanceof vscode.SourceBreakpoint && bp.location.uri.scheme === 'gemstone',
  ) as vscode.SourceBreakpoint[];
}

/**
 * VS Code's breakpoints on one method, as apply requests. Lines come out 1-based
 * (VS Code counts from 0) and a column-0 breakpoint reports no column at all, so
 * a gutter click stays distinguishable from an inline breakpoint in column 0.
 */
function readVsCodeBreakpoints(
  uri: vscode.Uri,
): { line: number; character?: number; enabled: boolean }[] {
  const uriStr = uri.toString();
  return gemstoneBreakpoints()
    .filter((bp) => bp.location.uri.toString() === uriStr)
    .map((bp) => {
      const start = bp.location.range.start;
      return {
        line: start.line + 1,
        character: start.character === 0 ? undefined : start.character,
        enabled: bp.enabled,
      };
    });
}

/**
 * Re-add `breakpoints` with a new enabled flag. `Breakpoint.enabled` is
 * read-only in the VS Code API, so this is the only way to flip it; condition,
 * hit condition and log message ride along so they survive the round trip.
 */
function replaceEnabled(breakpoints: vscode.SourceBreakpoint[], enabled: boolean): void {
  const replacements = breakpoints.map(
    (bp) =>
      new vscode.SourceBreakpoint(
        bp.location,
        enabled,
        bp.condition,
        bp.hitCondition,
        bp.logMessage,
      ),
  );
  vscode.debug.removeBreakpoints(breakpoints);
  vscode.debug.addBreakpoints(replacements);
}

function positionOf(document: vscode.TextDocument, offset: number): vscode.Position {
  return document.positionAt(offset);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Build a table of character offsets for the start of each line (1-based).
 * lineOffsets[1] = 0 (first line starts at offset 0)
 * lineOffsets[2] = position after first newline
 * etc.
 */
export function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0]; // dummy at index 0
  offsets.push(0); // line 1 starts at offset 0

  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Map a precise 0-based cursor offset to a step point — column-aware, for "Run to
 * Cursor". Prefers the step point on the cursor's OWN line that is nearest the
 * cursor column, so a cursor on `asInteger` in `x := (...) asInteger` breaks at
 * `asInteger` (not the leftmost `:=` store), and a cursor inside a one-line block
 * (`self do: [:e | body ]`) breaks INSIDE the block (not at the `do:` send). When
 * the cursor's line has no step point, falls back to the nearest step point at or
 * after the cursor (run forward). Returns null when nothing is at/after it.
 *
 * `sourceOffsets` are GemStone 1-based source positions; `lineStart`/`lineEnd` are
 * the 0-based char offsets bounding the cursor's line (end exclusive).
 */
export function mapOffsetToStepPoint(
  cursorOffset: number,
  sourceOffsets: number[],
  lineStart: number,
  lineEnd: number,
): { stepPoint: number; offset: number } | null {
  // 1) Nearest step point on the cursor's own line (by column distance).
  let bestOnLine: { stepPoint: number; offset: number; dist: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const off0 = sourceOffsets[i] - 1; // 1-based source position → 0-based char offset
    if (off0 >= lineStart && off0 < lineEnd) {
      const dist = Math.abs(off0 - cursorOffset);
      if (bestOnLine === null || dist < bestOnLine.dist) {
        bestOnLine = { stepPoint: i + 1, offset: sourceOffsets[i], dist };
      }
    }
  }
  if (bestOnLine) return { stepPoint: bestOnLine.stepPoint, offset: bestOnLine.offset };

  // 2) No step point on this line — run forward to the nearest one after the cursor.
  let bestAfter: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const off0 = sourceOffsets[i] - 1;
    if (off0 >= cursorOffset && (bestAfter === null || sourceOffsets[i] < bestAfter.offset)) {
      bestAfter = { stepPoint: i + 1, offset: sourceOffsets[i] };
    }
  }
  return bestAfter;
}

/**
 * Map a source line number (1-based) to a step point.
 * Returns the step point number and the actual line it maps to,
 * or null if no valid step point can be found.
 */
export function mapLineToStepPoint(
  targetLine: number,
  lineOffsets: number[],
  sourceOffsets: number[],
): { stepPoint: number; actualLine: number } | null {
  if (sourceOffsets.length === 0) return null;
  if (targetLine < 1 || targetLine >= lineOffsets.length) return null;

  const targetStart = lineOffsets[targetLine];
  const targetEnd = targetLine + 1 < lineOffsets.length ? lineOffsets[targetLine + 1] : Infinity;

  // Find step points on the target line
  let bestOnLine: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const offset = sourceOffsets[i];
    if (offset >= targetStart && offset < targetEnd) {
      if (!bestOnLine || offset < bestOnLine.offset) {
        bestOnLine = { stepPoint: i + 1, offset }; // step points are 1-based
      }
    }
  }

  if (bestOnLine) {
    return { stepPoint: bestOnLine.stepPoint, actualLine: targetLine };
  }

  // No step point on target line — find nearest step point after targetStart
  let bestAfter: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const offset = sourceOffsets[i];
    if (offset >= targetStart) {
      if (!bestAfter || offset < bestAfter.offset) {
        bestAfter = { stepPoint: i + 1, offset };
      }
    }
  }

  if (bestAfter) {
    // Find the line number for this offset
    let actualLine = 1;
    for (let l = 1; l < lineOffsets.length; l++) {
      if (lineOffsets[l] <= bestAfter.offset) {
        actualLine = l;
      } else {
        break;
      }
    }
    return { stepPoint: bestAfter.stepPoint, actualLine };
  }

  return null;
}
