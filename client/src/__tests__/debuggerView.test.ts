// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate debuggerView.js in jsdom so it registers the global DebuggerView,
// exactly as the webview does when it injects the file as a <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../debuggerView.js'), 'utf8');
  new Function(source)();
});

interface FrameSummary {
  level: number;
  label: string;
  position: string;
  overridable?: boolean;
  receiverClass?: string;
  breakable?: boolean;
  browsable?: boolean;
  homeDisplayLevel?: number;
}

interface DebuggerViewApi {
  renderStack(listEl: HTMLElement, stack: FrameSummary[]): void;
  renderVariables(
    varsEl: HTMLElement,
    groups: {
      title: string;
      kind: string;
      collapsed?: boolean;
      vars: {
        name: string;
        value: string;
        oop: string;
        edit?: { kind: string; index: number };
        revertible?: boolean;
      }[];
    }[],
    handlers?: {
      contextMenu?: (e: Event, oop: string, name: string) => void;
      commit?: (edit: { kind: string; index: number }, expr: string) => void;
      revert?: (edit: { kind: string; index: number }) => void;
      setActiveEditor?: (ctrl: unknown) => void;
    },
  ): void;
  renderDnu(
    dnuBarEl: HTMLElement,
    dnu: { selector: string; className: string; isMeta: boolean } | null | undefined,
    onCreate?: () => void,
  ): void;
  renderSubclassResp(
    dnuBarEl: HTMLElement,
    sr: { selector: string } | null | undefined,
    onImplement?: () => void,
  ): void;
  selectFrame(listEl: HTMLElement, level: number): HTMLElement | null;
  showMenu(menuEl: HTMLElement, x: number, y: number): void;
  hideMenu(menuEl: HTMLElement): void;
  frameLevelOf(target: Element | null): number | null;
  init(
    refs: Refs,
    vscode: {
      postMessage: (m: unknown) => void;
      getState?: () => unknown;
      setState?: (s: unknown) => void;
    },
  ): {
    selectedLevel(): number | null;
    select(level: number): void;
  };
}

interface Refs {
  list: HTMLElement;
  menu: HTMLElement;
  copyFrameItem: HTMLElement;
  browseFrameItem?: HTMLElement;
  homeFrameItem?: HTMLElement;
  frameImplItem?: HTMLElement;
  copyBtn: HTMLElement;
  dumpBtn?: HTMLElement;
  saveNotice?: HTMLElement;
  savePath?: HTMLElement;
  copyPathBtn?: HTMLElement;
  error: HTMLElement;
  flash?: HTMLElement;
  dnuBar?: HTMLElement;
  toolbar: HTMLElement;
  runToCursorBtn?: HTMLButtonElement;
  variables: HTMLElement;
  evalInput: HTMLInputElement;
  evalResult: HTMLElement;
  evalToggle?: HTMLElement;
  evalClear?: HTMLElement;
  evalbar?: HTMLElement;
  frameEvalItem?: HTMLElement;
  main?: HTMLElement;
  splitter?: HTMLElement;
  varMenu?: HTMLElement;
  varInspectItem?: HTMLElement;
  busyOverlay?: HTMLElement;
  busyCancel?: HTMLElement;
}

function api(): DebuggerViewApi {
  return (globalThis as unknown as { DebuggerView: DebuggerViewApi }).DebuggerView;
}

const STACK: FrameSummary[] = [
  { level: 1, label: '[] in JasperDebugDemo>>#finish', position: '@2 line 12' },
  {
    level: 2,
    label: 'SmallInteger (Object)>>#halt',
    position: '@2 line 12',
    overridable: true,
    receiverClass: 'SmallInteger',
    browsable: true,
  },
  { level: 3, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '' },
];

// Build the panel's DOM (the elements debuggerPanel.ts's getHtml renders) and
// wire DebuggerView to a fake vscode whose postMessage we can assert on.
function setup(
  stack: FrameSummary[] = STACK,
  dnu?: { selector: string; className: string; isMeta: boolean },
  subclassResp?: { selector: string },
) {
  document.body.innerHTML = `
    <button id="copyBtn">Copy Stack</button>
    <button id="dumpBtn">Dump Stack</button>
    <span id="saveNotice" style="display:none;"><span id="savePath"></span><span id="copyPathBtn">⧉</span></span>
    <div id="toolbar">
      <button data-cmd="resume">Resume</button>
      <button data-cmd="runToCursor" id="runToCursorBtn" disabled>Run to Cursor</button>
      <button data-cmd="stepOver">Over</button>
      <button data-cmd="stepInto">Into</button>
      <button data-cmd="stepThrough">Through</button>
      <button data-cmd="restartFrame">Restart Frame</button>
      <button data-cmd="terminate">Terminate</button>
    </div>
    <div id="flash" style="display:none;"></div>
    <div id="error"></div>
    <div id="dnuBar"></div>
    <div class="main"><ul id="stack"></ul><div id="variables"></div></div>
    <div id="evalbar"><div id="evalToggle">Evaluate…</div><input id="evalInput"><button id="evalClear">✕</button><div id="evalResult"></div></div>
    <div id="ctxmenu"><div id="copyFrameItem">Copy Frame</div><div id="browseFrameItem" style="display:none;">Browse</div><div id="homeFrameItem" style="display:none;">Go to home method</div><div id="frameImplItem" style="display:none;">Implement in receiver</div><div id="frameEvalItem">Evaluate in this frame</div></div>
    <div id="varctxmenu"><div id="varInspectItem">Inspect</div></div>
    <div id="busyOverlay" class="busy-overlay" style="display:none;"><div class="busy-box"><div class="busy-spinner"></div><button id="busyCancel" style="display:none;">Cancel</button></div></div>`;
  document.body.classList.remove('busy');
  // The eval bar's open/closed state lives on <body>, so reset it too — tests
  // run shuffled and one that closes the bar would otherwise leak into the next.
  document.body.classList.remove('eval-collapsed');
  const refs: Refs = {
    list: document.getElementById('stack')!,
    menu: document.getElementById('ctxmenu')!,
    copyFrameItem: document.getElementById('copyFrameItem')!,
    browseFrameItem: document.getElementById('browseFrameItem')!,
    homeFrameItem: document.getElementById('homeFrameItem')!,
    frameImplItem: document.getElementById('frameImplItem')!,
    copyBtn: document.getElementById('copyBtn')!,
    dumpBtn: document.getElementById('dumpBtn')!,
    saveNotice: document.getElementById('saveNotice')!,
    savePath: document.getElementById('savePath')!,
    copyPathBtn: document.getElementById('copyPathBtn')!,
    error: document.getElementById('error')!,
    flash: document.getElementById('flash')!,
    dnuBar: document.getElementById('dnuBar')!,
    toolbar: document.getElementById('toolbar')!,
    runToCursorBtn: document.getElementById('runToCursorBtn') as HTMLButtonElement,
    variables: document.getElementById('variables')!,
    evalInput: document.getElementById('evalInput') as HTMLInputElement,
    evalResult: document.getElementById('evalResult')!,
    evalToggle: document.getElementById('evalToggle')!,
    evalClear: document.getElementById('evalClear')!,
    evalbar: document.getElementById('evalbar')!,
    frameEvalItem: document.getElementById('frameEvalItem')!,
    varMenu: document.getElementById('varctxmenu')!,
    varInspectItem: document.getElementById('varInspectItem')!,
    busyOverlay: document.getElementById('busyOverlay')!,
    busyCancel: document.getElementById('busyCancel')!,
  };
  const vscode = { postMessage: vi.fn() };
  const ctrl = api().init(refs, vscode);
  // Deliver the host's init payload, as the webview does on load.
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { command: 'init', errorMessage: 'boom', stack, dnu, subclassResp },
    }),
  );
  return { refs, vscode, ctrl };
}

