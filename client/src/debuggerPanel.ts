import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';
import * as queries from './browserQueries';
import { drainTranscript } from './transcriptSink';
import { appendTranscriptOutput } from './transcriptChannel';
import { buildLineOffsets, mapOffsetToStepPoint } from './breakpointManager';
import { EnhancedInspector } from './enhancedInspector/enhancedInspector';
import { InspectorTreeProvider } from './inspectorTreeProvider';
import { routeInspect } from './inspectRouter';
import { SystemBrowser } from './systemBrowser';
import { logError, logInfo } from './gciLog';
import { NbCancelledError, NbRunOptions } from './nbRunner';
import { extensionPathFrom } from './extensionPath';

// The webview's DOM behavior lives in a standalone file (like listFilter.js /
// methodListView.js) so it gets IDE support and can be jsdom-tested in isolation
// instead of being trapped inside the inline <script> template literal. The
// webview needs the raw source text to inject into a <script> tag, so we read it
// at runtime rather than importing it as a compiled module.
const debuggerViewJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'debuggerView.js'),
  'utf8',
);

/**
 * Toolbar glyphs, keyed by `data-cmd`. These are the exact VS Code `codicon`
 * debug-control SVGs the DAP debug toolbar uses (debug-continue / -step-over /
 * -step-into / -step-out / -restart-frame / -stop), inlined so they need no font
 * load or extra `localResourceRoots` and stay within the strict webview CSP
 * (inline SVG markup, not a fetched resource). `fill="currentColor"` lets each
 * button's text colour drive the glyph (so the danger Terminate renders red).
 */
const TOOLBAR_ICONS: Record<string, string> = {
  resume:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.578 7.149L7.578 2.186C7.397 2.058 7.198 2 7.003 2C6.484 2 6 2.411 6 3.002V13.003C6 13.594 6.485 14.005 7.004 14.005C7.201 14.005 7.403 13.946 7.585 13.815L14.585 8.777C15.142 8.376 15.139 7.546 14.579 7.15L14.578 7.149ZM7.5 12.027V3.969L13.14 7.968L7.5 12.027ZM3.5 2.75V13.25C3.5 13.664 3.164 14 2.75 14C2.336 14 2 13.664 2 13.25V2.75C2 2.336 2.336 2 2.75 2C3.164 2 3.5 2.336 3.5 2.75Z"/></svg>',
  // "Run to Cursor" (#2): a play triangle aimed at a vertical bar — run until the
  // cursor (the bar). Reads as "continue to this point", distinct from the plain
  // Resume glyph.
  runToCursor:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3.8v8.4a.6.6 0 0 0 .92.5l6.3-4.2a.6.6 0 0 0 0-1L3.92 3.3A.6.6 0 0 0 3 3.8z"/><path d="M12.25 3a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-1.5 0v-8.5A.75.75 0 0 1 12.25 3z"/></svg>',
  stepOver:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.99993 13C9.99993 14.103 9.10293 15 7.99993 15C6.89693 15 5.99993 14.103 5.99993 13C5.99993 11.897 6.89693 11 7.99993 11C9.10293 11 9.99993 11.897 9.99993 13ZM13.2499 2C12.8359 2 12.4999 2.336 12.4999 2.75V4.027C11.3829 2.759 9.75993 2 7.99993 2C5.03293 2 2.47993 4.211 2.06093 7.144C2.00193 7.554 2.28793 7.934 2.69793 7.993C2.73393 7.999 2.76993 8.001 2.80493 8.001C3.17193 8.001 3.49293 7.731 3.54693 7.357C3.86093 5.159 5.77593 3.501 8.00093 3.501C9.52993 3.501 10.9199 4.264 11.7439 5.501H9.75093C9.33693 5.501 9.00093 5.837 9.00093 6.251C9.00093 6.665 9.33693 7.001 9.75093 7.001H13.2509C13.6649 7.001 14.0009 6.665 14.0009 6.251V2.751C14.0009 2.337 13.6649 2.001 13.2509 2.001L13.2499 2Z"/></svg>',
  stepInto:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 13C10 14.103 9.10304 15 8.00004 15C6.89704 15 6.00004 14.103 6.00004 13C6.00004 11.897 6.89704 11 8.00004 11C9.10304 11 10 11.897 10 13ZM12.03 5.22C11.737 4.927 11.262 4.927 10.969 5.22L8.74904 7.44V1.75C8.74904 1.336 8.41304 1 7.99904 1C7.58504 1 7.24904 1.336 7.24904 1.75V7.439L5.02904 5.219C4.73604 4.926 4.26104 4.926 3.96804 5.219C3.67504 5.512 3.67504 5.987 3.96804 6.28L7.46804 9.78C7.61404 9.926 7.80604 10 7.99804 10C8.19004 10 8.38204 9.927 8.52804 9.78L12.028 6.28C12.321 5.987 12.321 5.512 12.028 5.219L12.03 5.22Z"/></svg>',
  // "Through" = step through blocks (gciStepThru). The `indent` arrow (turns down
  // into a nested position) reads as stepping into a block, and stays visually
  // distinct from Into's debug-step-into glyph.
  stepThrough:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.50002 3C2.77602 3 3.00002 3.224 3.00002 3.5V6.5C3.00002 7.327 3.67302 8 4.50002 8H12.293L9.64702 5.354C9.45202 5.159 9.45202 4.842 9.64702 4.647C9.84202 4.452 10.159 4.452 10.354 4.647L13.854 8.147C14.049 8.342 14.049 8.659 13.854 8.854L10.354 12.354C10.256 12.452 10.128 12.5 10 12.5C9.87202 12.5 9.74402 12.451 9.64602 12.354C9.45102 12.159 9.45102 11.842 9.64602 11.647L12.292 9.001H4.49902C3.12002 9.001 1.99902 7.88 1.99902 6.501V3.501C1.99902 3.225 2.22302 3.001 2.49902 3.001L2.50002 3Z"/></svg>',
  restartFrame:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5C1 3.22386 1.22386 3 1.5 3H14.5C14.7761 3 15 3.22386 15 3.5C15 3.77614 14.7761 4 14.5 4H1.5C1.22386 4 1 3.77614 1 3.5Z"/><path d="M1 7.5C1 7.22386 1.22386 7 1.5 7H14.5C14.7761 7 15 7.22386 15 7.5C15 7.77614 14.7761 8 14.5 8H1.5C1.22386 8 1 7.77614 1 7.5Z"/><path d="M1 11.5C1 11.2239 1.22386 11 1.5 11H7.99939V11.4994C7.99939 11.6716 8.02899 11.8407 8.08538 12H1.5C1.22386 12 1 11.7761 1 11.5Z"/><path d="M8.99939 9.49939V11.4994C8.99939 11.632 9.05207 11.7592 9.14584 11.8529C9.2396 11.9467 9.36678 11.9994 9.49939 11.9994H11.4994C11.632 11.9994 11.7592 11.9467 11.8529 11.8529C11.9467 11.7592 11.9994 11.632 11.9994 11.4994C11.9994 11.3668 11.9467 11.2396 11.8529 11.1458C11.7592 11.0521 11.632 10.9994 11.4994 10.9994H10.4994C10.5702 10.9049 10.6477 10.8157 10.7314 10.7324C11.2078 10.2778 11.8409 10.0242 12.4994 10.0242C13.1579 10.0242 13.791 10.2778 14.2674 10.7324C14.4996 10.9645 14.6838 11.2402 14.8095 11.5435C14.9352 11.8469 14.9999 12.172 14.9999 12.5004C14.9999 12.8287 14.9352 13.1539 14.8095 13.4573C14.6838 13.7606 14.4996 14.0362 14.2674 14.2684C13.7909 14.7227 13.1578 14.9762 12.4994 14.9762C11.841 14.9762 11.2079 14.7227 10.7314 14.2684C10.6371 14.1773 10.5108 14.1269 10.3797 14.1281C10.2486 14.1292 10.1232 14.1818 10.0305 14.2745C9.93778 14.3672 9.88519 14.4926 9.88405 14.6237C9.88291 14.7548 9.93331 14.8811 10.0244 14.9754C10.6808 15.6318 11.5711 16.0006 12.4994 16.0006C13.4277 16.0006 14.318 15.6318 14.9744 14.9754C15.6308 14.319 15.9996 13.4287 15.9996 12.5004C15.9996 11.5721 15.6308 10.6818 14.9744 10.0254C14.3075 9.38902 13.4212 9.03396 12.4994 9.03396C11.5776 9.03396 10.6912 9.38902 10.0244 10.0254L9.99939 10.0514V9.49939C9.99939 9.36678 9.94671 9.2396 9.85294 9.14584C9.75918 9.05207 9.632 8.99939 9.49939 8.99939C9.36678 8.99939 9.2396 9.05207 9.14584 9.14584C9.05207 9.2396 8.99939 9.36678 8.99939 9.49939Z"/></svg>',
  terminate:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 3.5V12.5H3.5V3.5H12.5ZM12.5 2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H12.5C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2Z"/></svg>',
  // Copy Stack → clipboard glyph; Dump Stack → save-to-file (floppy) glyph.
  copyStack:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>',
  dumpStack:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.353 1.146l1.5 1.5L15 3v11.5l-.5.5h-13l-.5-.5v-13l.5-.5H13l.353.146zM2 2v12h12V3.207L12.793 2H12v5H4V2H2zm7 0v4h2V2H9z"/></svg>',
};

/**
 * Jasper Debugger — a roomy, Smalltalk-style debugger rendered as a VS Code
 * webview, offered *alongside* the existing DAP debugger. Whichever entry point
 * the user picks (DAP "Debug" vs. this "Enhanced Debug") owns the suspended
 * `gsProcess` for that error, so the two never coexist on the same process.
 * Closing the panel releases (terminates) that suspended process.
 *
 * This panel is a SECOND consumer of the DAP-free data layer in
 * `debugQueries.ts` (the DAP `GemStoneDebugSession` is the first). It mirrors
 * the webview wiring conventions established in `enhancedInspector.ts`
 * (createWebviewPanel + enableScripts + retainContextWhenHidden +
 * postMessage/onDidReceiveMessage).
 *
 * Stage 0: foundation only — panel lifecycle + a message-handler skeleton that
 * proves the data-layer pipe end-to-end by listing the stack. The real
 * show-everything layout (source / variables / eval / toolbar) lands in Stage 1.
 */

/** Messages the webview sends to the extension host. */
type DebuggerInbound =
  | { command: 'ready' }
  | { command: 'copyStack' }
  | { command: 'dumpStackToFile' }
  | { command: 'openDumpFile'; path: string }
  | { command: 'copyText'; text: string }
  | { command: 'copyFrame'; level: number }
  | { command: 'selectFrame'; level: number }
  | { command: 'evalInFrame'; level: number; expr: string }
  | { command: 'resume' }
  | { command: 'runToCursor'; level: number }
  | { command: 'terminate' }
  | { command: 'stepOver'; level: number }
  | { command: 'stepInto'; level: number }
  | { command: 'stepThrough'; level: number }
  | { command: 'restartFrame'; level: number }
  | { command: 'inspectVariable'; oop: string; name: string }
  | { command: 'setVariable'; level: number; kind: 'instvar' | 'temp'; index: number; expr: string }
  | { command: 'revertVariable'; level: number; kind: 'instvar' | 'temp'; index: number }
  | { command: 'createDnuMethod' }
  | { command: 'implementInReceiver'; level: number }
  | { command: 'browseFrame'; level: number }
  | { command: 'implementSubclassResponsibility' }
  | { command: 'cancelOp' }
  | { command: 'saveLayout'; stackBasis?: string; evalHeight?: string };

/**
 * What's needed to offer "Implement #<selector>" when the process is parked on a
 * `subclassResponsibility` (T4). Detected client-side from the raw stack: the
 * abstract method is the frame just below the `subclassResponsibility[:]` marker,
 * so `selector`/`definingClassName` come from that frame and `senderServerLevel`
 * is the frame below it (the caller, for re-dispatch on save). `definingClassName`
 * bounds the implement target — you implement at-or-below the abstract class.
 */
interface SubclassRespInfo {
  selector: string;
  /** Server level of the abstract-method frame (its receiver → the implement target). */
  abstractServerLevel: number;
  /** Server level of the frame that called the abstract method (-1 if none). */
  senderServerLevel: number;
  /** The abstract method's defining class — the upper bound for the class picker. */
  definingClassName: string;
}

/** A single variable row (name / printString / oop) sent to the webview. */
interface VarRow {
  name: string;
  value: string;
  /** The variable's OOP as a decimal string (drives the dim column + Inspect). */
  oop: string;
  /**
   * When present, this row is editable via the variable evaluator (T1). Carries
   * the server-side write target: `instvar` → `instVarAt:put:` on the receiver,
   * `temp` → `_frameAt:tempAt:put:` on the frame. `index` is 1-based. Absent for
   * the (non-editable) `self` receiver row.
   */
  edit?: { kind: 'instvar' | 'temp'; index: number };
  /**
   * True when this slot has been edited away from its original value this halt,
   * so the webview shows a revert (↺) icon. Set only when true (so unchanged
   * rows stay lean); see the per-panel undo state in DebuggerPanel.
   */
  revertible?: boolean;
}

/**
 * A named group of variable rows. Stage 2 splits the flat list into Receiver
 * (`self`), Instance variables, Arguments & Temps, and a collapsed
 * `(stack temps)` group for the synthetic eval-stack temporaries.
 */
interface VarGroup {
  title: string;
  kind: 'receiver' | 'instvars' | 'argtemps' | 'stacktemps';
  vars: VarRow[];
  /** Rendered collapsed by default (used for the noisy `(stack temps)` group). */
  collapsed?: boolean;
}

/**
 * Build the `gemstone://` URI for a method's source, in the exact form the
 * GemStoneFileSystemProvider expects — and the same one the DAP
 * `stackTraceRequest` builds for its `Source.path`. Opening this URI gives the
 * companion source editor all the real-editor features (syntax highlight,
 * senders/implementors, breakpoint gutters, compile-on-save).
 *
 * Exported so the URI format is unit-testable independently of the panel.
 * (Sharing this resolution with the DAP path is review #5, a later Stage 1 item.)
 */
export function buildMethodSourceUri(sessionId: number, uriInfo: debug.MethodUriInfo): string {
  const side = uriInfo.isMeta ? 'class' : 'instance';
  return (
    `gemstone://${sessionId}` +
    `/${encodeURIComponent(uriInfo.dictName)}` +
    `/${encodeURIComponent(uriInfo.className)}` +
    `/${side}` +
    `/${encodeURIComponent(uriInfo.category)}` +
    `/${encodeURIComponent(uriInfo.selector)}`
  );
}

/** Resolved pieces of a frame label, before formatting. */
export interface FrameLabelParts {
  /** True when the frame's method is a block method. */
  isBlock: boolean;
  /** Class that defines the (home) method, e.g. "Object" or "Foo class". */
  definingClass: string;
  /** The (home) method's selector. */
  selector: string;
  /** Class of the frame's receiver, when available. */
  receiverClass?: string;
}

/**
 * Format a frame label, mirroring GsNMethod>>_descrForStackPadTo:rcvr:
 *   - block frames are prefixed `[] in ` and named by their home method;
 *   - for non-block frames whose receiver's class differs from the class that
 *     defines the method, the receiver is disambiguated as
 *     `ReceiverClass (DefiningClass)` (the standard Smalltalk convention);
 *   - block frames are NOT receiver-disambiguated (the home receiver may not
 *     correspond to the block's defining class).
 */
export function formatFrameLabel(p: FrameLabelParts): string {
  const prefix = p.isBlock ? '[] in ' : '';
  let classPart = p.definingClass;
  if (!p.isBlock && p.receiverClass && p.receiverClass !== p.definingClass) {
    classPart = `${p.receiverClass} (${p.definingClass})`;
  }
  return `${prefix}${classPart}>>#${p.selector}`;
}

/**
 * Format a frame's position annotation as `@<stepPoint> line <line>` — e.g.
 * `@2 line 12`. Either part is omitted when unavailable; returns '' when both
 * are missing. Kept pure (no `debug`/webview dependency) so it is unit-testable
 * and shared by the data layer rather than reimplemented in the webview script.
 */
export function formatFramePosition(stepPoint?: number, line?: number): string {
  const parts: string[] = [];
  if (stepPoint != null) parts.push(`@${stepPoint}`);
  // A line of 0 means the IP has no source mapping — omit it (don't show "line 0").
  if (line) parts.push(`line ${line}`);
  return parts.join(' ');
}

/** Default category for a method created from a `doesNotUnderstand:`. */
const DNU_METHOD_CATEGORY = 'as yet unclassified';

/**
 * Build a method-template stub for a selector that wasn't understood: the real
 * signature on the first line (so saving compiles the intended method) followed
 * by a comment and a `^nil` placeholder body the user fills in. Handles all three
 * selector shapes — unary (`foo`), binary (`+ arg1`), and keyword
 * (`at: arg1 put: arg2`). Pure/exported so the templating is unit-testable.
 */
export function buildMethodStub(selector: string, argCount: number): string {
  let signature: string;
  if (selector.includes(':')) {
    // Keyword selector: pair each keyword with a generated argument name.
    const keywords = selector.split(':').filter((k) => k.length > 0);
    signature = keywords.map((kw, i) => `${kw}: arg${i + 1}`).join(' ');
  } else if (argCount > 0) {
    signature = `${selector} arg1`; // binary selector (e.g. + or <=)
  } else {
    signature = selector; // unary
  }
  // Keep the comment short so it fits a normal-width source pane (the long
  // version ran off the right edge), and have it state the save step explicitly.
  return (
    `${signature}\n` +
    '\t"Fill in the body, then save (Ctrl+S) to create this method."\n' +
    '\t^nil\n'
  );
}

/**
 * Argument count implied by a selector: the number of colons for a keyword
 * selector, 1 for a binary selector (an operator like `+` / `<=`), else 0
 * (unary). Used to stub an override whose selector comes from the frame (the
 * DNU path instead reads the arg count off the failed send's descriptor).
 */
export function selectorArgCount(selector: string): number {
  if (selector.includes(':')) return (selector.match(/:/g) ?? []).length;
  return /^[A-Za-z_]/.test(selector) ? 0 : 1;
}

/** An in-scope variable for the inline-values overlay (#5). */
export interface InlineVar {
  /** Source name (instVar / arg / temp / `self`). */
  name: string;
  /** Short, single-line printString already truncated for inline display. */
  value: string;
  /** Full printString, shown on hover (un-truncated, may be multi-line). */
  full: string;
  /**
   * When present, this var is editable in-frame from the hover overlay (a `$(edit)`
   * command-link → `gemstone.editInlineValue`), exactly like its row in the
   * Variables pane. Carries the server write target — same `{kind,index}` as the
   * pane's `VarRow.edit`. Absent for `self` and the synthetic `.tN` stack temps.
   */
  edit?: { kind: 'instvar' | 'temp'; index: number };
}

/** One source line's inline overlay: the rendered text + per-var hover parts. */
export interface InlineValueLine {
  /** 0-based document line index. */
  line: number;
  /** The end-of-line annotation, e.g. `amount = 75`. */
  label: string;
  /** The variables shown on this line, in first-appearance order (for hover). */
  vars: InlineVar[];
  /**
   * Left padding (in monospace `ch`) so every annotation lines up in a single
   * right-hand column clear of the code, rather than floating just past each
   * line's own text. The panel turns this into the decoration's `margin-left`.
   */
  padCh: number;
}

/** Options controlling how the inline-value overlay is laid out (#5). */
export interface InlineValueOpts {
  /**
   * When true, annotate EVERY line that references a variable (so a name used on
   * many lines shows on each), instead of just its first use. Helpful for finding
   * a value anywhere in a long method; busier. Toggled by the second CodeLens.
   */
  perLine?: boolean;
  /**
   * True when line 0 is a method signature (`foo: arg` / `at: k put: v`) rather
   * than executed-code (a doit). The signature only DECLARES its keyword args, so
   * the whole line is skipped — the args' values show at their first body use.
   */
  signatureLine?: boolean;
}

/** Whole Smalltalk identifiers (so `total` never matches inside `subtotal`). */
const INLINE_IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
/**
 * A temporaries declaration — `| a b c |` (names + whitespace between two bars).
 * Identifiers inside one are declarations, NOT uses, so the overlay skips them:
 * a variable's value should appear where it's first *used/assigned*, not on the
 * `| … |` line. (A bitOr like `a | b | c` can false-match; harmless and rare in
 * debugger source.)
 */
const INLINE_TEMPDECL_RE = /\|[A-Za-z0-9_\s]*\|/g;
/**
 * A block-argument declaration — `:each` in `[:each | …]` (a colon NOT preceded
 * by an identifier char, so a keyword message like `at:key` is excluded). Like a
 * temp declaration, this is a binding site, not a use, so it's skipped.
 */
const INLINE_BLOCKARG_RE = /(?<![A-Za-z0-9_]):[A-Za-z_][A-Za-z0-9_]*/g;
/** Gap (in columns) between the widest annotated line and the values column. */
const INLINE_VALUE_GAP = 3;
/** Separator between two values that share one line. */
const INLINE_VALUE_SEP = '   •   ';
/** Don't push the values column past this column even if an annotated line is wider. */
const INLINE_VALUE_MAX_COL = 48;

/**
 * Collapse a printString to a single short line for the inline overlay: newlines
 * and tabs become spaces, runs of whitespace collapse, and anything past
 * `maxLen` is elided with `…`. The full value is always kept for the hover. The
 * cap is generous (not pixel-perfect — VS Code gives an extension no editor-width
 * API, so we can't truly clip to the right boundary) but keeps a giant collection
 * from running the line off-screen.
 */
export function shortenInlineValue(value: string, maxLen = 40): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
}

/**
 * Blank out Smalltalk comments (`"…"`) and string literals (`'…'`) — replacing
 * their characters (delimiters included) with spaces while preserving newlines
 * and every character position — so the overlay never matches an identifier that
 * only appears inside a comment or string. Comments span multiple lines, so this
 * scans the whole source, not line by line. Doubled quotes (`""` / `''`) are the
 * in-literal escapes; a `$"`/`$'` character literal is NOT a delimiter.
 */
export function maskCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (k: number): void => {
    if (text[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '$') {
      i += 2;
      continue;
    } // character literal: `$x`, `$"`, `$'`
    if (c === '"' || c === "'") {
      // comment or string
      const quote = c;
      blank(i);
      i++;
      while (i < text.length) {
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            blank(i);
            blank(i + 1);
            i += 2;
            continue;
          } // escaped
          blank(i);
          i++;
          break; // closing delimiter
        }
        blank(i);
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Char ranges on `line` that are binding sites (temp decls + block args). */
function declarationSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const d of line.matchAll(INLINE_TEMPDECL_RE))
    spans.push([d.index ?? 0, (d.index ?? 0) + d[0].length]);
  for (const b of line.matchAll(INLINE_BLOCKARG_RE))
    spans.push([b.index ?? 0, (b.index ?? 0) + b[0].length]);
  return spans;
}

/**
 * Compute the inline-value overlay for a method's source (#5). By default each
 * in-scope variable is shown ONCE, on the first line that USES it — declarations
 * (the `| … |` temps line, block args `:x`, and the method signature) are skipped
 * so a value lands where it's first assigned/read, and a tight loop like
 * `total := total + each` doesn't repeat the same value on every line. With
 * `opts.perLine`, every referencing line is annotated instead. Variables never
 * referenced in the visible source are omitted. Annotations align in one
 * right-hand column a fixed gap past the widest ANNOTATED line (capped) — aligning
 * to annotated lines, not the widest line overall, keeps one long line (e.g. a
 * wide temps declaration) from shoving the whole column off-screen.
 *
 * Pure + exported for unit testing; the panel turns the result into decorations.
 * `vars` is the in-scope set (later entries win on a name clash, so a shadowing
 * arg/temp overrides an instVar of the same name — the caller pushes receiver →
 * instVars → args/temps in that order).
 */
