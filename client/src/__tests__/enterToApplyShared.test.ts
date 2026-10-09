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
 * it took several rounds to get right, and it used to exist as four byte-identical copies --
 * three refactoring panels and the undo plan panel -- so a correction reached whichever copies
 * the person editing happened to know about.
 *
 * Two things are pinned, and they need each other. The structural tests say there is ONE copy
 * and that every panel loads it. The behavioural tests say what that one copy has to do, since
 * each of its rules is the product of a separate bug.
 *
 * The richer behavioural coverage sits in `refactoring/__tests__/renameMethodPanel.test.ts`,
 * against one panel; with the guard shared, that suite covers all four by construction. The
 * cases here are the ones the shared module owns outright.
 */

const CLIENT_SRC = path.resolve(__dirname, '..');
const SHARED = path.join(CLIENT_SRC, 'webview', 'enterToApply.js');

/** The panel scripts that each carried their own copy of the guard. */
const PANEL_SCRIPTS = [
  'refactoring/renameMethodPanelView.js',
  'refactoring/renameInstVarPanelView.js',
  'refactoring/instVarRefactorPanelView.js',
  'undo/undoPlanPanelView.js',
];

/** The handler name the guard hangs its keyup listener on — its distinctive marker. */
const ARMING_HANDLER = '__gsArmEnter';

const filesUnder = (dir: string, extension: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'out', '__tests__', '__mocks__'].includes(entry.name)
        ? []
        : filesUnder(full, extension);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });

const read = (relative: string): string => fs.readFileSync(path.join(CLIENT_SRC, relative), 'utf8');

/** A host module and the panel script it loads. Found by scanning, so a new panel is covered. */
const PANEL_HOSTS: [string, string][] = filesUnder(CLIENT_SRC, '.ts').flatMap((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const script = PANEL_SCRIPTS.map((s) => path.basename(s)).find((name) =>
    new RegExp(`read(?:Webview|PreviewPanel)Script\\(\\s*'${name}'`).test(source),
  );
  return script ? [[path.relative(CLIENT_SRC, file), script]] : [];
});

describe('where the held-Enter guard lives', () => {
  it('is defined in exactly one script', () => {
    const defining = filesUnder(CLIENT_SRC, '.js')
      .filter((file) => fs.readFileSync(file, 'utf8').includes(`${ARMING_HANDLER} = function`))
      .map((file) => path.relative(CLIENT_SRC, file));

    expect(defining).toEqual(['webview/enterToApply.js']);
  });

  it.each(PANEL_SCRIPTS)('is no longer written out again in %s', (script) => {
    expect(read(script)).not.toContain(`${ARMING_HANDLER} = function`);
  });

  it('finds the panel hosts (guards against a broken scan)', () => {
    const hosts = PANEL_HOSTS.map(([module]) => module);
    expect(hosts).toContain('refactoring/renameMethodPanel.ts');
    expect(hosts).toContain('undo/undoPlanPanel.ts');
  });

  it.each(PANEL_HOSTS)('is loaded into the webview %s builds, ahead of %s', (module, script) => {
    // readPreviewPanelScript prepends the guard; a bare readWebviewScript of a panel script
    // would leave the panel calling a guard that was never loaded.
    expect(read(module)).toMatch(new RegExp(`readPreviewPanelScript\\(\\s*'${script}'`));
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
    vi.advanceTimersByTime(350);

    expect(enter(apply)).toBe(false);
  });

  it('applies on an Enter pressed elsewhere on the page once armed', () => {
    // The point of the guard is to let Enter apply; one that only ever blocks passes the rest.
    const clicked = vi.fn();
    apply.addEventListener('click', clicked);
    release();

    enter(document.body);

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('does not apply on an Enter pressed before the page has seen it released', () => {
    const clicked = vi.fn();
    apply.addEventListener('click', clicked);

    enter(document.body);

    expect(clicked).not.toHaveBeenCalled();
  });

  it('blocks a Space on Apply the page has not seen released', () => {
    // Space activates a focused button natively, so the guard covers it alongside Enter.
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    apply.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('blocks an auto-repeat even after a keyup has armed it', () => {
    // Nothing good comes of a held key activating the primary action, whatever armed the panel.
    release();

    expect(enter(apply, true)).toBe(true);
  });

  it('blocks an auto-repeat that outlasts the idle window', () => {
    // The window opens on a clock whether or not the key came up, so the idle alone would let a
    // still-held key repeat straight into Apply.
    vi.advanceTimersByTime(350);

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
