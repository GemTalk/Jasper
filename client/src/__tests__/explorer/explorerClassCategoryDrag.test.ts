import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what this flow touches.
vi.mock('../../browserQueries', () => ({
  recategorizeClass: vi.fn(() => 'Recategorized: Widget'),
  getClassesWithCategory: vi.fn(() => [] as unknown[]),
  getClassEnvironments: vi.fn(() => []),
  canClassBeWritten: vi.fn(() => true),
}));

import * as vscode from 'vscode';
import { DataTransfer, DataTransferItem } from '../../__mocks__/vscode';
import * as queries from '../../browserQueries';
import { buildClassDefinitionUri } from '../../gemstoneFileSystemProvider';
import {
  CategoryDropController,
  ClassCategoryItem,
  ClassDragAndDrop,
  ClassItem,
  ExplorerController,
  FilterChipItem,
} from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { ClassCategoryEntry } from '../../browserQueries';

function makeViews() {
  const pane = () => ({
    description: '',
    reveal: vi.fn(() => Promise.resolve()),
    selection: [] as unknown[],
  });
  return { dict: pane(), category: pane(), klass: pane(), hierarchy: pane(), method: pane() };
}

const notifyDocumentChanged = vi.fn();

function makeController(entries: ClassCategoryEntry[] = []) {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(
    sessionManager,
    undefined,
    undefined,
    undefined,
    undefined,
    notifyDocumentChanged,
  );
  ctl.setViews(makeViews() as unknown as Parameters<ExplorerController['setViews']>[0]);
  // Seed the pane's own view of which class sits in which category through the read that
  // really populates it, and go in through selectDict — the same call a dictionary click
  // makes. Writing the private backing field instead would be invisible to TypeScript on a
  // rename AND would bypass the accessor's derivation, and it fails QUIETLY: every
  // `categoryOfClass` lookup would just return undefined, which only one test below can see.
  vi.mocked(queries.getClassesWithCategory).mockReturnValue(entries);
  ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 3 });
  return ctl;
}

function entry(className: string, category: string): ClassCategoryEntry {
  return { className, category } as ClassCategoryEntry;
}

/** Run a whole drag: pick the rows up in the Classes pane, drop them on a Categories row. */
async function drag(
  ctl: ExplorerController,
  source: unknown[],
  target: unknown,
): Promise<DataTransfer> {
  const transfer = new DataTransfer();
  new ClassDragAndDrop(ctl).handleDrag(
    source as Parameters<ClassDragAndDrop['handleDrag']>[0],
    transfer,
  );
  await new CategoryDropController(ctl).handleDrop(
    target as Parameters<CategoryDropController['handleDrop']>[0],
    transfer,
  );
  return transfer;
}

const CLASS_MIME = 'application/vnd.gemstone.explorerclass';

const showInformationMessage = vi.mocked(vscode.window.showInformationMessage);
const showErrorMessage = vi.mocked(vscode.window.showErrorMessage);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.recategorizeClass).mockReturnValue('Recategorized: Widget');
  vi.mocked(queries.getClassesWithCategory).mockReturnValue([]);
});

describe('dragging a class onto a class category', () => {
  it('files the dragged class into the dropped-on category', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await drag(ctl, [new ClassItem('Widget')], new ClassCategoryItem('New', 'JasperIt-New', false));

    expect(queries.recategorizeClass).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'Widget',
      'JasperIt-New',
      3,
    );
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Moved Widget to class category 'JasperIt-New'.",
    );
  });

  it('files into the full dashed path, not the row segment it was dropped on', async () => {
    const ctl = makeController([entry('Widget', 'Kernel')]);

    await drag(
      ctl,
      [new ClassItem('Widget')],
      new ClassCategoryItem('Core', 'Announcements-Core', false),
    );

    expect(queries.recategorizeClass).toHaveBeenCalledWith(
      expect.anything(),
      'Widget',
      'Announcements-Core',
      3,
    );
  });

  it('does nothing when the class is already in that category', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Same')]);

    await drag(
      ctl,
      [new ClassItem('Widget')],
      new ClassCategoryItem('Same', 'JasperIt-Same', false),
    );

    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('ignores a drop on the filter chip, which is a control and not a category', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await drag(
      ctl,
      [new ClassItem('Widget')],
      new FilterChipItem('gemstoneExplorerCategories', ''),
    );

    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('carries only class rows — an expanded class’s variable child is not a class', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    const transfer = await drag(
      ctl,
      [{ className: 'Widget' }],
      new ClassCategoryItem('New', 'JasperIt-New', false),
    );

    // Nothing draggable, so no mime is set and the drop has nothing to act on.
    expect(transfer.get(CLASS_MIME)).toBeUndefined();
    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('reports a soft failure the query RETURNS rather than throws', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);
    vi.mocked(queries.recategorizeClass).mockReturnValue('Class not found: Widget');

    await drag(ctl, [new ClassItem('Widget')], new ClassCategoryItem('New', 'JasperIt-New', false));

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found: Widget'),
    );
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('re-reads the dictionary so the panes show the class under its new category', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await drag(ctl, [new ClassItem('Widget')], new ClassCategoryItem('New', 'JasperIt-New', false));

    expect(queries.getClassesWithCategory).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it('tells an open class definition to re-read, since its category line has changed', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await drag(ctl, [new ClassItem('Widget')], new ClassCategoryItem('New', 'JasperIt-New', false));

    expect(notifyDocumentChanged).toHaveBeenCalledWith(
      buildClassDefinitionUri(1, 'UserGlobals', 'Widget', 3),
    );
  });

  it('leaves open definitions alone when the move failed', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);
    vi.mocked(queries.recategorizeClass).mockReturnValue('Class not found: Widget');

    await drag(ctl, [new ClassItem('Widget')], new ClassCategoryItem('New', 'JasperIt-New', false));

    expect(notifyDocumentChanged).not.toHaveBeenCalled();
  });
});

