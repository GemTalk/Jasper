/**
 * The extract-superclass refactorings (V6 insert superclass, V7 extract superclass), driven from
 * the Explorer class row. Both share one server-side engine and one preview flow:
 *
 *   V6 Insert Superclass — prompt for a new class name, then insert an empty class between the
 *      anchor and its current superclass.
 *   V7 Extract Superclass — pick which SIBLING classes to pull up too (opt-in, none pre-picked),
 *      name the new superclass, then pick which common members to hoist (identical members
 *      pre-checked; divergent/partial opt-in; unhoistable not offered), and insert the new parent
 *      hoisting the chosen members.
 *
 * The apply creates new class versions server-side and never commits (existing instances keep
 * their prior version) — the user commits explicitly. Returns the new class name on success so
 * the caller can reveal it.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import { HoistSets } from './queries/previewExtractSuperclass';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  MemberCandidates,
} from './extractSuperclassPreview';
import { showExtractSuperclassPanel } from './extractSuperclassPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo } from '../gciLog';

export interface ExtractSuperContext {
  session: ActiveSession;
  className: string;
  dict?: number | string;
}

export interface ExtractSuperResult {
  newClass: string;
  applied: number;
}

/** A valid GemStone class name: a capitalised identifier. Returns an error string or null. */
function validateClassName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a class name.';
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(trimmed)) {
    return 'A class name must start with an uppercase letter and contain only letters, digits, or underscores.';
  }
  return null;
}

/** Save any open GemStone method editors with unsaved edits, so the engine hoists their CURRENT
 *  source rather than the stale stored version. The single-editor refactorings do this with
 *  `saveIfDirty(editor)`; extract-superclass is Explorer-driven with no single active editor, so
 *  flush every dirty `gemstone:`-scheme buffer. Returns false (and refuses) if one will not save
 *  — e.g. it does not compile — leaving the user to fix it before retrying. */
async function flushDirtyMethodBuffers(): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter(
    (d) => d.isDirty && d.uri.scheme === 'gemstone',
  );
  for (const doc of dirty) {
    if (!(await doc.save())) {
      refuse('Save your open method edits before extracting a superclass.');
      return false;
    }
  }
  return true;
}

/** Validate a proposed new-superclass name: its FORMAT, and that the name is not already bound
 *  to a global anywhere on the symbol list.
 *
 *  The format check alone is not enough. The engine's collision precondition resolves the name
 *  with `environment classNamed:`, which answers nil for anything that is not a Class — so a
 *  name bound to a NON-class global (say `UserGlobals at: #Pet` holding a collection or a
 *  constant) passes both the format check and the precondition, and the apply's
 *  `subclass: newName … inDictionary:` then rebinds that key to the new class, silently
 *  destroying the existing global.
 *
 *  Mirrors ExplorerController's rename guard (`validateRenameTarget`), which layers the same
 *  `globalNameInUse` probe on top of its format check. Runs as the input box's live validator,
 *  so the collision surfaces inline while the user is still typing. */
function validateNewSuperclassName(session: ActiveSession, name: string): string | undefined {
  const fmt = validateClassName(name);
  if (fmt) return fmt;
  if (queries.globalNameInUse(session, name.trim())) {
    return `The name ${name.trim()} is already in use. Choose another.`;
  }
  return undefined;
}

async function promptNewClassName(
  session: ActiveSession,
  anchor: string,
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: `New superclass for ${anchor}`,
    prompt: 'Name of the new superclass to insert',
    placeHolder: 'e.g. AbstractShape',
    ignoreFocusOut: true,
    validateInput: (v) => validateNewSuperclassName(session, v),
  });
  return name?.trim();
}

interface MemberPick extends vscode.QuickPickItem {
  memberType: 'method' | 'ivar';
  key: string;
}

/** Build the member-selection QuickPick items from the classified candidates. Unhoistable
 *  members are not offered (they cannot compile on the new superclass); identical members are
 *  pre-picked; divergent/partial are offered un-picked with a warning. */
function buildMemberPicks(candidates: MemberCandidates, anchor: string): MemberPick[] {
  const picks: MemberPick[] = [];
  const methods = candidates.methods.filter((m) => m.kind !== 'unhoistable');
  const ivars = candidates.instVars.filter((v) => v.kind !== 'unhoistable');
  if (methods.length > 0) {
    picks.push({
      label: 'Methods',
      kind: vscode.QuickPickItemKind.Separator,
      memberType: 'method',
      key: '',
    });
    for (const m of methods) {
      picks.push({
        label: m.selector,
        description:
          m.kind === 'identical'
            ? 'shared'
            : m.kind === 'divergent'
              ? `⚠ differs — keeps ${anchor}'s version`
              : `only in ${anchor}`,
        picked: m.defaultChecked,
        memberType: 'method',
        key: m.selector,
      });
    }
  }
  if (ivars.length > 0) {
    picks.push({
      label: 'Instance variables',
      kind: vscode.QuickPickItemKind.Separator,
      memberType: 'ivar',
      key: '',
    });
    for (const v of ivars) {
      picks.push({
        label: v.name,
        description: v.kind === 'identical' ? 'shared' : 'only in some',
        picked: v.defaultChecked,
        memberType: 'ivar',
        key: v.name,
      });
    }
  }
  return picks;
}

