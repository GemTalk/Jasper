import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import { parseMethodUri, type MethodUriRef } from '../gemstoneFileSystemProvider';
import { BREAKPOINT_GUTTER_LANGUAGES, isMethodSourceUri, methodSourceRef } from '../languageIds';
import * as queries from '../browserQueries';
import { GemStoneBreakpoint } from '../browserQueries';
import { FunctionBreakpointResolver } from './functionBreakpoints';
import { messageOf } from '../serverPlugin/installHelpers';
import { compiledMethodExpr } from '../queries/util';
import { BreakpointRule, logMessageExpression } from './conditionalBreakpoints';
import { describeMethodResult, methodLabel } from '../methodResultsPicker';
import {
  RuleParts,
  TriggerProblem,
  appendRuleMarkdown,
  editorLabel,
  pickerSummary,
} from './breakpointRuleText';
import {
  StepPointModel,
  StepPointInfo,
  ResolvedStepPoint,
  resolveStepPoint,
  stepPointAtOffset,
  rangesForStepPoint,
} from './stepPointModel';

/** A breakpoint as it now stands in the gem, for one method. */
export interface AppliedBreakpoint {
  stepPoint: number;
  /** 0-based offset into the stone's source. */
  offset: number;
  /** 1-based line in the stone's source. */
  line: number;
  enabled: boolean;
  /**
   * The Smalltalk expression that has to answer true for this breakpoint to
   * stop, or undefined when it stops every time. Carried here rather than read
   * off VS Code's list because this is the one place that knows which VS Code
   * breakpoint landed on which step point.
   */
  condition?: string;
  /**
   * What to log each time this breakpoint is reached, as typed — text with
   * `{…}` placeholders. A breakpoint with one never stops.
   */
  logMessage?: string;
  /**
   * The breakpoint that has to be reached before this one may stop, or
   * undefined when it is armed from the start. Copied from `triggers`. Whether
   * that breakpoint can still fire is not stored, since it changes with the
   * other breakpoint — see `triggerProblem`.
   */
  triggeredBy?: TriggerRef;
}

/**
 * Which breakpoint arms another. `vscode.Breakpoint` has no "triggered by"
 * field in any API version, so this is kept alongside VS Code's list.
 * Identified by method and step point rather than `vscode.Breakpoint.id`,
 * because `replaceEnabled` and `replaceCondition` recreate the breakpoint.
 */
export interface TriggerRef {
  /**
   * The triggering breakpoint's method URI, as a string. Any URI naming that
   * method will do: lookups go by the method it names (see `methodKey`).
   */
  uri: string;
  stepPoint: number;
}

/** The coordinates that make two method URIs name the same compiled method. */
type MethodCoordinates = Pick<
  MethodUriRef,
  'className' | 'isMeta' | 'selector' | 'environmentId'
> & { sessionId?: number };

/**
 * Whether `a` and `b` name the same compiled method. The session is compared
 * only when both carry one; a breakpoint the gem reported has none, and is
 * matched within the session it was read from.
 */
function sameMethod(a: MethodCoordinates, b: MethodCoordinates): boolean {
  return (
    (a.sessionId === undefined || b.sessionId === undefined || a.sessionId === b.sessionId) &&
    a.className === b.className &&
    a.isMeta === b.isMeta &&
    a.selector === b.selector &&
    a.environmentId === b.environmentId
  );
}

/**
 * One string for the method a URI names, shared by every URI that names it —
 * or the URI itself when it names no method.
 *
 * One compiled method can be addressed by more than one `gemstone://` URI: the
 * Explorer scopes its URIs to a dictionary index, and a GemStone Breakpoints row
 * builds one from what the gem reports. Anything kept per method is keyed by
 * this, so which of them a breakpoint was reached through does not matter. It
 * starts with the session's `gemstone://N/` prefix, so a sweep by session still
 * finds it.
 */
function methodKey(uri: string): string {
  const method = methodSourceRef(vscode.Uri.parse(uri));
  if (!method) return uri;
  const { sessionId, className, isMeta, selector, environmentId } = method;
  return `gemstone://${sessionId}/${JSON.stringify([className, isMeta, selector, environmentId])}`;
}

/**
 * Marks the exact token a breakpoint sits on: a line usually holds several step
 * points. Enabled and disabled differ mainly by colour, VS Code's own red and
 * grey; a dashed versus solid 1px border alone goes unnoticed.
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
  // Survives a theme where the grey border is nearly invisible.
  opacity: '0.75',
});

/**
 * Writes a breakpoint's condition, log message and trigger at the end of its
 * line. A decoration, never text: the method's source is the stone's. At the
 * line's end rather than after the step point's token, which can sit mid
 * statement (the `:=` of `running := running + each`) and would split the code.
 * Off when `gemstone.breakpoints.showRulesInEditor` is false.
 */
const conditionDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    // Otherwise, after a short line, the label reads as part of the statement.
    margin: '0 0 0 3ch',
    fontStyle: 'italic',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Whether to draw a breakpoint's rule beside its line. */
function showRulesInEditor(): boolean {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<boolean>('breakpoints.showRulesInEditor', true);
}

/** The label's hover: the rule in full, and for a logpoint a link to its output channel. */
function labelHover(rule: RuleParts): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  // Trusted for the one command it links to, not wholesale: the rule is text
  // the developer typed, and full trust would run any command link in it.
  md.isTrusted = { enabledCommands: ['gemstone.breakpoints.showLogpointOutput'] };
  md.supportThemeIcons = true;
  appendRuleMarkdown(md, rule);
  if (rule.logMessage !== undefined) {
    md.appendMarkdown(
      `\n\n[$(output) Show logpoint output](command:gemstone.breakpoints.showLogpointOutput ` +
        `"Open the GemStone Logpoints panel in Output")`,
    );
  }
  return md;
}

