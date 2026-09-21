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

/** Ask the session, tolerating a probe that fails. */
function available(session: ActiveSession | undefined): boolean {
  if (!session) return false;
  try {
    return queries.tonelCapability(session).available;
  } catch {
    // This runs on every session connect; a busy or half-established session must
    // not take the connect path down with it. Unavailable is the safe answer.
    return false;
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
  const isAvailable = available(session);
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
  if (available(session)) return true;
  void vscode.window.showWarningMessage(UNAVAILABLE_MESSAGE);
  return false;
}
