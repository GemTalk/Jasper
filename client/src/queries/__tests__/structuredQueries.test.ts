import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getDictionaryEntries } from '../getDictionaryEntries';
import { getGlobalsForDictionary } from '../getGlobalsForDictionary';
import { getAllClassNames } from '../getAllClassNames';
import { getClassEnvironments } from '../getClassEnvironments';
import { getBaseMethodSource } from '../getBaseMethodSource';
import { getClassHierarchy } from '../getClassHierarchy';
import { getMethodList } from '../getMethodList';
import { getStepPointSelectorRanges } from '../getStepPointSelectorRanges';
import { runFailingTests, globToPatternArray } from '../runFailingTests';
import { describeTestFailure } from '../describeTestFailure';
import { evalPython, evalPythonInScope, resetPythonScope, compilePython } from '../python';
import { getGrailStubReflection, parseGrailStubReflection } from '../grailStubReflection';

describe('getDictionaryEntries', () => {
  it('parses class (1) and global (0) rows', () => {
    const raw = '1\taccessing\tArray\n0\t\tMyVar\n';
    const results = getDictionaryEntries(
      vi.fn<QueryExecutor>(() => raw),
      1,
    );
    expect(results).toEqual([
      { isClass: true, category: 'accessing', name: 'Array' },
      { isClass: false, category: '', name: 'MyVar' },
    ]);
  });

  it('skips entries whose name is empty', () => {
    const raw = '1\taccessing\t\n1\taccessing\tFoo\n';
    const results = getDictionaryEntries(
      vi.fn<QueryExecutor>(() => raw),
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Foo');
  });
});

describe('getGlobalsForDictionary', () => {
  it('preserves tabs inside the value field', () => {
    const raw = 'X\tArray\tvalue\twith\ttabs\n';
    const results = getGlobalsForDictionary(
      vi.fn<QueryExecutor>(() => raw),
      1,
    );
    expect(results[0].value).toBe('value\twith\ttabs');
  });

  it('skips lines without at least two tabs', () => {
    const raw = 'bogus\noneTab\tonly\nok\tArray\tvalue\n';
    const results = getGlobalsForDictionary(
      vi.fn<QueryExecutor>(() => raw),
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('ok');
  });
});

describe('getAllClassNames', () => {
  it('parses dictIndex/dictName/className rows', () => {
    const raw = '1\tGlobals\tArray\n2\tUserGlobals\tMyClass\n';
    const results = getAllClassNames(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      { dictIndex: 2, dictName: 'UserGlobals', className: 'MyClass' },
    ]);
  });

  it('does not de-duplicate by object identity, so aliases of one class each appear', () => {
    // The same class object registered under two different dictionary/key pairs
    // (Python>object and Globals>Object both resolve to Object) must yield two
    // rows — one per registration.
    const raw = '1\tPython\tobject\n9\tGlobals\tObject\n';
    const results = getAllClassNames(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      { dictIndex: 1, dictName: 'Python', className: 'object' },
      { dictIndex: 9, dictName: 'Globals', className: 'Object' },
    ]);
  });

  it('lists two keys aliased to one class within the same dictionary', () => {
    // Globals>Float and Globals>FloatD are the same class object under two keys.
    const raw = '9\tGlobals\tFloat\n9\tGlobals\tFloatD\n';
    const results = getAllClassNames(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      { dictIndex: 9, dictName: 'Globals', className: 'Float' },
      { dictIndex: 9, dictName: 'Globals', className: 'FloatD' },
    ]);
  });

  it('emits a query that lists every (dictionary, key) pair without an identity filter', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getAllClassNames(execute);
    const code = execute.mock.calls[0][0];
    expect(code).not.toContain('IdentitySet');
    expect(code).not.toContain('seen');
  });
});

