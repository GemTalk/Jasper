import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Keep real `fs` (debuggerPanel reads debuggerView.js via readFileSync at import
// time) but stub the dump's writes so Save-to-File tests do no real disk IO.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    },
  };
});

// A controlled five-frame stack, modelled on `JasperDebugDemo new run`:
//   level 1 — a block frame in JasperDebugDemo>>finish
//   level 2 — an inherited method: receiver is a SmallInteger, halt is in Object
//   levels 3-5 — plain recursive frames (JasperDebugDemo>>accumulateFrom:to:)
//                which also exercise the repeated-label / deep-stack case.
vi.mock('../debugQueries', () => ({
  getStackDepth: vi.fn(() => 5),
  getFrameInfo: vi.fn((_s: unknown, _p: unknown, level: number) => ({
    methodOop: BigInt(level),
    ipOffset: 5,
    receiverOop: BigInt(level * 100),
    argAndTempNames: [],
    argAndTempOops: [],
  })),
  getMethodBlockInfo: vi.fn((_s: unknown, methodOop: bigint) => ({
    isBlock: methodOop === 1n,
    homeMethodOop: methodOop,
  })),
  getMethodUriInfo: vi.fn(() => undefined),
  getMethodInfo: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
    if (oop === 2n) return { className: 'Object', selector: 'halt' };
    return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
  }),
  getObjectClassName: vi.fn((_s: unknown, receiverOop: bigint) =>
    receiverOop === 200n ? 'SmallInteger' : 'JasperDebugDemo',
  ),
  getLineForIp: vi.fn(() => 12),
  getStepPoint: vi.fn(() => 2),
  // Source offsets fetched straight from a method OOP (read-only doit / non-
  // symbol-list method). Same 1-based shape as browserQueries.getSourceOffsets.
  getSourceOffsetsForMethod: vi.fn(() => [1, 8, 26]),
  // Run to Cursor in a doit frame breaks/clears by the method OOP (no class>>selector).
  setBreakAtStepPointByOop: vi.fn(),
  clearBreakAtStepPointByOop: vi.fn(),
  getMethodSource: vi.fn(() => '| t | t := 6 * 7. t halt'),
  getObjectPrintString: vi.fn((_s: unknown, oop: bigint) => `<print ${oop}>`),
  getInstVarNames: vi.fn(() => [] as string[]),
  getNamedInstVarOops: vi.fn(() => [] as bigint[]),
  evaluateInFrame: vi.fn(() => '42'),
  evaluateInFrameNb: vi.fn(async () => '42'),
  evaluateInFrameToOop: vi.fn(() => 999n),
  setFrameTemp: vi.fn(),
  setInstVar: vi.fn(),
  getInstVarOop: vi.fn(() => 700n),
  isSpecialOop: vi.fn(() => false),
  saveObjs: vi.fn(),
  releaseObjs: vi.fn(),
  continueExecution: vi.fn(() => ({ completed: true })),
  stepOver: vi.fn(() => ({ completed: false })),
  stepInto: vi.fn(() => ({ completed: false })),
  stepOut: vi.fn(() => ({ completed: false })),
  // Non-blocking variants the webview panel now uses (resolve async).
  stepOverNb: vi.fn(async () => ({ completed: false })),
  stepIntoNb: vi.fn(async () => ({ completed: false })),
  stepThruNb: vi.fn(async () => ({ completed: false })),
  trimStackToLevel: vi.fn(),
  trimStackToLevelNb: vi.fn(async () => {}),
  clearStack: vi.fn(),
  // Create-method-from-DNU detection — defaults to "not a DNU" (no Create button).
  getDoesNotUnderstandInfo: vi.fn(() => undefined),
  // Implement-in-receiver (override): the receiver's inheritance chain (default
  // is a single class → no QuickPick; tests override it for the multi-class case).
  getReceiverClassChain: vi.fn(() => [
    { className: 'SmallInteger', isMeta: false, dictName: 'Globals' },
  ]),
  // "Browse" frame: where the running selector is defined (defining class + home
  // dict + category). Default = a resolvable, symbol-list target.
  getBrowseTarget: vi.fn(() => ({
    className: 'JasperDebugDemo',
    isMeta: false,
    dictName: 'UserGlobals',
    category: 'running',
    environmentId: 0,
  })),
  // Whole-stack dump (#10/#11): one batched call. Default = a Receiver row per
  // frame whose printString/oop mirror the per-frame receiverOop (level * 100).
  fetchStackDump: vi.fn(() =>
    [1, 2, 3, 4, 5].map((l) => ({
      serverLevel: l,
      group: 'receiver' as const,
      name: 'self',
      value: `<print ${l * 100}>`,
      oop: `${l * 100}`,
    })),
  ),
  // Single-frame variables in one round trip (drives the Variables pane + inline
  // overlay). Default = just the receiver row (self oop = level*100), matching the
  // old getFrameInfo default; tests override per level for instVars/temps. The
  // server doit already filters __vsc glue, classifies .tN stack temps, and emits
  // each editable slot's 1-based write index, so rows arrive grouped + indexed.
  fetchFrameVariables: vi.fn((_s: unknown, _p: unknown, level: number) => [
    {
      group: 'receiver' as const,
      name: 'self',
      value: `<print ${level * 100}>`,
      oop: `${level * 100}`,
      index: 0,
    },
  ]),
}));

// Clicking a variable row opens an enhanced inspector — stub the static entry point.
// create() returns a closable handle so the debugger can close it on dispose.
vi.mock('../enhancedInspector/enhancedInspector', () => ({
  EnhancedInspector: { create: vi.fn(() => ({ close: vi.fn() })) },
}));

// "Browse" a frame opens a System Browser — stub the static entry point so the
// test doesn't pull in the whole browser module (and its many dependencies).
vi.mock('../systemBrowser', () => ({ SystemBrowser: { openAndNavigate: vi.fn() } }));

// Source offsets for the step-point highlight. These are GemStone `_sourceOffsets`,
// which are 1-BASED (index i = offset of step point i+1); the panel must convert
// them to 0-based for doc.positionAt.
vi.mock('../browserQueries', () => ({
  getSourceOffsets: vi.fn(() => [1, 8, 26]),
  // Run to Cursor (#2) sets a temporary step-point break, then clears it.
  setBreakAtStepPoint: vi.fn(() => 'ok'),
  clearBreakAtStepPoint: vi.fn(() => 'ok'),
}));

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { uriFsPath } from './support/uri';
import * as debug from '../debugQueries';
import { EditorGroupLayout } from '../debuggerLayout';
import * as queries from '../browserQueries';
import {
  DebuggerPanel,
  formatFrameLabel,
  formatFramePosition,
  buildMethodStub,
  selectorArgCount,
  formatFrameForClipboard,
  buildMethodSourceUri,
  filterStack,
  isExceptionMachinery,
  RawFrame,
  formatDetailedStack,
  stackDumpFileName,
  stackDumpTimestamp,
  DetailedStackFrame,
  computeInlineValueLines,
  shortenInlineValue,
  maskCommentsAndStrings,
  InlineVar,
  inlineHoverMarkdown,
} from '../debuggerPanel';
import { InlineValuesCodeLensProvider } from '../inlineValuesCodeLens';
import { EnhancedInspector } from '../enhancedInspector/enhancedInspector';
import { SystemBrowser } from '../systemBrowser';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import { SMALLTALK_LANGUAGE } from '../languageIds';

const GS_PROCESS = 0x123n;
const ERROR_MSG = 'a UndefinedObject does not understand #foo';

// The static step-point highlight decoration is built once, at module import —
// i.e. BEFORE the beforeEach vi.clearAllMocks() below wipes the mock's call
// record. Snapshot the options it was created with here, at top level, so the
// guard test (see "step-point highlight decoration") can still see them.
// Identify it by its themed base `backgroundColor` (unique to this decoration).
const stepPointDecorationIndex = vi
  .mocked(vscode.window.createTextEditorDecorationType)
  .mock.calls.findIndex(
    (c) =>
      c[0]?.backgroundColor instanceof vscode.ThemeColor &&
      c[0].backgroundColor.id === 'editor.focusedStackFrameHighlightBackground',
  );
const stepPointDecorationOptions = vi.mocked(vscode.window.createTextEditorDecorationType).mock
  .calls[stepPointDecorationIndex]?.[0];
const stepPointDecorationHandle = vi.mocked(vscode.window.createTextEditorDecorationType).mock
  .results[stepPointDecorationIndex]?.value;

// The accent wash the companion source editor carries. Built at module import
// like the step-point highlight above, so grab the HANDLE here — tests compare
// it against what setDecorations was called with. Identified by the flat
// translucent purple it uses (unique to this decoration).
const sourceTintIndex = vi
  .mocked(vscode.window.createTextEditorDecorationType)
  .mock.calls.findIndex(
    (c) =>
      c[0]?.isWholeLine === true &&
      typeof c[0].backgroundColor === 'string' &&
      c[0].backgroundColor.includes('163, 113, 247'),
  );
const sourceTintOptions = vi.mocked(vscode.window.createTextEditorDecorationType).mock.calls[
  sourceTintIndex
]?.[0];
const sourceTintDecoration = vi.mocked(vscode.window.createTextEditorDecorationType).mock.results[
  sourceTintIndex
]?.value;

/**
 * The ranges `type` was last applied to on `editor`. Several decorations land on
 * the companion source editor (the accent wash, the step-point highlight, the
 * inline-value overlay), so a test has to name the one it means rather than
 * reach for whichever call happened to come first.
 */
function decorationRanges(
  editor: { setDecorations: unknown },
  type: unknown,
): vscode.Range[] | undefined {
  const calls = vi.mocked(editor.setDecorations as (...a: unknown[]) => void).mock.calls;
  const call = calls.filter((c) => c[0] === type).at(-1);
  return call?.[1] as vscode.Range[] | undefined;
}

/** The step-point highlight's ranges on `editor` (see stepPointDecorationHandle). */
function stepPointRanges(editor: { setDecorations: unknown }): vscode.Range[] | undefined {
  return decorationRanges(editor, stepPointDecorationHandle);
}

// Snapshot every debugQueries mock's factory implementation at module load —
// BEFORE any test overrides one. Many tests install sticky mockImplementation/
// mockReturnValue overrides (e.g. getMethodInfo, getFrameInfo, getStackDepth)
// which vi.clearAllMocks() does NOT undo, so an override would otherwise leak
// into every later test. The beforeEach below re-applies these snapshots so each
// test starts from the factory defaults regardless of run order (sequence.shuffle).
const debugDefaults: Array<[string, ((...args: unknown[]) => unknown) | undefined]> = Object.keys(
  debug,
).map((k) => {
  const fn = (debug as Record<string, unknown>)[k];
  const impl = vi.isMockFunction(fn) ? fn.getMockImplementation() : undefined;
  return [k, impl as ((...args: unknown[]) => unknown) | undefined];
});

function restoreDebugDefaults(): void {
  for (const [k, impl] of debugDefaults) {
    const fn = (debug as Record<string, unknown>)[k];
    if (!vi.isMockFunction(fn)) continue;
    // mockReset() also flushes any leftover *Once override queued by a test that
    // didn't consume it; then re-install the captured factory implementation.
    fn.mockReset();
    if (impl) fn.mockImplementation(impl);
  }
}

function makeSession(id = 1): ActiveSession {
  return {
    id,
    handle: { h: 1 },
    login: {
      label: 'Test',
      gs_user: 'DataCurator',
      stone: 'gs64stone',
      gem_host: 'devhost',
    } as GemStoneLogin,
    stoneVersion: '3.7.2',
    enhancedInspectorAvailable: true,
    gci: { GciTsClearStack: vi.fn() } as unknown as ActiveSession['gci'],
  };
}

/** The most recently created webview panel mock. */
function lastPanel() {
  const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return results[results.length - 1].value;
}

/** Invoke the panel's webview message handler with an arbitrary message. */
function sendMessage(panel: ReturnType<typeof lastPanel>, msg: unknown) {
  panel.webview.onDidReceiveMessage.mock.calls[0][0](msg);
}

/** Simulate the webview finishing load and requesting data. */
function sendReady(panel: ReturnType<typeof lastPanel>) {
  sendMessage(panel, { command: 'ready' });
}

/** Simulate the user closing the panel window. */
/**
 * Close a panel the way VS Code does — through `dispose()`, which marks it
 * disposed and THEN fires onDidDispose. Calling the handler directly would skip
 * the marking, and with it every bug that only shows up once the panel refuses
 * to answer questions about itself.
 */
function closePanel(panel: ReturnType<typeof lastPanel>) {
  panel.dispose();
}

/** The `init` payload the panel posts back to the webview after `ready`. */
function initPayload(panel: ReturnType<typeof lastPanel>) {
  const call = panel.webview.postMessage.mock.calls.find(
    (c: unknown[]) => (c[0] as { command: string }).command === 'init',
  );
  return call?.[0];
}

/** All payloads the panel posted to the webview with the given command. */
function posted(panel: ReturnType<typeof lastPanel>, command: string) {
  return panel.webview.postMessage.mock.calls
    .map((c: unknown[]) => c[0] as { command: string })
    .filter((m: { command: string }) => m.command === command);
}
/**
 * The most recent payload posted with the given command (or undefined).
 * Sourced from `mock.calls` (like `initPayload`) so the element type stays
 * inferred rather than narrowed to `{ command: string }` — webview payloads
 * are an untyped IPC union that assertions index into ad-hoc.
 */
function lastPosted(panel: ReturnType<typeof lastPanel>, command: string) {
  const all = panel.webview.postMessage.mock.calls.filter(
    (c: unknown[]) => (c[0] as { command: string }).command === command,
  );
  return all[all.length - 1]?.[0];
}

/**
 * Yield to the microtask/timer queue so an async panel handler (step / restart /
 * edit-and-continue now route through the awaited non-blocking Nb variants) can
 * settle before assertions. The mocked Nb fns resolve immediately, so one tick
 * is enough.
 */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Drain a few macrotasks — enough for a chain of awaits to settle. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};

describe('formatFrameLabel', () => {
  it('names a plain frame `Class>>#selector` when receiver matches the defining class', () => {
    expect(
      formatFrameLabel({
        isBlock: false,
        definingClass: 'JasperDebugDemo',
        selector: 'finish',
        receiverClass: 'JasperDebugDemo',
      }),
    ).toBe('JasperDebugDemo>>#finish');
  });

  it('disambiguates an inherited method as `Receiver (Defining)>>#selector`', () => {
    expect(
      formatFrameLabel({
        isBlock: false,
        definingClass: 'Object',
        selector: 'printString',
        receiverClass: 'Array',
      }),
    ).toBe('Array (Object)>>#printString');
  });

  it('omits disambiguation when the receiver class is unavailable', () => {
    expect(
      formatFrameLabel({
        isBlock: false,
        definingClass: 'Object',
        selector: 'printString',
      }),
    ).toBe('Object>>#printString');
  });

  it('prefixes a block frame with `[] in ` and never disambiguates the receiver', () => {
    expect(
      formatFrameLabel({
        isBlock: true,
        definingClass: 'JasperDebugDemo',
        selector: 'finish',
        receiverClass: 'SomethingElse',
      }),
    ).toBe('[] in JasperDebugDemo>>#finish');
  });

  it('handles inherited class-side methods (metaclass names already include " class")', () => {
    expect(
      formatFrameLabel({
        isBlock: false,
        definingClass: 'Object class',
        selector: 'new',
        receiverClass: 'JasperDebugDemo class',
      }),
    ).toBe('JasperDebugDemo class (Object class)>>#new');
  });
});

describe('formatFramePosition', () => {
  it('formats step point and line as `@<step> line <line>`', () => {
    expect(formatFramePosition(2, 12)).toBe('@2 line 12');
  });

  it('shows only the step point when the line is unavailable', () => {
    expect(formatFramePosition(2, undefined)).toBe('@2');
  });

  it('shows only the line when the step point is unavailable', () => {
    expect(formatFramePosition(undefined, 12)).toBe('line 12');
  });

  it('returns an empty string when neither is available', () => {
    expect(formatFramePosition(undefined, undefined)).toBe('');
  });

  it('omits a line of 0 (an unmapped IP has no source line)', () => {
    expect(formatFramePosition(2, 0)).toBe('@2');
    expect(formatFramePosition(undefined, 0)).toBe('');
  });
});

describe('buildMethodStub', () => {
  it('builds a keyword signature pairing each keyword with a generated arg', () => {
    expect(buildMethodStub('fourtyTwo:bar:', 2)).toMatch(/^fourtyTwo: arg1 bar: arg2\n/);
  });

  it('builds a binary signature with one argument', () => {
    expect(buildMethodStub('+', 1)).toMatch(/^\+ arg1\n/);
  });

  it('builds a bare unary signature', () => {
    expect(buildMethodStub('makeWidget', 0)).toMatch(/^makeWidget\n/);
  });

  it('includes a placeholder body so the method compiles as-is', () => {
    expect(buildMethodStub('foo', 0)).toContain('^nil');
  });
});

describe('selectorArgCount', () => {
  it('counts the colons of a keyword selector', () => {
    expect(selectorArgCount('fourtyTwo:bar:')).toBe(2);
    expect(selectorArgCount('at:put:')).toBe(2);
    expect(selectorArgCount('foo:')).toBe(1);
  });

  it('treats a binary selector as one argument', () => {
    expect(selectorArgCount('+')).toBe(1);
    expect(selectorArgCount('>=')).toBe(1);
    expect(selectorArgCount(',')).toBe(1);
  });

  it('treats a unary selector as zero arguments', () => {
    expect(selectorArgCount('makeWidget')).toBe(0);
    expect(selectorArgCount('foo')).toBe(0);
  });
});

describe('formatFrameForClipboard', () => {
  it('renders `<label>  <position>` with no leading frame number', () => {
    expect(
      formatFrameForClipboard({
        level: 2,
        label: 'SmallInteger (Object)>>#halt',
        position: '@2 line 12',
      }),
    ).toBe('SmallInteger (Object)>>#halt  @2 line 12');
  });

  it('omits the position when the frame has none', () => {
    expect(formatFrameForClipboard({ level: 1, label: 'A>>#x', position: '' })).toBe('A>>#x');
  });
});

describe('formatDetailedStack (#10)', () => {
  const frames: DetailedStackFrame[] = [
    {
      level: 1,
      label: 'JasperFoo>>#bar',
      position: '@2 line 3',
      groups: [
        {
          title: 'Receiver',
          kind: 'receiver',
          vars: [{ name: 'self', value: 'a JasperFoo', oop: '100' }],
        },
        {
          title: 'Instance variables',
          kind: 'instvars',
          vars: [{ name: 'count', value: '7', oop: '14', edit: { kind: 'instvar', index: 1 } }],
        },
        {
          title: 'Arguments & Temps',
          kind: 'argtemps',
          vars: [{ name: 'x', value: 'nil', oop: '20', edit: { kind: 'temp', index: 1 } }],
        },
      ],
    },
    {
      level: 2,
      label: 'JasperFoo>>#run',
      position: '',
      groups: [
        {
          title: 'Receiver',
          kind: 'receiver',
          vars: [{ name: 'self', value: 'a JasperFoo', oop: '100' }],
        },
      ],
    },
  ];

  it('puts the short numbered stack first, then a detail block per frame', () => {
    const out = formatDetailedStack('boom', frames).split('\n');
    // Header (error) then the SHORT stack — both frames — before any detail.
    expect(out.slice(0, 4)).toEqual([
      'GemStone error: boom',
      '',
      '[1] JasperFoo>>#bar  @2 line 3',
      '[2] JasperFoo>>#run',
    ]);
    // A separator + repeated heading introduces each detail block.
    expect(out).toContain('---------------------------------');
    const firstSep = out.indexOf('---------------------------------');
    expect(out[firstSep + 1]).toBe('[1] JasperFoo>>#bar  @2 line 3');
  });

  it('renders each variable as "<name> = <printString>   {<oop>}" under its group', () => {
    const out = formatDetailedStack('', frames);
    expect(out).toContain('Receiver:');
    expect(out).toContain('    self = a JasperFoo   {100}');
    expect(out).toContain('Instance variables:');
    expect(out).toContain('    count = 7   {14}');
    expect(out).toContain('Arguments & Temps:');
    expect(out).toContain('    x = nil   {20}');
  });

  it('shows "(none)" for a group with no rows, and an optional header line', () => {
    const empty: DetailedStackFrame[] = [
      {
        level: 1,
        label: 'A>>#x',
        position: '',
        groups: [{ title: 'Instance variables', kind: 'instvars', vars: [] }],
      },
    ];
    const out = formatDetailedStack('', empty, 'GemStone Debugger stack dump — For me');
    expect(out.startsWith('GemStone Debugger stack dump — For me\n')).toBe(true);
    expect(out).toContain('Instance variables:\n    (none)');
  });

  it('emits a frame heading with no group lines when a frame has no variable rows', () => {
    const out = formatDetailedStack('', [{ level: 1, label: 'A>>#x', position: '', groups: [] }]);
    // Short stack, separator, repeated heading — and nothing after it.
    expect(out).toBe(['[1] A>>#x', '', '-'.repeat(33), '[1] A>>#x'].join('\n'));
  });

  // Golden, byte-exact rendering — locks the whole layout (spacing, separators,
  // group order) so a stray format change can't slip through the toContain checks.
  it('renders the exact GBS-style layout (golden)', () => {
    expect(formatDetailedStack('a Error', frames)).toBe(
      [
        'GemStone error: a Error',
        '',
        '[1] JasperFoo>>#bar  @2 line 3',
        '[2] JasperFoo>>#run',
        '',
        '-'.repeat(33),
        '[1] JasperFoo>>#bar  @2 line 3',
        'Receiver:',
        '    self = a JasperFoo   {100}',
        'Instance variables:',
        '    count = 7   {14}',
        'Arguments & Temps:',
        '    x = nil   {20}',
        '',
        '-'.repeat(33),
        '[2] JasperFoo>>#run',
        'Receiver:',
        '    self = a JasperFoo   {100}',
      ].join('\n'),
    );
  });
});

describe('stackDumpFileName / stackDumpTimestamp (#11)', () => {
  const when = new Date(2026, 5, 25, 15, 30, 12); // local 2026-06-25 15:30:12

  it('formats the timestamp as YYYYMMDD_HHMMSS (local, zero-padded, no dashes)', () => {
    expect(stackDumpTimestamp(when)).toBe('20260625_153012');
  });

  it('leads with the timestamp, then the frame token (block prefix dropped)', () => {
    expect(stackDumpFileName('[] in JasperFoo>>#bar', when)).toBe(
      '20260625_153012_JasperFoo-bar.txt',
    );
  });

  it('collapses non-alphanumerics and falls back to "stack" for an empty label', () => {
    expect(stackDumpFileName('', when)).toBe('20260625_153012_stack.txt');
    expect(stackDumpFileName('Executed Code', when)).toBe('20260625_153012_Executed-Code.txt');
  });
});

