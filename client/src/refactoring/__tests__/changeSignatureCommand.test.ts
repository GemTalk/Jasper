import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeChangeSignature: vi.fn(),
  startChangeSignaturePreview: vi.fn(),
  pageChangeSignaturePreview: vi.fn(),
  applyChangeSignature: vi.fn(),
  clearChangeSignaturePreview: vi.fn(),
}));
vi.mock('../changeSignatureEditor', () => ({ showChangeSignatureEditor: vi.fn() }));
vi.mock('../changeSignaturePanel', () => ({ showChangeSignaturePanel: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showChangeSignatureEditor } from '../changeSignatureEditor';
import { showChangeSignaturePanel } from '../changeSignaturePanel';
import { beginChangeSignature, changeSignatureCommand } from '../changeSignatureCommand';
import type { ActiveSession } from '../../sessionManager';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the change-signature COMMAND (not the engine). Both entry points share
 * beginChangeSignature; the pins here are the "always tell the user why nothing
 * happened" contract (a hard decline/collision surfaces a warning and never opens the
 * panel), the save-before/refresh-after behaviour, and the source-pane URI resolution.
 */

const session = (over: Partial<ActiveSession> = {}): ActiveSession =>
  ({ id: 7, rbSupportAvailable: true, ...over }) as unknown as ActiveSession;

const target = {
  className: 'Account',
  selector: 'at:',
  isMeta: false,
  dictIndex: 2,
  dictName: 'UserGlobals',
};

const analysis = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ selectorKind: 'keyword', arity: 1, argNames: ['k'], decline: null, ...over });

const edit = {
  newParts: ['at:', 'put:'],
  permutation: [1, 0],
  newArgNames: ['k', 'v'],
  defaults: ['', 'nil'],
  scope: { kind: 'hierarchy' as const },
};

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 't',
    total: 2,
    outOfScope: { implementors: 0, senders: 0, skipped: 0, collision: null, decline: null },
    skippedMethods: [],
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodRename',
          className: 'Account',
          isMeta: false,
          selector: 'at:',
          newSelector: 'at:put:',
          oldSource: 'at: k',
          newSource: 'at: k put: v',
        },
      ],
      nextOffset: 2,
      done: true,
    },
    ...over,
  });

beforeEach(() => vi.clearAllMocks());

