// Shared test helper: run the production discover-all fragment and return one
// row per discovered TestCase subclass — the exact class set the no-args path of
// runFailingTests feeds to `suite run`.
//
// Exercising the fragment directly lets the round-2 (compiles) and round-5
// (deduped + abstract-free) regressions be tested WITHOUT running the entire
// image's SUnit suite. That full run is the wrong tool for an integration test: it's
// unbounded, grows as the image gains tests, and — because the GCI executor is a
// synchronous blocking call — can't be interrupted by a vitest timeout, so a
// single slow or blocking image test hangs the whole run.

import { DISCOVER_ALL_TEST_CLASSES } from '../runFailingTests';
import { splitLines } from '../util';
import { QueryExecutor } from '../types';

/** One discovered TestCase subclass: its name and whether it is abstract. */
export type DiscoveredTestClass = { name: string; isAbstract: boolean };

export function discoverAllTestClasses(exec: QueryExecutor): DiscoveredTestClass[] {
  const code = `| classes ws |
classes := ${DISCOVER_ALL_TEST_CLASSES}.
ws := WriteStream on: Unicode7 new.
classes do: [:c |
  ws nextPutAll: c name; tab; nextPutAll: c isAbstract printString; lf].
ws contents encodeAsUTF8`;
  return splitLines(exec(code)).map((line) => {
    const [name, isAbstract] = line.split('\t');
    return { name: name || '', isAbstract: isAbstract === 'true' };
  });
}
