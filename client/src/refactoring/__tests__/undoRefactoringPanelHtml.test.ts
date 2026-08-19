import { describe, it, expect } from 'vitest';
import { renderUndoPanelHtml, renderUndoCards } from '../undoRefactoringPanelHtml';
import { UndoChange } from '../undoRefactoringPreview';

/**
 * The undo preview panel's HTML (#434). The panel is the "see the reverse refactoring
 * before it runs" half of the feature, so what it must show is pinned here: an action
 * per row in the user's terms, the drift warnings inline AND summarised, and a diff
 * that reads forward in time (what is in the stone now → what undoing leaves).
 */

const change = (over: Partial<UndoChange> = {}): UndoChange => ({
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'total',
  newName: null,
  category: 'computing',
  oldSource: 'total ^ self sum',
  newSource: 'total ^ 40 + 2',
  warning: null,
  ...over,
});

const html = (over: Partial<Parameters<typeof renderUndoPanelHtml>[0]> = {}): string =>
  renderUndoPanelHtml({
    refactoringLabel: 'Rename #total to #sum',
    mechanism: 'changeSet',
    total: 1,
    drifted: 0,
    changes: [change()],
    done: true,
    nonce: 'abc',
    script: '/* view */',
    ...over,
  });

describe('undo panel html', () => {
  it('names the refactoring being undone in the header and the button', () => {
    const out = html();
    expect(out).toContain('Undo <code>Rename #total to #sum</code>');
    expect(out).toContain('<button id="apply">Undo <span id="count">1</span></button>');
  });

  it('badges each row with what undoing DOES, not with the change kind', () => {
    const out = renderUndoCards([
      change({ id: '1', kind: 'methodAdd', oldSource: null }),
      change({ id: '2', kind: 'methodRemove', newSource: null }),
      change({ id: '3', kind: 'methodRecompile' }),
    ]);
    expect(out).toContain('>Restore<');
    expect(out).toContain('>Delete<');
    expect(out).toContain('>Revert<');
    // The engine's kind names must not leak into the UI — they read backwards here.
    expect(out).not.toContain('methodAdd');
  });

  it('gives every row a checkbox, so any part of an undo can be kept', () => {
    const out = renderUndoCards([change({ id: '1' }), change({ id: '2' })]);
    expect(out.match(/type="checkbox"/g)).toHaveLength(2);
    // Unlike a forward rename, NO undo row is structural/disabled: keeping half an
    // undo is the user's call.
    expect(out).not.toContain('disabled');
  });

  it('shows a drift warning inline and marks the row', () => {
    const out = renderUndoCards([change({ warning: 'Edited since the refactoring.' })]);
    expect(out).toContain('class="change warned"');
    expect(out).toContain('⚠ Edited since the refactoring.');
  });

  it('summarises drift at the top only when there is some', () => {
    expect(html({ drifted: 0 })).not.toContain('class="oos"');
    const drifted = html({ total: 3, drifted: 2, changes: [change({ warning: 'x' })] });
    expect(drifted).toContain('class="oos"');
    expect(drifted).toContain('2 of them are');
  });

  it('renders a restore as all-added and a delete as all-removed', () => {
    const restore = renderUndoCards([change({ kind: 'methodAdd', oldSource: null })]);
    expect(restore).toContain('class="line add"');
    expect(restore).not.toContain('class="line del"');
    const remove = renderUndoCards([change({ kind: 'methodRemove', newSource: null })]);
    expect(remove).toContain('class="line del"');
    expect(remove).not.toContain('class="line add"');
  });

  it('escapes HTML in a class name, a label and a warning', () => {
    const out = renderUndoPanelHtml({
      refactoringLabel: '<script>x</script>',
      mechanism: 'changeSet',
      total: 1,
      drifted: 1,
      changes: [change({ className: 'A<b>', warning: '<i>w</i>' })],
      done: true,
      nonce: 'n',
      script: '',
    });
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('A&lt;b&gt;');
    expect(out).toContain('&lt;i&gt;w&lt;/i&gt;');
  });

  it('hides the pager when the first page is the last', () => {
    expect(html({ done: true })).toContain('class="pager hidden"');
    expect(html({ done: false })).toContain('class="pager"');
  });

  it('locks the script down to the nonce', () => {
    expect(html()).toContain("script-src 'nonce-abc'");
    expect(html()).toContain('<script nonce="abc">');
  });
});

describe('undo panel html — a reverse rename says it is not a rollback', () => {
  const renameRow = (over: Partial<UndoChange> = {}): UndoChange => ({
    ...change(),
    kind: 'classRename',
    className: 'NewName',
    newName: 'OldName',
    selector: null,
    ...over,
  });

  it('carries the caveat banner for a renameBack, and not for a changeSet', () => {
    const back = html({ mechanism: 'mirror', changes: [renameRow()] });
    expect(back).toContain('class="note"');
    expect(back).toContain('not a rollback');
    expect(html({ mechanism: 'changeSet' })).not.toContain('class="note"');
  });

  it('badges a class-shape row and labels it by its class', () => {
    const out = renderUndoCards([renameRow()], 'mirror');
    expect(out).toContain('>Rename back<');
    expect(out).toContain('NewName → OldName');
    // No phantom ">>" for a row that has no selector.
    expect(out).not.toContain('&gt;&gt;');
  });

  it('derives the badge class from the badge word, so a multi-word action is still valid CSS', () => {
    expect(renderUndoCards([renameRow()], 'mirror')).toContain('action-rename-back');
  });

  it('badges a reference rewrite as a rewrite, not as a revert', () => {
    const out = renderUndoCards(
      [renameRow({ kind: 'methodRecompile', selector: 'usesIt', newName: null })],
      'mirror',
    );
    expect(out).toContain('>Rewrite<');
    expect(out).not.toContain('>Revert<');
  });
});

describe('undo panel html — un-ticking means three different things', () => {
  it('disables every checkbox when the engine ignores deselection', () => {
    // An enabled box that silently changes nothing is worse than no box: it invites a click and
    // then betrays it.
    const out = renderUndoCards([change()], 'mirror', 'ignored');
    expect(out).toContain('disabled');
    expect(out).toContain('all-or-nothing');
    expect(out).toContain('(always applied)');
  });

  it('leaves them enabled where deselection is honoured', () => {
    expect(renderUndoCards([change()], 'changeSet', 'perChange')).not.toContain('disabled');
    expect(renderUndoCards([change()], 'mirror', 'dropsMethod')).not.toContain('disabled');
  });

  it('says all-or-nothing in the banner and the counter, not "selected"', () => {
    const out = html({ mechanism: 'mirror', deselection: 'ignored' });
    expect(out).toContain('all-or-nothing');
    expect(out).toContain('(all applied)');
    expect(out).not.toContain('changes selected');
  });

  it('warns, in the warning style, where un-ticking DELETES the method', () => {
    const out = html({ mechanism: 'mirror', deselection: 'dropsMethod' });
    expect(out).toContain('DELETES it');
    // Warning styling, not the neutral note styling — this one can lose work.
    expect(out).toMatch(/class="oos">⚠[^<]*DELETES it/);
  });

  it('says nothing about the checkboxes in the ordinary case', () => {
    const out = html({ mechanism: 'changeSet', deselection: 'perChange' });
    expect(out).not.toContain('all-or-nothing');
    expect(out).not.toContain('DELETES it');
  });

  it('names the number of methods an instVar-add reversal would delete', () => {
    const out = html({ mechanism: 'mirror', reverseKind: 'instVarAdd', dropCount: 2 });
    expect(out).toContain('DELETE 2 methods');
  });
});
