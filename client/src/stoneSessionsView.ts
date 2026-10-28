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

/** What a row knows about the sessions of this window. */
export interface StoneSessionContext {
  /** The Jasper session in this window that is this stone session, if any. */
  jasperSession?: ActiveSession;
  /** A run the user stopped is still running on it. */
  stuck: boolean;
}

/** One session on the stone. */
export class StoneSessionRowItem extends vscode.TreeItem {
  constructor(
    public readonly parent: StoneSessionsItem,
    public readonly stoneSession: StoneSession,
    serverNow: number,
    context: StoneSessionContext,
  ) {
    const { id, serial, user, gemPid, host, loggedInAt, systemGem } = stoneSession;
    super(user || '(logging in or out)', vscode.TreeItemCollapsibleState.None);
    const { jasperSession, stuck } = context;
    const age = sessionAge(loggedInAt, serverNow);
    const parts = [`gem ${gemPid}`, host, age];
    if (jasperSession) parts.push(`Jasper session ${jasperSession.id}`);
    if (systemGem) parts.push(`system: ${systemGem}`);
    if (stuck) parts.push('⚠ still running a stopped run');
    this.description = parts.join(' · ');
    // The flags are in the id so a row whose run is collected redraws.
    this.id = `stoneSession-${parent.loginIndex}-${serial}${stuck ? '-stuck' : ''}`;
    this.iconPath = new vscode.ThemeIcon(
      stuck ? 'warning' : jasperSession ? 'plug' : systemGem ? 'gear' : 'account',
    );
    // Not offered on this window's own sessions, whose Log Out stops their run
    // first, nor on GemStone's own gems.
    this.contextValue = jasperSession || systemGem ? 'stoneSession' : 'stoneSession.canStop';

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
          'from the session row above.\n\n',
      );
    } else if (jasperSession) {
      tooltip.appendMarkdown(`Jasper session ${jasperSession.id} in this window.\n\n`);
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
  constructor(parent: StoneSessionsItem, label: string, tooltip: string) {
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
}

export const STOP_SESSION = 'Stop Session';

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
        ? `Stopping a session needs the SessionAccess privilege, which ` +
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
    case 'stuck':
      void vscode.window.showWarningMessage(
        `Session ${id} was told to stop but is still on the stone: its gem isn't answering. ` +
          `Only ending its process will clear it — process ${gemPid} on ${host}.`,
      );
  }
}
