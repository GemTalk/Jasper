// @vitest-environment jsdom
/**
 * The Inspector's evaluate tab and the debugger's evaluate pane, gesture by gesture.
 *
 * The two panes have drifted: the same gesture does different things depending on which one you are
 * in, and neither is a superset of the other. The wanted end state is one evaluate-pane UX, so what
 * you learn in one panel transfers to the other. See the "Make the Inspector's and the debugger's
 * evaluate panes behave the same way" item in https://github.com/GemTalk/Jasper/issues/622.
 *
 * Both views are evaluated in jsdom exactly as their webviews inject them, and each is wrapped in
 * the same small adapter (`Pane`), so every behaviour below is asserted against BOTH panes from one
 * `it.each`. A divergence therefore shows up as the same expectation passing for one pane and
 * failing for the other, which is the shape of the complaint. The adapter normalises only the
 * plumbing the two panels legitimately do not share — the Inspector posts `evaluate` with a column
 * and an oop, the debugger posts `evalInFrame` with a stack level — so what is compared is "the pane
 * ran Display It", not a message name.
 *
 * The debugger's evaluate pane is mounted from `evaluatePaneHtml()` — the SAME markup the panel
 * ships — so a control that is renamed, dropped, or never wired fails here rather than passing
 * against a hand-copied DOM the panel no longer emits. The Inspector's pane is opened through the
 * real view, which renders its own.
 *
 * Three gaps run the other way — the Inspector is the one missing something — and a fourth is
 * missing from both. They are all here rather than only the reported direction, because "one UX"
 * has to settle each of them and a fix aimed at only the debugger would leave the rest.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { evaluatePaneHtml } from '../debuggerEvalPane';

beforeAll(() => {
  for (const file of [
    '../debuggerView.js',
    '../webview/millerColumns.js',
    '../basicInspector/basicInspectorView.js',
  ]) {
    new Function(fs.readFileSync(path.resolve(__dirname, file), 'utf8'))();
  }
});

/** What every evaluate pane must be able to do, however its own panel spells it. */
interface Pane {
  /** The expression box itself, so a test can read back what a gesture typed into it. */
  input: HTMLInputElement | HTMLTextAreaElement;
  /** Type `text` into the box the way the user does, firing the `input` the view listens for. */
  type(text: string): void;
  press(key: string, over?: KeyboardEventInit): KeyboardEvent;
  /** Press the pane's Display It / Execute It / Inspect It button. */
  click(mode: string): void;
  /** The editor's own Ctrl+K chord: `Ctrl+K` then the closing key. */
  chord(key: string): void;
  /** The mode of the last expression the pane asked the host to run, or undefined if it asked for
   *  nothing — normalised across the two panels' different message shapes. */
  lastRun(): string | undefined;
  /** How many runs the pane has asked for in total. */
  runCount(): number;
  /** Deliver a host answer, as the panel does when the stone replies. */
  answer(text: string, isError?: boolean): void;
  /** The element the answer is shown in. */
  resultEl(): HTMLElement;
  /** The pane's ✕ clear control. */
  clearBtn(): HTMLElement;
  /** The element that would carry the answer's error styling. */
  isErrorShown(): boolean;
  /** The pane's own root, for asking what controls it offers. */
  root(): HTMLElement;
  /** Whatever the pane is currently saying about the last keystroke — its own status surface. */
  status(): string;
  /** Ctrl+Up — step back through what has been run. */
  older(): void;
  /** Ctrl+Down — step forward again, and past the newest back to the draft. */
  newer(): void;
  /** Shift+Enter — Display It. */
  runKey(): void;
}

// ── the debugger's evaluate pane ────────────────────────────────────────────

interface DebuggerViewApi {
  init(refs: Record<string, unknown>, vscode: { postMessage: (m: unknown) => void }): unknown;
}

