import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseMethodUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { GemStoneBreakpoint } from './browserQueries';
import { FunctionBreakpointResolver } from './functionBreakpoints';
import { messageOf } from './serverPlugin/installHelpers';
import { describeMethodResult } from './methodResultsPicker';
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
  /** Why an unverified breakpoint was refused, for the debug adapter to relay. */
  message?: string;
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

/**
 * Marks the exact token a breakpoint sits on.
 *
 * The gutter dot only says "this line"; a Smalltalk line usually holds several
 * step points, so this is what says *which one*.
 *
 * Enabled and disabled are told apart mainly by **colour** — the same
 * red-versus-grey pair VS Code uses for the gutter dot itself — because a
 * dashed-versus-solid 1px border is not a difference anyone notices. The
 * disabled marker also fades its token, which reads as inert without needing the
 * border to be seen at all.
 */
const enabledDecoration = vscode.window.createTextEditorDecorationType({
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  borderRadius: '2px',
  overviewRulerColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const disabledDecoration = vscode.window.createTextEditorDecorationType({
  borderWidth: '1px',
  borderStyle: 'dashed',
  borderColor: new vscode.ThemeColor('debugIcon.breakpointDisabledForeground'),
  borderRadius: '2px',
  // Fading the token is the cue that survives a theme where the grey border is
  // nearly invisible — and "is this breakpoint live?" is exactly the question
  // the marker exists to answer.
  opacity: '0.75',
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
 * outlived the thing it was set in would be a marker promising to stop execution
 * it cannot stop. So a breakpoint is dropped from VS Code's list — not just the
 * gem — when either of those things goes away:
 *
 * - the **session** logs out (`clearAllForSession`), and anything VS Code's own
 *   cross-restart persistence brings back is pruned (`pruneOrphans`);
 * - the **method** is recompiled (`invalidateForUri`), since the new method is a
 *   different object and the same step point may now be different code.
 *
 * Step point precision rides on the breakpoint's **column**: a gutter click has
 * none and means "the leftmost step point on this line", while an inline
 * breakpoint or Jasper's toggle-at-cursor carries the exact column and picks the
 * step point nearest it. See `resolveStepPoint`.
 *
 * A breakpoint can only be set where the editor's text *is* the compiled
 * method's, so a method with unsaved edits takes no new ones and has the ones it
 * has held exactly as they are until it is clean again (`holdWhileDirty`).
 *
 * A *disabled* breakpoint is applied as set-then-disabled rather than left off
 * the stone, so stepping past it is instant to re-arm and the breakpoint
 * manager view can show it. `disableBreakAtStepPoint:` is a no-op on a step
 * point with no breakpoint, hence the two calls.
 */
export class BreakpointManager {
  /** What we last applied, per method URI — drives decorations and re-application. */
  private applied = new Map<string, AppliedBreakpoint[]>();

  /**
   * Method URIs held still because their editor has unsaved edits, so the gem
   * can catch up once it is clean again. See `holdWhileDirty`.
   */
  private frozen = new Set<string>();

  private _onDidApply = new vscode.EventEmitter<void>();
  /** Fires after breakpoints are pushed to the gem, so views can refresh. */
  readonly onDidApply = this._onDidApply.event;

  /**
   * Turns a named (function) breakpoint into a located one on the method's
   * entry. Kept here rather than wired separately so the conversion happens on
   * the same event that applies everything else.
   */
  private functionBreakpoints: FunctionBreakpointResolver;

  constructor(
    private sessionManager: SessionManager,
    private stepPoints: StepPointModel,
  ) {
    this.functionBreakpoints = new FunctionBreakpointResolver(sessionManager);
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this._onDidApply,
      vscode.debug.onDidChangeBreakpoints((e) => this.onBreakpointsChanged(e)),
      vscode.workspace.onDidChangeTextDocument((e) => this.thawIfClean(e.document)),
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
   * The live session a `gemstone://` URI belongs to — the gem that actually
   * holds this method — or undefined when no such session is logged in.
   *
   * Not `getSelectedSession()`. A method editor stays bound to the session it
   * was opened from while the developer switches the active one (see "Single vs.
   * multiple sessions" in the README), so with more than one session live the
   * selected session is routinely *not* the one holding the method on screen.
   * Applying a breakpoint against it would clear and arm step points in the
   * wrong stone: the method on screen would never stop, and a method the
   * developer never touched in the other session would.
   *
   * The URI's session id is the authority, the same rule `pruneOrphans` and
   * `clearAllForSession` already use.
   */
  private sessionForUri(uri: vscode.Uri): ActiveSession | undefined {
    const method = parseMethodUri(uri);
    if (!method) return undefined;
    return this.sessionManager.getSessions().find((s) => s.id === method.sessionId);
  }

  /**
   * Push every VS Code breakpoint on `uri` to the gem, replacing whatever the
   * method had. Returns one verified result per requested line, in order, for
   * the debug adapter's `setBreakpoints` response.
   *
   * `requests` carries the raw line/column pairs. When omitted, they are read
   * from `vscode.debug.breakpoints` — the absolute model: whatever is in VS
   * Code's list right now is exactly what the method ends up with.
   *
   * Callers are responsible for not running this while the method's editor has
   * unsaved edits, when a position in VS Code's list and an offset in the
   * compiled method no longer describe the same code — see `holdWhileDirty`.
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
      // `clearAllBreaks` above has already emptied the method, so anything this
      // manager still remembers for it is a lie: left in place it keeps drawing
      // token markers, hover text and breakpoint-view rows for breaks that exist
      // in no gem. Drop the record and let the views redraw — the same thing the
      // "nothing wanted" path does — rather than returning early and leaving the
      // developer looking at markers for breakpoints that are gone.
      const reason =
        `The breakpoints in ${describeMethodResult(method)} were cleared: its step points ` +
        `could not be read. Reopen the method to set them again.`;
      this.applied.delete(uri.toString());
      this.refreshEditorsFor(uri);
      this._onDidApply.fire();
      vscode.window.showWarningMessage(reason);
      return wanted.map((r) => ({
        stepPoint: 0,
        actualLine: r.line,
        verified: false,
        message: reason,
      }));
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
    const failures: string[] = [];

    /**
     * Refuse one step point, out loud. The marker going hollow is not enough on
     * its own: an unverified marker looks exactly like a breakpoint on a line
     * with no step point, so the reason has to be both said to the developer and
     * carried back in the result for the debug adapter to relay.
     */
    const refuse = (stepPoint: number, reason: string): void => {
      failures.push(reason);
      for (const r of results) {
        if (r.stepPoint === stepPoint) {
          r.verified = false;
          r.message = reason;
        }
      }
    };

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
      } catch (e) {
        refuse(
          bp.stepPoint,
          `Could not set the breakpoint at step point ${bp.stepPoint} in ` +
            `${describeMethodResult(method)}: ${messageOf(e)}`,
        );
        continue;
      }

      if (bp.enabled) {
        applied.push(bp);
        continue;
      }

      // A disabled breakpoint is applied as set-then-disabled, so a failure here
      // leaves the step point ARMED while the developer asked for it off. A
      // marker reading "disabled" over a break that still stops execution is the
      // worst state this code can produce, so take the break back out.
      try {
        queries.disableBreakAtStepPoint(
          session,
          method.className,
          method.isMeta,
          method.selector,
          bp.stepPoint,
          method.environmentId,
        );
      } catch (e) {
        let stillArmed = ' It is still armed in the gem and will stop execution.';
        try {
          queries.clearBreakAtStepPoint(
            session,
            method.className,
            method.isMeta,
            method.selector,
            bp.stepPoint,
            method.environmentId,
          );
          stillArmed = '';
        } catch {
          /* Both calls failed; the message says the break is still armed. */
        }
        refuse(
          bp.stepPoint,
          `Could not disable the breakpoint at step point ${bp.stepPoint} in ` +
            `${describeMethodResult(method)}: ${messageOf(e)}.${stillArmed}`,
        );
        continue;
      }
      applied.push(bp);
    }

    if (failures.length > 0) {
      vscode.window.showErrorMessage(
        failures.length === 1
          ? failures[0]
          : `${failures.length} breakpoints could not be applied. ${failures.join(' ')}`,
      );
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
    // Held still while the editor has unsaved edits — see `holdWhileDirty`.
    // Report what the gem already holds instead of arming anything: a
    // breakpoint set before the edits is still armed and still verified, and a
    // new one is refused with the reason.
    if (isDirty(uri)) return this.frozenResults(uri, lines, columns);

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
   * Take back a breakpoint set somewhere a breakpoint cannot mean anything.
   *
   * A GemStone breakpoint is a step point in a compiled method, so only a
   * `gemstone://` method editor can carry one — but VS Code offers the gutter
   * anywhere the gemstone-smalltalk language is, which includes a workspace and
   * a `.gst` file. Those breakpoints were previously dropped on the floor: the
   * dot stayed in the gutter, armed nothing, and said nothing, which is
   * indistinguishable from a breakpoint that simply never gets hit.
   */
  private refuseOutsideMethodSource(added: readonly vscode.Breakpoint[]): void {
    const stray = added.filter(
      (bp) => bp instanceof vscode.SourceBreakpoint && inviteWeCannotHonour(bp.location.uri),
    );
    if (stray.length === 0) return;

    vscode.debug.removeBreakpoints(stray);
    vscode.window.showWarningMessage(NOT_A_METHOD_REFUSAL);
  }

  /**
   * Hold a method's breakpoints still while its editor has unsaved edits, and
   * refuse any new one.
   *
   * `applyToUri` is an absolute model: clear the method, then re-arm everything
   * in VS Code's list by resolving each position against the *compiled* method's
   * step point offsets. VS Code moves its own breakpoints as the buffer is
   * edited, so the moment the text and the compiled method disagree, re-applying
   * would resolve every breakpoint on the method — including ones the developer
   * never touched — against offsets that no longer describe it, and silently
   * move them. Nothing is pushed to the gem until the editor is clean again, so
   * what was already armed stays exactly as it was and is still there after a
   * revert.
   *
   * A breakpoint just *added* is a different matter: leaving it in the list
   * would show a red dot arming nothing, so it is taken back out and the reason
   * given. `Shift+F9` refuses the same edit for the same reason, one step
   * earlier (`StepPointModel.explain`).
   */
  private holdWhileDirty(uri: vscode.Uri, added: readonly vscode.Breakpoint[]): void {
    this.frozen.add(uri.toString());

    const uriStr = uri.toString();
    const rejected = added.filter(
      (bp) => bp instanceof vscode.SourceBreakpoint && bp.location.uri.toString() === uriStr,
    );
    if (rejected.length === 0) return;

    vscode.debug.removeBreakpoints(rejected);
    vscode.window.showWarningMessage(DIRTY_REFUSAL);
  }

  /**
   * The gem's state for a method being held still, phrased as breakpoint
   * results — verified for what is actually armed, refused for anything else.
   */
  private frozenResults(
    uri: vscode.Uri,
    lines: number[],
    columns?: (number | undefined)[],
  ): VerifiedBreakpoint[] {
    this.frozen.add(uri.toString());

    const method = parseMethodUri(uri);
    const session = this.sessionForUri(uri);
    const applied = this.applied.get(uri.toString()) ?? [];
    const info = method && session ? this.stepPoints.fetch(session, uri, method) : null;

    return lines.map((line, i) => {
      const column = columns?.[i];
      // DAP columns are 1-based; our resolver takes a 0-based character.
      const character = column === undefined ? undefined : Math.max(column - 1, 0);
      const resolved = info ? resolveStepPoint(info, line, character) : null;
      const armed = resolved !== null && applied.some((a) => a.stepPoint === resolved.stepPoint);
      return {
        stepPoint: resolved?.stepPoint ?? 0,
        actualLine: resolved?.line ?? line,
        verified: armed,
        message: armed ? undefined : DIRTY_REFUSAL,
      };
    });
  }

  /**
   * Let the gem catch up once a held method's editor is clean again.
   *
   * Reverting (`File: Revert File`) is the ordinary way out, and usually there
   * is nothing to do — the text is the compiled method's again, and so are VS
   * Code's breakpoint positions, so re-applying arms exactly what was already
   * armed. It matters when the list moved during the hold: a breakpoint disabled
   * or removed while the editor was dirty was deliberately left alone in the
   * gem, and this is where the gem catches up with it. Saving takes the other
   * route entirely — the recompile drops the method's breakpoints
   * (`invalidateForUri`).
   */
  private thawIfClean(document: vscode.TextDocument): void {
    const uriStr = document.uri.toString();
    if (!this.frozen.has(uriStr) || document.isDirty) return;
    this.frozen.delete(uriStr);

    const session = this.sessionForUri(document.uri);
    if (session) this.applyToUri(session, document.uri);
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

    // Every live session's gem, not just the selected one. The rows just flipped
    // are one list spanning all of them, so sweeping a single gem would leave
    // another session's breaks armed behind rows that read "disabled" — the
    // gutter would say one thing and execution would do another.
    const failures = this.sweepEveryGem((session) =>
      enabled ? queries.enableAllBreakpoints(session) : queries.disableAllBreakpoints(session),
    );
    if (failures.length > 0) {
      vscode.window.showErrorMessage(
        `Could not ${enabled ? 'enable' : 'disable'} breakpoints in ${failures.join('; ')}`,
      );
    }
    this._onDidApply.fire();
  }

  /** Remove every GemStone breakpoint, in VS Code's model and in the gem. */
  removeAll(): void {
    const mine = gemstoneBreakpoints();
    if (mine.length > 0) vscode.debug.removeBreakpoints(mine);

    // Every live gem, for the same reason as `setAllEnabled`: the rows removed
    // above span all of them, and a gem left un-swept would keep stopping
    // execution at a breakpoint with no marker left anywhere to explain it.
    const failures = this.sweepEveryGem((session) => queries.removeAllBreakpoints(session));
    if (failures.length > 0) {
      vscode.window.showErrorMessage(`Could not remove breakpoints in ${failures.join('; ')}`);
    }
    this.applied.clear();
    for (const editor of vscode.window.visibleTextEditors) this.refreshDecorations(editor);
    this._onDidApply.fire();
  }

  /**
   * Run a gem-wide breakpoint operation on every live session, and answer the
   * ones that failed, already phrased for a message.
   *
   * One failing session does not stop the others: with several sessions live,
   * abandoning the sweep half way would leave the remaining gems armed behind
   * rows that say otherwise, which is the very state the caller is trying to
   * avoid.
   */
  private sweepEveryGem(operation: (session: ActiveSession) => void): string[] {
    const failures: string[] = [];
    for (const session of this.sessionManager.getSessions()) {
      try {
        operation(session);
      } catch (e) {
        failures.push(`session ${session.id}: ${messageOf(e)}`);
      }
    }
    return failures;
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
    // The rows this is matching against were read out of the selected session's
    // gem, so only a method from that session can be behind one. Without this,
    // two sessions holding the same class and selector at the same step point
    // would collide, and toggling a row here would flip a breakpoint belonging
    // to a method opened from the other session — the same prefix rule
    // `pruneOrphans` and `clearAllForSession` apply.
    const prefix = `gemstone://${session.id}/`;

    for (const [uriStr, applied] of this.applied) {
      if (!uriStr.startsWith(prefix)) continue;
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
      vscode.window.showErrorMessage(`Breakpoint operation failed: ${messageOf(e)}`);
      return;
    }
    this._onDidApply.fire();
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Called after a method is recompiled. Its breakpoints go away.
   *
   * Recompiling replaces the `GsNMethod`, so the gem's breakpoints on the old
   * one are unreachable and its step point offsets may have moved. They are
   * dropped rather than re-applied to the new method: a breakpoint belongs to
   * the code it was set in, and after an edit "step point 4" may be a different
   * expression entirely — silently moving it is worse than losing it. Removing
   * them from VS Code's list as well is what makes the gutter, the Breakpoints
   * panel and the GemStone Breakpoints view all agree, which is the same rule
   * that applies when a session logs out.
   */
  invalidateForUri(uri: vscode.Uri): void {
    this.stepPoints.invalidate(uri);
    this.applied.delete(uri.toString());

    // Removing these re-enters onBreakpointsChanged with none left for the
    // method, which clears the gem's breaks and refreshes the view.
    const stale = gemstoneBreakpoints().filter(
      (bp) => bp.location.uri.toString() === uri.toString(),
    );
    if (stale.length > 0) vscode.debug.removeBreakpoints(stale);

    this.refreshEditorsFor(uri);
    this._onDidApply.fire();
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
    this.warnAboutUnsupportedFields([...event.added, ...event.changed]);

    // Added *and* changed: VS Code's `+` button creates a function breakpoint
    // with an empty name and only then opens it for editing, so the name the
    // developer types arrives as a change rather than an addition.
    //
    // Resolving a name can need a prompt, so this runs on its own; the
    // SourceBreakpoint it produces comes back through this handler and is
    // applied like any other. `handle` never rejects — it reports its own
    // failures — so there is nothing here for a caller to handle.
    void this.functionBreakpoints.handle([...event.added, ...event.changed]);

    // Before anything needing a session: a breakpoint set in a workspace is
    // wrong whether or not one is logged in, and left alone it would sit in the
    // gutter as a solid red dot arming nothing and saying nothing.
    this.refuseOutsideMethodSource(event.added);

    const affected = new Set<string>();
    for (const bp of [...event.added, ...event.removed, ...event.changed]) {
      if (bp instanceof vscode.SourceBreakpoint && bp.location.uri.scheme === 'gemstone') {
        affected.add(bp.location.uri.toString());
      }
    }
    for (const uriStr of affected) {
      const uri = vscode.Uri.parse(uriStr);
      // Each method goes to its OWN session's gem, not to whichever session is
      // selected — see `sessionForUri`. A URI with no live session behind it is
      // left alone: `pruneOrphans` above has already taken its row out.
      const session = this.sessionForUri(uri);
      if (!session) continue;
      if (isDirty(uri)) {
        this.holdWhileDirty(uri, event.added);
        continue;
      }
      this.applyToUri(session, uri);
    }
  }

  /**
   * Say so when a breakpoint carries a condition, hit count or log message.
   *
   * VS Code offers all three through *Edit Breakpoint*, and they are honoured
   * entirely by the debugger — Jasper does not implement them, so the breakpoint
   * stops every time it is reached. Left unsaid, that is the worst kind of
   * failure this feature has: the developer has written down a precise intent,
   * the UI accepts it, and execution quietly ignores it. The fields are still
   * carried across enable/disable and name-conversion, so nothing is lost if
   * they are honoured later.
   */
  private warnAboutUnsupportedFields(breakpoints: readonly vscode.Breakpoint[]): void {
    const ignored = breakpoints.filter(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.location.uri.scheme === 'gemstone' &&
        (bp.condition !== undefined ||
          bp.hitCondition !== undefined ||
          bp.logMessage !== undefined),
    );
    if (ignored.length === 0) return;
    vscode.window.showWarningMessage(
      'GemStone breakpoints ignore conditions, hit counts and log messages — ' +
        `${ignored.length === 1 ? 'this breakpoint' : 'these breakpoints'} will stop every time ` +
        'the step point is reached.',
    );
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

/**
 * Why a breakpoint is refused, and cleared, while the method's editor has
 * unsaved edits. Names both ways out: the edits can be compiled, or dropped.
 */
const DIRTY_REFUSAL =
  'This method has unsaved edits, so its breakpoints are held as they are — ' +
  'step points come from the compiled method, not the text on screen. ' +
  'Save the method, or run "File: Revert File", and set the breakpoint then.';

/**
 * Why a breakpoint set outside a method editor is refused.
 *
 * Named as what the editor *is* rather than what it is not, since the developer
 * is looking at a workspace or a `.gst` file and has to be told where the
 * breakpoint does belong.
 */
const NOT_A_METHOD_REFUSAL =
  'A breakpoint can only be set in the source of a compiled GemStone method. ' +
  'This editor is not one — open the method and set the breakpoint there.';

/**
 * Whether VS Code offered a breakpoint here only because of *our* language
 * contribution, on a document that cannot hold one.
 *
 * `contributes.breakpoints` names a language, and VS Code gives no way to narrow
 * it by URI scheme — so the gutter is offered wherever gemstone-smalltalk is:
 * a workspace, a `.gst` file on disk, as well as the `gemstone://` method
 * editors that are the only documents a breakpoint means anything in.
 *
 * The language test is what keeps this honest. `onDidChangeBreakpoints` reports
 * every extension's breakpoints, so "not a gemstone:// URI" would also match a
 * Python file's — and taking those out of the developer's Breakpoints panel
 * would be a far worse bug than the one being fixed. A document that is not open
 * has no language to read, so it falls back to the extension VS Code would have
 * used itself; anything else is left alone.
 */
function inviteWeCannotHonour(uri: vscode.Uri): boolean {
  if (uri.scheme === 'gemstone') return false;

  const uriStr = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriStr);
  if (open) return open.languageId === 'gemstone-smalltalk';

  // Restored across a restart, before its editor is opened.
  return uri.path.endsWith('.gst');
}

/**
 * Whether `uri` is open with unsaved edits. A breakpoint is placed by position,
 * and only the compiled method's positions mean anything to the gem.
 */
function isDirty(uri: vscode.Uri): boolean {
  const uriStr = uri.toString();
  return vscode.workspace.textDocuments.some((d) => d.uri.toString() === uriStr && d.isDirty);
}
