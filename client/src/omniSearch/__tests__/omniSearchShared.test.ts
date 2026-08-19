import { describe, it, expect } from 'vitest';
import { resultsMessage } from '../omniSearchShared';
import { OMNI_DEFAULTS } from '../omniConfig';
import { OmniViewData } from '../omniEngine';

const chrome = {
  config: OMNI_DEFAULTS,
  scopeId: null,
  caseSensitive: false,
  pinned: false,
  excludedFromAll: OMNI_DEFAULTS.excludedFromAll,
  matchMode: OMNI_DEFAULTS.matchMode,
};

/**
 * A view with EVERY field populated, so a dropped field is detectable. Typed `Required<OmniViewData>`
 * on purpose: that makes TypeScript force each future field — **optional ones included** — into this
 * fixture, so the forwarding guard below covers it without anyone remembering to. A base typed
 * `OmniViewData` would let a new optional field (the shape `pivotTitle` has) slip past `Object.keys`,
 * which is exactly the kind of remembering the #14 regression proved we can't count on.
 */
function viewData(over: Partial<OmniViewData> = {}): Required<OmniViewData> {
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
    pivotTitle: 'Senders of foo',
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
    // The base fixture is `Required<OmniViewData>`, so every field — `pivotTitle` included — is present
    // here and the loop below checks each one is forwarded.
    const view = viewData();
    const msg = resultsMessage(view, chrome);
    for (const key of Object.keys(view)) {
      expect(msg, `OmniViewData.${key} is missing from the results message`).toHaveProperty(key);
    }
  });
});
