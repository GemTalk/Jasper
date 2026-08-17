/**
 * #428 item #18 — production wiring guard. The provider mechanism (literalsProvider's onError sink)
 * is unit-tested in literalsProviderErrors.test.ts; this proves buildProviders actually CONNECTS it
 * to the durable log. Without the wiring, a real GCI failure during a literal search stays invisible
 * (the original bug), so this test fails the moment the onError argument is dropped from the
 * createLiteralsProvider call.
 *
 * Kept in its own file so it runs clear of Round 4's parallel edits to omniSearchCommand.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));
// The literals runner is the one boundary that throws on a GCI drop; make it do so. The other two
// exports are imported by omniSearchCommand for the source/string paths and just need to exist.
vi.mock('../../queries/methodSearch', () => ({
  searchMethodSource: vi.fn(() => []),
  stringLiteralReferences: vi.fn(() => []),
  literalSymbolReferences: vi.fn(() => {
    throw new Error('GCI connection dropped');
  }),
}));

import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import { buildProviders } from '../omniSearchCommand';
import { logWarning } from '../../gciLog';
import type { ActiveSession } from '../../sessionManager';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

beforeEach(() => vi.clearAllMocks());

describe('buildProviders wires the Literals provider to the GCI log (#18)', () => {
  it('logs a warning when the literal runner throws on a well-formed #symbol', () => {
    const providers = buildProviders({ id: 1 } as ActiveSession, ['literals']);
    const literals = providers.find((p) => p.category.id === 'literals');
    expect(literals).toBeDefined();

    const results = literals!.search('#at:put:', cfg(), NEVER_CANCELLED);

    expect(results).toEqual([]); // the swallow-to-[] contract is preserved
    expect(vi.mocked(logWarning)).toHaveBeenCalledTimes(1); // ...but it is no longer silent
    expect(String(vi.mocked(logWarning).mock.calls[0][0])).toContain('GCI connection dropped');
  });
});
