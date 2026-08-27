import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  implementorsOf: vi.fn(() => []),
  getSourceOffsets: vi.fn(() => []),
  getMethodSource: vi.fn(() => ''),
}));

import {
  debug,
  window,
  FunctionBreakpoint,
  SourceBreakpoint,
  __setConfig,
  __resetConfig,
} from '../__mocks__/vscode';
import { FunctionBreakpointResolver, parseFunctionName } from '../functionBreakpoints';
import { SessionManager } from '../sessionManager';
import { implementorsOf, getSourceOffsets, getMethodSource } from '../browserQueries';

const mockImplementors = vi.mocked(implementorsOf);
const mockOffsets = vi.mocked(getSourceOffsets);
const mockSource = vi.mocked(getMethodSource);

describe('parseFunctionName', () => {
  it('reads a bare selector as "whoever implements it"', () => {
    expect(parseFunctionName('balance')).toEqual({ isMeta: false, selector: 'balance' });
  });

  it('reads a keyword selector', () => {
    expect(parseFunctionName('at:put:')).toEqual({ isMeta: false, selector: 'at:put:' });
  });

  it('reads a binary selector, which looks nothing like an identifier', () => {
    expect(parseFunctionName('//')).toEqual({ isMeta: false, selector: '//' });
    expect(parseFunctionName(',')).toEqual({ isMeta: false, selector: ',' });
  });

  it('reads an instance-side qualified name', () => {
    expect(parseFunctionName('Account>>balance')).toEqual({
      className: 'Account',
      isMeta: false,
      selector: 'balance',
    });
  });

  it('reads a class-side qualified name', () => {
    expect(parseFunctionName('Account class>>new')).toEqual({
      className: 'Account',
      isMeta: true,
      selector: 'new',
    });
  });

  it('tolerates the spacing a Smalltalker actually types', () => {
    expect(parseFunctionName('  Account class >> at:put:  ')).toEqual({
      className: 'Account',
      isMeta: true,
      selector: 'at:put:',
    });
  });

  it('tolerates a # on the selector', () => {
    expect(parseFunctionName('Account>>#balance')).toEqual({
      className: 'Account',
      isMeta: false,
      selector: 'balance',
    });
    expect(parseFunctionName('#balance')).toEqual({ isMeta: false, selector: 'balance' });
  });

  it('keeps a qualified keyword selector whole', () => {
    expect(parseFunctionName('Dictionary>>at:ifAbsent:')?.selector).toBe('at:ifAbsent:');
  });

  it('rejects empty input', () => {
    expect(parseFunctionName('   ')).toBeNull();
  });

  it('rejects a malformed qualified name rather than reading it as a selector', () => {
    // '>>' present but the class half is not a class name — treating the whole
    // string as a selector would look up something that cannot exist.
    expect(parseFunctionName('123>>balance')).toBeNull();
    expect(parseFunctionName('>>balance')).toBeNull();
  });
});

