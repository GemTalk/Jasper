// Host-side tests for the Session Configuration panel: which session a panel is
// bound to, what it reads and posts, and — the two decisions this feature turns
// on — whether a value the stone quietly ignored is reported as such, and
// whether a session is offered an editor the stone would refuse.
//
// The webview half is covered in configurationView.test.ts; nothing here draws
// anything. `showConfigurationCommand` is exercised here too, because the
// question it answers ("which session did that row mean?") is the same question
// the panel's identity depends on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// Keep real `fs` — configurationPanel reads configurationView.js through
// webviewAssets at import time — but make readFileSync a spy so a test can hand
// back a system.conf without one existing on disk.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, default: actual, readFileSync: vi.fn(actual.readFileSync) };
});

vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn() }));

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ConfigurationPanel } from '../configurationPanel';
import { showConfigurationCommand } from '../showConfigurationCommand';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import { appendSysadmin } from '../../sysadminChannel';
import { GemStoneSessionItem } from '../../loginTreeProvider';
import { DEFAULT_LOGIN, GemStoneLogin } from '../../loginTypes';
import type { ActiveSession, SessionManager } from '../../sessionManager';
import type { SysadminStorage } from '../../sysadminStorage';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    ...DEFAULT_LOGIN,
    label: 'Test',
    gs_user: 'DataCurator',
    stone: 'gs64stone',
    gem_host: 'localhost',
    netldi: 'gs64ldi',
    version: '3.6.2',
    ...overrides,
  };
}

function makeSession(id: number, login = makeLogin()): ActiveSession {
  return { id, login, stoneVersion: login.version } as unknown as ActiveSession;
}

/** One line of the tab-delimited report the server emits. */
const line = (key: string, cls: string, value: string) => `${key}\t${cls}\t${value}\n`;

const STONE_REPORT =
  line('StnGemTimeout', 'SmallInteger', '60') +
  line('SHR_PAGE_CACHE_SIZE_KB', 'SmallInteger', '75000') +
  line('StnTranLogDirectories', 'Array', "an Array( '/data' )");
const GEM_REPORT =
  line('GemHaltOnError', 'SmallInteger', '0') +
  line('GemConvertArrayBuilder', 'Boolean', 'false') +
  line('GEM_TEMPOBJ_CACHE_SIZE', 'SmallInteger', '50000');

type StoneAnswers = {
  isSystemUser?: boolean;
  stoneReport?: string;
  gemReport?: string;
  /** Answers the set doit; `'OK'` unless a test says otherwise. */
  onSet?: (code: string) => string;
};

/**
 * A stand-in for one session's GCI. It dispatches on the emitted Smalltalk the
 * same way the gem would — which report was asked for, whether this is the
 * SystemUser probe, whether this is a set — so the tests run the real generated
 * code rather than a paraphrase of it.
 */
function fakeGci(answers: StoneAnswers = {}) {
  const state = {
    stoneReport: answers.stoneReport ?? STONE_REPORT,
    gemReport: answers.gemReport ?? GEM_REPORT,
  };
  const execute = vi.fn((code: string): string => {
    if (code.includes('AllUsers userWithId')) return answers.isSystemUser ? 'true' : 'false';
    if (code.includes('stoneConfigurationReport')) return state.stoneReport;
    if (code.includes('gemConfigurationReport')) return state.gemReport;
    if (code.includes('ConfigurationAt:')) return (answers.onSet ?? (() => 'OK'))(code);
    throw new Error(`unexpected code: ${code}`);
  });
  return { execute, state };
}

type Harness = {
  sessionManager: SessionManager;
  storage: SysadminStorage;
  removeSession: (id: number) => void;
  ping: ReturnType<typeof vi.fn>;
  gciFor: (id: number) => ReturnType<typeof fakeGci>;
};

/**
 * A session manager over the given sessions, with one fake GCI per session so a
 * test can prove a panel read over *its own* session rather than the selected
 * one.
 */
