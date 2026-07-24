import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';
import { TestRunResult } from './runTestMethod';

// Per-message printString cap. Single-method runs use 4096 because there's
// only one entry; batched runs across many TestCases need a tighter cap to
// stay under MAX_RESULT (256KB) when many tests fail at once. 1024 chars
// per entry leaves headroom for ~250 failures in a single round trip.
const MAX_MSG = 1024;

// Hard cap on how many TestCase subclasses a single call will run. The GCI
// executor is a *synchronous, blocking* call (see McpSession / queryHarness):
// while a doit runs, nothing else on that session can proceed. Running an
// unbounded suite — most dangerously the no-args discover-all path, which on a
// full image resolves to hundreds of base-library TestCases — blocks the
// session for minutes and wedges outright if any single test hangs. So we
// refuse oversized selections in Smalltalk before any suite runs and tell the
// caller to narrow the scope. A typical project's own test set is well under
// this; "run literally everything" is the footgun, not a real workflow.
export const MAX_RUN_CLASSES = 100;

// Run SUnit suites and return only the failed/errored results — the agent
// equivalent of `run_tests.sh | grep -A20 'Test failures:'`.
//
// Class selection precedence: explicit `classNames` wins; otherwise a
// `classNamePattern` (GemStone glob, `*` matches any chars) filters the
// discovered TestCase subclasses; otherwise every TestCase subclass in the
// user's symbolList is run. With explicit classNames, missing names are
// skipped silently rather than aborting the run.
//
// Whatever the path, if the selection resolves to more than MAX_RUN_CLASSES
// classes the call raises before running anything (the blocking-call guard —
// see MAX_RUN_CLASSES). The no-args path on a full image always trips this, so
// in practice "run everything" must be narrowed with a pattern.
//
// Single round-trip by design: iteration happens in Smalltalk so an N-class
// invocation is one GCI call, not N.
export function runFailingTests(
  execute: QueryExecutor,
  classNames?: string[],
  classNamePattern?: string,
): TestRunResult[] {
  let classesExpr: string;
  if (classNames && classNames.length > 0) {
    classesExpr = buildExplicitClassList(classNames);
  } else if (classNamePattern) {
    classesExpr = buildPatternFilter(classNamePattern);
  } else {
    classesExpr = DISCOVER_ALL_TEST_CLASSES;
  }

  // `result failures` and `result errors` contain the TestCase instances
  // themselves (only `testSelector` ivar) — verified via probe. Don't send
  // `t testCase`: the wrappers don't respond to it, and a real failure
  // would DNU. Use `t class name` / `t selector` directly.
  //
  // Round-2 enhancement: re-run each failing/erroring test with our own
  // AbstractException handler to capture the real messageText. Without this
  // the message column is just `t printString` — the SUnit debug recipe
  // ("ClassTestCase debug: #testFooBar"), which says *which* test failed
  // but nothing about *why*. Re-running doubles the cost for failing tests
  // only; a project where most tests pass barely notices. Iteration stays
  // in Smalltalk so it remains one GCI round-trip.
  //
  // Build the entire output through a String-class WriteStream (which
  // widens to Unicode16 transparently if a captured messageText carries
  // non-ASCII codepoints), cap by character count, then convert to Utf8
  // once at the boundary. See python.ts for the full encoding rationale —
  // both prior misfires (round-2 Unicode16 leak, round-3 Utf8 immutability)
  // came from treating a transfer protocol as if it were storage.
  const code = `| ws classes captureMessage |
classes := ${classesExpr}.
classes size > ${MAX_RUN_CLASSES} ifTrue: [
  ^Error signal: 'runFailingTests: ', classes size printString,
    ' test classes selected — too many to run in one blocking call (limit ${MAX_RUN_CLASSES}). ',
    'Narrow the run with classNamePattern (e.g. ''MyApp*'') or pass explicit classNames.'].
captureMessage := [:t |
  | captured |
  captured := nil.
  [t setUp.
   t perform: t selector.
   t tearDown] on: AbstractException do: [:e | captured := e].
  captured isNil
    ifTrue: ['(no exception on re-run)']
    ifFalse: [
      | inner s |
      inner := WriteStream on: Unicode7 new.
      inner nextPutAll: captured class name asString.
      inner nextPutAll: ': '.
      inner nextPutAll: captured messageText asString.
      s := inner contents.
      "Cap before transcoding so the cap is character-count, not byte-count."
      s copyFrom: 1 to: (s size min: ${MAX_MSG})]].
ws := WriteStream on: Unicode7 new.
classes do: [:cls |
  | result |
  result := cls suite run.
  result failures do: [:t |
    ws nextPutAll: t class name; tab;
      nextPutAll: t selector; tab;
      nextPutAll: 'failed'; tab;
      nextPutAll: (captureMessage value: t); lf].
  result errors do: [:e |
    ws nextPutAll: e class name; tab;
      nextPutAll: e selector; tab;
      nextPutAll: 'error'; tab;
      nextPutAll: (captureMessage value: e); lf]].
ws contents encodeAsUTF8`;
  const data = execute(code);
  return splitLines(data).map((line) => {
    const parts = line.split('\t');
    return {
      className: parts[0] || '',
      selector: parts[1] || '',
      status: (parts[2] || 'error') as TestRunResult['status'],
      message: parts[3] || '',
      durationMs: 0,
    };
  });
}

