import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  implementorsOf: vi.fn(() => []),
  sendersOf: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
  getClassComment: vi.fn(() => ''),
}));

import type * as vscode from 'vscode';
import type { TextDocument, CodeLens } from 'vscode';
import { Uri, Position, Range, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { CODE_LENS_SELECTORS, GemStoneCodeLensProvider } from '../gemstoneCodeLensProvider';
import { GemStoneHoverProvider } from '../gemstoneHoverProvider';
import { SelectorResolver } from '../gemstoneDefinitionProvider';
import { GCI_PROVIDER_SELECTORS, METHOD_LANGUAGE } from '../languageIds';
import { SessionManager } from '../sessionManager';
import { implementorsOf, sendersOf } from '../browserQueries';

/**
 * Who is allowed to show the senders/implementors counts, and what they owe.
 *
 * The counts have moved surface once: they were a CodeLens above the method
 * until the selector hover took them over, and the two read
 * `gemstone.maxEnvironment` differently — the lens swept 0..max, the hover
 * asked the ceiling alone. Nothing caught it, because each provider's own
 * tests stayed green: the lens still swept, and no hover test had ever raised
 * the setting. The counts simply stopped existing in a method editor for
 * anyone who had.
 *
 * The rule, stated once here rather than left implicit in two suites:
 *
 *   1. A `gemstone://` method editor is covered by a surface that shows counts.
 *   2. Every surface that shows counts sweeps 0..`gemstone.maxEnvironment`.
 *
 * If the counts move again, the new home goes in COUNT_SURFACES below. That
 * list is the checklist a move has to pass, not documentation of one.
 */
function matches(selectors: readonly vscode.DocumentFilter[], scheme: string, language: string) {
  return selectors.some((f) => f.scheme === scheme && f.language === language);
}

describe('senders/implementors count surfaces', () => {
  beforeEach(() => {
    __resetConfig();
    vi.clearAllMocks();
  });

  describe('a gemstone:// method editor has somewhere for the counts to live', () => {
    it('is served by the GCI providers, which is where the counts are now', () => {
      expect(matches(GCI_PROVIDER_SELECTORS, 'gemstone', METHOD_LANGUAGE)).toBe(true);
    });

    it('is deliberately NOT served by the CodeLens, which handed them over', () => {
      // Not a second assertion of the same fact: together with the one above it
      // says the counts have exactly one home behind this scheme. Both false is
      // the failure this file exists to catch.
      expect(matches(CODE_LENS_SELECTORS, 'gemstone', METHOD_LANGUAGE)).toBe(false);
    });
  });

  // `gemstone.maxEnvironment` is a ceiling — "look in environments 0 through N".
  // A surface that passes it through as the one environment to ask about answers
  // nothing at all, since almost nothing is compiled above 0.
  describe('every count surface sweeps 0..maxEnvironment', () => {
    beforeEach(() => {
      __setConfig('gemstone', 'maxEnvironment', 2);
    });

    it('the selector hover, which owns the counts in a method editor', async () => {
      const sessionManager = {
        getSelectedSession: () => ({ id: 1 }),
        onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
      } as unknown as SessionManager;
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const document = {
        uri: { toString: () => 'gemstone://1/Globals/Array/instance/accessing/size' },
        getText: () => 'self size',
        getWordRangeAtPosition: () => new Range(new Position(0, 5), new Position(0, 9)),
      } as unknown as vscode.TextDocument;

      await new GemStoneHoverProvider(sessionManager, resolver).provideHover(
        document,
        new Position(0, 5) as unknown as vscode.Position,
      );

      expect(vi.mocked(implementorsOf).mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
      expect(vi.mocked(sendersOf).mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
    });

    it('the CodeLens, which still owns them in a Topaz file', () => {
      vi.useFakeTimers();
      try {
        const sessionManager = new SessionManager();
        sessionManager.getSelectedSession = () => ({ id: 1 }) as never;
        const provider = new GemStoneCodeLensProvider(sessionManager);
        const document = {
          uri: Uri.file('/test.gs'),
          getText: () => 'method: MyClass\nsize\n  ^ 42\n%',
          languageId: 'gemstone-topaz',
          lineAt: vi.fn(),
          lineCount: 4,
        } as unknown as TextDocument;

        const lenses = provider
          .provideCodeLenses(document)
          .filter((l: CodeLens) => l.command?.command !== 'gemstone.fileInFile');
        provider.resolveCodeLens(lenses[0]); // schedules the deferred lookup
        vi.runAllTimers();

        expect(vi.mocked(sendersOf).mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
        provider.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
