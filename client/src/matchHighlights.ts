/**
 * Shows a regex search's matches in the editor a hit opens in: the first match selected and scrolled
 * into view, every match marked in the editor's find-highlight colours. The marks clear on the first
 * edit to the document, since an edit moves the text they were placed on.
 *
 * Something may replace the editor just after the open, and the replacement has neither the
 * selection nor the marks: the GemStone Explorer, following the open to a method it was not
 * showing, opens that method itself, under its own form of the URI (with the dictionary's
 * position). `showMatches` therefore applies them again, once, to a new editor of the same method
 * shown within `RESHOW_WINDOW_MS`, matching the method rather than the URI. An editor of it that
 * was already open (in another group, say) is left as the user had it.
 *
 * Matches are 0-based offsets into the document, `end` exclusive, counted in characters as the stone
 * counts them (see matchOffsets.ts for the conversion). A method edited since the search may be
 * shorter than they assume; a match that no longer fits is dropped rather than marking whatever
 * text is there now.
 *
 * A match can be empty (a pattern like `^` or `x*`): it is not marked, but if it is the first match
 * the cursor is put there.
 */
import * as vscode from 'vscode';
import { parseUri } from './gemstoneFileSystemProvider';
import { codePointMatchesToUtf16 } from './matchOffsets';

export interface MatchOffsets {
  start: number;
  end: number;
}

/** The matches that still fit `doc`, as offsets into its text, in order, with empty ones and
 *  overlaps dropped: the ones worth a mark. */
export function fittingMatches(
  doc: vscode.TextDocument,
  matches: readonly MatchOffsets[] | undefined,
): MatchOffsets[] {
  if (!matches) return [];
  const text = doc.getText();
  const out: MatchOffsets[] = [];
  let pos = 0;
  for (const m of codePointMatchesToUtf16(text, matches)) {
    if (m.start < pos || m.end <= m.start || m.end > text.length) continue;
    out.push(m);
    pos = m.end;
  }
  return out;
}

/** The selection for the first match, or undefined when it does not fit `doc`. An empty first match
 *  (a pattern like `^`) gives an empty selection: the cursor, placed where it matched. */
export function firstMatchSelection(
  doc: vscode.TextDocument,
  matches: readonly MatchOffsets[] | undefined,
): vscode.Selection | undefined {
  if (!matches || matches.length === 0) return undefined;
  const text = doc.getText();
  const [first] = codePointMatchesToUtf16(text, [matches[0]]);
  if (first.start < 0 || first.end < first.start || first.end > text.length) return undefined;
  return new vscode.Selection(doc.positionAt(first.start), doc.positionAt(first.end));
}

let decoration: vscode.TextEditorDecorationType | undefined;
let clearOnEdit: vscode.Disposable | undefined;
/** Documents (by URI) with marks on them, so an edit knows whether there is anything to clear. */
const marked = new Set<string>();

function matchDecoration(): vscode.TextEditorDecorationType {
  decoration ??= vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
    borderStyle: 'solid',
    borderWidth: '1px',
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  return decoration;
}

/** How long after an open an editor of the same method gets its matches again. */
export const RESHOW_WINDOW_MS = 3000;

/** Recent opens at their matches, by `methodKey`, until when a re-show is caught. Exported for its
 *  test only. */
export const recent = new Map<
  string,
  { matches: readonly MatchOffsets[]; until: number; seen: Set<vscode.TextEditor> }
>();
let reapplyOnReshow: vscode.Disposable | undefined;

/** Release the marks' style and listeners when the extension deactivates, like its other
 *  registrations. */
export function disposeMatchHighlights(): void {
  decoration?.dispose();
  clearOnEdit?.dispose();
  reapplyOnReshow?.dispose();
  decoration = clearOnEdit = reapplyOnReshow = undefined;
  marked.clear();
  recent.clear();
}

/** The method a document holds, whatever form its URI takes; the URI itself for anything else. */
export function methodKey(uri: vscode.Uri): string {
  try {
    const p = parseUri(uri);
    if (p.kind === 'method') {
      return [
        uri.scheme,
        p.sessionId,
        p.dictName,
        p.className,
        p.isMeta,
        p.selector,
        p.environmentId,
      ].join('|');
    }
  } catch {
    // Not a GemStone URI: fall through.
  }
  return uri.toString();
}

/** Select the first match in `editor` and reveal it, then mark every match. */
function applyMatches(editor: vscode.TextEditor, matches: readonly MatchOffsets[]): void {
  const selection = firstMatchSelection(editor.document, matches);
  if (selection) {
    editor.selection = selection;
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  markMatches(editor, matches);
}

/**
 * Show a regex hit's matches in the editor its method was opened in, and again in a new editor of
 * that method shown within RESHOW_WINDOW_MS (see the module comment).
 */
export function showMatches(editor: vscode.TextEditor, matches: readonly MatchOffsets[]): void {
  applyMatches(editor, matches);
  // An entry is otherwise dropped only when its method is shown again, so opens nobody re-shows
  // would pile up for the life of the window.
  const now = Date.now();
  for (const [key, entry] of recent) if (now > entry.until) recent.delete(key);
  recent.set(methodKey(editor.document.uri), {
    matches,
    until: Date.now() + RESHOW_WINDOW_MS,
    // Editors already showing the method (another group, say) are the user's: only a new one counts.
    seen: new Set([editor, ...vscode.window.visibleTextEditors]),
  });
  reapplyOnReshow ??= vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) reapplyIfReshown(ed);
    }),
    // A re-show that keeps focus elsewhere may not make the new editor the active one.
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(reapplyIfReshown)),
  );
}

/** Apply a recent open's matches to `ed` if it is a new editor of that method, inside the window, once. */
function reapplyIfReshown(ed: vscode.TextEditor): void {
  const key = methodKey(ed.document.uri);
  const pending = recent.get(key);
  if (!pending) return;
  if (Date.now() > pending.until) {
    recent.delete(key);
    return;
  }
  if (pending.seen.has(ed)) return;
  pending.seen.add(ed);
  applyMatches(ed, pending.matches);
}

/** Mark every match that fits `editor`'s document. Replaces any marks it had. */
export function markMatches(
  editor: vscode.TextEditor,
  matches: readonly MatchOffsets[] | undefined,
): void {
  const doc = editor.document;
  const ranges = fittingMatches(doc, matches).map(
    (m) => new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end)),
  );
  editor.setDecorations(matchDecoration(), ranges);
  if (ranges.length === 0) return;
  marked.add(doc.uri.toString());
  clearOnEdit ??= vscode.workspace.onDidChangeTextDocument((e) => {
    const key = e.document.uri.toString();
    if (e.contentChanges.length === 0 || !marked.delete(key)) return;
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === key) ed.setDecorations(matchDecoration(), []);
    }
  });
}
