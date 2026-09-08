import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { installMethodHistory } from '../methodHistoryServer';
import { parseMethodHistory } from '../methodHistoryModel';

/**
 * Automatic GCI integration test for per-method history, over the real GCI
 * transport. This deliberately does NOT require any server plugin — method
 * history stands on its own: the JasperMethodHistory helper is installed via
 * SessionTemps (installMethodHistory), so the whole flow must work on a BARE
 * stone. It exercises the real capture path (queries.compileMethod
 * brackets each compile with the helper) and the read path (queries.getMethodHistory).
 *
 * Fully transient: the helper class lives in SessionTemps and the store writes are
 * uncommitted, and the useIntegrationTest harness aborts each test, so the fixture
 * class, the recorded history, and the helper all vanish — nothing is committed.
 * All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('method history (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const CLS = 'JMHItFixture';
  // The fixture carries an instance variable so tests can exercise methods that
  // reference it — the case that must parse in the class's own context when seeding.
  const defineClass = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #(count) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
  };

  it('installs its helper on a bare stone', () => {
    expect(installMethodHistory(session())).toBe(true);
    // A second install is idempotent (already-installed short-circuit), not an error.
    expect(installMethodHistory(session())).toBe(true);
  });

  it('records a timestamped version on each Jasper compile, newest first', () => {
    installMethodHistory(session());
    defineClass();

    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 1');
    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 2');
    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));

    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0].isCurrent).toBe(true);
    expect(versions[0].source).toContain('^ 2');
    expect(versions[0].timeStamp).not.toBe('');
    expect(versions[0].userId).not.toBe('');
  });

  it('seeds the pre-existing source as the first version when a method is first edited', () => {
    installMethodHistory(session());
    defineClass();
    // Compile the original WITHOUT the capture path (direct kernel compile), so it
    // stands in for a method that predates any Jasper edit. It references the
    // instance variable `count` — the seed's selector-parse must resolve that in the
    // class's own context, or the original would be silently dropped on first edit.
    exec(
      `(System myUserProfile symbolList objectNamed: #'${CLS}') ` +
        "compileMethod: 'answer\n\t^ count' dictionaries: System myUserProfile symbolList " +
        "category: 'accessing' environmentId: 0. true printString",
    );

    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ count + 1');
    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));

    const sources = versions.map((v) => v.source);
    // The seeded original (^ count) AND the edit (^ count + 1) are both present.
    expect(sources.some((s) => s.includes('^ count') && !s.includes('+ 1'))).toBe(true);
    expect(sources.some((s) => s.includes('^ count + 1'))).toBe(true);
    expect(versions[0].source).toContain('^ count + 1');
  });

  it('does not record an identical recompile twice', () => {
    installMethodHistory(session());
    defineClass();

    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 1');
    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 1');
    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));

    expect(versions.filter((v) => !v.notInHistory)).toHaveLength(1);
  });

  it('forgets a method’s history on request', () => {
    installMethodHistory(session());
    defineClass();
    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 1');
    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 2');

    q.removeMethodHistory(session(), CLS, 'answer', false);
    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));

    // Only the synthetic current version (the installed method) remains.
    expect(versions.every((v) => v.notInHistory)).toBe(true);
  });

  /**
   * The finding this suite exists for: the store key and both lookups must be scoped
   * by the DEFINING dictionary. Two classes with the same name in different
   * SymbolDictionaries are different classes — sharing one history entry would
   * interleave their versions, and an unscoped read would show (and let you restore)
   * the wrong class's source.
   *
   * The fixture inserts a second dictionary AHEAD of UserGlobals, so a bare
   * `objectNamed:` resolves to the NEW dictionary's class — meaning an unscoped read
   * for the UserGlobals class would answer the other one's history.
   */
  describe('two same-named classes in different dictionaries', () => {
    const SHADOW = 'JMHItShadow';
    const OTHER_DICT = 'JMHItOtherDict';

    const defineClassIn = (dictExpr: string, className: string): void => {
      exec(
        `| d | d := ${dictExpr}. (Object subclass: '${className}' instVarNames: #() ` +
          'classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: d ' +
          'options: #()) name printString',
      );
    };

    /** UserGlobals' class first, then a new dictionary inserted at index 1 holding a
     *  second class of the same name. Answers nothing; both are addressed by dict. */
    const defineShadowPair = (): void => {
      defineClassIn('UserGlobals', SHADOW);
      exec(
        `| d | d := SymbolDictionary new. d name: #'${OTHER_DICT}'. ` +
          'System myUserProfile insertDictionary: d at: 1. true printString',
      );
      defineClassIn('System myUserProfile symbolList at: 1', SHADOW);
    };

    it('keeps each class’s versions in its own history entry', () => {
      installMethodHistory(session());
      defineShadowPair();

      // Two edits on the UserGlobals class, one on the shadowing class.
      q.compileMethod(session(), SHADOW, false, 'accessing', 'answer\n\t^ 1', 0, 'UserGlobals');
      q.compileMethod(session(), SHADOW, false, 'accessing', 'answer\n\t^ 2', 0, 'UserGlobals');
      q.compileMethod(session(), SHADOW, false, 'accessing', 'answer\n\t^ 99', 0, 1);

      const inUserGlobals = parseMethodHistory(
        q.getMethodHistory(session(), SHADOW, 'answer', false, 'UserGlobals'),
      );
      const inOther = parseMethodHistory(q.getMethodHistory(session(), SHADOW, 'answer', false, 1));

      // Neither history contains the other's source: the key separated them.
      expect(inUserGlobals.map((v) => v.source).join('\n')).toContain('^ 2');
      expect(inUserGlobals.map((v) => v.source).join('\n')).not.toContain('^ 99');
      expect(inOther.map((v) => v.source).join('\n')).toContain('^ 99');
      expect(inOther.map((v) => v.source).join('\n')).not.toContain('^ 2');
    });

    it('forgets only the dictionary-scoped class’s history', () => {
      installMethodHistory(session());
      defineShadowPair();
      q.compileMethod(session(), SHADOW, false, 'accessing', 'answer\n\t^ 1', 0, 'UserGlobals');
      q.compileMethod(session(), SHADOW, false, 'accessing', 'answer\n\t^ 99', 0, 1);

      q.removeMethodHistory(session(), SHADOW, 'answer', false, 1);

      // The shadowing class's history is gone; the UserGlobals one is untouched.
      const inOther = parseMethodHistory(q.getMethodHistory(session(), SHADOW, 'answer', false, 1));
      const inUserGlobals = parseMethodHistory(
        q.getMethodHistory(session(), SHADOW, 'answer', false, 'UserGlobals'),
      );
      expect(inOther.filter((v) => !v.isCurrent)).toHaveLength(0);
      expect(inUserGlobals.map((v) => v.source).join('\n')).toContain('^ 1');
    });
  });

  // A stamp without a UTC offset is read by the client as its OWN local time, so every
  // developer outside the stone's timezone misreads it — invisibly, because the digits
  // are unchanged. asStringISO8601 is present on 3.6.2 and 3.7.5; this pins that the
  // engine actually emits the offset rather than a bare wall clock.
  it('records timestamps carrying the stone’s UTC offset', () => {
    installMethodHistory(session());
    defineClass();
    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 1');

    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));
    const stamp = versions.find((v) => v.timeStamp)?.timeStamp ?? '';

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})$/);
    // And it must be a real instant, not just well-shaped text.
    expect(Number.isNaN(new Date(stamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).getTime())).toBe(
      false,
    );
  });
});
