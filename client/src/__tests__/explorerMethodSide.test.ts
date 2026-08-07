import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({}));

import { commands, __resetConfig, __setConfig } from '../__mocks__/vscode';
import { ExplorerController, MethodCategoryItem, MethodItem } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { EnvCategoryLine } from '../browserQueries';

const GROUP_KEY = 'explorer.groupMethodsByCategory';

// A class with one instance-side and one class-side method, so switching sides
// changes which rows the pane produces.
function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] },
    { isMeta: true, envId: 0, category: 'instance creation', selectors: ['new'] },
  ];
  return ctl;
}

const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;

// Attach a minimal five-pane views mock; setViews() runs syncTitles(), which is
// what writes each pane's header description. `methodSelection` seeds the Methods
// view's selection so we can prove the header ignores it.
function attachViews(ctl: ExplorerController, methodSelection: unknown[] = []) {
  const pane = () => ({
    description: '',
    message: undefined as string | undefined,
    reveal: vi.fn(async () => {}),
    selection: [] as unknown[],
  });
  const method = { ...pane(), selection: methodSelection };
  ctl.setViews({
    dict: pane(),
    category: pane(),
    klass: pane(),
    hierarchy: pane(),
    method,
  } as never);
  return method;
}

function methodItem(selector: string): MethodItem {
  return new MethodItem(
    false,
    { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 },
    'accessing',
  );
}

function setMethodFilter(ctl: ExplorerController, pattern: string): void {
  (ctl as unknown as { filters: Map<string, string> }).filters.set(
    'gemstoneExplorerMethods',
    pattern,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
});

describe('Methods pane instance/class side toggle', () => {
  it('shows the instance side by default', () => {
    const ctl = makeController();

    expect(ctl.showClassMethods).toBe(false);
    const cats = ctl.methodProvider.getChildren() as MethodCategoryItem[];
    expect(cats.every((c) => c.isMeta === false)).toBe(true);
    expect(cats.map((c) => c.category)).toContain('accessing');
  });

  it('switches the whole pane to the class side when toggled', () => {
    const ctl = makeController();

    ctl.setMethodSide(true);

    expect(ctl.showClassMethods).toBe(true);
    const cats = ctl.methodProvider.getChildren() as MethodCategoryItem[];
    expect(cats.every((c) => c.isMeta === true)).toBe(true);
    expect(cats.map((c) => c.category)).toContain('instance creation');
  });

  it('lists only the active side when flattened', () => {
    __setConfig('gemstone', GROUP_KEY, false);
    const ctl = makeController();

    ctl.setMethodSide(true);

    const rows = ctl.methodProvider.getChildren() as MethodItem[];
    expect(rows.map((r) => r.info.selector)).toEqual(['new']);
  });

  it('renders the instance/class level as a title toggle, so categories are roots', () => {
    const ctl = makeController();

    const [cat] = ctl.methodProvider.getChildren() as MethodCategoryItem[];

    expect(ctl.methodProvider.getParent(cat)).toBeUndefined();
  });

  it('mirrors the active side into the context key that picks the visible toggle', () => {
    const ctl = makeController();

    ctl.setMethodSide(true);

    expect(executeCommand).toHaveBeenCalledWith(
      'setContext',
      'gemstone.explorer.methodSideIsClass',
      true,
    );
  });
});

// Capture which side/category New Method files into without driving the real
// compile: replace the private createNewMethod with a spy and read its args.
function stubCreateNewMethod(ctl: ExplorerController): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => {});
  (ctl as unknown as { createNewMethod: typeof spy }).createNewMethod = spy;
  return spy;
}

describe('New Method follows the visible side after the title toggle flips', () => {
  it('files on the default instance side before any selection or toggle', async () => {
    const ctl = makeController();
    const create = stubCreateNewMethod(ctl);

    await ctl.newMethod();

    expect(create).toHaveBeenCalledWith(false, 'as yet unclassified');
  });

  it('files on the class side when the toggle shows class, even after an instance method was selected', async () => {
    const ctl = makeController();
    const create = stubCreateNewMethod(ctl);
    ctl.recordMethodContext(false, 'accessing');

    ctl.setMethodSide(true);
    await ctl.newMethod();

    expect(create).toHaveBeenCalledWith(true, 'as yet unclassified');
  });

  it('files on the instance side when the toggle shows instance, even after a class method was selected', async () => {
    const ctl = makeController();
    const create = stubCreateNewMethod(ctl);
    ctl.setMethodSide(true);
    ctl.recordMethodContext(true, 'instance creation');

    ctl.setMethodSide(false);
    await ctl.newMethod();

    expect(create).toHaveBeenCalledWith(false, 'as yet unclassified');
  });

  it('brings the recorded side in step with the visible side and drops the stale category', () => {
    const ctl = makeController();
    ctl.recordMethodContext(false, 'accessing');

    ctl.setMethodSide(true);

    expect(ctl.state.selectedIsMeta).toBe(true);
    expect(ctl.state.selectedMethodCategory).toBeUndefined();
  });

  it('still reuses the selected category when the visible side never changed', async () => {
    const ctl = makeController();
    const create = stubCreateNewMethod(ctl);
    ctl.recordMethodContext(false, 'accessing');

    await ctl.newMethod();

    expect(create).toHaveBeenCalledWith(false, 'accessing');
  });
});

describe('Methods pane header', () => {
  it('names the instance side and does not append the selected selector', () => {
    const ctl = makeController();

    const method = attachViews(ctl, [methodItem('at:')]);

    expect(method.description).toBe('instance');
  });

  it('names the class side after toggling', () => {
    const ctl = makeController();
    const method = attachViews(ctl);

    ctl.setMethodSide(true);

    expect(method.description).toBe('class');
  });

  it('keeps naming the side in the header while filtering (the filter shows as a chip row)', () => {
    const ctl = makeController();
    const method = attachViews(ctl);
    setMethodFilter(ctl, 'at');

    ctl.setMethodSide(true);

    expect(method.description).toBe('class');
  });
});
