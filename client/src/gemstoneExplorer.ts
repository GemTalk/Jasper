import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { ALL_METHODS_CATEGORY, SESSION_METHODS_CATEGORY } from './systemBrowser';
import {
  escapeSelectorSlashes,
  unescapeSelectorSlashes,
  buildClassDefinitionUri,
  buildClassCommentUri,
  buildNewMethodUri,
  buildMethodUri,
  parseUri,
  parseMethodUri,
  listOpenGemstoneTabs,
  tabInputUri,
} from './gemstoneFileSystemProvider';
import type { ParsedUri } from './gemstoneFileSystemProvider';
import { filterMatches } from './explorerFilter';
import {
  parseMethodFilter,
  methodMatchesFilter as matchesMethodFilter,
  ivarAccessMark as computeIvarAccessMark,
  ivarIdentifierRanges,
  MethodFilter,
} from './explorerMethodFilter';
import { DoubleClickDetector } from './explorerDoubleClick';
import { categoryChildNodes, categoryParentPath, categoryMatches } from './explorerCategories';
import { registerOpenEditorsStatusBar } from './openEditorsStatusBar';
import { SourceEditorPlacement } from './sourceEditorPlacement';
import { generateAndSaveGrailStub } from './grailStubGenerator';
import {
  RenamePreview,
  RenameApplyResult,
  parseRenamePreview,
  parseRenameApplyResult,
  orderChangesClassDefFirst,
  deselectedIdsFrom,
  deselectedLabels,
  validateNewIvarName,
} from './refactoring/renameInstVarPreview';
import { showRenameInstVarPanel } from './refactoring/renameInstVarPanel';
import { decideSafeDelete, announceSilentDelete, SafeDeleteTarget } from './refactoring/safeDelete';
import { METHOD_SEARCH_RESULT_LIMIT, dedupeMethodResults } from './queries/methodSearch';
import { formatRenameFailureLog, formatRenameFailureToast } from './refactoring/renameFailureLog';
import { getGciLog, logWarning } from './gciLog';
import { supportsServerUtf8FileIn } from './refactoring/refactoringInstall';
import { renameInstVarAtCursorCommand } from './refactoring/renameInstVarAtCursorCommand';
import { renameAtCursorCommand } from './refactoring/renameAtCursorCommand';
import { renameClassAtCursorCommand } from './refactoring/renameClassAtCursorCommand';
import { accessorSpecsFor } from './refactoring/queries/addAccessors';
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
import {
  insertSuperclassCommand,
  extractSuperclassCommand,
} from './refactoring/extractSuperclassCommand';
import { splitClassCommand } from './refactoring/splitClassCommand';
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
import {
  variableSides,
  defaultDictionaryIndex,
  matchesClassPrefix,
  categoryContains,
} from './explorerTreeHelpers';
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

// Button on a rename-failure notification; reveals the channel holding the full list.
const SHOW_RENAME_DETAILS = 'Show Details';

// Highlights the filtered instance variable(s) in an opened method source while a
// reads:/writes:/accesses: filter is active — theme-aware, styled like a search
// match. One shared type for the extension's lifetime (disposed in activation).
const ivarHighlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  borderRadius: '2px',
});

// How the Explorer should open a gemstone:// source editor:
//   - 'preview': a single-click NAVIGATION open — VS Code's own preview tab (the
//     one italic, reused tab per group that the next preview replaces; pinned and
//     permanent tabs are left alone). Focus stays in the tree so type-to-filter /
//     arrow-nav keep working.
//   - 'keep': a double-click open — the same doc re-shown as a permanent (non-
//     preview) tab, promoting the preview in place so a later single click won't
//     replace it.
//   - 'pin': the 📌 action — a pinned tab added to the group WITHOUT stealing the
//     view (the tab you were reading stays showing).
export type OpenSourceMode = 'preview' | 'keep' | 'pin';