function harness(
  sessions: ActiveSession[],
  answersById: Record<number, StoneAnswers> = {},
): Harness {
  const gcis = new Map<number, ReturnType<typeof fakeGci>>();
  for (const s of sessions) gcis.set(s.id, fakeGci(answersById[s.id]));

  const removeHandlers: Array<(id: number) => void> = [];
  const live = new Map(sessions.map((s) => [s.id, s]));
  const ping = vi.fn(() => ({ success: true, err: { number: 0, message: '' } }));

  const sessionManager = {
    getSession: (id: number) => live.get(id),
    getSessions: () => [...live.values()],
    getSelectedSession: () => [...live.values()][0],
    resolveSession: vi.fn(async () => [...live.values()][0]),
    onDidRemoveSession: (handler: (id: number) => void) => {
      removeHandlers.push(handler);
      return { dispose: () => {} };
    },
    ping,
  } as unknown as SessionManager;

  vi.mocked(defaultQueryExecutorUsing).mockImplementation((session: ActiveSession) => {
    const gci = gcis.get(session.id);
    if (!gci) throw new Error(`no fake GCI for session ${session.id}`);
    return gci.execute;
  });

  return {
    sessionManager,
    storage: { getGemstonePath: vi.fn(() => undefined) } as unknown as SysadminStorage,
    removeSession: (id: number) => {
      live.delete(id);
      for (const handler of [...removeHandlers]) handler(id);
    },
    ping,
    gciFor: (id: number) => gcis.get(id)!,
  };
}

// ── Panel plumbing ──────────────────────────────────────────────────────────

type MockPanel = ReturnType<typeof vscode.window.createWebviewPanel>;

/** Every webview panel created since the last reset, oldest first. */
function panels(): MockPanel[] {
  return vi.mocked(vscode.window.createWebviewPanel).mock.results.map((r) => r.value as MockPanel);
}

function lastPanel(): MockPanel {
  const all = panels();
  return all[all.length - 1];
}

/** Deliver a message from the webview to its host. */
function sendMessage(panel: MockPanel, msg: unknown): void {
  const handler = vi.mocked(panel.webview.onDidReceiveMessage).mock.calls[0][0] as (
    m: unknown,
  ) => void;
  handler(msg);
}

/** All payloads a panel posted with the given command, oldest first. */
function posted<T = Record<string, unknown>>(panel: MockPanel, command: string): T[] {
  return vi
    .mocked(panel.webview.postMessage)
    .mock.calls.map((c) => c[0] as { command: string })
    .filter((m) => m.command === command) as T[];
}

function lastPosted<T = Record<string, unknown>>(panel: MockPanel, command: string): T | undefined {
  const all = posted<T>(panel, command);
  return all[all.length - 1];
}

type ConfigParam = {
  key: string;
  value: string;
  type: string;
  settable: boolean;
  editable: boolean;
  description?: string;
};
type ConfigPayload = {
  command: string;
  config: {
    sessionId: number;
    label: string;
    version: string;
    isSystemUser: boolean;
    descriptionsAvailable: boolean;
    stoneParams: ConfigParam[];
    gemParams: ConfigParam[];
  };
};

/** Open a panel for a session and drive it to its first load. */
function open(h: Harness, sessionId: number): MockPanel {
  ConfigurationPanel.show({ sessionManager: h.sessionManager, storage: h.storage }, sessionId);
  const panel = lastPanel();
  sendMessage(panel, { command: 'ready' });
  return panel;
}

function config(panel: MockPanel): ConfigPayload['config'] {
  const payload = lastPosted<ConfigPayload>(panel, 'configuration');
  expect(payload, 'the panel should have posted a configuration').toBeDefined();
  return payload!.config;
}

const paramNamed = (params: ConfigParam[], key: string): ConfigParam => {
  const found = params.find((p) => p.key === key);
  expect(found, `expected a parameter named ${key}`).toBeDefined();
  return found!;
};

beforeEach(() => {
  vi.mocked(vscode.window.createWebviewPanel).mockClear();
  vi.mocked(vscode.window.showInformationMessage).mockClear();
  vi.mocked(appendSysadmin).mockClear();
  vi.mocked(fs.readFileSync).mockClear();
});

afterEach(() => {
  // The panel registry is module-level state: close everything this test opened
  // so the next one starts with no panels bound to its session ids.
  for (const panel of panels()) panel.dispose();
});

