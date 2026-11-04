import { describe, it, expect, beforeEach } from 'vitest';
import { REFUSAL_REPORT_SLACK_MS, SessionLedger } from './sessionGateLedger';

// Watcher samples are login serial -> GCI client process id.
const stone = (...sessions: [serial: string, pid: number][]) => new Map(sessions);

describe('the session gate ledger', () => {
  let now: number;
  let ledger: SessionLedger<string>;

  beforeEach(() => {
    now = 1_000;
    ledger = new SessionLedger<string>(9, () => now);
    ledger.sample(stone());
  });

  const book = (key: string, n: number, pid = 100) => {
    ledger.request(key, { file: `/x/client/${key}.test.ts`, pid, n });
    return ledger.grant();
  };

  describe('booking', () => {
    it('books nothing before the watcher has looked at the stone', () => {
      const fresh = new SessionLedger<string>(9, () => now);
      fresh.request('a', { file: 'a', pid: 1, n: 1 });
      expect(fresh.grant()).toEqual([]);
    });

    it('books files in arrival order while they fit', () => {
      expect(book('a', 4)).toEqual(['a']);
      expect(book('b', 4)).toEqual(['b']);
      expect(book('c', 2)).toEqual([]);
      expect(ledger.committed()).toBe(8);
    });

    it('keeps a small request behind a large one that does not fit yet', () => {
      book('a', 8);
      expect(book('big', 3)).toEqual([]);
      expect(book('small', 1)).toEqual([]);
      ledger.release('a');
      expect(ledger.grant()).toEqual(['big', 'small']);
    });

    it('gives a released booking to the next in line', () => {
      book('a', 9);
      expect(book('b', 2)).toEqual([]);
      ledger.release('a');
      expect(ledger.grant()).toEqual(['b']);
    });

    it('drops a request that is withdrawn before it is booked', () => {
      book('a', 9);
      book('b', 2);
      expect(ledger.withdraw('b')).toBe(true);
      ledger.release('a');
      expect(ledger.grant()).toEqual([]);
    });

    it('counts a session no running file reported as taken', () => {
      ledger.sample(stone(['7', 999], ['8', 999]));
      expect(ledger.committed()).toBe(2);
      expect(book('a', 8)).toEqual([]);
    });

    it("keeps counting a released file's gem until it leaves the stone", () => {
      book('a', 2);
      ledger.opened('a', '10');
      ledger.sample(stone(['10', 100]));
      ledger.release('a');
      expect(ledger.committed()).toBe(1);
      ledger.sample(stone());
      expect(ledger.committed()).toBe(0);
    });
  });

  describe('a file over its booking', () => {
    // A books 2, B 3, C 4: all 9. B has 2 of its 3 open, so A's 3rd login fits on the stone.
    beforeEach(() => {
      book('A', 2, 1);
      book('B', 3, 2);
      book('C', 4, 3);
      for (const [key, serials] of [
        ['A', ['1', '2', '3']],
        ['B', ['4', '5']],
        ['C', ['6', '7', '8', '9']],
      ] as const) {
        for (const serial of serials) ledger.opened(key, serial);
      }
      ledger.sample(
        stone(
          ['1', 1],
          ['2', 1],
          ['3', 1],
          ['4', 2],
          ['5', 2],
          ['6', 3],
          ['7', 3],
          ['8', 3],
          ['9', 3],
        ),
      );
    });

    it('counts what it has on the stone, not what it booked', () => {
      expect(ledger.committed()).toBe(10);
    });

    it("doesn't give the next file the slot it is using", () => {
      ledger.release('B');
      ledger.sample(stone(['1', 1], ['2', 1], ['3', 1], ['6', 3], ['7', 3], ['8', 3], ['9', 3]));
      expect(book('D', 3, 4)).toEqual([]);
      expect(book('E', 2, 5)).toEqual([]);
    });

    it('is reported with what it booked and the most it had logged in', () => {
      expect(ledger.overBudgetOf('A')).toEqual({ booked: 2, seen: 3 });
      expect(ledger.overBudget().get('/x/client/A.test.ts')).toEqual({ booked: 2, seen: 3 });
    });

    it('stays reported after it drops back within its booking', () => {
      ledger.sample(stone(['1', 1]));
      expect(ledger.overBudgetOf('A')).toEqual({ booked: 2, seen: 3 });
    });

    it('is the only one reported', () => {
      expect(ledger.overBudgetOf('B')).toBeUndefined();
      expect(ledger.overBudgetOf('C')).toBeUndefined();
    });
  });

  describe('a session that has logged out but whose gem is still on the stone', () => {
    beforeEach(() => {
      book('a', 1);
      ledger.opened('a', '10');
      ledger.sample(stone(['10', 100]));
      ledger.closed('a', '10');
      ledger.opened('a', '11');
      ledger.sample(stone(['10', 100], ['11', 100]));
    });

    it("doesn't count against its file's booking", () => {
      expect(ledger.overBudgetOf('a')).toBeUndefined();
    });

    it('still counts as taken', () => {
      expect(ledger.committed()).toBe(2);
    });

    it('counts against the booking while still logged in', () => {
      ledger.opened('a', '12');
      ledger.sample(stone(['10', 100], ['11', 100], ['12', 100]));
      expect(ledger.overBudgetOf('a')).toEqual({ booked: 1, seen: 2 });
    });
  });

  describe('unreported logins', () => {
    it('are answered for the file whose worker made them, once', () => {
      book('a', 2, 100);
      book('b', 2, 200);
      ledger.opened('a', '10');
      ledger.sample(stone(['10', 100], ['11', 100], ['12', 200]));
      expect(ledger.unreportedFrom('a').map((u) => u.serial)).toEqual(['11']);
      expect(ledger.unreportedFrom('a')).toEqual([]);
      expect(ledger.unreportedFrom('b').map((u) => u.serial)).toEqual(['12']);
    });

    it('are not blamed on a file for sessions already on the stone before the run', () => {
      const fresh = new SessionLedger<string>(9, () => now);
      expect(fresh.sample(stone(['5', 100]))).toEqual(stone(['5', 100]));
      fresh.request('a', { file: 'a', pid: 100, n: 1 });
      fresh.grant();
      fresh.sample(stone(['5', 100]));
      expect(fresh.unreportedFrom('a')).toEqual([]);
    });

    it('made outside any booking are left as stray', () => {
      book('a', 1, 100);
      ledger.release('a');
      ledger.sample(stone(['20', 100], ['21', 555]));
      expect(ledger.stray()).toEqual([{ serial: '20', pid: 100 }]);
    });
  });

  describe('logins too short for the watcher to see', () => {
    it('are found as gaps in the login serials, with the files running then', () => {
      book('a', 2);
      ledger.opened('a', '11');
      now += 100;
      ledger.opened('a', '13');
      expect(ledger.loginsNeverSeen(10, 14)).toEqual([{ serial: 12, running: ['a.test.ts'] }]);
    });

    it('are excused one each by a refusal reported near them', () => {
      book('a', 2);
      ledger.opened('a', '11');
      now += 100;
      ledger.refused();
      ledger.opened('a', '14');
      expect(ledger.loginsNeverSeen(10, 15).map((m) => m.serial)).toEqual([13]);
    });

    it('are not excused by a refusal long before them', () => {
      book('a', 2);
      ledger.refused();
      now += REFUSAL_REPORT_SLACK_MS + 1_000;
      ledger.opened('a', '11');
      now += 100;
      ledger.opened('a', '13');
      expect(ledger.loginsNeverSeen(undefined, 14).map((m) => m.serial)).toEqual([12]);
    });
  });
});
