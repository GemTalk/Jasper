// @vitest-environment jsdom
/**
 * Highlighting the send inside an expanded reference row in the GemStone Search preview pane.
 *
 * The pane marks the symbol the list is references OF, so the eye lands on the call rather than
 * re-reading the whole method. A senders query hands the view the whole selector as its highlight
 * term (`omniSearchCommand.ts` builds `target` from `req.selector`, `omniEngine.ts` passes it on as
 * `highlightTerm`), and the view looks for that term as a literal substring of the source
 * (`highlightOccurrences` in `omniSearchView.js`).
 *
 * A literal substring search is the wrong shape for a Smalltalk send, in three separate ways:
 *
 *  - **It misses every keyword selector.** `on:do:` is never written as one token — the source says
 *    `on: Error do: [...]` — so nothing matches and the method renders unmarked.
 *  - **It marks a one-keyword selector inside a longer one.** `at:` is a substring of `at:put:`, so
 *    an `at:put:` send lights up as if it were a send of `at:`.
 *  - **It marks any identifier the term is a prefix of.** `printString` matches inside
 *    `printStringLimitedTo:`, and the class `Account` matches inside `AccountHolder`.
 *
 * The first is what was reported; the other two fall out of the same line and would survive a fix
 * aimed only at keyword selectors, so they are pinned here too. See the "Search tool's reference
 * preview doesn't highlight a keyword selector" item in https://github.com/GemTalk/Jasper/issues/622.
 *
 * What SHOULD be marked is the send site: each keyword part of a keyword send, the selector token of
 * a unary or binary send, the name of a class reference — and nothing that merely contains those
 * characters.
 *
 * Both ways of looking at references are covered, because they render through different paths and
 * only one of them was fixed first:
 *
 *  - the default **sticky list** (`referencesInPreview`), where the preview pane holds the reference
 *    rows and one expands to show its source (`fillReferenceSource`);
 *  - the **classic pivot**, where the reference rows replace the result list and the preview pane is
 *    an ordinary source preview of the selected row (`showPreview`). That path highlighted the TYPED
 *    query, which in a pivot is the selector as a selector — `on:do:` — and so matched nothing at
 *    all, which is what the bug looked like from the panel.
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
    referenceable: true,
    categoryId: 'methods',
    categoryLabel: 'Method',
    icon: 'symbol-method',
  };
}

/**
 * Drive the pane the way the user does: a result list, a references/senders list in the preview pane
 * for the selected row, then expand a reference and let the host answer with its source. Returns the
 * `<pre>` the expanded source was rendered into.
 */
function expandedSource(
  mounted: MountedOmniView,
  highlightTerm: string,
  source: string,
  refId = 7,
): HTMLElement {
  mounted.view.onMessage({
    data: {
      command: 'results',
      rows: [row(0, 'Account>>caller')],
      shownCount: 1,
      hasMore: false,
      exact: true,
      truncations: [],
      pivot: false,
      categories: CATEGORIES,
      scopeId: 'methods',
      caseSensitive: false,
      placeholder: 'Search…',
    },
  });
  mounted.view.onMessage({
    data: {
      command: 'refPreview',
      forId: 0,
      title: `Senders of #${highlightTerm}`,
      rows: [{ id: refId, label: 'Account>>caller', ranges: [] }],
      highlightTerm,
    },
  });
  const header = document.querySelector(`.preview-ref[data-ref-id="${refId}"]`) as HTMLElement;
  header.click(); // expand → the view asks the host for the source
  mounted.view.onMessage({ data: { command: 'referenceSource', refId, source } });
  return header.parentNode!.querySelector('.preview-ref-src') as HTMLElement;
}

const marks = (el: HTMLElement): (string | null)[] =>
  Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);

/**
 * Drive the CLASSIC PIVOT: the reference rows have replaced the result list, the search box still
 * holds the term that found them, and the preview pane shows the selected row's source. Returns the
 * `<pre>` that source was rendered into.
 */
function pivotedSource(
  mounted: MountedOmniView,
  target: string,
  source: string,
  typed = target,
): HTMLElement {
  (document.getElementById('query') as HTMLInputElement).value = typed;
  mounted.view.onMessage({
    data: {
      command: 'results',
      rows: [row(0, 'AbstractExternalSession class>>_stackReport:')],
      shownCount: 1,
      hasMore: false,
      exact: true,
      truncations: [],
      pivot: true,
      pivotTitle: `Senders of ${target}`,
      pivotTarget: target,
      pivotHint: 'Esc to go back',
      categories: CATEGORIES,
      scopeId: 'methods',
      caseSensitive: false,
      placeholder: 'Search…',
    },
  });
  mounted.view.onMessage({ data: { command: 'preview', id: 0, source, title: 'x' } });
  return document.querySelector('.preview-src') as HTMLElement;
}

