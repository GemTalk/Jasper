import * as vscode from 'vscode';
import type { ActiveSession } from './activeSession';
import { GciLibraryError } from './gciLibraryError';
import { NO_PRIVILEGE_ERROR } from './forceStop';
import { GemStoneLogin } from './loginTypes';
import {
  sessionAge,
  StoneSession,
  StoneSessionList,
  StopSessionOutcome,
  TransientLogin,
} from './stoneSessions';

/** The list as last read, or why it couldn't be. */
export type StoneSessionsRead = StoneSessionList | { kind: 'error'; message: string };

/** The "All sessions on <stone>" node under a connected login. */
export class StoneSessionsItem extends vscode.TreeItem {
  constructor(
    public readonly login: GemStoneLogin,
    public readonly loginIndex: number,
    /** A connected session of the login, whose GCI library the list is read through. */
    public readonly through: ActiveSession,
    read: StoneSessionsRead | undefined,
  ) {
    super(`All sessions on ${login.stone}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `stoneSessions-${loginIndex}`;
    this.iconPath = new vscode.ThemeIcon('organization');
    this.contextValue = 'stoneSessionList';
    if (read?.kind === 'sessions') this.description = `${read.sessions.length}`;
    this.tooltip =
      'Every session logged in to the stone, from any tool or user. Read when expanded; ' +
      'Refresh reads it again.';
  }
}

/** What a row knows beyond the stone's own description of the session. */
export interface StoneSessionContext {
  /** The Jasper session in this window that is this stone session, if any. */
  jasperSession?: ActiveSession;
  /** A run the user stopped is still running on it. */
  stuck: boolean;
  /** The login has the privileges `System stopSession:` needs. */
  mayStop?: boolean;
  /** Its gem runs on this machine (in WSL, on Windows) as a process this OS user may signal. */
  canSignalGem?: boolean;
  /** It holds back a commit-record backlog the stone already asks sessions to abort over. */
  backlog?: { count: number; threshold: number };
}

/** One session on the stone. */
export class StoneSessionRowItem extends vscode.TreeItem {
  constructor(
    public readonly parent: StoneSessionsItem,
    public readonly stoneSession: StoneSession,
    serverNow: number,
    public readonly context: StoneSessionContext,
  ) {
    const { id, serial, user, gemPid, host, loggedInAt, systemGem } = stoneSession;
    super(user || '(logging in or out)', vscode.TreeItemCollapsibleState.None);
    const { jasperSession, stuck, mayStop, canSignalGem, backlog } = context;
    const age = sessionAge(loggedInAt, serverNow);
    const parts = [`gem ${gemPid}`, host, age];
    if (jasperSession) parts.push(`Jasper session ${jasperSession.id}`);
    if (systemGem) parts.push(`system: ${systemGem}`);
    if (stuck) parts.push('⚠ still running a stopped run');
    if (backlog) parts.push('⧗ holds the oldest commit record');
    this.description = parts.join(' · ');
    // The flags are in the id so a row whose run is collected redraws.
    this.id =
      `stoneSession-${parent.loginIndex}-${serial}` +
      `${stuck ? '-stuck' : ''}${backlog ? '-backlog' : ''}`;
    this.iconPath = new vscode.ThemeIcon(
      stuck
        ? 'warning'
        : backlog
          ? 'history'
          : jasperSession
            ? 'plug'
            : systemGem
              ? 'gear'
              : 'account',
    );
    // Each is offered only where it can work, and neither on GemStone's own
    // gems. Stop isn't offered on this window's own sessions, whose Log Out
    // stops their run first; Kill is, once a stopped run holds one, for a gem
    // nothing else can end.
    const stoppable = !jasperSession && !systemGem;
    const canStop = stoppable && !!mayStop;
    const canKill = !!canSignalGem && !systemGem && (!jasperSession || stuck);
    this.contextValue = `stoneSession${canStop ? '.canStop' : ''}${canKill ? '.canKill' : ''}`;

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Session ${id}** — ${user || 'logging in or out'}\n\n`);
    tooltip.appendMarkdown(
      `Gem process ${gemPid} on ${host}, logged in ${age} ago, ` +
        `${transactionWording(stoneSession.transaction)}.\n\n`,
    );
    if (systemGem) {
      tooltip.appendMarkdown(`One of GemStone's own gems (${systemGem}).\n\n`);
    }
    if (stuck) {
      tooltip.appendMarkdown(
        `A run you stopped is still running on the server, so Jasper session ` +
          `${jasperSession?.id} can't run anything else. Force Stop it, or log out ` +
          'from the session row above.' +
          (canKill ? ' If its gem is frozen for good, Kill ends it.' : '') +
          '\n\n',
      );
    } else if (jasperSession) {
      tooltip.appendMarkdown(`Jasper session ${jasperSession.id} in this window.\n\n`);
    }
    if (stoppable && !mayStop) {
      tooltip.appendMarkdown(
        `Stopping it needs the SystemControl privilege, which ${parent.login.gs_user} ` +
          "doesn't have.\n\n",
      );
    }
    if (backlog) {
      tooltip.appendMarkdown(
        `Its view is the oldest of the ${backlog.count} commit records the stone is keeping, ` +
          `past the ${backlog.threshold} at which the stone asks sessions to abort. Until it ` +
          'commits or aborts, the stone can reclaim none of the space behind them.\n\n',
      );
    }
    this.tooltip = tooltip;
  }
}