// Open a gemstone:// source document in the editor area. All of this Explorer's
// source editors live as tabs in ONE group (see NOTES-editor-placement.md), so the
// preview tab and every pinned tab sit next to each other in one row. `placement`
// scopes this to editors this Explorer opened, so it never invades the System
// Browser's group (see sourceEditorPlacement.ts).
// Exported for unit testing the placement rules.
export async function openGemstoneDocument(
  doc: vscode.TextDocument,
  mode: OpenSourceMode,
  placement: SourceEditorPlacement,
): Promise<void> {
  const sourceColumn = placement.sourceColumn();
  const targetColumn = sourceColumn ?? vscode.ViewColumn.Active;

  if (mode !== 'pin') {
    // NAVIGATION. Let VS Code's native preview tab do the transient-tab
    // bookkeeping — one reusable preview tab per group, replaced by the next
    // preview, leaving pinned/permanent tabs alone. A single click ('preview')
    // opens that preview tab; a double click ('keep') re-shows the same doc as a
    // permanent tab, promoting the preview in place. Either way focus stays in the
    // tree. Preview being per-group means we never disturb the System Browser's
    // own group.
    await vscode.window.showTextDocument(doc, {
      viewColumn: targetColumn,
      preview: mode === 'preview',
      preserveFocus: true,
    });
    placement.remember(doc.uri);
    return;
  }

  // PIN. Bring the method into our group and pin it, WITHOUT stealing the view: note
  // what's showing, add + pin the tab, then restore what was showing so a new pin
  // just parks a background tab beside the one you're reading. Pinning the method
  // that's currently the preview simply promotes it to a pinned tab.
  const uriStr = doc.uri.toString();
  const showingTab =
    sourceColumn !== undefined
      ? vscode.window.tabGroups.all.find((g) => g.viewColumn === sourceColumn)?.activeTab
      : undefined;
  const showing = showingTab ? tabInputUri(showingTab)?.toString() : undefined;
  await vscode.window.showTextDocument(doc, {
    viewColumn: targetColumn,
    preview: false,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand('workbench.action.pinEditor');
  placement.remember(doc.uri);
  if (sourceColumn !== undefined && showing !== undefined && showing !== uriStr) {
    // Restore whatever was showing in its ORIGINAL preview/permanent state — a pin
    // action must not silently promote the preview method you were just browsing.
    await vscode.window.showTextDocument(vscode.Uri.parse(showing), {
      viewColumn: sourceColumn,
      preview: showingTab?.isPreview ?? false,
      preserveFocus: true,
    });
  }
}

// ── GemStone Explorer ───────────────────────────────────────────────────────
//
// A set of interconnected navigation panes that cascade left-to-right:
//   Dictionaries → Class Categories → Classes → Methods (side ▸ category ▸ sel)
// Selecting a method opens its source in an editor; the ↗ inline action (or
// right-click ▸ Open to the Side) opens it in a balanced editor group. A
// status-bar button tallies the open source editors and closes them all at once.
//
// The panes live in their own `gemstoneExplorer` sidebar container. All four share
// one controller that holds the cascade state, the current dictionary's
// class→category listing, and the selected class's per-method metadata
// (categories, override arrows, session-method flags).

// The method environment the Methods pane acts in. The pane collapses a class's
// selectors across every environment into ONE row per selector (see selectorsFor),
// so a row carries no environment of its own, and both opening and removing a row
// address environment 0. Named rather than written as a bare 0 so the places that
// depend on that assumption can be found together — notably the safe-delete
// self-send exclusion, which has to know WHICH method is going away.
const EXPLORER_METHOD_ENVIRONMENT = 0;

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
    hasComment = false,
  ) {
    super(
      versionTag === undefined ? className : `${className}[${versionTag}]`,
      hasIvars ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    // The displayed label may carry a `[n]` version tag, but the node's identity
    // (id, click argument, ivar sub-tree) always uses the raw class name.
    this.id = `k:${className}`;
    // `.commented` gates the comment button to classes that actually have one
    // (#387 item 11). Every other class action matches BOTH forms — see the
    // `explorerClass(\.commented)?` clauses in package.json — so the suffix only
    // ever adds a button, never removes one. Anchored there rather than a bare
    // `^explorerClass` prefix, which would also swallow `explorerClassVar`.
    this.contextValue = hasComment ? 'explorerClass.commented' : 'explorerClass';
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
    // A side node exists only when that side has variables (#387 item 12), so it is
    // always expandable and never needs an empty/grayed rendering.
    super(
      isMeta ? 'class variables' : 'instance variables',
      vscode.TreeItemCollapsibleState.Expanded,
    );
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
// Exported for unit tests that drive the New Method / category flows.
export class MethodCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly isMeta: boolean,
    public readonly category: string,
    public readonly computed: boolean,
    // Open the node up front. Categories do this while a filter is active, so matches
    // show without expanding every folder by hand. (Before #387 item 10 the ALL METHODS
    // row also forced itself open as the landing view; that row is gone, so nothing is
    // expanded by default any more and the real categories start at the top.)
    forceExpanded = false,
  ) {
    super(
      category,
      forceExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `mcat:${isMeta}:${category}`;
    this.iconPath = new vscode.ThemeIcon(computed ? 'list-flat' : 'symbol-folder');
    // Real (non-computed) protocols host the rename pencil; the computed
    // ALL/SESSION rows don't (they aren't renamable categories). The token
    // avoids the substring "explorerMethod" so it can't match the method-row
    // menu regexes.
    if (!computed) this.contextValue = 'explorerProtocol';
  }
}

export class MethodItem extends vscode.TreeItem {
  // `displayCategory` is the category node this row is shown *under* (a real
  // category, SESSION METHODS, or undefined when category grouping is off). It's
  // needed so MethodProvider.getParent can walk up for reveal().
  constructor(
    public readonly isMeta: boolean,
    public readonly info: SelectorInfo,
    public readonly displayCategory?: string,
    // The method's gemstone:// source URI, when known. Only used to carry a
    // FileDecoration (the "shown in the active editor" tint) — the label and icon
    // are still set explicitly below, so it doesn't affect how the row renders.
    resourceUri?: vscode.Uri,
    // Under an active reads:/writes:/accesses: ivar filter, the row's role for the
    // filtered ivar: 'r' (reads), 'w' (writes), or 'rw' (both). Shown as a glyph.
    accessMark?: 'r' | 'w' | 'rw',
  ) {
    super(info.selector, vscode.TreeItemCollapsibleState.None);
    this.id = `msel:${isMeta}:${displayCategory ?? ''}:${info.selector}`;
    this.resourceUri = resourceUri;
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
    if (accessMark) marks.push(accessMark);
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

    const lines = [
      'Single-click previews (one reusable tab) · double-click or $(pin) keeps it open',
    ];
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

    // Fires on every click (a re-click of the already-selected row too, which
    // onDidChangeSelection misses). Selection still drives the single-click
    // preview open; the controller uses this hook's timing to detect a
    // double-click and promote that preview to a permanent tab.
    this.command = {
      command: 'gemstone.explorer.methodClicked',
      title: '',
      arguments: [this],
    };
  }
}

// A "filter chip" root row shown while a pane's filter is active: a funnel icon,
// the label "Filter:", and the pattern in grey description text — visually
// distinct from method/selector rows. Clicking it re-opens the filter editor;
// its inline ✕ clears the filter. Carries the owning view id so one clear
// command serves every pane.
//
// The label keeps its colon: seeing the pattern is easy, but NOTICING that a
// filter is on at all is the hard part, and "Filter: foo*" reads as a statement
// about the pane where a bare "Filter foo*" reads like a button (#387 item 4).
export class FilterChipItem extends vscode.TreeItem {
  constructor(
    public readonly viewId: string,
    pattern: string,
  ) {
    super('Filter:', vscode.TreeItemCollapsibleState.None);
    this.id = `filterchip:${viewId}`;
    this.description = pattern;
    this.iconPath = new vscode.ThemeIcon('filter-filled');
    this.contextValue = 'explorerFilterChip';
    this.tooltip = `Active filter: ${pattern} — click to edit, ✕ to clear`;
    this.command = { command: `${viewId}.filter`, title: '' };
  }
}

type MethodNode = MethodCategoryItem | MethodItem | FilterChipItem;

// ── Hierarchy pane ───────────────────────────────────────────────────────────
// Shows the selected class's lineage: superclasses (root-first) → the class
// itself → its immediate subclasses. Clicking any row navigates to that class.
// Exported so the Explorer controller tests can construct a genuine hierarchy-node item — the
// insert/extract-superclass handlers branch on `instanceof HierarchyItem` to resolve the dictionary.
export class HierarchyItem extends vscode.TreeItem {
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
    qp.items = all.filter((it) => matchesClassPrefix(it.label, value));
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

// Unchecking a method in the rename-instance-variable preview does not "leave it
// alone" — the class is re-versioned, and a method that isn't carried onto the new
// version is gone. Deleting a method can be exactly what the user wants, but it
// should never be a surprise, so name the casualties and make them say yes.
async function confirmDroppedMethods(labels: string[]): Promise<boolean> {
  const shown = labels.slice(0, 5).join(', ');
  const more = labels.length > 5 ? ` (+${labels.length - 5} more)` : '';
  const DELETE = 'Delete Them';
  const choice = await vscode.window.showWarningMessage(
    `${labels.length} unchecked method${labels.length === 1 ? '' : 's'} will be DELETED, not ` +
      `left unchanged: ${shown}${more}. Renaming reshapes the class, and a method that isn't ` +
      'recompiled cannot be carried onto the new version.',
    { modal: true },
    DELETE,
  );
  return choice === DELETE;
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
  // The filterable panes can each lead with a FilterChipItem row (MethodNode
  // already includes it).
  dict: vscode.TreeView<DictItem | FilterChipItem>;
  category: vscode.TreeView<ClassCategoryItem | FilterChipItem>;
  klass: vscode.TreeView<ClassNode | FilterChipItem>;
  hierarchy: vscode.TreeView<HierarchyItem>;
  method: vscode.TreeView<MethodNode>;
}

// Whether to fire the one-time "how to keep methods open" hint. It fires the first
// time a single-click preview REPLACES a different previously previewed method —
// the moment the reused preview tab makes a first method appear to be lost. Not on
// the very first open (nothing has been replaced yet), not when re-opening the same
// method, and never once it has been shown.
export function shouldHintKeepMethodsOpen(
  prevKey: string | undefined,
  key: string,
  alreadyShown: boolean,
): boolean {
  return !alreadyShown && prevKey !== undefined && prevKey !== key;
}

// ── Controller ───────────────────────────────────────────────────────────────

/** The last-known outcome of one test class or test method, as the Explorer needs it. */
export interface ExplorerTestResult {
  outcome: 'running' | 'passed' | 'failed' | 'error';
  /** Running results only: whether the run can be broken. False under the debugger,
   *  which owns the suspended gem and ends it with its own Terminate. */
  stoppable?: boolean;
  /** The code changed since this ran, so it describes something no longer in the stone. */
  stale?: boolean;
}

/**
 * What the Explorer needs from the SUnit controller to show test affordances on
 * its rows. Narrow on purpose — the Explorer neither runs tests nor knows how
 * they run; it marks the rows that can be run and paints the last outcome.
 */
export interface ExplorerSunitHooks {
  isTestClass(dictName: string, className: string): boolean;
  /** True when a URI is the document a test item points at. Lets the Explorer leave its
   *  panes alone for a Testing-view row click, which is an open it did not cause. */
  isTestItemUri(uri: vscode.Uri): boolean;
  resultFor(dictName: string, className: string, selector?: string): ExplorerTestResult | undefined;
  onDidChangeResults: vscode.Event<void>;
  /** Select and scroll to this class, or one of its test methods, in the Testing view.
   *  False when there is nothing there to reveal. */
  revealInTestExplorer(dictName: string, className: string, selector?: string): Promise<boolean>;
}

/**
 * The row icon for an outcome. A stale result keeps its shape but is dimmed to a
 * muted grey: what it says was true of code that has since been recompiled, so it
 * should read as "was passing" rather than "is passing". Deliberately NOT the
 * queued yellow — that colour already means "skipped" in the Testing view and
 * most IDEs, so a stale pass in yellow reads as a test that never ran.
 */
function testResultIcon(result: ExplorerTestResult): vscode.ThemeIcon {
  if (result.outcome === 'running') return new vscode.ThemeIcon('loading~spin');
  const [icon, color] =
    result.outcome === 'passed'
      ? ['pass', 'testing.iconPassed']
      : result.outcome === 'failed'
        ? ['error', 'testing.iconFailed']
        : ['warning', 'testing.iconErrored'];
  return new vscode.ThemeIcon(
    icon,
    new vscode.ThemeColor(result.stale ? 'disabledForeground' : color),
  );
}

/**
 * The selector-shape half of "SUnit would run this": an instance-side unary
 * selector beginning with 'test'. Matches GemStone's own `TestCase>>testSelectors`.
 * The class-level check (a discovered TestCase subclass) is the caller's — see
 * ExplorerController.isTestSelector and decorateTestRow, which share this so the
 * rule lives in exactly one place.
 */
function isTestSelectorShape(isMeta: boolean, selector: string): boolean {
  return !isMeta && selector.startsWith('test') && !selector.includes(':');
}

function testResultTooltip(result: ExplorerTestResult): string {
  const said =
    result.outcome === 'running'
      ? 'Running…'
      : result.outcome === 'passed'
        ? 'Last run: passed'
        : result.outcome === 'failed'
          ? 'Last run: failed'
          : 'Last run: error';
  return result.stale && result.outcome !== 'running'
    ? `${said} — before the code was recompiled`
    : said;
}

export class ExplorerController {
  readonly state: ExplorerState = {};
  // className → category for the current dictionary; fetched once per dict.
  // Assign through the accessor pair, never to the backing field: the setter derives
  // `commentedClasses` from the entries, so every reassignment (dict switch, refresh,
  // class create/rename, comment edit) keeps that set in step with no site to forget.
  private classCategoryEntriesStore: queries.ClassCategoryEntry[] = [];
  // The commented subset of the above, as a set. `classHasComment` is asked once per
  // class ROW, so scanning the entries there made the Classes pane quadratic in class
  // count (~300k comparisons for the 769 classes in Globals, on every render). A set
  // lookup puts it back alongside the O(1) map reads its two row siblings do
  // (`classHasDefinedVars`, `classVersion`).
  private commentedClasses = new Set<string>();
  private get classCategoryEntries(): queries.ClassCategoryEntry[] {
    return this.classCategoryEntriesStore;
  }
  private set classCategoryEntries(entries: queries.ClassCategoryEntry[]) {
    this.classCategoryEntriesStore = entries;
    this.commentedClasses = new Set(entries.filter((e) => e.hasComment).map((e) => e.className));
  }
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
  // Per-method instance-variable read/write map for the selected class, keyed
  // `${isMeta}:${selector}`. Lazily loaded (only when a reads:/writes:/accesses:
  // filter is actually used); see methodIvarAccess. Cache validity is tied to the
  // `envLines` array *identity* — envLines is replaced on every method-list reload
  // (class switch, refresh, post-edit reloadIfCurrent), so a changed reference
  // means the class's methods may have changed and the map must be rebuilt. This
  // auto-invalidates without having to touch each envLines-assignment site.
  private ivarAccessCache?: {
    envLines: queries.EnvCategoryLine[];
    map: Map<string, queries.MethodInstVarAccess>;
  };
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
  // A New Method "+" opened a template; on the next compile of this class, select
  // the newly-added selector (unknown until the user saves). `before` is the
  // side's selector set at template-open time, diffed against the refreshed set.
  private pendingNewMethod?: {
    className: string;
    dictIndex: number;
    isMeta: boolean;
    before: Set<string>;
  };
  // URIs of editors we opened ourselves (method/definition clicks); syncToEditor
  // ignores its own opens so a tree click doesn't bounce the selection. A Set (not
  // a single value) because opens can overlap — clicking through methods faster
  // than each preview settles — and each open must match its own later
  // onDidChangeActiveTextEditor event; a scalar got overwritten by the next click,
  // letting the earlier open's event slip past the guard and re-reveal (scroll) the
  // Methods pane.
  private readonly selfOpenedUris = new Set<string>();
  // URIs someone is about to open deliberately — GemStone Search through
  // `gemstone.openDocument`, or Reveal in GemStone Explorer from a test row.
  // VS Code gives no way to ask where an open came from, so a Testing-view row
  // click is recognised by elimination: an open of a test item's URI that nobody
  // claimed. Claiming the deliberate ones keeps them navigating as they always have.
  private readonly attributedOpens = new Set<string>();

  /** Claim the next open of `uri`, so syncToEditor treats it as a deliberate
   *  navigation rather than a Testing-view row click. */
  markAttributedOpen(uri: vscode.Uri): void {
    this.attributedOpens.add(uri.toString());
  }

  /** Drop a claim that was never consumed — the open threw, kept focus, or the
   *  document was already active, so no editor-change fired to spend it. Without
   *  this the claim lingers and the next genuine Testing-view click on the same
   *  URI is misread as a deliberate navigation. A no-op once syncToEditor has
   *  already consumed the claim. */
  clearAttributedOpen(uri: vscode.Uri): void {
    this.attributedOpens.delete(uri.toString());
  }

  /**
   * Navigate the panes to `uri`'s class/method on purpose — what Reveal in
   * GemStone Explorer does from a Testing view row, where a plain click
   * deliberately navigates nothing. Claims the open first, so the guard that
   * ignores test-item documents lets this one through.
   */
  async revealDocument(uri: vscode.Uri): Promise<void> {
    this.markAttributedOpen(uri);
    await this.syncToEditor(uri);
  }

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

  constructor(
    private readonly sessionManager: SessionManager,
    /** Called after a symbol-list structural change (dictionary add/remove/rename) so other views —
     *  e.g. GemStone Search's cached dictionary corpus — can refresh. Uncommitted, but visible in-session. */
    private readonly onSymbolListChanged?: (sessionId: number) => void,
    /** Called once per class removed by Remove Class, so views holding a cached class corpus (GemStone
     *  Search) can drop it. Per class, not per command: the delete takes the whole subtree. */
    private readonly onClassRemoved?: (sessionId: number, className: string) => void,
    /** Extension global storage, used only to fire the one-time "how to keep methods open" hint. */
    private readonly globalState?: vscode.Memento,
    /** Test affordances on class/method rows. Absent in tests that don't exercise them,
     *  and before the SUnit controller exists. */
    private readonly sunit?: ExplorerSunitHooks,
  ) {}

  /**
   * True when SUnit would run this selector of the class the Methods pane is
   * showing — i.e. the row should offer to run it.
   *
   * Combines the class check (a discovered TestCase subclass) with the selector
   * shape rule in `isTestSelectorShape`. Decided from the selector rather than by
   * asking the SUnit controller for the class's test methods, because those are
   * listed lazily and this is answered while building rows, synchronously. A
   * selector that slips through runs and reports that it found no such test.
   */
  isTestSelector(isMeta: boolean, selector: string): boolean {
    const { dictName, className } = this.state;
    if (dictName === undefined || className === undefined) return false;
    if (!this.sunit?.isTestClass(dictName, className)) return false;
    return isTestSelectorShape(isMeta, selector);
  }

  /**
   * Give a rendered row its test affordances: a `.test` token on the context
   * value — which is what puts the inline ▶ there and nowhere else — and an icon
   * for the last-known outcome.
   *
   * One helper for all three panes so a class row in Classes, the same class in
   * Hierarchy, and its methods all say the same thing about the same run. A row
   * that has never been run keeps the icon it was built with; only a result
   * replaces it.
   *
   * Pass `selector` for a method row; omit it for a class row.
   */
  decorateTestRow(
    item: vscode.TreeItem,
    dictName: string | undefined,
    className: string,
    selector?: string,
    isMeta = false,
  ): void {
    if (dictName === undefined || !this.sunit?.isTestClass(dictName, className)) return;
    // A test class's non-test methods (setUp, helpers) are not runnable rows.
    // Same selector-shape rule isTestSelector uses — one home, so the copy under
    // test is the copy that runs.
    if (selector !== undefined && !isTestSelectorShape(isMeta, selector)) return;

    item.contextValue = `${item.contextValue ?? ''}.test`;
    const result = this.sunit.resultFor(dictName, className, selector);
    if (!result) return;
    // A running row swaps its ▶ for a ■ — see the `.running` when-clauses. The
    // token goes last so the menus can anchor on `.test$` vs `.running$`. A test
    // suspended in the debugger gets neither: there is no ▶ to offer mid-run, and
    // nothing our ■ could break.
    if (result.outcome === 'running' && result.stoppable) {
      item.contextValue = `${item.contextValue}.running`;
    } else if (result.outcome === 'running') {
      item.contextValue = `${item.contextValue}.debugging`;
    }
    item.iconPath = testResultIcon(result);
    const note = testResultTooltip(result);
    item.tooltip =
      typeof item.tooltip === 'string' && item.tooltip.length > 0
        ? `${item.tooltip}\n${note}`
        : note;
  }

  session(): ActiveSession | undefined {
    return this.sessionManager.getSelectedSession();
  }

  // Resolve the session a reveal should run against. When a caller (GemStone Search) names the session its
  // result came from, switch the Explorer to that session first so the reveal targets the right data —
  // otherwise, after the user switches the active session, a click would resolve against the new one
  // and land in the wrong session (or a same-named dictionary/category). With no id, fall back to the
  // normal "resolve the selected session (prompting if ambiguous)" path.
  private async resolveSessionFor(sessionId?: number): Promise<ActiveSession | undefined> {
    if (sessionId === undefined) return this.sessionManager.resolveSession();
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      void vscode.window.showWarningMessage(
        `That result's GemStone session (${sessionId}) is no longer active.`,
      );
      return undefined;
    }
    // Only switch when the result came from a DIFFERENT session than the one already selected. The
    // common case — searching and clicking a result in the session you are already in — must not fire a
    // needless `selectSession`, which unconditionally emits onDidChangeSelection (sessionManager.ts) and
    // drives a full downstream refresh it doesn't need: symbol-cache invalidation, admin-panel restale,
    // sunit resync, tree refreshes. Mirrors OmniSearchPanel.show()'s session-id compare before switching.
    if (this.sessionManager.getSelectedSession()?.id !== sessionId) {
      this.sessionManager.selectSession(sessionId);
    }
    return session;
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
    // The side (instance/class) is a title toggle rather than a tree row now, so
    // keep it in the header description; don't append the selected selector (the
    // grayed "instance · roll" just clutters, and the selection is already
    // highlighted in the tree). The active filter is shown by the filter-chip row
    // at the top of the tree (see MethodProvider), not in the header.
    this.views.method.description = this._showClassMethods ? 'class' : 'instance';
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

  // Set (or clear, with an empty pattern) a pane's filter: update the map, then
  // refresh the pane and titles. Clearing is offered via the in-pane filter chip
  // (see FilterChipItem), so no context key is needed to gate a title Clear button.
  private setFilterState(viewId: string, pattern: string | undefined): void {
    if (pattern) this.filters.set(viewId, pattern);
    else this.filters.delete(viewId);
    this.providerFor(viewId).refresh();
    this.syncTitles();
    // A changed Methods filter changes which ivar (if any) is highlighted.
    if (viewId === VIEW_METHODS) this.refreshIvarHighlights();
  }

  clearFilter(viewId: string): void {
    this.setFilterState(viewId, undefined);
  }

  private clearFilters(...viewIds: string[]): void {
    for (const id of viewIds) this.setFilterState(id, undefined);
  }

  // Open a live filter input for a pane: prefix match, '*' wildcard. Typing
  // filters the pane immediately; an empty value clears the filter.
  //
  // Because filtering is live, every keystroke has already changed the pane by the time the
  // box closes — so cancelling has to be undone explicitly. VS Code fires onDidHide for BOTH
  // Enter and Escape and onDidAccept only for Enter, so the accepted flag is what tells them
  // apart. On cancel we restore the filter captured when the box opened, which is the
  // previously accepted filter when the user was editing an existing one (the box is seeded
  // from it) rather than simply clearing.
  beginFilter(viewId: string): void {
    const box = vscode.window.createInputBox();
    const filterBeforeEdit = this.filters.get(viewId);
    // What this box last wrote, so the cancel path can tell its own edit from someone else's.
    let lastAppliedByBox = filterBeforeEdit;
    let accepted = false;
    box.title = 'Filter';
    box.placeholder = 'starts with… (use * as a wildcard)';
    // Set an explicit prompt. Left unset, VS Code fills the prompt line with its own
    // "press Enter to confirm / Escape to cancel" hint, which tells the user nothing
    // filters until Enter — but this box filters on every keystroke
    // (onDidChangeValue -> setFilterState). The live behaviour is the one worth
    // keeping, so correct the message instead (#387 item 5). Escape still cancels and
    // restores the previous filter, which is why it stays in the text.
    box.prompt = 'Filters as you type — Escape to cancel';
    box.value = filterBeforeEdit ?? '';
    this.filteringView = viewId;
    this.syncTitles();
    box.onDidChangeValue((value) => {
      lastAppliedByBox = value.trim() || undefined;
      this.setFilterState(viewId, lastAppliedByBox);
    });
    box.onDidAccept(() => {
      accepted = true;
      box.hide();
    });
    box.onDidHide(() => {
      // Undo ONLY this box's own edit, and only when there is something to undo.
      //
      // Restoring unconditionally was wrong: selecting a class clears the Methods filter
      // (`selectClass` -> `clearFilters(VIEW_METHODS)`), and that same click is what dismisses an
      // open filter box — so the restore could re-apply a filter the user typed for the PREVIOUS
      // class onto the newly selected one. If the live value is no longer what this box set,
      // someone else owns it now; leave it alone.
      //
      // The second guard keeps the common "open the box and press Escape without typing" case a
      // no-op rather than a needless refresh() + syncTitles() + refreshIvarHighlights() round.
      if (
        !accepted &&
        this.filters.get(viewId) === lastAppliedByBox &&
        lastAppliedByBox !== filterBeforeEdit
      ) {
        this.setFilterState(viewId, filterBeforeEdit);
      }
      this.filteringView = undefined;
      this.syncTitles();
      box.dispose();
    });
    box.show();
  }

  // From an instance-variable row's context menu: filter the Methods pane to the
  // methods that read / write / reference that ivar, by seeding the matching
  // reads:/writes:/accesses: token. Selects the ivar's OWN class first (selecting
  // an ivar row is otherwise inert, so the pane could still be showing another
  // class — which would filter the wrong method list and find nothing), then
  // switches to the instance side, since instance variables are only accessed by
  // instance-side methods. `selectClass` clears the Methods filter, so seed the
  // token after it.
  filterMethodsByIvar(
    kind: 'reads' | 'writes' | 'accesses',
    ivarName: string,
    className: string,
  ): void {
    if (className !== this.state.className) this.selectClass(new ClassItem(className), false);
    this.setMethodSide(false);
    this.setFilterState(VIEW_METHODS, `${kind}:${ivarName}`);
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
    this.pendingNewMethod = undefined;
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

    // Re-resolve the selected dictionary by NAME. A commit elsewhere can remove it
    // or shift every dictionary's index — e.g. uninstalling the server plugin drops
    // GsRefactoring / GsEnhancedInspector. If the selected dictionary is gone, don't
    // reload by its stale index (that would show a different dictionary's classes, or
    // leave the removed one's classes orphaned in the panes); reset to a default
    // dictionary so the class/category/hierarchy/method panes reflect the stone.
    let currentDictIndex = dictIndex;
    try {
      const pos = queries.getDictionaryNames(session).indexOf(dictName);
      if (pos < 0) {
        this.reset();
        return;
      }
      currentDictIndex = pos + 1;
      this.state.dictIndex = currentDictIndex;
    } catch {
      /* keep the retained index if the dictionary list can't be read */
    }

    // Reload the dictionary's class listing (+ ivar counts) and, when a class is
    // selected, its method environment and hierarchy. Keep stale data on a failed
    // fetch rather than blanking the tree out from under the user.
    try {
      this.classCategoryEntries = queries.getClassesWithCategory(session, currentDictIndex);
    } catch {
      /* keep stale on failure */
    }
    this.loadDefinedIvarCounts();
    if (className !== undefined) {
      try {
        this.envLines = queries.getClassEnvironments(
          session,
          currentDictIndex,
          className,
          this.maxEnv(),
        );
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
      if (info) await this.revealMethodRow(revealMethod.isMeta, info);
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
    this.pendingNewMethod = undefined;
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
    // A category node keeps showing (and the classes pane keeps highlighting) a
    // selected class that still lives under it. Dropping the controller's className
    // here would desync from that highlight — the row looks selected, yet New
    // Method and the Hierarchy pane would report "no class selected". So keep the
    // current class (and its already-loaded hierarchy) when it remains under this
    // category; only reset when the class is filtered out of view.
    const keepClass =
      this.state.className !== undefined &&
      categoryContains(item.fullPath, this.categoryOfClass(this.state.className));
    if (!keepClass) {
      this.state.className = undefined;
      this.envLines = [];
      this.hierChain = [];
      this.hierSubs = [];
    }
    this.clearFilters(VIEW_CLASSES, VIEW_METHODS);
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // The class-category of a class as the classes pane currently knows it, or
  // undefined if not loaded. Used to decide whether a class stays selected when its
  // category node is clicked (see selectClassCategory).
  private categoryOfClass(className: string): string | undefined {
    return this.classCategoryEntries.find((e) => e.className === className)?.category;
  }

  // The class currently highlighted in the Classes pane, if any. A fallback for
  // when the controller's className has been cleared (e.g. by a category click)
  // but a class row is still visually selected — actions should act on what the
  // user sees selected. Returns undefined if the selection isn't a class row.
  private selectedClassInTree(): ClassItem | undefined {
    const node = this.views?.klass.selection?.[0];
    return node instanceof ClassItem ? node : undefined;
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

  // After a dictionary is renamed, every open editor URI for a class in it still
  // embeds the OLD dictionary name (parseUri(uri).dictName), so saving one would
  // resolve a dictionary that no longer exists under that name. Close the clean stale
  // tabs; leave dirty ones open (never discard unsaved work) but warn about them.
  private async closeStaleTabsForRenamedDictionary(
    session: ActiveSession,
    oldName: string,
  ): Promise<void> {
    let dirty = 0;
    for (const { tab, uri } of listOpenGemstoneTabs()) {
      let parsed;
      try {
        parsed = parseUri(uri);
      } catch {
        continue;
      }
      if (parsed.sessionId !== session.id || parsed.dictName !== oldName) continue;
      if (tab.isDirty) {
        dirty += 1;
        continue;
      }
      try {
        await vscode.window.tabGroups.close(tab);
      } catch {
        /* best-effort: a failed close just leaves the (now stale) tab open */
      }
    }
    if (dirty > 0) {
      void vscode.window.showWarningMessage(
        `${dirty} unsaved editor${dirty === 1 ? '' : 's'} still reference${dirty === 1 ? 's' : ''} ` +
          `the old dictionary name '${oldName}'. Save or close ${dirty === 1 ? 'it' : 'them'} — a save ` +
          `under the old name will fail with "dictionary not found".`,
      );
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

  // `revealHierarchy` false loads the hierarchy data but doesn't reveal (and thus
  // can't force-open) the Hierarchy pane — used when selecting the class is a
  // side effect (e.g. filtering methods by one of its ivars), not a navigation.
  selectClass(item: ClassItem, revealHierarchy = true): void {
    this.state.className = item.className;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.pendingNewMethod = undefined;
    this.clearFilters(VIEW_METHODS);
    const session = this.session();
    this.envLines =
      session && this.state.dictIndex !== undefined
        ? queries.getClassEnvironments(session, this.state.dictIndex, item.className, this.maxEnv())
        : [];
    this.loadHierarchy();
    this.methodProvider.refresh();
    this.hierarchyProvider.refresh();
    if (revealHierarchy) void this.revealHierarchySelf();
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
  // currently-selected class for Find Class / new-class flows. `pin` pins it
  // in the neighbouring editor group so several definitions can be compared.
  async openClassDefinition(item?: ClassItem, pin = false): Promise<void> {
    const className = item?.className ?? this.state.className;
    if (
      this.state.dictName === undefined ||
      className === undefined ||
      this.state.dictIndex === undefined
    ) {
      return;
    }
    await this.openDefinitionFor(className, this.state.dictName, this.state.dictIndex, pin);
  }

  // Open a class's (editable) comment editor — the same gemstone://…/comment
  // document the System Browser saves, but reached from the Explorer's class row
  // or Classes-pane toolbar. Opens to the side so the comment sits alongside
  // whatever the developer is reading, and as a PREVIEW tab rather than a pinned
  // one: reading a comment is usually a peek, and a preview tab is reused by the
  // next one and dismissed with a single click instead of two (#387 item 11).
  // Double-clicking the tab still promotes it to a permanent one. `item` comes
  // from the inline button; falls back to the selected class for the toolbar /
  // palette.
  async openClassComment(item?: ClassItem): Promise<void> {
    const className = item?.className ?? this.state.className;
    if (
      this.state.dictName === undefined ||
      className === undefined ||
      this.state.dictIndex === undefined
    ) {
      return;
    }
    await this.openCommentFor(className, this.state.dictName, this.state.dictIndex);
  }

  // Same as openClassComment, but for a Hierarchy node — resolves the class's own
  // dictionary (it may live elsewhere than the currently-shown one), mirroring
  // openHierarchyDefinition.
  async openHierarchyComment(item: HierarchyItem): Promise<void> {
    const resolved = this.resolveClassDict(item.className, item.dictName);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Can't locate class ${item.className}.`);
      return;
    }
    await this.openCommentFor(item.className, resolved.dictName, resolved.dictIndex);
  }

  private async openCommentFor(
    className: string,
    dictName: string,
    dictIndex: number,
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    const uri = buildClassCommentUri(session.id, dictName, className, dictIndex);
    this.selfOpenedUris.add(uri.toString());
    const doc = await vscode.workspace.openTextDocument(uri);
    await openGemstoneDocument(doc, 'preview', this.placement);
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
    pin: boolean,
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    const uri = buildClassDefinitionUri(session.id, dictName, className, dictIndex);
    this.selfOpenedUris.add(uri.toString());
    const doc = await vscode.workspace.openTextDocument(uri);
    await openGemstoneDocument(doc, pin ? 'pin' : 'preview', this.placement);
  }

  // Manual double-click detection for the Classes pane: VS Code trees have no
  // double-click event, so a class row's `command` (fired on each click) records
  // the click; two on the same class within the threshold open its definition.
  private readonly classClicks = new DoubleClickDetector(500);
  handleClassClick(className: string): void {
    // (Re)select the class even when VS Code's tree still shows it highlighted from
    // a DIFFERENT dictionary: a same-named class in another dictionary shares this
    // row's tree id (`k:<className>`), so switching dictionaries leaves the row
    // highlighted while selectDict cleared the controller's className — and clicking
    // the already-highlighted row fires no onDidChangeSelection, so the hierarchy
    // would never reload. classClicked fires on EVERY click, so re-sync here. The
    // matching guard on the classView selection wiring keeps this to exactly one
    // selectClass per click.
    if (className !== this.state.className) {
      this.selectClass(new ClassItem(className));
    }
    if (this.classClicks.register(className)) {
      void this.openClassDefinition(new ClassItem(className));
    }
  }

  // Same manual double-click detection for the Methods pane: a single click
  // already opened the method as a preview tab (via onDidChangeSelection); a
  // double-click on the same row promotes it to a permanent tab so a later
  // single click elsewhere won't replace it.
  private readonly methodClicks = new DoubleClickDetector(500);
  handleMethodClick(node: MethodItem): void {
    if (this.methodClicks.register(`${node.isMeta}:${node.info.selector}`)) {
      void this.openMethod(node, 'keep');
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
      // Scope the lookup to the selected dictionary: without dictIndex, a class
      // name shadowed across dictionaries resolves to the global first match, so
      // the Hierarchy pane would show the OTHER dictionary's class's lineage.
      entries = queries.getClassHierarchy(session, this.state.className, this.state.dictIndex);
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
      const item = new HierarchyItem(
        e.className,
        e.dictName,
        isSelf ? 'self' : 'ancestor',
        i,
        hasChildren,
        this.classVersion(e.className),
      );
      // Each row carries its own dictionary — an ancestor often lives in another
      // one — so the affordance and the outcome are for the right class.
      this.decorateTestRow(item, e.dictName, e.className);
      return item;
    };
    if (!element) return [chainItem(0)];
    if (element.role === 'subclass') return [];
    if (element.chainIndex < lastIdx) return [chainItem(element.chainIndex + 1)];
    // element is the current class → list its subclasses.
    return this.hierSubs.map((s) => {
      const item = new HierarchyItem(
        s.className,
        s.dictName,
        'subclass',
        -1,
        false,
        this.classVersion(s.className),
      );
      this.decorateTestRow(item, s.dictName, s.className);
      return item;
    });
  }

  // Select the current class's node in the Hierarchy pane so its selection stays
  // in sync with the Classes pane.
  async revealHierarchySelf(): Promise<void> {
    if (this.hierChain.length === 0) return;
    // Don't reveal when the Hierarchy pane is collapsed — reveal() would force
    // VS Code to expand the section, defeating the collapsed-by-default layout
    // and re-opening the pane every time the user selects a class.
    if (!this.views?.hierarchy.visible) return;
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

  // Re-reveal the current class when the Hierarchy pane reappears. reveals are
  // skipped while the pane is hidden — either collapsed, or the whole Explorer
  // container is off-screen (revealHierarchySelf's visible guard) — so a class
  // navigated to while it was hidden would otherwise leave the pane on a stale
  // selection until the next navigation. Only acts on becoming visible, so it
  // never forces a deliberately-collapsed pane open.
  onHierarchyVisibilityChanged(visible: boolean): void {
    if (visible) void this.revealHierarchySelf();
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

  // Whether a class carries a real comment — drives whether the row offers the
  // comment button at all (#387 item 11), so the button never promises a document
  // that turns out to be GemStone's synthesised "No class-specific documentation
  // for …" placeholder. Answered from the set derived from the class list already
  // fetched for this dictionary, so asking costs no extra query and no scan. A class
  // we have no entry for (a stale row, or one from another dictionary) is treated as
  // uncommented: the Classes-pane toolbar button still reaches it, so nothing becomes
  // unreachable.
  classHasComment(className: string): boolean {
    return this.commentedClasses.has(className);
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
      // A FAST-FAIL only — the engine's isValidIvarName: is the authority and declines with a
      // fuller message. Kept so a typo is caught in the box without a round trip, and kept in
      // step with the engine: lowercase-or-underscore first, because a capitalised identifier
      // in a method body reads as a global.
      // Deliberately ASCII-only: the engine's `first isLowercase` also accepts non-ASCII lowercase
      // letters (é, ä, …), so this regex is intentionally the stricter, conservative side — it may
      // decline a rare Unicode-lowercase name the engine would accept, but never accepts one it
      // would reject, so there is no data risk. Widen to a Unicode letter class if that ever bites.
      validateInput: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Enter a name.';
        return /^[a-z_][A-Za-z0-9_]*$/.test(t)
          ? undefined
          : 'Must start with a lowercase letter or underscore, then letters, digits, or underscores.';
      },
    });
    if (entered === undefined) return;
    const name = entered.trim();
    if (name.length === 0) return;
    // Ask the accessors question up front so the add feels atomic — escaping it
    // cancels the whole operation (nothing added) rather than leaving the variable
    // added with the question half-answered.
    const wantAccessors = await this.askAddAccessors(name);
    if (wantAccessors === undefined) return;
    const outcome = await runInstVarRefactor({
      session,
      op: 'add',
      className,
      ivarName: name,
      dict: this.state.dictIndex,
      // Accessors are compiled by the engine IN THE SAME transaction as the reshape, so
      // they commit or abort atomically with the instance-variable add (not a separate
      // fire-and-forget step after a possible commit).
      accessorSpecs: wantAccessors ? accessorSpecsFor(name, 'ivar').accessors : undefined,
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
      // Accessors (if requested) were compiled inside the apply's transaction, so they are
      // already present and committed/aborted together with the reshape — no separate
      // generateAccessorsFor call here (that was the split-commit hazard).
    }
  }

  // "+" inline on the "instance" variable-side node.
  async addInstVarFromSide(item: VarSideItem): Promise<void> {
    if (item.isMeta) return; // the class-variable side is handled by addClassVar
    await this.addInstVarOnClass(item.className);
  }

  // "+" inline on the "class variables" side node.
  async addClassVarFromSide(item: VarSideItem): Promise<void> {
    if (!item.isMeta) return; // the instance side is handled by addInstVar
    await this.addClassVarOnClass(item.className);
  }

  // Add a class variable to a class. Unlike adding an instance variable this does NOT
  // reshape the class (class variables are not part of instance layout), so there is
  // no preview / migration panel — just the name, then the shared binding is added
  // (initialized to nil), no new class version, no instances migrated, no commit.
  async addClassVarOnClass(className: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    const entered = await vscode.window.showInputBox({
      title: 'Add Class Variable',
      prompt: `Add a class variable to ${className}.`,
      placeHolder: 'NewVariableName',
      // Same identifier rule as the class-variable rename (letter/underscore first).
      validateInput: (v) => validateNewClassVarName(v, ''),
    });
    if (entered === undefined) return;
    const name = entered.trim();
    if (name.length === 0) return;

    // A class variable is visible to the whole subtree, so adding one already visible
    // (declared here OR inherited) would be a silent no-op in the image — refuse with
    // a reason instead.
    try {
      if (
        queries.getVisibleClassVarNames(session, className, this.state.dictIndex).includes(name)
      ) {
        void vscode.window.showWarningMessage(
          `'${name}' is already a class variable visible to ${className}.`,
        );
        return;
      }
    } catch {
      /* non-fatal: fall through and let the add surface any real problem */
    }

    // Ask the accessors question up front so the add feels atomic — escaping it
    // cancels the whole operation (nothing added).
    const wantAccessors = await this.askAddAccessors(name);
    if (wantAccessors === undefined) return;

    let addResult: string;
    try {
      addResult = queries.addClassVariable(session, className, name, this.state.dictIndex);
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Add class variable failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // addClassVariable answers the non-throwing sentinel 'no-class' when the class
    // can't be resolved — treat that as a failure, not success, so we don't refresh,
    // reveal, and add accessors as if the variable had been added when it wasn't.
    if (addResult.trim() !== 'ok') {
      void vscode.window.showWarningMessage(
        `Couldn't resolve ${className} to add the class variable '${name}'.`,
      );
      return;
    }

    // Adding a class variable does NOT reshape the class (no new version); this is
    // just the general "class members changed" pane refresh, reused despite its name.
    await this.refreshAfterClassReshape(className);
    // Select the newly-added class variable (its row is under the "class" side); fall
    // back to the class-variable side node, then leave the class selected.
    try {
      await this.views?.klass.reveal(new ClassVarItem(className, name), {
        select: true,
        focus: false,
      });
    } catch {
      try {
        await this.views?.klass.reveal(new VarSideItem(className, true), {
          select: true,
          focus: false,
        });
      } catch {
        /* best-effort — leave the class selected if neither row can be revealed */
      }
    }
    if (wantAccessors) await this.generateAccessorsFor(className, name, 'classvar');
  }

  // Generate accessors for an existing variable (the "Add Accessors" row action, and
  // the follow-up when adding a variable). Skips any accessor already implemented, so
  // it never clobbers a hand-written one, and reports what it did.
  async generateAccessorsFor(
    className: string,
    varName: string,
    kind: 'ivar' | 'classvar',
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    const { isMeta, accessors } = accessorSpecsFor(varName, kind);
    let result;
    try {
      result = queries.addAccessors(session, className, isMeta, accessors, this.state.dictIndex);
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Add accessors failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (result.noClass) {
      void vscode.window.showWarningMessage(`Couldn't resolve ${className} to add accessors.`);
      return;
    }
    // Show the new accessors: navigate the panes to the class they were added to and
    // reveal the new getter on its side (instance for an ivar, class for a classvar).
    // Using revealClass (rather than only refreshing when this class happens to be the
    // shown one) means the accessors are shown even when a DIFFERENT class was
    // displayed — e.g. adding via V4Boat's "+" while viewing V4Car — and revealClass
    // reloads the class's methods, so the accessors are in the list before the getter
    // is revealed. Deferred a tick so any pending tree-selection event (the add flow's
    // own class reveal fires selectClass) settles first, letting this reveal win.
    const { dictName, dictIndex } = this.state;
    if (dictName !== undefined && dictIndex !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const getter = accessors[0]?.selector;
      await this.revealClass(dictName, dictIndex, className, {
        revealMethod: getter ? { selector: getter, isMeta } : undefined,
      });
    }
    const where = isMeta ? 'class-side ' : '';
    if (result.created === 0) {
      void vscode.window.showInformationMessage(`${varName}: ${where}accessors already existed.`);
    } else {
      const skipNote = result.skipped > 0 ? ` (${result.skipped} already existed)` : '';
      void vscode.window.showInformationMessage(
        `Added ${result.created} ${where}accessor${result.created === 1 ? '' : 's'} for ${varName}${skipNote}.`,
      );
    }
  }

  // Ask, up front, whether to also generate accessors. Answers true/false, or
  // undefined if the user escaped — the caller treats escape as "cancel the whole
  // operation" so adding a variable feels atomic (all questions asked before any
  // change, nothing added if the user backs out).
  private async askAddAccessors(varName: string): Promise<boolean | undefined> {
    const YES = 'Add accessors';
    const choice = await vscode.window.showQuickPick([YES, 'No accessors'], {
      placeHolder: `Also generate accessors for ${varName}?`,
    });
    return choice === undefined ? undefined : choice === YES;
  }

  // 🗑 inline on an instance-variable row: remove it. Guarded like every other delete —
  // a variable no method reads or writes goes straight through (no preview to show, since
  // nothing can break) and is announced afterwards, while one that IS accessed raises a
  // confirmation naming the accessors and then opens the will-not-recompile preview.
  async removeInstVar(item: IvarItem): Promise<void> {
    const session = this.session();
    if (!session) return;

    const scan = await this.scanReferences(`Finding methods that use ${item.ivarName}…`, (env) =>
      queries.methodsAccessingInstVar(
        session,
        item.className,
        item.ivarName,
        this.state.dictIndex,
        env,
      ),
    );
    const target: SafeDeleteTarget = {
      kind: 'instance variable',
      label: `${item.ivarName} from ${item.className}`,
      references: scan.references,
      scanFailed: scan.scanFailed,
      truncated: scan.truncated,
    };

    const decision = await decideSafeDelete(session.id, target);
    if (decision === 'cancelled') return;

    const outcome = await runInstVarRefactor({
      session,
      op: 'remove',
      className: item.className,
      ivarName: item.ivarName,
      dict: this.state.dictIndex,
      autoApply: decision === 'silent',
    });
    if (!outcome) return;
    await this.refreshAfterClassReshape(item.className);
    // Only when the panel really was skipped: the engine can send an autoApply request to
    // the panel after all, and that removal was not unasked.
    if (outcome.autoApplied) announceSilentDelete(target);
  }

  // 🗑 inline on a class-variable row: remove it. The mirror of addClassVarOnClass and
  // just as lightweight — a class variable is not part of instance layout, so removing one
  // reshapes nothing, needs no preview panel and no refactoring engine. Guarded the same
  // way as every other delete: a variable no method references goes without a question and
  // is announced, one that is referenced asks first. Nothing is committed.
  async removeClassVar(item: ClassVarItem): Promise<void> {
    const session = this.session();
    if (!session) return;

    const { className, classVarName } = item;

    // Kernel/system classes can't be modified here, so a removal could only fail.
    if (!queries.canClassBeWritten(session, className, this.state.dictIndex)) {
      void vscode.window.showWarningMessage(`${className} cannot be modified in this repository.`);
      return;
    }

    // Belt and braces, not a case the tree produces: class-variable rows are built from
    // definedClassVarNames, which lists only what the class DECLARES, so no row can name a
    // variable an ancestor owns. The real guard is server-side in deleteClassVariable, which
    // also covers the query and MCP paths; this is here so that if a caller ever does hand
    // over an inherited name, it is refused with a sentence rather than silently acting on
    // the wrong class. Uses the memoized accessor — the same list the row was built from.
    if (!this.definedClassVarNames(className).includes(classVarName)) {
      void vscode.window.showWarningMessage(
        `'${classVarName}' is not declared in ${className} — remove it from the class that declares it.`,
      );
      return;
    }

    const scan = await this.scanReferences(`Finding methods that use ${classVarName}…`, (env) =>
      queries.methodsAccessingClassVar(session, className, classVarName, this.state.dictIndex, env),
    );
    const target: SafeDeleteTarget = {
      kind: 'class variable',
      label: `${classVarName} from ${className}`,
      references: scan.references,
      scanFailed: scan.scanFailed,
      truncated: scan.truncated,
      note: 'Methods that reference it keep their binding and will read a variable nothing declares.',
    };

    const decision = await decideSafeDelete(session.id, target);
    if (decision === 'cancelled') return;

    let result: string;
    try {
      result = queries.deleteClassVariable(session, className, classVarName, this.state.dictIndex);
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Remove class variable failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (result.trim() !== 'ok') {
      void vscode.window.showErrorMessage(
        `Couldn't remove the class variable '${classVarName}' from ${className} (${result.trim()}).`,
      );
      return;
    }

    // Removing a class variable does NOT reshape the class (no new version); this is just
    // the general "class members changed" pane refresh, reused despite its name.
    await this.refreshAfterClassReshape(className);
    // The variable's row is gone, so land the selection on the class-variable side node —
    // the parent row — falling back to the class itself when that side is now empty.
    try {
      await this.views?.klass.reveal(new VarSideItem(className, true), {
        select: true,
        focus: false,
      });
    } catch {
      try {
        await this.views?.klass.reveal(new ClassItem(className), { select: true, focus: false });
      } catch {
        /* best-effort — leave the class selected if neither row can be revealed */
      }
    }
    if (decision === 'silent') announceSilentDelete(target);
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

    // The engine ships as an optional, separately-installed payload; gate through
    // the shared helper so the install-then-re-check logic lives in one place.
    if (!(await this.ensureRbSupport('Renaming an instance variable'))) return false;

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

    // The preview is addressed by token so the APPLY runs server-side: renaming an
    // instance variable reshapes the class, and a reshape starts a new class version
    // with an EMPTY method dictionary. Only the engine can copy the whole method
    // dictionary forward, so a client that replayed the staged changes itself would
    // destroy every method the change set doesn't mention.
    const token = `rivPreview_${crypto.randomBytes(8).toString('hex')}`;
    const safeClear = (): void => {
      try {
        queries.clearRenameInstVarPreview(session, token);
      } catch {
        /* best-effort — the token expires with the session anyway */
      }
    };

    let json: string;
    try {
      json = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Previewing rename of '${oldName}'…`,
          cancellable: false,
        },
        () =>
          Promise.resolve(
            queries.startRenameInstVarPreview(session, className, oldName, newName, token, dict),
          ),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
      return false;
    }

    let preview: RenamePreview;
    try {
      preview = parseRenamePreview(json);
    } catch {
      const detail = json.length > 200 ? `${json.slice(0, 200)}…` : json;
      void vscode.window.showErrorMessage(`Rename preview failed: ${detail}`);
      safeClear();
      return false;
    }

    if (preview.changes.length === 0) {
      void vscode.window.showInformationMessage(
        `No references to '${oldName}' were found in ${className} or its ` +
          'subclasses; nothing to rename.',
      );
      safeClear();
      return false;
    }

    // Preview in the custom panel (all changes pre-checked, before/after diffs);
    // the user unchecks any they don't want and hits Apply.
    const ordered = orderChangesClassDefFirst(preview.changes);
    const selectedIds = await showRenameInstVarPanel(oldName, newName, ordered);
    if (!selectedIds || selectedIds.length === 0) {
      safeClear();
      return false;
    }

    // Unchecking a method means it is NOT carried onto the new class version, i.e.
    // it is deleted. That is a reasonable thing to ask for, but not a good thing to
    // discover afterwards, so confirm it explicitly.
    const dropping = deselectedLabels(ordered, selectedIds);
    if (dropping.length > 0 && !(await confirmDroppedMethods(dropping))) {
      safeClear();
      return false;
    }

    const applied = await this.applyRenameInstVar(
      session,
      token,
      deselectedIdsFrom(ordered, selectedIds),
      className,
      oldName,
      newName,
    );
    safeClear();
    return applied;
  }

  // Report a rename that left methods behind: the FULL list to the persistent "GemStone
  // GCI" channel, and a notification that names the first and offers a button onto the
  // rest. Both are built from the same `action` + result, so they cannot disagree about
  // what happened. A notification collapses newlines and truncates, so it can never be
  // the durable artifact however it is worded -- hence the channel, and hence the button
  // rather than an instruction to go find it ('Show Details', the idiom logJasperError
  // uses in extension.ts). `action` must name WHAT was renamed: the channel is durable
  // and shared, so two renames in a session otherwise leave two indistinguishable blocks.
  private reportRenameFailures(action: string, result: RenameApplyResult): void {
    if (result.failed.length === 0) return; // nothing to report; the toast names failed[0]
    const block = formatRenameFailureLog(action, result.failed);
    if (block) logWarning(block);
    void vscode.window
      .showErrorMessage(formatRenameFailureToast(action, result), SHOW_RENAME_DETAILS)
      .then((choice) => {
        if (choice === SHOW_RENAME_DETAILS) getGciLog().show(true);
      });
  }

  // Apply the rename SERVER-SIDE, without committing. The engine re-versions the
  // defining class and every subclass and copies all their methods onto the new
  // versions — accessing methods from their rewritten source, everything else
  // verbatim — so nothing the change set never mentioned is lost. `deselectedIds`
  // are the methods the user chose to drop; the class-definition edit is structural
  // and can never be among them. Answers true when the rename was applied.
  private async applyRenameInstVar(
    session: ActiveSession,
    token: string,
    deselectedIds: string[],
    className: string,
    oldName: string,
    newName: string,
  ): Promise<boolean> {
    let result: RenameApplyResult;
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Applying rename '${oldName}' → '${newName}'…`,
          cancellable: false,
        },
        () =>
          Promise.resolve(
            parseRenameApplyResult(queries.applyRenameInstVar(session, token, deselectedIds)),
          ),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Rename failed: ${msg}`);
      return false;
    }

    // The defining class and every subclass were reshaped onto new versions, so the
    // cached method environment is stale. Do a full reshape refresh keyed on the
    // DEFINING class: it re-fetches the environment and re-selects that class (not a
    // subclass) via revealClass, so the method pane shows the carried-forward methods
    // of the right class rather than re-rendering stale data.
    this.loadDefinedIvarCounts();
    await this.refreshAfterClassReshape(className);
    // Land on the renamed variable's row on the defining class. Best-effort: reveal
    // rejects if the row isn't in the rebuilt tree, which we ignore.
    this.views?.klass
      .reveal(new IvarItem(className, newName, this.classHasSubclasses(className)), {
        select: true,
        focus: true,
      })
      .then(undefined, () => {});

    if (result.error !== undefined) {
      void vscode.window.showErrorMessage(`Rename failed: ${result.error}`);
      return false;
    }
    if (result.failed.length > 0) {
      this.reportRenameFailures(
        `Rename instance variable '${oldName}' → '${newName}' in ${className}`,
        result,
      );
      return true;
    }
    void vscode.window.showInformationMessage(
      `Renamed '${oldName}' → '${newName}' (${result.applied} class` +
        `${result.applied === 1 ? '' : 'es'} re-versioned). ` +
        'Compiled but NOT committed — commit when ready.',
    );
    return true;
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

    // Gate through the shared helper (see renameInstVarNamed) — one place for the
    // install-then-re-check logic instead of a verbatim copy per call site.
    if (!(await this.ensureRbSupport('Renaming a method'))) return false;

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
      this.reportRenameFailures(`Rename method '${oldSelector}' → '${newSelector}'`, result);
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
  // Returns true when it is (now) available — re-checks rbSupportAvailable AFTER the
  // install command so a failed/declined install cleanly returns false. The single
  // gate for every rename refactoring (ivar, method, class, class-var) + class history.
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
  // bound to another global in the stone. Runs as the rename input's live validator
  // (showRenameClassEditor), so catching a collision here surfaces it inline while the
  // user is still typing — they correct the name in place, instead of the rename starting
  // and failing server-side with a costlier, later error. Returns an error string or undefined.
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
    // A hierarchy node may name a class outside the current dictionary, so resolve
    // it across the whole symbol list; a class-row uses the current dictionary.
    const dictArg = item instanceof HierarchyItem ? undefined : this.state.dictIndex;
    await this.renameClassNamed(item.className, dictArg);
  }

  /** Rename the class `oldName` across the image, resolving it through `dictArg`
   *  (a 1-based SymbolList index, or undefined to resolve across the whole symbol
   *  list). Shared by the Explorer class-row / hierarchy pencil and the method
   *  editor's Rename… when the cursor is on a class reference. */
  async renameClassNamed(oldName: string, dictArg: number | undefined): Promise<void> {
    const session = this.session();
    if (!session) return;
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

    // The "This dictionary" scope must follow the CLASS being renamed, not the
    // Explorer's current selection: invoked from a method editor or a hierarchy
    // node, `oldName` can live in a different dictionary than `this.state.dictName`,
    // and scoping to the selection would silently exclude the class's real
    // references. Resolve the class's own defining dictionary (via the same
    // `dictArg` used for the rename lookup); fall back to the selection only if the
    // probe fails, and to no "This dictionary" option if the class is unbound.
    let scopeDictName = this.state.dictName;
    try {
      const homeDict = queries.classDefiningDictionaryName(session, oldName, dictArg);
      scopeDictName = homeDict.length > 0 ? homeDict : undefined;
    } catch {
      /* keep the Explorer selection as a best-effort fallback */
    }

    const edit = await showRenameClassEditor({ oldName, dictName: scopeDictName }, (newName) =>
      this.validateRenameTarget(newName, oldName),
    );
    if (!edit) return;
    const { newName, scope, options } = edit;

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
        removeOldFromHistory: options.removeOldFromHistory,
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
      this.reportRenameFailures(`Rename class '${oldName}' → '${newName}'`, result);
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

  // V6 Insert Superclass: slide a new empty class between this class and its current
  // superclass (server-side new class versions, no commit). Reveals the new class after.
  async insertSuperclass(item: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    // A hierarchy node may name a class outside the current dictionary; a class row uses it.
    const dict = item instanceof HierarchyItem ? undefined : this.state.dictIndex;
    const outcome = await insertSuperclassCommand({ session, className: item.className, dict });
    if (outcome) await this.refreshAfterClassReshape(outcome.newClass);
  }

  // V7 Extract Superclass: insert a new common superclass above this class and chosen sibling
  // classes, hoisting chosen shared members up into it (server-side, no commit). Reveals the
  // new class after.
  async extractSuperclass(item: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const dict = item instanceof HierarchyItem ? undefined : this.state.dictIndex;
    const outcome = await extractSuperclassCommand({ session, className: item.className, dict });
    if (outcome) await this.refreshAfterClassReshape(outcome.newClass);
  }

  // V8 Split Class: extract a chosen set of this class's own instance variables (and the methods
  // that use them) into a new component class, leaving the source with a lazy accessor +
  // delegating stubs (server-side, no commit). Reveals the new class after.
  async splitClass(item: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const dict = item instanceof HierarchyItem ? undefined : this.state.dictIndex;
    const outcome = await splitClassCommand({ session, className: item.className, dict });
    if (outcome) await this.refreshAfterClassReshape(outcome.newClass);
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
      this.reportRenameFailures(
        `Rename class variable '${oldName}' → '${newName}' in ${className}`,
        result,
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

  // Method categories for one side, with the computed SESSION row on top,
  // plus any just-created (still empty) categories from the + button.
  methodCategories(isMeta: boolean, filter?: string): MethodCategoryItem[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    const real = [...new Set(lines.map((l) => l.category).filter((c) => c && c.length))];
    const fresh = [...this.newMethodCategories[isMeta ? 'meta' : 'instance']].filter(
      (c) => !real.includes(c),
    );
    let combined = [...real, ...fresh].sort((a, b) => a.localeCompare(b));
    if (lines.length === 0 && combined.length === 0) return [];
    const hasSession = lines.some(
      (l) => l.sessionMethodBits && Object.keys(l.sessionMethodBits).length > 0,
    );
    // With a filter set and categories visible, keep the category structure but
    // drop categories with no matching selector, and expand what remains so the
    // matches are visible without hand-expanding each folder.
    // A category survives the filter when its OWN name matches (#387 item 7) or when
    // any selector inside it matches. Name-matching first: it is a cached-parse
    // lookup plus a string compare (parseFilter re-parses only when the raw filter
    // string changes), where the selector scan can pull in the ivar-access map.
    const hasMatch = (category: string) =>
      filter === undefined ||
      this.methodCategoryMatchesFilter(category, filter) ||
      this.selectorsFor(isMeta, category).some((info) =>
        this.methodMatchesFilter(isMeta, info.selector, filter),
      );
    const expanded = filter !== undefined;
    if (filter !== undefined) combined = combined.filter(hasMatch);
    const items: MethodCategoryItem[] = [];
    // No ALL METHODS pseudo-category row (#387 item 10). It duplicated what the real
    // categories already show — for an uncategorized class it listed exactly what "as
    // yet unclassified" lists — and being first AND expanded by default it pushed the
    // real categories below the fold, so switching classes meant scrolling before any
    // category was visible. Every method is still reachable under its own category (the
    // pseudo-category's contents were only ever "selectors that have a category"), and
    // the flat/grouped toggle remains the see-everything view.
    //
    // ALL_METHODS_CATEGORY itself stays: selectorsFor() still uses it as the
    // enumerate-every-selector lookup key that reveal and the flat view depend on.
    if (hasSession && hasMatch(SESSION_METHODS_CATEGORY))
      items.push(new MethodCategoryItem(isMeta, SESSION_METHODS_CATEGORY, true, expanded));
    return items.concat(combined.map((c) => new MethodCategoryItem(isMeta, c, false, expanded)));
  }

  // Whether the Methods pane groups selectors under their categories. Off = a
  // flat list of the class's methods (the category tree level is dropped). Backed
  // by a setting so the title-bar toggle both flips the view AND persists it.
  groupMethodsByCategory(): boolean {
    return vscode.workspace
      .getConfiguration('gemstone')
      .get<boolean>('explorer.groupMethodsByCategory', true);
  }

  // All of one side's methods as flat rows (no category parent) — used when
  // category grouping is off, or when a filter is narrowing the list.
  flatMethods(isMeta: boolean, filter?: string): MethodItem[] {
    return this.selectorsFor(isMeta, ALL_METHODS_CATEGORY)
      .filter(
        (info) =>
          filter === undefined ||
          this.methodMatchesFilter(isMeta, info.selector, filter) ||
          // A category-name match keeps that category's methods here too (#387 item 7).
          // Without this, filtering 'accessing' listed the category in grouped mode and
          // then emptied the pane the moment the user turned grouping off, even though
          // the filter had not changed. Ivar-token filters are excluded for free --
          // methodCategoryMatchesFilter answers false for them.
          this.methodCategoryMatchesFilter(info.category, filter),
      )
      .map((info) => {
        const item = new MethodItem(
          isMeta,
          info,
          undefined,
          this.methodSourceUri(isMeta, info),
          this.ivarAccessMark(isMeta, info.selector, filter),
        );
        this.decorateTestRow(
          item,
          this.state.dictName,
          this.state.className ?? '',
          info.selector,
          isMeta,
        );
        return item;
      });
  }

  // Lazily load + cache the per-method instance-variable read/write map for the
  // current class. Called only when a reads:/writes:/accesses: filter is active,
  // so plain textual filters never pay for the extra round trip.
  private methodIvarAccess(): Map<string, queries.MethodInstVarAccess> {
    const session = this.session();
    const { className, dictIndex } = this.state;
    if (!session || className === undefined || dictIndex === undefined) return new Map();
    // Valid as long as the method list (envLines) hasn't been reloaded since.
    if (this.ivarAccessCache?.envLines === this.envLines) return this.ivarAccessCache.map;
    const map = new Map<string, queries.MethodInstVarAccess>();
    for (const r of queries.getMethodInstVarAccess(session, dictIndex, className, this.maxEnv())) {
      map.set(`${r.isMeta}:${r.selector}`, r);
    }
    this.ivarAccessCache = { envLines: this.envLines, map };
    return map;
  }

  // Parse cache — the same raw filter string is matched against every row, so
  // parse it once per distinct string.
  private parsedFilter?: { raw: string; filter: MethodFilter };
  private parseFilter(raw: string): MethodFilter {
    if (this.parsedFilter?.raw !== raw) this.parsedFilter = { raw, filter: parseMethodFilter(raw) };
    return this.parsedFilter.filter;
  }

  // Whether a method row passes the active filter — the selector prefix plus any
  // reads:/writes:/accesses: ivar tokens. The ivar map is only consulted (and
  // hence only loaded) when the filter actually carries an ivar token.
  methodMatchesFilter(isMeta: boolean, selector: string, raw: string): boolean {
    const filter = this.parseFilter(raw);
    if (filter.ivar.length === 0) {
      return filter.selector === undefined || filterMatches(selector, filter.selector);
    }
    const access = this.methodIvarAccess().get(`${isMeta}:${selector}`);
    return matchesMethodFilter(filter, selector, access);
  }

  // Whether a method CATEGORY's own name passes the active filter (#387 item 7).
  // The browser offers category quick-filters, so typing 'acc' in the Methods pane
  // should surface the 'accessing' category, not just selectors starting with 'acc'.
  //
  // Deliberately false for a filter carrying reads:/writes:/accesses: tokens: those
  // ask a question about a method's bytecode, which a category name cannot answer, so
  // an ivar filter keeps its current selector-only meaning rather than dragging in
  // whole categories whose NAME happens to look like the ivar.
  methodCategoryMatchesFilter(category: string, raw: string): boolean {
    const filter = this.parseFilter(raw);
    if (filter.ivar.length > 0) return false;
    return filter.selector !== undefined && filterMatches(category, filter.selector);
  }

  // The r/w/rw glyph a method row should show under an active ivar filter, or
  // undefined when the filter has no ivar token (nothing to mark).
  ivarAccessMark(isMeta: boolean, selector: string, raw?: string): 'r' | 'w' | 'rw' | undefined {
    if (raw === undefined) return undefined;
    const filter = this.parseFilter(raw);
    if (filter.ivar.length === 0) return undefined;
    const access = this.methodIvarAccess().get(`${isMeta}:${selector}`);
    return computeIvarAccessMark(filter, access);
  }

  // The instance-variable names to highlight in a method-source editor: the ivars
  // the method actually reads/writes that match an active reads:/writes:/accesses:
  // token. Empty unless a gemstone:// method source and an ivar filter line up.
  ivarsToHighlight(uri: vscode.Uri): string[] {
    if (uri.scheme !== 'gemstone') return [];
    const raw = this.filters.get(VIEW_METHODS);
    if (raw === undefined) return [];
    const filter = this.parseFilter(raw);
    if (filter.ivar.length === 0) return [];
    const method = parseMethodUri(uri);
    if (!method) return [];
    const access = this.methodIvarAccess().get(`${method.isMeta}:${method.selector}`);
    if (!access) return [];
    const patterns = filter.ivar.map((c) => c.pattern);
    return [...new Set([...access.reads, ...access.writes])].filter((n) =>
      patterns.some((p) => filterMatches(n, p)),
    );
  }

  // Highlight (or clear) the filtered ivar identifiers in one editor. When there's
  // nothing to highlight (the common case — no active ivar filter) just clear,
  // without reading the document text, so this stays off the editor-open hot path
  // (it runs on every activation, alongside the async CodeLens render).
  private applyIvarHighlight(editor?: vscode.TextEditor): void {
    if (!editor) return;
    const names = this.ivarsToHighlight(editor.document.uri);
    if (names.length === 0) {
      editor.setDecorations(ivarHighlightDecoration, []);
      return;
    }
    const ranges = ivarIdentifierRanges(editor.document.getText(), names).map(
      ([s, e]) => new vscode.Range(editor.document.positionAt(s), editor.document.positionAt(e)),
    );
    editor.setDecorations(ivarHighlightDecoration, ranges);
  }

  // Re-apply ivar highlighting across every open source editor — after opening a
  // method or changing the filter, so highlights track the active ivar filter.
  refreshIvarHighlights(): void {
    for (const editor of vscode.window.visibleTextEditors) this.applyIvarHighlight(editor);
  }

  // Highlight in whichever editor just became active (tab switch).
  highlightActiveEditor(editor?: vscode.TextEditor): void {
    this.applyIvarHighlight(editor);
  }

  // Flip the persistent group-by-category setting (from the title-bar toggle).
  // Writing the setting fires the config-change listener that calls
  // syncMethodGrouping, so the view and the saved preference stay in step.
  async setGroupMethodsByCategory(group: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('gemstone')
      .update('explorer.groupMethodsByCategory', group, vscode.ConfigurationTarget.Global);
  }

  // Keep the `gemstone.explorer.methodsGrouped` context key (which title toggle
  // shows) in step with the setting, and re-render the pane.
  syncMethodGrouping(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.explorer.methodsGrouped',
      this.groupMethodsByCategory(),
    );
    this.methodProvider.refresh();
  }

  // Which method side the Methods pane shows — instance (default) or class. The
  // pane shows ONE side at a time; this is a per-session toggle from the title bar
  // that carries across class selections until flipped or the window reloads.
  private _showClassMethods = false;
  get showClassMethods(): boolean {
    return this._showClassMethods;
  }

  // Switch the pane to a side, re-rendering only when it actually changed. Called
  // by the title toggle and before revealing a row that lives on the other side.
  setMethodSide(isMeta: boolean): void {
    const changed = this._showClassMethods !== isMeta;
    this._showClassMethods = isMeta;
    this.syncMethodSide();
    if (changed) {
      // Keep the recorded selection side in step with the visible side so New
      // Method lands on the side you're now looking at (the old selection is on
      // the other side); its category no longer applies, so drop it too.
      this.state.selectedIsMeta = isMeta;
      this.state.selectedMethodCategory = undefined;
      this.methodProvider.refresh();
      this.syncTitles();
    }
  }

  // Mirror the active side into the `gemstone.explorer.methodSideIsClass` context
  // key that selects which title toggle (Show Class / Show Instance) is visible.
  syncMethodSide(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.explorer.methodSideIsClass',
      this._showClassMethods,
    );
  }

  // Reveal + select a method row, honoring the pane's current view state: switch
  // to the method's side (the pane shows one side at a time) and drop the category
  // parent when grouping is off, so the built node's id matches the rendered row.
  private async revealMethodRow(
    isMeta: boolean,
    info: SelectorInfo,
    opts: { focusEditorAfter?: boolean } = {},
  ): Promise<void> {
    this.setMethodSide(isMeta);
    const displayCategory = this.groupMethodsByCategory() ? info.category : undefined;
    const item = new MethodItem(isMeta, info, displayCategory, this.methodSourceUri(isMeta, info));
    // In this VS Code build focus:false selects the row but never scrolls it into view; only
    // focus:true scrolls. For editor-driven navigation we force the scroll with focus:true and hand
    // focus straight back to the editor so the tree doesn't keep it. A passive background resync
    // stays a plain (non-scrolling) select so it can't yank focus off whatever the user is doing.
    const takesFocus = opts.focusEditorAfter === true;
    const side = isMeta ? 'class' : 'instance';
    try {
      await this.views?.method.reveal(item, { select: true, focus: takesFocus, expand: true });
    } catch (e) {
      // No longer swallowed silently: log it so a future failure is diagnosable from the GCI log
      // (mirrors the dictionary/category reveal paths above).
      logWarning(
        `Explorer method reveal failed for ${side} method ${info.selector}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // Hand focus back even if the reveal above rejected: it may have taken focus before failing, and
    // leaving the user's cursor stranded in the tree is the worse outcome.
    if (takesFocus) {
      try {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      } catch (e) {
        logWarning(
          `Explorer could not return focus to the editor after revealing ${side} method ${info.selector}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // The environments OTHER than 0 in which this class implements `selector` on this side.
  //
  // The Methods pane shows one row per selector however many environments implement it (see
  // selectorsFor), and a removal takes the environment-0 method only. So when the answer here
  // is non-empty the row the user clicked stands for more methods than the one about to go,
  // and the dialog has to say so — otherwise "removed, nothing referenced it" reads as though
  // the selector is gone from the class, when an implementation is still there.
  //
  // Read off envLines, which the method list is already built from, so this costs no query.
  private otherEnvironmentsImplementing(isMeta: boolean, selector: string): number[] {
    return [
      ...new Set(
        this.envLines
          .filter(
            (l) =>
              l.isMeta === isMeta &&
              l.envId !== EXPLORER_METHOD_ENVIRONMENT &&
              l.selectors.includes(selector),
          )
          .map((l) => l.envId),
      ),
    ].sort((a, b) => a - b);
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

  // The gemstone:// source URI for a method row — the SAME URI openMethod opens, so
  // a FileDecoration keyed on it (the active-editor tint) matches the row. Returns
  // undefined without a session/dictionary/class. Both the ALL METHODS copy and the
  // real-category copy of a selector share this URI (built from info.category), so
  // both rows light up together.
  methodSourceUri(isMeta: boolean, info: SelectorInfo): vscode.Uri | undefined {
    const session = this.session();
    if (
      session === undefined ||
      this.state.dictName === undefined ||
      this.state.className === undefined
    ) {
      return undefined;
    }
    return buildMethodUri({
      kind: 'method',
      sessionId: session.id,
      dictName: this.state.dictName,
      className: this.state.className,
      isMeta,
      category: info.category,
      selector: escapeSelectorSlashes(info.selector),
      environmentId: EXPLORER_METHOD_ENVIRONMENT,
      dictIndex: this.state.dictIndex,
    });
  }

  async openMethod(node: MethodItem, mode: OpenSourceMode = 'preview'): Promise<void> {
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
      environmentId: EXPLORER_METHOD_ENVIRONMENT,
      dictIndex: this.state.dictIndex,
    });
    // This open normally fires onDidChangeActiveTextEditor, so mark it — syncToEditor
    // then ignores its own open instead of re-revealing the row under ALL METHODS and
    // stealing the selection from the category the user clicked. But if this method is
    // ALREADY the active editor (the user clicked the row whose tab is focused),
    // re-showing it fires no such event: a mark here would never be consumed and would
    // later swallow a genuine focus event for this tab. Only mark when the active
    // editor is actually going to change.
    const uriStr = uri.toString();
    if (vscode.window.activeTextEditor?.document.uri.toString() !== uriStr) {
      this.selfOpenedUris.add(uriStr);
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    // Assign the language BEFORE the doc enters the (reused) preview editor. A
    // gemstone doc is otherwise language-tagged asynchronously
    // (onDidOpenTextDocument → setTextDocumentLanguage) — i.e. *after* it's shown —
    // and that post-show flip re-tokenizes and re-queries CodeLens, which makes the
    // senders/implementors lens pop in and shove the source down on each new
    // method. Setting it up front keeps the doc stable when it's shown.
    if (doc.languageId !== 'gemstone-smalltalk') {
      await vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
    }
    // Single-click opens a preview tab and a double-click promotes it to a
    // permanent one (focus stays in the tree so type-to-filter / arrow-nav keep
    // working); the 📌 action pins a real tab so methods can be compared.
    await openGemstoneDocument(doc, mode, this.placement);
    // The first time a single click is about to REPLACE a previously previewed
    // method (the exact moment a first-time user watches their method disappear),
    // explain once how to keep methods open.
    if (mode === 'preview') this.maybeHintKeepMethodsOpen(`${node.isMeta}:${node.info.selector}`);
    // Under an active ivar filter, highlight the filtered ivar in the just-opened
    // source (it may not be the active editor, so refresh all visible editors).
    this.refreshIvarHighlights();
  }

  // The key (`isMeta:selector`) of the last method opened as a preview, so we can
  // detect when a new single click is about to replace it.
  private lastPreviewedKey?: string;
  private static readonly KEEP_METHODS_HINT_KEY = 'gemstone.explorer.keepMethodsOpenHintShown';

  // A first-time user single-clicks a method, then single-clicks another and the
  // first vanishes — the preview tab is reused, and it isn't obvious the method is
  // still reachable or how to keep both open (issue #468). Fire a one-time toast at
  // exactly that moment: the second, different preview open. It names both gestures
  // that keep a method open (double-click, or the Keep Method Open button).
  private maybeHintKeepMethodsOpen(key: string): void {
    const prev = this.lastPreviewedKey;
    this.lastPreviewedKey = key;
    if (!this.globalState) return;
    const alreadyShown = !!this.globalState.get<boolean>(ExplorerController.KEEP_METHODS_HINT_KEY);
    if (!shouldHintKeepMethodsOpen(prev, key, alreadyShown)) return;
    void this.globalState.update(ExplorerController.KEEP_METHODS_HINT_KEY, true);
    void vscode.window.showInformationMessage(
      'Methods open in a single reusable preview tab, so clicking another method replaces the last. ' +
        'Double-click a method — or use its 📌 Keep Method Open button — to keep it open while you browse others.',
      'Got it',
    );
  }

  // Every environment the user has asked to see, so a scan covers the same ground the
  // Senders / Implementors commands do.
  private environmentsToScan(): number[] {
    const envs: number[] = [];
    for (let env = 0; env <= this.maxEnv(); env++) envs.push(env);
    return envs;
  }

  // The nearest ancestor that also implements `selector`, or undefined. Answers the class a
  // send would reach once this implementation is gone, which is what makes removing an
  // override harmless. Best-effort: a failure here answers undefined, which only means the
  // caller falls back to the full sender scan.
  private superclassImplementorOf(
    session: ActiveSession,
    className: string,
    selector: string,
    isMeta: boolean,
  ): string | undefined {
    try {
      const above = queries.hierarchyImplementorsOf(
        session,
        this.state.dictIndex ?? 1,
        className,
        selector,
        isMeta,
        'up',
      );
      return above[0]?.className;
    } catch {
      return undefined;
    }
  }

  // Run a reference scan over every environment, or report why it could not answer. A scan
  // that fails is NOT the same as a scan that found nothing: safe delete confirms in that
  // case rather than deleting unasked, so the reason travels with the (empty) result.
  //
  // `truncated` says the SCAN came back full, and is the only honest source for that. It has
  // to be observed here, on the raw per-environment rows, because it stops being visible
  // afterwards: callers drop references that go away with the target (a self-send, a doomed
  // subclass), so a capped scan of 500 can arrive at the dialog as 499 and no longer look
  // capped, and deduping across environments can shrink it further. Re-deriving it downstream
  // from the surviving count answers "no" for a list that really was cut off — precisely the
  // overconfident number this guard exists to avoid. It is per environment because the cap is
  // applied per query: one environment coming back full means rows were dropped, whatever the
  // others returned, and several environments summing past the cap without any one of them
  // reaching it means nothing was dropped at all.
  //
  // Shown under a progress notification because these are whole-image scans that block the
  // extension host: without it, clicking a delete freezes the editor with no explanation for
  // as long as the scan takes, where the old unguarded delete popped a modal instantly. The
  // GCI call is synchronous so the notification cannot spin, but it does say what is
  // happening and why the window is busy — the same treatment the Senders command gives the
  // identical loop.
  private async scanReferences(
    title: string,
    scan: (environmentId: number) => queries.MethodSearchResult[],
  ): Promise<{
    references: queries.MethodSearchResult[];
    scanFailed?: string;
    truncated: boolean;
  }> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      () => {
        try {
          const perEnv = this.environmentsToScan().map((env) => scan(env));
          const truncated = perEnv.some((rows) => rows.length >= METHOD_SEARCH_RESULT_LIMIT);
          return Promise.resolve({
            references: dedupeMethodResults(perEnv.flat()),
            truncated,
          });
        } catch (e: unknown) {
          return Promise.resolve({
            references: [],
            scanFailed: e instanceof Error ? e.message : String(e),
            truncated: false,
          });
        }
      },
    );
  }

  // Remove a method from its class (the row's 🗑 button). Guarded by a sender scan: a
  // selector nothing sends goes without a question and is announced afterwards, while one
  // that still has senders raises a confirmation naming them (see safeDelete.ts). Nothing
  // is committed either way (the user commits explicitly, same as every other Explorer
  // edit). After removal the class's method set changed, so re-cascade the method panes.
  async removeMethod(node: MethodItem): Promise<void> {
    const session = this.session();
    if (!session || this.state.className === undefined) return;

    const className = this.state.className;
    const selector = node.info.selector;
    const side = node.isMeta ? `${className} class` : className;

    // Kernel/system classes can't be modified in this repository, so a removal
    // there can only fail. Guard before prompting (mirrors createNewMethod's
    // canClassBeWritten check) rather than popping a modal that leads nowhere.
    if (!queries.canClassBeWritten(session, className, this.state.dictIndex)) {
      void vscode.window.showWarningMessage(`${className} cannot be modified in this repository.`);
      return;
    }

    // An override is the common case, and for it the sender scan is both expensive and
    // beside the point: if a superclass still implements the selector, every send that
    // resolved here simply resolves there instead and nothing is left calling into a hole.
    // Asking the hierarchy first is bounded by its depth, where the sender scan is a
    // whole-image walk that, for an ordinary selector like #printOn:, would list hundreds
    // of methods that were never going to break.
    //
    // The check is deliberately one-directional: finding an implementor above skips the
    // scan, but failing to find one only means we fall through and ask, so a hierarchy
    // probe that under-reports (it reads environment 0) costs a question, never a wrong
    // silent delete.
    const inheritedFrom = this.superclassImplementorOf(session, className, selector, node.isMeta);

    const scan = inheritedFrom
      ? { references: [] as queries.MethodSearchResult[], scanFailed: undefined, truncated: false }
      : await this.scanReferences(`Finding senders of #${selector}…`, (env) =>
          queries.sendersOf(session, selector, env),
        );
    const target: SafeDeleteTarget = {
      kind: 'method',
      label: `#${selector} from ${side}`,
      // The method's own send of its own selector goes away with it, so a recursive method
      // is not a method with a surviving sender.
      //
      // The environment is part of what makes it "its own" send. A class can implement the
      // same selector on the same side in two environments, and those are two different
      // methods: only the one being removed disappears. Matching on class/side/selector
      // alone crossed off the OTHER environment's method as if it were this one's recursion,
      // hiding a sender that really does survive — the under-report this guard exists to
      // prevent. The pane removes the environment-0 method (see EXPLORER_METHOD_ENVIRONMENT),
      // so that is the row, and only that row, which goes away with it.
      references: scan.references.filter(
        (r) =>
          !(
            r.className === className &&
            r.isMeta === node.isMeta &&
            r.selector === selector &&
            r.environmentId === EXPLORER_METHOD_ENVIRONMENT
          ),
      ),
      scanFailed: scan.scanFailed,
      truncated: scan.truncated,
      // Says what actually happens to the senders, rather than the untrue "nothing
      // referenced it" the plain silent path would report.
      silentNote: inheritedFrom
        ? `senders now resolve to ${inheritedFrom} >> #${selector}`
        : undefined,
    };

    // One row in the pane can stand for the same selector in several environments, and only
    // the environment-0 one is removed. Say which are left, on the confirmation and on the
    // notification alike — a removal that silently leaves an implementation standing is the
    // kind of thing you find out about much later.
    const alsoIn = this.otherEnvironmentsImplementing(node.isMeta, selector);
    if (alsoIn.length > 0) {
      const envList = alsoIn.map((e) => `environment ${e}`).join(', ');
      const stays = `${side} also implements #${selector} in ${envList}; only the environment ${EXPLORER_METHOD_ENVIRONMENT} method is removed.`;
      target.note = target.note ? `${target.note}\n\n${stays}` : stays;
      target.silentNote = target.silentNote
        ? `${target.silentNote}; ${side} still implements it in ${envList}`
        : `${side} still implements it in ${envList}`;
    }

    const decision = await decideSafeDelete(session.id, target);
    if (decision === 'cancelled') return;

    // deleteMethod reports failure two ways: a non-"Deleted:" status string
    // (class/selector not found) or a raised error (e.g. removeSelector: on an
    // unwritable class). Surface either — otherwise the pane just redraws with
    // the method still present and the user thinks the click didn't register.
    let result: string;
    try {
      result = queries.deleteMethod(
        session,
        className,
        node.isMeta,
        selector,
        this.state.dictIndex,
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Remove method failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (!result.startsWith('Deleted:')) {
      void vscode.window.showErrorMessage(`Remove method failed: ${result}`);
      return;
    }
    if (decision === 'silent') announceSilentDelete(target);
    this.reloadCurrentClassMethods();
  }

  // ── Find Class ────────────────────────────────────────────────────────────

  // Show a type-to-filter list of every class (the same UX as the old System
  // Browser "Find Class…"), then cascade the new panes to the chosen class:
  // select its dictionary and class-category, reveal the class row, and open its
  // definition. An explicit `name` arg (programmatic callers) skips the picker.
  async findClass(name?: string, sessionId?: number): Promise<void> {
    // Resolve rather than require a pre-selected session: if one session is
    // logged in it's chosen automatically (a bare getSelectedSession() no-ops).
    // An explicit sessionId (GemStone Search) pins the reveal to the result's own session.
    const session = await this.resolveSessionFor(sessionId);
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

  // Reveal+select a dictionary row by name in the Dictionaries pane (used by GemStone
  // Search). Resolves the 1-based symbol-list index from the live list, cascades
  // the panes to that dictionary, and highlights its row. Warns on an unknown name.
  async revealDictionaryByName(name: string, sessionId?: number): Promise<void> {
    const session = await this.resolveSessionFor(sessionId);
    if (!session) return;
    const names = queries.getDictionaryNames(session);
    const idx = names.indexOf(name);
    if (idx < 0) {
      void vscode.window.showWarningMessage(`No dictionary matching "${name}".`);
      return;
    }
    const item = new DictItem(name, idx + 1);
    this.selectDict(item);
    try {
      await this.views?.dict.reveal(item, { select: true, focus: true });
    } catch (e) {
      // No longer swallowed silently: log it so a future failure is diagnosable from the GCI log
      // (mirrors the category-reveal path below).
      logWarning(
        `GemStone Search dictionary reveal failed for ${name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Reveal+select a class-category node by path in the Categories pane (used by GemStone Search). Selects
  // the home dictionary first (so its categories load + the classes pane filters to the category),
  // then selects and reveals the category node itself.
  async revealCategoryByPath(
    dictName: string,
    categoryPath: string,
    sessionId?: number,
  ): Promise<void> {
    const session = await this.resolveSessionFor(sessionId);
    if (!session) return;
    const names = queries.getDictionaryNames(session);
    const idx = names.indexOf(dictName);
    if (idx < 0) {
      void vscode.window.showWarningMessage(`No dictionary matching "${dictName}".`);
      return;
    }
    this.selectDict(new DictItem(dictName, idx + 1));

    // Check the category actually exists in this dictionary's loaded forest BEFORE mutating the
    // category/classes panes. selectDict has just (synchronously) loaded classCategoryEntries, so
    // allCategoryPaths() is valid here. Note the dictionary selection above has ALREADY been applied
    // and is meant to stick — landing on the home dictionary is still useful. Doing the check first
    // means a missing category leaves only the category/classes panes untouched instead of scrolling
    // them to a node that isn't there — the jump would otherwise silently appear to do nothing (the
    // reported "strange spot").
    if (
      !this.allCategoryPaths().some((p) => p === categoryPath || p.startsWith(`${categoryPath}-`))
    ) {
      void vscode.window.showWarningMessage(
        `Category "${categoryPath}" was not found in ${dictName}.`,
      );
      return;
    }

    const segment = categoryPath.split('-').pop() ?? categoryPath;
    const catItem = new ClassCategoryItem(segment, categoryPath, false);
    this.selectClassCategory(catItem);

    // Surface the Class Categories view FIRST. When it lives in a collapsed/hidden sidebar,
    // TreeView.reveal() can no-op — which is exactly how a GemStone Search category jump looked like it landed
    // nowhere (a flat dictionary reveal is less sensitive, so dictionary jumps still worked). Focusing
    // the view makes the subsequent nested reveal land on the real node.
    try {
      await vscode.commands.executeCommand('gemstoneExplorerCategories.focus');
    } catch {
      /* the view id may be absent in some hosts — fall through to the best-effort reveal */
    }
    try {
      await this.views?.dict.reveal(new DictItem(dictName, idx + 1), { select: true });
      await this.views?.category.reveal(catItem, { select: true, focus: true, expand: true });
    } catch (e) {
      // No longer swallowed silently: log it so a future failure is diagnosable from the GCI log.
      logWarning(
        `GemStone Search category reveal failed for ${dictName}/${categoryPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
    this.pendingNewMethod = undefined;
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
      // Select the method under its own category node (expanding as needed), not
      // the ALL METHODS node. The ALL_METHODS_CATEGORY lookup just enumerates all
      // selectors; each info carries its real category.
      const info = this.selectorsFor(opts.revealMethod.isMeta, ALL_METHODS_CATEGORY).find(
        (i) => i.selector === opts.revealMethod!.selector,
      );
      if (info) {
        await this.revealMethodRow(opts.revealMethod.isMeta, info, { focusEditorAfter: true });
        this.syncTitles();
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
    // delete() consumes just this URI's mark, leaving any other in-flight self-open
    // to still match its own event.
    if (this.selfOpenedUris.delete(uri.toString())) {
      return;
    }
    // Nobody claimed this open and it lands on a test item's document: it is a
    // click on a row in the Testing view, whose navigation is its own.
    if (!this.attributedOpens.delete(uri.toString()) && this.sunit?.isTestItemUri(uri)) {
      return;
    }
    const session = this.session();
    if (!session || String(session.id) !== uri.authority) return;

    // Only a saved method or a class definition drives the navigator; a comment
    // or a new-* template (and anything unparseable) is left alone.
    let parsed: ParsedUri;
    try {
      parsed = parseUri(uri);
    } catch {
      return;
    }
    if (parsed.kind !== 'method' && parsed.kind !== 'definition') return;
    const { dictName, className } = parsed;

    const revealMethod =
      parsed.kind === 'method' ? { selector: parsed.selector, isMeta: parsed.isMeta } : undefined;

    // Already showing this class: just (re)reveal the method row / refresh title.
    if (this.state.className === className && this.state.dictName === dictName) {
      if (revealMethod) {
        // If the Methods pane already has this selector selected — which is exactly
        // the case when the user just clicked it in the tree (that click is what
        // opened this editor) — don't re-reveal it. A redundant reveal() scrolls the
        // pane, knocking the just-clicked row out of view. Only sync when the tree
        // is genuinely elsewhere, e.g. the user focused an editor tab for a method
        // that isn't the current selection. This is the reliable guard; the
        // self-opened-URI check above can miss when the editor reports a normalized
        // URI that no longer string-matches what we stored.
        const alreadySelected = this.views?.method.selection.some(
          (n) =>
            n instanceof MethodItem &&
            n.isMeta === revealMethod.isMeta &&
            n.info.selector === revealMethod.selector,
        );
        if (alreadySelected) {
          this.syncTitles();
          return;
        }
        const info = this.selectorsFor(revealMethod.isMeta, ALL_METHODS_CATEGORY).find(
          (i) => i.selector === revealMethod.selector,
        );
        if (info) {
          await this.revealMethodRow(revealMethod.isMeta, info, { focusEditorAfter: true });
          this.syncTitles();
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
    this.onSymbolListChanged?.(session.id);
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
    this.onSymbolListChanged?.(session.id);
    void vscode.window.setStatusBarMessage(`Removed dictionary ${node.dictName}`, 4000);
  }

  // Rename a dictionary on the symbol list. A SymbolDictionary's name is a
  // self-referential entry it holds by identity, so the rename is a reflective
  // swap (see queries/renameDictionary): its symbol-list index does not change and
  // classes it holds are untouched. Source that names the dictionary literally is
  // NOT rewritten, so the confirmation calls that out. Nothing is committed.
  async renameDictionary(node: DictItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    const oldName = node.dictName;
    const entered = await vscode.window.showInputBox({
      title: 'Rename Dictionary',
      prompt: `Rename dictionary "${oldName}" on the symbol list.`,
      value: oldName,
      valueSelection: [0, oldName.length],
      validateInput: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Enter a dictionary name.';
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) {
          return 'A dictionary name must be a Smalltalk identifier (a letter followed by letters, digits, or underscores).';
        }
        return undefined;
      },
    });
    if (entered === undefined) return;
    const newName = entered.trim();
    if (newName === oldName) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Rename dictionary "${oldName}" to "${newName}"?`,
      {
        modal: true,
        detail:
          `Renames it on this session’s symbol list. Source that names the dictionary literally ` +
          `(e.g. "objectNamed: #${oldName}") is NOT rewritten. Classes it holds are unaffected, and ` +
          `nothing is committed until you commit the session.`,
      },
      'Rename',
    );
    if (confirmed !== 'Rename') return;

    let result: string;
    try {
      result = queries.renameDictionary(session, node.dictIndex, newName);
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Could not rename "${oldName}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (result !== 'ok') {
      // Server-side refusal (system dictionary, name collision, not found).
      void vscode.window.showErrorMessage(`Could not rename "${oldName}": ${result}`);
      return;
    }
    // Open editor tabs for classes in this dictionary still embed the OLD name in
    // their URIs; close the clean ones and warn about unsaved ones (MED-1).
    await this.closeStaleTabsForRenamedDictionary(session, oldName);
    // The dictionary keeps its symbol-list position, so its index is unchanged. Redraw
    // the pane; if the user was browsing this dictionary, keep their class/method
    // selection (LOW-5) by updating its name in state and refreshing-retaining rather
    // than selectDict (which resets it). Reveal the renamed row WITHOUT re-selecting
    // it — a select would fire selectDict and clear the retained selection.
    this.dictProvider.refresh();
    if (this.state.dictIndex === node.dictIndex) {
      this.state.dictName = newName;
      await this.refreshRetainingSelection();
    }
    try {
      await this.views?.dict.reveal(new DictItem(newName, node.dictIndex), { select: false });
    } catch {
      /* ignore */
    }
    this.onSymbolListChanged?.(session.id);
    void vscode.window.setStatusBarMessage(`Renamed dictionary ${oldName} → ${newName}`, 4000);
  }

  // Rename a class category within the selected dictionary. Every class filed
  // under the category -- exactly, or in its dash-segmented subtree -- is
  // reassigned server-side via Class>>category: (see queries/renameClassCategory);
  // nothing is recompiled or committed. A still-empty category that exists only in
  // the client "fresh" overlay is carried across the rename in the overlay.
  async renameClassCategory(item: ClassCategoryItem): Promise<void> {
    const session = this.session();
    if (!session) return;
    if (this.state.dictIndex === undefined) {
      void vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }
    const dictIndex = this.state.dictIndex;
    const oldPath = item.fullPath;
    // Rename only this single node of the dash-segmented category tree, never the
    // whole path: prompt with the last segment and rebuild the full path from the
    // unchanged parent. Dashes are rejected so a rename can't graft on new subtree
    // levels (or a trailing '-' empty category) -- it changes exactly one node, and
    // the subtree beneath it moves with it (handled by renameClassCategory).
    const oldSegment = item.segment;
    const parentPath =
      oldPath.length > oldSegment.length
        ? oldPath.slice(0, oldPath.length - oldSegment.length - 1)
        : '';
    // Pre-3.7 stones can't compile a doit whose source carries a non-ASCII (wide)
    // string literal -- the category name is interpolated as a literal, so a wide
    // name crashes the 3.6.x compiler (`ComStrmSetCursor`, error 1001). 3.7+ handles
    // UTF-8 source (same boundary as server UTF-8 file-in), so only guard below it,
    // turning that crash into a clear message. The existing name is guarded here (the
    // user can't edit it); the new name is also guarded live in validateInput.
    const blockNonAscii = !supportsServerUtf8FileIn(session.stoneVersion);
    // Iterate by code point (surrogate-safe) so astral chars are detected too.
    const hasNonAscii = (s: string): boolean =>
      [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
    if (blockNonAscii && hasNonAscii(oldPath)) {
      void vscode.window.showErrorMessage(
        `Cannot rename category '${oldPath}': non-ASCII category names aren't supported on GemStone ${session.stoneVersion}. Upgrade to 3.7 or later.`,
      );
      return;
    }
    const entered = await vscode.window.showInputBox({
      title: 'Rename Class Category',
      prompt: parentPath
        ? `Rename category node '${oldSegment}' under '${parentPath}' and everything beneath it. Not committed automatically.`
        : `Rename category node '${oldSegment}' and everything beneath it. Not committed automatically.`,
      value: oldSegment,
      valueSelection: [0, oldSegment.length],
      validateInput: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Enter a category name.';
        if (t.includes('-')) return "Enter a single category node (no '-').";
        if (blockNonAscii && hasNonAscii(t))
          return `Non-ASCII names aren't supported on GemStone ${session.stoneVersion} (needs 3.7+).`;
        return undefined;
      },
    });
    if (entered === undefined) return;
    const newSegment = entered.trim();
    if (newSegment === oldSegment) return;
    const newPath = parentPath ? `${parentPath}-${newSegment}` : newSegment;

    const inSubtree = (c: string): boolean => c === oldPath || c.startsWith(`${oldPath}-`);
    // Always run the query rather than gating on the cached classCategoryEntries: the
    // cache can be stale — another session may have filed a class into this category
    // since the last refresh — and the query answers `renamed: 0` harmlessly when
    // nothing matches (MED-3). Remember what the client *believed* was there so a
    // zero count can be flagged as a likely stale view instead of silent success.
    const clientExpectedClasses = this.classCategoryEntries.some((e) => inSubtree(e.category));
    let result: string;
    try {
      result = queries.renameClassCategory(session, dictIndex, oldPath, newPath);
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Rename class category failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Success is exactly `renamed: <n>` (optionally ` skipped: <m>`). Anything else —
    // 'Dictionary not found', or an unrecognised payload — is a failure and must not
    // fall through to the success message (MED-2).
    const renamedMatch = /^renamed: (\d+)(?: skipped: (\d+))?$/.exec(result);
    if (!renamedMatch) {
      void vscode.window.showErrorMessage(`Rename class category failed: ${result}`);
      return;
    }
    const renamedCount = parseInt(renamedMatch[1], 10);
    const skippedCount = renamedMatch[2] ? parseInt(renamedMatch[2], 10) : 0;
    // Warn (instead of reporting success) when the server moved nothing though the
    // client thought the category had classes — a stale view (MED-2/MED-3) — or when
    // some classes were skipped because their category couldn't be read (LOW-2).
    let warned = false;
    if (renamedCount === 0 && clientExpectedClasses) {
      warned = true;
      void vscode.window.showWarningMessage(
        `No classes were moved for category '${oldPath}' — the view may have been out of date. Refreshed.`,
      );
    } else if (skippedCount > 0) {
      warned = true;
      void vscode.window.showWarningMessage(
        `Renamed '${oldPath}' → '${newPath}', but ${skippedCount} class${skippedCount === 1 ? '' : 'es'} could not be read and ${skippedCount === 1 ? 'was' : 'were'} left unchanged.`,
      );
    }

    // Carry empty overlay categories in the subtree across, preserving the suffix.
    for (const c of [...this.newClassCategories]) {
      if (inSubtree(c)) {
        this.newClassCategories.delete(c);
        this.newClassCategories.add(newPath + c.slice(oldPath.length));
      }
    }
    if (this.state.classCategory !== undefined && inSubtree(this.state.classCategory)) {
      this.state.classCategory = newPath + this.state.classCategory.slice(oldPath.length);
    }

    // Class categories changed, so refetch the dictionary's class/category data
    // and redraw, then reveal the renamed category.
    this.classCategoryEntries = queries.getClassesWithCategory(session, dictIndex);
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
    const segment = newPath.split('-').pop() ?? newPath;
    try {
      await this.views?.category.reveal(new ClassCategoryItem(segment, newPath, false), {
        select: true,
        expand: true,
      });
    } catch {
      /* ignore */
    }
    if (!warned) {
      void vscode.window.setStatusBarMessage(
        `Renamed class category ${oldPath} → ${newPath}`,
        4000,
      );
    }
  }

  // Remove a class from its dictionary. `item` comes from the inline trash on a
  // Classes-pane or Hierarchy-pane row; falls back to the selected class. The delete
  // is dict-scoped (a shadowed name deletes the one the user sees). If the class has
  // subclasses it's all-or-none: confirm removing the whole subtree, or cancel.
  // A leaf class nothing references goes without a confirmation and is announced instead
  // (see safeDelete.ts); references from inside the doomed subtree don't count, since they
  // go with it. Nothing is committed — the user commits the session.
  async removeClass(item?: ClassItem | HierarchyItem): Promise<void> {
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
    } else if (this.state.className !== undefined) {
      className = this.state.className;
      dictName = this.state.dictName;
      dictIndex = this.state.dictIndex;
    }
    if (className === undefined || dictName === undefined || dictIndex === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }

    // Kernel/system classes can't be modified in this repository — guard before prompting.
    if (!queries.canClassBeWritten(session, className, dictIndex)) {
      void vscode.window.showWarningMessage(`${className} cannot be modified in this repository.`);
      return;
    }

    // The transitive subtree, resolved dict-scoped so a shadowed root walks its OWN
    // lineage; each descendant carries the dictionary that binds it BY OBJECT IDENTITY
    // (not by name), so a subclass whose name is shadowed in another dictionary still
    // resolves to its own class, never a same-named one elsewhere.
    const descendants = queries.getClassDescendantNames(session, className, dictIndex);

    // Resolve and vet the whole subtree BEFORE prompting, so the all-or-none promise
    // holds: if any member can't be located in a dictionary or can't be written, abort
    // deleting nothing rather than half-removing the subtree. The root is already
    // writable-checked above.
    const targets: { className: string; dictName: string; dictIndex: number }[] = [
      { className, dictName, dictIndex },
    ];
    const blockers: string[] = [];
    for (const d of descendants) {
      if (d.dictIndex <= 0) {
        blockers.push(`${d.className} (not found in any dictionary)`);
      } else if (!queries.canClassBeWritten(session, d.className, d.dictIndex)) {
        blockers.push(`${d.className} (not writable)`);
      } else {
        targets.push({ className: d.className, dictName: d.dictName, dictIndex: d.dictIndex });
      }
    }
    if (blockers.length > 0) {
      void vscode.window.showErrorMessage(
        `Cannot remove ${className} and its subclasses (all-or-none) — blocked by: ${blockers.join('; ')}.`,
      );
      return;
    }

    // A method that references the class from INSIDE the doomed subtree goes away with it
    // (Doomed class >> new naming Doomed, a subclass's own method), so it is no reason to
    // ask. What is left is the references that will still be there afterwards.
    //
    // A doomed class is identified by name AND home dictionary, never by name alone. The
    // scan deliberately resolves its target through the dictionary by object identity so a
    // same-named class elsewhere does not collide; excluding on the bare name puts that
    // collision straight back, because an unrelated class that merely SHARES a name with
    // something in the subtree would have its real, surviving reference thrown away — and
    // the delete would then go through silently as "nothing references it". Over-matching
    // here is the one failure this guard cannot afford, so the key carries the dictionary.
    //
    // The two sides derive a home dictionary by slightly different rules (the descendant
    // walk takes the first dictionary binding the class object; a result row takes the
    // first that binds it under its own name, skipping alias entries), so an aliased class
    // can fail to match. That costs a confirmation that was not strictly needed, which is
    // the direction to err in: asking too often is a nuisance, not a lost reference.
    const doomedKey = (className: string, dictName: string) => `${className}|${dictName}`;
    const doomed = new Set(targets.map((t) => doomedKey(t.className, t.dictName)));
    const scan = await this.scanReferences(`Finding references to ${className}…`, (env) =>
      queries.referencesToClassInDict(session, className, dictIndex, env),
    );
    const target: SafeDeleteTarget = {
      kind: 'class',
      label: `${className} from ${dictName}`,
      references: scan.references.filter((r) => !doomed.has(doomedKey(r.className, r.dictName))),
      scanFailed: scan.scanFailed,
      truncated: scan.truncated,
      // Subclasses always earn a confirmation: removing the subtree takes classes the user
      // did not click on, whether or not anything outside references them.
      blockers: descendants.map((d) => d.className),
      blockerLead: `Subclass${descendants.length === 1 ? '' : 'es'} removed with it (all or none)`,
      note: 'Nothing is committed until you commit the session.',
      confirmLabel: descendants.length > 0 ? 'Remove All' : undefined,
    };

    const decision = await decideSafeDelete(session.id, target);
    if (decision === 'cancelled') return;

    const failures: string[] = [];
    const removed: string[] = [];
    for (const t of targets) {
      try {
        const result = queries.deleteClass(session, t.dictIndex, t.className);
        if (result.startsWith('Deleted class:')) removed.push(t.className);
        else failures.push(`${t.className}: ${result}`);
      } catch (e: unknown) {
        failures.push(`${t.className}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Drop the removed class from selection/hierarchy and reload the current dict's
    // class list so the pane reflects the deletion.
    if (this.state.className === className) {
      this.state.className = undefined;
      this.envLines = [];
      this.hierChain = [];
      this.hierSubs = [];
    }
    if (this.state.dictIndex !== undefined) {
      this.classCategoryEntries = queries.getClassesWithCategory(session, this.state.dictIndex);
      this.loadDefinedIvarCounts();
    }
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();

    // Views that cache a class corpus can't see this deletion — it is uncommitted, so nothing else
    // announces it, and until now a removed class stayed listed (and clickable) in an open GemStone
    // Search until the next commit/abort resync. Notify the ones that ACTUALLY went, so a partial
    // failure doesn't drop a class that is still there.
    for (const name of removed) this.onClassRemoved?.(session.id, name);

    if (failures.length > 0) {
      void vscode.window.showErrorMessage(`Remove class had errors — ${failures.join('; ')}`);
    } else if (decision === 'silent') {
      // Nothing was asked, so the status bar alone is too quiet for a whole class going away.
      announceSilentDelete(target);
    } else if (targets.length > 1) {
      const n = targets.length - 1;
      void vscode.window.setStatusBarMessage(
        `Removed ${className} and ${n} subclass${n === 1 ? '' : 'es'}`,
        4000,
      );
    } else {
      void vscode.window.setStatusBarMessage(`Removed class ${className}`, 4000);
    }
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

  // Add a (still-empty) method category to the given side. The instance and
  // class "+" buttons pass their side explicitly, so it never depends on the
  // last-touched selection.
  async newMethodCategory(isMeta: boolean): Promise<void> {
    if (this.state.className === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    const name = (
      await vscode.window.showInputBox({
        prompt: `New ${isMeta ? 'Class' : 'Instance'} Method Category`,
        placeHolder: 'e.g. accessing',
      })
    )?.trim();
    if (!name) return;
    this.newMethodCategories[isMeta ? 'meta' : 'instance'].add(name);
    this.recordMethodContext(isMeta, name);
    this.methodProvider.refresh();
    this.syncTitles();
    // Select the new category (expanding the side node — the class side starts
    // collapsed, so otherwise the fresh category would be created out of sight).
    this.views?.method
      .reveal(new MethodCategoryItem(isMeta, name, false), {
        select: true,
        focus: true,
        expand: true,
      })
      .then(undefined, () => {});
  }

  // Rename a real (non-computed) method category via the row's pencil. A category
  // exists on the server only once a method is filed into it; a still-empty one
  // lives solely in the client-side "fresh" overlay (`_unifiedCategorys:`, which
  // drives this pane, never lists an empty category). So a populated category is
  // renamed server-side via the base `renameCategory:to:` protocol (mirroring the
  // System Browser; not committed automatically), while an empty one is renamed
  // purely in the overlay — calling the server would raise classErrMethCatNotFound.
  async renameMethodCategory(item: MethodCategoryItem): Promise<void> {
    const session = this.session();
    if (!session || item.computed) return;
    if (this.state.className === undefined || this.state.dictIndex === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    const className = this.state.className;
    const dictIndex = this.state.dictIndex;
    const oldCategory = item.category;

    const entered = await vscode.window.showInputBox({
      title: 'Rename Method Category',
      prompt: `Rename '${oldCategory}' on the ${item.isMeta ? 'class' : 'instance'} side of ${className}.`,
      value: oldCategory,
      valueSelection: [0, oldCategory.length],
      validateInput: (v) => (v.trim().length === 0 ? 'Enter a category name.' : undefined),
    });
    if (entered === undefined) return;
    const newCategory = entered.trim();
    if (newCategory === oldCategory) return;

    const hasServerMethods = this.envLines.some(
      (l) => l.isMeta === item.isMeta && l.category === oldCategory,
    );
    if (hasServerMethods) {
      try {
        queries.renameCategory(
          session,
          className,
          item.isMeta,
          oldCategory,
          newCategory,
          dictIndex,
        );
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Rename category failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    }

    // Carry a just-created (still-empty) category across the rename so it keeps
    // showing, and keep the recorded selection pointing at the renamed row.
    const freshSet = this.newMethodCategories[item.isMeta ? 'meta' : 'instance'];
    if (freshSet.delete(oldCategory)) freshSet.add(newCategory);
    if (
      this.state.selectedIsMeta === item.isMeta &&
      this.state.selectedMethodCategory === oldCategory
    ) {
      this.state.selectedMethodCategory = newCategory;
    }
    // A server rename changed the class's methods, so refetch; an overlay-only
    // rename just needs the tree redrawn.
    if (hasServerMethods) {
      this.reloadIfCurrent(className, dictIndex);
    } else {
      this.methodProvider.refresh();
      this.syncTitles();
    }
    this.views?.method
      .reveal(new MethodCategoryItem(item.isMeta, newCategory, false), {
        select: true,
        focus: true,
      })
      .then(undefined, () => {});
  }

  // New Method, invoked from a category row → files into THAT category (including
  // a still-empty one, which the compile then creates on the server, so overlay
  // categories become real once they hold a method). With no argument (palette)
  // it infers side/category from the current Methods-pane selection.
  async newMethod(target?: MethodCategoryItem): Promise<void> {
    if (target instanceof MethodCategoryItem) {
      // Computed ALL/SESSION rows aren't real categories → default category.
      await this.createNewMethod(
        target.isMeta,
        target.computed ? 'as yet unclassified' : target.category,
      );
      return;
    }
    if (this.state.className === undefined) {
      // The controller lost its className (e.g. a category click) but a class row
      // may still be highlighted — adopt it so "New Method" acts on what the user
      // sees selected (this also reloads its methods and hierarchy).
      const fromTree = this.selectedClassInTree();
      if (fromTree) this.selectClass(fromTree);
    }
    if (this.state.className === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    // Honor the last-touched side, else default to the side the Methods pane is
    // currently showing (the instance/class title toggle) — a new method lands on
    // the side you're looking at.
    const isMeta = this.state.selectedIsMeta ?? this.showClassMethods;
    const category =
      this.state.selectedIsMeta === isMeta && this.state.selectedMethodCategory
        ? this.state.selectedMethodCategory
        : 'as yet unclassified';
    await this.createNewMethod(isMeta, category);
  }

  // "+" on the instance / class side node adds a method on that side; with no
  // category chosen it lands in the default one (which then appears in the tree).
  async newInstanceMethod(): Promise<void> {
    await this.createNewMethod(false, 'as yet unclassified');
  }

  async newClassMethod(): Promise<void> {
    await this.createNewMethod(true, 'as yet unclassified');
  }

  // Open a blank method template for the given side + category. The method only
  // exists once the user saves (compile), so remember what to select and let the
  // post-compile refresh reveal it (see maybeRevealNewMethod).
  private async createNewMethod(isMeta: boolean, category: string): Promise<void> {
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
    // Snapshot the side's current selectors so the post-compile refresh can spot
    // the newly-added one and select it (the selector isn't known until save).
    this.pendingNewMethod = {
      className: this.state.className,
      dictIndex: this.state.dictIndex,
      isMeta,
      before: new Set(this.selectorsFor(isMeta, ALL_METHODS_CATEGORY).map((i) => i.selector)),
    };
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
    // A preview tab, like a single-click navigation open: the next preview
    // replaces it, and it counts as the navigation editor (remembered below) so
    // "open to the side" doesn't mistake its group for the side group.
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
    });
    this.placement.remember(uri);
  }

  // After a method compiles on the class we're showing, select a just-created
  // method (from the New Method "+") under its own category — so a brand-new
  // category shows the method selected. reveal()'s alreadySelected guard in
  // syncToEditor then skips its own ALL-METHODS reveal, avoiding a fight.
  private maybeRevealNewMethod(): void {
    const pending = this.pendingNewMethod;
    if (
      !pending ||
      pending.className !== this.state.className ||
      pending.dictIndex !== this.state.dictIndex
    ) {
      return;
    }
    const added = this.selectorsFor(pending.isMeta, ALL_METHODS_CATEGORY).find(
      (i) => !pending.before.has(i.selector),
    );
    if (!added) return;
    this.pendingNewMethod = undefined;
    void this.revealMethodRow(pending.isMeta, added, { focusEditorAfter: true });
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
    this.maybeRevealNewMethod();
  }

  onExternalClassCompiled(sessionId: number, className: string, dictName?: string): void {
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
      return;
    }
    // Otherwise the class was created in a dictionary other than the selected one
    // — e.g. a new class whose `inDictionary:` names a different dictionary. Jump
    // the explorer to where the class actually lives so it's revealed there,
    // rather than leaving the panes on a dictionary that doesn't contain it.
    const resolved = this.resolveClassDict(className, dictName);
    if (resolved) {
      void this.revealClass(resolved.dictName, resolved.dictIndex, className);
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

// Lead a pane's root rows with a filter chip when a filter is active, so every
// filterable pane shows (and can clear) its filter the same way (see
// FilterChipItem / MethodProvider). Panes render the chip identically because the
// chip carries its own view id.
function withFilterChip<T>(
  viewId: string,
  ctl: ExplorerController,
  rows: T[],
): (T | FilterChipItem)[] {
  const filter = ctl.getFilter(viewId);
  return filter === undefined ? rows : [new FilterChipItem(viewId, filter), ...rows];
}

class DictProvider extends RefreshableProvider<DictItem | FilterChipItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  // Flat list — every row is a root. getParent is required for TreeView.reveal.
  getParent(): DictItem | undefined {
    return undefined;
  }
  getChildren(element?: DictItem | FilterChipItem): (DictItem | FilterChipItem)[] {
    if (element) return [];
    const session = this.ctl.session();
    if (!session) return [];
    const rows = queries
      .getDictionaryNames(session)
      .map((name, i) => new DictItem(name, i + 1))
      .filter((d) => filterMatches(d.dictName, this.ctl.getFilter(VIEW_DICTS)));
    return withFilterChip(VIEW_DICTS, this.ctl, rows);
  }
}

class CategoryProvider extends RefreshableProvider<ClassCategoryItem | FilterChipItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassCategoryItem | FilterChipItem): ClassCategoryItem | undefined {
    if (element instanceof FilterChipItem) return undefined;
    return this.ctl.categoryParent(element.fullPath);
  }
  getChildren(
    element?: ClassCategoryItem | FilterChipItem,
  ): (ClassCategoryItem | FilterChipItem)[] {
    if (this.ctl.state.dictName === undefined || element instanceof FilterChipItem) return [];
    if (!element) {
      // While filtering, drop the tree and list matching full category paths flat.
      const rows = this.ctl.categoryFilterActive()
        ? this.ctl.filteredCategoryPaths().map((p) => new ClassCategoryItem(p, p, false))
        : this.ctl
            .categoryChildren(undefined)
            .map((n) => new ClassCategoryItem(n.segment, n.fullPath, n.hasChildren));
      return withFilterChip(VIEW_CATEGORIES, this.ctl, rows);
    }
    return this.ctl
      .categoryChildren(element.fullPath)
      .map((n) => new ClassCategoryItem(n.segment, n.fullPath, n.hasChildren));
  }
}

class ClassProvider extends RefreshableProvider<ClassNode | FilterChipItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassNode | FilterChipItem): ClassNode | undefined {
    if (element instanceof IvarItem) return new VarSideItem(element.className, false);
    if (element instanceof ClassVarItem) return new VarSideItem(element.className, true);
    if (element instanceof VarSideItem) return new ClassItem(element.className);
    return undefined;
  }
  getChildren(element?: ClassNode | FilterChipItem): (ClassNode | FilterChipItem)[] {
    if (this.ctl.state.dictName === undefined || element instanceof FilterChipItem) return [];
    if (!element) {
      const rows = this.ctl.classNames().map((n) => {
        const item = new ClassItem(
          n,
          this.ctl.classHasDefinedVars(n),
          this.ctl.classVersion(n),
          this.ctl.classHasComment(n),
        );
        this.ctl.decorateTestRow(item, this.ctl.state.dictName, n);
        return item;
      });
      return withFilterChip(VIEW_CLASSES, this.ctl, rows);
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
  // Walk up the category ▸ selector tree so TreeView.reveal can locate a method
  // row (used by editor-focus → navigator sync). The instance/class side is a
  // title-bar toggle, not a tree level, so a category is a root. Nodes match by
  // their stable ids, so freshly-built parents resolve to the rendered ones.
  getParent(element: MethodNode): MethodNode | undefined {
    if (element instanceof MethodItem) {
      if (element.displayCategory === undefined) return undefined;
      const computed =
        element.displayCategory === ALL_METHODS_CATEGORY ||
        element.displayCategory === SESSION_METHODS_CATEGORY;
      return new MethodCategoryItem(element.isMeta, element.displayCategory, computed);
    }
    // Category rows and the filter chip are roots.
    return undefined;
  }
  getChildren(element?: MethodNode): MethodNode[] {
    if (this.ctl.state.className === undefined) return [];

    if (!element) {
      // Roots are the active side's rows. Filtering respects the grouping setting:
      // categories off → a flat list of matching selectors; categories on → the
      // category structure, pruned to categories that contain a match (see
      // methodCategories). An empty filter is a no-op.
      const isMeta = this.ctl.showClassMethods;
      const filter = this.ctl.getFilter(VIEW_METHODS);
      const rows: MethodNode[] = !this.ctl.groupMethodsByCategory()
        ? this.ctl.flatMethods(isMeta, filter)
        : this.ctl.methodCategories(isMeta, filter);
      // While filtering, lead with a filter chip (funnel row + inline ✕) so the
      // active filter reads distinctly from the method rows and can be cleared
      // here — the same helper the other three panes use.
      return withFilterChip(VIEW_METHODS, this.ctl, rows);
    }
    if (element instanceof MethodCategoryItem) {
      const filter = this.ctl.getFilter(VIEW_METHODS);
      // When the CATEGORY NAME is what matched the filter, show everything inside it
      // (#387 item 7). Filtering the selectors too would render the category the user
      // just searched for as an empty folder, since its methods generally do not start
      // with their category's name.
      const nameMatched =
        filter !== undefined && this.ctl.methodCategoryMatchesFilter(element.category, filter);
      return this.ctl
        .selectorsFor(element.isMeta, element.category)
        .filter(
          (info) =>
            filter === undefined ||
            nameMatched ||
            this.ctl.methodMatchesFilter(element.isMeta, info.selector, filter),
        )
        .map((info) => {
          const item = new MethodItem(
            element.isMeta,
            info,
            element.category,
            this.ctl.methodSourceUri(element.isMeta, info),
            this.ctl.ivarAccessMark(element.isMeta, info.selector, filter),
          );
          this.ctl.decorateTestRow(
            item,
            this.ctl.state.dictName,
            this.ctl.state.className ?? '',
            info.selector,
            element.isMeta,
          );
          return item;
        });
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
  onClassCompiled(sessionId: number, className: string, dictName?: string): void;
  onSessionAborted(sessionId: number): void;
  /** Flash a green ✅ connection-success banner atop the Dictionaries view for a
   * few seconds (called after a successful login). */
  showConnectedBanner(stone: string): void;
  /** Claim an about-to-happen open so it navigates the panes; see
   *  ExplorerController.markAttributedOpen. */
  markAttributedOpen(uri: vscode.Uri): void;
  /** Drop a claim whose open never fired an editor-change; see
   *  ExplorerController.clearAttributedOpen. */
  clearAttributedOpen(uri: vscode.Uri): void;
  /** Navigate the panes to `uri`'s class/method — the explicit Reveal action a
   *  Testing-view row offers, since a plain click deliberately does not. */
  revealDocument(uri: vscode.Uri): Promise<void>;
}

export function registerGemStoneExplorer(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  // LSP-backed "full selector at this position" resolver, used by the editor-
  // triggered Rename Method to target a SENT selector under the cursor. Optional
  // so tests (and a not-yet-started LSP) degrade to renaming the edited method.
  selectorAtPosition: SelectorAtPosition = () => Promise.resolve(null),
  // Called after a dictionary add/remove/rename so other views (GemStone Search) can refresh their
  // cached symbol-list corpus.
  onSymbolListChanged?: (sessionId: number) => void,
  // Called once per class that Remove Class actually deleted, so GemStone Search can drop it from its
  // cached corpus instead of showing (and offering to open) a class that no longer exists.
  onClassRemoved?: (sessionId: number, className: string) => void,
  // Test affordances on class/method rows. Late-bound, because the SUnit controller is
  // built after this one.
  sunit?: ExplorerSunitHooks,
): ExplorerHandle {
  const ctl = new ExplorerController(
    sessionManager,
    onSymbolListChanged,
    onClassRemoved,
    context.globalState,
    sunit,
  );

  // A run starting or finishing changes what these rows should say, so repaint the
  // three panes that carry test affordances. Cheap — the providers rebuild rows from
  // state already fetched, with no trip to the stone.
  if (sunit) {
    context.subscriptions.push(
      sunit.onDidChangeResults(() => {
        ctl.classProvider.refresh();
        ctl.hierarchyProvider.refresh();
        ctl.methodProvider.refresh();
      }),
    );
  }

  // A status-bar "Close All GemStone Editors" button, tallying the open
  // gemstone:// source editors; it is session-independent, so it registers on
  // its own.
  registerOpenEditorsStatusBar(context);

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
  // Seed the Methods-pane grouping context key (which title toggle shows) from the
  // saved setting, and keep it in step if the setting changes elsewhere.
  ctl.syncMethodGrouping();
  // Seed the instance/class side context key (defaults to instance).
  ctl.syncMethodSide();

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
  const hierarchyView = vscode.window.createTreeView('gemstoneExplorerClassHierarchy', {
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
    const node = e.selection[0];
    if (node instanceof DictItem) ctl.selectDict(node);
  });
  categoryView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    if (node instanceof ClassCategoryItem) ctl.selectClassCategory(node);
  });
  classView.onDidChangeSelection((e) => {
    // Only a class row navigates; selecting an ivar child is inert (it's acted on
    // via its inline pencil, not selection). Skip when the class is already the
    // selected one so a click doesn't run selectClass twice — the row's classClicked
    // command also (re)selects; between the two, exactly one runs per click.
    const node = e.selection[0];
    if (node instanceof ClassItem && node.className !== ctl.state.className) ctl.selectClass(node);
  });
  hierarchyView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectHierarchyNode(e.selection[0]);
  });
  hierarchyView.onDidChangeVisibility((e) => ctl.onHierarchyVisibilityChanged(e.visible));
  methodView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    // Record the category context so New Method(-Category) defaults there. The
    // side is the title-bar toggle now, not a selectable row.
    if (node instanceof MethodItem) {
      ctl.recordMethodContext(node.isMeta, node.info.category);
      void ctl.openMethod(node);
    } else if (node instanceof MethodCategoryItem) {
      ctl.recordMethodContext(node.isMeta, node.computed ? undefined : node.category);
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
    // Per-pane clear-filter command (palette / programmatic). The in-pane filter
    // chip's ✕ is the primary affordance now (see clearFilterChip below).
    ...EXPLORER_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.clearFilter`, () => ctl.clearFilter(viewId)),
    ),
    // The filter-chip row's inline ✕ — clears the filter for whichever pane the
    // chip belongs to (it carries its own view id).
    vscode.commands.registerCommand(
      'gemstone.explorer.clearFilterChip',
      (item?: FilterChipItem) => {
        if (item instanceof FilterChipItem) ctl.clearFilter(item.viewId);
      },
    ),
    vscode.commands.registerCommand('gemstone.explorer.openMethodToSide', (node: MethodItem) => {
      if (node instanceof MethodItem) void ctl.openMethod(node, 'pin');
    }),
    // The inline ▶ on a test method row. Runs through the same command the System
    // Browser uses, so the result lands in the Testing view like every other run.
    vscode.commands.registerCommand('gemstone.explorer.runTestMethod', (node?: MethodItem) => {
      if (!(node instanceof MethodItem)) return;
      const { dictName, className } = ctl.state;
      if (dictName === undefined || className === undefined) return;
      void vscode.commands.executeCommand('gemstone.runSunitMethods', dictName, className, [
        node.info.selector,
      ]);
    }),
    // The mirror of Reveal in GemStone Explorer: go from a row here to the same
    // test in the Testing view. Offered on the rows that carry a `.test` token,
    // so it is never on a row the Testing view has nothing for.
    vscode.commands.registerCommand(
      'gemstone.explorer.revealInTestingView',
      async (node?: ClassItem | HierarchyItem | MethodItem) => {
        if (!node || !sunit) return;
        const dictName = node instanceof HierarchyItem ? node.dictName : ctl.state.dictName;
        // A method row names its class through the pane's current selection; a class
        // or hierarchy row names it directly.
        const className = node instanceof MethodItem ? ctl.state.className : node.className;
        const selector = node instanceof MethodItem ? node.info.selector : undefined;
        if (dictName === undefined || className === undefined) return;
        if (!(await sunit.revealInTestExplorer(dictName, className, selector))) {
          void vscode.window.showInformationMessage(
            `The Testing view has no test for ${className}${selector ? `>>${selector}` : ''}.`,
          );
        }
      },
    ),

    // The inline ▶ on a test class row, in the Classes pane or the Hierarchy pane.
    // A hierarchy row carries its own dictionary — an ancestor test class often
    // lives in a different one than the class being browsed.
    vscode.commands.registerCommand(
      'gemstone.explorer.runTestClass',
      (node?: ClassItem | HierarchyItem) => {
        const dictName = node instanceof HierarchyItem ? node.dictName : ctl.state.dictName;
        if (!node || dictName === undefined) return;
        void vscode.commands.executeCommand('gemstone.runSunitClass', {
          dictName,
          className: node.className,
        });
      },
    ),
    vscode.commands.registerCommand('gemstone.explorer.removeMethod', (node?: MethodItem) => {
      if (node instanceof MethodItem)
        void ctl.removeMethod(node).catch((e: unknown) => {
          void vscode.window.showErrorMessage(
            `Remove method failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    }),
    vscode.commands.registerCommand('gemstone.explorer.removeClass', (node?: unknown) => {
      const item = node instanceof ClassItem || node instanceof HierarchyItem ? node : undefined;
      void ctl.removeClass(item).catch((e: unknown) => {
        void vscode.window.showErrorMessage(
          `Remove class failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }),
    // Ctrl/Cmd+Enter in the Methods pane: open the selected method in a new
    // source editor to the side (same as the row's ↗ button). Keybindings don't
    // pass the tree selection, so read it from the view here.
    vscode.commands.registerCommand('gemstone.explorer.openSelectedMethodToSide', () => {
      const node = methodView.selection[0];
      if (node instanceof MethodItem) void ctl.openMethod(node, 'pin');
    }),
    // Find Class: cascade the panes to a class by name (from the Classes pane
    // title button or the command palette). The optional sessionId lets a caller (GemStone Search) target
    // the session its result came from rather than whatever session is selected now.
    vscode.commands.registerCommand(
      'gemstone.explorer.findClass',
      (name?: string, sessionId?: number) =>
        ctl.findClass(
          typeof name === 'string' ? name : undefined,
          typeof sessionId === 'number' ? sessionId : undefined,
        ),
    ),
    // Reveal+select a dictionary row by name (GemStone Search dictionary results). Optional sessionId
    // as above — the result carries the session it was found in.
    vscode.commands.registerCommand(
      'gemstone.explorer.revealDictionary',
      (name?: string, sessionId?: number) =>
        typeof name === 'string'
          ? ctl.revealDictionaryByName(name, typeof sessionId === 'number' ? sessionId : undefined)
          : undefined,
    ),
    // Reveal+select a class-category node by dict + path (GemStone Search category results). Optional
    // sessionId as above.
    vscode.commands.registerCommand(
      'gemstone.explorer.revealCategory',
      (dictName?: string, categoryPath?: string, sessionId?: number) =>
        typeof dictName === 'string' && typeof categoryPath === 'string'
          ? ctl.revealCategoryByPath(
              dictName,
              categoryPath,
              typeof sessionId === 'number' ? sessionId : undefined,
            )
          : undefined,
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
    // Open a class's editable comment as a preview tab (inline button on the class
    // row / Classes-pane toolbar). A class comment is often the first place a
    // developer looks — and usually just a look, hence preview rather than pinned.
    vscode.commands.registerCommand(
      'gemstone.explorer.openComment',
      (item?: ClassItem) => void ctl.openClassComment(item instanceof ClassItem ? item : undefined),
    ),
    // Same button on a Hierarchy node — opens that class's definition to the side
    // (resolving its own dictionary), without navigating the panels.
    vscode.commands.registerCommand(
      'gemstone.explorer.openHierarchyDefinition',
      (item?: HierarchyItem) => {
        if (item instanceof HierarchyItem) void ctl.openHierarchyDefinition(item);
      },
    ),
    // Same class-comment button on a Hierarchy node.
    vscode.commands.registerCommand(
      'gemstone.explorer.openHierarchyComment',
      (item?: HierarchyItem) => {
        if (item instanceof HierarchyItem) void ctl.openHierarchyComment(item);
      },
    ),
    // Per-click hook powering double-click-to-open-definition.
    vscode.commands.registerCommand('gemstone.explorer.classClicked', (className?: string) => {
      if (typeof className === 'string') ctl.handleClassClick(className);
    }),
    // Per-click hook powering double-click-to-promote-the-preview-tab.
    vscode.commands.registerCommand('gemstone.explorer.methodClicked', (node?: MethodItem) => {
      if (node instanceof MethodItem) ctl.handleMethodClick(node);
    }),
    // Methods-pane title toggle: group under categories, or list methods flat.
    // Both write the persistent setting; the config listener re-renders the pane.
    vscode.commands.registerCommand(
      'gemstone.explorer.groupMethodsByCategory',
      () => void ctl.setGroupMethodsByCategory(true),
    ),
    vscode.commands.registerCommand(
      'gemstone.explorer.showMethodsFlat',
      () => void ctl.setGroupMethodsByCategory(false),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.explorer.groupMethodsByCategory'))
        ctl.syncMethodGrouping();
    }),
    // Methods-pane title toggle: show the instance side or the class side (the
    // pane shows one at a time; the side level is no longer a tree row).
    vscode.commands.registerCommand('gemstone.explorer.showClassMethods', () =>
      ctl.setMethodSide(true),
    ),
    vscode.commands.registerCommand('gemstone.explorer.showInstanceMethods', () =>
      ctl.setMethodSide(false),
    ),
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
    // Filter the Methods pane to the readers / writers / references of an ivar
    // (its row's context menu) — seeds a reads:/writes:/accesses: token.
    vscode.commands.registerCommand('gemstone.explorer.filterReadersOfIvar', (item?: IvarItem) => {
      if (item instanceof IvarItem) ctl.filterMethodsByIvar('reads', item.ivarName, item.className);
    }),
    vscode.commands.registerCommand('gemstone.explorer.filterWritersOfIvar', (item?: IvarItem) => {
      if (item instanceof IvarItem)
        ctl.filterMethodsByIvar('writes', item.ivarName, item.className);
    }),
    vscode.commands.registerCommand(
      'gemstone.explorer.filterReferencesToIvar',
      (item?: IvarItem) => {
        if (item instanceof IvarItem)
          ctl.filterMethodsByIvar('accesses', item.ivarName, item.className);
      },
    ),
    // Add / remove an instance variable (V1).
    vscode.commands.registerCommand('gemstone.explorer.addInstVar', (item?: unknown) => {
      if (item instanceof VarSideItem) void ctl.addInstVarFromSide(item);
      else if (item instanceof ClassItem) void ctl.addInstVarOnClass(item.className);
    }),
    // Add a class variable (lightweight — no reshape/migration; see addClassVarOnClass).
    vscode.commands.registerCommand('gemstone.explorer.addClassVar', (item?: unknown) => {
      if (item instanceof VarSideItem) void ctl.addClassVarFromSide(item);
      else if (item instanceof ClassItem) void ctl.addClassVarOnClass(item.className);
    }),
    // Generate getter/setter accessors for the variable at the row: instance-side for
    // an instance variable, class-side for a class variable. Skips ones that exist.
    vscode.commands.registerCommand('gemstone.explorer.addAccessors', (item?: unknown) => {
      if (item instanceof IvarItem)
        void ctl.generateAccessorsFor(item.className, item.ivarName, 'ivar');
      else if (item instanceof ClassVarItem)
        void ctl.generateAccessorsFor(item.className, item.classVarName, 'classvar');
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
    // The single "Rename…" entry: figure out what the cursor is on (selector,
    // temporary, instance variable, or class variable) and dispatch to the specific
    // rename below. Consolidates the four rename actions (#328 item 2).
    vscode.commands.registerCommand('gemstone.rename', (position?: unknown) => {
      void renameAtCursorCommand(
        sessionManager,
        selectorAtPosition,
        position instanceof vscode.Position ? position : undefined,
      );
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
    // Rename the class referenced at the cursor in a method source editor — routes
    // into the same shared flow as the Explorer's class-row pencil.
    vscode.commands.registerCommand('gemstone.renameClassAtCursor', (position?: unknown) => {
      void renameClassAtCursorCommand(
        sessionManager,
        (target) => ctl.renameClassNamed(target.className, target.dict),
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
    // Remove a class variable (lightweight — no reshape/preview; see removeClassVar).
    vscode.commands.registerCommand('gemstone.explorer.removeClassVar', (item?: ClassVarItem) => {
      if (!(item instanceof ClassVarItem)) return;
      void ctl.removeClassVar(item).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Remove class variable failed: ${msg}`);
      });
    }),
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
    // Rename a method category / protocol (pencil on the category row).
    vscode.commands.registerCommand(
      'gemstone.explorer.renameMethodCategory',
      (item?: MethodCategoryItem) => {
        if (!(item instanceof MethodCategoryItem)) return;
        void ctl.renameMethodCategory(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Rename category failed: ${msg}`);
        });
      },
    ),
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
    // Insert an empty superclass above a class (context menu on a class row or hierarchy node).
    vscode.commands.registerCommand(
      'gemstone.explorer.insertSuperclass',
      (item?: ClassItem | HierarchyItem) => {
        if (!(item instanceof ClassItem) && !(item instanceof HierarchyItem)) return;
        void ctl.insertSuperclass(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Insert superclass failed: ${msg}`);
        });
      },
    ),
    // Extract a common superclass above a class + chosen siblings, hoisting shared members.
    vscode.commands.registerCommand(
      'gemstone.explorer.extractSuperclass',
      (item?: ClassItem | HierarchyItem) => {
        if (!(item instanceof ClassItem) && !(item instanceof HierarchyItem)) return;
        void ctl.extractSuperclass(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Extract superclass failed: ${msg}`);
        });
      },
    ),
    // Split a class: extract chosen instance variables + their methods into a new component class.
    vscode.commands.registerCommand(
      'gemstone.explorer.splitClass',
      (item?: ClassItem | HierarchyItem) => {
        if (!(item instanceof ClassItem) && !(item instanceof HierarchyItem)) return;
        void ctl.splitClass(item).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Split class failed: ${msg}`);
        });
      },
    ),
    vscode.commands.registerCommand('gemstone.explorer.removeDictionary', (node?: unknown) => {
      if (node instanceof DictItem) void ctl.removeDictionary(node);
    }),
    vscode.commands.registerCommand('gemstone.explorer.renameDictionary', (node?: unknown) => {
      if (node instanceof DictItem) void ctl.renameDictionary(node);
    }),
    vscode.commands.registerCommand('gemstone.explorer.renameClassCategory', (node?: unknown) => {
      if (node instanceof ClassCategoryItem) void ctl.renameClassCategory(node);
    }),
    // New (+) actions, one per pane.
    vscode.commands.registerCommand('gemstone.explorer.newDictionary', () => ctl.newDictionary()),
    vscode.commands.registerCommand('gemstone.explorer.newClassCategory', () =>
      ctl.newClassCategory(),
    ),
    vscode.commands.registerCommand('gemstone.explorer.newClass', () => ctl.newClass()),
    // "+" on the instance / class side node adds a category to that side. Two
    // commands so each button carries its own title.
    vscode.commands.registerCommand('gemstone.explorer.newInstanceMethodCategory', () =>
      ctl.newMethodCategory(false),
    ),
    vscode.commands.registerCommand('gemstone.explorer.newClassMethodCategory', () =>
      ctl.newMethodCategory(true),
    ),
    // Methods-pane title "+": add a category to whichever side the pane is
    // currently showing (the instance/class level is a title toggle now).
    vscode.commands.registerCommand('gemstone.explorer.newMethodCategory', () =>
      ctl.newMethodCategory(ctl.showClassMethods),
    ),
    // From a category row, file the new method straight into that category;
    // from the palette / title bar (no item), infer side + category from the
    // active side and selection.
    vscode.commands.registerCommand('gemstone.explorer.newMethod', (item?: MethodCategoryItem) =>
      ctl.newMethod(item instanceof MethodCategoryItem ? item : undefined),
    ),
    // "+" on the instance / class side node → new method in the default category.
    vscode.commands.registerCommand('gemstone.explorer.newInstanceMethod', () =>
      ctl.newInstanceMethod(),
    ),
    vscode.commands.registerCommand('gemstone.explorer.newClassMethod', () => ctl.newClassMethod()),
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
      ctl.highlightActiveEditor(editor);
      if (editor) void ctl.syncToEditor(editor.document.uri);
    }),
    ivarHighlightDecoration,
  );

  // A green connection-success banner at the top of the Dictionaries view, shown
  // briefly after a login. The ✅ emoji renders green in every theme (including
  // High Contrast), and TreeView.message sits above the tree without stealing space
  // or focus — unlike a status-bar color (which can't be green) or a webview panel
  // (which is far too large for a transient flash).
  const CONNECTED_BANNER_MS = 5000;
  let connectedBannerTimer: ReturnType<typeof setTimeout> | undefined;
  function showConnectedBanner(stone: string): void {
    if (connectedBannerTimer) clearTimeout(connectedBannerTimer);
    const message = `✅ Connected to ${stone}`;
    dictView.message = message;
    connectedBannerTimer = setTimeout(() => {
      connectedBannerTimer = undefined;
      // Only clear our own banner — a newer message (or another connect) wins.
      if (dictView.message === message) dictView.message = undefined;
    }, CONNECTED_BANNER_MS);
  }

  return {
    onMethodCompiled: (sessionId, className) => ctl.onExternalMethodCompiled(sessionId, className),
    onClassCompiled: (sessionId, className, dictName) =>
      ctl.onExternalClassCompiled(sessionId, className, dictName),
    onSessionAborted: (sessionId) => ctl.onSessionAborted(sessionId),
    showConnectedBanner,
    markAttributedOpen: (uri) => ctl.markAttributedOpen(uri),
    clearAttributedOpen: (uri) => ctl.clearAttributedOpen(uri),
    revealDocument: (uri) => ctl.revealDocument(uri),
  };
}
