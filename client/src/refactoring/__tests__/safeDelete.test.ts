import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The picker navigates a System Browser / opens a document, both of which reach the
// extension's live wiring. Stub it: this suite is about the decision, not the navigation.
vi.mock('../../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { window } from '../../__mocks__/vscode';
import {
  decideSafeDelete,
  announceSilentDelete,
  dedupeMethodResults,
  groupReferencesByReceiver,
  SafeDeleteTarget,
} from '../safeDelete';
import { showMethodResults } from '../../methodResultsPicker';
import { METHOD_SEARCH_RESULT_LIMIT, type MethodSearchResult } from '../../queries/methodSearch';

/**
 * The safe-delete decision: what the user is asked before a method, class, instance
 * variable or class variable is removed. Nothing referencing the target means no
 * question at all; anything referencing it means a confirmation that names the
 * references and can show them. `vscode` and the result picker are mocked, so this
 * covers the whole decision table without a stone.
 */

const warn = window.showWarningMessage as ReturnType<typeof vi.fn>;
const info = window.showInformationMessage as ReturnType<typeof vi.fn>;
const picker = showMethodResults as ReturnType<typeof vi.fn>;

const SHOW = 'Show References…';

const reference = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Caller',
  isMeta: false,
  selector: 'callsIt',
  category: 'accessing',
  environmentId: 0,
  ...over,
});

const target = (over: Partial<SafeDeleteTarget> = {}): SafeDeleteTarget => ({
  kind: 'method',
  label: '#doomed from Victim',
  references: [],
  ...over,
});

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clearing drops recorded calls but LEAVES queued
  // `mockResolvedValueOnce` values. Tests here deliberately arm an answer they expect not
  // to be consumed (the browsing tests, which assert the dialog does NOT come back), so a
  // leftover would surface as the first answer the next test receives — an order-dependent
  // failure that only some shuffle seeds reveal.
  vi.resetAllMocks();
  // Default the picker to "closed the list without opening anything", the branch that loops
  // back; the test that opens a reference sets it explicitly.
  picker.mockResolvedValue(false);
});

describe('safe delete with nothing referencing the target', () => {
  it('proceeds without asking anything', async () => {
    const decision = await decideSafeDelete(1, target());

    expect(decision).toBe('silent');
    expect(warn).not.toHaveBeenCalled();
  });

  it('proceeds without asking when only a note accompanies the target', async () => {
    const decision = await decideSafeDelete(1, target({ note: 'Nothing is committed yet.' }));

    expect(decision).toBe('silent');
    expect(warn).not.toHaveBeenCalled();
  });

  it('announces the removal afterwards so a silent delete is still visible', () => {
    announceSilentDelete(target());

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Removed method #doomed from Victim'),
    );
  });

  it('says in the announcement that nothing referenced the target', () => {
    announceSilentDelete(target());

    expect(info).toHaveBeenCalledWith(expect.stringContaining('nothing referenced it'));
  });
});

