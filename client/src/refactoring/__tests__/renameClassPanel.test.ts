// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderClassPanelHtml, renderClassCards } from '../renameClassPanelHtml';
import { ClassRenameChange } from '../renameClassPreview';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameMethodPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    deselectedIds: () => string[];
  };
}
function api(): PanelApi {
  return (globalThis as unknown as { RenameMethodPanel: PanelApi }).RenameMethodPanel;
}

const renameChange: ClassRenameChange = {
  id: '1',
  kind: 'classRename',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: null,
  newName: 'Bar',
  category: null,
  oldSource: "Object subclass: 'Foo'\n  instVarNames: #( x)",
  newSource: "Object subclass: 'Bar'\n  instVarNames: #( x)",
};
const reparentChange: ClassRenameChange = {
  id: '2',
  kind: 'classReparent',
  dictName: 'UserGlobals',
  className: 'Sub',
  isMeta: false,
  selector: null,
  newName: null,
  category: null,
  oldSource: "Foo subclass: 'Sub'",
  newSource: "Bar subclass: 'Sub'",
};
const refChange: ClassRenameChange = {
  id: '3',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Other',
  isMeta: false,
  selector: 'usesFoo',
  newName: null,
  category: 'making',
  oldSource: 'usesFoo "a Foo comment" ^Foo new',
  newSource: 'usesFoo "a Foo comment" ^Bar new',
};

function mount(over: Partial<Parameters<typeof renderClassPanelHtml>[0]> = {}) {
  const full = renderClassPanelHtml({
    oldName: 'Foo',
    newName: 'Bar',
    total: 3,
    recompileSubclasses: true,
    migrateInstances: true,
    removeOldFromHistory: false,
    changes: [renameChange, reparentChange, refChange],
    done: true,
    outOfScope: { references: 0, descendants: 1, skipped: 0, collision: null },
    skippedMethods: [],
    nonce: 'test',
    script: '',
    ...over,
  });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.setAttribute('data-total', String(over.total ?? 3));
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode, full };
}

describe('rename-class preview panel HTML', () => {
  it('shows the old → new class name in the rename card header', () => {
    const html = renderClassCards([renameChange]);

    expect(html).toContain('Foo');
    expect(html).toContain('Bar');
    expect(html).toContain('sel-added');
  });

  it('rewrites the real reference but keeps the comment spelling in the diff', () => {
    const html = renderClassCards([refChange]);

    expect(html).toContain('+usesFoo &quot;a Foo comment&quot; ^Bar new');
    expect(html).toContain('-usesFoo &quot;a Foo comment&quot; ^Foo new');
  });

  it('renders structural changes with a disabled, checked checkbox', () => {
    const { full } = mount();

    const structural = full.match(/data-id="1"[\s\S]*?<input[^>]*>/)![0];
    expect(structural).toContain('disabled');
    expect(structural).toContain('checked');
  });

  it('warns prominently when the new name collides', () => {
    const { full } = mount({
      outOfScope: {
        references: 0,
        descendants: 0,
        skipped: 0,
        collision: 'the name Bar is already in use',
      },
    });

    expect(full).toContain('the name Bar is already in use');
  });

  it('notes that subclasses will be re-parented when recompile is on', () => {
    const { full } = mount();

    expect(full).toMatch(/1 subclass will be re-parented onto the new version/);
  });

  it('warns that subclasses will be orphaned when recompile is off', () => {
    const { full } = mount({ recompileSubclasses: false });

    expect(full).toMatch(/NOT be re-parented/);
    expect(full).toContain('orphaned');
  });

  it('states instances will be migrated when migrate is on, or stay put when off', () => {
    expect(mount().full).toContain('migrated to the new version');
    expect(mount({ migrateInstances: false }).full).toContain('stay on their prior version');
  });

  it('warns in the preview that migrating instances commits the transaction', () => {
    const full = mount({ migrateInstances: true, removeOldFromHistory: false }).full;

    expect(full).toMatch(/commit the transaction[\s\S]*Migrate all instances/);
  });

  it('warns that removing old versions commits even when instances are not migrated', () => {
    const full = mount({ migrateInstances: false, removeOldFromHistory: true }).full;

    expect(full).toMatch(/commit the transaction[\s\S]*Remove old versions from class history/);
  });

  it('names both persistent options in the commit warning when both are chosen', () => {
    const full = mount({ migrateInstances: true, removeOldFromHistory: true }).full;

    expect(full).toContain('Migrate all instances');
    expect(full).toContain('Remove old versions from class history');
    expect(full).toContain('each require a commit');
  });

  it('states the rename applies without committing when no persistent option is chosen', () => {
    const full = mount({ migrateInstances: false, removeOldFromHistory: false }).full;

    expect(full).toContain('applies without committing');
  });
});

describe('rename-class panel apply behaviour', () => {
  it('never reports a structural change as deselected, even though it counts as selected', () => {
    const { handle } = mount();
    const structuralCb = document.querySelector<HTMLInputElement>('li.change[data-id="1"] .sel')!;

    expect(structuralCb.disabled).toBe(true);
    expect(handle.deselectedIds()).toEqual([]);
  });

  it('reports only an unchecked optional reference as deselected', () => {
    const { handle } = mount();
    const optionalCb = document.querySelector<HTMLInputElement>('li.change[data-id="3"] .sel')!;

    optionalCb.checked = false;
    optionalCb.dispatchEvent(new Event('change'));

    expect(handle.deselectedIds()).toEqual(['3']);
  });
});
