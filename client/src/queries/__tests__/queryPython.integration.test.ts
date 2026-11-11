// Integration tests for `client/src/queries/python.ts` against a live stone.
//
// Only the Grail-absent case runs here: no CI leg installs Grail, so a test that
// needs it would skip on every run.

import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { evalPython } from '../python';
import type { ActiveSession } from '../../sessionManager';
import { requireGrailAbsent } from './support/grailAvailability';
import { testActiveSession } from '../../__tests__/testActiveSession';

describe('python queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  describe('eval_python', () => {
    it('reports a clear hint when Grail is not installed', (ctx) => {
      requireGrailAbsent(ctx, exec);

      const result = evalPython(exec, '2 + 3');

      expect(result).toContain('Grail');
    });
  });
});
