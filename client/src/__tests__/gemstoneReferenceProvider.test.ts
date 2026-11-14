import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  sendersOf: vi.fn(() => []),
}));

import { Position, Location, Uri, __setConfig, __resetConfig } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneReferenceProvider } from '../gemstoneReferenceProvider';
import { SelectorResolver } from '../gemstoneDefinitionProvider';
import { SessionManager } from '../sessionManager';
import { sendersOf } from '../browserQueries';
import { fakeActiveSession } from './fakeActiveSession';

const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;
const mockSendersOf = vi.mocked(sendersOf);

const fakeSession = (id: number) =>
  fakeActiveSession({ id, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' });

// Session 1 is selected; `others` are logged in alongside it.
function makeSessionManager(hasSession: boolean, others: number[] = []) {
  const selected = hasSession ? fakeSession(1) : undefined;
  const sessions = [...(selected ? [selected] : []), ...others.map(fakeSession)];
  return {
    getSelectedSession: vi.fn(() => selected),
    getSessions: vi.fn(() => sessions),
  } as unknown as SessionManager;
}

const stoneMethod = 'gemstone://1/Globals/Object/instance/Accessing/recursiveSizeReport';
const document = (uri = stoneMethod) => ({ uri: Uri.parse(uri) }) as unknown as vscode.TextDocument;
const resolving = (selector: string | null): SelectorResolver => ({
  getSelector: vi.fn(async () => selector),
});

const sender = (className: string, environmentId = 0) => ({
  dictName: 'Globals',
  className,
  isMeta: false,
  selector: 'recursiveSizeReport',
  category: 'Accessing',
  environmentId,
});

describe('GemStoneReferenceProvider', () => {
  beforeEach(() => {
    __resetConfig();
    mockSendersOf.mockReset();
    mockSendersOf.mockReturnValue([]);
  });

  it('lists the stone’s senders of the selector, one location per method', async () => {
    mockSendersOf.mockReturnValue([sender('Object'), sender('Array')]);
    const provider = new GemStoneReferenceProvider(
      makeSessionManager(true),
      resolving('recursiveSize'),
    );

    const results = await provider.provideReferences(document(), pos(2, 12));

    expect(mockSendersOf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'recursiveSize',
      0,
    );
    expect(results.map((l) => l.uri.toString())).toEqual([
      expect.stringMatching(/^gemstone:\/\/1\/Globals\/Object\/instance\/Accessing\//),
      expect.stringMatching(/^gemstone:\/\/1\/Globals\/Array\/instance\/Accessing\//),
    ]);
    expect(results[0]).toBeInstanceOf(Location);
  });

  it('lists a method found again in another environment once per environment', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    mockSendersOf.mockImplementation((_s, _sel, env) => [sender('Object', env)]);
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    const results = await provider.provideReferences(document(), pos(2, 12));

    expect(mockSendersOf.mock.calls.map((c) => c[2])).toEqual([0, 1]);
    expect(results).toHaveLength(2);
  });

  it('asks the session a stone method was opened from, not the selected one', async () => {
    const provider = new GemStoneReferenceProvider(
      makeSessionManager(true, [2]),
      resolving('size'),
    );

    await provider.provideReferences(
      document('gemstone://2/Globals/Object/instance/Accessing/recursiveSizeReport'),
      pos(2, 12),
    );

    expect(mockSendersOf).toHaveBeenCalled();
    expect(mockSendersOf.mock.calls.every(([s]) => s.id === 2)).toBe(true);
  });

  it('asks the selected session from a file on disk', async () => {
    const provider = new GemStoneReferenceProvider(
      makeSessionManager(true, [2]),
      resolving('size'),
    );

    await provider.provideReferences(document('file:///project/kernel.gs'), pos(2, 12));

    expect(mockSendersOf.mock.calls.every(([s]) => s.id === 1)).toBe(true);
  });

  it('answers nothing, without asking the stone, when the cursor is on no selector', async () => {
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving(null));

    expect(await provider.provideReferences(document(), pos(1, 4))).toEqual([]);
    expect(mockSendersOf).not.toHaveBeenCalled();
  });

  it('answers nothing for a stone method whose session has logged out', async () => {
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    const results = await provider.provideReferences(
      document('gemstone://2/Globals/Object/instance/Accessing/recursiveSizeReport'),
      pos(2, 12),
    );

    expect(results).toEqual([]);
    expect(mockSendersOf).not.toHaveBeenCalled();
  });

  it('answers nothing while the language server is not ready', async () => {
    const resolver: SelectorResolver = {
      getSelector: vi.fn(async () => {
        throw new Error('not ready');
      }),
    };
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolver);

    expect(await provider.provideReferences(document(), pos(2, 12))).toEqual([]);
  });
});
