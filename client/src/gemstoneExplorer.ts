import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { ALL_METHODS_CATEGORY, SESSION_METHODS_CATEGORY } from './systemBrowser';
import {
  escapeSelectorSlashes,
  unescapeSelectorSlashes,
  buildClassDefinitionUri,
  buildNewMethodUri,
  buildMethodUri,
  parseUri,
  listOpenGemstoneTabs,
} from './gemstoneFileSystemProvider';
import { filterMatches } from './explorerFilter';
import { DoubleClickDetector } from './explorerDoubleClick';
import { categoryChildNodes, categoryParentPath, categoryMatches } from './explorerCategories';
import { registerExplorerOpenEditors } from './explorerOpenEditors';
import { SourceEditorPlacement } from './sourceEditorPlacement';
import { generateAndSaveGrailStub } from './grailStubGenerator';
import {
  RenameChange,
  parseRenameChanges,
  orderChangesClassDefFirst,
  planRenameApply,
  validateNewIvarName,
} from './refactoring/renameInstVarPreview';
import { showRenameInstVarPanel } from './refactoring/renameInstVarPanel';
import { renameInstVarAtCursorCommand } from './refactoring/renameInstVarAtCursorCommand';
import { runInstVarRefactor } from './refactoring/instVarRefactorCommand';
import { renameClassVarAtCursorCommand } from './refactoring/renameClassVarAtCursorCommand';
import {
  renameMethodAtCursorCommand,
  SelectorAtPosition,
} from './refactoring/renameMethodAtCursorCommand';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewParts,
  buildSelector,
  permutationFromOriginalIndices,
  parseArgNames,
} from './refactoring/renameMethodPreview';
import { PREVIEW_PAGE_BYTES } from './refactoring/queries/previewRenameMethod';
import { showRenameMethodEditor } from './refactoring/renameMethodEditor';
import { showRenameMethodPanel } from './refactoring/renameMethodPanel';
import { beginChangeSignature, changeSignatureCommand } from './refactoring/changeSignatureCommand';
import { moveInstVar as moveInstVarFlow } from './refactoring/instVarStructureCommand';
import { pushMethod } from './refactoring/pushMethodCommand';
import { PushDirection } from './refactoring/queries/previewPushMethod';
import {
  parseStartPreview as parseStartClassPreview,
  parsePage as parseClassPage,
  parseApplyResult as parseClassApplyResult,
  validateNewClassName,
} from './refactoring/renameClassPreview';
import { showRenameClassEditor } from './refactoring/renameClassEditor';
import { showRenameClassPanel } from './refactoring/renameClassPanel';
import {
  parseStartPreview as parseStartClassVarPreview,
  parsePage as parseClassVarPage,
  parseApplyResult as parseClassVarApplyResult,
  validateNewClassVarName,
} from './refactoring/renameClassVarPreview';
import { showRenameClassVarPanel } from './refactoring/renameClassVarPanel';
import { variableSides, defaultDictionaryIndex } from './explorerTreeHelpers';
import {
  parseClassHistory,
  parseRevertResult,
  parseRemoveResult,
} from './refactoring/classHistoryModel';
import { showClassHistoryPanel } from './refactoring/classHistoryPanel';
import { moveMethod } from './refactoring/moveMethodCommand';

const VIEW_DICTS = 'gemstoneExplorerDicts';
const VIEW_CATEGORIES = 'gemstoneExplorerCategories';
const VIEW_CLASSES = 'gemstoneExplorerClasses';
const VIEW_METHODS = 'gemstoneExplorerMethods';
// Panes that support the live filter (the Hierarchy pane doesn't).
const EXPLORER_VIEWS = [VIEW_DICTS, VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS];

// Open a gemstone:// source document in the editor area. A plain open replaces
// the active preview tab (keeping focus in the tree for live browsing); an
// open-to-side pins the editor in a balanced column so several editors spread
// across a few of OUR groups instead of clumping. `placement` scopes the
// balancing to editors this Explorer opened, so it doesn't invade the System
// Browser's group (see sourceEditorPlacement.ts).
async function openGemstoneDocument(
  doc: vscode.TextDocument,
  toSide: boolean,
  placement: SourceEditorPlacement,
): Promise<void> {
  if (!toSide) {
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
      preserveFocus: true,
    });
    placement.remember(doc.uri);
    return;
  }
  const target = placement.balancedColumn();
  if (target === 'new') {
    // Append a fresh group at the far right: focus the last group first so
    // Beside lands to its right. (A numeric column past the end is treated as
    // "beside the active group", which isn't reliably the rightmost.)
    await vscode.commands.executeCommand('workbench.action.focusLastEditorGroup');
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
      preserveFocus: false,
    });
  } else {
    await vscode.window.showTextDocument(doc, {
      viewColumn: target,
      preview: false,
      preserveFocus: false,
    });
  }
  placement.remember(doc.uri);
}

// ── GemStone Explorer ───────────────────────────────────────────────────────
//
// A set of interconnected navigation panes that cascade left-to-right:
//   Dictionaries → Class Categories → Classes → Methods (side ▸ category ▸ sel)
// Selecting a method opens its source in an editor; the ↗ inline action (or
// right-click ▸ Open to the Side) opens it in a balanced editor group. The
// Open Editors pane mirrors the currently-open source editors.
//
// The panes live in their own `gemstoneExplorer` sidebar container. All four share
// one controller that holds the cascade state, the current dictionary's
// class→category listing, and the selected class's per-method metadata
// (categories, override arrows, session-method flags).

interface ExplorerState {
  dictName?: string;
  dictIndex?: number; // 1-based symbolList position
  classCategory?: string; // undefined = show all classes in dict
  className?: string;
  selectedSelector?: string; // last method opened (kept for reference)
  // Context recorded from the Methods pane so New Method / New Method Category
  // land on the right side/category even without a method currently selected.
  selectedIsMeta?: boolean;
  selectedMethodCategory?: string;
}

// Per-selector metadata derived from the class's environment data.
interface SelectorInfo {
  selector: string;
  category: string; // real method category (for the source URI)
  overrideBits: number; // 1 = overrides super, 2 = overridden below
  sessionBit: number; // 0 = none, 1 = extension, 2 = override
}

// ── Tree item payload classes ───────────────────────────────────────────────

class DictItem extends vscode.TreeItem {
  constructor(
    public readonly dictName: string,
    public readonly dictIndex: number,
  ) {
    super(dictName, vscode.TreeItemCollapsibleState.None);
    // Stable id so TreeView.reveal (used by Find Class) can locate this row.
    this.id = `d:${dictIndex}:${dictName}`;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    // Hosts the row's context menu (e.g. Remove Dictionary).
    this.contextValue = 'explorerDict';
  }
}

// Class categories render as a tree keyed on '-' segments: "Announcements-Core"
// is a child of "Announcements". `fullPath` is the whole dash-joined category;
// `segment` is just this node's piece. Selecting a node shows the classes in
// that category AND all of its sub-categories (prefix match).
class ClassCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly segment: string,
    public readonly fullPath: string,
    hasChildren: boolean,
  ) {
    super(
      segment,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `c:${fullPath}`;
    this.contextValue = 'explorerCategory';
    this.iconPath = new vscode.ThemeIcon('symbol-folder');
    if (fullPath !== segment) this.tooltip = fullPath;
  }
}

