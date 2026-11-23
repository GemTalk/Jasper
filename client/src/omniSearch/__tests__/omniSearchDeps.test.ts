/**
 * The session-bound deps both GemStone Search hosts build: the docked view's resolver and the
 * Spotter's builder. Here, only what regex search reads from them: whether the session has regex
 * support, and the re-check a commit or abort makes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
const mocks = vi.hoisted(() => ({ refresh: vi.fn(() => true) }));
vi.mock('../../regex/regexAvailability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../regex/regexAvailability')>()),
  refreshRegexSupportAvailable: mocks.refresh,
}));

import { buildSpotterDeps, buildViewContextResolver } from '../omniSearchCommand';
import type { ActiveSession, SessionManager } from '../../sessionManager';

const sessionWith = (regexSupportAvailable: boolean | undefined) =>
  ({ id: 3, regexSupportAvailable }) as unknown as ActiveSession;

const managerOf = (session: ActiveSession) =>
  ({
    getSelectedSession: () => session,
    getSessions: () => [session],
  }) as unknown as SessionManager;

beforeEach(() => mocks.refresh.mockClear());

describe.each([
  [
    'the docked view',
    async (s: ActiveSession) => (await buildViewContextResolver(managerOf(s))())!.deps,
  ],
  ['the Spotter', (s: ActiveSession) => Promise.resolve(buildSpotterDeps(s))],
])('%s', (_host, depsFor) => {
  it("reads the session's regex support live, so an install during the session shows", async () => {
    const session = sessionWith(false);
    const deps = await depsFor(session);
    expect(deps.regexAvailable?.()).toBe(false);

    (session as { regexSupportAvailable?: boolean }).regexSupportAvailable = true;

    expect(deps.regexAvailable?.()).toBe(true);
  });

  it('counts a session never checked as without regex support', async () => {
    const deps = await depsFor(sessionWith(undefined));

    expect(deps.regexAvailable?.()).toBe(false);
  });

  it('asks the stone again for that session when re-checking', async () => {
    const session = sessionWith(false);
    const deps = await depsFor(session);

    expect(deps.refreshRegexAvailable?.()).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledWith(session);
  });
});
