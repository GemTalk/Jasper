import { asCount } from './previewCounts';

/**
 * The apply-result envelope every RB refactoring's server-side apply returns: how
 * many changes applied, which ones failed (with a per-change reason), and an
 * optional top-level error. This is the single home for it (RB catalog C3),
 * replacing the byte-identical private copies each simple family carried.
 *
 * Refactorings that can COMMIT (the class-reshape family: rename-class,
 * extract-superclass, split-class, instVar add/remove and structure) return a
 * SUPERSET with `committed` / `migratedFailures` / `dropped`; they get the same
 * base through `parseApplyResultWith` and contribute only their extra fields, so
 * the envelope validation, the `failed` filtering and the `asCount` clamp have
 * exactly one implementation. No `vscode` dependency, so it unit-tests directly.
 *
 * Two more producers arrived with undo (#434): a method-only refactoring's apply
 * adds `undoRecorded`, and UNDOING one answers this same envelope. Both are read
 * through the plain `parseApplyResult` -- an unknown extra field is ignored, so
 * neither needed a variant of its own.
 */
export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/**
 * Parse a server-side apply result. Throws only when the payload is not a JSON object
 * (a malformed envelope is a bug, not a user-facing outcome); everything inside it is
 * coerced rather than rejected — `applied` is clamped to a non-negative count, a
 * non-array or malformed `failed` degrades to an empty list, and a missing field in a
 * failure entry falls back to `'?'` / `'unknown error'`. A whole-apply failure the
 * engine reports (an expired preview token, say) arrives as `error`, not as a throw.
 *
 * Most families reach this through a bare re-export, which carries no doc comment of
 * its own — so this block is what their call sites see.
 */
export function parseApplyResult(json: string): ApplyResult {
  return parseApplyResultWith(json, () => ({}));
}

/**
 * `parseApplyResult` for a family whose apply answers a SUPERSET of the envelope.
 * `extend` receives the already-validated raw envelope and answers only the extra
 * fields; the base is parsed here, once. Mirrors `makeParseChange` in
 * methodRelocationPreview (RB catalog C2), which does the same for preview changes.
 */
export function parseApplyResultWith<T extends ApplyResult>(
  json: string,
  extend: (env: Record<string, unknown>) => Omit<T, keyof ApplyResult>,
): T {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Apply did not return a result envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const failed = Array.isArray(env.failed)
    ? env.failed
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({
          id: typeof f.id === 'string' ? f.id : '?',
          label: typeof f.label === 'string' ? f.label : '?',
          error: typeof f.error === 'string' ? f.error : 'unknown error',
        }))
    : [];
  const base: ApplyResult = {
    applied: asCount(env.applied),
    failed,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
  return { ...base, ...extend(env) } as T;
}
