import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseMethodUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';

export interface VerifiedBreakpoint {
  stepPoint: number;
  actualLine: number;
  verified: boolean;
}

interface TrackedBreakpoint {
  stepPoint: number;
  actualLine: number;
}

export class BreakpointManager {
  private tracked = new Map<string, TrackedBreakpoint[]>();

  constructor(private sessionManager: SessionManager) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.debug.onDidChangeBreakpoints((e) => this.onBreakpointsChanged(e)),
    );
  }

  /**
   * Set breakpoints for a method source. Clears any existing breakpoints on
   * the method first, then sets the requested ones.
   * Returns verified breakpoint locations (line may differ from requested).
   */
  setBreakpointsForSource(
    session: ActiveSession,
    uri: vscode.Uri,
    lines: number[],
  ): VerifiedBreakpoint[] {
    const method = parseMethodUri(uri);
    if (!method || method.diffView)
      return lines.map(() => ({ stepPoint: 0, actualLine: 0, verified: false }));

    try {
      // Clear existing breakpoints on this method
      queries.clearAllBreaks(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
    } catch {
      /* method may not exist */
    }

    if (lines.length === 0) {
      this.tracked.delete(uri.toString());
      return [];
    }

    let source: string;
    let sourceOffsets: number[];
    try {
      source = queries.getMethodSource(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
      sourceOffsets = queries.getSourceOffsets(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
    } catch {
      return lines.map(() => ({ stepPoint: 0, actualLine: 0, verified: false }));
    }

    const lineOffsets = buildLineOffsets(source);
    const results: VerifiedBreakpoint[] = [];
    const tracked: TrackedBreakpoint[] = [];

    for (const line of lines) {
      const result = mapLineToStepPoint(line, lineOffsets, sourceOffsets);
      if (result) {
        try {
          queries.setBreakAtStepPoint(
            session,
            method.className,
            method.isMeta,
            method.selector,
            result.stepPoint,
            method.environmentId,
          );
          results.push({
            stepPoint: result.stepPoint,
            actualLine: result.actualLine,
            verified: true,
          });
          tracked.push({ stepPoint: result.stepPoint, actualLine: result.actualLine });
        } catch {
          results.push({ stepPoint: 0, actualLine: line, verified: false });
        }
      } else {
        results.push({ stepPoint: 0, actualLine: line, verified: false });
      }
    }

    this.tracked.set(uri.toString(), tracked);
    return results;
  }

  /**
   * Called after a method is recompiled — re-applies tracked breakpoints.
   */
  invalidateForUri(uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = this.tracked.get(key);
    if (!existing || existing.length === 0) return;

    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    // Get current VS Code breakpoints for this URI
    const vsBps = vscode.debug.breakpoints.filter(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint && bp.enabled && bp.location.uri.toString() === key,
    ) as vscode.SourceBreakpoint[];

    if (vsBps.length > 0) {
      const lines = vsBps.map((bp) => bp.location.range.start.line + 1); // VS Code is 0-based
      this.setBreakpointsForSource(session, uri, lines);
    } else {
      this.tracked.delete(key);
    }
  }

  /**
   * Called when a session logs out — clear tracking for that session.
   */
  clearAllForSession(sessionId: number): void {
    // Remove tracked breakpoints whose URI belongs to this session
    for (const [key] of this.tracked) {
      if (key.startsWith(`gemstone://${sessionId}/`)) {
        this.tracked.delete(key);
      }
    }
  }

  private onBreakpointsChanged(event: vscode.BreakpointsChangeEvent): void {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    // Collect all gemstone:// URIs that were affected
    const affectedUris = new Set<string>();

    for (const bp of [...event.added, ...event.removed, ...event.changed]) {
      if (bp instanceof vscode.SourceBreakpoint) {
        const uri = bp.location.uri;
        if (uri.scheme === 'gemstone') {
          affectedUris.add(uri.toString());
        }
      }
    }

    // For each affected URI, recompute all breakpoints (absolute model)
    for (const uriStr of affectedUris) {
      const uri = vscode.Uri.parse(uriStr);
      const allBps = vscode.debug.breakpoints.filter(
        (bp) =>
          bp instanceof vscode.SourceBreakpoint &&
          bp.enabled &&
          bp.location.uri.toString() === uriStr,
      ) as vscode.SourceBreakpoint[];

      const lines = allBps.map((bp) => bp.location.range.start.line + 1); // 0-based → 1-based
      this.setBreakpointsForSource(session, uri, lines);
    }
  }
}

/**
 * Build a table of character offsets for the start of each line (1-based).
 * lineOffsets[1] = 0 (first line starts at offset 0)
 * lineOffsets[2] = position after first newline
 * etc.
 */
export function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0]; // dummy at index 0
  offsets.push(0); // line 1 starts at offset 0

  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Map a precise 0-based cursor offset to a step point — column-aware, for "Run to
 * Cursor" (#2). Prefers the step point on the cursor's OWN line that is nearest the
 * cursor column, so a cursor on `asInteger` in `x := (...) asInteger` breaks at
 * `asInteger` (not the leftmost `:=` store), and a cursor inside a one-line block
 * (`self do: [:e | body ]`) breaks INSIDE the block (not at the `do:` send). When
 * the cursor's line has no step point, falls back to the nearest step point at or
 * after the cursor (run forward). Returns null when nothing is at/after it.
 *
 * `sourceOffsets` are GemStone 1-based source positions; `lineStart`/`lineEnd` are
 * the 0-based char offsets bounding the cursor's line (end exclusive).
 */
export function mapOffsetToStepPoint(
  cursorOffset: number,
  sourceOffsets: number[],
  lineStart: number,
  lineEnd: number,
): { stepPoint: number; offset: number } | null {
  // 1) Nearest step point on the cursor's own line (by column distance).
  let bestOnLine: { stepPoint: number; offset: number; dist: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const off0 = sourceOffsets[i] - 1; // 1-based source position → 0-based char offset
    if (off0 >= lineStart && off0 < lineEnd) {
      const dist = Math.abs(off0 - cursorOffset);
      if (bestOnLine === null || dist < bestOnLine.dist) {
        bestOnLine = { stepPoint: i + 1, offset: sourceOffsets[i], dist };
      }
    }
  }
  if (bestOnLine) return { stepPoint: bestOnLine.stepPoint, offset: bestOnLine.offset };

  // 2) No step point on this line — run forward to the nearest one after the cursor.
  let bestAfter: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const off0 = sourceOffsets[i] - 1;
    if (off0 >= cursorOffset && (bestAfter === null || sourceOffsets[i] < bestAfter.offset)) {
      bestAfter = { stepPoint: i + 1, offset: sourceOffsets[i] };
    }
  }
  return bestAfter;
}

