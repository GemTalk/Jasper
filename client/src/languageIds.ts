import * as vscode from 'vscode';
import { parseMethodUri, parseUri } from './gemstoneFileSystemProvider';

/**
 * The language ids Jasper assigns to the documents it opens, and the rule that
 * picks between them.
 *
 * Why a method editor has a language of its own
 * ---------------------------------------------
 * `contributes.breakpoints` names a *language*, and VS Code offers the
 * breakpoint gutter wherever that language is — it gives no way to narrow the
 * offer by URI scheme or document. Jasper shows GemStone Smalltalk in five
 * kinds of document, and only one of them, the source of a compiled method
 * behind a `gemstone://` URI, can carry a breakpoint: a GemStone breakpoint is
 * a step point in a compiled method, so there is nothing in a workspace, a
 * `.gst` file, or the debugger's read-only source views for one to attach to.
 *
 * With a single language id the gutter was offered in all five and had to be
 * withdrawn after the click — the dot appeared, a warning fired, the dot
 * vanished. Splitting the method editors onto `gemstone-method` and naming only
 * that id in `contributes.breakpoints` means the gutter is never offered
 * anywhere else, so there is nothing to refuse.
 *
 * Both ids are GemStone Smalltalk and are treated as such throughout: the
 * grammar, the `editor/context` `when` clauses, the language client's document
 * selector and the per-language editor defaults all name the pair. The split is
 * about where a breakpoint may be offered, and nothing else.
 */

/** Smalltalk that is not the source of a compiled method: a workspace, a `.gst` file, the debugger's read-only source. */
export const SMALLTALK_LANGUAGE = 'gemstone-smalltalk';

/** The source of a compiled method, behind a `gemstone://` URI — the only document a breakpoint can be set in. */
export const METHOD_LANGUAGE = 'gemstone-method';

/** A class comment is prose, not code: it word-wraps and is not highlighted as Smalltalk. */
export const CLASS_COMMENT_LANGUAGE = 'gemstone-class-comment';

/**
 * The two halves of the breakpoint split: the languages Jasper's *own* editors —
 * a method, a workspace, a `.gst` file, a notebook cell, the debugger's
 * read-only source — are given.
 *
 * Not every GemStone document: a Topaz `.gs` file and a Tonel `.st` file are
 * GemStone Smalltalk source too, and are deliberately out. This set exists to
 * answer "did a breakpoint here come from an offer of ours?", and the gutter has
 * only ever been contributed for the ids listed here — so those are the only
 * ones there is anything of ours to take back. A breakpoint on a Topaz or Tonel
 * file came from somewhere else and is left where it is.
 */
export const SMALLTALK_LANGUAGES = [SMALLTALK_LANGUAGE, METHOD_LANGUAGE] as const;

/**
 * Whether `uri` is the source of a compiled method — the one document a GemStone
 * breakpoint can be armed on.
 *
 * Deliberately the same test `BreakpointManager.applyToUri` makes before it
 * touches the gem: a saved, compiled method (`parseUri` kind `method`) that is
 * not an override *diff view*. Everything else behind the scheme has no compiled
 * method to hold a step point — a class definition, a `new-method` template that
 * has never been compiled, a `new-class` template — and the read-only diff view
 * shows two versions of a method at once, so a line in it does not name one.
 *
 * Both the language a document is given and the refusal that backstops it are
 * derived from this, so the gutter is offered exactly where a breakpoint can be
 * armed and the two can't drift apart.
 */
export function isMethodSourceUri(uri: vscode.Uri): boolean {
  const method = parseMethodUri(uri); // null unless scheme is gemstone and kind is 'method'
  return method !== null && !method.diffView;
}

/**
 * The language id for a `gemstone://` document.
 *
 * A class comment is prose. A compiled method's source gets the language that
 * `contributes.breakpoints` names. Everything else behind the scheme is
 * Smalltalk source with nothing to arm, so it is offered no gutter — as is an
 * unrecognized URI, which has no compiled method either.
 */
export function gemstoneDocumentLanguage(uri: vscode.Uri): string {
  let kind: string;
  try {
    kind = parseUri(uri).kind;
  } catch {
    return SMALLTALK_LANGUAGE; // unrecognized URI — treat as plain source
  }
  if (kind === 'comment') return CLASS_COMMENT_LANGUAGE;
  return isMethodSourceUri(uri) ? METHOD_LANGUAGE : SMALLTALK_LANGUAGE;
}
