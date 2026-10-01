// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderClassPanelHtml, renderClassCards } from '../renameClassPanelHtml';
import { renderInstVarPanelHtml, renderInstVarCards } from '../instVarRefactorPanelHtml';
import { ClassRenameChange } from '../renameClassPreview';
import { InstVarChange, InstVarOutOfScope } from '../instVarRefactorPreview';

/**
 * A preview row says which dictionary its class came from only when the change set claims that
 * class name from more than one — qualifying every row would bury the distinction.
 *
 * The change set, though, arrives a page at a time: the panel renders and posts page 1 before
 * page 2 exists. Deciding per page means two rows that are the whole reason the marking exists
 * read identically whenever the paging happens to separate them — `Shadowed>>foo` twice, one of
 * them somebody else's class, and nothing on screen to tell them apart.
 *
 * So what is pinned is the rule as the user meets it: a row is qualified when the change set AS
 * A WHOLE claims its class name twice, however the rows were paged. The assertions read the
 * rendered page rather than a return value, because the row that has to change is one that was
 * already drawn when the clash came to light.
 *
 * These pin the CLIENT-side way of getting there: the panel re-qualifies rows it already drew
 * when a later page reveals the clash. The other way — the engine, which sees the whole change
 * set, flags each change as ambiguous — cannot pass them as written, because the fixtures carry
 * no such flag. Choosing that one means giving the fixtures the field, not loosening the
 * assertions.
 */

beforeAll(() => {
  // Both panels share the rename-method panel's view script.
  new Function(fs.readFileSync(path.resolve(__dirname, '../renameMethodPanelView.js'), 'utf8'))();
  new Function(
    fs.readFileSync(path.resolve(__dirname, '../instVarRefactorPanelView.js'), 'utf8'),
  )();
});

interface Appends {
  appendChanges: (html: string, done: boolean) => void;
}
interface PanelApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): Appends;
}

const classPanel = (): PanelApi =>
  (globalThis as unknown as { RenameMethodPanel: PanelApi }).RenameMethodPanel;
const instVarPanel = (): PanelApi =>
  (globalThis as unknown as { InstVarRefactorPanel: PanelApi }).InstVarRefactorPanel;

/** The row labels the user can read, in order. */
const labels = (): string[] =>
  [...document.querySelectorAll('li.change .label')].map((el) => el.textContent.trim());

function body(html: string, total: number): void {
  const match = html.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.setAttribute('data-total', String(total));
  document.body.innerHTML = match[2];
}

const recompile = (id: string, dictName: string | null): ClassRenameChange => ({
  id,
  kind: 'methodRecompile',
  dictName,
  className: 'Shadowed',
  isMeta: false,
  selector: 'foo',
  newName: null,
  category: 'accessing',
  oldSource: 'foo ^Old new',
  newSource: 'foo ^New new',
});

const unrelated = (id: string): ClassRenameChange => ({
  ...recompile(id, 'DictA'),
  className: 'Plain',
  selector: 'bar',
});

function mountClassPanel(firstPage: ClassRenameChange[], total: number): Appends {
  body(
    renderClassPanelHtml({
      oldName: 'Old',
      newName: 'New',
      total,
      recompileSubclasses: true,
      migrateInstances: false,
      removeOldFromHistory: false,
      changes: firstPage,
      done: false,
      outOfScope: {
        references: 0,
        descendants: 0,
        skipped: 0,
        collision: null,
        shadowedFrom: null,
      },
      skippedMethods: [],
      nonce: 'test',
      script: '',
    }),
    total,
  );
  return classPanel().wire(document, { postMessage: vi.fn() });
}

const definitionEdit = (id: string, dictName: string | null): InstVarChange => ({
  id,
  kind: 'classDefinitionEdit',
  dictName,
  className: 'Shadowed',
  oldSource: "Object subclass: 'Shadowed'\n  instVarNames: #()",
  newSource: "Object subclass: 'Shadowed'\n  instVarNames: #( tally)",
});

