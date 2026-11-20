import { describe, it, expect, vi } from 'vitest';
import * as q from '../queries/getEnhancedInspectorViewSpecs';
import { QueryExecutor } from '../../queries/types';

// Each fetcher puts a selector the inspected object supplied into a `#'...'` literal, and refuses
// one that is not a selector before it reaches the stone.
const NOT_A_SELECTOR = "foo'; System exit";

const fetchers: [string, (execute: QueryExecutor, sel: string) => unknown, unknown][] = [
  [
    'print tab',
    (e, s) => q.fetchEnhancedInspectorPrintTabData(e, 1n, s),
    { data: null, truncated: false },
  ],
  ['text', (e, s) => q.fetchEnhancedInspectorTextData(e, 1n, s), null],
  ['forward row oop', (e, s) => q.fetchEnhancedInspectorForwardRowOop(e, 1n, s, 0), null],
  ['row oop', (e, s) => q.fetchEnhancedInspectorRowOop(e, 1n, s, 0), null],
  ['list total', (e, s) => q.fetchEnhancedInspectorListTotal(e, 1n, s), null],
  ['tree children', (e, s) => q.fetchEnhancedInspectorTreeChildren(e, 1n, s, []), null],
  ['browse location', (e, s) => q.fetchMethodBrowseLocation(e, 1n, s, false), null],
  ['method source', (e, s) => q.fetchMethodSource(e, 1n, s, false), null],
  ['list data', (e, s) => q.fetchEnhancedInspectorListData(e, 1n, s, 1, 10), null],
  ['forward list data', (e, s) => q.fetchEnhancedInspectorForwardListData(e, 1n, s, 1, 10), null],
  ['forward list total', (e, s) => q.fetchEnhancedInspectorForwardListTotal(e, 1n, s), null],
];

describe('Enhanced Inspector fetchers refuse a name that is not a selector', () => {
  it.each(fetchers)('%s asks the stone nothing', (_name, fetch, refused) => {
    const execute = vi.fn(() => '');
    expect(fetch(execute, NOT_A_SELECTOR)).toEqual(refused);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(fetchers)('%s still asks the stone about a real selector', (_name, fetch) => {
    const execute = vi.fn(() => '');
    fetch(execute, 'gtItemsFor:');
    expect(execute).toHaveBeenCalled();
  });
});
