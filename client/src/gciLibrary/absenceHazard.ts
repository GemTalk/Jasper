import type { GciAbsenceReason } from './optionalFunctions';

// `addedIn` and `removedIn` interpolate their value, so widening either still
// renders a hazard. `absentOn` is the one axis whose message is a *phrase*
// rather than the value, so this module has to restate something the type
// already knows -- keyed rather than compared, and an unknown key throws.
// Widening `GciAbsenceReason['absentOn']` without adding a clause here fails
// the caller (eslint.config.mjs) load, instead of quietly rendering `may be
// absent ()` with nothing between the parens.
const ABSENT_ON_CLAUSE: Record<string, string> = {
  win32:
    'absent from the Windows client library -- throws on every `windows-latest` cell and every Windows install',
};

const absentOnClause = (name: string, absentOn: string): string => {
  const clause = ABSENT_ON_CLAUSE[absentOn];
  if (clause === undefined) {
    throw new Error(
      `${name} carries absentOn: '${absentOn}', which absenceHazard.ts has no hazard clause for. ` +
        'Add one to ABSENT_ON_CLAUSE next to the GciAbsenceReason widening that introduced it.',
    );
  }
  return clause;
};

/**
 * Render the hazard message for one `GciAbsenceReason` entry. One clause per
 * axis the registry records, so a two-axis entry (`GciTsNbLogin_`) names both
 * hazards rather than the first one found.
 */
export function absenceHazard(name: string, reason: GciAbsenceReason): string {
  const hazard = [
    reason.addedIn && `absent before ${reason.addedIn}`,
    reason.absentOn && absentOnClause(name, reason.absentOn),
    reason.removedIn && `removed in ${reason.removedIn}`,
  ]
    .filter(Boolean)
    .join('; ');
  // A new axis on `GciAbsenceReason` that nothing above reads leaves an entry
  // with no hazard at all. The rule would still fire, but on the message this
  // function exists to produce -- so fail rather than ship the hole.
  if (hazard === '') {
    throw new Error(
      `${name} is gated by ${JSON.stringify(reason)}, no part of which absenceHazard.ts renders. ` +
        'Add a clause for the new GciAbsenceReason axis to the hazard list above.',
    );
  }
  return hazard;
}
