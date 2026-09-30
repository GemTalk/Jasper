import { describe, it, expect, vi } from 'vitest';
import {
  fetchEnhancedInspectorListTotal,
  fetchEnhancedInspectorListData,
  fetchEnhancedInspectorTextData,
  fetchEnhancedInspectorPrintTabData,
  fetchEnhancedInspectorForwardListData,
  fetchEnhancedInspectorForwardListTotal,
  fetchEnhancedInspectorTreeChildren,
} from '../queries/getEnhancedInspectorViewSpecs';

describe('fetchEnhancedInspectorListTotal', () => {
  it('returns count as a number on happy path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '42');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBe(42);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtItemsFor:');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('returns null when response is not a number', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'not a number');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('returns null when response is an empty string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('handles whitespace in response', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '  42\n');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBe(42);
  });

  it('returns 0 when response is "0" — valid count, not treated as falsy', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '0');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'gtItemsFor:')).toBe(0);
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '42');
    expect(await fetchEnhancedInspectorListTotal(execute, 1000n, 'bad selector!')).toBeNull();
  });

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '0');
    await fetchEnhancedInspectorListTotal(execute, 99999n, 'gtItemsFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
  });
});

describe('fetchEnhancedInspectorListData', () => {
  it('returns JSON string on happy path without modification', async () => {
    expect.assertions(1);
    const json = '[{"col1":"foo"},{"col1":"bar"}]';
    const execute = vi.fn(async () => json);
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBe(json);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtItemsFor:');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBeNull();
  });

  it('embeds oop, methodSelector, fromIndex, and count in emitted Smalltalk', async () => {
    expect.assertions(4);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorListData(execute, 99999n, 'gtItemsFor:', 1, 50);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
    expect(code).toContain('1');
    expect(code).toContain('50');
  });

  it('returns null when fromIndex is 0 — below valid 1-based range', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 0, 100)).toBeNull();
  });

  it('returns null when count is 0', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, 0)).toBeNull();
  });

  it('returns null when fromIndex is negative', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', -1, 100)).toBeNull();
  });

  it('returns null when fromIndex is a float', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1.5, 100),
    ).toBeNull();
  });

  it('returns null when count is negative', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, -1)).toBeNull();
  });

  it('returns null when count is a float', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(await fetchEnhancedInspectorListData(execute, 1000n, 'gtItemsFor:', 1, 1.5)).toBeNull();
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorListData(execute, 1000n, 'bad selector!', 1, 100),
    ).toBeNull();
  });

  it('passes through very large count — no upper bound validation', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorListData(
        execute,
        1000n,
        'gtItemsFor:',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    ).not.toBeNull();
  });
});

describe('fetchEnhancedInspectorTextData', () => {
  it('returns the text data JSON string on happy path', async () => {
    expect.assertions(1);
    const json = '{"string":"hello world","truncated":false}';
    const execute = vi.fn(async () => json);
    expect(await fetchEnhancedInspectorTextData(execute, 1000n, 'gtTextFor:')).toBe(json);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtTextFor:');
    expect(await fetchEnhancedInspectorTextData(execute, 1000n, 'gtTextFor:')).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchEnhancedInspectorTextData(execute, 1000n, 'gtTextFor:')).toBeNull();
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '{}');
    expect(await fetchEnhancedInspectorTextData(execute, 1000n, 'bad selector!')).toBeNull();
  });

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    await fetchEnhancedInspectorTextData(execute, 99999n, 'gtTextFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtTextFor:');
  });
});