function frame(refs: Refs, level: number): HTMLElement {
  return refs.list.querySelector(`.frame[data-level="${level}"]`) as HTMLElement;
}

describe('DebuggerView.renderStack', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="stack"></ul>';
  });

  it('renders one .frame per stack entry, tagged with its level', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);

    const frames = list.querySelectorAll('.frame');
    expect(frames).toHaveLength(3);
    expect([...frames].map((f) => (f as HTMLElement).dataset.level)).toEqual(['1', '2', '3']);
    expect(frames[0].querySelector('.level')!.textContent).toBe('1');
    expect(frames[0].querySelector('.label')!.textContent).toBe('[] in JasperDebugDemo>>#finish');
  });

  it('renders a dimmed .pos only when the frame has a position', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);

    expect(list.querySelector('.frame[data-level="1"] .pos')!.textContent).toBe('@2 line 12');
    expect(list.querySelector('.frame[data-level="3"] .pos')).toBeNull();
  });

  it('shows an empty-state message for an empty stack', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, []);

    expect(list.querySelectorAll('.frame')).toHaveLength(0);
    expect(list.querySelector('.empty')!.textContent).toBe('No stack frames available.');
  });

  it('clears prior content on re-render', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);
    api().renderStack(list, [STACK[0]]);
    expect(list.querySelectorAll('.frame')).toHaveLength(1);
  });
});

describe('DebuggerView.init — init payload', () => {
  it('renders the stack, shows the error, default-selects the top frame, and posts selectFrame', () => {
    const { refs, ctrl, vscode } = setup();

    expect(refs.error.textContent).toBe('boom');
    expect(refs.list.querySelectorAll('.frame')).toHaveLength(3);
    expect(frame(refs, 1).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(1);
    // Default-selecting the top frame drives the companion source editor.
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 1 });
  });

  it('does not select anything when the stack is empty', () => {
    const { refs, ctrl } = setup([]);
    expect(refs.list.querySelector('.selected')).toBeNull();
    expect(ctrl.selectedLevel()).toBeNull();
  });
});

describe('DebuggerView.init — frame selection', () => {
  it('left-click selects a frame, moves selection off the previous one, and posts selectFrame', () => {
    const { refs, ctrl, vscode } = setup(); // top frame (1) selected by default
    frame(refs, 3).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(frame(refs, 1).classList.contains('selected')).toBe(false);
    expect(frame(refs, 3).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(3);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 3 });
  });
});

