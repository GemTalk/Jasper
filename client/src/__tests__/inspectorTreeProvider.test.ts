import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../debugQueries', () => ({
  getObjectPrintString: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return 'a UserProfileSet';
    if (oop === 200n) return 'an Array';
    if (oop === 300n) return 'SystemUser';
    if (oop === 0x14n) return 'nil';
    return `OOP(${oop})`;
  }),
  getObjectClassName: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return 'UserProfileSet';
    if (oop === 200n) return 'Array';
    if (oop === 300n) return 'UserProfile';
    if (oop === 0x14n) return 'UndefinedObject';
    if (oop === 400n) return 'SymbolDictionary';
    if (oop === 500n) return 'Array';
    return 'Object';
  }),
  isSpecialOop: vi.fn((_s: unknown, oop: bigint) => {
    // SmallIntegers and nil are special
    return oop === 0x14n || oop === 42n;
  }),
  getInstVarNames: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return ['list', 'maxSize'];
    if (oop === 200n) return [];
    if (oop === 400n) return ['name', 'table'];
    if (oop === 500n) return [];
    return [];
  }),
  getNamedInstVarOops: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return [200n, 42n];
    return [];
  }),
  getIndexedSize: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 200n) return 2;
    if (oop === 500n) return 250;
    return 0;
  }),
  getIndexedOops: vi.fn((_s: unknown, oop: bigint, start: number, count: number) => {
    if (oop === 200n) return [300n, 300n];
    if (oop === 500n) {
      return Array.from({ length: count }, (_, i) => BigInt(1000 + start + i));
    }
    return [];
  }),
  getDictionaryEntries: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 400n) {
      return [
        { key: 'Alpha', valueOop: 300n },
        { key: 'Beta', valueOop: 42n },
      ];
    }
    return [];
  }),
}));

import { TreeItemCollapsibleState, ThemeIcon } from '../__mocks__/vscode';
import { InspectorTreeProvider, InspectorNode } from '../inspectorTreeProvider';
import { SessionManager } from '../sessionManager';