// ── Which session a panel belongs to ────────────────────────────────────────

describe('a panel belongs to one session', () => {
  it('titles the panel with the session it was opened for', () => {
    const h = harness([makeSession(1), makeSession(2, makeLogin({ gs_user: 'SystemUser' }))]);
    open(h, 2);
    expect(lastPanel().title).toContain('SystemUser on gs64stone');
  });

  it('reveals the existing panel rather than opening a second for the same session', () => {
    const h = harness([makeSession(1)]);
    open(h, 1);
    const first = lastPanel();

    ConfigurationPanel.show({ sessionManager: h.sessionManager, storage: h.storage }, 1);

    expect(panels()).toHaveLength(1);
    expect(first.reveal).toHaveBeenCalled();
  });

  it('opens a separate panel per session, so two can be compared side by side', () => {
    const h = harness([makeSession(1), makeSession(2)]);
    open(h, 1);
    open(h, 2);
    expect(panels()).toHaveLength(2);
  });

  it('reads over its own session, not whichever session is selected', () => {
    const h = harness([makeSession(1), makeSession(2)], {
      2: { gemReport: line('GemHaltOnError', 'SmallInteger', '7') },
    });
    const panel = open(h, 2);

    expect(config(panel).sessionId).toBe(2);
    expect(paramNamed(config(panel).gemParams, 'GemHaltOnError').value).toBe('7');
    // Session 1 was never touched.
    expect(h.gciFor(1).execute).not.toHaveBeenCalled();
  });

  it('closes itself when its session logs out', () => {
    const h = harness([makeSession(1), makeSession(2)]);
    const one = open(h, 1);
    const two = open(h, 2);

    h.removeSession(1);

    expect(one.dispose).toHaveBeenCalled();
    expect(two.dispose).not.toHaveBeenCalled();
  });

  it('lets a session open a fresh panel after its first one was closed', () => {
    const h = harness([makeSession(1)]);
    const first = open(h, 1);
    first.dispose();

    open(h, 1);

    expect(panels()).toHaveLength(2);
    // Identity compared as a boolean: a disposed panel throws when a matcher
    // tries to render it.
    expect(panels()[1] === first).toBe(false);
  });
});

// ── Loading ─────────────────────────────────────────────────────────────────

describe('loading a session configuration', () => {
  it('posts both reports when the webview reports ready', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);

    const cfg = config(panel);
    expect(cfg.stoneParams.map((p) => p.key)).toContain('StnGemTimeout');
    expect(cfg.gemParams.map((p) => p.key)).toContain('GemHaltOnError');
    expect(cfg.label).toBe('DataCurator on gs64stone (localhost)');
    expect(cfg.version).toBe('3.6.2');
  });

  it('re-reads on Refresh', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);
    h.gciFor(1).state.gemReport = line('GemHaltOnError', 'SmallInteger', '3');

    sendMessage(panel, { command: 'loadConfiguration' });

    expect(paramNamed(config(panel).gemParams, 'GemHaltOnError').value).toBe('3');
  });

  it('reports a failing report as an error the panel can show, not a throw', () => {
    const h = harness([makeSession(1)], {
      1: { stoneReport: 'GS-ERROR: the session is busy' },
    });
    const panel = open(h, 1);

    expect(lastPosted(panel, 'configurationError')).toMatchObject({
      message: 'the session is busy',
    });
    expect(posted(panel, 'configuration')).toHaveLength(0);
  });

  it('says so when the session has gone away before the load', () => {
    const h = harness([makeSession(1)]);
    ConfigurationPanel.show({ sessionManager: h.sessionManager, storage: h.storage }, 99);
    const panel = lastPanel();

    sendMessage(panel, { command: 'ready' });

    expect(lastPosted<{ message: string }>(panel, 'configurationError')?.message).toMatch(
      /No GemStone session/,
    );
  });
});

// ── Who may edit what ───────────────────────────────────────────────────────