describe('DebuggerView.init — right-click copy popup', () => {
  it('right-click selects the frame and shows the menu at the cursor', () => {
    const { refs, ctrl, vscode } = setup();
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    });
    frame(refs, 2).dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true); // native menu suppressed
    expect(frame(refs, 2).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(2);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 2 });
    expect(refs.menu.classList.contains('show')).toBe(true);
    expect(refs.menu.style.left).toBe('40px');
    expect(refs.menu.style.top).toBe('60px');
  });

  it('Copy Frame posts copyFrame for the selected level and hides the menu', () => {
    const { refs, vscode } = setup();
    frame(refs, 2).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    refs.copyFrameItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'copyFrame', level: 2 });
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('an outside click hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('Escape hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('a scroll hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    window.dispatchEvent(new Event('scroll'));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('a right-click outside any frame does not open the menu', () => {
    const { refs } = setup();
    refs.list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('shows "Implement in…" (a picker follows) only on an overridable frame', () => {
    const { refs } = setup();
    // Frame 2 is an inherited method (overridable) → item shown; the ellipsis
    // signals the class picker (an overridable frame always has several targets).
    frame(refs, 2).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.frameImplItem!.style.display).not.toBe('none');
    expect(refs.frameImplItem!.textContent).toBe('Implement in…');

    // Frame 1 is NOT overridable → item hidden.
    frame(refs, 1).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.frameImplItem!.style.display).toBe('none');
  });

  it('clicking Implement posts implementInReceiver for the selected level and hides the menu', () => {
    const { refs, vscode } = setup();
    frame(refs, 2).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    refs.frameImplItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'implementInReceiver', level: 2 });
  });

  it('shows "Browse" only on a frame that runs a real class method', () => {
    const { refs } = setup();

    frame(refs, 2).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.browseFrameItem!.style.display).not.toBe('none');

    frame(refs, 1).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.browseFrameItem!.style.display).toBe('none');
  });

  it('clicking Browse posts browseFrame for the selected level and hides the menu', () => {
    const { refs, vscode } = setup();
    frame(refs, 2).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    refs.browseFrameItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'browseFrame', level: 2 });
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  // A block frame whose home method is on the stack carries homeDisplayLevel,
  // which drives the "Go to home method" navigation item.
  const BLOCK_STACK: FrameSummary[] = [
    {
      level: 1,
      label: '[] in JasperDebugDemo>>#finish',
      position: '@2 line 12',
      homeDisplayLevel: 3,
    },
    { level: 2, label: 'Collection>>#do:', position: '@1 line 1' },
    { level: 3, label: 'JasperDebugDemo>>#finish', position: '@4 line 20' },
  ];

  it('shows "Go to home method" only on a block frame whose home is on the stack', () => {
    const { refs } = setup(BLOCK_STACK);
    frame(refs, 1).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.homeFrameItem!.style.display).not.toBe('none');

    // The home method frame itself (no homeDisplayLevel) doesn't offer it.
    frame(refs, 3).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(refs.homeFrameItem!.style.display).toBe('none');
  });

  it('clicking "Go to home method" selects the home frame (drives its source + variables)', () => {
    const { refs, vscode } = setup(BLOCK_STACK);
    frame(refs, 1).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    vscode.postMessage.mockClear(); // drop the right-click's own selectFrame(1)
    refs.homeFrameItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Navigation reuses selectFrame, so the host opens the home frame like a click.
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 3 });
    expect(frame(refs, 3).classList.contains('selected')).toBe(true);
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  // Several blocks nested in one method: each block row carries the SAME
  // homeDisplayLevel (the host resolves them all to the one home activation).
  const NESTED_BLOCK_STACK: FrameSummary[] = [
    { level: 1, label: '[] in JasperDebugDemo>>#foo', position: '@2 line 3', homeDisplayLevel: 5 },
    { level: 2, label: 'Collection>>#do:', position: '@1 line 1' },
    { level: 3, label: '[] in JasperDebugDemo>>#foo', position: '@2 line 2', homeDisplayLevel: 5 },
    { level: 4, label: 'Collection>>#do:', position: '@1 line 1' },
    { level: 5, label: 'JasperDebugDemo>>#foo', position: '@6 line 10' },
  ];

  it('offers home navigation on EVERY nested block row, each pointing at the shared home', () => {
    const { refs } = setup(NESTED_BLOCK_STACK);
    for (const lvl of [1, 3]) {
      frame(refs, lvl).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
      expect(refs.homeFrameItem!.style.display).not.toBe('none');
    }
  });

  it('navigates to the shared home from a nested block other than the top one', () => {
    const { refs, vscode } = setup(NESTED_BLOCK_STACK);
    // Right-click the MIDDLE block (3), not the default-selected top frame, to
    // prove the click reads the right-clicked row's homeDisplayLevel.
    frame(refs, 3).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    vscode.postMessage.mockClear();
    refs.homeFrameItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 5 });
    expect(frame(refs, 5).classList.contains('selected')).toBe(true);
  });
});

