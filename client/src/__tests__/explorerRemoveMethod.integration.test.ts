import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import * as queries from '../browserQueries';
import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import { window } from '../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';

/**
 * End-to-end coverage for the Explorer's "Remove Method" button, driven through
 * the real controller against a live stone: define a throwaway class, compile a
 * method onto it, then call ExplorerController.removeMethod and confirm the
 * stone no longer reports the selector. This is the integration counterpart to
 * the unit tests in explorerRemoveMethod.test.ts, which stub the query layer.
 *
 * Ungated: needs only a running stone. The harness aborts afterward, so the
 * throwaway class never reaches the repository.
 */
describe('Explorer remove method (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const TEST_CLASS = 'VsCodeExplorerRemoveTest';
  const TEST_SELECTOR = 'vsCodeExplorerRemoveMe';

  const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;

  const dictIndexOf = (name: string): number => {
    const index = queries.getDictionaryNames(session()).indexOf(name) + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  /** A class carrying a single instance method for the test to remove. */
  const fixtureWithMethod = (): void => {
    const defined = queries.compileClassDefinition(
      session(),
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    expect(defined).toBe(TEST_CLASS);

    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test-vscode-extension',
      `${TEST_SELECTOR}\n  ^ 42`,
    );
    expect(queries.getAllSelectors(session(), TEST_CLASS)).toContain(TEST_SELECTOR);
  };

  const controllerOnFixture = (): ExplorerController => {
    const sessionManager = {
      getSelectedSession: () => session(),
    } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = dictIndexOf('UserGlobals');
    ctl.state.className = TEST_CLASS;
    return ctl;
  };

  const methodNode = (): MethodItem =>
    new MethodItem(
      false,
      {
        selector: TEST_SELECTOR,
        category: 'test-vscode-extension',
        overrideBits: 0,
        sessionBit: 0,
      },
      'test-vscode-extension',
    );

  beforeEach(() => {
    vi.clearAllMocks();
    window.tabGroups.all = [];
  });

  it('removes a confirmed method so the stone no longer reports it', async () => {
    fixtureWithMethod();
    showWarningMessage.mockResolvedValue('Remove');

    await controllerOnFixture().removeMethod(methodNode());

    expect(queries.getAllSelectors(session(), TEST_CLASS)).not.toContain(TEST_SELECTOR);
  });

  it('leaves the method in place when the user dismisses the confirmation', async () => {
    fixtureWithMethod();
    showWarningMessage.mockResolvedValue(undefined);

    await controllerOnFixture().removeMethod(methodNode());

    expect(queries.getAllSelectors(session(), TEST_CLASS)).toContain(TEST_SELECTOR);
  });
});
