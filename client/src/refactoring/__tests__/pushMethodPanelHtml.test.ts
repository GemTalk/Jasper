import { describe, it, expect } from 'vitest';
import { renderPushPanelHtml, renderPushCards } from '../pushMethodPanelHtml';
import { PushChange } from '../pushMethodPreview';

const add: PushChange = {
  id: '1',
  kind: 'methodAdd',
  dictName: 'UserGlobals',
  className: 'Base',
  isMeta: false,
  selector: 'foo',
  category: 'accessing',
  oldSource: '',
  newSource: 'foo\n\t^ 1',
};
const remove: PushChange = {
  id: '2',
  kind: 'methodRemove',
  dictName: 'UserGlobals',
  className: 'Sub',
  isMeta: false,
  selector: 'foo',
  category: 'accessing',
  oldSource: 'foo\n\t^ 1',
  newSource: '',
};

describe('push-method panel HTML', () => {
  describe('renderPushCards', () => {
    it('renders a methodAdd as an all-added single-sided diff', () => {
      const html = renderPushCards([add]);

      expect(html).toContain('add to target');
      expect(html).toContain('line add');
      expect(html).not.toContain('line del');
    });

    it('renders a methodRemove as an all-removed single-sided diff', () => {
      const html = renderPushCards([remove]);

      expect(html).toContain('remove from source');
      expect(html).toContain('line del');
      expect(html).not.toContain('line add');
    });

    it('makes every change a required (checked + disabled) row', () => {
      const html = renderPushCards([add]);

      expect(html).toContain('checked disabled');
    });

    it('escapes HTML metacharacters in the source', () => {
      const html = renderPushCards([{ ...add, newSource: 'foo\n\t^ a < b & c' }]);

      expect(html).toContain('&lt; b &amp; c');
      expect(html).not.toContain('< b & c');
    });
  });

  describe('renderPushPanelHtml', () => {
    const opts = {
      heading: 'Push up to Base',
      total: 2,
      changes: [add, remove],
      done: true,
      outOfScope: { collision: null, decline: null },
      skippedMethods: [],
      nonce: 'abc123',
      script: 'const x = 1;',
    };

    it('shows the heading and a strict CSP with the nonce', () => {
      const html = renderPushPanelHtml(opts);

      expect(html).toContain('Push up to Base');
      expect(html).toContain("script-src 'nonce-abc123'");
      expect(html).toContain('<script nonce="abc123">const x = 1;</script>');
    });

    it('hides the pager when the first page is the last', () => {
      const html = renderPushPanelHtml(opts);

      expect(html).toContain('pager hidden');
    });

    it('shows the pager when more pages remain', () => {
      const html = renderPushPanelHtml({ ...opts, done: false });

      expect(html).toMatch(/pager"/);
      expect(html).not.toContain('pager hidden');
    });

    it('renders a global-decline banner that blocks apply', () => {
      const html = renderPushPanelHtml({
        ...opts,
        outOfScope: { collision: null, decline: 'Cannot push down: no subclasses.' },
      });

      expect(html).toContain('oos');
      expect(html).toContain('no subclasses');
    });

    it('lists skipped methods with their reasons', () => {
      const html = renderPushPanelHtml({
        ...opts,
        skippedMethods: [{ selector: 'bar', reason: 'sends super' }],
      });

      expect(html).toContain('will NOT move');
      expect(html).toContain('bar');
      expect(html).toContain('sends super');
    });
  });
});
