/**
 * Pure helpers for the move-method (M6) preview: parsing the engine's pre-flight
 * analysis, the paginated preview envelope, and the apply result. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * M6 relocates one OR MORE methods from a source class/side to a different class
 * and/or the other side. Per movable selector it stages a `methodAdd` on the target
 * (the same source, verbatim) plus a `methodRemove` on the source. Both changes for a
 * selector are required together, so every row is a CORE row (checked + disabled): the
 * user chooses WHICH methods to move at drag/command time, not in the preview.
 *
 * A selector that cannot move is dropped from the change set and reported in
 * `skippedMethods` (with a reason); a GLOBAL decline (target missing, or a same-class
 * same-side no-op) empties the whole change set and rides in `outOfScope.decline`.
 *
 * The envelope shape and parsers are shared with push-method via
 * `methodRelocationPreview`; this module just names the M6-specific types and builds the
 * parsers with move's (empty) per-change / per-selector extensions.
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

export type MoveChangeKind = MethodChangeKind;

/** One staged change: a `methodAdd` (compile on the target, no old source) or a
 *  `methodRemove` (delete from the source, no new source). Move has no extra fields. */
export type MoveChange = BaseMethodChange;

/** A selector that will NOT move, with the reason. */
export type SkippedMethod = RelocationSkippedMethod;

/** Preview preconditions. `decline` (a global decline) blocks Apply; `collision` is
 *  always null for move (per-selector collisions ride in `skippedMethods`). */
export type MoveOutOfScope = RelocationOutOfScope;

export type PreviewPage = RelocationPreviewPage<MoveChange>;

export type StartMovePreview = StartRelocationPreview<MoveChange>;

export type ApplyResult = RelocationApplyResult;

/** One selector's pre-flight verdict. */
export type MoveSelectorAnalysis = BaseSelectorAnalysis;

/** The engine pre-flight: the resolved target class, a global decline (if any), the
 *  count that will move, and a per-selector decline. */
export type MoveAnalysis = RelocationAnalysis<MoveSelectorAnalysis>;

const parseChange = makeParseChange<MoveChange>('Move', () => ({}));

/** Parse the pre-flight analysis payload. Throws on a bare error string (which fails
 *  JSON.parse). */
export const parseAnalysis = makeParseAnalysis<MoveSelectorAnalysis>('Move', () => ({}));

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export const parseStartPreview = makeParseStartPreview<MoveChange>('Move', parseChange);

export const parsePage = makeParsePage<MoveChange>('Move', parseChange);

export const parseApplyResult = parseApplyResultShared;

/** A human label for a preview row: "Class[ class]>>selector" tagged with the move
 *  direction (add onto the target / remove from the source). */
export function moveChangeLabel(change: MoveChange): string {
  const base = relocationChangeStem(change);
  return change.kind === 'methodAdd' ? `${base} (add to target)` : `${base} (remove from source)`;
}
