/**
 * #428 item #43 — opening a method must scroll the Methods pane to the selected row. In this VS Code
 * build only reveal({ focus: true }) scrolls (focus:false selects but never scrolls); so an
 * editor-driven navigation reveals with focus:true and then hands focus straight back to the editor.
 * A passive background resync must NOT do that (it would yank focus off whatever the user is doing),
 * so it stays a plain non-scrolling select.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

const SESSION = { id: 1 } as ActiveSession;
const INFO = { selector: 'printString', category: 'printing', overrideBits: 0, sessionBit: 0 };
const FOCUS_EDITOR = 'workbench.action.focusActiveEditorGroup';

function makeController() {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const method = { reveal: vi.fn(async () => {}), selection: [], description: '', visible: true };
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

beforeEach(() => vi.clearAllMocks());

describe('#43 revealMethodRow scrolls to the method on navigation', () => {
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
