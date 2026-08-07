import { describe, it, expect } from 'vitest';
import {
  BaseMethodChange,
  BaseSelectorAnalysis,
  makeParseAnalysis,
  makeParseChange,
  makeParsePage,
  makeParseStartPreview,
  parseApplyResult,
  relocationChangeStem,
} from '../methodRelocationPreview';
import {
  escapeHtml,
  renderAllOfType,
  renderPlainChangeDiff,
  renderRelocationPanelHtml,
} from '../methodRelocationPanelHtml';

/**
 * Unit tests for the SHARED method-relocation module (RB catalog C2) that backs both the
 * move-method and push-method families. The family-specific wrappers keep their own
 * suites (moveMethodPreview / pushMethodPreview / *PanelHtml); these pin the shared
 * parsers, the `extend` hooks, the envelope edge cases, and the shared HTML scaffold in
 * one place, so a regression is caught here regardless of which family exercises it.
 */

// A minimal family: no per-change / per-selector extension (like move).
const parsePlainChange = makeParseChange<BaseMethodChange>('Test', () => ({}));
const parsePlainAnalysis = makeParseAnalysis<BaseSelectorAnalysis>('Test', () => ({}));
const parsePlainStart = makeParseStartPreview<BaseMethodChange>('Test', parsePlainChange);
const parsePlainPage = makeParsePage<BaseMethodChange>('Test', parsePlainChange);

// A family WITH an extension (like push's `warning`).
interface WarnChange extends BaseMethodChange {
  warning: string | null;
}
interface WarnSel extends BaseSelectorAnalysis {
  warning: string | null;
}
const parseWarnChange = makeParseChange<WarnChange>('Warn', (c) => ({
  warning: typeof c.warning === 'string' ? c.warning : null,
}));
const parseWarnAnalysis = makeParseAnalysis<WarnSel>('Warn', (s) => ({
  warning: typeof s.warning === 'string' ? s.warning : null,
}));
const parseWarnPage = makeParsePage<WarnChange>('Warn', parseWarnChange);

describe('makeParseChange', () => {
  const raw = {
    id: '1',
    kind: 'methodAdd',
    dictName: 'UserGlobals',
    className: 'Target',
    isMeta: true,
    selector: 'foo',
    category: 'accessing',
    oldSource: '',
    newSource: 'foo ^ 1',
  };

  it('reads the base fields', () => {
    const c = parsePlainChange(raw, 0);
    expect(c).toEqual(raw);
  });

  it('defaults optional fields (dictName/selector/category null, sources empty, isMeta false)', () => {
    const c = parsePlainChange({ id: '2', kind: 'methodRemove', className: 'X' }, 0);
    expect(c).toEqual({
      id: '2',
      kind: 'methodRemove',
      dictName: null,
      className: 'X',
      isMeta: false,
      selector: null,
      category: null,
      oldSource: '',
      newSource: '',
    });
  });

  it('merges the extend hook (push-style warning)', () => {
    const c = parseWarnChange({ ...raw, warning: 'overwrites Target>>foo' }, 0);
    expect(c.warning).toBe('overwrites Target>>foo');
    const plain = parseWarnChange(raw, 0);
    expect(plain.warning).toBeNull();
  });

  it('throws with the family label on a non-object', () => {
    expect(() => parsePlainChange(42, 3)).toThrow(/Test preview change 3 is malformed/);
  });

  it('throws on an unknown kind, naming the bad value', () => {
    expect(() => parsePlainChange({ id: '1', kind: 'nope', className: 'X' }, 0)).toThrow(
      /unknown kind: nope/,
    );
  });

  it('throws when id or className is missing', () => {
    expect(() => parsePlainChange({ kind: 'methodAdd', className: 'X' }, 0)).toThrow(
      /missing required fields/,
    );
    expect(() => parsePlainChange({ id: '1', kind: 'methodAdd' }, 0)).toThrow(
      /missing required fields/,
    );
  });
});

describe('makeParseAnalysis', () => {
  it('reads target, global decline, movable count, and per-selector verdicts', () => {
    const a = parsePlainAnalysis(
      JSON.stringify({
        targetClass: 'Base',
        globalDecline: null,
        movableCount: 2,
        selectors: [
          { selector: 'foo', decline: null },
          { selector: 'bar', decline: 'nope' },
        ],
      }),
    );
    expect(a.targetClass).toBe('Base');
    expect(a.movableCount).toBe(2);
    expect(a.selectors).toHaveLength(2);
    expect(a.selectors[1].decline).toBe('nope');
  });

  it('carries the extend hook onto each selector', () => {
    const a = parseWarnAnalysis(
      JSON.stringify({
        targetClass: 'Base',
        movableCount: 1,
        selectors: [{ selector: 'foo', decline: null, warning: 'w' }],
      }),
    );
    expect(a.selectors[0].warning).toBe('w');
  });

  it('defaults a null target and empty selectors, and drops non-object selectors', () => {
    const a = parsePlainAnalysis(
      JSON.stringify({
        targetClass: null,
        movableCount: 0,
        selectors: [null, 3, { selector: 'x' }],
      }),
    );
    expect(a.targetClass).toBeNull();
    expect(a.selectors).toHaveLength(1);
    expect(a.selectors[0]).toEqual({ selector: 'x', decline: null });
  });

  it('throws (with the label) when the payload is not an envelope', () => {
    expect(() => parsePlainAnalysis('"a bare error string"')).toThrow(/Test analysis/);
    expect(() => parsePlainAnalysis('[1,2]')).toThrow(/Test analysis/);
  });

  it('throws on a bare (non-JSON) engine error string', () => {
    expect(() => parsePlainAnalysis('Source class not found: Foo')).toThrow();
  });
});

