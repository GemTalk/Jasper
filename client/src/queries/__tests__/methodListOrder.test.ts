// Every query that lists methods or method categories hands them back in Jasper's order, whatever
// order the stone answers in. Each fake stone below answers in GemStone's own order (case folded
// to capitals, so \\, _ and ~ land after Z, and test10 before test2), which is what a mock copying
// the stone used to hide.
import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getMethodList } from '../getMethodList';
import { getMethodCategories } from '../getMethodCategories';
import { getClassEnvironments } from '../getClassEnvironments';
import { discoverTestMethods } from '../discoverTestMethods';
import { getAllSelectors } from '../getAllSelectors';
import { describeClass } from '../describeClass';
import { getGrailStubReflection } from '../grailStubReflection';
import { fetchObjectMeta as fetchBasicMeta } from '../../basicInspector/queries/basicInspectorQueries';
import { fetchObjectMeta as fetchEnhancedMeta } from '../../enhancedInspector/queries/getEnhancedInspectorViewSpecs';

const STONE_ORDER = ['/', 'abs', 'test10', 'test2', 'Zed', '\\\\', '_bottomBit', '~='];
const JASPER_ORDER = ['_bottomBit', '/', '\\\\', '~=', 'abs', 'test2', 'test10', 'Zed'];

const stone = (answer: string) => vi.fn<QueryExecutor>(() => answer);
const lines = (rows: string[]) => rows.map((r) => `${r}\n`).join('');

describe('method list queries sort in Jasper, not on the stone', () => {
  it('getMethodList: instance side first, then by category, then by selector', () => {
    const answer = lines([
      '0\tversion10\tb',
      '0\tversion2\ta',
      ...STONE_ORDER.map((s) => `0\tAll\t${s}`),
      '1\tinstance creation\tnew',
    ]);
    // Rows deliberately start on the class side to show the side is sorted too.
    const rows = getMethodList(stone(`1\tdefaults\tdefaultName\n${answer}`), 'Probe');
    expect(rows.map((r) => `${r.isMeta ? 'C' : 'I'} ${r.category} ${r.selector}`)).toEqual([
      ...JASPER_ORDER.map((s) => `I All ${s}`),
      'I version2 a',
      'I version10 b',
      'C defaults defaultName',
      'C instance creation new',
    ]);
  });

  it('getMethodCategories', () => {
    expect(
      getMethodCategories(
        stone(lines(['version10', 'Accessing', 'version2', '*ext'])),
        'Probe',
        false,
      ),
    ).toEqual(['*ext', 'Accessing', 'version2', 'version10']);
  });

  it('getClassEnvironments: the selectors of each category', () => {
    const tokens = STONE_ORDER.map((s) => `00${s}`).join('\t');
    const [only] = getClassEnvironments(stone(`Probe\t0\tAll\t${tokens}\t\n`), 1, 'Probe', 0);
    expect(only.selectors).toEqual(JASPER_ORDER);
  });

  it('discoverTestMethods', () => {
    const answer = lines(['testZed', 'test10', 'test2', 'test_private'].map((s) => `${s}\ttests`));
    expect(discoverTestMethods(stone(answer), 'ProbeTest').map((t) => t.selector)).toEqual([
      'test_private',
      'test2',
      'test10',
      'testZed',
    ]);
  });

  it('getAllSelectors', () => {
    expect(getAllSelectors(stone(lines(STONE_ORDER)), 'Probe')).toEqual(JASPER_ORDER);
  });

  it('describeClass: categories and their selectors, both sides', () => {
    const answer =
      lines([
        'i\tversion10',
        'i\tversion10\tb',
        'i\tAll',
        ...STONE_ORDER.map((s) => `i\tAll\t${s}`),
        'i\tversion2',
        'i\tversion2\ta',
        'c\tinstance creation',
        'c\tinstance creation\tnew',
        'c\tdefaults',
        'c\tdefaults\tdefaultName',
      ]) + '=== Definition ===\nObject subclass: #Probe\n\n=== Comment ===\nhello\n\n';
    expect(describeClass(stone(answer), 'Probe')).toBe(
      '=== Definition ===\nObject subclass: #Probe\n\n=== Comment ===\nhello\n\n' +
        '=== Instance methods ===\n' +
        'All:\n' +
        JASPER_ORDER.map((s) => `  ${s}\n`).join('') +
        'version2:\n  a\n' +
        'version10:\n  b\n' +
        '\n=== Class methods ===\n' +
        'defaults:\n  defaultName\n' +
        'instance creation:\n  new\n',
    );
  });

  it('describeClass: an empty category still gets its heading', () => {
    const answer = lines(['i\tempty']) + '=== Definition ===\nx\n\n=== Comment ===\ny\n\n';
    expect(describeClass(stone(answer), 'Probe')).toBe(
      '=== Definition ===\nx\n\n=== Comment ===\ny\n\n' +
        '=== Instance methods ===\nempty:\n\n=== Class methods ===\n',
    );
  });

  it('describeClass: passes a not-found answer through untouched', () => {
    expect(describeClass(stone('Class not found: Nope'), 'Nope')).toBe('Class not found: Nope');
  });

  it('getGrailStubReflection: methods by side, then category, then selector', () => {
    const answer =
      'SUPER\tObject\n' +
      lines([
        'METHOD\tc\tinstance creation\tnew',
        ...STONE_ORDER.map((s) => `METHOD\ti\tAll\t${s}`),
        'METHOD\ti\tversion10\tb',
        'METHOD\ti\tversion2\ta',
      ]) +
      '===COMMENT===\n';
    const methods = getGrailStubReflection(stone(answer), 'Probe').methods;
    expect(
      methods.map((m) => `${m.side === 'class' ? 'C' : 'I'} ${m.category} ${m.selector}`),
    ).toEqual([
      ...JASPER_ORDER.map((s) => `I All ${s}`),
      'I version2 a',
      'I version10 b',
      'C instance creation new',
    ]);
  });

  it('Inspector Meta tab: both selector lists', () => {
    // The payload escapes a backslash as \\, so the selector \\ arrives as four.
    const esc = (s: string) => s.replace(/\\/g, '\\\\');
    const answer = lines([
      'cls\tProbe',
      ...STONE_ORDER.map((s) => `inst\t${esc(s)}`),
      ...STONE_ORDER.map((s) => `meta\t${esc(s)}`),
    ]);
    const meta = fetchBasicMeta(stone(answer), 1n);
    expect(meta?.instanceSelectors).toEqual(JASPER_ORDER);
    expect(meta?.classSelectors).toEqual(JASPER_ORDER);
  });

  it('Enhanced Inspector Meta tab: both selector lists', () => {
    const answer = JSON.stringify({
      className: 'Probe',
      methodSelectors: STONE_ORDER,
      classMethodSelectors: STONE_ORDER,
    });
    const meta = JSON.parse(fetchEnhancedMeta(stone(answer), 1n) ?? '{}');
    expect(meta.methodSelectors).toEqual(JASPER_ORDER);
    expect(meta.classMethodSelectors).toEqual(JASPER_ORDER);
    expect(meta.className).toBe('Probe');
  });
});