describe('DebuggerPanel', () => {
  let session: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() clears call history but NOT mockImplementation overrides;
    // re-apply the captured factory defaults so a sticky override from one test
    // doesn't leak into the next under sequence.shuffle.
    restoreDebugDefaults();
    // The read-only content provider is registered once per module lifetime
    // (guarded by the static providerRegistered flag); reset it (and the backing
    // source map) so every test re-registers as needed instead of depending on
    // whichever read-only-frame test happened to run first.
    (DebuggerPanel as unknown as { providerRegistered: boolean }).providerRegistered = false;
    (DebuggerPanel as unknown as { readOnlySources: Map<string, string> }).readOnlySources.clear();
    // The injected inspector provider is a static (set once at activation); clear
    // it so a test that assigns it (the fallback-inspect case) doesn't leak into
    // the next under sequence.shuffle.
    DebuggerPanel.inspectorProvider = undefined;
    // tabGroups.all is a plain array on the mock, not a vi.fn — reset it so a
    // test that populates it doesn't leak into the next.
    (vscode.window.tabGroups.all as unknown as unknown[]).length = 0;
    // Panels stay in the static registry until they're disposed, and most tests
    // never close theirs. Every one that opened a companion source editor also
    // left a layout sampler running — a 2s setInterval calling
    // `vscode.getEditorLayout`, cleared only in dispose() — so stop those first.
    // On a host slow enough for the interval to fire mid-test (Windows CI, where
    // this file takes ~70s rather than ~1s) a leaked sampler lands an extra
    // getEditorLayout on the shared executeCommand mock and inflates whichever
    // test is counting those calls. Then clear the registry, so a leftover panel
    // can't hand its carved column pair to the next test's debugger (see
    // liveDebuggerColumns).
    const panelRegistry = (
      DebuggerPanel as unknown as {
        panels: Map<number, Set<{ layoutSampler?: ReturnType<typeof setInterval> }>>;
      }
    ).panels;
    for (const sessionPanels of panelRegistry.values()) {
      for (const panel of sessionPanels) {
        // clearInterval(undefined) is a no-op, so panels that never started a
        // sampler need no guard.
        clearInterval(panel.layoutSampler);
        panel.layoutSampler = undefined;
      }
    }
    panelRegistry.clear();
    session = makeSession();
  });

  it('opens into a new column of its own with the title "GemStone Debugger"', () => {
    (vscode.window.tabGroups.all as unknown as unknown[]).push(
      { viewColumn: 1, tabs: [] },
      { viewColumn: 2, tabs: [] },
    );
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);

    const call = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
    expect(call[1]).toBe('GemStone Debugger'); // tab title
    // An explicit column past the last one, NOT ViewColumn.Beside — Beside's
    // direction is a user setting and it reuses an adjacent group.
    expect(call[2]).toEqual({ viewColumn: 3, preserveFocus: false });
    expect(call[3]).toMatchObject({ enableScripts: true });
  });

  it("reuses the first debugger's column pair when a second halt opens", async () => {
    (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    await tick();
    DebuggerPanel.create(session, 0x456n, 'a second halt');

    const columns = vi
      .mocked(vscode.window.createWebviewPanel)
      .mock.calls.map((c) => (c[2] as { viewColumn: number }).viewColumn);
    expect(columns).toEqual([2, 2]); // one column pair, not one per error
    // …and the second panel carved nothing: only the first one reshaped the grid.
    const carves = vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.filter((c) => c[0] === 'vscode.getEditorLayout');
    expect(carves).toHaveLength(1);
  });

  it("waits for the first debugger's carve before opening a second halt's source", async () => {
    // The column pair exists only once the carve has finished. A second halt
    // arriving mid-carve must wait for the same thing the first one is waiting
    // for, or it opens a source editor into a group VS Code has not split yet.
    (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
    let releaseLayout!: (v: unknown) => void;
    const layoutRead = new Promise((resolve) => (releaseLayout = resolve));
    vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
      cmd === 'vscode.getEditorLayout' ? layoutRead : Promise.resolve(undefined),
    );
    try {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG); // its carve is now in flight
      await tick();
      DebuggerPanel.create(session, 0x456n, 'a second halt');
      const second = lastPanel();
      sendReady(second);
      sendMessage(second, { command: 'selectFrame', level: 3 });
      await flushMicrotasks();

      // Nothing opened: the second panel is waiting on the first one's carve.
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();

      releaseLayout({ orientation: 0, groups: [{ size: 600 }, { size: 600 }] });
      await flushMicrotasks();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    } finally {
      vi.mocked(vscode.commands.executeCommand).mockReset();
    }
  });

  it("keeps a second session out of this session's column pair", async () => {
    // Two sessions are two stones' worth of work; sharing a column would also
    // let one debugger's teardown close the other's tabs.
    (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    await tick();
    DebuggerPanel.create(makeSession(2), GS_PROCESS, 'a halt on another stone');

    // A second halt in the SAME session joins the open pair and carves nothing;
    // another session gets its own column, so it reads the grid to carve one.
    const carves = vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.filter((c) => c[0] === 'vscode.getEditorLayout');
    expect(carves).toHaveLength(2); // one per session, not one shared
  });

  it("follows the first debugger's panel when VS Code renumbers the columns", async () => {
    // An emptied group collapsing is enough to shift every column number along.
    // A second halt must land on the debugger's group as it is NOW — reusing the
    // number the first panel recorded at open time puts it in the SOURCE group,
    // stacking the panel and the source editor in one half of the column.
    (vscode.window.tabGroups.all as unknown as unknown[]).push(
      { viewColumn: 1, tabs: [] },
      { viewColumn: 2, tabs: [] },
    );
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    await tick();
    const first = lastPanel() as { viewColumn?: number };
    expect(first.viewColumn).toBe(3);
    first.viewColumn = 2; // a group ahead of it closed; everything shifted left

    DebuggerPanel.create(session, 0x456n, 'a second halt');
    const columns = vi
      .mocked(vscode.window.createWebviewPanel)
      .mock.calls.map((c) => (c[2] as { viewColumn: number }).viewColumn);
    expect(columns).toEqual([3, 2]); // the second follows the panel, not the stale number
  });

  it('sweeps the columns it occupies NOW when a renumber moved it before it closed', async () => {
    // The remembered column is what teardown works from (a disposed panel won't
    // answer), and a halt that never selected a frame reads nothing off the panel
    // to refresh it — the view-state listener is the only thing that does. VS
    // Code does fire it for a pure renumber: it recomputes every webview's view
    // state when a group is added, removed or moved, and the panel raises the
    // event on any position it computes differently. Without that refresh the
    // sweep works from the open-time number and gets BOTH columns wrong: the
    // debugger's own group survives (the accumulation the sweep exists to
    // prevent) and a stranger's group one past it is closed in its place.
    (vscode.window.tabGroups.all as unknown as unknown[]).push(
      { viewColumn: 1, tabs: [] },
      { viewColumn: 2, tabs: [] },
    );
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    await tick();
    const panel = lastPanel();
    expect(panel.viewColumn).toBe(3);

    panel.__moveTo(2); // a group ahead of it closed; everything shifted left

    const groups = vscode.window.tabGroups.all as unknown as {
      viewColumn: number;
      tabs: unknown[];
    }[];
    groups.length = 0;
    groups.push(
      { viewColumn: 1, tabs: [] },
      { viewColumn: 2, tabs: [] }, // the debugger's panel group, where it is now
      { viewColumn: 3, tabs: [] }, // its source group
      { viewColumn: 4, tabs: [] }, // a user's own empty group — must survive
    );
    closePanel(panel);
    await tick();

    const swept = vi
      .mocked(vscode.window.tabGroups.close)
      .mock.calls.map((c) => (c[0] as { viewColumn?: number }).viewColumn);
    expect(swept).toEqual([2, 3]);
  });

  it('shows a dimmed "For <user> on <stone> @ <host>" subtitle from the login', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain('For DataCurator on gs64stone @ devhost');
    // The subtitle uses the dimmed description color.
    expect(html).toMatch(/\.subtitle\s*\{[^}]*--vscode-descriptionForeground/);
  });

  it('styles editable variable rows with a pointer cursor (the editable affordance)', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    // Editable rows get a pointer cursor; the base row stays a plain default
    // (so `self` and other non-editable rows don't look clickable).
    expect(html).toMatch(/\.var\.editable\s*\{[^}]*cursor:\s*pointer/);
    expect(html).toMatch(/\.vars \.var\s*\{[^}]*cursor:\s*default/);
  });

  it('styles a rejected variable expression with an error border + visible message line', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    // The editor's .error state recolors the border to the validation-error color…
    expect(html).toMatch(/\.var-edit\.error\s*\{[^}]*--vscode-inputValidation-errorBorder/);
    // …and the message line below it uses the error foreground color…
    expect(html).toMatch(/\.var-edit-error\s*\{[^}]*--vscode-errorForeground/);
    // …and is text-selectable so the real error can be copied out.
    expect(html).toMatch(/\.var-edit-error\s*\{[^}]*user-select:\s*text/);
  });

  it('HTML-escapes session text so it cannot inject markup into the page', () => {
    session.login = {
      label: 'T',
      gs_user: '<img src=x>',
      stone: 's&s',
      gem_host: 'h"h',
    } as GemStoneLogin;
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain(
      '<span class="subtitle">For &lt;img src=x&gt; on s&amp;s @ h&quot;h</span>',
    );
    expect(html).not.toContain('<img src=x>'); // raw, unescaped tag must not appear
  });

  it('builds a partial subtitle when some login fields are missing', () => {
    session.login = { label: 'T', gs_user: 'solo' } as GemStoneLogin; // no stone / host
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain('<span class="subtitle">For solo</span>');
  });

  it('disposeForSession disposes every panel created for the session', () => {
    const s = { ...makeSession(), id: 4242 };
    DebuggerPanel.create(s, GS_PROCESS, ERROR_MSG);
    DebuggerPanel.create(s, 0x456n, 'another error');
    const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
    const p1 = results[results.length - 2].value;
    const p2 = results[results.length - 1].value;

    DebuggerPanel.disposeForSession(4242);

    expect(p1.dispose).toHaveBeenCalled();
    expect(p2.dispose).toHaveBeenCalled();
  });

  it('posts the error string back to the webview unchanged', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();
    sendReady(panel);

    expect(initPayload(panel).errorMessage).toBe(ERROR_MSG);
  });

  describe('copy / context menu', () => {
    it('provides a Copy Stack button and a Copy Frame popup item, and suppresses the default menu', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toContain('id="copyBtn"'); // Copy Stack button
      expect(html).toContain('Copy Stack');
      expect(html).toContain('id="copyFrameItem"'); // Copy Frame popup item
      expect(html).toContain('Copy Frame');
      expect(html).toContain('copyFrame'); // per-frame copy wiring
      expect(html).toContain('id="browseFrameItem"'); // Browse popup item
      expect(html).toMatch(/addEventListener\(\s*'contextmenu'/); // default menu suppressed + custom menu
      expect(html).toContain('preventDefault');
    });

    it('renders labelled, splittable Call Stack / Variables panes', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toContain('>Call Stack<'); // pane title
      expect(html).toContain('>Variables<'); // pane title
      expect(html).toContain('id="splitter"'); // draggable column divider
      expect(html).toMatch(/--stack-basis:\s*60%/); // default split, injected from the saved static
      // The eval bar is one row, expression beside answer, so there is nothing
      // left to drag it against — no horizontal divider, no remembered height.
      expect(html).not.toContain('id="hsplitter"');
      expect(html).not.toContain('--eval-height');
    });

    it('renders the toolbar as DAP-style icon buttons (codicon SVGs), not text labels', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      // Each control keeps its data-cmd (wiring) but now carries an inline SVG glyph.
      for (const cmd of [
        'resume',
        'runToCursor',
        'stepOver',
        'stepInto',
        'stepThrough',
        'restartFrame',
        'terminate',
      ]) {
        expect(html).toMatch(new RegExp(`data-cmd="${cmd}"[^>]*>\\s*<svg`));
      }
      // Run to Cursor starts disabled (enabled only when a breakable frame is selected).
      expect(html).toMatch(/data-cmd="runToCursor"[^>]*\bdisabled\b/);
      // The old text labels are gone (names live in title/aria-label tooltips).
      expect(html).toContain('aria-label="Resume execution"');
      expect(html).not.toMatch(/data-cmd="resume"[^>]*>Resume</);
    });

    it('#10 copyStack: copies the FULL stack — short stack on top, then per-frame values', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel); // fetches + caches the stack
      sendMessage(panel, { command: 'copyStack' });

      const text = vi.mocked(vscode.env.clipboard.writeText).mock.calls[0][0];
      // Header, error, then the short numbered stack ([1]..[5]) …
      expect(text.startsWith('GemStone Debugger stack dump')).toBe(true);
      expect(text).toContain('GemStone error: a UndefinedObject does not understand #foo');
      expect(text).toContain('[1] [] in JasperDebugDemo>>#finish  @2 line 12');
      expect(text).toContain('[5] JasperDebugDemo>>#accumulateFrom:to:  @2 line 12');
      // … then a detail block: separator, repeated heading, Receiver with self + oop.
      expect(text).toContain('---------------------------------');
      expect(text).toContain('Receiver:');
      expect(text).toContain('    self = <print 100>   {100}'); // frame 1 receiverOop = 100
    });

    it('writes a single frame (no leading number) to the clipboard on copyFrame', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyFrame', level: 2 });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        'SmallInteger (Object)>>#halt  @2 line 12',
      );
    });

    it('ignores copyFrame for an unknown level without writing the clipboard', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyFrame', level: 999 });

      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('marks real method frames as browsable in the init payload', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      const stack = initPayload(panel).stack as Array<{ browsable?: boolean }>;
      expect(stack.every((f) => f.browsable === true)).toBe(true);
    });

    it('opens a browser on the running method’s defining class beside the debugger', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      sendMessage(panel, { command: 'browseFrame', level: 2 });

      expect(SystemBrowser.openAndNavigate).toHaveBeenCalledWith(
        session,
        {
          dictName: 'UserGlobals',
          className: 'JasperDebugDemo',
          isMeta: false,
          selector: 'halt',
          category: 'running',
          environmentId: 0,
        },
        vscode.ViewColumn.Beside,
      );
    });

    it('does not open a browser for an unknown frame level', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      sendMessage(panel, { command: 'browseFrame', level: 999 });

      expect(SystemBrowser.openAndNavigate).not.toHaveBeenCalled();
    });

    it('shows a message instead of opening a browser when the selector cannot be located', () => {
      vi.mocked(debug.getBrowseTarget).mockReturnValueOnce(undefined);
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      sendMessage(panel, { command: 'browseFrame', level: 2 });

      expect(SystemBrowser.openAndNavigate).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toContain('Could not locate #halt');
    });

    it('shows a message instead of opening a browser when the class is outside the symbol list', () => {
      vi.mocked(debug.getBrowseTarget).mockReturnValueOnce({
        className: 'Loner',
        isMeta: false,
        dictName: '',
        category: '',
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      sendMessage(panel, { command: 'browseFrame', level: 2 });

      expect(SystemBrowser.openAndNavigate).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toContain("isn't in your symbol list");
    });

    it('#10 copyStack: assembles the batched dump rows into per-frame groups', () => {
      // One batched fetch returns flat rows; the panel buckets them back into
      // Receiver / Instance variables / Arguments & Temps / (stack temps).
      vi.mocked(debug.fetchStackDump).mockReturnValueOnce([
        { serverLevel: 1, group: 'receiver', name: 'self', value: 'a JasperDebugDemo', oop: '100' },
        { serverLevel: 1, group: 'instvars', name: 'total', value: '42', oop: '84' },
        { serverLevel: 1, group: 'argtemps', name: 'each', value: '7', oop: '14' },
        { serverLevel: 1, group: 'stacktemps', name: '.t1', value: 'nil', oop: '20' },
      ]);
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyStack' });

      const text = vi.mocked(vscode.env.clipboard.writeText).mock.calls[0][0];
      expect(text).toContain('Receiver:\n    self = a JasperDebugDemo   {100}');
      expect(text).toContain('Instance variables:\n    total = 42   {84}');
      expect(text).toContain('Arguments & Temps:\n    each = 7   {14}');
      expect(text).toContain('(stack temps):\n    .t1 = nil   {20}');
    });

    it('copyText: writes the given text to the clipboard (the Copy-path button)', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyText', text: '/Users/me/.jasper/stacks/x.txt' });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/Users/me/.jasper/stacks/x.txt');
    });

    it('#11 dumpStackToFile: writes ~/.jasper/stacks/<ts>_*.txt and posts the path notice (no tab opened)', async () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'dumpStackToFile' });
      await tick();

      // Directory ensured + file written with the detailed text.
      expect(vi.mocked(fs.promises.mkdir)).toHaveBeenCalledWith(
        expect.stringContaining(`${path.sep}.jasper${path.sep}stacks`),
        { recursive: true },
      );
      const [filePath, content, enc] = vi.mocked(fs.promises.writeFile).mock.calls[0] as [
        string,
        string,
        string,
      ];
      // Timestamp-first name (YYYYMMDD_HHMMSS_<frame>.txt) under ~/.jasper/stacks.
      expect(filePath).toMatch(/[/\\]\.jasper[/\\]stacks[/\\]\d{8}_\d{6}_.*\.txt$/);
      expect(enc).toBe('utf-8');
      expect(content).toContain('[1] [] in JasperDebugDemo>>#finish  @2 line 12');
      expect(content).toContain('Receiver:');
      // Does NOT open the file (repeated dumps would pile up editor tabs) …
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
      // … the raw path is posted to the panel for the inline Copy-path notice instead.
      expect(lastPosted(panel, 'savedNotice').path).toBe(filePath);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('#11 dumpStackToFile: surfaces a write failure as an error toast (no crash)', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('disk full'));
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'dumpStackToFile' });
      await tick();

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('disk full');
    });

    // The text below "GemStone error:" — i.e. everything except the header line,
    // which carries a wall-clock timestamp that legitimately differs run-to-run.
    const dumpBody = (s: string) => s.slice(s.indexOf('GemStone error:'));

    it('Copy Stack and Dump Stack produce identical content for the same paused state', async () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyStack' });
      const copied = vi.mocked(vscode.env.clipboard.writeText).mock.calls[0][0];
      sendMessage(panel, { command: 'dumpStackToFile' });
      await tick();
      const dumped = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;

      // Both go through buildDetailedStackText → byte-identical apart from the
      // header's timestamp; the stack body must never diverge between the two.
      expect(dumpBody(copied)).toBe(dumpBody(dumped));
    });

    it('openDumpFile: opens the requested path in an editor (on-demand, a real tab)', async () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'openDumpFile', path: '/Users/me/.jasper/stacks/x.txt' });
      await tick();

      const opened = vi
        .mocked(vscode.workspace.openTextDocument)
        .mock.calls.at(-1)![0] as vscode.Uri;
      expect(opened.fsPath).toBe(uriFsPath('/Users/me/.jasper/stacks/x.txt'));
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: false }),
      );
    });

    it('copyStack stays graceful when the batched variable fetch yields nothing', () => {
      vi.mocked(debug.fetchStackDump).mockReturnValueOnce([]); // e.g. introspection failed
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyStack' });

      const text = vi.mocked(vscode.env.clipboard.writeText).mock.calls[0][0];
      // Short stack + per-frame headings still render; just no variable groups.
      expect(text).toContain('[1] [] in JasperDebugDemo>>#finish  @2 line 12');
      expect(text).not.toContain('Receiver:'); // no rows → no groups, no crash
    });
  });

  describe('frame list', () => {
    it('renders step point & line in a dimmed `.pos` element', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toMatch(/\.pos\s*\{[^}]*--vscode-descriptionForeground/);
    });

    it('numbers the frames 1..N, strictly ascending, for easy reference', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      const levels = initPayload(panel).stack.map((f: { level: number }) => f.level);
      // A deep stack (>2) so "ascending" is a meaningful assertion, not a coincidence.
      expect(levels.length).toBeGreaterThan(2);
      // Numbered 1..N with no gaps, no duplicates, strictly increasing.
      expect(levels).toEqual(levels.map((_: number, i: number) => i + 1));
    });

    it('builds frame labels with block prefix, receiver disambiguation, and position', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack).toMatchObject([
        { level: 1, label: '[] in JasperDebugDemo>>#finish', position: '@2 line 12' },
        { level: 2, label: 'SmallInteger (Object)>>#halt', position: '@2 line 12' },
        { level: 3, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
        { level: 4, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
        { level: 5, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
      ]);
    });

    // Ported from the DAP stackTraceRequest "doit frame" test: a valid frame
    // whose method can't be introspected is `Executed Code`, NOT an error.
    it('labels a frame `Executed Code` when its method cannot be resolved', () => {
      // getMethodUriInfo already returns undefined in the base mock; make the
      // getMethodInfo fallback throw for the first frame (as a doit/anon frame).
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => {
        throw new Error('does not understand #inClass');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack[0].label).toBe('Executed Code');
    });

    // The other fallback branch: when the frame contents themselves can't be
    // fetched, the frame is `<frame N>` with no position (vs. "unavailable").
    it('labels a frame `<frame N>` when its contents cannot be fetched', () => {
      vi.mocked(debug.getFrameInfo).mockImplementationOnce(() => {
        throw new Error('cannot fetch frame contents');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack[0]).toMatchObject({
        level: 1,
        label: '<frame 1>',
        position: '',
      });
    });

    // An "unprintable" / unresolvable receiver: getObjectClassName throws. The
    // label must still render (no crash), just without receiver disambiguation.
    it('falls back to the defining class when the receiver class cannot be fetched', () => {
      // First non-block frame (level 2) is the only one that queries the
      // receiver class; make that query throw.
      vi.mocked(debug.getObjectClassName).mockImplementationOnce(() => {
        throw new Error('receiver does not understand #class');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      // Without the receiver class there is no `Receiver (Defining)` form —
      // just the plain defining-class label, and the frame isn't overridable
      // (we can't tell the receiver inherited the method).
      expect(initPayload(panel).stack[1]).toMatchObject({
        level: 2,
        label: 'Object>>#halt',
        position: '@2 line 12',
        overridable: false,
      });
    });

    // fetchStack's outer guard: if the stack can't even be measured (e.g. the
    // process died), the panel posts an empty stack rather than throwing.
    it('returns an empty stack when the stack-depth query fails', () => {
      vi.mocked(debug.getStackDepth).mockImplementationOnce(() => {
        throw new Error('process is dead');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack).toEqual([]);
    });
  });

  describe('source pane', () => {
    // Let revealFrameSource's awaited openTextDocument/showTextDocument settle.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const URI_INFO = {
      dictName: 'UserGlobals',
      className: 'JasperDebugDemo',
      isMeta: false,
      category: 'accessing',
      environmentId: 0,
      selector: 'accumulateFrom:to:',
    };

    // The editor showTextDocument resolved to on the most recent call.
    async function shownEditor() {
      const results = vi.mocked(vscode.window.showTextDocument).mock.results;
      return await results[results.length - 1].value;
    }

    // Open the panel and load the (unfiltered, 5-frame) stack so selectFrame can
    // map a display level back to its server level. Reveal-specific mocks are set
    // AFTER this — fetchStack consumes only the base mocks, never the per-test
    // `…Once` ones, which are then picked up by the single revealFrameSource call.
    function openPanelWithStack() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('builds a gemstone:// URI of the form scheme/dict/class/side/category/selector', () => {
      expect(buildMethodSourceUri(7, URI_INFO)).toBe(
        'gemstone://7/UserGlobals/JasperDebugDemo/instance/accessing/accumulateFrom%3Ato%3A',
      );
    });

    it('uses the "class" side for metaclass methods', () => {
      expect(buildMethodSourceUri(7, { ...URI_INFO, isMeta: true })).toContain(
        '/JasperDebugDemo/class/',
      );
    });

    it('opens the method source (gemstone://) in a group BELOW the panel, keeping focus', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // for the reveal of frame 3
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone');
      expect(openUri.toString()).toContain('JasperDebugDemo');

      // Opened straight into the column below the panel — no focus change to
      // race, and none of the relative step commands that made the arrangement
      // depend on timing and window size.
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: true, preserveFocus: true }),
      );
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
        'workbench.action.newGroupBelow',
      );
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
        'workbench.action.decreaseViewHeight',
      );
    });

    it("washes the companion source editor in the debugger's accent", async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      // The two halves of the column are one thing — a debugger and the source
      // it stopped in, not a debugger and some editor that happens to sit below.
      const editor = await shownEditor();
      expect(sourceTintDecoration).toBeDefined();
      const wash = decorationRanges(editor, sourceTintDecoration);
      expect(wash).toBeDefined();
      expect(wash![0].start.line).toBe(0);
      // Same colour as the panel's own background, by construction — both are
      // built from ACCENT_RGB at WASH_STRENGTH, so they can't drift apart.
      expect(sourceTintOptions?.backgroundColor).toBe('rgba(163, 113, 247, 0.12)');
      expect(lastPanel().webview.html).toContain('rgb(163, 113, 247) 12%');

      // It comes off when the panel does: the source tab can outlive the panel,
      // and a document still washed like a debugger's is a lie.
      closePanel(panel);
      expect(decorationRanges(editor, sourceTintDecoration)).toEqual([]);
    });

    it('highlights the step-point token, converting the 1-based source offset to 0-based', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      // step point 2 → getSourceOffsets()[1] === 8 (1-based) → positionAt(8 - 1) → (0, 7).
      // Regression guard for C1: dropping the "-1" would land the highlight at column 8.
      // No word range in the mock → a one-character marker, NOT the whole line.
      const range = stepPointRanges(editor)![0];
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(7); // 8 (1-based) - 1, NOT 8
      expect(range.end.character - range.start.character).toBe(1);
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('shows the executed source read-only, exactly as stored on the server', async () => {
      const panel = openPanelWithStack();
      // A true doit frame: no class>>selector at all (getMethodUriInfo AND
      // getMethodInfo both fail to resolve a home class). Doits run the user's
      // raw code, so the stored source IS the displayed source.
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => {
        throw new Error('doit: nil inClass');
      });
      vi.mocked(debug.getMethodSource).mockReturnValueOnce('JasperDebugDemo new run');
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone-debug');
      expect(openUri.path).toBe('Executed Code');
      // stashReadOnlySource keys each method distinct via the query (session + oop).
      expect(openUri.query).toMatch(/session=\d+&method=\d+/);
      expect(debug.getMethodSource).toHaveBeenCalled();

      // The content provider serves the source 1:1 (read-only, never dirty).
      // (First read-only frame in the suite, so registration happens here.)
      const reg = vi.mocked(vscode.workspace.registerTextDocumentContentProvider).mock.calls[0];
      expect(reg[0]).toBe('gemstone-debug');
      const provider = reg[1] as { provideTextDocumentContent(u: vscode.Uri): string };
      expect(provider.provideTextDocumentContent(openUri)).toBe('JasperDebugDemo new run');
    });

    // The companion source pane shows EITHER a gemstone:// method (when the frame
    // can be edited and continued) or the read-only gemstone-debug:// stash. Only
    // the latter needs a language set here — and the distinction matters, because
    // a method editor carries gemstone-method, the one language
    // `contributes.breakpoints` names. Re-tagging everything would put the
    // method a developer is most likely to want a breakpoint in back on
    // gemstone-smalltalk and quietly take its gutter away.
    it('does NOT re-tag a gemstone:// method, so its breakpoint gutter survives', async () => {
      const panel = openPanelWithStack();
      vi.mocked(vscode.languages.setTextDocumentLanguage).mockClear();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // reveal of frame 3
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone'); // the editable path
      expect(vscode.languages.setTextDocumentLanguage).not.toHaveBeenCalled();
    });

    it('tags the read-only stash as gemstone-smalltalk, so its source is highlighted', async () => {
      // The read-only scheme has no language of its own, and the highlighting is
      // the point of this pane. gemstone-smalltalk gives it that and no gutter.
      const panel = openPanelWithStack();
      vi.mocked(vscode.languages.setTextDocumentLanguage).mockClear();
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => {
        throw new Error('doit: nil inClass');
      });
      vi.mocked(debug.getMethodSource).mockReturnValueOnce('JasperDebugDemo new run');
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone-debug');
      expect(vscode.languages.setTextDocumentLanguage).toHaveBeenCalledWith(
        expect.anything(),
        SMALLTALK_LANGUAGE,
      );
    });

    it('titles a read-only NON-symbol-list method by its method name (C3: never mislabel as Executed Code)', async () => {
      const panel = openPanelWithStack();
      // Frame 3: no dictName (getMethodUriInfo → undefined) but getMethodInfo
      // resolves a real class → a method, NOT executed code. It must open titled
      // by the method, not under "Executed Code".
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone-debug');
      expect(openUri.path).toBe('JasperDebugDemo>>#accumulateFrom:to:');
    });

    it('highlights a read-only frame whose source matches the server source 1:1', async () => {
      // A non-symbol-list method or a doit is shown unmodified, so the server
      // step-point offsets map onto the displayed source directly and the step
      // point IS highlighted.
      const panel = openPanelWithStack(); // frame 3 → read-only
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      // step point 2 → getSourceOffsetsForMethod()[1] === 8 (1-based) → positionAt(7) → (0, 7).
      const range = stepPointRanges(editor)![0];
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(7);
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('highlights a read-only BLOCK frame from its HOME method, not the block method', async () => {
      // Regression: a block's own GsNMethod carries a SHORT _sourceOffsets (its
      // own step points only), but _stepPointAt: reports the frame's step point
      // in HOME-method numbering. Pairing a home step point with the block's
      // short offsets overruns the array → undefined → highlight collapses to the
      // line. Source AND offsets must come from the home method. Here the block's
      // method (frame 3 → 3n) differs from its home (999n).
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodBlockInfo).mockReturnValueOnce({
        isBlock: true,
        homeMethodOop: 999n,
      });
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      expect(debug.getMethodSource).toHaveBeenCalledWith(session, 999n);
      expect(debug.getSourceOffsetsForMethod).toHaveBeenCalledWith(session, 999n);
    });

    // A collapsed Executed Code frame: a doit whose code contains blocks
    // produces several frames sharing the doit's home method, and filterStack
    // collapses those into the single DEEPEST doit frame — but execution
    // stopped in the TOP block (the user's halt). The highlight must use that
    // top frame's step point, not the collapsed doit frame's.
    describe('collapsed executed-code highlight (step-point highlight on the stop frame)', () => {
      // These overrides leak past clearAllMocks — restore the factory defaults.
      afterEach(() => {
        vi.mocked(debug.getStackDepth).mockImplementation(() => 5);
        vi.mocked(debug.getFrameInfo).mockImplementation(
          (_s: unknown, _p: unknown, level: number) => ({
            methodOop: BigInt(level),
            ipOffset: 5,
            receiverOop: BigInt(level * 100),
            argAndTempNames: [],
            argAndTempOops: [],
          }),
        );
        vi.mocked(debug.getMethodBlockInfo).mockImplementation(
          (_s: unknown, methodOop: bigint) => ({
            isBlock: methodOop === 1n,
            homeMethodOop: methodOop,
          }),
        );
        vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
          if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
          if (oop === 2n) return { className: 'Object', selector: 'halt' };
          return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
        });
        vi.mocked(debug.getMethodSource).mockImplementation(() => '| t | t := 6 * 7. t halt');
        vi.mocked(debug.getStepPoint).mockImplementation(() => 2);
        vi.mocked(debug.getSourceOffsetsForMethod).mockImplementation(() => [1, 8, 26]);
      });

      it('highlights the true stop frame, not the collapsed doit frame', async () => {
        // 3 frames, all sharing the doit's home method (oop 30n):
        //   level 1 — inner wrapper block, stopped at the user halt (step point 2)
        //   level 2 — outer wrapper block
        //   level 3 — the doit home (step point 5, out in the wrapper glue)
        vi.mocked(debug.getStackDepth).mockImplementation(() => 3);
        vi.mocked(debug.getFrameInfo).mockImplementation(
          (_s: unknown, _p: unknown, level: number) => ({
            methodOop: BigInt(level),
            ipOffset: 5,
            receiverOop: 100n,
            argAndTempNames: [],
            argAndTempOops: [],
          }),
        );
        // All three resolve to the same doit home (30n) → collapse to one frame.
        vi.mocked(debug.getMethodBlockInfo).mockImplementation(
          (_s: unknown, methodOop: bigint) => ({
            isBlock: methodOop !== 3n,
            homeMethodOop: 30n,
          }),
        );
        // No symbol-list entry and no resolvable class → executed code (a doit).
        vi.mocked(debug.getMethodInfo).mockImplementation(() => {
          throw new Error('doit');
        });
        vi.mocked(debug.getMethodSource).mockImplementation(
          () => '[Array new add: 1; halt; add: 2] value',
        );
        // Step point differs by frame: the stop frame (level 1) is at the halt;
        // the collapsed doit (level 3) is at the trailing `value` send.
        vi.mocked(debug.getStepPoint).mockImplementation(
          (_s: unknown, _p: unknown, level: number) => (level === 1 ? 2 : 5),
        );
        // Home-method offsets (1-based): sp 2 → 8 → col 7 (the halt);
        // sp 5 → 40 → col 39 (the `value` send).
        vi.mocked(debug.getSourceOffsetsForMethod).mockImplementation(() => [1, 8, 15, 22, 40]);

        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const panel = lastPanel();
        sendReady(panel);
        // filterStack collapses all three frames into one Executed Code frame.
        expect(initPayload(panel).stack).toHaveLength(1);

        sendMessage(panel, { command: 'selectFrame', level: 1 });
        await flush();

        // Highlight uses the STOP frame (level 1 → sp 2 → col 7), NOT the
        // collapsed doit frame (level 3 → sp 5 → col 39).
        const editor = await shownEditor();
        const range = stepPointRanges(editor)![0];
        expect(range.start.character).toBe(7);
        expect(editor.revealRange).toHaveBeenCalled();
      });
    });

    it('clears the highlight (no reveal) when there is no step point and no source line', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      vi.mocked(debug.getStepPoint).mockReturnValueOnce(0); // no step point (reveal)
      vi.mocked(debug.getLineForIp).mockReturnValueOnce(0); // unmapped IP   (reveal)
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      expect(stepPointRanges(editor)).toEqual([]);
      expect(editor.revealRange).not.toHaveBeenCalled();
    });

    it('clears the step-point highlight when the panel is closed', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();
      const editor = await shownEditor();
      vi.mocked(editor.setDecorations).mockClear();

      closePanel(panel);

      expect(editor.setDecorations).toHaveBeenCalledWith(expect.anything(), []);
    });

    // A source editor that reports a real view column (VS Code resolves Active/
    // Beside to one), so the panel can remember and target its source group.
    function columnedEditor(viewColumn: number) {
      return {
        document: {
          languageId: SMALLTALK_LANGUAGE,
          positionAt: (o: number) => new vscode.Position(0, o),
          getWordRangeAtPosition: () => undefined,
          lineAt: () => ({ firstNonWhitespaceCharacterIndex: 0 }),
        },
        viewColumn,
        setDecorations: vi.fn(),
        revealRange: vi.fn(),
      };
    }

    it('closes the companion source editor when the panel is closed', async () => {
      const panel = openPanelWithStack();
      // Set AFTER ready so these apply to the frame-3 reveal (not the stack walk):
      // a real gemstone:// method source, shown in source column 9.
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      // Same method also open in the user's System Browser (column 1) — must NOT
      // close. `label` only distinguishes the (structurally identical) tabs here.
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const browserTab = {
        label: 'browser',
        input: new vscode.TabInputText(vscode.Uri.parse(uri)),
      };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 1, tabs: [browserTab] }, { viewColumn: 9, tabs: [sourceTab] });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(sourceTab);
    });

    it('sweeps the emptied group only after the tabs have actually closed', async () => {
      // "Next macrotask" was a guess about when the closes had landed. Sweeping
      // early either spares the debugger's own group (the accumulation the sweep
      // exists to prevent) or catches a user's group mid-renumber.
      let releaseClose!: () => void;
      const closing = new Promise<void>((resolve) => (releaseClose = resolve));
      const panel = openPanelWithStack();
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 9, tabs: [sourceTab] });
      vi.mocked(vscode.window.tabGroups.close).mockImplementation((() => closing) as never);
      // Group closes are the ones passed a group (a viewColumn), not a tab.
      const sweeps = () =>
        vi
          .mocked(vscode.window.tabGroups.close)
          .mock.calls.filter((c) => (c[0] as { viewColumn?: number }).viewColumn !== undefined);
      try {
        closePanel(panel);
        await tick();
        await tick();
        expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(sourceTab);
        expect(sweeps()).toHaveLength(0); // the tab close is still in flight

        groups.length = 0;
        groups.push({ viewColumn: 9, tabs: [] }); // now it is really gone
        releaseClose();
        await tick();
        await tick();
        expect(sweeps().map((c) => (c[0] as { viewColumn: number }).viewColumn)).toContain(9);
      } finally {
        vi.mocked(vscode.window.tabGroups.close).mockReset();
      }
    });

    // Group closes are the ones passed a group (a viewColumn), not a tab.
    const groupCloses = () =>
      vi
        .mocked(vscode.window.tabGroups.close)
        .mock.calls.filter((c) => (c[0] as { viewColumn?: number }).viewColumn !== undefined)
        .map((c) => (c[0] as { viewColumn: number }).viewColumn);

    it('still sweeps the groups that emptied when a tab close rejects', async () => {
      // `tabGroups.close()` rejects outright for a tab that went away between our
      // scan and the close ("Tab close: Invalid tab not found!"). Abandoning the
      // sweep on that would strand every group that DID empty — and the sweep is
      // fire-and-forget from a dispose handler, so an unhandled rejection is all
      // anyone would ever see of it.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      const panel = openPanelWithStack();
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.length = 0;
      groups.push({ viewColumn: 1, tabs: [] }, { viewColumn: 9, tabs: [sourceTab] });
      vi.mocked(vscode.window.tabGroups.close).mockImplementation(((arg: {
        viewColumn?: number;
      }) =>
        arg.viewColumn === undefined
          ? Promise.reject(new Error('Tab close: Invalid tab not found!'))
          : Promise.resolve(true)) as never);
      try {
        closePanel(panel);
        await tick();
        await tick();

        // The panel's own group (column 1) is empty and gets retired regardless;
        // column 9 still holds the tab whose close failed, so it is left alone.
        expect(groupCloses()).toEqual([1]);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        vi.mocked(vscode.window.tabGroups.close).mockReset();
      }
    });

    it("retires its own empty group without waiting out a dirty tab's save prompt", async () => {
      // A DIRTY tab's close resolves only once the user answers the save/discard/
      // cancel dialog, so it stays pending for as long as the dialog stands. The
      // panel's group is empty and has nothing to save; it must not be held
      // hostage by that. The source group still holds the unsaved tab, so it is
      // not empty and is correctly left until the close actually lands.
      const panel = openPanelWithStack();
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      const dirtyTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.length = 0;
      groups.push({ viewColumn: 1, tabs: [] }, { viewColumn: 9, tabs: [dirtyTab] });
      let answerPrompt!: () => void;
      const prompt = new Promise<void>((resolve) => (answerPrompt = resolve));
      vi.mocked(vscode.window.tabGroups.close).mockImplementation((() => prompt) as never);
      vi.useFakeTimers();
      try {
        closePanel(panel);
        await vi.advanceTimersByTimeAsync(0);
        expect(groupCloses()).toEqual([]); // still inside the deadline

        await vi.advanceTimersByTimeAsync(2000);
        expect(groupCloses()).toEqual([1]); // the empty panel group, on its own

        groups.length = 0;
        groups.push({ viewColumn: 9, tabs: [] }); // discarded; the tab is gone
        answerPrompt();
        await vi.advanceTimersByTimeAsync(0);
        expect(groupCloses()).toEqual([1, 9]); // …and the source group follows
      } finally {
        vi.useRealTimers();
        vi.mocked(vscode.window.tabGroups.close).mockReset();
      }
    });

    it('closes nothing when the debugger never opened a source editor', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel); // no frame selected → no source opened
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({
        viewColumn: 9,
        tabs: [{ input: new vscode.TabInputText(vscode.Uri.parse('gemstone://1/x')) }],
      });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).not.toHaveBeenCalled();
    });

    it('still closes a read-only (gemstone-debug:) source even when the source column is unknown', async () => {
      // Default mock editor has no viewColumn → sourceColumn stays undefined. The
      // read-only scheme is unique to this debugger, so it's safe to close anywhere
      // (a shared gemstone:// would NOT be — see the previous test's column guard).
      const panel = openPanelWithStack(); // frame 3 → read-only (base getMethodUriInfo → undefined)
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.scheme).toBe('gemstone-debug');
      const tab = { input: new vscode.TabInputText(vscode.Uri.parse(uri.toString())) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 1, tabs: [tab] });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(tab);
    });

    it('closes the source editor AND every enhanced inspector it opened, together, on close', async () => {
      const panel = openPanelWithStack();
      // A real gemstone:// method source, shown in source column 9.
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      // Inspect two variables → two inspectors, each a closable handle.
      sendMessage(panel, { command: 'inspectVariable', oop: '300', name: 'self' });
      sendMessage(panel, { command: 'inspectVariable', oop: '901', name: 'total' });
      const inspectorCloses = vi
        .mocked(EnhancedInspector.create)
        .mock.results.map((r) => (r.value as { close: ReturnType<typeof vi.fn> }).close);
      expect(inspectorCloses).toHaveLength(2);

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 9, tabs: [sourceTab] });

      closePanel(panel);

      // The companion source tab is closed…
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(sourceTab);
      // …and BOTH inspectors are closed alongside it.
      for (const close of inspectorCloses) expect(close).toHaveBeenCalledTimes(1);
    });

    it('carves the panel/source pair in one setEditorLayout before any source opens', async () => {
      // The grid right after the panel opened into a new group at the end: the
      // user's editor column, then ours.
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const layout = { orientation: 0, groups: [{ size: 1200 }, { size: 400 }] };
      // Route getEditorLayout to our sample; everything else returns undefined.
      // mockImplementation persists past clearAllMocks, so restore it in finally.
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? layout : undefined),
      );
      try {
        const panel = openPanelWithStack();
        await flush();
        const applied = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.find((c) => c[0] === 'vscode.setEditorLayout')?.[1] as EditorGroupLayout;

        // One declared grid, applied before the source editor exists — not a
        // resize of a group that was split into place first.
        expect(applied).toBeDefined();
        // The pair opens sizeless (evenly split): the column's height isn't
        // knowable until it exists, so the panel's own measurement sizes it.
        expect(applied.groups[1].groups).toEqual([{}, {}]);
        expect(applied.groups[0].size).toBe(640); // the user's column, in pixels
        expect(applied.groups[1].size).toBe(960); // the debugger's 60%

        // The source then just opens into the group that carve created.
        vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
        sendMessage(panel, { command: 'selectFrame', level: 3 });
        await flush();
        expect(vscode.window.showTextDocument).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ viewColumn: 3 }),
        );
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    it('leaves the grid alone when it cannot be read', async () => {
      // getEditorLayout unavailable (older VS Code) → no wholesale rewrite of a
      // tree we could not inspect; the panel still has its own column.
      vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));
      try {
        openPanelWithStack();
        await flush();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
          'vscode.setEditorLayout',
          expect.anything(),
        );
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    // ── Orphaned companion source tabs across a VS Code window close ──────
    // The webview panel is NOT restored across a window close (no serializer),
    // but its companion source editor is a real text-editor tab, which VS Code
    // always restores — orphaned and broken (no live session to resolve
    // gemstone://). We persist the open source URIs to workspaceState and reap
    // the leftovers on the next activation.
    const ORPHAN_KEY = 'jasper.debugger.orphanSourceUris';
    function fakeMemento(initial: Record<string, unknown> = {}): vscode.Memento {
      const store = new Map<string, unknown>(Object.entries(initial));
      return {
        get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
        update: (key: string, val: unknown) => {
          if (val === undefined) store.delete(key);
          else store.set(key, val);
          return Promise.resolve();
        },
        keys: () => Array.from(store.keys()),
      };
    }

    it('reaps a debugger source tab a prior session left open, then re-arms the set', () => {
      const orphan = 'gemstone://1/UserGlobals/JasperDebugDemo/instance/accessing/finish';
      const memento = fakeMemento({ [ORPHAN_KEY]: [orphan] });
      const orphanTab = { input: new vscode.TabInputText(vscode.Uri.parse(orphan)) };
      // An unrelated tab the user opened independently (e.g. System Browser) — never ours.
      const otherTab = {
        input: new vscode.TabInputText(
          vscode.Uri.parse('gemstone://1/UserGlobals/Foo/instance/x/bar'),
        ),
      };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 1, tabs: [orphanTab, otherTab] });

      DebuggerPanel.initSourceTabCleanup(memento);

      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(orphanTab);
      // The set is re-armed (emptied) so this session starts tracking fresh.
      expect(memento.get(ORPHAN_KEY)).toBeUndefined();
    });

    it('persists an opened source URI so an abrupt window close can reap it next launch', async () => {
      const memento = fakeMemento();
      DebuggerPanel.initSourceTabCleanup(memento);
      const panel = openPanelWithStack();
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce({
        ...URI_INFO,
        selector: 'orphanProbeA',
      });
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      expect(uri).toContain('orphanProbeA'); // our just-opened source…
      expect(memento.get(ORPHAN_KEY) as string[]).toContain(uri); // …is now tracked for reaping.
    });

    it('drops the URI from the tracked set on a clean panel close (nothing to reap)', async () => {
      const memento = fakeMemento();
      DebuggerPanel.initSourceTabCleanup(memento);
      const panel = openPanelWithStack();
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce({
        ...URI_INFO,
        selector: 'orphanProbeB',
      });
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();
      const uri = (
        vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri
      ).toString();
      expect(memento.get(ORPHAN_KEY) as string[]).toContain(uri); // tracked while open…

      closePanel(panel);

      // …and dropped on a clean dispose, so the next launch has nothing to reap.
      expect(memento.get(ORPHAN_KEY) ?? []).not.toContain(uri);
    });

    // ── Double-click-to-edit inline values (#5 Phase 2) ───────────────────
    // Double-clicking an editable variable's name in the source (overlay on) opens
    // its set-value prompt — a direct selection handler, since hover command-links
    // don't fire in all hosts. A double-click selects the word; a single click
    // leaves an empty selection (the cursor, kept for Run to Cursor). These poke the
    // live panel's overlay state and fire the constructor-registered handler.
    describe('inline-value double-click-to-edit (#5 Phase 2)', () => {
      function liveInstance(): {
        sourceEditor: unknown;
        inlineValuesEnabled: boolean;
        inlineHoverLevel: number | undefined;
        inlineEditableByName: Map<string, { kind: 'instvar' | 'temp'; index: number }>;
      } {
        const panels = (DebuggerPanel as unknown as { panels: Map<number, Set<unknown>> }).panels;
        const all = [...panels.values()].flatMap((s) => [...s]);
        return all[all.length - 1] as never;
      }

      // The selection-change handler the panel registered in its constructor.
      function lastSelectionHandler(): (e: unknown) => void {
        const calls = vi.mocked(vscode.window.onDidChangeTextEditorSelection).mock.calls;
        return calls[calls.length - 1][0] as (e: unknown) => void;
      }

      // A source editor whose selected text is `word`, shown at `uri`.
      function editorWithWord(word: string, uri = 'gemstone-debug://1/Acct/instance/x/readFrom') {
        return { document: { uri: vscode.Uri.parse(uri), getText: vi.fn(() => word) } };
      }

      // Wire a panel for click-to-edit: `year` is an editable temp (write index 2).
      function setup(opts: { word?: string; enabled?: boolean; busy?: boolean } = {}) {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const handler = lastSelectionHandler();
        const editor = editorWithWord(opts.word ?? 'year');
        const inst = liveInstance();
        inst.sourceEditor = editor;
        inst.inlineValuesEnabled = opts.enabled ?? true;
        inst.inlineHoverLevel = 3;
        inst.inlineEditableByName = new Map([['year', { kind: 'temp', index: 2 }]]);
        if (opts.busy) (inst as unknown as { nbBusy: boolean }).nbBusy = true;
        return { handler, editor };
      }

      // A mouse selection event. empty:false (default) = a double-click word
      // selection; empty:true = a single-click cursor.
      function select(
        editor: unknown,
        over: { kind?: number; empty?: boolean; editor?: unknown } = {},
      ) {
        return {
          kind: over.kind ?? vscode.TextEditorSelectionChangeKind.Mouse,
          textEditor: 'editor' in over ? over.editor : editor,
          selections: [{ isEmpty: over.empty ?? false }],
        };
      }

      it('opens the prompt and writes when an editable variable is double-clicked', async () => {
        const { handler, editor } = setup();
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('99');
        vi.mocked(debug.evaluateInFrameToOop).mockReturnValueOnce(990n);

        handler(select(editor));
        await tick();

        expect(vscode.window.showInputBox).toHaveBeenCalled();
        expect(debug.setFrameTemp).toHaveBeenCalledWith(session, GS_PROCESS, 3, 2, 990n);
      });

      it('writes nothing when the prompt is cancelled', async () => {
        const { handler, editor } = setup();
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined); // Esc

        handler(select(editor));
        await tick();

        expect(debug.evaluateInFrameToOop).not.toHaveBeenCalled();
        expect(debug.setFrameTemp).not.toHaveBeenCalled();
      });

      it('writes nothing when the entered expression is blank', async () => {
        const { handler, editor } = setup();
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('   ');

        handler(select(editor));
        await tick();

        expect(debug.evaluateInFrameToOop).not.toHaveBeenCalled();
        expect(debug.setFrameTemp).not.toHaveBeenCalled();
      });

      it('surfaces a rejected expression as an error message', async () => {
        const { handler, editor } = setup();
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('bogus +');
        vi.mocked(debug.evaluateInFrameToOop).mockImplementationOnce(() => {
          throw new Error('a parse error');
        });

        handler(select(editor));
        await tick();

        expect(debug.setFrameTemp).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('a parse error'),
        );
      });

      it('refuses (no prompt) while a non-blocking step holds the session', async () => {
        const { handler, editor } = setup({ busy: true });

        handler(select(editor));
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        expect(debug.setFrameTemp).not.toHaveBeenCalled();
      });

      it('does nothing when the double-clicked word is not an editable variable', async () => {
        const { handler, editor } = setup({ word: 'asInteger' });

        handler(select(editor));
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      });

      it('leaves a single click alone (empty selection = the cursor for Run to Cursor)', async () => {
        const { handler, editor } = setup();

        handler(select(editor, { empty: true }));
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      });

      it('ignores a keyboard selection (only a mouse double-click edits)', async () => {
        const { handler, editor } = setup();

        handler(select(editor, { kind: vscode.TextEditorSelectionChangeKind.Keyboard }));
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      });

      it('does nothing while the inline overlay is off', async () => {
        const { handler, editor } = setup({ enabled: false });

        handler(select(editor));
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      });

      it('ignores selections in an editor other than the source pane', async () => {
        const { handler } = setup();

        handler(
          select(undefined, {
            editor: editorWithWord('year', 'gemstone-debug://1/Acct/instance/x/somethingElse'),
          }),
        );
        await tick();

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      });
    });
  });

  // The inline value+pencil is served by a registered HoverProvider (via the
  // static `provideInlineHover`), NOT the decoration's `hoverMessage` — command
  // links only fire from provider hovers. These poke the live panel's overlay
  // state directly (the map is normally filled by updateInlineValues from a real
  // source editor, which the headless editor mock can't supply).
  describe('inline-value hover provider (#5 Phase 2)', () => {
    // The most-recently-created live DebuggerPanel instance (held in the static
    // registry), so a test can seed its inline-overlay state.
    function liveInstance(): {
      shownSourceUris: Set<string>;
      sourceEditor: unknown;
      inlineValuesEnabled: boolean;
      inlineHoverByLine: Map<number, InlineVar[]>;
      inlineHoverLevel: number | undefined;
    } {
      const panels = (DebuggerPanel as unknown as { panels: Map<number, Set<unknown>> }).panels;
      const all = [...panels.values()].flatMap((s) => [...s]);
      return all[all.length - 1] as never;
    }

    // Seed a fresh panel's overlay for a UNIQUE source URI (so `panelForSourceUri`
    // resolves to this test's panel, not an undisposed one another test left in the
    // static registry). Returns the URI to hover. `sourceTag` overrides the panel's
    // CURRENT source (to exercise the stale-document guard).
    function seedOverlay(
      tag: string,
      vars: InlineVar[],
      opts: { enabled?: boolean; sourceTag?: string } = {},
    ): string {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const uri = `gemstone-debug://1/Acct/instance/accessing/${tag}`;
      const inst = liveInstance();
      inst.shownSourceUris.add(uri);
      const sourceUri = opts.sourceTag
        ? `gemstone-debug://1/Acct/instance/accessing/${opts.sourceTag}`
        : uri;
      inst.sourceEditor = { document: { uri: vscode.Uri.parse(sourceUri) } };
      inst.inlineValuesEnabled = opts.enabled ?? true;
      inst.inlineHoverLevel = 3;
      inst.inlineHoverByLine = new Map([[7, vars]]);
      return uri;
    }

    it('serves the value and a double-click-to-edit hint for an annotated line of the live source', () => {
      const uri = seedOverlay('serve', [
        { name: 'year', value: '2021', full: '2021', edit: { kind: 'temp', index: 2 } },
      ]);

      const md = DebuggerPanel.provideInlineHover(uri, 7);

      expect(md?.value).toContain('**year** = 2021');
      expect(md?.value).toContain('Double-click the variable name'); // edit hint, not a (dead) command-link
    });

    it('omits the edit hint for a read-only variable (self)', () => {
      const uri = seedOverlay('selfRo', [{ name: 'self', value: 'an Acct', full: 'an Acct' }]);

      const md = DebuggerPanel.provideInlineHover(uri, 7);

      expect(md?.value).toBe('**self** = an Acct');
      expect(md?.value).not.toContain('command:');
    });

    it('returns nothing when the inline overlay is off', () => {
      const uri = seedOverlay(
        'off',
        [{ name: 'year', value: '2021', full: '2021', edit: { kind: 'temp', index: 2 } }],
        { enabled: false },
      );

      expect(DebuggerPanel.provideInlineHover(uri, 7)).toBeUndefined();
    });

    it('returns nothing for a line with no annotated variable', () => {
      const uri = seedOverlay('noVar', [
        { name: 'year', value: '2021', full: '2021', edit: { kind: 'temp', index: 2 } },
      ]);

      expect(DebuggerPanel.provideInlineHover(uri, 99)).toBeUndefined();
    });

    it('returns nothing when the hovered document is not the panel’s live source', () => {
      // The overlay was computed for this URI, but the panel now shows a different
      // source — a stale map must not mislabel the other document.
      const uri = seedOverlay(
        'hovered',
        [{ name: 'year', value: '2021', full: '2021', edit: { kind: 'temp', index: 2 } }],
        { sourceTag: 'nowShowingOther' },
      );

      expect(DebuggerPanel.provideInlineHover(uri, 7)).toBeUndefined();
    });

    // The white-box tests above seed the overlay maps by hand; this one drives the
    // REAL updateInlineValues against a source editor so the population path itself
    // (frame vars → editable-by-name + per-line hover + decoration) is covered.
    it('updateInlineValues fills the editable + hover maps from the frame’s variables', () => {
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 3
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'argtemps', name: 'year', value: '<print 2021>', oop: '2021', index: 1 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const inst = liveInstance() as never as {
        shownSourceUris: Set<string>;
        sourceEditor: unknown;
        inlineValuesEnabled: boolean;
        inlineEditableByName: Map<string, { kind: string; index: number }>;
        updateInlineValues(editor: unknown, level: number): void;
      };
      const uri = 'gemstone-debug://1/Acct/instance/x/popMap';
      const src = '^year + 1';
      const editor = {
        document: {
          uri: vscode.Uri.parse(uri),
          getText: () => src,
          lineAt: (n: number) => ({ range: new vscode.Range(n, 0, n, src.length) }),
        },
        setDecorations: vi.fn(),
      };
      inst.shownSourceUris.add(uri);
      inst.sourceEditor = editor;
      inst.inlineValuesEnabled = true;

      inst.updateInlineValues(editor, 3);

      // The editable temp `year` (server write index 1) is indexed by name…
      expect(inst.inlineEditableByName.get('year')).toEqual({ kind: 'temp', index: 1 });
      // …a decoration was rendered…
      expect(editor.setDecorations).toHaveBeenCalled();
      // …and the hover provider now serves `year`'s value on its line.
      const hover = DebuggerPanel.provideInlineHover(uri, 0)?.value ?? '';
      expect(hover).toContain('**year**');
      expect(hover).toContain('2021');
    });
  });

  it('terminates the suspended gsProcess (via clearStack) when the panel window is closed', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();

    expect(debug.clearStack).not.toHaveBeenCalled();
    closePanel(panel);
    expect(debug.clearStack).toHaveBeenCalledWith(session, GS_PROCESS);
  });

  describe('variables / eval / toolbar', () => {
    // clearAllMocks() doesn't reset return values/implementations, so restore the
    // base getFrameInfo each test (a test that overrides it would otherwise leak).
    beforeEach(() => {
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: BigInt(level),
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
    });

    function openPanel() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('posts the selected frame variables, grouped (Receiver + Arguments & Temps with oops) on selectFrame', () => {
      // The one-trip query returns grouped rows; only level 2 carries temps.
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 2
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'argtemps', name: 'amount', value: '<print 11>', oop: '11', index: 1 },
                { group: 'argtemps', name: 'total', value: '<print 22>', oop: '22', index: 2 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      const receiver = groups.find((g: { kind: string }) => g.kind === 'receiver');
      expect(receiver.vars[0]).toEqual({ name: 'self', value: '<print 300>', oop: '300' });
      const argtemps = groups.find((g: { kind: string }) => g.kind === 'argtemps');
      expect(argtemps.vars).toEqual([
        { name: 'amount', value: '<print 11>', oop: '11', edit: { kind: 'temp', index: 1 } },
        { name: 'total', value: '<print 22>', oop: '22', edit: { kind: 'temp', index: 2 } },
      ]);
    });

    it('alphabetizes instVars and named args/temps while preserving each slot write index', () => {
      // Rows arrive in deliberately NON-alphabetical order to prove the client
      // sorts them for display while each keeps its server-assigned write index.
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 2
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'instvars', name: 'zebra', value: '<print 71>', oop: '71', index: 1 },
                { group: 'instvars', name: 'apple', value: '<print 72>', oop: '72', index: 2 },
                { group: 'argtemps', name: 'total', value: '<print 22>', oop: '22', index: 1 },
                { group: 'argtemps', name: 'amount', value: '<print 11>', oop: '11', index: 2 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      // instVars sorted apple < zebra; indices stay source-order (zebra=1, apple=2).
      expect(groups.find((g: { kind: string }) => g.kind === 'instvars').vars).toEqual([
        { name: 'apple', value: '<print 72>', oop: '72', edit: { kind: 'instvar', index: 2 } },
        { name: 'zebra', value: '<print 71>', oop: '71', edit: { kind: 'instvar', index: 1 } },
      ]);
      // Named args/temps sorted amount < total; indices stay source-order (total=1, amount=2).
      expect(groups.find((g: { kind: string }) => g.kind === 'argtemps').vars).toEqual([
        { name: 'amount', value: '<print 11>', oop: '11', edit: { kind: 'temp', index: 2 } },
        { name: 'total', value: '<print 22>', oop: '22', edit: { kind: 'temp', index: 1 } },
      ]);
    });

    it('splits named temps from the synthetic .tN eval-stack temps into a separate group', () => {
      // The server classifies `.tN` as group 'stacktemps' (read-only — no index).
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 2
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'argtemps', name: 'amount', value: '<print 11>', oop: '11', index: 1 },
                { group: 'stacktemps', name: '.t1', value: '<print 99>', oop: '99', index: 0 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      expect(groups.find((g: { kind: string }) => g.kind === 'argtemps').vars).toEqual([
        { name: 'amount', value: '<print 11>', oop: '11', edit: { kind: 'temp', index: 1 } },
      ]);
      const stack = groups.find((g: { kind: string }) => g.kind === 'stacktemps');
      expect(stack.collapsed).toBe(true);
      // Stack temps are NOT editable — the client leaves their edit metadata off.
      expect(stack.vars).toEqual([{ name: '.t1', value: '<print 99>', oop: '99' }]);
      expect(stack.vars[0].edit).toBeUndefined();
    });

    it('includes the receiver instance variables as their own group', () => {
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 3
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'instvars', name: 'count', value: '<print 7>', oop: '7', index: 1 },
                { group: 'instvars', name: 'sum', value: '<print 8>', oop: '8', index: 2 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 3 });

      const groups = lastPosted(panel, 'variables').groups;
      expect(groups.find((g: { kind: string }) => g.kind === 'instvars').vars).toEqual([
        { name: 'count', value: '<print 7>', oop: '7', edit: { kind: 'instvar', index: 1 } },
        { name: 'sum', value: '<print 8>', oop: '8', edit: { kind: 'instvar', index: 2 } },
      ]);
    });

    it('caches a frame’s variables — re-rendering it (e.g. toggling inline values) does not re-fetch', () => {
      const panel = openPanel();
      vi.mocked(debug.fetchFrameVariables).mockClear();
      // Two renders of the SAME frame (the path a toggle/overlay re-render takes).
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      expect(vi.mocked(debug.fetchFrameVariables)).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after the stack moves (cache invalidated on step)', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      vi.mocked(debug.fetchFrameVariables).mockClear();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await new Promise((r) => setTimeout(r, 0)); // let the non-blocking step settle
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      expect(vi.mocked(debug.fetchFrameVariables)).toHaveBeenCalled();
    });

    it('opens an enhanced inspector for a clicked variable when the session has one', () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'inspectVariable', oop: '300', name: 'self' });
      expect(EnhancedInspector.create).toHaveBeenCalledWith(session, 300n, 'self');
    });

    it('falls back to the sidebar Inspector for a clicked variable when the session has no enhanced inspector', () => {
      session.enhancedInspectorAvailable = false;
      const addRoot = vi.fn();
      DebuggerPanel.inspectorProvider = {
        addRoot,
      } as unknown as typeof DebuggerPanel.inspectorProvider;
      const panel = openPanel();

      sendMessage(panel, { command: 'inspectVariable', oop: '300', name: 'self' });

      expect(EnhancedInspector.create).not.toHaveBeenCalled();
      expect(addRoot).toHaveBeenCalledWith(1, 300n, 'self');
    });

    it('setVariable (instvar) evaluates the expr, writes via instVarAt:put:, refreshes, and reports ok', () => {
      vi.mocked(debug.evaluateInFrameToOop).mockReturnValueOnce(777n);
      const panel = openPanel();
      const before = posted(panel, 'variables').length;
      sendMessage(panel, {
        command: 'setVariable',
        level: 3,
        kind: 'instvar',
        index: 2,
        expr: '99',
      });

      expect(debug.evaluateInFrameToOop).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        '99',
        expect.any(Number),
      );
      expect(debug.setInstVar).toHaveBeenCalledWith(session, expect.any(BigInt), 2, 777n);
      // Re-fetched variables so every row's printString + OOP reflect the new object.
      expect(posted(panel, 'variables').length).toBe(before + 1);
      expect(lastPosted(panel, 'setVariableResult')).toEqual({
        command: 'setVariableResult',
        ok: true,
      });
    });

    it('setVariable (temp) writes via _frameAt:tempAt:put:, refreshes, and reports ok', () => {
      vi.mocked(debug.evaluateInFrameToOop).mockReturnValueOnce(555n);
      const panel = openPanel();
      const before = posted(panel, 'variables').length;
      sendMessage(panel, {
        command: 'setVariable',
        level: 3,
        kind: 'temp',
        index: 4,
        expr: 'self',
      });

      expect(debug.setFrameTemp).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        expect.any(Number),
        4,
        555n,
      );
      expect(debug.setInstVar).not.toHaveBeenCalled(); // a temp write must NOT touch instVars
      expect(posted(panel, 'variables').length).toBe(before + 1);
      expect(lastPosted(panel, 'setVariableResult')).toEqual({
        command: 'setVariableResult',
        ok: true,
      });
    });

    it('setVariable refuses (and reports !ok) while a non-blocking step is in flight', async () => {
      let release: (r: debug.StepResult) => void = () => {};
      vi.mocked(debug.stepOverNb).mockReturnValueOnce(
        new Promise<debug.StepResult>((res) => {
          release = res;
        }),
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 }); // holds the session's single GCI call
      await tick();

      sendMessage(panel, {
        command: 'setVariable',
        level: 3,
        kind: 'instvar',
        index: 1,
        expr: '99',
      });
      // A blocking frame write can't share the session with an in-flight step.
      expect(debug.evaluateInFrameToOop).not.toHaveBeenCalled();
      expect(debug.setInstVar).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'setVariableResult').ok).toBe(false);

      release({ completed: false }); // let the step settle
      await tick();
    });

    it('setVariable reports a compile/runtime error (and does NOT refresh) so the editor stays open', () => {
      vi.mocked(debug.evaluateInFrameToOop).mockImplementationOnce(() => {
        throw new Error('a parse error');
      });
      const panel = openPanel();
      const before = posted(panel, 'variables').length;
      sendMessage(panel, {
        command: 'setVariable',
        level: 3,
        kind: 'instvar',
        index: 1,
        expr: 'bogus +',
      });

      expect(debug.setInstVar).not.toHaveBeenCalled();
      expect(posted(panel, 'variables').length).toBe(before); // no refresh on failure
      const res = lastPosted(panel, 'setVariableResult');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('a parse error');
    });

    describe('variable revert (single-level undo)', () => {
      // A frame (level 2) with one named temp `amount` (#1, value oop 11) and a
      // receiver (300) with one instVar `count` (#1). getInstVarOop returns the
      // instVar's *original* oop (700) when captured before the first edit.
      beforeEach(() => {
        // The WRITE path still uses getFrameInfo (receiverOop) + getInstVarOop
        // (capture original); the PANE display now comes from fetchFrameVariables.
        vi.mocked(debug.getFrameInfo).mockImplementation(
          (_s: unknown, _p: unknown, level: number) =>
            level === 2
              ? {
                  methodOop: 2n,
                  ipOffset: 5,
                  receiverOop: 300n,
                  argAndTempNames: ['amount'],
                  argAndTempOops: [11n],
                }
              : {
                  methodOop: BigInt(level),
                  ipOffset: 5,
                  receiverOop: BigInt(level * 100),
                  argAndTempNames: [],
                  argAndTempOops: [],
                },
        );
        vi.mocked(debug.getInstVarOop).mockReturnValue(700n);
        vi.mocked(debug.fetchFrameVariables).mockImplementation(
          (_s: unknown, _p: unknown, level: number) =>
            level === 2
              ? [
                  { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                  { group: 'instvars', name: 'count', value: '<print 700>', oop: '700', index: 1 },
                  { group: 'argtemps', name: 'amount', value: '<print 11>', oop: '11', index: 1 },
                ]
              : [
                  {
                    group: 'receiver',
                    name: 'self',
                    value: `<print ${level * 100}>`,
                    oop: `${level * 100}`,
                    index: 0,
                  },
                ],
        );
      });

      // mockReturnValue is sticky past clearAllMocks; restore factory defaults so
      // these don't bleed into sibling tests (getFrameInfo is reset by the outer
      // beforeEach, so it's not listed here).
      afterEach(() => {
        vi.mocked(debug.getInstVarOop).mockReturnValue(700n);
        vi.mocked(debug.isSpecialOop).mockReturnValue(false);
        vi.mocked(debug.evaluateInFrameToOop).mockReturnValue(999n);
        vi.mocked(debug.continueExecution).mockReturnValue({ completed: true });
        vi.mocked(debug.fetchFrameVariables).mockImplementation(
          (_s: unknown, _p: unknown, level: number) => [
            {
              group: 'receiver',
              name: 'self',
              value: `<print ${level * 100}>`,
              oop: `${level * 100}`,
              index: 0,
            },
          ],
        );
      });

      const editInstVar = (panel: ReturnType<typeof lastPanel>, expr = '99') =>
        sendMessage(panel, { command: 'setVariable', level: 2, kind: 'instvar', index: 1, expr });

      it('captures + pins the original on the FIRST edit only (not on the second)', () => {
        vi.mocked(debug.evaluateInFrameToOop).mockReturnValue(999n);
        const panel = openPanel();
        editInstVar(panel, '99');
        editInstVar(panel, '123');

        expect(debug.getInstVarOop).toHaveBeenCalledTimes(1); // captured once
        expect(debug.saveObjs).toHaveBeenCalledTimes(1); // pinned once
        expect(debug.saveObjs).toHaveBeenCalledWith(session, [700n]); // the original oop
      });

      it('does NOT pin an immediate (special) original', () => {
        vi.mocked(debug.isSpecialOop).mockReturnValue(true);
        const panel = openPanel();
        editInstVar(panel);
        expect(debug.saveObjs).not.toHaveBeenCalled();
      });

      it('marks the edited row revertible (and only that row)', () => {
        const panel = openPanel();
        editInstVar(panel);
        const groups = lastPosted(panel, 'variables').groups;
        const count = groups.find((g: { kind: string }) => g.kind === 'instvars').vars[0];
        expect(count).toMatchObject({ name: 'count', revertible: true });
        // `self` (read-only) never becomes revertible.
        const self = groups.find((g: { kind: string }) => g.kind === 'receiver').vars[0];
        expect(self.revertible).toBeUndefined();
      });

      it('revertVariable writes the stored original back and clears the dirty flag', () => {
        const panel = openPanel();
        editInstVar(panel);
        sendMessage(panel, { command: 'revertVariable', level: 2, kind: 'instvar', index: 1 });

        // The LAST instVar write restores the original (700), not the edit (999).
        expect(debug.setInstVar).toHaveBeenLastCalledWith(session, 300n, 1, 700n);
        const count = lastPosted(panel, 'variables').groups.find(
          (g: { kind: string }) => g.kind === 'instvars',
        ).vars[0];
        expect(count.revertible).toBeUndefined(); // icon gone after revert
      });

      it('revertVariable on a slot with no recorded original is a no-op', () => {
        const panel = openPanel();
        sendMessage(panel, { command: 'revertVariable', level: 2, kind: 'instvar', index: 1 });
        expect(debug.setInstVar).not.toHaveBeenCalled();
      });

      it('reverts a frame temp via the original oop', () => {
        vi.mocked(debug.evaluateInFrameToOop).mockReturnValue(999n);
        const panel = openPanel();
        sendMessage(panel, {
          command: 'setVariable',
          level: 2,
          kind: 'temp',
          index: 1,
          expr: '99',
        });
        sendMessage(panel, { command: 'revertVariable', level: 2, kind: 'temp', index: 1 });

        // Original temp value (oop 11, from argAndTempOops[0]) written back.
        expect(debug.setFrameTemp).toHaveBeenLastCalledWith(
          session,
          GS_PROCESS,
          expect.any(Number),
          1,
          11n,
        );
      });

      it('releases pinned originals on Resume (leaving the halt)', () => {
        vi.mocked(debug.continueExecution).mockReturnValue({
          completed: false,
          errorMessage: 'next halt',
        });
        const panel = openPanel();
        editInstVar(panel); // pins 700
        sendMessage(panel, { command: 'resume' });
        expect(debug.releaseObjs).toHaveBeenCalledWith(session, [700n]);
      });

      it('releases pinned originals when the debugger is CLOSED (no export-set leak)', () => {
        const panel = openPanel();
        editInstVar(panel); // pins 700
        closePanel(panel); // user closes the debugger window
        expect(debug.releaseObjs).toHaveBeenCalledWith(session, [700n]);
      });

      it('releases pinned originals on Step (stack moved)', async () => {
        const panel = openPanel();
        editInstVar(panel); // pins 700
        sendMessage(panel, { command: 'stepOver', level: 2 });
        await tick();
        expect(debug.releaseObjs).toHaveBeenCalledWith(session, [700n]);
      });
    });

    it('evaluates an expression in the selected frame and posts the result', async () => {
      vi.mocked(debug.evaluateInFrameNb).mockResolvedValueOnce('1764');
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '42 * 42' });
      await tick();

      expect(debug.evaluateInFrameNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        '42 * 42',
        3,
        expect.objectContaining({ onStart: expect.any(Function) }),
      );
      expect(lastPosted(panel, 'evalResult')).toMatchObject({ value: '1764', isError: false });
    });

    it('reports an eval error without throwing', async () => {
      vi.mocked(debug.evaluateInFrameNb).mockRejectedValueOnce(new Error('doesNotUnderstand'));
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'foo bar' });
      await tick();

      expect(lastPosted(panel, 'evalResult')).toMatchObject({ isError: true });
      expect(lastPosted(panel, 'evalResult').value).toContain('doesNotUnderstand');
    });

    it('signals cancellable while a frame eval runs, then clears it', async () => {
      let release: (v: string) => void = () => {};
      vi.mocked(debug.evaluateInFrameNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[4] as { onStart?: (c: () => void) => void };
        opts.onStart?.(() => {}); // the nb call begins → cancellable
        return new Promise<string>((res) => {
          release = res;
        });
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '(1 to: 9e9) size' });
      await tick();

      expect(lastPosted(panel, 'cancellable')).toMatchObject({ on: true });

      release('done');
      await tick();
      expect(lastPosted(panel, 'cancellable')).toMatchObject({ on: false });
    });

    it('Cancel hits the running eval’s cancel handle', async () => {
      const cancelSpy = vi.fn();
      vi.mocked(debug.evaluateInFrameNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[4] as { onStart?: (c: () => void) => void };
        opts.onStart?.(cancelSpy); // the nb runner hands the panel its cancel fn
        return new Promise<string>(() => {}); // never settles — the op stays "running"
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '[true] whileTrue' });
      await tick();

      sendMessage(panel, { command: 'cancelOp' });

      expect(cancelSpy).toHaveBeenCalledTimes(1);
    });

    it('a cancelled eval shows "Evaluation Cancelled", the break kind, and the raw error', async () => {
      let rejectEval: (e: Error) => void = () => {};
      vi.mocked(debug.evaluateInFrameNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[4] as { onStart?: (c: () => void) => void };
        opts.onStart?.(() => {});
        return new Promise<string>((_res, rej) => {
          rejectEval = rej;
        });
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '[true] whileTrue' });
      await tick();

      sendMessage(panel, { command: 'cancelOp' }); // one click → soft break
      rejectEval(new Error('the operation was interrupted')); // gem stops with an interrupt
      await tick();

      const res = lastPosted(panel, 'evalResult');
      expect(res.value).toContain('Evaluation Cancelled');
      expect(res.value).toContain('soft break');
      expect(res.value).toContain('the operation was interrupted'); // raw error kept
      expect(res.isError).toBe(true);
    });

    it('labels a two-click eval cancel "(hard break)"', async () => {
      let rejectEval: (e: Error) => void = () => {};
      vi.mocked(debug.evaluateInFrameNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[4] as { onStart?: (c: () => void) => void };
        opts.onStart?.(() => {});
        return new Promise<string>((_res, rej) => {
          rejectEval = rej;
        });
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '[true] whileTrue' });
      await tick();

      sendMessage(panel, { command: 'cancelOp' }); // soft
      sendMessage(panel, { command: 'cancelOp' }); // hard
      rejectEval(new Error('forced'));
      await tick();

      expect(lastPosted(panel, 'evalResult').value).toContain('hard break');
    });

    it('ignores a second eval while one is already running (busy)', async () => {
      vi.mocked(debug.evaluateInFrameNb).mockReturnValueOnce(new Promise<string>(() => {})); // first hangs
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'first' });
      await tick();

      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'second' });
      await tick();

      expect(debug.evaluateInFrameNb).toHaveBeenCalledTimes(1); // the second was refused while busy
    });

    it('refuses a step while an eval is still running (shared nbBusy guard)', async () => {
      vi.mocked(debug.evaluateInFrameNb).mockReturnValueOnce(new Promise<string>(() => {})); // eval hangs
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'hang' });
      await tick();

      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      expect(debug.stepOverNb).not.toHaveBeenCalled();
    });

    it('refuses an eval while a step is still running (shared nbBusy guard)', async () => {
      vi.mocked(debug.stepOverNb).mockReturnValueOnce(new Promise(() => {})); // step hangs
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'x' });
      await tick();

      expect(debug.evaluateInFrameNb).not.toHaveBeenCalled();
    });

    it('does not mislabel a later eval setup error as cancelled after a prior cancel', async () => {
      // First eval: cancelled, so cancelClicks is bumped to 1.
      let rejectFirst: (e: Error) => void = () => {};
      vi.mocked(debug.evaluateInFrameNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[4] as { onStart?: (c: () => void) => void };
        opts.onStart?.(() => {});
        return new Promise<string>((_res, rej) => {
          rejectFirst = rej;
        });
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'first' });
      await tick();
      sendMessage(panel, { command: 'cancelOp' }); // cancelClicks → 1
      rejectFirst(new Error('interrupted'));
      await tick();

      // Second eval whose blocking SETUP fails before polling starts → onStart never
      // fires, so cancelClicks isn't reset there. The reset-at-entry guard must keep
      // the stale 1 from mislabeling this real error as a cancellation.
      vi.mocked(debug.evaluateInFrameNb).mockRejectedValueOnce(
        new Error('cannot create expression string'),
      );
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'second' });
      await tick();

      const res = lastPosted(panel, 'evalResult');
      expect(res.value).toContain('Error: cannot create expression string');
      expect(res.value).not.toContain('Cancelled');
    });

    it('Resume disposes the panel when execution completes', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
      const panel = openPanel();
      sendMessage(panel, { command: 'resume' });

      expect(debug.continueExecution).toHaveBeenCalledWith(session, GS_PROCESS);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('Resume refreshes with the new error when it hits another stop', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({
        completed: false,
        errorMessage: 'next error',
      });
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'resume' });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before + 1); // refreshed
      expect(lastPosted(panel, 'init').errorMessage).toBe('next error');
    });

    // Run to Cursor (#2): a Resume bracketed by a temporary step-point breakpoint at
    // the cursor's line in the (editable) source pane. The break is set, the
    // process continues, and the break is cleared afterward — unless the user owns
    // a break there. Non-breakable frames fall back to a plain Resume + flash.
    describe('Run to Cursor (#2)', () => {
      const RT_URI_INFO = {
        dictName: 'UserGlobals',
        className: 'JasperDebugDemo',
        isMeta: false,
        category: 'accessing',
        environmentId: 0,
        selector: 'accumulateFrom:to:',
      };
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

      beforeEach(() => {
        // No user breakpoints unless a test adds one (the mock array is shared).
        (vscode.debug as unknown as { breakpoints: unknown[] }).breakpoints = [];
      });

      // Open a panel whose frames are breakable (home method in the symbol list),
      // reveal frame 3's editable source, and place the cursor at (cursorLine0,
      // cursorChar0) (both 0-based). `source`/`offsets` default to a 3-line method
      // whose step points are at 1-based source offsets [3, 9, 14].
      async function openWithCursor(
        cursorLine0: number,
        cursorChar0 = 0,
        source = 'line1\nline2\nline3',
        offsets = [3, 9, 14],
      ) {
        vi.mocked(debug.getMethodUriInfo).mockReturnValue(RT_URI_INFO); // every frame breakable + editable
        vi.mocked(debug.getMethodSource).mockReturnValue(source);
        vi.mocked(debug.getSourceOffsetsForMethod).mockReturnValue(offsets);
        const panel = openPanel();
        sendMessage(panel, { command: 'selectFrame', level: 3 });
        await flush();
        const results = vi.mocked(vscode.window.showTextDocument).mock.results;
        const editor = await results[results.length - 1].value;
        // The mock doesn't wire the editor's uri to the opened doc — do it so the
        // "is the source pane showing this frame?" guard sees a match.
        editor.document.uri = vi
          .mocked(vscode.workspace.openTextDocument)
          .mock.calls.at(-1)![0] as vscode.Uri;
        editor.selection = new vscode.Selection(
          new vscode.Position(cursorLine0, cursorChar0),
          new vscode.Position(cursorLine0, cursorChar0),
        );
        return panel;
      }

      it('sets a temp break at the cursor step point, resumes, then clears it', async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        const panel = await openWithCursor(1); // line 2 → step point 2 (offset 9)
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          2,
        );
        expect(debug.continueExecution).toHaveBeenCalledWith(session, GS_PROCESS);
        // Cleared afterward (so it never lingers on the method) — same step point.
        expect(queries.clearBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          2,
        );
        expect(panel.dispose).toHaveBeenCalled(); // completed → closed
      });

      it('refreshes (stack/variables update) when the run re-halts at the cursor', async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({
          completed: false,
          errorMessage: '',
        });
        const panel = await openWithCursor(0); // line 1 → step point 1 (offset 3)
        const before = posted(panel, 'init').length;
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          1,
        );
        expect(queries.clearBreakAtStepPoint).toHaveBeenCalled();
        expect(panel.dispose).not.toHaveBeenCalled();
        expect(posted(panel, 'init').length).toBe(before + 1); // refreshed → variables re-fetch
      });

      it("does NOT clear a break the user already set at the cursor's step point", async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        const panel = await openWithCursor(1); // line 2 → actualLine 2 (0-based line 1)
        const openUri = vi
          .mocked(vscode.workspace.openTextDocument)
          .mock.calls.at(-1)![0] as vscode.Uri;
        (vscode.debug as unknown as { breakpoints: unknown[] }).breakpoints = [
          new vscode.SourceBreakpoint(
            new vscode.Location(openUri, new vscode.Range(1, 0, 1, 0)),
            true,
          ),
        ];
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).toHaveBeenCalled();
        expect(queries.clearBreakAtStepPoint).not.toHaveBeenCalled(); // it's the user's break
      });

      it('falls back to a flash + plain Resume when the source pane is not showing the frame', () => {
        // No selectFrame sent → no source editor revealed → no usable cursor target.
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        const panel = openPanel();
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).not.toHaveBeenCalled();
        expect(debug.setBreakAtStepPointByOop).not.toHaveBeenCalled();
        expect(lastPosted(panel, 'flash').text).toMatch(/cursor/i);
        expect(debug.continueExecution).toHaveBeenCalledWith(session, GS_PROCESS); // resumed anyway
      });

      // Executed Code (doit) frame: its anonymous GsNMethod has no class>>selector,
      // so the temp break is set/cleared BY OOP (debug.setBreakAtStepPointByOop).
      it('runs to cursor in a doit frame by setting + clearing the break by method OOP', async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        // A single-frame doit stack: getMethodInfo throws (no home class) → the frame
        // is "Executed Code"; source is shown read-only (gemstone-debug:), 1:1.
        vi.mocked(debug.getStackDepth).mockReturnValue(1);
        vi.mocked(debug.getFrameInfo).mockReturnValue({
          methodOop: 50n,
          ipOffset: 5,
          receiverOop: 0n,
          argAndTempNames: [],
          argAndTempOops: [],
        });
        vi.mocked(debug.getMethodBlockInfo).mockReturnValue({ isBlock: false, homeMethodOop: 50n });
        vi.mocked(debug.getMethodUriInfo).mockReturnValue(undefined);
        vi.mocked(debug.getMethodInfo).mockImplementation(() => {
          throw new Error('doit: nil inClass');
        });
        // Not wrapped → shift 0; offsets [3, 9, 14] like the editable case.
        vi.mocked(debug.getMethodSource).mockReturnValue('line1\nline2\nline3');
        vi.mocked(debug.getSourceOffsetsForMethod).mockReturnValue([3, 9, 14]);

        const panel = openPanel();
        sendMessage(panel, { command: 'selectFrame', level: 1 });
        await flush();
        const results = vi.mocked(vscode.window.showTextDocument).mock.results;
        const editor = await results[results.length - 1].value;
        editor.document.uri = vi
          .mocked(vscode.workspace.openTextDocument)
          .mock.calls.at(-1)![0] as vscode.Uri;
        editor.selection = new vscode.Selection(
          new vscode.Position(1, 0),
          new vscode.Position(1, 0),
        ); // line 2 → sp2

        sendMessage(panel, { command: 'runToCursor', level: 1 });

        // Break set + cleared BY OOP (50n) at step point 2; the class>>selector path is NOT used.
        expect(debug.setBreakAtStepPointByOop).toHaveBeenCalledWith(session, 50n, 2);
        expect(debug.clearBreakAtStepPointByOop).toHaveBeenCalledWith(session, 50n, 2);
        expect(queries.setBreakAtStepPoint).not.toHaveBeenCalled();
        expect(debug.continueExecution).toHaveBeenCalledWith(session, GS_PROCESS);
      });

      // Column-aware: the cursor's COLUMN picks the step point, not just its line.
      // `hdr\nself do: [:e | body ]`: line 2 holds step points for self (sp1@5),
      // do: (sp2@10) and the block body (sp3@20, all 1-based source offsets).
      it("breaks INSIDE a one-line block at the cursor column, not at the block's leftmost step point", async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        // Cursor at line 2 col 15 → offset 19 → nearest on-line step point is the
        // block body (sp3@20), NOT the leftmost self/do: (the old line-based bug).
        const panel = await openWithCursor(1, 15, 'hdr\nself do: [:e | body ]', [5, 10, 20]);
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          3,
        );
      });

      // The `minute := (...) asInteger` report: cursor on `asInteger` (late on the
      // line) must NOT snap to the `:=` store step point (leftmost on the line).
      it('breaks at the step point nearest the cursor column, not the leftmost on the line', async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        // `x := a asInteger` — sp1@1 (`x`, the store, col 0), sp2@6 (`a`, col 5),
        // sp3@8 (`asInteger`, col 7). Cursor on `asInteger` (col 7) → nearest sp3.
        const panel = await openWithCursor(0, 7, 'x := a asInteger', [1, 6, 8]);
        sendMessage(panel, { command: 'runToCursor', level: 3 });

        expect(queries.setBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          3,
        );
      });

      // A BLOCK frame: its own method (1n) differs from its HOME method (99n). The
      // displayed source IS the home method, so the break must target the HOME
      // (its `_sourceOffsets` + class>>selector), NOT the block's own method.
      it('runs to cursor on a block frame against its HOME method, not the block', async () => {
        vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
        vi.mocked(debug.getStackDepth).mockReturnValue(1);
        vi.mocked(debug.getFrameInfo).mockReturnValue({
          methodOop: 1n,
          ipOffset: 5,
          receiverOop: 300n,
          argAndTempNames: [],
          argAndTempOops: [],
        });
        // isBlock, with the enclosing (home) method a DIFFERENT oop (99n).
        vi.mocked(debug.getMethodBlockInfo).mockReturnValue({ isBlock: true, homeMethodOop: 99n });
        // Only the HOME method (99n) is an editable symbol-list method.
        vi.mocked(debug.getMethodUriInfo).mockImplementation((_s: unknown, oop: bigint) =>
          oop === 99n ? RT_URI_INFO : undefined,
        );
        vi.mocked(debug.getMethodSource).mockReturnValue('line1\nline2\nline3');
        vi.mocked(debug.getSourceOffsetsForMethod).mockReturnValue([3, 9, 14]);

        const panel = openPanel();
        sendMessage(panel, { command: 'selectFrame', level: 1 });
        await flush();
        const results = vi.mocked(vscode.window.showTextDocument).mock.results;
        const editor = await results[results.length - 1].value;
        editor.document.uri = vi
          .mocked(vscode.workspace.openTextDocument)
          .mock.calls.at(-1)![0] as vscode.Uri;
        editor.selection = new vscode.Selection(
          new vscode.Position(1, 0),
          new vscode.Position(1, 0),
        ); // line 2 → sp2

        sendMessage(panel, { command: 'runToCursor', level: 1 });

        // Resolved via the HOME method (99n): source/offsets fetched for 99n and the
        // break set by the home's class>>selector (a block-method break would be by OOP).
        expect(debug.getSourceOffsetsForMethod).toHaveBeenCalledWith(session, 99n);
        expect(queries.setBreakAtStepPoint).toHaveBeenCalledWith(
          session,
          'JasperDebugDemo',
          false,
          'accumulateFrom:to:',
          2,
        );
        expect(debug.setBreakAtStepPointByOop).not.toHaveBeenCalled();
      });
    });

    it('Step Over steps (non-blocking) from the selected user frame and refreshes, clearing the error banner', async () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'stepOver', level: 3 }); // display 3 → server level 3
      await tick();

      expect(debug.stepOverNb).toHaveBeenCalledWith(session, GS_PROCESS, 3, expect.anything());
      expect(posted(panel, 'init').length).toBe(before + 1);
      expect(lastPosted(panel, 'init').errorMessage).toBe('');
      expect(panel.dispose).not.toHaveBeenCalled();
    });

    // The step-at-halt fix: a Step on a collapsed "Executed Code" doit frame must
    // step from the TRUE stop frame (the nested wrapper block where the halt is),
    // not the collapsed doit-home level — else a single Step at a halt steps over
    // the whole user block and runs the process to completion (the reported bug).
    describe('step at a halt steps the stop frame, not the collapsed doit', () => {
      // These overrides leak past clearAllMocks — restore the factory defaults.
      afterEach(() => {
        vi.mocked(debug.getStackDepth).mockImplementation(() => 5);
        vi.mocked(debug.getMethodBlockInfo).mockImplementation(
          (_s: unknown, methodOop: bigint) => ({
            isBlock: methodOop === 1n,
            homeMethodOop: methodOop,
          }),
        );
        vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
          if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
          if (oop === 2n) return { className: 'Object', selector: 'halt' };
          return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
        });
      });

      // 3 frames all sharing the doit home (30n) → filterStack collapses them into
      // ONE Executed Code frame (serverLevel 3, the deepest). Execution actually
      // stopped in the top wrapper block (serverLevel 1, the user's halt).
      function setUpWrappedDoit() {
        vi.mocked(debug.getStackDepth).mockImplementation(() => 3);
        vi.mocked(debug.getFrameInfo).mockImplementation(
          (_s: unknown, _p: unknown, level: number) => ({
            methodOop: BigInt(level),
            ipOffset: 5,
            receiverOop: 100n,
            argAndTempNames: [],
            argAndTempOops: [],
          }),
        );
        vi.mocked(debug.getMethodBlockInfo).mockImplementation(
          (_s: unknown, methodOop: bigint) => ({
            isBlock: methodOop !== 3n,
            homeMethodOop: 30n,
          }),
        );
        vi.mocked(debug.getMethodInfo).mockImplementation(() => {
          throw new Error('doit');
        });
      }

      it('Step Over redirects from the collapsed doit (server level 3) to the stop frame (level 1)', async () => {
        setUpWrappedDoit();
        const panel = openPanel();
        expect(initPayload(panel).stack).toHaveLength(1); // collapsed to one frame
        sendMessage(panel, { command: 'stepOver', level: 1 }); // the single displayed frame
        await tick();
        // Without the fix this would step from the doit-home server level (3),
        // running the whole user block to completion; the stop frame is level 1.
        expect(debug.stepOverNb).toHaveBeenCalledWith(session, GS_PROCESS, 1, expect.anything());
      });

      it('Step Into likewise steps the stop frame, not the doit home', async () => {
        setUpWrappedDoit();
        const panel = openPanel();
        sendMessage(panel, { command: 'stepInto', level: 1 });
        await tick();
        expect(debug.stepIntoNb).toHaveBeenCalledWith(session, GS_PROCESS, 1, expect.anything());
      });

      it('Step Through likewise steps the stop frame, not the doit home', async () => {
        setUpWrappedDoit();
        const panel = openPanel();
        sendMessage(panel, { command: 'stepThrough', level: 1 });
        await tick();
        expect(debug.stepThruNb).toHaveBeenCalledWith(session, GS_PROCESS, 1, expect.anything());
      });
    });

    it('surfaces a clear message when a step hits native-code (error 6014), without disposing', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorMessage:
          'a ImproperOperation occurred (error 6014), Breakpoint and single-step not supported in native code',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/native code/i);
    });

    it('guides the user (no dispose, no refresh) when a step hits an unhandled halt (error 6011)', async () => {
      // Stepping OVER an unhandled halt drives the signal to _uncontinuableError
      // (rtErrUncontinuable = 6011). The process is dead-ended: don't refresh into
      // that machinery wall — keep the pre-step stack and steer to Terminate.
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorNumber: 6011,
        errorMessage: 'a UncontinuableError occurred (error 6011), reason:rtErrUncontinuable',
      });
      const panel = openPanel();
      vi.mocked(debug.getStackDepth).mockClear(); // refresh() re-walks the stack via fetchStack
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/Terminate/i);
      expect(debug.getStackDepth).not.toHaveBeenCalled(); // did NOT refresh into the new stack
    });

    it('once uncontinuable (6011), refuses a later Resume and Step with NO further GCI call (no growing message)', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorNumber: 6011,
        errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 }); // sets the uncontinuable flag
      await tick();

      // A retry must NOT hit the server again — that's what grows GemStone's
      // accumulating exception-chain message that Eric saw.
      vi.mocked(debug.continueExecution).mockClear();
      vi.mocked(debug.stepOverNb).mockClear();
      sendMessage(panel, { command: 'resume' });
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(debug.stepOverNb).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
    });

    it('Resume that hits 6011 shows the Terminate-only banner without refreshing', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({
        completed: false,
        errorNumber: 6011,
        errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'resume' });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before + 1); // postInit, not a stack refresh
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
    });

    it('re-enables Resume after an uncontinuable (6011) once a deeper frame is restarted', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorNumber: 6011,
        errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 }); // → uncontinuable
      await tick();
      sendMessage(panel, { command: 'restartFrame', level: 2 }); // deeper trim clears the flag
      await tick();
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        2,
        expect.anything(),
      );
      expect(debug.continueExecution).toHaveBeenCalled(); // no longer guarded
    });

    it('Step disposes the panel when the step completes the process', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({ completed: true });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('"Into" maps to gciStepInto (debugQueries.stepIntoNb), from the selected user frame', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepInto', level: 3 }); // display 3 → server level 3
      await tick();

      expect(debug.stepIntoNb).toHaveBeenCalledWith(session, GS_PROCESS, 3, expect.anything());
    });

    it('"Through" maps to gciStepThru (debugQueries.stepThruNb), from the selected user frame', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepThrough', level: 4 }); // display 4 → server level 4
      await tick();

      expect(debug.stepThruNb).toHaveBeenCalledWith(session, GS_PROCESS, 4, expect.anything());
    });

    it('Restart Frame trims the stack (non-blocking) to the selected (deeper) frame and refreshes', async () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'restartFrame', level: 2 });
      await tick();

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        2,
        expect.anything(),
      );
      expect(posted(panel, 'init').length).toBe(before + 1);
    });

    it('debugger nb ops suppress the 2s toast (the in-panel overlay owns cancel)', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      expect(debug.stepOverNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        3,
        expect.objectContaining({ suppressNotification: true }),
      );
    });

    it('a step marks the op cancellable, and Cancel breaks it', async () => {
      const cancelSpy = vi.fn();
      vi.mocked(debug.stepOverNb).mockImplementationOnce((...args: unknown[]) => {
        const opts = args[3] as { onStart?: (c: () => void) => void };
        opts.onStart?.(cancelSpy); // the nb step begins polling → cancellable
        return new Promise(() => {}); // never settles — the step "runs"
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      expect(lastPosted(panel, 'cancellable')).toMatchObject({ on: true });

      sendMessage(panel, { command: 'cancelOp' });
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(lastPosted(panel, 'flash').text).toMatch(/break sent/i); // click acknowledged

      sendMessage(panel, { command: 'cancelOp' });
      expect(cancelSpy).toHaveBeenCalledTimes(2);
      expect(lastPosted(panel, 'flash').text).toMatch(/forc/i); // second click → force
    });

    it('Restart Frame on the top frame shows an in-panel notice and does not trim (GemStone cannot reset the TOS IP)', async () => {
      const panel = openPanel();
      vi.mocked(debug.trimStackToLevelNb).mockClear();
      sendMessage(panel, { command: 'restartFrame', level: 1 }); // display 1 → server level 1 (top)
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/top frame/i);
    });

    it('Restart Frame on an Executed Code (doit) frame shows a notice and does not trim (kernel cannot reset a classless frame)', async () => {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 2);
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => ({
        isBlock: false,
        homeMethodOop: methodOop,
      }));
      // Top frame is a real method; the deeper frame is a doit (its method can't be
      // resolved → Executed Code), like `<expr> halt` stepped into a real method.
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'initialize' };
        throw new Error('doit');
      });
      const panel = openPanel();
      vi.mocked(debug.trimStackToLevelNb).mockClear();

      sendMessage(panel, { command: 'restartFrame', level: 2 }); // the Executed Code frame
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/Executed Code/i);
    });

    it('Terminate disposes the panel', () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'terminate' });

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('hands the completed result to onComplete on Resume, then disposes', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true, resultOop: 0x55n });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'resume' });

      expect(onComplete).toHaveBeenCalledWith(0x55n);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('hands the completed result to onComplete on step-to-completion', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({ completed: true, resultOop: 0x66n });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(onComplete).toHaveBeenCalledWith(0x66n);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('does NOT call onComplete when Resume hits another error (refreshes instead)', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({
        completed: false,
        errorMessage: 'boom2',
      });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'resume' });

      expect(onComplete).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
    });

    it('does NOT silently drop a second op while one is in flight — it posts a busy notice', async () => {
      let release: (r: debug.StepResult) => void = () => {};
      vi.mocked(debug.stepOverNb).mockReturnValueOnce(
        new Promise<debug.StepResult>((res) => {
          release = res;
        }),
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 }); // starts, stays pending
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(1);

      sendMessage(panel, { command: 'stepOver', level: 3 }); // while the first is in flight
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(1); // not started again
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/still running/i); // user is told

      release({ completed: false }); // let the first finish so the panel settles
      await tick();
    });

    it('releases the in-flight guard after a FAILED op so the next op still runs (no permanent wedge)', async () => {
      vi.mocked(debug.stepOverNb).mockRejectedValueOnce(new Error('boom'));
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/failed/i);

      sendMessage(panel, { command: 'stepOver', level: 3 }); // guard must be released
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(2);
    });
  });

  describe('edit-and-continue (save companion source)', () => {
    // Let revealFrameSource's awaited openTextDocument/showTextDocument settle so
    // editableSourceUri is set before we fire the save.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const URI_INFO = {
      dictName: 'UserGlobals',
      className: 'JasperDebugDemo',
      isMeta: false,
      category: 'accessing',
      environmentId: 0,
      selector: 'accumulateFrom:to:',
    };

    beforeEach(() => {
      // Restore the base getFrameInfo (mockImplementation leaks past clearAllMocks).
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: BigInt(level),
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
    });

    /** The save listener the panel registered in its constructor. */
    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    /**
     * Open a panel, load the 5-frame stack, and select `displayLevel` as an
     * EDITABLE gemstone:// frame (URI_INFO supplied to the single reveal). Returns
     * the panel and the source URI the panel opened (== the doc the user saves).
     */
    async function openWithEditableFrame(displayLevel: number) {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel); // fetchStack uses the base (undefined URI) mocks
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // for the reveal only
      sendMessage(panel, { command: 'selectFrame', level: displayLevel });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      return { panel, uri };
    }

    it('re-enters the selected (deeper) frame when its source is saved and recompiled', async () => {
      const { panel, uri } = await openWithEditableFrame(3); // display 3 → server level 3
      const before = posted(panel, 'init').length;
      saveListener()({ uri } as vscode.TextDocument);
      await tick(); // editAndContinue awaits the non-blocking trim

      // trimStackToLevel installs the recompiled method + resets the frame to its
      // first instruction (the old activation held the pre-edit GsNMethod).
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(posted(panel, 'init').length).toBe(before + 1); // refreshed
    });

    it('does NOT re-enter when the recompile failed (GemStone error diagnostic on the URI)', async () => {
      const { panel, uri } = await openWithEditableFrame(3);
      // getDiagnostics is overloaded ([Uri, Diagnostic[]][] | Diagnostic[]); cast
      // past the union to the single-URI Diagnostic[] shape the panel calls with.
      vi.mocked(vscode.languages.getDiagnostics).mockReturnValueOnce([
        { severity: vscode.DiagnosticSeverity.Error },
      ] as never);
      const before = posted(panel, 'init').length;
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before); // no refresh
    });

    it('ignores a save of some OTHER document (not the selected frame source)', async () => {
      const { panel } = await openWithEditableFrame(3);
      const before = posted(panel, 'init').length;
      saveListener()({
        uri: vscode.Uri.parse('gemstone://1/Other/Foo/instance/x/bar'),
      } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before);
    });

    it('ignores a save when the selected frame is read-only (no editable gemstone:// source)', async () => {
      // Frame 3 with the base (undefined URI) mocks resolves read-only.
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
    });

    it('shows an in-panel notice and does NOT trim when the edited frame is the top frame', async () => {
      const { panel, uri } = await openWithEditableFrame(1); // display 1 → server level 1 (top)
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/top frame/i);
    });

    it('BLOCKS Resume after a top-frame recompile (continuing the stale activation would hang the gem)', async () => {
      const { panel, uri } = await openWithEditableFrame(1); // top frame → stale activation
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/recompiled/i);
    });

    it('BLOCKS Step after a top-frame recompile', async () => {
      const { panel, uri } = await openWithEditableFrame(1);
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      vi.mocked(debug.stepOverNb).mockClear();
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(debug.stepOverNb).not.toHaveBeenCalled();
    });

    it('re-enables Resume once a deeper frame is restarted (the trim discards the stale activation)', async () => {
      const { panel, uri } = await openWithEditableFrame(1);
      saveListener()({ uri } as vscode.TextDocument); // stale top activation (sync guard)
      await tick();
      sendMessage(panel, { command: 'restartFrame', level: 2 }); // deeper trim clears it
      await tick(); // let the async trim settle
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        2,
        expect.anything(),
      );
      expect(debug.continueExecution).toHaveBeenCalled(); // no longer blocked
    });
  });

  // A block frame can't be restarted / re-entered on its own — Restart Frame,
  // edit-and-continue, and the "Go to home method" navigation item all target its
  // HOME method's activation, which always sits DEEPER on the stack. Models
  // `JasperDebugDemo>>finish` running a block:
  //   server 1 — `[] in JasperDebugDemo>>finish`  (block; home method oop 10n)
  //   server 2 — `Collection>>do:`                (kernel)
  //   server 3 — `JasperDebugDemo>>finish`        (the block's HOME method; oop 10n)
  //   server 4 — `JasperDebugDemo>>run`           (the caller)
  describe('block-frame home method (navigate / restart / re-enter)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const URI_INFO = {
      dictName: 'UserGlobals',
      className: 'JasperDebugDemo',
      isMeta: false,
      category: 'running',
      environmentId: 0,
      selector: 'finish',
    };

    // mockImplementation leaks past clearAllMocks — restore the factory defaults.
    afterEach(() => {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 5);
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: BigInt(level),
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => ({
        isBlock: methodOop === 1n,
        homeMethodOop: methodOop,
      }));
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
    });

    /**
     * Configure the 4-frame block stack above. `blockHomeOop` is the block
     * frame's home method oop — 10n (the `finish` frame at server 3 IS on the
     * stack) by default, or something absent (e.g. 99n) to model a stored block
     * invoked after its home method already returned.
     */
    function openBlockStack(blockHomeOop = 10n) {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 4);
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: level === 3 ? 10n : BigInt(level), // the home method's own activation
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => ({
        isBlock: methodOop === 1n,
        homeMethodOop: methodOop === 1n ? blockHomeOop : methodOop,
      }));
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 10n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Collection', selector: 'do:' };
        if (oop === 4n) return { className: 'JasperDebugDemo', selector: 'run' };
        return { className: 'JasperDebugDemo', selector: 'finish' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('tells the webview the block frame can navigate to its home method (display level 3)', () => {
      const panel = openBlockStack();
      const stack = initPayload(panel).stack;

      // The block frame is display 1; its home method `finish` is display 3.
      expect(stack[0].homeDisplayLevel).toBe(3);
      // The home method frame, and the plain frames, offer no such navigation.
      expect(stack[2].homeDisplayLevel).toBeUndefined();
      expect(stack[1].homeDisplayLevel).toBeUndefined();
      expect(stack[3].homeDisplayLevel).toBeUndefined();
    });

    it("offers no home navigation when the block's home method has already returned", () => {
      const panel = openBlockStack(99n); // home oop not present on the stack
      expect(initPayload(panel).stack[0].homeDisplayLevel).toBeUndefined();
    });

    it('Restart on a block frame re-runs its HOME method (trims to the deeper home activation)', async () => {
      const panel = openBlockStack();
      sendMessage(panel, { command: 'restartFrame', level: 1 }); // the top block frame
      await tick();

      // Retargeted from the block (server 1) to its home method (server 3) — so it
      // trims there, NOT refusing as it would for a genuine top frame.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        3,
        expect.anything(),
      );
      expect(lastPosted(panel, 'init').errorMessage).not.toMatch(/top frame/i);
    });

    it('Restart on a block frame whose home already returned falls back to the top-frame notice', async () => {
      const panel = openBlockStack(99n); // no home activation to retarget to
      vi.mocked(debug.trimStackToLevelNb).mockClear();
      sendMessage(panel, { command: 'restartFrame', level: 1 });
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/top frame/i);
    });

    it("Saving a block frame's (home-method) source re-enters at the home activation", async () => {
      const panel = openBlockStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // the reveal → editable
      sendMessage(panel, { command: 'selectFrame', level: 1 }); // select the block frame
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      const saveListener = vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
      saveListener({ uri } as vscode.TextDocument);
      await tick();

      // Re-enters the HOME method (server 3), not the block (server 1) — and so
      // never marks the activation stale the way a true top-frame edit would.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(lastPosted(panel, 'init').errorMessage).not.toMatch(/recompiled/i);
    });

    // Several blocks nested inside ONE method (GemStone's `homeMethod` resolves
    // transitively, so EVERY nested block's homeMethodOop is the outermost method,
    // not its lexically-enclosing block). The home activation is the single
    // non-block `foo` frame at the very bottom; every block must resolve to it.
    //   server 1 — `[] in foo`  (innermost block; home oop 100n)
    //   server 2 — `Collection>>do:`
    //   server 3 — `[] in foo`  (middle block;    home oop 100n)
    //   server 4 — `Collection>>do:`
    //   server 5 — `[] in foo`  (outermost block; home oop 100n)
    //   server 6 — `Collection>>do:`
    //   server 7 — `JasperDebugDemo>>foo`  (the shared HOME method; oop 100n)
    function openNestedBlockStack() {
      const HOME = 100n;
      vi.mocked(debug.getStackDepth).mockImplementation(() => 7);
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: level === 7 ? HOME : BigInt(level), // the home method's own activation
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
      // Odd levels 1/3/5 are the nested blocks; all share the one home method.
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => {
        const isBlock = methodOop === 1n || methodOop === 3n || methodOop === 5n;
        return { isBlock, homeMethodOop: isBlock ? HOME : methodOop };
      });
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === HOME) return { className: 'JasperDebugDemo', selector: 'foo' };
        return { className: 'Collection', selector: 'do:' }; // the even (kernel) frames
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('points every nested block frame at the SAME home method frame (display level 7)', () => {
      const panel = openNestedBlockStack();
      const stack = initPayload(panel).stack;

      // All three blocks (display 1, 3, 5) navigate to the one `foo` frame (7).
      expect(stack[0].homeDisplayLevel).toBe(7);
      expect(stack[2].homeDisplayLevel).toBe(7);
      expect(stack[4].homeDisplayLevel).toBe(7);
      // The kernel `do:` frames and the home method itself offer no navigation.
      expect(stack[1].homeDisplayLevel).toBeUndefined();
      expect(stack[3].homeDisplayLevel).toBeUndefined();
      expect(stack[5].homeDisplayLevel).toBeUndefined();
      expect(stack[6].homeDisplayLevel).toBeUndefined();
    });

    it('Restart from the INNERMOST nested block re-runs the shared home method (trims to 7)', async () => {
      const panel = openNestedBlockStack();
      sendMessage(panel, { command: 'restartFrame', level: 1 });
      await tick();

      // The whole home method re-runs from the top — the inner AND outer blocks
      // above the home frame are all discarded by the trim.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        7,
        expect.anything(),
      );
      expect(lastPosted(panel, 'init').errorMessage).not.toMatch(/top frame/i);
    });

    it('Restart from an OUTER nested block resolves to the same home method (not the inner block)', async () => {
      const panel = openNestedBlockStack();
      sendMessage(panel, { command: 'restartFrame', level: 5 }); // the outermost block
      await tick();

      // homeMethodFrameLevel skips the deeper kernel frame and lands on `foo` (7),
      // never on the still-deeper nothing — there's exactly one home activation.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        7,
        expect.anything(),
      );
    });

    it('Saving from a nested block re-enters the shared home method (trims to 7)', async () => {
      const panel = openNestedBlockStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // reveal → editable
      sendMessage(panel, { command: 'selectFrame', level: 3 }); // select the middle block
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      const saveListener = vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
      saveListener({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 7);
    });

    // A block sitting MID-stack (a frame above it, its home below) — the case
    // where the old code already "worked" by restarting the block in place. The
    // retarget changes that: it re-runs the whole home method instead.
    //   server 1 — `SomeClass>>callee`   (a method the block called → above it)
    //   server 2 — `[] in foo`           (the block; home oop 10n)
    //   server 3 — `Collection>>do:`
    //   server 4 — `JasperDebugDemo>>foo` (the block's HOME method; oop 10n)
    function openMidBlockStack() {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 4);
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: level === 4 ? 10n : BigInt(level), // home activation is server 4
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => ({
        isBlock: methodOop === 2n, // only the mid frame is a block
        homeMethodOop: methodOop === 2n ? 10n : methodOop,
      }));
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 10n) return { className: 'JasperDebugDemo', selector: 'foo' };
        if (oop === 1n) return { className: 'SomeClass', selector: 'callee' };
        return { className: 'Collection', selector: 'do:' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('Restart from a MID-stack block re-runs the home method, not the block in place', async () => {
      const panel = openMidBlockStack();
      sendMessage(panel, { command: 'restartFrame', level: 2 }); // the mid-stack block
      await tick();

      // Retargets DOWN to the home method (server 4) — NOT a trim to the block's
      // own level (2), which would merely restart the block in place (the old
      // behaviour, before block frames retargeted to their home method).
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        4,
        expect.anything(),
      );
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalledWith(session, GS_PROCESS, 2);
    });

    // Recursion: the SAME home METHOD (`foo`) is on the stack more than once, each
    // activation owning its own block. A block's home activation is the NEAREST
    // `foo` BELOW it — restart/re-enter must re-run THAT activation, not the
    // deepest `foo` (which would discard a whole extra recursion level). This is
    // the case that separates "nearest below" from a naive "deepest match".
    //   server 1 — `[] in foo`  (block of the INNER foo; home oop 100n)
    //   server 2 — `Collection>>do:`
    //   server 3 — `JasperDebugDemo>>foo`  (inner activation; oop 100n)
    //   server 4 — `[] in foo`  (block of the OUTER foo; home oop 100n)
    //   server 5 — `Collection>>do:`
    //   server 6 — `JasperDebugDemo>>foo`  (outer activation; oop 100n)
    function openRecursiveBlockStack() {
      const HOME = 100n;
      vi.mocked(debug.getStackDepth).mockImplementation(() => 6);
      vi.mocked(debug.getFrameInfo).mockImplementation(
        (_s: unknown, _p: unknown, level: number) => ({
          methodOop: level === 3 || level === 6 ? HOME : BigInt(level), // two `foo` activations
          ipOffset: 5,
          receiverOop: BigInt(level * 100),
          argAndTempNames: [],
          argAndTempOops: [],
        }),
      );
      vi.mocked(debug.getMethodBlockInfo).mockImplementation((_s: unknown, methodOop: bigint) => {
        const isBlock = methodOop === 1n || methodOop === 4n;
        return { isBlock, homeMethodOop: isBlock ? HOME : methodOop };
      });
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === HOME) return { className: 'JasperDebugDemo', selector: 'foo' };
        return { className: 'Collection', selector: 'do:' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('resolves each recursive block to its NEAREST home activation, not the deepest', () => {
      const stack = initPayload(openRecursiveBlockStack()).stack;
      // Inner block (display 1) → inner foo (3); outer block (display 4) → outer foo
      // (6). Both share the home METHOD oop, but navigate to DIFFERENT activations.
      expect(stack[0].homeDisplayLevel).toBe(3);
      expect(stack[3].homeDisplayLevel).toBe(6);
    });

    it('Restart from a recursive block re-runs its OWN (nearest) home activation', async () => {
      const panel = openRecursiveBlockStack();
      sendMessage(panel, { command: 'restartFrame', level: 1 }); // the inner block
      await tick();

      // Trims to the inner foo (server 3), NOT the deeper outer foo (server 6) —
      // restarting the inner recursion level, not unwinding an extra one.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(
        session,
        GS_PROCESS,
        3,
        expect.anything(),
      );
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalledWith(session, GS_PROCESS, 6);
    });
  });

  describe('create-method-from-DNU', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const DNU = {
      className: 'JasperDebugDemo',
      isMeta: false,
      dictName: 'UserGlobals',
      selector: 'fourtyTwo:bar:',
      argCount: 2,
    };

    // getDoesNotUnderstandInfo's mockReturnValue persists past clearAllMocks, so
    // restore "not a DNU" afterwards to keep later describes isolated.
    afterEach(() => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
      // getMethodInfo overrides below leak past clearAllMocks — restore the base.
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
    });

    /**
     * Open a panel parked on a doesNotUnderstand:. By default the top two frames
     * are DNU machinery (defaultAction, doesNotUnderstand:) so they're trimmed and
     * the topmost DISPLAYED frame — the re-enterable sender — is server level 3.
     */
    function openWithDnu() {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(DNU);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'MessageNotUnderstood', selector: 'defaultAction' };
        if (oop === 2n) return { className: 'Object', selector: 'doesNotUnderstand:' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    it('includes the DNU info in the init payload when parked on a doesNotUnderstand:', () => {
      const panel = openWithDnu();
      expect(initPayload(panel).dnu).toEqual({
        selector: 'fourtyTwo:bar:',
        className: 'JasperDebugDemo',
        isMeta: false,
      });
    });

    it('omits dnu from the init payload when not a DNU', () => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      expect(initPayload(panel).dnu).toBeUndefined();
    });

    it('opens a pre-filled new-method template BELOW the panel and hints to fill+save', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      // gemstone:// new-method URI for the receiver's class/dict (the FS provider
      // serves the template; the selector is parsed from the saved source).
      expect(uri.toString()).toContain('/UserGlobals/JasperDebugDemo/instance/');
      expect(uri.toString()).toContain('new-method');
      // Opened in the companion source group below the panel, like frame source.
      expect(vscode.window.showTextDocument).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preserveFocus: false }),
      );
      // The generic template was replaced with the real signature + body stub.
      const editor = await vi.mocked(vscode.window.showTextDocument).mock.results.at(-1)!.value;
      expect(editor.edit).toHaveBeenCalled();
      // A lightweight banner update (NOT a full init, which would re-select the top
      // frame and steal focus from the new-method editor) tells the user to fill in
      // + save (Ctrl+S). The Create button is gone (no init re-render needed).
      expect(lastPosted(panel, 'banner').text).toMatch(/save.*Ctrl/i);
      expect(posted(panel, 'init').length).toBe(1); // only the original ready init
    });

    it('re-enters the sender frame (trim, NOT resume) on a clean compile, leaving Resume to the user', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      // Trim re-enters the sender (server level 3, below the trimmed DNU machinery)
      // so the user's next Resume re-runs the send. We must NOT auto-resume — the
      // blocking continueExecution of a parked DNU hung the gem and crashed the host.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/resume/i);
    });

    it('closes the created method tab on debugger close (FS-provider URI form, : not %3A)', async () => {
      const panel = openWithDnu();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      // The FS provider swaps the template tab to this real method URI on save —
      // built via vscode.Uri.from (keyword ':' left un-encoded). closeSourceEditors
      // must match THIS form; buildMethodSourceUri's %3A encoding would not, and the
      // tab would linger ("stuck around"). Guards that regression.
      const compiledUri = vscode.Uri.from({
        scheme: 'gemstone',
        authority: '1',
        path: '/UserGlobals/JasperDebugDemo/instance/as yet unclassified/fourtyTwo:bar:',
      });
      const methodTab = { label: 'fourtyTwo:bar:', input: new vscode.TabInputText(compiledUri) };
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.push({ viewColumn: 9, tabs: [methodTab] });

      closePanel(panel);
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(methodTab);
    });

    it('does NOT trim (and keeps the template pending) when the compile fails', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      vi.mocked(vscode.languages.getDiagnostics).mockReturnValueOnce([
        { severity: vscode.DiagnosticSeverity.Error },
      ] as never);
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();

      // Re-save after fixing (clean diagnostics) — the pending state survived.
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
    });

    it('does NOT trim a workspace/Executed Code sender — tells the user to re-run', async () => {
      // All frames resolve as Executed Code (no class) → the sender can't be
      // re-entered (kernel trim sends compiledMethodAt: to nil); never attempt it.
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(DNU);
      vi.mocked(debug.getMethodInfo).mockImplementation(() => {
        throw new Error('doit: no class');
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(debug.continueExecution).not.toHaveBeenCalled();
      // Doesn't trim, but DOES tell the user to Resume (manual Resume works — the
      // kernel's defaultAction re-performs the send). Must NOT auto-resume.
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/resume/i);
    });

    it('refuses to create when the class has no home dictionary (not in the symbol list)', async () => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue({ ...DNU, dictName: '' });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();

      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/symbol list/i);
    });

    it('keeps the Create button suppressed once a create is underway (re-detect returns it)', async () => {
      const panel = openWithDnu();
      expect(initPayload(panel).dnu).toBeDefined(); // shown initially
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      // A refresh while editing must NOT re-offer the button (method-in-progress).
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();
      expect(lastPosted(panel, 'init').dnu).toBeUndefined();
    });
  });

  describe('implement in receiver (override)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    // getMethodInfo overrides (in the doit-sender test) leak past clearAllMocks —
    // restore the base so later tests see the standard 5-frame stack.
    afterEach(() => {
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
    });

    // The base stack's level-2 frame is an inherited method: receiver is a
    // SmallInteger (oop 200) while the method (#halt) is defined in Object.
    function openPanel() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    it('marks an inherited-method frame overridable, carrying the receiver class', () => {
      const overridable = initPayload(openPanel()).stack.find(
        (f: { overridable?: boolean }) => f.overridable,
      );
      expect(overridable.receiverClass).toBe('SmallInteger'); // the receiver's class…
      expect(overridable.label).toContain('Object'); // …while the method lives in Object
    });

    it('does NOT mark a frame overridable when the receiver IS the defining class', () => {
      const selfFrames = initPayload(openPanel()).stack.filter(
        (f: { receiverClass?: string }) => f.receiverClass === 'JasperDebugDemo',
      );
      expect(selfFrames.length).toBeGreaterThan(0);
      for (const f of selfFrames) expect(f.overridable).toBe(false);
    });

    it('opens a new-method template for the receiver class + frame selector, with banner help (no init)', async () => {
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      // gemstone:// new-method URI targeting the RECEIVER's class + home dict.
      expect(uri.toString()).toContain('/Globals/SmallInteger/instance/');
      expect(uri.toString()).toContain('new-method');
      expect(vscode.window.showTextDocument).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preserveFocus: false }),
      );
      const editor = await vi.mocked(vscode.window.showTextDocument).mock.results.at(-1)!.value;
      expect(editor.edit).toHaveBeenCalled(); // generic template replaced with the #halt stub
      // Banner help (NOT a full init that would re-select the top frame + steal focus).
      const banner = lastPosted(panel, 'banner');
      expect(banner.text).toContain('#halt');
      expect(banner.text).toContain('SmallInteger');
      expect(posted(panel, 'init').length).toBe(1); // only the original ready init
    });

    it('on a clean save, refreshes with a "used on next send" message and does NOT trim/resume (option B)', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      // Option B: no auto-restart and never auto-resume — just refresh + explain.
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/used on the next/i);
    });

    it('keeps the template pending on a failed compile, then finishes on a clean re-save', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0] as vscode.Uri;

      vi.mocked(vscode.languages.getDiagnostics).mockReturnValueOnce([
        { severity: vscode.DiagnosticSeverity.Error },
      ] as never);
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      // Bad compile → finish not run yet (no "saved" message).
      expect(
        posted(panel, 'init').some((m: { errorMessage?: string }) =>
          /used on the next/i.test(m.errorMessage ?? ''),
        ),
      ).toBe(false);

      saveListener()({ uri } as vscode.TextDocument); // re-save after fixing → pending survived
      await tick();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/used on the next/i);
    });

    it('refuses to implement when the receiver class has no home dictionary', async () => {
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce([
        { className: 'SmallInteger', isMeta: false, dictName: '' },
      ]);
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/symbol list/i);
    });

    // The receiver (Interval) chain for #asOrderedCollection: two override targets
    // then the class that already implements it (Collection) and Object.
    const CHAIN = [
      { className: 'Interval', isMeta: false, dictName: 'Globals', implementsSelector: false },
      {
        className: 'SequenceableCollection',
        isMeta: false,
        dictName: 'Kernel',
        implementsSelector: false,
      },
      { className: 'Collection', isMeta: false, dictName: 'Kernel', implementsSelector: true },
      { className: 'Object', isMeta: false, dictName: 'Kernel', implementsSelector: true },
    ];

    it('QuickPicks the full chain (override vs already-implements) and opens the chosen class', async () => {
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(CHAIN);
      // Choose SequenceableCollection (index 1) — a superclass override target.
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[1] as never,
      );
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      // The picker offered the whole chain, receiver first; classes that already
      // implement the selector are marked as edit (not override) targets.
      const items = vi.mocked(vscode.window.showQuickPick).mock.calls.at(-1)![0] as {
        label: string;
        description: string;
      }[];
      expect(items.map((i) => i.label)).toEqual([
        'Interval',
        'SequenceableCollection',
        'Collection',
        'Object',
      ]);
      expect(items[0].description).toMatch(/implement here/i);
      expect(items[2].description).toMatch(/already implements/i);
      // A stub template for the chosen (non-implementing) superclass.
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/Kernel/SequenceableCollection/instance/');
      expect(uri.toString()).toContain('new-method');
    });

    it('opens the EXISTING source (no stub) when the chosen class already implements it', async () => {
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[2] as never,
      ); // Collection (implements it)
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      // The real method URI (not a new-method template), and NOT clobbered by a stub.
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/Kernel/Collection/instance/');
      expect(uri.toString()).not.toContain('new-method');
      const editor = await vi.mocked(vscode.window.showTextDocument).mock.results.at(-1)!.value;
      expect(editor.edit).not.toHaveBeenCalled(); // existing source left intact
    });

    it('warns that a subclass implementation shadows an override placed higher up', async () => {
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce([
        { className: 'Interval', isMeta: false, dictName: 'Globals', implementsSelector: true }, // active impl
        {
          className: 'SequenceableCollection',
          isMeta: false,
          dictName: 'Kernel',
          implementsSelector: false,
        },
      ]);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[1] as never,
      ); // implement in the superclass
      const panel = openPanel();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();
      // Save → the message explains Interval still shadows it (no trim — option B).
      saveListener()({
        uri: vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0],
      } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/Interval already implements/i);
    });

    it('opens nothing when the inheritance-chain QuickPick is cancelled', async () => {
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('skips the QuickPick when the chain has a single class', async () => {
      // Default mock chain is single-element → straight to the template, no prompt.
      const panel = openPanel();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });
  });

  describe('implement subclassResponsibility (implement an abstract method)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    // A subclassResponsibility stop: the `subclassResponsibility` marker frame on
    // top, the abstract method (`Integer>>foo`, receiver LargeNegativeInteger)
    // below it, then a re-enterable caller, then a deeper frame. getMethodInfo
    // overrides leak past clearAllMocks — restore the base shape in afterEach.
    afterEach(() => {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 5);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
    });

    // serverLevel → method identity. Level 1 is the marker, level 2 the abstract
    // method, level 3 a re-enterable caller, level 4 a deeper user method.
    function setUpSubclassRespStack(senderIsExecutedCode = false) {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 4);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'Object', selector: 'subclassResponsibility' };
        if (oop === 2n) return { className: 'Integer', selector: 'foo' };
        if (oop === 3n) {
          if (senderIsExecutedCode) throw new Error('doit'); // no class → Executed Code
          return { className: 'SomeClass', selector: 'bar' };
        }
        return { className: 'JasperDebugDemo', selector: 'run' };
      });
    }

    // Receiver chain for #foo: the concrete class, an intermediate, the abstract
    // definer (which "implements" #foo only as the subclassResponsibility stub),
    // then classes ABOVE the definer — which the implement action must trim away.
    const SR_CHAIN = [
      {
        className: 'LargeNegativeInteger',
        isMeta: false,
        dictName: 'Globals',
        implementsSelector: false,
      },
      { className: 'LargeInteger', isMeta: false, dictName: 'Globals', implementsSelector: false },
      { className: 'Integer', isMeta: false, dictName: 'Globals', implementsSelector: true },
      { className: 'Number', isMeta: false, dictName: 'Kernel', implementsSelector: false },
      { className: 'Object', isMeta: false, dictName: 'Kernel', implementsSelector: true },
    ];

    function openPanel() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    it('opens the debugger on the abstract method (subclassResponsibility frame trimmed)', () => {
      setUpSubclassRespStack();
      const stack = initPayload(openPanel()).stack;
      // The marker frame is trimmed; the abstract method `Integer>>foo` is the top.
      expect(stack[0].label).toContain('foo');
      expect(stack.some((f: { label: string }) => /subclassResponsibility/.test(f.label))).toBe(
        false,
      );
    });

    it('offers the "Implement #sel" action when parked on a subclassResponsibility', () => {
      setUpSubclassRespStack();
      expect(initPayload(openPanel()).subclassResp).toEqual({ selector: 'foo' });
    });

    it('does NOT offer the implement action when a doesNotUnderstand: is also parked (DNU wins)', () => {
      setUpSubclassRespStack();
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue({
        className: 'Foo',
        isMeta: false,
        dictName: 'Globals',
        selector: 'bar',
        argCount: 0,
      });
      const payload = initPayload(openPanel());
      expect(payload.subclassResp).toBeUndefined();
      expect(payload.dnu).toBeDefined();
    });

    it('QuickPicks the chain BOUNDED at the abstract definer, then opens a stub', async () => {
      setUpSubclassRespStack();
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(SR_CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[0] as never,
      ); // LargeNegativeInteger
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementSubclassResponsibility' });
      await flush();

      // Bounded at Integer (the definer) — Number/Object above it are dropped.
      const items = vi.mocked(vscode.window.showQuickPick).mock.calls.at(-1)![0] as {
        label: string;
      }[];
      expect(items.map((i) => i.label)).toEqual([
        'LargeNegativeInteger',
        'LargeInteger',
        'Integer',
      ]);
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/Globals/LargeNegativeInteger/instance/');
      expect(uri.toString()).toContain('new-method');
    });

    it('on a clean save, re-enters the caller so Resume re-dispatches into the new method', async () => {
      setUpSubclassRespStack(); // caller (level 3) is a re-enterable method frame
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(SR_CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[0] as never,
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'implementSubclassResponsibility' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3); // the caller's level
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/re-entered the caller/i);
    });

    it('tells the user to re-run when the caller is workspace/Executed Code (no trim)', async () => {
      setUpSubclassRespStack(true); // caller is a doit → not re-enterable
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(SR_CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[0] as never,
      );
      const panel = openPanel();
      sendMessage(panel, { command: 'implementSubclassResponsibility' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/re-run the expression/i);
    });

    it('stops offering Implement after a re-run save (srSuppressed) — the method now exists', async () => {
      setUpSubclassRespStack(true);
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce(SR_CHAIN);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[0] as never,
      );
      const panel = openPanel();
      expect(initPayload(panel).subclassResp).toEqual({ selector: 'foo' }); // offered at first
      sendMessage(panel, { command: 'implementSubclassResponsibility' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)![0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      // The same subclassResponsibility is still parked, but the button must NOT
      // re-appear (the method exists now) — like dnuSuppressed.
      expect(lastPosted(panel, 'init').subclassResp).toBeUndefined();
    });

    it('does NOT offer Implement when the frame below the marker is not a real method', () => {
      // Defensive guard: an Executed-Code / block frame can't be implemented in.
      vi.mocked(debug.getStackDepth).mockImplementation(() => 3);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'Object', selector: 'subclassResponsibility' };
        if (oop === 2n) throw new Error('doit'); // frame below the marker → Executed Code
        return { className: 'JasperDebugDemo', selector: 'run' };
      });
      expect(initPayload(openPanel()).subclassResp).toBeUndefined();
    });
  });

  // Class-side (metaclass) parallels of the instance-side debugger coverage:
  // editable variables, implement-in override, subclassResponsibility, and
  // doesNotUnderstand. The receiver here is a CLASS, so getObjectClassName
  // returns "Foo class" and the gemstone:// URIs must target `/class/` rather
  // than `/instance/`. Mirrors the hardening item-A live verification
  // (JasperMaker* / JasperClassSideDemo).
  describe('class-side coverage (metaclass receivers)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    // getMethodInfo / getObjectClassName / getDoesNotUnderstandInfo / getStackDepth
    // mockImplementations leak past clearAllMocks — restore the base 5-frame stack.
    afterEach(() => {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 5);
      vi.mocked(debug.getObjectClassName).mockImplementation((_s: unknown, receiverOop: bigint) =>
        receiverOop === 200n ? 'SmallInteger' : 'JasperDebugDemo',
      );
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
    });

    function openPanel() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    // Make the level-2 frame (receiverOop 200) a class-side method `buildIt`
    // inherited from JasperMakerBase, run with `receiverClassName` as the receiver.
    function classSideInheritedAtLevel2(receiverClassName: string) {
      vi.mocked(debug.getObjectClassName).mockImplementation((_s: unknown, receiverOop: bigint) =>
        receiverOop === 200n ? receiverClassName : 'JasperDebugDemo',
      );
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'JasperMakerBase', selector: 'buildIt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
    }

    // --- Implement-in override (override an inherited method in the receiver's class), class side ---

    it('marks an inherited CLASS-SIDE frame overridable, carrying the receiver metaclass', () => {
      classSideInheritedAtLevel2('JasperMakerLeaf class');
      const overridable = initPayload(openPanel()).stack.find(
        (f: { overridable?: boolean }) => f.overridable,
      );
      expect(overridable.receiverClass).toBe('JasperMakerLeaf class'); // the receiver's metaclass…
      expect(overridable.label).toContain('JasperMakerBase'); // …while the method lives in the superclass
    });

    it('does NOT mark a CLASS-SIDE frame overridable when the receiver IS the defining class', () => {
      // Receiver is JasperMakerBase itself → "JasperMakerBase class"; the
      // `receiverClass !== definingClassName + " class"` guard must suppress it.
      classSideInheritedAtLevel2('JasperMakerBase class');
      const selfFrames = initPayload(openPanel()).stack.filter(
        (f: { receiverClass?: string }) => f.receiverClass === 'JasperMakerBase class',
      );
      expect(selfFrames.length).toBeGreaterThan(0);
      for (const f of selfFrames) expect(f.overridable).toBe(false);
    });

    it('implementInReceiver opens a CLASS-side new-method template for a metaclass receiver', async () => {
      classSideInheritedAtLevel2('JasperMakerLeaf class');
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce([
        { className: 'JasperMakerLeaf', isMeta: true, dictName: 'UserGlobals' },
      ]);
      const panel = openPanel();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementInReceiver', level: 2 });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/UserGlobals/JasperMakerLeaf/class/');
      expect(uri.toString()).toContain('new-method');
    });

    // --- subclassResponsibility (implement an abstract method), class side ---

    it('implementSubclassResponsibility opens a CLASS-side stub for a metaclass receiver', async () => {
      vi.mocked(debug.getStackDepth).mockImplementation(() => 4);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'Object', selector: 'subclassResponsibility' };
        if (oop === 2n) return { className: 'JasperAbstractMaker', selector: 'defaultInstance' };
        if (oop === 3n) return { className: 'SomeClass', selector: 'bar' };
        return { className: 'JasperDebugDemo', selector: 'run' };
      });
      // Class-side receiver chain, bounded at the abstract definer (isMeta throughout).
      vi.mocked(debug.getReceiverClassChain).mockReturnValueOnce([
        {
          className: 'JasperConcreteMaker',
          isMeta: true,
          dictName: 'UserGlobals',
          implementsSelector: false,
        },
        {
          className: 'JasperAbstractMaker',
          isMeta: true,
          dictName: 'UserGlobals',
          implementsSelector: true,
        },
      ]);
      vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
        async (items: unknown) => (items as { index: number }[])[0] as never,
      ); // JasperConcreteMaker class
      const panel = openPanel();
      expect(initPayload(panel).subclassResp).toEqual({ selector: 'defaultInstance' });
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'implementSubclassResponsibility' });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/UserGlobals/JasperConcreteMaker/class/');
      expect(uri.toString()).toContain('new-method');
    });

    // --- DNU (create-method), class side: receiver IS a class ---

    const DNU_META = {
      className: 'JasperClassSideDemo',
      isMeta: true,
      dictName: 'UserGlobals',
      selector: 'makeFancyThing:',
      argCount: 1,
    };

    function openWithClassDnu() {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(DNU_META);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'MessageNotUnderstood', selector: 'defaultAction' };
        if (oop === 2n) return { className: 'Object', selector: 'doesNotUnderstand:' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('carries isMeta in the DNU init payload when the receiver is a class', () => {
      const panel = openWithClassDnu();
      expect(initPayload(panel).dnu).toEqual({
        selector: 'makeFancyThing:',
        className: 'JasperClassSideDemo',
        isMeta: true,
      });
    });

    it('createDnuMethod opens a CLASS-side new-method URI for a class receiver', async () => {
      const panel = openWithClassDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(uri.toString()).toContain('/UserGlobals/JasperClassSideDemo/class/');
      expect(uri.toString()).toContain('new-method');
    });

    // --- editable Variables on a class-side frame (classInstVars) ---

    it('shows + edits a class-instance variable on a class-side frame (receiver is a class)', () => {
      // Frame at level 3 (receiverOop 300) has a class receiver; its named
      // instVars are the class-instance variables (e.g. `registry`).
      vi.mocked(debug.getObjectClassName).mockImplementation((_s: unknown, receiverOop: bigint) =>
        receiverOop === 300n ? 'JasperClassSideDemo class' : 'JasperDebugDemo',
      );
      // The one-trip query returns the class-instance var as an instvars row.
      vi.mocked(debug.fetchFrameVariables).mockImplementation(
        (_s: unknown, _p: unknown, level: number) =>
          level === 3
            ? [
                { group: 'receiver', name: 'self', value: '<print 300>', oop: '300', index: 0 },
                { group: 'instvars', name: 'registry', value: '<print 7>', oop: '7', index: 1 },
              ]
            : [
                {
                  group: 'receiver',
                  name: 'self',
                  value: `<print ${level * 100}>`,
                  oop: `${level * 100}`,
                  index: 0,
                },
              ],
      );
      vi.mocked(debug.evaluateInFrameToOop).mockReturnValueOnce(777n);
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 3 });

      // The class-instance var renders in the instvars group with edit metadata.
      const groups = lastPosted(panel, 'variables').groups;
      expect(groups.find((g: { kind: string }) => g.kind === 'instvars').vars).toEqual([
        { name: 'registry', value: '<print 7>', oop: '7', edit: { kind: 'instvar', index: 1 } },
      ]);
      // Writing it routes through the same instVarAt:put: primitive, class receiver.
      sendMessage(panel, {
        command: 'setVariable',
        level: 3,
        kind: 'instvar',
        index: 1,
        expr: 'Array new',
      });
      expect(debug.setInstVar).toHaveBeenCalledWith(session, expect.any(BigInt), 1, 777n);
      expect(lastPosted(panel, 'setVariableResult')).toEqual({
        command: 'setVariableResult',
        ok: true,
      });
    });
  });

  describe('layout persistence', () => {
    it('remembers a saved split so the next panel opens with it', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      sendMessage(lastPanel(), { command: 'saveLayout', stackBasis: '42%' });

      // A freshly created panel injects the remembered basis into its HTML.
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      expect(lastPanel().webview.html).toMatch(/--stack-basis:\s*42%/);

      // Restore the default so later tests see the standard 60% split.
      sendMessage(lastPanel(), { command: 'saveLayout', stackBasis: '60%' });
    });

    it('puts the answer beside the expression, on one row', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      // Quick calculations against the selected frame: half the row each. The
      // answer used to sit UNDER the input in a resizable block, which made it
      // the first thing squeezed out of sight on a short column.
      expect(html).toMatch(/\.evalbar\s*\{[^}]*flex-direction:\s*row/);
      expect(html).toMatch(/\.eval-input-wrap\s*\{[^}]*flex:\s*1 1 50%/);
      expect(html).toMatch(/\.eval-result\s*\{[^}]*flex:\s*1 1 50%/);
      // A ✕ inside the input's right edge clears it, like the list filters.
      expect(html).toContain('id="evalClear"');
      expect(html).toMatch(/\.evalbar\.has-text \.clear-btn\s*\{[^}]*visibility:\s*visible/);
      // One line: a long printString scrolls sideways rather than growing the bar.
      expect(html).toMatch(/\.eval-result\s*\{[^}]*white-space:\s*pre;/);
    });

    it('opens with the eval bar ready to type, and remembers if you close it', () => {
      // One row either way now, so there's no reason to make you open it first.
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      expect(lastPanel().webview.html).toContain('<body class="">');
      expect(lastPanel().webview.html).toContain('id="evalToggle"');
      expect(lastPanel().webview.html).toContain('Evaluate in this frame…');

      sendMessage(lastPanel(), { command: 'saveLayout', evalCollapsed: true });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      expect(lastPanel().webview.html).toContain('<body class="eval-collapsed">');

      sendMessage(lastPanel(), { command: 'saveLayout', evalCollapsed: false }); // restore
    });

    it('frames itself so the column never reads as a source editor', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toContain('<h1>GemStone Debugger</h1>');
      // A webview tab and surface are otherwise identical to a source editor's,
      // and this panel is a live suspended process. Border and background wash
      // frame the whole surface, so it holds even when the column is squeezed.
      expect(html).toMatch(/body\s*\{[^}]*border:\s*2px solid var\(--vscode-charts-purple/);
      expect(html).toMatch(/body\s*\{[^}]*color-mix\(in srgb, rgb\(163, 113, 247\) 12%/);
      // The wash is mixed INTO the editor's own background, so it sits right in
      // any theme; the plain background before it is the no-color-mix fallback.
      expect(html).toMatch(/background:\s*var\(--vscode-editor-background\);/);
      // Title matches the border and the tab icon — one treatment, not three.
      expect(html).toMatch(/h1\s*\{[^}]*--vscode-charts-purple/);
      // …and the header stays compact so short columns still show stack frames.
      expect(html).toMatch(/h1\s*\{[^}]*font-size:\s*1rem/);
    });

    it('gives the tab an icon once activation has supplied the extension path', () => {
      const state: vscode.Memento = {
        get: <T>(_k: string, d?: T) => d,
        update: async () => {},
        keys: () => [],
      };
      try {
        DebuggerPanel.initSourceTabCleanup(state, '/opt/jasper');
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        // A webview tab is indistinguishable from a source-editor tab without one.
        expect(String(lastPanel().iconPath)).toContain(
          '/opt/jasper/resources/gemstone-debugger.svg',
        );
      } finally {
        DebuggerPanel.initSourceTabCleanup(state); // un-arm for the other tests
      }
    });

    it('pushes the source pane down when the panel reports it needs more height', async () => {
      // The panel measured itself at 300px in a 220px viewport; its group is 260
      // (260 - 220 = 40px of tab bar), so it needs 340 of the column's 400.
      // One editor group already open, so the panel opens into column 2 — the
      // column the plan below also puts it in (the mock panel reports the column
      // it was created in; the real one is moved there by the layout itself).
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const beforeCarve = { orientation: 0, groups: [{ size: 600 }, { size: 600 }] };
      const carved = {
        orientation: 0,
        groups: [{ size: 240 }, { size: 360, groups: [{ size: 260 }, { size: 140 }] }],
      };
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? beforeCarve : undefined),
      );
      try {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const panel = lastPanel();
        await tick();
        vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
          Promise.resolve(cmd === 'vscode.getEditorLayout' ? carved : undefined),
        );
        sendMessage(panel, { command: 'fit', needed: 300, viewport: 220 });
        await tick();
        await tick();

        const applied = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout')
          .at(-1)?.[1] as EditorGroupLayout;
        const pair = applied.groups[1].groups!;
        expect(pair[0].size).toBeCloseTo(340, 5); // panel gets what it asked for
        expect(pair[0].size! + pair[1].size!).toBeCloseTo(400, 5); // out of the column's 400
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    it("refuses to resize a pair that is not the debugger's own", async () => {
      // The pair is identified by column arithmetic — the leaf before the
      // source's. Sound while those two really are the panes the carve made
      // adjacent; if the carve declined an unfamiliar grid and the source landed
      // elsewhere, the same arithmetic names one of the USER's groups as "the
      // panel" and resizes it. Adjacency to our own column is what rules it out.
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const beforeCarve = { orientation: 0, groups: [{ size: 600 }, { size: 600 }] };
      const strangersGrid = {
        orientation: 0,
        groups: [{ size: 240 }, { size: 360, groups: [{ size: 100 }, { size: 300 }] }],
      };
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? beforeCarve : undefined),
      );
      try {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const panel = lastPanel();
        await tick();
        // The source editor ended up in column 7 — nowhere near the panel's 2.
        (panel as { viewColumn?: number }).viewColumn = 2;
        const dbg = [
          ...((DebuggerPanel as unknown as { panels: Map<number, Set<unknown>> }).panels.get(
            session.id,
          ) ?? []),
        ][0] as { sourceEditor?: { viewColumn: number } };
        dbg.sourceEditor = { viewColumn: 7 };

        vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
          Promise.resolve(cmd === 'vscode.getEditorLayout' ? strangersGrid : undefined),
        );
        const before = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout').length;
        sendMessage(panel, { command: 'fit', needed: 900, viewport: 100 });
        await tick();
        await tick();

        expect(
          vi
            .mocked(vscode.commands.executeCommand)
            .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout').length,
        ).toBe(before); // nothing resized
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    it('leaves the divider alone when the panel already fits, and after the first fit', async () => {
      // One editor group already open, so the panel opens into column 2 — the
      // column the plan below also puts it in (the mock panel reports the column
      // it was created in; the real one is moved there by the layout itself).
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const beforeCarve = { orientation: 0, groups: [{ size: 600 }, { size: 600 }] };
      const roomy = {
        orientation: 0,
        groups: [{ size: 505 }, { size: 758, groups: [{ size: 470 }, { size: 232 }] }],
      };
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? beforeCarve : undefined),
      );
      try {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const panel = lastPanel();
        await tick();
        vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
          Promise.resolve(cmd === 'vscode.getEditorLayout' ? roomy : undefined),
        );
        const carves = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout').length;

        // 400 needed in a 430 viewport whose group is 470 (40px of tab bar) — the
        // panel wants 440 and has 470, so nothing to do.
        sendMessage(panel, { command: 'fit', needed: 400, viewport: 430 });
        await tick();
        await tick();
        // A later render reports again (a bigger banner) — but the divider is the
        // user's now, so it is ignored.
        sendMessage(panel, { command: 'fit', needed: 900, viewport: 430 });
        await tick();
        await tick();

        expect(
          vi
            .mocked(vscode.commands.executeCommand)
            .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout').length,
        ).toBe(carves);
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    it('closes cleanly, and lets the NEXT halt open', async () => {
      // VS Code marks a panel disposed before firing onDidDispose, and its
      // `viewColumn` getter throws from then on. A dispose() that asks the panel
      // where it is therefore dies on its first line — and silently, because the
      // throw happens inside an event listener. Everything after it is skipped:
      // the sampler keeps running, the companion source tab stays open, and the
      // panel is never removed from the static registry. The next halt then
      // reads that stale panel and throws BEFORE creating its webview, so the
      // debugger simply never opens again until the window is reloaded.
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      await tick();

      expect(() => closePanel(panel)).not.toThrow();

      // dispose() ran to the end: the registry is empty…
      const panels = (DebuggerPanel as unknown as { panels: Map<number, Set<unknown>> }).panels;
      expect(panels.get(session.id)?.size ?? 0).toBe(0);
      // …and the suspended process was released, which is the LAST thing dispose
      // does, so reaching it means the whole method ran. (The companion source
      // tab closing is the other visible symptom; the source-pane tests above
      // cover it, and they now close panels through real dispose() semantics.)
      expect(debug.clearStack).toHaveBeenCalled();

      // And the next halt opens.
      DebuggerPanel.create(session, 0x456n, 'a second halt');
      expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls).toHaveLength(2);
    });

    it('retires its own groups once they are empty, so the grid does not accumulate', async () => {
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      await tick();

      // The debugger's pair (2 and 3) is empty after its tabs close; the user's
      // column still holds their editor.
      const groups = vscode.window.tabGroups.all as unknown as {
        viewColumn: number;
        tabs: unknown[];
      }[];
      groups.length = 0;
      groups.push(
        { viewColumn: 1, tabs: [{}] },
        { viewColumn: 2, tabs: [] },
        { viewColumn: 3, tabs: [] },
      );
      closePanel(panel);
      await tick(); // the sweep waits on the tab closes, not on a timer
      await tick();

      // An empty group left behind shifts every column number along and makes
      // the next debugger's group nest inside it instead of opening plainly.
      const closed = vi
        .mocked(vscode.window.tabGroups.close)
        .mock.calls.map((c) => (c[0] as { viewColumn?: number }).viewColumn)
        .filter((c) => c !== undefined);
      expect(closed).toEqual([2, 3]);
    });

    it('offers maximize as the way out of a column that is too small to work in', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      sendMessage(lastPanel(), { command: 'maximizePanel' });

      // VS Code clips a webview rather than adapting it, so the escape hatch is
      // to take the whole editor area; the same toggle puts the grid back.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'workbench.action.toggleMaximizeEditorGroup',
      );
    });

    it('degrades instead of clipping when the column gets small', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      // Nothing is ever cut off outright — the body scrolls as a last resort.
      expect(html).toMatch(/body\s*\{[^}]*overflow:\s*auto/);
      // Padding and margins go first…
      expect(html).toMatch(/@media\s*\(max-height:\s*460px\)/);
      // …then the labels, keeping the frames and the reason for the halt.
      expect(html).toMatch(/@media\s*\(max-height:\s*340px\)/);
      // A narrow column only stacks the panes when there's height to spare —
      // stacking them on a short column would make the squeeze worse.
      expect(html).toMatch(/@media\s*\(max-width:\s*340px\)\s*and\s*\(min-height:\s*420px\)/);
    });

    it('keeps the Call Stack readable when the column is squeezed short', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      // The panes hold a floor…
      expect(html).toMatch(/\.main\s*\{[^}]*min-height:\s*5rem/);
      // …because the chrome around them costs as little as it can: the eval bar
      // is a single row, and a long error banner scrolls in place rather than
      // pushing the panes off the bottom.
      expect(html).toMatch(/\.evalbar\s*\{[^}]*flex:\s*0 0 auto/);
      expect(html).toMatch(/^\s*\.error\s*\{[^}]*overflow-y:\s*auto/m);
      // …but never below one line: a scrollable flex item shrinks to nothing
      // otherwise, and the message saying why execution stopped just vanishes.
      expect(html).toMatch(/^\s*\.error\s*\{[^}]*min-height:\s*1\.3em/m);
    });

    it('sizes the debugger column by declaring it, never by stepping it wider', async () => {
      // One group already open, so the panel opens into column 2 — the column
      // the reported grid below also has it in.
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const layout = { orientation: 0, groups: [{ size: 1200 }, { size: 400 }] };
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? layout : undefined),
      );
      try {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        await tick(); // the carve runs off the create call

        const applied = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.find((c) => c[0] === 'vscode.setEditorLayout')?.[1] as EditorGroupLayout;
        const width = applied.groups.reduce((sum, g) => sum + g.size!, 0);
        expect(applied.groups[1].size! / width).toBeCloseTo(0.6, 2); // ~60% of the window
        // A step command means something different on every window size, which
        // is why the layout used to vary with it.
        expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
          'workbench.action.increaseViewWidth',
        );
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
    });

    it('sizes the pair to the remembered divider ratio once the panel measures itself', async () => {
      // The sampler (unchanged) records the user's drag of the panel↔source
      // divider; the next debugger's fit pass applies it, in pixels, against a
      // column height VS Code has actually measured.
      const saved = DebuggerPanel as unknown as { savedSourceRatio: number | undefined };
      const previous = saved.savedSourceRatio;
      saved.savedSourceRatio = 0.5;
      // One editor group already open, so the panel opens into column 2 — the
      // column the plan below also puts it in (the mock panel reports the column
      // it was created in; the real one is moved there by the layout itself).
      (vscode.window.tabGroups.all as unknown as unknown[]).push({ viewColumn: 1, tabs: [] });
      const beforeCarve = { orientation: 0, groups: [{ size: 600 }, { size: 600 }] };
      const carved = {
        orientation: 0,
        // Opened evenly split by the carve — no, unevenly here, so the assertion
        // proves the ratio was applied rather than already being in place.
        groups: [{ size: 240 }, { size: 360, groups: [{ size: 500 }, { size: 200 }] }],
      };
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? beforeCarve : undefined),
      );
      try {
        DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
        const panel = lastPanel();
        await tick();
        vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
          Promise.resolve(cmd === 'vscode.getEditorLayout' ? carved : undefined),
        );
        // Plenty of room: 200 needed in a 500 group, so the ratio wins outright.
        sendMessage(panel, { command: 'fit', needed: 200, viewport: 500 });
        await tick();
        await tick();

        const applied = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'vscode.setEditorLayout')
          .at(-1)?.[1] as EditorGroupLayout;
        const pair = applied.groups[1].groups!;
        expect(pair[1].size).toBe(350); // the 50/50 they dragged to, in pixels
        expect(pair[0].size).toBe(350);
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
        saved.savedSourceRatio = previous;
      }
    });
  });
});

