import { describe, it, expect } from 'vitest';
import {
  explainMissingInstall,
  explainStartFailure,
  isBareGemstoneUndefined,
} from '../startFailureMessage';

/** The real thing, copied out of the `startstone` binary's message table and
 *  confirmed by running it with GEMSTONE unset — not a paraphrase. The first
 *  matcher written here was built from the issue report's wording instead, so
 *  it matched nothing GemStone actually emits while its tests passed. */
const REAL_COMPLAINT =
  "startstone[Info]: GemStone version '3.7.5'\n" +
  'startstone[Info]: Starting Stone repository monitor gs64stone2.\n' +
  "startstone[Error]: The environment variable 'GEMSTONE' is not defined.";

/** The other template in the same binary, for an NRS string naming an unset var. */
const REAL_NRS_COMPLAINT =
  "NRS Parse Error: the environment variable 'GEMSTONE_NRS_ALL' is not defined.";

/** The wording the issue report used, which GemStone never emits. Kept so that
 *  quoting the issue still gets a hit. */
const PARAPHRASE = 'GEMSTONE environment variable is not defined';

describe('isBareGemstoneUndefined', () => {
  it('recognises what GemStone actually prints when GEMSTONE is unset', () => {
    expect(isBareGemstoneUndefined(REAL_COMPLAINT)).toBe(true);
  });

  it('recognises the NRS form of the same complaint', () => {
    expect(isBareGemstoneUndefined(REAL_NRS_COMPLAINT)).toBe(true);
  });

  it('still recognises the wording used in the issue report', () => {
    expect(isBareGemstoneUndefined(PARAPHRASE)).toBe(true);
  });

  it('leaves any other failure alone', () => {
    expect(isBareGemstoneUndefined('stopstone: stone gs64stone is not running')).toBe(false);
  });

  it('does not claim an unrelated missing variable as this problem', () => {
    // Same sentence, different variable — a missing PATH is its own bug and
    // must not be explained away as the GemStone-environment one.
    expect(isBareGemstoneUndefined("The environment variable 'PATH' is not defined.")).toBe(false);
  });
});

describe('explainMissingInstall', () => {
  it('says where Jasper looked instead of blaming a missing setting', () => {
    // A user who has just installed 3.7.5 reads "the install path isn't
    // configured" as Jasper losing a setting, and goes hunting Settings for a
    // path field that does not exist.
    const message = explainMissingInstall('3.7.5', '/home/u/jasperStones');

    expect(message).toContain('/home/u/jasperStones');
    expect(message).toContain('GemStone64Bit3.7.5');
    expect(message).not.toMatch(/path is(n't| not) configured/i);
  });

  it('offers both ways out: extract it, or point Jasper at an existing install', () => {
    const message = explainMissingInstall('3.7.5', '/root');

    expect(message).toContain('Databases & Versions panel');
    expect(message).toContain('local version');
  });
});

describe('explainStartFailure', () => {
  it('contradicts GemStone: Jasper did set the variable, and says to what', () => {
    const message = explainStartFailure(
      'Starting stone gs64stone',
      REAL_COMPLAINT,
      '/opt/GemStone64Bit3.7.5-x86_64.Linux',
    );

    expect(message).toContain('/opt/GemStone64Bit3.7.5-x86_64.Linux');
    expect(message).toContain('Your shell profile and your GemStone install are not the problem');
  });

  it('offers the diagnostic before the diagnosis', () => {
    // An earlier version asserted "this usually means a server was started
    // outside Jasper" — which is wrong whenever nothing external is running,
    // and is the same confident misdirection this whole message replaced.
    const message = explainStartFailure('Starting stone gs64stone', REAL_COMPLAINT, '/opt/gs');

    expect(message).toContain('printenv GEMSTONE');
    expect(message).not.toMatch(/this usually means/i);
  });

  it('mentions the external-server case as a possibility, not a verdict', () => {
    const message = explainStartFailure('Starting stone gs64stone', REAL_COMPLAINT, '/opt/gs');

    expect(message).toContain('outside Jasper');
    expect(message).toContain('may have');
  });

  it('says the variable was set and did not arrive, which is the one certain fact', () => {
    const message = explainStartFailure('Starting stone gs64stone', REAL_COMPLAINT, '/opt/gs');

    expect(message).toContain('did not reach the command');
  });

  it('keeps the original output so nothing is hidden', () => {
    const message = explainStartFailure('Starting stone gs64stone', REAL_COMPLAINT, '/opt/gs');

    expect(message).toContain(
      "startstone[Error]: The environment variable 'GEMSTONE' is not defined.",
    );
    expect(message).toContain("GemStone version '3.7.5'");
  });

  it('names what was being attempted', () => {
    const message = explainStartFailure('Starting NetLDI gs64ldi', REAL_COMPLAINT, '/opt/gs');

    expect(message).toContain('Starting NetLDI gs64ldi');
  });

  it('lets every other failure through untouched', () => {
    expect(
      explainStartFailure('Starting stone gs64stone', 'extent0.dbf is in use', '/opt/gs'),
    ).toBeUndefined();
  });
});
