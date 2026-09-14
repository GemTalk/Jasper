import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __resetConfig, __setConfig, TreeItemCollapsibleState } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider, GemStoneLoginItem, GemStoneSessionItem } from '../loginTreeProvider';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import type { ActiveSession, SessionManager } from '../sessionManager';
import {
  _resetAutoCommitStateForTests,
  forgetSessionAutoCommit,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from '../autoCommit/autoCommitState';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

function makeSession(login: GemStoneLogin, id: number): ActiveSession {
  return { id, login, stoneVersion: '3.7.2' } as unknown as ActiveSession;
}

// Minimal SessionManager stub: the provider reads getSessions()/selectedId and
// subscribes to onDidChangeSelection.
function stubSessionManager(
  sessions: ActiveSession[] = [],
  selectedId: number | null = null,
): SessionManager {
  return {
    onDidChangeSelection: vi.fn(),
    getSessions: () => sessions,
    selectedId,
  } as unknown as SessionManager;
}

describe('LoginTreeProvider', () => {
  let storage: LoginStorage;
  let provider: LoginTreeProvider;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
    provider = new LoginTreeProvider(storage);
  });

  describe('getChildren (roots)', () => {
    it('returns empty array when no logins', () => {
      expect(provider.getChildren()).toEqual([]);
    });

    it('returns a GemStoneLoginItem for each login', () => {
      __setConfig('gemstone', 'logins', [
        makeLogin({ label: 'Dev' }),
        makeLogin({ label: 'Prod' }),
      ]);
      const items = provider.getChildren();
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(GemStoneLoginItem);
      expect(items[1]).toBeInstanceOf(GemStoneLoginItem);
    });

    it('marks a connected root and expands it; leaves idle roots collapsible-none', () => {
      const dev = makeLogin({ label: 'Dev', stone: 'devstone' });
      const prod = makeLogin({ label: 'Prod', stone: 'prodstone' });
      __setConfig('gemstone', 'logins', [dev, prod]);
      provider = new LoginTreeProvider(storage, stubSessionManager([makeSession(prod, 1)]));

      const [devItem, prodItem] = provider.getChildren() as GemStoneLoginItem[];
      expect(devItem.contextValue).toBe('gemstoneLogin');
      expect(devItem.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(prodItem.contextValue).toBe('gemstoneLoginConnected');
      expect(prodItem.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    });
  });

  describe('getChildren (sessions under a login)', () => {
    it('returns the sessions started from that login', () => {
      const dev = makeLogin({ label: 'Dev', stone: 'devstone' });
      const prod = makeLogin({ label: 'Prod', stone: 'prodstone' });
      __setConfig('gemstone', 'logins', [dev, prod]);
      const sessions = [makeSession(prod, 1), makeSession(dev, 2)];
      provider = new LoginTreeProvider(storage, stubSessionManager(sessions, 2));

      const root = (provider.getChildren() as GemStoneLoginItem[])[0]; // dev
      const children = provider.getChildren(root) as GemStoneSessionItem[];
      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(GemStoneSessionItem);
      expect(children[0].activeSession.id).toBe(2);
    });

    it('returns no children when no SessionManager is supplied', () => {
      __setConfig('gemstone', 'logins', [makeLogin({ label: 'Dev' })]);
      const root = provider.getChildren()[0] as GemStoneLoginItem;
      expect(provider.getChildren(root)).toEqual([]);
    });

    // Regression: real VS Code config.get() returns a fresh deep copy on every
    // call, so the login object on a root item is never reference-equal to the
    // array fetched when expanding it. Grouping must key on position, not
    // identity, or expanded roots show a chevron with no children.
    it('finds children even though each getLogins() returns fresh copies', () => {
      const dev = makeLogin({ label: 'Dev', stone: 'devstone' });
      const prod = makeLogin({ label: 'Prod', stone: 'prodstone' });
      const freshCopyStorage = {
        getLogins: () => [{ ...dev }, { ...prod }], // new objects each call
      } as unknown as LoginStorage;
      provider = new LoginTreeProvider(
        freshCopyStorage,
        stubSessionManager([makeSession(prod, 1)], 1),
      );

      const [, prodRoot] = provider.getChildren() as GemStoneLoginItem[];
      const children = provider.getChildren(prodRoot) as GemStoneSessionItem[];
      expect(children.map((c) => c.activeSession.id)).toEqual([1]);
    });
  });

  describe('refresh', () => {
    it('fires onDidChangeTreeData event', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('subscribes to session selection changes', () => {
      const manager = stubSessionManager();
      new LoginTreeProvider(storage, manager);
      expect(manager.onDidChangeSelection).toHaveBeenCalled();
    });
  });
});

describe('GemStoneLoginItem', () => {
  it('sets label from login fields', () => {
    const item = new GemStoneLoginItem(
      makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db.example.com' }),
    );
    expect(item.label).toBe('Admin on prod (db.example.com)');
  });

  it('shows version as description', () => {
    const item = new GemStoneLoginItem(makeLogin({ version: '3.7.2' }));
    expect(item.description).toBe('3.7.2');
  });

  it('defaults to an idle, editable, leaf row', () => {
    const item = new GemStoneLoginItem(makeLogin());
    expect(item.contextValue).toBe('gemstoneLogin');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    expect(item.command).toEqual({
      command: 'gemstone.editLogin',
      title: 'Edit Login',
      arguments: [item],
    });
  });

  it('is a connected, expanded row that opens a read-only view when it has sessions', () => {
    const item = new GemStoneLoginItem(makeLogin(), 0, true);
    expect(item.contextValue).toBe('gemstoneLoginConnected');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(item.command).toEqual({
      command: 'gemstone.editLogin',
      title: 'View Login',
      arguments: [item],
    });
  });

  it('exposes its position via index', () => {
    const item = new GemStoneLoginItem(makeLogin(), 3);
    expect(item.index).toBe(3);
  });

  it('changes its id when it gains sessions so VS Code re-applies the expanded state', () => {
    const idle = new GemStoneLoginItem(makeLogin(), 0, false);
    const connected = new GemStoneLoginItem(makeLogin(), 0, true);
    expect(idle.id).not.toBe(connected.id);
  });

  it('stores the login data on the item', () => {
    const login = makeLogin({ stone: 'custom' });
    const item = new GemStoneLoginItem(login);
    expect(item.login).toEqual(login);
  });
});

describe('GemStoneSessionItem', () => {
  beforeEach(() => _resetAutoCommitStateForTests());

  it('describes the session and marks the selected one', () => {
    const session = makeSession(makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db' }), 3);
    const selected = new GemStoneSessionItem(session, true);
    expect(selected.label).toBe('Admin on prod (db)');
    expect(selected.description).toBe('Session 3 (3.7.2) · auto-commit off');
    expect(selected.contextValue).toBe('gemstoneSession');
    expect((selected.iconPath as { id: string }).id).toBe('debug-start');

    const idle = new GemStoneSessionItem(session, false);
    expect((idle.iconPath as { id: string }).id).toBe('plug');
  });

  // This row is the ONLY display of auto-commit (issue #254), so it speaks in both
  // directions: as one display among several, silence for "off" was fine; as the only one,
  // a row that says nothing does not read as off, it reads as a row that has not been told.
  it('says what auto-commit is doing, off included', () => {
    const session = makeSession(makeLogin(), 3);

    expect(new GemStoneSessionItem(session, false).description).toBe(
      'Session 3 (3.7.2) · auto-commit off',
    );

    registerSessionAutoCommit(3, true);
    expect(new GemStoneSessionItem(session, false).description).toBe(
      'Session 3 (3.7.2) · auto-commit ON',
    );

    setAutoCommitStatus(3, 'failed');
    expect(new GemStoneSessionItem(session, false).description).toBe(
      'Session 3 (3.7.2) · auto-commit FAILED',
    );
  });

  it('reads its own session, never another one', () => {
    const session = makeSession(makeLogin(), 3);
    registerSessionAutoCommit(4, true);
    expect(new GemStoneSessionItem(session, false).description).toBe(
      'Session 3 (3.7.2) · auto-commit off',
    );

    registerSessionAutoCommit(3, true);
    forgetSessionAutoCommit(3);
    expect(new GemStoneSessionItem(session, false).description).toBe(
      'Session 3 (3.7.2) · auto-commit off',
    );
  });

  it('tints the icon for the two states worth catching, and leaves off plain', () => {
    const session = makeSession(makeLogin(), 3);
    const colorOf = (item: GemStoneSessionItem) =>
      (item.iconPath as { color?: { id: string } }).color?.id;

    expect(colorOf(new GemStoneSessionItem(session, false))).toBeUndefined();

    registerSessionAutoCommit(3, true);
    expect(colorOf(new GemStoneSessionItem(session, false))).toBe('problemsWarningIcon.foreground');

    setAutoCommitStatus(3, 'failed');
    expect(colorOf(new GemStoneSessionItem(session, false))).toBe('problemsErrorIcon.foreground');
  });

  it('keeps the icon SHAPE for the selection, so colour and shape say different things', () => {
    const session = makeSession(makeLogin(), 3);
    registerSessionAutoCommit(3, true);

    const selected = new GemStoneSessionItem(session, true).iconPath as { id: string };
    const idle = new GemStoneSessionItem(session, false).iconPath as { id: string };
    expect(selected.id).toBe('debug-start');
    expect(idle.id).toBe('plug');
  });

  it('spells out in the tooltip what the armed state costs — Abort stops being a way back', () => {
    const session = makeSession(makeLogin(), 3);
    registerSessionAutoCommit(3, true);
    expect(String(new GemStoneSessionItem(session, false).tooltip)).toMatch(
      /Abort will not take one back/,
    );

    setAutoCommitStatus(3, 'failed');
    expect(String(new GemStoneSessionItem(session, false).tooltip)).toMatch(
      /NOT in the repository/,
    );
  });
});
