import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

vi.mock('../../browserQueries', () => ({
  getAllBreakpoints: vi.fn(() => []),
  getSourceOffsets: vi.fn(() => []),
}));

import { TreeItemCheckboxState, Uri, window, workspace } from '../../__mocks__/vscode';
import {
  BreakpointTreeProvider,
  BreakpointNode,
  classLabel,
  editBreakpointCondition,
  editBreakpointTrigger,
  groupBreakpoints,
  revealBreakpoint,
} from '../breakpointTreeProvider';
import { rowDescription } from '../breakpointRuleText';
import { SessionManager } from '../../sessionManager';
import { BreakpointManager } from '../breakpointManager';
import { getAllBreakpoints, GemStoneBreakpoint } from '../../browserQueries';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';

const mockGetAll = vi.mocked(getAllBreakpoints);

function bp(over: Partial<GemStoneBreakpoint> = {}): GemStoneBreakpoint {
  return {
    breakNumber: 1,
    className: 'Account',
    isMeta: false,
    selector: 'balance',
    stepPoint: 3,
    disabled: false,
    environmentId: 0,
    methodOop: '12345',
    dictName: 'Globals',
    category: 'accessing',
    ...over,
  };
}

describe('classLabel', () => {
  it('names an instance-side class plainly', () => {
    expect(classLabel('Account', false)).toBe('Account');
  });

  it('names the metaclass the way Smalltalk writes it', () => {
    expect(classLabel('Account', true)).toBe('Account class');
  });

  it('labels a classless breakpoint as executed code', () => {
    expect(classLabel('', false)).toBe('(executed code)');
  });
});

describe('rowDescription', () => {
  const TRIGGER = { uri: 'gemstone://1/Globals/Array/instance/accessing/size', stepPoint: 4 };

  it('says nothing for a breakpoint with no rule at all', () => {
    expect(rowDescription(undefined)).toBe('');
    expect(rowDescription({})).toBe('');
  });

  it('names the breakpoint a triggered one is waiting for', () => {
    expect(rowDescription({ triggeredBy: TRIGGER })).toBe(' \u00b7 after Array>>size @4');
  });

  it('puts the trigger ahead of the condition', () => {
    // The trigger is why the row will not stop yet, which outranks the terms of
    // a stop it is not eligible for.
    expect(rowDescription({ triggeredBy: TRIGGER, condition: 'x > 1' })).toBe(
      ' \u00b7 after Array>>size @4 \u00b7 if x > 1',
    );
  });

  it('still describes a plain condition and a logpoint', () => {
    expect(rowDescription({ condition: 'x > 1' })).toBe(' \u00b7 if x > 1');
    expect(rowDescription({ logMessage: 'hi' })).toBe(' \u00b7 logs');
  });
});

describe('groupBreakpoints', () => {
  it('groups by class and keeps the two sides of a class apart', () => {
    const nodes = groupBreakpoints([
      bp({ className: 'Account', isMeta: false, selector: 'balance' }),
      bp({ className: 'Account', isMeta: true, selector: 'new' }),
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => (n.kind === 'class' ? classLabel(n.className, n.isMeta) : ''))).toEqual(
      ['Account', 'Account class'],
    );
  });

  it('sorts classes alphabetically', () => {
    const nodes = groupBreakpoints([
      bp({ className: 'Zebra' }),
      bp({ className: 'Apple' }),
      bp({ className: 'Mango' }),
    ]);
    expect(nodes.map((n) => (n.kind === 'class' ? n.className : ''))).toEqual([
      'Apple',
      'Mango',
      'Zebra',
    ]);
  });

  it('sorts within a class by selector, then step point', () => {
    const nodes = groupBreakpoints([
      bp({ selector: 'zed', stepPoint: 1 }),
      bp({ selector: 'abc', stepPoint: 5 }),
      bp({ selector: 'abc', stepPoint: 2 }),
    ]);
    expect(nodes).toHaveLength(1);
    const only = nodes[0];
    expect(only.kind).toBe('class');
    if (only.kind !== 'class') return;
    expect(only.breakpoints.map((b) => `${b.selector}@${b.stepPoint}`)).toEqual([
      'abc@2',
      'abc@5',
      'zed@1',
    ]);
  });

  it('puts executed-code breakpoints last — nothing navigates to them', () => {
    const nodes = groupBreakpoints([
      bp({ className: '', selector: '' }),
      bp({ className: 'Account' }),
    ]);
    expect(nodes.map((n) => (n.kind === 'class' ? n.className : ''))).toEqual(['Account', '']);
  });

  it('returns nothing for no breakpoints', () => {
    expect(groupBreakpoints([])).toEqual([]);
  });
});