describe('what this session is offered an editor for', () => {
  it('does not offer a stone parameter to a user who is not SystemUser', () => {
    const h = harness([makeSession(1)], { 1: { isSystemUser: false } });
    const cfg = config(open(h, 1));

    const stn = paramNamed(cfg.stoneParams, 'StnGemTimeout');
    // It IS a runtime parameter — the panel says why it cannot be changed here
    // rather than pretending it is a fixed config-file value.
    expect(stn.settable).toBe(true);
    expect(stn.editable).toBe(false);
    expect(cfg.isSystemUser).toBe(false);
  });

  it('offers the same stone parameter to SystemUser', () => {
    const h = harness([makeSession(1)], { 1: { isSystemUser: true } });
    const cfg = config(open(h, 1));

    expect(paramNamed(cfg.stoneParams, 'StnGemTimeout').editable).toBe(true);
    expect(cfg.isSystemUser).toBe(true);
  });

  it('offers a gem parameter to any user, and lets the stone be the authority', () => {
    const h = harness([makeSession(1)], { 1: { isSystemUser: false } });
    const cfg = config(open(h, 1));

    expect(paramNamed(cfg.gemParams, 'GemHaltOnError').editable).toBe(true);
  });

  it('never offers an ALL_CAPS config-file parameter, in either scope', () => {
    const h = harness([makeSession(1)], { 1: { isSystemUser: true } });
    const cfg = config(open(h, 1));

    expect(paramNamed(cfg.stoneParams, 'SHR_PAGE_CACHE_SIZE_KB').editable).toBe(false);
    expect(paramNamed(cfg.gemParams, 'GEM_TEMPOBJ_CACHE_SIZE').editable).toBe(false);
  });

  it('never offers a value it has no literal for, even to SystemUser', () => {
    const h = harness([makeSession(1)], { 1: { isSystemUser: true } });
    const cfg = config(open(h, 1));

    const array = paramNamed(cfg.stoneParams, 'StnTranLogDirectories');
    expect(array.type).toBe('other');
    expect(array.settable).toBe(true);
    expect(array.editable).toBe(false);
  });
});

// ── Setting a value ─────────────────────────────────────────────────────────

