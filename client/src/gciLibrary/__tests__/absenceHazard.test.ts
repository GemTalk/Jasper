import { describe, expect, it } from 'vitest';
import { absenceHazard } from '../absenceHazard';
import {
  GCI_OPTIONAL_FUNCTIONS,
  type GciAbsenceReason,
  type GciOptionalFunctionName,
} from '../optionalFunctions';

/**
 * `absenceHazard` renders the reason a gated symbol may be missing, for the
 * eslint rule and for `requireGciCapability`'s skip message. Both throws exist
 * to fail loudly when `GciAbsenceReason` widens without a clause following it,
 * and neither fires on any current entry — so only these tests reach them.
 */
describe('absenceHazard', () => {
  it('names both hazards for a two-axis entry', () => {
    const hazard = absenceHazard('GciTsNbLogin_', { addedIn: '3.7.4.1', absentOn: 'win32' });

    expect(hazard).toContain('absent before 3.7.4.1');
    expect(hazard).toContain('Windows client library');
  });

  it('throws on an absentOn value it has no clause for', () => {
    const widened = { absentOn: 'aix' } as unknown as GciAbsenceReason;

    expect(() => absenceHazard('GciTsFoo', widened)).toThrow(/no hazard clause for/);
  });

  it('throws on an entry no part of which it renders', () => {
    expect(() => absenceHazard('GciTsFoo', {})).toThrow(/no part of which/);
  });

  // The check the reviewer ran by hand when this moved out of eslint.config.mjs.
  // A generated entry carrying a new axis or a new `absentOn` value otherwise
  // surfaces at eslint load time or inside an unrelated test's skip gate.
  it.each(Object.entries(GCI_OPTIONAL_FUNCTIONS) as [GciOptionalFunctionName, GciAbsenceReason][])(
    '%s renders a hazard',
    (name, reason) => {
      expect(absenceHazard(name, reason)).not.toEqual('');
    },
  );
});