describe('BreakpointTreeProvider', () => {
  function makeSessionManager(hasSession = true) {
    return {
      getSelectedSession: vi.fn(() =>
        hasSession
          ? fakeActiveSession({
              id: 1,
              gci: {},
              handle: 'h',
              // The heading names the session the way Logins & Sessions does.
              login: { gs_user: 'DataCurator', stone: 'gs64stone_375', gem_host: 'localhost' },
              stoneVersion: '3.7.5',
            })
          : undefined,
      ),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
  }

  const manager = {
    setEnabledForStoneBreakpoint: vi.fn(),
    removeStoneBreakpoint: vi.fn(),
    onDidApply: vi.fn(() => ({ dispose: () => {} })),
    // The gem records no condition, so a row's condition can only come from
    // what Jasper applied. Undefined by default: most rows have none.
    ruleForStoneBreakpoint: vi.fn(() => undefined),
    // Whether Jasper set the row's breakpoint. Undefined: a gem-only row.
    appliedForStoneBreakpoint: vi.fn(() => undefined),
  } as unknown as BreakpointManager;

  beforeEach(() => {
    mockGetAll.mockReset().mockReturnValue([]);
  });

  it('asks the developer to log in when there is no session', () => {
    const provider = new BreakpointTreeProvider(makeSessionManager(false), manager);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe('notice');
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('says so plainly when the session has no breakpoints', () => {
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const roots = provider.getChildren();
    expect(roots[0]).toMatchObject({ kind: 'notice' });
  });

  it('shows the failure rather than an empty tree when the query throws', () => {
    mockGetAll.mockImplementation(() => {
      throw new Error('session busy');
    });
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    // Show the developer why the view is empty; a bare empty tree reads as
    // "no breakpoints", which is a different and wrong answer.
    expect(roots[0]).toMatchObject({
      kind: 'notice',
      text: expect.stringContaining('session busy'),
    });
  });

  it('puts the gem breakpoints under a heading naming the session', () => {
    // Breakpoints are per-gem state and this view reads ONE gem — the selected
    // session's. Without the heading a row is a breakpoint in an unnamed stone.
    mockGetAll.mockReturnValue([bp(), bp({ selector: 'deposit:' })]);
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe('session');
  });

  it('groups the session’s breakpoints into class nodes beneath it', () => {
    mockGetAll.mockReturnValue([bp(), bp({ selector: 'deposit:' })]);
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const [sessionNode] = provider.getChildren();
    const groups = provider.getChildren(sessionNode);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('class');
  });

  it('names the session the way Logins & Sessions does, and counts its breakpoints', () => {
    mockGetAll.mockReturnValue([bp(), bp({ selector: 'deposit:' })]);
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const item = provider.getTreeItem(provider.getChildren()[0]);
    expect(item.label).toBe('DataCurator on gs64stone_375 (localhost)');
    expect(item.description).toBe('2');
  });

  it('reads only the selected session — it does not go asking the others', () => {
    // A view over every logged-in gem would be a different view, and a slower
    // one: this is one fetch, from the session whose name is on the heading.
    mockGetAll.mockReturnValue([bp()]);
    const sessionManager = makeSessionManager();
    const provider = new BreakpointTreeProvider(sessionManager, manager);
    provider.getChildren();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of refreshes into one redraw', () => {
    vi.useFakeTimers();
    try {
      const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
      const fired = vi.fn();
      provider.onDidChangeTreeData(fired);

      // The manager applies breakpoints one method at a time, so a multi-method
      // change arrives as a burst — each redraw would be its own GCI round trip.
      provider.refresh();
      provider.refresh();
      provider.refresh();
      expect(fired).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fired).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshNow redraws without waiting', () => {
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const fired = vi.fn();
    provider.onDidChangeTreeData(fired);
    provider.refreshNow();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('lists a class node’s breakpoints as its children', () => {
    mockGetAll.mockReturnValue([bp(), bp({ selector: 'deposit:' })]);
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const [sessionNode] = provider.getChildren();
    const [classNode] = provider.getChildren(sessionNode);
    const children = provider.getChildren(classNode);
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.kind === 'breakpoint')).toBe(true);
  });

  describe('getTreeItem', () => {
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);

    it('labels a breakpoint by selector and step point', () => {
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(item.label).toBe('balance');
      expect(item.description).toBe('@ 3');
    });

    it('checks the box for an enabled breakpoint', () => {
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp({ disabled: false }) });
      expect(item.checkboxState).toBe(TreeItemCheckboxState.Checked);
    });

    it('unchecks the box for a disabled breakpoint', () => {
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp({ disabled: true }) });
      expect(item.checkboxState).toBe(TreeItemCheckboxState.Unchecked);
    });

    it('gives a real method a reveal command', () => {
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(item.command).toMatchObject({ command: 'gemstone.breakpoints.reveal' });
      expect(item.contextValue).toBe('gemstoneBreakpoint');
    });

    it('shows a conditional breakpoint as conditional, and says what the condition is', () => {
      // The gem stores no condition, so this row is the only place in this view
      // that can tell the developer their breakpoint is not going to stop every
      // time — and the condition is the thing they actually want to re-read.
      vi.mocked(manager.ruleForStoneBreakpoint).mockReturnValueOnce({
        condition: 'amount > 100',
      });
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(item.description).toBe('@ 3 · if amount > 100');
      expect(item.iconPath).toMatchObject({ id: 'debug-breakpoint-conditional' });
    });

    it('leaves a plain breakpoint without the conditional icon', () => {
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(item.description).toBe('@ 3');
      expect(item.iconPath).toBeUndefined();
    });

    it('elides a long condition on the row but keeps it whole in the tooltip', () => {
      const long = 'anOrder customer name = ' + "'".repeat(2) + ' and this goes on for a while yet';
      vi.mocked(manager.ruleForStoneBreakpoint).mockReturnValueOnce({
        condition: long,
      });
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(String(item.description)).toContain('…');
      expect(String((item.tooltip as { value: string }).value)).toContain(long);
    });

    it('gives executed code no reveal command — there is no source to open', () => {
      const item = provider.getTreeItem({
        kind: 'breakpoint',
        bp: bp({ className: '', selector: '' }),
      });
      expect(item.command).toBeUndefined();
      expect(item.contextValue).toBe('gemstoneBreakpointDoit');
    });

    it('offers Break Only After only on a row for a breakpoint Jasper set', () => {
      // A trigger is recorded against a breakpoint in VS Code's list; one set
      // from topaz has none, so the button could only say there is nothing there.
      vi.mocked(manager.appliedForStoneBreakpoint).mockReturnValueOnce({
        stepPoint: 3,
        offset: 0,
        line: 1,
        enabled: true,
      });
      const owned = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(owned.contextValue).toBe('gemstoneBreakpointOwned');
    });

    it('says on the row and in its tooltip why a waiting breakpoint will not stop', () => {
      vi.mocked(manager.ruleForStoneBreakpoint).mockReturnValueOnce({
        triggeredBy: {
          uri: 'gemstone://1/Globals/Account/instance/accessing/deposit%3A',
          stepPoint: 2,
        },
        triggerProblem: 'disabled',
      });
      const item = provider.getTreeItem({ kind: 'breakpoint', bp: bp() });
      expect(item.description).toBe('@ 3 · after Account>>deposit: @2 (disabled)');
      expect(String((item.tooltip as { value: string }).value)).toContain('which is disabled');
    });

    it('counts a class node’s breakpoints, calling out the disabled ones', () => {
      const node: BreakpointNode = {
        kind: 'class',
        className: 'Account',
        isMeta: false,
        breakpoints: [bp(), bp({ disabled: true }), bp({ disabled: true })],
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Account');
      expect(item.description).toBe('3 · 2 disabled');
    });

    it('omits the disabled count when none are disabled', () => {
      const node: BreakpointNode = {
        kind: 'class',
        className: 'Account',
        isMeta: false,
        breakpoints: [bp(), bp()],
      };
      expect(provider.getTreeItem(node).description).toBe('2');
    });
  });
});

