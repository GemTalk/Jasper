/**
 * "Undo" — the one entry point behind the Actions & Navigation pane's button, the palette
 * entry, the keybinding and the post-apply toast (issue #434).
 *
 * Its whole job is to take the top entry off the session's stack and hand it to the
 * reverser for its kind. This is the ONLY module in `undo/` that knows the refactoring
 * engine exists: the generic layer defines the stack and the local reversers, and a
 * refactoring plugs in here as one more kind. Adding a further kind means another branch
 * here and a reverser beside it — not a change to the stack, the UI, or any recording site.
 *
 * Every undo SHOWS WHAT IT WILL DO first and waits to be accepted — see `confirmUndo` for why
 * that is unconditional. Every kind opens a panel: the local ones a plan built from the recorded
 * entry (`undoPlan.ts`), a refactoring the paged preview it already had. That is deliberate
 * sameness — "Undo" should not be two different experiences depending on machinery the user has
 * no reason to know about (#396 review).
 *
 * Past the panel the kinds still behave differently, and those differences are the point of the
 * design:
 *
 *  - a METHOD EDIT reverses straight away, because the user just made it and it is one
 *    method;
 *  - a CLASS EDIT reverses straight away too, but calls itself a REVERT and asks a SECOND
 *    time when binding the earlier version would leave methods behind — that question is
 *    what the reversal costs, rather than which change it is, and GemStone re-versions a
 *    class rather than rolling it back, so the user has to know before it happens;
 *  - a CLASS COMMENT and a CLASS VARIABLE reverse straight away and stay UNDOs: neither
 *    re-versions the class, so putting the earlier text back, or taking the declaration and
 *    its accessors away again, is exact and leaves nothing behind;
 *  - a METHOD CATEGORY is renamed back, a CLASS CATEGORY is put back one class at a time, and a
 *    DICTIONARY is renamed back or put back at its old position on the symbol list — all exact,
 *    and all UNDOs for the same reason;
 *  - a REFACTORING opens its OWN preview panel rather than a plan: its reversal is paged from
 *    the stone, can span a hierarchy, and supports per-change deselection, none of which a
 *    client-side plan can describe.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import { logInfo } from '../gciLog';
import { dropUndoEntry, peekUndoEntry } from './undoStack';
import { refreshUndoUi } from './undoUi';
import { planUndo } from './undoPlan';
import { dictionaryNameLookup } from '../refactoring/dictionaryLabel';
import { showUndoPlanPanel } from './undoPlanPanel';
import { UndoEntry } from './undoTypes';
import { reverseMethodEdit } from './reverseMethodEdit';
import { reverseClassEdit } from './reverseClassEdit';
import { reverseClassComment } from './reverseClassComment';
import { reverseClassVarEdit } from './reverseClassVarEdit';
import { reverseMethodCategoryEdit } from './reverseMethodCategoryEdit';
import { reverseDictionaryEdit } from './reverseDictionaryEdit';
import { reverseClassCategoryEdit } from './reverseClassCategoryEdit';
import { checkRefactoringUndoAvailable } from '../refactoring/refactoringUndoAvailability';
import { undoLastRefactoringCommand } from '../refactoring/undoRefactoringCommand';

export async function undoLastCommand(sessions: SessionManager): Promise<void> {
  const session = sessions.getSelectedSession();
  if (!session) {
    void vscode.window.showWarningMessage('Select a GemStone session first.');
    return;
  }

  // Loop rather than take one shot: a refactoring entry can turn out to be stale (the
  // stone's record is per session and a reconnect clears it), and dropping it should fall
  // through to whatever is under it rather than answer "nothing to undo" over a stack
  // that still has entries.
  for (;;) {
    const entry = peekUndoEntry(session.id);
    if (!entry) {
      // Normal, and not evidence of a stale affordance: the Ctrl+K U chord is gated on
      // `hasActiveSession && !revertAvailable`, and an empty stack leaves BOTH context keys
      // false — so the chord fires straight into here for anyone pressing it speculatively.
      // Saying so is better than a chord that silently does nothing. The palette entries are
      // gated on the keys and the pane's button is gated on the same state, so those two
      // really cannot reach this. `refreshUndoUi` is a no-op on the chord path and there for
      // the case it can still fix: a button drawn over a stack that has since emptied.
      refreshUndoUi(session);
      void vscode.window.showWarningMessage(
        'There is nothing to undo in this session. Undo covers the edits and refactorings ' +
          'you have made since you connected.',
      );
      return;
    }

    logInfo(`[undo] invoked on #${entry.id} (${entry.kind}) "${entry.label}"`);

    // Confirm before reversing anything, naming the change. A REFACTORING is the one
    // exemption: it opens a preview listing every reversal with its diff and its own
    // checkbox, which is a fuller form of this same question, and asking twice would read
    // as Jasper not trusting its own preview.
    if (entry.kind !== 'refactoring' && !(await confirmUndo(entry, session))) {
      logInfo(`[undo] #${entry.id} declined at the confirmation`);
      return;
    }

    // The plan panel is a WEBVIEW, not a modal: the user can keep working while it is open, and
    // a save pushes a NEWER entry. Reversing the entry we peeked and then popping "the top" would
    // then spend somebody else's entry -- losing its reversal, and leaving this one on the stack
    // to be applied a second time over whatever was written since. That is silent source loss,
    // and it is why every branch below spends the entry BY ID rather than popping (#396 review).
    if (peekUndoEntry(session.id)?.id !== entry.id) {
      logInfo(`[undo] #${entry.id} is no longer on top; the stack moved while the panel was open`);
      void vscode.window.showWarningMessage(
        'The stack changed while the panel was open, so nothing was undone. Try Undo again to ' +
          'reverse the most recent change.',
      );
      return;
    }
    const spend = (): void => dropUndoEntry(session.id, entry.id);

    // Popping is enough: the stack's change listener updates the button and the context key.
    // Leaving the entry in place when it was not spent is what keeps a cancelled or
    // unreadable undo on offer.
    if (entry.kind === 'methodEdit') {
      if (await reverseMethodEdit(session, entry)) spend();
      return;
    }

    if (entry.kind === 'classEdit') {
      if (await reverseClassEdit(session, entry)) spend();
      return;
    }

    if (entry.kind === 'classComment') {
      if (await reverseClassComment(session, entry)) spend();
      return;
    }

    if (entry.kind === 'classVarEdit') {
      if (await reverseClassVarEdit(session, entry)) spend();
      return;
    }

    if (entry.kind === 'methodCategoryEdit') {
      if (await reverseMethodCategoryEdit(session, entry)) spend();
      return;
    }

    if (entry.kind === 'dictionaryEdit') {
      if (await reverseDictionaryEdit(session, entry)) spend();
      return;
    }

    if (entry.kind === 'classCategoryEdit') {
      if (await reverseClassCategoryEdit(session, entry)) spend();
      return;
    }

    // A refactoring's record lives in the stone, so the client entry is only a pointer.
    // Verify it still points at something before opening a preview over nothing.
    const status = await checkRefactoringUndoAvailable(session);
    if (!status.available || status.sequence !== entry.sequence) {
      logInfo(`[undo] #${entry.id} no longer held by the stone; dropping it`);
      dropUndoEntry(session.id, entry.id);
      continue;
    }

    await undoLastRefactoringCommand(sessions);
    // The panel can be cancelled, and a partial undo leaves the record in place, so ask
    // the stone what actually happened rather than assume the entry is spent.
    const after = await checkRefactoringUndoAvailable(session);
    // By id, for the same reason as above: the refactoring panel is not modal either, so the
    // top of the stack may have moved on while it was open.
    if (!after.available || after.sequence !== entry.sequence) dropUndoEntry(session.id, entry.id);
    return;
  }
}

/**
 * Name the change and ask, before anything is reversed.
 *
 * Undo takes the top of the STACK, which is not always the last thing the user did: an
 * action that cannot be reversed records nothing, so the entry underneath it — an older
 * change, possibly several actions back — becomes what a click reverses. Every affordance
 * says which change that is (the tooltip names it, the toast is raised by the action
 * itself), but a tooltip is only read by someone who hovers, and a quick click on the
 * button was reversing the wrong change with nothing to stop it (review of #507).
 *
 * So the confirmation is unconditional rather than clever: no attempt is made to work out
 * whether this particular entry is the user's most recent action and skip the question when
 * it is. That test would be wrong exactly when it matters — an unrecorded action is by
 * definition one Jasper knows nothing about — and a prompt that usually does not appear is
 * worse than one that always does, because the one time it appears is the time the user has
 * already clicked through.
 *
 * The VERB matches every other affordance: `Revert` for a class edit, which binds an
 * earlier version rather than rolling anything back, and `Undo` for the rest. The
 * consequence modals that some reversals raise afterwards are a different question — what
 * it costs, rather than which change it is — and are left where they are.
 */
async function confirmUndo(entry: UndoEntry, session: ActiveSession): Promise<boolean> {
  // The rows name each class with its dictionary. The plan stays pure, so the lookup is passed
  // in: a slot records a SymbolList index as often as a name, and an index means nothing to a
  // reader -- least of all when the point is telling two same-named classes apart (#396). One
  // lookup for the whole plan, so the symbol list is read once rather than once per row.
  const plan = planUndo(entry, await dictionaryNameLookup(session));
  // planUndo answers undefined only for a refactoring, and the caller has already sent those
  // down their own path -- their reversal is paged from the stone, not derived here. So this is
  // not a "no plan, go ahead": it is a kind that should never have reached this function.
  if (plan === undefined) {
    logInfo(`[undo] #${entry.id} (${entry.kind}) has no plan; not reversing it unasked`);
    return false;
  }
  // The plan's own note -- what THIS reversal costs -- is the panel's banner. The standing
  // caveat about which change is on top of the stack lives in the panel as a disclosure, so it
  // stays available without sitting above the rows on every single undo.
  return await showUndoPlanPanel(plan);
}
