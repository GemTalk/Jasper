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
 * `commitDepth: 4` = 3 real commits (fixture commit that bumps the class's history to 2 versions,
 * the structural commit `commitStructuralThenMigrate:deleteHistory:on:` performs before pruning,
 * and the final commit after `deletePriorVersionsOf:` -- `GsInstVarRefactoring.class.st:562,574`)
 * plus 1 headroom level: `useIntegrationTest`'s teardown treats the nested levels reaching exactly
 * their floor (i.e. every opened level consumed) as a budget violation, not just exceeding it, so
 * `commitDepth` must be provisioned one level above the actual commit count -- confirmed
 * empirically here, not by re-deriving the harness's own check.
 */
describe('add instance variable, delete-history commit path (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
    },
    { commitStrategy: 'nested', commitDepth: 4 },
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
