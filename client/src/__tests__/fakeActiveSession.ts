import { ActiveSession } from '../activeSession';
import { OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import type { GciLibrary } from '../gciLibrary';
import type { GemStoneLogin } from '../loginTypes';

type FakeFields = Partial<Omit<ActiveSession, 'login'>> & {
  gci?: object;
  handle?: unknown;
  login?: Partial<GemStoneLogin>;
};

/**
 * A real `ActiveSession` for unit tests, built around a fake GCI library and
 * whichever fields the test cares about. Fields it leaves out stay
 * `undefined` (except `id`, which defaults to 1), and the fake library
 * answers only the calls it defines.
 */
export function fakeActiveSession(fields: FakeFields = {}): ActiveSession {
  const { id = 1, gci, handle, login, stoneVersion, ...state } = fields;
  return Object.assign(
    new ActiveSession(
      id,
      gci as GciLibrary,
      handle,
      login as GemStoneLogin,
      stoneVersion as string,
    ),
    state,
  );
}

/**
 * A `fakeActiveSession` on `gci`, with filler for the handle, login and stone
 * version that query tests don't read. `fields` overrides any of them.
 */
export function sessionOn(gci: object, fields: FakeFields = {}): ActiveSession {
  return fakeActiveSession({
    handle: {},
    login: { label: 'Test' },
    stoneVersion: '3.7.5',
    ...fields,
    gci,
  });
}

/**
 * Leaves `session` with a non-blocking call started and its result not yet
 * read, as a running Execute It does: GemStone refuses any other call on the
 * session until then. The session's fake library has to start the call, so it
 * answers GciTsNbExecute with success.
 */
export function startNonBlockingCall(session: ActiveSession): void {
  const started = session.GciTsNbExecute('nil', OOP_ILLEGAL, OOP_ILLEGAL, OOP_NIL, 0, 0);
  if (!started?.success) throw new Error('The fake library did not start the non-blocking call');
}
