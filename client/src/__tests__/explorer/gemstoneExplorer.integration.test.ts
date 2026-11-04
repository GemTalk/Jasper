import { describe, it, expect, onTestFinished, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { runNbCall } from '../../nbRunner';
import * as queries from '../../browserQueries';
import { ClassItem, ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { useIntegrationTest } from '../useIntegrationTest';
import { testActiveSession } from '../testActiveSession';

/**
 * The Classes pane remembers each class's variables and subclasses. A query
 * refused because a run holds the session must not be remembered as "none",
 * or the class keeps looking empty after the run ends. Each test runs on its
 * own transient session, so the fixture classes and the run never reach the
 * harness session, and logging out discards them.
 */
describe("the Classes pane's lookups (integration)", () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const PARENT = 'VsCodeExplorerBusyParent';
  const CHILD = 'VsCodeExplorerBusyChild';

  function transientSession(): ActiveSession {
    const { session: transient, err } = session().transientLogin(session().login);
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    return transient;
  }

  function defineFixture(on: ActiveSession): void {
    queries.compileClassDefinition(
      on,
      `Object subclass: '${PARENT}'
  instVarNames: #(vsCodeIvar)
  classVars: #(VsCodeClassVar)
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    queries.compileClassDefinition(
      on,
      `${PARENT} subclass: '${CHILD}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
  }

  function runFor(on: ActiveSession, seconds: number): Promise<unknown> {
    const run = runNbCall(
      on,
      () =>
        on.GciTsNbExecute(
          `(Delay forSeconds: ${seconds}) wait`,
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => on.GciTsNbResult(),
      { suppressNotification: true },
    );
    // A logout is refused while the call is still on the session.
    onTestFinished(async () => {
      await run.catch(() => {});
      on.logout();
    });
    return run;
  }

  function controllerOn(on: ActiveSession): ExplorerController {
    const sessionManager = { getSelectedSession: () => on } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = queries.getDictionaryNames(on).indexOf('UserGlobals') + 1;
    return ctl;
  }

  it("shows a class row's contents once the run that refused them ends", async () => {
    const transient = transientSession();
    defineFixture(transient);
    const ctl = controllerOn(transient);
    const run = runFor(transient, 1);
    expect((await ctl.classRow(PARENT)).instVarNames).toEqual([]);
    await run;

    const row = await ctl.classRow(PARENT);

    expect(row).toEqual({
      instVarNames: ['vsCodeIvar'],
      classVarNames: ['VsCodeClassVar'],
      ivarsCanMoveDown: true,
    });
  });

  it('loads the rows of classes expanded at the same time', async () => {
    const transient = transientSession();
    onTestFinished(() => {
      transient.logout();
    });
    defineFixture(transient);
    const ctl = controllerOn(transient);

    const [, parent] = await Promise.all([ctl.classRow(CHILD), ctl.classRow(PARENT)]);

    expect(parent.instVarNames).toEqual(['vsCodeIvar']);
  });

  it('loads a class row without a call that blocks until GemStone answers', async () => {
    const transient = transientSession();
    onTestFinished(() => {
      transient.logout();
    });
    defineFixture(transient);
    const ctl = controllerOn(transient);
    const blocking = vi.spyOn(transient, 'executeAndFetchString');
    const nonBlocking = vi.spyOn(transient, 'GciTsNbExecute');

    await ctl.classRow(PARENT);

    expect(nonBlocking).toHaveBeenCalledTimes(1);
    expect(blocking).not.toHaveBeenCalled();
  });

  it('keeps the selected class when a click is refused during a run', () => {
    const transient = transientSession();
    defineFixture(transient);
    const ctl = controllerOn(transient);
    ctl.selectClass(new ClassItem(PARENT), false);
    void runFor(transient, 1);

    ctl.selectClassFromTree(new ClassItem(CHILD));

    expect(ctl.state.className).toBe(PARENT);
  });

  it('selects a class clicked again once the run that refused it ends', async () => {
    const transient = transientSession();
    defineFixture(transient);
    const ctl = controllerOn(transient);
    ctl.selectClass(new ClassItem(PARENT), false);
    const run = runFor(transient, 1);
    ctl.selectClassFromTree(new ClassItem(CHILD));
    await run;

    ctl.selectClassFromTree(new ClassItem(CHILD));

    expect(ctl.state.className).toBe(CHILD);
  });

  it('remembers a class row that failed for a reason other than a busy session', async () => {
    const transient = transientSession();
    onTestFinished(() => {
      transient.logout();
    });
    defineFixture(transient);
    const ctl = controllerOn(transient);
    const dictIndex = ctl.state.dictIndex;
    ctl.state.dictIndex = 9999;
    expect((await ctl.classRow(PARENT)).instVarNames).toEqual([]);
    ctl.state.dictIndex = dictIndex;

    const row = await ctl.classRow(PARENT);

    expect(row.instVarNames).toEqual([]);
  });
});
