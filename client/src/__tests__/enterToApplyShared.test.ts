// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The held-Enter guard, in one place.
 *
 * Enter applies a preview panel, but only once the key has been seen released (or the panel has
 * been open a moment) — so an Enter held down in the rename editor cannot auto-repeat through a
 * warning dialog and into Apply, applying a preview nobody read. The rule is subtle enough that
 * it took several rounds to get right, and it currently exists as four byte-identical copies:
 * three refactoring panels and the undo plan panel. A correction made to it reaches whichever
 * copies the person editing happened to know about.
 *
 * Two things are pinned, and they need each other. The structural tests say there is ONE copy
 * and that every panel loads it, which is the change itself. The behavioural tests say what
 * that one copy has to do, so the merge cannot quietly drop a rule on the way — each of the
 * four it replaces is the product of a separate bug.
 *
 * The richer behavioural coverage already sits in `refactoring/__tests__/renameMethodPanel.test.ts`,
 * against one panel. Once the guard is shared, that suite covers all four by construction; the
 * cases here are the ones the shared module owns outright.
 */

const CLIENT_SRC = path.resolve(__dirname, '..');
const SHARED = path.join(CLIENT_SRC, 'webview', 'enterToApply.js');

/** The panel scripts that each carry their own copy of the guard today. */
const PANEL_SCRIPTS = [
  'refactoring/renameMethodPanelView.js',
  'refactoring/renameInstVarPanelView.js',
  'refactoring/instVarRefactorPanelView.js',
  'undo/undoPlanPanelView.js',
];

/** The modules that build those panels' webviews, and so must load the shared script. */
const PANEL_MODULES = [
  'refactoring/renameMethodPanel.ts',
  'refactoring/renameClassPanel.ts',
  'refactoring/renameInstVarPanel.ts',
  'refactoring/instVarRefactorPanel.ts',
  'undo/undoPlanPanel.ts',
];

/** The handler name the guard hangs its keyup listener on — its distinctive marker. */
const ARMING_HANDLER = '__gsArmEnter';

const jsFilesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'out', '__tests__', '__mocks__'].includes(entry.name)
        ? []
        : jsFilesUnder(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });

const read = (relative: string): string => fs.readFileSync(path.join(CLIENT_SRC, relative), 'utf8');

describe('where the held-Enter guard lives', () => {
  it('is defined in exactly one script', () => {
    const defining = jsFilesUnder(CLIENT_SRC)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(`${ARMING_HANDLER} = function`))
      .map((file) => path.relative(CLIENT_SRC, file));

    expect(defining).toEqual(['webview/enterToApply.js']);
  });

  it.each(PANEL_SCRIPTS)('is no longer written out again in %s', (script) => {
    expect(read(script)).not.toContain(`${ARMING_HANDLER} = function`);
  });

  it.each(PANEL_MODULES)('is loaded into the webview %s builds', (module) => {
    expect(read(module)).toContain('enterToApply.js');
  });
});

describe('the shared guard', () => {
  interface EnterToApply {
    arm(doc: Document, applyEl: Element | null): void;
  }

  const shared = (): EnterToApply =>
    (globalThis as unknown as { GsEnterToApply: EnterToApply }).GsEnterToApply;

  let apply: HTMLButtonElement;

  /** A fresh page with an Apply button, armed the way a panel arms it on open. */
  function mount(): void {
    document.body.innerHTML = '<button id="apply">Apply</button>';
    apply = document.getElementById('apply') as HTMLButtonElement;
    shared().arm(document, apply);
  }

  const release = (): void => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  };

  /** Dispatch an Enter keydown at `target` and answer whether the guard blocked it. */
  const enter = (target: Element | Document, repeat = false): boolean => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      repeat,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  beforeEach(() => {
    if (!shared()) new Function(fs.readFileSync(SHARED, 'utf8'))();
    vi.useFakeTimers();
    mount();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks an Enter the page has not seen released', () => {
    expect(enter(apply)).toBe(true);
  });

  it('lets an Enter through once the key has been released', () => {
    release();

    expect(enter(apply)).toBe(false);
  });

  it('lets an Enter through once the panel has been open a moment', () => {
    // The panel is built after a round trip, so the Enter that opened it was released while no
    // page was listening; waiting for a keyup alone ate the first deliberate press.
    vi.setSystemTime(new Date(Date.now() + 350));

    expect(enter(apply)).toBe(false);
  });

  it('blocks an auto-repeat even after a keyup has armed it', () => {
    // Nothing good comes of a held key activating the primary action, whatever armed the panel.
    release();

    expect(enter(apply, true)).toBe(true);
  });

  it('blocks an auto-repeat that outlasts the idle window', () => {
    // The window opens on a clock whether or not the key came up, so the idle alone would let a
    // still-held key repeat straight into Apply.
    vi.setSystemTime(new Date(Date.now() + 350));

    expect(enter(apply, true)).toBe(true);
  });

  it('replaces its listener when a panel re-renders instead of stacking another', () => {
    // A panel arms on every render. Stacked keyup listeners arm the page from a keystroke that
    // belongs to an earlier render of it.
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');

    shared().arm(document, apply);

    expect(removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(addEventListener.mock.calls.filter(([type]) => type === 'keyup')).toHaveLength(1);
  });

  it('arms the page even when the panel has no Apply button to guard', () => {
    // Some panels render without one until their first page arrives; arming must not throw.
    expect(() => shared().arm(document, null)).not.toThrow();
  });
});
