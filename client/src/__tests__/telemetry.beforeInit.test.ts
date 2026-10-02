import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { __telemetry } from '../__mocks__/vscode';
import { reportActivation } from '../telemetry';

// Kept in its own file, alone, deliberately: telemetry.ts keeps `reporter` as
// module state, so this assertion is only meaningful in a module graph where
// `initTelemetry` has genuinely never run. telemetry.test.ts shares one such
// graph across several tests that DO call `initTelemetry`, and the default
// project shuffles test order within a file (client/vitest.config.ts), so
// putting this there would make it depend on which test happened to run
// first.
describe('telemetry, before initTelemetry has run', () => {
  it('sends nothing', () => {
    reportActivation(123);

    expect(__telemetry).toHaveLength(0);
  });
});
