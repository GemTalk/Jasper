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
    });
  });

  const listNode = () => {
    const [login] = provider.getChildren() as GemStoneLoginItem[];
    return provider.getChildren(login).find((n) => n instanceof StoneSessionsItem)!;
  };
  const rows = () => provider.getChildren(listNode()) as StoneSessionRowItem[];

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