describe('DebuggerView.init — progress indicator (#9)', () => {
  // setup()'s default frame-select fires one server request; deliver its reply so
  // every test starts idle, then exercise its own action from that clean baseline.
  function setupIdle() {
    const ctx = setup();
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'variables', groups: [] } }),
    );
    return ctx;
  }

  // Selecting a frame is a server round-trip (it fetches that frame's variables).
  function selectAFrame(refs: Refs) {
    frame(refs, 3).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function respond() {
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'variables', groups: [] } }),
    );
  }

  it('shows nothing while a server request finishes within the reveal delay', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      selectAFrame(refs);
      vi.advanceTimersByTime(499);

      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveals the spinner once a server request outlives the reveal delay', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      selectAFrame(refs);
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
      expect(document.body.classList.contains('busy')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the spinner when the host sends its response', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      selectAFrame(refs);
      vi.advanceTimersByTime(500);
      respond();

      expect(refs.busyOverlay!.style.display).toBe('none');
      expect(document.body.classList.contains('busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never flashes when the host responds before the reveal delay', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      selectAFrame(refs);
      respond();
      vi.advanceTimersByTime(1000);

      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a spinner for local-only commands like Copy Stack', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      refs.copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(1000);

      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  function markCancellable() {
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'cancellable', on: true } }),
    );
  }

  it('offers a Cancel button when the running op is cancellable', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      markCancellable();
      selectAFrame(refs);
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
      expect(refs.busyCancel!.style.display).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the spinner but no Cancel button for a non-cancellable op', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      selectAFrame(refs);
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
      expect(refs.busyCancel!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('requests cancellation when the Cancel button is clicked', () => {
    vi.useFakeTimers();
    try {
      const { refs, vscode } = setupIdle();

      markCancellable();
      selectAFrame(refs);
      vi.advanceTimersByTime(500);
      refs.busyCancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'cancelOp' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the Cancel button when the op completes', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      markCancellable();
      selectAFrame(refs);
      vi.advanceTimersByTime(500);
      respond();

      expect(refs.busyCancel!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the spinner and Cancel up when the host posts a transient flash (e.g. Break sent)', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      markCancellable();
      selectAFrame(refs);
      vi.advanceTimersByTime(500);
      // The Cancel-click acknowledgement is a 'flash' posted mid-op; it must NOT end
      // the span — otherwise the spinner vanishes and a 2nd Cancel (hard break) is impossible.
      window.dispatchEvent(
        new MessageEvent('message', { data: { command: 'flash', text: 'Break sent…' } }),
      );

      expect(refs.busyOverlay!.style.display).toBe('');
      expect(refs.busyCancel!.style.display).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  // Each server-bound command must start the busy span (otherwise a slow op of that
  // kind would show no spinner). Drive each through its real toolbar/eval trigger.
  for (const cmd of ['stepOver', 'stepInto', 'stepThrough', 'restartFrame', 'resume']) {
    it(`shows the spinner for a ${cmd} request`, () => {
      vi.useFakeTimers();
      try {
        const { refs } = setupIdle();

        refs.toolbar
          .querySelector(`[data-cmd="${cmd}"]`)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(refs.busyOverlay!.style.display).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it('shows the spinner for an evalInFrame request', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      refs.evalInput.value = '3 + 4';
      refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT show the spinner for a local-only command (Terminate)', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      refs.toolbar
        .querySelector('[data-cmd="terminate"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveals then hides the spinner from a host-pushed busy message', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();

      window.dispatchEvent(new MessageEvent('message', { data: { command: 'busy', on: true } }));
      vi.advanceTimersByTime(500);
      expect(refs.busyOverlay!.style.display).toBe('');

      window.dispatchEvent(new MessageEvent('message', { data: { command: 'busy', on: false } }));
      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  // Render one editable variable through the host's 'variables' message, so the
  // init-wired var handlers (commit/revert/contextMenu → post(...)) are exercised.
  function renderEditableVar(refs: Refs) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Instance variables',
              kind: 'instvar',
              vars: [
                { name: 'count', value: '5', oop: '200', edit: { kind: 'instvar', index: 1 } },
              ],
            },
          ],
        },
      }),
    );
    return refs.variables.querySelector('.var') as HTMLElement;
  }

  it('shows the spinner for a setVariable request (commit from the variable editor)', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();
      const row = renderEditableVar(refs);

      row.click(); // open the inline editor
      const input = refs.variables.querySelector('.var-edit') as HTMLInputElement;
      input.value = '42';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); // commit → post(setVariable)
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the spinner for a revertVariable request', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            command: 'variables',
            groups: [
              {
                title: 'Instance variables',
                kind: 'instvar',
                vars: [
                  {
                    name: 'count',
                    value: '9',
                    oop: '201',
                    edit: { kind: 'instvar', index: 1 },
                    revertible: true,
                  },
                ],
              },
            ],
          },
        }),
      );

      (refs.variables.querySelector('.var-revert') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ); // → post(revertVariable)
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT show the spinner for inspectVariable (deliberately excluded — opens a separate inspector)', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setupIdle();
      const row = renderEditableVar(refs);

      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); // sets varMenuTarget
      refs.varInspectItem!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // → post(inspectVariable)
      vi.advanceTimersByTime(500);

      expect(refs.busyOverlay!.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DebuggerView.init — copy stack button', () => {
  it('posts copyStack and flashes a check on the (icon) button, then restores it', () => {
    vi.useFakeTimers();
    try {
      const { refs, vscode } = setup();
      const icon = refs.copyBtn.innerHTML;
      refs.copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'copyStack' });
      expect(refs.copyBtn.textContent).toBe('✓');
      vi.advanceTimersByTime(1200);
      expect(refs.copyBtn.innerHTML).toBe(icon); // original icon markup restored
    } finally {
      vi.useRealTimers();
    }
  });

  it('#11 posts dumpStackToFile and flashes a check on the Dump Stack button', () => {
    vi.useFakeTimers();
    try {
      const { refs, vscode } = setup();
      const icon = refs.dumpBtn!.innerHTML;
      refs.dumpBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'dumpStackToFile' });
      expect(refs.dumpBtn!.textContent).toBe('✓');
      vi.advanceTimersByTime(1200);
      expect(refs.dumpBtn!.innerHTML).toBe(icon);
    } finally {
      vi.useRealTimers();
    }
  });

  const DUMP_PATH = '/Users/me/.jasper/stacks/20260625_153012_JasperFoo-bar.txt';

  it('#11 clicking the dumped path requests opening it in an editor', () => {
    const { refs, vscode } = setup();
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'savedNotice', path: DUMP_PATH } }),
    );
    refs.savePath!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'openDumpFile', path: DUMP_PATH });
  });

  it('#11 reveals the dumped path on savedNotice, then auto-hides after 5s', () => {
    vi.useFakeTimers();
    try {
      const { refs } = setup();
      window.dispatchEvent(
        new MessageEvent('message', { data: { command: 'savedNotice', path: DUMP_PATH } }),
      );

      expect(refs.savePath!.textContent).toBe(`Dumped to ${DUMP_PATH}`);
      expect(refs.savePath!.title).toBe(DUMP_PATH); // full path on hover, even if ellipsized
      expect(refs.saveNotice!.style.display).not.toBe('none'); // revealed
      vi.advanceTimersByTime(5000);
      expect(refs.saveNotice!.style.display).toBe('none'); // auto-dismissed
    } finally {
      vi.useRealTimers();
    }
  });

  it('#11 Copy-path icon copies the path, flashes a check, then dismisses the notice', () => {
    vi.useFakeTimers();
    try {
      const { refs, vscode } = setup();
      window.dispatchEvent(
        new MessageEvent('message', { data: { command: 'savedNotice', path: DUMP_PATH } }),
      );
      refs.copyPathBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'copyText', text: DUMP_PATH });
      expect(refs.copyPathBtn!.textContent).toBe('✓');
      vi.advanceTimersByTime(1200);
      expect(refs.copyPathBtn!.textContent).toBe('⧉'); // glyph restored
      expect(refs.saveNotice!.style.display).toBe('none'); // dismissed once copied
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DebuggerView.renderVariables', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="variables"></div>';
  });

  it('renders each group with a title and its rows (name / value / dim oop)', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      {
        title: 'Receiver',
        kind: 'receiver',
        vars: [{ name: 'self', value: 'a JasperDebugDemo', oop: '100' }],
      },
      {
        title: 'Arguments & Temps',
        kind: 'argtemps',
        vars: [{ name: 'amount', value: '75', oop: '124' }],
      },
    ]);
    const titles = el.querySelectorAll('.var-group-title');
    expect([...titles].map((t) => t.textContent)).toEqual(['Receiver', 'Arguments & Temps']);

    const rows = el.querySelectorAll('.var');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.var-name')!.classList.contains('self')).toBe(true);
    expect(rows[0].querySelector('.var-name')!.textContent).toBe('self');
    expect(rows[0].querySelector('.var-value')!.textContent).toBe('a JasperDebugDemo');
    expect(rows[0].querySelector('.var-oop')!.textContent).toBe('100');
    expect((rows[0] as HTMLElement).dataset.oop).toBe('100');
    expect(rows[1].querySelector('.var-name')!.textContent).toBe('amount');
    expect(rows[1].querySelector('.var-oop')!.textContent).toBe('124');
  });

  it('renders the stack-temps group collapsed; clicking its title expands it', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      {
        title: '(stack temps)',
        kind: 'stacktemps',
        collapsed: true,
        vars: [{ name: '.t1', value: '7', oop: '36' }],
      },
    ]);
    const group = el.querySelector('.var-group')!;
    expect(group.classList.contains('collapsed')).toBe(true);
    (group.querySelector('.var-group-title') as HTMLElement).click();
    expect(group.classList.contains('collapsed')).toBe(false);
  });

  it('right-clicking a row invokes the contextMenu handler with the row oop + name (Inspect)', () => {
    const el = document.getElementById('variables')!;
    const contextMenu = vi.fn();
    api().renderVariables(
      el,
      [{ title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] }],
      { contextMenu },
    );
    (el.querySelector('.var') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true }),
    );
    expect(contextMenu).toHaveBeenCalled();
    expect(contextMenu.mock.calls[0].slice(1)).toEqual(['100', 'self']);
  });

  it('marks editable rows (with edit metadata) and leaves self read-only', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] },
      {
        title: 'Instance variables',
        kind: 'instvars',
        vars: [{ name: 'total', value: '0', oop: '200', edit: { kind: 'instvar', index: 1 } }],
      },
    ]);
    const rows = el.querySelectorAll('.var');
    expect(rows[0].classList.contains('editable')).toBe(false); // self
    expect(rows[1].classList.contains('editable')).toBe(true); // total
  });

  it('left-clicking an editable row opens an inline editor prefilled with the printString', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      {
        title: 'Instance variables',
        kind: 'instvars',
        vars: [{ name: 'total', value: '42', oop: '200', edit: { kind: 'instvar', index: 1 } }],
      },
    ]);
    (el.querySelector('.var') as HTMLElement).click();
    const input = el.querySelector('.var-edit') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('42');
  });

  it('left-clicking a read-only stack temp (no edit metadata) does NOT open an editor', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      {
        title: '(stack temps)',
        kind: 'stacktemps',
        vars: [{ name: '.t1', value: '7', oop: '36' }],
      },
    ]);
    const row = el.querySelector('.var') as HTMLElement;
    expect(row.classList.contains('editable')).toBe(false);
    row.click();
    expect(el.querySelector('.var-edit')).toBeNull();
  });

  it('shows the revert icon only on revertible rows; clicking it calls revert (not the editor)', () => {
    const el = document.getElementById('variables')!;
    const revert = vi.fn();
    api().renderVariables(
      el,
      [
        {
          title: 'Instance variables',
          kind: 'instvars',
          vars: [
            {
              name: 'count',
              value: '9',
              oop: '200',
              edit: { kind: 'instvar', index: 1 },
              revertible: true,
            },
            { name: 'sum', value: '0', oop: '201', edit: { kind: 'instvar', index: 2 } },
          ],
        },
      ],
      { revert },
    );
    const rows = el.querySelectorAll('.var');
    const revIcon = rows[0].querySelector('.var-revert') as HTMLElement;
    expect(revIcon).not.toBeNull();
    expect(rows[1].querySelector('.var-revert')).toBeNull(); // not revertible → no icon

    revIcon.click();
    expect(revert).toHaveBeenCalledWith({ kind: 'instvar', index: 1 });
    // The click must NOT open the inline editor on that row.
    expect(rows[0].querySelector('.var-edit')).toBeNull();
  });

  it('left-clicking the read-only self row does NOT open an editor', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] },
    ]);
    (el.querySelector('.var') as HTMLElement).click();
    expect(el.querySelector('.var-edit')).toBeNull();
  });

  it('Enter in the inline editor calls commit with the edit target + trimmed expression', () => {
    const el = document.getElementById('variables')!;
    const commit = vi.fn();
    api().renderVariables(
      el,
      [
        {
          title: 'Instance variables',
          kind: 'instvars',
          vars: [{ name: 'total', value: '42', oop: '200', edit: { kind: 'instvar', index: 1 } }],
        },
      ],
      { commit },
    );
    (el.querySelector('.var') as HTMLElement).click();
    const input = el.querySelector('.var-edit') as HTMLInputElement;
    input.value = '  99  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(commit).toHaveBeenCalledWith({ kind: 'instvar', index: 1 }, '99');
    // Stays open (so an error can be fixed); not removed on commit.
    expect(el.querySelector('.var-edit')).not.toBeNull();
  });

  it('blurring the inline editor cancels it (when there is no error)', async () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      {
        title: 'Instance variables',
        kind: 'instvars',
        vars: [{ name: 'total', value: '42', oop: '200', edit: { kind: 'instvar', index: 1 } }],
      },
    ]);
    (el.querySelector('.var') as HTMLElement).click();
    (el.querySelector('.var-edit') as HTMLInputElement).dispatchEvent(new FocusEvent('blur'));
    await new Promise((r) => setTimeout(r, 0)); // blur-close is deferred a tick
    expect(el.querySelector('.var-edit')).toBeNull();
  });

  it('Esc cancels the inline editor and restores the displayed value', () => {
    const el = document.getElementById('variables')!;
    const commit = vi.fn();
    api().renderVariables(
      el,
      [
        {
          title: 'Instance variables',
          kind: 'instvars',
          vars: [{ name: 'total', value: '42', oop: '200', edit: { kind: 'instvar', index: 1 } }],
        },
      ],
      { commit },
    );
    (el.querySelector('.var') as HTMLElement).click();
    const input = el.querySelector('.var-edit') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.querySelector('.var-edit')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect((el.querySelector('.var-value') as HTMLElement).style.display).toBe('');
  });

  it('shows an empty-state message when there are no groups', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, []);
    expect(el.querySelector('.empty')!.textContent).toBe('No variables.');
  });
});

