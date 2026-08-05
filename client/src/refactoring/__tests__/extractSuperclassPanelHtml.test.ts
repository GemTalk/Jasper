import { describe, it, expect } from 'vitest';
import {
  renderExtractSuperCards,
  renderExtractSuperPanelHtml,
} from '../extractSuperclassPanelHtml';
import { ExtractSuperChange, ExtractSuperOutOfScope } from '../extractSuperclassPreview';

/**
 * Unit-tests the pure extract-superclass panel HTML: every row is a required (checked + disabled)
 * checkbox, a classAdd renders as an all-added definition, a classReparent as a compact note, the
 * CSP/nonce is present, the decline banner and no-migrate note render, and user strings are
 * HTML-escaped. No mocks.
 */

const change = (over: Partial<ExtractSuperChange> = {}): ExtractSuperChange => ({
  id: 'a',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Dog',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Animal subclass: 'Dog'",
  newSource: "Pet subclass: 'Dog'",
  ...over,
});

const noScope: ExtractSuperOutOfScope = { decline: null, note: null };

describe('extract-superclass panel HTML', () => {
  it('renders every change as a required, disabled checkbox', () => {
    const html = renderExtractSuperCards([change()]);

    expect(html).toContain('checked disabled');
    expect(html).toContain('data-id="a"');
  });

  it('renders the new-superclass row as an all-added definition', () => {
    const html = renderExtractSuperCards([
      change({
        id: 'n',
        kind: 'classAdd',
        className: 'Pet',
        oldSource: '',
        newSource: "Animal subclass: 'Pet'",
      }),
    ]);

    expect(html).toContain('new superclass');
    expect(html).toContain('line add');
    expect(html).not.toContain('line del');
  });

  it('renders a descendant reparent as a compact note, not a diff', () => {
    const html = renderExtractSuperCards([
      change({ id: 'r', kind: 'classReparent', className: 'Puppy' }),
    ]);

    expect(html).toContain('re-point at the new class version');
  });

  it('includes a CSP nonce and the injected script', () => {
    const html = renderExtractSuperPanelHtml({
      heading: 'Extract superclass',
      total: 1,
      changes: [change()],
      done: true,
      outOfScope: noScope,
      nonce: 'abc123',
      script: 'console.log(1)',
    });

    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123">console.log(1)</script>');
  });

  it('shows a precondition banner and the no-migrate note', () => {
    const html = renderExtractSuperPanelHtml({
      heading: 'Extract superclass',
      total: 0,
      changes: [],
      done: true,
      outOfScope: {
        decline: 'a class of that name already exists',
        note: 'instances not migrated',
      },
      nonce: 'n',
      script: '',
    });

    expect(html).toContain('already exists');
    expect(html).toContain('instances not migrated');
  });

  it('escapes HTML in a class name', () => {
    const html = renderExtractSuperCards([change({ className: 'Dog<script>' })]);

    expect(html).toContain('Dog&lt;script&gt;');
    expect(html).not.toContain('Dog<script>');
  });
});