/**
 * Map a source line number (1-based) to a step point.
 * Returns the step point number and the actual line it maps to,
 * or null if no valid step point can be found.
 */
export function mapLineToStepPoint(
  targetLine: number,
  lineOffsets: number[],
  sourceOffsets: number[],
): { stepPoint: number; actualLine: number } | null {
  if (sourceOffsets.length === 0) return null;
  if (targetLine < 1 || targetLine >= lineOffsets.length) return null;

  const targetStart = lineOffsets[targetLine];
  const targetEnd = targetLine + 1 < lineOffsets.length ? lineOffsets[targetLine + 1] : Infinity;

  // Find step points on the target line
  let bestOnLine: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const offset = sourceOffsets[i];
    if (offset >= targetStart && offset < targetEnd) {
      if (!bestOnLine || offset < bestOnLine.offset) {
        bestOnLine = { stepPoint: i + 1, offset }; // step points are 1-based
      }
    }
  }

  if (bestOnLine) {
    return { stepPoint: bestOnLine.stepPoint, actualLine: targetLine };
  }

  // No step point on target line — find nearest step point after targetStart
  let bestAfter: { stepPoint: number; offset: number } | null = null;
  for (let i = 0; i < sourceOffsets.length; i++) {
    const offset = sourceOffsets[i];
    if (offset >= targetStart) {
      if (!bestAfter || offset < bestAfter.offset) {
        bestAfter = { stepPoint: i + 1, offset };
      }
    }
  }

  if (bestAfter) {
    // Find the line number for this offset
    let actualLine = 1;
    for (let l = 1; l < lineOffsets.length; l++) {
      if (lineOffsets[l] <= bestAfter.offset) {
        actualLine = l;
      } else {
        break;
      }
    }
    return { stepPoint: bestAfter.stepPoint, actualLine };
  }

  return null;
}
