import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { GciLibrary } from '../../gciLibrary';
import * as queries from '../../browserQueries';
import { ExplorerController } from '../../gemstoneExplorer';
import { window } from '../../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { useIntegrationTest } from '../useIntegrationTest';
import { testActiveSession } from '../testActiveSession';

/**
 * End-to-end coverage for the Explorer's new "Remove Class Variable" action against a live
 * stone. Needs no refactoring engine — removing a class variable is a base-image operation
 * that reshapes nothing — so it runs in both CI passes. The fixture carries one class
 * variable a method reads and one nothing touches, which is the whole point: the first
 * asks before it goes, the second does not. The harness aborts afterward, so the throwaway
 * class never reaches the repository.
 */
describe('Explorer remove class variable (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => queries.executeFetchString(session(), code);

  const TEST_CLASS = 'VsCodeExplorerRemoveClassVarTest';
  const USED_VAR = 'VsCodeUsedVar';
  const UNUSED_VAR = 'VsCodeUnusedVar';

  const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;
  const showInformationMessage = window.showInformationMessage as ReturnType<typeof vi.fn>;

  const dictIndexOf = (name: string): number => {
    const index = queries.getDictionaryNames(session()).indexOf(name) + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  const defineFixture = (): void => {
    queries.compileClassDefinition(
      session(),
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #(${USED_VAR} ${UNUSED_VAR})
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
      `readsIt\n  ^ ${USED_VAR}`,
    );
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

  const classVarNames = (): string =>
    exec(`${TEST_CLASS} classVarNames asSortedCollection asArray printString`);

  beforeEach(() => {
    vi.clearAllMocks();
    window.tabGroups.all = [];
  });

  it('removes a class variable no method reads without asking', async () => {
    defineFixture();

    await controllerOnFixture().removeClassVar({
      className: TEST_CLASS,
      classVarName: UNUSED_VAR,
    });

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(classVarNames()).not.toContain(UNUSED_VAR);
  });

  it('announces a removal it did not ask about', async () => {
    defineFixture();

    await controllerOnFixture().removeClassVar({
      className: TEST_CLASS,
      classVarName: UNUSED_VAR,
    });

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining(`Removed class variable ${UNUSED_VAR}`),
    );
  });

  it('leaves the variables a removal did not target in place', async () => {
    defineFixture();

    await controllerOnFixture().removeClassVar({
      className: TEST_CLASS,
      classVarName: UNUSED_VAR,
    });

    expect(classVarNames()).toContain(USED_VAR);
  });

  it('keeps a class variable a method reads when the confirmation is dismissed', async () => {
    defineFixture();
    showWarningMessage.mockResolvedValue(undefined);

    await controllerOnFixture().removeClassVar({ className: TEST_CLASS, classVarName: USED_VAR });

    expect(showWarningMessage).toHaveBeenCalled();
    expect(classVarNames()).toContain(USED_VAR);
  });

  it('removes a class variable a method reads when the user chooses to remove it anyway', async () => {
    defineFixture();
    showWarningMessage.mockResolvedValue('Remove Anyway');

    await controllerOnFixture().removeClassVar({ className: TEST_CLASS, classVarName: USED_VAR });

    expect(classVarNames()).not.toContain(USED_VAR);
  });
});