describe('getClassEnvironments', () => {
  it('detects class side via " class" suffix on receiver name', () => {
    // Each selector token carries a fixed 2-digit leading flag byte (00..15).
    const raw =
      'Array class\t0\tinstance creation\t00new\t00with:\n' + 'Array\t0\taccessing\t00size\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Array',
      0,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      isMeta: true,
      envId: 0,
      category: 'instance creation',
    });
    expect(results[0].selectors).toEqual(['new', 'with:']);
    expect(results[1].isMeta).toBe(false);
  });

  it('parses the per-selector override bitmask and strips its prefix', () => {
    // 1 = overrides super (▲), 2 = overridden in subclass (▼), 3 = both.
    const raw = 'Array\t0\taccessing\t01at:\t02size\t03printOn:\t00name\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Array',
      0,
    );
    expect(results[0].selectors).toEqual(['at:', 'name', 'printOn:', 'size']);
    expect(results[0].methodOverrideBits).toEqual({ 'at:': 1, size: 2, 'printOn:': 3 });
    expect(results[0].sessionMethodBits).toEqual({});
  });

  it('omits zero-bit (neither overrides nor overridden) selectors from the map', () => {
    const raw = 'Array\t0\taccessing\t00a\t00b\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Array',
      0,
    );
    expect(results[0].selectors).toEqual(['a', 'b']);
    expect(results[0].methodOverrideBits).toEqual({});
  });

  it('records override bits on the class side too', () => {
    const raw = 'Array class\t0\tinstance creation\t03new\t01basicNew\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Array',
      0,
    );
    expect(results[0].isMeta).toBe(true);
    expect(results[0].methodOverrideBits).toEqual({ new: 3, basicNew: 1 });
  });

  it('parses the session-method flag: bit 4 = extension, bit 8 = override', () => {
    // 04 = session extension (transient only), 12 = session override (4+8,
    // also in persistent dict). 00 = ordinary persistent method.
    const raw = 'Object\t0\t*mypkg\t04sessionExt\t12isVowel\t00hash\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Object',
      0,
    );
    expect(results[0].selectors).toEqual(['hash', 'isVowel', 'sessionExt']);
    expect(results[0].sessionMethodBits).toEqual({ sessionExt: 1, isVowel: 2 });
    expect(results[0].methodOverrideBits).toEqual({});
  });

  it('records session and override bits independently when they co-occur', () => {
    // 05 = overrides super (1) + session extension (4); a session method may
    // also shadow a superclass impl. Both maps must carry their own bits.
    const raw = 'Object\t0\t*mypkg\t05foo\t14bar\n';
    const results = getClassEnvironments(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Object',
      0,
    );
    // 14 = overridden-in-subclass (2) + session override (4+8) -> not asserted
    // on override map beyond bit 2; session map sees an override.
    expect(results[0].methodOverrideBits).toEqual({ foo: 1, bar: 2 });
    expect(results[0].sessionMethodBits).toEqual({ foo: 1, bar: 2 });
  });

  it('emits the session-detection primitives (transient/persistent dicts, at:otherwise:)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassEnvironments(execute, 1, 'Object', 0);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('transientMethodDictForEnv:');
    expect(code).toContain('persistentMethodDictForEnv:');
    expect(code).toContain('at: each otherwise: nil'); // NOT includesKey: on the transient dict
  });

  it('embeds dictIndex, escaped class name, and maxEnv', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassEnvironments(execute, 3, "Foo'Bar", 2);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 3');
    expect(code).toContain("#'Foo''Bar'");
    expect(code).toContain('envs := 2');
  });

  it('detects overrides via the full chain, not the immediate neighbour', () => {
    // Locks in the chain-walking primitives so a regression to a single-level
    // check (or back to lookupSelector:) is caught here. The actual depth of
    // detection is exercised by a live-GCI smoke test, not this unit test.
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassEnvironments(execute, 1, 'Array', 0);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('whichClassIncludesSelector:'); // walks all ancestors
    expect(code).toContain('allSubclasses'); // walks all descendants
    expect(code).not.toContain('lookupSelector:'); // the rejected approach
  });
});

describe('getBaseMethodSource', () => {
  it('reads the persistent (base) method, not the merged/session view', () => {
    const execute = vi.fn<QueryExecutor>(() => 'isVowel\n  ^ base');
    getBaseMethodSource(execute, 'Character', false, 'isVowel', 0);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('persistentMethodDictForEnv: 0');
    expect(code).toContain("at: #'isVowel' otherwise: nil");
    expect(code).not.toContain('compiledMethodAt:'); // that would return the override
  });

  it('targets the metaclass for a class-side selector', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getBaseMethodSource(execute, 'Character', true, 'foo', 0);
    expect(execute.mock.calls[0][0]).toContain('Character class');
  });

  it('threads a non-zero environment id into the persistent lookup', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getBaseMethodSource(execute, 'Character', false, 'foo', 2);
    expect(execute.mock.calls[0][0]).toContain('persistentMethodDictForEnv: 2');
  });

  it('emits ASCII-only source (3.6.x miscompiles non-ASCII: ComStrmSetCursor)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getBaseMethodSource(execute, 'Character', false, 'isVowel', 0);

    const code = execute.mock.calls[0][0];
    // eslint-disable-next-line no-control-regex -- \x00-\x7F is the intentional ASCII range, not a stray control char
    const asciiOnly = /^[\x00-\x7F]*$/;
    expect(asciiOnly.test(code)).toBe(true);
  });
});

