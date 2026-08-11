import { asCount } from './previewCounts';

/**
 * The apply-result envelope every RB refactoring's server-side apply returns: how
 * many changes applied, which ones failed (with a per-change reason), and an
 * optional top-level error. This is the single home for it (RB catalog C3),
 * replacing the byte-identical private copies each simple family carried.
 *
 * Refactorings that can COMMIT (the class-reshape family: rename-class,
 * extract-superclass, instVar add/remove and structure) return a SUPERSET with
 * `committed` / `migratedFailures`; those keep their own parser for now. A later
 * step can express those as this base plus an `extend` hook (the shape C2's
 * `makeParseChange` already uses for method-relocation changes). No `vscode`
 * dependency, so it unit-tests directly.
 */
export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

export function parseApplyResult(json: string): ApplyResult {
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
  return {
    applied: asCount(env.applied),
    failed,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}
