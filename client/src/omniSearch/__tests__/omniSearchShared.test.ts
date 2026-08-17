import { describe, it, expect } from 'vitest';
import { resultsMessage } from '../omniSearchShared';
import { OMNI_DEFAULTS } from '../omniConfig';
import { OmniViewData } from '../omniEngine';

const chrome = {
  config: OMNI_DEFAULTS,
  scopeId: null,
  caseSensitive: false,
  pinned: false,
};

/** A view with every footer-relevant field populated, so a dropped field is detectable. */
function viewData(over: Partial<OmniViewData> = {}): OmniViewData {
  return {
    rows: [],
    shownCount: 200,
    hasMore: false,
    exact: false,
    truncations: [
      {
        categoryId: 'methods',
        categoryLabel: 'Methods',
        scanned: 200,
        ceiling: 200,
        atCeiling: true,
      },
    ],
    pivot: false,
    ...over,
  };
}

describe('resultsMessage', () => {
  it('carries the truncation list to the webview', () => {
    const msg = resultsMessage(viewData(), chrome);
    expect(msg.truncations).toEqual([
      {
        categoryId: 'methods',
        categoryLabel: 'Methods',
        scanned: 200,
        ceiling: 200,
        atCeiling: true,
      },
    ]);
  });

  it('carries an empty truncation list rather than dropping the field', () => {
    // `undefined` on the webview side is falsy in exactly the same way as "nothing was capped", so a
    // dropped field fails silently — the distinction has to survive the boundary explicitly.
    const msg = resultsMessage(viewData({ truncations: [] }), chrome);
    expect(msg.truncations).toEqual([]);
  });

  // This payload lists its fields one at a time instead of spreading the view, so a NEW OmniViewData
  // field reaches the engine but never the footer. That is precisely how the #14 fix first shipped
  // broken: the engine computed the truncation flag, `resultsMessage` didn't forward it, the webview
  // read `undefined`, and the count still said "200 results". This guard fails the moment another
  // field is added to OmniViewData without being forwarded here.
  it('forwards every OmniViewData field, so a new field cannot be silently dropped', () => {
    const view = viewData({ pivotTitle: 'Senders of foo' });
    const msg = resultsMessage(view, chrome);
    for (const key of Object.keys(view)) {
      expect(msg, `OmniViewData.${key} is missing from the results message`).toHaveProperty(key);
    }
  });
});
