import { describe, it, expect } from 'vitest';
import {
  renderExtractTemporaryPanelHtml,
  renderExtractTemporaryCards,
} from '../extractTemporaryPanelHtml';
import { ExtractTemporaryChange } from '../extractTemporaryPreview';

/**
 * Pure HTML rendering for the extract-temporary (M3) preview panel. No vscode. M3 is
 * method-local and all-or-nothing, so there are NO per-change selection checkboxes;
 * the panel is Apply / Cancel with a banner that surfaces the decline / collision
 * preconditions and, when relevant, the replace-all-occurrences note.
 */

const recompile: ExtractTemporaryChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'M3Demo',
  isMeta: false,
  selector: 'compute',
  category: 'calc',
  oldSource: 'compute\n\t^ self a + self a',
  newSource: 'compute\n\t| t |\n\tt := self a.\n\t^ t + t',
};

function render(over: Partial<Parameters<typeof renderExtractTemporaryPanelHtml>[0]> = {}): string {
  return renderExtractTemporaryPanelHtml({
    newName: 't',
    total: 1,
    occurrenceCount: 1,
    changes: [recompile],
    done: true,
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    nonce: 'n0',
    script: '/* js */',
    ...over,
  });
}

describe('extract-temporary preview panel HTML', () => {
  it('titles the panel with the new temporary name', () => {
    const html = render();

    expect(html).toContain('Extract to temporary');
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
        decline: 'not an extractable expression',
      },
    });

    expect(html).toContain('not an extractable expression');
  });

  it('warns that a collision will fail the apply unless a different name is chosen', () => {
    const html = render({
      outOfScope: {
        references: 0,
        skipped: 0,
        collision: 'the name t is already an instance variable',
        decline: null,
      },
    });

    expect(html).toContain('the name t is already an instance variable');
    expect(html).toContain('another name');
  });

  it('notes that all occurrences are replaced when more than one is in scope', () => {
    const html = render({ occurrenceCount: 3 });

    expect(html).toContain('all 3 occurrences');
  });

  it('renders the change diff as a card carrying its id', () => {
    const html = render();

    expect(html).toContain('data-id="1"');
    expect(html).toContain('line add');
  });
});

describe('extractTemporaryPanelHtml.renderExtractTemporaryCards', () => {
  it('renders one card per change, with no selection checkboxes', () => {
    const cards = renderExtractTemporaryCards([recompile]);

    expect(cards).toContain('data-id="1"');
    expect(cards).not.toContain('class="sel"');
  });
});