describe('picking up class rows to drag', () => {
  it('carries nothing when no dictionary is showing, so there is nothing to move within', () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);
    ctl.state.dictIndex = undefined;

    expect(ctl.classDragPayloads([new ClassItem('Widget')])).toEqual([]);
  });

  it('carries the class and the category it is in right now', () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    expect(ctl.classDragPayloads([new ClassItem('Widget')])).toEqual([
      { className: 'Widget', category: 'JasperIt-Old', dictIndex: 3 },
    ]);
  });

  it('leaves the category undefined for a class the pane has no entry for', () => {
    const ctl = makeController([]);

    expect(ctl.classDragPayloads([new ClassItem('Unknown')])[0].category).toBeUndefined();
  });

  it('hands the pending drag over once, since a drag lands on one target', () => {
    const ctl = makeController();
    ctl.setPendingClassDrag([{ className: 'Widget', category: 'Old', dictIndex: 3 }]);

    expect(ctl.takePendingClassDrag()).toHaveLength(1);
    expect(ctl.takePendingClassDrag()).toEqual([]);
  });
});

describe('the Class Categories drop target', () => {
  const dropOn = async (ctl: ExplorerController, target: unknown, mime = CLASS_MIME) => {
    const transfer = new DataTransfer();
    ctl.setPendingClassDrag([{ className: 'Widget', category: 'JasperIt-Old', dictIndex: 3 }]);
    transfer.set(mime, new DataTransferItem('gemstone-class-drag'));
    await new CategoryDropController(ctl).handleDrop(
      target as Parameters<CategoryDropController['handleDrop']>[0],
      transfer,
    );
  };

  it('does not accept a drag of some other kind', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await dropOn(ctl, new ClassCategoryItem('New', 'JasperIt-New', false), 'text/uri-list');

    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('ignores a drop on empty space, which names no category to file into', async () => {
    const ctl = makeController([entry('Widget', 'JasperIt-Old')]);

    await dropOn(ctl, undefined);

    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('offers no drag of its own — categories are a drop target only', () => {
    const controller = new CategoryDropController(makeController());
    const transfer = new DataTransfer();

    controller.handleDrag();

    expect(controller.dragMimeTypes).toEqual([]);
    expect([...transfer]).toEqual([]);
  });
});

// Several classes travelling together is only reachable if the Classes pane allows a
// multi-row selection — without it VS Code hands `handleDrag` exactly one row and the
// plural confirmation, the per-class failure accumulation, and the tests below would all
// describe a shape no user can produce. Read from the source because the pane options are
// passed to `createTreeView` at activation, which these unit tests do not run.
describe('the Classes pane allows a multi-row drag', () => {
  it('creates the pane with canSelectMany, so more than one class can be picked up', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'gemstoneExplorer.ts'),
      'utf-8',
    );
    const options = src.slice(src.indexOf("createTreeView('gemstoneExplorerClasses'"));
    expect(options.slice(0, options.indexOf('});'))).toContain('canSelectMany: true');
  });
});

