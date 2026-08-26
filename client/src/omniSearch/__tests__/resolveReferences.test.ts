/**
 * resolveReferencesUsing — the references-pivot query layer.
 *
 * Senders and references can live in any method environment, so the pivot must sweep
 * 0..maxEnvironment (like the gemstone.sendersOfSelector / implementorsOfSelector commands), not just
 * environment 0. A hit found in a non-zero environment must survive AND open in that environment; a
 * method that appears in more than one environment is shown once (lowest-environment copy kept).
 *
 * browserQueries is mocked so no stone is needed; each env returns a distinct row so we can prove which
 * environments were actually queried and which env each surviving row was tagged with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  sendersOf: vi.fn(),
  referencesToObject: vi.fn(),
  // Named imports the module pulls from browserQueries but this test never exercises.
  defaultQueryExecutorUsing: vi.fn(),
  getMethodSource: vi.fn(),
  getClassDefinition: vi.fn(),
}));

import { __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { sendersOf, referencesToObject } from '../../browserQueries';
import { resolveReferencesUsing } from '../omniSearchCommand';
import type { MethodSearchResult } from '../../queries/methodSearch';
import type { OmniResult } from '../omniTypes';
import type { ActiveSession } from '../../sessionManager';

const sendersOfMock = vi.mocked(sendersOf);

const SESSION = { id: 5 } as ActiveSession;

// A method OmniResult, so referenceRequestFor() asks for senders of its selector.
const methodResult: OmniResult = {
  categoryId: 'methods',
  label: 'Object>>foo',
  score: 1,
  ranges: [],
  action: {
    kind: 'openMethod',
    sessionId: 5,
    dictName: 'Globals',
    className: 'Object',
    isMeta: false,
    category: 'accessing',
    selector: 'foo',
    environmentId: 0,
    dictIndex: 0,
  },
};

function row(className: string): MethodSearchResult {
  return {
    dictName: 'Globals',
    className,
    isMeta: false,
    selector: 'foo',
    category: 'accessing',
    environmentId: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
});

describe('resolveReferencesUsing sweeps every method environment', () => {
  it('queries only environment 0 when maxEnvironment is 0 (the default)', () => {
    sendersOfMock.mockReturnValue([row('CallerA')]);

    const view = resolveReferencesUsing(SESSION)(methodResult);

    expect(sendersOfMock).toHaveBeenCalledTimes(1);
    expect(sendersOfMock).toHaveBeenCalledWith(SESSION, 'foo', 0);
    expect(view?.results).toHaveLength(1);
  });

  it('queries 0..maxEnvironment and keeps hits found only in a non-zero environment', () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    // env 0 → CallerA, env 1 → nothing, env 2 → CallerC.
    sendersOfMock.mockImplementation((_s, _sel, env) =>
      env === 0 ? [row('CallerA')] : env === 2 ? [row('CallerC')] : [],
    );

    const view = resolveReferencesUsing(SESSION)(methodResult);

    expect(sendersOfMock.mock.calls.map((c) => c[2])).toEqual([0, 1, 2]); // swept every env
    const labels = view?.results.map((r) => r.label);
    expect(labels).toEqual(['CallerA>>foo', 'CallerC>>foo']); // env-0 and env-2 hits both survive
  });

  it('tags each surviving row with the environment it was found in, so it opens there', () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    sendersOfMock.mockImplementation((_s, _sel, env) =>
      env === 0 ? [row('CallerA')] : [row('CallerC')],
    );

    const view = resolveReferencesUsing(SESSION)(methodResult);

    const envById = Object.fromEntries(
      (view?.results ?? []).map((r) => [
        r.label,
        r.action.kind === 'openMethod' ? r.action.environmentId : -1,
      ]),
    );
    expect(envById['CallerA>>foo']).toBe(0);
    expect(envById['CallerC>>foo']).toBe(1); // NOT 0 — it opens in the env it was found in
  });

  it('shows a method that appears in several environments once, keeping the lowest-env copy', () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    sendersOfMock.mockReturnValue([row('CallerA')]); // same hit in every env

    const view = resolveReferencesUsing(SESSION)(methodResult);

    expect(view?.results).toHaveLength(1); // deduped by class/selector
    const only = view?.results[0];
    expect(only?.action.kind === 'openMethod' && only.action.environmentId).toBe(0); // lowest env kept
  });

  it('returns null for a non-referenceable result and never queries', () => {
    const dictResult: OmniResult = {
      categoryId: 'dictionaries',
      label: 'UserGlobals',
      score: 1,
      ranges: [],
      action: { kind: 'revealDictionary', sessionId: 5, dictName: 'UserGlobals' },
    };

    expect(resolveReferencesUsing(SESSION)(dictResult)).toBeNull();
    expect(sendersOfMock).not.toHaveBeenCalled();
    expect(vi.mocked(referencesToObject)).not.toHaveBeenCalled();
  });
});
