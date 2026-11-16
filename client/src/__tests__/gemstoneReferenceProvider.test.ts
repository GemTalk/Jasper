import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', async (orig) => ({
  BrowserQueryError: (await orig<typeof import('../browserQueries')>()).BrowserQueryError,
  sendersOf: vi.fn(() => []),
  sendersOfAsync: vi.fn(async () => []),
}));
vi.mock('../gciLog', () => ({ logError: vi.fn() }));

import { Position, Location, Uri, __setConfig, __resetConfig } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneReferenceProvider } from '../gemstoneReferenceProvider';
import { SelectorResolver } from '../selectorProviders';
import { SessionManager } from '../sessionManager';
import { BrowserQueryError, sendersOf, sendersOfAsync } from '../browserQueries';
import { logError } from '../gciLog';
import { NbCancelledError } from '../nbRunner';
import { fakeActiveSession } from './fakeActiveSession';

const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;
const mockSendersOf = vi.mocked(sendersOfAsync);

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
    vi.mocked(logError).mockClear();
    mockSendersOf.mockResolvedValue([]);
  });

  it('lists the stone’s senders of the selector, one location per method', async () => {
    mockSendersOf.mockResolvedValue([sender('Object'), sender('Array')]);
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
    expect(sendersOf).not.toHaveBeenCalled();
  });

  it('lists a method found again in another environment once per environment', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    mockSendersOf.mockImplementation(async (_s, _sel, env) => [sender('Object', env)]);
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

  it('answers nothing, and asks no further environment, once VS Code cancels the request', async () => {
    __setConfig('gemstone', 'maxEnvironment', 3);
    const token = { isCancellationRequested: false };
    mockSendersOf.mockImplementation(async (_s, _sel, env) => {
      token.isCancellationRequested = true;
      return [sender('Object', env)];
    });
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    const results = await provider.provideReferences(
      document(),
      pos(2, 12),
      { includeDeclaration: true },
      token as unknown as vscode.CancellationToken,
    );

    expect(mockSendersOf).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);
  });

  it('keeps what earlier environments found, and asks no more, once one fails', async () => {
    __setConfig('gemstone', 'maxEnvironment', 3);
    mockSendersOf.mockImplementation(async (_s, _sel, env) => {
      if (env === 1) throw new Error('session busy');
      return [sender('Object', env)];
    });
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    const results = await provider.provideReferences(document(), pos(2, 12));

    expect(mockSendersOf.mock.calls.map((c) => c[2])).toEqual([0, 1]);
    expect(results).toHaveLength(1);
  });

  it('logs a failure nothing else reported', async () => {
    mockSendersOf.mockRejectedValue(new Error('poll failed'));
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    expect(await provider.provideReferences(document(), pos(2, 12))).toEqual([]);
    expect(logError).toHaveBeenCalledWith(1, 'Find All References: poll failed');
  });

  it.each([
    ['a query failure, logged where it was raised', new BrowserQueryError('busy', 2203)],
    ['a cancel', new NbCancelledError()],
  ])('adds no log line for %s', async (_what, error) => {
    mockSendersOf.mockRejectedValue(error);
    const provider = new GemStoneReferenceProvider(makeSessionManager(true), resolving('size'));

    await provider.provideReferences(document(), pos(2, 12));

    expect(logError).not.toHaveBeenCalled();
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
