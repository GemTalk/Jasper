import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';

/**
 * Jasper's telemetry: one named function per thing worth counting.
 *
 * Rules a future edit can break, none visible from a call site:
 *
 * 1. **This module must never reach `server/` or `mcp-server/`** — the MCP
 *    server runs as a standalone process outside the extension host, so
 *    nothing there enforces the user's telemetry setting.
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
 * Elapsed time on the monotonic clock, whole milliseconds.
 *
 * Not `Date.now()` deltas: those can jump backward or forward across an NTP
 * step or a manual clock change. `performance.now()` cannot.
 */
export class Stopwatch {
  private readonly startedAt = performance.now();

  static start(): Stopwatch {
    return new Stopwatch();
  }

  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

/**
 * The extension host finished activating — once per window activation.
 *
 * @param activationMs time since the first statement of `activate()`.
 */
export function reportActivation(activationMs: number): void {
  send(EVENT.activated, undefined, { activationMs });
}
