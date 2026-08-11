import { describe, it, expect } from 'vitest';
import { renderSplitCards, renderSplitPanelHtml } from '../splitClassPanelHtml';
import { SplitChange, SplitOutOfScope } from '../splitClassPreview';

/**
 * Unit-tests the pure split-class panel HTML: every row is a required (checked + disabled) checkbox;
 * a classAdd / methodAdd renders as an all-added block, a classDefinitionEdit as a two-sided
 * (removed + added) diff, a classReparent as a compact note; the CSP/nonce + injected script are
 * present; the decline banner and the no-migrate note render; pluralization and the done-hidden
 * pager behave; and user strings are HTML-escaped. No mocks.
 */

const change = (over: Partial<SplitChange> = {}): SplitChange => ({
  id: 'a',
  kind: 'classAdd',
  dictName: 'UserGlobals',
  className: 'Address',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: '',
  newSource: "Object subclass: 'Address'",
  ...over,
});

const noScope: SplitOutOfScope = { decline: null, note: null };

const panel = (over: Partial<Parameters<typeof renderSplitPanelHtml>[0]> = {}): string =>
  renderSplitPanelHtml({
    heading: 'Split Person — extract Address',
    total: 1,
    changes: [change()],
    done: true,
    outOfScope: noScope,
    nonce: 'abc123',
    script: 'console.log(1)',
    ...over,
  });

describe('split-class panel HTML', () => {
  it('renders every change as a required, disabled checkbox carrying its id', () => {
    const html = renderSplitCards([change()]);

    expect(html).toContain('checked disabled');
    expect(html).toContain('data-id="a"');
  });

  it('renders the new component class as an all-added block with no removed lines', () => {
    const html = renderSplitCards([change()]);

    expect(html).toContain('line add');
    expect(html).not.toContain('line del');
  });

  it('renders a source definition edit as a two-sided removed-and-added diff', () => {
    const html = renderSplitCards([
      change({
        id: 'e',
        kind: 'classDefinitionEdit',
        className: 'Person',
        oldSource: "Object subclass: 'Person' instVarNames: #('street')",
        newSource: "Object subclass: 'Person' instVarNames: #('address')",
      }),
    ]);

    expect(html).toContain('line del');
    expect(html).toContain('line add');
  });

  it('renders a descendant reparent as a compact note, not a diff', () => {
    const html = renderSplitCards([
      change({
        id: 'r',
        kind: 'classReparent',
        className: 'Employee',
        oldSource: '',
        newSource: '',
      }),
    ]);

    expect(html).toContain('re-point at the new class version');
    expect(html).not.toContain('line add');
  });

  it('includes the CSP nonce and injects the script under it', () => {
    const html = panel();

    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123">console.log(1)</script>');
  });

  it('shows a precondition banner and the no-migration note when present', () => {
    const html = panel({
      total: 0,
      changes: [],
      outOfScope: {
        decline: 'a class named Address already exists',
        note: 'Existing instances keep their prior class version and are not migrated.',
      },
    });

    expect(html).toContain('already exists');
    expect(html).toContain('are not migrated');
  });

  it('omits the banner and note when neither is present', () => {
    const html = panel();

    expect(html).not.toContain('⛔');
    expect(html).not.toContain('ℹ️');
  });

  it('uses the singular for one change and the plural for several', () => {
    expect(panel({ total: 1 })).toContain('of 1 change selected');
    expect(panel({ total: 3 })).toContain('of 3 changes selected');
  });

  it('hides the pager once every page is loaded and shows it while more remain', () => {
    expect(panel({ done: true })).toContain('class="pager hidden"');
    expect(panel({ done: false })).toContain('class="pager"');
  });

  it('escapes HTML metacharacters in a class name', () => {
    const html = renderSplitCards([change({ className: 'Address<script>&"' })]);

    expect(html).toContain('&lt;script&gt;&amp;&quot;');
    expect(html).not.toContain('<script>&"');
  });
});
