import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseMethodUri, MethodUriRef } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { StepPointSelectorInfo } from './browserQueries';
import { expandKeywordParts } from './stepPointSelectors';

/**
 * Where every step point of one compiled method sits in its source, as the
 * stone reports it.
 */
export interface StepPointInfo {
  /** The stone's copy of the method source — what `offsets` index into. */
  source: string;
  /**
   * 0-based source offsets, one per step point: `offsets[i]` is step point
   * `i + 1`. This is the complete list — `GsNMethod >> _sourceOffsets` has an
   * entry for every step point, including ones starting at `:=`, `^`, a literal
   * or a block bracket rather than at a selector.
   */
  offsets: number[];
  /**
   * Selector token ranges, for the subset of step points beginning on an
   * identifier, with a keyword message's continuation keywords expanded in (so
   * `assert:equals:` contributes both parts under one step point). Only decides
   * what to *underline*; `offsets` decides numbering.
   */
  selectors: StepPointSelectorInfo[];
  /** 0-based offset where each 1-based line starts; `lineStarts[1]` is 0. */
  lineStarts: number[];
}

/** Either a method's step points, or why it hasn't got any we can use. */
export type StepPointResult = { info: StepPointInfo } | { problem: string };

/**
 * Per-method step point positions, fetched once and cached.
 *
 * The single home for "where are this method's step points" — the breakpoint
 * manager, the inlay hints, the hover and the cursor-toggle command all read it
 * from here, so a method is queried once per open rather than once per feature,
 * and they cannot disagree about which token is step point 7.
 *
 * Everything is expressed against the *stone's* source rather than an editor
 * buffer, so the debug adapter (which only ever has line numbers) and the editor
 * features resolve step points through the same code. It refuses a dirty
 * document because the stone's offsets would then point at the wrong tokens —
 * a wrong step point number is worse than none, and it would send a breakpoint
 * somewhere the developer didn't ask for.
 */
export class StepPointModel {
  private cache = new Map<string, StepPointInfo>();

  /** Why the last `fetch` returned null, for `explain` to pass on. */
  private lastError: string | undefined;

  constructor(private sessionManager: SessionManager) {}

  /**
   * Step points for `document`, or null when they can't be trusted or fetched.
   *
   * For the quiet consumers — the hover and the inlay hints — which have nothing
   * useful to say about a document that has no step points and must not nag. A
   * command the developer invoked deliberately should use `explain` instead, so
   * "nothing happened" can be told apart from "nothing was supposed to happen".
   */
  get(document: vscode.TextDocument): StepPointInfo | null {
    const result = this.explain(document);
    return 'info' in result ? result.info : null;
  }

  /**
   * Step points for `document`, or the reason there are none — phrased for the
   * developer, because every one of these is something they can act on.
   */
  explain(document: vscode.TextDocument): StepPointResult {
    if (document.uri.scheme !== 'gemstone') {
      return { problem: 'Breakpoints can only be set in GemStone method source.' };
    }
    if (document.isDirty) {
      // Step point offsets come from the compiled method, so they describe the
      // saved source, not what is on screen. Acting on them now would put the
      // breakpoint somewhere the developer didn't point at.
      return {
        problem:
          'This method has unsaved edits — step points come from the compiled method, ' +
          'not the text on screen. Save the method, or run "File: Revert File", and try again.',
      };
    }

    const method = parseMethodUri(document.uri);
    if (!method) {
      return { problem: 'This editor is not a saved method, so it has no step points.' };
    }
    if (method.diffView) {
      return {
        problem: 'This is a read-only comparison view — set the breakpoint in the method itself.',
      };
    }

    const session = this.sessionManager.getSelectedSession();
    if (!session) return { problem: 'No active GemStone session.' };

    const info = this.fetch(session, document.uri, method);
    if (!info) {
      return {
        problem: `Could not read step points for ${method.className}>>${method.selector}${
          this.lastError ? ` — ${this.lastError}` : ''
        }`,
      };
    }
    if (info.offsets.length === 0) {
      return { problem: 'This method has no step points to break at.' };
    }
    return { info };
  }

  /**
   * Step points for a method identified by coordinates rather than an open
   * document — the path the debug adapter and the breakpoint applier take.
   */
  fetch(session: ActiveSession, uri: vscode.Uri, method: MethodUriRef): StepPointInfo | null {
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached) return cached;

