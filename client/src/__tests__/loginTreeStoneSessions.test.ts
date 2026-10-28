import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { fakeSecretStorage } from './support/secretStorage';
import { GemStoneLoginItem, GemStoneSessionItem, LoginTreeProvider } from '../loginTreeProvider';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import type { ActiveSession, SessionManager } from '../sessionManager';
import type { StoneSession, StoneSessionList } from '../stoneSessions';
import {
  StoneSessionRowItem,
  StoneSessionsItem,
  StoneSessionsMessageItem,
} from '../stoneSessionsView';

const dev: GemStoneLogin = { ...DEFAULT_LOGIN, label: 'Dev', stone: 'devstone' };

function makeSession(id: number): ActiveSession {
  return { id, login: dev, stoneVersion: '3.7.5' } as unknown as ActiveSession;
}

function stoneSession(overrides: Partial<StoneSession>): StoneSession {
  return {
    id: 1,
    serial: 1,
    user: 'DataCurator',
    gemPid: 100,
    host: 'localhost',
    loggedInAt: 0,
    transaction: 'out',
    holdsOldestCommitRecord: false,
    ...overrides,
  };
}

describe('All sessions on a stone, in Logins & Sessions', () => {
  let sessions: ActiveSession[];
  let list: StoneSessionList;
  let stuck: Set<number>;
  let read: ReturnType<typeof vi.fn<(through: ActiveSession) => StoneSessionList>>;
  let provider: LoginTreeProvider;

  beforeEach(() => {
    __resetConfig();
    __setConfig('gemstone', 'logins', [dev]);
    sessions = [makeSession(1)];
    stuck = new Set();
    list = {
      kind: 'sessions',
      serverNow: 7200,
      commitRecordBacklog: 1,
      abortThreshold: 20,
      sessions: [
        stoneSession({ id: 4, serial: 3, gemPid: 41022 }),
        stoneSession({ id: 5, serial: 9, user: 'ewinger', gemPid: 39811, host: 'thor' }),
        stoneSession({ id: 2, serial: 1, user: 'SymbolUser', systemGem: 'symbolgem' }),
      ],
    };
    read = vi.fn(() => list);
    const manager = {
      onDidChangeSelection: vi.fn(),
      onDidChangeTransactionState: vi.fn(),
      getSessions: () => sessions,
      selectedId: 1,
    } as unknown as SessionManager;
    provider = new LoginTreeProvider(new LoginStorage(fakeSecretStorage()), manager, undefined, {
      read,
      stuck: (s) => stuck.has(s.id),
      // Jasper session 1 is GemStone's session 4.
      serverSessionOf: (id) => (id === 1 ? '4' : undefined),
      isLocalGemHost: (host) => host === 'localhost',
    });
  });

  const listNode = () => {
    const [login] = provider.getChildren() as GemStoneLoginItem[];
    return provider.getChildren(login).find((n) => n instanceof StoneSessionsItem)!;
  };
  const rows = () => provider.getChildren(listNode()) as StoneSessionRowItem[];
  const listed = () => list as Extract<StoneSessionList, { kind: 'sessions' }>;

  it('hangs under a connected login, after its own sessions, without reading anything', () => {
    const [login] = provider.getChildren() as GemStoneLoginItem[];
    const children = provider.getChildren(login);

    expect(children[0]).toBeInstanceOf(GemStoneSessionItem);
    expect(children[1]).toBeInstanceOf(StoneSessionsItem);
    expect(children[1].label).toBe('All sessions on devstone');
    expect(read).not.toHaveBeenCalled();
  });

  it('is not shown under a login with no session', () => {
    sessions = [];
    const [login] = provider.getChildren() as GemStoneLoginItem[];
    expect(provider.getChildren(login)).toEqual([]);
  });

  it('reads the list on expand, through a session of the login, then keeps it', () => {
    expect(rows()).toHaveLength(3);
    expect(read).toHaveBeenCalledWith(sessions[0]);
    rows();
    expect(read).toHaveBeenCalledTimes(1);
    expect(listNode().description).toBe('3');
  });

  it('reads it again on Refresh, and after it was collapsed', () => {
    rows();
    provider.refreshStoneSessions(listNode());
    rows();
    provider.forgetStoneSessions(listNode());
    rows();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('forgets the list when the login logs out', () => {
    rows();
    sessions = [];
    provider.getChildren();
    sessions = [makeSession(1)];
    rows();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shows each session's user, gem, host and age", () => {
    const ewinger = rows()[1];
    expect(ewinger.label).toBe('ewinger');
    expect(ewinger.description).toBe('gem 39811 · thor · 2h');
  });

  it("marks this window's own session, and offers Stop only on other people's", () => {
    const [mine, other, system] = rows();
    expect(mine.description).toContain('Jasper session 1');
    expect(mine.contextValue).toBe('stoneSession');
    expect(other.contextValue).toBe('stoneSession.canStop');
    expect(system.description).toContain('system: symbolgem');
    expect(system.contextValue).toBe('stoneSession');
  });

  it("offers Kill on another session whose gem is on this machine, never on GemStone's own", () => {
    listed().sessions[1].host = 'localhost';

    const [, other, system] = rows();

    expect(other.contextValue).toBe('stoneSession.canStop.canKill');
    expect(system.contextValue).toBe('stoneSession');
  });

  it("offers Kill on this window's own session only once a stopped run holds it", () => {
    const idle = rows()[0];
    stuck.add(1);

    const held = rows()[0];

    expect(idle.contextValue).toBe('stoneSession');
    expect(held.contextValue).toBe('stoneSession.canKill');
  });

  it('flags the session holding the oldest commit record once the stone asks for aborts', () => {
    listed().sessions[1].holdsOldestCommitRecord = true;
    const underThreshold = rows()[1];
    provider.refreshStoneSessions(listNode());
    list = { ...listed(), commitRecordBacklog: 20 };

    const holder = rows()[1];

    expect(underThreshold.description).not.toContain('⧗');
    expect(holder.description).toContain('⧗ holds the oldest commit record');
    expect((holder.tooltip as { value: string }).value).toContain(
      'oldest of the 20 commit records',
    );
    expect(rows()[0].description).not.toContain('⧗');
  });

  it("finds the row of this window's session, read fresh, and its way back up the tree", () => {
    rows();
    const row = provider.stoneSessionRowOf(sessions[0])!;
    expect(row.stoneSession.id).toBe(4);
    expect(read).toHaveBeenCalledTimes(2);

    const node = provider.getParent(row) as StoneSessionsItem;
    expect(node).toBeInstanceOf(StoneSessionsItem);
    expect(provider.getParent(node)).toBeInstanceOf(GemStoneLoginItem);
  });

  it('finds no row for a session the list does not show', () => {
    expect(provider.stoneSessionRowOf(makeSession(2))).toBeUndefined();
  });

  it('flags a session still running a run its user stopped, and redraws when that ends', () => {
    stuck.add(1);
    const flagged = rows()[0];
    expect(flagged.description).toContain('⚠ still running a stopped run');

    stuck.delete(1);
    const cleared = rows()[0];
    expect(cleared.description).not.toContain('⚠');
    expect(cleared.id).not.toBe(flagged.id);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('says why the list is empty for a login without SessionAccess', () => {
    list = { kind: 'noAccess' };
    const [message] = provider.getChildren(listNode());
    expect(message).toBeInstanceOf(StoneSessionsMessageItem);
    expect(message.label).toBe('Seeing other sessions needs the SessionAccess privilege');
  });

  it('says the list could not be read, rather than showing none', () => {
    read.mockImplementation(() => {
      throw new Error('the network went away');
    });
    const [message] = provider.getChildren(listNode());
    expect(message.label).toBe('Could not read the sessions');
    expect(message.tooltip).toBe('the network went away');
  });
});
