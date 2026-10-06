import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { Stopwatch } from './stopwatch';
import { normalizeGemStoneVersion } from './gemStoneVersionParsing';
import { GemStoneLogin } from './loginTypes';

/**
 * Jasper's telemetry: one named function per thing worth counting.
 *
 * Rules a future edit can break, none visible from a call site:
 *
 * 1. **This module must never reach `server/` or `mcp-server/`** — both the
 *    LSP server and the MCP server run as separate processes outside the
 *    extension host, so nothing there enforces the user's telemetry setting.
 *    The LSP server can still report an event: send an LSP `telemetry/event`
 *    notification (`connection.telemetry.logEvent`), which the client
 *    handles with `client.onTelemetry` and forwards to a `report*` function
 *    here, so it still goes through this module's reporter.
 * 2. **Never `sendDangerousTelemetryEvent`** or its siblings: they bypass the
 *    user's setting by design, and shipping one violates Marketplace policy.
 * 3. **Events are facts, not funnels.** Each `report*` function below states
 *    how often its event is sent.
 * 4. **Property values name what the user did**, never a function name, so a
 *    rename cannot silently split a series.
 */

// Not a secret — a connection string only says where events land. See
// .gitleaks.toml for why the instrumentation key is allowlisted rather than
// removed.
const CONNECTION_STRING =
  'InstrumentationKey=6065b12b-2a05-4908-8777-f09bb9158ac2;' +
  'IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/;' +
  'LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;' +
  'ApplicationId=5632bf83-5fcc-425c-93af-bfd6c698caa5';

/**
 * Every event Jasper can emit. `send` is typed to it, so a name cannot be
 * typo'd, and `send` is private, so no event can exist without a `report*`
 * function below that says what it means.
 */
export const EVENT = {
  activated: 'activated',
  loginAttempted: 'loginAttempted',
} as const;
export type EventName = (typeof EVENT)[keyof typeof EVENT];

let reporter: TelemetryReporter | undefined;

/**
 * Properties stamped on every event, established once at activation:
 * `extensionMode`. VS Code's own `common.*` properties are mixed in by the
 * extension host and are not repeated here.
 */
let baseProperties: Record<string, string> = {};

/** What `vscode.ExtensionMode` means, spelled for a telemetry property. */
function extensionModeName(mode: vscode.ExtensionMode): string {
  switch (mode) {
    case vscode.ExtensionMode.Production:
      return 'production';
    case vscode.ExtensionMode.Development:
      return 'development';
    case vscode.ExtensionMode.Test:
      return 'test';
    default:
      return 'unknown';
  }
}

/**
 * Sets up the reporter and this activation's base properties. Must run
 * before any `report*` call; a call before this is a silent no-op (`send`
 * guards on `reporter` being set).
 *
 * Disposal flushes queued events, so pushing onto `context.subscriptions`
 * matters — without it, events sent just before the window closes can be
 * dropped.
 */
export function initTelemetry(context: vscode.ExtensionContext): void {
  baseProperties = { extensionMode: extensionModeName(context.extensionMode) };
  reporter = new TelemetryReporter(CONNECTION_STRING);
  context.subscriptions.push(reporter);
}

/**
 * Registers the command USAGE_DATA.md points users to for access or deletion
 * requests: `vscode.env.machineId` (sent as `common.vscodemachineid`) is
 * shown nowhere in VS Code's own UI. Deliberately not gated on the telemetry
 * setting — someone who has opted out may still want past data deleted.
 */
export function registerCopyTelemetryIdCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.copyTelemetryId', async () => {
      await vscode.env.clipboard.writeText(vscode.env.machineId);
      void vscode.window.showInformationMessage('Telemetry ID copied to the clipboard.');
    }),
  );
}

/**
 * The single send site.
 *
 * **Not exported, and not to be called inline from new code.** Every event
 * gets its own named `report*` function beside this one instead. That is
 * what keeps `EVENT` the complete list of what Jasper emits, and gives each
 * event one documented shape and one place to change it.
 *
 * No consent check here, deliberately: `sendTelemetryEvent` goes through
 * `vscode.env.createTelemetryLogger`, which already checks
 * `isTelemetryEnabled` before anything reaches a sender.
 *
 * **The properties object must never be undefined**, which is why this
 * always passes one. VS Code's `TelemetryLogger` mixes its `common.*`
 * properties into `data.properties` only when that field is already truthy;
 * when it is not, it merges them into the top level of `data` instead, where
 * `@vscode/extension-telemetry`'s App Insights client — which reads only
 * `data.properties` — silently drops every one of them.
 */
