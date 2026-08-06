import { describe, it, expect } from 'vitest';
import { classifyGemstoneUri } from '../explorerOpenEditorsLabel';
import type { ParsedUri } from '../gemstoneFileSystemProvider';

function methodUri(over: Partial<ParsedUri> = {}): ParsedUri {
  return {
    kind: 'method',
    sessionId: 1,
    dictName: 'Globals',
    className: 'Array',
    isMeta: false,
    category: 'accessing',
    selector: 'at:',
    environmentId: 0,
    ...over,
  };
}

describe('classifyGemstoneUri', () => {
  it('labels an instance method as Class>>selector under the method group', () => {
    expect(classifyGemstoneUri(methodUri())).toEqual({ kind: 'method', label: 'Array>>at:' });
  });

  it('marks the class side of a method with a "(class)" receiver', () => {
    const entry = classifyGemstoneUri(methodUri({ isMeta: true, selector: 'new' }));

    expect(entry?.label).toBe('Array (class)>>new');
  });

  it('appends a "(base)" suffix for the persistent base source of an override', () => {
    const entry = classifyGemstoneUri(methodUri({ base: true }));

    expect(entry?.label).toBe('Array>>at: (base)');
  });

  it('omits the read-only override-diff comparison view', () => {
    expect(classifyGemstoneUri(methodUri({ diffView: true }))).toBeUndefined();
  });

  it('labels a class definition by its class name under the class group', () => {
    const parsed = {
      kind: 'definition',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
    } as ParsedUri;

    expect(classifyGemstoneUri(parsed)).toEqual({ kind: 'class', label: 'Array' });
  });

  it('labels a class comment by its class name under the comment group', () => {
    const parsed = {
      kind: 'comment',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
    } as ParsedUri;

    expect(classifyGemstoneUri(parsed)).toEqual({ kind: 'comment', label: 'Array' });
  });

  it('omits the new-class template', () => {
    const parsed = { kind: 'new-class', sessionId: 1, dictName: 'UserGlobals' } as ParsedUri;

    expect(classifyGemstoneUri(parsed)).toBeUndefined();
  });

  it('omits the new-method template', () => {
    const parsed = methodUri();
    const asNewMethod = { ...parsed, kind: 'new-method' } as ParsedUri;

    expect(classifyGemstoneUri(asNewMethod)).toBeUndefined();
  });
});
