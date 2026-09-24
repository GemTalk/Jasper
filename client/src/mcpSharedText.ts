import { VIEW_REFRESH_CODE } from './queries/transactionMode';

// Text the two MCP servers must say identically. Jasper ships the same tools
// twice — the in-window server in `mcpTools.ts` and the standalone one in
// `mcp-server/src/tools.ts` — and a tool that describes itself differently in the
// two is a tool Claude will use differently depending which it is talking to.
//
// Deliberately NOT here: the `status` tool's own description, which says "the
// user's active GemStone session" in-window and "the current GemStone session"
// standalone. The standalone server has no VS Code selection, so they differ.

/** The `refresh` tool's description, including both of VIEW_REFRESH_CODE's stand-downs. */
export const REFRESH_TOOL_DESCRIPTION =
  "Refresh this session's view of committed state by aborting, when the abort " +
  "would discard nothing. GemStone's GCI pins the session's read view " +
  'until it aborts or commits, so a commit landed by another process (e.g. install.sh) ' +
  'is invisible until refresh runs. This is a no-op — and reports back, so the caller ' +
  'can decide whether to abort or commit first — when the session has uncommitted work, ' +
  'or when it is inside a transaction it began by hand under the manualBegin transaction ' +
  'mode, which the abort would end.';

/**
 * The `status` report's doit. Opens with VIEW_REFRESH_CODE so a single status
 * call also primes the session for follow-up reads, then reports who and where.
 */
export const SESSION_STATUS_CODE = `| ws viewState |
viewState := ${VIEW_REFRESH_CODE}.
ws := WriteStream on: String new.
ws nextPutAll: 'User: '; nextPutAll: System myUserProfile userId asString; lf.
ws nextPutAll: 'Stone: '; nextPutAll: System stoneName asString; lf.
ws nextPutAll: 'Session ID: '; nextPutAll: System session printString; lf.
ws nextPutAll: 'Transaction mode: '; nextPutAll: System transactionMode asString; lf.
ws nextPutAll: 'Transaction: '; nextPutAll: (System inTransaction ifTrue: ['active'] ifFalse: ['none']); lf.
ws nextPutAll: 'Uncommitted changes: '; nextPutAll: (System needsCommit ifTrue: ['yes'] ifFalse: ['no']); lf.
ws nextPutAll: 'View: '; nextPutAll: viewState; lf.
ws contents`;
