import { describe, it, expect } from 'vitest';
import { compareMethodRows } from '../rank';
import { OmniResult } from '../omniTypes';

function methodRow(
  className: string,
  isMeta: boolean,
  selector: string,
  over: { score?: number; dictName?: string; environmentId?: number } = {},
): OmniResult {
  return {
    categoryId: 'methods',
    label: `${className}${isMeta ? ' class' : ''}>>${selector}`,
    score: over.score ?? 0,
    ranges: [],
    action: {
      kind: 'openMethod',
      sessionId: 1,
      dictName: over.dictName ?? 'UserGlobals',
      className,
      isMeta,
      category: 'misc',
      selector,
      environmentId: over.environmentId ?? 0,
      dictIndex: 1,
    },
  };
}

const labels = (rows: OmniResult[]) => rows.map((r) => r.label);

describe('compareMethodRows', () => {
  it('ranks by match score first', () => {
    const rows = [
      methodRow('Array', false, 'a', { score: 1 }),
      methodRow('Zed', false, 'z', { score: 9 }),
    ];
    expect(labels(rows.sort(compareMethodRows))).toEqual(['Zed>>z', 'Array>>a']);
  });

  it('orders equal scores by the shared method-list rule', () => {
    const rows = [
      methodRow('Foo', false, 'test10'),
      methodRow('Foo', true, '_new'),
      methodRow('Foo', false, 'test2'),
      methodRow('Foo', false, '\\\\'),
      methodRow('Foo', false, '_bottomBit'),
    ];
    expect(labels(rows.sort(compareMethodRows))).toEqual([
      'Foo>>_bottomBit',
      'Foo>>\\\\',
      'Foo>>test2',
      'Foo>>test10',
      'Foo class>>_new',
    ]);
  });

  it('breaks a tie on the dictionary, then the environment', () => {
    const rows = [
      methodRow('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 1 }),
      methodRow('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 0 }),
      methodRow('Foo', false, 'bar', { dictName: 'Globals', environmentId: 0 }),
    ];
    const sorted = rows
      .sort(compareMethodRows)
      .map((r) =>
        r.action.kind === 'openMethod' ? `${r.action.dictName}/${r.action.environmentId}` : '',
      );
    expect(sorted).toEqual(['Globals/0', 'UserGlobals/0', 'UserGlobals/1']);
  });
});
