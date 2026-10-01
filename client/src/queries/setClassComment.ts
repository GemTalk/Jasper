import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';
import { isRealClassComment } from './classCommentPresence';

/**
 * Set the class comment (docstring equivalent). Not committed automatically.
 * `dict` is optional; when given, disambiguates shadowed class names.
 *
 * An empty comment REMOVES the `#comment` key rather than storing `''`, so that
 * emptying the editor (or undoing back past the comment that was added) leaves
 * the class exactly as it was found: `cls comment` goes back to answering
 * GemStone's synthesised placeholder, and a file-out shows no comment rather
 * than an empty one. Storing `''` would already have taken the Explorer's 📖
 * button off the row — {@link isRealClassComment} counts blank as none — but it
 * would have left the class permanently carrying an empty comment.
 *
 * `_extraDictRemoveKey:` is a private accessor, so the removal falls back to
 * storing nil under the key, which reads back identically to an absent one.
 * Removing an absent key is a no-op, so an empty save on an uncommented class
 * does nothing rather than failing.
 *
 * The success string says "Comment set:" either way — callers test that prefix
 * to tell a real write from a class the lookup could not resolve, which is the
 * same question for a removal.
 */
export function setClassComment(
  execute: QueryExecutor,
  className: string,
  comment: string,
  dict?: number | string,
): string {
  const esc = escapeString(className);
  const write = isRealClassComment(comment)
    ? `cls comment: '${escapeString(comment)}'.`
    : `[cls _extraDictRemoveKey: #comment] on: Error do: [:e | cls _extraDictAt: #comment put: nil].`;
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${esc}'].
cls isBehavior ifFalse: [^ 'Not a class: ${esc}'].
${write}
'Comment set: ' , cls name`;
  return execute(code);
}
