import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  inlineChangeLabel,
  isCoreChange,
  InlineChange,
} from '../inlineMethodPreview';

/**
 * Pure parsing/labelling for the inline-method (M2) preview model. No vscode.
 */

const recompile: InlineChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'report',
  category: 'printing',
  oldSource: 'report\n\t^ self total',
  newSource: 'report\n\t^ balance',
};

const removal: InlineChange = {
  id: '2',
  kind: 'methodRemove',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'total',
  category: 'accessing',
  oldSource: 'total\n\t^ balance',
  newSource: '',
};

describe('inline analysis parsing', () => {
  it('reads the target class, selector, last-sender flag, and decline', () => {
    const a = parseAnalysis(
      JSON.stringify({
        targetClass: 'Account',
        targetSelector: 'total',
        lastSender: true,
        decline: null,
      }),
    );

    expect(a.targetClass).toBe('Account');
    expect(a.targetSelector).toBe('total');
    expect(a.lastSender).toBe(true);
    expect(a.decline).toBeNull();
  });

  it('carries a decline reason when the send cannot be inlined', () => {
    const a = parseAnalysis(
      JSON.stringify({ targetClass: null, targetSelector: null, lastSender: false, decline: 'no' }),
    );

    expect(a.decline).toBe('no');
    expect(a.targetSelector).toBeNull();
  });
});

describe('start-preview parsing', () => {
  it('reads totals, the target selector, the last-sender flag, and the first page', () => {
    const start = parseStartPreview(
      JSON.stringify({
        token: 't',
        total: 2,
        targetSelector: 'total',
        lastSender: true,
        outOfScope: { collision: null, decline: null },
        page: { changes: [recompile, removal], nextOffset: 3, done: true },
      }),
    );

    expect(start.total).toBe(2);
    expect(start.targetSelector).toBe('total');
    expect(start.lastSender).toBe(true);
    expect(start.page.changes).toHaveLength(2);
    expect(start.page.done).toBe(true);
  });

  it('surfaces a hard decline in the out-of-scope payload', () => {
    const start = parseStartPreview(
      JSON.stringify({
        token: 't',
        total: 0,
        targetSelector: null,
        lastSender: false,
        outOfScope: { collision: null, decline: 'not a send' },
        page: { changes: [], nextOffset: 0, done: true },
      }),
    );

    expect(start.outOfScope.decline).toBe('not a send');
  });
});

describe('page and apply parsing', () => {
  it('rejects a change of an unknown kind', () => {
    const bad = JSON.stringify({
      changes: [{ id: '9', kind: 'methodAdd', className: 'X' }],
      nextOffset: 1,
      done: true,
    });

    expect(() => parsePage(bad)).toThrow(/unknown kind/);
  });

  it('reads the applied count and the failed list', () => {
    const r = parseApplyResult(
      JSON.stringify({ applied: 2, failed: [{ id: '2', label: 'Account>>total', error: 'boom' }] }),
    );

    expect(r.applied).toBe(2);
    expect(r.failed[0].error).toBe('boom');
  });
});

describe('labels and core-change rule', () => {
  it('labels the rewritten caller as Class>>selector', () => {
    expect(inlineChangeLabel(recompile)).toBe('Account>>report');
  });

  it('tags the target removal so the user sees it is a deletion', () => {
    expect(inlineChangeLabel(removal)).toContain('remove');
  });

  it('treats only the first change (the caller recompile) as the required core change', () => {
    expect(isCoreChange(0)).toBe(true);
    expect(isCoreChange(1)).toBe(false);
  });
});
