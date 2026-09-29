// @vitest-environment jsdom
/**
 * The evaluate pane's behaviour, on its own, away from either panel that mounts it.
 *
 * The Inspector's evaluate tab and the debugger's evaluate pane used to carry a copy each of the
 * expression-history walk, and the copies drifted: the debugger recorded the TRIMMED expression
 * while leaving the box untrimmed, so the guard that stops the first Ctrl+Up reading as a dead key
 * compared two strings that no longer matched, and a trailing space handed back the expression you
 * had just run. The Inspector's copy happened to record what the box held and was unaffected. That
 * is the shape of bug two copies produce, and it is why this module exists.
 *
 * `evaluatePaneParity.test.ts` asserts the same gestures through BOTH real panels, which is what
 * proves the sharing actually reached them. This file drives the shared module directly, so the
 * edges that are awkward to stage through a panel — a status message cancelled by a clear, a chord
 * abandoned by a blur — are reachable, and a failure names the shared behaviour rather than one
 * panel's wiring.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** What a panel hands the shared pane: the three things the two panels genuinely do differently
 *  (where the box is, where status goes, how an expression reaches the host) and nothing else. */
interface PaneHooks {
  input(): HTMLTextAreaElement | null;
  send(expr: string, mode: string): void;
  syncText(text: string): void;
  showStatus(text: string): void;
  restStatus(): void;
  setChordArmed(armed: boolean): void;
  clearPane(): void;
  escapeWhenEmpty?(): void;
}

interface EvaluatePaneApi {
  keydown(ev: KeyboardEvent): void;
  run(mode: string): void;
  recallPrevious(): void;
  recallNext(): void;
  clear(): void;
  disarm(): void;
  settle(): void;
}

interface EvaluatePaneModule {
  create(hooks: PaneHooks): EvaluatePaneApi;
  applyLabels(root: ParentNode): void;
  modifierLabel(): string;
  chordLabel(): string;
  placeholderHint(): string;
  keyLegend(): string;
  buttonHint(mode: string): string;
  STATUS_MS: number;
}

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../evaluatePane.js'), 'utf8');
  new Function(source)();
});

const EvaluatePane = (): EvaluatePaneModule =>
  (globalThis as unknown as { EvaluatePane: EvaluatePaneModule }).EvaluatePane;

/** A panel reduced to what the shared pane asks of one: a box, a place to say things, and an
 *  outbox. Everything a test wants to know afterwards is recorded rather than drawn. */
function mountPane(hooks: Partial<PaneHooks> = {}) {
  document.body.innerHTML = '<textarea class="eval-input"></textarea>';
  const input = document.querySelector('.eval-input') as HTMLTextAreaElement;
  const sent: { expr: string; mode: string }[] = [];
  const synced: string[] = [];
  const armings: boolean[] = [];
  const surface = { text: '', atRest: true };
  let cleared = 0;
  let escapedEmpty = 0;

  const pane = EvaluatePane().create({
    input: () => input,
    send: (expr, mode) => sent.push({ expr, mode }),
    syncText: (text) => synced.push(text),
    showStatus: (text) => {
      surface.text = text;
      surface.atRest = false;
    },
    restStatus: () => {
      surface.text = '';
      surface.atRest = true;
    },
    setChordArmed: (armed) => armings.push(armed),
    clearPane: () => {
      cleared += 1;
      input.value = '';
    },
    escapeWhenEmpty: () => {
      escapedEmpty += 1;
    },
    ...hooks,
  });

  /** Type into the box the way the user does — the pane reads the live element, never a mirror. */
  const type = (text: string) => {
    input.value = text;
  };
  const press = (key: string, over: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over });
    pane.keydown(ev);
    return ev;
  };

  return {
    pane,
    input,
    sent,
    synced,
    armings,
    surface,
    type,
    press,
    older: () => press('ArrowUp', { ctrlKey: true }),
    newer: () => press('ArrowDown', { ctrlKey: true }),
    clearCount: () => cleared,
    escapedEmptyCount: () => escapedEmpty,
    /** Run `expr` the way a button does, leaving it in the box as a real run does. */
    runFromButton: (expr: string, mode = 'display') => {
      input.value = expr;
      pane.run(mode);
    },
  };
}