describe('getClassHierarchy', () => {
  it('preserves superclass/self/subclass order from Smalltalk', () => {
    const raw = 'Globals\tObject\tsuperclass\nGlobals\tArray\tself\nGlobals\tFoo\tsubclass\n';
    const results = getClassHierarchy(
      vi.fn<QueryExecutor>(() => raw),
      'Array',
    );
    expect(results.map((r) => r.kind)).toEqual(['superclass', 'self', 'subclass']);
  });

  // ClassOrganizer>>allSuperclassesOf: returns root-first
  // ([Object, Collection, SequenceableCollection, CharacterCollection]),
  // which is the order we want to render — Object at indent 0, the
  // immediate parent right above the selected class. The earlier query
  // sent reverseDo: to that collection, flipping it leaf-first and
  // putting Object at the deepest indent (the screenshot in the bug
  // report). Pin `do:` in / `reverseDo:` out so the regression can't
  // sneak back.
  it('iterates superclasses with do: (root-first), not reverseDo:', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    getClassHierarchy(exec, 'String');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('supers do: [:each |');
    expect(code).not.toContain('supers reverseDo:');
  });
});

describe('getMethodList', () => {
  it('parses instance (0) and class (1) rows', () => {
    const raw = '0\taccessing\tsize\n1\tinstance creation\tnew\n';
    const results = getMethodList(
      vi.fn<QueryExecutor>(() => raw),
      'Array',
    );
    expect(results).toEqual([
      { isMeta: false, category: 'accessing', selector: 'size' },
      { isMeta: true, category: 'instance creation', selector: 'new' },
    ]);
  });

  it('skips lines with fewer than 3 tab-separated fields', () => {
    const results = getMethodList(
      vi.fn<QueryExecutor>(() => 'incomplete\tonly\n0\tcat\tsel\n'),
      'Array',
    );
    expect(results).toHaveLength(1);
  });
});

describe('getStepPointSelectorRanges', () => {
  it('parses step point info with 0-based selectorOffset', () => {
    const raw = '1\t0\t3\tfoo\n2\t5\t4\tbar:\n';
    const results = getStepPointSelectorRanges(
      vi.fn<QueryExecutor>(() => raw),
      'X',
      false,
      'y',
    );
    expect(results).toEqual([
      { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 4, selectorText: 'bar:' },
    ]);
  });
});