describe('beginChangeSignature (shared flow)', () => {
  it('refuses install and stops when the engine is unavailable', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    const applied = await beginChangeSignature(target, {
      session: session({ rbSupportAvailable: false }),
      onApplied: vi.fn(),
    });

    expect(applied).toBe(false);
    expect(queries.analyzeChangeSignature).not.toHaveBeenCalled();
  });

  it('surfaces a hard pre-flight decline and never opens the editor', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(
      analysis({ decline: 'Class not found: Account' }),
    );

    const applied = await beginChangeSignature(target, { session: session(), onApplied: vi.fn() });

    expect(applied).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found'),
    );
    expect(showChangeSignatureEditor).not.toHaveBeenCalled();
  });

  it('does nothing when the editor is cancelled', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(undefined);

    const applied = await beginChangeSignature(target, { session: session(), onApplied: vi.fn() });

    expect(applied).toBe(false);
    expect(queries.startChangeSignaturePreview).not.toHaveBeenCalled();
  });

  it('tells the user and does nothing when the edit is a no-op', async () => {
    // A multi-keyword selector left in its original order + parts: passes the shape
    // validation but is a no-op, so it exercises isNoOpChange (a single-part revert would
    // trip validateSignatureParts first).
    const noopTarget = { ...target, selector: 'at:put:' };
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(
      analysis({ arity: 2, argNames: ['k', 'v'] }),
    );
    vi.mocked(showChangeSignatureEditor).mockResolvedValue({
      newParts: ['at:', 'put:'],
      permutation: [1, 2],
      newArgNames: ['k', 'v'],
      defaults: ['', ''],
      scope: { kind: 'hierarchy' },
    });

    const applied = await beginChangeSignature(noopTarget, {
      session: session(),
      onApplied: vi.fn(),
    });

    expect(applied).toBe(false);
    expect(queries.startChangeSignaturePreview).not.toHaveBeenCalled();
    // The user is told why nothing happened (the command's "always say why" contract).
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('unchanged'),
    );
  });

  it('refuses (and never opens the panel) on a collision from the preview', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(
      startEnvelope({
        total: 0,
        outOfScope: {
          implementors: 0,
          senders: 0,
          skipped: 0,
          collision: 'Account already implements at:put:.',
          decline: null,
        },
      }),
    );

    const applied = await beginChangeSignature(target, { session: session(), onApplied: vi.fn() });

    expect(applied).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already implements'),
    );
    expect(showChangeSignaturePanel).not.toHaveBeenCalled();
  });

  it('refuses (and never opens the panel) on a decline from the preview', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(
      startEnvelope({
        total: 0,
        outOfScope: {
          implementors: 0,
          senders: 0,
          skipped: 0,
          collision: null,
          decline: 'Parameter value is used in Account>>at:put:.',
        },
      }),
    );

    const applied = await beginChangeSignature(target, { session: session(), onApplied: vi.fn() });

    expect(applied).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('is used in'),
    );
    expect(showChangeSignaturePanel).not.toHaveBeenCalled();
  });

  it('reports a failed preview and never opens the panel', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockRejectedValue(new Error('kaboom'));

    const applied = await beginChangeSignature(target, { session: session(), onApplied: vi.fn() });

    expect(applied).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(showChangeSignaturePanel).not.toHaveBeenCalled();
  });

  it('applies the change and calls onApplied with the old and new selectors', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showChangeSignaturePanel).mockResolvedValue({ applied: 2, failed: [] });
    const onApplied = vi.fn();

    const applied = await beginChangeSignature(target, { session: session(), onApplied });

    expect(applied).toBe(true);
    expect(onApplied).toHaveBeenCalledWith('at:', 'at:put:');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('NOT committed'),
    );
  });

  // An expired preview token answers `applied:0` with an EMPTY `failed`, so it parses
  // cleanly. `onApplied` refreshes/reopens editors on the NEW selector, so it must not run
  // when the selector never actually changed.
  it('reports an expired preview token and does not call onApplied', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showChangeSignaturePanel).mockResolvedValue({
      applied: 0,
      failed: [],
      error: 'preview session expired',
    });
    const onApplied = vi.fn();

    const applied = await beginChangeSignature(target, { session: session(), onApplied });

    expect(applied).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('preview session expired'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does not call onApplied when the preview is cancelled', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showChangeSignaturePanel).mockResolvedValue(undefined);
    const onApplied = vi.fn();

    const applied = await beginChangeSignature(target, { session: session(), onApplied });

    expect(applied).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('saves a dirty source editor before previewing', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showChangeSignaturePanel).mockResolvedValue({ applied: 2, failed: [] });
    const save = vi.fn(async () => true);
    const saveEditor = { document: { isDirty: true, save } } as unknown as vscode.TextEditor;

    await beginChangeSignature(target, { session: session(), saveEditor, onApplied: vi.fn() });

    expect(save).toHaveBeenCalled();
  });

  it('stops without previewing when the dirty editor cannot be saved', async () => {
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    const saveEditor = {
      document: { isDirty: true, save: vi.fn(async () => false) },
    } as unknown as vscode.TextEditor;

    const applied = await beginChangeSignature(target, {
      session: session(),
      saveEditor,
      onApplied: vi.fn(),
    });

    expect(applied).toBe(false);
    expect(queries.analyzeChangeSignature).not.toHaveBeenCalled();
  });
});

describe('changeSignatureCommand (source-pane entry)', () => {
  const sessionsWith = (over: Partial<ActiveSession> = {}): SessionManager =>
    ({ getSession: () => session(over) }) as unknown as SessionManager;

  function installEditor(uri: string): void {
    const document = {
      uri: vscode.Uri.parse(uri),
      isDirty: false,
      save: vi.fn(async () => true),
    };
    const caret = new vscode.Position(0, 0);
    (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
      document,
      selection: { isEmpty: true, active: caret, start: caret, end: caret },
      viewColumn: 1,
    };
  }

  it('resolves the edited method from the URI and refreshes after applying', async () => {
    installEditor('gemstone://7/UserGlobals/Account/instance/accessing/at:?dict=2');
    vi.mocked(queries.analyzeChangeSignature).mockResolvedValue(analysis());
    vi.mocked(showChangeSignatureEditor).mockResolvedValue(edit);
    vi.mocked(queries.startChangeSignaturePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showChangeSignaturePanel).mockResolvedValue({ applied: 2, failed: [] });
    const refreshAfter = vi.fn();

    await changeSignatureCommand(sessionsWith(), refreshAfter);

    expect(queries.analyzeChangeSignature).toHaveBeenCalledWith(
      expect.anything(),
      'Account',
      'at:',
      false,
      2,
    );
    expect(refreshAfter).toHaveBeenCalledWith('at:', 'at:put:');
  });

  it('refuses to change the signature of a never-saved method', async () => {
    installEditor('gemstone://7/UserGlobals/Account/instance/accessing/new-method?dict=2');
    const refreshAfter = vi.fn();

    await changeSignatureCommand(sessionsWith(), refreshAfter);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Save the new method first'),
    );
    expect(queries.analyzeChangeSignature).not.toHaveBeenCalled();
  });
});