// ── Stack filtering ────────────────────────────────────────────────
// Models the real `JasperDebugDemo new run` halt stack (captured live, id 4):
//   top = AbstractException signal machinery + Object>>halt,
//   bottom = the transcript-capture doit + its block/ensure: glue.
const DOIT = 999n;

function raw(p: Partial<RawFrame> & { serverLevel: number; label: string }): RawFrame {
  return {
    methodOop: BigInt(p.serverLevel),
    homeMethodOop: BigInt(p.serverLevel),
    isBlock: false,
    definingClassName: '',
    selector: '',
    isExecutedCode: false,
    breakable: false,
    ...p,
  };
}

// level 1 = top.
const HALT_STACK: RawFrame[] = [
  raw({
    serverLevel: 1,
    label: 'AbstractException>>#_signalToDebugger',
    definingClassName: 'AbstractException',
    selector: '_signalToDebugger',
  }),
  raw({
    serverLevel: 2,
    label: 'AbstractException>>#_signal',
    definingClassName: 'AbstractException',
    selector: '_signal',
  }),
  raw({
    serverLevel: 3,
    label: 'AbstractException class>>#signal',
    definingClassName: 'AbstractException',
    selector: 'signal',
  }),
  raw({
    serverLevel: 4,
    label: 'SmallInteger (Object)>>#halt',
    definingClassName: 'Object',
    selector: 'halt',
  }),
  raw({
    serverLevel: 5,
    label: '[] in JasperDebugDemo>>#finish',
    definingClassName: 'JasperDebugDemo',
    selector: 'finish',
    isBlock: true,
    homeMethodOop: 10n,
  }),
  raw({
    serverLevel: 6,
    label: 'Array (Collection)>>#do:',
    definingClassName: 'Collection',
    selector: 'do:',
  }),
  raw({
    serverLevel: 7,
    label: 'JasperDebugDemo>>#finish',
    definingClassName: 'JasperDebugDemo',
    selector: 'finish',
  }),
  raw({
    serverLevel: 8,
    label: 'JasperDebugDemo>>#accumulateFrom:to:',
    definingClassName: 'JasperDebugDemo',
    selector: 'accumulateFrom:to:',
  }),
  raw({
    serverLevel: 9,
    label: 'JasperDebugDemo>>#run',
    definingClassName: 'JasperDebugDemo',
    selector: 'run',
  }),
  raw({
    serverLevel: 10,
    label: 'Executed Code',
    isBlock: true,
    homeMethodOop: DOIT,
    isExecutedCode: true,
  }),
  raw({
    serverLevel: 11,
    label: 'ExecBlock0 (ExecBlock)>>#ensure:',
    definingClassName: 'ExecBlock',
    selector: 'ensure:',
  }),
  raw({
    serverLevel: 12,
    label: 'Executed Code',
    isBlock: true,
    homeMethodOop: DOIT,
    isExecutedCode: true,
  }),
  raw({
    serverLevel: 13,
    label: 'Executed Code',
    methodOop: DOIT,
    homeMethodOop: DOIT,
    isExecutedCode: true,
  }),
  // GemStone leaves a <Reenter marker> BELOW the doit; getFrameInfo can't resolve
  // it so buildFrame yields a `<frame N>` (not executed-code). It must not block
  // the bottom collapse (the original bug) and must itself be dropped.
  raw({ serverLevel: 14, label: '<frame 14>' }),
];

