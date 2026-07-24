import { describe, it, expect } from 'vitest';
import { renderExtractPanelHtml, renderExtractCards } from '../extractMethodPanelHtml';
import { ExtractChange } from '../extractMethodPreview';

function change(over: Partial<ExtractChange> & Pick<ExtractChange, 'id' | 'kind'>): ExtractChange {
  return {
    dictName: null,
    className: 'Foo',
    isMeta: false,
    selector: 'x',
    category: null,
    oldSource: '',
    newSource: 'x\n\t^1',
    ...over,
  };
}

const core: ExtractChange[] = [
  change({
    id: '1',
    kind: 'methodAdd',
    selector: 'helper',
    oldSource: '',
    newSource: 'helper\n\tself a. self b',
  }),
  change({
    id: '2',
    kind: 'methodRecompile',
    selector: 'run',
    oldSource: 'run\n\tself a. self b',
    newSource: 'run\n\tself helper',
  }),
];

describe('extractMethodPanelHtml.renderExtractPanelHtml', () => {
  it('titles the panel with the new selector', () => {
    const html = renderExtractPanelHtml({
      newSelector: 'helper',
      total: 2,
      coreCount: 2,
      changes: core,
      done: true,
      outOfScope: { collision: null, decline: null },
      nonce: 'n',
      script: '/*js*/',
    });
    expect(html).toContain('Extract method');
    expect(html).toContain('<code>helper</code>');
  });

  it('renders the two core rows as required (disabled) checkboxes', () => {
    const withDup = [
      ...core,
      change({ id: '3', kind: 'methodRecompile', className: 'Sub', selector: 'dup' }),
    ];
    const html = renderExtractPanelHtml({
      newSelector: 'helper',
      total: 3,
      coreCount: 2,
      changes: withDup,
      done: true,
      outOfScope: { collision: null, decline: null },
      nonce: 'n',
      script: '/*js*/',
    });
    // exactly the two core rows are disabled (required)...
    expect(html.match(/class="sel" checked disabled/g)).toHaveLength(2);
    // ...and the duplicate row is opt-in: unchecked, applied only if the user ticks it
    expect(html).toContain('class="sel" aria-label="Also replace');
    expect(html).not.toContain('class="sel" checked aria-label');
    expect(html).toContain('1 similar fragment');
  });

  it('shows a soft collision banner but not a decline (decline blocks earlier)', () => {
    const html = renderExtractPanelHtml({
      newSelector: 'helper',
      total: 2,
      coreCount: 2,
      changes: core,
      done: true,
      outOfScope: { collision: 'already implemented in Bar', decline: null },
      nonce: 'n',
      script: '/*js*/',
    });
    expect(html).toContain('already implemented in Bar');
    expect(html).toContain('You can still apply');
  });

  it('renders a methodAdd as an all-added diff', () => {
    const html = renderExtractPanelHtml({
      newSelector: 'helper',
      total: 1,
      coreCount: 2,
      changes: [core[0]],
      done: true,
      outOfScope: { collision: null, decline: null },
      nonce: 'n',
      script: '/*js*/',
    });
    expect(html).toContain('(new method)');
    expect(html).toContain('line add');
    expect(html).not.toContain('line del');
  });
});

describe('extractMethodPanelHtml.renderExtractCards', () => {
  it('disables only rows whose global index is below the core count', () => {
    const cards = renderExtractCards(
      [change({ id: '5', kind: 'methodRecompile', selector: 'dupA' })],
      2, // this batch starts at global index 2 → past the core → enabled
      2,
    );
    expect(cards).not.toContain('disabled');
    expect(cards).toContain('data-id="5"');
  });
});
