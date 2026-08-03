import { describe, it, expect } from 'vitest';
import { renderMethodPanelHtml } from '../renameMethodPanelHtml';
import { MethodRenameChange } from '../renameMethodPreview';

const rename = (over: Partial<MethodRenameChange> = {}): MethodRenameChange => ({
  id: '1',
  kind: 'methodRename',
  dictName: 'UserGlobals',
  className: 'RmDemoRect',
  isMeta: false,
  selector: 'area',
  newSelector: 'computeArea',
  category: 'accessing',
  oldSource: 'area\n\t^w * h',
  newSource: 'computeArea\n\t^w * h',
  ...over,
});
const sender: MethodRenameChange = {
  id: '2',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'RmDemoShape',
  isMeta: false,
  selector: 'describe',
  newSelector: null,
  category: 'printing',
  oldSource: '^self area',
  newSource: '^self computeArea',
};

function html(
  changes: MethodRenameChange[],
  oos = { implementors: 0, senders: 0, skipped: 0 },
  skippedMethods: { className: string; selector: string }[] = [],
  opts: { total?: number; done?: boolean } = {},
): string {
  return renderMethodPanelHtml({
    oldSelector: 'area',
    newSelector: 'computeArea',
    total: opts.total ?? changes.length,
    changes,
    done: opts.done ?? true,
    outOfScope: oos,
    skippedMethods,
    nonce: 'test',
    script: '',
  });
}

describe('rename-method preview panel', () => {
  it('marks the removed and added selector on an implementor rename', () => {
    const out = html([rename()]);

    expect(out).toContain('class="sel-removed" title="removed">area<');
    expect(out).toContain('class="sel-added" title="added">computeArea<');
  });

  it('shows a sender as a plain modified label, not add/remove', () => {
    const out = html([sender]);

    expect(out).toContain('RmDemoShape&gt;&gt;describe');
    expect(out).not.toContain('class="sel-removed"');
  });

  it('marks an implementor rename as required — its checkbox is checked and disabled', () => {
    const out = html([rename()]);

    expect(out).toContain('class="sel" checked disabled');
  });

  it('still forces an implementor change that keeps its selector, showing a plain label', () => {
    const out = html([rename({ newSelector: null })]);

    expect(out).toContain('class="sel" checked disabled');
    expect(out).not.toContain('class="sel-removed"');
  });

  it('keeps a sender recompile individually deselectable — its checkbox is not disabled', () => {
    const out = html([sender]);

    expect(out).toContain('class="sel" checked aria-label="Include');
    expect(out).not.toContain('class="sel" checked disabled');
  });

  it('renders the structural implementor rename disabled while leaving senders selectable in one preview', () => {
    const out = html([rename(), sender]);

    // exactly one disabled (required) checkbox — the implementor rename — and the
    // sender stays plainly deselectable.
    expect((out.match(/class="sel" checked disabled/g) ?? []).length).toBe(1);
    expect(out).toContain('class="sel" checked aria-label="Include');
  });

  it('treats a same-selector argument reorder as a plain change, not add/remove', () => {
    const reorder = rename({ selector: 'from:to:', newSelector: 'from:to:' });

    const out = html([reorder]);

    expect(out).not.toContain('class="sel-removed"');
  });

  it('shows an out-of-scope warning only when there is something out of scope', () => {
    expect(html([rename()], { implementors: 2, senders: 3, skipped: 0 })).toMatch(
      /2 implementors and 3 senders outside the chosen scope/,
    );
    expect(html([rename()])).not.toContain('outside the chosen scope');
  });

  it('warns about methods that could not be rewritten', () => {
    expect(html([rename()], { implementors: 0, senders: 0, skipped: 3 })).toMatch(
      /3 methods could not be rewritten and were skipped/,
    );
  });

  it('lists the skipped methods behind a Show link', () => {
    const out = html([rename()], { implementors: 0, senders: 0, skipped: 2 }, [
      { className: 'AutoComplete', selector: 'strings:' },
      { className: 'ClassOrganizer class', selector: 'foo:' },
    ]);

    expect(out).toContain('id="showSkipped"');
    expect(out).toContain('<li>AutoComplete&gt;&gt;strings:</li>');
    expect(out).toContain('<li>ClassOrganizer class&gt;&gt;foo:</li>');
  });

  it('offers pagination and totals when more pages remain', () => {
    const out = html([rename()], undefined, [], { total: 10, done: false });

    expect(out).toContain('id="more"');
    expect(out).toContain('1 of 10 loaded');
    expect(out).toContain('<span id="count">10</span>');
    expect(out).not.toContain('class="pager hidden"');
  });

  it('hides the pager when the first page is the last', () => {
    const out = html([rename(), sender], undefined, [], { total: 2, done: true });

    expect(out).toContain('class="pager hidden"');
  });
});
