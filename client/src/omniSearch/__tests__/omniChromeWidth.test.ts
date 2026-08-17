/**
 * Guard for #428: the search chrome must size to the window rather than to a fixed pixel cap.
 *
 * `#omni` used to carry `max-width: 960px`, which left a wide monitor mostly empty and ellipsized long
 * `Class>>selector` rows while blank space sat beside them. Both hosts render this chrome, so the
 * default docked panel paid for it too — hence the check runs for both.
 *
 * jsdom has no layout engine (it parses CSS but never computes a box), so there is no honest way to
 * assert a *measured* width here. This asserts the rule instead, which is enough to fail if a fixed cap
 * is reintroduced — the actual regression to guard against.
 */
import { describe, it, expect } from 'vitest';
import { renderOmniHtml } from '../omniSearchShared';

/** The declarations inside the `#omni { … }` rule of the rendered chrome. */
function omniRule(html: string): string {
  const match = /#omni\s*\{([^}]*)\}/.exec(html);
  if (!match) throw new Error('#omni rule not found in the rendered chrome');
  return match[1];
}

describe('search chrome width (#428)', () => {
  for (const [host, showPin] of [
    ['docked panel', false],
    ['Spotter tab', true],
  ] as const) {
    it(`does not cap the container at a fixed pixel width — ${host}`, () => {
      const rule = omniRule(renderOmniHtml({ showPin }));

      // Sanity: we matched the real container rule, not some other `#omni`-ish text.
      expect(rule).toMatch(/height:\s*100vh/);

      expect(rule).not.toMatch(/max-width:\s*\d+(\.\d+)?px/);
    });
  }

  it('lets the container take the full available width', () => {
    expect(omniRule(renderOmniHtml({ showPin: false }))).toMatch(/width:\s*100%/);
  });

  it('renders identical width rules for both hosts (the chrome is shared)', () => {
    expect(omniRule(renderOmniHtml({ showPin: false }))).toBe(
      omniRule(renderOmniHtml({ showPin: true })),
    );
  });
});
