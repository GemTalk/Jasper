import { describe, it, expect, vi } from 'vitest';
import type { QueryExecutor } from '../types';
import { getStoredClassComment } from '../getStoredClassComment';
import { getClassComment } from '../getClassComment';

/**
 * A comment document opens on what the class STORES, never on `cls comment` —
 * which since 3.1 synthesises "No class-specific documentation for X…" plus a
 * rendered hierarchy for a class that has none. Opening on that makes the
 * boilerplate editable text: Ctrl+Z returns to it rather than to nothing, and
 * saving writes it in as a genuine comment.
 */
describe('getStoredClassComment', () => {
  it('reads the extra-dict key, not the synthesising accessor', () => {
    const execute = vi.fn<QueryExecutor>(() => 'A widget.');

    expect(getStoredClassComment(execute, 'Widget')).toBe('A widget.');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('_extraDictAt: #comment');
    expect(code).not.toContain('cls comment');
  });

  it('answers empty for a class with no comment of its own', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    expect(getStoredClassComment(execute, 'Widget')).toBe('');
    // The doit itself answers '' for a nil key and for a class it cannot resolve,
    // rather than letting either reach the editor.
    const code = execute.mock.calls[0][0];
    expect(code).toContain("cls ifNil: [^ '']");
    expect(code).toContain("c ifNil: [^ '']");
  });

  it('scopes the lookup to a dictionary', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getStoredClassComment(execute, 'Widget', 2);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 2');
  });

  // The hover and the System Browser's Comment panel deliberately still show the
  // synthesised text, where the rendered hierarchy is worth reading.
  it('is not what getClassComment asks', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassComment(execute, 'Widget', 2);
    expect(execute.mock.calls[0][0]).toContain('cls comment');
    expect(execute.mock.calls[0][0]).not.toContain('_extraDictAt:');
  });
});
