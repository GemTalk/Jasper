import { describe, it, expect } from 'vitest';
import {
  explainMissingInstall,
  explainStartFailure,
  isBareGemstoneUndefined,
} from '../startFailureMessage';

const SCRIPT_COMPLAINT = 'startstone[52]: GEMSTONE environment variable is not defined.\nExiting.';

describe('isBareGemstoneUndefined', () => {
  it('recognises the shell scripts complaining about their own environment', () => {
    expect(isBareGemstoneUndefined(SCRIPT_COMPLAINT)).toBe(true);
  });

  it('leaves any other failure alone', () => {
    expect(isBareGemstoneUndefined('stopstone: stone gs64stone is not running')).toBe(false);
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

    expect(message).toContain('Versions view');
    expect(message).toContain('local version');
  });
});

describe('explainStartFailure', () => {
  it('contradicts the script: Jasper did set the variable, and says to what', () => {
    const message = explainStartFailure(
      'Starting stone gs64stone',
      SCRIPT_COMPLAINT,
      '/opt/GemStone64Bit3.7.5-x86_64.Linux',
    );

    expect(message).toContain('/opt/GemStone64Bit3.7.5-x86_64.Linux');
    expect(message).toContain('not a problem with your shell profile');
  });

  it('points at the real cause, a server started outside Jasper', () => {
    const message = explainStartFailure('Starting stone gs64stone', SCRIPT_COMPLAINT, '/opt/gs');

    expect(message).toContain("outside Jasper's environment");
    expect(message).toContain('Databases view');
  });

  it('keeps the original output so nothing is hidden', () => {
    const message = explainStartFailure('Starting stone gs64stone', SCRIPT_COMPLAINT, '/opt/gs');

    expect(message).toContain('startstone[52]');
  });

  it('names what was being attempted', () => {
    const message = explainStartFailure('Starting NetLDI gs64ldi', SCRIPT_COMPLAINT, '/opt/gs');

    expect(message).toContain('Starting NetLDI gs64ldi');
  });

  it('lets every other failure through untouched', () => {
    expect(
      explainStartFailure('Starting stone gs64stone', 'extent0.dbf is in use', '/opt/gs'),
    ).toBeUndefined();
  });
});
