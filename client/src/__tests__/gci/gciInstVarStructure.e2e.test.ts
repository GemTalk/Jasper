import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries -> gciLog -> vscode.
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as q from '../../browserQueries';
import {
  analyzeInstVarStructure,
  startInstVarStructurePreview,
  applyInstVarStructure,
} from '../../refactoring/queries/previewInstVarStructure';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parseApplyResult,
} from '../../refactoring/instVarStructurePreview';

/**
 * On-demand GCI end-to-end test (`npm run test:gci`) for the instance-variable structure
 * refactorings (V2 push up, V3 push down, V5 convert temporary). Drives the real query
 * builders + parsers against a live stone over the GCI transport, then rolls everything
 * back.
 *
 * GUARDED on the engine being loaded: on a bare stone each test skips with a reason. Fully
 * transient — every test aborts the transaction in a `finally`, so the new class versions
 * and fixture classes never commit.
 */
describe('instance-variable structure (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const BASE = 'VsE2eBase';
  const MID = 'VsE2eMid';
  const LEAF = 'VsE2eLeaf';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session,
      `Object subclass: '${BASE}' instVarNames: #('shared') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${BASE} subclass: '${MID}' instVarNames: #('mid' 'pushable') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${MID} subclass: '${LEAF}' instVarNames: #('leaf') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, MID, false, 'accessing', 'midM\n\t^mid');
    q.compileMethod(session, LEAF, false, 'accessing', 'leafM\n\t^leaf');
  };

  const ownIvars = (cls: string): string =>
    exec(`(${cls} instVarNames collect: [:e | e asString]) printString`);

  const abort = (): void => {
    exec('System abortTransaction');
  };

  beforeAll(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.5',
    };
    enginePresent =
      exec(
        '(System myUserProfile symbolList objectNamed: #GsInstVarStructureRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('pushes an ivar up to the superclass, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const analysis = parseAnalysis(
        await analyzeInstVarStructure(asyncExec, 'pushUp', LEAF, 'leaf'),
      );
      expect(analysis.decline).toBeNull();

      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushUp',
          LEAF,
          'leaf',
          'vs-e2e-up',
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-up'));

      expect(result.failed).toEqual([]);
      expect(ownIvars(MID)).toContain("'leaf'");
      expect(ownIvars(LEAF)).not.toContain("'leaf'");
    } finally {
      abort();
    }
  });

  it('pushes an ivar down into the subclasses, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushDown',
          MID,
          'pushable',
          'vs-e2e-down',
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-down'));

      expect(result.failed).toEqual([]);
      expect(ownIvars(LEAF)).toContain("'pushable'");
      expect(ownIvars(MID)).not.toContain("'pushable'");
    } finally {
      abort();
    }
  });
});
