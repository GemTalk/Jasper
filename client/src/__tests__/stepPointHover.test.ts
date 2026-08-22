import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getMethodSource: vi.fn(() => ''),
  getSourceOffsets: vi.fn(() => []),
  getStepPointSelectorRanges: vi.fn(() => []),
}));

import type * as vscode from 'vscode';
import { Uri, Position } from '../__mocks__/vscode';
import { StepPointHoverProvider } from '../stepPointHover';
import { StepPointModel } from '../stepPointModel';
import { BreakpointManager, AppliedBreakpoint } from '../breakpointManager';
import { SessionManager } from '../sessionManager';
import { getMethodSource, getSourceOffsets, getStepPointSelectorRanges } from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockGetRanges = vi.mocked(getStepPointSelectorRanges);

/** The mock's Position is structurally distinct from vscode's; bridge it once. */
const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;

const METHOD_URI = 'gemstone://1/Globals/Account/instance/accessing/balance';
//                0         1
//                0123456789012345678
const SOURCE = 'balance\n^self total';
//  'self' at 0-based 9, 'total' at 14

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

function makeDocument(uriStr = METHOD_URI) {
  return {
    uri: Uri.parse(uriStr),
    isDirty: false,
    getText: () => SOURCE,
    // Line 0 is 'balance' (8 chars incl. newline); line 1 starts at offset 8.
    offsetAt: (p: Position) => (p.line === 0 ? p.character : 8 + p.character),
    positionAt: (offset: number) =>
      offset < 8 ? new Position(0, offset) : new Position(1, offset - 8),
  } as unknown as import('vscode').TextDocument;
}

function makeManager(applied: AppliedBreakpoint[] = []) {
  return { appliedFor: vi.fn(() => applied) } as unknown as BreakpointManager;
}

function hoverText(hover: import('vscode').Hover | null): string {
  if (!hover) return '';
  const contents = hover.contents as { value: string }[] | { value: string };
  return Array.isArray(contents) ? contents.map((c) => c.value).join('\n') : contents.value;
}

describe('StepPointHoverProvider', () => {
  beforeEach(() => {
    mockGetMethodSource.mockReset().mockReturnValue(SOURCE);
    // step points 1 and 2, at 0-based 9 ('self') and 14 ('total')
    mockGetSourceOffsets.mockReset().mockReturnValue([10, 15]);
    mockGetRanges.mockReset().mockReturnValue([
      { stepPoint: 1, selectorOffset: 9, selectorLength: 4, selectorText: 'self' },
      { stepPoint: 2, selectorOffset: 14, selectorLength: 5, selectorText: 'total' },
    ]);
  });

  it('reports the step point under the pointer', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    // character 6 on line 1 => offset 14 => 'total' => step point 2
    const hover = provider.provideHover(makeDocument(), pos(1, 6));
    expect(hoverText(hover)).toContain('Step point 2');
  });

  it('reports how many step points the method has', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    const hover = provider.provideHover(makeDocument(), pos(1, 1));
    expect(hoverText(hover)).toContain('of 2');
  });

  it('highlights the step point’s own token, so the reach is visible', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    const hover = provider.provideHover(makeDocument(), pos(1, 6));
    // 'total' spans offsets 14..19, i.e. characters 6..11 of line 1.
    expect(hover?.range?.start).toMatchObject({ line: 1, character: 6 });
    expect(hover?.range?.end).toMatchObject({ line: 1, character: 11 });
  });

  it('offers to set a breakpoint when there is none', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    const text = hoverText(provider.provideHover(makeDocument(), pos(1, 6)));
    expect(text).toContain('gemstone.breakpoints.toggleAtStepPoint');
    expect(text).not.toContain('disableAtStepPoint');
  });

  it('offers clear and disable for an enabled breakpoint', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager([{ stepPoint: 2, offset: 14, line: 2, enabled: true }]),
    );
    const text = hoverText(provider.provideHover(makeDocument(), pos(1, 6)));
    expect(text).toContain('Breakpoint set');
    expect(text).toContain('gemstone.breakpoints.clearAtStepPoint');
    expect(text).toContain('gemstone.breakpoints.disableAtStepPoint');
  });

  it('offers enable for a disabled breakpoint', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager([{ stepPoint: 2, offset: 14, line: 2, enabled: false }]),
    );
    const text = hoverText(provider.provideHover(makeDocument(), pos(1, 6)));
    expect(text).toContain('disabled');
    expect(text).toContain('gemstone.breakpoints.enableAtStepPoint');
  });

  it('says nothing when the pointer is not on a step point token', () => {
    // Character 0 of line 1 is '^', which carries no selector range here — and
    // the caret rule would otherwise fall forward and misreport a step point.
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    expect(provider.provideHover(makeDocument(), pos(1, 0))).toBeNull();
  });

  it('says nothing for a non-gemstone document', () => {
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    expect(provider.provideHover(makeDocument('file:///a.st'), pos(1, 6))).toBeNull();
  });

  it('says nothing for a method with no step points', () => {
    mockGetSourceOffsets.mockReturnValue([]);
    mockGetRanges.mockReturnValue([]);
    const provider = new StepPointHoverProvider(
      new StepPointModel(makeSessionManager()),
      makeManager(),
    );
    expect(provider.provideHover(makeDocument(), pos(1, 6))).toBeNull();
  });
});
