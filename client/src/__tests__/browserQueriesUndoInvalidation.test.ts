import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub every shared builder these wrappers delegate to, so the invalidation rule can be
// asserted without a live GCI transport.
vi.mock('../refactoring/queries/previewUndoRefactoring', () => ({
  refactoringUndoStatus: vi.fn(() => '{"available":false}'),
  startUndoRefactoringPreview: vi.fn(() => Promise.resolve('START')),
  pageUndoRefactoringPreview: vi.fn(() => Promise.resolve('PAGE')),
  applyUndoRefactoring: vi.fn(() => Promise.resolve('APPLY')),
  clearUndoRefactoringPreview: vi.fn(() => 'ok'),
  clearRefactoringUndo: vi.fn(() => 'ok'),
}));
vi.mock('../refactoring/queries/previewInstVar', () => ({
  applyInstVar: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewInstVarStructure', () => ({
  applyInstVarStructure: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewExtractSuperclass', () => ({
  applyExtractSuperclass: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewSplitClass', () => ({
  applySplitClass: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewRenameClass', () => ({
  applyRenameClass: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewRenameInstVar', () => ({
  applyRenameInstVar: vi.fn(() => 'APPLY'),
}));
vi.mock('../refactoring/queries/previewRenameClassVar', () => ({
  applyRenameClassVar: vi.fn(() => Promise.resolve('APPLY')),
}));
vi.mock('../refactoring/queries/previewRenameMethod', () => ({
  applyRenameMethod: vi.fn(() => Promise.resolve('APPLY')),
  PREVIEW_PAGE_BYTES: 1024,
}));

import * as undoQueries from '../refactoring/queries/previewUndoRefactoring';
import * as instVarQueries from '../refactoring/queries/previewInstVar';
import {
  applyInstVar,
  applyInstVarStructure,
  applyExtractSuperclass,
  applySplitClass,
  applyRenameClass,
  applyRenameInstVar,
  applyRenameClassVar,
  applyRenameMethod,
} from '../browserQueries';
import type { ActiveSession } from '../sessionManager';

/**
 * The undo-invalidation rule (#434).
 *
 * A class-reshaping refactoring records NO undo of its own — class shape has its own
 * restore path — but it also makes any PREVIOUSLY recorded method undo untrustworthy:
 * it creates new class versions, so the recorded sources may no longer compile into the
 * class they name, and offering "undo the last refactoring" would name the wrong one.
 *
 * So each of their applies forgets the record. This pins that for every one of them,
 * including when the apply itself fails — a partial class reshape invalidates the record
 * just as thoroughly as a complete one — and pins that a method refactoring does NOT
 * forget it (that is the whole feature).
 */

const session = { id: 1 } as ActiveSession;

beforeEach(() => vi.clearAllMocks());

const forgotten = (): boolean => vi.mocked(undoQueries.clearRefactoringUndo).mock.calls.length > 0;

describe('class-reshaping applies forget the recorded undo', () => {
  it('add/remove instance variable', async () => {
    await applyInstVar(session, 'tok', [], null, false, false);
    expect(forgotten()).toBe(true);
  });

  it('instance-variable structure (push up / push down / convert temporary)', async () => {
    await applyInstVarStructure(session, 'tok');
    expect(forgotten()).toBe(true);
  });

  it('extract superclass', async () => {
    await applyExtractSuperclass(session, 'tok');
    expect(forgotten()).toBe(true);
  });

  it('split class', async () => {
    await applySplitClass(session, 'tok');
    expect(forgotten()).toBe(true);
  });

  it('rename class', async () => {
    await applyRenameClass(session, 'tok', []);
    expect(forgotten()).toBe(true);
  });

  it('rename instance variable (the synchronous one)', () => {
    applyRenameInstVar(session, 'tok', []);
    expect(forgotten()).toBe(true);
  });

  it('rename class variable', async () => {
    await applyRenameClassVar(session, 'tok');
    expect(forgotten()).toBe(true);
  });

  it('forgets it even when the apply itself fails', async () => {
    vi.mocked(instVarQueries.applyInstVar).mockRejectedValueOnce(new Error('boom'));

    await expect(applyInstVar(session, 'tok', [], null, false, false)).rejects.toThrow('boom');

    expect(forgotten()).toBe(true);
  });

  it('still hands the apply result back unchanged', async () => {
    await expect(applyExtractSuperclass(session, 'tok')).resolves.toBe('APPLY');
  });
});

describe('a method refactoring keeps its record', () => {
  it('rename method does NOT forget the undo it just recorded', async () => {
    await applyRenameMethod(session, 'tok', [], 'Rename #a to #b');
    expect(forgotten()).toBe(false);
  });
});