/** The whole source still reads back, marked or not — highlighting must never eat text. */
const text = (el: HTMLElement): string => el.textContent ?? '';

const STACK_REPORT = [
  '_stackReport: contextOop',
  '\t"contextOop is from  aGciErrSType context"',
  '\t| aGsProcess |',
  "\taGsProcess := (Object _objectForOop: contextOop) ifNil:[ ^ ' < NO PROCESS FOUND >",
  "'].",
  '\t^ [ aGsProcess stackReportToLevel: 300 withArgsAndTemps: true andMethods: false',
  "\t  ] on: Error do:[:ex | 'ERROR during stack report ', ex asString ].",
].join('\n');

describe('the classic pivot marks the send in the selected row', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('marks on:do: in a real kernel sender', () => {
    // AbstractExternalSession class>>_stackReport:, verbatim from the panel — a comment, a string
    // literal that spans a line break, and `do:[` with no space before the block.
    const src = pivotedSource(mounted, 'on:do:', STACK_REPORT);

    expect(marks(src)).toEqual(['on:', 'do:']);
  });

  it('does not fall back to marking the typed selector as text', () => {
    const src = pivotedSource(mounted, 'on:do:', STACK_REPORT);

    // The old behaviour: `indexOf('on:do:')` over the source, which finds nothing here — and would
    // have found the wrong thing in a method that happens to mention the selector in a string.
    expect(marks(src)).not.toEqual([]);
  });

  it('keeps marking the send after typing narrows the pivot', () => {
    // Typing while pivoted FILTERS the loaded reference rows (see OmniEngine.search) rather than
    // starting a new search, so the list is still senders of the pivoted selector and the pane must
    // still mark the send. The typed text is a filter over row LABELS; marking it in the source
    // instead would say nothing about why the row is in the list.
    const src = pivotedSource(mounted, 'on:do:', STACK_REPORT, '_stackReport');

    expect(marks(src)).toEqual(['on:', 'do:']);
  });

  it('marks a class reference pivoted on', () => {
    const src = pivotedSource(mounted, 'Account', 'caller\n\t^ AccountHolder for: Account new');

    expect(marks(src)).toEqual(['Account']);
  });

  it('still marks the typed text literally when no pivot is up', () => {
    // An ordinary Source search asks "where does what I typed appear", and a literal match is the
    // right answer there — the pivot's rule must not leak into it.
    (document.getElementById('query') as HTMLInputElement).value = 'stackReport';
    mounted.view.onMessage({
      data: {
        command: 'results',
        rows: [row(0, 'A>>b')],
        shownCount: 1,
        hasMore: false,
        exact: true,
        truncations: [],
        pivot: false,
        categories: CATEGORIES,
        scopeId: 'methods',
        caseSensitive: false,
        placeholder: 'Search…',
      },
    });
    mounted.view.onMessage({
      data: { command: 'preview', id: 0, source: STACK_REPORT, title: 'x' },
    });
    const src = document.querySelector('.preview-src') as HTMLElement;

    // `stackReport` is a substring of `stackReportToLevel:` and of `_stackReport:` — both wanted
    // here, because this is a text search and that is what was asked for.
    expect(marks(src).length).toBeGreaterThan(1);
  });
});

describe('a unary or binary send is marked, and only where it is sent', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('marks a unary selector', () => {
    const src = expandedSource(mounted, 'printString', 'caller\n\t^ self value printString');

    expect(marks(src)).toEqual(['printString']);
  });

  it('marks a unary selector once per send', () => {
    const src = expandedSource(
      mounted,
      'printString',
      'caller\n\t^ self a printString , self b printString',
    );

    expect(marks(src)).toEqual(['printString', 'printString']);
  });

  it('marks a binary selector', () => {
    const src = expandedSource(mounted, ',', "caller\n\t^ 'a' , 'b'");

    expect(marks(src)).toEqual([',']);
  });

  it('does not mark an identifier the unary selector is merely a prefix of', () => {
    // `printStringLimitedTo:` is a different selector; a substring search marks its first 11 chars.
    const src = expandedSource(mounted, 'printString', 'caller\n\t^ self printStringLimitedTo: 20');

    expect(marks(src)).toEqual([]);
  });

  it('does not mark the selector where it appears inside a string literal', () => {
    const src = expandedSource(mounted, 'printString', "caller\n\t^ 'printString'");

    expect(marks(src)).toEqual([]);
  });
});

