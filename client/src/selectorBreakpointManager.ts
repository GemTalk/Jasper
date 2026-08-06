import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseMethodUri, MethodUriRef } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { StepPointSelectorInfo } from './browserQueries';

interface TrackedSelectorBreakpoint {
  stepPoint: number;
  selectorOffset: number;
  selectorLength: number;
  selectorText: string;
}

const decorationType = vscode.window.createTextEditorDecorationType({
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  overviewRulerColor: new vscode.ThemeColor('debugIcon.breakpointForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

export class SelectorBreakpointManager {
  private breakpoints = new Map<string, TrackedSelectorBreakpoint[]>();
  private selectorInfoCache = new Map<string, StepPointSelectorInfo[]>();

  constructor(private sessionManager: SessionManager) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.refreshDecorations(editor);
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this.refreshDecorations(editor);
      }),
    );
  }

  toggleBreakpointAtCursor(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== 'gemstone') return;

    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    const uri = editor.document.uri;
    const uriKey = uri.toString();
    const method = parseMethodUri(uri);
    if (!method || method.diffView) return;

    const infos = this.getSelectorInfos(session, uri, method, editor.document.getText());
    if (!infos || infos.length === 0) {
      vscode.window.showInformationMessage('No breakpointable step points found in this method.');
      return;
    }

    const cursorOffset = editor.document.offsetAt(editor.selection.active);
    const target = findNearestStepPoint(infos, cursorOffset);
    if (!target) return;

    // Use the primary (first) entry for this step point for tracking
    const primary = infos.find((i) => i.stepPoint === target.stepPoint) ?? target;

    const tracked = this.breakpoints.get(uriKey) ?? [];
    const existingIdx = tracked.findIndex((bp) => bp.stepPoint === target.stepPoint);

    try {
      if (existingIdx >= 0) {
        queries.clearBreakAtStepPoint(
          session,
          method.className,
          method.isMeta,
          method.selector,
          target.stepPoint,
          method.environmentId,
        );
        tracked.splice(existingIdx, 1);
      } else {
        queries.setBreakAtStepPoint(
          session,
          method.className,
          method.isMeta,
          method.selector,
          target.stepPoint,
          method.environmentId,
        );
        tracked.push({
          stepPoint: primary.stepPoint,
          selectorOffset: primary.selectorOffset,
          selectorLength: primary.selectorLength,
          selectorText: primary.selectorText,
        });
      }
    } catch (e) {
      vscode.window.showErrorMessage(
        `Breakpoint operation failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    if (tracked.length > 0) {
      this.breakpoints.set(uriKey, tracked);
    } else {
      this.breakpoints.delete(uriKey);
    }

    this.refreshDecorations(editor);
  }

  refreshDecorations(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== 'gemstone') return;
    const uriKey = editor.document.uri.toString();
    const tracked = this.breakpoints.get(uriKey) ?? [];
    const cached = this.selectorInfoCache.get(uriKey);

    const ranges: vscode.Range[] = [];
    for (const bp of tracked) {
      if (cached) {
        // Highlight all keyword parts (e.g., both assert: and equals:)
        for (const info of cached) {
          if (info.stepPoint === bp.stepPoint) {
            ranges.push(
              new vscode.Range(
                editor.document.positionAt(info.selectorOffset),
                editor.document.positionAt(info.selectorOffset + info.selectorLength),
              ),
            );
          }
        }
      } else {
        // Fallback: use the tracked entry's own range
        ranges.push(
          new vscode.Range(
            editor.document.positionAt(bp.selectorOffset),
            editor.document.positionAt(bp.selectorOffset + bp.selectorLength),
          ),
        );
      }
    }
    editor.setDecorations(decorationType, ranges);
  }

  /**
   * Called when a method is recompiled. Recompiling replaces the GsNMethod,
   * so any breakpoints on the old method are gone. Clear tracking and cache.
   */
  invalidateForUri(uri: vscode.Uri): void {
    const uriKey = uri.toString();
    this.selectorInfoCache.delete(uriKey);
    this.breakpoints.delete(uriKey);
    this.refreshVisibleEditorsForUri(uri);
  }

  clearAllForSession(sessionId: number): void {
    const prefix = `gemstone://${sessionId}/`;
    for (const [key] of this.breakpoints) {
      if (key.startsWith(prefix)) {
        this.breakpoints.delete(key);
        this.selectorInfoCache.delete(key);
      }
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString().startsWith(prefix)) {
        editor.setDecorations(decorationType, []);
      }
    }
  }

  private getSelectorInfos(
    session: ActiveSession,
    uri: vscode.Uri,
    method: MethodUriRef,
    source?: string,
  ): StepPointSelectorInfo[] | null {
    const uriKey = uri.toString();
    const cached = this.selectorInfoCache.get(uriKey);
    if (cached) return cached;

    try {
      const rawInfos = queries.getStepPointSelectorRanges(
        session,
        method.className,
        method.isMeta,
        method.selector,
        method.environmentId,
      );
      const infos = source ? expandKeywordParts(source, rawInfos) : rawInfos;
      this.selectorInfoCache.set(uriKey, infos);
      return infos;
    } catch (e) {
      vscode.window.showErrorMessage(
        `Could not fetch step points: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private refreshVisibleEditorsForUri(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uriStr) {
        this.refreshDecorations(editor);
      }
    }
  }
}

/**
 * Find the step point whose selector range contains the cursor offset,
 * or failing that the one whose selector start is nearest to the cursor.
 */
export function findNearestStepPoint(
  infos: StepPointSelectorInfo[],
  cursorOffset: number,
): StepPointSelectorInfo | null {
  if (infos.length === 0) return null;

  // First: exact containment — cursor is within a selector token
  for (const info of infos) {
    if (
      cursorOffset >= info.selectorOffset &&
      cursorOffset <= info.selectorOffset + info.selectorLength
    ) {
      return info;
    }
  }

  // Second: nearest by absolute distance to selector midpoint
  let nearest = infos[0];
  let minDist = Math.abs(cursorOffset - (infos[0].selectorOffset + infos[0].selectorLength / 2));
  for (let i = 1; i < infos.length; i++) {
    const mid = infos[i].selectorOffset + infos[i].selectorLength / 2;
    const dist = Math.abs(cursorOffset - mid);
    if (dist < minDist) {
      minDist = dist;
      nearest = infos[i];
    }
  }
  return nearest;
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}

function isTokenChar(ch: string): boolean {
  return /[a-zA-Z0-9_:]/.test(ch);
}

/**
 * For keyword messages (e.g., `assert:equals:`), the GCI query only returns
 * the first keyword (`assert:`) at the step point offset. This function scans
 * the source text to find continuation keywords (`equals:`) at the same
 * nesting depth and adds them as additional entries with the same step point.
 */
export function expandKeywordParts(
  source: string,
  infos: StepPointSelectorInfo[],
): StepPointSelectorInfo[] {
  const expanded: StepPointSelectorInfo[] = [];
  for (const info of infos) {
    expanded.push(info);
    if (!info.selectorText.endsWith(':')) continue;

    let pos = info.selectorOffset + info.selectorLength;
    let depth = 0;

    while (pos < source.length && depth >= 0) {
      const ch = source[pos];

      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        pos++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth < 0) break;
        pos++;
        continue;
      }
      if (ch === '.' || ch === ';') break;

      // Skip string literals (handle embedded '' quotes)
      if (ch === "'") {
        pos++;
        while (pos < source.length) {
          if (source[pos] === "'") {
            pos++;
            if (pos >= source.length || source[pos] !== "'") break;
          }
          pos++;
        }
        continue;
      }

      // Skip comments
      if (ch === '"') {
        pos++;
        while (pos < source.length && source[pos] !== '"') pos++;
        if (pos < source.length) pos++;
        continue;
      }

      // Skip symbol literals (#word or #'string')
      if (ch === '#') {
        pos++;
        if (pos < source.length && source[pos] === "'") {
          pos++;
          while (pos < source.length && source[pos] !== "'") pos++;
          if (pos < source.length) pos++;
        } else if (pos < source.length && isIdentStart(source[pos])) {
          while (pos < source.length && isTokenChar(source[pos])) pos++;
        }
        continue;
      }

      // At depth 0, check for continuation keyword
      if (depth === 0 && isIdentStart(ch)) {
        const start = pos;
        pos++;
        while (pos < source.length && isTokenChar(source[pos])) pos++;
        const token = source.substring(start, pos);
        if (token.endsWith(':')) {
          expanded.push({
            stepPoint: info.stepPoint,
            selectorOffset: start,
            selectorLength: token.length,
            selectorText: token,
          });
        }
        continue;
      }

      pos++;
    }
  }
  return expanded;
}
