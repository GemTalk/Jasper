// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Tests for the one way this feature names a Rowan class. The behaviour under
// test exists because of a measured fact: on a rowan3 stone the Rowan
// dictionaries are in SystemUser's symbol list and NOT in DataCurator's, so a
// DataCurator session cannot see `RwTonelParser` by name even though the stone
// plainly has it.
import { describe, it, expect } from 'vitest';

import { ROWAN_LOOKUP_PRELUDE, rowanLookupExpr } from '../rowanLookup';

describe('rowanLookup', () => {
  it('defines the lookup block the queries use', () => {
    expect(ROWAN_LOOKUP_PRELUDE).toContain('rwLookup :=');
    expect(rowanLookupExpr('RwTonelParser')).toContain("rwLookup value: #'RwTonelParser'");
  });

  it("tries the session's own symbol list first", () => {
    // The overwhelmingly common case is SystemUser, whose own list already has
    // the Rowan dictionaries. Reaching for another user's profile first would
    // make every lookup pay for the rare case.
    const own = ROWAN_LOOKUP_PRELUDE.indexOf('System myUserProfile symbolList');
    const reachThrough = ROWAN_LOOKUP_PRELUDE.indexOf('AllUsers');
    expect(own).toBeGreaterThanOrEqual(0);
    expect(reachThrough).toBeGreaterThan(own);
  });

  it("reaches through SystemUser's symbol list when the session's lacks the name", () => {
    // Measured on a 3.7.5 rowan3 stone: RwModificationTonelWriterVisitorV2 and
    // RwTonelParser live in RowanKernel, RwMethodDefinition in RowanTools, and
    // both dictionaries are in SystemUser's symbol list only.
    expect(ROWAN_LOOKUP_PRELUDE).toContain("AllUsers userWithId: 'SystemUser'");
    expect(ROWAN_LOOKUP_PRELUDE).toContain('symbolList');
  });

  it('answers nil instead of raising when the reach-through is not permitted', () => {
    // A user with no read access to AllUsers must see the feature quietly
    // unavailable, not a walkback: the gate's whole job is to answer, and a
    // raise here would surface as a broken command rather than a hidden one.
    expect(ROWAN_LOOKUP_PRELUDE).toContain('on: Error do:');
  });

  it('escapes the name it is given', () => {
    expect(rowanLookupExpr("Rw'Odd")).toContain("Rw''Odd");
  });
});