describe('runFailingTests', () => {
  it('parses class\\tselector\\tstatus\\tmessage rows into TestRunResult[]', () => {
    const raw =
      'MyTest\ttestBad\tfailed\texpected 1 got 2\nOther\ttestBoom\terror\tdivision by zero\n';
    const results = runFailingTests(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      {
        className: 'MyTest',
        selector: 'testBad',
        status: 'failed',
        message: 'expected 1 got 2',
        durationMs: 0,
      },
      {
        className: 'Other',
        selector: 'testBoom',
        status: 'error',
        message: 'division by zero',
        durationMs: 0,
      },
    ]);
  });

  // No classNames → discover-all path. The Smalltalk snippet must walk the
  // user's symbolList for TestCase subclasses (excluding TestCase itself);
  // the explicit-list-only `objectNamed:` and `reject:` constructs must NOT
  // appear, otherwise the path got swapped.
  it('uses the discover-all path when no classNames are given', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toContain('symbolList');
    expect(code).toContain('isSubclassOf: TestCase');
    expect(code).toContain('IdentitySet');
    expect(code).not.toContain('objectNamed:');
    expect(code).not.toContain('reject: [:c | c isNil]');
  });

  // With names → explicit-list path. Each name is resolved separately so a
  // single typo doesn't blow up the whole run; missing names get filtered
  // out before the suite executes.
  it('uses the explicit-list path when classNames are given, building the list at runtime', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ['ArrayTest', 'StringTest']);
    const code = exec.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'ArrayTest'");
    expect(code).toContain("objectNamed: #'StringTest'");
    expect(code).toContain('reject: [:c | c isNil]');
  });

  it('escapes single quotes in classNames', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ["it's"]);
    const code = exec.mock.calls[0][0];
    expect(code).toContain("#'it''s'");
  });

  it('returns [] when nothing failed', () => {
    expect(runFailingTests(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });

  // Bug guard: probe of GemStone's SUnit revealed that `result failures` and
  // `result errors` contain the TestCase instances themselves (only
  // `testSelector` ivar) — they don't respond to `#testCase`. Sending it
  // would silently DNU on real failures. The query must use direct
  // accessors (`each class name` / `each selector`), same as the passed
  // branch already does.
  it('does not send #testCase to failure/error wrappers', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).not.toMatch(/testCase\s+class\s+name/);
    expect(code).not.toMatch(/testCase\s+selector/);
  });

  // Per-message cap: 1024 chars in the batched runner so a worst case of
  // ~250 failing tests still fits under the 256KB MAX_RESULT. The cap now
  // applies to the captured `<exceptionClass>: <messageText>` string from
  // the per-failure re-run (round-2 messageText capture) rather than the
  // old SUnit-debug-recipe printString. Lock the constant in.
  it('caps each captured message at 1024 chars to stay under MAX_RESULT', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toContain('s size min: 1024');
  });

  // Cap *mechanism*, not just the magic number: the limit must be applied
  // as a string slice, not as a bare `min:` (which returns the integer
  // size — the trim wouldn't actually happen). And the slice has to come
  // *before* the outer `encodeAsUTF8`, so 1024 is a character-count cap,
  // not a byte-count cap. Without that ordering, multi-byte codepoints in
  // a captured messageText would let the per-message footprint exceed the
  // 1024-char budget that keeps total output under MAX_RESULT.
  it('clips each captured message via copyFrom:to: before the boundary encode', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];

    // Full slice form must be present — the cap is a substring, not just a size calc.
    expect(code).toMatch(/s copyFrom: 1 to: \(s size min: 1024\)/);

    // The clip lives inside captureMessage (per-message), and runs against the
    // internal Unicode7-backed buffer so 1024 counts characters. The boundary
    // encodeAsUTF8 is the last thing applied to the *outer* ws contents.
    const clipIdx = code.indexOf('copyFrom: 1 to:');
    const encodeIdx = code.indexOf('ws contents encodeAsUTF8');
    expect(clipIdx).toBeGreaterThan(-1);
    expect(encodeIdx).toBeGreaterThan(clipIdx);
  });

  // Round-2 fix: the no-args path (DISCOVER_ALL) had `| sl seen list |` temp
  // declarations substituted into `classes := <expr>`, which is a Smalltalk
  // syntax error. The block wrap closes around the temps so the expression
  // is a valid value-producing form.
  it('wraps DISCOVER_ALL in a block so its temps do not collide with the outer assignment', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toMatch(/classes := \[\| sl seen list \|/);
    expect(code).toContain('] value');
  });

  // Round-2 enhancement: the message column should carry exception class
  // + actual messageText (captured by re-running each failing test with
  // its own AbstractException handler), not the SUnit debug recipe.
  it('captures exception class and messageText per failing test via re-run', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toContain('on: AbstractException');
    expect(code).toContain('t setUp');
    expect(code).toContain('t perform: t selector');
    expect(code).toContain('t tearDown');
    expect(code).toContain('captured class name');
    expect(code).toContain('captured messageText');
  });

  // Round-3 (revised): build through a String-class WriteStream (which
  // widens transparently from Unicode7 to Unicode16 / Unicode32 as needed
  // for non-ASCII codepoints), then call `encodeAsUTF8` at the boundary to
  // produce the transfer-protocol bytes GCI hands back. Pins the boundary
  // call so neither earlier failure mode (Unicode16 leak via `, ` widen,
  // or Utf8 buffer-growth `at:put:`) can recur.
  it('builds the output as an internal String, encodeAsUTF8 at the boundary', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toContain('WriteStream on: Unicode7 new');
    expect(code).toMatch(/ws contents encodeAsUTF8/);
    // Negative guards: the round-2 Utf8 buffer and the round-3 lossy ASCII
    // gating must both stay out — they were misreads of GemStone's
    // storage/transfer encoding split.
    expect(code).not.toContain('WriteStream on: Utf8 new');
    expect(code).not.toContain('asInteger < 128');
  });

  // classNamePattern path: glob is parsed server-side into the literal
  // Array form CharacterCollection>>matchPattern: expects, alternating
  // literal Strings with `$*` / `$?` Characters. matchPattern: is the
  // public primitive on CharacterCollection — works without SUnit
  // loaded, unlike the SUnit-only `sunitMatch:` previously used.
  it('uses matchPattern: with a parsed Array when classNamePattern is given', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, undefined, 'Bytes*TestCase');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('isSubclassOf: TestCase');
    // The exact parsed form — pinning the literal Array source guards
    // against the parser regressing (e.g. losing the suffix segment).
    expect(code).toContain("v name matchPattern: #('Bytes' $* 'TestCase')");
    // Negative guards: bare match: is prefix-only; sunitMatch: works but
    // requires SUnit; both must stay out.
    expect(code).not.toMatch(/pattern match:/);
    expect(code).not.toContain('sunitMatch:');
  });

  it('explicit classNames wins over classNamePattern (precedence)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ['ArrayTest'], 'Bytes*TestCase');
    const code = exec.mock.calls[0][0];
    // classNames path runs (no pattern matching in the snippet).
    expect(code).toContain("objectNamed: #'ArrayTest'");
    expect(code).not.toContain('matchPattern:');
  });

  // Round-5 fix: an SUnit abstract TestCase's `suite` cascades into its
  // subclasses, so including both the abstract parent AND its leaves in
  // the discovery list runs every leaf test twice. Skipping abstracts in
  // discover-all keeps coverage (leaves' suites pull inherited tests
  // once) without the duplicate output.
  it('skips abstract TestCase classes in the no-args discovery walk', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][0];
    expect(code).toContain('v isAbstract not');
  });
});