describe('filterStack', () => {
  it('trims halt machinery off the top and the wrapper glue off the bottom', () => {
    const kept = filterStack(HALT_STACK);
    // Top = the user block where halt was sent; bottom = the doit (kept); the
    // signal frames, the wrapper frames (10, 11, 12) AND the reenter marker (14)
    // are gone. Exactly ONE "Executed Code" frame survives.
    expect(kept.map((f) => f.serverLevel)).toEqual([5, 6, 7, 8, 9, 13]);
    expect(kept[0].label).toBe('[] in JasperDebugDemo>>#finish');
    expect(kept[kept.length - 1].label).toBe('Executed Code');
    expect(kept.filter((f) => f.label === 'Executed Code')).toHaveLength(1);
    expect(kept.some((f) => f.serverLevel === 14)).toBe(false); // reenter marker dropped
  });

  it('collapses the wrapper even when a non-executed-code frame sits below the doit', () => {
    // Regression: the <Reenter marker> at the very bottom used to make the trim
    // gate ("deepest frame is the doit") fail, leaving all the glue frames.
    const kept = filterStack(HALT_STACK);
    expect(kept.filter((f) => f.isExecutedCode)).toHaveLength(1);
  });

  it('keeps mid-stack kernel frames (only trims contiguously from each end)', () => {
    // Array>>do: (level 6) sits between user frames and must survive.
    expect(filterStack(HALT_STACK).map((f) => f.serverLevel)).toContain(6);
  });

  it('leaves a clean stack untouched (no machinery, no doit)', () => {
    const plain = HALT_STACK.slice(4, 9); // frames 5..9, all user frames
    expect(filterStack(plain)).toEqual(plain);
  });

  it('never trims the whole stack, even if every frame looks like machinery', () => {
    const allMachinery = HALT_STACK.slice(0, 4); // the 4 signal/halt frames
    const kept = filterStack(allMachinery);
    expect(kept.length).toBe(1); // keeps the last as a floor
    expect(kept[0].serverLevel).toBe(4);
  });

  it('does not trim the bottom when the deepest frame is not a doit', () => {
    const noDoit = HALT_STACK.slice(4, 9); // ends at run, not Executed Code
    expect(filterStack(noDoit).map((f) => f.serverLevel)).toEqual([5, 6, 7, 8, 9]);
  });

  it('returns short stacks unchanged', () => {
    expect(filterStack([])).toEqual([]);
    expect(filterStack([HALT_STACK[8]])).toEqual([HALT_STACK[8]]);
  });

  // The real parked doesNotUnderstand: stack (captured live, error 2010): under
  // GCI debug it parks in the unhandled-error path, so the TOP frame is
  // MessageNotUnderstood>>defaultAction (NOT signal) — which must still be trimmed
  // so the debugger opens on the user's frame (here, Executed Code).
  const DNU_STACK: RawFrame[] = [
    raw({
      serverLevel: 1,
      label: 'MessageNotUnderstood>>#defaultAction',
      definingClassName: 'MessageNotUnderstood',
      selector: 'defaultAction',
    }),
    raw({
      serverLevel: 2,
      label: 'MessageNotUnderstood (AbstractException)>>#_defaultAction',
      definingClassName: 'AbstractException',
      selector: '_defaultAction',
    }),
    raw({
      serverLevel: 3,
      label: 'MessageNotUnderstood (AbstractException)>>#_signal',
      definingClassName: 'AbstractException',
      selector: '_signal',
    }),
    raw({
      serverLevel: 4,
      label: 'MessageNotUnderstood (AbstractException)>>#signal',
      definingClassName: 'AbstractException',
      selector: 'signal',
    }),
    raw({
      serverLevel: 5,
      label: 'SmallInteger (Object)>>#doesNotUnderstand:',
      definingClassName: 'Object',
      selector: 'doesNotUnderstand:',
    }),
    raw({
      serverLevel: 6,
      label: 'SmallInteger (Object)>>#_doesNotUnderstand:args:envId:reason:',
      definingClassName: 'Object',
      selector: '_doesNotUnderstand:args:envId:reason:',
    }),
    raw({
      serverLevel: 7,
      label: 'Executed Code',
      methodOop: DOIT,
      homeMethodOop: DOIT,
      isExecutedCode: true,
    }),
  ];

  it('trims the doesNotUnderstand: machinery (incl. defaultAction) down to the user frame', () => {
    const kept = filterStack(DNU_STACK);
    expect(kept.map((f) => f.serverLevel)).toEqual([7]); // just the Executed Code sender
    expect(kept[0].label).toBe('Executed Code');
  });

  // A subclassResponsibility stop: `subclassResponsibility` → `self error:` →
  // signal machinery. All of it is trimmed (incl. the marker) so the debugger opens
  // on the abstract method itself — the method the implement action offers to fill in.
  const SUBCLASS_RESP_STACK: RawFrame[] = [
    raw({
      serverLevel: 1,
      label: 'AbstractException class>>#signal',
      definingClassName: 'AbstractException',
      selector: 'signal',
    }),
    raw({
      serverLevel: 2,
      label: 'LargeNegativeInteger (Object)>>#error:',
      definingClassName: 'Object',
      selector: 'error:',
    }),
    raw({
      serverLevel: 3,
      label: 'LargeNegativeInteger (Object)>>#subclassResponsibility',
      definingClassName: 'Object',
      selector: 'subclassResponsibility',
    }),
    raw({
      serverLevel: 4,
      label: 'LargeNegativeInteger (Integer)>>#foo',
      definingClassName: 'Integer',
      selector: 'foo',
    }),
    raw({
      serverLevel: 5,
      label: 'Executed Code',
      methodOop: DOIT,
      homeMethodOop: DOIT,
      isExecutedCode: true,
    }),
  ];

  it('trims the subclassResponsibility machinery down to the abstract method', () => {
    const kept = filterStack(SUBCLASS_RESP_STACK);
    // The signal/error:/subclassResponsibility marker frames are gone; the abstract
    // method `foo` (level 4) is the top frame, the doit sender below it.
    expect(kept.map((f) => f.serverLevel)).toEqual([4, 5]);
    expect(kept[0].label).toContain('foo');
    expect(kept.some((f) => /subclassResponsibility/.test(f.selector))).toBe(false);
  });
});

