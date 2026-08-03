import { describe, it, expect, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../sessionManager';
import {
  OOP_NIL,
  OOP_ILLEGAL,
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
} from '../gciConstants';
import { stepOver, continueExecution, clearStack } from '../debugQueries';

const GCI_ERR_HALT = 2709;
const GCI_ERR_STEP_POINT = 6002; // "Single-step breakpoint encountered" — a successful step
const OOP_FORTY_TWO = 338n; // SmallInteger 42: (42 << 3) | 2

/**
 * Automatic GCI integration tests for debugger single-stepping. Executions are
 * started with GCI_PERFORM_FLAG_INTERPRETED (GemStone cannot step native code —
 * error 6014 — and a process must START interpreted to be steppable); the
 * step/continue performs carry the same flag. The halt is raised inside real
 * compiled methods, not a doit frame, so on stones where native code is enabled
 * (x86 — Darwin/ARM builds don't support it) these tests prove the flag keeps
 * the process steppable. Errors 6014 here mean the flag scheme regressed.
 */
describe('debugger single-stepping (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const exec = (code: string, flags: number) => {
    const strClass = gci.resolveSymbol(handle, 'String');
    return gci.GciTsExecute(handle, code, strClass, OOP_ILLEGAL, OOP_NIL, flags, 0);
  };

  // Compiles a throwaway class (session-local; the harness's per-test abort
  // discards it) whose `outer` calls `inner`, which halts — then runs it and
  // returns the halted GsProcess. The halt sits inside compiled methods so the
  // parked frames are ordinary methods, which native code (where supported)
  // would otherwise compile.
  function haltedProcess(): bigint {
    const compiled = exec(
      `| cls |
cls := Object subclass: 'ZzSteppingProbe' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
cls compileMethod: 'inner ^ self halt' dictionaries: System myUserProfile symbolList category: #probe.
cls compileMethod: 'outer | x | x := self inner. ^ 42' dictionaries: System myUserProfile symbolList category: #probe.
'compiled'`,
      0,
    );
    expect(compiled.err.number).toBe(0);

    const { err } = exec(
      'ZzSteppingProbe new outer',
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );

    expect(err.number).toBe(GCI_ERR_HALT);
    expect(err.context).not.toBe(0n);
    return err.context;
  }

  it('single-steps a process halted inside a compiled method', () => {
    let gsProcess = haltedProcess();
    let ranToCompletion = false;

    try {
      for (let i = 0; i < 3 && !ranToCompletion; i++) {
        const step = stepOver(session(), gsProcess, 1);

        if (step.completed) {
          ranToCompletion = true;
        } else {
          expect(step.errorNumber).toBe(GCI_ERR_STEP_POINT);
          gsProcess = step.errorContext!;
        }
      }
    } finally {
      if (!ranToCompletion) clearStack(session(), gsProcess);
    }
  });

  it('continues a halted process to normal completion with its result', () => {
    const gsProcess = haltedProcess();

    const result = continueExecution(session(), gsProcess);

    expect(result.completed).toBe(true);
    expect(result.resultOop).toBe(OOP_FORTY_TWO);
  });
});
