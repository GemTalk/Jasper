import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getGciLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone GCI');
  }
  return channel;
}

/** Local wall-clock time as `[HH:MM:SS.mmm]` for a log-line prefix. */
function stamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0');
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
}

export function logError(sessionId: number, message: string): void {
  const log = getGciLog();
  log.appendLine(`${stamp()} [Session ${sessionId}] ERROR: ${message}`);
  log.appendLine('');
}

export function logInfo(message: string): void {
  const log = getGciLog();
  log.appendLine(`${stamp()} ${message}`);
}

/**
 * A user-facing problem in a channel otherwise full of routine GCI traffic. Carries the
 * `WARNING:` marker so the block is scannable when the user opens the channel from a red
 * toast, and the trailing blank line `logError` uses so consecutive blocks do not butt
 * against each other. Unlike `logError` it needs no session id — it reports on an
 * operation, not on a session.
 */
export function logWarning(message: string): void {
  const log = getGciLog();
  log.appendLine(`${stamp()} WARNING: ${message}`);
  log.appendLine('');
}

/**
 * Test-only: drop the cached channel so each test starts from a clean slate
 * (the channel is a module-level singleton created once per process). Not
 * used by production code.
 */
export function _resetGciLogForTests(): void {
  channel = undefined;
}
