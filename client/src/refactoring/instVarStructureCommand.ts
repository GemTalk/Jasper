/**
 * The instance-variable structure refactorings (V2 push up, V3 push down, V5 convert
 * temporary to instance variable). V2/V3 are driven from the Explorer's instance-variable
 * row; V5 from a method source editor (cursor on the temporary). All three share one
 * server-side engine and one preview flow: run a pre-flight (viable? why not?), preview the
 * change set (class-definition edits + descendant reparents [+ a method recompile for V5]),
 * apply it server-side (new class versions, no commit), then let the caller refresh.
 *
 * Nothing is ever committed; the user commits explicitly. Existing instances keep their
 * prior class version and are NOT migrated (standard GemStone class evolution).
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import { IvarStructureOp, ConvertTempArgs } from './queries/previewInstVarStructure';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
} from './instVarStructurePreview';
import { showInstVarStructurePanel } from './instVarStructurePanel';
import {
  ensureRbSupport,
  refuse,
  resolveMethodEditor,
  wordAt,
  saveIfDirty,
  reloadMethodEditor,
} from './renameAtCursorShared';
import { logInfo } from '../gciLog';

export interface IvarStructureRequest {
  session: ActiveSession;
  op: IvarStructureOp;
  className: string;
  /** The instance-variable (V2/V3) or temporary (V5) name. */
  varName: string;
  heading: string;
  dict?: number | string;
  /** V5 only: the method + side the temporary lives in. */
  extra?: ConvertTempArgs;
  /** V2/V3 opt-in: also move the ivar's simple getter/setter accessors with the declaration. */
  moveAccessors?: boolean;
}

/** Preview + apply one instance-variable structure change. Answers true when it applied,
 *  false when cancelled/declined/failed. Surfaces its own user-facing messages. */
export async function runInstVarStructure(req: IvarStructureRequest): Promise<boolean> {
  const { session, op, className, varName, heading, dict, extra, moveAccessors } = req;
  logInfo(`[instVar:${op}] ${className}.${varName}${moveAccessors ? ' (+accessors)' : ''}`);

  if (!(await ensureRbSupport(session, heading))) return false;

  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeInstVarStructure(
        session,
        op,
        className,
        varName,
        dict,
        extra,
        moveAccessors,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    return false;
  }

  const token = `ivs_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearInstVarStructurePreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startInstVarStructurePreview(
        session,
        op,
        className,
        varName,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
        extra,
        moveAccessors,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    return false;
  }

  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    return false;
  }
  if (start.total === 0) {
    refuse('Nothing to change.');
    safeClear();
    return false;
  }

  const result = await showInstVarStructurePanel(heading, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageInstVarStructurePreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async (_deselected, options) =>
      parseApplyResult(
        await queries.applyInstVarStructure(
          session,
          token,
          options.migrateInstances,
          options.removeOldFromHistory,
        ),
      ),
    cleanup: safeClear,
  });
  if (!result) return false;

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Change failed: ${first.label}: ${first.error}`);
    return false;
  }

  const committedNote = result.committed ? ' and committed' : '';
  const migrateNote =
    result.migratedFailures && result.migratedFailures > 0
      ? ` (${result.migratedFailures} instance(s) failed to migrate)`
      : '';
  void vscode.window.showInformationMessage(
    `${heading} — applied ${result.applied} change(s)${committedNote}${migrateNote}.`,
  );
  return true;
}

/** V2/V3: push an instance variable up to the superclass / down into the subclasses. */
export async function pushInstVar(
  session: ActiveSession,
  direction: 'up' | 'down',
  className: string,
  ivarName: string,
  dict?: number | string,
): Promise<boolean> {
  const op: IvarStructureOp = direction === 'up' ? 'pushUp' : 'pushDown';
  const heading =
    direction === 'up'
      ? `Push instance variable '${ivarName}' up from ${className}`
      : `Push instance variable '${ivarName}' down from ${className}`;

  // Always carry the ivar's SIMPLE getter/setter accessors along with the declaration — a bare
  // `^ivar` / `ivar := arg` belongs with the variable it exposes. Anything that isn't a trivial
  // accessor is never moved, and the preview lists every change so the user can still cancel.
  return runInstVarStructure({
    session,
    op,
    className,
    varName: ivarName,
    heading,
    dict,
    moveAccessors: true,
  });
}

/** V5: convert the temporary at the cursor of the active method editor into an instance
 *  variable, then reload the editor to show the recompiled method. */
export async function convertTempToInstVarCommand(
  sessions: SessionManager,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[convertTemp] invoked');
  const target = resolveMethodEditor(sessions, position, 'a temporary');
  if (!target) return;

  const word = wordAt(target, 'a temporary');
  if (!word) return;
  const { editor, parsed, session, dict } = target;

  // The engine reads the STORED method source, so save a dirty buffer first.
  if (!(await saveIfDirty(editor))) return;

  const applied = await runInstVarStructure({
    session,
    op: 'convertTemp',
    className: parsed.className,
    varName: word.name,
    heading: `Convert temporary '${word.name}' to an instance variable`,
    dict,
    extra: { selector: parsed.selector, isMeta: parsed.isMeta, varName: word.name },
  });

  if (applied) await reloadMethodEditor(editor);
}
