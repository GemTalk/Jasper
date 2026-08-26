/**
 * Pure parser for the per-method history JSON the GsMethodHistory engine returns
 * (see gs-src/refactoring/engine/GsMethodHistory.class.st). Kept free of any
 * `vscode` dependency so it unit-tests directly.
 *
 * One entry per recorded version, NEWEST first. Each carries the version's 1-based
 * index (oldest-first, stable to reference), when it was compiled (timeStamp) and
 * by whom (userId), the category it was filed under, its source, and an isCurrent
 * flag marking the version whose source matches the method installed right now.
 *
 * A version with `notInHistory: true` is synthetic: the currently-installed method
 * is not represented in the recorded history (e.g. it was last edited outside
 * Jasper), so the engine surfaces it as the current version with no recorded
 * index/timestamp. It is never offered for "restore" (it is already current).
 */

export interface MethodVersion {
  /** 1-based position in the recorded history, oldest first (0 for the synthetic
   *  current version, which has no recorded slot). */
  index: number;
  /** Locale-neutral ISO-8601 (yyyy-mm-ddTHH:MM:SS), or '' when unknown. */
  timeStamp: string;
  userId: string;
  category: string;
  isCurrent: boolean;
  source: string;
  /** True only for the synthetic current version (installed but not recorded). */
  notInHistory: boolean;
}

/** Parse the history JSON. Throws on the engine's error envelope (unbound name)
 *  or a malformed payload — callers surface that as an error. */
export function parseMethodHistory(json: string): MethodVersion[] {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    typeof (parsed as Record<string, unknown>).error === 'string'
  ) {
    throw new Error((parsed as Record<string, unknown>).error as string);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Method history did not return a version array.');
  }
  return parsed
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      index: typeof v.index === 'number' ? v.index : 0,
      timeStamp: typeof v.timeStamp === 'string' ? v.timeStamp : '',
      userId: typeof v.userId === 'string' ? v.userId : '',
      category: typeof v.category === 'string' ? v.category : '',
      isCurrent: v.isCurrent === true,
      source: typeof v.source === 'string' ? v.source : '',
      notInHistory: v.notInHistory === true,
    }));
}

/** The result of forgetting a method's recorded history. */
export interface RemoveMethodHistoryResult {
  removed: boolean;
  error?: string;
}

/** Parse the remove-history result envelope. */
export function parseRemoveMethodHistoryResult(json: string): RemoveMethodHistoryResult {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Remove history did not return a result envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    removed: env.removed === true,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** The current version in a list, if the list marks one. */
export function currentVersion(versions: MethodVersion[]): MethodVersion | undefined {
  return versions.find((v) => v.isCurrent);
}
