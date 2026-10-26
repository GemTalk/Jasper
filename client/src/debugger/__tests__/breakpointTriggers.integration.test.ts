import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { GciLibrary } from '../../gciLibrary';
import * as queries from '../../browserQueries';
import * as debugQueries from '../debugQueries';
import { applyBreakpointRules } from '../conditionalBreakpoints';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
} from '../../gciConstants';
import type { ActiveSession, SessionManager } from '../../sessionManager';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { BreakpointManager } from '../breakpointManager';
import { StepPointModel } from '../stepPointModel';
import { buildMethodUri } from '../../gemstoneFileSystemProvider';
import { debug, Location, Position, SourceBreakpoint } from '../../__mocks__/vscode';

/**
 * A breakpoint waiting on one that is disabled stays disarmed for the whole
 * run, against a live gem.
 *
 * The manager says so by handing the gem a rule that names itself as its
 * trigger, and that is only right if the gem never arms a breakpoint that is
 * still waiting — which no unit test can show, since the unit tests stub the
 * gem out.
 */
describe('a breakpoint waiting on a disabled one (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const TEST_CLASS = 'VsCodeBreakpointWaitTest';
  const SELECTOR = 'countTo:';

  it('is passed over on every hit, and the run completes', async () => {
    const live = session();
    queries.compileClassDefinition(
      live,
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `${SELECTOR} n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n` +
        `    total := total + i ].\n  ^ total`,
    );
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: live.id,
      dictName: 'UserGlobals',
      className: TEST_CLASS,
      isMeta: false,
      category: 'test',
      selector: SELECTOR,
      environmentId: 0,
    });
    const source = queries.getMethodSource(live, TEST_CLASS, false, SELECTOR, 0);
    const lineOf = (needle: string): number =>
      source.slice(0, source.indexOf(needle)).split('\n').length - 1;

    // The loop body waits on `^ total`, which is disabled — so it can never
    // be reached, and the loop must never stop.
    debug.breakpoints = [
      new SourceBreakpoint(new Location(uri, new Position(lineOf('total := total + i'), 0)), true),
      new SourceBreakpoint(new Location(uri, new Position(lineOf('^ total'), 0)), false),
    ];
    const sessionManager = {
      getSelectedSession: () => live,
      getSessions: () => [live],
      onDidChangeSelection: () => ({ dispose: () => {} }),
    } as unknown as SessionManager;
    const manager = new BreakpointManager(sessionManager, new StepPointModel(sessionManager));

    let process: bigint | undefined;
    try {
      manager.applyToUri(live, uri);
      const applied = manager.appliedFor(uri);
      const loop = applied.find((a) => a.line === lineOf('total := total + i') + 1)!;
      const ret = applied.find((a) => a.line === lineOf('^ total') + 1)!;
      manager.setTrigger(uri, loop.stepPoint, { uri: uri.toString(), stepPoint: ret.stepPoint });

      const specs = manager.breakpointRulesFor(live);
      expect(specs).toHaveLength(1);
      expect(specs[0].triggeredBy).toBe(1);

      const { err } = gci.GciTsExecute(
        handle,
        `${TEST_CLASS} new ${SELECTOR} 20`,
        gci.utf8ClassOop(handle),
        OOP_ILLEGAL,
        OOP_NIL,
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
        0,
      );
      expect(err.number).toBe(6005);
      process = BigInt(err.context);
      expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loop.stepPoint);

      const outcome = await applyBreakpointRules(session(), process, specs);

      // The first hit above, then nineteen more, all passed over; the disabled
      // `^ total` does not stop either, so the run finishes.
      expect(outcome).toMatchObject({ kind: 'completed', skipped: 20 });
    } finally {
      if (process !== undefined) {
        try {
          debugQueries.clearStack(session(), process);
        } catch {
          /* already finished */
        }
      }
      queries.clearAllBreaks(live, TEST_CLASS, false, SELECTOR, 0);
      debug.breakpoints = [];
    }
  });
});
