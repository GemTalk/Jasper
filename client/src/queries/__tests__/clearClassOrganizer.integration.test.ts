// A commit or an abort drops the session's cached ClassOrganizer by running clearClassOrganizerCode
// through executeFetchString, which fetches the doit's answer as a String. An answer that is not a
// String (it used to be `true`) made every commit and abort log a MessageNotUnderstood for
// #encodeAsUTF8 to the GemStone GCI channel, even though the cache was dropped.
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
  const cachedOrganizers = (): string =>
    executeFetchString(
      session(),
      `(SessionTemps current keys select: [:k | k isString and: [k asString beginsWith: 'JasperClassOrganizer_']]) size printString`,
    );

  it('drops the cached organizer and answers a String the fetch can read', () => {
    executeFetchString(session(), `${classOrganizerExpr()}. 'ok'`);
    expect(cachedOrganizers()).toBe('1');

    expect(() => executeFetchString(session(), clearClassOrganizerCode())).not.toThrow();

    expect(cachedOrganizers()).toBe('0');
  });
});
