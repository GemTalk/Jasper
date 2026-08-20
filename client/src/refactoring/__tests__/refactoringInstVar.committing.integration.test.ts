import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { startInstVarPreview, applyInstVar } from '../queries/previewInstVar';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../instVarRefactorPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { userIndex as userIndexProbe, hasIvar as hasIvarProbe } from './support/refactoring';

/**
 * The one committing scenario of the add / remove instance-variable (V1) refactoring that
 * fits the harness's nested-transaction commit strategy: delete-history involves no
 * instance migration, so there is no persistence question. A spike run against both 3.6.2 and
 * 3.7.5 established that a nested commit promotes objects into the *parent* transaction, not into
 * the repository, so under one level of nesting `migrateInstancesTo:` sees no already-committed
 * instances and cannot migrate them. The migrate-instances scenario therefore stays out of this
 * suite; it, plus two accessor-atomicity scenarios that need a real commit-then-abort inside a
 * single test, remain in `__tests__/gci/gciInstVar.e2e.test.ts` pending their own migration to a
 * disposable-stone route.
 *
 * `allowedCommits: 3` = the test body's own commit at line 63 (bumping the class's history to 2
 * versions), plus the two commits `GsInstVarRefactoring.class.st` performs while applying: the
 * structural commit `commitStructuralThenMigrate:deleteHistory:on:` performs before pruning
 * (`:562`), and the commit after `deletePriorVersionsOf:` (`:574`). The per-class migration commit
 * at `:600` is NOT reached here -- this fixture passes `migrate=false, deleteHistory=true`, so that
 * path never runs. Keep this count in sync with the fixture: if it fails at the harness's floor
 * check, fix this comment and the number together, don't just bump the number.
 */
describe('add instance variable, delete-history commit path (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
    },
    { allowedCommits: 3 },
  );

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const userIndex = (): number => userIndexProbe(exec);
  const hasIvar = (cls: string, name: string): boolean => hasIvarProbe(exec, cls, name);

  const CLS = 'XIvCommitHist';

  it('deletes prior versions from the class history and commits when delete-history is requested', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    gci.executeDiscardingResult(handle, 'System commitTransaction'); // commit the original version so history bumps to 2

    parseStartPreview(
      await startInstVarPreview(
        asyncExec,
        'add',
        CLS,
        'z',
        'xiv-commit-hist',
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    const result = parseApplyResult(
      await applyInstVar(asyncExec, 'xiv-commit-hist', [], null, false, true),
    );

    expect(result.failed).toEqual([]);
    expect(result.committed).toBe(true);
    expect(hasIvar(CLS, 'z')).toBe(true);
    // The prior version was pruned: only the current version remains in the history.
    expect(gci.executeAndFetchInteger(handle, `${CLS} classHistory size`)).toBe(1n);
  });
});