describe('makeParseStartPreview', () => {
  const base = {
    token: 'tok',
    total: 2,
    targetClass: 'Base',
    movableCount: 1,
    outOfScope: { collision: null, decline: null },
    skippedMethods: [],
    page: { changes: [], nextOffset: 1, done: true },
  };

  it('reads totals, target, skipped methods, and the first page', () => {
    const s = parsePlainStart(
      JSON.stringify({
        ...base,
        skippedMethods: [{ selector: 'bar', reason: 'sends super' }],
        page: {
          changes: [{ id: '1', kind: 'methodAdd', className: 'Base' }],
          nextOffset: 2,
          done: false,
        },
      }),
    );
    expect(s.token).toBe('tok');
    expect(s.total).toBe(2);
    expect(s.targetClass).toBe('Base');
    expect(s.skippedMethods).toEqual([{ selector: 'bar', reason: 'sends super' }]);
    expect(s.page.changes).toHaveLength(1);
    expect(s.page.done).toBe(false);
  });

  it('carries a global decline through outOfScope', () => {
    const s = parsePlainStart(
      JSON.stringify({ ...base, outOfScope: { collision: null, decline: 'blocked' } }),
    );
    expect(s.outOfScope.decline).toBe('blocked');
  });

  it('tolerates a missing page (empty, done) and a missing outOfScope', () => {
    const s = parsePlainStart(JSON.stringify({ token: 'tok', total: 0 }));
    expect(s.page).toEqual({ changes: [], nextOffset: 0, done: true });
    expect(s.outOfScope).toEqual({ collision: null, decline: null });
    expect(s.skippedMethods).toEqual([]);
  });

  it('throws when the token is missing', () => {
    expect(() => parsePlainStart(JSON.stringify({ total: 1 }))).toThrow(/token/);
  });

  it('throws (with the label) when the payload is not an envelope', () => {
    expect(() => parsePlainStart('[]')).toThrow(/Test preview did not return a preview envelope/);
  });
});

describe('makeParsePage', () => {
  it('parses a multi-change page and applies the extend hook per change', () => {
    const p = parseWarnPage(
      JSON.stringify({
        changes: [
          { id: '1', kind: 'methodAdd', className: 'Sub', warning: 'overwrites Sub>>foo' },
          { id: '2', kind: 'methodAdd', className: 'Other' },
        ],
        nextOffset: 3,
        done: true,
      }),
    );
    expect(p.changes).toHaveLength(2);
    expect(p.changes[0].warning).toBe('overwrites Sub>>foo');
    expect(p.changes[1].warning).toBeNull();
    expect(p.done).toBe(true);
  });

  it('surfaces an expired-session error carried on the page', () => {
    expect(() =>
      parsePlainPage(JSON.stringify({ error: 'preview session expired', changes: [] })),
    ).toThrow(/expired/);
  });

  it('throws when the change list is missing', () => {
    expect(() => parsePlainPage(JSON.stringify({ nextOffset: 1, done: true }))).toThrow(
      /missing its change list/,
    );
  });

  it('throws (with the label) when the page is not an envelope', () => {
    expect(() => parsePlainPage('"bad"')).toThrow(/Test preview page/);
  });
});

describe('parseApplyResult', () => {
  it('reads the applied count and an empty failure list', () => {
    expect(parseApplyResult(JSON.stringify({ applied: 3, failed: [] }))).toEqual({
      applied: 3,
      failed: [],
      error: undefined,
    });
  });

  it('reads reported failures and normalises missing fields', () => {
    const r = parseApplyResult(
      JSON.stringify({ applied: 1, failed: [{ id: '2', label: 'Base', error: 'boom' }, {}] }),
    );
    expect(r.failed[0]).toEqual({ id: '2', label: 'Base', error: 'boom' });
    expect(r.failed[1]).toEqual({ id: '?', label: '?', error: 'unknown error' });
  });

  it('surfaces a top-level error and clamps a bad applied count', () => {
    const r = parseApplyResult(JSON.stringify({ applied: -5, error: 'nope' }));
    expect(r.applied).toBe(0);
    expect(r.error).toBe('nope');
    expect(r.failed).toEqual([]);
  });

  it('throws when the result is not an envelope', () => {
    expect(() => parseApplyResult('"x"')).toThrow(/result envelope/);
  });
});

