import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../debugQueries', () => ({
  saveObjs: vi.fn(),
  releaseObjs: vi.fn(),
}));

import * as debug from '../debugQueries';
import { ActiveSession } from '../sessionManager';
import { pinObject, unpinObjects, forgetSession, pinCount } from '../exportSetPins';

const session = { id: 1 } as unknown as ActiveSession;
const other = { id: 2 } as unknown as ActiveSession;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(debug.saveObjs).mockImplementation(() => {});
  vi.mocked(debug.releaseObjs).mockImplementation(() => {});
  forgetSession(session.id);
  forgetSession(other.id);
});

describe('export-set pins', () => {
  it('saves an object into the export set on the first claim only', () => {
    pinObject(session, 500n);
    pinObject(session, 500n);

    expect(debug.saveObjs).toHaveBeenCalledTimes(1);
    expect(debug.saveObjs).toHaveBeenCalledWith(session, [500n]);
    expect(pinCount(session.id, 500n)).toBe(2);
  });

  /**
   * The bug the registry exists for: the debugger and a basic Inspector on one
   * session both holding the same original, and the debugger clearing its undo
   * state first (a step, resume or restart).
   */
  it('keeps an object pinned while another holder still wants it', () => {
    pinObject(session, 500n); // the debugger's original
    pinObject(session, 500n); // the same object, held by an inspector slot

    unpinObjects(session, [500n]); // the debugger steps: clearUndoState()

    expect(debug.releaseObjs).not.toHaveBeenCalled();
    expect(pinCount(session.id, 500n)).toBe(1);

    unpinObjects(session, [500n]); // the inspector panel closes

    expect(debug.releaseObjs).toHaveBeenCalledWith(session, [500n]);
    expect(pinCount(session.id, 500n)).toBe(0);
  });

  it('drops two claims when a holder pinned the same object twice', () => {
    pinObject(session, 500n);
    pinObject(session, 500n);

    // One holder, two slots whose original is the same object — it releases
    // the OOP once per slot, and nobody else is holding it.
    unpinObjects(session, [500n, 500n]);

    expect(debug.releaseObjs).toHaveBeenCalledWith(session, [500n]);
  });

  it('releases every OOP whose last claim went in one call', () => {
    pinObject(session, 500n);
    pinObject(session, 600n);
    pinObject(session, 700n);
    pinObject(session, 700n); // a second holder wants 700 kept

    unpinObjects(session, [500n, 600n, 700n]);

    expect(debug.releaseObjs).toHaveBeenCalledTimes(1);
    expect(debug.releaseObjs).toHaveBeenCalledWith(session, [500n, 600n]);
  });

  it('records nothing when the stone refuses the save', () => {
    vi.mocked(debug.saveObjs).mockImplementation(() => {
      throw new Error('GciTsSaveObjs failed');
    });

    expect(() => pinObject(session, 500n)).toThrow('GciTsSaveObjs failed');
    expect(pinCount(session.id, 500n)).toBe(0);
  });

  it('forgets the bookkeeping even when the release fails', () => {
    pinObject(session, 500n);
    vi.mocked(debug.releaseObjs).mockImplementation(() => {
      throw new Error('session is gone');
    });

    expect(() => unpinObjects(session, [500n])).toThrow('session is gone');
    expect(pinCount(session.id, 500n)).toBe(0);
  });

  it('counts claims per session — the same OOP number means different objects', () => {
    pinObject(session, 500n);
    pinObject(other, 500n);

    expect(debug.saveObjs).toHaveBeenCalledTimes(2);

    unpinObjects(session, [500n]);

    expect(debug.releaseObjs).toHaveBeenCalledWith(session, [500n]);
    expect(pinCount(other.id, 500n)).toBe(1);
  });

  it('ignores an unpin for something never pinned', () => {
    unpinObjects(session, [500n]);

    expect(debug.releaseObjs).not.toHaveBeenCalled();
  });

  it('forgetSession drops the claims without asking the stone', () => {
    pinObject(session, 500n);

    forgetSession(session.id);

    expect(debug.releaseObjs).not.toHaveBeenCalled();
    expect(pinCount(session.id, 500n)).toBe(0);
  });
});
