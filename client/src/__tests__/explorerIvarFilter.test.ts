import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Only getMethodInstVarAccess is exercised here; the controller reads method
// selectors from its (privately seeded) envLines, not from a query.
vi.mock('../browserQueries', () => ({
  getMethodInstVarAccess: vi.fn(() => [
    { isMeta: false, selector: 'count', reads: ['count'], writes: [] },
    { isMeta: false, selector: 'count:', reads: [], writes: ['count'] },
  ]),
}));

import { Uri, Position, window, __resetConfig, __setConfig } from '../__mocks__/vscode';
import { ExplorerController, MethodItem, FilterChipItem } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { EnvCategoryLine } from '../browserQueries';

const GROUP_KEY = 'explorer.groupMethodsByCategory';
const VIEW_METHODS = 'gemstoneExplorerMethods';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['count', 'count:', 'size'] },
  ];
  return ctl;
}

function setMethodFilter(ctl: ExplorerController, pattern: string): void {
  (ctl as unknown as { filters: Map<string, string> }).filters.set(VIEW_METHODS, pattern);
}

// The method rows only — a filter chip leads the list while filtering.
function methodItems(ctl: ExplorerController): MethodItem[] {
  return ctl.methodProvider.getChildren().filter((r): r is MethodItem => r instanceof MethodItem);
}

function selectors(rows: MethodItem[]): string[] {
  return rows.map((r) => r.info.selector).sort();
}

// A minimal TextEditor stand-in for the ivar-highlight decoration path.
function fakeEditor(uriString: string, text: string) {
  return {
    document: {
      uri: Uri.parse(uriString),
      getText: () => text,
      positionAt: (o: number) => new Position(0, o),
    },
    setDecorations: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  __setConfig('gemstone', GROUP_KEY, false); // flat, so getChildren() returns method rows
});

describe('Methods pane instance-variable filter', () => {
  it('reads:<ivar> keeps only methods that read the ivar, marked r', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');

    const rows = methodItems(ctl);

    expect(selectors(rows)).toEqual(['count']);
    expect(rows[0].description).toBe('r');
  });

  it('writes:<ivar> keeps only methods that write the ivar, marked w', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'writes:count');

    const rows = methodItems(ctl);

    expect(selectors(rows)).toEqual(['count:']);
    expect(rows[0].description).toBe('w');
  });

  it('accesses:<ivar> keeps both readers and writers', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'accesses:count');

    expect(selectors(methodItems(ctl))).toEqual(['count', 'count:']);
  });

  it('leaves a plain textual filter untouched (no ivar query needed)', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'count');

    const rows = methodItems(ctl);

    expect(selectors(rows)).toEqual(['count', 'count:']);
    expect(rows.every((r) => r.description === '')).toBe(true);
  });
});

describe('Methods pane filter chip', () => {
  it('leads the list with a distinct filter chip while filtering', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');

    const [first] = ctl.methodProvider.getChildren();

    expect(first).toBeInstanceOf(FilterChipItem);
    expect((first as FilterChipItem).description).toBe('reads:count');
    expect((first as FilterChipItem).viewId).toBe(VIEW_METHODS);
  });

  it('shows no chip when nothing is filtered', () => {
    const ctl = makeController();

    const rows = ctl.methodProvider.getChildren();

    expect(rows.some((r) => r instanceof FilterChipItem)).toBe(false);
  });

  it('clears the pane filter when the chip is cleared', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');

    ctl.clearFilter(VIEW_METHODS);

    expect(ctl.getFilter(VIEW_METHODS)).toBeUndefined();
    expect(ctl.methodProvider.getChildren().some((r) => r instanceof FilterChipItem)).toBe(false);
  });

  it('treats the chip as a root so reveal never targets it', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');
    const chip = ctl.methodProvider
      .getChildren()
      .find((r): r is FilterChipItem => r instanceof FilterChipItem)!;

    expect(ctl.methodProvider.getParent(chip)).toBeUndefined();
  });
});

describe('ExplorerController.filterMethodsByIvar', () => {
  it('selects the ivar’s own class, seeds the reads: token, and switches to instance side', () => {
    const ctl = makeController();
    ctl.setMethodSide(true);
    const selectClass = vi.spyOn(ctl, 'selectClass').mockImplementation(() => {});

    ctl.filterMethodsByIvar('reads', 'count', 'Other');

    expect(selectClass).toHaveBeenCalledTimes(1);
    expect(selectClass.mock.calls[0][0].className).toBe('Other');
    // revealHierarchy=false: switching class for an ivar filter must not open the
    // (collapsed) Hierarchy pane.
    expect(selectClass.mock.calls[0][1]).toBe(false);
    expect(ctl.getFilter(VIEW_METHODS)).toBe('reads:count');
    expect(ctl.showClassMethods).toBe(false);
  });

  it('does not re-select the class when the pane already shows it', () => {
    const ctl = makeController(); // state.className === 'Demo'
    const selectClass = vi.spyOn(ctl, 'selectClass').mockImplementation(() => {});

    ctl.filterMethodsByIvar('accesses', 'count', 'Demo');

    expect(selectClass).not.toHaveBeenCalled();
    expect(ctl.getFilter(VIEW_METHODS)).toBe('accesses:count');
  });
});

const METHOD_URI = 'gemstone://1/UserGlobals/Demo/instance/accessing/count';

describe('source-editor ivar highlighting', () => {
  it('resolves the ivar names a method source should highlight under the filter', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');

    expect(ctl.ivarsToHighlight(Uri.parse(METHOD_URI))).toEqual(['count']);
  });

  it('highlights nothing for a plain textual filter', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'count');

    expect(ctl.ivarsToHighlight(Uri.parse(METHOD_URI))).toEqual([]);
  });

  it('highlights nothing for a non-gemstone editor', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');

    expect(ctl.ivarsToHighlight(Uri.parse('file:///x.st'))).toEqual([]);
  });

  it('decorates each occurrence of the filtered ivar in the opened source', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');
    const editor = fakeEditor(METHOD_URI, 'count\n\t^count');

    (ctl as unknown as { applyIvarHighlight: (e: unknown) => void }).applyIvarHighlight(editor);

    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    expect((editor.setDecorations.mock.calls[0][1] as unknown[]).length).toBe(2);
  });

  it('refreshes highlights across every visible source editor', () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'reads:count');
    const editor = fakeEditor(METHOD_URI, 'count\n\t^count');
    window.visibleTextEditors = [editor];

    try {
      ctl.refreshIvarHighlights();

      expect(editor.setDecorations).toHaveBeenCalledTimes(1);
      expect((editor.setDecorations.mock.calls[0][1] as unknown[]).length).toBe(2);
    } finally {
      window.visibleTextEditors = [];
    }
  });
});