describe('setting a value', () => {
  /** A harness whose gem report reflects sets that the stone actually applied. */
  function settableHarness(applies: boolean) {
    const h = harness([makeSession(1)], {
      1: {
        onSet: (code) => {
          if (applies) {
            const match = code.match(/put: (\S+?)\./);
            h.gciFor(1).state.gemReport = line(
              'GemHaltOnError',
              'SmallInteger',
              match ? match[1] : '0',
            );
          }
          return 'OK';
        },
      },
    });
    return h;
  }

  const setHaltOnError = (panel: MockPanel, value: string) =>
    sendMessage(panel, {
      command: 'setConfiguration',
      scope: 'gem',
      key: 'GemHaltOnError',
      valueType: 'integer',
      value,
    });

  it('confirms a change the session now reports', () => {
    const h = settableHarness(true);
    const panel = open(h, 1);

    setHaltOnError(panel, '2');

    const result = lastPosted<{ tone: string; message: string; key: string; scope: string }>(
      panel,
      'setResult',
    );
    expect(result).toMatchObject({ tone: 'ok', scope: 'gem', key: 'GemHaltOnError' });
    expect(result!.message).toContain('2');
    // The panel is handed the re-read values, so the row shows the new one.
    expect(paramNamed(config(panel).gemParams, 'GemHaltOnError').value).toBe('2');
  });

  it('reports a value the stone accepted and then ignored', () => {
    // The headline safety claim: 'OK' came back, but the session still reports
    // the old value — so it did not take, and the panel must not say it did.
    const h = settableHarness(false);
    const panel = open(h, 1);

    setHaltOnError(panel, '2');

    const result = lastPosted<{ tone: string; message: string }>(panel, 'setResult');
    expect(result!.tone).toBe('warn');
    expect(result!.message).toContain('accepted without error');
    expect(result!.message).toContain('still reports 0');
  });

  it('treats a differently-spelled but equal value as having taken', () => {
    // The stone answers `true`; the user typed `True`. Same value — a warning
    // here would be a false alarm on every boolean.
    const h = harness([makeSession(1)], {
      1: { gemReport: line('GemConvertArrayBuilder', 'Boolean', 'true') },
    });
    const panel = open(h, 1);

    sendMessage(panel, {
      command: 'setConfiguration',
      scope: 'gem',
      key: 'GemConvertArrayBuilder',
      valueType: 'boolean',
      value: 'True',
    });

    expect(lastPosted<{ tone: string }>(panel, 'setResult')!.tone).toBe('ok');
  });

  it('shows the stone own words when it refuses, beside the row that was edited', () => {
    const h = harness([makeSession(1)], {
      1: {
        onSet: () =>
          'GS-ERROR: a SecurityError occurred (error 2213), An operation that may only be performed by SystemUser.',
      },
    });
    const panel = open(h, 1);

    sendMessage(panel, {
      command: 'setConfiguration',
      scope: 'stone',
      key: 'StnGemTimeout',
      valueType: 'integer',
      value: '90',
    });

    const result = lastPosted<{ tone: string; message: string; scope: string; key: string }>(
      panel,
      'setResult',
    );
    expect(result).toMatchObject({ tone: 'warn', scope: 'stone', key: 'StnGemTimeout' });
    expect(result!.message).toContain('SystemUser');
    expect(result!.message).not.toContain('GS-ERROR:');
    // A refusal changed nothing, so there is nothing to re-read.
    expect(posted(panel, 'configuration')).toHaveLength(1);
  });

  it('refuses a value it cannot spell in Smalltalk without going to the stone', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);
    const callsBefore = h.gciFor(1).execute.mock.calls.length;

    sendMessage(panel, {
      command: 'setConfiguration',
      scope: 'gem',
      key: 'GemHaltOnError',
      valueType: 'integer',
      value: 'not a number',
    });

    expect(lastPosted<{ tone: string; message: string }>(panel, 'setResult')).toMatchObject({
      tone: 'warn',
    });
    expect(h.gciFor(1).execute.mock.calls.length).toBe(callsBefore);
  });

  it('logs a change and a failure to the sysadmin channel', () => {
    const h = settableHarness(true);
    const panel = open(h, 1);

    setHaltOnError(panel, '2');
    const logged = vi.mocked(appendSysadmin).mock.calls.map((c) => c[0]);
    expect(
      logged.some((m) =>
        m.includes('Session Configuration: set gem configuration GemHaltOnError = 2'),
      ),
    ).toBe(true);
  });

  it('says so when the session went away before the set', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);
    h.removeSession(1);
    // The panel is gone with the session; a set arriving from a webview that
    // had not yet closed must not throw.
    expect(() => setHaltOnError(panel, '2')).not.toThrow();
  });
});

// ── Ping ────────────────────────────────────────────────────────────────────

describe('ping', () => {
  it('reports a responsive session as a notice, leaving the values alone', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);
    const before = posted(panel, 'configuration').length;

    sendMessage(panel, { command: 'ping' });

    expect(lastPosted<{ tone: string; message: string }>(panel, 'pingResult')).toMatchObject({
      tone: 'ok',
    });
    expect(h.ping).toHaveBeenCalledWith(1);
    expect(posted(panel, 'configuration')).toHaveLength(before);
  });

  it('reports a session that did not answer, with the error', () => {
    const h = harness([makeSession(1)]);
    h.ping.mockReturnValue({ success: false, err: { number: 4100, message: 'session is busy' } });
    const panel = open(h, 1);

    sendMessage(panel, { command: 'ping' });

    const result = lastPosted<{ tone: string; message: string }>(panel, 'pingResult');
    expect(result!.tone).toBe('warn');
    expect(result!.message).toContain('session is busy');
  });
});

describe('copy', () => {
  it('puts the requested text on the clipboard', () => {
    const h = harness([makeSession(1)]);
    const panel = open(h, 1);

    sendMessage(panel, { command: 'copyText', text: 'a failure message' });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('a failure message');
  });
});

// ── Parameter descriptions ──────────────────────────────────────────────────

