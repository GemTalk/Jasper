import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getAllBreakpoints: vi.fn(() => []),
  getSourceOffsets: vi.fn(() => []),
}));

import { TreeItemCheckboxState } from '../__mocks__/vscode';
import {
  BreakpointTreeProvider,
  BreakpointNode,
  classLabel,
  groupBreakpoints,
} from '../breakpointTreeProvider';
import { SessionManager } from '../sessionManager';
import { BreakpointManager } from '../breakpointManager';
import { getAllBreakpoints, GemStoneBreakpoint } from '../browserQueries';

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
        hasSession ? { id: 1, gci: {}, handle: 'h', login: {}, stoneVersion: '3.7.5' } : undefined,
      ),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
  }

  const manager = {
    setEnabledForStoneBreakpoint: vi.fn(),
    removeStoneBreakpoint: vi.fn(),
    onDidApply: vi.fn(() => ({ dispose: () => {} })),
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

  it('groups the gem breakpoints into class nodes', () => {
    mockGetAll.mockReturnValue([bp(), bp({ selector: 'deposit:' })]);
    const provider = new BreakpointTreeProvider(makeSessionManager(), manager);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe('class');
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
    const [classNode] = provider.getChildren();
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

    it('gives executed code no reveal command — there is no source to open', () => {
      const item = provider.getTreeItem({
        kind: 'breakpoint',
        bp: bp({ className: '', selector: '' }),
      });
      expect(item.command).toBeUndefined();
      expect(item.contextValue).toBe('gemstoneBreakpointDoit');
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