function makeSessionManager(hasSession: boolean) {
  return {
    getSession: vi.fn((id: number) =>
      hasSession
        ? { id, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined,
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('InspectorTreeProvider', () => {
  describe('root management', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('starts with an empty tree', () => {
      expect(provider.getChildren()).toEqual([]);
    });

    it('addRoot adds a root node and fires change event', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.addRoot(1, 100n, 'AllUsers');

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({
        sessionId: 1,
        oop: 100n,
        label: 'AllUsers',
        isRoot: true,
        kind: 'root',
      });
      expect(listener).toHaveBeenCalled();
    });

    it('removeRoot removes a specific root', () => {
      provider.addRoot(1, 100n, 'AllUsers');
      provider.addRoot(1, 200n, 'SomeArray');

      const roots = provider.getChildren();
      expect(roots).toHaveLength(2);

      provider.removeRoot(roots[0]);
      const remaining = provider.getChildren();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe('SomeArray');
    });

    it('clearAll removes all roots', () => {
      provider.addRoot(1, 100n, 'AllUsers');
      provider.addRoot(1, 200n, 'SomeArray');
      expect(provider.getChildren()).toHaveLength(2);

      provider.clearAll();
      expect(provider.getChildren()).toEqual([]);
    });

    it('removeSessionItems removes items for a specific session', () => {
      provider.addRoot(1, 100n, 'FromSession1');
      provider.addRoot(2, 200n, 'FromSession2');
      provider.addRoot(1, 300n, 'AlsoSession1');

      provider.removeSessionItems(1);
      const remaining = provider.getChildren();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe('FromSession2');
    });

    it('removeSessionItems does not fire event if no items removed', () => {
      provider.addRoot(1, 100n, 'FromSession1');
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.removeSessionItems(999);
      expect(listener).not.toHaveBeenCalled();
    });

    it('findRootByLabel returns the matching root node', () => {
      provider.addRoot(1, 100n, 'AllUsers');
      provider.addRoot(1, 200n, 'SomeArray');

      const found = provider.findRootByLabel('AllUsers');
      expect(found).toBeDefined();
      expect(found!.label).toBe('AllUsers');
      expect(found!.oop).toBe(100n);
    });

    it('findRootByLabel returns undefined when no match exists', () => {
      provider.addRoot(1, 100n, 'AllUsers');

      expect(provider.findRootByLabel('NonExistent')).toBeUndefined();
    });

    it('findRootByLabel returns undefined when inspector is empty', () => {
      expect(provider.findRootByLabel('AllUsers')).toBeUndefined();
    });
  });

  describe('getTreeItem', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('renders a root node with eye icon and description from printString', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 100n,
        label: 'AllUsers',
        isRoot: true,
        kind: 'root',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('AllUsers');
      expect(item.description).toBe('a UserProfileSet');
      expect(item.tooltip).toBe('UserProfileSet: a UserProfileSet');
      expect((item.iconPath as ThemeIcon).id).toBe('eye');
      expect(item.contextValue).toBe('gemstoneInspectorRoot');
      // Has named instVars → collapsed
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it('renders a named child node with symbol-field icon', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 200n,
        label: 'list',
        isRoot: false,
        kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('list');
      expect(item.description).toBe('an Array');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-field');
      expect(item.contextValue).toBe('gemstoneInspectorItem');
      // Has indexed elements → collapsed
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it('renders an indexed child node with symbol-array icon', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 300n,
        label: '[1]',
        isRoot: false,
        kind: 'indexed',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('[1]');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-array');
    });

    it('renders a special (leaf) OOP as non-expandable', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 42n,
        label: 'maxSize',
        isRoot: false,
        kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('renders nil as non-expandable', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 0x14n,
        label: 'value',
        isRoot: false,
        kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.description).toBe('nil');
    });

    it('shows disconnected state when session is gone', () => {
      const disconnectedProvider = new InspectorTreeProvider(makeSessionManager(false));
      const node: InspectorNode = {
        sessionId: 1,
        oop: 100n,
        label: 'AllUsers',
        isRoot: true,
        kind: 'root',
      };
      const item = disconnectedProvider.getTreeItem(node);
      expect(item.description).toBe('<session disconnected>');
      expect((item.iconPath as ThemeIcon).id).toBe('warning');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getChildren (drill-down)', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('returns named instVars for an object with named fields', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 100n,
        label: 'AllUsers',
        isRoot: true,
        kind: 'root',
      };
      const children = provider.getChildren(node);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        label: 'list',
        oop: 200n,
        kind: 'named',
        isRoot: false,
      });
      expect(children[1]).toMatchObject({
        label: 'maxSize',
        oop: 42n,
        kind: 'named',
        isRoot: false,
      });
    });

    it('returns indexed elements for an array-like object', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 200n,
        label: 'list',
        isRoot: false,
        kind: 'named',
      };
      const children = provider.getChildren(node);
      // Array has no named instVars (mock returns []), but 2 indexed elements
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        label: '[1]',
        oop: 300n,
        kind: 'indexed',
        isRoot: false,
      });
      expect(children[1]).toMatchObject({
        label: '[2]',
        oop: 300n,
        kind: 'indexed',
        isRoot: false,
      });
    });

    it('returns empty for a special OOP', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 42n,
        label: 'maxSize',
        isRoot: false,
        kind: 'named',
      };
      expect(provider.getChildren(node)).toEqual([]);
    });

    it('returns empty for nil', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 0x14n,
        label: 'value',
        isRoot: false,
        kind: 'named',
      };
      expect(provider.getChildren(node)).toEqual([]);
    });

    it('returns empty when session is disconnected', () => {
      const disconnectedProvider = new InspectorTreeProvider(makeSessionManager(false));
      const node: InspectorNode = {
        sessionId: 1,
        oop: 100n,
        label: 'AllUsers',
        isRoot: true,
        kind: 'root',
      };
      expect(disconnectedProvider.getChildren(node)).toEqual([]);
    });
  });

  describe('SymbolDictionary (custom inspector)', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('returns association children for a SymbolDictionary', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 400n,
        label: 'Globals',
        isRoot: true,
        kind: 'root',
      };
      const children = provider.getChildren(node);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        label: 'Alpha',
        oop: 300n,
        kind: 'association',
        isRoot: false,
      });
      expect(children[1]).toMatchObject({
        label: 'Beta',
        oop: 42n,
        kind: 'association',
        isRoot: false,
      });
    });

    it('renders association nodes with symbol-key icon', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 300n,
        label: 'Alpha',
        isRoot: false,
        kind: 'association',
      };
      const item = provider.getTreeItem(node);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-key');
    });
  });

  describe('pagination (range nodes)', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('creates range nodes for collections larger than PAGE_SIZE', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 500n,
        label: 'bigArray',
        isRoot: true,
        kind: 'root',
      };
      const children = provider.getChildren(node);
      expect(children).toHaveLength(3);
      expect(children[0]).toMatchObject({
        label: '[1..100]',
        kind: 'range',
        rangeStart: 1,
        rangeEnd: 100,
      });
      expect(children[1]).toMatchObject({
        label: '[101..200]',
        kind: 'range',
        rangeStart: 101,
        rangeEnd: 200,
      });
      expect(children[2]).toMatchObject({
        label: '[201..250]',
        kind: 'range',
        rangeStart: 201,
        rangeEnd: 250,
      });
    });

    it('expands a range node into indexed elements', () => {
      const rangeNode: InspectorNode = {
        sessionId: 1,
        oop: 500n,
        label: '[1..100]',
        isRoot: false,
        kind: 'range',
        rangeStart: 1,
        rangeEnd: 100,
      };
      const children = provider.getChildren(rangeNode);
      expect(children).toHaveLength(100);
      expect(children[0]).toMatchObject({
        label: '[1]',
        kind: 'indexed',
        isRoot: false,
      });
      expect(children[99]).toMatchObject({
        label: '[100]',
        kind: 'indexed',
        isRoot: false,
      });
    });

    it('renders range nodes as always-collapsed with item count', () => {
      const rangeNode: InspectorNode = {
        sessionId: 1,
        oop: 500n,
        label: '[1..100]',
        isRoot: false,
        kind: 'range',
        rangeStart: 1,
        rangeEnd: 100,
      };
      const item = provider.getTreeItem(rangeNode);
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(item.description).toBe('100 items');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-array');
    });

    it('shows small collections inline without range grouping', () => {
      const node: InspectorNode = {
        sessionId: 1,
        oop: 200n,
        label: 'list',
        isRoot: false,
        kind: 'named',
      };
      const children = provider.getChildren(node);
      expect(children).toHaveLength(2);
      expect(children[0].kind).toBe('indexed');
      expect(children[1].kind).toBe('indexed');
    });
  });
});