describe('relocationChangeStem', () => {
  const c = (over: Partial<BaseMethodChange>): BaseMethodChange => ({
    id: '1',
    kind: 'methodAdd',
    dictName: null,
    className: 'Foo',
    isMeta: false,
    selector: 'bar',
    category: null,
    oldSource: '',
    newSource: '',
    ...over,
  });

  it('formats an instance-side stem', () => {
    expect(relocationChangeStem(c({}))).toBe('Foo>>bar');
  });

  it('marks the class side', () => {
    expect(relocationChangeStem(c({ isMeta: true }))).toBe('Foo class>>bar');
  });

  it('renders a null selector as ?', () => {
    expect(relocationChangeStem(c({ selector: null }))).toBe('Foo>>?');
  });
});

describe('shared HTML helpers', () => {
  it('escapeHtml escapes the five metacharacters', () => {
    expect(escapeHtml('a < b > c & "d"')).toBe('a &lt; b &gt; c &amp; &quot;d&quot;');
  });

  it('renderAllOfType prefixes and escapes each line', () => {
    const html = renderAllOfType('foo\n\t^ a < b', 'add');
    expect(html).toContain('<div class="line add">+foo</div>');
    expect(html).toContain('&lt; b');
    expect(html).not.toContain('line del');
  });

  it('renderPlainChangeDiff renders an add as all-added and a remove as all-removed', () => {
    const add = renderPlainChangeDiff({
      id: '1',
      kind: 'methodAdd',
      dictName: null,
      className: 'X',
      isMeta: false,
      selector: 'f',
      category: null,
      oldSource: 'OLD',
      newSource: 'NEW',
    });
    expect(add).toContain('line add">+NEW');
    expect(add).not.toContain('line del');

    const rm = renderPlainChangeDiff({
      id: '2',
      kind: 'methodRemove',
      dictName: null,
      className: 'X',
      isMeta: false,
      selector: 'f',
      category: null,
      oldSource: 'OLD',
      newSource: '',
    });
    expect(rm).toContain('line del">-OLD');
    expect(rm).not.toContain('line add');
  });
});

describe('renderRelocationPanelHtml', () => {
  const base = {
    docTitle: 'Move Method',
    headerHtml: 'Move to <code>Target</code>',
    total: 2,
    cardsHtml: '<li class="change" data-id="1"></li>',
    pageCount: 1,
    done: true,
    outOfScope: { collision: null, decline: null },
    skippedMethods: [],
    nonce: 'n0nce',
    script: '/* view */',
  };

  it('emits a strict CSP + nonce, the doc title, the header, the cards, and the script', () => {
    const html = renderRelocationPanelHtml(base);
    expect(html).toContain("script-src 'nonce-n0nce'");
    expect(html).toContain('<title>Move Method</title>');
    expect(html).toContain('Move to <code>Target</code>');
    expect(html).toContain('<li class="change" data-id="1">');
    expect(html).toContain('<script nonce="n0nce">/* view */</script>');
  });

  it('escapes the document title but passes headerHtml through verbatim', () => {
    const html = renderRelocationPanelHtml({ ...base, docTitle: 'A & B' });
    expect(html).toContain('<title>A &amp; B</title>');
    // headerHtml is caller-escaped, so its markup survives.
    expect(html).toContain('Move to <code>Target</code>');
  });

  it('hides the pager when done and shows it otherwise', () => {
    expect(renderRelocationPanelHtml(base)).toContain('pager hidden');
    const more = renderRelocationPanelHtml({ ...base, done: false });
    expect(more).toMatch(/pager"/);
    expect(more).not.toContain('pager hidden');
  });

  it('reports the loaded/total counts and singularises "change"', () => {
    expect(renderRelocationPanelHtml({ ...base, pageCount: 1, total: 5 })).toContain(
      '1 of 5 loaded',
    );
    expect(renderRelocationPanelHtml({ ...base, total: 1 })).toContain('of 1 change selected');
    expect(renderRelocationPanelHtml({ ...base, total: 2 })).toContain('of 2 changes selected');
  });

  it('renders the decline banner and the skipped summary when present', () => {
    const html = renderRelocationPanelHtml({
      ...base,
      outOfScope: { collision: null, decline: 'blocked <x>' },
      skippedMethods: [{ selector: 'bar', reason: 'sends super' }],
    });
    expect(html).toContain('class="oos"');
    expect(html).toContain('blocked &lt;x&gt;'); // banner escapes
    expect(html).toContain('1 method will NOT move');
    expect(html).toContain('sends super');
  });

  it('defaults the sel cursor to "default" and appends no extra CSS', () => {
    const html = renderRelocationPanelHtml(base);
    expect(html).toContain('.change-head .sel { cursor: default; }');
    expect(html).not.toContain('.change-head .sel:disabled');
  });

  it('honours the selCursor knob and appends extraCss (push-style)', () => {
    const html = renderRelocationPanelHtml({
      ...base,
      selCursor: 'pointer',
      extraCss: '\n    li.change.warn { color: orange; }',
    });
    expect(html).toContain('.change-head .sel { cursor: pointer; }');
    expect(html).toContain('li.change.warn { color: orange; }');
  });
});