function send(
  name: EventName,
  properties?: Record<string, string>,
  measures?: Record<string, number>,
): void {
  reporter?.sendTelemetryEvent(name, { ...baseProperties, ...properties }, measures);
}

/**
 * The extension host finished activating — once per window activation that
 * reaches the end of `activate()`. An activation that throws sends nothing.
 *
 * @param activationMs time from `startActivationTelemetry` to the end of
 *   `activate()`.
 */
export function reportActivation(activationMs: number): void {
  send(EVENT.activated, undefined, { activationMs });
}

/**
 * Starts timing activation and wires up the reporter, returning a `finish`
 * callback for `activate()` to call on its way out.
 *
 * `finish` is idempotent — only its first call sends `activated` — so every
 * exit path in `activate()` can call it unconditionally without worrying
 * about double-counting an activation whose control flow passes through more
 * than one exit.
 *
 * Neither this nor `finish` ever throws: `activate()` calls them unguarded,
 * and an analytics failure must not fail activation. If the reporter cannot
 * be constructed, `finish` is a no-op.
 */
export function startActivationTelemetry(context: vscode.ExtensionContext): () => void {
  const stopwatch = Stopwatch.start();
  try {
    initTelemetry(context);
  } catch (err) {
    console.error('Jasper telemetry failed to initialize; continuing without it.', err);
    return () => {};
  }

  let finished = false;
  return function finish(): void {
    if (finished) return;
    finished = true;
    try {
      reportActivation(stopwatch.elapsedMs());
    } catch (err) {
      console.error('Jasper telemetry failed to send the activated event.', err);
    }
  };
}

/**
 * Whether a login's host names this machine, for `serverLocation` only.
 * Deliberately broader than `isLocalHost` in databaseForLogin.ts, which gates
 * starting a stone and must stay narrow. No DNS lookup: it would put a network
 * round trip on the connect path. If the OS refuses to list interfaces, the
 * host is judged on its name alone rather than losing the event.
 */
function isThisMachine(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  const hostname = os.hostname().toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', hostname, hostname.split('.')[0]].includes(h)) {
    return true;
  }
  try {
    return Object.values(os.networkInterfaces()).some((addrs) =>
      addrs?.some((a) => a.address.toLowerCase() === h),
    );
  } catch {
    return false;
  }
}

/** How a run of the connect command ended, named for what the user saw. */
export type LoginOutcome = 'connected' | 'failed' | 'cancelled' | 'noClientLibrary';

/**
 * The user ran the connect command for a login — once per run that gets past
 * the open-folder check, whatever the outcome.
 *
 * `gemstoneVersion` and `serverLocation` are worked out here rather than
 * passed in, so a caller cannot hand over free text from the login's
 * settings: the version is reduced to its digits (or `unknown`) and the host
 * to `local`/`remote`.
 */
export function reportLoginAttempt(
  login: Pick<GemStoneLogin, 'version' | 'gem_host'>,
  outcome: LoginOutcome,
): void {
  send(EVENT.loginAttempted, {
    gemstoneVersion: normalizeGemStoneVersion(login.version?.trim()) ?? 'unknown',
    outcome,
    serverLocation: isThisMachine(login.gem_host) ? 'local' : 'remote',
  });
}

/**
 * Returns a `finish(outcome)` callback for one run of the connect command.
 *
 * Like `startActivationTelemetry`'s, `finish` is idempotent so the handler
 * can call it with the specific outcome at each exit and again with `failed`
 * from a `finally`; the first call wins. It never throws: in that `finally`,
 * a throw would replace the login's own error.
 */
export function startLoginAttemptTelemetry(
  login: Pick<GemStoneLogin, 'version' | 'gem_host'>,
): (outcome: LoginOutcome) => void {
  let finished = false;
  return function finish(outcome: LoginOutcome): void {
    if (finished) return;
    finished = true;
    try {
      reportLoginAttempt(login, outcome);
    } catch (err) {
      console.error('Jasper telemetry failed to send the loginAttempted event.', err);
    }
  };
}