    let source: string;
    let rawOffsets: number[];
    let rawSelectors: StepPointSelectorInfo[];
    try {
      source = queries.getMethodSource(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
      rawOffsets = queries.getSourceOffsets(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
      rawSelectors = queries.getStepPointSelectorRanges(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
    } catch (e) {
      // The method may have been removed, or its class renamed, since the editor
      // opened. Callers treat null as "no step points known"; `explain` reports
      // the stone's own words, which say which of those it was.
      this.lastError = e instanceof Error ? e.message : String(e);
      return null;
    }

    this.lastError = undefined;
    const info: StepPointInfo = {
      source,
      // _sourceOffsets is 1-based; every consumer here works in 0-based offsets.
      offsets: rawOffsets.map((o) => o - 1),
      selectors: expandKeywordParts(source, rawSelectors),
      lineStarts: buildLineStarts(source),
    };
    this.cache.set(key, info);
    return info;
  }

  /** Drop the cache for one method — call after it is recompiled. */
  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
  }

  /** Drop every cached method belonging to a session that has logged out. */
  invalidateSession(sessionId: number): void {
    const prefix = `gemstone://${sessionId}/`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Drop everything — e.g. when the selected session changes. */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * 0-based offset of the start of each 1-based line. Index 0 is unused padding so
 * `lineStarts[n]` reads as "line n", matching how GemStone and the debug adapter
 * both count lines.
 */
export function buildLineStarts(source: string): number[] {
  const starts = [0, 0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** The 1-based line containing `offset`. */
export function lineOfOffset(lineStarts: number[], offset: number): number {
  let line = 1;
  for (let l = 1; l < lineStarts.length; l++) {
    if (lineStarts[l] <= offset) line = l;
    else break;
  }
  return line;
}

/** A resolved breakpoint position: which step point, and where it actually is. */
export interface ResolvedStepPoint {
  stepPoint: number;
  /** 0-based source offset of the step point. */
  offset: number;
  /** 1-based line the step point is on — may differ from the line asked for. */
  line: number;
}

/**
 * The step point a breakpoint request lands on.
 *
 * `line` is 1-based. `character` is a 0-based column, or undefined for a plain
 * gutter click, which carries no column at all:
 *
 * - **No column** (or column 0) — the *leftmost* step point on the line. A
 *   gutter click means "this line", and the leftmost step point is the only
 *   defensible reading of that.
 * - **A column** — from an inline breakpoint or Jasper's own toggle-at-cursor —
 *   the step point on that line nearest the column, so a caret on `asInteger`
 *   in `x := (...) asInteger` breaks at `asInteger`, not at the leftmost store,
 *   and a caret inside a one-line block breaks inside the block.
 *
 * Either way, a line with no step point of its own falls forward to the next
 * step point after it, and the returned `line` says where the breakpoint really
 * ended up so VS Code can show it moved. Returns null when there is no step
 * point at or after the request — a breakpoint past the last statement.
 */
export function resolveStepPoint(
  info: StepPointInfo,
  line: number,
  character?: number,
): ResolvedStepPoint | null {
  const { offsets, lineStarts } = info;
  if (offsets.length === 0) return null;
  if (line < 1 || line >= lineStarts.length) return null;

  const lineStart = lineStarts[line];
  const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : info.source.length + 1;

  let best: { stepPoint: number; offset: number } | null = null;

  if (character === undefined || character <= 0) {
    // Leftmost step point on the line.
    for (let i = 0; i < offsets.length; i++) {
      const at = offsets[i];
      if (at >= lineStart && at < lineEnd && (best === null || at < best.offset)) {
        best = { stepPoint: i + 1, offset: at };
      }
    }
  } else {
    // Nearest step point on the line by column.
    const target = lineStart + character;
    let bestDist = Infinity;
    for (let i = 0; i < offsets.length; i++) {
      const at = offsets[i];
      if (at >= lineStart && at < lineEnd) {
        const dist = Math.abs(at - target);
        if (dist < bestDist) {
          bestDist = dist;
          best = { stepPoint: i + 1, offset: at };
        }
      }
    }
  }

  if (best) {
    return { stepPoint: best.stepPoint, offset: best.offset, line };
  }

  // Nothing on this line — fall forward to the next step point after it.
  let after: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < offsets.length; i++) {
    const at = offsets[i];
    if (at >= lineStart && (after === null || at < after.offset)) {
      after = { stepPoint: i + 1, offset: at };
    }
  }
  if (!after) return null;
  return {
    stepPoint: after.stepPoint,
    offset: after.offset,
    line: lineOfOffset(lineStarts, after.offset),
  };
}

/**
 * The step point nearest a caret at `offset`, for toggle-at-cursor and hover.
 * Prefers a step point on the caret's own line, then falls forward — the same
 * rule `resolveStepPoint` applies with a column.
 */
export function stepPointAtOffset(info: StepPointInfo, offset: number): ResolvedStepPoint | null {
  const line = lineOfOffset(info.lineStarts, offset);
  const character = offset - info.lineStarts[line];
  // A caret in column 0 still means "where the caret is", not "this whole
  // line", so keep it on the column path by nudging it off zero.
  return resolveStepPoint(info, line, Math.max(character, 1));
}

/** Every source range that should be marked for `stepPoint`, in offset pairs. */
export function rangesForStepPoint(
  info: StepPointInfo,
  stepPoint: number,
): { start: number; end: number }[] {
  const ranges = info.selectors
    .filter((s) => s.stepPoint === stepPoint)
    .map((s) => ({ start: s.selectorOffset, end: s.selectorOffset + s.selectorLength }));
  if (ranges.length > 0) return ranges;

  // A step point that doesn't start on an identifier (`:=`, `^`, a literal, a
  // block bracket) has no selector range — mark the single character at it so
  // the breakpoint is still visible.
  const at = info.offsets[stepPoint - 1];
  if (at === undefined) return [];
  return [{ start: at, end: at + 1 }];
}
