import { describe, it, expect, vi } from 'vitest';
import {
  getEnhancedInspectorViewSpecs,
  EnhancedInspectorViewSpec,
} from '../queries/getEnhancedInspectorViewSpecs';

describe('getEnhancedInspectorViewSpecs', () => {
  it('returns specs sorted ascending by priority', () => {
    expect.assertions(4);
    const execute = vi.fn(() =>
      JSON.stringify([
        {
          viewName: 'GtPhlowListViewSpecification',
          title: 'Items',
          priority: 20,
          methodSelector: 'gtItemsFor:',
          dataTransport: 1,
        },
        {
          viewName: 'GtPhlowTextViewSpecification',
          title: 'Print',
          priority: 5,
          methodSelector: 'gtPrintFor:',
          dataTransport: 0,
        },
      ]),
    );
    const result = getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);
    expect(result![0].priority).toBe(5);
    expect(result![1].priority).toBe(20);
  });

  it('returns null when execute returns a EIError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'EIError:does not understand #getInspectorSpecificationData');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is malformed JSON', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not valid json');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is a JSON object instead of an array', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '{}');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is an empty string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '');
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns non-null array when JSON array elements lack view spec properties', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[1,2,3]');
    const result = getEnhancedInspectorViewSpecs(execute, 1000n);
    if (result !== null) {
      expect(result).toHaveLength(3);
    }
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('resolves forward view spec and merges resolvedViewName and resolvedColumnSpecifications', () => {
    expect.assertions(3);
    const forwardSpec: EnhancedInspectorViewSpec = {
      viewName: 'GtPhlowForwardViewSpecification',
      title: 'Items',
      priority: 10,
      methodSelector: 'gtItemsFor:',
      dataTransport: 1,
    };
    const resolvedSpec = {
      viewName: 'GtPhlowListViewSpecification',
      columnSpecifications: [{ type: 'text', title: 'Item', cellWidth: null, spawnsObjects: true }],
    };
    const execute = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify([forwardSpec]))
      .mockReturnValueOnce(JSON.stringify(resolvedSpec));
    const result = getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result![0].resolvedViewName).toBe('GtPhlowListViewSpecification');
    expect(result![0].resolvedColumnSpecifications).toHaveLength(1);
  });

  it('resolved spec prefers __typeName over viewName', () => {
    expect.assertions(2);
    const forwardSpec: EnhancedInspectorViewSpec = {
      viewName: 'GtPhlowForwardViewSpecification',
      title: 'Items',
      priority: 10,
      methodSelector: 'gtItemsFor:',
      dataTransport: 1,
    };
    const resolvedSpec = {
      __typeName: 'GtPhlowColumnedListViewSpecification',
      viewName: 'GtPhlowListViewSpecification',
      columnSpecifications: [],
    };
    const execute = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify([forwardSpec]))
      .mockReturnValueOnce(JSON.stringify(resolvedSpec));
    const result = getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result![0].resolvedViewName).toBe('GtPhlowColumnedListViewSpecification');
  });

  it('embeds the oop and references GtRemotePhlowViewedObject in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '[]');
    getEnhancedInspectorViewSpecs(execute, 99999n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('GtRemotePhlowViewedObject');
  });
});
