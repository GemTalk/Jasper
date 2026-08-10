import { describe, it, expect, vi } from 'vitest';
import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import { createClassesProvider } from '../providers/classesProvider';
import { createDictionariesProvider } from '../providers/dictionariesProvider';
import { createOpenEditorsProvider } from '../providers/openEditorsProvider';
import { createMethodsProvider, SERVER_OVERFETCH } from '../providers/methodsProvider';
import { ClassNameEntry } from '../../queries/getAllClassNames';
import { SelectorSearchResult } from '../../queries/searchSelectors';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

describe('classesProvider', () => {
  const entries: ClassNameEntry[] = [
    { dictIndex: 1, dictName: 'Globals', className: 'OrderedCollection' },
    { dictIndex: 1, dictName: 'Globals', className: 'Object' },
    { dictIndex: 3, dictName: 'Python', className: 'object' },
  ];

  it('loads the corpus in prime(), then matches client-side WITHOUT reloading on each search', () => {
    const load = vi.fn(() => entries);
    const p = createClassesProvider(42, load);
    void p.prime?.(NEVER_CANCELLED);
    const r1 = p.search('oc', cfg(), NEVER_CANCELLED) as ReturnType<typeof Array.prototype.slice>;
    const r2 = p.search('obj', cfg(), NEVER_CANCELLED);
    // Load happened once (in prime); neither search re-queried — this is the caching guarantee.
    expect(load).toHaveBeenCalledTimes(1);
    expect((r1 as { label: string }[])[0].label).toBe('OrderedCollection');
    expect((r2 as { label: string }[]).map((x) => x.label)).toContain('Object');
  });

  it('produces an openClass action carrying the picked entry + session', () => {
    const p = createClassesProvider(7, () => entries);
    void p.prime?.(NEVER_CANCELLED);
    const [top] = p.search('OrderedCollection', cfg(), NEVER_CANCELLED) as {
      action: { kind: string; sessionId: number; className: string; dictIndex: number };
    }[];
    expect(top.action).toEqual({
      kind: 'openClass',
      sessionId: 7,
      dictName: 'Globals',
      className: 'OrderedCollection',
      dictIndex: 1,
    });
  });

  it('respects maxResultsPerCategory', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      dictIndex: 1,
      dictName: 'Globals',
      className: `Widget${i}`,
    }));
    const p = createClassesProvider(1, () => many);
    void p.prime?.(NEVER_CANCELLED);
    expect(p.search('widget', cfg({ maxResultsPerCategory: 5 }), NEVER_CANCELLED)).toHaveLength(5);
  });
});

describe('dictionariesProvider', () => {
  it('matches names and produces a revealDictionary action', () => {
    const p = createDictionariesProvider(9, () => ['Globals', 'Published', 'UserGlobals']);
    void p.prime?.(NEVER_CANCELLED);
    const results = p.search('glob', cfg(), NEVER_CANCELLED) as {
      label: string;
      action: unknown;
    }[];
    expect(results.map((r) => r.label)).toContain('Globals');
    expect(results[0].action).toEqual({
      kind: 'revealDictionary',
      sessionId: 9,
      dictName: results[0].label,
    });
  });
});

describe('openEditorsProvider', () => {
  it('is local (no prime) and focuses the tab uri', () => {
    const p = createOpenEditorsProvider(() => [
      { label: 'OrderedCollection', uri: 'gemstone://1/Globals/OrderedCollection/definition' },
      { label: 'add:', uri: 'gemstone://1/Globals/OrderedCollection/instance/adding/add:' },
    ]);
    expect(p.prime).toBeUndefined();
    const results = p.search('add', cfg(), NEVER_CANCELLED) as { label: string; action: unknown }[];
    expect(results[0].label).toBe('add:');
    expect(results[0].action).toEqual({
      kind: 'focusEditor',
      uri: 'gemstone://1/Globals/OrderedCollection/instance/adding/add:',
    });
  });
});

describe('methodsProvider', () => {
  const rows: SelectorSearchResult[] = [
    {
      dictName: 'Globals',
      className: 'OrderedCollection',
      isMeta: false,
      selector: 'add:',
      category: 'adding',
    },
    {
      dictName: 'Globals',
      className: 'Array',
      isMeta: true,
      selector: 'with:',
      category: 'instance creation',
    },
  ];

  it('does not hit the stone below methodMinQueryLength', () => {
    const runSearch = vi.fn(() => rows);
    const p = createMethodsProvider(1, runSearch);
    expect(p.search('ad', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)).toEqual([]);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it('queries the stone (case-folded per config) and builds Class>>selector labels', () => {
    const runSearch = vi.fn(() => rows);
    const p = createMethodsProvider(5, runSearch);
    const results = p.search('add', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED) as {
      label: string;
      description?: string;
      action: { kind: string; selector: string; isMeta: boolean };
    }[];
    // Over-fetches (SERVER_OVERFETCH ×) so ranking has a wider pool, then client-caps.
    expect(runSearch).toHaveBeenCalledWith(
      'add',
      OMNI_DEFAULTS.maxResultsPerCategory * SERVER_OVERFETCH,
      true,
    );
    const add = results.find((r) => r.label === 'OrderedCollection>>add:');
    expect(add).toBeTruthy();
    expect(add?.description).toBe('Globals · adding');
    expect(add?.action).toMatchObject({ kind: 'openMethod', selector: 'add:', isMeta: false });
  });

  it('labels the class side as `Class class>>selector`', () => {
    const p = createMethodsProvider(1, () => rows);
    const results = p.search('with', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED) as {
      label: string;
    }[];
    expect(results.some((r) => r.label === 'Array class>>with:')).toBe(true);
  });

  it('shifts highlight ranges from selector into label coordinates', () => {
    const p = createMethodsProvider(1, () => [rows[0]]);
    const [r] = p.search(
      'add',
      cfg({ methodMinQueryLength: 3, matchMode: 'prefix' }),
      NEVER_CANCELLED,
    ) as {
      label: string;
      ranges: [number, number][];
    }[];
    // label = 'OrderedCollection>>add:'; 'add' starts at index 18 (after 'OrderedCollection>>').
    expect(r.label.slice(r.ranges[0][0], r.ranges[0][1])).toBe('add');
  });
});
