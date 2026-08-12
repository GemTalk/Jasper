import { asCount } from './previewCounts';
import { ApplyResult as BaseApplyResult, parseApplyResultWith } from './previewEnvelope';
/**
 * Pure helpers for the rename-class (R3) preview: parsing the server-side
 * engine's paginated preview envelope and the apply result, and validating a new
 * class name. Kept free of any `vscode` dependency so it unit-tests directly.
 *
 * The engine (GsRenameClassRefactoring) stages three kinds of change:
 *   - classRename   — the target class (className = old name, newName = new name);
 *     apply creates the new class version, copies methods forward, rebinds.
 *   - classReparent — a descendant re-pointed at the new parent version.
 *   - methodRecompile — an OUTSIDE method whose reference to the old name is
 *     rewritten (the renamed subtree's own methods are handled by copy-forward,
 *     so they are NOT staged here).
 * The classRename and classReparent changes are STRUCTURAL — they always apply,
 * regardless of the deselected set; only methodRecompile references are optional.
 */

export type ClassChangeKind = 'classRename' | 'classReparent' | 'methodRecompile';

/** One staged change from the engine. `newName` is set only for classRename. */
export interface ClassRenameChange {
  id: string;
  kind: ClassChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  newName: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** How many OUTSIDE references fall outside the chosen scope (and so will not be
 *  rewritten), how many descendants are re-parented (always, unscoped), how many
 *  in-scope methods could not be rewritten (skipped), and — if the new name is
 *  already in use — the collision reason. Surfaced as a warning in the preview. */
export interface ClassOutOfScope {
  references: number;
  descendants: number;
  skipped: number;
  collision: string | null;
}

/** A method the engine could not rewrite (and skipped). */
export interface SkippedMethod {
  className: string;
  selector: string;
}

export interface PreviewPage {
  changes: ClassRenameChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartClassPreview {
  token: string;
  total: number;
  oldName: string;
  newName: string;
  outOfScope: ClassOutOfScope;
  skippedMethods: SkippedMethod[];
  page: PreviewPage;
}

export interface ApplyResult extends BaseApplyResult {
  /** True when the apply committed (the migrate-instances / remove-old options
   *  require a durable commit). */
  committed?: boolean;
  /** Instances that failed to migrate (only meaningful when migrate was on). */
  migratedFailures?: number;
}

function parseChange(raw: unknown, i: number): ClassRenameChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Rename preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'classRename' && kind !== 'classReparent' && kind !== 'methodRecompile') {
    throw new Error(`Rename preview change ${i} has an unknown kind: ${String(kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string' ||
    typeof c.oldSource !== 'string'
  ) {
    throw new Error(`Rename preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    newName: typeof c.newName === 'string' ? c.newName : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: c.oldSource,
    newSource: c.newSource,
  };
}

function parseSkipped(v: unknown): SkippedMethod[] {
  return Array.isArray(v)
    ? v
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          className: typeof m.class === 'string' ? m.class : '?',
          selector: typeof m.selector === 'string' ? m.selector : '?',
        }))
    : [];
}

function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Rename preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload; the
 *  stone returns a bare error string (e.g. "Class not found: Foo") when it can't
 *  build the preview, which fails JSON.parse and is reported as an error. */
export function parseStartPreview(json: string): StartClassPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Rename preview did not return a session token.');
  }
  const oos =
    typeof env.outOfScope === 'object' && env.outOfScope !== null
      ? (env.outOfScope as Record<string, unknown>)
      : {};
  const page =
    typeof env.page === 'object' && env.page !== null
      ? parsePageObject(env.page as Record<string, unknown>)
      : { changes: [], nextOffset: 0, done: true };
  return {
    token: env.token,
    total: asCount(env.total),
    oldName: typeof env.oldName === 'string' ? env.oldName : '',
    newName: typeof env.newName === 'string' ? env.newName : '',
    outOfScope: {
      references: asCount(oos.references),
      descendants: asCount(oos.descendants),
      skipped: asCount(oos.skipped),
      collision: typeof oos.collision === 'string' ? oos.collision : null,
    },
    skippedMethods: parseSkipped(env.skippedMethods),
    page,
  };
}

export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): ApplyResult {
  return parseApplyResultWith(json, (env) => ({
    committed: env.committed === true,
    migratedFailures: asCount(env.migratedFailures),
  }));
}

/** True when a change is structural (always applied, cannot be deselected). */
export function isStructuralChange(change: ClassRenameChange): boolean {
  return change.kind === 'classRename' || change.kind === 'classReparent';
}

/** A human label for a preview row. */
export function classChangeLabel(change: ClassRenameChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'methodRecompile') {
    return `${change.className}${side}>>${change.selector ?? '?'}`;
  }
  return `${change.className}${side}`;
}

/** Validate a proposed new class name against the old name. Returns an error
 *  string to show inline, or undefined when acceptable. A GemStone class name is
 *  a capitalised identifier; it must differ from the old name. */
export function validateNewClassName(value: string, oldName: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) return 'Enter a new class name.';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return 'A class name must be a letter followed by letters, digits, or underscores.';
  }
  if (name === oldName) return 'Enter a different name.';
  return undefined;
}
