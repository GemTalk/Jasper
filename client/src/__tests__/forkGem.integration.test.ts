import { describe, it, expect, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as browserQueries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
// eslint-disable-next-line no-restricted-imports -- forking is this file's subject, so it is the one integration test allowed to spawn a gem the harness never armed; the forked gems here only sleep, and write nothing
import { canForkGem, forkGemRunning } from '../queries/forkGem';

/**
 * Forking a gem, against a live stone.
 *
 * The unit tests pin the Smalltalk this builds, but only a stone can say
 * whether GemStone accepts it — and it did not, at first: `GsTsExternalSession
 * newDefault` assumes the NetLDI is called `gs64ldi`, so the fork failed with
 * "ERROR 2710, NetLDI service 'gs64ldi' not found" against a stone whose NetLDI
 * is named anything else (which is most of them, including this one). Setting
 * `gemNRS:` is what fixes it, and this test is what keeps it fixed.
 *
 * The forked gem runs a one-second sleep and exits on its own, so nothing is
 * left behind holding a session.
 */
describe('forking a gem (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const execute = (code: string): string => browserQueries.executeFetchString(session(), code);

  // The NetLDI this stone actually uses, as the harness itself connects through.
  const gemNrs = (): string => process.env.VITE_GEMSTONE_GEM_NRS!;

  // 3.6.2 has neither the one-time password selector nor a working
  // `newDefault`, so there is nothing to test there — the capability check
  // itself is what protects users on those stones.
  const supported = (): boolean => canForkGem(execute);

  it('runs an expression in a gem of its own and answers its session id', (ctx) => {
    if (!supported()) return ctx.skip();

    const id = forkGemRunning(execute, 'System sleep: 1', gemNrs());

    expect(id.trim()).toMatch(/^\d+$/);
  });

  it('gives the new gem a session distinct from this one', (ctx) => {
    if (!supported()) return ctx.skip();

    // Compare stone session ids, not serial numbers. forkGemRunning answers the
    // fork's `stoneSessionId` — its slot in the session table — so this session
    // must be read the same way (`System session`). A session's `serialNumber`
    // is a separate counter, so comparing one against the other is meaningless:
    // they collide by coincidence (a harness whose serial is 5 against a fork
    // that lands in slot 5), which is exactly what made this test flaky. Both
    // sessions are live at the moment the fork's id is read, and two live
    // sessions can never occupy the same slot, so this comparison is now exact.
    const mySession = execute('System session printString');

    const id = forkGemRunning(execute, 'System sleep: 1', gemNrs());

    expect(id.trim()).not.toBe(mySession.trim());
  });

  it('runs the gem as the user who asked, never SystemUser', (ctx) => {
    if (!supported()) return ctx.skip();

    const me = execute('System myUserProfile userId').trim();

    // The gem logs in with a one-time password minted for this same user, so a
    // successful fork is itself the evidence — minting for anyone else would
    // need privileges this session does not have.
    expect(me).not.toBe('SystemUser');
    expect(forkGemRunning(execute, 'System sleep: 1', gemNrs()).trim()).toMatch(/^\d+$/);
  });
});
