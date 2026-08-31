import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// `StepPointModel.fetch` asks for all three in one query now. The bundle mock
// delegates to the three separate mocks so every test keeps setting up its
// method the same way, one fact at a time.
vi.mock('../browserQueries', () => {
  const getMethodSource = vi.fn(() => '');
  const getSourceOffsets = vi.fn((): number[] => []);
  const getStepPointSelectorRanges = vi.fn((): unknown[] => []);
  return {
    getMethodSource,
    getSourceOffsets,
    getStepPointSelectorRanges,
    getStepPointBundle: vi.fn((...args: unknown[]) => ({
      source: (getMethodSource as (...a: unknown[]) => string)(...args),
      offsets: (getSourceOffsets as (...a: unknown[]) => number[])(...args),
      selectors: (getStepPointSelectorRanges as (...a: unknown[]) => unknown[])(...args),
    })),
  };
});

import type * as vscode from 'vscode';
import { Uri, Position, Range, debug, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { StepPointHintsProvider, shouldShow, readDisplaySetting } from '../stepPointHints';
import { StepPointModel } from '../stepPointModel';
import { SessionManager } from '../sessionManager';
import { getMethodSource, getSourceOffsets, getStepPointSelectorRanges } from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockGetRanges = vi.mocked(getStepPointSelectorRanges);

describe('shouldShow', () => {
  it('never shows when off', () => {
    expect(shouldShow('off', true)).toBe(false);
    expect(shouldShow('off', false)).toBe(false);
  });

  it('always shows when always', () => {
    expect(shouldShow('always', false)).toBe(true);
    expect(shouldShow('always', true)).toBe(true);
  });

  it('shows while debugging, and not otherwise — the point of the default', () => {
    expect(shouldShow('debugging', true)).toBe(true);
    expect(shouldShow('debugging', false)).toBe(false);
  });
});

describe('readDisplaySetting', () => {
  beforeEach(() => __resetConfig());

  it('defaults to debugging when unset', () => {
    expect(readDisplaySetting()).toBe('debugging');
  });

  it('falls back to debugging for a value it does not recognise', () => {
    __setConfig('gemstone', 'stepPoints.display', 'nonsense');
    expect(readDisplaySetting()).toBe('debugging');
  });

  it('honours an explicit choice', () => {
    __setConfig('gemstone', 'stepPoints.display', 'always');
    expect(readDisplaySetting()).toBe('always');
  });
});

describe('StepPointHintsProvider', () => {
  const METHOD_URI = 'gemstone://1/Globals/Array/instance/accessing/at%3A';
  const SOURCE = 'at: index\n^self basicAt: index';

  function makeSessionManager() {
    return {
      getSelectedSession: vi.fn(() => ({
        id: 1,
        gci: {},
        handle: 'h',
        login: {},
        stoneVersion: '3.7.5',
      })),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
  }

  function makeDocument() {
    return {
      uri: Uri.parse(METHOD_URI),
      isDirty: false,
      getText: () => SOURCE,
      offsetAt: (p: Position) => (p.line === 0 ? p.character : 10 + p.character),
      positionAt: (offset: number) =>
        offset < 10 ? new Position(0, offset) : new Position(1, offset - 10),
    } as unknown as import('vscode').TextDocument;
  }

  /** The mock's Range is structurally distinct from vscode's; bridge it once. */
  const range = (l1: number, c1: number, l2: number, c2: number) =>
    new Range(new Position(l1, c1), new Position(l2, c2)) as unknown as vscode.Range;

  /** The whole document, as VS Code asks for on first render. */
  const WHOLE = range(0, 0, 1, 100);

  function makeProvider(display: string) {
    __setConfig('gemstone', 'stepPoints.display', display);
    return new StepPointHintsProvider(new StepPointModel(makeSessionManager()));
  }

  beforeEach(() => {
    __resetConfig();
    mockGetMethodSource.mockReset().mockReturnValue(SOURCE);
    // step points at 0-based 10 ('^') and 16 ('basicAt:')
    mockGetSourceOffsets.mockReset().mockReturnValue([11, 17]);
    mockGetRanges.mockReset().mockReturnValue([]);
    debug.activeDebugSession = undefined;
  });

  it('draws nothing when numbering is off', () => {
    expect(makeProvider('off').provideInlayHints(makeDocument(), WHOLE)).toBeUndefined();
  });

  it('draws nothing outside a debug session when set to debugging', () => {
    expect(makeProvider('debugging').provideInlayHints(makeDocument(), WHOLE)).toBeUndefined();
  });

  it('draws while a debug session is live when set to debugging', () => {
    debug.activeDebugSession = { id: 'x' };
    const hints = makeProvider('debugging').provideInlayHints(makeDocument(), WHOLE);
    expect(hints).toHaveLength(2);
  });

  it('numbers each step point from one', () => {
    const hints = makeProvider('always').provideInlayHints(makeDocument(), WHOLE);
    expect(hints?.map((h) => (h.label as { value: string }[])[0].value)).toEqual(['1', '2']);
  });

  it('makes each number a clickable breakpoint toggle for its own step point', () => {
    const hints = makeProvider('always').provideInlayHints(makeDocument(), WHOLE);
    const parts = hints!.map(
      (h) => (h.label as { command?: { command: string; arguments: unknown[] } }[])[0],
    );
    expect(parts[0].command?.command).toBe('gemstone.breakpoints.toggleAtStepPoint');
    expect(parts[0].command?.arguments).toEqual([{ uri: METHOD_URI, stepPoint: 1 }]);
    expect(parts[1].command?.arguments).toEqual([{ uri: METHOD_URI, stepPoint: 2 }]);
  });

  it('only draws the step points inside the requested range', () => {
    // Offsets 0..12 covers the '^' step point (10) but not 'basicAt:' (16).
    const narrow = range(0, 0, 1, 2);
    const hints = makeProvider('always').provideInlayHints(makeDocument(), narrow);
    expect(hints?.map((h) => (h.label as { value: string }[])[0].value)).toEqual(['1']);
  });

  it('draws nothing for a method whose step points cannot be read', () => {
    mockGetMethodSource.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(makeProvider('always').provideInlayHints(makeDocument(), WHOLE)).toBeUndefined();
  });

  // Writing a setting is slow enough that a second call lands mid-await — a
  // double-click on the editor-title icon, or a held keybinding.
  describe('toggle', () => {
    it('flips back when invoked twice before the settings write lands', async () => {
      const provider = makeProvider('always');
      expect(provider.visible()).toBe(true);

      // Both started before either await resolves, which is the race.
      await Promise.all([provider.toggle(), provider.toggle()]);

      // Two toggles from 'always' is 'always' again. Reading the flag only after
      // the write meant both calls saw 'always', both computed 'off', and the
      // pair collapsed into one net change.
      expect(provider.visible()).toBe(true);
    });

    it('flips once for a single invocation', async () => {
      const provider = makeProvider('always');
      await provider.toggle();
      expect(provider.visible()).toBe(false);
    });
  });

  describe('visible', () => {
    it('reports off correctly', () => {
      expect(makeProvider('off').visible()).toBe(false);
    });

    it('reports always correctly', () => {
      expect(makeProvider('always').visible()).toBe(true);
    });

    it('follows the debug session when set to debugging', () => {
      const provider = makeProvider('debugging');
      expect(provider.visible()).toBe(false);
      debug.activeDebugSession = { id: 'x' };
      expect(provider.visible()).toBe(true);
    });
  });
});
