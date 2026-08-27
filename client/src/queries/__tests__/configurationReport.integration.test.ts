import { describe, it, expect } from 'vitest';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import type { GciLibrary } from '../../gciLibrary';
import {
  buildStoneReportCode,
  buildGemReportCode,
  parseConfigReport,
  sessionIsSystemUser,
  isRuntimeSettable,
  type ConfigEntry,
} from '../configurationReport';

// The report emitter (generated Smalltalk) and the parser (TS) are unit-tested
// only against hand-authored strings. This closes the loop against a live stone:
// it runs the real generated code and parses what actually comes back, proving
// the server-side tab/newline flatten, the key/class/value shape, and the
// CamelCase settable rule hold on real report data — not just on fixtures.
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
});
