import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { __telemetry, ExtensionMode } from '../__mocks__/vscode';
import { GemStoneLogin } from '../loginTypes';
import {
  initTelemetry,
  LoginOutcome,
  registerCopyTelemetryIdCommand,
  reportActivation,
  reportLoginAttempt,
  reportingLoginAttempt,
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
  ])('reports the launch mode by name', (mode, expected) => {
    initTelemetry(fakeContext(mode));

    reportActivation(0);

    expect(eventsNamed('activated')[0].properties).toMatchObject({ extensionMode: expected });
  });

  describe('the editor app', () => {
    // This project doesn't restore spies between tests, and test order is
    // shuffled, so a stubbed `env` getter left in place would leak into
    // whichever test runs next.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('says which app Jasper runs in on every event', () => {
      initTelemetry(fakeContext());

      reportActivation(0);
      reportLoginAttempt({ version: '3.7.2', gem_host: 'localhost' }, 'connected');

      for (const name of ['activated', 'loginAttempted']) {
        expect(eventsNamed(name)[0].properties).toMatchObject({
          appUriScheme: 'vscode',
          appName: 'Visual Studio Code',
        });
      }
    });

    it.each([
      ['uriScheme', 'appUriScheme'],
      ['appName', 'appName'],
    ] as const)('sends unknown when the editor reports an empty %s', (envField, property) => {
      vi.spyOn(vscode.env, envField, 'get').mockReturnValue('  ');
      initTelemetry(fakeContext());

      reportActivation(0);

      expect(eventsNamed('activated')[0].properties).toMatchObject({ [property]: 'unknown' });
    });

    it("sends unknown when the editor's app name can't be read", () => {
      vi.spyOn(vscode.env, 'appName', 'get').mockImplementation(() => {
        throw new Error('boom');
      });
      initTelemetry(fakeContext());

      reportActivation(0);

      expect(eventsNamed('activated')[0].properties).toMatchObject({ appName: 'unknown' });
    });
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

  describe('connect attempts', () => {
    const login = { version: '3.7.2', gem_host: 'localhost' };

    it.each<LoginOutcome>(['connected', 'failed', 'cancelled', 'noClientLibrary'])(
      'records how the attempt ended',
      (outcome) => {
        initTelemetry(fakeContext());

        reportLoginAttempt(login, outcome);

        expect(eventsNamed('loginAttempted')[0].properties).toMatchObject({ outcome });
      },
    );

    it.each([
      ['3.7.2', '3.7.2'],
      ['3.7', '3.7.0'],
      ['3.7.1.4', '3.7.1.4'],
      [' 3.7.2 ', '3.7.2'],
      ['', 'unknown'],
      ['latest', 'unknown'],
    ])('records the configured GemStone version as digits only', (version, expected) => {
      initTelemetry(fakeContext());

      reportLoginAttempt({ ...login, version }, 'connected');

      expect(eventsNamed('loginAttempted')[0].properties).toMatchObject({
        gemstoneVersion: expected,
      });
    });

    it.each([
      ['localhost', 'local'],
      ['db.example.com', 'remote'],
    ])('says whether the server is on this machine', (gem_host, expected) => {
      initTelemetry(fakeContext());

      reportLoginAttempt({ ...login, gem_host }, 'connected');

      expect(eventsNamed('loginAttempted')[0].properties).toMatchObject({
        serverLocation: expected,
      });
    });

    it('counts a login with no host as remote', () => {
      initTelemetry(fakeContext());

      reportLoginAttempt({ version: '3.7.2' } as GemStoneLogin, 'connected');

      expect(eventsNamed('loginAttempted')[0].properties).toMatchObject({
        serverLocation: 'remote',
      });
    });

    it('leaves out the host, stone, user and password', () => {
      initTelemetry(fakeContext());
      const fullLogin = {
        version: '3.7.2',
        gem_host: 'db.acme-corp.example',
        stone: 'acme_production',
        gs_user: 'jsmith',
        gs_password: 'hunter2',
      };

      reportLoginAttempt(fullLogin, 'connected');

      const { properties } = eventsNamed('loginAttempted')[0];
      const ownNames = Object.keys(properties).filter((name) => !name.startsWith('common.'));
      expect(ownNames.sort()).toEqual([
        'appName',
        'appUriScheme',
        'extensionMode',
        'gemstoneVersion',
        'outcome',
        'serverLocation',
      ]);
    });

    it('sends the outcome the attempt returns', async () => {
      initTelemetry(fakeContext());

      await reportingLoginAttempt(login, () => Promise.resolve('cancelled'));

      const events = eventsNamed('loginAttempted');
      expect(events).toHaveLength(1);
      expect(events[0].properties).toMatchObject({ outcome: 'cancelled' });
    });

    it('sends failed and rethrows when the attempt throws', async () => {
      initTelemetry(fakeContext());
      const error = new Error('login exploded');

      await expect(reportingLoginAttempt(login, () => Promise.reject(error))).rejects.toBe(error);

      const events = eventsNamed('loginAttempted');
      expect(events).toHaveLength(1);
      expect(events[0].properties).toMatchObject({ outcome: 'failed' });
    });

    it("keeps the attempt's own error when the event can't be sent", async () => {
      initTelemetry(fakeContext());
      vi.spyOn(TelemetryReporter.prototype, 'sendTelemetryEvent').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});
      const error = new Error('login exploded');

      await expect(reportingLoginAttempt(login, () => Promise.reject(error))).rejects.toBe(error);
    });

    it("finishes the attempt when the event can't be sent", async () => {
      initTelemetry(fakeContext());
      vi.spyOn(TelemetryReporter.prototype, 'sendTelemetryEvent').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});

      await expect(
        reportingLoginAttempt(login, () => Promise.resolve('connected')),
      ).resolves.toBeUndefined();
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