describe('globToPatternArray', () => {
  // The parsed Array is what makes matchPattern: work. Lock the exact
  // shape because the agent-supplied pattern reaches the stone verbatim
  // and a parser regression silently degrades classNamePattern matching.
  it('alternates literal segments with $* / $? Characters', () => {
    expect(globToPatternArray('Bytes*TestCase')).toBe("#('Bytes' $* 'TestCase')");
    expect(globToPatternArray('*Test')).toBe("#($* 'Test')");
    expect(globToPatternArray('Test*')).toBe("#('Test' $*)");
    expect(globToPatternArray('A*B*C')).toBe("#('A' $* 'B' $* 'C')");
    expect(globToPatternArray('?ar')).toBe("#($? 'ar')");
  });

  it('handles glob-free patterns (matches the literal exactly)', () => {
    expect(globToPatternArray('Foo')).toBe("#('Foo')");
  });

  it('handles bare wildcards (matches anything / one char)', () => {
    expect(globToPatternArray('*')).toBe('#($*)');
    expect(globToPatternArray('?')).toBe('#($?)');
  });

  it('escapes single quotes in literal segments', () => {
    expect(globToPatternArray("it's*")).toBe("#('it''s' $*)");
  });
});

describe('describeTestFailure', () => {
  // The parser is line-prefixed key/value — unknown keys must be silently
  // ignored so a future Smalltalk-side addition (extra fields, GS-version
  // specific extras) doesn't crash callers.
  it('parses TestFailure-shaped output into structured details', () => {
    const raw =
      'status: failed\n' +
      'exceptionClass: TestFailure\n' +
      'errorNumber: 2751\n' +
      'messageText: Assertion failed\n' +
      'description: TestFailure: Assertion failed\n';
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => raw),
      'ArrayTest',
      'testBad',
    );
    expect(result).toEqual({
      status: 'failed',
      exceptionClass: 'TestFailure',
      errorNumber: 2751,
      messageText: 'Assertion failed',
      description: 'TestFailure: Assertion failed',
    });
  });

  it('parses MessageNotUnderstood output, including mnuReceiver and mnuSelector', () => {
    const raw =
      'status: error\n' +
      'exceptionClass: MessageNotUnderstood\n' +
      'errorNumber: 2010\n' +
      'messageText: a Object class does not understand #foo\n' +
      'description: a Object class does not understand #foo\n' +
      'mnuReceiver: Object\n' +
      'mnuSelector: foo\n';
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => raw),
      'ArrayTest',
      'testErrors',
    );
    expect(result.status).toBe('error');
    expect(result.exceptionClass).toBe('MessageNotUnderstood');
    expect(result.mnuReceiver).toBe('Object');
    expect(result.mnuSelector).toBe('foo');
  });

  it('parses passed status with no other fields', () => {
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => 'status: passed\n'),
      'X',
      'y',
    );
    expect(result.status).toBe('passed');
    expect(result.exceptionClass).toBeUndefined();
    expect(result.messageText).toBeUndefined();
  });

  // Unknown keys must not throw — required so we can extend the snippet
  // server-side without coordinating client updates.
  it('ignores unknown keys', () => {
    const raw = 'status: failed\nfutureField: whatever\nexceptionClass: TestFailure\n';
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => raw),
      'X',
      'y',
    );
    expect(result.status).toBe('failed');
    expect(result.exceptionClass).toBe('TestFailure');
  });

  // The Smalltalk side has to use AbstractException — the GS hierarchy
  // means MessageNotUnderstood escapes past Exception in some session
  // contexts. Lock this in so a future "simplification" doesn't regress.
  it('uses AbstractException for the live exception capture', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('on: AbstractException');
    expect(code).not.toMatch(/on: Exception\b/);
  });

  // Bypass SUnit's swallow-the-exception runner.
  it('runs setUp / perform / tearDown manually rather than going through TestCase>>run', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('tc setUp');
    expect(code).toContain('tc perform:');
    expect(code).toContain('tc tearDown');
    expect(code).not.toMatch(/tc run\b/);
  });

  it('escapes single quotes in className and selector', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, "Foo'Bar", "test'X");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("Foo''Bar");
    expect(code).toContain("test''X");
  });

  // Stack capture path: the gem-level config GemExceptionSignalCapturesStack
  // controls whether AbstractException's gsStack is populated at signal time.
  // Without toggling it on, stackReport returns nil even on a live exception.
  it('toggles GemExceptionSignalCapturesStack around the run and restores after', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][0];

    // Saved before, set true during, restored in ensure: after.
    expect(code).toContain('System gemConfigurationAt: #GemExceptionSignalCapturesStack');
    expect(code).toContain('gemConfigurationAt: #GemExceptionSignalCapturesStack put: true');
    expect(code).toContain('gemConfigurationAt: #GemExceptionSignalCapturesStack put: oldStackCfg');
    expect(code).toContain('ensure:');
  });

  // The sentinel keeps multi-line stack content separate from the
  // line-prefixed key/value section. Without it, frame newlines would split
  // into bogus key/value pairs and the parser would lose the stack.
  it('parses stackReport that follows the sentinel as one verbatim block', () => {
    const raw =
      'status: failed\n' +
      'exceptionClass: TestFailure\n' +
      'errorNumber: 2751\n' +
      'messageText: Assertion failed\n' +
      'description: TestFailure: Assertion failed\n' +
      '--- stackReport ---\n' +
      'TestFailure (AbstractException) >> signal: @3 line 7  [GsNMethod 3523841]\n' +
      'TestFailure class (AbstractException class) >> signal: @3 line 4  [GsNMethod 3803137]\n' +
      'JasperProbeTest >> testFails @3 line 1  [GsNMethod 1236251649]\n';
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => raw),
      'X',
      'y',
    );
    expect(result.status).toBe('failed');
    expect(result.exceptionClass).toBe('TestFailure');
    expect(result.stackReport).toContain('TestFailure (AbstractException) >> signal:');
    expect(result.stackReport).toContain('JasperProbeTest >> testFails');
    // Frame separator newlines must survive intact.
    expect((result.stackReport || '').split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('omits stackReport when the sentinel is absent (e.g. config rejected)', () => {
    const raw = 'status: failed\nexceptionClass: TestFailure\nmessageText: Assertion failed\n';
    const result = describeTestFailure(
      vi.fn<QueryExecutor>(() => raw),
      'X',
      'y',
    );
    expect(result.stackReport).toBeUndefined();
  });

  // Stack cap: 16384 chars in the Smalltalk side keeps the largest
  // realistic trace under MAX_RESULT (256KB) while leaving plenty of
  // room for the scalar fields. Lock it in so a future bump doesn't
  // accidentally produce truncated output that's hard to diagnose.
  it('caps stackReport at 16384 chars', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'X', 'y');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('size min: 16384');
  });
});