describe('a keyword send is marked part by part', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('marks both keyword parts of a two-part send', () => {
    const src = expandedSource(
      mounted,
      'on:do:',
      'caller\n\t^ [self risky] on: Error do: [:e | e return: nil]',
    );

    expect(marks(src)).toEqual(['on:', 'do:']);
  });

  it('marks a keyword send whose parts are on separate lines', () => {
    const src = expandedSource(
      mounted,
      'on:do:',
      'caller\n\t^ [self risky]\n\t\ton: Error\n\t\tdo: [:e | e return: nil]',
    );

    expect(marks(src)).toEqual(['on:', 'do:']);
  });

  it('marks a real kernel sender: Array>>_literalEqual: sends with:do:', () => {
    // Straight out of the panel: searching `with:do:`, asking for its senders, and expanding this
    // row shows the send laid out over two lines and nothing marked. The keyword parts are what the
    // eye is looking for in a method this long.
    const src = expandedSource(
      mounted,
      'with:do:',
      '_literalEqual: anotherLiteral\n' +
        '\t"For two literals to be _literalEqual, their class must be identical and\n' +
        '\t otherwise equal"\n\n' +
        '\tself class == anotherLiteral class\n\t\tifFalse: [ ^ false ].\n' +
        '\tself size == anotherLiteral size\n\t\tifFalse: [ ^ false ].\n' +
        '\tself\n\t\twith: anotherLiteral\n\t\tdo: [ :e1 :e2 |\n' +
        '\t\t\t(e1 _literalEqual: e2)\n\t\t\t\tifFalse: [ ^ false ] ].\n\t^ true',
    );

    expect(marks(src)).toEqual(['with:', 'do:']);
  });

  it('marks all three parts of a three-part send', () => {
    const src = expandedSource(
      mounted,
      'at:put:ifAbsent:',
      'caller\n\t^ dict at: #k put: 1 ifAbsent: [0]',
    );

    expect(marks(src)).toEqual(['at:', 'put:', 'ifAbsent:']);
  });

  it('marks every part of each send when the selector is sent twice', () => {
    const src = expandedSource(
      mounted,
      'at:put:',
      'caller\n\tdict at: #a put: 1.\n\tdict at: #b put: 2',
    );

    expect(marks(src)).toEqual(['at:', 'put:', 'at:', 'put:']);
  });

  it('marks the keyword parts of a send inside a block', () => {
    const src = expandedSource(mounted, 'at:put:', 'caller\n\tkeys do: [:k | dict at: k put: 0]');

    expect(marks(src)).toEqual(['at:', 'put:']);
  });
});

describe('a longer selector is not mistaken for a shorter one', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('does not mark a one-keyword selector inside a longer keyword send', () => {
    // `at:put:` is not a send of `at:`; a plain substring search marks its first part anyway.
    const src = expandedSource(mounted, 'at:', 'caller\n\t^ dict at: #key put: 1');

    expect(marks(src)).toEqual([]);
  });

  it('marks a one-keyword selector where it really is sent, alongside a longer send', () => {
    const src = expandedSource(mounted, 'at:', 'caller\n\tdict at: #a put: 1.\n\t^ dict at: #a');

    expect(marks(src)).toEqual(['at:']);
  });

  it('does not mark a keyword part that belongs to a different selector', () => {
    // `do:` here is `collect:do:`-shaped noise, not a send of `on:do:`.
    const src = expandedSource(mounted, 'on:do:', 'caller\n\t^ items do: [:e | e run]');

    expect(marks(src)).toEqual([]);
  });
});

describe('a class reference is marked as a whole name', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it('marks a class reference', () => {
    const src = expandedSource(mounted, 'Account', 'caller\n\t^ Account new');

    expect(marks(src)).toEqual(['Account']);
  });

  it('does not mark a longer class name the term is a prefix of', () => {
    const src = expandedSource(mounted, 'Account', 'caller\n\t^ AccountHolder new');

    expect(marks(src)).toEqual([]);
  });

  it('marks the reference but not the longer name beside it', () => {
    const src = expandedSource(mounted, 'Account', 'caller\n\t^ AccountHolder for: Account new');

    expect(marks(src)).toEqual(['Account']);
  });
});

describe('whatever is marked, the source still reads back whole', () => {
  let mounted: MountedOmniView;
  beforeEach(() => {
    mounted = mountOmniView({ categories: CATEGORIES, scopeId: null, caseSensitive: false });
  });

  it.each([
    ['on:do:', 'caller\n\t^ [self risky] on: Error do: [:e | e return: nil]'],
    ['at:put:', 'caller\n\t^ dict at: #key put: 1'],
    ['printString', 'caller\n\t^ self value printString'],
    ['Account', 'caller\n\t^ Account new'],
  ])('keeps every character of the source for %s', (term, source) => {
    const src = expandedSource(mounted, term, source);

    expect(text(src)).toBe(source);
  });

  it('renders an unmatched term as plain text rather than blanking the pane', () => {
    const source = 'caller\n\t^ self other';
    const src = expandedSource(mounted, 'on:do:', source);

    expect(text(src)).toBe(source);
    expect(marks(src)).toEqual([]);
  });
});
