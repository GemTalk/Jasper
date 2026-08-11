import { describe, it, expect, vi } from 'vitest';
import { renameDictionary } from '../renameDictionary';

describe('renameDictionary query', () => {
  it('resolves the target by 1-based symbol-list index', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, 5, 'NewName');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('sl := System myUserProfile symbolList.');
    expect(code).toContain('d := System myUserProfile symbolList at: 5 ifAbsent: [nil].');
    // The doit answers 'ok' on success — assert the code's terminal expression, not
    // the mock's canned return (which would be a tautology).
    expect(code.trimEnd().endsWith("'ok'")).toBe(true);
  });

  it('resolves the target by current name when given a string', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, 'OldDict', 'NewDict');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("d := System myUserProfile symbolList objectNamed: #'OldDict'.");
  });

  it('guards the system dictionaries', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, 2, 'NewName');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('(d == Globals)');
    expect(code).toContain('(d == Published)');
    expect(code).toContain('d == UserGlobals');
    expect(code).toContain('Cannot rename a system dictionary');
  });

  it('declines a name already in use (collision) and no-ops an unchanged name', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, 2, 'Taken');
    const code = exec.mock.calls[0][0];
    expect(code).toContain('(sl objectNamed: newSym) ifNotNil:');
    expect(code).toContain('already in use in the symbol list');
    expect(code).toContain("d name == newSym ifTrue: [^ 'ok'].");
  });

  it('performs the self-reference swap: add new, drop old', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, 2, 'NewName');
    const code = exec.mock.calls[0][0];
    expect(code).toContain("newSym := #'NewName'.");
    expect(code).toContain('oldKey := d keyAtValue: d ifAbsent: [nil].');
    expect(code).toContain('d name: newSym.');
    expect(code).toContain(
      '(oldKey notNil and: [oldKey ~~ newSym]) ifTrue: [d removeKey: oldKey ifAbsent: []].',
    );
  });

  it('escapes single quotes in the new name and the string-form target', () => {
    const exec = vi.fn().mockReturnValue('ok');
    renameDictionary(exec, "O'ld", "N'ew");
    const code = exec.mock.calls[0][0];
    expect(code).toContain("symbolList objectNamed: #'O''ld'");
    expect(code).toContain("newSym := #'N''ew'.");
  });
});
