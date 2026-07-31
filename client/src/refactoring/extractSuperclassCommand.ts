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

async function promptNewClassName(anchor: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: `New superclass for ${anchor}`,
    prompt: 'Name of the new superclass to insert',
    placeHolder: 'e.g. AbstractShape',
    ignoreFocusOut: true,
    validateInput: (v) => validateClassName(v) ?? undefined,
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

  const newName = await promptNewClassName(ctx.className);
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
  const newName = await promptNewClassName(ctx.className);
  if (!newName) return undefined;

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
