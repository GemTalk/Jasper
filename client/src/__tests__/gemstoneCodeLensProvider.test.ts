import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  sendersOf: vi.fn(() => []),
  implementorsOf: vi.fn(() => []),
}));

import { Uri } from 'vscode';
import type { TextDocument, CodeLens } from 'vscode';
import { GemStoneCodeLensProvider } from '../gemstoneCodeLensProvider';
import { SessionManager, ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';

function createMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
    },
    stoneVersion: '3.7.2',
  };
}

/** Build a partial TextDocument mock, confining the one unavoidable cast here. */
function createMockDocument(text: string, scheme = 'file'): TextDocument {
  return {
    uri:
      scheme === 'gemstone'
        ? Uri.parse('gemstone://1/UserGlobals/MyClass/instance/accessing/name')
        : Uri.file('/test.gs'),
    getText: () => text,
    languageId: scheme === 'gemstone' ? 'gemstone-smalltalk' : 'gemstone-topaz',
    lineAt: vi.fn(),
    lineCount: text.split('\n').length,
  } as unknown as TextDocument;
}

describe('GemStoneCodeLensProvider', () => {
  let sessionManager: SessionManager;
  let provider: GemStoneCodeLensProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionManager = new SessionManager();
    provider = new GemStoneCodeLensProvider(sessionManager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The count is computed off the resolve path (so a spinner can paint first),
  // so resolving twice with the deferred work flushed in between yields the count.
  function resolveCount(lens: CodeLens): CodeLens {
    provider.resolveCodeLens(lens); // first resolve → spinner + schedules the lookup
    vi.runAllTimers(); // run the deferred sendersOf/implementorsOf
    return provider.resolveCodeLens(lens); // re-resolve → cache hit → the count
  }

  describe('provideCodeLenses', () => {
    // Each method gets two lenses on the same line: one for senders, one
    // for implementors. The pair is the VS Code convention — see e.g.
    // TypeScript's "N references | M implementations". Each is
    // independently clickable and dispatches to its own command.
    it('returns a senders+implementors lens pair per method in topaz files', () => {
      const doc = createMockDocument(`category: 'accessing'
method: MyClass
name
  ^ name
%
category: 'accessing'
method: MyClass
name: aString
  name := aString
%`);
      const lenses = provider.provideCodeLenses(doc);
      expect(lenses).toHaveLength(4); // 2 methods × 2 lenses
    });

    it('returns a senders+implementors lens pair for gemstone:// method URIs', () => {
      const doc = createMockDocument('name\n  ^ name', 'gemstone');
      const lenses = provider.provideCodeLenses(doc);
      expect(lenses).toHaveLength(2); // 1 method × 2 lenses
    });

    it('returns no lenses for an unsaved new-method template', () => {
      const doc = {
        uri: Uri.parse('gemstone://1/UserGlobals/MyClass/instance/accessing/new-method'),
        getText: () => 'messageSelector\n  ^ self',
        languageId: 'gemstone-smalltalk',
        lineAt: vi.fn(),
        lineCount: 2,
      } as unknown as TextDocument;

      const lenses = provider.provideCodeLenses(doc);

      expect(lenses).toHaveLength(0);
    });

    it('returns no lenses for empty files', () => {
      const doc = createMockDocument('');
      const lenses = provider.provideCodeLenses(doc);
      expect(lenses).toHaveLength(0);
    });

    it('returns no lenses for doit-only files', () => {
      const doc = createMockDocument(`run
true
%`);
      const lenses = provider.provideCodeLenses(doc);
      expect(lenses).toHaveLength(0);
    });
  });

  describe('resolveCodeLens', () => {
    it('shows a non-clickable spinner placeholder while the count is still loading', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([{}, {}]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      const loading = provider.resolveCodeLens(lenses[0]); // before the deferred lookup runs

      expect(loading.command?.title).toContain('$(loading~spin)');
      expect(loading.command?.command).toBe(''); // not clickable while counting
      expect(queries.sendersOf).not.toHaveBeenCalled(); // the lookup is deferred, not run inline
    });

    it('replaces the spinner with the real count once the lookup completes', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([{}, {}]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lens = provider.provideCodeLenses(doc)[0];

      expect(provider.resolveCodeLens(lens).command?.title).toContain('$(loading~spin)');
      vi.runAllTimers(); // the deferred lookup runs and caches the count
      expect(provider.resolveCodeLens(lens).command?.title).toBe('2 senders');
    });

    it('returns "No session" when no session is selected', () => {
      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      expect(lenses).toHaveLength(2);

      // Both lenses report no session — neither computes a count when
      // there's nothing to query against.
      for (const lens of lenses) {
        const resolved = provider.resolveCodeLens(lens);
        expect(resolved.command?.title).toBe('No session');
      }
    });

    it('emits the senders lens first, dispatching to gemstone.sendersOfSelector', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
        { dictName: 'D', className: 'D', isMeta: false, selector: 'foo', category: 'c' },
      ]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'MyClass', isMeta: false, selector: 'foo', category: 'c' },
      ]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      const sendersLens = resolveCount(lenses[0]);

      expect(sendersLens.command?.title).toBe('2 senders');
      expect(sendersLens.command?.command).toBe('gemstone.sendersOfSelector');
      expect(sendersLens.command?.arguments).toEqual([{ selector: 'foo', sessionId: session.id }]);
    });

    it('emits the implementors lens second, dispatching to gemstone.implementorsOfSelector', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
        { dictName: 'D', className: 'D', isMeta: false, selector: 'foo', category: 'c' },
      ]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'MyClass', isMeta: false, selector: 'foo', category: 'c' },
      ]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      const implementorsLens = resolveCount(lenses[1]);

      expect(implementorsLens.command?.title).toBe('1 implementor');
      expect(implementorsLens.command?.command).toBe('gemstone.implementorsOfSelector');
      expect(implementorsLens.command?.arguments).toEqual([
        { selector: 'foo', sessionId: session.id },
      ]);
    });

    // Each lens computes only its own count, so a senders lens never
    // queries implementorsOf and vice versa. Catches a regression where
    // the resolve path computed both for every lens (doubling the GCI work
    // for the two-lens pair).
    it('the senders lens does not call implementorsOf', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      resolveCount(lenses[0]); // senders lens

      expect(queries.sendersOf).toHaveBeenCalled();
      expect(queries.implementorsOf).not.toHaveBeenCalled();
    });

    it('the implementors lens does not call sendersOf', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      resolveCount(lenses[1]); // implementors lens

      expect(queries.implementorsOf).toHaveBeenCalled();
      expect(queries.sendersOf).not.toHaveBeenCalled();
    });

    it('handles singular counts on each lens', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
      ]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
      ]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      expect(resolveCount(lenses[0]).command?.title).toBe('1 sender');
      expect(resolveCount(lenses[1]).command?.title).toBe('1 implementor');
    });

    it('caches counts so a re-resolve does not re-run the server lookup', () => {
      // A re-resolve happens whenever another CodeLens provider on the same
      // document changes (e.g. the debugger's inline-values toggle). The count
      // must come from cache then — no extra sendersOf/implementorsOf calls.
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([{}, {}, {}]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc);
      expect(resolveCount(lenses[0]).command?.title).toBe('3 senders');
      // Re-provide + re-resolve (fresh lens objects, as VS Code does on a refresh):
      // the count comes from cache, so no second server lookup.
      const again = provider.provideCodeLenses(doc);
      expect(provider.resolveCodeLens(again[0]).command?.title).toBe('3 senders');
      expect(queries.sendersOf as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    });

    it('dispose() cancels a pending count lookup (no blocking GCI after teardown)', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      provider.resolveCodeLens(provider.provideCodeLenses(doc)[0]); // schedules the lookup

      provider.dispose();
      vi.runAllTimers(); // a still-pending timer would fire here

      expect(queries.sendersOf).not.toHaveBeenCalled();
    });

    it('refresh() clears the count cache (so a recompile can recount)', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;
      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([{}, {}, {}]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      resolveCount(provider.provideCodeLenses(doc)[0]);
      provider.refresh();
      resolveCount(provider.provideCodeLenses(doc)[0]);
      expect(queries.sendersOf as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    });
  });
});