describe('python (Grail) queries', () => {
  // Detection: a missing ModuleAst class is the signal that Grail isn't
  // installed. Direct reference like `ModuleAst evaluateSource: ...` would
  // be a *compile-time* failure of our query source — there'd be no
  // runtime exception to catch. Resolving via objectNamed: makes the
  // dispatcher's absence a runtime nil check we can branch on.
  it('uses objectNamed: ModuleAst rather than a direct class reference', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'ModuleAst'");
    expect(code).toContain('dispatcher isNil');
  });

  it('emits a graceful "Grail not detected" hint as the nil-branch result', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('Grail (GemStone-Python) not detected');
    expect(code).toContain('class ModuleAst not found');
  });

  // The dispatcher is reused across both tools — they should produce
  // identical detection scaffolding, only differing in the Grail
  // expression that runs in the ifFalse branch.
  it('eval_python uses ModuleAst evaluateSource: (returns the printed result)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'print(1+2)');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('dispatcher evaluateSource: src');
    expect(code).toContain('printString');
  });

  it('compile_python uses (ModuleAst parseSource: src) smalltalkSource', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    compilePython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('dispatcher parseSource: src');
    expect(code).toContain('smalltalkSource');
  });

  // Python source frequently contains single-quoted string literals — the
  // standard Smalltalk doubling rule must apply or the query won't parse.
  it('escapes single quotes in Python source', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, "x = 'hello'");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("''hello''");
  });

  // Stack-blowup guard: dataclass self-references and other recursive code
  // paths used to take the gem down. GemStone signals AlmostOutOfStack with
  // ~30 frames of headroom — the handler must be minimal because it runs
  // with very little stack room, so it just returns a fixed string literal.
  // It's nested *inside* the AbstractException wrapper so the cheap handler
  // intercepts before the rich-error path can fail under low stack.
  it('wraps the Grail call in an inner on: AlmostOutOfStack do:', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('on: AlmostOutOfStack');
    expect(code).toContain("'Error: AlmostOutOfStack");
    // AlmostOutOfStack must appear *before* AbstractException in the source
    // (innermost handler) so the minimal handler runs first.
    expect(code.indexOf('on: AlmostOutOfStack')).toBeLessThan(
      code.indexOf('on: AbstractException'),
    );
  });

  // Errors from Grail's compile/runtime path (SyntaxError, NameError, etc.)
  // are caught and reported inline as "Error: <class> — <messageText>" so
  // the agent gets a usable diagnostic, not a dropped tool call.
  it('wraps the Grail call in on: AbstractException do:', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('on: AbstractException');
    // Build internally with the natural String class (which widens
    // transparently for non-ASCII content), then `encodeAsUTF8` at the boundary
    // for the transfer protocol GCI expects. See the regression guards
    // below for why each prior attempt (Utf8 buffer, ASCII gating, `,`
    // concatenation) was wrong.
    expect(code).toContain('WriteStream on: Unicode7 new');
    expect(code).toContain("'Error: '");
    expect(code).toContain('result encodeAsUTF8');
  });

  // Round-2 regression guard: the eval_python error path was previously built
  // via `, ` concatenation, which widened the result to Unicode16 when
  // messageText was Unicode16 — GCI's Utf8 fetch then forwarded UTF-16LE
  // bytes raw and the agent saw `"E r r o r :   M ..."`.
  it('does not build the error string via , concatenation (UTF-16 leak guard)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).not.toMatch(/'Error: ' , e class name/);
  });

  // Round-3 regression guard: the round-2 fix `WriteStream on: Utf8 new`
  // forced UTF-8 output, but Utf8 in this GemStone is invariant —
  // growing the buffer triggers at:put: which Utf8 rejects with
  // rtErrShouldNotImplement. Every error case failed with
  // "Receiver: anUtf8(). Selector: #'at:put:'".
  it('does not write through a Utf8 stream (Utf8 immutability guard)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).not.toContain('WriteStream on: Utf8 new');
  });

  // Round-3-revised regression guard: the per-character codepoint-128 gate
  // (`ch asInteger < 128 ifTrue: [ch] ifFalse: [$?]`) was a lossy fix that
  // treated an internal storage detail as if it were a transfer-encoding
  // problem. The right answer is `encodeAsUTF8` at the boundary; this test pins
  // the absence of the regressed approach.
  it('does not use per-char ASCII gating with `?` substitution', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][0];
    expect(code).not.toContain('asInteger < 128');
    expect(code).not.toContain('ifFalse: [$?]');
  });

  it('returns the executor result verbatim — no parsing on the JS side', () => {
    const result = evalPython(
      vi.fn<QueryExecutor>(() => '3'),
      '1 + 2',
    );
    expect(result).toBe('3');
  });

  // Real-world Grail usage embeds `def`/`for`/`if` blocks inside a single
  // eval_python call — Round-5 verified this end-to-end by hand
  // (`def factorial(n): ...; factorial(5) → 120`). The escape rule we apply
  // (only double single quotes) lets newlines pass through verbatim, which
  // is what Smalltalk wants: real LFs inside a string literal are valid and
  // round-trip as themselves. The regression class this guards against is a
  // future "improvement" to escapeString that converts `\n` into the
  // two-character sequence `\` + `n` (which Smalltalk would not interpret
  // as a newline — the Python source would then be received as one line and
  // SyntaxError every time).
  it('embeds multi-line Python source verbatim, with real newlines inside the literal', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    const source = 'def f(n):\n    return n * 2\nf(5)';
    evalPython(exec, source);
    const code = exec.mock.calls[0][0];

    // The full multi-line body appears inside the Smalltalk string literal
    // with its actual newlines preserved.
    expect(code).toContain(`src := '${source}'.`);
    // Negative guard: no backslash-escape mutation of the newline characters.
    expect(code).not.toContain('def f(n):\\n');
    // The query as a whole carries the embedded LFs through — the literal
    // sits across multiple lines in the generated source.
    expect(code.split('\n').length).toBeGreaterThanOrEqual(source.split('\n').length);
  });
});

