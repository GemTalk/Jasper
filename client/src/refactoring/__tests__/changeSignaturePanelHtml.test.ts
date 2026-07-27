import { describe, it, expect } from 'vitest';
import { renderSignaturePanelHtml } from '../changeSignaturePanelHtml';
import { MethodSignatureChange, OutOfScopeCounts } from '../changeSignaturePreview';

/**
 * The change-signature preview panel HTML: an implementor's removed→added selector,
 * a sender's plain label, the out-of-scope banner, the skipped list, pagination, and
 * — M5-specific — the hard collision/decline blocker banner.
 */

const rename = (over: Partial<MethodSignatureChange> = {}): MethodSignatureChange => ({
  id: '1',
  kind: 'methodRename',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'at:',
  newSelector: 'at:put:',
  category: 'accessing',
  oldSource: 'at: k\n\t^1',
  newSource: 'at: k put: v\n\t^1',
  ...over,
});
const sender: MethodSignatureChange = {
  id: '2',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Bank',
  isMeta: false,
  selector: 'store',
  newSelector: null,
  category: 'actions',
  oldSource: '^acct at: 1',
  newSource: '^acct at: 1 put: nil',
};

const clearOos: OutOfScopeCounts = {
  implementors: 0,
  senders: 0,
  skipped: 0,
  collision: null,
  decline: null,
};

function html(
  changes: MethodSignatureChange[],
  oos: OutOfScopeCounts = clearOos,
  skippedMethods: { className: string; selector: string }[] = [],
  opts: { total?: number; done?: boolean } = {},
): string {
  return renderSignaturePanelHtml({
    oldSelector: 'at:',
    newSelector: 'at:put:',
    total: opts.total ?? changes.length,
    changes,
    done: opts.done ?? true,
    outOfScope: oos,
    skippedMethods,
    nonce: 'test',
    script: '',
  });
}

describe('change-signature preview panel', () => {
  it('marks the removed and added selector on an implementor change', () => {
    const out = html([rename()]);

    expect(out).toContain('class="sel-removed" title="removed">at:<');
    expect(out).toContain('class="sel-added" title="added">at:put:<');
  });

  it('shows a sender as a plain modified label, not add/remove', () => {
    const out = html([sender]);

    expect(out).toContain('Bank&gt;&gt;store');
    expect(out).not.toContain('class="sel-removed"');
  });

  it('treats a same-selector argument reorder as a plain change, not add/remove', () => {
    const reorder = rename({ selector: 'from:to:', newSelector: 'from:to:' });

    const out = html([reorder]);

    expect(out).not.toContain('class="sel-removed"');
  });

  it('surfaces a collision as a hard blocker banner', () => {
    const out = html([rename()], { ...clearOos, collision: 'Account already implements at:put:.' });

    expect(out).toContain('Account already implements at:put:.');
    expect(out).toContain('class="blocker"');
  });

  it('surfaces a decline as a hard blocker banner', () => {
    const out = html([rename()], {
      ...clearOos,
      decline: 'Parameter value is used in Account>>at:put:.',
    });

    expect(out).toContain('used in Account');
    expect(out).toContain('class="blocker"');
  });

  it('shows no blocker banner when there is neither a collision nor a decline', () => {
    expect(html([rename()])).not.toContain('class="blocker"');
  });

  it('shows an out-of-scope warning only when there is something out of scope', () => {
    expect(html([rename()], { ...clearOos, implementors: 2, senders: 3 })).toMatch(
      /2 implementors and 3 senders outside the chosen scope/,
    );
    expect(html([rename()])).not.toContain('outside the chosen scope');
  });

  it('lists the methods that could not be rewritten behind a Show link', () => {
    const out = html([rename()], { ...clearOos, skipped: 2 }, [
      { className: 'AutoComplete', selector: 'strings:' },
      { className: 'ClassOrganizer class', selector: 'foo:' },
    ]);

    expect(out).toContain('id="showSkipped"');
    expect(out).toContain('<li>AutoComplete&gt;&gt;strings:</li>');
  });

  it('offers pagination and totals when more pages remain', () => {
    const out = html([rename()], clearOos, [], { total: 10, done: false });

    expect(out).toContain('id="more"');
    expect(out).toContain('1 of 10 loaded');
    expect(out).not.toContain('class="pager hidden"');
  });

  it('hides the pager when the first page is the last', () => {
    const out = html([rename(), sender], clearOos, [], { total: 2, done: true });

    expect(out).toContain('class="pager hidden"');
  });
});
