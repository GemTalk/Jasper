// Integration tests for `client/src/queries/python.ts` against a live stone.
//
// What these protect against that the unit tests can't: missing GS
// selectors (the `asUtf8` → `encodeAsUTF8` typo that slipped through three
// rounds of unit-test review), Utf8 immutability, and the round-2/3
// encoding-class confusion. The unit tests verify the synthesized
// Smalltalk's *text* — these tests verify it actually runs and produces
// the right result over GCI's `Utf8` fetch.

import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { evalPython, compilePython } from '../python';
import type { ActiveSession } from '../../sessionManager';

describe('python queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  describe('eval_python', () => {
    // Simplest possible success case — any encoding bug in the success
    // path would surface as the wrong digits or visible NUL bytes.
    it('evaluates a basic Python expression', () => {
      const result = evalPython(exec, '2 + 3');
      const dispatcherMissing = result.includes('Grail (GemStone-Python) not detected');
      // Stones without Grail report the hint cleanly; that's also a pass —
      // we only need to confirm we didn't get a wrapper error.
      if (dispatcherMissing) {
        expect(result).toContain('Grail');
        return;
      }
      expect(result.trim()).toBe('5');
    });

    // The round-2 / round-3 regression both lived on this branch. With the
    // current "build internal, encodeAsUTF8 at the boundary" design we
    // expect a clean "Error: <ClassName> — <messageText>" string. The two
    // ways this used to break: UTF-16LE bytes leaking through (every char
    // followed by NUL) and Utf8-stream `at:put:` raising before any text
    // was produced.
    it('reports Grail-side errors as a clean ASCII string (no UTF-16 leak, no Utf8 wrapper error)', () => {
      const result = evalPython(exec, 'undefined_variable');
      if (result.includes('Grail (GemStone-Python) not detected')) return;

      // Every byte readable; no NUL or every-other-NUL pattern.
      expect(result).not.toContain(' ');
      // The classic UTF-16LE-as-ASCII signature: alphabetic chars
      // alternating with spaces ("E r r o r"). If we see that, the
      // encoding fix has regressed.
      expect(result).not.toMatch(/^[A-Z] [a-z] /);
      // The previous "fixes" both surfaced through this exact message —
      // pin its absence so a future regression is immediately obvious.
      expect(result).not.toContain("Selector:  #'at:put:'");
      expect(result).not.toContain("Selector:  #'copyFrom:to:'");
      // Successful error reporting starts with our prefix.
      expect(result).toMatch(/^Error: /);
    });

    // Source is supplied verbatim, including single quotes. The escape
    // path is shared with every other query in the file — if it's broken,
    // every test on this branch breaks.
    it('escapes single quotes in Python source', () => {
      const result = evalPython(exec, "'hello'.upper()");
      if (result.includes('Grail (GemStone-Python) not detected')) return;
      expect(result).toContain('HELLO');
    });
  });

  describe('compile_python', () => {
    // Transpile path uses `parseSource: ... smalltalkSource`. Selector
    // typos there would surface as a wrapper error (caught by the same
    // regression guards as eval_python).
    it('returns the generated Smalltalk source for a Python expression', () => {
      const result = compilePython(exec, '1 + 1');
      if (result.includes('Grail (GemStone-Python) not detected')) return;
      // Whatever Grail emits, it must be ASCII-clean and non-empty.
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain(' ');
      expect(result).not.toContain("Selector:  #'at:put:'");
    });
  });
});