describe('safe delete with methods still referencing the target', () => {
  it('asks for confirmation before removing anything', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ references: [reference()] }));

    expect(warn).toHaveBeenCalledWith(
      'Remove method #doomed from Victim?',
      expect.objectContaining({ modal: true }),
      SHOW,
      'Remove Anyway',
    );
  });

  it('counts the references in the confirmation', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({ references: [reference(), reference({ selector: 'alsoCallsIt' })] }),
    );

    expect(warn.mock.calls[0][1].detail).toContain('2 methods still reference it');
  });

  it('names the referencing methods in the confirmation', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({ references: [reference({ className: 'Ledger', selector: 'post' })] }),
    );

    expect(warn.mock.calls[0][1].detail).toContain('Ledger >> #post');
  });

  it('names the class side of a referencing class-side method', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ references: [reference({ isMeta: true })] }));

    expect(warn.mock.calls[0][1].detail).toContain('Caller class >> #callsIt');
  });

  it('names each referencing class once, however many of its methods are involved', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({
        references: [
          reference({ className: 'Account', selector: 'balance' }),
          reference({ className: 'Account', selector: 'deposit:' }),
          reference({ className: 'Savings', selector: 'accrue' }),
        ],
      }),
    );

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('Account >> #balance, #deposit:');
    expect(detail).toContain('Savings >> #accrue');
  });

  it('puts each referencing class on its own line', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({
        references: [
          reference({ className: 'Savings', selector: 'accrue' }),
          reference({ className: 'Account', selector: 'balance' }),
        ],
      }),
    );

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('Account >> #balance\nSavings >> #accrue');
  });

  it('keeps a class and its class side on separate lines', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({
        references: [
          reference({ className: 'Account', selector: 'record' }),
          reference({ className: 'Account', isMeta: true, selector: 'resetCount' }),
        ],
      }),
    );

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('Account >> #record');
    expect(detail).toContain('Account class >> #resetCount');
  });

  it('orders the classes the same way for the same set of references', async () => {
    warn.mockResolvedValue(undefined);
    const refs = [
      reference({ className: 'Zebra', selector: 'z' }),
      reference({ className: 'Apple', selector: 'a' }),
      reference({ className: 'Mango', selector: 'm' }),
    ];

    await decideSafeDelete(1, target({ references: refs }));
    await decideSafeDelete(1, target({ references: [...refs].reverse() }));

    const first = warn.mock.calls[0][1].detail as string;
    const second = warn.mock.calls[1][1].detail as string;
    expect(first).toBe(second);
    expect(first.indexOf('Apple')).toBeLessThan(first.indexOf('Mango'));
  });

  it('summarises a class with a very long method list rather than printing all of it', async () => {
    warn.mockResolvedValue(undefined);
    const many = Array.from({ length: 12 }, (_, i) =>
      reference({ className: 'Account', selector: `uses${i}` }),
    );

    await decideSafeDelete(1, target({ references: many }));

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('6 more');
    expect(detail).not.toContain('#uses11');
  });

  it('summarises the classes beyond the ones it lists', async () => {
    warn.mockResolvedValue(undefined);
    const many = Array.from({ length: 11 }, (_, i) =>
      reference({ className: `Caller${String(i).padStart(2, '0')}`, selector: 'usesIt' }),
    );

    await decideSafeDelete(1, target({ references: many }));

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('3 more classes');
    expect(detail).not.toContain('Caller10');
  });

  it('offers the references for browsing, and shows them when asked', async () => {
    const refs = [reference()];
    warn.mockResolvedValueOnce(SHOW).mockResolvedValueOnce(undefined);

    await decideSafeDelete(7, target({ references: refs }));

    expect(picker).toHaveBeenCalledWith(7, refs, expect.stringContaining('#doomed from Victim'));
  });

  it('abandons the deletion when the user opens one of the references', async () => {
    // Opening a reference means the user went to read that method. Re-raising a modal over
    // the code they just asked to see would interrupt them, with a destructive default.
    // The second answer is armed deliberately: if the deletion were NOT abandoned the loop
    // would come back, take it, and confirm — so this fails outright rather than hanging.
    warn.mockResolvedValueOnce(SHOW).mockResolvedValueOnce('Remove Anyway');
    picker.mockResolvedValue(true);

    const decision = await decideSafeDelete(1, target({ references: [reference()] }));

    expect(decision).toBe('cancelled');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('asks again when the user closes the reference list without opening anything', async () => {
    // Closing the list is not going anywhere — the user read it and is still deciding.
    warn.mockResolvedValueOnce(SHOW).mockResolvedValueOnce('Remove Anyway');
    picker.mockResolvedValue(false);

    const decision = await decideSafeDelete(1, target({ references: [reference()] }));

    expect(warn).toHaveBeenCalledTimes(2);
    expect(decision).toBe('confirmed');
  });

  it('removes the target when the user chooses to remove it anyway', async () => {
    warn.mockResolvedValue('Remove Anyway');

    const decision = await decideSafeDelete(1, target({ references: [reference()] }));

    expect(decision).toBe('confirmed');
  });

  it('leaves the target alone when the confirmation is dismissed', async () => {
    warn.mockResolvedValue(undefined);

    const decision = await decideSafeDelete(1, target({ references: [reference()] }));

    expect(decision).toBe('cancelled');
  });
});

