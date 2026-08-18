/**
 * Opening a method must scroll the Methods pane to the selected row. In this VS Code
 * build only reveal({ focus: true }) scrolls (focus:false selects but never scrolls); so an
 * editor-driven navigation reveals with focus:true and then hands focus straight back to the editor.
 * A passive background resync must NOT do that (it would yank focus off whatever the user is doing),
 * so it stays a plain non-scrolling select.
 *
 * Neither step is swallowed: a rejected reveal AND a failed hand-back both land in the GCI log,
 * because a silent failure here leaves the user's cursor stranded in the tree with no explanation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({}));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { logWarning } from '../gciLog';
import type { SessionManager, ActiveSession } from '../sessionManager';

const SESSION = { id: 1 } as ActiveSession;
const INFO = { selector: 'printString', category: 'printing', overrideBits: 0, sessionBit: 0 };
const FOCUS_EDITOR = 'workbench.action.focusActiveEditorGroup';

function makeController(methodReveal: () => Promise<void> = async () => {}) {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const method = { reveal: vi.fn(methodReveal), selection: [], description: '', visible: true };
  ctl.setViews({
    dict: { reveal: vi.fn(), description: '' },
    category: { reveal: vi.fn(), description: '' },
    klass: { reveal: vi.fn(), description: '' },
    hierarchy: { reveal: vi.fn(), description: '' },
    method,
  } as never);
  // revealMethodRow is private; drive it directly for the two paths.
  const reveal = (opts?: { focusEditorAfter?: boolean }) =>
    (
      ctl as unknown as {
        revealMethodRow: (
          m: boolean,
          i: typeof INFO,
          o?: { focusEditorAfter?: boolean },
        ) => Promise<void>;
      }
    ).revealMethodRow(false, INFO, opts);
  return { method, reveal };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so drop any per-test executeCommand override before the
  // next test (one case makes the focus hand-back throw).
  vi.mocked(vscode.commands.executeCommand).mockReset();
});

describe('revealMethodRow scrolls to the method on navigation', () => {
  it('reveals with focus:true and returns focus to the editor when focusEditorAfter is set', async () => {
    const { method, reveal } = makeController();

    await reveal({ focusEditorAfter: true });

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: true, focus: true, expand: true }),
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(FOCUS_EDITOR);
  });

  it('a passive resync reveals with focus:false and does NOT grab editor focus', async () => {
    const { method, reveal } = makeController();

    await reveal(); // no opts

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ focus: false }),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });
});

describe('revealMethodRow reports a reveal or focus failure instead of swallowing it', () => {
  it('logs to the GCI channel when the reveal rejects, and still returns focus to the editor', async () => {
    const { reveal } = makeController(() => Promise.reject(new Error('pane gone')));

    await reveal({ focusEditorAfter: true });

    expect(vi.mocked(logWarning)).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(logWarning).mock.calls[0][0]);
    expect(logged).toContain('printString');
    expect(logged).toContain('pane gone');
    // The reveal may have taken focus before failing, so the hand-back must still be attempted —
    // otherwise the user's cursor is stranded in the tree.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(FOCUS_EDITOR);
  });

  it('logs to the GCI channel when handing focus back to the editor fails', async () => {
    const { reveal } = makeController();
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (cmd: string) => {
      if (cmd === FOCUS_EDITOR) throw new Error('no active editor group');
    });

    await reveal({ focusEditorAfter: true });

    expect(vi.mocked(logWarning)).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(logWarning).mock.calls[0][0]);
    expect(logged).toContain('printString');
    expect(logged).toContain('no active editor group');
  });

  it('logs nothing when both the reveal and the focus hand-back succeed', async () => {
    const { method, reveal } = makeController();

    await reveal({ focusEditorAfter: true });

    // Assert the reveal ran, so "logs nothing" can't pass vacuously.
    expect(method.reveal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarning)).not.toHaveBeenCalled();
  });
});
