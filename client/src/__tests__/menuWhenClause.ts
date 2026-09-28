// Evaluating a `when` clause, rather than matching it as text.
//
// Two forms are in use — an outright `viewItem == x` and a `viewItem =~ /…/` —
// and a row sees both kinds at once. A substring test passes for any clause that
// merely fails to contain the literal, which is every clause once one is
// reworded: that is how a menu test goes green by absence. Session rows moved to
// the regex form when each row started saying in its own context value what that
// session can do (see `sessionContextValue` in loginTreeProvider.ts).
export function applies(when: string, viewItem: string): boolean {
  const literal = /viewItem == ([A-Za-z]+)/.exec(when);
  if (literal) return literal[1] === viewItem;
  const pattern = /viewItem =~ \/(.+?)\//.exec(when);
  return pattern ? new RegExp(pattern[1]).test(viewItem) : false;
}

/** The inline-group rank in `inline@N`, or 0 when the group carries no number. */
export function inlineRank(group: string): number {
  const match = /inline@(\d+)/.exec(group);
  return match ? Number(match[1]) : 0;
}
