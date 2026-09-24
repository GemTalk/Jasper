/**
 * Stands in for the real `@vscode/extension-telemetry` package in tests.
 *
 * The real package is a precompiled CommonJS module whose entry point calls
 * `require('vscode')` at evaluation time — a genuine Node `require`, not an
 * import vitest's mocking can alias, so it fails outside a real extension
 * host no matter how the `vscode` module itself is stubbed. This mock
 * implements just the surface `telemetry.ts` uses
 * (`sendTelemetryEvent`/`dispose`) as a thin call-through to
 * `vscode.env.createTelemetryLogger`, so `telemetry.ts` itself stays real:
 * real `send`, real `baseProperties` merging, real event names — only the
 * third-party wrapper is faked, not Jasper's own code.
 */
import * as vscode from 'vscode';

export class TelemetryReporter {
  private readonly logger: ReturnType<typeof vscode.env.createTelemetryLogger>;

  constructor(_connectionString: string) {
    // The mock's `createTelemetryLogger` ignores the sender entirely.
    this.logger = vscode.env.createTelemetryLogger(undefined as never);
  }

  sendTelemetryEvent(
    name: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>,
  ): void {
    this.logger.logUsage(name, { properties, measurements });
  }

  dispose(): void {
    this.logger.dispose();
  }
}