describe('safe delete with something other than a method in the way', () => {
  it('asks for confirmation when the target carries blockers of its own', async () => {
    warn.mockResolvedValue(undefined);

    const decision = await decideSafeDelete(
      1,
      target({ kind: 'class', label: 'Doomed from UserGlobals', blockers: ['Sub1', 'Sub2'] }),
    );

    expect(decision).toBe('cancelled');
    expect(warn).toHaveBeenCalled();
  });

  it('names the blockers in the confirmation under their own heading', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({
        kind: 'class',
        label: 'Doomed from UserGlobals',
        blockers: ['Sub1'],
        blockerLead: 'Subclasses removed with it',
      }),
    );

    expect(warn.mock.calls[0][1].detail).toContain('Subclasses removed with it: Sub1');
  });

  it('does not offer browsing when the only obstacle is a blocker', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ kind: 'class', blockers: ['Sub1'] }));

    expect(warn.mock.calls[0]).not.toContain(SHOW);
  });

  it('uses the confirmation label the caller asked for', async () => {
    warn.mockResolvedValue('Remove All');

    const decision = await decideSafeDelete(
      1,
      target({ kind: 'class', blockers: ['Sub1'], confirmLabel: 'Remove All' }),
    );

    expect(decision).toBe('confirmed');
  });

  it('names the referencing methods and the blockers together', async () => {
    // A class with both is the ordinary case — something outside still uses it AND it takes
    // subclasses with it. Each obstacle has its own heading, and both must survive.
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({
        kind: 'class',
        label: 'Doomed from UserGlobals',
        references: [reference({ className: 'Teller', selector: 'serve' })],
        blockers: ['Sub1'],
        blockerLead: 'Subclasses removed with it',
      }),
    );

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('Teller >> #serve');
    expect(detail).toContain('Subclasses removed with it: Sub1');
  });

  it('still offers browsing when references accompany blockers', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({ kind: 'class', references: [reference()], blockers: ['Sub1'] }),
    );

    expect(warn.mock.calls[0]).toContain(SHOW);
  });

  it('adds the caller note to the confirmation', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(
      1,
      target({ blockers: ['Sub1'], note: 'Nothing is committed until you commit the session.' }),
    );

    expect(warn.mock.calls[0][1].detail).toContain('Nothing is committed until you commit');
  });
});

describe('safe delete when the reference scan could not answer', () => {
  it('asks for confirmation rather than assuming the target is unreferenced', async () => {
    warn.mockResolvedValue(undefined);

    const decision = await decideSafeDelete(1, target({ scanFailed: 'a SecurityError occurred' }));

    expect(decision).toBe('cancelled');
    expect(warn).toHaveBeenCalled();
  });

  it('says in the confirmation why the references are unknown', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ scanFailed: 'a SecurityError occurred' }));

    expect(warn.mock.calls[0][1].detail).toContain('a SecurityError occurred');
  });

  it('still removes the target when the user confirms', async () => {
    warn.mockResolvedValue('Remove');

    const decision = await decideSafeDelete(1, target({ scanFailed: 'timed out' }));

    expect(decision).toBe('confirmed');
  });
});

// The exact text of the two lists the demo fixture produces, so the format is pinned by
// something a reader can compare against a screenshot. Both are cases where one class owns
// several of the referencing methods — the reason the list groups at all.
describe('the reference list as it reads for a real removal', () => {
  const ref = (className: string, isMeta: boolean, selector: string): MethodSearchResult => ({
    dictName: 'UserGlobals',
    className,
    isMeta,
    selector,
    category: 'safe-delete-fixture',
    environmentId: 0,
  });

  it('reads as one line per receiver when removing a class variable', () => {
    const lines = groupReferencesByReceiver([
      ref('SdDemoAccount', false, 'sdDemoDeposit:'),
      ref('SdDemoAccount', true, 'resetCount'),
    ]);

    expect(lines).toEqual([
      'SdDemoAccount >> #sdDemoDeposit:',
      'SdDemoAccount class >> #resetCount',
    ]);
  });

  it('names the class once for two of its methods when removing an instance variable', () => {
    const lines = groupReferencesByReceiver([
      ref('SdDemoAccount', false, 'sdDemoBalance'),
      ref('SdDemoAccount', false, 'sdDemoDeposit:'),
      ref('SdDemoSavings', false, 'accrue'),
    ]);

    expect(lines).toEqual([
      'SdDemoAccount >> #sdDemoBalance, #sdDemoDeposit:',
      'SdDemoSavings >> #accrue',
    ]);
  });

  it('answers nothing for no references', () => {
    expect(groupReferencesByReceiver([])).toEqual([]);
  });
});

