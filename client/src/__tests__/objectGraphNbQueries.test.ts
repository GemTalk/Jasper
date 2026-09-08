// The non-blocking wrappers the panel actually calls.
//
// A repository scan is ~150 ms on a large stone, and a synchronous GCI call freezes the
// whole extension host for its duration — which is why nothing could ever paint a progress
// indicator over one, and why several quick hops still felt sluggish. These four route the
// round trip through the nb runner instead. Each is thin, and each is the only place one
// builder is paired with one parser, so a mismatched pair would answer a well-formed empty
// graph rather than failing.
//
// Driven against a fake GCI rather than a mocked nb runner: the runner is the part that
// would break the responsiveness these exist for.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('../socketPoll', () => ({ pollReadable: vi.fn(() => 1) }));

import * as q from '../browserQueries';
import { ActiveSession } from '../sessionManager';

describe('the non-blocking reference-graph queries', () => {
  let reply: string;
  let executed: string[];
  let session: ActiveSession;

  beforeEach(() => {
    reply = 'ok\t0\n';
    executed = [];
    session = {
      id: 1,
      handle: {},
      login: { label: 'T' },
      gci: {
        GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
        utf8ClassOop: vi.fn(() => 100n),
        GciTsNbExecute: vi.fn((_h: unknown, code: string) => {
          executed.push(code);
          return { success: true, err: { number: 0, message: '' } };
        }),
        GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
        GciTsNbResult: vi.fn(() => ({ result: 200n, err: { number: 0, message: '' } })),
        GciTsFetchChars: vi.fn(() => ({ data: reply, err: { number: 0, message: '' } })),
        GciTsSocket: vi.fn(() => ({ fd: 7, err: { number: 0 } })),
        isAvailable: vi.fn(() => true),
        GciTsClearStack: vi.fn(),
      },
    } as unknown as ActiveSession;
  });

  it('sends the referrer scan and reads its groups back', async () => {
    reply = 'ok\t24\nGsNMethod\t144897\t496\t0\nend\t1\n';

    await expect(q.referrersOfNb(session, 66817n)).resolves.toEqual({
      kind: 'ok',
      scanMillis: 24,
      groups: [{ referrerClass: 'GsNMethod', referrerClassOop: '144897', count: 496 }],
    });
    expect(executed[0]).toContain('allReferencesByParentClass');
    expect(executed[0]).toContain('objectForOop: 66817');
  });

  it('sends the referrer listing and reads its page back', async () => {
    reply = 'ok\t12\n496\n100\t0\tanArray( 1, 2 )\nend\t2\n';

    await expect(q.referrerObjectsOfNb(session, 1n, 2n)).resolves.toMatchObject({
      kind: 'ok',
      total: 496,
      objects: [{ oop: '100', isClass: false, printString: 'anArray( 1, 2 )' }],
    });
  });

  it('sends the collection scan and reads back what to open', async () => {
    reply = 'ok\t30\n4096\t4096\t31553793\nend\t1\n';

    await expect(q.referrerCollectionOfNb(session, 1n, 2n)).resolves.toMatchObject({
      kind: 'ok',
      oop: '31553793',
      total: 4096,
    });
  });

  it('sends the slot read and reads the edges back', async () => {
    reply = 'ok\t0\n10\t20\tpartner\nend\t1\n';

    await expect(q.slotEdgesAmongNb(session, ['10', '20'])).resolves.toEqual({
      kind: 'ok',
      edges: [{ fromOop: '10', toOop: '20', via: 'partner' }],
    });
  });

  it('answers the empty edge set without troubling the session', async () => {
    await expect(q.slotEdgesAmongNb(session, ['10'])).resolves.toEqual({ kind: 'ok', edges: [] });

    expect(session.gci.GciTsNbExecute).not.toHaveBeenCalled();
  });

  it('carries a dirty session back as needsCommit, not as a failure', async () => {
    reply = 'needsCommit';

    await expect(q.referrersOfNb(session, 1n)).resolves.toEqual({ kind: 'needsCommit' });
  });

  it('refuses to queue behind another call on the same session', async () => {
    // Two scans on one session trip GemStone's own busy check, which surfaces as an error
    // the user did not cause; the panel serialises clicks for the same reason.
    session.gci.GciTsCallInProgress = vi.fn(() => ({ result: 1, err: { number: 0 } })) as never;

    await expect(q.referrersOfNb(session, 1n)).rejects.toThrow(/busy/i);
  });

  it('refuses a reply the transport cut short', async () => {
    // This is the layer where truncation happens: one 256 KB GciTsFetchChars, no check for
    // an overrun. The referrers of `Object` are ~254 KB on a 3.7.5 stone, so a slightly
    // bigger one arrives with rows missing and a perfectly valid `ok` header.
    reply = 'ok\t24\nGsNMethod\t144897\t496\t0\n';

    const result = await q.referrersOfNb(session, 66817n);

    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toContain('cut short');
  });
});
