import { describe, it, expect, vi } from 'vitest';
import { renameClassCategory } from '../renameClassCategory';

describe('renameClassCategory query', () => {
  it('resolves the dictionary by 1-based index', () => {
    const exec = vi.fn().mockReturnValue('renamed: 3');
    const out = renameClassCategory(exec, 3, 'Old', 'New');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('dict := System myUserProfile symbolList at: 3 ifAbsent: [nil].');
    expect(out).toBe('renamed: 3');
  });

  it('resolves the dictionary by name', () => {
    const exec = vi.fn().mockReturnValue('renamed: 0');
    renameClassCategory(exec, 'MyDict', 'Old', 'New');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("dict := System myUserProfile symbolList objectNamed: #'MyDict'.");
  });

  it('renames the exact category and the dash-segmented subtree', () => {
    const exec = vi.fn().mockReturnValue('renamed: 2');
    renameClassCategory(exec, 3, 'Announcements', 'Events');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("oldCat := 'Announcements'.");
    expect(code).toContain("newCat := 'Events'.");
    expect(code).toContain("prefix := oldCat , '-'.");
    // exact match via Unicode-safe Symbol identity (not String `=`; see 2718)
    expect(code).toContain('cat asSymbol == oldSym');
    // subtree: prefix compare (Symbol identity) + suffix-preserving reassignment.
    // '>=' (not '>') so a category named exactly 'Old-' (size = prefix size) is
    // treated as a subtree member rather than being left behind (LOW-1).
    expect(code).toContain('cat size >= prefix size');
    expect(code).toContain('(cat copyFrom: 1 to: prefix size) asSymbol == prefixSym');
    expect(code).toContain('v category: newCat , (cat copyFrom: oldCat size + 1 to: cat size)');
    expect(code).toContain('dict keysAndValuesDo:');
  });

  it('counts classes it could not read and reports them as skipped (LOW-2)', () => {
    const exec = vi.fn().mockReturnValue('renamed: 3 skipped: 1');
    renameClassCategory(exec, 3, 'Old', 'New');
    const code = exec.mock.calls[0][0];
    // An unreadable category increments a skipped counter instead of being ignored,
    // and the payload surfaces it so a partial rename doesn't look complete.
    expect(code).toContain('skipped := skipped + 1');
    expect(code).toContain("' skipped: ' , skipped printString");
  });

  it('guards a missing dictionary', () => {
    const exec = vi.fn().mockReturnValue('Dictionary not found');
    renameClassCategory(exec, 99, 'Old', 'New');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("dict ifNil: [^ 'Dictionary not found'].");
  });

  it('escapes single quotes in both paths and the string-form dictionary name', () => {
    const exec = vi.fn().mockReturnValue('renamed: 0');
    renameClassCategory(exec, "D'ct", "O'ld", "N'ew");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'D''ct'");
    expect(code).toContain("oldCat := 'O''ld'.");
    expect(code).toContain("newCat := 'N''ew'.");
  });
});
