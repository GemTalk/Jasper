import { describe, it, expect } from 'vitest';
import { renderIvarPanelHtml, renderIvarCards } from '../instVarStructurePanelHtml';
import { IvarChange } from '../instVarStructurePreview';

const edit: IvarChange = {
  id: '1',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Base',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Object subclass: 'Base' instVarNames: #( 'a')",
  newSource: "Object subclass: 'Base' instVarNames: #( 'a' 'b')",
};
const reparent: IvarChange = {
  id: '2',
  kind: 'classReparent',
  dictName: 'UserGlobals',
  className: 'Sub',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: 'x',
  newSource: 'x',
};

describe('instance-variable structure panel HTML', () => {
  describe('renderIvarCards', () => {
    it('renders a definition edit as a two-sided diff', () => {
      const html = renderIvarCards([edit]);

      expect(html).toContain('Base (definition)');
      expect(html).toContain('line del');
      expect(html).toContain('line add');
    });

    it('renders a reparent as a compact recompiled note (no diff lines)', () => {
      const html = renderIvarCards([reparent]);

      expect(html).toContain('Sub (recompiled)');
      expect(html).toContain('re-point at the new class version');
    });

    it('marks every change as a required (checked + disabled) row', () => {
      const html = renderIvarCards([edit]);

      expect(html).toContain('checked disabled');
    });

    it('escapes HTML metacharacters in the definition', () => {
      const html = renderIvarCards([{ ...edit, newSource: 'a < b & c' }]);

      expect(html).toContain('&lt; b &amp; c');
    });
  });

  describe('renderIvarPanelHtml', () => {
    const opts = {
      heading: "Push instance variable 'b' up from Sub",
      total: 2,
      changes: [edit, reparent],
      done: true,
      outOfScope: { decline: null, note: 'Existing instances keep their prior version.' },
      nonce: 'abc123',
      script: 'const x = 1;',
    };

    it('shows the heading, the migration note, and a strict CSP with the nonce', () => {
      const html = renderIvarPanelHtml(opts);

      expect(html).toContain('Push instance variable');
      expect(html).toContain('keep their prior version');
      expect(html).toContain("script-src 'nonce-abc123'");
    });

    it('renders a blocking decline banner', () => {
      const html = renderIvarPanelHtml({
        ...opts,
        outOfScope: { decline: 'Base still uses it', note: null },
      });

      expect(html).toContain('oos');
      expect(html).toContain('still uses it');
    });

    it('hides the pager when the first page is the last', () => {
      expect(renderIvarPanelHtml(opts)).toContain('pager hidden');
    });

    it('renders the migrate + remove-history apply-option checkboxes (default unchecked)', () => {
      const html = renderIvarPanelHtml(opts);

      expect(html).toContain('class="apply-option" data-opt="migrateInstances"');
      expect(html).toContain('class="apply-option" data-opt="removeOldFromHistory"');
      expect(html).toContain('Migrate existing instances');
      expect(html).toContain('Remove old versions from class history');
      // both commit, and neither is pre-checked
      expect(html).not.toContain('data-opt="migrateInstances" checked');
      expect(html).not.toContain('data-opt="removeOldFromHistory" checked');
    });
  });
});
