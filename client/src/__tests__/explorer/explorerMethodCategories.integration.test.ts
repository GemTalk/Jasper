import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { GciLibrary } from '../../gciLibrary';
import * as queries from '../../browserQueries';
import { ExplorerController, MethodCategoryItem } from '../../gemstoneExplorer';
import { window } from '../../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { useIntegrationTest } from '../useIntegrationTest';
import { testActiveSession } from '../testActiveSession';

/**
 * End-to-end coverage for the Explorer's method-category management, driven
 * through the real controller against a live stone. explorerQueries.integration
 * already checks the renameCategory *query*; this checks the *controller* path
 * that decides a category is server-backed (from the live env lines) and renames
 * it there. Its unit twin (explorerMethodCategories.test.ts) stubs the queries.
 *
 * Ungated: needs only a running stone. The harness aborts afterward, so the
 * throwaway class never reaches the repository.
 */
describe('Explorer method categories (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const TEST_CLASS = 'VsCodeExplorerCategoryTest';
  const OLD_CATEGORY = 'accessing';
  const NEW_CATEGORY = 'renamed-accessing';

  const showInputBox = window.showInputBox as ReturnType<typeof vi.fn>;

  const dictIndexOf = (name: string): number => {
    const index = queries.getDictionaryNames(session()).indexOf(name) + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  /** Selectors the stone reports for a class under one side + category. */
  const selectorsIn = (isMeta: boolean, category: string): string[] =>
    queries
      .getClassEnvironments(session(), dictIndexOf('UserGlobals'), TEST_CLASS, 0)
      .filter((l) => l.isMeta === isMeta && l.category === category)
      .flatMap((l) => l.selectors);

  /** A class carrying one instance and one class method, each in OLD_CATEGORY. */
  const fixtureWithMethods = (): void => {
    const defined = queries.compileClassDefinition(
      session(),
      `Object subclass: '${TEST_CLASS}' instVarNames: #() classVars: #() ` +
        `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
    );
    expect(defined).toBe(TEST_CLASS);
    queries.compileMethod(session(), TEST_CLASS, false, OLD_CATEGORY, 'answer ^ 42');
    queries.compileMethod(session(), TEST_CLASS, true, OLD_CATEGORY, 'build ^ self new');
  };

  /** A controller on the fixture class, with its env lines loaded from the stone. */
  const controllerOnFixture = (): ExplorerController => {
    const sessionManager = {
      getSelectedSession: () => session(),
    } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = dictIndexOf('UserGlobals');
    ctl.state.className = TEST_CLASS;
    // Populate envLines from the stone so renameMethodCategory sees the category
    // as server-backed and takes the real rename path (not the overlay-only one).
    ctl.reloadCurrentClassMethods();
    return ctl;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.tabGroups.all = [];
  });

  it('renames a populated instance-side category on the stone, carrying its method', async () => {
    fixtureWithMethods();
    showInputBox.mockResolvedValue(NEW_CATEGORY);

    await controllerOnFixture().renameMethodCategory(
      new MethodCategoryItem(false, OLD_CATEGORY, false),
    );

    expect(selectorsIn(false, NEW_CATEGORY)).toContain('answer');
    expect(selectorsIn(false, OLD_CATEGORY)).not.toContain('answer');
  });

  it('renames a populated class-side category independently of the instance side', async () => {
    fixtureWithMethods();
    showInputBox.mockResolvedValue(NEW_CATEGORY);

    await controllerOnFixture().renameMethodCategory(
      new MethodCategoryItem(true, OLD_CATEGORY, false),
    );

    expect(selectorsIn(true, NEW_CATEGORY)).toContain('build');
    // The instance side's identically named category is untouched.
    expect(selectorsIn(false, OLD_CATEGORY)).toContain('answer');
  });

  it('does not rename anything when the prompt is cancelled', async () => {
    fixtureWithMethods();
    showInputBox.mockResolvedValue(undefined);

    await controllerOnFixture().renameMethodCategory(
      new MethodCategoryItem(false, OLD_CATEGORY, false),
    );

    expect(selectorsIn(false, OLD_CATEGORY)).toContain('answer');
    expect(selectorsIn(false, NEW_CATEGORY)).not.toContain('answer');
  });
});