describe('walking back through what has been run', () => {
  it('says so when nothing has been run yet, rather than going silent', () => {
    // Silence is indistinguishable from the key not being wired at all, which is how an empty
    // history was read when the panel had only just opened.
    const p = mountPane();
    p.type('1 + 1');

    p.older();

    expect(p.surface.text).toContain('No earlier expression');
    expect(p.input.value).toBe('1 + 1');
  });

  it('steps PAST the expression the run left in the box, so the first press moves', () => {
    const p = mountPane();
    p.runFromButton('first');
    p.runFromButton('second');

    p.older();

    expect(p.input.value).toBe('first');
  });

  it('steps past it even when the box kept the whitespace the run trimmed off', () => {
    // The history holds what was RUN, which is trimmed; the box still holds what was typed. This is
    // the drift that shipped: comparing the two raw missed on a trailing space — easy to leave in a
    // multi-line box — and the first press handed back the expression just run.
    const p = mountPane();
    p.runFromButton('first');
    p.runFromButton('second  \n');

    p.older();

    expect(p.input.value).toBe('first');
  });

  it('recalls the newest when the box is empty, since there is nothing to step past', () => {
    const p = mountPane();
    p.runFromButton('amount * 2');
    p.type('');

    p.older();

    expect(p.input.value).toBe('amount * 2');
  });

  it('walks back one entry per press', () => {
    const p = mountPane();
    for (const expr of ['one', 'two', 'three']) p.runFromButton(expr);

    p.older();
    expect(p.input.value).toBe('two');

    p.older();
    expect(p.input.value).toBe('one');
  });

  it('stops at the oldest rather than emptying the box', () => {
    const p = mountPane();
    p.runFromButton('only');
    p.type('');

    p.older();
    p.older();

    expect(p.input.value).toBe('only');
    expect(p.surface.text).toMatch(/Oldest expression/);
  });

  it('says where in the history the walk is', () => {
    const p = mountPane();
    for (const expr of ['one', 'two', 'three']) p.runFromButton(expr);

    p.older();

    expect(p.surface.text).toMatch(/Earlier 2 of 3/);
  });

  it('names the way back to the draft at the moment it replaces it', () => {
    // The walk replaces what you were typing. Nothing on screen said so or said how to get it back,
    // so the draft looked lost and the walk looked like a one-way trip.
    const p = mountPane();
    p.runFromButton('ran this');
    p.type('half typed');

    p.older();

    expect(p.surface.text).toMatch(/for your draft/);
  });

  it('records what reached the stone, not what was merely typed', () => {
    const p = mountPane();
    p.runFromButton('was run');
    p.type('never run');

    p.older();

    expect(p.input.value).toBe('was run');
  });

  it('gives a repeated expression one entry, not two', () => {
    const p = mountPane();
    p.runFromButton('same');
    p.runFromButton('same');
    p.type('');

    p.older();
    p.older();

    expect(p.input.value).toBe('same');
    expect(p.surface.text).toMatch(/Oldest expression/);
  });
});

describe('stepping forward again', () => {
  it('walks toward the newest, then hands back the draft it interrupted', () => {
    const p = mountPane();
    p.runFromButton('one');
    p.runFromButton('two');
    p.type('half typed');

    p.older();
    expect(p.input.value).toBe('two');
    p.older();
    expect(p.input.value).toBe('one');

    p.newer();
    expect(p.input.value).toBe('two');

    p.newer();
    expect(p.input.value).toBe('half typed');
    expect(p.surface.text).toMatch(/what you were typing/);
  });

  it('does nothing when no walk is in progress', () => {
    const p = mountPane();
    p.runFromButton('ran');
    p.type('untouched');

    p.newer();

    expect(p.input.value).toBe('untouched');
  });

  it('does not walk on past the draft into a second one', () => {
    const p = mountPane();
    p.runFromButton('ran');
    p.type('half typed');
    p.older();
    p.newer();

    p.newer();

    expect(p.input.value).toBe('half typed');
  });
});

describe('a walk ends when the pane is used for something else', () => {
  it('starts again from the newest after another expression is run', () => {
    const p = mountPane();
    p.runFromButton('one');
    p.runFromButton('two');
    p.older(); // -> one
    p.runFromButton('three');

    p.older();

    expect(p.input.value).toBe('two');
  });

  it('starts again from the newest after the box is cleared', () => {
    const p = mountPane();
    p.runFromButton('one');
    p.runFromButton('two');
    p.older(); // -> one

    p.pane.clear();
    p.older();

    expect(p.input.value).toBe('two');
  });
});

