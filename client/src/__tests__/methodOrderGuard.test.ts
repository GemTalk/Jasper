// Method lists drifted apart because each place wrote its own sort. These checks keep every one
// of them on the shared comparators in methodOrder.ts.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CLIENT_SRC = join(__dirname, '..');
const REPO = join(CLIENT_SRC, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ||
        entry.name === '__mocks__' ||
        entry.name === 'node_modules'
        ? []
        : sourceFiles(path);
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const ALL_SOURCES = [...sourceFiles(CLIENT_SRC), ...sourceFiles(join(REPO, 'mcp-server', 'src'))];
// Forward slashes on every OS, so the paths below match on Windows too.
const rel = (path: string) => relative(REPO, path).split(sep).join('/');

// A selector list sorted on the stone comes back in GemStone's order (case folded to capitals),
// not Jasper's, so queries send them unsorted and the client sorts.
const STONE_SORTS = [
  /\b(selectors|testSelectors|allSelectors|categoryNames)\s+asSortedCollection\b/,
  /\bsortedSelectorsIn:/,
];
const STONE_SORT_ALLOWED: Record<string, string> = {
  // A fingerprint of the class's methods for undo, compared with itself; never shown.
  'client/src/undo/queries/classSlotQueries.ts': 'undo snapshot',
  // Frozen; replaced by the GemStone Explorer.
  'client/src/systemBrowser.ts': 'frozen',
};

// Every place that lists methods, from the table in the issue that unified them.
const METHOD_LIST_PLACES = [
  'client/src/basicInspector/queries/basicInspectorQueries.ts',
  'client/src/enhancedInspector/queries/getEnhancedInspectorViewSpecs.ts',
  'client/src/queries/getClassEnvironments.ts',
  'client/src/gemstoneExplorer.ts',
  'client/src/queries/getMethodList.ts',
  'client/src/queries/getMethodCategories.ts',
  'client/src/commands/findMethodInClass.ts',
  'client/src/omniSearch/rank.ts',
  'client/src/debugger/breakpointTreeProvider.ts',
  'client/src/debugger/functionBreakpoints.ts',
  'client/src/queries/discoverTestMethods.ts',
  'client/src/queries/getAllSelectors.ts',
  'client/src/queries/describeClass.ts',
  'client/src/queries/grailStubReflection.ts',
  'client/src/methodResultsPicker.ts',
  'client/src/gemstoneHoverProvider.ts',
  'client/src/refactoring/safeDelete.ts',
  'client/src/mcpTools.ts',
  'mcp-server/src/tools.ts',
];

describe('method lists all sort the same way', () => {
  it('no query sorts selectors or method categories on the stone', () => {
    const offenders = ALL_SOURCES.filter((path) => !(rel(path) in STONE_SORT_ALLOWED)).flatMap(
      (path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${rel(path)}:${i + 1}` }))
          .filter(({ line }) => STONE_SORTS.some((re) => re.test(line)))
          .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each(METHOD_LIST_PLACES)('%s sorts with the shared comparators', (place) => {
    const text = readFileSync(join(REPO, place), 'utf8');
    expect(text).toMatch(/from '(\.\.\/)*(\.\/)?(client\/src\/)?methodOrder'/);
  });

  it('no place that lists methods compares selectors any other way', () => {
    const otherRules = [/\.localeCompare\(/, /new Intl\.Collator\(/];
    const offenders = METHOD_LIST_PLACES.flatMap((place) =>
      readFileSync(join(REPO, place), 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${place}:${i + 1}` }))
        .filter(({ line }) => /selector/i.test(line) && otherRules.some((re) => re.test(line)))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('only methodOrder.ts builds the collator for method names', () => {
    const builders = ALL_SOURCES.filter((path) =>
      /new Intl\.Collator\(/.test(readFileSync(path, 'utf8')),
    ).map(rel);
    // The class picker orders class names, not methods.
    expect(builders.sort()).toEqual([
      'client/src/commands/classPicker.ts',
      'client/src/methodOrder.ts',
    ]);
  });
});