describe('isExceptionMachinery', () => {
  it('flags AbstractException frames and halt/DNU/signal selectors', () => {
    expect(isExceptionMachinery(HALT_STACK[0])).toBe(true); // _signalToDebugger
    expect(isExceptionMachinery(HALT_STACK[2])).toBe(true); // class>>signal
    expect(isExceptionMachinery(HALT_STACK[3])).toBe(true); // Object>>halt
    expect(
      isExceptionMachinery(raw({ serverLevel: 1, label: 'x', selector: 'doesNotUnderstand:' })),
    ).toBe(true);
  });

  it('does not flag ordinary user/kernel frames', () => {
    expect(isExceptionMachinery(HALT_STACK[4])).toBe(false); // [] in finish
    expect(isExceptionMachinery(HALT_STACK[6])).toBe(false); // finish
    expect(isExceptionMachinery(HALT_STACK[5])).toBe(false); // Collection>>do:
  });
});

describe('step-point highlight decoration', () => {
  // Guards item #5: light themes render `editor.focusedStackFrameHighlightBackground`
  // as a near-invisible translucent yellow, and we mark only the step-point token
  // (not the whole line), so the bare default was almost unreadable. The decoration
  // therefore carries a `light` override with a stronger fill + solid border. If
  // someone strips that override (back to the faint default), these fail.
  it('was created (snapshot captured at import time)', () => {
    expect(stepPointDecorationOptions).toBeDefined();
  });

  it('overrides light themes with a stronger fill and a solid (non-themed) border', () => {
    const light = stepPointDecorationOptions?.light;
    expect(light).toBeDefined();
    // A solid colour string, NOT a ThemeColor pointing back at the faint default.
    expect(typeof light?.backgroundColor).toBe('string');
    expect(typeof light?.borderColor).toBe('string');
    expect(light?.borderColor).not.toBeInstanceOf(vscode.ThemeColor);
    // The fill must be appreciably opaque (the faint default sits near ~0.2 alpha).
    const alpha = Number(
      /rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(String(light?.backgroundColor))?.[1] ?? '1',
    );
    expect(alpha).toBeGreaterThanOrEqual(0.4);
  });
});