describe('DebuggerView.init — toolbar', () => {
  it('posts each toolbar command with the selected frame level', () => {
    const { refs, vscode } = setup(); // default-selects top frame (level 1)
    const click = (cmd: string) =>
      refs.toolbar
        .querySelector(`button[data-cmd="${cmd}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    click('stepOver');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'stepOver', level: 1 });
    click('resume');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'resume', level: 1 });
    click('terminate');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'terminate', level: 1 });
  });

  it('resolves the command when the click lands on a child of the button (the SVG icon)', () => {
    const { refs, vscode } = setup(); // default-selects top frame (level 1)
    const btn = refs.toolbar.querySelector('button[data-cmd="stepInto"]')!;
    // Production buttons hold an inline <svg> glyph, so the real click target is
    // the child element, not the button — the handler must walk up via closest().
    const icon = document.createElement('span');
    btn.appendChild(icon);
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'stepInto', level: 1 });
  });
});

describe('DebuggerView.init — Run to Cursor (#2)', () => {
  it('enables Run to Cursor only when the selected frame is breakable', () => {
    const stack: FrameSummary[] = [
      { level: 1, label: 'JasperDebugDemo>>#m', position: '', breakable: true },
      { level: 2, label: 'Executed Code', position: '', breakable: false },
    ];
    const { refs } = setup(stack); // default-selects the (breakable) top frame
    expect(refs.runToCursorBtn!.disabled).toBe(false);

    // Selecting the non-breakable doit frame disables it.
    frame(refs, 2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(refs.runToCursorBtn!.disabled).toBe(true);

    // Back to the breakable frame re-enables it.
    frame(refs, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(refs.runToCursorBtn!.disabled).toBe(false);
  });

  it('posts runToCursor with the selected frame level when clicked', () => {
    const stack: FrameSummary[] = [
      { level: 1, label: 'JasperDebugDemo>>#m', position: '', breakable: true },
    ];
    const { refs, vscode } = setup(stack);
    expect(refs.runToCursorBtn!.disabled).toBe(false);

    refs.runToCursorBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'runToCursor', level: 1 });
  });

  it('shows a transient flash message without clobbering the error banner', () => {
    const { refs } = setup(); // init set error to 'boom'
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'flash', text: 'place the cursor on a code line' },
      }),
    );

    expect(refs.flash!.textContent).toBe('place the cursor on a code line');
    expect(refs.flash!.style.display).not.toBe('none');
    expect(refs.flash!.classList.contains('show')).toBe(true);
    expect(refs.error.textContent).toBe('boom'); // error banner untouched
  });
});

describe('DebuggerView.init — eval bar', () => {
  it('posts evalInFrame for the selected frame on Enter (trimmed, non-empty)', () => {
    const { refs, vscode } = setup();
    refs.evalInput.value = '  amount * 2  ';
    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'evalInFrame',
      level: 1,
      expr: 'amount * 2',
    });
  });

  it('does not post on Enter when the input is blank', () => {
    const { refs, vscode } = setup();
    vi.mocked(vscode.postMessage).mockClear();
    refs.evalInput.value = '   ';
    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});

describe('DebuggerView.init — reporting the height the panel needs', () => {
  it('measures itself and reports it after rendering the stack', () => {
    // The host sizes the debugger column from THIS message and nothing else —
    // the pair opens evenly split and is corrected once the panel says how much
    // height it needs. If this stopped being sent the debugger would open 50/50
    // forever, and every host-side test would still pass, because they all feed
    // the message in by hand.
    const frames: number[] = [];
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      frames.push(1);
      cb(0);
      return 0;
    };
    try {
      const { vscode } = setup();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: 'fit',
        needed: document.body.scrollHeight,
        viewport: window.innerHeight,
      });
      // Measured a frame later, so the layout has settled before it's read.
      expect(frames.length).toBeGreaterThan(0);
    } finally {
      window.requestAnimationFrame = realRaf;
    }
  });
});

describe('DebuggerView.init — collapsible eval bar', () => {
  it('opens on the header, closes on Escape, and reports each change', () => {
    const { refs, vscode } = setup();
    document.body.classList.add('eval-collapsed'); // the host renders it closed

    refs.evalToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.classList.contains('eval-collapsed')).toBe(false);
    expect(document.activeElement).toBe(refs.evalInput);
    // Remembered like the splitter positions, so it opens the way you left it.
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'saveLayout',
      evalCollapsed: false,
    });

    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.classList.contains('eval-collapsed')).toBe(true);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'saveLayout',
      evalCollapsed: true,
    });
  });

  it("opens ready to type from a frame's context menu", () => {
    const { refs } = setup();
    document.body.classList.add('eval-collapsed');

    // The menu is a way IN, not a second place the feature lives.
    refs.frameEvalItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.classList.contains('eval-collapsed')).toBe(false);
    expect(document.activeElement).toBe(refs.evalInput);
  });

  it('shows the ✕ only once there is something to clear', () => {
    const { refs } = setup();
    expect(refs.evalbar!.classList.contains('has-text')).toBe(false);

    refs.evalInput.value = 'self foo';
    refs.evalInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(refs.evalbar!.classList.contains('has-text')).toBe(true);
  });

  it('clears the expression AND its answer', () => {
    const { refs } = setup();
    refs.evalInput.value = 'self foo';
    refs.evalInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'evalResult', value: '42' } }),
    );
    expect(refs.evalResult.textContent).toBe('42');

    refs.evalClear!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(refs.evalInput.value).toBe('');
    // An answer that outlives its expression reads as the answer to whatever
    // you type next.
    expect(refs.evalResult.textContent).toBe('');
    expect(refs.evalbar!.classList.contains('has-text')).toBe(false);
    expect(document.activeElement).toBe(refs.evalInput);
  });

  it('clears on Escape, and closes only once already empty', () => {
    const { refs } = setup();
    refs.evalInput.value = 'self foo';
    refs.evalInput.dispatchEvent(new Event('input', { bubbles: true }));

    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(refs.evalInput.value).toBe('');
    expect(document.body.classList.contains('eval-collapsed')).toBe(false); // still open

    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.classList.contains('eval-collapsed')).toBe(true);
  });

  it('still evaluates on Enter once open', () => {
    const { refs, vscode } = setup();
    refs.evalToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    refs.evalInput.value = 'self foo';
    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'evalInFrame', expr: 'self foo' }),
    );
  });
});

describe('DebuggerView.init — inbound variables / evalResult', () => {
  it('renders grouped variables pushed from the host', () => {
    const { refs } = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Receiver',
              kind: 'receiver',
              vars: [{ name: 'self', value: 'x', oop: '100' }],
            },
            {
              title: 'Arguments & Temps',
              kind: 'argtemps',
              vars: [{ name: 'n', value: '7', oop: '20' }],
            },
          ],
        },
      }),
    );
    expect(refs.variables.querySelectorAll('.var')).toHaveLength(2);
  });

  it('right-clicking a pushed variable row then Inspect posts inspectVariable to the host', () => {
    const { refs, vscode } = setup();
    vi.mocked(vscode.postMessage).mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Receiver',
              kind: 'receiver',
              vars: [{ name: 'self', value: 'x', oop: '100' }],
            },
          ],
        },
      }),
    );
    (refs.variables.querySelector('.var') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true }),
    );
    expect(refs.varMenu!.classList.contains('show')).toBe(true);
    (refs.varInspectItem as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'inspectVariable',
      oop: '100',
      name: 'self',
    });
  });

  it('Enter in an editable pushed row posts setVariable with the selected frame level', () => {
    const { refs, vscode } = setup(); // top frame (level 1) selected by default
    vi.mocked(vscode.postMessage).mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Instance variables',
              kind: 'instvars',
              vars: [
                { name: 'total', value: '0', oop: '200', edit: { kind: 'instvar', index: 1 } },
              ],
            },
          ],
        },
      }),
    );
    (refs.variables.querySelector('.var') as HTMLElement).click();
    const input = refs.variables.querySelector('.var-edit') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'setVariable',
      level: 1,
      kind: 'instvar',
      index: 1,
      expr: '99',
    });
  });

  it('setVariableResult failure flags the open editor (keeps it open) instead of closing it', () => {
    const { refs } = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Instance variables',
              kind: 'instvars',
              vars: [
                { name: 'total', value: '0', oop: '200', edit: { kind: 'instvar', index: 1 } },
              ],
            },
          ],
        },
      }),
    );
    (refs.variables.querySelector('.var') as HTMLElement).click();
    const input = refs.variables.querySelector('.var-edit') as HTMLInputElement;
    input.value = 'bogus +';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'setVariableResult', ok: false, error: 'a parse error' },
      }),
    );
    const stillOpen = refs.variables.querySelector('.var-edit') as HTMLInputElement;
    expect(stillOpen).not.toBeNull();
    expect(stillOpen.classList.contains('error')).toBe(true);
    expect(stillOpen.title).toBe('a parse error');
    // A visible message line (not just a hover tooltip) names the failure.
    const errLine = refs.variables.querySelector('.var-edit-error') as HTMLElement;
    expect(errLine).not.toBeNull();
    expect(errLine.textContent).toBe('a parse error');
  });

  it('clicking the revert icon on a pushed row posts revertVariable with the frame level', () => {
    const { refs, vscode } = setup(); // top frame (level 1) selected by default
    vi.mocked(vscode.postMessage).mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Instance variables',
              kind: 'instvars',
              vars: [
                {
                  name: 'count',
                  value: '9',
                  oop: '200',
                  edit: { kind: 'instvar', index: 1 },
                  revertible: true,
                },
              ],
            },
          ],
        },
      }),
    );
    (refs.variables.querySelector('.var-revert') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'revertVariable',
      level: 1,
      kind: 'instvar',
      index: 1,
    });
  });

  it('keeps an errored editor open when the input is blurred (so the message stays copyable)', async () => {
    const { refs } = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          command: 'variables',
          groups: [
            {
              title: 'Instance variables',
              kind: 'instvars',
              vars: [
                { name: 'total', value: '0', oop: '200', edit: { kind: 'instvar', index: 1 } },
              ],
            },
          ],
        },
      }),
    );
    (refs.variables.querySelector('.var') as HTMLElement).click();
    const input = refs.variables.querySelector('.var-edit') as HTMLInputElement;
    input.value = 'bogus +';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'setVariableResult', ok: false, error: 'a parse error' },
      }),
    );
    // Click on the message line to copy it → the input blurs; the editor must NOT
    // vanish (it would before the fix), so the text remains selectable.
    input.dispatchEvent(new FocusEvent('blur'));
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.variables.querySelector('.var-edit')).not.toBeNull();
    expect(refs.variables.querySelector('.var-edit-error')!.textContent).toBe('a parse error');
  });

  it('shows an eval result, flagging errors', () => {
    const { refs } = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'evalResult', value: '150', isError: false },
      }),
    );
    expect(refs.evalResult.textContent).toBe('150');
    expect(refs.evalResult.classList.contains('error')).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'evalResult', value: 'Error: nope', isError: true },
      }),
    );
    expect(refs.evalResult.textContent).toBe('Error: nope');
    expect(refs.evalResult.classList.contains('error')).toBe(true);
  });

  it('renders an empty string (not "undefined") when an evalResult has no value', () => {
    const { refs } = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'evalResult', isError: false },
      }),
    );
    expect(refs.evalResult.textContent).toBe('');
  });

  it('clears stale variables and eval output on a fresh init (refresh)', () => {
    const { refs } = setup();
    refs.variables.innerHTML = '<div class="var">stale</div>';
    refs.evalResult.textContent = 'stale';
    refs.evalResult.classList.add('error');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'init', errorMessage: '', stack: STACK },
      }),
    );
    expect(refs.variables.querySelector('.var')).toBeNull();
    expect(refs.evalResult.textContent).toBe('');
    expect(refs.evalResult.classList.contains('error')).toBe(false);
  });
});

describe('DebuggerView.init — resizable splitter', () => {
  // Build a panel DOM that includes the .main container + splitter, and a fake
  // vscode that records postMessage and round-trips getState/setState. jsdom
  // getBoundingClientRect returns zeros, so stub .main's rect to a real width.
  function setupSplit(initialState?: { stackBasis?: string }) {
    document.body.innerHTML = `
      <div id="error"></div>
      <div class="main" id="main" style="--stack-basis: 60%;">
        <ul id="stack"></ul>
        <div id="splitter"></div>
        <div id="variables"></div>
      </div>
      <div id="evalbar">
        <input id="evalInput"><div id="evalResult"></div>
      </div>
      <div id="ctxmenu"><div id="copyFrameItem"></div></div>
      <button id="copyBtn"></button><div id="toolbar"></div>`;
    const main = document.getElementById('main')!;
    main.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON() {},
    });
    const refs: Refs = {
      list: document.getElementById('stack')!,
      menu: document.getElementById('ctxmenu')!,
      copyFrameItem: document.getElementById('copyFrameItem')!,
      copyBtn: document.getElementById('copyBtn')!,
      error: document.getElementById('error')!,
      toolbar: document.getElementById('toolbar')!,
      variables: document.getElementById('variables')!,
      evalInput: document.getElementById('evalInput') as HTMLInputElement,
      evalResult: document.getElementById('evalResult')!,
      main,
      splitter: document.getElementById('splitter')!,
    };
    let state: unknown = initialState;
    const vscode = {
      postMessage: vi.fn(),
      getState: vi.fn(() => state),
      setState: vi.fn((s: unknown) => {
        state = s;
      }),
    };
    api().init(refs, vscode);
    return { refs, vscode, main };
  }

  function drag(splitter: HTMLElement, toClientX: number) {
    splitter.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 120, clientY: 50 }),
    );
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: toClientX, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: toClientX, clientY: 50 }));
  }

  it('restores a previously saved stack basis from webview state on init', () => {
    const { main } = setupSplit({ stackBasis: '35%' });
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('35%');
  });

  it('updates --stack-basis while dragging, clamped to 20–80%', () => {
    const { refs, main } = setupSplit();
    // 50px / 200px width → 25%.
    drag(refs.splitter!, 50);
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('25.0%');
    // Dragging past the right edge clamps to 80%.
    drag(refs.splitter!, 400);
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('80.0%');
  });

  it('persists the basis on drag end via setState and a saveLayout message', () => {
    const { refs, vscode } = setupSplit();
    drag(refs.splitter!, 100); // 100/200 → 50%
    expect(vscode.setState).toHaveBeenCalledWith({ stackBasis: '50.0%' });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'saveLayout', stackBasis: '50.0%' });
  });

  it('a mousemove with no active drag does nothing', () => {
    const { main } = setupSplit();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('60%');
  });

  it('a bare click on the splitter (no movement) does not persist', () => {
    const { refs, vscode } = setupSplit();
    refs.splitter!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 120, clientY: 50 }),
    );
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 50 }));
    expect(vscode.setState).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'saveLayout' }),
    );
  });
});

describe('DebuggerView.renderDnu (create-method-from-DNU)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dnuBar"></div>';
  });

  it('renders a "Create #selector in Class" button for an instance-side DNU', () => {
    const bar = document.getElementById('dnuBar')!;
    api().renderDnu(bar, { selector: 'fourtyTwo:bar:', className: 'SmallInteger', isMeta: false });
    const btn = bar.querySelector('button.dnu-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Create #fourtyTwo:bar: in SmallInteger');
  });

  it('appends " class" to the class name for a class-side DNU', () => {
    const bar = document.getElementById('dnuBar')!;
    api().renderDnu(bar, { selector: 'makeWidget', className: 'JasperDebugDemo', isMeta: true });
    expect(bar.querySelector('button.dnu-btn')!.textContent).toBe(
      'Create #makeWidget in JasperDebugDemo class',
    );
  });

  it('clears the bar (no button) when there is no DNU', () => {
    const bar = document.getElementById('dnuBar')!;
    api().renderDnu(bar, { selector: 'x', className: 'Y', isMeta: false });
    api().renderDnu(bar, null);
    expect(bar.querySelector('button.dnu-btn')).toBeNull();
  });

  it('invokes onCreate when the button is clicked', () => {
    const bar = document.getElementById('dnuBar')!;
    const onCreate = vi.fn();
    api().renderDnu(bar, { selector: 'x', className: 'Y', isMeta: false }, onCreate);
    (bar.querySelector('button.dnu-btn') as HTMLButtonElement).click();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('DebuggerView.renderSubclassResp (subclassResponsibility implement action)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dnuBar"></div>';
  });

  it('renders an "Implement #selector" button (no class — chosen via picker)', () => {
    const bar = document.getElementById('dnuBar')!;
    api().renderSubclassResp(bar, { selector: 'foo' });
    const btn = bar.querySelector('button.dnu-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Implement #foo');
  });

  it('clears the bar (no button) when there is no subclassResponsibility', () => {
    const bar = document.getElementById('dnuBar')!;
    api().renderSubclassResp(bar, { selector: 'foo' });
    api().renderSubclassResp(bar, null);
    expect(bar.querySelector('button.dnu-btn')).toBeNull();
  });

  it('invokes onImplement when the button is clicked', () => {
    const bar = document.getElementById('dnuBar')!;
    const onImplement = vi.fn();
    api().renderSubclassResp(bar, { selector: 'foo' }, onImplement);
    (bar.querySelector('button.dnu-btn') as HTMLButtonElement).click();
    expect(onImplement).toHaveBeenCalledTimes(1);
  });
});

describe('DebuggerView init — DNU button wiring', () => {
  it('renders the Create button from the init payload and posts createDnuMethod on click', () => {
    const { refs, vscode } = setup(STACK, { selector: 'foo:', className: 'Array', isMeta: false });
    const btn = refs.dnuBar!.querySelector('button.dnu-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Create #foo: in Array');
    btn.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'createDnuMethod' });
  });

  it('shows no Create button when the init payload has no dnu', () => {
    const { refs } = setup(); // dnu omitted
    expect(refs.dnuBar!.querySelector('button.dnu-btn')).toBeNull();
  });

  it('a "banner" message sets the error text and clears the Create button (no re-render)', () => {
    const { refs } = setup(STACK, { selector: 'foo:', className: 'Array', isMeta: false });
    expect(refs.dnuBar!.querySelector('button.dnu-btn')).not.toBeNull();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'banner', text: 'Fill in the body, then save (Ctrl+S).' },
      }),
    );
    expect(refs.error.textContent).toBe('Fill in the body, then save (Ctrl+S).');
    expect(refs.dnuBar!.querySelector('button.dnu-btn')).toBeNull(); // button cleared
  });

  it('renders the Implement button from the init payload and posts implementSubclassResponsibility', () => {
    const { refs, vscode } = setup(STACK, undefined, { selector: 'foo' });
    const btn = refs.dnuBar!.querySelector('button.dnu-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Implement #foo');
    btn.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'implementSubclassResponsibility' });
  });

  it('shows the DNU Create button (not the Implement button) when both are present', () => {
    const { refs } = setup(
      STACK,
      { selector: 'foo:', className: 'Array', isMeta: false },
      { selector: 'foo' },
    );
    const btn = refs.dnuBar!.querySelector('button.dnu-btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('Create #foo:'); // DNU wins; Implement not rendered
  });
});