describe('putting a recalled expression in the box', () => {
  it('leaves the caret at the end, ready to edit', () => {
    const p = mountPane();
    p.runFromButton('self balance');
    p.type('');

    p.older();

    expect(p.input.selectionStart).toBe('self balance'.length);
    expect(p.input.selectionEnd).toBe('self balance'.length);
  });

  it('keeps the keyboard in the box', () => {
    const p = mountPane();
    p.runFromButton('self balance');
    p.type('');

    p.older();

    expect(document.activeElement).toBe(p.input);
  });

  it('tells the panel what the box now holds, so its own copy keeps up', () => {
    // The Inspector mirrors the expression on its column and re-renders the pane from it; a recall
    // that wrote only to the element would be undone by the next answer landing.
    const p = mountPane();
    p.runFromButton('self balance');
    p.type('');

    p.older();

    expect(p.synced).toContain('self balance');
  });
});

describe('running what is in the box', () => {
  it('sends the expression and the mode the gesture meant', () => {
    const p = mountPane();
    p.type('self balance');

    p.pane.run('inspect');

    expect(p.sent).toEqual([{ expr: 'self balance', mode: 'inspect' }]);
  });

  it('sends it trimmed', () => {
    const p = mountPane();
    p.type('  amount * 2  ');

    p.pane.run('display');

    expect(p.sent.at(-1)?.expr).toBe('amount * 2');
  });

  it('does not spend a round trip on a blank expression', () => {
    const p = mountPane();
    p.type('   \n  ');

    p.pane.run('display');

    expect(p.sent).toHaveLength(0);
  });

  it('hands the keyboard back, because running is not leaving', () => {
    // A button click parks the focus on the button, and the next thing you do is almost always
    // type again — edit the expression, or write the next one.
    const p = mountPane();
    p.type('self balance');
    p.input.blur();

    p.pane.run('display');

    expect(document.activeElement).toBe(p.input);
  });

  it('leaves the box alone, so the expression is there to edit and run again', () => {
    const p = mountPane();
    p.type('self balance');

    p.pane.run('display');

    expect(p.input.value).toBe('self balance');
  });
});

describe('the status surface is borrowed, not taken', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives it back once the message has been read', () => {
    vi.useFakeTimers();
    const p = mountPane();
    p.runFromButton('only');
    p.type('');
    p.older();
    p.older();
    expect(p.surface.atRest).toBe(false);

    vi.advanceTimersByTime(EvaluatePane().STATUS_MS + 1);

    expect(p.surface.atRest).toBe(true);
  });

  it('holds it for the full time again when a second message arrives', () => {
    vi.useFakeTimers();
    const p = mountPane();
    p.runFromButton('one');
    p.runFromButton('two');
    p.type('');

    p.older();
    vi.advanceTimersByTime(EvaluatePane().STATUS_MS - 100);
    p.older();
    vi.advanceTimersByTime(EvaluatePane().STATUS_MS - 100);

    expect(p.surface.atRest).toBe(false);
  });

  it('lets the panel take the surface back outright, for an answer it is about to draw', () => {
    // The debugger draws the answer into the very row the message borrowed. A restore still counting
    // down would put the row's OLD idea of rest back on top of the new answer.
    vi.useFakeTimers();
    const p = mountPane();
    p.runFromButton('only');
    p.type('');
    p.older();
    p.older();

    p.pane.settle();
    vi.advanceTimersByTime(EvaluatePane().STATUS_MS + 1);

    expect(p.surface.atRest).toBe(false);
  });

  it('does not hand a cleared pane a message from before the clear', () => {
    vi.useFakeTimers();
    const p = mountPane();
    p.runFromButton('only');
    p.type('');
    p.older();
    p.older();

    p.pane.clear();
    const restoresAfterClear = p.surface.atRest;
    vi.advanceTimersByTime(EvaluatePane().STATUS_MS + 1);

    // Clearing cancels the pending restore outright: the panel has already put the surface where it
    // wants it, and a timer firing afterwards would overwrite that with the pane's idea of rest.
    expect(restoresAfterClear).toBe(false);
    expect(p.surface.atRest).toBe(false);
  });
});

describe('clearing', () => {
  it('asks the panel to empty its own box and answer', () => {
    const p = mountPane();
    p.type('self balance');

    p.pane.clear();

    expect(p.clearCount()).toBe(1);
  });
});