describe('filing dragged classes into a category', () => {
  it('reports every class it moved when several travel together', async () => {
    const ctl = makeController([entry('Widget', 'Old'), entry('Gadget', 'Old')]);

    await ctl.dragClassesToCategory(
      [
        { className: 'Widget', category: 'Old', dictIndex: 3 },
        { className: 'Gadget', category: 'Old', dictIndex: 3 },
      ],
      'JasperIt-New',
    );

    expect(queries.recategorizeClass).toHaveBeenCalledTimes(2);
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Moved 2 classes to class category 'JasperIt-New'.",
    );
  });

  it('moves the classes it can when one of them fails', async () => {
    const ctl = makeController([entry('Widget', 'Old'), entry('Gadget', 'Old')]);
    vi.mocked(queries.recategorizeClass)
      .mockReturnValueOnce('Class not found: Widget')
      .mockReturnValueOnce('Recategorized: Gadget');

    await ctl.dragClassesToCategory(
      [
        { className: 'Widget', category: 'Old', dictIndex: 3 },
        { className: 'Gadget', category: 'Old', dictIndex: 3 },
      ],
      'JasperIt-New',
    );

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Widget'));
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Moved Gadget to class category 'JasperIt-New'.",
    );
    // Only the class that actually moved has a stale definition on screen; telling the
    // other one to re-read would throw away edits over a move that never happened.
    expect(notifyDocumentChanged).toHaveBeenCalledTimes(1);
    expect(notifyDocumentChanged).toHaveBeenCalledWith(
      buildClassDefinitionUri(1, 'UserGlobals', 'Gadget', 3),
    );
  });

  it('reports a query that throws instead of letting it escape the drop', async () => {
    const ctl = makeController([entry('Widget', 'Old')]);
    vi.mocked(queries.recategorizeClass).mockImplementation(() => {
      throw new Error('session busy');
    });

    await ctl.dragClassesToCategory(
      [{ className: 'Widget', category: 'Old', dictIndex: 3 }],
      'New',
    );

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('session busy'));
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('moves the class even where nothing is listening for document changes', async () => {
    const sessionManager = {
      getSelectedSession: () => ({ id: 1 }) as ActiveSession,
    } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = 3;

    await ctl.dragClassesToCategory(
      [{ className: 'Widget', category: 'Old', dictIndex: 3 }],
      'JasperIt-New',
    );

    expect(queries.recategorizeClass).toHaveBeenCalled();
  });

  it('skips the definition refresh when no dictionary is showing to name the document', async () => {
    const ctl = makeController([entry('Widget', 'Old')]);
    ctl.state.dictName = undefined;

    await ctl.dragClassesToCategory(
      [{ className: 'Widget', category: 'Old', dictIndex: 3 }],
      'JasperIt-New',
    );

    expect(queries.recategorizeClass).toHaveBeenCalled();
    expect(notifyDocumentChanged).not.toHaveBeenCalled();
  });

  it('does nothing without a session to run the move on', async () => {
    const ctl = new ExplorerController({
      getSelectedSession: () => undefined,
    } as unknown as SessionManager);

    await ctl.dragClassesToCategory(
      [{ className: 'Widget', category: 'Old', dictIndex: 3 }],
      'New',
    );

    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('still moves the class when its name has no URI to refresh', async () => {
    const ctl = makeController([entry('Odd/Name', 'Old')]);

    await ctl.dragClassesToCategory(
      [{ className: 'Odd/Name', category: 'Old', dictIndex: 3 }],
      'JasperIt-New',
    );

    expect(queries.recategorizeClass).toHaveBeenCalledWith(
      expect.anything(),
      'Odd/Name',
      'JasperIt-New',
      3,
    );
    expect(notifyDocumentChanged).not.toHaveBeenCalled();
  });
});

describe('dropping methods onto a class row', () => {
  const METHOD_MIME = 'application/vnd.gemstone.explorermethod';
  const methodPayload = {
    selector: 'foo',
    isMeta: false,
    category: 'accessing',
    className: 'Gadget',
    dictName: 'UserGlobals',
    dictIndex: 3,
  };

  const dropMethodsOn = async (ctl: ExplorerController, target: unknown, mime = METHOD_MIME) => {
    const transfer = new DataTransfer();
    ctl.setPendingMethodDrag([methodPayload]);
    transfer.set(mime, new DataTransferItem('gemstone-method-drag'));
    await new ClassDragAndDrop(ctl).handleDrop(
      target as Parameters<ClassDragAndDrop['handleDrop']>[0],
      transfer,
    );
  };

  it('hands the dragged methods to the class they landed on', async () => {
    const ctl = makeController();
    const dragToClass = vi.spyOn(ctl, 'dragToClass').mockResolvedValue();

    await dropMethodsOn(ctl, new ClassItem('Widget'));

    expect(dragToClass).toHaveBeenCalledWith([methodPayload], 'Widget');
  });

  it('resolves the class from a child row of an expanded class', async () => {
    const ctl = makeController();
    const dragToClass = vi.spyOn(ctl, 'dragToClass').mockResolvedValue();

    await dropMethodsOn(ctl, { className: 'Widget' });

    expect(dragToClass).toHaveBeenCalledWith([methodPayload], 'Widget');
  });

  it('ignores a drop that is not a method drag', async () => {
    const ctl = makeController();
    const dragToClass = vi.spyOn(ctl, 'dragToClass').mockResolvedValue();

    await dropMethodsOn(ctl, new ClassItem('Widget'), CLASS_MIME);

    expect(dragToClass).not.toHaveBeenCalled();
  });

  it('ignores a drop on empty space, which names no class to move into', async () => {
    const ctl = makeController();
    const dragToClass = vi.spyOn(ctl, 'dragToClass').mockResolvedValue();

    await dropMethodsOn(ctl, undefined);

    expect(dragToClass).not.toHaveBeenCalled();
  });
});
