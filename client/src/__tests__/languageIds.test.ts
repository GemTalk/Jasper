import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { Uri } from '../__mocks__/vscode';
import {
  BREAKPOINT_GUTTER_LANGUAGES,
  CLASS_COMMENT_LANGUAGE,
  METHOD_LANGUAGE,
  SMALLTALK_LANGUAGE,
  gemstoneDocumentLanguage,
  isMethodSourceUri,
  methodSourceRef,
} from '../languageIds';

const METHOD = 'gemstone://1/Globals/Array/instance/accessing/at%3A';
const DEFINITION = 'gemstone://1/Globals/Array/definition';
const COMMENT = 'gemstone://1/Globals/Array/comment';
const NEW_METHOD = 'gemstone://1/Globals/Array/instance/accessing/new-method';
const NEW_CLASS = 'gemstone://1/Globals/new-class';
// The override diff decorates the selector segment with a display label; its
// presence is what marks the document a read-only comparison of two versions.
const DIFF_VIEW = 'gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)';

// A method editor was split onto its own language id so `contributes.breakpoints`
// can name it alone — VS Code offers the breakpoint gutter by language and gives
// no way to narrow the offer by URI scheme. So the question these tests ask is
// always the same one: is this a document a GemStone breakpoint could be armed
// on? Only there may the gutter appear.
describe('gemstoneDocumentLanguage', () => {
  it("gives a compiled method's source the language breakpoints are offered for", () => {
    expect(gemstoneDocumentLanguage(Uri.parse(METHOD))).toBe(METHOD_LANGUAGE);
  });

  it('gives a class comment its own language — prose, not code', () => {
    expect(gemstoneDocumentLanguage(Uri.parse(COMMENT))).toBe(CLASS_COMMENT_LANGUAGE);
  });

  it.each([
    ['a class definition', DEFINITION],
    ['a new-method template that has never been compiled', NEW_METHOD],
    ['a new-class template', NEW_CLASS],
    ['a read-only override diff view', DIFF_VIEW],
  ])('leaves %s on plain Smalltalk, so it is offered no gutter', (_what, uri) => {
    expect(gemstoneDocumentLanguage(Uri.parse(uri))).toBe(SMALLTALK_LANGUAGE);
  });

  it('treats an unrecognized gemstone:// URI as plain source rather than throwing', () => {
    // parseUri throws FileNotFound on a shape it does not know. A document whose
    // URI cannot be parsed has no compiled method behind it either, so plain
    // source is both the safe answer and the right one.
    expect(gemstoneDocumentLanguage(Uri.parse('gemstone://1/Globals'))).toBe(SMALLTALK_LANGUAGE);
  });

  it('never hands out the method language to anything but a method', () => {
    // The guard on the whole scheme: if any other document reached
    // METHOD_LANGUAGE it would be offered a gutter it must then refuse, which is
    // the behaviour the split exists to remove.
    const others = [DEFINITION, COMMENT, NEW_METHOD, NEW_CLASS, DIFF_VIEW];
    expect(others.map((u) => gemstoneDocumentLanguage(Uri.parse(u)))).not.toContain(
      METHOD_LANGUAGE,
    );
  });
});

describe('isMethodSourceUri', () => {
  it("accepts a compiled method's source", () => {
    expect(isMethodSourceUri(Uri.parse(METHOD))).toBe(true);
  });

  it('rejects the override diff view, which shows two versions at once', () => {
    // A line in the diff does not name one method, and `applyToUri` refuses it
    // for exactly that reason — this is the same test, kept in one place.
    expect(isMethodSourceUri(Uri.parse(DIFF_VIEW))).toBe(false);
  });

  it.each([
    ['a class definition', DEFINITION],
    ['a class comment', COMMENT],
    ['an uncompiled new-method template', NEW_METHOD],
    ['a workspace', 'untitled:Workspace'],
    ['a .gst file on disk', 'file:///tmp/scratch.gst'],
    ["another extension's file", 'file:///tmp/app.py'],
  ])('rejects %s', (_what, uri) => {
    expect(isMethodSourceUri(Uri.parse(uri))).toBe(false);
  });
});

// The ids are a published contract, not an internal name: package.json's
// `contributes.breakpoints`, its language and grammar contributions, the
// `editor/context` `when` clauses and the keybindings all spell them out
// literally, and a user's own settings.json can scope to them. This is the one
// place the literal is written on the code's side — everywhere else, in source
// and in tests alike, uses the constants, so a rename that forgot the manifest
// fails here rather than shipping an id nothing is declared for.
describe('the ids themselves', () => {
  it("are the strings the manifest and users' settings name", () => {
    expect({
      smalltalk: SMALLTALK_LANGUAGE,
      method: METHOD_LANGUAGE,
      comment: CLASS_COMMENT_LANGUAGE,
    }).toEqual({
      smalltalk: 'gemstone-smalltalk',
      method: 'gemstone-method',
      comment: 'gemstone-class-comment',
    });
  });
});

describe('methodSourceRef', () => {
  it('answers the parsed method, which is what applyToUri needs of it', () => {
    // isMethodSourceUri is this same rule read as a yes/no. It answers with the
    // method so `BreakpointManager.applyToUri` — which needs the class, selector
    // and environment right after asking — can share the predicate instead of
    // open-coding a second copy that is free to drift from it.
    expect(methodSourceRef(Uri.parse(METHOD))).toMatchObject({
      className: 'Array',
      selector: 'at:',
      isMeta: false,
    });
  });

  it.each([
    ['a read-only override diff view', DIFF_VIEW],
    ['a class definition', DEFINITION],
    ['an uncompiled new-method template', NEW_METHOD],
    ['a workspace', 'untitled:Workspace'],
  ])('answers null for %s, so applyToUri and the gutter refuse it alike', (_what, uri) => {
    expect(methodSourceRef(Uri.parse(uri))).toBeNull();
  });
});

describe('BREAKPOINT_GUTTER_LANGUAGES', () => {
  it('is exactly the two ids the breakpoint gutter has ever been offered for', () => {
    // Used to decide whether a stray breakpoint came from an offer of OURS, so it
    // must cover both halves of the split and nothing else.
    expect([...BREAKPOINT_GUTTER_LANGUAGES]).toEqual([SMALLTALK_LANGUAGE, METHOD_LANGUAGE]);
  });

  it('leaves out the GemStone languages that were never offered a gutter', () => {
    // A class comment is prose, not source. A Topaz .gs and a Tonel .st file ARE
    // GemStone Smalltalk source, but no gutter was ever contributed for them, so
    // a breakpoint on one did not come from Jasper and must not be taken back.
    const others = [CLASS_COMMENT_LANGUAGE, 'gemstone-topaz', 'gemstone-tonel'];
    expect(
      others.filter((id) => (BREAKPOINT_GUTTER_LANGUAGES as readonly string[]).includes(id)),
    ).toEqual([]);
  });
});
