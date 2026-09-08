import { describe, it, expect, vi } from 'vitest';

// methodHistoryServer pulls in gciLog, which imports the vscode host module; the
// install source itself needs none of it.
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
import { METHOD_HISTORY_INSTALL_CODE } from '../methodHistoryServer';

// The helper's Smalltalk lives in this module as source strings, so its shape can be
// asserted here without a stone. The behavioural proof is in methodHistory.integration
// .test.ts; these guard the parts a silent edit would otherwise only break in a stone.
describe('method-history helper source', () => {
  it('scopes the persistent store key by defining dictionary, not by class name alone', () => {
    // Two classes named Foo in different SymbolDictionaries must not interleave their
    // versions into one entry — the key carries the dictionary that defines the class.
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('keyFor: aBehavior selector: aSelector');
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('self dictionaryNameOf: aBehavior');
  });

  it('resolves the defining dictionary by identity, so a shadowed name finds THIS class', () => {
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('dictionaryNameOf: aBehavior');
    // `==` against the object held in the slot, not a name comparison: the instance
    // side matches the class itself, the class side matches that class's metaclass.
    expect(METHOD_HISTORY_INSTALL_CODE).toContain(
      'bound == aBehavior or: [bound class == aBehavior]',
    );
  });

  it('trims the metaclass suffix, since a metaclass is never itself bound', () => {
    expect(METHOD_HISTORY_INSTALL_CODE).toContain("asSymbol == #'' class''");
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('bound class == aBehavior');
  });

  it('references no global but System — these compile into a throwaway dictionary', () => {
    // A bare global here is an undefined symbol at COMPILE time (error 1001) and takes
    // the whole install doit down, surfacing only as "Method history support is not
    // available in this session" — never as a compile error. Verified against a real
    // 3.6.2 stone: an `isKindOf: Metaclass` test did exactly that. Message sends are
    // resolved at runtime and stay safe; bare globals are not.
    // Smalltalk comments are stripped first so prose may still name the hazard.
    const code = METHOD_HISTORY_INSTALL_CODE.replace(/"[^"]*"/g, ' ');
    // Whole words only: `UserGlobals` is legitimate (it holds the store) and must not
    // trip the `Globals` check.
    for (const global of ['Metaclass', 'Globals', 'AllUsers', 'SystemUser']) {
      expect(code).not.toMatch(new RegExp(`\\b${global}\\b`));
    }
  });

  it('takes an already-resolved class for reads and forgets, never resolving a bare name', () => {
    // The client owns the one dict-aware lookup idiom (queries/util.ts classLookupExpr);
    // re-resolving here would reintroduce the unscoped lookup this fix removed.
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('forClass: cls named: aName');
    expect(METHOD_HISTORY_INSTALL_CODE).toContain('removeHistoryForClass: cls named: aName');
    expect(METHOD_HISTORY_INSTALL_CODE).not.toContain('forClassNamed:');
    expect(METHOD_HISTORY_INSTALL_CODE).not.toContain('removeHistoryForClassNamed:');
  });
});