/**
 * Applies Jasper's breakpoints to a GemStone session and keeps the two in step.
 *
 * **VS Code's breakpoint list is the working model, for the life of a session.**
 * Expressing breakpoints as `vscode.debug.breakpoints` is what makes the gutter,
 * the per-breakpoint enable checkbox and the built-in Enable/Disable/Remove All
 * commands drive GemStone for free — they arrive here as
 * `onDidChangeBreakpoints`.
 *
 * The one thing that list cannot hold is which breakpoint triggers which (see
 * `TriggerRef`); that lives in `triggers`, kept to the same lifetime by hand.
 *
 * The **method** is the unit throughout, not the URI. One method can be open
 * under more than one `gemstone://` URI (see `methodKey`), and the gem has one
 * set of breakpoints for it, so applying, looking up and editing a breakpoint
 * all take in every URI that names its method.
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
 * Step point precision rides on the breakpoint's **column**: a gutter click
 * arrives as column 0 and means "the leftmost step point on this line", while an
 * inline breakpoint or Jasper's toggle-at-cursor carries the exact column and
 * picks the step point nearest it. Column 0 is passed through as is, so it is
 * `resolveStepPoint`'s `character <= 0` test alone that reads it as "no column"
 * — narrowing that to `=== undefined` would send every gutter click to the step
 * point nearest column 0 instead.
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
  /**
   * What we last applied, one entry per method, under the URI it was last
   * applied through — drives decorations and the rules. Read it with
   * `appliedFor`, which finds a method's entry through any of its URIs.
   */
  private applied = new Map<string, AppliedBreakpoint[]>();

  /**
   * Which breakpoint arms which: per method (`methodKey`) of the *triggered*
   * breakpoint, then per its step point.
   *
   * Lives as long as the breakpoint that waits: dropped when that breakpoint is
   * removed or its method recompiled (`pruneTriggers`), on Remove All, and at
   * logout. Not dropped when the breakpoint it waits for goes away or is
   * disabled: the waiting one stays disarmed, as VS Code's own do, and says why
   * (`triggerProblem`).
   */
  private triggers = new Map<string, Map<number, TriggerRef>>();

  /**
   * The condition and log message each VS Code breakpoint carried when its
   * method was last applied, per method (`methodKey`), then per
   * `vscode.Breakpoint.id`. Lets `holdWhileDirty` tell an edit that is being
   * held apart from a change that alters nothing in the gem.
   */
  private appliedAs = new Map<string, Map<string, { condition?: string; logMessage?: string }>>();

  /**
   * Method URIs held still because their editor has unsaved edits, so the gem
   * can catch up once it is clean again. See `holdWhileDirty`.
   */
  private frozen = new Set<string>();

  /** Method URIs `applyToUri` is partway through; see the guard at its top. */
  private applying = new Set<string>();

  /**
   * Set while `replaceEnabled` / `replaceCondition` swap a breakpoint for its
   * copy. The remove half fires `onDidChangeBreakpoints` before the add runs,
   * and `pruneTriggers` would otherwise read it as the breakpoint going away.
   */
  private replacing = false;

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
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('gemstone.breakpoints.showRulesInEditor')) return;
        for (const editor of vscode.window.visibleTextEditors) this.refreshDecorations(editor);
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
   * Push every VS Code breakpoint in the method `uri` names to the gem,
   * replacing whatever the method had. The absolute model: whatever is in
   * `vscode.debug.breakpoints` right now is exactly what the method ends up with.
   *
   * Every breakpoint in the method, whichever URI it was set through. The gem
   * has one set of breakpoints per method and this clears all of them first, so
   * arming only the breakpoints on `uri` would silently disarm the ones set
   * through another URI for the same method, while their red dots stayed.
   *
   * Callers are responsible for not running this while the method's editor has
   * unsaved edits, when a position in VS Code's list and an offset in the
   * compiled method no longer describe the same code — see `holdWhileDirty`.
   */
  applyToUri(session: ActiveSession, uri: vscode.Uri): void {
    // Re-entrant for the same method: taking a breakpoint back at the end of a
    // run (see `unplaceable` below) calls `vscode.debug.removeBreakpoints`, which
    // fires `onDidChangeBreakpoints` before it returns and brings us straight
    // back here. The gem is in its final state by then and VS Code's list has
    // already lost the removed breakpoint, so the nested pass would clear and
    // arm the same method all over again — every set a second round trip, every
    // error toast twice, `onDidApply` twice. Dropping it changes no outcome.
    //
    // Keyed by method, not URI, since the breakpoint taken back may sit on
    // another URI for the same method. Only a nested call is dropped; a removal
    // from outside this method, as `invalidateForUri` does, still arrives as a
    // top-level call and still does its work.
    const inFlight = methodKey(uri.toString());
    if (this.applying.has(inFlight)) return;
    this.applying.add(inFlight);
    try {
      this.applyNow(session, uri);
    } finally {
      this.applying.delete(inFlight);
    }
  }

  /** `applyToUri`'s body, minus the re-entrancy guard. */
  private applyNow(session: ActiveSession, uri: vscode.Uri): void {
    // The one statement of "a breakpoint can be armed here" (see
    // client/src/languageIds.ts), shared with the rule that decides which
    // documents are given the language the gutter is offered for — so the offer
    // and what can honour it cannot disagree.
    const method = methodSourceRef(uri);
    if (!method) return;

    const wanted = breakpointsOnMethod(uri);
    const key = methodKey(uri.toString());
    this.appliedAs.set(
      key,
      new Map(
        wanted.map((bp) => [bp.id, { condition: conditionOf(bp), logMessage: logMessageOf(bp) }]),
      ),
    );

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

    // The gem's method is now empty, so any OTHER URI's record for it describes
    // breakpoints that no longer exist. Drop them here, at the moment they stop
    // being true, rather than leaving them to be believed.
    this.dropAliasRecords(uri, method);

    if (wanted.length === 0) {
      this.settle(uri, []);
      return;
    }

    const info = this.stepPoints.fetch(session, uri, method);
    if (!info) {
      // `clearAllBreaks` has already emptied the method, so drop the record as
      // the "nothing wanted" path does; returning early would leave markers for
      // breaks no gem holds.
      const reason =
        `The breakpoints in ${describeMethodResult(method)} were cleared: its step points ` +
        `could not be read. Reopen the method to set them again.`;
      this.settle(uri, []);
      vscode.window.showWarningMessage(reason);
      return;
    }

    // Two breakpoints can land on the same step point — a gutter click and an
    // inline breakpoint on the same line, or a gutter click on a blank line
    // falling forward onto the next line's step point. The gem has one
    // breakpoint per step point, so they collapse.
    const atStepPoint = new Map<
      number,
      { resolved: ResolvedStepPoint; bps: vscode.SourceBreakpoint[] }
    >();
    // A breakpoint with no step point to fall forward to — below the method's
    // last statement, usually. Left in the list it is a red dot that never
    // stops, so it is taken back out and the reason given, as `holdWhileDirty`
    // does. Taken back at the very end of this method; see there for why.
    const unplaceable: vscode.SourceBreakpoint[] = [];

    for (const bp of wanted) {
      const resolved = stepPointOf(info, bp);
      if (!resolved) {
        unplaceable.push(bp);
        continue;
      }
      const group = atStepPoint.get(resolved.stepPoint);
      if (group) group.bps.push(bp);
      else atStepPoint.set(resolved.stepPoint, { resolved, bps: [bp] });
    }

    const byStepPoint: AppliedBreakpoint[] = [...atStepPoint.values()].map(({ resolved, bps }) =>
      collapse(resolved, bps, this.triggerFor(uri, resolved.stepPoint)),
    );

    const applied: AppliedBreakpoint[] = [];
    // A step point the gem refused is reported out loud: its red dot looks
    // exactly like an armed one.
    const failures: string[] = [];

    for (const bp of byStepPoint) {
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
        failures.push(
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
        failures.push(
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

    this.settle(uri, applied);

    // Last, after the gem and our record are in their final state, the way
    // `invalidateForUri` leaves its removal until the end: this re-enters
    // `applyToUri`, which drops the nested pass precisely because there is
    // nothing left for it to do.
    if (unplaceable.length > 0) {
      vscode.debug.removeBreakpoints(unplaceable);
      vscode.window.showWarningMessage(
        noStepPointRefusal(unplaceable.length, describeMethodResult(method)),
      );
    }
  }

  /**
   * Record what the method `uri` names now holds, and redraw what shows it.
   *
   * A trigger whose waiting breakpoint is gone goes with it, or a breakpoint
   * later set on that step point would inherit "Break after …". Editors of
   * breakpoints waiting on this method are redrawn too: whether their trigger
   * can still fire may just have changed.
   */
  private settle(uri: vscode.Uri, applied: AppliedBreakpoint[]): void {
    if (applied.length > 0) this.applied.set(uri.toString(), applied);
    else this.applied.delete(uri.toString());
    this.pruneTriggers(uri, new Set(applied.map((a) => a.stepPoint)));
    this.refreshEditorsFor(uri);
    this.refreshWaitingEditors();
    this._onDidApply.fire();
  }

  /**
   * Forget every record for this method held under a *different* URI.
   *
   * One compiled method can be addressed by more than one `gemstone://` URI (see
   * `methodKey`). `applyToUri` clears the whole method and re-arms every
   * breakpoint in it, from whichever URI, under the URI it was called with — so
   * the other URI's record now describes breakpoints that are already gone.
   *
   * Left in place, it draws markers for breakpoints that do not exist and is
   * handed to the gem as a rule of its own, so an edited condition appears to
   * have no effect while the previous one still decides.
   */
  private dropAliasRecords(uri: vscode.Uri, method: MethodUriRef): void {
    const keep = uri.toString();
    for (const key of [...this.applied.keys()]) {
      if (key === keep) continue;
      const other = methodSourceRef(vscode.Uri.parse(key));
      if (other && sameMethod(other, method)) this.applied.delete(key);
    }
  }

  /**
   * Take back a breakpoint set somewhere a breakpoint cannot mean anything.
   *
   * A GemStone breakpoint is a step point in a compiled method, so only a
   * `gemstone://` method editor can carry one. The gutter is no longer *offered*
   * anywhere else — `contributes.breakpoints` names gemstone-method alone, and
   * only a compiled method's source is given that language (see
   * client/src/languageIds.ts) — so in VS Code this is now a backstop rather
   * than the everyday path. It still has work to do: `allowBreakpointsEverywhere`
   * puts the gutter back on every document, including the debugger's read-only
   * frame source.
   *
   * Such a breakpoint would otherwise be dropped on the floor: the dot stays in
   * the gutter, arms nothing, and says nothing, which is indistinguishable from a
   * breakpoint that simply never gets hit.
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
   *
   * A condition or log message edited on an armed breakpoint is held too, and
   * quietly: VS Code shows the new text while the gem goes on applying the old.
   * So that is said out loud, but only when it differs from what was applied
   * (`appliedAs`); flipping an enable checkbox, say, misleads no one.
   */
  private holdWhileDirty(
    uri: vscode.Uri,
    added: readonly vscode.Breakpoint[],
    changed: readonly vscode.Breakpoint[] = [],
  ): void {
    this.frozen.add(uri.toString());

    const rejected = breakpointsOn(uri, added);
    if (rejected.length > 0) {
      vscode.debug.removeBreakpoints(rejected);
      vscode.window.showWarningMessage(DIRTY_REFUSAL);
      return;
    }

    const asApplied = this.appliedAs.get(methodKey(uri.toString()));
    const held = breakpointsOn(uri, changed).some((bp) => {
      const was = asApplied?.get(bp.id);
      if (was === undefined) return conditionOf(bp) !== undefined || logMessageOf(bp) !== undefined;
      return was.condition !== conditionOf(bp) || was.logMessage !== logMessageOf(bp);
    });
    if (held) vscode.window.showWarningMessage(HELD_RULE_REFUSAL);
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
   * Enable or disable the breakpoint at the caret — the one on the caret's line
   * when the caret is not on its exact token (see `breakpointAtCursor`).
   */
  setEnabledAtCursor(editor: vscode.TextEditor, enabled: boolean): void {
    const found = this.breakpointAtCursor(editor);
    if (!found) return;

    const existing = found.breakpoint;
    if (!existing) {
      if (!enabled) return; // nothing there to disable
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(
          new vscode.Location(editor.document.uri, positionOf(editor.document, found.offset)),
        ),
      ]);
      return;
    }
    if (existing.enabled === enabled) return;
    this.replaceEnabled([existing], enabled);
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
    if (existing.enabled !== enabled) this.replaceEnabled([existing], enabled);
  }

  /** Clear the breakpoint at a named step point. */
  clearAtStepPoint(uri: vscode.Uri, stepPoint: number): void {
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    const existing = this.vsCodeBreakpointFor(uri, ctx.info, stepPoint);
    if (existing) vscode.debug.removeBreakpoints([existing]);
  }

  // ── Conditions ───────────────────────────────────────────

  /** Ask for the condition on the breakpoint at the caret, and set it. */
  async editConditionAtCursor(editor: vscode.TextEditor): Promise<void> {
    const found = this.breakpointAtCursor(editor);
    if (!found) return;
    await this.promptForCondition(editor.document.uri, found.info, found.stepPoint);
  }

  /** Ask for the condition on the breakpoint at a step point named outright. */
  async editConditionAtStepPoint(uri: vscode.Uri, stepPoint: number): Promise<void> {
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    await this.promptForCondition(uri, ctx.info, stepPoint);
  }

  /**
   * Put a condition on the breakpoint at `stepPoint`, creating the breakpoint if
   * there isn't one. An emptied box removes the condition; a cancelled box
   * changes nothing.
   */
  private async promptForCondition(
    uri: vscode.Uri,
    info: StepPointInfo,
    stepPoint: number,
  ): Promise<void> {
    const existing = this.vsCodeBreakpointFor(uri, info, stepPoint);
    // What the condition gates depends on what the breakpoint is: a logpoint
    // does not stop, so "leave empty to stop every time" would be a lie on one.
    const logs = existing !== undefined && logMessageOf(existing) !== undefined;
    const typed = await vscode.window.showInputBox({
      title: `${logs ? 'Logpoint' : 'Breakpoint'} condition — step point ${stepPoint}`,
      prompt:
        'A Smalltalk expression answering true or false, evaluated in the suspended frame. ' +
        (logs
          ? 'Leave empty to log every time. Lines go to the GemStone Logpoints panel in Output.'
          : 'Leave empty to stop every time.'),
      placeHolder: 'e.g. amount > 100',
      value: existing?.condition ?? '',
      ignoreFocusOut: true,
    });
    if (typed === undefined) return; // cancelled

    const condition = typed.trim() === '' ? undefined : typed.trim();
    if (existing) {
      if (existing.condition === condition) return;
      this.replaceCondition(existing, condition);
      return;
    }

    const at = info.offsets[stepPoint - 1];
    if (at === undefined) return;
    const ctx = this.contextFor(uri);
    if (!ctx) return;
    vscode.debug.addBreakpoints([
      new vscode.SourceBreakpoint(
        new vscode.Location(uri, ctx.document.positionAt(at)),
        true,
        condition,
      ),
    ]);
  }

  /**
   * Re-add `breakpoints` with a new enabled flag. `Breakpoint.enabled` is
   * read-only in the VS Code API, so this is the only way to flip it; condition,
   * hit condition and log message ride along so they survive the round trip,
   * and the trigger is kept (see `replacing`).
   */
  private replaceEnabled(breakpoints: vscode.SourceBreakpoint[], enabled: boolean): void {
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
    this.keepingTriggers(() => {
      vscode.debug.removeBreakpoints(breakpoints);
      vscode.debug.addBreakpoints(replacements);
    });
  }

  /**
   * Re-add `breakpoint` with a new condition. `Breakpoint.condition` is read-only
   * in the VS Code API, exactly as `enabled` is, so this is the only way to change
   * one; everything else about the breakpoint rides along untouched.
   */
  private replaceCondition(
    breakpoint: vscode.SourceBreakpoint,
    condition: string | undefined,
  ): void {
    this.keepingTriggers(() => {
      vscode.debug.removeBreakpoints([breakpoint]);
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(
          breakpoint.location,
          breakpoint.enabled,
          condition,
          breakpoint.hitCondition,
          breakpoint.logMessage,
        ),
      ]);
    });
  }

  private keepingTriggers(swap: () => void): void {
    const outer = this.replacing;
    this.replacing = true;
    try {
      swap();
    } finally {
      this.replacing = outer;
    }
  }

  // ── Triggers ─────────────────────────────────────────────

  /** The breakpoint that has to be reached before the one at `stepPoint` stops. */
  triggerFor(uri: vscode.Uri, stepPoint: number): TriggerRef | undefined {
    return this.triggers.get(methodKey(uri.toString()))?.get(stepPoint);
  }

  /**
   * Why `ref` cannot arm the breakpoint waiting on it, or undefined when it can:
   * its breakpoint is disabled, or there is none at that step point any more.
   *
   * The one rule behind both what a waiting breakpoint's label, row and hover
   * say and what `breakpointRulesFor` hands the gem, so the two cannot
   * disagree.
   */
  triggerProblem(ref: TriggerRef): TriggerProblem | undefined {
    const target = this.appliedFor(vscode.Uri.parse(ref.uri)).find(
      (a) => a.stepPoint === ref.stepPoint,
    );
    if (!target) return 'removed';
    return target.enabled ? undefined : 'disabled';
  }

  /** Everything the rule text for `bp` is made from — see `breakpointRuleText.ts`. */
  ruleOf(bp: AppliedBreakpoint): RuleParts {
    return {
      condition: bp.condition,
      logMessage: bp.logMessage,
      triggeredBy: bp.triggeredBy,
      triggerProblem: bp.triggeredBy && this.triggerProblem(bp.triggeredBy),
    };
  }

  /**
   * Drop the triggers of breakpoints in the method `uri` names that are not at
   * one of `kept` — the breakpoint that waited is gone, so its trigger goes with
   * it.
   */
  private pruneTriggers(uri: vscode.Uri, kept: ReadonlySet<number>): void {
    if (this.replacing) return;
    const key = methodKey(uri.toString());
    const mine = this.triggers.get(key);
    if (!mine) return;
    for (const stepPoint of [...mine.keys()]) {
      if (!kept.has(stepPoint)) mine.delete(stepPoint);
    }
    if (mine.size === 0) this.triggers.delete(key);
  }

  /**
   * Make the breakpoint at `stepPoint` wait for `trigger`, or clear that with
   * `undefined`.
   *
   * Nothing is sent to the gem: the breakpoint is armed there either way, and
   * the decider judges each hit. Views are told directly, since a trigger
   * raises no breakpoint event.
   */
  setTrigger(uri: vscode.Uri, stepPoint: number, trigger: TriggerRef | undefined): void {
    const key = methodKey(uri.toString());
    const mine = this.triggers.get(key) ?? new Map<number, TriggerRef>();
    if (trigger === undefined) mine.delete(stepPoint);
    else mine.set(stepPoint, trigger);
    if (mine.size > 0) this.triggers.set(key, mine);
    else this.triggers.delete(key);

    const record = this.appliedFor(uri).find((a) => a.stepPoint === stepPoint);
    if (record) record.triggeredBy = trigger;

    this.refreshEditorsFor(uri);
    this.refreshWaitingEditors();
    this._onDidApply.fire();
  }

  /**
   * Ask which breakpoint should arm the one at the caret — the one on the
   * caret's line when the caret is not on its exact token — and record it.
   */
  async editTriggerAtCursor(editor: vscode.TextEditor): Promise<void> {
    const found = this.breakpointAtCursor(editor);
    if (!found) return;
    if (!found.breakpoint) {
      vscode.window.showInformationMessage(
        `There is no breakpoint on line ${editor.selection.active.line + 1} to trigger. ` +
          'Set one first, then choose what has to be reached before it stops.',
      );
      return;
    }
    await this.editTriggerAtStepPoint(editor.document.uri, found.stepPoint);
  }

  /**
   * Offer every other breakpoint in the session as the one the breakpoint at
   * `stepPoint` waits for, and record the choice.
   *
   * Only breakpoints that already exist: naming one that is not set would leave
   * this one disarmed forever. A breakpoint cannot wait for itself.
   */
  async editTriggerAtStepPoint(uri: vscode.Uri, stepPoint: number): Promise<void> {
    const mine = this.appliedFor(uri).find((a) => a.stepPoint === stepPoint);
    if (!mine) {
      vscode.window.showInformationMessage(
        `There is no breakpoint at step point ${stepPoint} to trigger. Set one first, ` +
          'then choose what has to be reached before it stops.',
      );
      return;
    }

    const current = this.triggerFor(uri, stepPoint);
    const candidates = this.triggerCandidates(uri, stepPoint);
    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        'A triggered breakpoint waits for another breakpoint to be reached, and this ' +
          'session has no other breakpoint to wait for.',
      );
      return;
    }

    type Item = vscode.QuickPickItem & { ref?: TriggerRef };
    const items: Item[] = [
      {
        label: 'Always armed',
        description: current === undefined ? 'current' : undefined,
        detail: 'Stop every time this breakpoint is reached, waiting for nothing.',
      },
      ...candidates.map((c) => ({
        label: c.label,
        description: current && sameBreakpoint(current, c.ref) ? 'current' : undefined,
        detail: c.detail,
        ref: c.ref,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `Break at step point ${stepPoint} only after…`,
      placeHolder: 'The breakpoint that has to be reached first',
    });
    if (picked === undefined) return; // cancelled
    this.setTrigger(uri, stepPoint, picked.ref);
  }

  /**
   * Whether the breakpoint `from` waits — at any remove — on `on`.
   *
   * Walks the chain rather than checking the one link, so a ring of three is
   * refused as readily as a pair. Bounded by the number of recorded triggers,
   * which also guards against walking a ring that somehow already exists.
   */
  private waitsOn(from: TriggerRef, on: TriggerRef): boolean {
    let bound = 0;
    for (const mine of this.triggers.values()) bound += mine.size;
    let at = this.triggerFor(vscode.Uri.parse(from.uri), from.stepPoint);
    for (let hops = 0; at !== undefined && hops <= bound; hops += 1) {
      if (sameBreakpoint(at, on)) return true;
      at = this.triggerFor(vscode.Uri.parse(at.uri), at.stepPoint);
    }
    return false;
  }

  /**
   * Every breakpoint that could arm the one at `stepPoint` — in the gem that
   * holds `uri`'s method, which is the only gem a trigger can be judged in.
   */
  private triggerCandidates(
    uri: vscode.Uri,
    stepPoint: number,
  ): { label: string; detail: string; ref: TriggerRef }[] {
    // The method's own session, not the selected one: see `sessionForUri`. A
    // breakpoint from another gem would be recorded as a trigger that can
    // never be reached in this one.
    const session = this.sessionForUri(uri);
    if (!session) return [];
    const self: TriggerRef = { uri: uri.toString(), stepPoint };
    const out: { label: string; detail: string; ref: TriggerRef }[] = [];

    for (const { uriStr, method, bp } of this.appliedInSession(session.id)) {
      const ref: TriggerRef = { uri: uriStr, stepPoint: bp.stepPoint };
      if (sameBreakpoint(ref, self)) continue;
      // Anything already waiting on this breakpoint, directly or through a
      // chain, cannot also arm it: the ring would never fire.
      if (this.waitsOn(ref, self)) continue;
      out.push({
        label: `${methodLabel(method)} @${bp.stepPoint}`,
        detail: pickerSummary(bp),
        ref,
      });
    }
    return out;
  }

  /** Every applied breakpoint in a session's gem, with the method it is in. */
  private *appliedInSession(
    sessionId: number,
  ): Generator<{ uriStr: string; method: MethodUriRef; bp: AppliedBreakpoint }> {
    const prefix = `gemstone://${sessionId}/`;
    for (const [uriStr, applied] of this.applied) {
      if (!uriStr.startsWith(prefix)) continue;
      const method = methodSourceRef(vscode.Uri.parse(uriStr));
      if (!method) continue;
      for (const bp of applied) yield { uriStr, method, bp };
    }
  }

  /**
   * Every armed breakpoint in `session`'s gem the decider has to know about — one
   * carrying a condition, a log message or a trigger, plus any breakpoint that is
   * itself somebody's trigger.
   *
   * Both ends of a trigger need a spec even when otherwise plain: a step point
   * no spec claims answers Stop, so a trigger left out would never arm anything,
   * and a triggered breakpoint left out would stop on its first hit.
   *
   * A breakpoint whose trigger is disabled or gone (`triggerProblem`) names
   * **itself** as its trigger, which keeps it disarmed for the whole run: a
   * breakpoint still waiting arms nothing, itself included.
   *
   * Only enabled ones. Empty when nothing needs judging, so the ordinary case
   * costs nothing.
   */
  breakpointRulesFor(session: ActiveSession): BreakpointRule[] {
    // Enabled breakpoints only, and gathered before any rule is built: a trigger
    // is resolved to an index into this same list, so the list has to be settled
    // first.
    const live = [...this.appliedInSession(session.id)].filter((l) => l.bp.enabled);
    const ids = live.map((l) => `${methodKey(l.uriStr)}#${l.bp.stepPoint}`);

    // Index `i` waits for index `armedBy.get(i)` — itself when its trigger can
    // never fire.
    const armedBy = new Map<number, number>();
    live.forEach((l, i) => {
      const ref = l.bp.triggeredBy;
      if (!ref) return;
      const at =
        this.triggerProblem(ref) === undefined
          ? ids.indexOf(`${methodKey(ref.uri)}#${ref.stepPoint}`)
          : -1;
      armedBy.set(i, at >= 0 ? at : i);
    });

    const needed = new Set<number>();
    live.forEach((l, i) => {
      if (l.bp.condition !== undefined || l.bp.logMessage !== undefined) needed.add(i);
    });
    // The trigger earns a spec by being one, whatever it carries itself.
    for (const [waiting, trigger] of armedBy) needed.add(waiting).add(trigger);
    if (needed.size === 0) return [];

    // Each spec costs a method lookup per install and a comparison per hit, so
    // only needed ones go. That renumbers them, so trigger indexes are
    // translated into the pruned array.
    const order = [...needed].sort((a, b) => a - b);
    // 1-based: the decider indexes its spec Array in Smalltalk.
    const specIndex = new Map(order.map((from, to) => [from, to + 1]));

    return order.map((i) => {
      const l = live[i];
      const trigger = armedBy.get(i);
      return {
        methodExpr: compiledMethodExpr(
          l.method.className,
          l.method.isMeta,
          l.method.selector,
          l.method.environmentId,
        ),
        stepPoint: l.bp.stepPoint,
        condition: l.bp.condition,
        // Compiled once per run here, keeping it out of the per-hit path.
        logMessage:
          l.bp.logMessage === undefined ? undefined : logMessageExpression(l.bp.logMessage),
        label: methodLabel(l.method),
        triggeredBy: trigger === undefined ? undefined : specIndex.get(trigger),
      };
    });
  }

  /**
   * The record Jasper applied for a breakpoint the gem reported, or undefined
   * when Jasper did not set it — one from topaz, say. Matched on method
   * coordinates and step point within the selected session, whose gem the
   * GemStone Breakpoints view reads.
   */
  appliedForStoneBreakpoint(bp: GemStoneBreakpoint): AppliedBreakpoint | undefined {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return undefined;
    for (const l of this.appliedInSession(session.id)) {
      if (l.bp.stepPoint === bp.stepPoint && sameMethod(l.method, bp)) return l.bp;
    }
    return undefined;
  }

  /**
   * The rule on a breakpoint the gem reported, when Jasper set it and it has
   * one. Lets the breakpoint manager view show a condition, a log message or a
   * trigger it has no other way of knowing about — the gem records none of them.
   */
  ruleForStoneBreakpoint(bp: GemStoneBreakpoint): RuleParts | undefined {
    const match = this.appliedForStoneBreakpoint(bp);
    if (
      !match ||
      (match.condition === undefined &&
        match.logMessage === undefined &&
        match.triggeredBy === undefined)
    ) {
      return undefined;
    }
    return this.ruleOf(match);
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
    const mine = breakpointsOnMethod(editor.document.uri);
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

  /**
   * The breakpoint an "at Cursor" command that edits one is about.
   *
   * The caret's own step point when a breakpoint is on it. Otherwise the
   * breakpoint on the caret's line (the nearest, if several): the caret's
   * nearest step point is routinely another token, and answering it would make
   * Edit Condition add a second breakpoint and Edit Trigger find none. With no
   * breakpoint on the line, `breakpoint` is undefined and `stepPoint` is the
   * caret's.
   *
   * Toggle at Cursor does not use this: toggling means "at this token".
   */
  private breakpointAtCursor(editor: vscode.TextEditor): {
    info: StepPointInfo;
    stepPoint: number;
    offset: number;
    breakpoint?: vscode.SourceBreakpoint;
  } | null {
    const found = this.stepPointAtCursor(editor);
    if (!found) return null;
    const { info, resolved } = found;

    const mine = breakpointsOnMethod(editor.document.uri).flatMap((bp) => {
      const at = stepPointOf(info, bp);
      return at ? [{ bp, at }] : [];
    });
    const exact = mine.find((m) => m.at.stepPoint === resolved.stepPoint);
    if (exact) return { info, ...resolved, breakpoint: exact.bp };

    const caretLine = editor.selection.active.line + 1;
    const caret = editor.document.offsetAt(editor.selection.active);
    const onLine = mine
      .filter((m) => m.at.line === caretLine || m.bp.location.range.start.line + 1 === caretLine)
      .sort((a, b) => Math.abs(a.at.offset - caret) - Math.abs(b.at.offset - caret));
    if (onLine.length > 0) {
      const [{ bp, at }] = onLine;
      return { info, stepPoint: at.stepPoint, offset: at.offset, breakpoint: bp };
    }
    return { info, stepPoint: resolved.stepPoint, offset: resolved.offset };
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
    if (mine.length > 0) this.replaceEnabled(mine, enabled);

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
    // Nothing is left to wait, and nothing is left to catch up to.
    this.triggers.clear();
    this.appliedAs.clear();
    this.frozen.clear();
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
      if (owned.enabled !== enabled) this.replaceEnabled([owned], enabled);
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
    for (const { uriStr, method, bp: applied } of this.appliedInSession(session.id)) {
      if (applied.stepPoint !== bp.stepPoint || !sameMethod(method, bp)) continue;
      const uri = vscode.Uri.parse(uriStr);
      const info = this.stepPoints.fetch(session, uri, method);
      if (!info) continue;
      return this.vsCodeBreakpointFor(uri, info, bp.stepPoint);
    }
    return undefined;
  }

  /**
   * The URI a gem-reported breakpoint was set through, when Jasper set it.
   *
   * What a GemStone Breakpoints row opens: the method editor its breakpoint
   * actually sits in, so the red dot is there to see, rather than a second
   * editor on a URI built from what the gem reports.
   */
  uriForStoneBreakpoint(bp: GemStoneBreakpoint): vscode.Uri | undefined {
    return this.ownedBreakpoint(bp)?.location.uri;
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
    // Every URI the method is known by, since it is the method that changed:
    // a breakpoint set through another URI for it is just as stale, and left in
    // VS Code's list it would be armed on the new method by the next apply.
    const key = methodKey(uri.toString());
    const aliases = new Set([uri.toString()]);
    for (const uriStr of this.applied.keys()) if (methodKey(uriStr) === key) aliases.add(uriStr);
    for (const bp of breakpointsOnMethod(uri)) aliases.add(bp.location.uri.toString());
    for (const document of vscode.workspace.textDocuments) {
      if (methodKey(document.uri.toString()) === key) aliases.add(document.uri.toString());
    }

    for (const alias of aliases) {
      this.stepPoints.invalidate(vscode.Uri.parse(alias));
      this.applied.delete(alias);
      // Saving is the ordinary way out of a dirty editor, and it arrives here
      // rather than through `thawIfClean` — VS Code fires no text-document change
      // for a save. Without this the URI would stay held for the life of the
      // window, and a later unrelated clean edit would re-apply a method nobody
      // asked about.
      this.frozen.delete(alias);
    }
    // The breakpoints that waited in this method go; a trigger elsewhere that
    // names one of them stays, and its breakpoint stays disarmed (see `triggers`).
    this.triggers.delete(key);
    this.appliedAs.delete(key);

    // Removing these re-enters onBreakpointsChanged with none left for the
    // method, which clears the gem's breaks and refreshes the view.
    const stale = breakpointsOnMethod(uri);
    if (stale.length > 0) vscode.debug.removeBreakpoints(stale);

    this.refreshEditorsFor(uri);
    this.refreshWaitingEditors();
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
    // Keyed by `methodKey`, which starts with the same prefix.
    for (const key of [...this.triggers.keys()]) {
      if (key.startsWith(prefix)) this.triggers.delete(key);
    }
    for (const key of [...this.appliedAs.keys()]) {
      if (key.startsWith(prefix)) this.appliedAs.delete(key);
    }
    // Held methods go with the gem too: nothing is left to catch up to.
    for (const key of [...this.frozen]) {
      if (key.startsWith(prefix)) this.frozen.delete(key);
    }
    this.stepPoints.invalidateSession(sessionId);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString().startsWith(prefix)) {
        editor.setDecorations(enabledDecoration, []);
        editor.setDecorations(disabledDecoration, []);
        editor.setDecorations(conditionDecoration, []);
      }
    }
    this._onDidApply.fire();
  }

  // ── Decorations ──────────────────────────────────────────

  /** Mark the token each breakpoint sits on, and write its rule after its line. */
  refreshDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== 'gemstone') return;

    const applied = this.appliedFor(editor.document.uri);
    if (applied.length === 0) {
      editor.setDecorations(enabledDecoration, []);
      editor.setDecorations(disabledDecoration, []);
      editor.setDecorations(conditionDecoration, []);
      return;
    }

    const info = this.stepPoints.get(editor.document);
    if (!info) return;

    const on: vscode.Range[] = [];
    const off: vscode.Range[] = [];
    const labels: vscode.DecorationOptions[] = [];
    const withRules = showRulesInEditor();
    // A line holding more than one breakpoint gets `@N` on each label, or the
    // reader cannot tell which label goes with which breakpoint.
    const lineOf = (bp: AppliedBreakpoint): number | undefined => {
      const first = rangesForStepPoint(info, bp.stepPoint)[0];
      return first && positionOf(editor.document, first.start).line;
    };
    const perLine = new Map<number | undefined, number>();
    for (const bp of applied) perLine.set(lineOf(bp), (perLine.get(lineOf(bp)) ?? 0) + 1);

    for (const bp of applied) {
      for (const r of rangesForStepPoint(info, bp.stepPoint)) {
        const range = new vscode.Range(
          positionOf(editor.document, r.start),
          positionOf(editor.document, r.end),
        );
        (bp.enabled ? on : off).push(range);
      }
      // One label per breakpoint, at the end of the line its step point starts
      // on (see `conditionDecoration`).
      const line = lineOf(bp);
      if (line === undefined || !withRules) continue;
      const rule = this.ruleOf(bp);
      const label = editorLabel(rule, (perLine.get(line) ?? 0) > 1 ? bp.stepPoint : undefined);
      if (label === undefined) continue;
      const endOfLine = editor.document.lineAt(line).range.end;
      labels.push({
        range: new vscode.Range(endOfLine, endOfLine),
        hoverMessage: labelHover(rule),
        renderOptions: { after: { contentText: label } },
      });
    }
    editor.setDecorations(enabledDecoration, on);
    editor.setDecorations(disabledDecoration, off);
    editor.setDecorations(conditionDecoration, labels);
  }

  /**
   * What is applied to the METHOD `uri` names — for the hover, the token
   * markers and the condition label.
   *
   * Looked up by method rather than by URI string. One compiled method can be
   * addressed by more than one `gemstone://` URI (the Explorer scopes its URIs
   * to a dictionary index, revealing a breakpoint from the Breakpoints view
   * builds one from what the gem reports), and only the URI last applied through
   * holds the record — see `dropAliasRecords`. Keyed by string, an editor open
   * on the *other* URI would show a red dot with no marker, no condition and a
   * hover claiming there is no breakpoint, while the gem has one right there.
   */
  appliedFor(uri: vscode.Uri): AppliedBreakpoint[] {
    const direct = this.applied.get(uri.toString());
    if (direct) return direct;

    const method = methodSourceRef(uri);
    if (!method) return [];
    for (const [key, applied] of this.applied) {
      const other = methodSourceRef(vscode.Uri.parse(key));
      if (other && sameMethod(other, method)) return applied;
    }
    return [];
  }

  // ── Internals ────────────────────────────────────────────

  /**
   * The VS Code breakpoint in the method `uri` names that resolves to
   * `stepPoint`, whichever URI for the method it was set through. Resolution
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
    return breakpointsOnMethod(uri).find((bp) => stepPointOf(info, bp)?.stepPoint === stepPoint);
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

    // One apply per method, since an apply takes in every URI for it.
    const affected = new Map<string, string>();
    for (const bp of [...event.added, ...event.removed, ...event.changed]) {
      if (bp instanceof vscode.SourceBreakpoint && bp.location.uri.scheme === 'gemstone') {
        const uriStr = bp.location.uri.toString();
        const key = methodKey(uriStr);
        if (!affected.has(key)) affected.set(key, uriStr);
      }
    }
    for (const uriStr of affected.values()) {
      const uri = vscode.Uri.parse(uriStr);
      // Each method goes to its OWN session's gem, not to whichever session is
      // selected — see `sessionForUri`. A URI with no live session behind it is
      // left alone: `pruneOrphans` above has already taken its row out.
      const session = this.sessionForUri(uri);
      if (!session) continue;
      if (isDirty(uri)) {
        this.holdWhileDirty(uri, event.added, event.changed);
        continue;
      }
      this.applyToUri(session, uri);
    }
  }

  /**
   * Say so when a breakpoint carries a hit count.
   *
   * VS Code offers it through *Edit Breakpoint* and it is honoured entirely by
   * the debugger. Jasper does not implement it, so the breakpoint stops (or
   * logs) every time regardless; left unsaid, an intent the UI accepted would be
   * quietly ignored. The field is still carried across enable/disable and
   * name-conversion.
   *
   * Conditions and log messages are **not** on this list: both are evaluated in
   * the suspended frame — see `conditionalBreakpoints.ts`.
   */
  private warnAboutUnsupportedFields(breakpoints: readonly vscode.Breakpoint[]): void {
    const ignored = breakpoints.filter(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.location.uri.scheme === 'gemstone' &&
        bp.hitCondition !== undefined,
    );
    if (ignored.length === 0) return;
    vscode.window.showWarningMessage(
      'GemStone breakpoints ignore hit counts — ' +
        `${ignored.length === 1 ? 'this breakpoint' : 'these breakpoints'} will stop, or log, ` +
        'every time the step point is reached. Conditions are honoured, and a log message is ' +
        'written to the GemStone Logpoints panel in Output.',
    );
  }

  /** Redraw every visible editor on the method `uri` names, through any URI. */
  private refreshEditorsFor(uri: vscode.Uri): void {
    const key = methodKey(uri.toString());
    for (const editor of vscode.window.visibleTextEditors) {
      if (methodKey(editor.document.uri.toString()) === key) this.refreshDecorations(editor);
    }
  }

  /**
   * Redraw every visible editor holding a breakpoint that waits on another.
   * Whether its trigger can still fire changes with a breakpoint in some other
   * method, which no event for its own method reports.
   */
  private refreshWaitingEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (this.appliedFor(editor.document.uri).some((a) => a.triggeredBy !== undefined)) {
        this.refreshDecorations(editor);
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

const isSourceBreakpoint = (bp: vscode.Breakpoint): bp is vscode.SourceBreakpoint =>
  bp instanceof vscode.SourceBreakpoint;

/** Every VS Code source breakpoint on a `gemstone://` URI. */
export function gemstoneBreakpoints(): vscode.SourceBreakpoint[] {
  return vscode.debug.breakpoints
    .filter(isSourceBreakpoint)
    .filter((bp) => bp.location.uri.scheme === 'gemstone');
}

/**
 * The source breakpoints in `from` that are on `uri`. Unlike
 * `gemstoneBreakpoints()`, this does not filter by scheme — `uri` alone decides.
 */
function breakpointsOn(
  uri: vscode.Uri,
  from: readonly vscode.Breakpoint[] = vscode.debug.breakpoints,
): vscode.SourceBreakpoint[] {
  const uriStr = uri.toString();
  return from.filter(isSourceBreakpoint).filter((bp) => bp.location.uri.toString() === uriStr);
}

/**
 * The source breakpoints in the method `uri` names, through whichever URI each
 * was set on (see `methodKey`). Just `uri`'s own when it names no method.
 */
function breakpointsOnMethod(uri: vscode.Uri): vscode.SourceBreakpoint[] {
  const method = methodSourceRef(uri);
  if (!method) return breakpointsOn(uri);
  return gemstoneBreakpoints().filter((bp) => {
    const other = methodSourceRef(bp.location.uri);
    return other !== null && sameMethod(other, method);
  });
}

/** Whether two trigger ends name the same breakpoint, through any URI. */
function sameBreakpoint(a: TriggerRef, b: TriggerRef): boolean {
  return a.stepPoint === b.stepPoint && methodKey(a.uri) === methodKey(b.uri);
}

/** The step point `bp` lands on. VS Code counts lines from 0; the model from 1. */
function stepPointOf(info: StepPointInfo, bp: vscode.SourceBreakpoint): ResolvedStepPoint | null {
  const start = bp.location.range.start;
  return resolveStepPoint(info, start.line + 1, start.character);
}

/**
 * `bp`'s condition, or undefined for none. A condition of whitespace is no
 * condition: VS Code hands back what was typed, and an accidentally blank one
 * must not turn into a breakpoint that can never stop.
 */
function conditionOf(bp: vscode.SourceBreakpoint): string | undefined {
  return bp.condition?.trim() || undefined;
}

/**
 * `bp`'s log message, or undefined for none. Blank is none, as for a condition:
 * a blank message would make a breakpoint that never stops and logs empty lines.
 * Unlike a condition it is not trimmed, since its spacing is part of the text.
 */
function logMessageOf(bp: vscode.SourceBreakpoint): string | undefined {
  return bp.logMessage?.trim() ? bp.logMessage : undefined;
}

/**
 * The one breakpoint the gem gets for every VS Code breakpoint that landed on
 * one step point.
 *
 * Only the enabled ones decide what it does (all of them when none is): a
 * disabled breakpoint must not turn an enabled plain one beside it into a
 * logpoint, nor strip its condition. Among those, the reading that stops more
 * often wins: conditional only while every one has a condition, a logpoint only
 * while every one logs, since the gem has one breakpoint there. Differing texts
 * keep the first. A trigger is recorded per step point, so they share it.
 */
function collapse(
  resolved: ResolvedStepPoint,
  bps: readonly vscode.SourceBreakpoint[],
  triggeredBy: TriggerRef | undefined,
): AppliedBreakpoint {
  const enabled = bps.filter((bp) => bp.enabled);
  const deciding = enabled.length > 0 ? enabled : bps;
  const conditions = deciding.map(conditionOf);
  const messages = deciding.map(logMessageOf);
  return {
    stepPoint: resolved.stepPoint,
    offset: resolved.offset,
    line: resolved.line,
    enabled: enabled.length > 0,
    condition: conditions.includes(undefined) ? undefined : conditions[0],
    logMessage: messages.includes(undefined) ? undefined : messages[0],
    triggeredBy,
  };
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

/** Why an edited condition or log message is not in effect while the method's editor is dirty. */
const HELD_RULE_REFUSAL =
  'This method has unsaved edits, so its breakpoints are held as they are and ' +
  'the edited condition or log message is NOT in effect — the breakpoint goes on ' +
  'doing what it did before. Run "File: Revert File" and the edit applies; saving ' +
  'recompiles the method, which clears its breakpoints.';

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
 * Why a breakpoint with no step point to fall forward to is taken back out.
 *
 * Names the method, since one event can touch several. Below the last statement
 * is the usual cause, but `resolveStepPoint` also returns null for a method with
 * no step points and for a line past its end, so the wording covers all three.
 */
function noStepPointRefusal(count: number, where: string): string {
  const [subject, pronoun, verb] =
    count === 1 ? ['A breakpoint', 'it', 'it is'] : [`${count} breakpoints`, 'them', 'they are'];
  return (
    `${subject} in ${where} could never stop — there is no step point at or after ` +
    `${pronoun}, most often because ${verb} below the method's last statement. ` +
    `Set ${pronoun} on a statement instead.`
  );
}

/**
 * Whether this is a breakpoint on one of *our* documents that cannot hold one.
 *
 * Two things have to be true. The document must be Jasper's — which is what
 * keeps this honest, and is the guard that matters most: `onDidChangeBreakpoints`
 * reports every extension's breakpoints, so a rule of "not a compiled method"
 * alone would also match a Python file's, and taking those out of the
 * developer's Breakpoints panel would be a far worse bug than the one being
 * fixed. And the document must not be a compiled method's source, the one place
 * `applyToUri` can arm anything (see isMethodSourceUri, which this shares with
 * the rule that decides which documents are offered a gutter at all).
 *
 * "Ours" is read from the language (see BREAKPOINT_GUTTER_LANGUAGES), so it
 * covers a workspace, a `.gst` file, a notebook cell and the debugger's
 * read-only source alike, and it covers the `gemstone://` documents that are
 * Smalltalk but have no compiled method behind them — a class definition, an
 * uncompiled `new-method` template, an override diff view. It also still catches a
 * breakpoint VS Code restores from before the language split, when the gutter
 * was offered in all of those. A Topaz `.gs` or Tonel `.st` file is a GemStone
 * document but was never offered a gutter, so a breakpoint there is not ours to
 * take. A document that is not open has no language to read, so it falls back to
 * the extension VS Code would have used itself; anything else is left alone.
 */
function inviteWeCannotHonour(uri: vscode.Uri): boolean {
  if (isMethodSourceUri(uri)) return false;

  const uriStr = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriStr);
  if (open) return (BREAKPOINT_GUTTER_LANGUAGES as readonly string[]).includes(open.languageId);

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
