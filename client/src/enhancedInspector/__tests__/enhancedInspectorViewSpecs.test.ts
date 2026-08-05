import { describe, it, expect, vi } from 'vitest';
import { getEnhancedInspectorViewSpecs } from '../queries/getEnhancedInspectorViewSpecs';

describe('getEnhancedInspectorViewSpecs', () => {
  it('returns null when execute returns a EIError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'EIError:viewed object not found');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when execute returns malformed JSON', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not valid json {{{');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns specs sorted by ascending priority', () => {
    const priorities = [50, 10, 80, 30, 70, 20, 90, 40, 60, 1];
    expect.assertions(priorities.length);
    const specs = priorities.map((priority, i) => ({
      viewName: 'GtPhlowListViewSpecification',
      title: `View${i}`,
      priority,
      methodSelector: `gtView${i}For:`,
      dataTransport: 1,
    }));
    const execute = vi.fn(() => JSON.stringify(specs));
    const result = getEnhancedInspectorViewSpecs(execute, 1000n)!;
    const sorted = [...priorities].sort((a, b) => a - b);
    sorted.forEach((p, i) => expect(result[i].priority).toBe(p));
  });

  it('makes a second execute call to resolve a forward view spec', () => {
    expect.assertions(2);
    const specs = [
      {
        viewName: 'GtPhlowForwardViewSpecification',
        title: 'Forward',
        priority: 1,
        methodSelector: 'gtForwardFor:',
        dataTransport: 1,
      },
    ];
    const execute = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(specs))
      .mockReturnValueOnce(
        JSON.stringify({ __typeName: 'GtPhlowListViewSpecification', columnSpecifications: [] }),
      );
    const result = getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result![0].resolvedViewName).toBe('GtPhlowListViewSpecification');
  });

  it('embeds oop in emitted Smalltalk', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    getEnhancedInspectorViewSpecs(execute, 99999n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
  });
});
