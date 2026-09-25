import { describe, it, expect } from 'vitest';
import { SESSION_STATUS_CODE } from '../mcpSharedText';
import { VIEW_REFRESH_CODE } from '../queries/transactionMode';

// Both MCP servers send this one doit for `status`; their suites pin only that
// they send it, and what it reports is pinned here.
describe('SESSION_STATUS_CODE', () => {
  // Stale-transaction guard: the report must auto-refresh when the abort would
  // discard nothing, so the rest of it (and any follow-up read tools in this
  // session) sees committed state. When it stands down is VIEW_REFRESH_CODE's,
  // pinned in transactionMode.test.ts.
  it('refreshes the view first, and reports whether it did', () => {
    expect(SESSION_STATUS_CODE).toContain(`viewState := ${VIEW_REFRESH_CODE}.`);
    expect(SESSION_STATUS_CODE).toContain("nextPutAll: 'View: '; nextPutAll: viewState");
  });

  it('names the transaction mode, which decides what commit and abort mean', () => {
    expect(SESSION_STATUS_CODE).toContain(
      "nextPutAll: 'Transaction mode: '; nextPutAll: System transactionMode asString",
    );
  });

  // Regression: nextPutAll: sends do: to its argument. If any value passed is a
  // SmallInteger (as System stoneVersionReport was observed returning), GemStone
  // raises "SmallInteger does not understand #do:". Every value put into the
  // stream must be a CharacterCollection.
  it('coerces every streamed value to a CharacterCollection', () => {
    expect(SESSION_STATUS_CODE).toMatch(/myUserProfile userId (asString|printString)/);
    expect(SESSION_STATUS_CODE).toMatch(/stoneName (asString|printString)/);
    expect(SESSION_STATUS_CODE).toMatch(/session printString/);
    expect(SESSION_STATUS_CODE).toContain('needsCommit');
    // stoneVersionReport returned a SmallInteger in 3.7.x (SmallInteger DNU
    // do:); modifiedObjects isn't a recognized System class method there
    // (DNU #modifiedObjects). Neither should be re-introduced.
    expect(SESSION_STATUS_CODE).not.toContain('stoneVersionReport');
    expect(SESSION_STATUS_CODE).not.toContain('modifiedObjects');
  });
});
