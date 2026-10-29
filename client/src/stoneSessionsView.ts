import * as vscode from 'vscode';
import type { ActiveSession } from './activeSession';
import { GciLibraryError } from './gciLibraryError';
import { NO_PRIVILEGE_ERROR } from './forceStop';
import {
  sessionAge,
  StoneSession,
  StoneSessionList,
  StopSessionOutcome,
  TransientLogin,
} from './stoneSessions';

/** What the stone's session lists need from outside them. */
export interface StoneSessionsDeps {
  /** Read the stone's sessions through a login of its own on `through`'s library; may throw. */
  read(through: ActiveSession): StoneSessionList;
  /** The gem processes among `sessions` that Kill can end; see `killableGems`. */
  killableGems(sessions: StoneSession[]): Set<number>;
  /** Whether a run the user stopped still holds `session`. */
  stuck(session: ActiveSession): boolean;
  /** GemStone's session number for a Jasper session, once known. */
  serverSessionOf(jasperId: number): string | undefined;
  transientLogin(through: ActiveSession): TransientLogin;
  stop(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  kill(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  /** Drop this window's Jasper session whose gem was ended. */
  logout(jasperId: number): Promise<unknown>;
}

/** One session as the Databases & Versions panel draws it. */
export interface StoneSessionRow {
  id: number;
  serial: number;
  user: string;
  gemPid: number;
  host: string;
  /** How long ago it logged in: `45s`, `14m`, `3h`, `2d`. */
  age: string;
  /** The Jasper session in this window that is this session, if any. */
  jasperSessionId?: number;
  systemGem?: string;
  /** A run the user stopped is still running on it. */
  stuck: boolean;
  /** It holds back a commit-record backlog the stone already asks sessions to abort over. */
  holdsBacklog: boolean;
  canStop: boolean;
  canKill: boolean;
  /** The row's hover text. */
  tip: string;
}

/** One stone's session list, or the one line standing in for it. */
export type StoneSessionsInfo =
  | { key: string; kind: 'sessions'; rows: StoneSessionRow[] }
  | { key: string; kind: 'message'; message: string; detail: string };

/** A row's session, with what acting on it needs. */
export interface StoneSessionTarget {
  stoneSession: StoneSession;
  jasperSession?: ActiveSession;
  canKill: boolean;
  /** The GemStone user the list was read as, for the privilege messages. */
  loginUser: string;
  /** A session of this window on the stone, whose GCI library the action logs in on. */
  through: ActiveSession;
}

/**
 * How long after a session of this window logs out its list is read again. The
 * stone lets a gem go a moment after the logout returns, so the read the logout
 * itself causes can still list it.
 */
export const REREAD_AFTER_LOGOUT_MS = 2000;

/** The list as last read, or why it couldn't be. */
type StoneSessionsRead = StoneSessionList | { kind: 'error'; message: string };

interface CacheEntry {
  read: StoneSessionsRead;
  killable: Set<number>;
  /** This window's session ids when it was read: a login or logout here changes the list. */
  windowSessions: string;
}

/**
 * Each stone's session list, by a key naming the stone. Read on first showing,
 * on Refresh, and when a session of this window logs in or out, and kept
 * otherwise: a read is a login, which blocks the window while it runs, and the
 * panel redraws on every selection and transaction change.
 */
export class StoneSessions {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly targets = new Map<string, Map<number, StoneSessionTarget>>();
  private readonly changed = new vscode.EventEmitter<void>();
  /** A list was forgotten on its own, and should be shown again. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly deps: StoneSessionsDeps) {}

  /** The stone `key`'s list, read through `through` unless it is kept. */
  describe(
    key: string,
    through: ActiveSession,
    windowSessions: ActiveSession[],
  ): StoneSessionsInfo {
    const { deps } = this;
    const seen = windowSessions.map((s) => s.id).join(',');
    let entry = this.cache.get(key);
    if (entry?.windowSessions !== seen) {
      const loggedOut =
        entry !== undefined &&
        entry.windowSessions
          .split(',')
          .some((id) => id !== '' && !windowSessions.some((s) => String(s.id) === id));
      if (loggedOut) {
        setTimeout(() => {
          this.forget(key);
          this.changed.fire();
        }, REREAD_AFTER_LOGOUT_MS);
      }
      let read: StoneSessionsRead;
      try {
        read = deps.read(through);
      } catch (e) {
        read = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      const killable =
        read.kind === 'sessions' ? deps.killableGems(read.sessions) : new Set<number>();
      entry = { read, killable, windowSessions: seen };
      this.cache.set(key, entry);
    }
    const { read, killable } = entry;
    const loginUser = through.login.gs_user;
    if (read.kind === 'noAccess') {
      this.targets.delete(key);
      return {
        key,
        kind: 'message',
        message: 'Seeing other sessions needs the SessionAccess privilege',
        detail:
          `${loginUser} doesn't have the SessionAccess privilege, which GemStone requires to ` +
          'look at any session but its own. DataCurator and SystemUser have it.',
      };
    }
    if (read.kind === 'error') {
      this.targets.delete(key);
      return { key, kind: 'message', message: 'Could not read the sessions', detail: read.message };
    }

    const byServerSession = new Map<string, ActiveSession>();
    for (const s of windowSessions) {
      const number = deps.serverSessionOf(s.id);
      if (number !== undefined) byServerSession.set(number, s);
    }
    // Some session always holds the oldest commit record; it is only news once
    // the stone itself asks sessions to abort over the backlog.
    const backlog = read.commitRecordBacklog >= read.abortThreshold ? read : undefined;
    const targets = new Map<number, StoneSessionTarget>();
    const rows = read.sessions.map((stoneSession) => {
      const jasperSession = byServerSession.get(String(stoneSession.id));
      const row = describeRow(stoneSession, read.serverNow, {
        jasperSession,
        stuck: jasperSession !== undefined && deps.stuck(jasperSession),
        mayStop: read.canStopSessions,
        canSignalGem: killable.has(stoneSession.gemPid),
        backlog: stoneSession.holdsOldestCommitRecord ? backlog : undefined,
        loginUser,
      });
      targets.set(stoneSession.serial, {
        stoneSession,
        jasperSession,
        canKill: row.canKill,
        loginUser,
        through,
      });
      return row;
    });
    this.targets.set(key, targets);
    return { key, kind: 'sessions', rows };
  }

  /** Read the stone `key`'s list again next time it is shown. */
  forget(key: string): void {
    this.cache.delete(key);
  }

  /** Forget every list, so each is read again next time it is shown. */
  forgetAll(): void {
    this.cache.clear();
  }

  /** The session behind a row last shown, or undefined for one no longer listed. */
  target(key: string, serial: number): StoneSessionTarget | undefined {
    return this.targets.get(key)?.get(serial);
  }

  /** Where Jasper session `jasperId`'s row was last shown. */
  rowOf(jasperId: number): { key: string; serial: number } | undefined {
    for (const [key, rows] of this.targets) {
      for (const [serial, t] of rows) {
        if (t.jasperSession?.id === jasperId) return { key, serial };
      }
    }
    return undefined;
  }

  /** Stop Session on a row last shown; the list is read again after. */
  async stop(key: string, serial: number): Promise<void> {
    const target = this.target(key, serial);
    if (target) await stopStoneSessionCommand(target, this.commandDeps(key));
  }

  /** Kill on a row last shown; the list is read again after. */
  async kill(key: string, serial: number): Promise<void> {
    const target = this.target(key, serial);
    if (target?.canKill) await killStoneSessionCommand(target, this.commandDeps(key));
  }

  private commandDeps(key: string): StoneSessionCommandDeps {
    const { stop, kill, transientLogin, logout } = this.deps;
    return { stop, kill, transientLogin, logout, refresh: () => this.forget(key) };
  }
}

interface RowContext {
  jasperSession?: ActiveSession;
  stuck: boolean;
  /** The login has the privileges `System stopSession:` needs. */
  mayStop: boolean;
  /** Its gem runs on this machine (in WSL, on Windows) as a process this OS user may signal. */
  canSignalGem: boolean;
  backlog?: { commitRecordBacklog: number; abortThreshold: number };
  loginUser: string;
}

export function describeRow(
  stoneSession: StoneSession,
  serverNow: number,
  context: RowContext,
): StoneSessionRow {
  const { id, serial, user, gemPid, host, loggedInAt, systemGem } = stoneSession;
  const { jasperSession, stuck, mayStop, canSignalGem, backlog, loginUser } = context;
  const age = sessionAge(loggedInAt, serverNow);
  // Each is offered where it can work, and neither on GemStone's own gems.
  // Both are offered on this window's own sessions too, whose state Jasper
  // can't always judge: the user decides, and the Jasper session is logged
  // out after.
  const canStop = !systemGem && mayStop;
  const canKill = canSignalGem && !systemGem;

  // Only what the row's own text and badges don't already say.
  const tip = [`${transactionWording(stoneSession.transaction)}.`];
  if (stuck) {
    tip.push(
      `Force Stop or log out session ${jasperSession?.id} in this window to end the run` +
        (canKill ? '; Kill if its gem is frozen.' : '.'),
    );
  } else if (jasperSession && (canStop || canKill)) {
    tip.push("Stop and Kill don't ask about uncommitted changes; Log out does.");
  }
  if (!systemGem && !mayStop) tip.push(`No Stop: ${loginUser} lacks the SystemControl privilege.`);
  if (backlog) {
    tip.push(
      `Holds back ${backlog.commitRecordBacklog} commit records (the stone asks for aborts at ` +
        `${backlog.abortThreshold}); none can be reclaimed until it commits or aborts.`,
    );
  }

  return {
    id,
    serial,
    user,
    gemPid,
    host,
    age,
    jasperSessionId: jasperSession?.id,
    systemGem,
    stuck,
    holdsBacklog: !!backlog,
    canStop,
    canKill,
    tip: tip.join('\n'),
  };
}

function transactionWording(transaction: StoneSession['transaction']): string {
  switch (transaction) {
    case 'in':
      return 'In a transaction';
    case 'transactionless':
      return 'Transactionless';
    default:
      return 'Not in a transaction';
  }
}

export interface StoneSessionCommandDeps {
  stop(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  kill(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  transientLogin: (through: ActiveSession) => TransientLogin;
  /** Drop this window's Jasper session whose gem was ended. */
  logout(jasperId: number): Promise<unknown>;
  /** Have the list read again. */
  refresh(): void;
}

export const STOP_SESSION = 'Stop Session';
export const KILL = 'Kill';

/**
 * End a session on the stone, after a warning that its uncommitted work is
 * lost. Where that can't work, says so and names what an administrator can run,
 * as logging out does.
 */
export async function stopStoneSessionCommand(
  target: StoneSessionTarget,
  deps: StoneSessionCommandDeps,
): Promise<void> {
  const { id, user, gemPid, host } = target.stoneSession;
  const { jasperSession } = target;
  const who = `session ${id} (${user || 'unknown user'} on ${host}, gem ${gemPid})`;
  const confirmed = await vscode.window.showWarningMessage(
    `Stop ${who}? Anything it hasn't committed is lost.` +
      (jasperSession ? ` Session ${jasperSession.id} in this window is logged out.` : ''),
    { modal: true },
    STOP_SESSION,
  );
  if (confirmed !== STOP_SESSION) return;

  let outcome: StopSessionOutcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Stopping session ${id}…` },
      () => deps.stop(target.stoneSession, deps.transientLogin(target.through)),
    );
  } catch (e) {
    const administrator = `An administrator can end it with: System stopSession: ${id}`;
    void vscode.window.showWarningMessage(
      e instanceof GciLibraryError && e.number === NO_PRIVILEGE_ERROR
        ? `Stopping a session needs the SessionAccess and SystemControl privileges, which ` +
            `${target.loginUser} doesn't have. ${administrator}`
        : `Session ${id} could not be stopped (${e instanceof Error ? e.message : String(e)}). ` +
            administrator,
    );
    deps.refresh();
    return;
  }
  if (jasperSession && outcome !== 'stuck') await logOutAfter(jasperSession, deps);
  deps.refresh();
  switch (outcome) {
    case 'ended':
      void vscode.window.showInformationMessage(`Session ${id} is stopped.`);
      return;
    case 'gone':
      void vscode.window.showInformationMessage(`Session ${id} had already ended.`);
      return;
    case 'stuck': {
      const message =
        `Session ${id} was told to stop but is still on the stone: its gem isn't answering. ` +
        `Only ending its process will clear it — process ${gemPid} on ${host}.`;
      if (!target.canKill) {
        void vscode.window.showWarningMessage(message);
        return;
      }
      if ((await vscode.window.showWarningMessage(message, KILL)) === KILL) {
        await killStoneSessionCommand(target, deps);
      }
    }
  }
}

/**
 * End a session by ending its gem's process on this machine, after a warning
 * that its uncommitted work is lost. For a gem frozen for good, which nothing
 * sent through GemStone can reach. A Jasper session of this window whose gem
 * it was is logged out after.
 */
export async function killStoneSessionCommand(
  target: StoneSessionTarget,
  deps: StoneSessionCommandDeps,
): Promise<void> {
  const { id, user, gemPid, host } = target.stoneSession;
  const { jasperSession } = target;
  const confirmed = await vscode.window.showWarningMessage(
    `Kill session ${id} (${user || 'unknown user'} on ${host})? Its gem, process ${gemPid}, ` +
      "is ended on this machine, and anything it hasn't committed is lost." +
      (jasperSession ? ` Session ${jasperSession.id} in this window is logged out.` : ''),
    { modal: true },
    KILL,
  );
  if (confirmed !== KILL) return;

  let outcome: StopSessionOutcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Killing session ${id}…` },
      () => deps.kill(target.stoneSession, deps.transientLogin(target.through)),
    );
  } catch (e) {
    void vscode.window.showWarningMessage(
      `Session ${id} could not be killed: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.')} ` +
        `Someone allowed to end process ${gemPid} on ${host} can run: kill -9 ${gemPid}`,
    );
    deps.refresh();
    return;
  }
  if (jasperSession && outcome !== 'stuck') await logOutAfter(jasperSession, deps);
  deps.refresh();
  switch (outcome) {
    case 'ended':
      void vscode.window.showInformationMessage(`Session ${id} is killed.`);
      return;
    case 'gone':
      void vscode.window.showInformationMessage(`Session ${id} had already ended.`);
      return;
    case 'stuck':
      void vscode.window.showWarningMessage(
        `Session ${id} is still on the stone after its gem, process ${gemPid}, was sent SIGKILL. ` +
          'Check that process on this machine.',
      );
  }
}

/** Log out this window's Jasper session whose gem has just been ended. */
async function logOutAfter(
  session: ActiveSession,
  deps: { logout(jasperId: number): Promise<unknown> },
): Promise<void> {
  try {
    await deps.logout(session.id);
  } catch (e) {
    void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
  }
}