function transactionWording(transaction: StoneSession['transaction']): string {
  switch (transaction) {
    case 'in':
      return 'in a transaction';
    case 'transactionless':
      return 'transactionless';
    default:
      return 'not in a transaction';
  }
}

/** A row standing in for the list when it can't be shown. */
export class StoneSessionsMessageItem extends vscode.TreeItem {
  constructor(
    public readonly parent: StoneSessionsItem,
    label: string,
    tooltip: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `stoneSessionsMessage-${parent.loginIndex}`;
    this.iconPath = new vscode.ThemeIcon('info');
    this.tooltip = tooltip;
    this.contextValue = 'stoneSessionMessage';
  }
}

export interface StopStoneSessionDeps {
  stop(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  transientLogin: (through: ActiveSession) => TransientLogin;
  /** Read the list again. */
  refresh(item: StoneSessionsItem): void;
  /** Kill, for the gem a stop couldn't end. */
  kill(row: StoneSessionRowItem): Promise<void>;
}

export const STOP_SESSION = 'Stop Session';
export const KILL = 'Kill';

function canKill(row: StoneSessionRowItem): boolean {
  return row.contextValue?.includes('.canKill') ?? false;
}

/**
 * End another session on the stone, after a warning that its uncommitted work
 * is lost. Where that can't work, says so and names what an administrator can
 * run, as logging out does.
 */
export async function stopStoneSessionCommand(
  row: StoneSessionRowItem,
  deps: StopStoneSessionDeps,
): Promise<void> {
  const { id, user, gemPid, host } = row.stoneSession;
  const who = `session ${id} (${user || 'unknown user'} on ${host}, gem ${gemPid})`;
  const confirmed = await vscode.window.showWarningMessage(
    `Stop ${who}? Anything it hasn't committed is lost.`,
    { modal: true },
    STOP_SESSION,
  );
  if (confirmed !== STOP_SESSION) return;

  let outcome: StopSessionOutcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Stopping session ${id}…` },
      () => deps.stop(row.stoneSession, deps.transientLogin(row.parent.through)),
    );
  } catch (e) {
    const administrator = `An administrator can end it with: System stopSession: ${id}`;
    void vscode.window.showWarningMessage(
      e instanceof GciLibraryError && e.number === NO_PRIVILEGE_ERROR
        ? `Stopping a session needs the SessionAccess and SystemControl privileges, which ` +
            `${row.parent.login.gs_user} doesn't have. ${administrator}`
        : `Session ${id} could not be stopped (${e instanceof Error ? e.message : String(e)}). ` +
            administrator,
    );
    return;
  } finally {
    deps.refresh(row.parent);
  }
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
      if (!canKill(row)) {
        void vscode.window.showWarningMessage(message);
        return;
      }
      if ((await vscode.window.showWarningMessage(message, KILL)) === KILL) await deps.kill(row);
    }
  }
}

export interface KillStoneSessionDeps {
  kill(target: StoneSession, login: TransientLogin): Promise<StopSessionOutcome>;
  transientLogin: (through: ActiveSession) => TransientLogin;
  refresh(item: StoneSessionsItem): void;
  /** Drop this window's Jasper session whose gem was killed. */
  logout(jasperId: number): Promise<unknown>;
}

/**
 * End a session by ending its gem's process on this machine, after a warning
 * that its uncommitted work is lost. For a gem frozen for good, which nothing
 * sent through GemStone can reach. A Jasper session of this window whose gem
 * it was is logged out after.
 */
export async function killStoneSessionCommand(
  row: StoneSessionRowItem,
  deps: KillStoneSessionDeps,
): Promise<void> {
  const { id, user, gemPid, host } = row.stoneSession;
  const { jasperSession } = row.context;
  const confirmed = await vscode.window.showWarningMessage(
    `Kill session ${id} (${user || 'unknown user'} on ${host})? Its gem, process ${gemPid}, ` +
      "is ended on this machine, and anything it hasn't committed is lost." +
      (jasperSession ? ` Jasper session ${jasperSession.id} is logged out.` : ''),
    { modal: true },
    KILL,
  );
  if (confirmed !== KILL) return;

  let outcome: StopSessionOutcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Killing session ${id}…` },
      () => deps.kill(row.stoneSession, deps.transientLogin(row.parent.through)),
    );
  } catch (e) {
    void vscode.window.showWarningMessage(
      `Session ${id} could not be killed: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.')} ` +
        `Someone allowed to end process ${gemPid} on ${host} can run: kill -9 ${gemPid}`,
    );
    deps.refresh(row.parent);
    return;
  }
  if (jasperSession && outcome !== 'stuck') {
    try {
      await deps.logout(jasperSession.id);
    } catch (e) {
      void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
    }
  }
  deps.refresh(row.parent);
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
