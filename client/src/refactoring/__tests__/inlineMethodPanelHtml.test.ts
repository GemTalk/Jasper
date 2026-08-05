import { describe, it, expect } from 'vitest';
import { renderInlinePanelHtml, renderInlineCards } from '../inlineMethodPanelHtml';
import { InlineChange } from '../inlineMethodPreview';

/**
 * Pure HTML rendering for the inline-method (M2) preview panel. No vscode.
 */

const recompile: InlineChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'report',
  category: 'printing',
  oldSource: 'report\n\t^ self total',
  newSource: 'report\n\t^ balance',
};

const removal: InlineChange = {
  id: '2',
  kind: 'methodRemove',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'total',
  category: 'accessing',
  oldSource: 'total\n\t^ balance',
  newSource: '',
};

function render(over: Partial<Parameters<typeof renderInlinePanelHtml>[0]> = {}): string {
  return renderInlinePanelHtml({
    targetSelector: 'total',
    total: 1,
    coreCount: 1,
    lastSender: false,
    changes: [recompile],
    done: true,
    outOfScope: { collision: null, decline: null },
    nonce: 'n0',
    script: '/* js */',
    ...over,
  });
}

describe('inline-method preview panel HTML', () => {
  it('renders the caller recompile as a required (checked, disabled) row', () => {
    const html = render();

    expect(html).toContain('checked disabled');
  });

  it('offers the target removal as an opt-in (unchecked, enabled) row when last-sender', () => {
    const html = render({
      total: 2,
      lastSender: true,
      changes: [recompile, removal],
    });

    const start = html.indexOf('data-id="2"');
    const removalRow = html.slice(start, html.indexOf('</li>', start));
    expect(removalRow).not.toContain('checked');
    expect(removalRow).not.toContain('disabled');
  });

  it('explains that this was the last sender when a removal is offered', () => {
    const html = render({ total: 2, lastSender: true, changes: [recompile, removal] });

    expect(html.toLowerCase()).toContain('last sender');
  });

  it('renders the removed method as an all-deleted diff', () => {
    const html = render({ total: 2, lastSender: true, changes: [recompile, removal] });

    expect(html).toContain('line del');
    expect(html).toContain('-total');
  });

  it('shows a blocking banner for a hard decline', () => {
    const html = render({ outOfScope: { collision: null, decline: 'not a send' } });

    expect(html).toContain('not a send');
  });

  it('names the inlined selector in the title', () => {
    const html = render();

    expect(html).toContain('<code>total</code>');
  });
});

describe('inlineMethodPanelHtml.renderInlineCards', () => {
  it('disables only rows whose global index is below the core count', () => {
    const cards = renderInlineCards([removal], 1, 1);

    expect(cards).not.toContain('disabled');
    expect(cards).toContain('data-id="2"');
  });
});
