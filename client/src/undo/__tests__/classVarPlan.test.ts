import { describe, it, expect } from 'vitest';
import { classVarDrifted, planClassVarReversal } from '../classVarPlan';

/**
 * Planning a class-variable reversal (#434).
 *
 * Planned against the LIVE state, like every other planner here: a variable someone has
 * already removed by hand needs no reversal, and asking for one would be work the stone
 * does not need.
 */

const declared = { defined: true };
const absent = { defined: false };

describe('planClassVarReversal', () => {
  it('takes an added declaration away again', () => {
    expect(planClassVarReversal(absent, declared)).toBe('undeclare');
  });

  it('declares a removed name again', () => {
    expect(planClassVarReversal(declared, absent)).toBe('declare');
  });

  it('plans nothing when the declaration is already as it was', () => {
    expect(planClassVarReversal(absent, absent)).toBeNull();
    expect(planClassVarReversal(declared, declared)).toBeNull();
  });
});

describe('classVarDrifted', () => {
  it('spots a declaration someone has removed since the add', () => {
    expect(classVarDrifted(declared, absent)).toBe(true);
  });

  it('is quiet when the declaration still reads as the add left it', () => {
    expect(classVarDrifted(declared, declared)).toBe(false);
  });
});