function debuggerPane(): Pane {
  document.body.innerHTML = `
    <button id="copyBtn"></button>
    <div id="toolbar"></div>
    <div id="error"></div>
    <div class="main"><ul id="stack"></ul><div id="variables"></div></div>
    ${evaluatePaneHtml()}
    <div id="ctxmenu"><div id="copyFrameItem"></div><div id="frameEvalItem"></div></div>
    <div id="varctxmenu"><div id="varInspectItem"></div></div>`;
  document.body.classList.remove('eval-collapsed');
  const el = (id: string) => document.getElementById(id)!;
  const posted: Record<string, unknown>[] = [];
  const api = (globalThis as unknown as { DebuggerView: DebuggerViewApi }).DebuggerView;
  api.init(
    {
      list: el('stack'),
      menu: el('ctxmenu'),
      copyFrameItem: el('copyFrameItem'),
      frameEvalItem: el('frameEvalItem'),
      copyBtn: el('copyBtn'),
      error: el('error'),
      toolbar: el('toolbar'),
      variables: el('variables'),
      evalInput: el('evalInput'),
      evalResult: el('evalResult'),
      evalToggle: el('evalToggle'),
      evalClear: el('evalClear'),
      evalbar: el('evalbar'),
      evalToolbar: el('evalToolbar'),
      varMenu: el('varctxmenu'),
      varInspectItem: el('varInspectItem'),
    },
    { postMessage: (m: unknown) => posted.push(m as Record<string, unknown>) },
  );
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        command: 'init',
        stack: [{ level: 1, label: 'Account>>deposit:', position: '@2 line 3' }],
      },
    }),
  );
  posted.length = 0;
  const input = el('evalInput') as HTMLTextAreaElement;
  const runs = () => posted.filter((m) => m.command === 'evalInFrame');
  const press = (key: string, over: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over });
    input.dispatchEvent(ev);
    return ev;
  };
  return {
    input,
    type(text) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    press,
    click(mode) {
      (document.querySelector(`[data-eval="${mode}"]`) as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    },
    chord(key) {
      press('k', { ctrlKey: true });
      press(key);
    },
    // Bare Enter is the debugger's own way to run, and it carries no mode; treat it as Display It,
    // which is what it does (it shows the answer in the result row).
    lastRun: () => {
      const last = runs().at(-1);
      return last ? ((last.mode as string) ?? 'display') : undefined;
    },
    runCount: () => runs().length,
    answer(text, isError = false) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { command: 'evalResult', value: text, isError },
        }),
      );
    },
    resultEl: () => el('evalResult'),
    clearBtn: () => el('evalClear'),
    isErrorShown: () => el('evalResult').classList.contains('error'),
    root: () => el('evalbar'),
    status: () => el('evalResult').textContent ?? '',
    older: () => press('ArrowUp', { ctrlKey: true }),
    newer: () => press('ArrowDown', { ctrlKey: true }),
    runKey: () => press('Enter', { shiftKey: true }),
  };
}

// ── the Inspector's evaluate tab ────────────────────────────────────────────

interface InspectorColumn {
  el: { root: HTMLElement; contentPane: HTMLElement };
}
interface InspectorView {
  columns: { get(id: number): InspectorColumn | undefined };
  handleHostMessage(msg: Record<string, unknown>): void;
}

function inspectorPane(): Pane {
  document.body.innerHTML =
    '<div id="strip"></div>' +
    '<div id="ctx" class="ctx-menu"><div class="ctx-item" data-action="inspect"></div></div>' +
    '<div id="methodCtx" class="ctx-menu"><div class="ctx-item" data-action="browseMethod"></div></div>';
  Element.prototype.scrollIntoView = vi.fn();
  const posted: Record<string, unknown>[] = [];
  const view = (
    globalThis as unknown as { BasicInspectorView: { init(o: unknown): InspectorView } }
  ).BasicInspectorView.init({
    strip: document.getElementById('strip'),
    ctxMenu: document.getElementById('ctx'),
    methodCtxMenu: document.getElementById('methodCtx'),
    vscode: { postMessage: (m: Record<string, unknown>) => posted.push(m) },
    pageSize: 100,
    defaultColumnWidth: 340,
    minColumnWidth: 280,
  });
  view.handleHostMessage({
    command: 'addRoot',
    columnId: 0,
    oop: '100',
    label: 'anAccount',
    header: {
      className: 'Account',
      superclassName: 'Object',
      namedSize: 0,
      itemCount: 0,
      entryCount: 0,
      isBytes: false,
      byteSize: 0,
      isDictionary: false,
      printString: 'an Account',
      sizeUnit: '',
    },
  });
  const col = view.columns.get(0)!;
  (col.el.root.querySelector('[data-tab="eval"]') as HTMLElement).click();
  // The pane is re-rendered on a result, so the live textarea is looked up each time rather than
  // captured once.
  const box = () => col.el.contentPane.querySelector('.eval-input') as HTMLTextAreaElement;
  const runs = () => posted.filter((m) => m.command === 'evaluate');
  const press = (key: string, over: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over });
    box().dispatchEvent(ev);
    return ev;
  };
  return {
    get input() {
      return box();
    },
    type(text) {
      const input = box();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    press,
    click(mode) {
      (col.el.contentPane.querySelector(`[data-eval="${mode}"]`) as HTMLElement).click();
    },
    chord(key) {
      press('k', { ctrlKey: true });
      press(key);
    },
    lastRun: () => runs().at(-1)?.mode as string | undefined,
    runCount: () => runs().length,
    answer(text, isError = false) {
      view.handleHostMessage({
        command: 'evalResult',
        columnId: 0,
        ok: !isError,
        text,
      });
    },
    resultEl: () => col.el.contentPane.querySelector('.eval-out') as HTMLElement,
    clearBtn: () => col.el.contentPane.querySelector('[data-eval-clear]') as HTMLElement,
    isErrorShown: () =>
      (col.el.contentPane.querySelector('.eval-out') as HTMLElement).classList.contains('error'),
    root: () => col.el.contentPane.querySelector('.eval') as HTMLElement,
    status: () =>
      (col.el.contentPane.querySelector('.eval-hint') as HTMLElement)?.textContent ?? '',
    older: () => press('ArrowUp', { ctrlKey: true }),
    newer: () => press('ArrowDown', { ctrlKey: true }),
    runKey: () => press('Enter', { shiftKey: true }),
  };
}

