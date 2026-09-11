import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  CLASS_DEFINITION_NOT_FORMATTABLE,
  provideDocumentFormattingEdits,
} from '../formattingMiddleware';

const METHOD_URI = 'gemstone://1/UserGlobals/V8Contact/instance/accessing/printOn:';
const NEW_METHOD_URI = 'gemstone://1/UserGlobals/V8Contact/instance/accessing/new-method';
const DEFINITION_URI = 'gemstone://1/UserGlobals/V8Contact/definition';
// The 5-segment form, whose trailing repeat makes the tab read as the class name.
const DEFINITION_URI_5 = 'gemstone://1/UserGlobals/V8Contact/definition/V8Contact';
const TOPAZ_URI = 'file:///x/foo.gs';

function doc(uri: string) {
  return { uri: vscode.Uri.parse(uri) } as vscode.TextDocument;
}

const options = {} as vscode.FormattingOptions;
const token = {} as vscode.CancellationToken;

describe('provideDocumentFormattingEdits middleware', () => {
  const showInformationMessage = vscode.window.showInformationMessage as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showInformationMessage.mockClear();
  });

  for (const uri of [DEFINITION_URI, DEFINITION_URI_5]) {
    it(`says why Format Document does nothing on a class definition (${uri})`, () => {
      const next = vi.fn();

      const edits = provideDocumentFormattingEdits(doc(uri), options, token, next);

      // The point of the middleware: the request never reaches the server, because the
      // server would answer it with an empty edit list and no explanation.
      expect(next).not.toHaveBeenCalled();
      expect(edits).toEqual([]);
      expect(showInformationMessage).toHaveBeenCalledWith(CLASS_DEFINITION_NOT_FORMATTABLE);
    });
  }

  for (const [label, uri] of [
    ['a method editor', METHOD_URI],
    ['a new-method editor', NEW_METHOD_URI],
    ['a Topaz file', TOPAZ_URI],
  ] as const) {
    it(`passes ${label} straight through to the server`, () => {
      const serverEdits = [{ newText: 'formatted' }] as vscode.TextEdit[];
      const next = vi.fn().mockReturnValue(serverEdits);
      const d = doc(uri);

      const edits = provideDocumentFormattingEdits(d, options, token, next);

      expect(next).toHaveBeenCalledWith(d, options, token);
      expect(edits).toBe(serverEdits);
      expect(showInformationMessage).not.toHaveBeenCalled();
    });
  }

  it('passes a class comment through rather than claiming it for the definition message', () => {
    // A comment editor never gets here — its gemstone-class-comment language keeps it
    // out of the client's document selector, so VS Code raises its own "no formatter
    // installed" instead. Pinned so the guard stays narrowed to definitions.
    const next = vi.fn().mockReturnValue([]);

    provideDocumentFormattingEdits(
      doc('gemstone://1/UserGlobals/V8Contact/comment'),
      options,
      token,
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(showInformationMessage).not.toHaveBeenCalled();
  });
});
