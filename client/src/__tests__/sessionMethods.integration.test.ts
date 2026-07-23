import { describe, it, expect, afterEach, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as browserQueries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import type { EnvCategoryLine } from '../queries/getClassEnvironments';

/**
 * Automatic GCI integration tests for session-method detection (grail #13).
 *
 * Runs across the whole `npm run test:server:start` matrix (3.6.2 → 3.7.5), so
 * it also validates the detection selectors on the 3.6.2 floor. Everything is
 * transient: each test enables GsPackagePolicy and compiles session methods on
 * a kernel class, and the `afterEach` disables the policy + refreshes (dropping
 * the transient dicts) while the harness aborts the transaction — nothing is
 * ever committed.
 *
 * All emitted Smalltalk is ASCII-only: on 3.6.x a non-ASCII character in
 * compiled source trips the ComStrmSetCursor compiler bug. Session methods
 * route only for a user that CANNOT write the kernel class's persistent
 * dictionary — DataCurator (the standard test/GLASS user) — so the tests skip
 * themselves if ever run as a system profile.
 */
describe('session methods (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => browserQueries.executeFetchString(session(), code);

  const isSystemProfile = (): boolean =>
    exec('System myUserProfile isSystemProfile printString').trim() === 'true';
  const enablePolicy = (): void => {
    exec(
      "GsPackagePolicy current homeSymbolDict: UserGlobals; externalSymbolList: { Globals }; enable. 'ok'",
    );
  };

  // Compile `source` into `receiver` ('Character' or 'Character class') as a
  // session method — it routes to a session method because DataCurator cannot
  // write the kernel class's persistent dictionary.
  const compileSessionMethod = (receiver: string, source: string): void => {
    const escaped = source.replace(/'/g, "''"); // double quotes for the Smalltalk string literal
    exec(
      `${receiver} compileMethod: '${escaped}' ` +
        `dictionaries: GsCurrentSession currentSession symbolList ` +
        `category: '*jasper-it' environmentId: 0. 'ok'`,
    );
  };

  const linesOf = (className: string): EnvCategoryLine[] => {
    const globalsIndex = parseInt(
      exec('(System myUserProfile symbolList indexOf: Globals) printString'),
      10,
    );
    return browserQueries.getClassEnvironments(session(), globalsIndex, className, 0);
  };

  // Merge a per-selector map (sessionMethodBits | methodOverrideBits) across all
  // lines on one side (instance or class) of a class.
  const bitsFor = (
    className: string,
    isMeta: boolean,
    field: 'sessionMethodBits' | 'methodOverrideBits',
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const line of linesOf(className)) {
      if (line.isMeta === isMeta) Object.assign(out, line[field] ?? {});
    }
    return out;
  };

  afterEach(() => {
    // Idempotent even if a test never enabled the policy; the harness then
    // aborts the transaction, rolling back the (uncommitted) package/policy.
    try {
      exec(
        "GsPackagePolicy current disable. GsPackagePolicy current refreshSessionMethodDictionary. 'ok'",
      );
    } catch {
      /* session already gone / never enabled */
    }
  });

  it('flags a session extension as 1 and a session override as 2 on the instance side', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character', 'jasperItSessionExt ^42'); // new selector -> extension
    compileSessionMethod('Character', "isVowel ^'aeiou' includes: self asLowercase"); // shadows kernel isVowel -> override

    const bits = bitsFor('Character', false, 'sessionMethodBits');

    expect(bits.jasperItSessionExt).toBe(1); // transient only -> extension
    expect(bits.isVowel).toBe(2); // transient + persistent -> override
  });

  it('does not flag anything once the policy is disabled', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character', "isVowel ^'aeiou' includes: self asLowercase");
    expect(bitsFor('Character', false, 'sessionMethodBits').isVowel).toBe(2);

    exec(
      "GsPackagePolicy current disable. GsPackagePolicy current refreshSessionMethodDictionary. 'ok'",
    );

    // isVowel is back to the plain persistent method — no session flag.
    expect(bitsFor('Character', false, 'sessionMethodBits').isVowel).toBeUndefined();
  });

  it('flags a class-side (metaclass) session method', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character class', 'jasperItClassExt ^7');

    expect(bitsFor('Character', true, 'sessionMethodBits').jasperItClassExt).toBe(1);
    // ...and it does not bleed onto the instance side.
    expect(bitsFor('Character', false, 'sessionMethodBits').jasperItClassExt).toBeUndefined();
  });

  it('composes the session flag with the override-arrow bit when a session method also overrides a superclass', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character', 'max: aCharacter ^super max: aCharacter'); // Magnitude defines max:

    expect(bitsFor('Character', false, 'sessionMethodBits')['max:']).toBe(1); // extension (not persistent on Character)
    expect(bitsFor('Character', false, 'methodOverrideBits')['max:'] & 1).toBe(1); // overrides a superclass (up arrow)
  });

  it('serves the persistent base for an override and a placeholder for an extension', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character', 'jasperItSessionExt ^42');
    compileSessionMethod('Character', "isVowel ^'aeiou' includes: self asLowercase");

    const overrideSource = browserQueries.getMethodSource(
      session(),
      'Character',
      false,
      'isVowel',
      0,
    );
    const baseSource = browserQueries.getBaseMethodSource(
      session(),
      'Character',
      false,
      'isVowel',
      0,
    );
    expect(overrideSource).toContain('aeiou'); // session view = our override
    expect(baseSource).not.toContain('aeiou'); // untouched kernel method
    expect(baseSource).not.toBe(overrideSource);

    // An extension has no persistent method to fall back to.
    const extBase = browserQueries.getBaseMethodSource(
      session(),
      'Character',
      false,
      'jasperItSessionExt',
      0,
    );
    expect(extBase).toContain('no base method');
  });

  it('does not flag session methods on an untouched class', () => {
    if (isSystemProfile()) return;
    enablePolicy();
    compileSessionMethod('Character', 'jasperItSessionExt ^42');

    // Symbol got no session methods — detection must not false-positive there.
    expect(bitsFor('Symbol', false, 'sessionMethodBits')).toEqual({});
  });
});
