import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub the shared query builders so we can assert the extension-side wrappers delegate to them
// with the right arguments and hand back their result, without a live GCI transport.
vi.mock('../refactoring/queries/previewInstVar', () => ({
  analyzeInstVar: vi.fn(() => Promise.resolve('ANALYZE')),
  startInstVarPreview: vi.fn(() => Promise.resolve('START')),
  pageInstVarPreview: vi.fn(() => Promise.resolve('PAGE')),
  applyInstVar: vi.fn(() => Promise.resolve('APPLY')),
  clearInstVarPreview: vi.fn(() => 'ok'),
}));

import * as shared from '../refactoring/queries/previewInstVar';
import {
  analyzeInstVar,
  startInstVarPreview,
  pageInstVarPreview,
  applyInstVar,
  clearInstVarPreview,
} from '../browserQueries';
import type { ActiveSession } from '../sessionManager';

/**
 * The extension-side browserQueries wrappers are thin: each attaches a progress-labelled,
 * non-blocking executor to the session and delegates to the shared builder. These pin that
 * delegation — arguments passed straight through and the builder's result handed back — so the
 * wrapper layer the live suites bypass is exercised. A working executor function is passed each
 * time; its GCI plumbing is covered by executeFetchStringNb's own tests.
 */

const session = { id: 1 } as ActiveSession;

beforeEach(() => vi.clearAllMocks());

describe('browserQueries instance-variable wrappers', () => {
  it('analyzeInstVar delegates to the shared builder and returns its result', async () => {
    const result = await analyzeInstVar(session, 'add', 'Foo', 'bar', 1);

    expect(shared.analyzeInstVar).toHaveBeenCalledWith(
      expect.any(Function),
      'add',
      'Foo',
      'bar',
      1,
    );
    expect(result).toBe('ANALYZE');
  });

  it('startInstVarPreview delegates with the token, page size, and dict', async () => {
    const result = await startInstVarPreview(
      session,
      'remove',
      'Foo',
      'count',
      'tok',
      4096,
      'Users',
    );

    expect(shared.startInstVarPreview).toHaveBeenCalledWith(
      expect.any(Function),
      'remove',
      'Foo',
      'count',
      'tok',
      4096,
      'Users',
    );
    expect(result).toBe('START');
  });

  it('pageInstVarPreview delegates with the token, offset, and page size', async () => {
    const result = await pageInstVarPreview(session, 'tok', 3, 4096);

    expect(shared.pageInstVarPreview).toHaveBeenCalledWith(expect.any(Function), 'tok', 3, 4096);
    expect(result).toBe('PAGE');
  });

  it('applyInstVar delegates with the deselection, options, and commit flags', async () => {
    const result = await applyInstVar(session, 'tok', ['x'], ['logCreation'], true, false);

    expect(shared.applyInstVar).toHaveBeenCalledWith(
      expect.any(Function),
      'tok',
      ['x'],
      ['logCreation'],
      true,
      false,
    );
    expect(result).toBe('APPLY');
  });

  it('clearInstVarPreview delegates with the token', () => {
    const result = clearInstVarPreview(session, 'tok');

    expect(shared.clearInstVarPreview).toHaveBeenCalledWith(expect.any(Function), 'tok');
    expect(result).toBe('ok');
  });
});
