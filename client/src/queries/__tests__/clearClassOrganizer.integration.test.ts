// A commit or an abort drops the session's cached ClassOrganizer by running clearClassOrganizerCode
// through executeFetchString, which fetches the doit's answer as a String. Any other answer fails
// the fetch with a MessageNotUnderstood for #encodeAsUTF8, logged to the GemStone GCI channel on
// every commit and abort although the cache was dropped.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { GciLibrary } from '../../gciLibrary';
import { executeFetchString } from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { classOrganizerExpr, clearClassOrganizerCode } from '../classOrganizer';

describe('clearClassOrganizerCode (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => testActiveSession(gci, handle);
  // Environment 0's organizer only: another test on this session may have cached one for another.
  const organizerCached = (): string =>
    executeFetchString(
      session(),
      `(SessionTemps current includesKey: #'JasperClassOrganizer_0') printString`,
    );

  it('drops the cached organizer and answers a String the fetch can read', () => {
    executeFetchString(session(), `${classOrganizerExpr()}. 'ok'`);
    expect(organizerCached()).toBe('true');

    expect(() => executeFetchString(session(), clearClassOrganizerCode())).not.toThrow();

    expect(organizerCached()).toBe('false');
  });
});
