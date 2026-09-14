import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What the Meta tab's info bar calls the class's category.
 *
 * The value is `cls category` — the thing the Explorer's Class Categories pane
 * lists. Both info bars used to label it "Package", which names a Rowan concept
 * this field has nothing to do with. The two bars were deliberately built to
 * match (see basicInspectorView.js's renderMeta doc-comment), so the label is
 * pinned on both sides; the basic one's rendered output is asserted in
 * basicInspectorView.test.ts.
 *
 * Read off the source rather than rendered, for the reason
 * enhancedInspectorRunBasedText.test.ts gives: the webview script is an injected
 * string that `tsc` never type-checks and no test renders.
 */
const CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'enhancedInspector.ts'), 'utf8');

describe("the Enhanced Inspector's Meta info bar", () => {
  it('labels the class category as a class category', () => {
    expect(CLIENT_SRC).toContain('<span>Class Category: <strong');
  });

  it('no longer calls it a package', () => {
    expect(CLIENT_SRC).not.toContain('<span>Package: <strong');
  });
});
