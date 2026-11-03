import * as vscode from 'vscode';
import { stamp } from '../gciLog';

/**
 * Where logpoints write: a channel of their own, so a line the program wrote
 * (Transcript) is never mixed up with one a breakpoint wrote about it.
 *
 * Created at activation, not on first write: hovers and warnings name this
 * channel, and it must already be in the Output dropdown when they do. See
 * `docs/output-channels.md`.
 */
let channel: vscode.OutputChannel | undefined;

export function getLogpointChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('GemStone Logpoints');
  return channel;
}

/**
 * Timestamped because logpoint output does not interleave with the
 * Transcript's in any guaranteed order.
 */
export function appendLogpoint(where: string, text: string): void {
  getLogpointChannel().appendLine(`${stamp()} ${where}  ${text}`);
}

export function showLogpointChannel(): void {
  getLogpointChannel().show(true);
}

/** Drop the channel, for tests. In the extension it is disposed with `context.subscriptions`. */
export function disposeLogpointChannel(): void {
  channel?.dispose();
  channel = undefined;
}
