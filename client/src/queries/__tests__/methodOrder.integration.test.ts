// Method lists read from a live stone come out in Jasper's order (VS Code's file-name rule), not
// the stone's. The probe class has operators, a private _ method, mixed case and numbered names,
// which are exactly the selectors GemStone's own sort scatters. The fixture is compiled inside each
// test's transaction, so the harness's per-test abort removes it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { knownGemStoneBugs, skipForKnownGemStoneBug } from '../../__tests__/knownGemStoneBugs';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { compareNames } from '../../methodOrder';
import { getMethodList } from '../getMethodList';
import { getMethodCategories } from '../getMethodCategories';
import { getClassEnvironments } from '../getClassEnvironments';
import { discoverTestMethods } from '../discoverTestMethods';
import { getAllSelectors } from '../getAllSelectors';
import { describeClass } from '../describeClass';
import { getGrailStubReflection } from '../grailStubReflection';
import { fetchObjectMeta as fetchBasicMeta } from '../../basicInspector/queries/basicInspectorQueries';
import { fetchObjectMeta as fetchEnhancedMeta } from '../../enhancedInspector/queries/getEnhancedInspectorViewSpecs';

const PROBE = 'JasperMethodOrderProbe';

// [source, category]. `\\` in the template is one Smalltalk backslash pair: the selector \\.
const INSTANCE_METHODS: [string, string][] = [
  ['/ other  ^ self', 'arithmetic'],
  ['\\\\ other  ^ self', 'arithmetic'],
  ['~= other  ^ false', 'arithmetic'],
  ['abs  ^ self', 'Accessing'],
  ['Zed  ^ self', 'Accessing'],
  ['_bottomBit  ^ 0', 'private'],
  ['test2  ^ self', 'version2'],
  ['test10  ^ self', 'version10'],
];
const CLASS_METHODS: [string, string][] = [
  ['Zed  ^ self', 'instance creation'],
  ['_make  ^ self new', 'instance creation'],
];

const INSTANCE_ORDER = ['_bottomBit', '/', '\\\\', '~=', 'abs', 'test2', 'test10', 'Zed'];
const CATEGORY_ORDER = ['Accessing', 'arithmetic', 'private', 'version2', 'version10'];

const compileAll = (side: string, methods: [string, string][]) =>
  methods
    .map(
      ([source, category]) =>
        `${side} compileMethod: '${source.replace(/'/g, "''")}' dictionaries: System myUserProfile symbolList category: '${category}'.`,
    )
    .join('\n');

const FIXTURE = `[| cls |
cls := UserGlobals at: #'${PROBE}' ifAbsent: [
  TestCase subclass: '${PROBE}' instVarNames: #() classVars: #() classInstVars: #()
    poolDictionaries: #() inDictionary: UserGlobals].
${compileAll('cls', INSTANCE_METHODS)}
${compileAll('cls class', CLASS_METHODS)}
'ok'] value`;

