import { describe, it, expect } from 'vitest';
import { renderMovePanelHtml, renderMoveCards } from '../moveMethodPanelHtml';
import { MoveChange } from '../moveMethodPreview';

const add: MoveChange = {
  id: '1',
  kind: 'methodAdd',
  dictName: 'UserGlobals',
  className: 'Target',
  isMeta: false,
  selector: 'pure',
  category: 'accessing',
  oldSource: '',
  newSource: 'pure\n\t^ 42',
};
const remove: MoveChange = {
  id: '2',
  kind: 'methodRemove',
  dictName: 'UserGlobals',
  className: 'Source',
  isMeta: false,
  selector: 'pure',
  category: 'accessing',
  oldSource: 'pure\n\t^ 42',
  newSource: '',
};

const baseOpts = {
  targetClass: 'Target',
  total: 2,
  changes: [add, remove],
  done: true,
  outOfScope: { collision: null, decline: null },
  skippedMethods: [],
  nonce: 'n0nce',
  script: '/* view js */',
};

describe('move-method panel HTML', () => {
  it('names the destination class in the header', () => {
    const html = renderMovePanelHtml(baseOpts);

    expect(html).toContain('Move to <code>Target</code>');
  });

  it('renders every change as a required, disabled checkbox (no per-change deselect)', () => {
    const html = renderMovePanelHtml(baseOpts);

    const checkboxes = html.match(/type="checkbox"/g) ?? [];
    expect(checkboxes).toHaveLength(2);
    expect(html).not.toMatch(/class="sel"(?![^>]*disabled)/);
  });

  it('shows the add going to the target and the remove leaving the source', () => {
    const html = renderMovePanelHtml(baseOpts);

    expect(html).toContain('Target&gt;&gt;pure (add to target)');
    expect(html).toContain('Source&gt;&gt;pure (remove from source)');
  });

  it('renders the added method as all-added and the removed one as all-removed', () => {
    const html = renderMoveCards([add, remove]);

    expect(html).toContain('<div class="line add">+pure</div>');
    expect(html).toContain('<div class="line del">-pure</div>');
  });

  it('lists the methods that will not move', () => {
    const html = renderMovePanelHtml({
      ...baseOpts,
      skippedMethods: [{ selector: 'usesIvar', reason: 'accesses an ivar the target lacks' }],
    });

    expect(html).toContain('1 method will NOT move');
    expect(html).toContain('usesIvar');
    expect(html).toContain('accesses an ivar the target lacks');
  });

  it('shows a decline banner when the move is globally blocked', () => {
    const html = renderMovePanelHtml({
      ...baseOpts,
      outOfScope: { collision: null, decline: 'source and target are the same' },
    });

    expect(html).toContain('source and target are the same');
  });

  it('injects the view script under the nonce', () => {
    const html = renderMovePanelHtml(baseOpts);

    expect(html).toContain('<script nonce="n0nce">/* view js */</script>');
  });
});