// ── Inline values (#5) — pure overlay computation ──────────────────────────
describe('shortenInlineValue', () => {
  it('passes a short single-line value through untouched', () => {
    expect(shortenInlineValue('75')).toBe('75');
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(shortenInlineValue('a Point(\n  1\n  2\n)')).toBe('a Point( 1 2 )');
  });

  it('truncates past the limit with an ellipsis', () => {
    expect(shortenInlineValue('abcdefghij', 5)).toBe('abcd…');
    expect(shortenInlineValue('abcdefghij', 5).length).toBe(5);
  });

  it('keeps wide collection values short by default', () => {
    expect(
      shortenInlineValue('an OrderedCollection(3 7 2 9 4 100 200 300 400 500)').length,
    ).toBeLessThanOrEqual(40);
  });
});

describe('computeInlineValueLines', () => {
  const vars: InlineVar[] = [
    { name: 'self', value: 'an Account', full: 'an Account' },
    { name: 'balance', value: '200', full: '200' },
    { name: 'amount', value: '75', full: '75' },
    { name: 'unused', value: '999', full: '999' },
  ];

  it('shows each variable once, on its first referencing line', () => {
    const lines = [
      'withdraw: amount',
      '  | newBalance |',
      '  newBalance := balance - amount.',
      '  ^balance',
    ];
    const overlay = computeInlineValueLines(lines, vars);
    // amount → line 0 (first use); balance → line 2 (first use); never repeated.
    expect(overlay.map((o) => o.line)).toEqual([0, 2]);
    expect(overlay[0].label).toBe('amount = 75');
    expect(overlay[1].label).toBe('balance = 200');
  });

  it('skips the temp-declaration line so values land at first real use', () => {
    const lines = [
      '| numbers sum evens |',
      'numbers := (1 to: 10) asOrderedCollection.',
      'sum := numbers inject: 0 into: [:a :b | a + b].',
      'evens := numbers select: [:n | n even].',
    ];
    const v: InlineVar[] = [
      { name: 'numbers', value: 'anOC…', full: 'anOrderedCollection(1 2 3)' },
      { name: 'sum', value: '55', full: '55' },
      { name: 'evens', value: 'anOC…', full: 'anOrderedCollection(2 4)' },
    ];
    const overlay = computeInlineValueLines(lines, v);
    // Nothing on the declaration line; each var at its first assignment/use.
    expect(overlay.map((o) => o.line)).toEqual([1, 2, 3]);
    expect(overlay[0].label).toBe('numbers = anOC…');
    expect(overlay[1].label).toBe('sum = 55');
    expect(overlay[2].label).toBe('evens = anOC…');
  });

  it('does not repeat a value across a tight loop (the clutter case)', () => {
    const lines = ['| total |', 'total := 0.', 'total := total + 1.', 'total'];
    const overlay = computeInlineValueLines(lines, [{ name: 'total', value: '25', full: '25' }]);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].line).toBe(1); // line 0 is the `| total |` declaration — skipped
    expect(overlay[0].label).toBe('total = 25');
  });

  it('omits variables never referenced in the source (no clutter)', () => {
    const overlay = computeInlineValueLines(['^balance'], vars);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].label).toBe('balance = 200');
    expect(JSON.stringify(overlay)).not.toContain('unused');
  });

  it('matches whole identifiers only (balance must not hit in subBalance)', () => {
    const overlay = computeInlineValueLines(['  subBalance := 1.'], vars);
    expect(overlay).toHaveLength(0);
  });

  it('separates two values that share their first-reference line', () => {
    const overlay = computeInlineValueLines(['^amount + balance'], vars);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].label).toBe('amount = 75   •   balance = 200');
    expect(overlay[0].vars).toHaveLength(2);
  });

  it('lets a later (shadowing) entry win on a name clash', () => {
    const shadowing: InlineVar[] = [
      { name: 'x', value: 'IV', full: 'IV' }, // instVar
      { name: 'x', value: 'TEMP', full: 'TEMP' }, // arg/temp shadows it
    ];
    const overlay = computeInlineValueLines(['^x'], shadowing);
    expect(overlay[0].label).toBe('x = TEMP');
  });

  it('carries full (un-truncated) values for the hover', () => {
    const long: InlineVar[] = [
      { name: 'c', value: 'an Ord…', full: 'an OrderedCollection(1 2 3 4 5)' },
    ];
    const overlay = computeInlineValueLines(['^c'], long);
    expect(overlay[0].vars[0].full).toBe('an OrderedCollection(1 2 3 4 5)');
    expect(overlay[0].label).toBe('c = an Ord…');
  });

  it('aligns annotations into one column past the widest line (padCh)', () => {
    const lines = ['x', 'a longer line referencing y'];
    const overlay = computeInlineValueLines(lines, [
      { name: 'x', value: '1', full: '1' },
      { name: 'y', value: '2', full: '2' },
    ]);
    // Both annotations should land at the same column: line.length + padCh equal.
    const col = (o: { line: number; padCh: number }) => lines[o.line].length + o.padCh;
    expect(col(overlay[0])).toBe(col(overlay[1]));
    // The short line gets more padding than the long one.
    expect(overlay[0].padCh).toBeGreaterThan(overlay[1].padCh);
  });

  it('aligns to the widest ANNOTATED line, not a long line with no values', () => {
    // A long line that has no in-scope var must not shove the column right.
    const lines = ['aVeryLongMethodCallWithNoLocalVariablesAtAllHere foo: 1.', 'x'];
    const overlay = computeInlineValueLines(lines, [{ name: 'x', value: '1', full: '1' }]);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].line).toBe(1);
    // Column tracks the tiny annotated line ('x'), so padding stays the minimum
    // gap (3) — NOT pushed out by the long line above (which would give ~40+).
    expect(overlay[0].padCh).toBe(3);
  });

  it('skips the method signature line (keyword args show at first body use)', () => {
    const lines = ['readFrom: aStream', '  | bc |', '  aStream peek.', '  bc := aStream next.'];
    const v: InlineVar[] = [
      { name: 'aStream', value: 'aStream…', full: 'aStream...' },
      { name: 'bc', value: 'nil', full: 'nil' },
    ];
    const overlay = computeInlineValueLines(lines, v, { signatureLine: true });
    // Not on the signature (line 0) nor the temp decl (line 1); aStream at line 2.
    expect(overlay.map((o) => o.line)).toEqual([2, 3]);
    expect(overlay[0].label).toBe('aStream = aStream…');
    expect(overlay[1].label).toBe('bc = nil');
  });

  it('skips a block-argument declaration (:x) but annotates its use', () => {
    const overlay = computeInlineValueLines(
      ['nums do: [:x | x squared]'],
      [{ name: 'x', value: '7', full: '7' }],
    );
    expect(overlay).toHaveLength(1);
    // The `:x` binding is skipped; the `x` in `x squared` is the annotated use.
    expect(overlay[0].label).toBe('x = 7');
  });

  it('perLine mode annotates every line that references a variable', () => {
    const lines = ['total := 0.', 'total := total + 1.', '^total'];
    const v: InlineVar[] = [{ name: 'total', value: '25', full: '25' }];
    const overlay = computeInlineValueLines(lines, v, { perLine: true });
    expect(overlay.map((o) => o.line)).toEqual([0, 1, 2]);
    expect(overlay.every((o) => o.label === 'total = 25')).toBe(true);
  });

  it('does not match an identifier that appears only in a comment', () => {
    const lines = ['"returns aString parsed"', '^self parse: aString'];
    const v: InlineVar[] = [{ name: 'aString', value: "'50'", full: "'50'" }];
    const overlay = computeInlineValueLines(lines, v, { perLine: true });
    // Only the real use on line 1, never the comment on line 0.
    expect(overlay.map((o) => o.line)).toEqual([1]);
  });

  it('does not match an identifier inside a multi-line comment', () => {
    const lines = ['foo', '"a comment', ' mentioning total again', ' total total"', '^total'];
    const v: InlineVar[] = [{ name: 'total', value: '7', full: '7' }];
    const overlay = computeInlineValueLines(lines, v, { perLine: true });
    expect(overlay.map((o) => o.line)).toEqual([4]);
  });

  it('does not match an identifier inside a string literal', () => {
    const lines = ["x := 'the value is amount'.", '^amount'];
    const v: InlineVar[] = [{ name: 'amount', value: '9', full: '9' }];
    const overlay = computeInlineValueLines(lines, v, { perLine: true });
    expect(overlay.map((o) => o.line)).toEqual([1]);
  });
});

