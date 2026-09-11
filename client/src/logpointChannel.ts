import * as vscode from 'vscode';

/**
 * Where logpoints write.
 *
 * Its **own** channel, not the Transcript. The Transcript is the program's
 * output — what the code under test chose to say — and a logpoint is the
 * developer standing outside it taking notes. Folding one into the other makes
 * both harder to read, and makes it impossible to tell a line the program wrote
 * from a line a breakpoint wrote about it.
 *
 * Created at activation with the rest of them, not on the first line written:
 * the hover, the breakpoint row and the warnings all send the developer to this
 * channel by name, and a channel that is not in the Output dropdown until
 * something has already been written to it makes every one of those a dead end.
 * See `docs/output-channels.md`.
 */
let channel: vscode.OutputChannel | undefined;

export function getLogpointChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('GemStone Logpoints');
  return channel;
}

/** Local wall-clock time as `[HH:MM:SS.mmm]`, matching the GCI log's prefix. */
function stamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0');
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
}

/**
 * Write one logpoint's line.
 *
 * Timestamped, because the interesting thing about a logpoint on a loop is
 * usually *when* and *how often* rather than any one line, and a logpoint's
 * output does not interleave with the Transcript's in any guaranteed order.
 * `where` names the method and step point so two logpoints in one run are
 * distinguishable.
 */
export function appendLogpoint(where: string, text: string): void {
  getLogpointChannel().appendLine(`${stamp()} ${where}  ${text}`);
}

/** Bring the channel forward — offered when the first line of a run is written. */
export function showLogpointChannel(): void {
  getLogpointChannel().show(true);
}

/** Drop the channel, for tests and for `deactivate`. */
export function disposeLogpointChannel(): void {
  channel?.dispose();
  channel = undefined;
}
