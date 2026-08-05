import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Most GemStone Explorer panes are created eagerly with `vscode.window.createTreeView`
// (gemstoneExplorer.ts). VS Code registers a contributed view only once its `when`
// clause is satisfied, and createTreeView throws "No view is registered with id:
// <id>" for a view whose `when` is still false. So a createTreeView-backed view
// must NOT be gated on a context key that is false at activation/login.
//
// The Open Editors pane is the exception: it hides when no gemstone:// editor is
// open, so it IS gated on `gemstone.explorerHasOpenEditors` (false at login). That
// is safe ONLY because explorerOpenEditors.ts registers it with
// `registerTreeDataProvider`, which tolerates a hidden view, rather than
// createTreeView. These tests pin that split so neither half regresses (an empty
// pane always showing, or the login crash shipped in 1.8.1 coming back).
const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const explorerViews: Array<{ id: string; when?: string }> = pkg.contributes.views.gemstoneExplorer;

const OPEN_EDITORS = 'gemstoneExplorerOpenEditors';

describe('GemStone Explorer views are registrable when created', () => {
  it('registers an Open Editors pane', () => {
    const ids = explorerViews.map((v) => v.id);

    expect(ids).toContain(OPEN_EDITORS);
  });

  it('hides the Open Editors pane when no editor is open (gated on active + content)', () => {
    const openEditors = explorerViews.find((v) => v.id === OPEN_EDITORS);

    expect(openEditors?.when).toBe('gemstone.explorerActive && gemstone.explorerHasOpenEditors');
  });

  it('registers the content-gated Open Editors pane with registerTreeDataProvider, not createTreeView', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'explorerOpenEditors.ts'), 'utf-8');

    expect(src).toContain('registerTreeDataProvider(VIEW_ID');
    expect(src).not.toContain('window.createTreeView(');
  });

  it.each(explorerViews.filter((v) => v.id !== OPEN_EDITORS))(
    'does not gate $id (a createTreeView pane) on a content key that is false at login',
    (view) => {
      expect(view.when ?? '').not.toContain('explorerHasOpenEditors');
    },
  );
});

// The Class Hierarchy pane starts collapsed so it doesn't crowd out the other
// panes. VS Code only applies a view's declared `visibility` when it has no
// stored layout for that view id, so the pane id must also stay in sync with
// the id passed to createTreeView — a mismatch throws "No view is registered".
const HIERARCHY = 'gemstoneExplorerClassHierarchy';

describe('GemStone Explorer Class Hierarchy pane', () => {
  it('starts collapsed to leave room for the other panes', () => {
    const hierarchy = explorerViews.find((v) => v.id === HIERARCHY) as
      { visibility?: string } | undefined;

    expect(hierarchy?.visibility).toBe('collapsed');
  });

  it('registers the pane under the id the source creates it with', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'gemstoneExplorer.ts'), 'utf-8');

    expect(src).toContain(`createTreeView('${HIERARCHY}'`);
  });
});
