import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import {
  startRenameMethodPreview,
  pageRenameMethodPreview,
  applyRenameMethod,
  PREVIEW_PAGE_BYTES,
} from '../queries/previewRenameMethod';
import { parseStartPreview, parsePage, parseApplyResult } from '../renameMethodPreview';

/**
 * Rename Method with hierarchy scope, over a hierarchy that really has several implementors.
 *
 * Hierarchy scope is the defining class, its subclasses and its superclasses. Every implementor
 * inside that set must move; an implementor outside it must not, and must be REPORTED as out of
 * scope rather than silently dropped — the preview's counts are the only thing that tells you a
 * rename left a same-named method behind.
 *
 * There is no test that pins this today, which is why a report of "it doesn't look like both
 * implementors were renamed" cannot be settled by reading. See the "Is Rename Method's hierarchy
 * scope actually renaming every implementor?" item in https://github.com/GemTalk/Jasper/issues/622.
 *
 * Gated on the refactoring engine being present, so a bare stone skips the body but stays green.
 * Fully transient: the useIntegrationTest harness aborts each test, so the fixture classes and the
 * applied rename are rolled back. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename method, hierarchy scope (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const ROOT = 'RMHSItRoot'; // superclass — implements
  const MID = 'RMHSItMid'; // subclass of ROOT — implements, and is where the rename starts
  const LEAF = 'RMHSItLeaf'; // subclass of MID — implements
  const SIBLING = 'RMHSItSibling'; // subclass of ROOT, NOT of MID — implements, out of scope
  const OUTSIDE = 'RMHSItOutside'; // unrelated Object subclass — implements, out of scope

  const subclassOf = (parent: string, name: string): void => {
    q.compileClassDefinition(
      session(),
      `${parent} subclass: '${name}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
  };

  /**
   * Five implementors of a zero-argument selector across two hierarchies. Renaming from MID puts
   * ROOT (a superclass), MID itself and LEAF (a subclass) in scope, and leaves SIBLING — a subclass
   * of ROOT but not of MID — and the unrelated OUTSIDE out of it.
   */
  const defineHierarchy = (): void => {
    subclassOf('Object', ROOT);
    subclassOf(ROOT, MID);
    subclassOf(MID, LEAF);
    subclassOf(ROOT, SIBLING);
    subclassOf('Object', OUTSIDE);
    for (const cls of [ROOT, MID, LEAF, SIBLING, OUTSIDE]) {
      q.compileMethod(session(), cls, false, 'testing', `isGemQuality\n\t^ '${cls}'`);
    }
    // A sender inside the scope and one outside it, so the sender half of the scope test has
    // something to move and something to leave alone.
    q.compileMethod(session(), LEAF, false, 'testing', 'callsIt\n\t^ self isGemQuality');
    q.compileMethod(session(), OUTSIDE, false, 'testing', 'callsIt\n\t^ self isGemQuality');
  };

  /** Whether `cls` currently implements `selector` as its OWN instance method. */
  const implements_ = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  /** Start a hierarchy-scoped rename from MID and drain every page of its preview. */
  const previewHierarchyRename = async (token: string) => {
    const start = parseStartPreview(
      await startRenameMethodPreview(
        asyncExec,
        MID,
        'isGemQuality',
        ['isHighQuality'],
        [],
        { kind: 'hierarchy' },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    const changes = [...start.page.changes];
    let page = start.page;
    while (!page.done) {
      page = parsePage(
        await pageRenameMethodPreview(asyncExec, token, page.nextOffset, PREVIEW_PAGE_BYTES),
      );
      changes.push(...page.changes);
    }
    return { start, changes };
  };

  it('stages a rename for every implementor in the hierarchy and none outside it', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineHierarchy();

    const { changes } = await previewHierarchyRename(`rmhsit-preview-${MID}`);

    const renamed = changes
      .filter((c) => c.kind === 'methodRename')
      .map((c) => c.className)
      .sort();
    expect(renamed).toEqual([MID, ROOT, LEAF].sort());
  });

  it('counts the implementors it is leaving behind rather than dropping them silently', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineHierarchy();

    const { start } = await previewHierarchyRename(`rmhsit-counts-${MID}`);

    // SIBLING and OUTSIDE are the two implementors outside the hierarchy.
    expect(start.outOfScope.implementors).toBe(2);
    // Nothing was skipped for being unrewritable — an implementor missing from the rename must be
    // explained by scope, not by a swallowed parse failure.
    expect(start.outOfScope.skipped).toBe(0);
  });

  it('really renames every implementor in the hierarchy when applied', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineHierarchy();
    const token = `rmhsit-apply-${MID}`;

    await previewHierarchyRename(token);
    const result = parseApplyResult(await applyRenameMethod(asyncExec, token, [], 'test undo'));

    expect(result.failed).toEqual([]);
    for (const cls of [ROOT, MID, LEAF]) {
      expect([cls, implements_(cls, 'isHighQuality')]).toEqual([cls, true]);
      expect([cls, implements_(cls, 'isGemQuality')]).toEqual([cls, false]);
    }
  });

  it('leaves an implementor outside the hierarchy alone', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineHierarchy();
    const token = `rmhsit-outside-${MID}`;

    await previewHierarchyRename(token);
    parseApplyResult(await applyRenameMethod(asyncExec, token, [], 'test undo'));

    for (const cls of [SIBLING, OUTSIDE]) {
      expect([cls, implements_(cls, 'isGemQuality')]).toEqual([cls, true]);
      expect([cls, implements_(cls, 'isHighQuality')]).toEqual([cls, false]);
    }
  });

  it('rewrites a sender in the hierarchy and leaves one outside it untouched', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineHierarchy();
    const token = `rmhsit-senders-${MID}`;

    await previewHierarchyRename(token);
    parseApplyResult(await applyRenameMethod(asyncExec, token, [], 'test undo'));

    expect(exec(`(${LEAF} compiledMethodAt: #callsIt environmentId: 0) sourceString`)).toContain(
      'self isHighQuality',
    );
    expect(exec(`(${OUTSIDE} compiledMethodAt: #callsIt environmentId: 0) sourceString`)).toContain(
      'self isGemQuality',
    );
  });
});