const noOutOfScope: InstVarOutOfScope = {
  decline: null,
  willNotRecompile: [],
  actedOnClass: null,
  note: null,
  sessionHasUncommittedChanges: false,
};

function mountInstVarPanel(firstPage: InstVarChange[], total: number): Appends {
  body(
    renderInstVarPanelHtml({
      title: 'Add tally to Shadowed',
      total,
      changes: firstPage,
      done: false,
      outOfScope: noOutOfScope,
      nonce: 'test',
      script: '',
    }),
    total,
  );
  return instVarPanel().wire(document, { postMessage: vi.fn() });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a class name two dictionaries claim, split across preview pages', () => {
  it('qualifies the row on the later page that revealed the clash', () => {
    const panel = mountClassPanel([recompile('1', 'DictA')], 2);

    panel.appendChanges(renderClassCards([recompile('2', 'DictB')]), true);

    expect(labels()[1]).toBe('Shadowed (DictB)>>foo');
  });

  it('goes back and qualifies the row drawn before the clash was known', () => {
    const panel = mountClassPanel([recompile('1', 'DictA')], 2);

    panel.appendChanges(renderClassCards([recompile('2', 'DictB')]), true);

    expect(labels()[0]).toBe('Shadowed (DictA)>>foo');
  });

  it('leaves a name only one dictionary claims unqualified', () => {
    // Qualifying every row would bury the distinction the marking exists to draw.
    const panel = mountClassPanel([unrelated('1')], 2);

    panel.appendChanges(renderClassCards([recompile('2', 'DictB')]), true);

    expect(labels()[0]).toBe('Plain>>bar');
  });

  it('qualifies the other row when one of them cannot say where it lands', () => {
    // "Somewhere unstated" counts as its own claim, so the name is ambiguous — but only the row
    // that CAN name its dictionary has one to show; the other stays as it is.
    const panel = mountClassPanel([recompile('1', null)], 2);

    panel.appendChanges(renderClassCards([recompile('2', 'DictB')]), true);

    expect(labels()).toEqual(['Shadowed>>foo', 'Shadowed (DictB)>>foo']);
  });

  it('holds across three pages, not just the second', () => {
    const panel = mountClassPanel([recompile('1', 'DictA')], 3);

    panel.appendChanges(renderClassCards([unrelated('2')]), false);
    panel.appendChanges(renderClassCards([recompile('3', 'DictB')]), true);

    expect(labels()).toEqual(['Shadowed (DictA)>>foo', 'Plain>>bar', 'Shadowed (DictB)>>foo']);
  });

  it('qualifies both rows when one page happens to hold them', () => {
    mountClassPanel([recompile('1', 'DictA'), recompile('2', 'DictB')], 2);

    expect(labels()).toEqual(['Shadowed (DictA)>>foo', 'Shadowed (DictB)>>foo']);
  });
});

describe('the same name across the instance-variable panel’s pages', () => {
  it('qualifies the row on the later page that revealed the clash', () => {
    const panel = mountInstVarPanel([definitionEdit('1', 'DictA')], 2);

    panel.appendChanges(renderInstVarCards([definitionEdit('2', 'DictB')]), true);

    expect(labels()[1]).toBe('Shadowed (DictB) (definition edited)');
  });

  it('goes back and qualifies the row drawn before the clash was known', () => {
    const panel = mountInstVarPanel([definitionEdit('1', 'DictA')], 2);

    panel.appendChanges(renderInstVarCards([definitionEdit('2', 'DictB')]), true);

    expect(labels()[0]).toBe('Shadowed (DictA) (definition edited)');
  });

  it('qualifies both rows when one page happens to hold them', () => {
    mountInstVarPanel([definitionEdit('1', 'DictA'), definitionEdit('2', 'DictB')], 2);

    expect(labels()).toEqual([
      'Shadowed (DictA) (definition edited)',
      'Shadowed (DictB) (definition edited)',
    ]);
  });
});
