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
  category: 'computing',
  oldSource: 'total ^ self sum',
  newSource: 'total ^ 40 + 2',
  warning: null,
  ...over,
});

const html = (over: Partial<Parameters<typeof renderUndoPanelHtml>[0]> = {}): string =>
  renderUndoPanelHtml({
    refactoringLabel: 'Rename #total to #sum',
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