describe('inlineHoverMarkdown (#5 Phase 2 — the inline-value hover)', () => {
  it('shows each variable as a bold name and its full (un-truncated) value', () => {
    const md = inlineHoverMarkdown([
      { name: 'balance', value: 'an Ord…', full: 'an OrderedCollection(1 2 3)' },
    ]);
    expect(md).toContain('**balance**');
    expect(md).toContain('= an OrderedCollection(1 2 3)'); // the full value, not the truncated one
  });

  it('hints that an editable variable is set by double-clicking its name', () => {
    const md = inlineHoverMarkdown([
      { name: 'amount', value: '75', full: '75', edit: { kind: 'temp', index: 2 } },
    ]);
    expect(md).toContain('**amount** = 75');
    expect(md).toContain('Double-click the variable name'); // the double-click-to-edit hint
  });

  it('escapes markdown-significant characters in the value so it renders verbatim', () => {
    const md = inlineHoverMarkdown([{ name: 'x', value: 'evil', full: '`[a]`*b*' }]);
    expect(md).toContain('\\`\\[a\\]\\`\\*b\\*'); // backticks/brackets/asterisks escaped
  });

  it('omits the click hint for a read-only-only hover (no editable variable)', () => {
    const md = inlineHoverMarkdown([{ name: 'self', value: 'an Account', full: 'an Account' }]);
    expect(md).toBe('**self** = an Account'); // no hint, no affordance
  });

  it('shows the hint once when a line mixes an editable and a read-only variable', () => {
    const md = inlineHoverMarkdown([
      { name: 'self', value: 'an Account', full: 'an Account' },
      { name: 'count', value: '7', full: '7', edit: { kind: 'instvar', index: 1 } },
    ]);
    expect(md).toContain('**self** = an Account');
    expect(md).toContain('**count** = 7');
    expect(md.match(/Double-click the variable name/g)).toHaveLength(1); // hint appears exactly once
  });
});