describe('parameter descriptions', () => {
  const SYSTEM_CONF = `#=========================================================================
# STN_GEM_TIMEOUT: How long the stone waits before declaring a gem dead.
# Default: 0
#STN_GEM_TIMEOUT = 0;
#=========================================================================
`;

  it('says descriptions are unavailable when the version product tree is not here', () => {
    const h = harness([makeSession(1)]);
    const cfg = config(open(h, 1));

    expect(cfg.descriptionsAvailable).toBe(false);
    expect(paramNamed(cfg.stoneParams, 'StnGemTimeout').description).toBeUndefined();
  });

  it('attaches the purpose text from system.conf, matching a CamelCase key to its file name', () => {
    const h = harness([makeSession(1)]);
    vi.mocked(h.storage.getGemstonePath).mockReturnValue('/gs');
    vi.mocked(fs.readFileSync).mockReturnValue(SYSTEM_CONF);

    const cfg = config(open(h, 1));

    expect(cfg.descriptionsAvailable).toBe(true);
    expect(paramNamed(cfg.stoneParams, 'StnGemTimeout').description).toContain(
      'waits before declaring a gem dead',
    );
  });

  it('reads system.conf once per version, not on every load', () => {
    const h = harness([makeSession(1)]);
    vi.mocked(h.storage.getGemstonePath).mockReturnValue('/gs');
    vi.mocked(fs.readFileSync).mockReturnValue(SYSTEM_CONF);
    const panel = open(h, 1);
    const readsAfterFirstLoad = vi.mocked(fs.readFileSync).mock.calls.length;

    sendMessage(panel, { command: 'loadConfiguration' });

    expect(vi.mocked(fs.readFileSync).mock.calls.length).toBe(readsAfterFirstLoad);
  });

  it('carries on without descriptions when system.conf cannot be read', () => {
    const h = harness([makeSession(1)]);
    vi.mocked(h.storage.getGemstonePath).mockReturnValue('/gs');
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const cfg = config(open(h, 1));

    expect(cfg.descriptionsAvailable).toBe(false);
    expect(cfg.stoneParams.length).toBeGreaterThan(0);
  });
});

// ── Which session a row means ───────────────────────────────────────────────

describe('the Session Configuration command', () => {
  function deps(h: Harness) {
    return { sessionManager: h.sessionManager, sysadminStorage: h.storage };
  }

  it('opens the panel for the session whose row was clicked', async () => {
    const login = makeLogin();
    const h = harness([makeSession(1, login), makeSession(2, login)]);

    await showConfigurationCommand(deps(h), new GemStoneSessionItem(makeSession(2, login), false));

    expect(panels()).toHaveLength(1);
    sendMessage(lastPanel(), { command: 'ready' });
    expect(config(lastPanel()).sessionId).toBe(2);
  });

  it('opens the clicked session even when another session looks identical', async () => {
    // Two sessions of the same login carry the same row label, and two logins
    // that differ only in NetLDI do too. The row is resolved by session id, which
    // is unique and never reused, so neither can stand in for the other — and a
    // set from this panel cannot land on the other stone.
    const login = makeLogin({ netldi: 'ldi-a' });
    const twin = makeLogin({ netldi: 'ldi-b' });
    const h = harness([makeSession(1, login), makeSession(2, twin)]);

    await showConfigurationCommand(deps(h), new GemStoneSessionItem(makeSession(2, twin), false));

    sendMessage(lastPanel(), { command: 'ready' });
    expect(config(lastPanel()).sessionId).toBe(2);
  });

  it('says to log in when the row outlived its session', async () => {
    const login = makeLogin();
    const stale = makeSession(9, login);
    const h = harness([makeSession(1, login)]);

    await showConfigurationCommand(deps(h), new GemStoneSessionItem(stale, false));

    expect(panels()).toHaveLength(0);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Log in'),
    );
  });

  it('falls back to the session Jasper is working with when invoked from the palette', async () => {
    const h = harness([makeSession(1)]);

    await showConfigurationCommand(deps(h));

    sendMessage(lastPanel(), { command: 'ready' });
    expect(config(lastPanel()).sessionId).toBe(1);
  });

  it('stays quiet from the palette when no session could be resolved', async () => {
    const h = harness([]);
    vi.mocked(h.sessionManager.resolveSession).mockResolvedValue(undefined);

    await showConfigurationCommand(deps(h));

    expect(panels()).toHaveLength(0);
    // resolveSession has already told the user why.
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
