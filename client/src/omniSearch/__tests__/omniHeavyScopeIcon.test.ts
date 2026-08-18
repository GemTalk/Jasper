import { describe, it, expect } from 'vitest';
import { renderOmniHtml } from '../omniSearchShared';

// #428 item 27: the heavy/slow scopes (Source/Literals/Categories, i.e. the `.tab.explicit` tabs) used
// to carry the same magnifier glyph as a plain search, which reads oddly for an expensive full-image
// scan. They now carry a distinct hourglass marker. jsdom has no layout/pseudo-element engine, so we
// guard the CSS RULE text rather than a rendered glyph (same approach the chrome-width guard uses).
describe('heavy-scope tab icon (#428 #27)', () => {
  for (const showPin of [false, true]) {
    it(`marks .tab.explicit with the hourglass, not the magnifier (showPin=${showPin})`, () => {
      const html = renderOmniHtml({ showPin });
      // The rule still targets the explicit (heavy) scopes...
      expect(html).toContain('.tab.explicit::before');
      // ...but now with the hourglass codepoint (U+231B), and the plain magnifier (U+1F50D) is gone.
      expect(html).toContain('\\231B');
      expect(html).not.toContain('\\1F50D');
    });
  }
});
