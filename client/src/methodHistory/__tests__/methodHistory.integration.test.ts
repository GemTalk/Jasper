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
  const defineClass = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
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
    // stands in for a method that predates any Jasper edit.
    exec(
      `(System myUserProfile symbolList objectNamed: #'${CLS}') ` +
        "compileMethod: 'answer\n\t^ 1' dictionaries: System myUserProfile symbolList " +
        "category: 'accessing' environmentId: 0. true printString",
    );

    q.compileMethod(session(), CLS, false, 'accessing', 'answer\n\t^ 2');
    const versions = parseMethodHistory(q.getMethodHistory(session(), CLS, 'answer', false));

    const sources = versions.map((v) => v.source);
    expect(sources.some((s) => s.includes('^ 1'))).toBe(true);
    expect(sources.some((s) => s.includes('^ 2'))).toBe(true);
    expect(versions[0].source).toContain('^ 2');
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
});
