// After a commit or an abort, Jasper drops the session's cached ClassOrganizer. The drop must not
// write an error to the GemStone GCI channel: it once did on every commit and abort, as a
// MessageNotUnderstood for #encodeAsUTF8, although the cache had been dropped.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', async (orig) => ({
  ...(await orig()),
  logError: vi.fn(),
}));

import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import { GciLibrary } from '../gciLibrary';
import { executeFetchString } from '../browserQueries';
import { logError } from '../gciLog';
import type { ActiveSession } from '../sessionManager';
import { classOrganizerExpr } from '../queries/classOrganizer';
import { dropCachedClassOrganizer } from '../classOrganizerCache';

describe('dropping the cached ClassOrganizer after a commit or an abort (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  // One commit and one abort: each spends a nested transaction level.
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
    },
    { allowedCommits: 2 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  // Environment 0's organizer only: another test on this session may have cached one for another.
  const organizerCached = (): string =>
    executeFetchString(
      session(),
      `(SessionTemps current includesKey: #'JasperClassOrganizer_0') printString`,
    );

  beforeEach(() => {
    vi.mocked(logError).mockClear();
    executeFetchString(session(), `${classOrganizerExpr()}. 'ok'`);
    expect(organizerCached()).toBe('true');
  });

  it('drops it after a commit, logging no error', () => {
    expect(executeFetchString(session(), 'System commitTransaction printString')).toBe('true');

    dropCachedClassOrganizer(session());

    expect(logError).not.toHaveBeenCalled();
    expect(organizerCached()).toBe('false');
  });

  it('drops it after an abort, logging no error', () => {
    executeFetchString(session(), `System abortTransaction. 'ok'`);

    dropCachedClassOrganizer(session());

    expect(logError).not.toHaveBeenCalled();
    expect(organizerCached()).toBe('false');
  });
});
