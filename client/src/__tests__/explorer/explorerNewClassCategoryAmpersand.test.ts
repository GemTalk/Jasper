import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { ExplorerController } from '../../gemstoneExplorer';
import { parseUri } from '../../gemstoneFileSystemProvider';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * New Class carries the selected class category in the template URI's query, which
 * `vscode.Uri.parse` decodes before `parseUri` reads it. An `&` in the category then
 * looked like a parameter separator: the category was cut short at the `&`, and the
 * rest stayed in the query as parameters of its own.
 * https://github.com/GemTalk/Jasper/issues/744
 */

function newClassUriFor(category: string): vscode.Uri {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 2;
  ctl.state.classCategory = category;
  ctl.newClass();
  const call = vi
    .mocked(vscode.commands.executeCommand)
    .mock.calls.find(([command]) => command === 'gemstone.openDocument');
  expect(call).toBeDefined();
  return call![1] as vscode.Uri;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('New Class keeps a selected class category that contains "&"', () => {
  it('reads back the whole category, not just the part before the "&"', () => {
    const parsed = parseUri(newClassUriFor('Logical & Bits'));
    expect(parsed).toMatchObject({ kind: 'new-class', category: 'Logical & Bits' });
  });

  it('does not turn the text after the "&" into a URI parameter', () => {
    const uri = newClassUriFor('a&dict=9');
    expect(parseUri(uri)).toMatchObject({ kind: 'new-class', category: 'a&dict=9' });
    expect(uri.query.split('&')).toHaveLength(1);
  });
});
