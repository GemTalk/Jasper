import { describe, it, expect, vi } from 'vitest';
import {
  getEnhancedInspectorViewSpecs,
  EnhancedInspectorViewSpec,
} from '../queries/getEnhancedInspectorViewSpecs';

describe('getEnhancedInspectorViewSpecs', () => {
  it('returns specs sorted ascending by priority', async () => {
    expect.assertions(4);
    const execute = vi.fn(async () =>
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
    const result = await getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);
    expect(result![0].priority).toBe(5);
    expect(result![1].priority).toBe(20);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #getInspectorSpecificationData');
    expect(await getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is malformed JSON', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'not valid json');
    expect(await getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is a JSON object instead of an array', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '{}');
    expect(await getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when response is an empty string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '');
    expect(await getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns non-null array when JSON array elements lack view spec properties', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '[1,2,3]');

    const result = await getEnhancedInspectorViewSpecs(execute, 1000n);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await getEnhancedInspectorViewSpecs(execute, 1000n)).toBeNull();
  });

  it('resolves forward view spec and merges resolvedViewName and resolvedColumnSpecifications', async () => {
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
    const result = await getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result![0].resolvedViewName).toBe('GtPhlowListViewSpecification');
    expect(result![0].resolvedColumnSpecifications).toHaveLength(1);
  });

  it('resolved spec prefers __typeName over viewName', async () => {
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
    const result = await getEnhancedInspectorViewSpecs(execute, 1000n);
    expect(result).not.toBeNull();
    expect(result![0].resolvedViewName).toBe('GtPhlowColumnedListViewSpecification');
  });

  it('embeds the oop and references GtRemotePhlowViewedObject in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '[]');
    await getEnhancedInspectorViewSpecs(execute, 99999n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('GtRemotePhlowViewedObject');
  });
});
