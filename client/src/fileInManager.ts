import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import { fileInClass } from './topazFileIn';
import { SystemBrowser } from './systemBrowser';
import * as queries from './browserQueries';
import { beginDictionaryRemoval } from './undo/recordDictionaryEdit';
import { notifyUndoable } from './undo/undoableToast';

/**
 * Generate a Topaz file-out template for a new class.
 */
export function newClassTemplate(className: string, dictName: string): string {
  return `! Class definition for ${className}
run
Object subclass: '${className}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: ${dictName}
  category: ''
  options: #()
%

doit
${className} comment: 'A brief description of ${className}.'
%

! ------------------- Class methods for ${className}

category: 'instance creation'
classmethod: ${className}
new

\t^ self basicNew
\t\tinitialize;
\t\tyourself
%

! ------------------- Instance methods for ${className}

category: 'initialization'
method: ${className}
initialize

\tsuper initialize.
%
`;
}

/**
 * Manages file events for exported GemStone .gs files.
 *
 * Handles new class creation (file-in template) and class/dictionary deletion.
 * Method editing is handled via the GemStoneFileSystemProvider (gemstone:// scheme).
 */
export class FileInManager {
  private disposables: vscode.Disposable[] = [];

  constructor(
    private sessionManager: SessionManager,
    private exportManager: ExportManager,
  ) {}

  register(context: vscode.ExtensionContext): void {
    const createSub = vscode.workspace.onDidCreateFiles((e) => {
      for (const file of e.files) {
        this.handleFileCreate(file);
      }
    });
    const deleteSub = vscode.workspace.onDidDeleteFiles((e) => {
      for (const file of e.files) {
        this.handleFileDelete(file);
      }
    });
    this.disposables.push(createSub, deleteSub);
    context.subscriptions.push(createSub, deleteSub);
  }

  private handleFileCreate(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    if (this.exportManager.isWriting) return;

    if (!this.resolveSessionFromPath(uri.fsPath)) return;

    // Append .gs if the file has no extension
    let filePath = uri.fsPath;
    if (!path.extname(filePath)) {
      const newPath = filePath + '.gs';
      fs.renameSync(filePath, newPath);
      filePath = newPath;
    }

    if (!filePath.endsWith('.gs')) return;

    // Check the file is empty (newly created)
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) return;
    } catch {
      return;
    }

    // Extract class name from filename and dictionary name from parent dir
    const className = path.basename(filePath, '.gs');
    const dictDir = path.basename(path.dirname(filePath));
    const dictMatch = dictDir.match(/^\d+-(.*)/);
    const dictName = dictMatch ? dictMatch[1] : dictDir;

    const template = newClassTemplate(className, dictName);
    fs.writeFileSync(filePath, template, 'utf-8');

    // File in the template so the class exists in GemStone
    const session = this.resolveSessionFromPath(filePath);
    if (session) {
      fileInClass(session, template);
      // Reconcile the mirror so the new class is filed under canonical source.
      this.exportManager.scheduleRefresh(session);
      SystemBrowser.refresh(session.id);
    }

    if (filePath !== uri.fsPath) {
      // Close the stale tab for the original file
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input as { uri?: vscode.Uri } | undefined;
          if (input?.uri?.fsPath === uri.fsPath) {
            vscode.window.tabGroups.close(tab);
          }
        }
      }
      // Open the renamed file
      vscode.window.showTextDocument(vscode.Uri.file(filePath));
    }
  }

  private handleFileDelete(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    if (this.exportManager.isWriting) return;

    const session = this.resolveSessionFromPath(uri.fsPath);
    if (!session) return;

    const sessionRoot = this.exportManager.getSessionRoot(session)!;
    const relative = path.relative(sessionRoot, uri.fsPath);
    const parts = relative.split(path.sep);

    if (uri.fsPath.endsWith('.gs') && parts.length >= 2) {
      // Deleting a .gs file → remove class from GemStone
      const dictIndex = this.parseDictIndex(parts[0], session);
      if (!dictIndex) return;
      const className = path.basename(uri.fsPath, '.gs');
      try {
        queries.deleteClass(session, dictIndex, className);
        // The .gs is already gone; drop it from the persisted mirror state too.
        const dictName = parts[0].replace(/^\d+-/, '');
        this.exportManager.removeClassFile(session, dictIndex, dictName, className);
        SystemBrowser.refresh(session.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(
          `Failed to remove class "${className}" from GemStone: ${msg}`,
        );
      }
    } else if (parts.length === 1) {
      // Deleting a dictionary directory → remove dictionary from symbol list
      const dictIndex = this.parseDictIndex(parts[0], session);
      if (!dictIndex) return;
      const dictName = parts[0].replace(/^\d+-/, '');
      // Stash the dictionary and its POSITION before unlisting it, so Undo can put it back
      // with every class it holds (#434). Deleting the mirror directory is the same
      // destructive act as the Explorer's Remove Dictionary, and gets the same way back.
      const recording = beginDictionaryRemoval(session, dictName);
      try {
        queries.removeDictionary(session, dictIndex);
        // Reconcile the mirror (the dir is gone; drop its classes from state).
        this.exportManager.scheduleRefresh(session);
        SystemBrowser.refresh(session.id);
        notifyUndoable(`Removed dictionary ${dictName}`, recording?.commit());
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to remove dictionary from GemStone: ${msg}`);
      }
    }
  }

  /**
   * Extract dictionary index from a directory name.
   * Handles both "{index}-{dictName}" and plain "{dictName}" formats.
   */
  private parseDictIndex(dictDir: string, session: ActiveSession): number | undefined {
    const match = dictDir.match(/^(\d+)-(.*)/);
    if (match) return parseInt(match[1], 10);
    const dictNames = queries.getDictionaryNames(session);
    const idx = dictNames.indexOf(dictDir) + 1;
    return idx > 0 ? idx : undefined;
  }

  /**
   * Map a .gs file path back to the active session whose export area contains it.
   */
  resolveSessionFromPath(fsPath: string): ActiveSession | undefined {
    return this.sessionManager.getSessions().find((session) => {
      const sessionRoot = this.exportManager.getSessionRoot(session);
      if (!sessionRoot) return false;
      const relative = path.relative(sessionRoot, fsPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  /**
   * Check if any open .gs files or gemstone:// method editors for this session
   * have unsaved changes (to warn before commit/abort).
   */
  hasUnsavedChanges(session: ActiveSession): boolean {
    const sessionRoot = this.exportManager.getSessionRoot(session);

    return vscode.workspace.textDocuments.some((doc) => {
      if (!doc.isDirty) return false;
      // gemstone:// method editor for this session
      if (doc.uri.scheme === 'gemstone' && parseInt(doc.uri.authority, 10) === session.id) {
        return true;
      }
      // .gs file under session root (read-only but could be dirty if user bypassed)
      if (sessionRoot && doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(sessionRoot)) {
        return true;
      }
      return false;
    });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