class ClassItem extends vscode.TreeItem {
  // `hasIvars` drives the expansion caret: a class with locally-defined instance
  // variables opens to reveal its ivar sub-tree; one without stays flat. It never
  // affects the stable `id`, so TreeView.reveal still matches regardless.
  constructor(
    public readonly className: string,
    hasIvars = false,
    versionTag?: string,
  ) {
    super(
      versionTag === undefined ? className : `${className}[${versionTag}]`,
      hasIvars ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    // The displayed label may carry a `[n]` version tag, but the node's identity
    // (id, click argument, ivar sub-tree) always uses the raw class name.
    this.id = `k:${className}`;
    this.contextValue = 'explorerClass';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    // Fires on every click (selection still drives navigation separately); the
    // controller uses the timing to detect a double-click → open definition.
    this.command = {
      command: 'gemstone.explorer.classClicked',
      title: '',
      arguments: [className],
    };
  }
}

// A locally-defined instance variable, shown under its class's "instance"
// variable-side node. The pencil (inline) action renames it; selecting the row
// does not navigate.
class IvarItem extends vscode.TreeItem {
  constructor(
    public readonly className: string,
    public readonly ivarName: string,
    // Drives the inline ▼ "Push Down" arrow: with no subclasses there's nowhere to push
    // to, so the row uses a contextValue the push-down menu doesn't match. The ▲ "Push Up"
    // and ✎ rename actions match both contextValues.
    hasSubclasses = true,
  ) {
    super(ivarName, vscode.TreeItemCollapsibleState.None);
    this.id = `k:${className}/iv:${ivarName}`;
    this.contextValue = hasSubclasses ? 'explorerIvar' : 'explorerIvarNoSubs';
    this.iconPath = new vscode.ThemeIcon('symbol-field');
    this.tooltip = `Instance variable defined in ${className}`;
  }
}

// A locally-defined class variable, shown under its class's "class" variable-side
// node. The pencil (inline) action renames it across the class and its subclasses;
// selecting the row does not navigate.
class ClassVarItem extends vscode.TreeItem {
  constructor(
    public readonly className: string,
    public readonly classVarName: string,
  ) {
    super(classVarName, vscode.TreeItemCollapsibleState.None);
    this.id = `k:${className}/cv:${classVarName}`;
    this.contextValue = 'explorerClassVar';
    this.iconPath = new vscode.ThemeIcon('symbol-constant');
    this.tooltip = `Class variable defined in ${className}`;
  }
}

// The "instance" / "class" grouping node under a ClassItem that separates instance
// variables from class variables — mirroring the Methods pane's instance/class
// sides. isMeta=false holds the IvarItem rows; isMeta=true holds the ClassVarItem
// rows. A side node is only created when that side has at least one variable.
class VarSideItem extends vscode.TreeItem {
  constructor(
    public readonly className: string,
    public readonly isMeta: boolean,
  ) {
    super(isMeta ? 'class' : 'instance', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `k:${className}/vside:${isMeta}`;
    // Split by side so the inline "+" (Add Instance Variable) targets only the
    // instance side; the class side keeps the base token.
    this.contextValue = isMeta ? 'explorerVarSide.class' : 'explorerVarSide.instance';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.tooltip = isMeta
      ? `Class variables of ${className}`
      : `Instance variables of ${className}`;
  }
}

type ClassNode = ClassItem | VarSideItem | IvarItem | ClassVarItem;

// Method pane is a 3-level tree: side ▸ method-category ▸ selector.
class MethodSideItem extends vscode.TreeItem {
  constructor(public readonly isMeta: boolean) {
    // Instance side opens expanded (so ALL METHODS shows immediately); the
    // class side starts collapsed to keep the default view focused.
    super(
      isMeta ? 'class' : 'instance',
      isMeta ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.id = `mside:${isMeta}`;
    // Both instance/class side headers use the class icon — distinct from the
    // per-method rows (symbol-method) so a header doesn't read as a method.
    this.iconPath = new vscode.ThemeIcon('symbol-class');
  }
}

class MethodCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly isMeta: boolean,
    public readonly category: string,
    public readonly computed: boolean,
  ) {
    // ALL METHODS is the default landing view — expand it so selecting a class
    // immediately lists every method.
    super(
      category,
      category === ALL_METHODS_CATEGORY
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `mcat:${isMeta}:${category}`;
    this.iconPath = new vscode.ThemeIcon(computed ? 'list-flat' : 'symbol-folder');
  }
}

class MethodItem extends vscode.TreeItem {
  // `displayCategory` is the category node this row is shown *under* (a real
  // category, ALL METHODS, SESSION METHODS, or undefined when flattened by a
  // filter). It's needed so MethodProvider.getParent can walk up for reveal().
  constructor(
    public readonly isMeta: boolean,
    public readonly info: SelectorInfo,
    public readonly displayCategory?: string,
  ) {
    super(info.selector, vscode.TreeItemCollapsibleState.None);
    this.id = `msel:${isMeta}:${displayCategory ?? ''}:${info.selector}`;
    // The context value carries the indicator state so the right-click menu can
    // offer superclass/subclass-implementation browsing only where an override
    // arrow is actually present (▲ overrides super, ▼ overridden below). Base
    // Senders/Implementors are always offered on the plain `explorerMethod` token.
    this.contextValue =
      'explorerMethod' +
      (info.overrideBits & 1 ? '.up' : '') +
      (info.overrideBits & 2 ? '.down' : '') +
      (info.sessionBit ? '.session' : '');

    // Indicators (tree items can't render italics, so we surface override/
    // session state via a compact glyph description + an explanatory tooltip).
    const marks: string[] = [];
    if (info.overrideBits & 1) marks.push('▲');
    if (info.overrideBits & 2) marks.push('▼');
    if (info.sessionBit === 1) marks.push('+');
    if (info.sessionBit === 2) marks.push('±');
    this.description = marks.join(' ');

    // Encode the selector/side as a command-link argument so the tooltip lines
    // below are *clickable* (a guaranteed-working path to the browse actions,
    // independent of whether the inline row buttons render).
    const arg = encodeURIComponent(JSON.stringify([{ selector: info.selector, isMeta }]));
    const cmd = (id: string) => `command:gemstone.explorer.${id}?${arg}`;

    const lines = ['Click to open · $(split-horizontal) opens to the side'];
    lines.push(`[Implementors](${cmd('implementorsOf')}) · [Senders](${cmd('sendersOf')})`);
    if (info.overrideBits & 1) {
      lines.push(
        `[▲ Superclass implementors](${cmd('superImplementors')}) — overrides a superclass method`,
      );
    }
    if (info.overrideBits & 2) {
      lines.push(`[▼ Subclass overrides](${cmd('subOverrides')}) — overridden in a subclass`);
    }
    if (info.sessionBit === 1) lines.push('+ session method (extension — adds new behavior)');
    if (info.sessionBit === 2) lines.push('± session method (overrides a persistent base method)');
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    tooltip.supportThemeIcons = true;
    tooltip.isTrusted = true; // required for command: links to be clickable
    this.tooltip = tooltip;

    if (info.sessionBit) {
      this.iconPath = new vscode.ThemeIcon(
        'symbol-method',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
  }
}

type MethodNode = MethodSideItem | MethodCategoryItem | MethodItem;

// ── Hierarchy pane ───────────────────────────────────────────────────────────
// Shows the selected class's lineage: superclasses (root-first) → the class
// itself → its immediate subclasses. Clicking any row navigates to that class.
class HierarchyItem extends vscode.TreeItem {
  constructor(
    public readonly className: string,
    public readonly dictName: string,
    public readonly role: 'ancestor' | 'self' | 'subclass',
    // Position in the ancestor→self chain; -1 for subclasses.
    public readonly chainIndex: number,
    hasChildren: boolean,
    // A `[current/total]` class-history version tag, when the class has more than
    // one version (same rule as the Classes pane). Affects only the label, never the id.
    versionTag?: string,
  ) {
    super(
      versionTag === undefined ? className : `${className}[${versionTag}]`,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `h:${role}:${chainIndex}:${className}`;
    this.contextValue = 'explorerHierClass';
    // The current class is shown by keeping it *selected* in this pane (synced
    // with the Classes pane), so no extra "current" label is needed; up/down
    // arrows distinguish superclasses from subclasses.
    this.iconPath = new vscode.ThemeIcon(
      role === 'self'
        ? 'symbol-class'
        : role === 'ancestor'
          ? 'arrow-small-up'
          : 'arrow-small-down',
    );
  }
}

// The browse commands accept either a tree item (inline button / right-click) or
// a plain {selector, isMeta} payload (from a tooltip command: link, which can
// only carry JSON). Normalize both to the selector + side.
// Payload carried while dragging a method (same-window drag keeps the object).
interface MethodDragPayload {
  selector: string;
  isMeta: boolean;
  category: string;
  className: string;
  dictName: string;
  dictIndex: number;
}
const METHOD_MIME = 'application/vnd.gemstone.explorermethod';

// A class picker that filters by PREFIX on the class name as the user types. VS Code's
// default showQuickPick does fuzzy SUBSTRING matching — typing "Z" would also surface
// "AZure" / "BtreeOptimiZed" (a 'z' anywhere) — which reads as random. Here we own the
// items and prefix-filter them ourselves (matchOnDescription/Detail off), so "Z" shows
// only Z… classes. Returns the chosen entry, or undefined if dismissed.
async function pickClassByPrefix(
  entries: queries.ClassNameEntry[],
  title: string,
): Promise<queries.ClassNameEntry | undefined> {
  type Item = vscode.QuickPickItem & { entry: queries.ClassNameEntry };
  const all: Item[] = entries.map((e) => ({
    label: e.className,
    description: e.dictName,
    entry: e,
  }));
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = title;
  qp.placeholder = 'Type the start of the destination class name…';
  qp.matchOnDescription = false;
  qp.matchOnDetail = false;
  qp.items = all;
  qp.onDidChangeValue((value) => {
    const q = value.trim().toLowerCase();
    qp.items = q === '' ? all : all.filter((it) => it.label.toLowerCase().startsWith(q));
  });
  try {
    return await new Promise<queries.ClassNameEntry | undefined>((resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems[0]?.entry);
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
    });
  } finally {
    qp.dispose();
  }
}

type MethodCommandArg = MethodItem | { selector: string; isMeta: boolean } | undefined;
function methodArg(arg: MethodCommandArg): { selector: string; isMeta: boolean } | undefined {
  if (arg instanceof MethodItem) return { selector: arg.info.selector, isMeta: arg.isMeta };
  if (arg && typeof arg.selector === 'string')
    return { selector: arg.selector, isMeta: !!arg.isMeta };
  return undefined;
}

// The MethodItem set a tree command should act on. VS Code passes a multi-select
// command (focusedItem, allSelectedItems); prefer the full selection, falling back to
// the focused row when the array is absent (single-select / palette). Non-method nodes
// are filtered out.
function methodSelection(
  item: MethodItem | undefined,
  selected: MethodItem[] | undefined,
): MethodItem[] {
  const source = Array.isArray(selected) && selected.length > 0 ? selected : item ? [item] : [];
  return source.filter((n): n is MethodItem => n instanceof MethodItem);
}

// Views the controller updates with the current selection (shown as the greyed
// description beside each pane title).
interface ExplorerViews {
  dict: vscode.TreeView<DictItem>;
  category: vscode.TreeView<ClassCategoryItem>;
  klass: vscode.TreeView<ClassNode>;
  hierarchy: vscode.TreeView<HierarchyItem>;
  method: vscode.TreeView<MethodNode>;
}

// ── Controller ───────────────────────────────────────────────────────────────

export class ExplorerController {
  readonly state: ExplorerState = {};
  // className → category for the current dictionary; fetched once per dict.
  private classCategoryEntries: queries.ClassCategoryEntry[] = [];
  // className → count of locally-defined instance variables, for the current
  // dictionary; fetched once per dict so class rows know whether to show an
  // expansion caret. Names are fetched lazily on expand and memoized here.
  private definedIvarCounts = new Map<string, number>();
  private readonly definedIvarNamesCache = new Map<string, string[]>();
  // className → {superclass, subclasses} from the class hierarchy, memoized so ivar rows
  // can cheaply know whether a class has subclasses (to gate the ▼ push-down arrow) and
  // find the push up/down reveal target. Cleared alongside the ivar caches on any reshape.
  private readonly hierNeighborsCache = new Map<
    string,
    { superclass?: string; subclasses: string[] }
  >();
  // Same, for locally-defined CLASS variables (drives the class-variable sub-tree).
  private definedClassVarCounts = new Map<string, number>();
  private readonly definedClassVarNamesCache = new Map<string, string[]>();
  // className → {current,total} position in its class history, for classes with
  // more than one version in the current dictionary; fetched once per dict so a
  // reshaped class row can render `Foo[2/3]`. Single-version classes are absent
  // (they render with no version tag).
  private classVersions = new Map<string, queries.ClassVersionInfo>();
  // Per-method metadata for the selected class; fetched once per class.
  private envLines: queries.EnvCategoryLine[] = [];
  private views?: ExplorerViews;
  // Active filter pattern per pane (view id → pattern); empty/absent = no filter.
  private readonly filters = new Map<string, string>();
  // The pane whose filter input is currently open (so its header shows the
  // live "Filter: …" label while typing, even if a method is already selected).
  private filteringView?: string;
  // Freshly-created (via the + button) class categories that have no class yet,
  // so they still appear in the Class Categories pane. Cleared on dict change.
  private readonly newClassCategories = new Set<string>();
  // Freshly-created method categories, per side, that hold no method yet.
  // Cleared on class change.
  private readonly newMethodCategories = { instance: new Set<string>(), meta: new Set<string>() };
  // URI of an editor we opened ourselves (method/definition click); syncToEditor
  // ignores its own open so a tree click doesn't bounce the selection.
  private selfOpenedUri?: string;
  // Owns where our source editors land. Balances "open to the side" across only
  // our own groups, so we neither clump nor invade the System Browser's group.
  readonly placement = new SourceEditorPlacement();

  readonly dictProvider = new DictProvider(this);
  readonly categoryProvider = new CategoryProvider(this);
  readonly classProvider = new ClassProvider(this);
  readonly hierarchyProvider = new HierarchyProvider(this);
  readonly methodProvider = new MethodProvider(this);

  // Selected class's lineage: [superclasses root-first…, self] and its subclasses.
  private hierChain: queries.ClassHierarchyEntry[] = [];
  private hierSubs: queries.ClassHierarchyEntry[] = [];

  constructor(private readonly sessionManager: SessionManager) {}

  session(): ActiveSession | undefined {
    return this.sessionManager.getSelectedSession();
  }

  setViews(views: ExplorerViews): void {
    this.views = views;
    this.syncTitles();
  }

  private maxEnv(): number {
    return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
  }

  private syncTitles(): void {
    if (!this.views) return;
    // Show the live "Filter: …" label while this pane's filter input is open
    // (even over a prior selection) or whenever a filter is set with nothing
    // selected; otherwise the selection wins.
    const compose = (viewId: string, selection?: string, fallback = ''): string => {
      const f = this.filters.get(viewId);
      if (f && (this.filteringView === viewId || !selection)) return `Filter: ${f}`;
      return selection || fallback;
    };
    this.views.dict.description = compose(VIEW_DICTS, this.state.dictName);
    this.views.category.description = compose(VIEW_CATEGORIES, this.state.classCategory);
    this.views.klass.description = compose(VIEW_CLASSES, this.state.className);
    this.views.hierarchy.description = this.state.className ?? '';
    // The Methods header reflects what is *currently* selected in the tree — not
    // the last method that happened to be opened. So when the filter input is
    // cleared (backspaced to empty) or dismissed with nothing selected, the
    // header goes blank — matching the other three panes — rather than a stale
    // selector or a redundant class name. See `currentMethodSelector`.
    this.views.method.description = compose(VIEW_METHODS, this.currentMethodSelector());
  }

  // The selector of the method row currently selected in the Methods pane, or
  // undefined when nothing (or a non-method row) is selected. Reads the live
  // TreeView selection so it can't go stale. Falls back to the last-opened
  // selector only when the view can't report a selection (e.g. under test mocks).
  private currentMethodSelector(): string | undefined {
    const selection = this.views?.method.selection;
    if (!selection) return this.state.selectedSelector;
    const item = selection.find((n) => n instanceof MethodItem);
    return item?.info.selector;
  }

  getFilter(viewId: string): string | undefined {
    return this.filters.get(viewId);
  }

  private providerFor(viewId: string): RefreshableProvider<unknown> {
    switch (viewId) {
      case VIEW_DICTS:
        return this.dictProvider;
      case VIEW_CATEGORIES:
        return this.categoryProvider;
      case VIEW_CLASSES:
        return this.classProvider;
      default:
        return this.methodProvider;
    }
  }

  // Set (or clear, with an empty pattern) a pane's filter: updates the map, the
  // `gemstone.explorerFiltered.<viewId>` context key that shows/hides its Clear
  // button, then refreshes the pane and titles.
  private setFilterState(viewId: string, pattern: string | undefined): void {
    if (pattern) this.filters.set(viewId, pattern);
    else this.filters.delete(viewId);
    void vscode.commands.executeCommand(
      'setContext',
      `gemstone.explorerFiltered.${viewId}`,
      !!pattern,
    );
    this.providerFor(viewId).refresh();
    this.syncTitles();
  }

  clearFilter(viewId: string): void {
    this.setFilterState(viewId, undefined);
  }

  private clearFilters(...viewIds: string[]): void {
    for (const id of viewIds) this.setFilterState(id, undefined);
  }

  // Open a live filter input for a pane: prefix match, '*' wildcard. Typing
  // filters the pane immediately; an empty value clears the filter.
  beginFilter(viewId: string): void {
    const box = vscode.window.createInputBox();
    box.title = 'Filter';
    box.placeholder = 'starts with… (use * as a wildcard)';
    box.value = this.filters.get(viewId) ?? '';
    this.filteringView = viewId;
    this.syncTitles();
    box.onDidChangeValue((value) => this.setFilterState(viewId, value.trim() || undefined));
    box.onDidAccept(() => box.hide());
    box.onDidHide(() => {
      this.filteringView = undefined;
      this.syncTitles();
      box.dispose();
    });
    box.show();
  }

  applyFilter(names: string[], viewId: string): string[] {
    const pattern = this.filters.get(viewId);
    return pattern ? names.filter((n) => filterMatches(n, pattern)) : names;
  }

  // Called when the active session changes: reset everything and reload dicts.
  reset(): void {
    this.state.dictName = undefined;
    this.state.dictIndex = undefined;
    this.state.classCategory = undefined;
    this.state.className = undefined;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.classCategoryEntries = [];
    this.definedIvarCounts = new Map();
    this.classVersions = new Map();
    this.definedIvarNamesCache.clear();
    this.hierNeighborsCache.clear();
    this.definedClassVarCounts = new Map();
    this.definedClassVarNamesCache.clear();
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.newClassCategories.clear();
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(...EXPLORER_VIEWS);
    this.dictProvider.refresh();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
    // Auto-select a default dictionary so the class/category panes are populated on
    // first open. A programmatic tree selection does NOT fire the view's selection
    // handler (which is what runs selectDict), so without this the panes stay empty
    // until the user clicks a dictionary even though one looks highlighted.
    this.autoSelectDefaultDict();
  }

  // Select a sensible default dictionary (UserGlobals if present, else the first)
  // and populate + reveal it. Called ONLY from reset() — i.e. on a session switch,
  // which has already cleared any prior selection — so it never stomps a user's
  // current selection (the manual Refresh button uses refreshRetainingSelection,
  // which does NOT call this). Lets a freshly-connected session land on a populated
  // dictionary instead of empty class/category panes. No-op without a session or
  // dictionaries.
  private autoSelectDefaultDict(): void {
    const session = this.session();
    if (session === undefined) return;
    let names: string[];
    try {
      names = queries.getDictionaryNames(session);
    } catch {
      return;
    }
    const i = defaultDictionaryIndex(names);
    if (i < 0) return;
    const item = new DictItem(names[i], i + 1);
    this.selectDict(item);
    const views = this.views;
    if (views) views.dict.reveal(item, { select: true }).then(undefined, () => {});
  }

  // Re-fetch everything for the CURRENT selection WITHOUT clearing it — the
  // manual Refresh button and a session abort both use this so a stale tree
  // reloads in place (new/removed classes, recompiled methods) while the user
  // stays where they were. Unlike reset(), state and filters are preserved.
  //
  // `reveal` re-highlights (and scrolls to) the retained rows, which also forces
  // the Explorer view visible/forward. That's wanted for the in-Explorer Refresh
  // button, but NOT for an abort fired from another view (e.g. the Sessions
  // tree) — there it would yank focus over to the Explorer. The tree keeps the
  // selection highlighted across a data refresh on its own (stable row ids), so
  // skipping reveal loses nothing but the unwanted jump.
  async refreshRetainingSelection({ reveal = true }: { reveal?: boolean } = {}): Promise<void> {
    const session = this.session();
    const { dictName, dictIndex, className } = this.state;
    // Remember the method row currently selected so it can be re-revealed.
    const selectedMethod = this.views?.method.selection.find((n) => n instanceof MethodItem);
    const revealMethod = selectedMethod
      ? { selector: selectedMethod.info.selector, isMeta: selectedMethod.isMeta }
      : undefined;

    if (!session || dictName === undefined || dictIndex === undefined) {
      // Nothing meaningful selected — just reload the dictionary list.
      this.dictProvider.refresh();
      this.syncTitles();
      return;
    }

    // Reload the dictionary's class listing (+ ivar counts) and, when a class is
    // selected, its method environment and hierarchy. Keep stale data on a failed
    // fetch rather than blanking the tree out from under the user.
    try {
      this.classCategoryEntries = queries.getClassesWithCategory(session, dictIndex);
    } catch {
      /* keep stale on failure */
    }
    this.loadDefinedIvarCounts();
    if (className !== undefined) {
      try {
        this.envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
      } catch {
        /* keep stale on failure */
      }
      this.loadHierarchy();
    }

    this.dictProvider.refresh();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();

    if (reveal) await this.revealRetainedSelection(revealMethod);
    this.syncTitles();
  }

  // Re-highlight the retained dict/category/class/method rows after a refresh.
  // reveal() rejects when a row isn't in the (rebuilt) tree; treat each as a
  // best-effort highlight, exactly like revealClass does.
  private async revealRetainedSelection(revealMethod?: {
    selector: string;
    isMeta: boolean;
  }): Promise<void> {
    const { dictName, dictIndex, classCategory, className } = this.state;
    if (dictName !== undefined && dictIndex !== undefined) {
      try {
        await this.views?.dict.reveal(new DictItem(dictName, dictIndex), { select: true });
      } catch {
        /* ignore */
      }
    }
    if (classCategory) {
      const segment = classCategory.split('-').pop() ?? classCategory;
      try {
        await this.views?.category.reveal(new ClassCategoryItem(segment, classCategory, false), {
          select: true,
          expand: true,
        });
      } catch {
        /* ignore */
      }
    }
    if (className !== undefined) {
      try {
        await this.views?.klass.reveal(
          new ClassItem(className, this.classHasDefinedVars(className)),
          { select: true },
        );
      } catch {
        /* ignore */
      }
    }
    void this.revealHierarchySelf();
    if (revealMethod) {
      const info = this.selectorsFor(revealMethod.isMeta, ALL_METHODS_CATEGORY).find(
        (i) => i.selector === revealMethod.selector,
      );
      if (info) {
        try {
          await this.views?.method.reveal(
            new MethodItem(revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
            { select: true, focus: false, expand: true },
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  // A session abort discards uncommitted changes and refreshes the session's
  // view of the repository, so the Explorer's cached listing can be stale.
  // Reload in place (keeping the selection) when it's OUR current session.
  onSessionAborted(sessionId: number): void {
    const session = this.session();
    if (!session || session.id !== sessionId) return;
    // Reload in place but DON'T reveal — the abort was pressed from another view,
    // so the Explorer must not jump to the foreground.
    void this.refreshRetainingSelection({ reveal: false });
  }

  selectDict(item: DictItem): void {
    this.state.dictName = item.dictName;
    this.state.dictIndex = item.dictIndex;
    this.state.classCategory = undefined;
    this.state.className = undefined;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.newClassCategories.clear();
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS);
    const session = this.session();
    this.classCategoryEntries = session
      ? queries.getClassesWithCategory(session, item.dictIndex)
      : [];
    this.loadDefinedIvarCounts();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  selectClassCategory(item: ClassCategoryItem): void {
    this.state.classCategory = item.fullPath;
    this.state.className = undefined;
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.clearFilters(VIEW_CLASSES, VIEW_METHODS);
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // Record which side / method-category the user last touched in the Methods
  // pane, so New Method and New Method Category default to the right place.
  recordMethodContext(isMeta: boolean, category?: string): void {
    this.state.selectedIsMeta = isMeta;
    this.state.selectedMethodCategory = category;
  }

  // Reload the current class's method/environment data (the source the Methods
  // pane renders from) and refresh the affected panes. Called after a change that
  // alters the visible class's selectors — e.g. a method rename — so the method
  // list, override arrows, and class list reflect it without reselecting the class.
  reloadCurrentClassMethods(): void {
    const session = this.session();
    this.envLines =
      session && this.state.dictIndex !== undefined && this.state.className !== undefined
        ? queries.getClassEnvironments(
            session,
            this.state.dictIndex,
            this.state.className,
            this.maxEnv(),
          )
        : [];
    this.methodProvider.refresh();
    this.hierarchyProvider.refresh();
    this.classProvider.refresh();
  }

  // After a method rename, bring already-open editors on the affected methods up
  // to date: a recompiled sender is reopened on the same URI (re-reading its new
  // body), a renamed implementor is reopened on its NEW selector's URI (the old
  // one no longer exists). An editor with UNSAVED changes is left alone — we
  // never discard the user's in-progress edits. Best-effort and clean-only.
  private async refreshRenamedSelectorEditors(
    oldSelector: string,
    newSelector: string,
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    if (oldSelector === newSelector) return; // pure reorder: same selector, same URI

    for (const { tab, uri } of listOpenGemstoneTabs()) {
      if (tab.isDirty) continue; // never clobber unsaved edits

      let parsed;
      try {
        parsed = parseUri(uri);
      } catch {
        continue;
      }
      if (parsed.kind !== 'method' || parsed.sessionId !== session.id) continue;
      if (parsed.base || parsed.diffView) continue; // read-only override-diff views

      // The rename maps oldSelector → newSelector uniformly, so an editor open on
      // an implementor of the old selector should reopen on the new one (the old
      // method no longer exists). Senders keep their own selector — left as is.
      if (unescapeSelectorSlashes(parsed.selector) !== oldSelector) continue;

      const targetUri = buildMethodUri({
        kind: 'method',
        sessionId: parsed.sessionId,
        dictName: parsed.dictName,
        className: parsed.className,
        isMeta: parsed.isMeta,
        category: parsed.category,
        selector: escapeSelectorSlashes(newSelector),
        environmentId: parsed.environmentId,
        dictIndex: parsed.dictIndex,
      });
      const viewColumn = tab.group.viewColumn;
      try {
        await vscode.window.tabGroups.close(tab);
        await vscode.window.showTextDocument(targetUri, { viewColumn, preview: false });
      } catch {
        // Best-effort: a failed reopen just leaves the tab closed.
      }
    }
  }

  // After a push moves a method OUT of its source class, an editor still open on the
  // source method is stale — the method no longer resolves there — and, via syncToEditor
  // (onDidChangeActiveTextEditor), it drags the navigator back to the source, clobbering
  // the reveal of the method in its NEW home. Close such editors (non-dirty only), but only
  // for selectors the source no longer defines: a partial push-down can leave the source
  // method in place, and that editor is still valid.
  private async closeStaleSourceMethodEditors(
    session: ActiveSession,
    dictName: string,
    sourceClass: string,
    selectors: string[],
    isMeta: boolean,
  ): Promise<void> {
    for (const { tab, uri } of listOpenGemstoneTabs()) {
      if (tab.isDirty) continue;
      let parsed;
      try {
        parsed = parseUri(uri);
      } catch {
        continue;
      }
      if (parsed.kind !== 'method' || parsed.sessionId !== session.id) continue;
      if (parsed.base || parsed.diffView) continue;
      if (parsed.className !== sourceClass || parsed.dictName !== dictName) continue;
      if (parsed.isMeta !== isMeta) continue;
      const sel = unescapeSelectorSlashes(parsed.selector);
      if (!selectors.includes(sel)) continue;
      if (this.classStillDefines(session, sourceClass, sel, isMeta)) continue;
      try {
        await vscode.window.tabGroups.close(tab);
      } catch {
        /* best-effort: a failed close just leaves the (now stale) tab open */
      }
    }
  }

  // True when className still defines selector on the given side (its OWN method), used to
  // decide whether a source-method editor is stale after a push. On any query error, assume
  // it is still defined (do not close the editor).
  private classStillDefines(
    session: ActiveSession,
    className: string,
    selector: string,
    isMeta: boolean,
  ): boolean {
    const behavior = isMeta ? `${className} class` : className;
    try {
      return (
        queries
          .executeFetchString(
            session,
            `((${behavior} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil) printString`,
          )
          .trim() === 'true'
      );
    } catch {
      return true;
    }
  }

  selectClass(item: ClassItem): void {
    this.state.className = item.className;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(VIEW_METHODS);
    const session = this.session();
    this.envLines =
      session && this.state.dictIndex !== undefined
        ? queries.getClassEnvironments(session, this.state.dictIndex, item.className, this.maxEnv())
        : [];
    this.loadHierarchy();
    this.methodProvider.refresh();
    this.hierarchyProvider.refresh();
    void this.revealHierarchySelf();
    this.syncTitles();
    // NOTE: a plain class click no longer auto-opens the definition editor —
    // that cluttered the editor area with a definition tab per class browsed.
    // Use the inline "Open Definition" button (gemstone.explorer.openDefinition).
  }

  // Resolve a class's dictionary (name + 1-based index). Prefers the given dict
  // name; falls back to a full class-name lookup when it's blank/unresolvable.
  private resolveClassDict(
    className: string,
    dictName?: string,
  ): { dictName: string; dictIndex: number } | undefined {
    const session = this.session();
    if (!session) return undefined;
    if (dictName) {
      const index = queries.getDictionaryNames(session).indexOf(dictName) + 1;
      if (index > 0) return { dictName, dictIndex: index };
    }
    const match = queries.getAllClassNames(session).find((e) => e.className === className);
    return match ? { dictName: match.dictName, dictIndex: match.dictIndex } : undefined;
  }

  // Open a class's (editable, compilable) definition editor. `item` comes from
  // the inline button (which doesn't change tree selection); falls back to the
  // currently-selected class for Find Class / new-class flows. `toSide` pins it
  // in the neighbouring editor group so several definitions can be compared.
  async openClassDefinition(item?: ClassItem, toSide = false): Promise<void> {
    const className = item?.className ?? this.state.className;
    if (
      this.state.dictName === undefined ||
      className === undefined ||
      this.state.dictIndex === undefined
    ) {
      return;
    }
    await this.openDefinitionFor(className, this.state.dictName, this.state.dictIndex, toSide);
  }

  // Generate an editable Grail `.py` stub for a class. Invoked from the Classes-
  // and Hierarchy-pane context menus (with a tree item) or the Command Palette
  // (no item — falls back to the current selection, then a class picker).
  async generateGrailStub(item?: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) {
      void vscode.window.showWarningMessage('No active GemStone session.');
      return;
    }

    let className: string | undefined;
    let dictName: string | undefined;
    let dictIndex: number | undefined;
    if (item instanceof ClassItem) {
      className = item.className;
      dictName = this.state.dictName;
      dictIndex = this.state.dictIndex;
    } else if (item instanceof HierarchyItem) {
      className = item.className;
      const resolved = this.resolveClassDict(item.className, item.dictName);
      dictName = resolved?.dictName;
      dictIndex = resolved?.dictIndex;
    } else if (this.state.className) {
      className = this.state.className;
      dictName = this.state.dictName;
      dictIndex = this.state.dictIndex;
    }

    if (!className) {
      const entry = await this.pickClass(session);
      if (!entry) return;
      ({ className, dictName, dictIndex } = entry);
    }
    if (!dictName || dictIndex === undefined) {
      const resolved = this.resolveClassDict(className, dictName);
      if (!resolved) {
        void vscode.window.showWarningMessage(`Can't locate class ${className}.`);
        return;
      }
      ({ dictName, dictIndex } = resolved);
    }

    await generateAndSaveGrailStub(session, className, dictName, dictIndex);
  }

  // Prompt for a class across the whole symbolList (Command Palette entry point).
  private async pickClass(
    session: ActiveSession,
  ): Promise<{ className: string; dictName: string; dictIndex: number } | undefined> {
    const classes = queries.getAllClassNames(session);
    if (classes.length === 0) {
      void vscode.window.showInformationMessage('No classes found in this session.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      classes.map((c) => ({ label: c.className, description: c.dictName, entry: c })),
      { placeHolder: 'Select a class to generate a Grail .py stub for', matchOnDescription: true },
    );
    return picked
      ? {
          className: picked.entry.className,
          dictName: picked.entry.dictName,
          dictIndex: picked.entry.dictIndex,
        }
      : undefined;
  }

  // Open the definition of a class shown in the Hierarchy pane (which may live
  // in a different dictionary than the one currently browsed). Opens to the side
  // like the Classes-pane button, without changing the navigator selection.
  async openHierarchyDefinition(item: HierarchyItem): Promise<void> {
    const resolved = this.resolveClassDict(item.className, item.dictName);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Can't locate class ${item.className}.`);
      return;
    }
    await this.openDefinitionFor(item.className, resolved.dictName, resolved.dictIndex, true);
  }

  private async openDefinitionFor(
    className: string,
    dictName: string,
    dictIndex: number,
    toSide: boolean,
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    const uri = buildClassDefinitionUri(session.id, dictName, className, dictIndex);
    this.selfOpenedUri = uri.toString();
    const doc = await vscode.workspace.openTextDocument(uri);
    await openGemstoneDocument(doc, toSide, this.placement);
  }

  // Manual double-click detection for the Classes pane: VS Code trees have no
  // double-click event, so a class row's `command` (fired on each click) records
  // the click; two on the same class within the threshold open its definition.
  private readonly classClicks = new DoubleClickDetector(500);
  handleClassClick(className: string): void {
    if (this.classClicks.register(className)) {
      void this.openClassDefinition(new ClassItem(className));
    }
  }

  // ── Hierarchy pane ──────────────────────────────────────────────────────────

  // Fetch the selected class's superclass chain + immediate subclasses.
  private loadHierarchy(): void {
    const session = this.session();
    if (!session || this.state.className === undefined) {
      this.hierChain = [];
      this.hierSubs = [];
      return;
    }
    let entries: queries.ClassHierarchyEntry[];
    try {
      entries = queries.getClassHierarchy(session, this.state.className);
    } catch {
      this.hierChain = [];
      this.hierSubs = [];
      return;
    }
    const supers = entries.filter((e) => e.kind === 'superclass');
    const self = entries.find((e) => e.kind === 'self');
    // chain = superclasses (root-first) then the class itself (last element).
    this.hierChain = self ? [...supers, self] : supers;
    this.hierSubs = entries.filter((e) => e.kind === 'subclass');
  }

  // Children of a hierarchy node (for HierarchyProvider): the chain nests as a
  // single branch (each ancestor's only child is the next), and the class itself
  // parents its subclasses.
  hierarchyChildren(element?: HierarchyItem): HierarchyItem[] {
    if (this.hierChain.length === 0) return [];
    const lastIdx = this.hierChain.length - 1;
    const chainItem = (i: number): HierarchyItem => {
      const e = this.hierChain[i];
      const isSelf = i === lastIdx;
      const hasChildren = !isSelf || this.hierSubs.length > 0;
      return new HierarchyItem(
        e.className,
        e.dictName,
        isSelf ? 'self' : 'ancestor',
        i,
        hasChildren,
        this.classVersion(e.className),
      );
    };
    if (!element) return [chainItem(0)];
    if (element.role === 'subclass') return [];
    if (element.chainIndex < lastIdx) return [chainItem(element.chainIndex + 1)];
    // element is the current class → list its subclasses.
    return this.hierSubs.map(
      (s) =>
        new HierarchyItem(
          s.className,
          s.dictName,
          'subclass',
          -1,
          false,
          this.classVersion(s.className),
        ),
    );
  }

  // Select the current class's node in the Hierarchy pane so its selection stays
  // in sync with the Classes pane.
  async revealHierarchySelf(): Promise<void> {
    if (this.hierChain.length === 0) return;
    const lastIdx = this.hierChain.length - 1;
    const e = this.hierChain[lastIdx];
    const self = new HierarchyItem(
      e.className,
      e.dictName,
      'self',
      lastIdx,
      this.hierSubs.length > 0,
    );
    try {
      await this.views?.hierarchy.reveal(self, { select: true, focus: false });
    } catch {
      /* ignore */
    }
  }

  hierarchyParent(element: HierarchyItem): HierarchyItem | undefined {
    if (element.role === 'subclass') {
      const selfIdx = this.hierChain.length - 1;
      if (selfIdx < 0) return undefined;
      const e = this.hierChain[selfIdx];
      return new HierarchyItem(e.className, e.dictName, 'self', selfIdx, true);
    }
    if (element.chainIndex <= 0) return undefined;
    const i = element.chainIndex - 1;
    const e = this.hierChain[i];
    return new HierarchyItem(e.className, e.dictName, 'ancestor', i, true);
  }

  // Clicking a hierarchy node navigates to that class (which reloads the
  // hierarchy centered on it, plus the methods and the other panes).
  selectHierarchyNode(item: HierarchyItem): void {
    if (item.role === 'self') return; // already the current class
    // The hierarchy query supplies a dict name, but it can be blank (a class
    // reachable only in another symbol-list scope); the resolver falls back to a
    // full class-name lookup so nodes like Object always navigate.
    const resolved = this.resolveClassDict(item.className, item.dictName);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Can't locate class ${item.className}.`);
      return;
    }
    void this.revealClass(resolved.dictName, resolved.dictIndex, item.className);
  }

  // All distinct category paths in the current dictionary (incl. just-created).
  private allCategoryPaths(): string[] {
    const set = new Set(
      this.classCategoryEntries.map((e) => e.category).filter((c) => c && c.length),
    );
    for (const c of this.newClassCategories) set.add(c);
    return [...set];
  }

  // When the category pane is filtered, it drops the tree and shows a flat list
  // of matching full category paths (mirrors the Methods pane's filter mode).
  categoryFilterActive(): boolean {
    return this.getFilter(VIEW_CATEGORIES) !== undefined;
  }
  filteredCategoryPaths(): string[] {
    return this.applyFilter(
      this.allCategoryPaths().sort((a, b) => a.localeCompare(b)),
      VIEW_CATEGORIES,
    );
  }

  // Direct child category-nodes under `parentPath` (undefined = top level),
  // built from the '-' segments of every category path (see explorerCategories).
  categoryChildren(
    parentPath?: string,
  ): { segment: string; fullPath: string; hasChildren: boolean }[] {
    return categoryChildNodes(this.allCategoryPaths(), parentPath);
  }

  // The parent node of a category path (for TreeView.reveal / getParent), or
  // undefined when it's a top-level segment.
  categoryParent(fullPath: string): ClassCategoryItem | undefined {
    const parent = categoryParentPath(fullPath);
    return parent ? new ClassCategoryItem(parent.segment, parent.fullPath, true) : undefined;
  }

  // Class names in the selected dictionary. When a category node is selected,
  // include the classes in that category AND all of its sub-categories (so a
  // "super" category shows everything beneath it). No selection = all classes.
  classNames(): string[] {
    const { classCategory } = this.state;
    const names = this.classCategoryEntries
      .filter((e) => categoryMatches(e.category, classCategory))
      .map((e) => e.className);
    return this.applyFilter(
      [...new Set(names)].sort((a, b) => a.localeCompare(b)),
      VIEW_CLASSES,
    );
  }

  // ── Instance-variable sub-tree (Classes pane) ────────────────────────────────

  // Reload the per-class Classes-pane row metadata for the current dictionary
  // (defined-ivar counts and version numbers, one round trip each) and drop any
  // memoized name lists. Called wherever the class listing itself is (re)loaded.
  // A failed probe leaves the maps empty rather than breaking navigation —
  // classes just render flat and untagged.
  private loadDefinedIvarCounts(): void {
    const session = this.session();
    this.definedIvarNamesCache.clear();
    this.hierNeighborsCache.clear();
    this.definedClassVarNamesCache.clear();
    if (!session || this.state.dictIndex === undefined) {
      this.definedIvarCounts = new Map();
      this.definedClassVarCounts = new Map();
      this.classVersions = new Map();
      return;
    }
    try {
      this.definedIvarCounts = queries.getDefinedInstVarCounts(session, this.state.dictIndex);
    } catch {
      this.definedIvarCounts = new Map();
    }
    try {
      this.definedClassVarCounts = queries.getDefinedClassVarCounts(session, this.state.dictIndex);
    } catch {
      this.definedClassVarCounts = new Map();
    }
    try {
      this.classVersions = queries.getClassVersions(session, this.state.dictIndex);
    } catch {
      this.classVersions = new Map();
    }
  }

  // Whether a class has locally-defined instance variables (drives the caret).
  classHasDefinedIvars(className: string): boolean {
    return (this.definedIvarCounts.get(className) ?? 0) > 0;
  }

  // Whether a class has locally-defined variables of EITHER kind — the class row
  // shows an expansion caret when it has instance OR class variables to reveal.
  classHasDefinedVars(className: string): boolean {
    return (
      this.classHasDefinedIvars(className) || (this.definedClassVarCounts.get(className) ?? 0) > 0
    );
  }

  // The class's `current/total` version tag when it has more than one version in
  // the current dictionary (so the row renders `Foo[2/3]`), or undefined for a
  // single-version class (rendered as a plain `Foo`).
  classVersion(className: string): string | undefined {
    const v = this.classVersions.get(className);
    return v ? `${v.current}/${v.total}` : undefined;
  }

  // Locally-defined instance variable names for a class, memoized per dict load.
  // {superclass, immediate subclasses} for a class, memoized. Used to gate the ▼ move-down
  // arrow (no subclasses ⇒ nowhere to move) and to pick the reveal target after a move.
  // Resolution is first-match (not dict-scoped), matching the Explorer's Hierarchy pane; under a
  // class name shadowed across dictionaries this only affects arrow visibility / reveal target —
  // the refactoring itself stays correct: the source class is resolved dict-scoped, and the engine
  // binds each chosen destination within the source's own lineage rather than by unscoped name.
  private hierNeighbors(className: string): { superclass?: string; subclasses: string[] } {
    const cached = this.hierNeighborsCache.get(className);
    if (cached) return cached;
    let neighbors: { superclass?: string; subclasses: string[] } = { subclasses: [] };
    const session = this.session();
    if (session) {
      try {
        const entries = queries.getClassHierarchy(session, className);
        const supers = entries.filter((e) => e.kind === 'superclass');
        neighbors = {
          // superclasses are root-first, so the immediate parent is the last one.
          superclass: supers.length > 0 ? supers[supers.length - 1].className : undefined,
          subclasses: entries.filter((e) => e.kind === 'subclass').map((e) => e.className),
        };
      } catch {
        /* leave empty — treated as a leaf with no superclass */
      }
    }
    this.hierNeighborsCache.set(className, neighbors);
    return neighbors;
  }

  classHasSubclasses(className: string): boolean {
    return this.hierNeighbors(className).subclasses.length > 0;
  }

  definedIvarNames(className: string): string[] {
    const cached = this.definedIvarNamesCache.get(className);
    if (cached) return cached;
    const session = this.session();
    let names: string[] = [];
    if (session) {
      try {
        names = queries.getDefinedInstVarNames(session, className, this.state.dictIndex);
      } catch {
        /* leave empty — the row simply shows no children */
      }
    }
    this.definedIvarNamesCache.set(className, names);
    return names;
  }

  // Locally-defined class variable names for a class, memoized per dict load.
  definedClassVarNames(className: string): string[] {
    const cached = this.definedClassVarNamesCache.get(className);
    if (cached) return cached;
    const session = this.session();
    let names: string[] = [];
    if (session) {
      try {
        names = queries.getDefinedClassVarNames(session, className, this.state.dictIndex);
      } catch {
        /* leave empty — the row simply shows no class-variable children */
      }
    }
    this.definedClassVarNamesCache.set(className, names);
    return names;
  }

  // Rename this instance variable across its defining class and every subclass,
  // over all symbol-list dictionaries, via the server-side refactoring engine.
  // The engine stages a non-committing change set (a recompile per affected
  // method plus the class-definition edit); we show VS Code's native refactor
  // preview so the user can uncheck any change and see per-change diffs, then
  // apply — which recompiles the kept changes in the stone (class definition
  // first) WITHOUT committing. The user commits explicitly, as everywhere else.
  async renameInstVar(item: IvarItem): Promise<void> {
    await this.renameInstVarNamed(item.className, item.ivarName, this.state.dictIndex);
  }

  // ---- Add / remove instance variable (V1) --------------------------------------
  // The engine recompiles the class (a new version), so both flows preview the
  // affected classes, surface the methods that will not recompile, and offer opt-in
  // (committing) instance migration / history deletion.

  // "+" on the instance variable-side node, or right-click on a class row: prompt for
  // a name and add it as an instance variable of that class.
  async addInstVarOnClass(className: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    const entered = await vscode.window.showInputBox({
      title: 'Add Instance Variable',
      prompt: `Add an instance variable to ${className}.`,
      placeHolder: 'newVariableName',
      validateInput: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Enter a name.';
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(t)
          ? undefined
          : 'Not a valid instance-variable name.';
      },
    });
    if (entered === undefined) return;
    const name = entered.trim();
    if (name.length === 0) return;
    const outcome = await runInstVarRefactor({
      session,
      op: 'add',
      className,
      ivarName: name,
      dict: this.state.dictIndex,
    });
    if (outcome) {
      await this.refreshAfterClassReshape(className);
      // Select the newly-added instance variable: refreshAfterClassReshape re-reveals
      // the CLASS, which would otherwise steal the selection, so re-reveal the new
      // ivar row last. Best-effort — the row (and its instance-side parent) must be in
      // the rebuilt tree, else fall back to the instance-variable side node.
      try {
        await this.views?.klass.reveal(new IvarItem(className, name), {
          select: true,
          focus: false,
        });
      } catch {
        try {
          await this.views?.klass.reveal(new VarSideItem(className, false), {
            select: true,
            focus: false,
          });
        } catch {
          /* best-effort — leave the class selected if neither row can be revealed */
        }
      }
    }
  }

  // "+" inline on the "instance" variable-side node.
  async addInstVarFromSide(item: VarSideItem): Promise<void> {
    if (item.isMeta) return; // class-variable side is out of scope
    await this.addInstVarOnClass(item.className);
  }

  // "−" inline on an instance-variable row: remove it (with the will-not-recompile
  // preview).
  async removeInstVar(item: IvarItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const outcome = await runInstVarRefactor({
      session,
      op: 'remove',
      className: item.className,
      ivarName: item.ivarName,
      dict: this.state.dictIndex,
    });
    if (outcome) await this.refreshAfterClassReshape(item.className);
  }

  // Move an instance variable up the hierarchy (▲) or down into subclasses (▼), from the ivar
  // row. Each arrow opens a picker of destination classes IN THE HIERARCHY — ancestors for ▲
  // (pick one), descendants for ▼ (pick one or more) — so the two arrows cover push-up (V2),
  // push-down to a chosen subset (V3), and move to any hierarchy class (V4). The engine
  // recompiles the affected class definitions (new versions), previews, and applies WITHOUT
  // committing. After a successful apply the class shape changed, so re-cascade the class panes.
  async moveInstVar(item: IvarItem, direction: 'up' | 'down'): Promise<void> {
    const session = this.session();
    if (!session) return;

    const targets = await this.pickInstVarMoveTargets(session, item, direction);
    if (!targets || targets.length === 0) return;

    const applied = await moveInstVarFlow(
      session,
      direction,
      item.className,
      item.ivarName,
      targets,
      this.state.dictIndex,
    );
    if (!applied) return;
    await this.refreshAfterClassReshape(item.className);
    // Select the moved variable on its first destination. Best-effort: reveal rejects if the
    // row isn't in the rebuilt tree, which we ignore.
    const target = targets[0];
    if (target) {
      this.views?.klass
        .reveal(new IvarItem(target, item.ivarName, this.classHasSubclasses(target)), {
          select: true,
          focus: true,
        })
        .then(undefined, () => {});
    }
  }

  // Ask the user which hierarchy class(es) to move an ivar to. ▲ lists ancestors (immediate
  // superclass first) as a single-select; ▼ lists every descendant (top-down) as a multi-select.
  // Answers the chosen destination class names, or undefined when there is nowhere to move or the
  // user cancels.
  private async pickInstVarMoveTargets(
    session: ActiveSession,
    item: IvarItem,
    direction: 'up' | 'down',
  ): Promise<string[] | undefined> {
    if (direction === 'up') {
      // superclass entries are root-first; reverse so the immediate superclass leads the list.
      // Dict-scoped like the down path so a shadowed class name offers the right lineage.
      const ancestors = queries
        .getClassHierarchy(session, item.className, this.state.dictIndex)
        .filter((e) => e.kind === 'superclass')
        .map((e) => e.className)
        .reverse();
      if (ancestors.length === 0) {
        void vscode.window.showInformationMessage(
          `${item.className} has no superclass to move '${item.ivarName}' up to.`,
        );
        return undefined;
      }
      const chosen = await vscode.window.showQuickPick(
        ancestors.map((name, i) => ({
          label: name,
          description: i === 0 ? 'immediate superclass' : 'ancestor',
        })),
        {
          title: `Move '${item.ivarName}' up — choose the destination superclass`,
          placeHolder: 'Pick one ancestor class',
        },
      );
      return chosen ? [chosen.label] : undefined;
    }

    const descendants = queries.getClassDescendantNames(
      session,
      item.className,
      this.state.dictIndex,
    );
    if (descendants.length === 0) {
      void vscode.window.showInformationMessage(
        `${item.className} has no subclasses to move '${item.ivarName}' down to.`,
      );
      return undefined;
    }
    const chosen = await vscode.window.showQuickPick(
      descendants.map((d) => ({
        label: d.className,
        description: d.parentName ? `subclass of ${d.parentName}` : undefined,
      })),
      {
        title: `Move '${item.ivarName}' down — choose destination subclass(es)`,
        placeHolder: 'Pick one or more subclasses',
        canPickMany: true,
      },
    );
    return chosen && chosen.length > 0 ? chosen.map((c) => c.label) : undefined;
  }

  // The rename-instance-variable flow, addressed by NAME rather than a tree row so
  // both entry points share it: the Explorer's ivar-row pencil (above) and the
  // source editor's Refactor… code action (renameInstVarAtCursorCommand). Answers
  // true when the rename was APPLIED (so an editor-triggered caller knows to
  // reload the method source), false on any cancel/decline path.
  async renameInstVarNamed(
    className: string,
    ivarName: string,
    dict: number | string | undefined,
  ): Promise<boolean> {
    const session = this.session();
    if (!session) return false;

    // The engine ships as an optional, separately-installed payload (bundled with
    // the Enhanced Inspector). When it isn't loaded, offer to install the optional
    // GemStone support; the install relatches the probe, so re-read it and only
    // continue if the engine is now present.
    if (!session.rbSupportAvailable) {
      const LOAD = 'Install GemStone Support…';
      const choice = await vscode.window.showInformationMessage(
        'Renaming instance variables needs the GemStone refactoring engine, which ' +
          "isn't loaded in this stone yet.",
        LOAD,
      );
      if (choice !== LOAD) return false;
      await vscode.commands.executeCommand('gemstone.installServerSupport');
      if (!this.session()?.rbSupportAvailable) return false;
    }

    const oldName = ivarName;
    const entered = await vscode.window.showInputBox({
      title: 'Rename Instance Variable',
      prompt: `Rename '${oldName}' in ${className} (and its subclasses).`,
      value: oldName,
      valueSelection: [0, oldName.length],
      validateInput: (v) => validateNewIvarName(v, oldName),
    });
    if (entered === undefined) return false;
    const newName = entered.trim();
    if (newName === oldName) return false;

    let json: string;
    try {
      json = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Previewing rename of '${oldName}'…`,
          cancellable: false,
        },
        () =>
          Promise.resolve(queries.previewRenameInstVar(session, className, oldName, newName, dict)),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
      return false;
    }

    let changes: RenameChange[];
    try {
      changes = parseRenameChanges(json);
    } catch {
      const detail = json.length > 200 ? `${json.slice(0, 200)}…` : json;
      void vscode.window.showErrorMessage(`Rename preview failed: ${detail}`);
      return false;
    }

    if (changes.length === 0) {
      void vscode.window.showInformationMessage(
        `No references to '${oldName}' were found in ${className} or its ` +
          'subclasses; nothing to rename.',
      );
      return false;
    }

    // Preview in the custom panel (all changes pre-checked, before/after diffs);
    // the user unchecks any they don't want and hits Apply.
    const ordered = orderChangesClassDefFirst(changes);
    const selectedIds = await showRenameInstVarPanel(oldName, newName, ordered);
    if (!selectedIds || selectedIds.length === 0) return false;

    await this.applyRename(session, ordered, selectedIds, oldName, newName);
    return true;
  }

  // Recompile the selected changes in the stone: the class-definition edit first
  // (so methods recompile against the new class shape), then each method under
  // its own category. Everything compiles in the stone but NOTHING is committed —
  // the user commits explicitly, as everywhere else in Jasper.
  private async applyRename(
    session: ActiveSession,
    ordered: RenameChange[],
    selectedIds: string[],
    oldName: string,
    newName: string,
  ): Promise<void> {
    // Ordering (class definition first), dictionary-index resolution, and the
    // category default are computed as a pure plan so those rules are unit-tested
    // directly; here we just execute each step with no commit.
    const steps = planRenameApply(
      ordered,
      selectedIds,
      queries.getDictionaryNames(session),
      this.state.dictName,
    );
    const failures: string[] = [];
    let applied = 0;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Applying rename '${oldName}' → '${newName}'…`,
        cancellable: false,
      },
      async () => {
        for (const step of steps) {
          try {
            if (step.kind === 'classDefinitionEdit') {
              queries.compileClassDefinition(session, step.newSource);
            } else {
              queries.compileMethod(
                session,
                step.className,
                step.isMeta,
                step.category,
                step.newSource,
                0,
                step.dictIndex,
              );
            }
            applied += 1;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            failures.push(`${step.label}: ${msg}`);
          }
        }
      },
    );

    // The class was just reshaped/recompiled — reload the defined-ivar data
    // (dropping the memoized names) and refresh so the ivar sub-tree and method
    // list reflect the new name.
    this.loadDefinedIvarCounts();
    this.classProvider.refresh();
    this.methodProvider.refresh();

    if (failures.length > 0) {
      void vscode.window.showErrorMessage(
        `Rename applied ${applied} of ${steps.length} change(s); ` +
          `${failures.length} failed: ${failures[0]}` +
          (failures.length > 1 ? ` (+${failures.length - 1} more)` : ''),
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `Renamed '${oldName}' → '${newName}' (${applied} change${applied === 1 ? '' : 's'}). ` +
        'Compiled but NOT committed — commit when ready.',
    );
  }

  // Rename this method / selector across its implementors and senders, within a
  // chosen scope, via the server-side refactoring engine (R2). The user edits the
  // selector as reorderable keyword-part rows, we preview the non-committing
  // change set (a methodRename per implementor, a methodRecompile per sender), the
  // user unchecks any change, and Apply recompiles the kept changes — deleting the
  // old-selector implementors — WITHOUT committing.
  async renameMethod(item: MethodItem): Promise<void> {
    const className = this.state.className;
    if (!className) return;
    await this.renameMethodNamed(
      className,
      item.info.selector,
      item.isMeta,
      this.state.dictIndex,
      this.state.dictName,
    );
  }

  // The rename-method flow, addressed by NAME rather than a tree row so both
  // entry points share it: the Explorer's method-row pencil (above) and the
  // source editor's Refactor… code action (renameMethodAtCursorCommand). Answers
  // true when the rename was APPLIED, false on any cancel/decline path.
  async renameMethodNamed(
    className: string,
    selector: string,
    isMeta: boolean,
    dictIndex: number | undefined,
    dictName: string | undefined,
  ): Promise<boolean> {
    const session = this.session();
    if (!session) return false;

    if (!session.rbSupportAvailable) {
      const LOAD = 'Install GemStone Support…';
      const choice = await vscode.window.showInformationMessage(
        "Renaming a method needs the GemStone refactoring engine, which isn't " +
          'loaded in this stone yet.',
        LOAD,
      );
      if (choice !== LOAD) return false;
      await vscode.commands.executeCommand('gemstone.installServerSupport');
      if (!this.session()?.rbSupportAvailable) return false;
    }

    const oldSelector = selector;

    // Best-effort argument names for the editor rows (display only).
    let argNames: string[];
    try {
      const src = queries.getMethodSource(session, className, isMeta, oldSelector, 0, dictIndex);
      argNames = parseArgNames(src, oldSelector);
    } catch {
      argNames = parseArgNames('', oldSelector);
    }

    const edit = await showRenameMethodEditor({
      className,
      oldSelector,
      isMeta,
      argNames,
      dictName,
    });
    if (!edit) return false;

    const err = validateNewParts(edit.parts, oldSelector);
    if (err) {
      void vscode.window.showErrorMessage(`Rename: ${err}`);
      return false;
    }
    const newSelector = buildSelector(edit.parts);
    const permutation = permutationFromOriginalIndices(edit.originalIndices);
    const noReorder = permutation.every((v, i) => v === i + 1);
    if (newSelector === oldSelector && noReorder) return false; // nothing to do

    // A client-generated token keys this preview's server-side state (the built
    // change set stored in SessionTemps) for paging and the eventual apply.
    const token = `rmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeClear = (): void => {
      try {
        queries.clearRenameMethodPreview(session, token);
      } catch {
        /* best-effort cleanup */
      }
    };

    let start;
    try {
      // Non-blocking: shows a progress notification and keeps the UI responsive
      // while the engine builds the (possibly large) change set.
      const json = await queries.startRenameMethodPreview(
        session,
        className,
        oldSelector,
        edit.parts,
        permutation,
        edit.scope,
        token,
        PREVIEW_PAGE_BYTES,
        dictIndex,
      );
      start = parseStartPreview(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
      safeClear();
      return false;
    }

    if (start.total === 0) {
      safeClear();
      void vscode.window.showInformationMessage(
        `No implementors or senders of '${oldSelector}' were found in the chosen scope; ` +
          'nothing to rename.',
      );
      return false;
    }

    // The preview is paginated (each page bounded to fit the GCI buffer) and the
    // apply runs server-side (skipping only the deselected ids), so an arbitrarily
    // large rename previews and applies without loading every page client-side.
    const result = await showRenameMethodPanel(oldSelector, newSelector, start, {
      loadPage: async (offset) =>
        parsePage(
          await queries.pageRenameMethodPreview(session, token, offset, PREVIEW_PAGE_BYTES),
        ),
      apply: async (deselected) =>
        parseApplyResult(await queries.applyRenameMethod(session, token, deselected)),
      cleanup: safeClear,
    });
    if (!result) return false; // cancelled/closed

    // A whole-apply error (an expired preview token) answers `applied:0` with an empty
    // `failed`, so it parses cleanly. Reported before the reload below: no selector
    // changed, so there is nothing stale to refresh and nothing to abort.
    if (result.error) {
      void vscode.window.showErrorMessage(`Rename failed: ${result.error}`);
      return false;
    }

    // Selectors changed, so the current class's cached method environment is
    // stale — reload it and reopen any editor that was on the renamed selector.
    this.reloadCurrentClassMethods();
    await this.refreshRenamedSelectorEditors(oldSelector, newSelector);

    if (result.failed.length > 0) {
      const first = result.failed[0];
      void vscode.window.showErrorMessage(
        `Rename applied ${result.applied} change(s); ${result.failed.length} failed: ` +
          `${first.label}: ${first.error}` +
          (result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : ''),
      );
      return true;
    }
    void vscode.window.showInformationMessage(
      `Renamed '${oldSelector}' → '${newSelector}' (${result.applied} change` +
        `${result.applied === 1 ? '' : 's'}). Compiled but NOT committed — commit when ready.`,
    );
    return true;
  }

  // Change a method's signature — add, remove, or reorder parameters — across its
  // implementors and senders, within a chosen scope, via the server-side engine
  // (M5). Driven from the Explorer's method-row context menu; shares the flow with
  // the source-pane Refactor… entry (both call beginChangeSignature).
  async changeSignature(item: MethodItem): Promise<void> {
    const className = this.state.className;
    const session = this.session();
    if (!className || !session) return;
    await beginChangeSignature(
      {
        className,
        selector: item.info.selector,
        isMeta: item.isMeta,
        dictIndex: this.state.dictIndex,
        dictName: this.state.dictName,
      },
      { session, onApplied: (o, n) => this.refreshAfterSignatureChange(o, n) },
    );
  }

  // Push a method up to its superclass (M7) or down into its subclasses (M8), from the
  // method row's context menu. The engine resolves the target(s) and declines with a
  // clear reason when impossible (no superclass / no subclasses / precondition). After a
  // successful push, navigate to where the method landed and highlight it: the superclass
  // for push-up, the first recipient subclass for push-down. If there is nowhere to reveal
  // (or we lack the dict context), just reload the source list so the removed row vanishes.
  async pushMethod(item: MethodItem, direction: PushDirection): Promise<void> {
    const className = this.state.className;
    const session = this.session();
    if (!className || !session) return;
    const outcome = await pushMethod({
      session,
      direction,
      sourceClass: className,
      selectors: [item.info.selector],
      isMeta: item.isMeta,
      dict: this.state.dictIndex ?? this.state.dictName,
    });
    if (!outcome) return;
    const { dictName, dictIndex } = this.state;
    // The source method(s) moved away; an editor still open on the source is now stale and
    // would yank the navigator back to the source via syncToEditor, clobbering the reveal.
    // Close those (only where the source truly lost the method) BEFORE revealing.
    if (dictName !== undefined) {
      await this.closeStaleSourceMethodEditors(
        session,
        dictName,
        className,
        outcome.moved,
        item.isMeta,
      );
    }
    if (outcome.revealClass && dictName !== undefined && dictIndex !== undefined) {
      await this.revealClass(dictName, dictIndex, outcome.revealClass, {
        revealMethod: { selector: item.info.selector, isMeta: item.isMeta },
      });
      return;
    }
    // Nowhere to reveal: the source lost the method — reload its method list so the removed
    // row disappears.
    this.reloadCurrentClassMethods();
  }

  // Bring the tree and any open editors up to date after a signature change: the
  // method environment is stale (selectors changed) and an editor open on a renamed
  // implementor must reopen under its new selector. Public so BOTH entry points (the
  // Explorer method row and the source-pane Refactor… command) share it.
  async refreshAfterSignatureChange(oldSelector: string, newSelector: string): Promise<void> {
    this.reloadCurrentClassMethods();
    await this.refreshRenamedSelectorEditors(oldSelector, newSelector);
  }

  // Ensure the refactoring engine is loaded, offering to install it if not.
  // Returns true when it is (now) available. Shared by rename-class and history.
  private async ensureRbSupport(action: string): Promise<boolean> {
    const session = this.session();
    if (!session) return false;
    if (session.rbSupportAvailable) return true;
    const LOAD = 'Install GemStone Support…';
    const choice = await vscode.window.showInformationMessage(
      `${action} needs the GemStone refactoring engine, which isn't loaded in this stone yet.`,
      LOAD,
    );
    if (choice !== LOAD) return false;
    await vscode.commands.executeCommand('gemstone.installServerSupport');
    return this.session()?.rbSupportAvailable === true;
  }

  // Validate a proposed rename target: the name's format AND that it isn't already
  // bound to another global in the stone (so we reject a collision up front and let
  // the user pick another name, per Eric's UX). Returns an error string or undefined.
  private validateRenameTarget(newName: string, oldName: string): string | undefined {
    const fmt = validateNewClassName(newName, oldName);
    if (fmt) return fmt;
    const session = this.session();
    if (session && queries.globalNameInUse(session, newName)) {
      return `The name ${newName} is already in use. Choose another.`;
    }
    return undefined;
  }

  // Re-cascade the class panes onto a (renamed or reshaped) class so the Classes
  // and Hierarchy panes show the new name / version tag. When the class is in the
  // current dictionary, revealClass does the full reload+reveal; otherwise reload
  // what we can from the current view.
  private async refreshAfterClassReshape(className: string): Promise<void> {
    const session = this.session();
    const { dictName, dictIndex } = this.state;
    if (!session || dictName === undefined || dictIndex === undefined) {
      this.classProvider.refresh();
      this.hierarchyProvider.refresh();
      return;
    }
    let entries: queries.ClassCategoryEntry[];
    try {
      entries = queries.getClassesWithCategory(session, dictIndex);
    } catch {
      this.classProvider.refresh();
      this.hierarchyProvider.refresh();
      return;
    }
    if (entries.some((e) => e.className === className)) {
      await this.revealClass(dictName, dictIndex, className);
      return;
    }
    this.classCategoryEntries = entries;
    this.loadDefinedIvarCounts();
    this.loadHierarchy();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // Rename this class across the image via the server-side engine (R3): a new
  // class version under the new name (bumping the class history), methods copied
  // forward, descendants re-parented, and references rewritten — WITHOUT
  // committing. The name + reference scope are chosen in a rename-method-style
  // editor (default scope: whole system); then the (paginated, non-committing)
  // change set is previewed, any optional reference unchecked, and applied.
  // Invokable from a class row OR a hierarchy-pane class node.
  async renameClass(item: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const oldName = item.className;
    if (!(await this.ensureRbSupport('Renaming a class'))) return;

    // Renaming a kernel/system class is hazardous (pervasive references; some
    // kernel histories are deliberately size 1) — warn before proceeding.
    let isKernel = false;
    try {
      isKernel = queries.isKernelClass(session, oldName);
    } catch {
      /* if the probe fails, don't block the rename */
    }
    if (isKernel) {
      const PROCEED = 'Rename anyway';
      const choice = await vscode.window.showWarningMessage(
        `${oldName} looks like a kernel/system class. Renaming it is risky — it is referenced ` +
          'pervasively across the image and may destabilize the stone. Continue?',
        { modal: true },
        PROCEED,
      );
      if (choice !== PROCEED) return;
    }

    const edit = await showRenameClassEditor(
      { oldName, dictName: this.state.dictName },
      (newName) => this.validateRenameTarget(newName, oldName),
    );
    if (!edit) return;
    const { newName, scope, options } = edit;

    // A hierarchy node may name a class outside the current dictionary, so resolve
    // it across the whole symbol list; a class-row uses the current dictionary.
    const dictArg = item instanceof HierarchyItem ? undefined : this.state.dictIndex;

    const token = `rcp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeClear = (): void => {
      try {
        queries.clearRenameClassPreview(session, token);
      } catch {
        /* best-effort cleanup */
      }
    };

    let start;
    try {
      const json = await queries.startRenameClassPreview(
        session,
        oldName,
        newName,
        scope,
        options,
        token,
        PREVIEW_PAGE_BYTES,
        dictArg,
      );
      start = parseStartClassPreview(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
      safeClear();
      return;
    }

    if (start.total === 0) {
      safeClear();
      void vscode.window.showInformationMessage(`Nothing to rename for '${oldName}'.`);
      return;
    }

    const result = await showRenameClassPanel(
      oldName,
      newName,
      start,
      {
        recompileSubclasses: options.recompileSubclasses,
        migrateInstances: options.migrateInstances,
      },
      {
        loadPage: async (offset) =>
          parseClassPage(
            await queries.pageRenameClassPreview(session, token, offset, PREVIEW_PAGE_BYTES),
          ),
        apply: async (deselected) =>
          parseClassApplyResult(await queries.applyRenameClass(session, token, deselected)),
        cleanup: safeClear,
      },
    );
    if (!result) return;

    // A whole-apply error (an expired preview token) answers `applied:0` with an empty
    // `failed`, so it parses cleanly. Reported before the re-cascade below: the class was
    // never reshaped, so there is nothing to refresh and nothing to abort.
    if (result.error) {
      void vscode.window.showErrorMessage(`Rename failed: ${result.error}`);
      return;
    }

    // The class was reshaped/rebound — re-cascade so both panes show the new name
    // and version tag.
    await this.refreshAfterClassReshape(newName);

    if (result.failed.length > 0) {
      const first = result.failed[0];
      void vscode.window.showErrorMessage(
        `Rename applied ${result.applied} change(s); ${result.failed.length} failed: ` +
          `${first.label}: ${first.error}` +
          (result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : ''),
      );
      return;
    }
    const migrateNote =
      result.migratedFailures && result.migratedFailures > 0
        ? ` (${result.migratedFailures} instance(s) could not be migrated)`
        : '';
    const commitNote = result.committed
      ? `Migrated and COMMITTED${migrateNote}.`
      : 'Compiled but NOT committed — commit when ready.';
    void vscode.window.showInformationMessage(
      `Renamed class '${oldName}' → '${newName}' (${result.applied} change` +
        `${result.applied === 1 ? '' : 's'}). ${commitNote}`,
    );
  }

  // Rename this class variable across its defining class and every subclass — both
  // the instance and class side — via the server-side engine (R4). The apply is
  // value-preserving (the shared class-variable VALUE carries across) and
  // all-or-nothing: every reference is rewritten (no per-change deselection), so a
  // method is never left naming a removed variable. Nothing is committed.
  async renameClassVariable(item: ClassVarItem): Promise<void> {
    await this.renameClassVarNamed(item.className, item.classVarName, this.state.dictIndex);
  }

  // The rename-class-variable flow, addressed by NAME rather than a tree row so
  // both entry points share it: the Explorer's class-var-row pencil (above) and
  // the source editor's Refactor… code action (renameClassVarAtCursorCommand).
  // Answers true when the rename was APPLIED (so an editor-triggered caller knows
  // to reload the method source), false on any cancel/decline path.
  async renameClassVarNamed(
    className: string,
    classVarName: string,
    dict: number | string | undefined,
  ): Promise<boolean> {
    const session = this.session();
    if (!session) return false;
    if (!(await this.ensureRbSupport('Renaming a class variable'))) return false;

    const oldName = classVarName;
    // Re-select the class-variable row the rename started from. Opening the input
    // box or the preview webview moves focus off the tree, so on any cancel/no-op
    // exit we put focus back on the original row (otherwise the row is left
    // unfocused — inconsistently, since only the webview steals focus). Best-effort.
    const reselect = (): void => {
      const views = this.views;
      if (views)
        views.klass
          .reveal(new ClassVarItem(className, oldName), { select: true, focus: true })
          .then(undefined, () => {});
    };

    const entered = await vscode.window.showInputBox({
      title: 'Rename Class Variable',
      prompt: `Rename '${oldName}' in ${className} (and its subclasses).`,
      value: oldName,
      valueSelection: [0, oldName.length],
      validateInput: (v) => validateNewClassVarName(v, oldName),
    });
    if (entered === undefined) {
      reselect();
      return false;
    }
    const newName = entered.trim();
    if (newName === oldName) {
      reselect();
      return false;
    }

    const token = `rcvp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeClear = (): void => {
      try {
        queries.clearRenameClassVarPreview(session, token);
      } catch {
        /* best-effort cleanup */
      }
    };

    let start;
    try {
      const json = await queries.startRenameClassVarPreview(
        session,
        className,
        oldName,
        newName,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      );
      start = parseStartClassVarPreview(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
      safeClear();
      reselect();
      return false;
    }

    if (start.total === 0) {
      safeClear();
      void vscode.window.showInformationMessage(
        `No references to '${oldName}' were found in ${className} or its subclasses; ` +
          'nothing to rename.',
      );
      reselect();
      return false;
    }

    const result = await showRenameClassVarPanel(oldName, newName, start, {
      loadPage: async (offset) =>
        parseClassVarPage(
          await queries.pageRenameClassVarPreview(session, token, offset, PREVIEW_PAGE_BYTES),
        ),
      // All-or-nothing: the query ignores deselection, so we don't thread it.
      apply: async () =>
        parseClassVarApplyResult(await queries.applyRenameClassVar(session, token)),
      cleanup: safeClear,
    });
    if (!result) {
      reselect();
      return false;
    }

    // A whole-apply error (an expired preview token) answers `applied:0` with an empty
    // `failed`, so it parses cleanly. Reported before the re-cascade below: nothing was
    // renamed, so there is nothing to refresh and nothing to abort.
    if (result.error) {
      void vscode.window.showErrorMessage(`Rename failed: ${result.error}`);
      reselect();
      return false;
    }

    // The class variable and any referencing methods changed (the class name and
    // its [n] version tag do NOT — a class-variable change makes no new version).
    await this.refreshAfterClassReshape(className);
    // Keep the (now-renamed) class variable selected: refreshAfterClassReshape
    // re-reveals the CLASS, which would otherwise steal the selection, so re-reveal
    // the renamed class-variable row last. Best-effort — the row must be in the
    // rebuilt tree (same dictionary), else this is a no-op.
    try {
      await this.views?.klass.reveal(new ClassVarItem(className, newName), {
        select: true,
        focus: false,
      });
    } catch {
      // The renamed leaf resolves through two getParent hops (class → class-side →
      // row); if it can't be revealed, fall back to selecting the "class" side node
      // so focus at least lands near the renamed variable.
      try {
        await this.views?.klass.reveal(new VarSideItem(className, true), {
          select: true,
          focus: false,
        });
      } catch {
        /* best-effort — leave the class selected if neither row can be revealed */
      }
    }

    if (result.failed.length > 0) {
      const first = result.failed[0];
      void vscode.window.showErrorMessage(
        `Rename applied ${result.applied} change(s); ${result.failed.length} failed: ` +
          `${first.label}: ${first.error}` +
          (result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : ''),
      );
      return true;
    }
    void vscode.window.showInformationMessage(
      `Renamed class variable '${oldName}' → '${newName}' (${result.applied} change` +
        `${result.applied === 1 ? '' : 's'}). Compiled but NOT committed — commit when ready.`,
    );
    return true;
  }

  // Open the (read-only, this-stone-only) class-definition history viewer for a
  // class: every version with its timestamp, the name it had then, its oop, and
  // the methods that changed. Offers a redo — restore a prior version as a new
  // version (no commit). Invokable from a class row OR a hierarchy-pane class node.
  async classHistory(item: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const className = item.className;
    if (!(await this.ensureRbSupport('Viewing class history'))) return;

    let versions;
    try {
      versions = parseClassHistory(queries.getClassHistory(session, className));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Class history failed: ${msg}`);
      return;
    }
    if (versions.length === 0) {
      void vscode.window.showInformationMessage(`No definition history for ${className}.`);
      return;
    }

    // Restoring across a rename renames the class back, so the current name can
    // change between restores; track it so the follow-up history fetch, the tree
    // refresh, and a second restore all target the right (current) name.
    let currentName = className;
    showClassHistoryPanel(className, versions, {
      restore: async (index) => {
        const result = parseRevertResult(queries.revertClassToVersion(session, currentName, index));
        if (result.reverted && result.name) currentName = result.name;
        const refreshed = result.reverted
          ? parseClassHistory(queries.getClassHistory(session, currentName))
          : versions;
        // The class was reshaped/renamed (a new version) — re-cascade so the
        // Explorer's Classes + Hierarchy panes show the restored name and version.
        if (result.reverted) await this.refreshAfterClassReshape(currentName);
        return { result, versions: refreshed };
      },
      remove: async (index) => {
        const result = parseRemoveResult(queries.removeClassVersion(session, currentName, index));
        const refreshed = result.removed
          ? parseClassHistory(queries.getClassHistory(session, currentName))
          : versions;
        // The version count / tag changed — refresh the tree's version tags.
        if (result.removed) await this.refreshAfterClassReshape(currentName);
        return { result, versions: refreshed };
      },
    });
  }

  // Method categories for one side, with the computed ALL/SESSION rows on top,
  // plus any just-created (still empty) categories from the + button.
  methodCategories(isMeta: boolean): MethodCategoryItem[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    const real = [...new Set(lines.map((l) => l.category).filter((c) => c && c.length))];
    const fresh = [...this.newMethodCategories[isMeta ? 'meta' : 'instance']].filter(
      (c) => !real.includes(c),
    );
    const combined = [...real, ...fresh].sort((a, b) => a.localeCompare(b));
    if (lines.length === 0 && combined.length === 0) return [];
    const hasSession = lines.some(
      (l) => l.sessionMethodBits && Object.keys(l.sessionMethodBits).length > 0,
    );
    const items = [new MethodCategoryItem(isMeta, ALL_METHODS_CATEGORY, true)];
    if (hasSession) items.push(new MethodCategoryItem(isMeta, SESSION_METHODS_CATEGORY, true));
    return items.concat(combined.map((c) => new MethodCategoryItem(isMeta, c, false)));
  }

  // Selectors under a category (real or computed) with per-method metadata.
  selectorsFor(isMeta: boolean, category: string): SelectorInfo[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    const realCategory: Record<string, string> = {};
    const overrideBits: Record<string, number> = {};
    const sessionBit: Record<string, number> = {};
    for (const line of lines) {
      for (const sel of line.selectors) {
        if (line.category && !realCategory[sel]) realCategory[sel] = line.category;
        if (line.methodOverrideBits?.[sel]) overrideBits[sel] |= line.methodOverrideBits[sel];
        if (line.sessionMethodBits?.[sel]) sessionBit[sel] = line.sessionMethodBits[sel];
      }
    }

    let selectors: string[];
    if (category === ALL_METHODS_CATEGORY) {
      selectors = Object.keys(realCategory);
    } else if (category === SESSION_METHODS_CATEGORY) {
      selectors = Object.keys(sessionBit);
    } else {
      selectors = [
        ...new Set(lines.filter((l) => l.category === category).flatMap((l) => l.selectors)),
      ];
    }

    return selectors
      .sort((a, b) => a.localeCompare(b))
      .map((sel) => ({
        selector: sel,
        category: realCategory[sel] || 'as yet unclassified',
        overrideBits: overrideBits[sel] || 0,
        sessionBit: sessionBit[sel] || 0,
      }));
  }

  async openMethod(node: MethodItem, toSide = false): Promise<void> {
    const session = this.session();
    if (!session || this.state.dictName === undefined || this.state.className === undefined) {
      return;
    }
    this.state.selectedSelector = node.info.selector;
    this.syncTitles();
    // Carry the 1-based dictionary index so the method's class is resolved in the
    // right dictionary (some dictionaries — e.g. Python — hold classes whose
    // lookup is ambiguous by bare name). Slash-bearing selectors are escaped.
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: session.id,
      dictName: this.state.dictName,
      className: this.state.className,
      isMeta: node.isMeta,
      category: node.info.category,
      selector: escapeSelectorSlashes(node.info.selector),
      environmentId: 0,
      dictIndex: this.state.dictIndex,
    });
    // This open will fire onDidChangeActiveTextEditor; mark it so syncToEditor
    // doesn't then re-reveal the row under ALL METHODS and steal the selection
    // from the category the user actually clicked.
    this.selfOpenedUri = uri.toString();
    const doc = await vscode.workspace.openTextDocument(uri);
    // Single-click swaps in place (preview, focus stays in the tree so
    // type-to-filter / arrow-nav keep working); open-to-side pins a real tab in
    // a balanced neighbouring group so methods can be compared.
    await openGemstoneDocument(doc, toSide, this.placement);
  }

  // ── Find Class ────────────────────────────────────────────────────────────

  // Show a type-to-filter list of every class (the same UX as the old System
  // Browser "Find Class…"), then cascade the new panes to the chosen class:
  // select its dictionary and class-category, reveal the class row, and open its
  // definition. An explicit `name` arg (programmatic callers) skips the picker.
  async findClass(name?: string): Promise<void> {
    // Resolve rather than require a pre-selected session: if one session is
    // logged in it's chosen automatically (a bare getSelectedSession() no-ops).
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    let entries: queries.ClassNameEntry[];
    try {
      entries = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading class list…',
          cancellable: false,
        },
        () => Promise.resolve(queries.getAllClassNames(session)),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Failed to load classes: ${msg}`);
      return;
    }

    let chosen: queries.ClassNameEntry | undefined;
    if (name && name.trim()) {
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();
      chosen =
        entries.find((e) => e.className === trimmed) ??
        entries.find((e) => e.className.toLowerCase() === lower);
      if (!chosen) {
        void vscode.window.showWarningMessage(`No class matching "${trimmed}".`);
        return;
      }
    } else {
      // Live-filtered picker over all classes; description = dictionary name.
      const picked = await vscode.window.showQuickPick(
        entries.map((e) => ({ label: e.className, description: e.dictName, entry: e })),
        { placeHolder: 'Type to find a class…', matchOnDescription: true },
      );
      if (!picked) return;
      chosen = picked.entry;
    }
    await this.revealClass(chosen.dictName, chosen.dictIndex, chosen.className);
  }

  // Set the cascade state to a specific class and reveal it across the panes.
  // Never opens the class-definition editor — that's an explicit action now (the
  // class-row button / menu). `opts.revealMethod` reveals+selects a method row.
  private async revealClass(
    dictName: string,
    dictIndex: number,
    className: string,
    opts: { revealMethod?: { selector: string; isMeta: boolean } } = {},
  ): Promise<void> {
    const session = this.session();
    if (!session) return;

    // Fetch first, commit second: if a query fails (e.g. the class can't be
    // resolved in that dictionary), warn and leave the current state intact
    // rather than half-updating it — a half-update was breaking later syncs.
    let entries: queries.ClassCategoryEntry[];
    let envLines: queries.EnvCategoryLine[];
    try {
      entries = queries.getClassesWithCategory(session, dictIndex);
      envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Couldn't open ${className}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    this.state.dictName = dictName;
    this.state.dictIndex = dictIndex;
    this.classCategoryEntries = entries;
    this.loadDefinedIvarCounts();
    const catEntry = this.classCategoryEntries.find((e) => e.className === className);
    // Only pin the category pane when the class has a non-empty one; otherwise
    // leave it on "all classes" so the target row is guaranteed visible.
    this.state.classCategory = catEntry && catEntry.category ? catEntry.category : undefined;
    this.state.className = className;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.envLines = envLines;
    this.loadHierarchy();
    this.clearFilters(VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS);
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    void this.revealHierarchySelf();
    this.syncTitles();

    // reveal() rejects if the element isn't (yet) in the tree; the panes are
    // already correct from state, so treat reveal purely as a highlight nicety.
    try {
      await this.views?.dict.reveal(new DictItem(dictName, dictIndex), { select: true });
    } catch {
      /* ignore */
    }
    if (this.state.classCategory) {
      const path = this.state.classCategory;
      const segment = path.split('-').pop() ?? path;
      try {
        await this.views?.category.reveal(new ClassCategoryItem(segment, path, false), {
          select: true,
          expand: true,
        });
      } catch {
        /* ignore */
      }
    }
    const focusClass = opts.revealMethod === undefined;
    try {
      await this.views?.klass.reveal(new ClassItem(className), { select: true, focus: focusClass });
    } catch {
      /* ignore */
    }

    if (opts.revealMethod) {
      // Reveal under the always-expanded ALL METHODS node (displayCategory).
      const info = this.selectorsFor(opts.revealMethod.isMeta, ALL_METHODS_CATEGORY).find(
        (i) => i.selector === opts.revealMethod!.selector,
      );
      if (info) {
        try {
          await this.views?.method.reveal(
            new MethodItem(opts.revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
            { select: true, focus: false, expand: true },
          );
          this.syncTitles();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ── Editor → navigator sync ─────────────────────────────────────────────────

  // When a gemstone:// method/definition editor gains focus, cascade the panels
  // to its location (without reopening the editor). Ignores non-gemstone tabs,
  // template (new-*) URIs, and editors from a different session.
  async syncToEditor(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'gemstone') return;
    // We opened this editor ourselves from a tree click — the tree selection is
    // already correct, so don't bounce it (e.g. onto the ALL METHODS node).
    if (this.selfOpenedUri === uri.toString()) {
      this.selfOpenedUri = undefined;
      return;
    }
    const session = this.session();
    if (!session || String(session.id) !== uri.authority) return;

    const parts = uri.path.split('/').map((p) => decodeURIComponent(p));
    // parts: ['', dictName, className, side|'definition', category, selector...]
    const dictName = parts[1];
    const className = parts[2];
    if (!dictName || !className || className === 'new-class') return;

    let revealMethod: { selector: string; isMeta: boolean } | undefined;
    if (parts.length >= 6) {
      const selector = unescapeSelectorSlashes(parts.slice(5).join('/'));
      if (selector === 'new-method') return; // unsaved template
      revealMethod = { selector, isMeta: parts[3] === 'class' };
    } else if (parts[3] !== 'definition') {
      return; // not a recognizable method/definition URI
    }

    // Already showing this class: just (re)reveal the method row / refresh title.
    if (this.state.className === className && this.state.dictName === dictName) {
      if (revealMethod) {
        const info = this.selectorsFor(revealMethod.isMeta, ALL_METHODS_CATEGORY).find(
          (i) => i.selector === revealMethod.selector,
        );
        if (info) {
          try {
            await this.views?.method.reveal(
              new MethodItem(revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
              { select: true, focus: false, expand: true },
            );
            this.syncTitles();
          } catch {
            /* ignore */
          }
        }
      }
      return;
    }

    const dictIndex = queries.getDictionaryNames(session).indexOf(dictName) + 1;
    if (dictIndex <= 0) return;
    await this.revealClass(dictName, dictIndex, className, { revealMethod });
  }

  // ── New (+) actions ─────────────────────────────────────────────────────────

  async newDictionary(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const name = (
      await vscode.window.showInputBox({
        prompt: 'New dictionary name',
        placeHolder: 'e.g. MyProject',
      })
    )?.trim();
    if (!name) return;
    queries.addDictionary(session, name);
    this.dictProvider.refresh();
    // Select the new dictionary so its (empty) categories/classes cascade, and
    // highlight its row.
    const names = queries.getDictionaryNames(session);
    const idx = names.indexOf(name);
    if (idx >= 0) {
      const item = new DictItem(name, idx + 1);
      this.selectDict(item);
      try {
        await this.views?.dict.reveal(item, { select: true, focus: true });
      } catch {
        /* ignore */
      }
    }
  }

  async removeDictionary(node: DictItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Remove dictionary "${node.dictName}" from the symbol list?`,
      {
        modal: true,
        detail:
          'Removes it from this session’s symbol list. Classes it holds are not deleted, and ' +
          'nothing is committed until you commit the session.',
      },
      'Remove',
    );
    if (confirmed !== 'Remove') return;
    try {
      queries.removeDictionary(session, node.dictIndex);
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Could not remove "${node.dictName}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Indices have shifted and the selection may be gone; rebuild from scratch and
    // auto-select a default dictionary.
    this.reset();
    void vscode.window.setStatusBarMessage(`Removed dictionary ${node.dictName}`, 4000);
  }

  async newClassCategory(): Promise<void> {
    if (this.state.dictName === undefined) {
      void vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }
    const name = (
      await vscode.window.showInputBox({
        prompt: 'New class category name',
        placeHolder: 'e.g. Model',
      })
    )?.trim();
    if (!name) return;
    // Class categories in GemStone exist only implicitly (a class names one), so
    // hold the new name locally until a class is filed into it, then select it.
    this.newClassCategories.add(name);
    this.state.classCategory = name;
    this.state.className = undefined;
    this.envLines = [];
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
    const segment = name.split('-').pop() ?? name;
    try {
      await this.views?.category.reveal(new ClassCategoryItem(segment, name, false), {
        select: true,
        expand: true,
      });
    } catch {
      /* ignore */
    }
  }

  newClass(): void {
    const session = this.session();
    if (!session || this.state.dictName === undefined) {
      void vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }
    const category = this.state.classCategory;
    const categoryQuery = category ? `?category=${encodeURIComponent(category)}` : '';
    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(this.state.dictName)}/new-class${categoryQuery}`,
    );
    void vscode.commands.executeCommand('gemstone.openDocument', uri);
  }

  async newMethodCategory(): Promise<void> {
    if (this.state.className === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    const name = (
      await vscode.window.showInputBox({
        prompt: 'New method category name',
        placeHolder: 'e.g. accessing',
      })
    )?.trim();
    if (!name) return;
    const isMeta = this.state.selectedIsMeta ?? false;
    this.newMethodCategories[isMeta ? 'meta' : 'instance'].add(name);
    this.recordMethodContext(isMeta, name);
    this.methodProvider.refresh();
    this.syncTitles();
  }

  async newMethod(): Promise<void> {
    const session = this.session();
    if (
      !session ||
      this.state.dictName === undefined ||
      this.state.className === undefined ||
      this.state.dictIndex === undefined
    ) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    // A new-method template editor is always writable (there's no existing
    // method to permission-check), so guard restricted classes here — otherwise
    // a save into e.g. a system/kernel class silently no-ops server-side.
    let writable = true;
    try {
      writable = queries.canClassBeWritten(session, this.state.className, this.state.dictIndex);
    } catch {
      /* session busy — let the compile itself report any failure */
    }
    if (!writable) {
      void vscode.window.showWarningMessage(
        `${this.state.className} is not writable in this repository — cannot add a method.`,
      );
      return;
    }
    // Choose the side: honor the last-touched side if the user was working in the
    // Methods pane, otherwise ask so either an instance or a class method can be
    // created regardless of what's selected.
    let isMeta: boolean;
    if (this.state.selectedIsMeta !== undefined) {
      isMeta = this.state.selectedIsMeta;
    } else {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Instance method', meta: false },
          { label: 'Class method', meta: true },
        ],
        { placeHolder: `New method on ${this.state.className}` },
      );
      if (!pick) return;
      isMeta = pick.meta;
    }
    const category =
      this.state.selectedIsMeta === isMeta && this.state.selectedMethodCategory
        ? this.state.selectedMethodCategory
        : 'as yet unclassified';
    const uri = buildNewMethodUri(
      session.id,
      this.state.dictName,
      this.state.className,
      isMeta,
      category,
      0,
      this.state.dictIndex,
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
    });
    this.placement.remember(uri);
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  // Drag a method onto another category (move) or onto a class (copy). Both the
  // source method and any class drop-target live in the currently-shown
  // dictionary, so state.dictIndex scopes every lookup.

  // The method rows currently being dragged. VS Code does NOT carry a custom
  // DataTransferItem's content across DIFFERENT trees (methods → classes): the item
  // arrives with an empty string. So the DataTransfer is used only as a SIGNAL that a
  // method drag is in flight, and the actual payload is stashed here — both tree
  // drag/drop controllers share this one ExplorerController, so an in-memory hand-off
  // is reliable where serialization is not.
  private pendingMethodDrag: MethodDragPayload[] = [];

  setPendingMethodDrag(payloads: MethodDragPayload[]): void {
    this.pendingMethodDrag = payloads;
  }

  // Read AND clear the pending drag (a drag lands on exactly one drop target).
  takePendingMethodDrag(): MethodDragPayload[] {
    const p = this.pendingMethodDrag;
    this.pendingMethodDrag = [];
    return p;
  }

  dragPayload(item: MethodItem): MethodDragPayload | undefined {
    if (
      this.state.className === undefined ||
      this.state.dictName === undefined ||
      this.state.dictIndex === undefined
    ) {
      return undefined;
    }
    return {
      selector: item.info.selector,
      isMeta: item.isMeta,
      category: item.info.category,
      className: this.state.className,
      dictName: this.state.dictName,
      dictIndex: this.state.dictIndex,
    };
  }

  // Drop on a method category → recategorize each dragged method there.
  async dragMoveToCategory(payloads: MethodDragPayload[], category: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    const toMove = payloads.filter((p) => p.category !== category);
    if (toMove.length === 0) return;
    try {
      for (const p of toMove) {
        queries.recategorizeMethod(
          session,
          p.className,
          p.isMeta,
          p.selector,
          category,
          p.dictIndex,
        );
      }
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Move failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    this.reloadIfCurrent(toMove[0].className, toMove[0].dictIndex);
    void vscode.window.showInformationMessage(
      toMove.length === 1
        ? `Moved #${toMove[0].selector} to '${category}'.`
        : `Moved ${toMove.length} methods to '${category}'.`,
    );
  }

  // Drop on a class → ask whether to MOVE (relocate, remove from source, with a
  // preview) or COPY (duplicate into the target, immediate). VS Code's tree drag/drop
  // API exposes no modifier-key state, so a plain-vs-shift distinction is impossible;
  // this QuickPick is the copy/move choice a modifier would otherwise carry.
  async dragToClass(payloads: MethodDragPayload[], targetClass: string): Promise<void> {
    const fresh = payloads.filter((p) => p.className !== targetClass);
    if (fresh.length === 0) return;
    const n = fresh.length;
    const noun = n === 1 ? `#${fresh[0].selector}` : `${n} methods`;
    const MOVE = `Move here (remove from source)`;
    const COPY = `Copy here (keep original)`;
    const choice = await vscode.window.showQuickPick([MOVE, COPY], {
      title: `Drop ${noun} onto ${targetClass}`,
      placeHolder: `Move or copy ${noun} to ${targetClass}?`,
    });
    if (choice === MOVE) await this.dragMoveToClass(fresh, targetClass);
    else if (choice === COPY) await this.dragCopyToClass(fresh, targetClass);
  }

  // Relocate the dragged methods into targetClass through the move-method refactoring
  // (preview → apply, no commit). Grouped by source side so an instance→instance and a
  // class→class move each run on their own side.
  async dragMoveToClass(payloads: MethodDragPayload[], targetClass: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    // The drop target is a class row in the CURRENTLY-shown dictionary.
    await this.runMoveToClass(
      session,
      payloads.filter((p) => p.className !== targetClass),
      targetClass,
      this.state.dictName,
      this.state.dictIndex,
      false,
    );
  }

  // Run the move for the selected rows, grouped by source side (so a mixed
  // instance/class selection each moves on its own side), then reveal the first moved
  // method in its NEW class so the result is visible (otherwise a move looks like
  // "nothing happened"). `flipSide` moves to the OTHER side of the SAME class.
  private async runMoveToClass(
    session: ActiveSession,
    payloads: MethodDragPayload[],
    targetClass: string,
    targetDictName: string | undefined,
    targetDictIndex: number | undefined,
    flipSide: boolean,
  ): Promise<void> {
    if (payloads.length === 0) return;
    let reveal: { selector: string; isMeta: boolean } | undefined;
    for (const isMeta of [false, true]) {
      const group = payloads.filter((p) => p.isMeta === isMeta);
      if (group.length === 0) continue;
      const outcome = await moveMethod({
        session,
        sourceClass: group[0].className,
        selectors: group.map((p) => p.selector),
        isMeta,
        targetName: flipSide ? group[0].className : targetClass,
        toMeta: flipSide ? !isMeta : isMeta,
        dict: group[0].dictIndex,
      });
      if (outcome && outcome.moved.length > 0 && !reveal) {
        reveal = { selector: outcome.moved[0], isMeta: outcome.toMeta };
      }
    }
    if (reveal && targetDictName !== undefined && targetDictIndex !== undefined) {
      await this.revealClass(targetDictName, targetDictIndex, targetClass, {
        revealMethod: reveal,
      });
    }
  }

  // Drop on a class → copy each dragged method into it (preserving source + category).
  async dragCopyToClass(payloads: MethodDragPayload[], targetClass: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    const toCopy = payloads.filter((p) => p.className !== targetClass);
    if (toCopy.length === 0) return;
    try {
      for (const p of toCopy) {
        queries.copyMethodToClass(
          session,
          p.className,
          targetClass,
          p.isMeta,
          p.selector,
          0,
          p.dictIndex,
        );
      }
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Copy failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    this.reloadIfCurrent(targetClass, toCopy[0].dictIndex);
    void vscode.window.showInformationMessage(
      toCopy.length === 1
        ? `Copied #${toCopy[0].selector} to ${targetClass}.`
        : `Copied ${toCopy.length} methods to ${targetClass}.`,
    );
  }

  // Right-click "Move Method to Class…": pick a target from ALL classes in the image
  // (not just the visible ones — the point of Move is to relocate anywhere, including
  // classes outside the Explorer's current dictionary/category), then move + reveal.
  async moveMethodsToClassPrompt(items: MethodItem[]): Promise<void> {
    const session = this.session();
    if (!session) return;
    const payloads = this.dragPayloads(items);
    if (payloads.length === 0) return;
    const source = payloads[0].className;
    const sourceDict = payloads[0].dictIndex;

    let entries: queries.ClassNameEntry[];
    try {
      entries = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading class list…',
          cancellable: false,
        },
        () => Promise.resolve(queries.getAllClassNames(session)),
      );
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Failed to load classes: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Drop only the source class's OWN entry (a same-named class in another dictionary
    // is a legitimate, distinct target), then sort alphabetically (class name, then
    // dictionary). The picker itself prefix-filters as the user types (see
    // pickClassByPrefix) so the list reads sensibly rather than fuzzy-substring.
    const sorted = entries
      .filter((e) => !(e.className === source && e.dictIndex === sourceDict))
      .sort(
        (a, b) => a.className.localeCompare(b.className) || a.dictName.localeCompare(b.dictName),
      );
    const target = await pickClassByPrefix(
      sorted,
      `Move ${payloads.length === 1 ? `#${payloads[0].selector}` : `${payloads.length} methods`} from ${source} to…`,
    );
    if (!target) return;
    await this.runMoveToClass(
      session,
      payloads,
      target.className,
      target.dictName,
      target.dictIndex,
      false,
    );
  }

  // Right-click "Move to Class/Instance Side": relocate the selected method rows to
  // the OTHER side of their own class (instance↔class), then reveal them there.
  async moveMethodsToOtherSide(items: MethodItem[]): Promise<void> {
    const session = this.session();
    if (!session) return;
    const payloads = this.dragPayloads(items);
    if (payloads.length === 0) return;
    await this.runMoveToClass(
      session,
      payloads,
      payloads[0].className,
      this.state.dictName,
      this.state.dictIndex,
      true,
    );
  }

  // Map selected method rows to drag payloads (skipping non-method nodes).
  dragPayloads(items: readonly MethodNode[]): MethodDragPayload[] {
    const out: MethodDragPayload[] = [];
    for (const item of items) {
      if (item instanceof MethodItem) {
        const p = this.dragPayload(item);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // Reload the method list when the class just mutated is the one on screen.
  private reloadIfCurrent(className: string, dictIndex: number): void {
    const session = this.session();
    if (!session || this.state.className !== className || this.state.dictIndex !== dictIndex)
      return;
    this.envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // ── Indicator actions (▲ / ▼ / senders / implementors) ──────────────────────

  private sessionId(): number | undefined {
    return this.session()?.id;
  }

  implementorsOf(selector: string): void {
    const sessionId = this.sessionId();
    if (sessionId === undefined) return;
    void vscode.commands.executeCommand('gemstone.implementorsOfSelector', { selector, sessionId });
  }

  sendersOf(selector: string): void {
    const sessionId = this.sessionId();
    if (sessionId === undefined) return;
    void vscode.commands.executeCommand('gemstone.sendersOfSelector', { selector, sessionId });
  }

  // ▲ arrow: implementations of this selector up the superclass chain.
  // ▼ arrow: overrides of this selector down in the subclasses.
  private hierarchy(selector: string, isMeta: boolean, direction: 'up' | 'down'): void {
    const sessionId = this.sessionId();
    if (
      sessionId === undefined ||
      this.state.className === undefined ||
      this.state.dictIndex === undefined
    ) {
      return;
    }
    void vscode.commands.executeCommand('gemstone.hierarchyImplementorsOf', {
      selector,
      className: this.state.className,
      dictIndex: this.state.dictIndex,
      isMeta,
      direction,
      sessionId,
    });
  }

  superImplementors(selector: string, isMeta: boolean): void {
    this.hierarchy(selector, isMeta, 'up');
  }

  subOverrides(selector: string, isMeta: boolean): void {
    this.hierarchy(selector, isMeta, 'down');
  }

  // ── External-compile refresh ────────────────────────────────────────────────
  // The gemstone:// file-system provider fires events after a method or class is
  // compiled (Save). When it's the class we're showing, reload so the new method
  // / class appears in the panels without a manual refresh.

  onExternalMethodCompiled(sessionId: number, className: string): void {
    const session = this.session();
    if (
      !session ||
      session.id !== sessionId ||
      this.state.className !== className ||
      this.state.dictIndex === undefined
    ) {
      return;
    }
    this.envLines = queries.getClassEnvironments(
      session,
      this.state.dictIndex,
      className,
      this.maxEnv(),
    );
    this.methodProvider.refresh();
    this.syncTitles();
  }

  onExternalClassCompiled(sessionId: number, className: string): void {
    const session = this.session();
    if (!session || session.id !== sessionId || this.state.dictIndex === undefined) return;
    this.classCategoryEntries = queries.getClassesWithCategory(session, this.state.dictIndex);
    this.loadDefinedIvarCounts();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    // If the compiled class lives in the current dictionary, select it so the
    // freshly-created class is highlighted and its methods load.
    if (
      this.classCategoryEntries.some((e) => e.className === className) &&
      this.state.dictName !== undefined
    ) {
      void this.revealClass(this.state.dictName, this.state.dictIndex, className);
    } else {
      this.syncTitles();
    }
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────

abstract class RefreshableProvider<T> implements vscode.TreeDataProvider<T> {
  protected _onDidChangeTreeData = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  abstract getChildren(element?: T): T[];
  getTreeItem(element: T): vscode.TreeItem {
    return element as unknown as vscode.TreeItem;
  }
}

class DictProvider extends RefreshableProvider<DictItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  // Flat list — every row is a root. getParent is required for TreeView.reveal.
  getParent(): DictItem | undefined {
    return undefined;
  }
  getChildren(element?: DictItem): DictItem[] {
    if (element) return [];
    const session = this.ctl.session();
    if (!session) return [];
    return queries
      .getDictionaryNames(session)
      .map((name, i) => new DictItem(name, i + 1))
      .filter((d) => filterMatches(d.dictName, this.ctl.getFilter(VIEW_DICTS)));
  }
}

class CategoryProvider extends RefreshableProvider<ClassCategoryItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassCategoryItem): ClassCategoryItem | undefined {
    return this.ctl.categoryParent(element.fullPath);
  }
  getChildren(element?: ClassCategoryItem): ClassCategoryItem[] {
    if (this.ctl.state.dictName === undefined) return [];
    // While filtering, drop the tree and list matching full category paths flat.
    if (!element && this.ctl.categoryFilterActive()) {
      return this.ctl.filteredCategoryPaths().map((p) => new ClassCategoryItem(p, p, false));
    }
    return this.ctl
      .categoryChildren(element?.fullPath)
      .map((n) => new ClassCategoryItem(n.segment, n.fullPath, n.hasChildren));
  }
}

class ClassProvider extends RefreshableProvider<ClassNode> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassNode): ClassNode | undefined {
    if (element instanceof IvarItem) return new VarSideItem(element.className, false);
    if (element instanceof ClassVarItem) return new VarSideItem(element.className, true);
    if (element instanceof VarSideItem) return new ClassItem(element.className);
    return undefined;
  }
  getChildren(element?: ClassNode): ClassNode[] {
    if (this.ctl.state.dictName === undefined) return [];
    if (!element) {
      return this.ctl
        .classNames()
        .map((n) => new ClassItem(n, this.ctl.classHasDefinedVars(n), this.ctl.classVersion(n)));
    }
    // A class expands to an "instance" and/or "class" variable-side node (like the
    // Methods pane's sides), each shown only when that side has variables.
    if (element instanceof ClassItem) {
      return variableSides(
        this.ctl.definedIvarNames(element.className),
        this.ctl.definedClassVarNames(element.className),
      ).map((side) => new VarSideItem(element.className, side.isMeta));
    }
    // A side node expands to its variable rows (each with an inline rename pencil).
    if (element instanceof VarSideItem) {
      return element.isMeta
        ? this.ctl
            .definedClassVarNames(element.className)
            .map((cv) => new ClassVarItem(element.className, cv))
        : this.ctl
            .definedIvarNames(element.className)
            .map(
              (iv) =>
                new IvarItem(element.className, iv, this.ctl.classHasSubclasses(element.className)),
            );
    }
    return [];
  }
}

class HierarchyProvider extends RefreshableProvider<HierarchyItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: HierarchyItem): HierarchyItem | undefined {
    return this.ctl.hierarchyParent(element);
  }
  getChildren(element?: HierarchyItem): HierarchyItem[] {
    return this.ctl.hierarchyChildren(element);
  }
}

class MethodProvider extends RefreshableProvider<MethodNode> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  // Walk up the side ▸ category ▸ selector tree so TreeView.reveal can locate a
  // method row (used by editor-focus → navigator sync). Nodes match by their
  // stable ids, so freshly-built parents resolve to the rendered ones.
  getParent(element: MethodNode): MethodNode | undefined {
    if (element instanceof MethodItem) {
      if (element.displayCategory === undefined) return new MethodSideItem(element.isMeta);
      const computed =
        element.displayCategory === ALL_METHODS_CATEGORY ||
        element.displayCategory === SESSION_METHODS_CATEGORY;
      return new MethodCategoryItem(element.isMeta, element.displayCategory, computed);
    }
    if (element instanceof MethodCategoryItem) return new MethodSideItem(element.isMeta);
    return undefined;
  }
  getChildren(element?: MethodNode): MethodNode[] {
    if (this.ctl.state.className === undefined) return [];

    if (!element) {
      return [new MethodSideItem(false), new MethodSideItem(true)];
    }
    if (element instanceof MethodSideItem) {
      // With a filter active, drop the category grouping and show matching
      // selectors directly under each side — "everything starting with r".
      const filter = this.ctl.getFilter(VIEW_METHODS);
      if (filter) {
        return this.ctl
          .selectorsFor(element.isMeta, ALL_METHODS_CATEGORY)
          .filter((info) => filterMatches(info.selector, filter))
          .map((info) => new MethodItem(element.isMeta, info));
      }
      return this.ctl.methodCategories(element.isMeta);
    }
    if (element instanceof MethodCategoryItem) {
      return this.ctl
        .selectorsFor(element.isMeta, element.category)
        .map((info) => new MethodItem(element.isMeta, info, element.category));
    }
    return [];
  }
}

// ── Drag & drop controllers ─────────────────────────────────────────────────

// Methods pane: drag a method; drop it on another category to MOVE it there.
class MethodDragAndDrop implements vscode.TreeDragAndDropController<MethodNode> {
  readonly dragMimeTypes = [METHOD_MIME];
  readonly dropMimeTypes = [METHOD_MIME];
  constructor(private readonly ctl: ExplorerController) {}

  handleDrag(source: readonly MethodNode[], dataTransfer: vscode.DataTransfer): void {
    // Carry ALL selected method rows (multi-select is enabled on this view), so a
    // drag can move/copy several methods at once.
    const payloads = this.ctl.dragPayloads(source);
    // Stash the payload in the shared controller (survives cross-tree; a DataTransfer
    // value does not) and set the mime only as a SIGNAL so the Classes/Methods drop
    // controllers accept the drop and know it's ours.
    this.ctl.setPendingMethodDrag(payloads);
    if (payloads.length > 0) {
      dataTransfer.set(METHOD_MIME, new vscode.DataTransferItem('gemstone-method-drag'));
    }
  }

  async handleDrop(
    target: MethodNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    if (!dataTransfer.get(METHOD_MIME)) return;
    const payloads = this.ctl.takePendingMethodDrag();
    if (payloads.length === 0) return;
    // Resolve the drop's target category: a real category row, or the category
    // of the method row it landed on. Dropping on a side/computed row is ignored.
    let category: string | undefined;
    if (target instanceof MethodCategoryItem && !target.computed) category = target.category;
    else if (target instanceof MethodItem) category = target.info.category;
    if (category) await this.ctl.dragMoveToCategory(payloads, category);
  }
}

// Classes pane: accept dragged method(s) and MOVE or COPY them into the dropped-on
// class (a QuickPick asks which — the drag/drop API has no modifier-key signal).
class ClassDropController implements vscode.TreeDragAndDropController<ClassNode> {
  readonly dragMimeTypes: readonly string[] = [];
  readonly dropMimeTypes = [METHOD_MIME];
  constructor(private readonly ctl: ExplorerController) {}

  handleDrag(): void {
    /* classes aren't draggable */
  }

  async handleDrop(
    target: ClassNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    // Resolve the owning class from ANY class-pane node — the class row itself OR a
    // child (its instance/class variable-side node, an ivar/classvar row) — so a drop
    // onto an EXPANDED class (showing its variables) still lands on that class rather
    // than being silently ignored. Every ClassNode carries `className`.
    const targetClass = target?.className;
    if (!dataTransfer.get(METHOD_MIME)) return;
    const payloads = this.ctl.takePendingMethodDrag();
    if (!targetClass || payloads.length === 0) return;
    await this.ctl.dragToClass(payloads, targetClass);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

// Handle returned to the extension so it can forward file-system compile events
// (method / class Save) and session lifecycle events (abort) to the controller
// for a live panel refresh.
export interface ExplorerHandle {
  onMethodCompiled(sessionId: number, className: string): void;
  onClassCompiled(sessionId: number, className: string): void;
  onSessionAborted(sessionId: number): void;
}

export function registerGemStoneExplorer(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  // LSP-backed "full selector at this position" resolver, used by the editor-
  // triggered Rename Method to target a SENT selector under the cursor. Optional
  // so tests (and a not-yet-started LSP) degrade to renaming the edited method.
  selectorAtPosition: SelectorAtPosition = () => Promise.resolve(null),
): ExplorerHandle {
  const ctl = new ExplorerController(sessionManager);

  // The Open Editors pane (last in the container) mirrors the open gemstone://
  // source editors; it is session-independent, so it registers on its own.
  registerExplorerOpenEditors(context);

  // Gate the downstream panes (and swap the Dictionaries welcome) on whether a
  // session is available to browse.
  const syncActiveContext = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.explorerActive',
      sessionManager.getSelectedSession() !== undefined,
    );
  };
  syncActiveContext();

  const dictView = vscode.window.createTreeView('gemstoneExplorerDicts', {
    treeDataProvider: ctl.dictProvider,
  });
  const categoryView = vscode.window.createTreeView('gemstoneExplorerCategories', {
    treeDataProvider: ctl.categoryProvider,
  });
  const classView = vscode.window.createTreeView('gemstoneExplorerClasses', {
    treeDataProvider: ctl.classProvider,
    dragAndDropController: new ClassDropController(ctl),
  });
  const hierarchyView = vscode.window.createTreeView('gemstoneExplorerHierarchy', {
    treeDataProvider: ctl.hierarchyProvider,
  });
  const methodView = vscode.window.createTreeView('gemstoneExplorerMethods', {
    treeDataProvider: ctl.methodProvider,
    showCollapseAll: true,
    // Multi-select so several method rows can be dragged (move/copy) together.
    canSelectMany: true,
    dragAndDropController: new MethodDragAndDrop(ctl),
  });
  ctl.setViews({
    dict: dictView,
    category: categoryView,
    klass: classView,
    hierarchy: hierarchyView,
    method: methodView,
  });

  dictView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectDict(e.selection[0]);
  });
  categoryView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectClassCategory(e.selection[0]);
  });
  classView.onDidChangeSelection((e) => {
    // Only a class row navigates; selecting an ivar child is inert (it's acted on
    // via its inline pencil, not selection).
    const node = e.selection[0];
    if (node instanceof ClassItem) ctl.selectClass(node);
  });
  hierarchyView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectHierarchyNode(e.selection[0]);
  });
  methodView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    // Record the side / category context so New Method(-Category) default there.
    if (node instanceof MethodItem) {
      ctl.recordMethodContext(node.isMeta, node.info.category);
      void ctl.openMethod(node);
    } else if (node instanceof MethodCategoryItem) {
      ctl.recordMethodContext(node.isMeta, node.computed ? undefined : node.category);
    } else if (node instanceof MethodSideItem) {
      ctl.recordMethodContext(node.isMeta, undefined);
    }
  });

  context.subscriptions.push(
    dictView,
    categoryView,
    classView,
    hierarchyView,
    methodView,
    sessionManager.onDidChangeSelection(() => {
      syncActiveContext();
      ctl.reset();
    }),
    // The manual Refresh button reloads in place, keeping the user's selection
    // (a full reset only happens on a session switch, below).
    vscode.commands.registerCommand(
      'gemstone.explorer.refresh',
      () => void ctl.refreshRetainingSelection(),
    ),
    // Per-pane filter buttons: open a live filter input (prefix match, '*'
    // wildcard) that filters the pane in place — works regardless of where
    // focus currently sits (e.g. the editor).
    ...EXPLORER_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.filter`, () => ctl.beginFilter(viewId)),
    ),
    // Clear buttons: shown (via the gemstone.explorerFiltered.<viewId> context key)
    // only when that pane has an active filter.
    ...EXPLORER_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.clearFilter`, () => ctl.clearFilter(viewId)),
    ),
    vscode.commands.registerCommand('gemstone.explorer.openMethodToSide', (node: MethodItem) => {
      if (node instanceof MethodItem) void ctl.openMethod(node, true);
    }),
    // Ctrl/Cmd+Enter in the Methods pane: open the selected method in a new
    // source editor to the side (same as the row's ↗ button). Keybindings don't
    // pass the tree selection, so read it from the view here.
    vscode.commands.registerCommand('gemstone.explorer.openSelectedMethodToSide', () => {
      const node = methodView.selection[0];
      if (node instanceof MethodItem) void ctl.openMethod(node, true);
    }),
    // Find Class: cascade the panes to a class by name (from the Classes pane
    // title button or the command palette).
    vscode.commands.registerCommand('gemstone.explorer.findClass', (name?: string) =>
      ctl.findClass(typeof name === 'string' ? name : undefined),
    ),
    // Open a class's definition editor (inline button / menu on the class row —
    // a plain class click no longer auto-opens it; a double-click does).
    vscode.commands.registerCommand(
      'gemstone.explorer.openDefinition',
      (item?: ClassItem) =>
        void ctl.openClassDefinition(item instanceof ClassItem ? item : undefined),
    ),
    vscode.commands.registerCommand(
      'gemstone.explorer.openDefinitionToSide',
      (item?: ClassItem) =>
        void ctl.openClassDefinition(item instanceof ClassItem ? item : undefined, true),
    ),
    // Same button on a Hierarchy node — opens that class's definition to the side
    // (resolving its own dictionary), without navigating the panels.
    vscode.commands.registerCommand(
      'gemstone.explorer.openHierarchyDefinition',
      (item?: HierarchyItem) => {
        if (item instanceof HierarchyItem) void ctl.openHierarchyDefinition(item);
      },
    ),
    // Per-click hook powering double-click-to-open-definition.
    vscode.commands.registerCommand('gemstone.explorer.classClicked', (className?: string) => {
      if (typeof className === 'string') ctl.handleClassClick(className);
    }),
    // Generate a Grail (.py) stub for a class — Classes/Hierarchy menus and the
    // Command Palette all route here.
    vscode.commands.registerCommand(
      'gemstone.generateGrailStub',
      (item?: ClassItem | HierarchyItem) =>
        void ctl.generateGrailStub(
          item instanceof ClassItem || item instanceof HierarchyItem ? item : undefined,
        ),
    ),
    // Rename a locally-defined instance variable (pencil on the ivar row).
    vscode.commands.registerCommand('gemstone.explorer.renameIvar', (item?: IvarItem) => {
      if (item instanceof IvarItem) void ctl.renameInstVar(item);
    }),
    // Add / remove an instance variable (V1).
    vscode.commands.registerCommand('gemstone.explorer.addInstVar', (item?: unknown) => {
      if (item instanceof VarSideItem) void ctl.addInstVarFromSide(item);
      else if (item instanceof ClassItem) void ctl.addInstVarOnClass(item.className);
    }),
    vscode.commands.registerCommand('gemstone.explorer.removeInstVar', (item?: IvarItem) => {
      if (item instanceof IvarItem) void ctl.removeInstVar(item);
    }),
    // Move an instance variable up to a chosen ancestor (▲) — ivar row context menu.
    vscode.commands.registerCommand('gemstone.explorer.moveUpInstVar', (item?: IvarItem) => {
      if (!(item instanceof IvarItem)) return;
      void ctl.moveInstVar(item, 'up').catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Move up instance variable failed: ${msg}`);
      });
    }),
    // Move an instance variable down into chosen subclasses (▼) — ivar row context menu.
    vscode.commands.registerCommand('gemstone.explorer.moveDownInstVar', (item?: IvarItem) => {
      if (!(item instanceof IvarItem)) return;
      void ctl.moveInstVar(item, 'down').catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Move down instance variable failed: ${msg}`);
      });
    }),
    // Rename the instance variable at the cursor in a method source editor (the
    // Refactor… code action / palette) — routes into the same shared flow.
    vscode.commands.registerCommand('gemstone.renameInstVarAtCursor', (position?: unknown) => {
      void renameInstVarAtCursorCommand(
        sessionManager,
        (target) => ctl.renameInstVarNamed(target.className, target.ivarName, target.dict),
        position instanceof vscode.Position ? position : undefined,
      );
    }),
    // Rename the class variable at the cursor in a method source editor — routes
    // into the same shared flow as the Explorer's class-var-row pencil.
    vscode.commands.registerCommand('gemstone.renameClassVarAtCursor', (position?: unknown) => {
      void renameClassVarAtCursorCommand(
        sessionManager,
        (target) => ctl.renameClassVarNamed(target.className, target.classVarName, target.dict),
        position instanceof vscode.Position ? position : undefined,
      );
    }),
    // Rename the method at the cursor in a source editor: a SENT selector under
    // the cursor renames that selector; the header (or a non-send position)
    // renames the edited method. Routes into the same shared flow as the
    // Explorer's method-row pencil (which also reopens editors under the new
    // selector).
    vscode.commands.registerCommand('gemstone.renameMethodInEditor', (position?: unknown) => {
      void renameMethodAtCursorCommand(
        (target) =>
          ctl.renameMethodNamed(
            target.className,
            target.selector,
            target.isMeta,
            target.dictIndex,
            target.dictName,
          ),
        selectorAtPosition,
        position instanceof vscode.Position ? position : undefined,
      );
    }),
    // Rename a locally-defined class variable (pencil on the class-variable row).
    vscode.commands.registerCommand(
      'gemstone.explorer.renameClassVariable',
      (item?: ClassVarItem) => {
        if (item instanceof ClassVarItem) void ctl.renameClassVariable(item);
      },
    ),
    // Rename a method / selector across implementors and senders (pencil on the
    // method row).
    vscode.commands.registerCommand('gemstone.explorer.renameMethod', (item?: MethodItem) => {
      if (!(item instanceof MethodItem)) return;
      // Surface any error rather than letting a fire-and-forget rejection vanish
      // (which looked like the editor "just closing" with no preview).
      void ctl.renameMethod(item).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Rename method failed: ${msg}`);
      });
    }),
    // Move method(s) to another class (M6). Works on the focused row plus any other
    // selected method rows (multi-select), so several methods move at once.
    vscode.commands.registerCommand(
      'gemstone.explorer.moveMethodToClass',
      (item?: MethodItem, selected?: MethodItem[]) => {
        const items = methodSelection(item, selected);
        if (items.length === 0) return;
        void ctl.moveMethodsToClassPrompt(items).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Move method failed: ${msg}`);
        });
      },
    ),
    // Move method(s) to the OTHER side (instance↔class) of their own class.
    vscode.commands.registerCommand(
      'gemstone.explorer.moveMethodToOtherSide',
      (item?: MethodItem, selected?: MethodItem[]) => {
        const items = methodSelection(item, selected);
        if (items.length === 0) return;
        void ctl.moveMethodsToOtherSide(items).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Move method failed: ${msg}`);
        });
      },
    ),
    // Change a method's signature — add/remove/reorder parameters (context menu on
    // the method row).
    vscode.commands.registerCommand('gemstone.explorer.changeSignature', (item?: MethodItem) => {
      if (!(item instanceof MethodItem)) return;
      void ctl.changeSignature(item).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Change signature failed: ${msg}`);
      });
    }),
    // Push a method up to its superclass (M7) — context menu on the method row.
    vscode.commands.registerCommand('gemstone.explorer.pushUpMethod', (item?: MethodItem) => {
      if (!(item instanceof MethodItem)) return;
      void ctl.pushMethod(item, 'up').catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Push up failed: ${msg}`);
      });
    }),
    // Push a method down into its subclasses (M8) — context menu on the method row.
    vscode.commands.registerCommand('gemstone.explorer.pushDownMethod', (item?: MethodItem) => {
      if (!(item instanceof MethodItem)) return;
      void ctl.pushMethod(item, 'down').catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Push down failed: ${msg}`);
      });
    }),
    // Change the edited method's signature from a source editor (the Refactor… code
    // action / palette). Routes into the same shared flow, then reopens editors under
    // the new selector via the controller's refresh.
    vscode.commands.registerCommand('gemstone.changeMethodSignature', (position?: unknown) => {
      void changeSignatureCommand(
        sessionManager,
        (oldSelector, newSelector) => ctl.refreshAfterSignatureChange(oldSelector, newSelector),
        position instanceof vscode.Position ? position : undefined,
      );
    }),
    // Rename a class across the image (pencil on a class row OR a hierarchy node).
    vscode.commands.registerCommand(
      'gemstone.explorer.renameClass',
      (item?: ClassItem | HierarchyItem) => {
        if (!(item instanceof ClassItem) && !(item instanceof HierarchyItem)) return;
        void ctl.renameClass(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Rename class failed: ${msg}`);
        });
      },
    ),
    // Show a class's definition history (context menu on a class row or hierarchy node).
    vscode.commands.registerCommand(
      'gemstone.explorer.classHistory',
      (item?: ClassItem | HierarchyItem) => {
        if (!(item instanceof ClassItem) && !(item instanceof HierarchyItem)) return;
        void ctl.classHistory(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Class history failed: ${msg}`);
        });
      },
    ),
    vscode.commands.registerCommand('gemstone.explorer.removeDictionary', (node?: unknown) => {
      if (node instanceof DictItem) void ctl.removeDictionary(node);
    }),
    // New (+) actions, one per pane.
    vscode.commands.registerCommand('gemstone.explorer.newDictionary', () => ctl.newDictionary()),
    vscode.commands.registerCommand('gemstone.explorer.newClassCategory', () =>
      ctl.newClassCategory(),
    ),
    vscode.commands.registerCommand('gemstone.explorer.newClass', () => ctl.newClass()),
    vscode.commands.registerCommand('gemstone.explorer.newMethodCategory', () =>
      ctl.newMethodCategory(),
    ),
    vscode.commands.registerCommand('gemstone.explorer.newMethod', () => ctl.newMethod()),
    // Indicator / method actions: browse implementors, senders, and the
    // superclass (▲) / subclass (▼) implementations behind the override arrows.
    // Each accepts either the tree item (inline button / right-click) or a
    // {selector, isMeta} payload (tooltip command link).
    vscode.commands.registerCommand('gemstone.explorer.implementorsOf', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.implementorsOf(sel.selector);
    }),
    vscode.commands.registerCommand('gemstone.explorer.sendersOf', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.sendersOf(sel.selector);
    }),
    vscode.commands.registerCommand(
      'gemstone.explorer.superImplementors',
      (arg: MethodCommandArg) => {
        const sel = methodArg(arg);
        if (sel) ctl.superImplementors(sel.selector, sel.isMeta);
      },
    ),
    vscode.commands.registerCommand('gemstone.explorer.subOverrides', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.subOverrides(sel.selector, sel.isMeta);
    }),
    // Editor-focus → navigator: when a gemstone:// method/class editor gains
    // focus, cascade the panels to its location.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) void ctl.syncToEditor(editor.document.uri);
    }),
  );

  return {
    onMethodCompiled: (sessionId, className) => ctl.onExternalMethodCompiled(sessionId, className),
    onClassCompiled: (sessionId, className) => ctl.onExternalClassCompiled(sessionId, className),
    onSessionAborted: (sessionId) => ctl.onSessionAborted(sessionId),
  };
}