describe('fetchEnhancedInspectorPrintTabData', () => {
  it('returns data and truncated:false on happy path', async () => {
    expect.assertions(2);
    const json = '{"string":"hello world","truncated":false}';
    const execute = vi.fn(async () => json);
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(json);
    expect(result.truncated).toBe(false);
  });

  it('returns data and truncated:true when JSON reports truncation', async () => {
    expect.assertions(2);
    const json = '{"string":"hello wo...","truncated":true}';
    const execute = vi.fn(async () => json);
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(json);
    expect(result.truncated).toBe(true);
  });

  it('returns data and truncated:false when JSON.parse fails on malformed response', async () => {
    expect.assertions(2);
    const badJson = 'not valid json {{{';
    const execute = vi.fn(async () => badJson);
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(badJson);
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when execute returns a EIError string', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => 'EIError:does not understand #gtPrintTabFor:');
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when execute throws', async () => {
    expect.assertions(2);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when methodSelector is invalid', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    const result = await fetchEnhancedInspectorPrintTabData(execute, 1000n, 'bad selector!');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    await fetchEnhancedInspectorPrintTabData(execute, 99999n, 'gtPrintTabFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtPrintTabFor:');
  });
});

describe('fetchEnhancedInspectorForwardListData', () => {
  it('returns JSON string on happy path', async () => {
    expect.assertions(1);
    const json = '[{"col1":"foo"},{"col1":"bar"}]';
    const execute = vi.fn(async () => json);
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100),
    ).toBe(json);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtForwardFor:');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100),
    ).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100),
    ).toBeNull();
  });

  it('returns null when forwardSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'bad selector!', 1, 100),
    ).toBeNull();
  });

  it('returns null when fromIndex is 0', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 0, 100),
    ).toBeNull();
  });

  it('returns null when fromIndex is negative', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', -1, 100),
    ).toBeNull();
  });

  it('returns null when fromIndex is a float', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1.5, 100),
    ).toBeNull();
  });

  it('returns null when count is 0', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, 0),
    ).toBeNull();
  });

  it('returns null when count is negative', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, -1),
    ).toBeNull();
  });

  it('returns null when count is a float', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorForwardListData(execute, 1000n, 'gtForwardFor:', 1, 1.5),
    ).toBeNull();
  });

  it('embeds oop, forwardSelector, fromIndex, and count in emitted Smalltalk', async () => {
    expect.assertions(4);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorForwardListData(execute, 99999n, 'gtForwardFor:', 1, 50);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtForwardFor:');
    expect(code).toContain('1');
    expect(code).toContain('50');
  });
});

describe('fetchEnhancedInspectorForwardListTotal', () => {
  it('returns count as a number on happy path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '42');
    expect(await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(42);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtForwardFor:');
    expect(
      await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:'),
    ).toBeNull();
  });

  it('returns null when response is not a number', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'not a number');
    expect(
      await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:'),
    ).toBeNull();
  });

  it('returns null when response is an empty string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '');
    expect(
      await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:'),
    ).toBeNull();
  });

  it('handles whitespace in response', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '  42\n');
    expect(await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(42);
  });

  it('returns 0 when response is "0" — valid count, not treated as falsy', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '0');
    expect(await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(0);
  });

  it('returns null when forwardSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '42');
    expect(
      await fetchEnhancedInspectorForwardListTotal(execute, 1000n, 'bad selector!'),
    ).toBeNull();
  });

  it('embeds oop and forwardSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '0');
    await fetchEnhancedInspectorForwardListTotal(execute, 99999n, 'gtForwardFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtForwardFor:');
  });
});

describe('fetchEnhancedInspectorTreeChildren', () => {
  it('returns JSON string on happy path', async () => {
    expect.assertions(1);
    const json = '[{"label":"child1"},{"label":"child2"}]';
    const execute = vi.fn(async () => json);
    expect(await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBe(json);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtTreeFor:');
    expect(await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBeNull();
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    expect(
      await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'bad selector!', [1]),
    ).toBeNull();
  });

  it('produces {} in Smalltalk for an empty path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', []);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('{}');
  });

  it('produces {1} in Smalltalk for a single-element path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', [1]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('{1}');
  });

  it('produces {1. 2. 3} in Smalltalk for a multi-element path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorTreeChildren(execute, 1000n, 'gtTreeFor:', [1, 2, 3]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('{1. 2. 3}');
  });

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '[]');
    await fetchEnhancedInspectorTreeChildren(execute, 99999n, 'gtTreeFor:', [1]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtTreeFor:');
  });
});