// Walk the user's symbolList for every concrete TestCase subclass (excluding
// TestCase itself and any abstract intermediate classes), deduped via
// IdentitySet so a class registered in two dicts is run only once.
//
// Why we skip abstract classes: an abstract TestCase's `suite` cascades into
// its subclasses' suites (the SUnit "abstract test class" idiom). If we
// also include those leaf subclasses directly, every test under an abstract
// parent runs twice — round-5 reported 45 duplicate (className, selector)
// pairs out of 99 unique, all traceable to the two abstract parents on the
// probe stone. Skipping `isAbstract` here lets the leaves' own suites pick
// up inherited tests once, no duplicates.
//
// The fragment is wrapped as `[| ... | ...] value` because it gets substituted
// into `classes := <expr>` — Smalltalk does not allow temp declarations in
// expression position. Without the wrap, the no-args call path produced a
// CompileError "expected a primary expression" before any test could run.
export const DISCOVER_ALL_TEST_CLASSES = `[| sl seen list |
sl := System myUserProfile symbolList.
seen := IdentitySet new.
list := OrderedCollection new.
sl do: [:dict |
  dict valuesDo: [:v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [v isAbstract not
      and: [(seen includes: v) not]]]])
        ifTrue: [seen add: v. list add: v]]].
list] value`;

// Explicit-list path: build an OrderedCollection at runtime, doing each
// lookup separately so a typo doesn't blow up the whole run. Anything that
// resolves to nil (missing class) is filtered out before the suite runs.
function buildExplicitClassList(classNames: string[]): string {
  const adds = classNames
    .map((n) => `add: (System myUserProfile symbolList objectNamed: #'${escapeString(n)}');`)
    .join('\n  ');
  return `((OrderedCollection new
  ${adds}
  yourself) reject: [:c | c isNil])`;
}

// Pattern path: same symbolList walk as DISCOVER_ALL_TEST_CLASSES, but
// gated by `(v name matchPattern: <pattern-array>)`. matchPattern: is the
// public glob primitive on CharacterCollection (the underlying sequence
// is `findPattern:startingAt:`); it takes an Array of literal
// CharacterCollections alternating with `$*` (any chars) or `$?` (single
// char). E.g. the glob `Bytes*TestCase` becomes the Array `#('Bytes' $*
// 'TestCase')`.
//
// Why we don't use `sunitMatch:` (which also globs): it's an SUnit
// extension — only present when SUnit's been loaded. matchPattern: is on
// the CharacterCollection base class, so the query works in any session.
//
// Why we don't use bare `match:`: it's a case-sensitive *prefix* matcher
// in GemStone (`receiver startsWith: arg`), not a glob. Caught by the
// gci/ smoke-test suite when "expect(code).toContain('match:')" passed
// while every live invocation returned false.
//
// Abstract classes are still allowed under classNamePattern so the agent
// can target an abstract parent on purpose ("`PythonTestCase`'s entire
// cascaded suite, please"). The discover-all path is the one that
// auto-skips them to avoid double-running.
function buildPatternFilter(pattern: string): string {
  const patternArray = globToPatternArray(pattern);
  return `[| sl seen list |
sl := System myUserProfile symbolList.
seen := IdentitySet new.
list := OrderedCollection new.
sl do: [:dict |
  dict valuesDo: [:v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(seen includes: v) not
      and: [v name matchPattern: ${patternArray}]]]])
        ifTrue: [seen add: v. list add: v]]].
list] value`;
}

// Translate a glob like `Bytes*TestCase` to the Smalltalk literal-Array
// source matchPattern: expects: alternating literal CharacterCollections
// and the `$*` / `$?` Character wildcards. Single quotes in the literal
// segments are doubled per the standard Smalltalk-string escape.
//
// Examples:
//   "Bytes*TestCase"  →  #('Bytes' $* 'TestCase')
//   "*Test"           →  #($* 'Test')
//   "Foo"             →  #('Foo')                  (matches exactly)
//   "*"               →  #($*)                     (matches anything)
export function globToPatternArray(glob: string): string {
  const parts: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.length > 0) {
      parts.push(`'${escapeString(buf)}'`);
      buf = '';
    }
  };
  for (const ch of glob) {
    if (ch === '*') {
      flush();
      parts.push('$*');
    } else if (ch === '?') {
      flush();
      parts.push('$?');
    } else {
      buf += ch;
    }
  }
  flush();
  return `#(${parts.join(' ')})`;
}
