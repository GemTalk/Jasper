/**
 * Shows a regex search's matches in the editor a hit opens in: the first match selected and scrolled
 * into view, every match marked in the editor's find-highlight colours. The marks clear on the first
 * edit to the document, since an edit moves the text they were placed on.
 *
 * Matches are 0-based offsets into the document, `end` exclusive. A method edited since the search
 * may be shorter than they assume; a match that no longer fits is dropped rather than marking
 * whatever text is there now.
 */
import * as vscode from 'vscode';

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