describe('python (Grail) scoped queries — notebook kernel', () => {
  // REPL contract: ModuleAst evaluateSource:usingModuleScope: persists
  // user-defined globals across calls that pass the *same* SymbolDictionary.
  // The dictionary lives in SessionTemps keyed by scopeId so successive GCI
  // executes (notebook cells) reuse it.
  it('evaluates through evaluateSource:usingModuleScope: with a persistent scope', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPythonInScope(exec, 'x = 1', 'file:///nb/a.ipynb');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('dispatcher evaluateSource: src usingModuleScope: scope');
    expect(code).toContain("SessionTemps current at: #'__vscGrailScopes'");
    expect(code).toContain("at: 'file:///nb/a.ipynb' ifAbsentPut: [SymbolDictionary new]");
  });

  // Scoped eval must keep the same protection scaffolding as one-shot eval:
  // Grail-absence hint, cheap AlmostOutOfStack handler innermost, rich
  // AbstractException handler outermost, UTF-8 transcoding at the boundary.
  it('keeps the detection, stack-guard, and encoding scaffolding', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPythonInScope(exec, 'x = 1', 'nb');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'ModuleAst'");
    expect(code).toContain('Grail (GemStone-Python) not detected');
    expect(code.indexOf('on: AlmostOutOfStack')).toBeLessThan(
      code.indexOf('on: AbstractException'),
    );
    expect(code).toContain('result encodeAsUTF8');
  });

  // scopeId is interpolated into a Smalltalk string literal — the same
  // single-quote doubling rule as the Python source applies (a notebook URI
  // can contain quotes via its path).
  it('escapes single quotes in both source and scopeId', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPythonInScope(exec, "x = 'hi'", "file:///o'brien/nb.ipynb");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("''hi''");
    expect(code).toContain("o''brien");
  });

  it('returns the executor result verbatim — no parsing on the JS side', () => {
    const result = evalPythonInScope(
      vi.fn<QueryExecutor>(() => '3'),
      'x + 2',
      'nb',
    );
    expect(result).toBe('3');
  });

  // Reset works without Grail: the scope registry is plain GemStone
  // (Dictionary / SymbolDictionary), so no ModuleAst lookup belongs here.
  it('resetPythonScope removes only the given scope and needs no dispatcher', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    resetPythonScope(exec, 'file:///nb/a.ipynb');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("removeKey: 'file:///nb/a.ipynb' ifAbsent: []");
    expect(code).toContain("SessionTemps current at: #'__vscGrailScopes'");
    expect(code).not.toContain('ModuleAst');
    expect(code).toContain('encodeAsUTF8');
  });

  it('resetPythonScope escapes single quotes in scopeId', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    resetPythonScope(exec, "o'brien");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("removeKey: 'o''brien'");
  });
});