const PANES: [string, () => Pane][] = [
  ['the Inspector', inspectorPane],
  ['the debugger', debuggerPane],
];

// ── the parity itself ───────────────────────────────────────────────────────

describe('running the expression from a button', () => {
  it.each(PANES)('%s runs Display It from its button', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.click('display');

    expect(pane.lastRun()).toBe('display');
  });

  it.each(PANES)('%s runs Execute It from its button', (_name, open) => {
    const pane = open();
    pane.type('self commit');

    pane.click('execute');

    expect(pane.lastRun()).toBe('execute');
  });

  it.each(PANES)('%s runs Inspect It from its button', (_name, open) => {
    const pane = open();
    pane.type('self class');

    pane.click('inspect');

    expect(pane.lastRun()).toBe('inspect');
  });

  it.each(PANES)('%s does not run a blank expression from a button', (_name, open) => {
    const pane = open();
    pane.type('   ');

    pane.click('display');

    expect(pane.runCount()).toBe(0);
  });
});

describe('Shift+Enter runs, plain Enter does not', () => {
  it.each(PANES)('%s runs Display It on Shift+Enter', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.runKey();

    expect(pane.lastRun()).toBe('display');
  });

  it.each(PANES)('%s leaves plain Enter alone, so a second line can be typed', (_name, open) => {
    // The box is multi-line in both panes now. A pane where Enter runs has no way to type a
    // newline, which is why Shift+Enter took the job over from the debugger's bare Enter.
    const pane = open();
    pane.type('| t |');

    const ev = pane.press('Enter');

    expect(pane.runCount()).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  it.each(PANES)('%s does not run a blank expression on Shift+Enter', (_name, open) => {
    const pane = open();
    pane.type('   ');

    pane.runKey();

    expect(pane.runCount()).toBe(0);
  });
});

describe('stepping forward again with Ctrl+Down', () => {
  it.each(PANES)('%s walks back toward what was typed', (_name, open) => {
    const pane = open();
    pane.type('one');
    pane.click('display');
    pane.type('two');
    pane.click('display');

    pane.older(); // -> one
    expect(pane.input.value).toBe('one');

    pane.newer(); // -> two
    expect(pane.input.value).toBe('two');
  });

  it.each(PANES)('%s gives back the draft it interrupted', (_name, open) => {
    // Walking away from a half-typed expression must not lose it — the walk is a detour, not a
    // replacement for what you were writing.
    const pane = open();
    pane.type('ran this');
    pane.click('display');
    pane.type('half typed');

    pane.older();
    expect(pane.input.value).toBe('ran this');

    pane.newer();
    expect(pane.input.value).toBe('half typed');
  });

  /**
   * The walk replaces what you were typing, and nothing on screen said so or said how to get it
   * back — so the draft looked lost and the walk looked like a one-way trip. "I don't see a way to
   * return to my half-typed one" was the report; the mechanism was there and unannounced.
   */
  it.each(PANES)('%s names the way back to the draft while walking', (_name, open) => {
    const pane = open();
    pane.type('ran this');
    pane.click('display');
    pane.type('half typed');

    pane.older();

    expect(pane.status()).toMatch(/for your draft/);
  });

  it.each(PANES)('%s says where in the history you are', (_name, open) => {
    const pane = open();
    for (const expr of ['one', 'two', 'three']) {
      pane.type(expr);
      pane.click('display');
    }

    pane.older();

    expect(pane.status()).toMatch(/Earlier 2 of 3/);
  });

  it.each(PANES)('%s says so when the draft comes back', (_name, open) => {
    const pane = open();
    pane.type('ran this');
    pane.click('display');
    pane.type('half typed');
    pane.older();

    pane.newer();

    expect(pane.input.value).toBe('half typed');
    expect(pane.status()).toMatch(/what you were typing/);
  });

  it.each(PANES)('%s does nothing when no walk is in progress', (_name, open) => {
    const pane = open();
    pane.type('untouched');

    pane.newer();

    expect(pane.input.value).toBe('untouched');
  });
});

describe("the editor's own Ctrl+K chord", () => {
  it.each(PANES)('%s runs Display It on Ctrl+K D', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.chord('d');

    expect(pane.lastRun()).toBe('display');
  });

  it.each(PANES)('%s runs Execute It on Ctrl+K E', (_name, open) => {
    const pane = open();
    pane.type('self commit');

    pane.chord('e');

    expect(pane.lastRun()).toBe('execute');
  });

  it.each(PANES)('%s runs Inspect It on Ctrl+K I', (_name, open) => {
    const pane = open();
    pane.type('self class');

    pane.chord('i');

    expect(pane.lastRun()).toBe('inspect');
  });

  it.each(PANES)('%s swallows the chord’s closing key rather than typing it', (_name, open) => {
    const pane = open();
    pane.type('self');

    pane.press('k', { ctrlKey: true });

    expect(pane.press('d').defaultPrevented).toBe(true);
  });

  it.each(PANES)('%s runs Display It on Ctrl+Enter', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.press('Enter', { ctrlKey: true });

    expect(pane.lastRun()).toBe('display');
  });
});

