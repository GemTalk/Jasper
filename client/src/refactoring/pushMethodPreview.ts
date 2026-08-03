/**
 * Pure helpers for the push-up / push-down method (M7 / M8) preview: parsing the
 * engine's pre-flight analysis, the paginated preview envelope, and the apply result.
 * No `vscode` dependency, so it unit-tests directly.
 *
 * Push-UP relocates one OR MORE methods from a class to its immediate SUPERCLASS.
 * Push-DOWN relocates them from a class into its immediate SUBCLASSES. Both keep the
 * selector and the source verbatim and the same side (no instance↔class flip). Per
 * movable selector, push-up stages one `methodAdd` on the superclass + one
 * `methodRemove` on the source; push-down stages one `methodAdd` per receiving subclass
 * + a single `methodRemove` on the source. Both changes for a selector are required
 * together, so every row is a CORE row (checked + disabled): the user chose WHICH
 * methods to push at command time, not in the preview.
 *
 * A selector that cannot move is dropped from the change set and reported in
 * `skippedMethods` (with a reason); a GLOBAL decline (no superclass for push-up, no
 * subclasses for push-down) empties the whole change set and rides in
 * `outOfScope.decline`. The engine's JSON shape is move-method's plus a per-change /
 * per-selector `warning` (an overwrite data-loss note), so this module builds the shared
 * relocation parsers with that one extension.
 */
import {
  BaseMethodChange,
  BaseSelectorAnalysis,
  MethodChangeKind,
  RelocationAnalysis,
  RelocationApplyResult,
  RelocationOutOfScope,
  RelocationPreviewPage,
  RelocationSkippedMethod,
  StartRelocationPreview,
  makeParseAnalysis,
  makeParseChange,
  makeParsePage,
  makeParseStartPreview,
  parseApplyResult as parseApplyResultShared,
  relocationChangeStem,
} from './methodRelocationPreview';

export type PushChangeKind = MethodChangeKind;

/** One staged change: a `methodAdd` (compile on the target) or a `methodRemove` (delete
 *  from the source). Push extends the base change with a data-loss `warning`. */
export interface PushChange extends BaseMethodChange {
  /** A data-loss warning when this change overwrites an existing method (its definition is
   *  lost); null for a non-destructive change. Overwrite rows are shown un-ticked by default
   *  so the user opts in. */
  warning: string | null;
}

/** A selector that will NOT move, with the reason. */
export type PushSkippedMethod = RelocationSkippedMethod;

/** Preview preconditions. `decline` (a global decline) blocks Apply; `collision` is
 *  always null for push (per-selector collisions ride in `skippedMethods`). */
export type PushOutOfScope = RelocationOutOfScope;

export type PushPreviewPage = RelocationPreviewPage<PushChange>;

export type StartPushPreview = StartRelocationPreview<PushChange>;

export type PushApplyResult = RelocationApplyResult;

/** One selector's pre-flight verdict. */
export interface PushSelectorAnalysis extends BaseSelectorAnalysis {
  /** A data-loss warning when pushing this selector would overwrite an existing method
   *  (push-up: the superclass's; push-down: one or more subclass overrides); null otherwise.
   *  The selector still moves — the overwrite is opt-in in the preview. */
  warning: string | null;
}

/** The engine pre-flight: the resolved target (superclass name, or null for
 *  push-down), a global decline (if any), the count that will move, and a per-selector
 *  decline. */
export type PushAnalysis = RelocationAnalysis<PushSelectorAnalysis>;

const parseChange = makeParseChange<PushChange>('Push', (c) => ({
  warning: typeof c.warning === 'string' ? c.warning : null,
}));

/** Parse the pre-flight analysis payload. Throws on a bare error string (which fails
 *  JSON.parse). */
export const parseAnalysis = makeParseAnalysis<PushSelectorAnalysis>('Push', (s) => ({
  warning: typeof s.warning === 'string' ? s.warning : null,
}));

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export const parseStartPreview = makeParseStartPreview<PushChange>('Push', parseChange);

export const parsePage = makeParsePage<PushChange>('Push', parseChange);

export const parseApplyResult = parseApplyResultShared;

/** A human label for a preview row: "Class[ class]>>selector" tagged with what the change
 *  does — add onto the target, OVERWRITE an existing target method, or remove from the
 *  source. */
export function pushChangeLabel(change: PushChange): string {
  const base = relocationChangeStem(change);
  if (change.kind === 'methodRemove') return `${base} (remove from source)`;
  return change.warning ? `${base} (overwrite existing)` : `${base} (add to target)`;
}
