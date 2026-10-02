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
  it('records a single activated event with extensionMode and activationMs', () => {
    initTelemetry(fakeContext());

    reportActivation(42);

    const events = eventsNamed('activated');
    expect(events).toHaveLength(1);
    expect(events[0].properties).toMatchObject({ extensionMode: 'production' });
    expect(events[0].measurements).toEqual({ activationMs: 42 });
  });

  it('always passes a properties object, proven by the fake common property', () => {
    initTelemetry(fakeContext());

    reportActivation(0);

    expect(eventsNamed('activated')[0].properties).toMatchObject({ 'common.fake': 'yes' });
  });

  it.each([
    [ExtensionMode.Production, 'production'],
    [ExtensionMode.Development, 'development'],
    [ExtensionMode.Test, 'test'],
  ])('maps extension mode %d to %s', (mode, expected) => {
    initTelemetry(fakeContext(mode));

    reportActivation(0);

    expect(eventsNamed('activated')[0].properties).toMatchObject({ extensionMode: expected });
  });

  describe('startActivationTelemetry', () => {
    it('sends a single activated event when finish is called', () => {
      const finish = startActivationTelemetry(fakeContext());

      finish();

      expect(eventsNamed('activated')).toHaveLength(1);
    });

    it('sends nothing more on a second finish call', () => {
      const finish = startActivationTelemetry(fakeContext());

      finish();
      finish();

      expect(eventsNamed('activated')).toHaveLength(1);
    });

    it('returns a working finish even when the reporter fails to construct', () => {
      vi.spyOn(vscode.env, 'createTelemetryLogger').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});

      const finish = startActivationTelemetry(fakeContext());

      expect(() => finish()).not.toThrow();
    });
  });

  describe('registerCopyTelemetryIdCommand', () => {
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
