/**
 * Shows a regex search's matches in the editor a hit opens in: the first match selected and scrolled
 * into view, every match marked in the editor's find-highlight colours. The marks clear on the first
 * edit to the document, since an edit moves the text they were placed on.
 *
 * Something may replace the editor just after the open, and the replacement has neither the
 * selection nor the marks: the GemStone Explorer, following the open to a method it was not
 * showing, opens that method itself, under its own form of the URI (with the dictionary's
 * position). `showMatches` therefore applies them again to any editor of the same method shown
 * within `RESHOW_WINDOW_MS`, matching the method rather than the URI.
 *
 * Matches are 0-based offsets into the document, `end` exclusive. A method edited since the search
 * may be shorter than they assume; a match that no longer fits is dropped rather than marking
 * whatever text is there now.
 */
import * as vscode from 'vscode';
import { parseUri } from './gemstoneFileSystemProvider';

export interface MatchOffsets {
  start: number;
  end: number;
}

/** The matches that still fit `doc`, in order, with empty ones and overlaps dropped. */
export function fittingMatches(
  doc: vscode.TextDocument,
  matches: readonly MatchOffsets[] | undefined,
): MatchOffsets[] {
  if (!matches) return [];
  const length = doc.getText().length;
  const out: MatchOffsets[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start < pos || m.end <= m.start || m.end > length) continue;
    out.push(m);
    pos = m.end;
  }
  return out;
}

/** The selection for the first match that fits `doc`, or undefined when none does. */
export function firstMatchSelection(
  doc: vscode.TextDocument,
  matches: readonly MatchOffsets[] | undefined,
): vscode.Selection | undefined {
  const [first] = fittingMatches(doc, matches);
  return first && new vscode.Selection(doc.positionAt(first.start), doc.positionAt(first.end));
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

/** Recent opens at their matches, by `methodKey`, until when a re-show is caught. */
const recent = new Map<
  string,
  { matches: readonly MatchOffsets[]; until: number; editor: vscode.TextEditor }
>();
let reapplyOnReshow: vscode.Disposable | undefined;

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
 * Show a regex hit's matches in the editor its method was opened in, and again in any editor of
 * that method shown within RESHOW_WINDOW_MS (see the module comment).
 */
export function showMatches(editor: vscode.TextEditor, matches: readonly MatchOffsets[]): void {
  applyMatches(editor, matches);
  recent.set(methodKey(editor.document.uri), {
    matches,
    until: Date.now() + RESHOW_WINDOW_MS,
    editor,
  });
  reapplyOnReshow ??= vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) reapplyIfReshown(ed);
    }),
    // A re-show that keeps focus elsewhere may not make the new editor the active one.
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(reapplyIfReshown)),
  );
}

/** Apply a recent open's matches to `ed` if it is a new editor of that method, inside the window. */
function reapplyIfReshown(ed: vscode.TextEditor): void {
  const key = methodKey(ed.document.uri);
  const pending = recent.get(key);
  if (!pending) return;
  if (Date.now() > pending.until) {
    recent.delete(key);
    return;
  }
  if (ed === pending.editor) return;
  pending.editor = ed;
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