export function computeInlineValueLines(
  srcLines: string[],
  vars: InlineVar[],
  opts: InlineValueOpts = {},
): InlineValueLine[] {
  const byName = new Map<string, InlineVar>();
  for (const v of vars) byName.set(v.name, v);

  // Match against a copy with comments + string literals blanked out (spaces, so
  // positions/lengths are unchanged) — an identifier that only appears in a
  // comment or a string is not a variable reference. (Multi-line comments are why
  // this masks the whole source, not each line.)
  const lines = maskCommentsAndStrings(srcLines.join('\n')).split('\n');

  // Pass 1: which variables to show on which lines (applying decl-skip + mode).
  const shown = new Set<string>(); // first-use dedup (ignored when perLine)
  const hits: Array<{ line: number; vars: InlineVar[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (opts.signatureLine && i === 0) continue; // signature declares args only
    const spans = declarationSpans(lines[i]);
    const inDecl = (at: number): boolean => spans.some(([s, e]) => at >= s && at < e);

    const lineVars: InlineVar[] = [];
    const seenOnLine = new Set<string>();
    for (const m of lines[i].matchAll(INLINE_IDENTIFIER_RE)) {
      const name = m[0];
      if (seenOnLine.has(name) || (!opts.perLine && shown.has(name))) continue;
      // Skip a declaration occurrence WITHOUT marking it shown, so the variable
      // still gets annotated at its first real use further down.
      if (inDecl(m.index ?? 0)) continue;
      const v = byName.get(name);
      if (!v) continue;
      seenOnLine.add(name);
      if (!opts.perLine) shown.add(name);
      lineVars.push(v);
    }
    if (lineVars.length > 0) hits.push({ line: i, vars: lineVars });
  }

  // The column sits a fixed gap past the widest ANNOTATED line (capped).
  const widestAnnotated = hits.reduce((m, h) => Math.max(m, lines[h.line].length), 0);
  const targetCol = Math.min(widestAnnotated, INLINE_VALUE_MAX_COL) + INLINE_VALUE_GAP;

  // Pass 2: render label + alignment padding.
  return hits.map((h) => ({
    line: h.line,
    vars: h.vars,
    label: h.vars.map((v) => `${v.name} = ${v.value}`).join(INLINE_VALUE_SEP),
    padCh: Math.max(INLINE_VALUE_GAP, targetCol - lines[h.line].length),
  }));
}

/**
 * The hover markdown for one inline-overlay line: a `**name** = value` part per
 * variable, joined one-per-line. Each *editable* var (#5 Phase 2) gets a `$(edit)`
 * pencil command-link beside its name that opens the same set-value prompt as the
 * Variables pane — `self` and the synthetic stack temps carry no `edit`, so they
 * get no pencil and stay read-only. The link encodes `[uri, serverLevel, kind,
 * index, name]`; the caller marks the `MarkdownString` trusted for the single
 * `gemstone.editInlineValue` command (and enables codicons).
 */
export function inlineHoverMarkdown(vars: InlineVar[]): string {
  // Escape markdown-significant chars in the (server-supplied) printString so it
  // renders verbatim rather than as accidental markup.
  const safe = (s: string): string => s.replace(/[\\[\]`*_<>]/g, '\\$&');
  const body = vars.map((v) => `**${v.name}** = ${safe(v.full)}`).join('  \n');
  // Editing in the source is by double-clicking the variable's name (command-links
  // in hovers don't fire in all hosts, so the hover only hints — it isn't the
  // trigger). The hint shows only when something on this line is editable.
  return vars.some((v) => v.edit)
    ? `${body}\n\n_Double-click the variable name to set its value._`
    : body;
}

/** Minimal HTML-escape for interpolating session text into the page. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A single stack frame summary sent to the webview. */
interface FrameSummary {
  /** 1-based DISPLAY number (1 = top), after filtering; shown to the user. */
  level: number;
  label: string;
  /** Pre-formatted `@<stepPoint> line <line>` annotation; '' when unavailable. */
  position: string;
  /** True when the running method was inherited → offer "Implement in <receiverClass>". */
  overridable?: boolean;
  /** Receiver's class name, for the override menu item's label. */
  receiverClass?: string;
  /**
   * True when this frame resolved to a home method we can set a step-point break
   * in (editable method → by class>>selector; doit / non-symbol-list → by method
   * OOP). Drives whether "Run to Cursor" (#2) is enabled; false only for an
   * unresolvable `<frame N>`.
   */
  breakable?: boolean;
  /**
   * True when this frame runs a real `Class>>#selector` method we can open in a
   * System Browser — drives the right-click "Browse" item. False for an
   * Executed-Code (doit) frame or an unresolvable `<frame N>` (no class/selector).
   */
  browsable?: boolean;
}

/**
 * Host-side cached frame: a `FrameSummary` plus the real GsProcess frame level.
 * Display levels are renumbered 1..N after filtering, but server queries
 * (`revealFrameSource`, etc.) must use the original level — so we keep both.
 */
interface DisplayFrame extends FrameSummary {
  serverLevel: number;
  /** True for a doit / "Executed Code" frame (no class → can't be restarted/re-entered). */
  isExecutedCode: boolean;
  /**
   * Display level of this (block) frame's HOME method frame, when it's a block
   * whose home method is also on the visible stack — drives the "Go to home
   * method" menu item. Undefined for non-block frames and blocks whose home
   * isn't shown (already returned, or filtered out).
   */
  homeDisplayLevel?: number;
}

/**
 * Render a single frame for the clipboard — `<label>  <position>` (no leading
 * frame number, since a lone frame has no stack context). Pure/exported for
 * unit-testing; used by the right-click "Copy Frame" action.
 */
export function formatFrameForClipboard(frame: FrameSummary): string {
  return frame.position ? `${frame.label}  ${frame.position}` : frame.label;
}

/** A frame plus its variable groups, for the detailed stack dump (#10/#11). */
export interface DetailedStackFrame extends FrameSummary {
  groups: VarGroup[];
}

const DETAIL_SEP = '---------------------------------';

/** `[n] <label>  <position>` — the short-stack line shared by the summary + detail. */
function detailFrameHeading(f: FrameSummary): string {
  return `[${f.level}] ${formatFrameForClipboard(f)}`;
}

/**
 * Render the GBS-style detailed stack dump (Stage 5 #10): the short numbered
 * stack on top, then one detail block per frame — the frame heading followed by
 * its variable groups (Receiver / Instance variables / Arguments & Temps / stack
 * temps), each row as `<name> = <printString>   {<oop>}`. Pure and exported so
 * the format is unit-testable; the same text feeds both Copy Stack (clipboard)
 * and Dump Stack (file, #11).
 */
export function formatDetailedStack(
  errorMessage: string,
  frames: DetailedStackFrame[],
  header?: string,
): string {
  const lines: string[] = [];
  if (header) lines.push(header, '');
  if (errorMessage) lines.push(`GemStone error: ${errorMessage}`, '');

  // Short stack first, so a reader sees the shape before the (long) detail.
  for (const f of frames) lines.push(detailFrameHeading(f));

  // Then a detail block per frame.
  for (const f of frames) {
    lines.push('', DETAIL_SEP, detailFrameHeading(f));
    for (const g of f.groups) {
      lines.push(`${g.title}:`);
      if (g.vars.length === 0) {
        lines.push('    (none)');
        continue;
      }
      for (const v of g.vars) lines.push(`    ${v.name} = ${v.value}   {${v.oop}}`);
    }
  }
  return lines.join('\n');
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/**
 * `YYYYMMDD_HHMMSS` in local time — stable for a given Date. Leads the dump file
 * name so the stacks folder sorts chronologically.
 */
export function stackDumpTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/**
 * A safe, sortable file name for a dumped stack (#11): the timestamp FIRST (so
 * the folder lists newest-alongside-oldest in order), then the top frame as a
 * filename-safe token (block prefix dropped, non-alphanumerics collapsed to
 * `-`), e.g. `[] in JasperFoo>>#bar` → `2026-06-25_153012_JasperFoo-bar.txt`.
 */
export function stackDumpFileName(topLabel: string, d: Date): string {
  const token =
    (topLabel || '')
      .replace(/\[\] in /g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'stack';
  return `${stackDumpTimestamp(d)}_${token}.txt`;
}

/** Virtual-document scheme for read-only frame source (doits + non-symbol-list methods). */
const READONLY_SOURCE_SCHEME = 'gemstone-debug';

/**
 * A fully-resolved stack frame, before display filtering and renumbering.
 * Carries the classification bits the stack filter needs (which `FrameSummary`,
 * the wire/display shape, deliberately omits).
 */
export interface RawFrame {
  /** Real GsProcess frame level (1 = top); preserved for server queries. */
  serverLevel: number;
  methodOop: bigint;
  /** Home (enclosing) method — equal to methodOop for non-block frames. */
  homeMethodOop: bigint;
  isBlock: boolean;
  /** Defining class name WITHOUT any " class" suffix (for machinery matching). */
  definingClassName: string;
  selector: string;
  /** True for doit / "Executed Code" frames (no resolvable home class). */
  isExecutedCode: boolean;
  /** Receiver's actual class name (non-block frames only); drives override detection. */
  receiverClassName?: string;
  /**
   * True when the running method was INHERITED — the receiver's class differs
   * from the method's defining class (a real, non-doit method frame). This is
   * exactly when "Implement <selector> in <ReceiverClass>" is offered (override).
   * The home-dictionary check (is the receiver class editable?) is deferred to
   * click time, to keep buildFrame off the extra per-frame server round-trip.
   */
  overridable?: boolean;
  /**
   * True when a home method was resolved (homeMethodOop ≠ 0) — a step-point break
   * can be set in it (editable → by class>>selector; doit / non-symbol-list → by
   * method OOP). Drives "Run to Cursor" (#2); false only for an unresolvable frame.
   */
  breakable: boolean;
  label: string;
  line?: number;
  stepPoint?: number;
}

// Exception/halt machinery, trimmed from the TOP of the stack so the debugger
// opens on the user's frame (e.g. `[] in Foo>>bar`) instead of `signal`/`halt`.
// `AbstractException` covers signal/_signal/_signalToDebugger/_executeHandler:
// (instance and class side); the selectors cover Object>>halt and friends.
// `defaultAction`/`_defaultAction` are the unhandled-error path a `doesNotUnderstand:`
// parks in under GCI debug (MessageNotUnderstood>>defaultAction → _defaultAction →
// _signal → signal → doesNotUnderstand: → _doesNotUnderstand:…); trimming them opens
// the debugger on the user's frame (e.g. Executed Code) rather than this machinery.
// `subclassResponsibility`/`subclassResponsibility:` are the abstract-method markers
// (`subclassResponsibility` → `self error:`; the `:` form signals Error 2008 directly).
// Trimming them opens the debugger on the abstract method itself (the frame just below,
// e.g. `LargeNegativeInteger(Integer)>>foo`) — the method T4 offers to implement.
const MACHINERY_SELECTORS = new Set([
  'halt',
  'halt:',
  'pause',
  'error:',
  'signal',
  'signal:',
  'defaultAction',
  '_defaultAction',
  'subclassResponsibility',
  'subclassResponsibility:',
]);
// Kernel block-invocation selectors that appear as transcript-capture-wrapper
// glue at the BOTTOM (the doit evaluates its blocks via these).
const BLOCK_EVAL_SELECTORS = new Set([
  'value',
  'value:',
  'value:value:',
  'value:value:value:',
  'ensure:',
  'ifCurtailed:',
  'on:do:',
]);

// GemStone rtErrUncontinuable (ErrorSymbols #rtErrUncontinuable → 6011): raised
// when execution is asked to continue past an uncontinuable point — e.g. trying
// to single-step *over* an unhandled `halt`/error. The step drives the signal to
// `_uncontinuableError` rather than returning, so the user must Resume or
// Terminate instead. ("Not trappable with Exceptions" per the kernel.)
const GS_ERR_UNCONTINUABLE = 6011;

/** True when a frame is exception-signalling / halt machinery. */
export function isExceptionMachinery(f: RawFrame): boolean {
  return (
    f.definingClassName === 'AbstractException' ||
    f.selector.startsWith('doesNotUnderstand') ||
    f.selector.startsWith('_doesNotUnderstand') ||
    f.selector.startsWith('_signal') ||
    MACHINERY_SELECTORS.has(f.selector)
  );
}

/**
 * Filter a raw stack down to what's worth showing: trim exception/halt
 * machinery from the top, and collapse the whole transcript-capture wrapper at
 * the bottom to the single "Executed Code" doit frame. Mid-stack frames are
 * never removed. Always keeps ≥1 frame.
 *
 * The bottom collapse is *anchored on the deepest `Executed Code` frame* (the
 * doit) rather than on the literal last frame — because GemStone leaves a
 * `<Reenter marker>` (and sometimes other cruft) *below* the doit. We keep that
 * one doit frame, drop everything beneath it, and drop the contiguous glue
 * above it (the doit's own block frames, which also read as "Executed Code",
 * plus block-eval kernel frames like `ensure:`/`value`) up to the first real
 * user frame.
 *
 * Heuristic, and deliberately conservative — it only trims at the two ends, so
 * an unrecognised stack degrades to "shows a couple extra frames", never to
 * dropping real user frames.
 */
export function filterStack(raws: RawFrame[]): RawFrame[] {
  if (raws.length <= 1) return raws;

  // Top: drop a contiguous run of machinery frames (never the whole stack).
  let top = 0;
  while (top < raws.length - 1 && isExceptionMachinery(raws[top])) top++;
  const kept = raws.slice(top);

  // Bottom: find the deepest doit (Executed Code) frame, if any.
  let doitIdx = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i].isExecutedCode) {
      doitIdx = i;
      break;
    }
  }
  if (doitIdx === -1) return kept; // no wrapper (e.g. a breakpoint in a method)

  // Walk up over the contiguous wrapper glue (doit's block frames + block-eval
  // kernel frames) to the first real user frame; keep [user…] + the one doit.
  let u = doitIdx - 1;
  while (u >= 0 && (kept[u].isExecutedCode || BLOCK_EVAL_SELECTORS.has(kept[u].selector))) u--;
  return [...kept.slice(0, u + 1), kept[doitIdx]];
}

/**
 * Initial-layout nudges. VS Code's stable API can't set an exact editor-group
 * size, only step it via the relative `increase/decreaseView{Width,Height}`
 * commands, so these are best-effort approximations (tune the step counts here):
 *  - PANEL_WIDEN_STEPS: widen the Beside split from 50/50 toward ~60% for the
 *    debugger (its Call Stack + Variables sit side-by-side and want the room).
 *  - SOURCE_SHRINK_STEPS: shrink the companion source group from the 50/50
 *    `newGroupBelow` split toward ~1/3, leaving ~2/3 for the stack/variables.
 */
const PANEL_WIDEN_STEPS = 2;
const SOURCE_SHRINK_STEPS = 2;
/** Source-group fraction of its column on first open when nothing's been saved (~1/3). */
const DEFAULT_SOURCE_RATIO = 0.33;

/**
 * VS Code editor-group layout, as returned by the `vscode.getEditorLayout`
 * command and accepted by `vscode.setEditorLayout`. A tree of groups; a leaf has
 * a `size`, a branch has nested `groups`. Sizes round-trip in pixels but are
 * treated as relative weights, so preserving their sum preserves the layout.
 */
export interface EditorGroupNode {
  size?: number;
  groups?: EditorGroupNode[];
}
export interface EditorGroupLayout {
  orientation?: number;
  groups: EditorGroupNode[];
}

/**
 * Flatten a layout's leaf groups in depth-first, left-to-right order — the same
 * order VS Code assigns ViewColumns (1-based), so leaf N maps to ViewColumn N+1.
 * Each entry carries its parent branch so callers can find a leaf's siblings.
 */
export function flattenLayoutLeaves(
  layout: EditorGroupLayout,
): { node: EditorGroupNode; parent: EditorGroupNode }[] {
  const acc: { node: EditorGroupNode; parent: EditorGroupNode }[] = [];
  const root: EditorGroupNode = { groups: layout.groups };
  const walk = (node: EditorGroupNode, parent: EditorGroupNode): void => {
    if (node.groups && node.groups.length) {
      for (const child of node.groups) walk(child, node);
    } else {
      acc.push({ node, parent });
    }
  };
  for (const g of layout.groups) walk(g, root);
  return acc;
}

/**
 * The source group's fraction of its containing branch, or undefined if the
 * column can't be located / measured. `sourceColumn` is 1-based (a ViewColumn).
 */
export function sourceRatioFromLayout(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
): number | undefined {
  if (!layout || !sourceColumn) return undefined;
  const leaves = flattenLayoutLeaves(layout);
  const leaf = leaves[sourceColumn - 1];
  if (!leaf || leaf.node.size == null || !leaf.parent.groups) return undefined;
  const total = leaf.parent.groups.reduce((s, g) => s + (g.size ?? 0), 0);
  if (total <= 0) return undefined;
  return leaf.node.size / total;
}

/**
 * Set the source group to `ratio` of its containing branch, giving the rest to
 * its sibling (the debugger group). Mutates `layout` in place; returns false
 * (leaving it untouched) when the source isn't a clean two-way split we created
 * — so an unusual user layout falls back to the step-based resize. `ratio` is
 * clamped to a sane band so a degenerate save can't collapse a pane.
 */
export function setSourceRatioInLayout(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
  ratio: number,
): boolean {
  if (!layout || !sourceColumn) return false;
  const leaves = flattenLayoutLeaves(layout);
  const leaf = leaves[sourceColumn - 1];
  if (!leaf || !leaf.parent.groups || leaf.parent.groups.length !== 2) return false;
  const total = leaf.parent.groups.reduce((s, g) => s + (g.size ?? 0), 0);
  if (total <= 0) return false;
  const clamped = Math.max(0.1, Math.min(0.9, ratio));
  const sourceSize = Math.round(total * clamped);
  const sibling = leaf.parent.groups.find((g) => g !== leaf.node);
  if (!sibling) return false;
  leaf.node.size = sourceSize;
  sibling.size = total - sourceSize;
  return true;
}

export class DebuggerPanel {
  private static panels = new Map<number, Set<DebuggerPanel>>();
  /**
   * Highlight for the selected frame's current step point in the companion
   * source editor — the standard debugger "focused stack frame" colour, boxed
   * and on the overview ruler. It marks just the step-point token (NOT the whole
   * line), so a line with several sends shows exactly where execution paused.
   * One type shared by all panels (a decoration type is a style, not per-editor).
   *
   * Dark themes use the standard `editor.focusedStackFrameHighlightBackground`
   * theme colour. In LIGHT themes that colour is a very faint translucent yellow
   * — and since we mark only the step-point token (not the whole line) it nearly
   * vanishes — so the `light` override gives a stronger, more opaque fill plus a
   * solid dark-goldenrod border to clearly box the paused token.
   */
  private static readonly stepPointDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    borderRadius: '2px',
    overviewRulerColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
    light: {
      backgroundColor: 'rgba(255, 197, 0, 0.45)',
      borderColor: '#b8860b',
      overviewRulerColor: '#b8860b',
    },
  });

  /**
   * Inline-value overlay (#5): a dim, inlay-hint-styled annotation appended at
   * end-of-line showing each referenced variable's value. Styling lives on the
   * type; the per-line text (`after.contentText`) and hover are supplied per
   * decoration. `textDecoration` is the standard CSS-injection escape hatch to
   * shrink the font and give the chip a little padding (there's no first-class
   * font-size field on a decoration attachment). Off unless the user toggles it.
   */
  private static readonly inlineValueDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorInlayHint.foreground'),
      backgroundColor: new vscode.ThemeColor('editorInlayHint.background'),
      fontStyle: 'normal',
      textDecoration: 'none; font-size: 0.85em; padding: 0 4px; border-radius: 4px;',
    },
  });

  // ── Read-only source for frames with no gemstone:// editor ──────────
  // "Executed Code" doits (no class at all) and methods whose class isn't in the
  // session's symbol list (so no dictName → no gemstone:// URI) are served
  // read-only through a content provider (never dirty, no "Untitled-N" pileup)
  // keyed by a per-session+method virtual URI.
  private static readOnlySources = new Map<string, string>();
  private static providerRegistered = false;

  /**
   * The Call-Stack-vs-Variables split, as a CSS width for the stack pane
   * (`--stack-basis`). Remembered across panels for the lifetime of this VS Code
   * window so a resize sticks from one debugger to the next; the webview also
   * persists it via getState/setState so it survives a webview reload. (Full
   * cross-restart persistence would need globalState — deferred.) Default 60%.
   */
  private static savedStackBasis = '60%';

  /**
   * The classic Inspector tree view, injected once at activation. Used as the
   * fallback for "Inspect" on a stack variable when the session has no enhanced
   * inspector installed (else the variable opens in an Enhanced Inspector beside
   * the debugger). The panel isn't constructed with it — its factory runs deep
   * inside codeExecutor — so it's a static handle rather than a ctor arg.
   */
  static inspectorProvider: InspectorTreeProvider | undefined;

  /**
   * Whether the inline-value overlay (#5) is on. Off by default — it can clutter
   * a large method — and toggled per source pane via the editor-title button.
   * Remembered window-wide (like `savedStackBasis`) so the choice carries from
   * one debugger to the next.
   */
  private static savedInlineValuesEnabled = false;
  /** Window-remembered inline-value mode (see `inlineValuesPerLine`). */
  private static savedInlineValuesPerLine = false;

  /**
   * The eval bar's height (`--eval-height`); the hsplitter resizes it, trading
   * space with the panes (which flex-fill the rest). Like `savedStackBasis`,
   * remembered across panels for this window and persisted webview-side via
   * getState/setState. Default 4rem — just the input plus a slim result strip;
   * the old 7rem left a tall empty band below the input on first open. The
   * hsplitter still grows it on demand (e.g. for a multi-line eval result).
   */
  private static savedEvalHeight = '4rem';

  /**
   * The companion source group's fraction of its column, remembered across
   * debugger opens for this window so the user's drag of the panel↔source
   * divider sticks. Unlike the two webview splitters (which we own and can read
   * on drag-end), this is an editor-group split VS Code owns: there's no resize
   * event, so we sample it with `vscode.getEditorLayout` on a low-frequency timer
   * while the panel is open and re-apply it with `vscode.setEditorLayout` on the
   * next open. Undefined until first sampled → DEFAULT_SOURCE_RATIO is used.
   */
  private static savedSourceRatio: number | undefined;

  /**
   * Workspace-state key + handle for reaping orphaned companion source tabs.
   *
   * The companion source editor is a real text-editor tab (a `gemstone://`
   * method or our `gemstone-debug:` doc), which VS Code persists and restores
   * across a window close — unlike the webview panel, which is dropped (we
   * register no serializer). So if the window is closed while a debugger is
   * open, `dispose()` → `closeSourceEditors()` can't win the shutdown race (the
   * async tab close isn't persisted), and the source tab comes back next launch
   * orphaned — and broken, since there's no live session to resolve `gemstone://`.
   *
   * Fix: keep the set of currently-open debugger source URIs in `workspaceState`
   * (rewritten as the union of all live panels whenever it changes; emptied on
   * clean dispose). On the next activation `initSourceTabCleanup` closes whatever
   * is left over — exactly the tabs a window-close-with-debugger-open orphaned —
   * then re-arms a fresh set. Tracking only our own URIs means a System Browser
   * tab the user opened independently is never touched.
   */
  private static orphanState: vscode.Memento | undefined;
  private static readonly ORPHAN_SOURCE_KEY = 'jasper.debugger.orphanSourceUris';

  /**
   * Arm orphan-source-tab cleanup for this window: close any source tab a prior
   * session left open at window close, then re-arm a fresh (empty) set. Call once
   * from `activate()` with `context.workspaceState`.
   */
  static initSourceTabCleanup(state: vscode.Memento): void {
    DebuggerPanel.orphanState = state;
    const orphans = state.get<string[]>(DebuggerPanel.ORPHAN_SOURCE_KEY, []);
    // Re-arm immediately; live panels re-populate as they open source editors.
    void state.update(DebuggerPanel.ORPHAN_SOURCE_KEY, undefined);
    if (orphans.length === 0) return;
    const wanted = new Set(orphans);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && wanted.has(tab.input.uri.toString())) {
          void vscode.window.tabGroups.close(tab);
        }
      }
    }
  }

  /**
   * Rewrite the persisted orphan set as the union of every live panel's open
   * source URIs. Called after any panel opens/closes a source tab so the set
   * always reflects what's currently open — if the window dies abruptly, the
   * leftover set is exactly what needs reaping next launch. No-op until armed.
   */
  private static persistLiveSourceUris(): void {
    const state = DebuggerPanel.orphanState;
    if (!state) return;
    const uris = new Set<string>();
    for (const set of DebuggerPanel.panels.values()) {
      for (const dbg of set) {
        for (const u of dbg.shownSourceUris) uris.add(u);
        for (const u of dbg.dnuMethodUris) uris.add(u);
      }
    }
    void state.update(DebuggerPanel.ORPHAN_SOURCE_KEY, uris.size ? Array.from(uris) : undefined);
  }

  private static ensureReadOnlySourceProvider(): void {
    if (DebuggerPanel.providerRegistered) return;
    DebuggerPanel.providerRegistered = true;
    vscode.workspace.registerTextDocumentContentProvider(READONLY_SOURCE_SCHEME, {
      provideTextDocumentContent: (uri: vscode.Uri) =>
        DebuggerPanel.readOnlySources.get(uri.toString()) ?? '',
    });
  }

  /** Stash a frame's read-only source and return its virtual URI; `title` is the tab label. */
  private static stashReadOnlySource(
    sessionId: number,
    methodOop: bigint,
    title: string,
    source: string,
  ): vscode.Uri {
    DebuggerPanel.ensureReadOnlySourceProvider();
    // Path titles the tab; query keeps each method distinct.
    const uri = vscode.Uri.from({
      scheme: READONLY_SOURCE_SCHEME,
      path: title,
      query: `session=${sessionId}&method=${methodOop}`,
    });
    DebuggerPanel.readOnlySources.set(uri.toString(), source);
    return uri;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  /** Last fetched (filtered) stack, cached so copy/select need not re-query. */
  private frames: DisplayFrame[] = [];
  /**
   * The UN-filtered raw stack from the same fetch. `filterStack` collapses a
   * doit's wrapper/block frames into a single "Executed Code" frame, discarding
   * the frame execution actually stopped in — so the highlight path consults
   * these to find the true stop frame (see `stopFrameLevel`).
   */
  private rawFrames: RawFrame[] = [];
  /** Column the companion source editor lives in, reused across frame selects. */
  private sourceColumn: vscode.ViewColumn | undefined;
  /**
   * The most recent companion source editor. Its live `.viewColumn` is the
   * authoritative current column of the source group at dispose time — VS Code
   * renumbers ViewColumns positionally as groups are added/removed (e.g. when a
   * enhanced inspector opens Beside), so the captured `sourceColumn` number can go
   * stale. We read this editor's column when closing so the right group matches.
   */
  private sourceEditor: vscode.TextEditor | undefined;
  /** Low-frequency sampler of the source-group ratio (see savedSourceRatio); cleared on dispose. */
  private layoutSampler: ReturnType<typeof setInterval> | undefined;
  /**
   * enhanced inspectors opened from this debugger's Variables pane. They're artifacts
   * of this debugger, so they're closed when it closes (see dispose).
   */
  private openedInspectors = new Set<EnhancedInspector>();
  /** The editor currently carrying the step-point highlight, if any. */
  private decoratedEditor: vscode.TextEditor | undefined;
  /** Whether this panel's inline-value overlay (#5) is currently shown. */
  private inlineValuesEnabled = DebuggerPanel.savedInlineValuesEnabled;
  /** Inline-value mode: false = once at first use (default), true = every reference. */
  private inlineValuesPerLine = DebuggerPanel.savedInlineValuesPerLine;
  /** The editor currently carrying the inline-value overlay, if any. */
  private inlineDecoratedEditor: vscode.TextEditor | undefined;
  /**
   * The current overlay's per-line variables and frame, so the inline-value
   * HoverProvider (#5 Phase 2) can serve the value+edit-pencil hover on demand.
   * A registered HoverProvider is used rather than the decoration's `hoverMessage`
   * because command-links only fire from provider hovers, not decoration hovers.
   */
  private inlineHoverByLine = new Map<number, InlineVar[]>();
  private inlineHoverLevel: number | undefined;
  /**
   * Editable in-scope variables for the shown frame, keyed by source name → write
   * target. Drives click-to-edit: while the overlay is on, a mouse click on one of
   * these names in the source opens its set-value prompt. Built in
   * `updateInlineValues`; empty when the overlay is off (so clicks behave normally).
   */
  private inlineEditableByName = new Map<string, { kind: 'instvar' | 'temp'; index: number }>();
  /**
   * The selected frame's variable groups, cached so toggling the inline overlay
   * (or its mode) re-renders from memory instead of re-running N blocking
   * getObjectPrintString round-trips per click. Keyed by server level; dropped
   * when the stack moves (refresh) or a value is edited (set/revert).
   */
  private varGroupsCache: { level: number; groups: VarGroup[] } | undefined;
  /**
   * True when the source pane currently shows a method (its line 0 is a selector
   * signature) rather than executed code — so the overlay skips the signature's
   * keyword-arg declarations. Set by revealFrameSource.
   */
  private shownFrameIsMethod = false;
  /** Virtual read-only source URIs this panel stashed (pruned on dispose). */
  private stashedSourceKeys = new Set<string>();
  /** Every source URI shown in the companion editor (closed on dispose). */
  private shownSourceUris = new Set<string>();
  /** Server level of the currently-selected frame (drives edit-and-continue). */
  private selectedServerLevel: number | undefined;
  /**
   * The `gemstone://` URI of the selected frame's source IFF it is an editable
   * method — set by revealFrameSource, cleared for read-only (doit) frames.
   * Saving this exact document triggers edit-and-continue for the selected frame.
   */
  private editableSourceUri: string | undefined;
  /**
   * The URI the companion editor currently shows for the selected frame — the
   * editable `gemstone://` method OR the read-only `gemstone-debug:` doit source.
   * Set by revealFrameSource for BOTH. "Run to Cursor" uses it to confirm the
   * cursor refers to the selected frame's source before mapping it.
   */
  private shownFrameSourceUri: string | undefined;
  /**
   * When the suspended process is parked on a `doesNotUnderstand:`, the info
   * needed to offer "Create #<selector> in <Class>" — re-detected whenever the
   * stack is (re)fetched, undefined otherwise. Drives the webview's Create button.
   */
  private dnuInfo: debug.DnuInfo | undefined;
  /**
   * While a create-method-from-DNU template is being edited, the `gemstone://`
   * new-method URI of that template, and the server level of the frame that made
   * the failed send. Saving the template (a clean compile) restarts that sender
   * frame so the send re-dispatches into the freshly-created method.
   */
  private pendingDnuMethodUri: string | undefined;
  private pendingDnuSelector: string | undefined;
  /**
   * While an "Implement in <class>" template is being edited: the `gemstone://`
   * URI being edited (a new-method template, or the real method when editing an
   * existing one), the selector, and the target class (for the save message).
   * Saving (a clean compile) just refreshes + explains — option B, no auto-trim;
   * the new method is used on the NEXT send of the selector.
   */
  private pendingOverrideUri: string | undefined;
  private pendingOverrideSelector: string | undefined;
  /** The class the pending override is being implemented in (for the save message). */
  private pendingOverrideTargetClass: string | undefined;
  /** Set when the chosen target is shadowed by a more-specific subclass impl;
   *  surfaced after save so the user understands why a new send still won't reach
   *  the method they just implemented higher up the chain. */
  private pendingOverrideShadowedBy: string | undefined;
  /**
   * Set for a T4 (subclassResponsibility) implement: the server level of the
   * frame that SENT the abstract method (the caller). Unlike a plain override
   * (option B), an abstract method that's on the stack won't dispatch into the
   * new method on a bare Resume — its activation already returned to the abstract
   * stub — so on a clean save we re-enter this sender (when re-enterable) so the
   * send re-dispatches into the concrete method. Undefined for a normal override.
   */
  private pendingOverrideReEnterSenderLevel: number | undefined;
  /**
   * When the suspended process is parked on a `subclassResponsibility` (an abstract
   * method that should have been overridden in a concrete subclass), the info
   * needed to offer "Implement #<selector>" (T4). Re-detected whenever the stack is
   * (re)fetched, undefined otherwise. Drives the webview's Implement button.
   */
  private subclassRespInfo: SubclassRespInfo | undefined;
  /**
   * Suppresses the "Implement #sel" button once a T4 implement is underway/resolved
   * for the SAME parked subclassResponsibility (mirrors `dnuSuppressed`). Reset when
   * a trim rebuilds the stack (a genuinely new abstract-method stop may then appear).
   */
  private srSuppressed = false;
  /**
   * Suppresses the "Create #sel" button once a create is underway or resolved, so
   * it never reappears for the SAME parked doesNotUnderstand: (the method now
   * exists, but the suspended process still has the DNU frame on its stack). Reset
   * when a successful trim rebuilds the stack (a genuinely new DNU may then appear).
   */
  private dnuSuppressed = false;
  /**
   * gemstone:// URIs of DNU method templates this panel opened AND the methods
   * they compile to — closed on dispose regardless of column (we created them, so
   * unlike a shared method open in the System Browser they're safe to close).
   */
  private dnuMethodUris = new Set<string>();
  /**
   * True once the TOP frame's method has been recompiled in place but could not
   * be re-entered (GemStone has no primitive to reset the top-of-stack IP — see
   * editAndContinue). The suspended top activation is then stale: continuing or
   * stepping it via GciTsContinueWith / gciStep… does NOT return (it hangs the
   * gem, freezing the whole extension host — confirmed 2026-06-22). So while this
   * is set, Resume/Step are refused with guidance; it clears the moment a trim
   * (Restart a deeper frame / deep edit-and-continue) rebuilds the stack.
   */
  private staleTopActivation = false;
  /**
   * True once the process has hit an uncontinuable state (GemStone error 6011 —
   * e.g. a step drove an unhandled `halt`/error to `_uncontinuableError`). The
   * process is then dead-ended: neither Resume nor Step can recover it (each
   * retry just re-signals 6011 and GemStone grows the exception-chain message),
   * so while set we refuse both with a Terminate-only banner and make NO further
   * GCI call. Cleared by a trim (Restart a deeper frame / deep edit-and-continue),
   * which rebuilds the stack from a fresh activation.
   */
  private uncontinuable = false;
  /**
   * True while a non-blocking GCI operation (step / trim) is in flight. Only one
   * GciTsNb… call may be outstanding per session, and overlapping a blocking
   * Resume on top of one is illegal — so step/resume/restart are ignored while
   * set. Cleared when the operation settles (resolve / reject / cancel).
   */
  private nbBusy = false;
  /**
   * Cancel handle for the in-flight non-blocking op (#9 cancel). Set from the nb
   * runner's `onStart` while a cancellable op runs; calling it requests a soft
   * break, then a hard break on a second call. Drives the in-panel Cancel button
   * (which the webview shows only while the busy spinner is up). Undefined when
   * nothing cancellable is running.
   */
  private activeNbCancel: (() => void) | undefined;
  /** How many times Cancel was clicked for the current op (1 = soft break, 2+ = hard).
   *  Reset to 0 when a cancellable op begins; drives the acknowledgement wording. */
  private cancelClicks = 0;
  /** Set in dispose() so an in-flight Nb op's continuation skips touching a dead panel. */
  private disposed = false;

  /**
   * Variable-revert (single-level undo) state, scoped to the current halt.
   * `undoOriginals` maps a slot key (`level:kind:index`) → the OOP the slot held
   * before its FIRST edit this halt; `undoDirty` is the subset whose value still
   * differs from that original (drives the ↺ revert icon). `undoPinned` is the
   * non-immediate originals saved against GC via `saveObjs` — released together
   * (never per-slot, since the export set isn't ref-counted) by clearUndoState()
   * on any stack-mutating op and on dispose. See setVariable / revertVariable.
   */
  private undoOriginals = new Map<string, bigint>();
  private undoDirty = new Set<string>();
  private undoPinned: bigint[] = [];

  /**
   * @param onComplete called with the process's result oop when execution
   *   completes via Resume or step-to-completion (e.g. so a halted Display It
   *   can render its result back in the workspace). Omitted when there's no
   *   result to surface (Execute It, or a halt not originating from a doit).
   */
  static create(
    session: ActiveSession,
    gsProcess: bigint,
    errorMessage: string,
    onComplete?: (resultOop: bigint) => void,
  ): void {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneEnhancedDebugger',
      'Jasper Debugger',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    // The Beside split is 50/50; nudge the (now-focused) debugger group wider
    // toward ~60% — its stack/variables panes want more room than the code.
    void (async () => {
      try {
        for (let i = 0; i < PANEL_WIDEN_STEPS; i++) {
          await vscode.commands.executeCommand('workbench.action.increaseViewWidth');
        }
      } catch {
        /* best-effort layout */
      }
    })();
    const debugger_ = new DebuggerPanel(panel, session, gsProcess, errorMessage, onComplete);
    if (!DebuggerPanel.panels.has(session.id)) {
      DebuggerPanel.panels.set(session.id, new Set());
    }
    DebuggerPanel.panels.get(session.id)!.add(debugger_);
    // Single-stepping needs no session-wide setup here: the debugged process
    // started interpreted (GCI_PERFORM_FLAG_INTERPRETED at execution start —
    // GemStone can't step native code, error 6014) and every step/continue
    // perform carries the same flag (STEP_FLAGS in debugQueries).
  }

  static disposeForSession(sessionId: number): void {
    const set = DebuggerPanel.panels.get(sessionId);
    if (set) {
      for (const dbg of set) dbg.panel.dispose();
      DebuggerPanel.panels.delete(sessionId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    private readonly gsProcess: bigint,
    // Mutable: resume-into-another-error updates it; step/restart clear it.
    private errorMessage: string,
    private readonly onComplete?: (resultOop: bigint) => void,
  ) {
    this.panel = panel;
    this.sessionId = session.id;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: DebuggerInbound) => this.handleMessage(msg),
      null,
      this.disposables,
    );
    // Edit-and-continue: saving the selected frame's source recompiles it (the
    // gemstone:// FS provider) and then re-enters the recompiled method.
    vscode.workspace.onDidSaveTextDocument(
      (doc) => this.onSourceSaved(doc),
      null,
      this.disposables,
    );
    // Double-click-to-edit (#5 Phase 2): double-clicking an editable variable's
    // name in the companion source (while the inline overlay is on) opens its
    // set-value prompt — a direct selection handler, since hover command-links
    // don't fire here. A single click is left alone (cursor / Run to Cursor).
    vscode.window.onDidChangeTextEditorSelection(
      (e) => this.onSourceSelectionChanged(e),
      null,
      this.disposables,
    );
  }

  /**
   * Double-click-to-edit handler: a double-click selects the whole word, so when
   * the mouse selects an editable in-scope variable's name in this panel's source
   * pane (overlay on), open that variable's set-value prompt. A single click
   * leaves an EMPTY selection and is ignored — the cursor stays put for normal
   * navigation and Run to Cursor (#2).
   */
  private onSourceSelectionChanged(e: vscode.TextEditorSelectionChangeEvent): void {
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return; // mouse, not keyboard
    if (!this.inlineValuesEnabled || this.inlineHoverLevel === undefined) return;
    // Compare by document URI, not editor identity — VS Code can hand back a
    // different TextEditor instance for the same view, which a `!==` would miss.
    const uri = this.sourceEditor?.document.uri.toString();
    if (uri === undefined || e.textEditor.document.uri.toString() !== uri) return;
    const sel = e.selections[0];
    if (!sel || sel.isEmpty) return; // single click → leave the cursor
    const word = e.textEditor.document.getText(sel); // the double-clicked word
    const edit = this.inlineEditableByName.get(word);
    if (!edit) return; // not an editable variable
    void this.editInlineValue(this.inlineHoverLevel, edit.kind, edit.index, word);
  }

  private handleMessage(msg: DebuggerInbound): void {
    switch (msg.command) {
      case 'ready': {
        this.frames = this.fetchStack();
        this.dnuInfo = this.detectDnu();
        this.subclassRespInfo = this.detectSubclassResp();
        this.postInit();
        return;
      }
      case 'copyStack': {
        // Copy Stack copies the FULL (detailed) stack — short stack on top, then
        // each frame's variable values — the same text Dump Stack writes to file.
        void vscode.env.clipboard.writeText(this.buildDetailedStackText(new Date()));
        return;
      }
      case 'dumpStackToFile': {
        void this.dumpStackToFile();
        return;
      }
      case 'openDumpFile': {
        void this.openDumpFile(msg.path);
        return;
      }
      case 'copyText': {
        void vscode.env.clipboard.writeText(msg.text);
        return;
      }
      case 'copyFrame': {
        const frame = this.frames.find((f) => f.level === msg.level);
        if (frame) void vscode.env.clipboard.writeText(formatFrameForClipboard(frame));
        return;
      }
      case 'selectFrame': {
        // Map the display level the webview reported back to the server level,
        // then drive the source pane AND the variables pane for that frame.
        const frame = this.frames.find((f) => f.level === msg.level);
        if (frame) {
          this.selectedServerLevel = frame.serverLevel;
          void this.revealFrameSource(frame.serverLevel);
          this.postVariables(frame.serverLevel);
        }
        return;
      }
      case 'evalInFrame': {
        const frame = this.frames.find((f) => f.level === msg.level);
        void this.evalInFrame(frame?.serverLevel, msg.expr);
        return;
      }
      case 'cancelOp': {
        this.cancelActiveOp();
        return;
      }
      case 'resume': {
        this.resume();
        return;
      }
      case 'runToCursor': {
        this.runToCursor(msg.level);
        return;
      }
      case 'terminate': {
        this.panel.dispose();
        return;
      } // dispose → clearStack
      case 'stepOver':
      case 'stepInto':
      case 'stepThrough': {
        void this.step(msg.command, msg.level);
        return;
      }
      case 'restartFrame': {
        const frame = this.frames.find((f) => f.level === msg.level);
        if (frame) void this.restartFrame(frame.serverLevel);
        return;
      }
      case 'createDnuMethod': {
        void this.createDnuMethod();
        return;
      }
      case 'implementInReceiver': {
        void this.implementInReceiver(msg.level);
        return;
      }
      case 'browseFrame': {
        void this.browseFrame(msg.level);
        return;
      }
      case 'implementSubclassResponsibility': {
        void this.implementSubclassResponsibility();
        return;
      }
      case 'setVariable': {
        const frame = this.frames.find((f) => f.level === msg.level);
        this.setVariable(frame?.serverLevel, msg.kind, msg.index, msg.expr);
        return;
      }
      case 'revertVariable': {
        const frame = this.frames.find((f) => f.level === msg.level);
        this.revertVariable(frame?.serverLevel, msg.kind, msg.index);
        return;
      }
      case 'inspectVariable': {
        // Inspect the clicked variable through the shared router: with the
        // enhanced inspector installed it opens beside the debugger and is
        // tracked so it closes with the debugger (it's an artifact of it);
        // otherwise it falls back to the classic Inspector tree view in the
        // primary sidebar (which persists on its own).
        try {
          const inspector = routeInspect(
            this.session,
            BigInt(msg.oop),
            msg.name,
            DebuggerPanel.inspectorProvider!,
          );
          if (inspector) this.openedInspectors.add(inspector);
        } catch (e: unknown) {
          logError(this.sessionId, e instanceof Error ? e.message : String(e));
        }
        return;
      }
      case 'saveLayout': {
        // Remember the splits (stack-vs-variables width, eval-bar height) so the
        // next panel opens the same way. Each is sent only when it changed.
        if (msg.stackBasis != null) DebuggerPanel.savedStackBasis = msg.stackBasis;
        if (msg.evalHeight != null) DebuggerPanel.savedEvalHeight = msg.evalHeight;
        return;
      }
    }
  }

  /** Post the current (filtered) stack to the webview; it re-renders + re-selects top. */
  private postInit(): void {
    this.panel.webview.postMessage({
      command: 'init',
      errorMessage: this.errorMessage,
      // Send only the display shape; serverLevel stays host-side.
      stack: this.frames.map((f) => ({
        level: f.level,
        label: f.label,
        position: f.position,
        overridable: f.overridable,
        receiverClass: f.receiverClass,
        breakable: f.breakable,
        browsable: f.browsable,
        homeDisplayLevel: f.homeDisplayLevel,
      })),
      // When parked on a doesNotUnderstand:, drive the "Create #sel in Class" button.
      dnu: this.dnuInfo
        ? {
            selector: this.dnuInfo.selector,
            className: this.dnuInfo.className,
            isMeta: this.dnuInfo.isMeta,
          }
        : undefined,
      // When parked on a subclassResponsibility, drive the "Implement #sel" button (T4).
      // The target class is chosen via picker, so only the selector is sent.
      subclassResp: this.subclassRespInfo
        ? { selector: this.subclassRespInfo.selector }
        : undefined,
    });
  }

  /** Re-walk the (advanced) stack and re-render — used after a step / restart / resume-with-error. */
  private refresh(): void {
    this.invalidateVariablesCache(); // the stack moved — cached values are stale
    this.frames = this.fetchStack();
    this.dnuInfo = this.detectDnu();
    this.subclassRespInfo = this.detectSubclassResp();
    this.postInit();
  }

  /**
   * Detect whether the process is parked on a `doesNotUnderstand:` and, if so,
   * what method the user could create. Best-effort: any failure → undefined (the
   * Create button just doesn't appear).
   */
  private detectDnu(): debug.DnuInfo | undefined {
    // Suppress the Create button while a create is being edited (pendingDnuMethodUri)
    // or after one is resolved for this parked DNU (dnuSuppressed) — the method now
    // exists, but the suspended process still has the doesNotUnderstand: frame, so
    // re-detecting it would wrongly re-offer "Create".
    if (this.pendingDnuMethodUri !== undefined || this.dnuSuppressed) return undefined;
    try {
      return debug.getDoesNotUnderstandInfo(this.session, this.gsProcess);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }

  /**
   * Detect whether the process is parked on a `subclassResponsibility` (T4): scan
   * the RAW stack (pre-trim) for the `subclassResponsibility[:]` marker frame — the
   * frame just below it is the abstract method whose selector should be implemented
   * concretely. Client-side only (no GCI round-trip): the marker, the abstract
   * method's selector + defining class, and the caller's level all come from frames
   * the panel already built. Suppressed while a DNU is offered (DNU takes
   * precedence), while a T4 template is being edited, or once resolved (srSuppressed).
   */
  private detectSubclassResp(): SubclassRespInfo | undefined {
    if (this.dnuInfo || this.srSuppressed || this.pendingOverrideUri !== undefined)
      return undefined;
    const raws = this.rawFrames;
    const srIdx = raws.findIndex(
      (r) => r.selector === 'subclassResponsibility' || r.selector === 'subclassResponsibility:',
    );
    // Need the abstract method frame just below the marker. (srIdx+1 must exist.)
    if (srIdx === -1 || srIdx + 1 >= raws.length) return undefined;
    const abstractFrame = raws[srIdx + 1];
    // Only a real method can be implemented/overridden — never a block or doit.
    if (!abstractFrame.selector || abstractFrame.isBlock || abstractFrame.isExecutedCode)
      return undefined;
    if (!abstractFrame.definingClassName) return undefined;
    const sender = raws[srIdx + 2];
    return {
      selector: abstractFrame.selector,
      abstractServerLevel: abstractFrame.serverLevel,
      senderServerLevel: sender ? sender.serverLevel : -1,
      definingClassName: abstractFrame.definingClassName,
    };
  }

  /**
   * Create-method-from-DNU. Open a `gemstone://` new-method template pre-filled
   * with the unknown selector's signature in the receiver's class, then remember
   * it so the next save (a clean compile) restarts the frame that made the failed
   * send — re-dispatching it into the new method. The user fills in the body.
   */
  /**
   * Build a `gemstone://` method URI EXACTLY as GemStoneFileSystemProvider's
   * `buildMethodUri` does — `vscode.Uri.from` (which leaves `:` un-encoded in the
   * path), NOT `buildMethodSourceUri`'s `encodeURIComponent` (which yields `%3A`).
   * The two produce different `.toString()`s for keyword selectors, so matching
   * the FS provider's form is what lets us recognise (and close) the tab it opens.
   * `selector` may be `new-method` for the template URI. Env 0 (no query).
   */
  private gemstoneMethodUri(
    dictName: string,
    className: string,
    isMeta: boolean,
    selector: string,
  ): vscode.Uri {
    return vscode.Uri.from({
      scheme: 'gemstone',
      authority: String(this.session.id),
      path: `/${dictName}/${className}/${isMeta ? 'class' : 'instance'}/${DNU_METHOD_CATEGORY}/${selector}`,
    });
  }

  private async createDnuMethod(): Promise<void> {
    const dnu = this.dnuInfo;
    if (!dnu) return;
    if (!dnu.dictName) {
      // No home dictionary → we can't build an editable gemstone:// URI for it.
      this.errorMessage =
        `Can't create #${dnu.selector}: ${dnu.className} isn't in your symbol ` +
        'list, so its source has no home dictionary. Add the class to a dictionary first.';
      this.postInit();
      return;
    }
    // selector 'new-method' makes this the FS provider's new-method template URI.
    const uri = this.gemstoneMethodUri(dnu.dictName, dnu.className, dnu.isMeta, 'new-method');
    // On a clean save the FS provider swaps the template tab to this real method
    // URI — built EXACTLY as the provider builds it (vscode.Uri.from leaves ':'
    // un-encoded, unlike buildMethodSourceUri's encodeURIComponent → '%3A'), so the
    // strings match and closeSourceEditors actually closes it (else it lingered).
    const compiledUri = this.gemstoneMethodUri(
      dnu.dictName,
      dnu.className,
      dnu.isMeta,
      dnu.selector,
    );
    try {
      await this.openTemplateEditor(uri, buildMethodStub(dnu.selector, dnu.argCount));
      this.pendingDnuMethodUri = uri.toString();
      this.dnuMethodUris.add(uri.toString());
      this.dnuMethodUris.add(compiledUri.toString());
      DebuggerPanel.persistLiveSourceUris();
      this.pendingDnuSelector = dnu.selector;
      // Replace the DNU error with what-to-do guidance — the most visible spot, and
      // the next step is the user's (the original complaint was that nothing said to
      // fill in + save). Use a lightweight banner update (NOT postInit): postInit
      // re-renders the stack and re-selects the top frame, which reopens the frame
      // source in the source column and steals focus from the new-method editor we
      // just opened. The banner update clears the Create button and keeps focus on
      // the new-method tab so the user can type immediately.
      this.errorMessage =
        `Editing new method #${dnu.selector} below — fill in the body, then save it ` +
        '(Ctrl+S / Cmd+S) to create the method. Then press Resume (▶) to run it.';
      this.panel.webview.postMessage({ command: 'banner', text: this.errorMessage });
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `Could not open a method template: ${e instanceof Error ? e.message : String(e)}`;
      this.postInit();
    }
  }

  /**
   * "Implement <selector> in <ReceiverClass>" (T2/T3 override): the selected
   * frame is running a method the receiver INHERITED; open an editor to implement
   * that selector somewhere along the receiver's inheritance chain. The candidate
   * classes (getReceiverClassChain — the receiver's class up through Object) and
   * the selector/arg-count come from the frame. With more than one candidate, a
   * QuickPick lets the user choose where in the hierarchy to implement (the
   * receiver's class is pre-selected); each entry notes its home dictionary and
   * whether it ALREADY implements the selector.
   *
   * For a class that does NOT yet implement it → a pre-filled stub (reuses the
   * create-method-from-DNU template machinery). For one that ALREADY does → its
   * EXISTING source opens (never clobbered with a stub). Either way, on a clean
   * save `finishOverrideMethod` re-enters the SENDER so a Resume re-dispatches the
   * send into the new code (the frame is "reset to that method").
   *
   * SHADOWING: if a SUBCLASS between the receiver and the chosen target already
   * implements the selector, method lookup for this receiver still finds that
   * subclass method, so the re-entered frame shows the subclass — not the new
   * one. We detect that and tell the user why. Degrades with the same in-band
   * error help as the DNU path.
   */
  private async implementInReceiver(displayLevel: number): Promise<void> {
    const frame = this.frames.find((f) => f.level === displayLevel);
    if (!frame || !frame.overridable) return;
    const raw = this.rawFrames.find((r) => r.serverLevel === frame.serverLevel);
    const selector = raw?.selector;
    if (!selector) return;

    let receiverOop: bigint;
    try {
      receiverOop = debug.getFrameInfo(this.session, this.gsProcess, frame.serverLevel).receiverOop;
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `Could not resolve the receiver of ${frame.label}.`;
      this.postInit();
      return;
    }
    // The receiver's class and every superclass up to Object — each a place the
    // selector could be implemented, flagged with whether it already is.
    const chain = debug.getReceiverClassChain(this.session, receiverOop, selector);
    if (chain.length === 0) {
      this.errorMessage = `Could not resolve the receiver's class to implement #${selector}.`;
      this.postInit();
      return;
    }
    await this.pickAndOpenImplementTemplate({
      selector,
      chain,
      contextLabel: `${frame.label}@sv${frame.serverLevel}`,
    });
  }

  /**
   * "Browse" a stack frame (right-click menu): open a NEW System Browser to the
   * right of the debugger pane, navigated to the class+method actually running in
   * this frame. The target is resolved by method lookup on the receiver
   * (`getBrowseTarget`), so an inherited method opens on its DEFINING class — the
   * source that's really executing — rather than the receiver's concrete class.
   * Degrades to an in-panel message for a doit frame, a receiver we can't resolve,
   * a selector not found in the chain, or a class outside the user's symbol list.
   */
  private async browseFrame(displayLevel: number): Promise<void> {
    const frame = this.frames.find((f) => f.level === displayLevel);
    if (!frame) return;
    const raw = this.rawFrames.find((r) => r.serverLevel === frame.serverLevel);
    if (!raw || raw.isExecutedCode || !raw.selector) {
      this.errorMessage = 'Cannot browse this frame — it has no class or method.';
      this.postInit();
      return;
    }

    let receiverOop: bigint;
    try {
      receiverOop = debug.getFrameInfo(this.session, this.gsProcess, frame.serverLevel).receiverOop;
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `Could not resolve the receiver of ${frame.label}.`;
      this.postInit();
      return;
    }

    const target = debug.getBrowseTarget(this.session, receiverOop, raw.selector);
    if (!target) {
      this.errorMessage = `Could not locate #${raw.selector} to browse it.`;
      this.postInit();
      return;
    }
    if (!target.dictName) {
      this.errorMessage = `Can't browse #${raw.selector}: ${target.className} isn't in your symbol list.`;
      this.postInit();
      return;
    }

    // Open the browser to the RIGHT of the debugger pane: focus the debugger's
    // group so ViewColumn.Beside resolves relative to it, then open a fresh
    // browser there and navigate it to the running method's defining class.
    this.panel.reveal(this.panel.viewColumn, false);
    SystemBrowser.openAndNavigate(
      this.session,
      {
        dictName: target.dictName,
        className: target.className,
        isMeta: target.isMeta,
        selector: raw.selector,
        category: target.category,
        environmentId: 0,
      },
      vscode.ViewColumn.Beside,
    );
  }

  /**
   * "Implement #<selector>" for a `subclassResponsibility` stop (T4): the process
   * is parked because an abstract method (a `^self subclassResponsibility` stub)
   * was invoked on a concrete subclass that didn't override it. Offer to implement
   * that selector concretely. Reuses the override harness (chain QuickPick + stub),
   * with two differences from T3:
   *  - the candidate chain is BOUNDED at the abstract method's defining class
   *    (you implement at-or-below the abstract class, never above it — a concrete
   *    Object/Number method would defeat the abstract contract for OTHER subclasses);
   *  - on a clean save we re-enter the CALLER (the sender of the abstract method),
   *    because the abstract activation already returned its stub — a bare Resume
   *    wouldn't dispatch into the new method (see finishOverrideMethod / DNU).
   */
  private async implementSubclassResponsibility(): Promise<void> {
    const info = this.subclassRespInfo;
    if (!info) return;
    let receiverOop: bigint;
    try {
      receiverOop = debug.getFrameInfo(
        this.session,
        this.gsProcess,
        info.abstractServerLevel,
      ).receiverOop;
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `Could not resolve the receiver of #${info.selector}.`;
      this.postInit();
      return;
    }
    let chain = debug.getReceiverClassChain(this.session, receiverOop, info.selector);
    // Bound the chain at the abstract method's defining class (inclusive).
    const boundIdx = chain.findIndex((c) => c.className === info.definingClassName);
    if (boundIdx >= 0) chain = chain.slice(0, boundIdx + 1);
    if (chain.length === 0) {
      this.errorMessage = `Could not resolve the receiver's class to implement #${info.selector}.`;
      this.postInit();
      return;
    }
    await this.pickAndOpenImplementTemplate({
      selector: info.selector,
      chain,
      contextLabel: `subclassResponsibility #${info.selector}`,
      reEnterSenderLevel: info.senderServerLevel,
    });
  }

  /**
   * Shared tail for T3 (implementInReceiver) and T4 (implementSubclassResponsibility):
   * pick a target class from `chain` (QuickPick when >1; receiver's class
   * pre-selected), then open an editor — a pre-filled stub for a class that doesn't
   * implement the selector, or the EXISTING source for one that does (never
   * clobbered). Records the pending-override state so the next clean save runs
   * `finishOverrideMethod`. `reEnterSenderLevel` (T4 only) makes that save re-enter
   * the caller so the send re-dispatches into the new method.
   */
  private async pickAndOpenImplementTemplate(opts: {
    selector: string;
    chain: debug.ClassHomeInfo[];
    contextLabel: string;
    reEnterSenderLevel?: number;
  }): Promise<void> {
    const { selector, chain, reEnterSenderLevel } = opts;
    // One candidate → go straight in. Several → let the user pick where in the
    // chain to implement (receiver's class first; each marked override vs edit).
    logInfo(
      `[Jasper Debugger] implement #${selector}: chain = ` +
        chain.map((c) => `${c.className}${c.implementsSelector ? '(impl)' : ''}`).join(' → '),
    );
    let targetIndex = 0;
    if (chain.length > 1) {
      const pick = await vscode.window.showQuickPick(
        chain.map((c, i) => ({
          label: c.className,
          description: !c.dictName
            ? '(not in your symbol list)'
            : c.implementsSelector
              ? `already implements #${selector} — opens it to edit (in ${c.dictName})`
              : `implement here (in ${c.dictName})`,
          index: i,
        })),
        {
          placeHolder: `Implement #${selector} in which class? (receiver is ${chain[0].className})`,
          // The pick is triggered from the webview, which keeps/regains focus —
          // without this the QuickPick loses focus and auto-dismisses before the
          // user can see it (it just flashes). Keep it open until an explicit pick.
          ignoreFocusOut: true,
        },
      );
      if (this.disposed) return; // panel closed while the pick was open
      if (!pick) return; // user cancelled — open nothing
      targetIndex = pick.index;
    }
    const target = chain[targetIndex];
    if (!target.dictName) {
      // No home dictionary → no editable gemstone:// URI (same guard as the DNU path).
      this.errorMessage =
        `Can't implement #${selector}: ${target.className} isn't in your symbol ` +
        'list, so its source has no home dictionary. Add the class to a dictionary first.';
      this.postInit();
      return;
    }

    // Shadowing: the method actually used by this receiver is the FIRST class in
    // the chain (most specific) that implements the selector. If that class is
    // strictly below the chosen target, the new/edited target method is shadowed.
    const activeIndex = chain.findIndex((c) => c.implementsSelector);
    const shadowedBy =
      activeIndex >= 0 && activeIndex < targetIndex ? chain[activeIndex].className : undefined;

    // For a class that already implements the selector, open its EXISTING source
    // (no stub → never clobber a real method). Otherwise open a pre-filled stub.
    const editingExisting = target.implementsSelector === true;
    const compiledUri = this.gemstoneMethodUri(
      target.dictName,
      target.className,
      target.isMeta,
      selector,
    );
    // selector 'new-method' is the FS provider's template URI; for an edit we open
    // the real method URI directly. Built EXACTLY as the provider builds it (see
    // createDnuMethod) so the close-on-dispose match works.
    const openUri = editingExisting
      ? compiledUri
      : this.gemstoneMethodUri(target.dictName, target.className, target.isMeta, 'new-method');
    logInfo(
      `[Jasper Debugger] implement #${selector} in ${target.className} ` +
        `(${editingExisting ? 'edit existing' : 'new method'}); from ` +
        `${opts.contextLabel}${shadowedBy ? `; shadowed by ${shadowedBy}` : ''}` +
        `${reEnterSenderLevel !== undefined ? `; re-enter sender sv${reEnterSenderLevel}` : ''}`,
    );
    try {
      await this.openTemplateEditor(
        openUri,
        editingExisting ? undefined : buildMethodStub(selector, selectorArgCount(selector)),
      );
      this.pendingOverrideUri = openUri.toString();
      this.pendingOverrideSelector = selector;
      this.pendingOverrideShadowedBy = shadowedBy;
      this.pendingOverrideTargetClass = target.className;
      this.pendingOverrideReEnterSenderLevel = reEnterSenderLevel;
      this.dnuMethodUris.add(openUri.toString()); // closed with the panel
      this.dnuMethodUris.add(compiledUri.toString());
      DebuggerPanel.persistLiveSourceUris();
      // Banner-only guidance (NOT postInit — that re-selects the top frame and
      // steals focus from the editor we just opened; see createDnuMethod).
      const verb = editingExisting
        ? `Editing existing #${selector} in`
        : `Editing new method #${selector} in`;
      // T4 (re-enter sender): the abstract method is on the stack, so the new method
      // is reached by re-dispatching the send — not "the next send" (T3 / option B).
      const usage =
        reEnterSenderLevel !== undefined
          ? `On a clean save the call to #${selector} is re-dispatched into it (or re-run the expression).`
          : `It's then used on the next #${selector} send.`;
      let text = `${verb} ${target.className} below — edit the body, then save it (Ctrl+S / Cmd+S). ${usage}`;
      if (shadowedBy) {
        text +=
          ` NOTE: ${shadowedBy} already implements #${selector}, so a ${chain[0].className} still ` +
          `uses ${shadowedBy}>>#${selector}, not ${target.className}'s.`;
      }
      this.errorMessage = text;
      this.panel.webview.postMessage({ command: 'banner', text });
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `Could not open a method template: ${e instanceof Error ? e.message : String(e)}`;
      this.postInit();
    }
  }

  /**
   * After an implement/override method is saved (clean compile).
   *
   * For a plain T3 override (`reEnterSenderLevel` undefined) DON'T auto-restart
   * anything (option B — predictable, no surprising stack jumps): the method now
   * exists and is used on the NEXT send of the selector. The call already on the
   * stack keeps running the method it dispatched to; the user Resumes (later sends
   * use the new one) or re-runs. (An override's send already succeeded into the
   * inherited method, so the current activation is legitimate.)
   *
   * For a T4 subclassResponsibility implement (`reEnterSenderLevel` set) the abstract
   * activation already returned its stub, so a bare Resume would NOT dispatch into
   * the new method — re-enter the CALLER (when it's a re-enterable method frame, like
   * the DNU path) so a Resume re-sends the selector and finds the concrete method;
   * for a workspace/"Executed Code" caller, tell the user to re-run the expression.
   */
  private async finishOverrideMethod(
    selector: string,
    shadowedBy: string | undefined,
    targetClass: string,
    reEnterSenderLevel?: number,
  ): Promise<void> {
    const sel = selector ? `#${selector}` : 'the method';
    const inTarget = targetClass ? ` in ${targetClass}` : '';
    // When a more-specific subclass already implements the selector, the receiver
    // keeps using THAT method — explain why a new send still won't reach this one.
    const shadowNote = shadowedBy
      ? ` NOTE: ${shadowedBy} already implements ${sel}, so ${shadowedBy}>>${sel} still wins for this receiver.`
      : '';

    // T4: re-dispatch from the caller of the abstract method.
    if (reEnterSenderLevel !== undefined) {
      const senderRaw =
        reEnterSenderLevel >= 0
          ? this.rawFrames.find((r) => r.serverLevel === reEnterSenderLevel)
          : undefined;
      if (!senderRaw || senderRaw.isExecutedCode || reEnterSenderLevel <= 1) {
        // Workspace/"Executed Code" (or top) caller — can't be re-entered in place
        // (the kernel trim sends compiledMethodAt: to its nil class), so don't trim.
        this.srSuppressed = true; // the method exists now; don't re-offer Implement
        this.frames = this.fetchStack();
        this.dnuInfo = this.detectDnu();
        this.subclassRespInfo = this.detectSubclassResp();
        this.errorMessage =
          `Saved ${sel}${inTarget} — re-run the expression to dispatch into the new ` +
          `method. (Resume just finishes the abstract stub, which returns the receiver.)${shadowNote}`;
        this.postInit();
        return;
      }
      // A real method caller — re-enter it (non-blocking trim) so the user's Resume
      // re-sends the selector from a clean frame, dispatching into the new method.
      await this.runNb('Implement method', async () => {
        await debug.trimStackToLevelNb(this.session, this.gsProcess, reEnterSenderLevel);
        if (this.disposed) return;
        this.staleTopActivation = false; // the trim rebuilt the stack from a fresh activation
        this.uncontinuable = false;
        this.srSuppressed = false; // fresh stack — a new abstract stop may legitimately appear
        this.frames = this.fetchStack();
        this.dnuInfo = this.detectDnu();
        this.subclassRespInfo = this.detectSubclassResp();
        this.errorMessage =
          `Saved ${sel}${inTarget} — re-entered the caller. Press Resume (▶) to ` +
          `re-send ${sel} into the new method, or step into it.${shadowNote}`;
        this.postInit();
      });
      return;
    }

    this.dnuSuppressed = false;
    this.frames = this.fetchStack(); // labels/source may have shifted; no trim
    this.dnuInfo = this.detectDnu();
    this.subclassRespInfo = this.detectSubclassResp();
    this.errorMessage =
      `Saved ${sel}${inTarget} — used on the next ${sel} send. Resume (▶) to continue ` +
      '(the call now on the stack finishes with the previously-found version), or re-run the ' +
      `expression.${shadowNote}`;
    this.postInit();
  }

  /**
   * Open a new-method template editor in the companion source group docked BELOW
   * the panel (the same place frame source opens — not Beside, which the user saw
   * as "to the side"), focused so they can type, and replace the FS provider's
   * generic template with `stub` (the real selector signature + a placeholder
   * body). Mirrors showSourceEditor's docking so the first open splits a group
   * beneath the panel; later opens reuse that group.
   */
  private async openTemplateEditor(uri: vscode.Uri, stub?: string): Promise<vscode.TextEditor> {
    const firstOpen = this.sourceColumn === undefined;
    if (firstOpen) {
      try {
        this.panel.reveal(this.panel.viewColumn, false); // focus the panel's group…
        await vscode.commands.executeCommand('workbench.action.newGroupBelow'); // …split below it
      } catch {
        /* best-effort layout; fall back to the active group */
      }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: this.sourceColumn ?? vscode.ViewColumn.Active,
      preview: false, // a real tab the user edits, not a throwaway preview
      preserveFocus: false, // focus the editor so the user can fill in the body
    });
    this.sourceColumn = editor.viewColumn ?? this.sourceColumn;
    this.sourceEditor = editor;
    // Replace the whole document with the pre-filled stub — but ONLY for a fresh
    // template. When `stub` is omitted (implementing in a class that ALREADY has
    // the selector), leave the FS provider's existing source so we never clobber
    // a real method with a placeholder body.
    if (stub !== undefined) {
      const lastLine = Math.max(0, editor.document.lineCount - 1);
      const end = editor.document.lineAt(lastLine).range.end;
      await editor.edit((b) => b.replace(new vscode.Range(new vscode.Position(0, 0), end), stub));
    }
    this.shownSourceUris.add(uri.toString()); // closed with the panel
    DebuggerPanel.persistLiveSourceUris();
    if (firstOpen) await this.applySourcePaneRatio();
    return editor;
  }

  /**
   * True if the last compile of `uri` failed — the FS provider left an
   * Error-severity diagnostic (and did NOT rethrow, so the save still fired).
   */
  private recompileFailed(uri: vscode.Uri): boolean {
    return vscode.languages
      .getDiagnostics(uri)
      .some((d) => d.severity === vscode.DiagnosticSeverity.Error);
  }

  /**
   * After a DNU method is created (clean compile), re-enter the frame that made
   * the send so a (user-initiated) Resume re-dispatches into the new method —
   * then leave the process suspended for the user to press Resume. We do NOT
   * auto-resume: resuming the parked doesNotUnderstand: machinery directly
   * (continueExecution / forcing a value) hung the gem and crashed the host.
   *
   * `this.frames[0]` is the topmost user frame (the DNU machinery is trimmed from
   * the display), i.e. the sender. Trimming to it (`trimStackToLevel:`,
   * non-blocking) resets it to its method's first instruction, so the user's next
   * Resume is an ordinary resume of a clean frame — which re-runs the send.
   *
   * A workspace/"Executed Code" sender has no class, so GemStone can't re-enter it
   * (the kernel trim does `oldHome inClass compiledMethodAt:…`, which is sent to
   * nil). The method still exists — tell the user to re-run their expression.
   */
  private async finishDnuMethod(selector: string): Promise<void> {
    const sel = selector ? `#${selector}` : 'the method';
    this.dnuSuppressed = true; // method exists now; never re-offer Create for this DNU
    const sender = this.frames[0];
    // Either way, the user finishes with Resume (▶): GemStone's
    // MessageNotUnderstood>>defaultAction re-performs the now-understood send on
    // resume, so the original expression evaluates to the new method's result.
    // (We never auto-resume — resuming the parked DNU machinery from the save
    // handler hung the gem and crashed the host. Manual Resume is safe.)
    if (!sender || sender.isExecutedCode || sender.serverLevel <= 1) {
      // Workspace/"Executed Code" (or top) sender — can't be re-entered in place
      // (the kernel trim sends compiledMethodAt: to its nil class), so don't trim.
      this.errorMessage = `Created ${sel} — press Resume (▶) to re-run the send into the new method.`;
      this.postInit();
      return;
    }
    // A real method sender — re-enter it (non-blocking trim) so the user's Resume
    // re-runs the send from a clean frame, and they can also step into the method.
    await this.runNb('Create method', async () => {
      await debug.trimStackToLevelNb(this.session, this.gsProcess, sender.serverLevel);
      if (this.disposed) return;
      this.staleTopActivation = false; // the trim rebuilt the stack from a fresh activation
      this.uncontinuable = false;
      this.dnuSuppressed = false; // fresh stack — a new DNU may legitimately appear
      this.frames = this.fetchStack();
      this.dnuInfo = this.detectDnu();
      this.errorMessage =
        `Created ${sel} — re-entered the frame where it was sent. ` +
        'Press Resume (▶) to run the new method, or step into it.';
      this.postInit(); // re-selects the re-entered sender frame + shows the banner
    });
  }

  /** Fetch the selected frame's grouped variables and post them. */
  private postVariables(serverLevel: number): void {
    let groups: VarGroup[] = [];
    try {
      groups = this.variablesForFrame(serverLevel);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
    this.panel.webview.postMessage({ command: 'variables', groups });
  }

  /**
   * The selected frame's variable groups, fetched once per (frame, value-state)
   * and cached — the Variables pane AND the inline overlay (#5) share this, so a
   * frame select costs one fetch and toggling the overlay costs none. The cache
   * is invalidated by `invalidateVariablesCache()` when the stack moves or a value
   * is edited.
   */
  private variablesForFrame(serverLevel: number): VarGroup[] {
    if (this.varGroupsCache?.level === serverLevel) return this.varGroupsCache.groups;
    const groups = this.fetchVariables(serverLevel);
    this.varGroupsCache = { level: serverLevel, groups };
    return groups;
  }

  /** Drop the cached variable groups (stack moved, or a value was edited). */
  private invalidateVariablesCache(): void {
    this.varGroupsCache = undefined;
  }

  /**
   * The selected frame's variables, split into Receiver (`self`), Instance
   * variables (the receiver's named instVars), Arguments & Temps (the frame's
   * *named* args/temps), and a collapsed `(stack temps)` group for the synthetic
   * `.tN` eval-stack temporaries (which have no source name). Each row carries its
   * OOP for the dim column + click-to-inspect.
   *
   * One server round trip via `fetchFrameVariables` (the doit gathers every
   * receiver/instVar/arg/temp + printString + oop + write index at once) instead
   * of the old 3 + N blocking calls — so a frame select, and especially toggling
   * the inline overlay, no longer stalls. The server already filters `__vsc` glue
   * and classifies `.tN` stack temps; the edit-index + grouping rules below match
   * the previous per-call build exactly.
   */
  private fetchVariables(serverLevel: number): VarGroup[] {
    const rows = debug.fetchFrameVariables(this.session, this.gsProcess, serverLevel);

    const toRow = (r: debug.FrameVarRow, edit?: VarRow['edit']): VarRow => {
      // Stamp `revertible` only when this slot has been edited away from its
      // original this halt (the webview then shows the ↺ icon).
      const revertible =
        edit && this.undoDirty.has(this.undoKey(serverLevel, edit.kind, edit.index))
          ? true
          : undefined;
      return { name: r.name, value: r.value, oop: r.oop, edit, revertible };
    };
    const byName = (a: VarRow, b: VarRow): number =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    // `self` (read-only), instVars (editable via `instVarAt:put:`), named
    // args/temps (editable via `_frameAt:tempAt:put:`), and read-only `.tN` stack
    // temps. The server emits the 1-based write index per editable slot; instVars
    // and named temps are alphabetized for findability (each row keeps its own
    // index, so sorting the display never disturbs the write path).
    const receiver = rows.filter((r) => r.group === 'receiver').map((r) => toRow(r));
    const instVars = rows
      .filter((r) => r.group === 'instvars')
      .map((r) => toRow(r, { kind: 'instvar', index: r.index }))
      .sort(byName);
    const argTemps = rows
      .filter((r) => r.group === 'argtemps')
      .map((r) => toRow(r, { kind: 'temp', index: r.index }))
      .sort(byName);
    // Stack temps keep natural order (sorting `.t1/.t10/.t2` would look wrong).
    const stackTemps = rows.filter((r) => r.group === 'stacktemps').map((r) => toRow(r));

    const groups: VarGroup[] = [];
    if (receiver.length > 0) groups.push({ title: 'Receiver', kind: 'receiver', vars: receiver });
    if (instVars.length > 0)
      groups.push({ title: 'Instance variables', kind: 'instvars', vars: instVars });
    if (argTemps.length > 0)
      groups.push({ title: 'Arguments & Temps', kind: 'argtemps', vars: argTemps });
    if (stackTemps.length > 0) {
      groups.push({
        title: '(stack temps)',
        kind: 'stacktemps',
        collapsed: true,
        vars: stackTemps,
      });
    }
    return groups;
  }

  /** Variables-pane group titles, keyed by the dump row's group kind. */
  private static readonly DUMP_GROUP_TITLES: Record<debug.StackDumpRow['group'], string> = {
    receiver: 'Receiver',
    instvars: 'Instance variables',
    argtemps: 'Arguments & Temps',
    stacktemps: '(stack temps)',
  };

  /**
   * Gather every displayed frame's variable groups for the detailed stack dump
   * (#10/#11) in ONE server round trip (`fetchStackDump`), then bucket the flat
   * rows back into per-frame, per-group structure. Only run on the explicit Copy
   * Stack / Dump Stack actions, never on the hot path. The doit emits a frame's
   * rows contiguously in group order, so a row simply extends the current group
   * or starts a new one.
   */
  private collectStackDetail(): DetailedStackFrame[] {
    let rows: debug.StackDumpRow[] = [];
    try {
      rows = debug.fetchStackDump(this.session, this.gsProcess);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
    const byLevel = new Map<number, VarGroup[]>();
    for (const r of rows) {
      let groups = byLevel.get(r.serverLevel);
      if (!groups) {
        groups = [];
        byLevel.set(r.serverLevel, groups);
      }
      let group = groups[groups.length - 1];
      if (!group || group.kind !== r.group) {
        group = {
          title: DebuggerPanel.DUMP_GROUP_TITLES[r.group],
          kind: r.group,
          vars: [],
          collapsed: r.group === 'stacktemps' || undefined,
        };
        groups.push(group);
      }
      group.vars.push({ name: r.name, value: r.value, oop: r.oop });
    }
    return this.frames.map((f) => ({ ...f, groups: byLevel.get(f.serverLevel) ?? [] }));
  }

  /** The full detailed-stack text (header + short stack + per-frame variables). */
  private buildDetailedStackText(now: Date): string {
    const subtitle = this.sessionSubtitle();
    const when =
      `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
      `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const header = ['Jasper Debugger stack dump', subtitle, when].filter(Boolean).join(' — ');
    return formatDetailedStack(this.errorMessage, this.collectStackDetail(), header);
  }

  /**
   * Save the detailed stack (#11) to `~/.jasper/stacks/<timestamp>_<frame>.txt`
   * (the cross-platform extension folder). It deliberately does NOT open the file
   * — repeated dumps would pile up editor tabs — the inline path notice (with its
   * Copy-path button) is the pointer instead. Best-effort: any failure surfaces as
   * an error toast rather than tearing down the panel.
   */
  private async dumpStackToFile(): Promise<void> {
    try {
      const now = new Date();
      const text = this.buildDetailedStackText(now);
      const fileName = stackDumpFileName(this.frames[0]?.label ?? 'stack', now);
      const dir = extensionPathFrom('stacks');
      const filePath = path.join(dir, fileName);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, text, 'utf-8');
      if (this.disposed) return;
      // Show the saved path inline in the panel with its own Copy-path button (a
      // full path is too long for the button itself, and selecting it by hand
      // before it cleared was fiddly). It auto-hides after 5s.
      this.panel.webview.postMessage({ command: 'savedNotice', path: filePath });
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      void vscode.window.showErrorMessage(
        `Could not save the stack: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Open a previously-dumped stack file in an editor — invoked when the user
   * clicks the inline path (an explicit, on-demand action, so unlike the dump
   * itself this DOES open a tab). Repeated clicks on the same path reuse the one
   * editor rather than piling up.
   */
  private async openDumpFile(filePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      if (this.disposed) return;
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      void vscode.window.showErrorMessage(
        `Could not open ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Evaluate an expression in the selected frame and post the printString back. */
  private async evalInFrame(serverLevel: number | undefined, expr: string): Promise<void> {
    if (serverLevel == null) return;
    if (this.nbBusy) {
      this.notifyBusy('Evaluate');
      return;
    }
    this.nbBusy = true;
    // Reset here, not only in onStart: the blocking frame-setup inside
    // evaluateInFrameNb can fail BEFORE polling starts (so onStart never fires), and
    // a stale count from a prior cancelled op would mislabel that error as cancelled.
    this.cancelClicks = 0;
    // The eval runs non-blocking so a runaway expression doesn't freeze the panel
    // and CAN be cancelled. The in-panel overlay owns cancel (suppressNotification),
    // and onStart marks it cancellable + captures the handle the Cancel button hits.
    let value = '';
    let isError = false;
    try {
      value = await debug.evaluateInFrameNb(this.session, this.gsProcess, expr, serverLevel, {
        suppressNotification: true,
        onStart: (cancel) => {
          this.activeNbCancel = cancel;
          this.setCancellable(true);
        },
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      if (this.cancelClicks > 0) {
        // The user interrupted this eval. Show a clean header (with which break it
        // was — soft = stop at a safe point, hard = forced) plus the raw gem error
        // for context, in the eval-result area below the bar (no top-banner error).
        const kind = this.cancelClicks === 1 ? 'soft break' : 'hard break';
        value = `Evaluation Cancelled (${kind})${raw ? ` — ${raw}` : ''}`;
      } else {
        value = `Error: ${raw}`;
      }
      isError = true;
    } finally {
      this.activeNbCancel = undefined;
      this.nbBusy = false;
      this.setCancellable(false);
    }
    if (this.disposed) return;
    this.panel.webview.postMessage({ command: 'evalResult', expr, value, isError });
  }

  /** Tell the webview whether the in-flight busy op can be cancelled (#9). */
  private setCancellable(on: boolean): void {
    if (this.disposed) return;
    this.panel.webview.postMessage({ command: 'cancellable', on });
  }

  /** Webview Cancel button → request a break of the active nb op (soft, then hard). */
  private cancelActiveOp(): void {
    if (!this.activeNbCancel) return;
    this.cancelClicks += 1;
    // Acknowledge the click so it visibly registers — the break is asynchronous
    // (the gem stops at a safe point), so without this the Cancel feels unheard.
    this.flash(
      this.cancelClicks === 1 ? 'Break sent — waiting for the gem to stop…' : 'Forcing interrupt…',
    );
    this.activeNbCancel();
  }

  /**
   * Assign a variable from the variable evaluator (T1): evaluate `expr` in the
   * frame, then write the resulting object into the receiver's instVar or the
   * frame's temp. On success, re-fetch ALL variables so every row's printString,
   * OOP (dim column) and GT-Inspect target reflect the new object — the old OOP
   * is stale once the slot points at a different object. On a compile/runtime
   * error nothing is written and the error is sent back so the webview keeps the
   * editor open.
   */
  private setVariable(
    serverLevel: number | undefined,
    kind: 'instvar' | 'temp',
    index: number,
    expr: string,
  ): void {
    if (serverLevel == null) return;
    // Writing is a blocking GCI perform; refuse while a non-blocking step/trim
    // owns the session's single in-flight call.
    if (this.nbBusy) {
      this.notifyBusy('Set variable');
      this.panel.webview.postMessage({
        command: 'setVariableResult',
        ok: false,
        error: 'Busy — try again',
      });
      return;
    }
    const result = this.writeVariableInFrame(serverLevel, kind, index, expr);
    // Success → the host's `postVariables` (inside the write) already re-rendered
    // the pane, which removes the open editor; this ok just confirms it. Failure →
    // keep the editor open and flag the error on it so the expression can be fixed.
    this.panel.webview.postMessage(
      result.ok
        ? { command: 'setVariableResult', ok: true }
        : { command: 'setVariableResult', ok: false, error: result.error },
    );
  }

  /**
   * The shared variable write: evaluate `expr` in the frame, capture+pin the
   * slot's original (for revert), write the new OOP into the instVar / temp, then
   * refresh the Variables pane and inline overlay. Returns `{ ok }` so each caller
   * surfaces failures its own way — the webview pane flags the inline editor
   * (`setVariableResult`), the source-pane inline edit shows an error toast (it has
   * no webview). On failure nothing is written and the pane is NOT re-rendered (so
   * the pane's editor stays open). Callers must guard `nbBusy` first.
   */
  private writeVariableInFrame(
    serverLevel: number,
    kind: 'instvar' | 'temp',
    index: number,
    expr: string,
  ): { ok: boolean; error?: string } {
    try {
      const valueOop = debug.evaluateInFrameToOop(this.session, this.gsProcess, expr, serverLevel);
      const info = debug.getFrameInfo(this.session, this.gsProcess, serverLevel);
      // Capture + pin the slot's pre-edit value BEFORE overwriting it (first edit
      // only), so revert can restore the exact original object.
      this.captureUndoOriginal(serverLevel, kind, index, info);
      if (kind === 'instvar') {
        debug.setInstVar(this.session, info.receiverOop, index, valueOop);
      } else {
        debug.setFrameTemp(this.session, this.gsProcess, serverLevel, index, valueOop);
      }
      this.undoDirty.add(this.undoKey(serverLevel, kind, index));
      this.invalidateVariablesCache(); // the slot points at a new object — re-fetch
      this.postVariables(serverLevel);
      // The slot now points at a new object — refresh the inline overlay so its
      // value (and hover) track, just like the Variables pane.
      if (this.sourceEditor) this.updateInlineValues(this.sourceEditor, serverLevel);
      return { ok: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      logError(this.sessionId, error);
      return { ok: false, error };
    }
  }

  /**
   * Edit an inline-overlay variable from its hover `$(edit)` pencil (#5 Phase 2):
   * prompt for a new value (prefilled with the current printString, like the
   * Variables pane's inline editor), then route through the shared
   * `writeVariableInFrame` — so the pane, the inline overlay, undo/revert and the
   * GC-pin all update exactly as a pane edit does. The source pane has no webview,
   * so a rejected expression surfaces as an error toast. Resolved from the hover
   * command args by `editInlineValueForUri`.
   */
  private async editInlineValue(
    serverLevel: number,
    kind: 'instvar' | 'temp',
    index: number,
    name: string,
  ): Promise<void> {
    try {
      if (this.nbBusy) {
        this.notifyBusy('Set variable');
        return;
      }
      // Prefill with the current printString (like the pane), but never let a
      // failed prefetch abort the edit — fall back to an empty box.
      let prefill = '';
      try {
        prefill =
          this.inlineVarsForFrame(serverLevel).find(
            (v) => v.name === name && v.edit?.kind === kind && v.edit?.index === index,
          )?.full ?? '';
      } catch (e: unknown) {
        logError(this.sessionId, e instanceof Error ? e.message : String(e));
      }
      const expr = await vscode.window.showInputBox({
        title: `Set ${name}`,
        prompt: `New value for ${name} — evaluated in the selected frame`,
        value: prefill,
        ignoreFocusOut: true,
      });
      if (expr === undefined) return; // cancelled (Esc / focus-out off)
      const trimmed = expr.trim();
      if (trimmed === '') return; // empty → no-op, matching the pane's editor
      // The prompt is modeless; re-check before the blocking write in case a
      // step/trim claimed the session while it was open.
      if (this.nbBusy) {
        this.notifyBusy('Set variable');
        return;
      }
      const result = this.writeVariableInFrame(serverLevel, kind, index, trimmed);
      if (!result.ok) {
        void vscode.window.showErrorMessage(`Could not set ${name}: ${result.error}`);
      }
    } catch (e: unknown) {
      // A throw here would otherwise be a silent unhandled rejection (the command
      // is invoked via `void`), which reads as "the pencil does nothing".
      const msg = e instanceof Error ? e.message : String(e);
      logError(this.sessionId, msg);
      void vscode.window.showErrorMessage(`Jasper: inline edit of ${name} failed: ${msg}`);
    }
  }

  private undoKey(level: number, kind: 'instvar' | 'temp', index: number): string {
    return `${level}:${kind}:${index}`;
  }

  /**
   * Record (once per slot, this halt) the value a slot holds before its first
   * edit, and pin it against GC so revert can write the exact original object
   * back. Immediates aren't pinned (they can't be collected). `info` is the
   * already-fetched frame contents for `level`.
   */
  private captureUndoOriginal(
    level: number,
    kind: 'instvar' | 'temp',
    index: number,
    info: debug.FrameInfo,
  ): void {
    const key = this.undoKey(level, kind, index);
    if (this.undoOriginals.has(key)) return; // keep the FIRST original
    const originalOop =
      kind === 'instvar'
        ? debug.getInstVarOop(this.session, info.receiverOop, index)
        : info.argAndTempOops[index - 1];
    if (originalOop === undefined) return; // defensive: nothing to remember
    this.undoOriginals.set(key, originalOop);
    if (!debug.isSpecialOop(this.session, originalOop)) {
      debug.saveObjs(this.session, [originalOop]);
      this.undoPinned.push(originalOop);
    }
  }

  /**
   * Revert a slot to the value it held before its first edit this halt (the ↺
   * icon). Writes the stored original OOP straight back (no re-evaluation), then
   * refreshes — the row is no longer dirty, so the icon disappears. The pin is
   * NOT released here (the slot re-references the object anyway); pins are freed
   * en masse by clearUndoState(). No-op if the slot has no stored original.
   */
  private revertVariable(
    serverLevel: number | undefined,
    kind: 'instvar' | 'temp',
    index: number,
  ): void {
    if (serverLevel == null) return;
    const key = this.undoKey(serverLevel, kind, index);
    const originalOop = this.undoOriginals.get(key);
    if (originalOop === undefined) return; // nothing recorded for this slot
    // A blocking write can't share the session with an in-flight non-blocking op.
    if (this.nbBusy) {
      this.notifyBusy('Revert variable');
      return;
    }
    try {
      if (kind === 'instvar') {
        const receiverOop = debug.getFrameInfo(
          this.session,
          this.gsProcess,
          serverLevel,
        ).receiverOop;
        debug.setInstVar(this.session, receiverOop, index, originalOop);
      } else {
        debug.setFrameTemp(this.session, this.gsProcess, serverLevel, index, originalOop);
      }
      this.undoDirty.delete(key);
      this.invalidateVariablesCache(); // slot restored to its original object
      this.postVariables(serverLevel);
      // Keep the inline overlay in step with the reverted value.
      if (this.sourceEditor) this.updateInlineValues(this.sourceEditor, serverLevel);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Drop all variable-revert state and release every pinned original. Called on
   * any stack-mutating op (step / resume / restart) and on dispose — once the
   * stack moves, the stored `{level,index}` slots are no longer valid, and we
   * must not leak the session's export set. Best-effort release (a failure here
   * must not break dispose).
   */
  private clearUndoState(): void {
    if (this.undoPinned.length > 0) {
      try {
        debug.releaseObjs(this.session, this.undoPinned);
      } catch (e: unknown) {
        logError(this.sessionId, e instanceof Error ? e.message : String(e));
      }
    }
    this.undoPinned = [];
    this.undoOriginals.clear();
    this.undoDirty.clear();
  }

  /** Resume execution: closes the panel if the process completes, else refreshes on the new error. */
  private resume(): void {
    if (this.guardStaleTopActivation('Resume')) return;
    if (this.guardUncontinuable()) return;
    // Don't issue a blocking continue while a non-blocking step/trim is in flight
    // (only one GCI call per session). Resume itself is still BLOCKING — 3.7.x has
    // no GciTsNbContinue — so a long/looping Resume can still stall the host until
    // it returns; making Resume non-blocking needs a worker thread (tracked).
    if (this.nbBusy) {
      this.notifyBusy('Resume');
      return;
    }
    // Leaving this halt: drop revert state + release pinned originals.
    this.clearUndoState();
    const result = debug.continueExecution(this.session, this.gsProcess);
    this.handleContinueResult(result);
  }

  /**
   * Dispatch the outcome of a blocking `continueExecution` (Resume / Run to Cursor):
   * close on completion, show the fixed Terminate-only banner if the process is
   * now uncontinuable (6011), else refresh on the new stop. Shared so Run to Cursor
   * lands a hit exactly like a Resume that re-halted.
   */
  private handleContinueResult(result: debug.StepResult): void {
    // Transcript writes buffered during the resumed run are shown now (the
    // completion path drains in onCompleted).
    if (!result.completed) appendTranscriptOutput(drainTranscript(this.session));
    if (result.completed) {
      this.onCompleted(result);
    } else if (result.errorNumber === GS_ERR_UNCONTINUABLE) {
      // The process is dead-ended; don't refresh (that would surface the
      // uncontinuable machinery wall) — show the fixed Terminate-only banner.
      this.uncontinuable = true;
      this.errorMessage = DebuggerPanel.UNCONTINUABLE_MSG;
      this.postInit();
    } else {
      this.errorMessage = result.errorMessage || 'GemStone error';
      this.refresh();
    }
  }

  /**
   * "Run to Cursor" (#2): run until execution reaches the step point nearest the
   * cursor in the companion source pane, then stop there exactly as a halt would —
   * variables, stack and step-point highlight all refresh.
   *
   * Under the cover it's a Resume bracketed by a TEMPORARY step-point breakpoint:
   * we map the cursor to a step point in the selected frame's (editable) home
   * method, `setBreakAtStepPoint:`, continue, then clear that break in a `finally`
   * so it never lingers — whether the run hit it, ran to completion, or stopped
   * elsewhere. The break is cleared ONLY when we own it; if the user already has a
   * persistent breakpoint at that step point we leave it (Run to Cursor must not
   * silently delete the user's break).
   *
   * Two break paths: an editable (`gemstone://`) method → by class>>selector, with
   * a guard so we don't delete the user's own breakpoint; a doit / "Executed Code"
   * (or non-symbol-list) frame → by the home method's OOP (no class>>selector). The
   * home method's `_sourceOffsets` is method-wide (spans nested blocks), so a doit
   * cursor maps to a real step point too. Falls back to a plain Resume (with a
   * brief flash) when there's no usable target.
   */
  private runToCursor(displayLevel: number): void {
    if (this.guardStaleTopActivation('Run to Cursor')) return;
    if (this.guardUncontinuable()) return;
    if (this.nbBusy) {
      this.notifyBusy('Run to Cursor');
      return;
    }

    const target = this.resolveRunToTarget(displayLevel);
    if (!target) {
      this.flash(
        'Run to Cursor: place the cursor on a code line in the source pane — resuming instead.',
      );
      this.resume();
      return;
    }

    // Don't clear a break the USER already set at this step point (editable
    // frames only; a read-only doit can't carry a user line breakpoint).
    const userOwns = target.byName
      ? this.userBreakAt(target.byName.uri, target.byName.actualLine)
      : false;
    const setBreak = (): void => {
      if (target.byName) {
        queries.setBreakAtStepPoint(
          this.session,
          target.byName.className,
          target.byName.isMeta,
          target.byName.selector,
          target.stepPoint,
        );
      } else {
        debug.setBreakAtStepPointByOop(this.session, target.homeMethodOop, target.stepPoint);
      }
    };
    const clearBreak = (): void => {
      if (target.byName) {
        queries.clearBreakAtStepPoint(
          this.session,
          target.byName.className,
          target.byName.isMeta,
          target.byName.selector,
          target.stepPoint,
        );
      } else {
        debug.clearBreakAtStepPointByOop(this.session, target.homeMethodOop, target.stepPoint);
      }
    };

    try {
      setBreak();
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.flash('Run to Cursor: could not set a temporary breakpoint — resuming instead.');
      this.resume();
      return;
    }

    // Leaving this halt: drop revert state + release pinned originals (as Resume).
    this.clearUndoState();
    let result: debug.StepResult;
    try {
      result = debug.continueExecution(this.session, this.gsProcess);
    } finally {
      if (!userOwns) {
        try {
          clearBreak();
        } catch (e: unknown) {
          logError(this.sessionId, e instanceof Error ? e.message : String(e));
        }
      }
    }
    this.handleContinueResult(result);
  }

  /**
   * Resolve the "Run to Cursor" target from the selected frame + the cursor in the
   * companion source editor, or undefined when there's no usable target. Requires
   * the source pane to be showing that frame's source (editable OR read-only doit)
   * so the cursor refers to it. Column-aware via the exact cursor offset.
   *
   * For a read-only doit the displayed source is UNWRAPPED from the transcript-
   * capture glue, so its step-point offsets (stored in WRAPPED coords) are shifted
   * by the stripped prefix — add the shift back to put the cursor in stored coords
   * before mapping. An editable method is shown 1:1 (shift 0). The returned
   * `byName` is present only for an editable method (break by class>>selector with
   * the user-break guard); absent for a doit (break by the home method's OOP).
   */
  private resolveRunToTarget(displayLevel: number):
    | {
        homeMethodOop: bigint;
        stepPoint: number;
        byName?: {
          className: string;
          isMeta: boolean;
          selector: string;
          uri: string;
          actualLine: number;
        };
      }
    | undefined {
    const frame = this.frames.find((f) => f.level === displayLevel);
    if (!frame) return undefined;
    const editor = this.sourceEditor;
    // The cursor only refers to this frame's source when the companion editor is
    // showing it (editable gemstone:// or read-only gemstone-debug:).
    if (
      !editor ||
      this.shownFrameSourceUri === undefined ||
      editor.document.uri.toString() !== this.shownFrameSourceUri
    )
      return undefined;

    const raw = this.rawFrames.find((r) => r.serverLevel === frame.serverLevel);
    if (!raw || raw.homeMethodOop === 0n) return undefined; // an unresolvable <frame N>
    const home = this.resolveHomeMethod(raw.homeMethodOop);

    let rawSource: string;
    let offsets: number[];
    try {
      rawSource = debug.getMethodSource(this.session, raw.homeMethodOop);
      offsets = debug.getSourceOffsetsForMethod(this.session, raw.homeMethodOop);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return undefined;
    }

    // Source is always shown 1:1 — doits run the user's raw code (no wrapper
    // glue), so displayed and stored coordinates coincide.
    const dispLineOffsets = buildLineOffsets(rawSource);
    const pos = editor.selection.active;
    const dispLineStart = dispLineOffsets[pos.line + 1];
    if (dispLineStart === undefined) return undefined; // cursor past the source (stale editor)
    const cursorOffset = dispLineStart + pos.character;

    // Column-aware map needs the cursor's line bounds in STORED coords.
    const storedLineOffsets = dispLineOffsets;
    let storedLine = 1;
    for (let l = 1; l < storedLineOffsets.length; l++) {
      if (storedLineOffsets[l] <= cursorOffset) storedLine = l;
      else break;
    }
    const lineStart = storedLineOffsets[storedLine];
    const lineEnd = storedLineOffsets[storedLine + 1] ?? rawSource.length; // end exclusive
    const mapped = mapOffsetToStepPoint(cursorOffset, offsets, lineStart, lineEnd);
    if (!mapped) return undefined;

    if (!home.uriInfo) {
      // Doit / non-symbol-list: break by the method's OOP (no class>>selector).
      return { homeMethodOop: raw.homeMethodOop, stepPoint: mapped.stepPoint };
    }
    // Editable method: break by class>>selector + guard a user line breakpoint.
    // `mapped.offset` is a 1-based stored position == displayed position (shift 0).
    let actualLine = 1;
    for (let l = 1; l < dispLineOffsets.length; l++) {
      if (dispLineOffsets[l] <= mapped.offset - 1) actualLine = l;
      else break;
    }
    return {
      homeMethodOop: raw.homeMethodOop,
      stepPoint: mapped.stepPoint,
      byName: {
        className: home.uriInfo.className,
        isMeta: home.uriInfo.isMeta,
        selector: home.uriInfo.selector,
        uri: this.shownFrameSourceUri,
        actualLine,
      },
    };
  }

  /**
   * True when the user already has an enabled breakpoint on `line` (1-based) of
   * `uri` — so Run to Cursor must NOT clear the step-point break afterward (it's the
   * user's, not our temporary one).
   */
  private userBreakAt(uri: string, line: number): boolean {
    return vscode.debug.breakpoints.some(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.enabled &&
        bp.location.uri.toString() === uri &&
        bp.location.range.start.line === line - 1,
    );
  }

  /** Post a brief, self-dismissing status flash to the webview (transient; doesn't disturb the error banner). */
  private flash(text: string): void {
    if (this.disposed) return;
    this.panel.webview.postMessage({ command: 'flash', text });
  }

  /**
   * Refuse a Resume/Step when the top activation is stale (its method was
   * recompiled in place and couldn't be re-entered). Continuing/stepping it would
   * hang the gem and freeze the extension host. Returns true if the action was
   * blocked (the caller must bail). The only safe escapes are Restart on a deeper
   * frame (re-enters the recompiled code) or Terminate.
   */
  // Shown whenever the process is uncontinuable (error 6011). Fixed text so
  // retrying Resume/Step never grows GemStone's accumulating exception-chain
  // message — and steers the user to the only thing that works: Terminate.
  private static readonly UNCONTINUABLE_MSG =
    "Execution can't be continued — this stepped into an unhandled halt or error and GemStone " +
    'marked the process uncontinuable (error 6011). Terminate (■) and re-run; Resume and Step ' +
    'cannot recover it. (To pass a halt next time, use Resume instead of Step.)';

  /**
   * Refuse a Resume/Step once the process is uncontinuable (6011). Returns true
   * if the action was blocked (caller must bail). Makes NO GCI call — so a retry
   * can't re-signal 6011 and grow GemStone's exception-chain message. The only
   * escape is Restart a deeper frame (which clears the flag) or Terminate.
   */
  private guardUncontinuable(): boolean {
    if (!this.uncontinuable) return false;
    this.errorMessage = DebuggerPanel.UNCONTINUABLE_MSG;
    this.postInit();
    return true;
  }

  private guardStaleTopActivation(action: string): boolean {
    if (!this.staleTopActivation) return false;
    this.errorMessage =
      `${action} is unavailable: the top frame's method was recompiled, so its ` +
      'suspended activation can no longer be continued (GemStone would hang). Restart a deeper ' +
      'frame to re-enter the recompiled code, or Terminate the process.';
    this.postInit();
    return true;
  }

  /**
   * The process ran to completion (via Resume or step). Hand its result to the
   * onComplete callback (e.g. a halted Display It rendering its value back in
   * the workspace) — BEFORE dispose, while the result oop is still fetchable —
   * then close the panel.
   */
  private onCompleted(result: debug.StepResult): void {
    // Show Transcript output the completing run buffered (harmlessly empty if
    // an onComplete callback drains again).
    appendTranscriptOutput(drainTranscript(this.session));
    if (result.resultOop != null) this.onComplete?.(result.resultOop);
    this.panel.dispose();
  }

  /**
   * Step over/into/through, then dispose on completion / else refresh.
   *
   * Steps from the selected (or topmost) USER frame's server level — NOT the
   * process top (level 1). After a `halt`/error the process top is exception/
   * signal machinery (which we filter out of the view); stepping over from a
   * user frame runs that machinery to completion and stops at the next step
   * point in the user code (e.g. the statement after `halt`), which is what the
   * user expects from one Step Over. Stepping from level 1 would instead crawl
   * one step point at a time through the hidden machinery.
   *
   * For a collapsed "Executed Code" doit frame, the displayed level is the
   * DEEPEST doit frame (the doit home), but for wrapped code (Display It /
   * Execute It / Inspect It) the halt is in a nested wrapper block ABOVE it.
   * Stepping from the doit-home level would step OVER the whole user block —
   * running every remaining statement to completion in one Step (the step-at-
   * halt bug: a single Step ran the process to the end). So we step from the
   * TRUE stop frame (the same `stopFrameLevel` the highlight uses) — one Step
   * then advances one user statement, never auto-completing past a halt.
   *
   * Requires native code OFF (codeExecutor toggles it before a debuggable run;
   * the panel holds it off while open) — GemStone can't step native code (error
   * 6014). If a step still hits that, we surface a clear message rather than
   * fail silently. Resume is unaffected.
   */
  private async step(
    command: 'stepOver' | 'stepInto' | 'stepThrough',
    displayLevel?: number,
  ): Promise<void> {
    if (this.guardStaleTopActivation('Step')) return;
    if (this.guardUncontinuable()) return;
    const fn =
      command === 'stepOver'
        ? debug.stepOverNb
        : command === 'stepInto'
          ? debug.stepIntoNb
          : debug.stepThruNb; // "Through" == gciStepThru
    const frame = this.frames.find((f) => f.level === displayLevel) ?? this.frames[0];
    let level = frame?.serverLevel ?? 1;
    // Redirect a step on a collapsed doit frame to its true stop frame (the
    // nested wrapper block where the halt actually is), or one Step at a halt
    // steps over the entire user block to completion. Mirrors revealFrameSource.
    if (frame?.isExecutedCode) {
      const raw = this.rawFrames.find((r) => r.serverLevel === frame.serverLevel);
      if (raw) level = this.stopFrameLevel(raw.homeMethodOop, frame.serverLevel);
    }
    await this.runNb('Step', async (opts) => {
      // Stepping moves the stack → the prior halt's revert slots are now invalid.
      this.clearUndoState();
      // Non-blocking + cancellable: a step that crawls hidden machinery or steps
      // a looping method no longer freezes the extension host (see nbRunner.ts).
      // Forwarding opts wires the in-panel Cancel button for a runaway step.
      const result = await fn(this.session, this.gsProcess, level, opts);
      // The sink buffers Transcript writes while debugging (a live forwarder
      // send would swallow the step) — show whatever this step produced.
      appendTranscriptOutput(drainTranscript(this.session));
      if (this.disposed) return; // panel closed while the step ran
      if (result.completed) {
        this.onCompleted(result);
        return;
      }
      if (result.errorNumber === GS_ERR_UNCONTINUABLE) {
        // Stepping *over* an unhandled halt/error drove its signal to
        // `_uncontinuableError`; the process is now dead-ended. Mark it so
        // Resume/Step are refused (no GCI retry → no growing message), keep the
        // pre-step stack, and steer the user to Terminate.
        this.uncontinuable = true;
        this.errorMessage = DebuggerPanel.UNCONTINUABLE_MSG;
        this.postInit(); // show the note; the stack is unchanged
        return;
      }
      if (result.errorMessage && /native code/i.test(result.errorMessage)) {
        this.errorMessage =
          'Stepping is unavailable while the gem runs native code ' +
          '(GEM_NATIVE_CODE_ENABLED). Use Resume — or run the gem with native code disabled to step.';
        this.postInit(); // show the note; the stack is unchanged
        return;
      }
      this.errorMessage = ''; // stepped to a new point — clear the original halt banner
      this.refresh();
    });
  }

  /**
   * Report a failed/cancelled non-blocking op in the panel banner (best-effort —
   * does nothing if the panel was disposed mid-flight). A user cancel (hard
   * break) is surfaced as "<action> cancelled", anything else as a failure.
   */
  private handleNbError(action: string, e: unknown): void {
    if (this.disposed) return;
    if (e instanceof NbCancelledError) {
      this.errorMessage = `${action} cancelled.`;
    } else {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `${action} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.refresh();
  }

  /**
   * Run a non-blocking debugger op (step / trim) under the single-in-flight
   * guard. Owns the `nbBusy` lifecycle in a `finally` so it can NEVER leak — a
   * leaked flag would silently wedge the debugger (every later step/resume/
   * restart becomes a no-op). `op` does the work and its own post-processing; a
   * thrown error (including a user cancel) is surfaced via handleNbError. If an
   * op is already in flight the request is NOT silently dropped — the user is
   * told to retry (otherwise a save-driven edit-and-continue or a click would
   * just vanish).
   */
  private async runNb(action: string, op: (opts: NbRunOptions) => Promise<void>): Promise<void> {
    if (this.nbBusy) {
      this.notifyBusy(action);
      return;
    }
    this.nbBusy = true;
    this.cancelClicks = 0; // reset before the op (onStart may not fire if start fails)
    // Hand the op nb options that (a) suppress the 2s toast — the in-panel overlay
    // owns cancel for debugger ops — and (b) wire the in-panel Cancel button: when
    // the op forwards these to its nb call, onStart fires and we mark it cancellable
    // and capture its cancel handle. Ops that don't forward them simply show the
    // spinner with no Cancel button (never a dead button).
    const opts: NbRunOptions = {
      suppressNotification: true,
      onStart: (cancel) => {
        this.activeNbCancel = cancel;
        this.setCancellable(true);
      },
    };
    try {
      await op(opts);
    } catch (e: unknown) {
      this.handleNbError(action, e);
    } finally {
      this.activeNbCancel = undefined;
      this.setCancellable(false);
      this.nbBusy = false;
    }
  }

  /** Tell the user another debugger op is still running rather than dropping theirs. */
  private notifyBusy(action: string): void {
    if (this.disposed) return;
    this.errorMessage = `Another debugger operation is still running — wait for it to finish, then retry ${action}.`;
    this.postInit();
  }

  /**
   * Restart the selected frame: re-enter its method from the first statement,
   * keeping the receiver + arguments. GemStone does this via
   * `GsProcess>>trimStackToLevel:` (the same primitive GT's `restartFrameLevel:`
   * uses), which trims the calls made from the frame and resets the new
   * top-of-stack to its method's first instruction.
   *
   * That primitive is a guarded no-op for level 1, and there is no primitive to
   * reset the *top* frame's IP in place — so the absolute top frame can't be
   * restarted. Tell the user instead of silently doing nothing; restart still
   * works on any deeper frame (for a recursive call, restarting the caller frame
   * re-enters the same method one level up).
   */
  private async restartFrame(serverLevel: number): Promise<void> {
    // A block frame can't be restarted on its own — retarget to its home
    // method's activation and re-run the whole home method (GT's behaviour, and
    // the only way to restart a block parked at the very top frame). A non-block
    // frame, or a block whose home has already returned, is left as-is.
    serverLevel = this.homeMethodFrameLevel(serverLevel);
    if (serverLevel <= 1) {
      // Show the notice IN the panel (the banner) — a toast is easy to miss while
      // the webview has focus. It clears on the next step/resume/restart.
      this.errorMessage =
        'Cannot restart the top frame: GemStone can only restart a frame ' +
        'that has called another. Select a deeper frame to restart it.';
      this.postInit();
      return;
    }
    // An Executed Code (doit) frame can't be a restart target: the kernel's
    // trimStackToLevel: does `oldHome inClass compiledMethodAt:…` to reinstall the
    // (possibly recompiled) method, and a doit's home method has a NIL class — so
    // the trim fails with a raw `UndefinedObject doesNotUnderstand`. Guard it with a
    // clear message instead, mirroring the edit-and-continue re-enter guard.
    if (this.rawFrames.find((r) => r.serverLevel === serverLevel)?.isExecutedCode) {
      this.errorMessage =
        'Cannot restart an Executed Code frame — it has no home class for ' +
        'GemStone to reset. Re-run the expression instead.';
      this.postInit();
      return;
    }
    await this.runNb('Restart frame', async (opts) => {
      // The trim rebuilds the stack → revert slots no longer apply.
      this.clearUndoState();
      // Forwarding opts wires the in-panel Cancel button — a trim can run unwind/
      // ensure: blocks (infinite kernel timeout), so a runaway restart is cancellable.
      await debug.trimStackToLevelNb(this.session, this.gsProcess, serverLevel, opts);
      if (this.disposed) return;
      this.staleTopActivation = false; // the trim discarded any stale top activation
      this.uncontinuable = false; // …and a fresh activation is continuable again
      this.errorMessage = '';
      this.refresh();
    });
  }

  /**
   * Edit-and-continue. The companion source editor IS a real `gemstone://`
   * editor, so saving it already recompiles the method (the FS provider's
   * writeFile). We hook the *post*-save moment: when the saved document is the
   * selected frame's editable source AND the recompile succeeded, re-enter the
   * recompiled method so execution picks up the new code.
   *
   * Only the selected frame's editable source counts — a read-only doit, or a
   * save of some unrelated method, is ignored (`editableSourceUri` gates it).
   *
   * A failed recompile leaves the OLD method installed and an error diagnostic
   * on the URI (the FS provider sets it and does NOT rethrow, so this save still
   * fires) — we detect that and do nothing, so the user just fixes and re-saves.
   */
  private onSourceSaved(doc: vscode.TextDocument): void {
    // Create-method-from-DNU: saving the pre-filled template compiles the new
    // method; on a clean compile, resume so the send re-dispatches into it. A bad
    // compile keeps the pending state so the user can fix the squiggle and re-save.
    if (this.pendingDnuMethodUri !== undefined && doc.uri.toString() === this.pendingDnuMethodUri) {
      if (this.recompileFailed(doc.uri)) return;
      const selector = this.pendingDnuSelector ?? '';
      this.pendingDnuMethodUri = undefined;
      this.pendingDnuSelector = undefined;
      this.dnuInfo = undefined; // the method now exists
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: needs investigation before deciding void vs .catch; the sibling override branch below uses void, but confirm finishDnuMethod can't reject outside runNb's internal handling first
      this.finishDnuMethod(selector);
      return;
    }

    // Implement-in-receiver (override): saving the template creates the method in
    // the chosen class; on a clean compile we just refresh + explain (no trim —
    // option B). A bad compile keeps the pending state for a re-save.
    if (this.pendingOverrideUri !== undefined && doc.uri.toString() === this.pendingOverrideUri) {
      if (this.recompileFailed(doc.uri)) return;
      const selector = this.pendingOverrideSelector ?? '';
      const shadowedBy = this.pendingOverrideShadowedBy;
      const targetClass = this.pendingOverrideTargetClass ?? '';
      const reEnterSenderLevel = this.pendingOverrideReEnterSenderLevel;
      this.pendingOverrideUri = undefined;
      this.pendingOverrideSelector = undefined;
      this.pendingOverrideShadowedBy = undefined;
      this.pendingOverrideTargetClass = undefined;
      this.pendingOverrideReEnterSenderLevel = undefined;
      void this.finishOverrideMethod(selector, shadowedBy, targetClass, reEnterSenderLevel);
      return;
    }

    if (this.editableSourceUri === undefined || this.selectedServerLevel === undefined) return;
    if (doc.uri.toString() !== this.editableSourceUri) return;
    // The recompile failed if the FS provider left an error diagnostic on the URI
    // (it sets one and does NOT rethrow, so this save still fires) — then we leave
    // the old method installed and do nothing; the user fixes and re-saves.
    if (this.recompileFailed(doc.uri)) return;
    void this.editAndContinue(this.selectedServerLevel);
  }

  /**
   * Re-enter the (just-recompiled) selected frame's method. Reuses the restart
   * mechanism: `trimStackToLevel:` installs the recompiled home method on the
   * frame and resets it to its method's first instruction (the running activation
   * still held the OLD GsNMethod and could not continue on it). Execution then
   * flows into the new code on the next step/resume.
   *
   * Same GemStone limitation as Restart Frame: the primitive is a guarded no-op
   * for the absolute top frame (level 1), so an edit there can't be re-entered in
   * place — we tell the user instead of silently doing nothing. (After a halt/
   * error the user's frame is normally below the trimmed signal machinery, so its
   * server level is ≥ 2 and edit-and-continue works.)
   */
  private async editAndContinue(serverLevel: number): Promise<void> {
    // A block frame's editable source IS its home method (revealFrameSource
    // points editableSourceUri there), so the save already recompiled the home
    // method — re-enter at the home method's activation, not the block, to pick
    // up the new code. Mirrors restartFrame; a non-block frame is left as-is.
    serverLevel = this.homeMethodFrameLevel(serverLevel);
    if (serverLevel <= 1) {
      // The top method is now recompiled but its activation can't be re-entered;
      // mark it stale so Resume/Step refuse to continue it (would hang the gem).
      this.staleTopActivation = true;
      this.errorMessage =
        'Saved and recompiled — but GemStone cannot re-enter the top frame in ' +
        'place, so its suspended activation can no longer be continued. Restart a deeper frame ' +
        'to re-enter the recompiled code, or Terminate the process. (Resume/Step are disabled.)';
      this.postInit();
      return;
    }
    await this.runNb('Edit-and-continue', async () => {
      await debug.trimStackToLevelNb(this.session, this.gsProcess, serverLevel);
      if (this.disposed) return;
      this.staleTopActivation = false; // the trim rebuilt the stack from a fresh activation
      this.uncontinuable = false; // …which is continuable again
      this.errorMessage = '';
      this.refresh();
    });
  }

  /**
   * Open the selected frame's source in the companion editor docked *below* the
   * panel, and highlight the step point the IP is on.
   *
   * Two source kinds:
   *  - a class>>selector method → the real `gemstone://` editor (full editing,
   *    senders/implementors, breakpoint gutters);
   *  - an "Executed Code" / doit frame (no home dictionary) → a read-only
   *    virtual editor showing the executed source (so these frames still show
   *    their code rather than opening nothing).
   *
   * Resolution is lazy (only the selected frame, on demand) — the cheap stack
   * listing already happened on `ready`, so the expensive URI/source resolution
   * (review #6) is deferred to here. Everything is best-effort: a failure to
   * open one frame's source must never tear down the debugger.
   */
  private async revealFrameSource(level: number): Promise<void> {
    try {
      const info = debug.getFrameInfo(this.session, this.gsProcess, level);
      // Block frames share their home method's source; resolve from the home
      // method (blocks aren't dictionary entries) but keep the frame's own
      // method+ip for the position (matches buildFrame's naming/position split).
      const { homeMethodOop } = debug.getMethodBlockInfo(this.session, info.methodOop);
      // Same classification as buildFrame's label (C3): a frame the stack list
      // shows as a method must never open as "Executed Code", and vice-versa.
      const home = this.resolveHomeMethod(homeMethodOop);

      let uri: vscode.Uri;
      let methodForOffsets: { className: string; isMeta: boolean; selector: string } | undefined;
      // For a read-only view we still highlight the step point from the frame's
      // method OOP. Doits run the user's raw code, so the displayed source is
      // always the stored source and offsets apply 1:1.
      let readOnlyOffsetMethodOop: bigint | undefined;
      if (home.uriInfo) {
        // In the symbol list → the real editable gemstone:// editor.
        uri = vscode.Uri.parse(buildMethodSourceUri(this.session.id, home.uriInfo));
        methodForOffsets = {
          className: home.uriInfo.className,
          isMeta: home.uriInfo.isMeta,
          selector: home.uriInfo.selector,
        };
        // Saving this document triggers edit-and-continue for the selected frame.
        this.editableSourceUri = uri.toString();
      } else {
        // A read-only doit / non-symbol-list method can't be edited-and-continued.
        this.editableSourceUri = undefined;
        // No gemstone:// URI: show the source read-only, exactly as stored —
        // doits run the user's raw code, so there is no wrapper glue to strip.
        // Title by the method when we have one, so a non-symbol-list method
        // isn't mislabelled "Executed Code".
        //
        // Source AND offsets come from the HOME method, never the block's own
        // GsNMethod. A block's `_sourceOffsets` covers only its own step points,
        // but `_stepPointAt:` reports the frame's step point in HOME-method
        // numbering — so pairing a home step point with a block's short offsets
        // array overruns it (undefined) and the highlight collapses to the line.
        // The home method's offsets include every block's step points, so they
        // line up. (This mirrors the editable path, which uses home offsets.)
        const source = debug.getMethodSource(this.session, homeMethodOop);
        readOnlyOffsetMethodOop = homeMethodOop;
        const title = home.isExecutedCode
          ? 'Executed Code'
          : `${home.definingClassName}>>#${home.selector}`;
        uri = DebuggerPanel.stashReadOnlySource(this.session.id, homeMethodOop, title, source);
        this.stashedSourceKeys.add(uri.toString());
      }

      // Remember what the source pane is showing for this frame (editable or
      // read-only doit), so "Run to Cursor" can confirm the cursor refers to it.
      this.shownFrameSourceUri = uri.toString();
      // A method's line 0 is its selector signature (skip its arg declarations in
      // the overlay); an executed-code doit's line 0 is real code.
      this.shownFrameIsMethod = !home.isExecutedCode;
      const editor = await this.showSourceEditor(uri);

      // For a collapsed "Executed Code" doit frame, the displayed level is the
      // deepest doit frame, but execution actually stopped in a nested wrapper
      // block above it (Display It / Execute It / Inspect It). Query the step
      // point from the true stop frame so the marker lands on the user's halt
      // rather than the wrapper glue. Other frames show un-collapsed, so they
      // stop where they display (highlightLevel === level).
      const highlightLevel = home.isExecutedCode
        ? this.stopFrameLevel(homeMethodOop, level)
        : level;
      let highlightInfo = info;
      if (highlightLevel !== level) {
        try {
          highlightInfo = debug.getFrameInfo(this.session, this.gsProcess, highlightLevel);
        } catch {
          /* keep the displayed frame's info for the line fallback */
        }
      }

      // Highlight the current step point: from class>>selector offsets for an
      // editable method, or from the method OOP for a read-only doit.
      const range = methodForOffsets
        ? this.stepPointRange(editor.document, highlightInfo, highlightLevel, methodForOffsets)
        : readOnlyOffsetMethodOop !== undefined
          ? this.stepPointRange(
              editor.document,
              highlightInfo,
              highlightLevel,
              undefined,
              readOnlyOffsetMethodOop,
            )
          : undefined;
      // Clear a stale highlight if the source moved to a different editor.
      if (this.decoratedEditor && this.decoratedEditor !== editor) {
        this.decoratedEditor.setDecorations(DebuggerPanel.stepPointDecoration, []);
      }
      if (range) {
        editor.setDecorations(DebuggerPanel.stepPointDecoration, [range]);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      } else {
        editor.setDecorations(DebuggerPanel.stepPointDecoration, []);
      }
      this.decoratedEditor = editor;
      // Refresh the inline-value overlay for the frame now shown (#5). No-op
      // when the user hasn't toggled it on.
      this.updateInlineValues(editor, level);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Render (or clear) the inline-value overlay (#5) on `editor` for the frame at
   * `serverLevel`. Reuses the same `fetchVariables` round trip as the Variables
   * pane, flattens the editable groups (receiver / instVars / args & temps — the
   * synthetic stack temps have no source name, so they're skipped) into the
   * in-scope set, and decorates each source line that references one of them.
   * Off → just clears any existing overlay. Best-effort: a failed fetch leaves
   * the source clean rather than throwing on the hot path.
   */
  private updateInlineValues(editor: vscode.TextEditor, serverLevel: number): void {
    if (this.inlineDecoratedEditor && this.inlineDecoratedEditor !== editor) {
      this.inlineDecoratedEditor.setDecorations(DebuggerPanel.inlineValueDecoration, []);
      this.inlineDecoratedEditor = undefined;
    }
    if (!this.inlineValuesEnabled) {
      editor.setDecorations(DebuggerPanel.inlineValueDecoration, []);
      this.inlineHoverByLine.clear();
      this.inlineEditableByName.clear();
      this.inlineHoverLevel = undefined;
      return;
    }
    try {
      const vars = this.inlineVarsForFrame(serverLevel);
      const lines = editor.document.getText().split('\n');
      const overlay = computeInlineValueLines(lines, vars, {
        perLine: this.inlineValuesPerLine,
        signatureLine: this.shownFrameIsMethod,
      });
      // Record this frame's overlay so the HoverProvider can serve the full-value
      // hover for a hovered line (the decoration carries only the rendered `after`
      // text). Also index the editable variables by name for click-to-edit.
      this.inlineHoverByLine = new Map(overlay.map((o) => [o.line, o.vars]));
      this.inlineEditableByName = new Map(vars.filter((v) => v.edit).map((v) => [v.name, v.edit!]));
      this.inlineHoverLevel = serverLevel;
      const decorations: vscode.DecorationOptions[] = overlay.map((o) => {
        const line = editor.document.lineAt(o.line);
        return {
          range: new vscode.Range(line.range.end, line.range.end),
          // `padCh` left-pads each annotation so they align in one right-hand
          // column, out of the way of the code (see computeInlineValueLines).
          renderOptions: { after: { contentText: o.label, margin: `0 0 0 ${o.padCh}ch` } },
        };
      });
      editor.setDecorations(DebuggerPanel.inlineValueDecoration, decorations);
      this.inlineDecoratedEditor = editor;
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * The inline-value hover for `line` of the source `uriStr`: each variable's full
   * (un-truncated) printString, plus a hint that editable ones can be set by
   * clicking their name. Undefined when the overlay is off, the hovered document
   * isn't this panel's live source, or the line has no annotated variable.
   */
  private inlineHoverForLine(uriStr: string, line: number): vscode.MarkdownString | undefined {
    if (!this.inlineValuesEnabled || this.inlineHoverLevel === undefined) return undefined;
    // Only answer for the source the overlay was computed against, so a stale
    // (other-frame) map can't mislabel a different document.
    if (this.sourceEditor?.document.uri.toString() !== uriStr) return undefined;
    const vars = this.inlineHoverByLine.get(line);
    if (!vars || vars.length === 0) return undefined;
    return new vscode.MarkdownString(inlineHoverMarkdown(vars));
  }

  /**
   * HoverProvider entry point (#5 Phase 2): the inline-value hover for a hovered
   * source line, resolved to the panel showing that source. Returns undefined when
   * no live panel owns the document or it has nothing to show on that line.
   */
  static provideInlineHover(uriStr: string, line: number): vscode.MarkdownString | undefined {
    return DebuggerPanel.panelForSourceUri(uriStr)?.inlineHoverForLine(uriStr, line);
  }

  /**
   * The in-scope, named variables for `serverLevel` as inline-overlay rows, in
   * receiver → instVars → args/temps order (so a shadowing temp overrides an
   * instVar of the same name; `computeInlineValueLines` lets later entries win).
   * The collapsed `(stack temps)` group is dropped — those `.tN` temporaries have
   * no source name to match.
   */
  private inlineVarsForFrame(serverLevel: number): InlineVar[] {
    const vars: InlineVar[] = [];
    for (const group of this.variablesForFrame(serverLevel)) {
      if (group.kind === 'stacktemps') continue;
      for (const v of group.vars) {
        vars.push({
          name: v.name,
          value: shortenInlineValue(v.value),
          full: v.value,
          edit: v.edit,
        });
      }
    }
    return vars;
  }

  /**
   * Toggle the inline-value overlay (#5) for this panel, remember the choice
   * window-wide, and re-render the current source pane. Driven by the
   * `gemstone.toggleInlineValues` editor-title button.
   */
  toggleInlineValues(): void {
    this.inlineValuesEnabled = !this.inlineValuesEnabled;
    DebuggerPanel.savedInlineValuesEnabled = this.inlineValuesEnabled;
    if (this.sourceEditor && this.selectedServerLevel !== undefined) {
      this.updateInlineValues(this.sourceEditor, this.selectedServerLevel);
    }
    // Flip the source-pane CodeLens label (on/off) to match — and reveal/hide the
    // companion "every line" lens, which only shows while the overlay is on.
    DebuggerPanel.refreshSourceCodeLenses();
  }

  /**
   * Toggle the inline-value MODE (once-at-first-use ↔ every reference) for this
   * panel, remember it window-wide, and re-render. Driven by the second
   * source-pane CodeLens, shown only while the overlay is on.
   */
  toggleInlineValuesPerLine(): void {
    this.inlineValuesPerLine = !this.inlineValuesPerLine;
    DebuggerPanel.savedInlineValuesPerLine = this.inlineValuesPerLine;
    if (this.inlineValuesEnabled && this.sourceEditor && this.selectedServerLevel !== undefined) {
      this.updateInlineValues(this.sourceEditor, this.selectedServerLevel);
    }
    DebuggerPanel.refreshSourceCodeLenses();
  }

  /**
   * Forward the `gemstone.toggleInlineValues` command (fired by the source-pane
   * CodeLens, which passes the document URI) to the owning panel. Falls back to
   * the active editor's URI when called without one.
   */
  static toggleInlineValuesForUri(uriStr?: string): void {
    const uri = uriStr ?? vscode.window.activeTextEditor?.document.uri.toString();
    const dbg = uri ? DebuggerPanel.panelForSourceUri(uri) : undefined;
    if (dbg) dbg.toggleInlineValues();
  }

  /** As `toggleInlineValuesForUri`, but for the every-line MODE (second lens). */
  static toggleInlineValuesPerLineForUri(uriStr?: string): void {
    const uri = uriStr ?? vscode.window.activeTextEditor?.document.uri.toString();
    const dbg = uri ? DebuggerPanel.panelForSourceUri(uri) : undefined;
    if (dbg) dbg.toggleInlineValuesPerLine();
  }

  /** The live panel currently showing `uriStr` in its companion source pane, if any. */
  private static panelForSourceUri(uriStr: string): DebuggerPanel | undefined {
    for (const set of DebuggerPanel.panels.values()) {
      for (const dbg of set) {
        if (dbg.shownSourceUris.has(uriStr)) return dbg;
      }
    }
    return undefined;
  }

  /** True when `uriStr` is a source pane some live debugger is currently showing. */
  static isLiveSourceUri(uriStr: string): boolean {
    return DebuggerPanel.panelForSourceUri(uriStr) !== undefined;
  }

  /** Whether the panel showing `uriStr` has its inline-value overlay on. */
  static isInlineValuesEnabledFor(uriStr: string): boolean {
    return DebuggerPanel.panelForSourceUri(uriStr)?.inlineValuesEnabled ?? false;
  }

  /** Whether the panel showing `uriStr` is in every-line mode (vs first-use). */
  static isInlineValuesPerLineFor(uriStr: string): boolean {
    return DebuggerPanel.panelForSourceUri(uriStr)?.inlineValuesPerLine ?? false;
  }

  /**
   * The source-pane CodeLens provider, registered once in `activate()`. The
   * panel pokes it (via `refreshSourceCodeLenses`) whenever a source pane opens,
   * the shown frame changes, the overlay toggles, or a panel closes — so the
   * "Inline values: on/off" lens appears, flips, and disappears in step.
   */
  private static codeLensProvider: { refresh(): void } | undefined;
  static setSourceCodeLensProvider(p: { refresh(): void }): void {
    DebuggerPanel.codeLensProvider = p;
  }
  private static refreshSourceCodeLenses(): void {
    DebuggerPanel.codeLensProvider?.refresh();
  }

  /**
   * Open `uri` in the companion source editor and return it. The editor lives in
   * a dedicated group docked *below* the panel: the first time, we focus the
   * panel and split a new group beneath it; later selections reuse that group
   * (remembered as `sourceColumn`). Focus stays in the panel so clicking through
   * frames stays fluid, and the doc opens as a reused preview tab (no pile-up).
   */
  private async showSourceEditor(uri: vscode.Uri): Promise<vscode.TextEditor> {
    const firstOpen = this.sourceColumn === undefined;
    if (firstOpen) {
      try {
        this.panel.reveal(this.panel.viewColumn, false); // focus the panel's group…
        await vscode.commands.executeCommand('workbench.action.newGroupBelow'); // …then split below it
      } catch {
        /* best-effort layout; fall back to the active group */
      }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: this.sourceColumn ?? vscode.ViewColumn.Active,
      preview: true,
      preserveFocus: true,
    });
    this.shownSourceUris.add(uri.toString()); // closed with the panel (see dispose)
    DebuggerPanel.persistLiveSourceUris();
    DebuggerPanel.refreshSourceCodeLenses(); // surface the inline-values lens on this doc
    this.sourceColumn = editor.viewColumn ?? this.sourceColumn;
    this.sourceEditor = editor; // live .viewColumn used at close time (see field doc)
    // Size the brand-new source group: re-apply the user's remembered ratio (or
    // the ~1/3 default). Only on first open — never override a mid-session drag.
    if (firstOpen) {
      await this.applySourcePaneRatio();
      this.startLayoutSampler();
    }
    // gemstone:// docs get their language from the FS provider; the read-only
    // executed-code scheme does not, so set it so the source is highlighted.
    if (doc.languageId !== 'gemstone-smalltalk') {
      await vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
    }
    return editor;
  }

  /** The live column of the companion source group (survives ViewColumn renumbering). */
  private get liveSourceColumn(): number | undefined {
    return this.sourceEditor?.viewColumn ?? this.sourceColumn;
  }

  /**
   * Size the (just-created) source group to the remembered ratio, or the ~1/3
   * default. Uses `vscode.setEditorLayout` for an exact split that preserves all
   * other groups' sizes; falls back to the imprecise relative-resize command
   * when the layout can't be read/mapped (older VS Code, or an unusual layout).
   */
  private async applySourcePaneRatio(): Promise<void> {
    const ratio = DebuggerPanel.savedSourceRatio ?? DEFAULT_SOURCE_RATIO;
    try {
      const layout =
        await vscode.commands.executeCommand<EditorGroupLayout>('vscode.getEditorLayout');
      if (setSourceRatioInLayout(layout, this.liveSourceColumn, ratio)) {
        await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
        return;
      }
    } catch {
      /* fall through to the step-based resize */
    }
    // The new group is still focused (showTextDocument kept focus there), so the
    // relative resize targets it. newGroupBelow split 50/50; shrink toward ~1/3.
    try {
      for (let i = 0; i < SOURCE_SHRINK_STEPS; i++) {
        await vscode.commands.executeCommand('workbench.action.decreaseViewHeight');
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * Sample the source-group ratio periodically and remember it. VS Code gives no
   * editor-group resize event, so a low-frequency poll is the only way to capture
   * a drag of the panel↔source divider before the panel closes (at which point
   * the group is gone). `unref` so it never keeps the host alive.
   */
  private startLayoutSampler(): void {
    if (this.layoutSampler) return;
    this.layoutSampler = setInterval(() => void this.captureSourceRatio(), 2000);
    this.layoutSampler.unref?.();
  }

  private async captureSourceRatio(): Promise<void> {
    if (this.disposed || this.liveSourceColumn === undefined) return;
    try {
      const layout =
        await vscode.commands.executeCommand<EditorGroupLayout>('vscode.getEditorLayout');
      const ratio = sourceRatioFromLayout(layout, this.liveSourceColumn);
      if (ratio !== undefined) DebuggerPanel.savedSourceRatio = ratio;
    } catch {
      /* best-effort sampling */
    }
  }

  /**
   * The server level of the frame execution actually stopped in, for a collapsed
   * "Executed Code" doit frame. `filterStack` keeps only the DEEPEST executed-code
   * frame (the doit home), but for wrapped code (Display It / Execute It / Inspect
   * It) the halt is in a nested wrapper block ABOVE it. All of the doit's frames —
   * the wrapper blocks and the doit home — share its `homeMethodOop`, while
   * machinery and unrelated user-method frames do not, so the stop frame is the
   * TOPMOST raw frame (lowest server level) with that home method.
   *
   * Resolves to the doit home itself when nothing nests above it (a raw Debug It,
   * or a doit that just called into a user method), and to `fallbackLevel` if the
   * raws are unavailable — so the caller can use it unconditionally.
   */
  private stopFrameLevel(homeMethodOop: bigint, fallbackLevel: number): number {
    // rawFrames is in server order (top first), so the first match is the topmost.
    for (const r of this.rawFrames) {
      if (r.homeMethodOop === homeMethodOop) return r.serverLevel;
    }
    return fallbackLevel;
  }

  /**
   * Map a block frame's server level to the server level of its HOME method's
   * activation on the stack — the frame Navigate / Restart / edit-and-continue
   * act on. You can't meaningfully restart a block in isolation (its home
   * method's temps/iteration state are mid-flight, and a block at the very top
   * frame can't be reset in place at all); re-running the whole home method from
   * its first statement is the operation that makes sense — this matches GT.
   *
   * A block always runs ABOVE its home method, so the home activation is the
   * nearest frame BELOW the block (deeper — higher server level) whose method IS
   * the home method (non-block, `methodOop === homeMethodOop`). This is the
   * opposite direction from `stopFrameLevel`, which finds the TOPMOST frame
   * sharing a home method (the true stop frame, for stepping/highlighting).
   *
   * Returns the input level unchanged for a non-block frame, or when the home
   * method isn't on the stack (a stored block invoked after its home returned) —
   * the caller then acts on the frame as-is.
   */
  private homeMethodFrameLevel(serverLevel: number): number {
    const raw = this.rawFrames.find((r) => r.serverLevel === serverLevel);
    if (!raw || !raw.isBlock) return serverLevel;
    for (const r of this.rawFrames) {
      if (r.serverLevel > serverLevel && !r.isBlock && r.methodOop === raw.homeMethodOop) {
        return r.serverLevel;
      }
    }
    return serverLevel; // home method not on the stack → act on the block frame itself
  }

  /**
   * The range to highlight for a frame's current step point — just the token at
   * the step point, NOT the whole line. Prefers the exact step-point character
   * offset (`getSourceOffsets`, available for class>>selector methods); falls
   * back to the start of the IP's source line when offsets aren't available
   * (e.g. executed-code frames). Returns undefined when there's nothing to mark.
   */
  private stepPointRange(
    doc: vscode.TextDocument,
    info: debug.FrameInfo,
    level: number,
    method: { className: string; isMeta: boolean; selector: string } | undefined,
    readOnlyMethodOop?: bigint,
  ): vscode.Range | undefined {
    let pos: vscode.Position | undefined;

    // Exact step-point offset → the precise sub-expression start. The offsets
    // come from class>>selector for an editable method, or straight from the
    // method OOP for a read-only doit. The displayed source is always the
    // stored source (doits run the user's raw code), so offsets apply 1:1.
    if (method || readOnlyMethodOop !== undefined) {
      try {
        const stepPoint = debug.getStepPoint(this.session, this.gsProcess, level);
        if (stepPoint) {
          // getSourceOffsets returns GemStone `_sourceOffsets`, which are
          // 1-BASED (see getStepPointSelectorRanges.ts). doc.positionAt is
          // 0-based, so convert — otherwise the highlight sits one char too far.
          const offsets = method
            ? queries.getSourceOffsets(
                this.session,
                method.className,
                method.isMeta,
                method.selector,
              )
            : debug.getSourceOffsetsForMethod(this.session, readOnlyMethodOop!);
          const offset = offsets[stepPoint - 1];
          const displayOffset = offset != null ? offset - 1 : -1;
          if (displayOffset >= 0 && doc.positionAt) pos = doc.positionAt(displayOffset);
        }
      } catch {
        /* best-effort; fall back to the IP line below */
      }
    }

    // Fallback: the first non-whitespace token of the IP's source line.
    if (!pos) {
      let line = 0;
      try {
        line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset);
      } catch {
        /* */
      }
      if (line > 0) {
        const col = doc.lineAt?.(line - 1)?.firstNonWhitespaceCharacterIndex ?? 0;
        pos = new vscode.Position(line - 1, col);
      }
    }
    if (!pos) return undefined;

    // Mark the token at the step point (its beginning), not the whole line.
    return doc.getWordRangeAtPosition?.(pos) ?? new vscode.Range(pos, pos.translate(0, 1));
  }

  /**
   * Walk the suspended process's stack and build a label per frame. The naming
   * logic deliberately mirrors the DAP `stackTraceRequest`
   * (gemstoneDebugSession.ts) so the Enhanced Debugger's stack matches the Run
   * and Debug Call Stack frame-for-frame. Proves the `debugQueries` pipe works
   * from this second consumer before Stage 1 builds the real layout on top.
   */
  private fetchStack(): DisplayFrame[] {
    const raws: RawFrame[] = [];
    try {
      const depth = debug.getStackDepth(this.session, this.gsProcess);
      for (let level = 1; level <= depth; level++) {
        raws.push(this.buildFrame(level));
      }
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.rawFrames = [];
      return [];
    }
    this.rawFrames = raws; // retained for stopFrameLevel (pre-collapse lookup)
    // Trim machinery/wrapper glue, then renumber the survivors 1..N for display
    // while keeping each one's real server level for subsequent queries.
    const kept = filterStack(raws);
    // serverLevel → display level, so a block frame can point at its home frame.
    const displayLevelByServer = new Map<number, number>();
    kept.forEach((r, i) => displayLevelByServer.set(r.serverLevel, i + 1));
    return kept.map((r, i) => {
      // "Go to home method" target: for a block frame, the display level of its
      // home method's activation — but only when that frame is itself visible
      // and isn't this very frame (homeMethodFrameLevel returns the input level
      // when the home method has already returned / was filtered out).
      let homeDisplayLevel: number | undefined;
      if (r.isBlock) {
        const homeServer = this.homeMethodFrameLevel(r.serverLevel);
        if (homeServer !== r.serverLevel) {
          const dl = displayLevelByServer.get(homeServer);
          if (dl !== undefined && dl !== i + 1) homeDisplayLevel = dl;
        }
      }
      return {
        level: i + 1,
        serverLevel: r.serverLevel,
        label: r.label,
        isExecutedCode: r.isExecutedCode,
        overridable: r.overridable,
        receiverClass: r.receiverClassName,
        breakable: r.breakable,
        // Browsable iff the frame runs a real Class>>#selector (not a doit, and the
        // home method resolved to a defining class + selector).
        browsable: !r.isExecutedCode && !!r.definingClassName && !!r.selector,
        homeDisplayLevel,
        // Executed-code frames have no meaningful step point/line once unwrapped (#3).
        position: r.isExecutedCode ? '' : formatFramePosition(r.stepPoint, r.line),
      };
    });
  }

  /**
   * Resolve a single raw frame: a `Class[ class]>>#selector` label plus the
   * classification bits the stack filter needs. The label logic mirrors the DAP
   * path — only frames whose contents can't be fetched are `<frame N>`; a valid
   * frame with no introspectable method (a doit / executed-code or its blocks)
   * is `Executed Code`. Step point / line are best-effort.
   */
  private buildFrame(level: number): RawFrame {
    let info: debug.FrameInfo;
    try {
      info = debug.getFrameInfo(this.session, this.gsProcess, level);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return {
        serverLevel: level,
        methodOop: 0n,
        homeMethodOop: 0n,
        isBlock: false,
        definingClassName: '',
        selector: '',
        isExecutedCode: false,
        breakable: false,
        label: `<frame ${level}>`,
      };
    }

    // Block vs home method (homeMethodOop == methodOop for non-blocks).
    let isBlock = false;
    let homeMethodOop = info.methodOop;
    try {
      const blockInfo = debug.getMethodBlockInfo(this.session, info.methodOop);
      isBlock = blockInfo.isBlock;
      homeMethodOop = blockInfo.homeMethodOop;
    } catch {
      /* treat as a non-block frame */
    }

    // Resolve the home method's identity (the single source of truth for
    // "is this executed code?", shared with revealFrameSource — see C3).
    const home = this.resolveHomeMethod(homeMethodOop);

    let label: string;
    let receiverClass: string | undefined;
    if (home.definingClassName) {
      const definingClass = `${home.definingClassName}${home.isMeta ? ' class' : ''}`;
      // Receiver class drives the `Receiver (Defining)` disambiguation for
      // inherited methods (non-block frames only — see formatFrameLabel).
      if (!isBlock) {
        try {
          receiverClass = debug.getObjectClassName(this.session, info.receiverOop);
        } catch {
          /* best-effort; fall back to defining class only */
        }
      }
      label = formatFrameLabel({ isBlock, definingClass, selector: home.selector, receiverClass });
    } else {
      label = 'Executed Code';
    }
    const isExecutedCode = home.isExecutedCode;
    // The running method was inherited iff the receiver's class differs from the
    // method's defining class — the precise condition for offering "Implement in
    // <ReceiverClass>" (override). (getObjectClassName returns "Foo class" for a
    // class receiver, so a class-side inherited method qualifies too.)
    const overridable =
      !isBlock &&
      !isExecutedCode &&
      !!receiverClass &&
      receiverClass !== home.definingClassName &&
      receiverClass !== `${home.definingClassName} class`;

    let line: number | undefined;
    try {
      line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset);
    } catch {
      /* best-effort */
    }

    let stepPoint: number | undefined;
    try {
      stepPoint = debug.getStepPoint(this.session, this.gsProcess, level);
    } catch {
      /* best-effort */
    }

    // Breakable iff we resolved a home method to set a step-point break in —
    // drives "Run to Cursor" (#2). The home method's `_sourceOffsets` is method-
    // wide (it spans every nested block — verified on the stone), so a cursor in a
    // doit's user code maps to a real step point too. An editable method breaks by
    // class>>selector; a doit / non-symbol-list method breaks by its method OOP.
    // Only an unresolvable `<frame N>` (homeMethodOop 0) can't be broken.
    const breakable = homeMethodOop !== 0n;

    return {
      serverLevel: level,
      methodOop: info.methodOop,
      homeMethodOop,
      isBlock,
      definingClassName: home.definingClassName,
      selector: home.selector,
      isExecutedCode,
      receiverClassName: receiverClass,
      overridable,
      breakable,
      label,
      line,
      stepPoint,
    };
  }

  /**
   * Resolve a (home) method's display identity — the SINGLE source of truth for
   * "is this executed code?", shared by buildFrame (labelling/classification)
   * and revealFrameSource (source-pane routing) so the two can never disagree.
   *
   *  - in the session's symbol list → `uriInfo` set (editable via gemstone://);
   *  - resolvable class but not in the symbol list → `uriInfo` undefined, but
   *    definingClassName/selector are still set — a real method, NOT executed code;
   *  - no resolvable class at all (a doit) → isExecutedCode true.
   */
  private resolveHomeMethod(homeMethodOop: bigint): {
    uriInfo: debug.MethodUriInfo | undefined;
    definingClassName: string;
    selector: string;
    isMeta: boolean;
  } & { isExecutedCode: boolean } {
    let uriInfo: debug.MethodUriInfo | undefined;
    let definingClassName = '';
    let selector = '';
    let isMeta = false;
    try {
      uriInfo = debug.getMethodUriInfo(this.session, homeMethodOop);
      if (uriInfo && uriInfo.dictName) {
        definingClassName = uriInfo.className;
        selector = uriInfo.selector;
        isMeta = uriInfo.isMeta;
      } else {
        uriInfo = undefined; // no dictName → not usable to build a gemstone:// URI
        const methodInfo = debug.getMethodInfo(this.session, homeMethodOop);
        definingClassName = methodInfo.className;
        selector = methodInfo.selector;
      }
    } catch {
      /* doit / executed code: no resolvable home class */
    }
    return {
      uriInfo,
      definingClassName,
      selector,
      isMeta,
      isExecutedCode: definingClassName === '',
    };
  }

  /** Dimmed "For <user> on <stone> @ <host>" subtitle from the login. */
  private sessionSubtitle(): string {
    const { gs_user, stone, gem_host } = this.session.login;
    const parts: string[] = [];
    if (gs_user) parts.push(`For ${gs_user}`);
    if (stone) parts.push(`on ${stone}`);
    if (gem_host) parts.push(`@ ${gem_host}`);
    return parts.join(' ');
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const subtitle = escapeHtml(this.sessionSubtitle());
    const stackBasis = DebuggerPanel.savedStackBasis;
    const evalHeight = DebuggerPanel.savedEvalHeight;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Fill the webview column as a flex column so the panes take all available
       height (more stack frames visible) and the eval bar stays pinned at the
       bottom — it can never overlap the companion source editor group below. */
    html, body { height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 0.75rem 1rem;
      box-sizing: border-box;
      height: 100vh;
      margin: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Suppress text selection / the default Cut-Copy-Paste affordances; the
       Copy button is the supported way to copy the stack. */
    body { user-select: none; -webkit-user-select: none; }
    /* Progress / busy indicator (#9). The host posts {command:'busy', on} around
       blocking server round-trips (class-chain resolve, save→fetchStack, etc.);
       the webview reveals this only if the op outlives BUSY_DELAY_MS (~500ms), so
       fast calls never flash. The webview is a SEPARATE process from the frozen
       extension host, so this keeps animating while the host is blocked. */
    body.busy { cursor: progress; }
    .busy-overlay {
      position: fixed; inset: 0; z-index: 50;
      display: flex; align-items: center; justify-content: center;
      background: transparent; pointer-events: none; /* don't trap clicks */
    }
    .busy-box { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
    .busy-overlay .busy-spinner {
      width: 30px; height: 30px; border-radius: 50%;
      border: 3px solid var(--vscode-foreground);
      border-top-color: transparent;
      opacity: 0.45;
      animation: jasper-busy-spin 0.8s linear infinite;
    }
    @keyframes jasper-busy-spin { to { transform: rotate(360deg); } }
    /* The Cancel button is the one part of the overlay that takes clicks — it
       appears only for cancellable (non-blocking) ops, so it's never a dead link. */
    .busy-cancel {
      pointer-events: auto;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none; padding: 0.25rem 0.9rem; border-radius: 2px; cursor: pointer;
      font-size: 0.85rem;
    }
    .busy-cancel:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    .titlebar { display: flex; align-items: baseline; gap: 0.6rem; margin: 0 0 0.25rem; flex-wrap: wrap; }
    h1 { font-size: 1.3rem; margin: 0; }
    .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
    /* The action cluster sits together at the right; the buttons no longer each
       grab margin-left:auto, which used to spread them apart. */
    .titlebar-actions { margin-left: auto; display: flex; align-items: center; gap: 0.15rem; min-width: 0; }
    /* Copy/Dump are icon-only buttons (tooltips name them), styled like the toolbar. */
    .copy-btn {
      display: flex; align-items: center; justify-content: center;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      background: transparent; border: none; padding: 0.3rem; border-radius: 4px; cursor: pointer;
    }
    /* pointer-events:none so hover/click land on the BUTTON (which owns the title
       tooltip + handler), not the title-less SVG — otherwise no tooltip appears. */
    .copy-btn svg { width: 16px; height: 16px; display: block; pointer-events: none; }
    .copy-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    /* "Dumped to <path>  ⧉" — its OWN row under the titlebar (not in the button
       flex row), so showing/hiding it never reflows the buttons. Right-aligned to
       sit under the buttons; auto-hides after 5s. */
    .save-notice { display: flex; align-items: center; justify-content: flex-end; gap: 0.3rem; min-width: 0; margin: 0 0 0.25rem; }
    /* The path reads as a link (click opens the file in an editor). */
    .save-path {
      color: var(--vscode-textLink-foreground, var(--vscode-descriptionForeground)); font-size: 0.82em; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      user-select: text; -webkit-user-select: text; cursor: pointer;
    }
    .save-path:hover { text-decoration: underline; }
    /* Small copy glyph, styled like the Variables pane's revert (↺) icon. */
    .copy-path-icon {
      flex: 0 0 auto; cursor: pointer; user-select: none; font-size: 0.95em;
      color: var(--vscode-descriptionForeground); opacity: 0.8;
    }
    .copy-path-icon:hover { opacity: 1; color: var(--vscode-foreground); }
    .error {
      color: var(--vscode-errorForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      margin-bottom: 1rem;
      /* Selectable so the error text can be copied (Ctrl/Cmd+C); the rest of the
         panel stays non-selectable to keep the custom copy menu the only path. */
      user-select: text; -webkit-user-select: text; cursor: text;
    }
    /* Transient status flash (e.g. Run to Cursor falling back to a plain Resume).
       Self-dismisses; sits above the error banner and never clobbers it. The
       show class fades it in (and is removed on a timer to fade it out). */
    .flash {
      color: var(--vscode-notificationsInfoIcon-foreground, var(--vscode-foreground));
      background: var(--vscode-editorWidget-background, transparent);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 4px; padding: 0.25rem 0.6rem; margin-bottom: 0.6rem;
      font-size: 0.9rem; opacity: 0; transition: opacity 0.15s ease-in-out;
    }
    .flash.show { opacity: 1; }
    /* "Create #selector in Class" action shown when parked on a doesNotUnderstand:.
       Styled as a prominent primary button just below the error banner. */
    .dnu-bar { margin: 0 0 0.75rem; }
    .dnu-bar:empty { display: none; }
    .dnu-btn {
      font-family: var(--vscode-font-family);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none; padding: 0.3rem 0.8rem; border-radius: 2px; cursor: pointer;
    }
    .dnu-btn:hover { background: var(--vscode-button-hoverBackground); }
    .stack { list-style: none; margin: 0; padding: 0; }
    .frame {
      font-family: var(--vscode-editor-font-family, monospace);
      padding: 0.2rem 0.4rem;
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      cursor: context-menu;
    }
    .frame:hover { background: var(--vscode-list-hoverBackground); }
    .frame.selected { background: var(--vscode-list-activeSelectionBackground); }
    /* Custom right-click menu (the default Cut/Copy/Paste menu is suppressed). */
    .ctx-menu {
      position: fixed; display: none; z-index: 10; min-width: 120px; padding: 0.2rem 0;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border, transparent));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
    }
    .ctx-menu.show { display: block; }
    .ctx-item { padding: 0.25rem 1rem; cursor: pointer; white-space: nowrap; }
    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground);
      color: var(--vscode-menu-selectionForeground);
    }
    .frame .level { color: var(--vscode-descriptionForeground); margin-right: 0.6rem; }
    .frame .pos { color: var(--vscode-descriptionForeground); margin-left: 0.6rem; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    /* Pane labels above the Call Stack / Variables panes. */
    .pane-title {
      font-size: 0.9rem; font-weight: 600; margin: 0 0 0.3rem;
      color: var(--vscode-foreground);
    }
    /* Toolbar: icon-only debug controls (the DAP toolbar's codicon glyphs) so it
       stays compact. Tooltips/aria-labels carry the names. */
    .toolbar { display: flex; gap: 0.15rem; margin: 0 0 0.6rem; flex-wrap: wrap; }
    .toolbar button {
      display: flex; align-items: center; justify-content: center;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      background: transparent;
      border: none; padding: 0.3rem; border-radius: 4px; cursor: pointer;
    }
    .toolbar button svg { width: 16px; height: 16px; display: block; pointer-events: none; }
    .toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .toolbar button.danger { color: var(--vscode-debugIcon-stopForeground, var(--vscode-errorForeground)); }
    /* A disabled control (e.g. Run to Cursor on a non-breakable doit frame) dims and
       drops its hover affordance, so it reads as unavailable. */
    .toolbar button:disabled { opacity: 0.35; cursor: default; }
    .toolbar button:disabled:hover { background: transparent; }
    /* Call Stack (left) + Variables (right), divided by a draggable splitter.
       --stack-basis is the stack pane's width; the splitter drag rewrites it and
       it's persisted (see debuggerView.js / the saveLayout message). */
    /* The panes row fills the leftover vertical space (flex:1) so the Call Stack /
       Variables get as much room as the column allows. */
    .main { display: flex; align-items: stretch; --stack-basis: 60%; flex: 1 1 auto; min-height: 0; }
    .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .stack-pane { flex: 0 0 var(--stack-basis); }
    .vars-pane { flex: 1 1 0; }
    .main .stack { min-width: 0; flex: 1 1 0; min-height: 0; overflow: auto; }
    /* Draggable divider: a thin hit area with a centred 1px rule that thickens
       and lights up on hover / while dragging. */
    .splitter {
      flex: 0 0 9px; align-self: stretch; cursor: col-resize; position: relative;
      margin-top: 1.7rem; /* skip past the pane titles so the rule spans the lists */
    }
    .splitter::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
      background: var(--vscode-panel-border, transparent);
    }
    .splitter:hover::before, .splitter.dragging::before {
      left: 3px; width: 3px; background: var(--vscode-focusBorder);
    }
    .vars {
      min-width: 0; flex: 1 1 0; min-height: 0; overflow: auto;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
    }
    /* Horizontal divider between the panes and the eval bar: drag up to give the
       eval bar more room (e.g. for a long result), drag down to give the panes
       more room. Rewrites the --eval-height var (the eval bar's fixed height). */
    .hsplitter {
      flex: 0 0 auto; height: 9px; cursor: row-resize; position: relative; margin: 0.2rem 0;
    }
    .hsplitter::before {
      content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 1px;
      background: var(--vscode-panel-border, transparent);
    }
    .hsplitter:hover::before, .hsplitter.dragging::before {
      top: 3px; height: 3px; background: var(--vscode-focusBorder);
    }
    /* Only when the column is genuinely tiny: stack the Variables pane under the
       Call Stack and hide the splitter (a horizontal drag is meaningless in a
       vertical layout). A debugger webview usually lives in a Beside column a few
       hundred px wide, so this threshold stays low — otherwise the side-by-side
       layout would never apply and the panel would be needlessly tall. */
    @media (max-width: 340px) {
      .main { flex-direction: column; }
      .stack-pane, .vars-pane { flex: 1 1 0; }
      .splitter { display: none; }
      .vars-pane { margin-top: 0.6rem; }
    }
    /* Variable groups (Receiver / Instance variables / Arguments & Temps /
       stack temps). Titles toggle their body; the stack-temps group is collapsed. */
    .var-group { margin-bottom: 0.25rem; }
    .var-group-title {
      font-weight: 600; font-size: 0.82rem; cursor: pointer; user-select: none;
      color: var(--vscode-foreground); padding: 0.15rem 0.2rem;
    }
    .var-group-title::before { content: '\\25BE\\00a0'; color: var(--vscode-descriptionForeground); }
    .var-group.collapsed .var-group-title::before { content: '\\25B8\\00a0'; }
    .var-group.collapsed .var-group-body { display: none; }
    .vars .var {
      padding: 0.15rem 0.2rem; display: flex; gap: 0.5rem; align-items: baseline;
      cursor: default; border-radius: 3px;
    }
    /* Only editable rows invite a click (left-click opens the variable evaluator);
       the pointer cursor signals they're interactive. */
    .vars .var.editable { cursor: pointer; }
    /* While editing, let the error message wrap onto its own line under the input. */
    .vars .var.editing { flex-wrap: wrap; }
    .vars .var:hover { background: var(--vscode-list-hoverBackground); }
    /* Inline variable evaluator: replaces the value cell in place, prefilled with
       the printString. .error flags a rejected (compile/runtime) expression. */
    .vars .var-edit {
      flex: 1 1 auto; min-width: 0; box-sizing: border-box; user-select: text; -webkit-user-select: text;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      padding: 0.05rem 0.25rem; border-radius: 2px;
    }
    .vars .var-edit.error {
      border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
      outline: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
    }
    /* The rejected-expression message, on its own line below the input.
       Selectable so the user can copy the real error text. */
    .vars .var-edit-error {
      flex: 1 0 100%; margin-top: 0.15rem; padding-left: 0.1rem;
      color: var(--vscode-errorForeground); font-size: 0.78em; white-space: pre-wrap; word-break: break-word;
      user-select: text; -webkit-user-select: text; cursor: text;
    }
    .vars .var-name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground)); white-space: nowrap; flex: 0 0 auto; }
    .vars .var-name.self { font-style: italic; }
    /* The value hugs its content (shrink-and-ellipsize, not grow) so the revert
       icon can sit right after it; min-width:0 lets the ellipsis kick in. */
    .vars .var-value { color: var(--vscode-descriptionForeground); white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
    /* Revert (↺) icon on an edited row — immediately to the right of the value.
       A long printString ellipsizes (the value shrinks), so the icon stays glued
       to the value and never scrolls off; the dim OOP stays pinned far right. */
    .vars .var-revert {
      flex: 0 0 auto; cursor: pointer; user-select: none;
      color: var(--vscode-descriptionForeground); opacity: 0.8;
    }
    .vars .var-revert:hover { opacity: 1; color: var(--vscode-foreground); }
    /* OOP shown dim at the row end, matching the enhanced inspector header convention. */
    .vars .var-oop {
      flex: 0 0 auto; margin-left: auto; white-space: nowrap;
      font-size: 0.78em; color: var(--vscode-descriptionForeground); opacity: 0.75;
    }
    /* Eval-in-frame bar: a fixed-height region at the bottom (the hsplitter
       resizes it). The result area scrolls within it. */
    .evalbar {
      flex: 0 0 var(--eval-height, 4rem); min-height: 2.6rem; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .evalbar input {
      width: 100%; box-sizing: border-box; user-select: text; -webkit-user-select: text;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
      padding: 0.3rem 0.5rem; border-radius: 2px; flex: 0 0 auto;
    }
    .eval-result {
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
      white-space: pre-wrap; margin-top: 0.35rem; user-select: text; -webkit-user-select: text;
      flex: 1 1 auto; min-height: 0; overflow: auto;
    }
    .eval-result.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <div class="titlebar">
    <h1>Jasper Debugger</h1>
    <span class="subtitle">${subtitle}</span>
    <span class="titlebar-actions">
      <button id="copyBtn" class="copy-btn" title="Copy Stack — copy the full stack (with each frame's variable values) to the clipboard" aria-label="Copy Stack">${TOOLBAR_ICONS.copyStack}</button>
      <button id="dumpBtn" class="copy-btn" title="Dump Stack — write the full stack to a file in ~/.jasper/stacks" aria-label="Dump Stack">${TOOLBAR_ICONS.dumpStack}</button>
    </span>
  </div>
  <!-- Dump-path confirmation gets its OWN row (so it never reflows the buttons),
       right-aligned to sit under them. The path opens the file on click. -->
  <div id="saveNotice" class="save-notice" style="display:none;">
    <span id="savePath" class="save-path" role="button" title="Click to open this file in an editor"></span>
    <span id="copyPathBtn" class="copy-path-icon" role="button" title="Copy the file path to the clipboard">⧉</span>
  </div>
  <div class="toolbar" id="toolbar">
    <button data-cmd="resume" title="Resume execution" aria-label="Resume execution">${TOOLBAR_ICONS.resume}</button>
    <button data-cmd="runToCursor" id="runToCursorBtn" disabled title="Run to Cursor" aria-label="Run to Cursor">${TOOLBAR_ICONS.runToCursor}</button>
    <button data-cmd="stepOver" title="Step over (from the selected frame)" aria-label="Step over">${TOOLBAR_ICONS.stepOver}</button>
    <button data-cmd="stepInto" title="Step into" aria-label="Step into">${TOOLBAR_ICONS.stepInto}</button>
    <button data-cmd="stepThrough" title="Step through blocks" aria-label="Step through blocks">${TOOLBAR_ICONS.stepThrough}</button>
    <button data-cmd="restartFrame" title="Restart the selected frame" aria-label="Restart the selected frame">${TOOLBAR_ICONS.restartFrame}</button>
    <button data-cmd="terminate" class="danger" title="Terminate the process" aria-label="Terminate the process">${TOOLBAR_ICONS.terminate}</button>
  </div>
  <div class="flash" id="flash" style="display:none;"></div>
  <div class="error" id="error"></div>
  <div class="dnu-bar" id="dnuBar"></div>
  <div class="main" id="main" style="--stack-basis: ${stackBasis};">
    <div class="pane stack-pane">
      <div class="pane-title">Call Stack</div>
      <ul class="stack" id="stack"></ul>
    </div>
    <div class="splitter" id="splitter" title="Drag to resize"></div>
    <div class="pane vars-pane">
      <div class="pane-title">Variables</div>
      <div class="vars" id="variables"></div>
    </div>
  </div>
  <div class="hsplitter" id="hsplitter" title="Drag to resize the panes vs the eval bar"></div>
  <div class="evalbar" id="evalbar" style="--eval-height: ${evalHeight};">
    <input id="evalInput" type="text" autocomplete="off" spellcheck="false"
           placeholder="Evaluate in the selected frame — press Enter">
    <div class="eval-result" id="evalResult"></div>
  </div>
  <div id="ctxmenu" class="ctx-menu" role="menu">
    <div class="ctx-item" id="copyFrameItem" role="menuitem">Copy Frame</div>
    <div class="ctx-item" id="browseFrameItem" role="menuitem" style="display:none;">Browse</div>
    <div class="ctx-item" id="homeFrameItem" role="menuitem" style="display:none;">Go to home method</div>
    <div class="ctx-item" id="frameImplItem" role="menuitem" style="display:none;">Implement in…</div>
  </div>
  <div id="varctxmenu" class="ctx-menu" role="menu">
    <div class="ctx-item" id="varInspectItem" role="menuitem">Inspect</div>
  </div>
  <!-- Progress/busy overlay (#9): hidden until a slow server op crosses the delay.
       The Cancel button shows only when the running op is cancellable. -->
  <div id="busyOverlay" class="busy-overlay" style="display:none;" aria-hidden="true">
    <div class="busy-box">
      <div class="busy-spinner"></div>
      <button id="busyCancel" class="busy-cancel" type="button" style="display:none;">Cancel</button>
    </div>
  </div>
  <script nonce="${nonce}">${debuggerViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    DebuggerView.init({
      list: document.getElementById('stack'),
      menu: document.getElementById('ctxmenu'),
      copyFrameItem: document.getElementById('copyFrameItem'),
      browseFrameItem: document.getElementById('browseFrameItem'),
      homeFrameItem: document.getElementById('homeFrameItem'),
      frameImplItem: document.getElementById('frameImplItem'),
      copyBtn: document.getElementById('copyBtn'),
      dumpBtn: document.getElementById('dumpBtn'),
      saveNotice: document.getElementById('saveNotice'),
      savePath: document.getElementById('savePath'),
      copyPathBtn: document.getElementById('copyPathBtn'),
      error: document.getElementById('error'),
      flash: document.getElementById('flash'),
      dnuBar: document.getElementById('dnuBar'),
      toolbar: document.getElementById('toolbar'),
      runToCursorBtn: document.getElementById('runToCursorBtn'),
      variables: document.getElementById('variables'),
      evalInput: document.getElementById('evalInput'),
      evalResult: document.getElementById('evalResult'),
      evalbar: document.getElementById('evalbar'),
      main: document.getElementById('main'),
      splitter: document.getElementById('splitter'),
      hsplitter: document.getElementById('hsplitter'),
      varMenu: document.getElementById('varctxmenu'),
      varInspectItem: document.getElementById('varInspectItem'),
      busyOverlay: document.getElementById('busyOverlay'),
      busyCancel: document.getElementById('busyCancel'),
    }, vscode);
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true; // an in-flight Nb step/trim continuation must skip the dead panel
    if (this.layoutSampler) {
      clearInterval(this.layoutSampler);
      this.layoutSampler = undefined;
    }
    DebuggerPanel.panels.get(this.sessionId)?.delete(this);
    // Release any pinned revert originals so closing the debugger never leaks the
    // session's export set.
    this.clearUndoState();
    // Drop the step-point highlight from the companion editor (which outlives
    // the panel) so a stale highlight doesn't linger after the debugger closes.
    this.decoratedEditor?.setDecorations(DebuggerPanel.stepPointDecoration, []);
    this.decoratedEditor = undefined;
    // Likewise drop the inline-value overlay from the (outliving) source editor.
    this.inlineDecoratedEditor?.setDecorations(DebuggerPanel.inlineValueDecoration, []);
    this.inlineDecoratedEditor = undefined;
    // The source pane is going away — drop its inline-values CodeLens too. (This
    // panel was already removed from `panels` above, so the lens won't re-appear.)
    DebuggerPanel.refreshSourceCodeLenses();
    // Close the companion source editor and any enhanced inspectors this debugger
    // opened — they're artifacts of this debugger and shouldn't outlive it.
    this.closeSourceEditors();
    // Drop this panel's source tabs from the persisted orphan set (it was already
    // removed from `panels` above, so the union now excludes it). A clean dispose
    // thus leaves nothing to reap; only a window-close-with-debugger-open does.
    DebuggerPanel.persistLiveSourceUris();
    for (const inspector of this.openedInspectors) inspector.close();
    this.openedInspectors.clear();
    // Release this panel's stashed read-only source.
    for (const key of this.stashedSourceKeys) DebuggerPanel.readOnlySources.delete(key);
    this.stashedSourceKeys.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    // Closing the panel implicitly terminates the suspended process it owned,
    // releasing the stalled GsProcess on the server (same as dismissing the
    // error notifier). clearStack is best-effort: the session may already be gone.
    debug.clearStack(this.session, this.gsProcess);
  }

  /**
   * Close the companion source tabs this panel opened. A `gemstone://` method is
   * closed ONLY in our own source column — never the user's own copy of the same
   * method open elsewhere (e.g. the System Browser). Our private read-only scheme
   * is unique to this debugger, so it's safe to close in any column. When the
   * source column is unknown we therefore close only the read-only tabs (closing
   * a shared `gemstone://` everywhere would be the very bug the guard prevents).
   */
  private closeSourceEditors(): void {
    if (this.shownSourceUris.size === 0 && this.dnuMethodUris.size === 0) return;
    // The source group's ViewColumn can have been renumbered since we captured
    // it (VS Code reassigns columns positionally when groups open/close — e.g. a
    // enhanced inspector opening Beside). The live source editor reports its CURRENT
    // column, so prefer that; fall back to the captured number.
    const sourceColumn = this.sourceEditor?.viewColumn ?? this.sourceColumn;
    for (const group of vscode.window.tabGroups.all) {
      const inOurColumn = sourceColumn !== undefined && group.viewColumn === sourceColumn;
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) continue;
        const uriStr = tab.input.uri.toString();
        // A DNU template / its compiled method was created BY this debugger, so
        // it's safe to close in ANY column (the FS provider may have swapped the
        // template tab to the compiled method, and possibly into another column).
        if (this.dnuMethodUris.has(uriStr)) {
          void vscode.window.tabGroups.close(tab);
          continue;
        }
        if (!this.shownSourceUris.has(uriStr)) continue;
        if (inOurColumn || tab.input.uri.scheme === READONLY_SOURCE_SCHEME) {
          void vscode.window.tabGroups.close(tab);
        }
      }
    }
    this.shownSourceUris.clear();
    this.dnuMethodUris.clear();
    this.sourceEditor = undefined;
  }
}