describe("the editor's own Ctrl+K chord", () => {
  it.each([
    ['d', 'display'],
    ['e', 'execute'],
    ['i', 'inspect'],
  ])('runs %s as %s', (key, mode) => {
    const p = mountPane();
    p.type('self balance');

    p.press('k', { ctrlKey: true });
    p.press(key);

    expect(p.sent.at(-1)).toEqual({ expr: 'self balance', mode });
  });

  it('swallows the closing key rather than typing it into the expression', () => {
    const p = mountPane();
    p.type('self');
    p.press('k', { ctrlKey: true });

    expect(p.press('d').defaultPrevented).toBe(true);
  });

  it('answers to the Mac modifier as readily as the Windows one', () => {
    const p = mountPane();
    p.type('self balance');

    p.press('k', { metaKey: true });
    p.press('e');

    expect(p.sent.at(-1)?.mode).toBe('execute');
  });

  it('types a key that is not one of the three, and costs only the chord', () => {
    // A stray Ctrl+K must cost one keystroke, never a swallowed character.
    const p = mountPane();
    p.type('self');
    p.press('k', { ctrlKey: true });

    const ev = p.press('x');

    expect(ev.defaultPrevented).toBe(false);
    expect(p.sent).toHaveLength(0);
    expect(p.armings.at(-1)).toBe(false);
  });

  it('drops a half-typed chord when Escape cancels it, leaving the expression alone', () => {
    const p = mountPane();
    p.type('self balance');
    p.press('k', { ctrlKey: true });

    p.press('Escape');

    expect(p.armings.at(-1)).toBe(false);
    expect(p.input.value).toBe('self balance');
    expect(p.clearCount()).toBe(0);
  });

  it('drops a half-typed chord when the focus leaves the box', () => {
    const p = mountPane();
    p.press('k', { ctrlKey: true });
    expect(p.armings.at(-1)).toBe(true);

    p.pane.disarm();

    expect(p.armings.at(-1)).toBe(false);
  });

  it('says nothing to the panel when a disarm has nothing to disarm', () => {
    // The Inspector redraws its chord hint from this, and the hint may be showing a walk message —
    // an unasked-for disarm would wipe it.
    const p = mountPane();

    p.pane.disarm();

    expect(p.armings).toHaveLength(0);
  });
});