/** The shared analyze → preview → panel → apply core. Returns the new class name + applied count
 *  on success, or undefined if cancelled/declined/failed (surfacing its own messages). */
async function runExtractSuperclass(
  ctx: ExtractSuperContext,
  heading: string,
  newName: string,
  siblings: string[],
  hoist: HoistSets,
): Promise<ExtractSuperResult | undefined> {
  const { session, className, dict } = ctx;

  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeExtractSuperclass(session, className, newName, siblings, hoist, dict),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    return undefined;
  }

  const token = `esup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearExtractSuperclassPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startExtractSuperclassPreview(
        session,
        className,
        newName,
        siblings,
        hoist,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    return undefined;
  }

  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    return undefined;
  }
  if (start.total === 0) {
    refuse('Nothing to change.');
    safeClear();
    return undefined;
  }

  const result = await showExtractSuperclassPanel(heading, start, {
    loadPage: async (off) =>
      parsePage(
        await queries.pageExtractSuperclassPreview(session, token, off, PREVIEW_PAGE_BYTES),
      ),
    apply: async () => parseApplyResult(await queries.applyExtractSuperclass(session, token)),
    cleanup: safeClear,
  });
  if (!result) return undefined;

  if (result.error) {
    void vscode.window.showErrorMessage(`${heading} failed: ${result.error}`);
    return undefined;
  }
  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(
      `Change failed: ${first.label}: ${first.error}. Earlier changes may have been applied — abort the transaction to discard them.`,
    );
    return undefined;
  }
  // Defensive: the preview was non-empty (guarded above) and the apply is all-or-nothing, so
  // zero changes applied without an error/failure is an impossible-in-practice state — but do not
  // claim success for it (the "no false success" rule).
  if (result.applied === 0) {
    void vscode.window.showErrorMessage(`${heading} applied no changes.`);
    return undefined;
  }

  void vscode.window.showInformationMessage(
    `${heading} — applied ${result.applied} change(s). Existing instances keep their prior version; commit to persist.`,
  );
  return { newClass: newName, applied: result.applied };
}

/** V6: insert an empty superclass above the anchor class. */
export async function insertSuperclassCommand(
  ctx: ExtractSuperContext,
): Promise<ExtractSuperResult | undefined> {
  logInfo(`[insertSuperclass] ${ctx.className}`);
  if (!(await ensureRbSupport(ctx.session, 'Inserting a superclass'))) return undefined;

  const newName = await promptNewClassName(ctx.session, ctx.className);
  if (!newName) return undefined;

  return runExtractSuperclass(
    ctx,
    `Insert superclass '${newName}' above ${ctx.className}`,
    newName,
    [],
    { methods: [], instVars: [] },
  );
}

/** V7: extract a common superclass above the anchor and chosen siblings, hoisting chosen members. */
export async function extractSuperclassCommand(
  ctx: ExtractSuperContext,
): Promise<ExtractSuperResult | undefined> {
  logInfo(`[extractSuperclass] ${ctx.className}`);
  if (!(await ensureRbSupport(ctx.session, 'Extracting a superclass'))) return undefined;

  // 1. Which siblings to pull up too? (opt-in — none pre-picked). Skip if the anchor is an only child.
  let siblings: string[] = [];
  const siblingNames = queries.getSiblingClassNames(ctx.session, ctx.className, ctx.dict);
  if (siblingNames.length > 0) {
    const picked = await vscode.window.showQuickPick(siblingNames, {
      title: `Extract superclass — also pull up siblings of ${ctx.className}?`,
      placeHolder: 'Select sibling classes to include (none = extract above this class alone)',
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (picked === undefined) return undefined; // cancelled
    siblings = picked;
  }

  // 2. Name the new superclass.
  const newName = await promptNewClassName(ctx.session, ctx.className);
  if (!newName) return undefined;

  // The engine classifies and hoists by reading each class's STORED method source, so flush any
  // unsaved method edits first — otherwise a dirty editor's method would hoist at its stale saved
  // version. Explorer-driven (no single active editor), so flush every dirty method buffer.
  if (!(await flushDirtyMethodBuffers())) return undefined;

  // 3. Which common members to hoist? Classify across {anchor} ∪ siblings.
  let candidates: MemberCandidates;
  try {
    candidates = parseCandidates(
      await queries.candidatesForExtractSuperclass(ctx.session, ctx.className, siblings, ctx.dict),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Could not classify members: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (candidates.decline) {
    refuse(candidates.decline);
    return undefined;
  }

  const hoist: HoistSets = { methods: [], instVars: [] };
  const picks = buildMemberPicks(candidates, ctx.className);
  if (picks.length > 0) {
    const chosen = await vscode.window.showQuickPick(picks, {
      title: `Extract superclass '${newName}' — which members to pull up?`,
      placeHolder: 'Identical members are pre-selected; opt in to the rest',
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (chosen === undefined) return undefined; // cancelled
    for (const c of chosen) {
      if (c.memberType === 'method') hoist.methods.push(c.key);
      else hoist.instVars.push(c.key);
    }
  }

  const where = siblings.length > 0 ? ` (with ${siblings.join(', ')})` : '';
  return runExtractSuperclass(
    ctx,
    `Extract superclass '${newName}' from ${ctx.className}${where}`,
    newName,
    siblings,
    hoist,
  );
}
