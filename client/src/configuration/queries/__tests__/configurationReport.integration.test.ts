import { describe, it, expect } from 'vitest';
import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import type { GciLibrary } from '../../../gciLibrary';
import {
  buildStoneReportCode,
  buildGemReportCode,
  parseConfigReport,
  sessionIsSystemUser,
  isRuntimeSettable,
  setConfiguration,
  type ConfigEntry,
} from '../configurationReport';

// The report emitter and the setter (generated Smalltalk) and the parser (TS)
// are unit-tested only against hand-authored strings. This closes the loop
// against a live stone: it runs the real generated code and parses what actually
// comes back, proving the server-side tab/newline flatten, the key/class/value
// shape, and the CamelCase settable rule hold on real report data — not just on
// fixtures — and that the set doit compiles and evaluates, with a refusal
// arriving in the shape the panel unwraps.
describe('configuration report round-trip (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;
  useIntegrationTest((ctx) => {
    gci = ctx.gciLibrary;
    session = ctx.session;
  });

  const execute = (code: string) => gci.executeAndFetchString(session, code);
  const TYPES = ['boolean', 'integer', 'string', 'other'];

  const assertWellFormed = (entries: ConfigEntry[]) => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).not.toBe('');
      expect(TYPES).toContain(e.type);
      // The server flattens any tab/newline inside a value to a space, so a value
      // can never split or span a line — the assumption the parser is built on.
      expect(e.value).not.toContain('\t');
      expect(e.value).not.toContain('\n');
      // `settable` is exactly the CamelCase test, now applied to real keys.
      expect(e.settable).toBe(isRuntimeSettable(e.key));
    }
  };

  it('reads and parses the live stone report', () => {
    const entries = parseConfigReport(execute(buildStoneReportCode()));
    assertWellFormed(entries);
    // Every stone report carries this runtime parameter.
    expect(entries.some((e) => e.key === 'StnMaxSessions')).toBe(true);
  });

  it('reads and parses the live gem report', () => {
    const entries = parseConfigReport(execute(buildGemReportCode()));
    assertWellFormed(entries);
  });

  it('answers whether the session is SystemUser as a real boolean', () => {
    expect(typeof sessionIsSystemUser(execute)).toBe('boolean');
  });

  // The tests below run the *setter* doit on the stone. Nothing here is
  // unit-testable: whether `[ System gemConfigurationAt: #K put: v. 'OK' ]`
  // compiles at all, and whether a refusal really comes back through
  // `messageText` behind the error sentinel, is the stone's answer to give.

  /** The gem's current value for a key, read back through the real report. */
  const gemValue = (key: string): string => {
    const entry = parseConfigReport(execute(buildGemReportCode())).find((e) => e.key === key);
    expect(entry, `the gem report should carry ${key}`).toBeDefined();
    return entry!.value;
  };

  it('sets a gem parameter and is told OK by the stone', () => {
    // Set the parameter to the value it already holds, so a green run changes
    // nothing about the gem it borrowed. What is under test is that the emitted
    // doit compiles and evaluates — not that the number moves.
    const before = gemValue('GemHaltOnError');
    expect(setConfiguration(execute, 'gem', 'GemHaltOnError', 'integer', before)).toEqual({
      ok: true,
    });
    expect(gemValue('GemHaltOnError')).toBe(before);
  });

  it('reports the stone refusing a stone parameter, in the stone words', () => {
    // Stone parameters are SystemUser-only, and the harness logs in as
    // DataCurator — so this is the refusal path the panel shows beside the row,
    // end to end: the doit catches the SecurityError, the sentinel carries its
    // messageText back, and setConfiguration unwraps it.
    expect(sessionIsSystemUser(execute)).toBe(false);
    const entries = parseConfigReport(execute(buildStoneReportCode()));
    const timeout = entries.find((e) => e.key === 'StnGemTimeout')!;
    const result = setConfiguration(execute, 'stone', 'StnGemTimeout', 'integer', timeout.value);
    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).not.toBe('');
    // Its own words, not ours — the panel shows this verbatim.
    expect(result.message).toContain('SystemUser');
    // The sentinel is stripped before the message reaches the panel.
    expect(result.message).not.toContain('GS-ERROR:');
  });
});
