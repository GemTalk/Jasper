import * as vscode from 'vscode';
import type { ProvideDocumentFormattingEditsSignature } from 'vscode-languageclient';
import { isClassDefinitionUri } from './languageIds';

/**
 * Why the client refuses this request instead of the server.
 *
 * `documentFormattingProvider` is one boolean for the whole language server
 * (`server/src/server.ts`), so the server cannot advertise the formatter for some of
 * its documents and not others. It answers a class definition with an empty edit
 * list, which VS Code applies — zero edits — and reports as nothing at all: Format
 * Document appears to do nothing and says nothing about why, the complaint this
 * PR set out to fix for method editors.
 *
 * Narrowing the document selector would not work either: a definition shares the
 * `gemstone-smalltalk` language with workspaces, `.gst` files, the debugger's source
 * views and new-method editors, and those format. Giving definitions a language of
 * their own — the trick that keeps class comments out, where VS Code raises its own
 * "no formatter installed" — would drop them out of the selector for *every* request,
 * costing completion, hover, diagnostics, folding and document symbols. A definition
 * is code; it wants all of those. A comment is prose and wants none, which is why the
 * cheap fix is right there and wrong here.
 *
 * So the refusal lives here, in front of the request. Definitions are excluded only
 * until the `compileClassDefinition` round trip is checked (see `docs/formatter.md`);
 * when it is, delete this middleware and they format like any other Smalltalk.
 */
export const CLASS_DEFINITION_NOT_FORMATTABLE =
  'Format Document is not available for class definitions.';

/**
 * `Middleware.provideDocumentFormattingEdits`: answer a class-definition editor with
 * a message rather than passing the request to the server, which would return no
 * edits silently. Every other document goes straight through.
 */
export function provideDocumentFormattingEdits(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
  token: vscode.CancellationToken,
  next: ProvideDocumentFormattingEditsSignature,
): vscode.ProviderResult<vscode.TextEdit[]> {
  if (isClassDefinitionUri(document.uri)) {
    void vscode.window.showInformationMessage(CLASS_DEFINITION_NOT_FORMATTABLE);
    return [];
  }
  return next(document, options, token);
}