describe('going back to a previous expression', () => {
  /**
   * Ctrl+Up / Ctrl+Down, driven the way they are actually used: running an expression LEAVES it in
   * the box, so these must not clear the box first. Clearing is what let a first press that did
   * nothing ship — it stepped to the newest entry, which was the text already on screen, and read as
   * a dead key. Tests that cleared the box exercised the mechanism and missed the gesture.
   *
   * MODIFIED arrows rather than bare ones, because the box is multi-line and bare Up/Down have to go
   * on moving the caret.
   */
  it.each(PANES)(
    '%s moves on the FIRST press, with the box left as the run left it',
    (_name, open) => {
      const pane = open();
      pane.type('first');
      pane.click('display');
      pane.type('second');
      pane.click('display');
      expect(pane.input.value).toBe('second'); // the run leaves it there

      pane.older();

      expect(pane.input.value).toBe('first');
    },
  );

  it.each(PANES)('%s walks back one per press', (_name, open) => {
    const pane = open();
    for (const expr of ['one', 'two', 'three']) {
      pane.type(expr);
      pane.click('display');
    }

    pane.older();
    expect(pane.input.value).toBe('two');

    pane.older();
    expect(pane.input.value).toBe('one');
  });

  it.each(PANES)('%s recalls the newest when the box was cleared', (_name, open) => {
    // Nothing on screen to step past, so the newest entry IS the move.
    const pane = open();
    pane.type('amount * 2');
    pane.click('display');
    pane.type('');

    pane.older();

    expect(pane.input.value).toBe('amount * 2');
  });

  it.each(PANES)('%s says so when there is nothing to go back to', (_name, open) => {
    // A pane just opened has run nothing, so there is no history. Doing nothing silently is
    // indistinguishable from the key not being wired — which is how it was read.
    const pane = open();
    pane.type('1 + 1');

    pane.older();

    expect(pane.status()).toContain('No earlier expression');
    expect(pane.input.value).toBe('1 + 1'); // and it does not eat what you typed
  });

  it.each(PANES)(
    '%s stops at the oldest expression rather than emptying the box',
    (_name, open) => {
      const pane = open();
      pane.type('only');
      pane.click('display');
      pane.type('');

      pane.older();
      pane.older();

      expect(pane.input.value).toBe('only');
    },
  );

  it.each(PANES)('%s recalls what was run, not what was merely typed', (_name, open) => {
    const pane = open();
    pane.type('was run');
    pane.click('display');
    // Typed, thought better of, and abandoned — the history is of what reached the stone.
    pane.type('never run');

    pane.older();

    expect(pane.input.value).toBe('was run');
  });
});