describe('getGrailStubReflection', () => {
  it('parses superclass, instance variables with accessor flags, methods, and comment', () => {
    const raw =
      'SUPER\tObject\n' +
      'IVAR\tbalance\t1\t1\n' +
      'IVAR\towner\t1\t0\n' +
      'METHOD\ti\taccessing\tbalance\n' +
      'METHOD\tc\tinstance creation\tnew\n' +
      '===COMMENT===\n' +
      'An account.';

    const result = parseGrailStubReflection(raw);

    expect(result).toEqual({
      found: true,
      superclass: 'Object',
      comment: 'An account.',
      instVars: [
        { name: 'balance', hasGetter: true, hasSetter: true },
        { name: 'owner', hasGetter: true, hasSetter: false },
      ],
      methods: [
        { side: 'instance', category: 'accessing', selector: 'balance' },
        { side: 'class', category: 'instance creation', selector: 'new' },
      ],
    });
  });

  it('preserves a multi-line class comment verbatim', () => {
    const raw = 'SUPER\tObject\n===COMMENT===\nfirst line\nsecond line';

    const result = parseGrailStubReflection(raw);

    expect(result.comment).toBe('first line\nsecond line');
  });

  it('reports a class that could not be resolved as not found', () => {
    const result = parseGrailStubReflection('MISSING');

    expect(result.found).toBe(false);
    expect(result.instVars).toEqual([]);
  });

  it('treats an empty comment section as no comment', () => {
    const raw = 'SUPER\tObject\n===COMMENT===\n';

    const result = parseGrailStubReflection(raw);

    expect(result.comment).toBe('');
  });

  it('scopes the class lookup to a dictionary index when given', () => {
    const exec = vi.fn<QueryExecutor>(() => 'MISSING');

    getGrailStubReflection(exec, 'Account', 5);

    const code = exec.mock.calls[0][0];
    expect(code).toContain('symbolList at: 5');
    expect(code).toContain('canUnderstand:');
  });
});
