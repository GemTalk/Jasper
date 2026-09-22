// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf`.)
//
// Full statement, and the reasoning: ./queries/tonel/tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// Whether Jasper offers the Tonel commands at all.
//
// HIDDEN, not degraded. On a stone without the machinery the menu entries are
// absent — not present and failing when clicked. A developer on a base extent
// should see no sign of a feature their stone cannot support.
//
// Two mechanisms, because one is not enough:
//
//   * a context key, which the menu `when` clauses read;
//   * a runtime guard, because the COMMAND PALETTE IGNORES `when` and would
//     otherwise let a user invoke a command the menus hide.
//
// The probe behind both asks the session whether the classes and selectors this
// feature drives are present — never the version, never the extent filename. So
// the feature switches itself on the day rowan3 reaches CI or the base extent,
// with nothing to update.
import * as vscode from 'vscode';
import * as queries from './browserQueries';
import type { ActiveSession } from './sessionManager';

/** Context key the Tonel menu entries are gated on. */
export const TONEL_AVAILABLE_CONTEXT = 'gemstone.tonelAvailable';

/** What to tell a user who reached a Tonel command on a stone that cannot run it. */
const UNAVAILABLE_MESSAGE =
  'Tonel file out/in needs GemStone 3.7.5 or later on a rowan3 extent ' +
  '(one built from extent0.rowan3.dbf). This session does not have the Rowan ' +
  'classes the feature uses.';

/**
 * How many absent capabilities to name before the message stops being readable.
 *
 * Naming them is the whole reason the probe answers `missing` rather than a bare
 * boolean: "Rowan is not here at all" and "Rowan is here but changed one selector
 * under us" are the same warning otherwise, and only the second is a bug to file.
 * On a base extent every capability is absent, so the list is capped.
 */
const MISSING_TO_NAME = 3;

/** The warning for this session, naming what is actually absent. */
function unavailableMessage(missing: readonly string[]): string {
  if (missing.length === 0) return UNAVAILABLE_MESSAGE;
  const named = missing.slice(0, MISSING_TO_NAME).join(', ');
  const rest = missing.length - MISSING_TO_NAME;
  return `${UNAVAILABLE_MESSAGE} Missing: ${named}${rest > 0 ? ` and ${rest} more` : ''}.`;
}

/**
 * The last probe answer for a session.
 *
 * The probe is a ten-way doit, and the guard runs on every Tonel command — once
 * PER FILE in a multi-file file-in, on top of the refresh each connect already
 * does. What it measures cannot change within a session: the Rowan classes a
 * stone has are a property of the stone.
 *
 * Keyed on the session object so it cannot outlive it, and cleared by
 * {@link refreshTonelAvailability}, which already runs on connect and on a session
 * change — the two moments the answer could legitimately differ.
 */
const probed = new WeakMap<ActiveSession, { available: boolean; missing: string[] }>();

/** Ask the session, tolerating a probe that fails. */
function probe(session: ActiveSession | undefined): { available: boolean; missing: string[] } {
  if (!session) return { available: false, missing: [] };
  const cached = probed.get(session);
  if (cached) return cached;
  try {
    const result = queries.tonelCapability(session);
    const answer = { available: result.available, missing: result.missing };
    probed.set(session, answer);
    return answer;
  } catch {
    // This runs on every session connect; a busy or half-established session must
    // not take the connect path down with it. Unavailable is the safe answer, and
    // there is nothing to name — the probe itself did not answer.
    //
    // NOT cached: a probe that failed because the session was busy must be asked
    // again, or one bad moment hides the feature for the rest of the session.
    return { available: false, missing: [] };
  }
}

/**
 * Publish whether this session can do Tonel, for the menu `when` clauses.
 *
 * Call on connect and whenever the active session changes. Always sets the key,
 * both ways: until it is set the key is undefined, which a `when` clause reads as
 * false — correct by luck rather than by design.
 */
export function refreshTonelAvailability(session: ActiveSession | undefined): boolean {
  // The one invalidation point: this is called on connect and whenever the active
  // session changes, which is exactly when a cached answer could be wrong.
  if (session) probed.delete(session);
  const isAvailable = probe(session).available;
  void vscode.commands.executeCommand('setContext', TONEL_AVAILABLE_CONTEXT, isAvailable);
  return isAvailable;
}

/**
 * Guard for a Tonel command, for the palette route the menus cannot gate.
 *
 * Explains rather than merely refusing: a hidden command reached through the
 * palette gives the user no other clue why nothing happened.
 */
export function requireTonelAvailable(session: ActiveSession | undefined): boolean {
  const { available, missing } = probe(session);
  if (available) return true;
  void vscode.window.showWarningMessage(unavailableMessage(missing));
  return false;
}
