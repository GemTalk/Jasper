/**
 * Production wiring guard: the Methods provider's reference path is unit-tested with a fake lookup
 * in providers.test.ts; this proves buildProviders hands it the real one. Without it, a pasted
 * `Class>>selector` silently falls through to the selector scan and finds nothing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../queries/lookupMethod', () => ({
  lookupMethod: vi.fn(() => [
    {
      dictName: 'Globals',
      className: 'Object',
      isMeta: false,
      selector: 'printString',
      category: 'printing',
    },
  ]),
}));
vi.mock('../../queries/searchSelectors', () => ({ searchSelectors: vi.fn(() => []) }));

import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED } from '../omniTypes';
import { buildProviders } from '../omniSearchCommand';
import { lookupMethod } from '../queries/lookupMethod';
import { searchSelectors } from '../../queries/searchSelectors';
import type { ActiveSession } from '../../sessionManager';

describe('buildProviders wires the Methods provider to the method lookup', () => {
  it('looks a pasted reference up instead of scanning selectors', () => {
    const [methods] = buildProviders({ id: 1 } as ActiveSession, ['methods']);

    const results = methods.search('Object>>printString', OMNI_DEFAULTS, NEVER_CANCELLED);

    expect(vi.mocked(lookupMethod)).toHaveBeenCalledWith(
      expect.any(Function),
      'Object',
      false,
      'printString',
    );
    expect(vi.mocked(searchSelectors)).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });
});
