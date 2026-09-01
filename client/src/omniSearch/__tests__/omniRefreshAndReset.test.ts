// @vitest-environment jsdom
/**
 * The two webview behaviours issue #517 adds:
 *
 *  - the ⟳ button, which asks the host to reload the cached corpora and re-run the current search, so
 *    classes and methods created (or removed) by EXECUTING code are picked up without a commit;
 *  - the `reset` message, which wipes the panel when the session under it changes. Everything on
 *    screen was read out of the session just left, and a stale row still LOOKS live — activating one
 *    would open a document against the session that is now current.
 *
 * Mounts the real chrome from `renderOmniHtml` via the shared harness, so a renamed or dropped control
 * fails here rather than passing against markup the extension no longer emits.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadOmniView, mountOmniView, MountedOmniView } from './omniViewHarness';

beforeAll(loadOmniView);

const CATEGORIES = [
  { id: 'classes', label: 'Classes', explicitOnly: false },
  { id: 'methods', label: 'Methods', explicitOnly: false },
];

function row(id: number, label: string) {
  return {
    id,
    label,
    ranges: [],
    referenceable: false,
    categoryId: 'classes',
    categoryLabel: 'Class',
    icon: 'symbol-class',
  };
}

/** A panel mid-work: a typed term, results, a selected row, a references breadcrumb and an error. */
function busyPanel(): MountedOmniView {
  const mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  const input = document.getElementById('query') as HTMLInputElement;
  input.value = 'Acc';
  mounted.view.onMessage({
    data: {
      command: 'results',
      rows: [row(0, 'Account'), row(1, 'AccountHolder')],
      shownCount: 2,
      hasMore: false,
      exact: true,
      truncations: [],
      pivot: true,
      pivotTitle: 'Senders of #foo',
      pivotHint: 'Esc to go back',
      categories: CATEGORIES,
      scopeId: 'classes',
      caseSensitive: false,
      placeholder: 'Search classes…',
    },
  });
  mounted.view.onMessage({ data: { command: 'error', message: 'something went wrong' } });
  mounted.posted.length = 0;
  return mounted;
}

describe('GemStone Search webview — the refresh button', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('asks the host to refresh, and shows the panel as busy until it answers', () => {
    (document.getElementById('query') as HTMLInputElement).value = 'at:';

    (document.getElementById('refresh') as HTMLButtonElement).click();

    expect(mounted.posted).toEqual([{ command: 'refresh' }]);
    expect(document.body.classList.contains('busy')).toBe(true);
  });

  it('keeps the typed term — the point is that same search against the current image', () => {
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'at:';

    (document.getElementById('refresh') as HTMLButtonElement).click();

    expect(input.value).toBe('at:');
    // No second query message: the host re-runs the term it already holds.
    expect(mounted.posted.filter((m) => m.command === 'query')).toEqual([]);
  });
});

describe('GemStone Search webview — resetting on a session switch', () => {
  it('clears the query, the rows, the preview, the breadcrumb and the error banner', () => {
    const mounted = busyPanel();
    expect(mounted.view.rowCount()).toBe(2);

    mounted.view.onMessage({ data: { command: 'reset' } });

    expect((document.getElementById('query') as HTMLInputElement).value).toBe('');
    expect(mounted.view.rowCount()).toBe(0);
    expect(document.getElementById('results')?.textContent).toBe('');
    expect(document.getElementById('preview')?.textContent).toBe('');
    expect(document.getElementById('breadcrumb')?.textContent).toBe('');
    expect(document.getElementById('error')?.textContent).toBe('');
    expect(document.body.classList.contains('busy')).toBe(false);
  });

  it('puts the scope back to All, which is where the replacement engine starts', () => {
    const mounted = busyPanel();
    const activeTab = () => document.querySelector('#tabs .tab.active')?.textContent;
    expect(activeTab()).toBe('Classes');

    mounted.view.onMessage({ data: { command: 'reset' } });

    expect(activeTab()).toBe('All');
  });

  it('leaves no references state behind for the next session to inherit', () => {
    const mounted = busyPanel();
    const indicator = document.getElementById('refindicator') as HTMLButtonElement;
    expect(indicator.style.display).not.toBe('none');

    mounted.view.onMessage({ data: { command: 'reset' } });

    expect(indicator.style.display).toBe('none');
  });
});