// A scan runs once per method environment, so the same method can come back more than once;
// the caller folds the rounds together before anything counts them or renders them.
describe('folding repeated scan results together', () => {
  const found = (className: string, isMeta: boolean, selector: string): MethodSearchResult => ({
    dictName: 'UserGlobals',
    className,
    isMeta,
    selector,
    category: 'accessing',
    environmentId: 0,
  });

  it('keeps one entry for a method found more than once', () => {
    const hit = found('Account', false, 'balance');

    expect(dedupeMethodResults([hit, { ...hit }])).toEqual([hit]);
  });

  it('keeps the same selector on both sides of a class, which are different methods', () => {
    const instance = found('Account', false, 'reset');
    const classSide = found('Account', true, 'reset');

    expect(dedupeMethodResults([instance, classSide])).toEqual([instance, classSide]);
  });

  it('keeps the same selector implemented by different classes', () => {
    const account = found('Account', false, 'balance');
    const savings = found('Savings', false, 'balance');

    expect(dedupeMethodResults([account, savings])).toEqual([account, savings]);
  });

  it('keeps the first sighting, so the earliest environment wins', () => {
    const first = found('Account', false, 'balance');
    const later = { ...first, category: 'a different category' };

    expect(dedupeMethodResults([first, later])).toEqual([first]);
  });

  it('answers nothing for nothing', () => {
    expect(dedupeMethodResults([])).toEqual([]);
  });
});

// The scan is capped server-side and the client cannot tell a full page from an exact answer,
// so at the cap the dialog must stop stating the count as fact.
describe('reporting a reference count that hit the scan cap', () => {
  const many = (n: number): MethodSearchResult[] =>
    Array.from({ length: n }, (_, i) => reference({ className: `C${i}`, selector: 'usesIt' }));

  it('states the count as a floor when the scan came back full', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ references: many(METHOD_SEARCH_RESULT_LIMIT) }));

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain(`At least ${METHOD_SEARCH_RESULT_LIMIT} methods still reference it`);
  });

  it('says the list is incomplete when the scan came back full', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ references: many(METHOD_SEARCH_RESULT_LIMIT) }));

    expect(warn.mock.calls[0][1].detail).toContain('not complete');
  });

  it('states the count plainly when the scan came back short of the cap', async () => {
    warn.mockResolvedValue(undefined);

    await decideSafeDelete(1, target({ references: many(3) }));

    const detail = warn.mock.calls[0][1].detail as string;
    expect(detail).toContain('3 methods still reference it:');
    expect(detail).not.toContain('At least');
  });
});

// Removing an override does not break dispatch, so the caller can say what actually happens
// to the senders instead of the untrue "nothing referenced it".
describe('announcing a removal that senders survive', () => {
  it('says where the senders now resolve', () => {
    announceSilentDelete(target({ silentNote: 'senders now resolve to Object >> #printOn:' }));

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('senders now resolve to Object >> #printOn:'),
    );
  });

  it('does not claim nothing referenced it', () => {
    announceSilentDelete(target({ silentNote: 'senders now resolve to Object >> #printOn:' }));

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('nothing referenced it'));
  });
});

// A selector implemented on both sides of a class, or in two environments, is more than one
// method; the dialog must not merge them into one line.
describe('keeping methods that differ only by environment apart', () => {
  it('lists a selector found in two environments once per environment', () => {
    const env0 = reference({ className: 'Account', selector: 'balance', environmentId: 0 });
    const env1 = reference({ className: 'Account', selector: 'balance', environmentId: 1 });

    expect(dedupeMethodResults([env0, env1])).toEqual([env0, env1]);
  });
});