describe('maskCommentsAndStrings', () => {
  it('blanks comments and strings but preserves length and newlines', () => {
    const src = 'x := 1. "set x" y := \'hi\'.';
    const masked = maskCommentsAndStrings(src);
    expect(masked.length).toBe(src.length);
    expect(masked).toBe('x := 1.         y :=     .');
  });

  it('keeps a $" / $\' character literal as code (not a delimiter)', () => {
    const src = 'c := $". d := $\'. e := 1.';
    // No real comment/string opens, so nothing past the char literals is blanked.
    expect(maskCommentsAndStrings(src)).toBe(src);
  });

  it('preserves newlines across a multi-line comment', () => {
    const masked = maskCommentsAndStrings('a "c1\nc2" b');
    expect(masked.split('\n')).toHaveLength(2);
    expect(masked).toBe('a    \n    b');
  });
});

describe('InlineValuesCodeLensProvider', () => {
  const doc = (uri: string) => ({ uri: { toString: () => uri } }) as unknown as vscode.TextDocument;

  afterEach(() => vi.restoreAllMocks());

  it('emits no lens for a doc no live debugger is showing (e.g. a browser editor)', () => {
    vi.spyOn(DebuggerPanel, 'isLiveSourceUri').mockReturnValue(false);
    const lenses = new InlineValuesCodeLensProvider().provideCodeLenses(doc('gemstone://x'));
    expect(lenses).toEqual([]);
  });

  it('emits an "off" lens (with the doc URI as the command arg) for a live source', () => {
    vi.spyOn(DebuggerPanel, 'isLiveSourceUri').mockReturnValue(true);
    vi.spyOn(DebuggerPanel, 'isInlineValuesEnabledFor').mockReturnValue(false);
    const lenses = new InlineValuesCodeLensProvider().provideCodeLenses(doc('gemstone://m'));
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.command).toBe('gemstone.toggleInlineValues');
    expect(lenses[0].command?.arguments).toEqual(['gemstone://m']);
    expect(lenses[0].command?.title).toContain('off');
  });

  it('reflects the on state in the lens title', () => {
    vi.spyOn(DebuggerPanel, 'isLiveSourceUri').mockReturnValue(true);
    vi.spyOn(DebuggerPanel, 'isInlineValuesEnabledFor').mockReturnValue(true);
    const lenses = new InlineValuesCodeLensProvider().provideCodeLenses(doc('gemstone-debug://d'));
    expect(lenses[0].command?.title).toContain('on');
  });
});
