import { describe, it, expect } from 'vitest';
import {
  renderInlineTemporaryPanelHtml,
  renderInlineTemporaryCards,
} from '../inlineTemporaryPanelHtml';
import { InlineTemporaryChange } from '../inlineTemporaryPreview';

/**
 * Pure HTML rendering for the inline-temporary (M4) preview panel. No vscode. M4 is
 * method-local and all-or-nothing, so there are NO per-change selection checkboxes;
 * the panel is Apply / Cancel with a banner that surfaces the decline precondition.
 * Inlining introduces no shadowing, so there is no collision.
 */

const recompile: InlineTemporaryChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'M4Demo',
  isMeta: false,
  selector: 'report',
  category: 'printing',
  oldSource: 'report\n\t| t |\n\tt := self total.\n\t^ t',
  newSource: 'report\n\t^ self total',
};

function render(over: Partial<Parameters<typeof renderInlineTemporaryPanelHtml>[0]> = {}): string {
  return renderInlineTemporaryPanelHtml({
    name: 't',
    total: 1,
    changes: [recompile],
    done: true,
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    nonce: 'n0',
    script: '/* js */',
    ...over,
  });
}

describe('inline-temporary preview panel HTML', () => {
  it('names the inlined temporary in the title', () => {
    const html = render();

    expect(html).toContain('Inline temporary');
    expect(html).toContain('<code>t</code>');
  });

  it('offers Apply and Cancel actions', () => {
    const html = render();

    expect(html).toContain('id="apply"');
    expect(html).toContain('id="cancel"');
  });

  it('renders no per-change selection checkboxes (all-or-nothing)', () => {
    const html = render();

    expect(html).not.toContain('class="sel"');
  });

  it('always states that the change is confined to the one method', () => {
    const html = render();

    expect(html).toContain('Changes are confined to this one method.');
  });

  it('shows a blocking banner for a hard decline', () => {
    const html = render({
      outOfScope: {
        references: 0,
        skipped: 0,
        collision: null,
        decline: 'not an inlinable temporary',
      },
    });

    expect(html).toContain('not an inlinable temporary');
  });

  it('renders the change diff as a card carrying its id', () => {
    const html = render();

    expect(html).toContain('data-id="1"');
    expect(html).toContain('line del');
  });
});

describe('inlineTemporaryPanelHtml.renderInlineTemporaryCards', () => {
  it('renders one card per change, with no selection checkboxes', () => {
    const cards = renderInlineTemporaryCards([recompile]);

    expect(cards).toContain('data-id="1"');
    expect(cards).not.toContain('class="sel"');
  });
});
