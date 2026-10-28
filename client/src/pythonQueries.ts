import { ActiveSession } from './sessionManager';
import { defaultQueryExecutorUsing } from './browserQueries';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from './gciConstants';
import { NbRunOptions, runNbCall } from './nbRunner';
import { failCell, fetchCellResult } from './notebookCellResult';

import {
  evalPython as sharedEvalPython,
  pythonInScopeCode,
  resetPythonScope as sharedResetPythonScope,
  compilePython as sharedCompilePython,
} from './queries/python';

export function evalPython(session: ActiveSession, source: string) {
  return sharedEvalPython(defaultQueryExecutorUsing(session), source);
}

/**
 * Run a Python cell in its notebook's module scope (see `evalPythonInScope` in
 * queries/python.ts), non-blocking, so VS Code stays free while it runs and it
 * can be stopped like any other run (`onStart` hands out its canceller).
 */
export async function evalPythonInScopeNb(
  session: ActiveSession,
  source: string,
  scopeId: string,
  onStart?: NbRunOptions['onStart'],
): Promise<string> {
  const code = pythonInScopeCode(source, scopeId);
  return await runNbCall(
    session,
    () => session.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
    async () => {
      const { result, err } = session.GciTsNbResult();
      if (err.number !== 0) return await failCell(session, err);
      return fetchCellResult(session, result);
    },
    { title: 'GemStone: Running cell…', disposableProcess: true, onStart },
  );
}

export function resetPythonScope(session: ActiveSession, scopeId: string) {
  return sharedResetPythonScope(defaultQueryExecutorUsing(session), scopeId);
}

export function compilePython(session: ActiveSession, source: string) {
  return sharedCompilePython(defaultQueryExecutorUsing(session), source);
}
