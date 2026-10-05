import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import * as vscode from 'vscode';
import { __telemetry, ExtensionMode } from '../__mocks__/vscode';
import {
  initTelemetry,
  registerCopyTelemetryIdCommand,
  reportActivation,
  startActivationTelemetry,
} from '../telemetry';

function fakeContext(mode: number = ExtensionMode.Production): vscode.ExtensionContext {
  return {
    extensionMode: mode,
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function eventsNamed(name: string) {
  return __telemetry.filter((e) => e.name === name);
}

// The default project shuffles test order (client/vitest.config.ts), and
// telemetry.ts deliberately keeps `reporter`/`baseProperties` as module
// state rather than per-call state, so every `report*` call site stays a
// one-liner. Every test below calls `initTelemetry` itself before asserting,
// which fully replaces both, so no test depends on what ran before it in
// this file. Whether nothing is recorded *before* `initTelemetry` ever runs
// is instead covered by telemetry.beforeInit.test.ts, alone in its own
// module graph, where that question is meaningful.
beforeEach(() => {
  __telemetry.length = 0;
});

describe('telemetry', () => {
  it('records one activation event saying how the extension was launched and how long it took to start', () => {
    initTelemetry(fakeContext());

    reportActivation(42);

    const events = eventsNamed('activated');
    expect(events).toHaveLength(1);
    expect(events[0].properties).toMatchObject({ extensionMode: 'production' });
    expect(events[0].measurements).toEqual({ activationMs: 42 });
  });

  it("keeps VS Code's common properties on every event", () => {
    initTelemetry(fakeContext());

    reportActivation(0);

    expect(eventsNamed('activated')[0].properties).toMatchObject({ 'common.fake': 'yes' });
  });

  it.each([
    [ExtensionMode.Production, 'production'],
    [ExtensionMode.Development, 'development'],
    [ExtensionMode.Test, 'test'],
  ])('reports the launch mode by name (%d → %s)', (mode, expected) => {
    initTelemetry(fakeContext(mode));

    reportActivation(0);

    expect(eventsNamed('activated')[0].properties).toMatchObject({ extensionMode: expected });
  });

  describe('timing activation', () => {
    it('sends one activation event when activation finishes', () => {
      const finish = startActivationTelemetry(fakeContext());

      finish();

      expect(eventsNamed('activated')).toHaveLength(1);
    });

    it('sends nothing more if activation finishes twice', () => {
      const finish = startActivationTelemetry(fakeContext());

      finish();
      finish();

      expect(eventsNamed('activated')).toHaveLength(1);
    });

    it("still lets activation finish when telemetry can't be set up", () => {
      vi.spyOn(vscode.env, 'createTelemetryLogger').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});

      const finish = startActivationTelemetry(fakeContext());

      expect(() => finish()).not.toThrow();
    });
  });

  describe('the Copy Telemetry ID command', () => {
    it('copies the machine ID to the clipboard', async () => {
      const registerCommand = vi.mocked(vscode.commands.registerCommand);
      registerCommand.mockClear();
      const context = fakeContext();

      registerCopyTelemetryIdCommand(context);

      expect(context.subscriptions).toHaveLength(1);
      const [command, callback] = registerCommand.mock.calls[0];
      expect(command).toBe('gemstone.copyTelemetryId');
      await (callback as () => Promise<void>)();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(vscode.env.machineId);
    });
  });
});
