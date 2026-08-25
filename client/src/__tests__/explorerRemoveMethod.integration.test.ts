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
 * End-to-end coverage for the Explorer's "Remove Method" button, driven through the real
 * controller against a live stone: define a throwaway class, compile a method onto it,
 * then call ExplorerController.removeMethod and confirm what the stone reports afterwards.
 * The safe-delete guard is what makes the two shapes here differ — a selector nothing
 * sends goes without a confirmation, one with a live sender does not — so the fixture
 * builds both. This is the integration counterpart to the unit tests in
 * explorerRemoveMethod.test.ts, which stub the query layer.
 *
 * Ungated: the sender scan is base-image reflection, so this needs only a running stone.
 * The harness aborts afterward, so the throwaway classes never reach the repository.
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
  const CALLER_CLASS = 'VsCodeExplorerRemoveCaller';
  const TEST_SELECTOR = 'vsCodeExplorerRemoveMe';
  const SENT_SELECTOR = 'vsCodeExplorerRemoveMeToo';

  const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;
  const showInformationMessage = window.showInformationMessage as ReturnType<typeof vi.fn>;

  const dictIndexOf = (name: string): number => {
    const index = queries.getDictionaryNames(session()).indexOf(name) + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  /** A class carrying two instance methods: one nothing sends, and one a second class does. */
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
    queries.compileClassDefinition(
      session(),
      `Object subclass: '${CALLER_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );

    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test-vscode-extension',
      `${TEST_SELECTOR}\n  ^ 42`,
    );
    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test-vscode-extension',
      `${SENT_SELECTOR}\n  ^ 43`,
    );
    queries.compileMethod(
      session(),
      CALLER_CLASS,
      false,
      'test-vscode-extension',
      `callsIt\n  ^ ${TEST_CLASS} new ${SENT_SELECTOR}`,
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

  const methodNode = (selector: string): MethodItem =>
    new MethodItem(
      false,
      {
        selector,
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

  it('removes a method nothing sends without asking', async () => {
    fixtureWithMethod();

    await controllerOnFixture().removeMethod(methodNode(TEST_SELECTOR));

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(queries.getAllSelectors(session(), TEST_CLASS)).not.toContain(TEST_SELECTOR);
  });

  it('announces a removal it did not ask about', async () => {
    fixtureWithMethod();

    await controllerOnFixture().removeMethod(methodNode(TEST_SELECTOR));

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining(`Removed method #${TEST_SELECTOR}`),
    );
  });

  it('leaves a method with a live sender in place when the confirmation is dismissed', async () => {
    fixtureWithMethod();
    showWarningMessage.mockResolvedValue(undefined);

    await controllerOnFixture().removeMethod(methodNode(SENT_SELECTOR));

    expect(showWarningMessage).toHaveBeenCalled();
    expect(queries.getAllSelectors(session(), TEST_CLASS)).toContain(SENT_SELECTOR);
  });

  it('names the sender in the confirmation it raises', async () => {
    fixtureWithMethod();
    showWarningMessage.mockResolvedValue(undefined);

    await controllerOnFixture().removeMethod(methodNode(SENT_SELECTOR));

    expect(showWarningMessage.mock.calls[0][1].detail).toContain(`${CALLER_CLASS} >> #callsIt`);
  });

  it('removes a method with a live sender when the user chooses to remove it anyway', async () => {
    fixtureWithMethod();
    showWarningMessage.mockResolvedValue('Remove Anyway');

    await controllerOnFixture().removeMethod(methodNode(SENT_SELECTOR));

    expect(queries.getAllSelectors(session(), TEST_CLASS)).not.toContain(SENT_SELECTOR);
  });
});
