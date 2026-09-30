import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { renderGrailStub, selectorKind, WrapSelector } from './grailStub';

// Shared flow behind every "Generate Grail .py Stub" entry point (Explorer
// context menu, Command Palette, System Browser menu): reflect the class, let
// the user pick which methods to scaffold as @smalltalk wrappers, render the
// module, and save it to a file they choose.
export async function generateAndSaveGrailStub(
  session: ActiveSession,
  className: string,
  dictName: string,
  dictIndex?: number,
): Promise<void> {
  const reflection = await queries.getGrailStubReflection(
    session,
    className,
    dictIndex ?? dictName,
  );
  if (!reflection.found) {
    void vscode.window.showWarningMessage(`Can't reflect on class ${className}.`);
    return;
  }

  // Accessors and binary selectors are handled by the generator directly, so
  // they're not offered as method-wrapper candidates: accessor selectors would
  // duplicate the get_/set_ block, and binaries can't be named automatically.
  const accessorSelectors = new Set<string>();
  for (const iv of reflection.instVars) {
    if (iv.hasGetter) accessorSelectors.add(iv.name);
    if (iv.hasSetter) accessorSelectors.add(`${iv.name}:`);
  }
  const candidates = reflection.methods.filter(
    (m) =>
      selectorKind(m.selector) !== 'binary' &&
      !(m.side === 'instance' && accessorSelectors.has(m.selector)),
  );

  let wrapSelectors: WrapSelector[] = [];
  if (candidates.length) {
    const picked = await vscode.window.showQuickPick(
      candidates.map((m) => ({
        label: m.selector,
        description: `${m.side} · ${m.category}`,
        method: m,
      })),
      {
        canPickMany: true,
        matchOnDescription: true,
        title: `Wrap methods of ${className}`,
        placeHolder:
          'Select methods to scaffold as @smalltalk wrappers (none = slots + accessors only)',
      },
    );
    if (picked === undefined) return; // dismissed
    wrapSelectors = picked.map((p) => ({ side: p.method.side, selector: p.method.selector }));
  }

  const source = renderGrailStub({
    className,
    dictionaryName: dictName,
    reflection,
    wrapSelectors,
  });

  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const uri = await vscode.window.showSaveDialog({
    title: `Generate Grail .py stub for ${className}`,
    defaultUri: wsRoot ? vscode.Uri.file(path.join(wsRoot, `${className}.py`)) : undefined,
    filters: { 'Python Files': ['py'], 'All Files': ['*'] },
  });
  if (!uri) return;

  fs.writeFileSync(uri.fsPath, source, 'utf8');
  void vscode.window.showTextDocument(uri);
}