describe('a status message is transient, and gives the row back', () => {
  /**
   * Both panes borrow a surface to say things that are not results — "Oldest expression", "Back to
   * what you were typing". Both must give it back: the Inspector's chord-hint line returns to the
   * chord legend, and the debugger's result row returns to the ANSWER, which it was otherwise
   * destroying — walking to the end of the history threw away the printString you were reading,
   * which is a steep price for a navigation message.
   */
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(PANES)('%s shows the message straight away', (_name, open) => {
    const pane = open();
    pane.type('only');
    pane.click('display');

    pane.older();
    pane.older();

    expect(pane.status()).toMatch(/Oldest expression/);
  });

  it.each(PANES)('%s returns to rest after the message', (_name, open) => {
    vi.useFakeTimers();
    const pane = open();
    pane.type('only');
    pane.click('display');
    pane.answer('42');
    pane.older();
    pane.older();
    expect(pane.status()).toMatch(/Oldest expression/);

    vi.advanceTimersByTime(2000);

    expect(pane.status()).not.toMatch(/Oldest expression/);
  });

  it('the debugger gets its answer back rather than losing it', () => {
    vi.useFakeTimers();
    const pane = debuggerPane();
    pane.type('1 + 1');
    pane.click('display');
    pane.answer('2');
    expect(pane.status()).toBe('2');

    pane.older();
    pane.older();
    vi.advanceTimersByTime(2000);

    expect(pane.status()).toBe('2');
  });
});

describe('clearing', () => {
  it.each(PANES)('%s empties the expression when ✕ is pressed', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.clearBtn().click();

    expect(pane.input.value).toBe('');
  });

  it.each(PANES)('%s drops the previous answer along with the expression', (_name, open) => {
    const pane = open();
    pane.type('self balance');
    pane.click('display');
    pane.answer('42');

    pane.clearBtn().click();

    // An answer that outlives its expression reads as the answer to whatever is typed next.
    expect(pane.resultEl().textContent).toBe('');
  });

  it.each(PANES)('%s empties the expression on Escape', (_name, open) => {
    const pane = open();
    pane.type('self balance');

    pane.press('Escape');

    expect(pane.input.value).toBe('');
  });
});

describe('running does not take the keyboard away', () => {
  /**
   * The next thing you do after running is almost always type again — edit the expression, or write
   * the next one. A run that parks the focus somewhere else makes the pane feel like a form you
   * submit rather than a place you work.
   */
  it.each(PANES)('%s keeps the caret in the box after Shift+Enter', (_name, open) => {
    const pane = open();
    pane.type('self balance');
    pane.input.focus();

    pane.runKey();

    expect(document.activeElement).toBe(pane.input);
  });

  it.each(PANES)('%s hands the focus back after a button run', (_name, open) => {
    // Clicking parks the focus on the button; typing would then go nowhere useful.
    const pane = open();
    pane.type('self balance');

    pane.click('display');

    expect(document.activeElement).toBe(pane.input);
  });

  it.each(PANES)('%s still has the caret in the box once the answer lands', (_name, open) => {
    // The Inspector used to re-render the whole pane here, swapping the textarea out from under
    // the user and taking the caret with it.
    const pane = open();
    pane.type('self class name');
    pane.runKey();

    pane.answer("'Account'");

    expect(document.activeElement).toBe(pane.input);
    expect(pane.input.value).toBe('self class name');
  });
});