describe('method list order on a live stone (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const probeSelectors = (all: string[]) => all.filter((s) => INSTANCE_ORDER.includes(s));

  beforeEach(() => {
    expect(exec(FIXTURE)).toBe('ok');
  });

  it("records GemStone's own order, which Jasper does not use", () => {
    // Case folded to capitals before comparing, so \\, _ and ~ (above Z in ASCII) land after
    // every letter. If a GemStone release changes this, this test says so.
    const stone = exec(`| ws |
ws := WriteStream on: String new.
#(#'abs' #'Zed' #'/' #'\\\\' #'_bottomBit' #'~=' #'test10' #'test2' #'<') asSortedCollection
  do: [:each | ws nextPutAll: each] separatedBy: [ws space].
ws contents`);
    expect(stone.split(' ')).toEqual([
      '/',
      '<',
      'abs',
      'test10',
      'test2',
      'Zed',
      '\\\\',
      '_bottomBit',
      '~=',
    ]);
  });

  it('getMethodList: by side, then category, then selector', () => {
    const rows = getMethodList(exec, PROBE).map(
      (m) => `${m.isMeta ? 'C' : 'I'} ${m.category} ${m.selector}`,
    );
    expect(rows).toEqual([
      'I Accessing abs',
      'I Accessing Zed',
      'I arithmetic /',
      'I arithmetic \\\\',
      'I arithmetic ~=',
      'I private _bottomBit',
      'I version2 test2',
      'I version10 test10',
      'C instance creation _make',
      'C instance creation Zed',
    ]);
  });

  it('getMethodCategories', () => {
    expect(getMethodCategories(exec, PROBE, false)).toEqual(CATEGORY_ORDER);
  });

  it('getClassEnvironments: the Explorer Methods pane data', () => {
    const dictIndex = Number(
      exec('(System myUserProfile symbolList indexOf: UserGlobals) printString'),
    );
    const lines = getClassEnvironments(exec, dictIndex, PROBE, 0).filter((l) => !l.isMeta);
    for (const line of lines) {
      expect(line.selectors).toEqual([...line.selectors].sort(compareNames));
    }
    expect(lines.find((l) => l.category === 'arithmetic')?.selectors).toEqual(['/', '\\\\', '~=']);
  });

  it('discoverTestMethods', () => {
    expect(discoverTestMethods(exec, PROBE, 'UserGlobals').map((t) => t.selector)).toEqual([
      'test2',
      'test10',
    ]);
  });

  it('getAllSelectors: inherited ones too, all in one order', () => {
    const all = getAllSelectors(exec, PROBE);
    expect(all).toEqual([...all].sort(compareNames));
    expect(probeSelectors(all)).toEqual(INSTANCE_ORDER);
  });

  it('describeClass: the instance-methods section', () => {
    const text = describeClass(exec, PROBE, 'UserGlobals');
    const section = text.slice(
      text.indexOf('=== Instance methods ===\n'),
      text.indexOf('\n=== Class methods ==='),
    );
    expect(section).toBe(
      '=== Instance methods ===\n' +
        'Accessing:\n  abs\n  Zed\n' +
        'arithmetic:\n  /\n  \\\\\n  ~=\n' +
        'private:\n  _bottomBit\n' +
        'version2:\n  test2\n' +
        'version10:\n  test10\n',
    );
    expect(text.endsWith('=== Class methods ===\ninstance creation:\n  _make\n  Zed\n')).toBe(true);
  });

  it('getGrailStubReflection', () => {
    const methods = getGrailStubReflection(exec, PROBE, 'UserGlobals').methods;
    expect(methods.filter((m) => m.side === 'instance').map((m) => m.selector)).toEqual([
      'abs',
      'Zed',
      '/',
      '\\\\',
      '~=',
      '_bottomBit',
      'test2',
      'test10',
    ]);
  });

  const probeOop = () => BigInt(exec(`${PROBE} asOop printString`));

  it('Inspector Meta tab', () => {
    const meta = fetchBasicMeta(exec, probeOop());
    expect(meta?.instanceSelectors).toEqual(INSTANCE_ORDER);
    expect(meta?.classSelectors).toEqual(['_make', 'Zed']);
  });

  it('Enhanced Inspector Meta tab', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());
    const meta = JSON.parse(fetchEnhancedMeta(exec, probeOop()) ?? '{}');
    expect(meta.methodSelectors).toEqual(INSTANCE_ORDER);
    expect(meta.classMethodSelectors).toEqual(['_make', 'Zed']);
  });

  it('a non-ASCII selector and category sort among the letters', (ctx) => {
    skipForKnownGemStoneBug(knownGemStoneBugs.nonAsciiSourceCompile, ctx, session());
    expect(
      exec(`[${PROBE}
  compileMethod: 'caf', (String with: (Character codePoint: 233)), '  ^ 1'
  dictionaries: System myUserProfile symbolList
  category: (String with: (Character codePoint: 201)), 'tiquettes'.
'ok'] value`),
    ).toBe('ok');
    const rows = getMethodList(exec, PROBE).filter((m) => !m.isMeta);
    expect(rows.map((m) => m.category)).toEqual(
      [...rows.map((m) => m.category)].sort(compareNames),
    );
    const cafe = rows.find((m) => m.selector === 'café');
    expect(cafe?.category).toBe('Étiquettes');
    expect(getMethodCategories(exec, PROBE, false)).toEqual([
      'Accessing',
      'arithmetic',
      'Étiquettes',
      'private',
      'version2',
      'version10',
    ]);
    expect(fetchBasicMeta(exec, probeOop())?.instanceSelectors).toEqual([
      '_bottomBit',
      '/',
      '\\\\',
      '~=',
      'abs',
      'café',
      'test2',
      'test10',
      'Zed',
    ]);
  });
});