describe('acting on a row', () => {
  const sessionManager = {
    getSelectedSession: vi.fn(() =>
      fakeActiveSession({ id: 1, gci: {}, handle: 'h', login: {}, stoneVersion: '3.7.5' }),
    ),
  } as unknown as SessionManager;
  const EXPLORER_URI = Uri.parse('gemstone://1/Globals/Account/instance/accessing/balance?dict=4');

  function managerWith(owned?: typeof EXPLORER_URI) {
    return {
      uriForStoneBreakpoint: vi.fn(() => owned),
      editConditionAtStepPoint: vi.fn(async () => {}),
      editTriggerAtStepPoint: vi.fn(async () => {}),
    } as unknown as BreakpointManager;
  }

  beforeEach(() => {
    vi.mocked(workspace.openTextDocument).mockClear();
    // An unrelated editor is active: the edit must not be aimed at it.
    (window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { uri: Uri.parse('gemstone://1/Globals/Other/instance/x/y') },
    };
  });

  it('opens the editor the breakpoint was set in, when Jasper set it', async () => {
    const uri = await revealBreakpoint(sessionManager, managerWith(EXPLORER_URI), {
      kind: 'breakpoint',
      bp: bp(),
    });
    expect(uri).toBe(EXPLORER_URI);
    expect(vi.mocked(workspace.openTextDocument)).toHaveBeenCalledWith(EXPLORER_URI);
  });

  it('builds the URI from what the gem reports for a breakpoint Jasper did not set', async () => {
    const uri = await revealBreakpoint(sessionManager, managerWith(undefined), {
      kind: 'breakpoint',
      bp: bp(),
    });
    expect(uri?.toString()).toContain('/Account/instance/accessing/balance');
  });

  it('edits the condition through the URI it opened, at the row’s step point', async () => {
    const manager = managerWith(EXPLORER_URI);
    await editBreakpointCondition(sessionManager, manager, { kind: 'breakpoint', bp: bp() });
    expect(vi.mocked(manager.editConditionAtStepPoint)).toHaveBeenCalledWith(EXPLORER_URI, 3);
  });

  it('edits the trigger through the URI it opened, at the row’s step point', async () => {
    const manager = managerWith(EXPLORER_URI);
    await editBreakpointTrigger(sessionManager, manager, { kind: 'breakpoint', bp: bp() });
    expect(vi.mocked(manager.editTriggerAtStepPoint)).toHaveBeenCalledWith(EXPLORER_URI, 3);
  });

  it('does nothing for executed code, which has no method to open', async () => {
    const manager = managerWith(EXPLORER_URI);
    const doit: BreakpointNode = { kind: 'breakpoint', bp: bp({ className: '', selector: '' }) };
    await editBreakpointCondition(sessionManager, manager, doit);
    await editBreakpointTrigger(sessionManager, manager, doit);
    expect(vi.mocked(manager.editConditionAtStepPoint)).not.toHaveBeenCalled();
    expect(vi.mocked(manager.editTriggerAtStepPoint)).not.toHaveBeenCalled();
  });
});