describe('FunctionBreakpointResolver', () => {
  function makeSessionManager(hasSession = true) {
    return {
      getSelectedSession: vi.fn(() =>
        hasSession ? { id: 1, gci: {}, handle: 'h', login: {}, stoneVersion: '3.7.5' } : undefined,
      ),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
  }

  const account = {
    dictName: 'Globals',
    className: 'Account',
    isMeta: false,
    selector: 'balance',
    category: 'accessing',
    environmentId: 0,
  };
  const savings = { ...account, className: 'SavingsAccount' };

  const warn = () => vi.mocked(window.showWarningMessage);
  const added = () => vi.mocked(debug.addBreakpoints);
  const removed = () => vi.mocked(debug.removeBreakpoints);

  beforeEach(() => {
    __resetConfig();
    debug.breakpoints = [];
    added().mockClear();
    removed().mockClear();
    warn().mockClear();
    vi.mocked(window.showQuickPick).mockReset();
    mockImplementors.mockReset().mockReturnValue([]);
    // 'balance\n^total' — first step point at 1-based 9, i.e. line 2 column 0.
    mockOffsets.mockReset().mockReturnValue([9]);
    mockSource.mockReset().mockReturnValue('balance\n^total');
  });

  /** The SourceBreakpoint the resolver added, if any. */
  const addedSourceBreakpoint = () =>
    added().mock.calls.at(-1)?.[0]?.[0] as SourceBreakpoint | undefined;

  it('converts a single implementor into a located breakpoint on entry', async () => {
    mockImplementors.mockReturnValue([account]);
    const bp = new FunctionBreakpoint('balance');

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    // The named breakpoint is replaced, not kept alongside.
    expect(removed()).toHaveBeenCalledWith([bp]);
    const source = addedSourceBreakpoint();
    expect(source).toBeInstanceOf(SourceBreakpoint);
    // Offset 8 in 'balance\n^total' is line 1 (0-based), column 0.
    expect(source?.location.range.start).toMatchObject({ line: 1, character: 0 });
    expect(source?.location.uri.toString()).toContain(
      '/Globals/Account/instance/accessing/balance',
    );
  });

  it('does not prompt when only one class implements the selector', async () => {
    mockImplementors.mockReturnValue([account]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);
    expect(vi.mocked(window.showQuickPick)).not.toHaveBeenCalled();
  });

  it('asks which class when several implement the selector', async () => {
    mockImplementors.mockReturnValue([savings, account]);
    vi.mocked(window.showQuickPick).mockResolvedValue({ target: savings });
    const bp = new FunctionBreakpoint('balance');
    // The resolver only ever sees breakpoints VS Code holds — the event fires
    // *because* they are in the list — and it now checks they survived the picker.
    debug.breakpoints = [bp];

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    const items = vi.mocked(window.showQuickPick).mock.calls[0][0] as { label: string }[];
    // Sorted, so the list doesn't reorder between invocations.
    expect(items.map((i) => i.label)).toEqual(['Account', 'SavingsAccount']);
    expect(addedSourceBreakpoint()?.location.uri.toString()).toContain('/SavingsAccount/');
  });

  it('drops the breakpoint when the class picker is dismissed', async () => {
    mockImplementors.mockReturnValue([savings, account]);
    vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
    const bp = new FunctionBreakpoint('balance');
    debug.breakpoints = [bp];

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    // Leaving an unresolved one in the panel is the dead-breakpoint problem again.
    expect(removed()).toHaveBeenCalledWith([bp]);
    expect(added()).not.toHaveBeenCalled();
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('No class chosen'));
  });

  it('does not resurrect a breakpoint deleted while the class picker was open', async () => {
    // The picker is the only point where this waits, so it is the only window in
    // which the developer can delete the row out from under it. Answering the
    // picker afterwards must not put back what they just removed.
    mockImplementors.mockReturnValue([savings, account]);
    const bp = new FunctionBreakpoint('balance');
    debug.breakpoints = [bp];

    let release: (v: unknown) => void = () => {};
    vi.mocked(window.showQuickPick).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const pending = new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);
    debug.breakpoints = []; // the developer deletes the row
    release({ target: savings }); // ...and only then picks a class
    await pending;

    expect(added()).not.toHaveBeenCalled();
    // Nothing to take back out, and nothing to complain about — they got what
    // they asked for.
    expect(removed()).not.toHaveBeenCalled();
    expect(warn()).not.toHaveBeenCalled();
  });

  it('takes a qualified name at its word without prompting', async () => {
    mockImplementors.mockReturnValue([savings, account]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('Account>>balance'),
    ]);
    expect(vi.mocked(window.showQuickPick)).not.toHaveBeenCalled();
    expect(addedSourceBreakpoint()?.location.uri.toString()).toContain(
      '/Globals/Account/instance/',
    );
  });

  it('resolves a class-side qualified name to the metaclass', async () => {
    const meta = { ...account, isMeta: true, selector: 'new', category: 'instance creation' };
    mockImplementors.mockReturnValue([meta]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('Account class>>new'),
    ]);
    expect(addedSourceBreakpoint()?.location.uri.toString()).toContain('/Account/class/');
  });

  it('refuses a qualified name whose class does not implement it', async () => {
    // Trusting the typing would set a breakpoint that silently never fires.
    mockImplementors.mockReturnValue([savings]);
    const bp = new FunctionBreakpoint('Account>>balance');

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    expect(removed()).toHaveBeenCalledWith([bp]);
    expect(added()).not.toHaveBeenCalled();
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('Nothing implements'));
  });

  it('says nothing implements an unknown selector', async () => {
    mockImplementors.mockReturnValue([]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('noSuchThing'),
    ]);
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('Nothing implements #noSuchThing'));
  });

  it('explains a name that is not a method name at all', async () => {
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('>>oops'),
    ]);
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('is not a method name'));
  });

  it('asks for a login rather than failing silently', async () => {
    await new FunctionBreakpointResolver(makeSessionManager(false)).handle([
      new FunctionBreakpoint('balance'),
    ]);
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('No active GemStone session'));
  });

  it('refuses a method with no step points', async () => {
    mockImplementors.mockReturnValue([account]);
    mockOffsets.mockReturnValue([]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('no step points'));
  });

  it('reports a lookup that throws instead of swallowing it', async () => {
    mockImplementors.mockImplementation(() => {
      throw new Error('session busy');
    });
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('session busy'));
  });

  it('refuses a class whose dictionary could not be determined', async () => {
    // implementorsOf reports '' for a class not bound under its own name; an
    // empty dictionary segment builds a URI that resolves to nothing.
    mockImplementors.mockReturnValue([{ ...account, dictName: '' }]);
    const bp = new FunctionBreakpoint('balance');

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    expect(removed()).toHaveBeenCalledWith([bp]);
    expect(added()).not.toHaveBeenCalled();
    expect(warn()).toHaveBeenCalledWith(expect.stringContaining('which dictionary'));
  });

  it('reports rather than swallows an unexpected failure', async () => {
    // handleAdded is fired without await, so a rejection would otherwise vanish
    // and leave the breakpoint sitting there doing nothing.
    mockImplementors.mockReturnValue([account]);
    mockSource.mockImplementation(() => {
      throw new Error('boom');
    });
    const bp = new FunctionBreakpoint('balance');

    await expect(
      new FunctionBreakpointResolver(makeSessionManager()).handle([bp]),
    ).resolves.toBeUndefined();
    expect(warn()).toHaveBeenCalled();
    expect(removed()).toHaveBeenCalledWith([bp]);
  });

  it('leaves a blank name alone — the developer is still typing', async () => {
    // VS Code's + button creates the breakpoint empty and *then* opens it for
    // editing. Rejecting the blank deleted the row before it could be typed in.
    const bp = new FunctionBreakpoint('');

    await new FunctionBreakpointResolver(makeSessionManager()).handle([bp]);

    expect(removed()).not.toHaveBeenCalled();
    expect(added()).not.toHaveBeenCalled();
    expect(warn()).not.toHaveBeenCalled();
  });

  it('leaves a whitespace-only name alone too', async () => {
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('   '),
    ]);
    expect(warn()).not.toHaveBeenCalled();
    expect(removed()).not.toHaveBeenCalled();
  });

  it('resolves the name that arrives as a change, not an addition', async () => {
    // The typed name reaches us through onDidChangeBreakpoints' `changed` list;
    // the manager passes added and changed together, so `handle` sees both.
    mockImplementors.mockReturnValue([account]);
    const typed = new FunctionBreakpoint('balance');

    await new FunctionBreakpointResolver(makeSessionManager()).handle([typed]);

    expect(removed()).toHaveBeenCalledWith([typed]);
    expect(addedSourceBreakpoint()).toBeInstanceOf(SourceBreakpoint);
  });

  it('finds an environment-0 method when maxEnvironment is above 0', async () => {
    // gemstone.maxEnvironment is a ceiling, not a selection. Searching only that
    // number skipped environment 0, where practically every method lives, so on
    // such a stone nothing was ever found.
    __setConfig('gemstone', 'maxEnvironment', 2);
    mockImplementors.mockImplementation((_session, _selector, env) =>
      env === 0 ? [{ ...account, environmentId: env }] : [],
    );

    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);

    expect(mockImplementors.mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
    expect(warn()).not.toHaveBeenCalled();
    expect(addedSourceBreakpoint()).toBeInstanceOf(SourceBreakpoint);
  });

  it('sets the breakpoint against the environment the method was found in', async () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    mockImplementors.mockImplementation((_session, _selector, env) =>
      env === 1 ? [{ ...account, environmentId: env }] : [],
    );

    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);

    // Not the configured ceiling of 2 — the environment that actually had it.
    expect(mockOffsets).toHaveBeenCalledWith(expect.anything(), 'Account', false, 'balance', 1);
    // Decoded, because the URI library percent-encodes '=' in the query.
    expect(decodeURIComponent(addedSourceBreakpoint()?.location.uri.toString() ?? '')).toContain(
      'env=1',
    );
  });

  it('does not offer the same class twice when it appears in two environments', async () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    mockImplementors.mockImplementation((_session, _selector, env) => [
      { ...account, environmentId: env ?? 0 },
    ]);

    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance'),
    ]);

    // Three passes all report Account, each stamped with its own environment; one
    // candidate means no needless picker.
    expect(vi.mocked(window.showQuickPick)).not.toHaveBeenCalled();
    expect(added()).toHaveBeenCalledTimes(1);
  });

  it('carries the enabled flag across the conversion', async () => {
    mockImplementors.mockReturnValue([account]);
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new FunctionBreakpoint('balance', false),
    ]);
    expect(addedSourceBreakpoint()?.enabled).toBe(false);
  });

  it('ignores an ordinary source breakpoint', async () => {
    await new FunctionBreakpointResolver(makeSessionManager()).handle([
      new SourceBreakpoint({ uri: 'x', range: { start: {} } } as never),
    ]);
    expect(added()).not.toHaveBeenCalled();
    expect(removed()).not.toHaveBeenCalled();
  });

  it('resolves the same name once when events overlap', async () => {
    // Choosing a class is a prompt, so a second event can land mid-await.
    mockImplementors.mockReturnValue([savings, account]);
    let release: (v: unknown) => void = () => {};
    vi.mocked(window.showQuickPick).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const resolver = new FunctionBreakpointResolver(makeSessionManager());
    const one = new FunctionBreakpoint('balance');
    const two = new FunctionBreakpoint('balance');
    debug.breakpoints = [one, two];
    const first = resolver.handle([one]);
    const second = resolver.handle([two]);

    release({ target: account });
    await Promise.all([first, second]);

    expect(added()).toHaveBeenCalledTimes(1);
  });
});
