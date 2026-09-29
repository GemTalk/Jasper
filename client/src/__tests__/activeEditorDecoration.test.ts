import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { Uri } from '../__mocks__/vscode';
import { ActiveEditorDecorationProvider, explorerRowUri } from '../activeEditorDecoration';

const METHOD = 'gemstone://1/UserGlobals/Array/instance/accessing/at%3A';
const OTHER = 'gemstone://1/UserGlobals/Array/instance/accessing/size';

describe('ActiveEditorDecorationProvider', () => {
  it('decorates the row whose source is the active editor', () => {
    const provider = new ActiveEditorDecorationProvider();
    provider.setActiveEditor(Uri.parse(METHOD));

    const decoration = provider.provideFileDecoration(Uri.parse(METHOD));

    expect(decoration?.color).toBeDefined();
    expect(decoration?.tooltip).toBe('Shown in the active editor');
  });

  it("tints the Methods-pane row, whose URI is the method's marked as a row", () => {
    const provider = new ActiveEditorDecorationProvider();
    provider.setActiveEditor(Uri.parse(METHOD));

    expect(provider.provideFileDecoration(explorerRowUri(Uri.parse(METHOD)))?.color).toBeDefined();
    expect(provider.provideFileDecoration(explorerRowUri(Uri.parse(OTHER)))).toBeUndefined();
  });

  it('refreshes the row as well as the editor when the active editor moves', () => {
    const provider = new ActiveEditorDecorationProvider();
    const fired: string[] = [];
    provider.onDidChangeFileDecorations((e) => {
      for (const u of Array.isArray(e) ? e : e ? [e] : []) fired.push(u.toString());
    });

    provider.setActiveEditor(Uri.parse(METHOD));

    expect(fired).toEqual([METHOD, explorerRowUri(Uri.parse(METHOD)).toString()]);
  });

  it('leaves other rows undecorated', () => {
    const provider = new ActiveEditorDecorationProvider();
    provider.setActiveEditor(Uri.parse(METHOD));

    expect(provider.provideFileDecoration(Uri.parse(OTHER))).toBeUndefined();
  });

  it('never decorates a non-gemstone resource', () => {
    const provider = new ActiveEditorDecorationProvider();
    provider.setActiveEditor(Uri.parse(METHOD));

    expect(provider.provideFileDecoration(Uri.parse('file:///tmp/x.st'))).toBeUndefined();
  });

  it('moves the decoration when the active editor changes, refreshing both rows', () => {
    const provider = new ActiveEditorDecorationProvider();
    const fired: string[] = [];
    provider.onDidChangeFileDecorations((e) => {
      for (const u of Array.isArray(e) ? e : e ? [e] : []) fired.push(u.toString());
    });

    provider.setActiveEditor(Uri.parse(METHOD));
    provider.setActiveEditor(Uri.parse(OTHER));

    expect(provider.provideFileDecoration(Uri.parse(METHOD))).toBeUndefined();
    expect(provider.provideFileDecoration(Uri.parse(OTHER))?.color).toBeDefined();
    // the second switch fires both the outgoing (METHOD) and incoming (OTHER) rows
    expect(fired).toContain(METHOD);
    expect(fired).toContain(OTHER);
  });

  it('clears the decoration when the active editor is not a gemstone document', () => {
    const provider = new ActiveEditorDecorationProvider();
    provider.setActiveEditor(Uri.parse(METHOD));

    provider.setActiveEditor(Uri.parse('file:///tmp/x.st'));

    expect(provider.provideFileDecoration(Uri.parse(METHOD))).toBeUndefined();
  });
});
