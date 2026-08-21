import { describe, it, expect } from 'vitest';
import {
  DatabaseProcessState,
  ProcessHealth,
  databaseStatus,
  isConnectable,
} from '../databaseServerStatus';

function health(overrides: Partial<ProcessHealth> = {}): ProcessHealth {
  return { running: true, responding: true, external: false, ...overrides };
}

function state(
  stone: Partial<ProcessHealth> = {},
  netldi: Partial<ProcessHealth> = {},
): DatabaseProcessState {
  return { stone: health(stone), netldi: health(netldi) };
}

const DOWN = { running: false, responding: false };
const WEDGED = { running: true, responding: false };
const OUTSIDE = { running: false, responding: false, external: true };

describe('databaseStatus', () => {
  it('shows both servers running when the database is healthy', () => {
    expect(databaseStatus(state())).toEqual({ stone: 'running', netldi: 'running' });
  });

  it('shows both stopped when nothing is running', () => {
    expect(databaseStatus(state(DOWN, DOWN))).toEqual({ stone: 'stopped', netldi: 'stopped' });
  });

  it('will not call a stone plainly running while nothing can reach it', () => {
    // The contradiction this state exists to end: the row said Running and the
    // login failed, because a login has to come in through the NetLDI.
    expect(databaseStatus(state({}, DOWN)).stone).toBe('unreachable');
  });

  it('will not call a stone plainly running while its listener is wedged', () => {
    expect(databaseStatus(state({}, WEDGED)).stone).toBe('unreachable');
  });

  it('will not call a stone plainly running while its listener was started elsewhere', () => {
    expect(databaseStatus(state({}, OUTSIDE)).stone).toBe('unreachable');
  });

  it('does not hold a stopped stone against its listener', () => {
    // A NetLDI does not need the stone, so there is nothing wrong with it here.
    expect(databaseStatus(state(DOWN, {})).netldi).toBe('running');
  });

  it('distinguishes a wedged server from a stopped one', () => {
    expect(databaseStatus(state(WEDGED, {})).stone).toBe('not-responding');
  });

  it('reports a server alive outside Jasper rather than calling it stopped', () => {
    expect(databaseStatus(state(OUTSIDE, OUTSIDE))).toEqual({
      stone: 'external',
      netldi: 'external',
    });
  });

  it('reports a server as started elsewhere even while gslist also lists one', () => {
    // Two servers of the same name can be alive at once — one Jasper started
    // and one it did not. The mismatch is the more urgent thing to say.
    expect(databaseStatus(state({ external: true }, {})).stone).toBe('external');
  });
});

describe('isConnectable', () => {
  it('expects a connect to succeed when both servers are healthy', () => {
    expect(isConnectable(state())).toBe(true);
  });

  it('expects a connect to fail when either server is down', () => {
    expect(isConnectable(state(DOWN, {}))).toBe(false);
    expect(isConnectable(state({}, DOWN))).toBe(false);
  });

  it('expects a connect to fail when a server is wedged', () => {
    expect(isConnectable(state(WEDGED, {}))).toBe(false);
  });

  it('expects a connect to fail when a server is registered outside Jasper', () => {
    // Jasper cannot traverse a NetLDI its own gslist does not see, however
    // alive the process is.
    expect(isConnectable(state({}, OUTSIDE))).toBe(false);
  });

  it('agrees with what the tree shows: nothing but a plain Running connects', () => {
    // The tree and the login-failure recovery share this predicate precisely so
    // they cannot tell the user different things.
    const cases: DatabaseProcessState[] = [
      state(DOWN, {}),
      state(WEDGED, {}),
      state(OUTSIDE, {}),
      state({}, DOWN),
      state({}, WEDGED),
      state({}, OUTSIDE),
    ];

    for (const s of cases) {
      const status = databaseStatus(s);
      expect(isConnectable(s)).toBe(status.stone === 'running' && status.netldi === 'running');
    }
  });
});
