import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in the whole query module; nothing here reaches the stone.
vi.mock('../../browserQueries', () => ({}));
vi.mock('../../fileIn', () => ({ fileInCommand: vi.fn() }));

import { ExplorerController } from '../../gemstoneExplorer';
import { fileInCommand } from '../../fileIn';
import type * as vscode from 'vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * File In, reached from the GemStone Explorer (issue #539).
 *
 * File Out lives on Explorer rows; File In lived in another view entirely, so the way
 * back in was a button in Logins & Sessions or palette wording you had to know. What
 * matters here is which session it lands in: the Explorer is already showing one, so
 * passing it is what keeps the "which session?" prompt away — and passing the wrong
 * thing (or nothing) brings the prompt back with nothing else looking wrong.
 */

const SESSION = { id: 7 } as ActiveSession;

function makeController(session: ActiveSession | undefined, store?: vscode.Memento) {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  return new ExplorerController(sessionManager, undefined, undefined, store);
}

describe('ExplorerController.fileIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files into the session the Explorer is showing, without asking which', () => {
    const ctl = makeController(SESSION);

    void ctl.fileIn();

    expect(fileInCommand).toHaveBeenCalledWith(expect.anything(), undefined, SESSION);
  });

  it('hands over the remembered directory, so File Out and File In share one', () => {
    const store = {} as vscode.Memento;
    const ctl = makeController(SESSION, store);

    void ctl.fileIn();

    expect(fileInCommand).toHaveBeenCalledWith(expect.anything(), store, SESSION);
  });

  it('leaves the choice open when nothing is connected, rather than refusing', () => {
    // No session to name, so no session is named: fileInUris then asks, which is the
    // same thing every other route with no row does. Refusing here would make the
    // Explorer the one place File In cannot start from.
    const ctl = makeController(undefined);

    void ctl.fileIn();

    expect(fileInCommand).toHaveBeenCalledWith(expect.anything(), undefined, undefined);
  });
});