describe('showing the answer', () => {
  it.each(PANES)('%s shows what the expression answered', (_name, open) => {
    const pane = open();
    pane.type('self class name');
    pane.click('display');

    pane.answer("'Account'");

    expect(pane.resultEl().textContent).toBe("'Account'");
  });

  it.each(PANES)('%s marks a failed evaluation as an error', (_name, open) => {
    const pane = open();
    pane.type('self nope');
    pane.click('display');

    pane.answer('doesNotUnderstand: #nope', true);

    expect(pane.isErrorShown()).toBe(true);
  });

  it.each(PANES)('%s does not mark a successful evaluation as an error', (_name, open) => {
    const pane = open();
    pane.type('self class name');
    pane.click('display');

    pane.answer("'Account'");

    expect(pane.isErrorShown()).toBe(false);
  });
});

describe('typing an expression that needs more than one line', () => {
  it.each(PANES)('%s accepts a multi-line expression', (_name, open) => {
    const pane = open();
    const expr = '| t |\nt := self balance.\nt * 2';

    pane.type(expr);
    pane.click('display');

    expect(pane.input.value).toBe(expr);
    expect(pane.runCount()).toBe(1);
  });
});

describe('the pane says which keys it answers to, without spending layout on it', () => {
  /**
   * Both panes are squeezed — the debugger's into a panel always short of height, the Inspector's
   * into a column beside the miller strip — so the guidance has to be free. The placeholder occupies
   * space the empty box was spending on nothing and vanishes as you type; the rest rides on tooltips.
   * No row, no legend bar, nothing added to the layout.
   */
  it.each(PANES)('%s names the run key in its placeholder', (_name, open) => {
    const pane = open();

    expect(pane.input.getAttribute('placeholder') ?? '').toMatch(/Shift\+Enter/);
  });

  it.each(PANES)('%s keeps the placeholder short enough not to overflow the box', (_name, open) => {
    // A placeholder wider than the field made the debugger's one-line box scroll SIDEWAYS, and the
    // scrollbar ate most of a 1.9rem box — so a pane nobody had touched looked broken. The rest of
    // the legend belongs on the tooltip, which cannot overflow.
    const pane = open();

    expect((pane.input.getAttribute('placeholder') ?? '').length).toBeLessThanOrEqual(24);
  });

  it.each(PANES)('%s carries the full key legend on the box’s tooltip', (_name, open) => {
    const pane = open();
    const legend = pane.input.getAttribute('title') ?? '';

    expect(legend).toMatch(/Shift\+Enter/);
    expect(legend).toMatch(/\u2191/);
    expect(legend).toMatch(/\u2193/);
    expect(legend).toMatch(/Escape/);
  });

  it.each(PANES)('%s stops advertising the key that no longer runs anything', (_name, open) => {
    // The debugger's placeholder said "Enter" until Shift+Enter took the job over; a hint that
    // names a dead key is worse than none, because it is the one thing the user will try first.
    const pane = open();

    expect(pane.input.getAttribute('placeholder') ?? '').not.toMatch(/(^|[^+])\bEnter\b/);
  });

  it.each(PANES)('%s puts the run key on the Display It button too', (_name, open) => {
    const pane = open();
    const btn = pane.root().querySelector('[data-eval="display"]') as HTMLElement;

    expect(btn.getAttribute('title') ?? '').toMatch(/Shift\+Enter/);
  });
});

describe('what the debugger’s row puts where', () => {
  /**
   * Reading order, not just presence. The expression and its answer are the pair you READ, so they
   * sit together; the buttons are what you reach for, and reaching tolerates distance in a way
   * reading does not. Adding the toolbar pushed the answer to the far end of the row — a full
   * button-set away from the expression that produced it — which is easy to do again, hence a test
   * on the order rather than only on the parts.
   */
  it('puts the answer beside the expression, ahead of the buttons', () => {
    document.body.innerHTML = evaluatePaneHtml();
    const row = document.getElementById('evalbar')!;
    const order = Array.from(row.children).map((c) => c.id || c.className);

    const box = order.findIndex((c) => c.includes('eval-input-wrap'));
    const answer = order.indexOf('evalResult');
    const buttons = order.indexOf('evalToolbar');

    expect(box).toBeGreaterThanOrEqual(0);
    expect(answer).toBeGreaterThan(box);
    expect(buttons).toBeGreaterThan(answer);
  });
});

describe('the pane is there on demand, not unconditionally', () => {
  it.each(PANES)('%s offers Evaluate as a lower tab', (_name, open) => {
    open();

    // A tab the user picks — not a bar that is merely collapsed.
    expect(document.querySelector('[data-tab="eval"]')).not.toBeNull();
  });
});