describe('the keys the box answers to', () => {
  it('runs Display It on Shift+Enter', () => {
    const p = mountPane();
    p.type('self balance');

    const ev = p.press('Enter', { shiftKey: true });

    expect(p.sent.at(-1)?.mode).toBe('display');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('runs Display It on Ctrl+Enter, for anyone who reached for that first', () => {
    const p = mountPane();
    p.type('self balance');

    p.press('Enter', { ctrlKey: true });

    expect(p.sent.at(-1)?.mode).toBe('display');
  });

  it('leaves plain Enter to type a newline, which is the point of a multi-line box', () => {
    const p = mountPane();
    p.type('| t |');

    const ev = p.press('Enter');

    expect(p.sent).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves the bare arrows to move the caret', () => {
    // The box is multi-line, so Up and Down have to go on doing what they do in any editor; the
    // walk is on the modified pair for exactly that reason.
    const p = mountPane();
    p.runFromButton('ran this');
    p.type('line one\nline two');

    const up = p.press('ArrowUp');
    const down = p.press('ArrowDown');

    expect(up.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(p.input.value).toBe('line one\nline two');
  });

  it('takes the walk on either modifier, and keeps the key from the box', () => {
    const p = mountPane();
    p.runFromButton('ran this');
    p.type('');

    const up = p.press('ArrowUp', { metaKey: true });

    expect(p.input.value).toBe('ran this');
    expect(up.defaultPrevented).toBe(true);
  });

  it('clears the box on Escape when there is something in it', () => {
    const p = mountPane();
    p.type('self balance');

    p.press('Escape');

    expect(p.clearCount()).toBe(1);
    expect(p.escapedEmptyCount()).toBe(0);
  });

  it('hands Escape to the panel when the box is already empty', () => {
    // The debugger's pane closes on that second Escape, the way the list filters do; the
    // Inspector's is a tab with no closed state and supplies nothing.
    const p = mountPane();
    p.type('');

    p.press('Escape');

    expect(p.escapedEmptyCount()).toBe(1);
    expect(p.clearCount()).toBe(0);
  });

  it('does nothing on an empty-box Escape a panel has no answer for', () => {
    const p = mountPane({ escapeWhenEmpty: undefined });
    p.type('');

    expect(() => p.press('Escape')).not.toThrow();
  });
});

describe('a pane whose box is not in the DOM', () => {
  /**
   * Both panels look their box up live — the Inspector re-renders the tab on every answer, and the
   * debugger's pane can be collapsed — so every gesture has to survive being asked while there is
   * no box to act on.
   */
  const missing = { input: () => null };

  it('recalls nothing rather than throwing', () => {
    const p = mountPane(missing);

    expect(() => p.older()).not.toThrow();
    expect(p.surface.text).toBe('');
  });

  it('runs nothing rather than sending an empty expression', () => {
    const p = mountPane(missing);

    p.pane.run('display');

    expect(p.sent).toHaveLength(0);
  });
});

describe('the wording of the keys, in one place for both panes', () => {
  /**
   * jsdom serves `navigator.platform` off the prototype, so there is no OWN descriptor to put back
   * and a naive restore leaves the override in place for every later test — including ones in other
   * files, since the suite shares the environment and runs in a shuffled order. Delete the override
   * instead, and the prototype's value shows through again.
   */
  const asPlatform = (platform: string, body: () => void) => {
    const own = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    try {
      body();
    } finally {
      if (own) Object.defineProperty(window.navigator, 'platform', own);
      else delete (window.navigator as { platform?: string }).platform;
    }
  };

  it('writes Cmd on a Mac and Ctrl everywhere else', () => {
    asPlatform('MacIntel', () => {
      expect(EvaluatePane().modifierLabel()).toBe('Cmd');
      expect(EvaluatePane().chordLabel()).toBe('Cmd+K');
    });
    asPlatform('Win32', () => {
      expect(EvaluatePane().modifierLabel()).toBe('Ctrl');
      expect(EvaluatePane().chordLabel()).toBe('Ctrl+K');
    });
  });

  it('names every key the pane answers to in the legend', () => {
    asPlatform('Win32', () => {
      const legend = EvaluatePane().keyLegend();

      expect(legend).toMatch(/Shift\+Enter/);
      expect(legend).toMatch(/Ctrl\+K then D \/ E \/ I/);
      expect(legend).toMatch(/Ctrl\+↑ \/ Ctrl\+↓/);
      expect(legend).toMatch(/Escape/);
    });
  });

  it('keeps the placeholder short enough not to make the box scroll sideways', () => {
    // A placeholder wider than the field made the debugger's one-line box scroll horizontally, and
    // the scrollbar ate most of a 1.9rem box — so a pane nobody had touched looked broken.
    expect(EvaluatePane().placeholderHint().length).toBeLessThanOrEqual(24);
    expect(EvaluatePane().placeholderHint()).toMatch(/Shift\+Enter/);
  });

  it('names the run key on Display It, and the chord on the other two', () => {
    asPlatform('Win32', () => {
      expect(EvaluatePane().buttonHint('display')).toBe('Shift+Enter, Ctrl+K D, or Ctrl+Enter');
      expect(EvaluatePane().buttonHint('execute')).toBe('Ctrl+K E');
      expect(EvaluatePane().buttonHint('inspect')).toBe('Ctrl+K I');
    });
  });
});

describe('installing that wording on a pane', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pane">
        <textarea class="eval-input"></textarea>
        <span class="eval-hint"></span>
        <button data-eval="display"></button>
        <button data-eval="execute"></button>
        <button data-eval="inspect"></button>
        <button data-eval-clear="1" title="Clear"></button>
      </div>`;
  });

  const pane = () => document.getElementById('pane')!;
  const titleOf = (selector: string) =>
    (pane().querySelector(selector) as HTMLElement).getAttribute('title') ?? '';

  it('puts the short hint in the box and the full legend on its tooltip', () => {
    EvaluatePane().applyLabels(pane());

    const box = pane().querySelector('.eval-input') as HTMLTextAreaElement;
    expect(box.placeholder).toBe(EvaluatePane().placeholderHint());
    expect(box.title).toBe(EvaluatePane().keyLegend());
  });

  it('puts the run key on each of the three buttons', () => {
    EvaluatePane().applyLabels(pane());

    expect(titleOf('[data-eval="display"]')).toBe(EvaluatePane().buttonHint('display'));
    expect(titleOf('[data-eval="execute"]')).toBe(EvaluatePane().buttonHint('execute'));
    expect(titleOf('[data-eval="inspect"]')).toBe(EvaluatePane().buttonHint('inspect'));
  });

  it('puts the legend on a chord-hint line as well, where a pane has one', () => {
    EvaluatePane().applyLabels(pane());

    expect(titleOf('.eval-hint')).toBe(EvaluatePane().keyLegend());
  });

  it('leaves the clear button alone — it is not one of the three', () => {
    EvaluatePane().applyLabels(pane());

    expect(titleOf('[data-eval-clear]')).toBe('Clear');
  });

  it('labels a pane that has no chord-hint line of its own', () => {
    // The debugger advertises the chord on tooltips only; the Inspector has a hint line as well.
    pane().querySelector('.eval-hint')!.remove();

    expect(() => EvaluatePane().applyLabels(pane())).not.toThrow();
  });
});
