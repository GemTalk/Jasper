/**
 * Opening a method must scroll the Methods pane to the selected row. Every VS Code Jasper
 * supports scrolls a revealed row into view with focus:false, so a reveal the editor drove
 * never takes the tree's focus and has nothing to hand back. Only the explicit Reveal in
 * GemStone Explorer (keepTreeFocus) reveals with focus:true, because being put in the tree is
 * what the user asked for.
 *
 * A rejected reveal is not swallowed: it lands in the GCI log.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({}));
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import { logWarning } from '../../gciLog';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION = { id: 1 } as ActiveSession;
const INFO = { selector: 'printString', category: 'printing', overrideBits: 0, sessionBit: 0 };
const FOCUS_EDITOR = 'workbench.action.focusActiveEditorGroup';

type RevealOpts = { keepTreeFocus?: boolean };

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
  // revealMethodRow is private; drive it directly.
  const reveal = (opts?: RevealOpts) =>
    (
      ctl as unknown as {
        revealMethodRow: (m: boolean, i: typeof INFO, o?: RevealOpts) => Promise<void>;
      }
    ).revealMethodRow(false, INFO, opts);
  return { ctl, method, reveal };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.commands.executeCommand).mockReset();
});

describe('revealMethodRow', () => {
  it('reveals an editor-driven row with focus:false and never touches the editor focus', async () => {
    const { method, reveal } = makeController();

    await reveal();

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: true, focus: false, expand: true }),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });

  it('keepTreeFocus reveals with focus:true and leaves the focus in the tree', async () => {
    const { method, reveal } = makeController();

    await reveal({ keepTreeFocus: true });

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: true, focus: true, expand: true }),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });

  it('keepTreeFocus:false is the editor-driven reveal', async () => {
    const { method, reveal } = makeController();

    await reveal({ keepTreeFocus: false });

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ focus: false }),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });

  it('logs to the GCI channel when the reveal rejects, and hands nothing back', async () => {
    const { reveal } = makeController(() => Promise.reject(new Error('pane gone')));

    await reveal();

    expect(vi.mocked(logWarning)).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(logWarning).mock.calls[0][0]);
    expect(logged).toContain('printString');
    expect(logged).toContain('pane gone');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });
});

describe('selecting a method just created with New Method', () => {
  it('reveals it with focus:false, leaving the cursor in its editor', async () => {
    const { ctl, method } = makeController();
    ctl.state.dictIndex = 1;
    ctl.state.className = 'Account';
    const internals = ctl as unknown as {
      pendingNewMethod: unknown;
      maybeRevealNewMethod: () => void;
    };
    internals.pendingNewMethod = {
      className: 'Account',
      dictIndex: 1,
      isMeta: false,
      before: new Set<string>(),
    };
    vi.spyOn(ctl as unknown as { selectorsFor: () => unknown }, 'selectorsFor').mockReturnValue([
      INFO,
    ] as never);

    internals.maybeRevealNewMethod();
    await vi.waitFor(() => expect(method.reveal).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: true, focus: false }),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(FOCUS_EDITOR);
  });
});
