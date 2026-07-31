import { describe, it, expect } from 'vitest';
import { renderInstVarPanelHtml, renderInstVarCards } from '../instVarRefactorPanelHtml';
import { InstVarChange, InstVarOutOfScope } from '../instVarRefactorPreview';

const edit: InstVarChange = {
  id: '1',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Foo',
  oldSource: "Object subclass: 'Foo'\n  instVarNames: #(count)",
  newSource: "Object subclass: 'Foo'\n  instVarNames: #(count tally)",
};
const reparent: InstVarChange = {
  id: '2',
  kind: 'classReparent',
  dictName: 'UserGlobals',
  className: 'Sub',
  oldSource: "Foo subclass: 'Sub'",
  newSource: "Foo subclass: 'Sub'",
};

const baseOos: InstVarOutOfScope = {
  decline: null,
  willNotRecompile: [],
  actedOnClass: 'Foo',
  note: 'Migrating instances and deleting history DO commit the transaction; nothing else does.',
  sessionHasUncommittedChanges: false,
};

function html(oos: Partial<InstVarOutOfScope> = {}, changes = [edit, reparent], done = true) {
  return renderInstVarPanelHtml({
    title: 'Add tally to Foo',
    total: changes.length,
    changes,
    done,
    outOfScope: { ...baseOos, ...oos },
    nonce: 'n0nce',
    script: '/* view */',
  });
}

describe('instance-variable refactor panel HTML', () => {
  it('shows the title, a nonce-scoped CSP, and empty localResourceRoots-friendly inline script', () => {
    const h = html();
    expect(h).toContain('Add tally to Foo');
    expect(h).toContain("script-src 'nonce-n0nce'");
    expect(h).toContain('<script nonce="n0nce">/* view */</script>');
  });

  it('renders an edit as a delete+add diff and a reparent as context (no phantom diff)', () => {
    const cards = renderInstVarCards([edit, reparent]);
    expect(cards).toContain('line del');
    expect(cards).toContain('line add');
    // reparent has identical old/new — rendered as context lines, not del+add.
    const reparentOnly = renderInstVarCards([reparent]);
    expect(reparentOnly).not.toContain('line del');
    expect(reparentOnly).not.toContain('line add');
  });

  it('every change row is required (checked + disabled)', () => {
    expect(renderInstVarCards([edit])).toContain('checked disabled');
  });

  it('renders the will-not-recompile warning list', () => {
    const h = html({
      willNotRecompile: [
        { className: 'Foo', selector: 'combine' },
        { className: 'Sub', selector: 'doubleCount' },
      ],
    });
    expect(h).toContain('will NOT recompile');
    expect(h).toContain('Foo&gt;&gt;combine');
    expect(h).toContain('Sub&gt;&gt;doubleCount');
  });

  it('omits the warning box when nothing breaks', () => {
    expect(html({ willNotRecompile: [] })).not.toContain('will NOT recompile');
  });

  it('agrees in number for a single broken method', () => {
    const h = html({ willNotRecompile: [{ className: 'Foo', selector: 'combine' }] });
    expect(h).toContain('1 method will NOT recompile onto the new class version');
  });

  it('agrees in number for several broken methods', () => {
    const h = html({
      willNotRecompile: [
        { className: 'Foo', selector: 'combine' },
        { className: 'Sub', selector: 'doubleCount' },
      ],
    });
    expect(h).toContain('2 methods will NOT recompile onto the new class version');
  });

  // V1 ships add / remove only — V4 (move) was deliberately dropped from this panel, so no
  // rendered string may promise a move.
  it('never mentions a move, which this panel does not do', () => {
    const h = html({
      willNotRecompile: [{ className: 'Foo', selector: 'combine' }],
      decline: null,
    });
    expect(h).not.toMatch(/\bmoved\b|\bmoving\b|removed\/moved/i);
  });

  it('does not surface the class-options group for editing', () => {
    const h = html();
    expect(h).not.toContain('Class options for');
    expect(h).not.toContain('class="opt"');
  });

  it('renders migrate + delete-history commit controls with the commit warning', () => {
    const h = html();
    expect(h).toContain('id="migrate"');
    expect(h).toContain('id="deleteHistory"');
    expect(h).toContain('⚠ commits');
    expect(h).toContain('DO commit the transaction');
  });

  it('disables Apply and shows a banner on a hard decline', () => {
    const h = html({ decline: 'Cannot remove count: not declared here.' });
    expect(h).toContain('id="apply" disabled');
    expect(h).toContain('Cannot remove count');
  });

  it('escapes HTML in the title and source', () => {
    const h = renderInstVarPanelHtml({
      title: 'Move <x> to Bar',
      total: 1,
      changes: [{ ...edit, newSource: "instVarNames: #(a) '<b>'" }],
      done: true,
      outOfScope: baseOos,
      nonce: 'n',
      script: '',
    });
    expect(h).toContain('Move &lt;x&gt; to Bar');
    expect(h).toContain('&lt;b&gt;');
  });
});
