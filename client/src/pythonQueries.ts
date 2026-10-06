import { ActiveSession } from './sessionManager';
import { defaultQueryExecutorUsing } from './browserQueries';

import {
  evalPython as sharedEvalPython,
  evalPythonInScope as sharedEvalPythonInScope,
  resetPythonScope as sharedResetPythonScope,
  compilePython as sharedCompilePython,
} from './queries/python';

export async function evalPython(session: ActiveSession, source: string) {
  return await sharedEvalPython(defaultQueryExecutorUsing(session), source);
}

export async function evalPythonInScope(session: ActiveSession, source: string, scopeId: string) {
  return await sharedEvalPythonInScope(defaultQueryExecutorUsing(session), source, scopeId);
}

export async function resetPythonScope(session: ActiveSession, scopeId: string) {
  return await sharedResetPythonScope(defaultQueryExecutorUsing(session), scopeId);
}

export async function compilePython(session: ActiveSession, source: string) {
  return await sharedCompilePython(defaultQueryExecutorUsing(session), source);
}
