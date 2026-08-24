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

// Jasper contributes one activity-bar container, so the Explorer panes share it
// with the admin views. Select them by id rather than by container.
const gemstoneViews: Array<{ id: string; when?: string; visibility?: string }> =
  pkg.contributes.views.gemstone;
const explorerViews = gemstoneViews.filter((v) => v.id.startsWith('gemstoneExplorer'));

const OPEN_EDITORS = 'gemstoneExplorerOpenEditors';

describe('Jasper contributes one activity-bar container', () => {
  it('shows a single GemStone icon in the activity bar', () => {
    const ids = (pkg.contributes.viewsContainers.activitybar as Array<{ id: string }>).map(
      (c) => c.id,
    );

    expect(ids).toEqual(['gemstone']);
  });

  it('puts the Explorer panes in that container', () => {
    expect(explorerViews.map((v) => v.id)).toContain('gemstoneExplorerDicts');
  });
});

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

// A command referenced from a menu (title bar, row context, palette) but never
// declared in contributes.commands shows up only at runtime as "command not
// found". Guard our own gemstone.* commands so a new menu entry can't drift out
// of sync with its declaration.
describe('command manifest consistency', () => {
  const declared = new Set<string>(
    (pkg.contributes.commands as Array<{ command: string }>).map((c) => c.command),
  );
  const menus = pkg.contributes.menus as Record<string, Array<{ command?: string }>>;
  const menuCommands = new Set<string>();
  for (const group of Object.values(menus)) {
    for (const item of group) if (item.command) menuCommands.add(item.command);
  }

  it('declares every gemstone command that a menu references', () => {
    const missing = [...menuCommands]
      .filter((c) => c.startsWith('gemstone'))
      .filter((c) => !declared.has(c))
      .sort();

    expect(missing).toEqual([]);
  });
});

// The mirror of the command check above, for view ids. A menu `when` that gates
// on a `view ==` id no view declares is silently, permanently false — the entry
// just never appears, with no runtime error. That is exactly how the Insert /
// Extract Superclass items vanished when the Hierarchy pane was renamed but two
// of its menu clauses weren't. Guard every view reference so a renamed or
// mistyped id fails a test instead of quietly dropping a menu item.
describe('menu view-id consistency', () => {
  const declaredViews = new Set<string>();
  for (const views of Object.values(
    pkg.contributes.views as Record<string, Array<{ id: string }>>,
  )) {
    for (const v of views) declaredViews.add(v.id);
  }

  const whens: string[] = [];
  for (const group of Object.values(
    pkg.contributes.menus as Record<string, Array<{ when?: string }>>,
  )) {
    for (const item of group) if (item.when) whens.push(item.when);
  }

  it('references only declared view ids in exact `view ==` menu clauses', () => {
    const referenced = new Set<string>();
    for (const when of whens) {
      for (const m of when.matchAll(/view\s*==\s*([A-Za-z0-9_.]+)/g)) referenced.add(m[1]);
    }

    const missing = [...referenced].filter((id) => !declaredViews.has(id)).sort();

    expect(missing).toEqual([]);
  });

  it('uses only `view =~` menu patterns that match at least one declared view', () => {
    const dead: string[] = [];
    for (const when of whens) {
      for (const m of when.matchAll(/view\s*=~\s*\/([^/]+)\//g)) {
        const re = new RegExp(m[1]);
        if (![...declaredViews].some((id) => re.test(id))) dead.push(m[1]);
      }
    }

    expect(dead).toEqual([]);
  });
});
