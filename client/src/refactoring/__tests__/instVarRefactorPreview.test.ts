import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  instVarChangeLabel,
  describeApplyFailure,
} from '../instVarRefactorPreview';
import type { ApplyResult } from '../instVarRefactorPreview';

const applyResult = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  applied: 2,
  failed: [],
  dropped: [],
  committed: false,
  ...over,
});

describe('instance-variable refactor preview parsing', () => {
  it('parses a viable add analysis', () => {
    const a = parseAnalysis(
      '{"decline":null,"operation":"add","sourceClass":"Foo","affectedCount":3,"willNotRecompileCount":0}',
    );
    expect(a.decline).toBeNull();
    expect(a.operation).toBe('add');
    expect(a.sourceClass).toBe('Foo');
    expect(a.affectedCount).toBe(3);
    expect(a.willNotRecompileCount).toBe(0);
  });

  it('parses a declined analysis', () => {
    const a = parseAnalysis(
      '{"decline":"Cannot add count: already an instance variable.","operation":"add","sourceClass":"Foo","affectedCount":0,"willNotRecompileCount":0}',
    );
    expect(a.decline).toMatch(/already an instance variable/);
  });

  it('parses a remove analysis reporting methods that will not recompile', () => {
    const a = parseAnalysis(
      '{"decline":null,"operation":"remove","sourceClass":"Foo","affectedCount":4,"willNotRecompileCount":2}',
    );
    expect(a.operation).toBe('remove');
    expect(a.willNotRecompileCount).toBe(2);
  });

  it('parses a start-preview envelope with will-not-recompile and note', () => {
    const s = parseStartPreview(
      JSON.stringify({
        token: 'tok1',
        total: 2,
        sourceClass: 'Foo',
        outOfScope: {
          decline: null,
          willNotRecompile: [
            { class: 'Foo', selector: 'combine' },
            { class: 'Sub', selector: 'doubleCount' },
          ],
          actedOnClass: 'Foo',
          note: 'Migrating instances and deleting history DO commit.',
        },
        page: {
          changes: [
            {
              id: '1',
              kind: 'classDefinitionEdit',
              dictName: 'UserGlobals',
              className: 'Foo',
              oldSource: 'a',
              newSource: 'b',
            },
          ],
          nextOffset: 2,
          done: false,
        },
      }),
    );
    expect(s.token).toBe('tok1');
    expect(s.outOfScope.willNotRecompile).toHaveLength(2);
    expect(s.outOfScope.willNotRecompile[0]).toEqual({ className: 'Foo', selector: 'combine' });
    expect(s.outOfScope.note).toMatch(/commit/);
    expect(s.page.changes[0].kind).toBe('classDefinitionEdit');
    expect(s.page.done).toBe(false);
  });

  it('throws when the start payload lacks a token', () => {
    expect(() => parseStartPreview('{"total":1}')).toThrow(/session token/);
  });

  it('parses a page and rejects an unknown change kind', () => {
    const p = parsePage(
      '{"changes":[{"id":"7","kind":"classReparent","dictName":"UserGlobals","className":"Sub","oldSource":"x","newSource":"x"}],"nextOffset":8,"done":true}',
    );
    expect(p.changes[0].kind).toBe('classReparent');
    expect(() =>
      parsePage(
        '{"changes":[{"id":"1","kind":"bogus","className":"X"}],"nextOffset":1,"done":true}',
      ),
    ).toThrow(/unknown kind/);
  });

  it('surfaces a page-level error string', () => {
    expect(() => parsePage('{"error":"preview session expired","changes":[]}')).toThrow(/expired/);
  });

  it('parses an apply result with dropped methods and the commit flag', () => {
    const r = parseApplyResult(
      '{"applied":3,"failed":[],"dropped":[{"class":"Foo","selector":"combine"}],"committed":true}',
    );
    expect(r.applied).toBe(3);
    expect(r.failed).toHaveLength(0);
    expect(r.dropped).toEqual([{ className: 'Foo', selector: 'combine' }]);
    expect(r.committed).toBe(true);
  });

  it('parses an apply result with failures and no commit', () => {
    const r = parseApplyResult(
      '{"applied":0,"failed":[{"id":"1","label":"Foo","error":"boom"}],"dropped":[],"committed":false}',
    );
    expect(r.failed[0].error).toBe('boom');
    expect(r.committed).toBe(false);
  });

  it('parses the partially-applied flag on a failed apply', () => {
    // Something was staged before the failure: the transaction holds a partial reshape.
    const staged = parseApplyResult(
      '{"applied":1,"failed":[{"id":"2","label":"Sub","error":"boom"}],"dropped":[],"committed":false,"partiallyApplied":true}',
    );
    expect(staged.partiallyApplied).toBe(true);

    // The very first change failed: nothing staged, nothing to abort.
    const nothingStaged = parseApplyResult(
      '{"applied":0,"failed":[{"id":"1","label":"Foo","error":"boom"}],"dropped":[],"committed":false,"partiallyApplied":false}',
    );
    expect(nothingStaged.partiallyApplied).toBe(false);
  });

  // An engine older than this change omits the field; undefined (not false) so the caller can
  // tell "nothing was staged" from "the engine did not say".
  it('leaves the partially-applied flag undefined when the engine omits it', () => {
    const r = parseApplyResult('{"applied":2,"failed":[],"dropped":[],"committed":false}');
    expect(r.partiallyApplied).toBeUndefined();
  });

  it('parses the session-has-uncommitted-changes flag from the preview', () => {
    const envelope = (extra: string): string =>
      `{"token":"t","total":1,"sourceClass":"Foo","outOfScope":{"decline":null,` +
      `"willNotRecompile":[],"actedOnClass":"Foo","note":null${extra}},` +
      `"page":{"changes":[],"nextOffset":1,"done":true}}`;

    expect(
      parseStartPreview(envelope(',"sessionHasUncommittedChanges":true')).outOfScope
        .sessionHasUncommittedChanges,
    ).toBe(true);
    expect(
      parseStartPreview(envelope(',"sessionHasUncommittedChanges":false')).outOfScope
        .sessionHasUncommittedChanges,
    ).toBe(false);
    // Absent (an older engine) reads as false — no warning rather than a false alarm.
    expect(parseStartPreview(envelope('')).outOfScope.sessionHasUncommittedChanges).toBe(false);
  });

  it('labels edited vs reparented changes', () => {
    expect(
      instVarChangeLabel({
        id: '1',
        kind: 'classDefinitionEdit',
        dictName: null,
        className: 'Foo',
        oldSource: '',
        newSource: '',
      }),
    ).toMatch(/definition edited/);
    expect(
      instVarChangeLabel({
        id: '2',
        kind: 'classReparent',
        dictName: null,
        className: 'Sub',
        oldSource: '',
        newSource: '',
      }),
    ).toMatch(/recompiled/);
  });
});

describe('describing an apply failure for the preview panel', () => {
  it('treats a clean apply as a success (no failure to show)', () => {
    expect(describeApplyFailure(applyResult({ applied: 2 }), false)).toBeNull();
  });

  it('offers an abort and names what is stranded when a partial reshape was staged', () => {
    const failure = describeApplyFailure(
      applyResult({
        applied: 1,
        failed: [{ id: 'c2', label: 'Sub (recompiled)', error: 'boom' }],
        partiallyApplied: true,
      }),
      false,
    );

    expect(failure).toEqual({
      canAbort: true,
      message: expect.stringContaining('1 class was already versioned and remains'),
    });
    expect(failure?.message).toContain('Sub (recompiled): boom');
  });

  it('pluralizes the stranded-class count', () => {
    const failure = describeApplyFailure(
      applyResult({
        applied: 3,
        failed: [{ id: 'c4', label: 'Leaf (recompiled)', error: 'boom' }],
        partiallyApplied: true,
      }),
      false,
    );

    expect(failure?.message).toContain('3 classes were already versioned and remain');
  });

  it('spells out that an abort also discards other uncommitted work in a dirty session', () => {
    const failure = describeApplyFailure(
      applyResult({
        applied: 1,
        failed: [{ id: 'c2', label: 'Sub (recompiled)', error: 'boom' }],
        partiallyApplied: true,
      }),
      true,
    );

    expect(failure?.message).toContain('every other uncommitted change in this session');
  });

  it('assumes a stranded change when an older engine omits the partial-state flag', () => {
    const failure = describeApplyFailure(
      applyResult({ applied: 1, failed: [{ id: 'c2', label: 'Sub', error: 'boom' }] }),
      false,
    );

    expect(failure?.canAbort).toBe(true);
  });

  it('does not offer an abort when the first change failed and nothing was staged', () => {
    const failure = describeApplyFailure(
      applyResult({
        applied: 0,
        failed: [{ id: 'c1', label: 'Foo (definition edited)', error: 'boom' }],
        partiallyApplied: false,
      }),
      false,
    );

    expect(failure).toEqual({
      canAbort: false,
      message: expect.stringContaining('Nothing was applied.'),
    });
  });

  it('surfaces a whole-apply error (an expired token) with no abort offered', () => {
    const failure = describeApplyFailure(
      applyResult({ applied: 0, failed: [], error: 'preview session expired' }),
      false,
    );

    expect(failure).toEqual({ canAbort: false, message: 'preview session expired' });
  });

  it('treats a zero-change apply with no error as a failure', () => {
    expect(describeApplyFailure(applyResult({ applied: 0 }), false)).toEqual({
      canAbort: false,
      message: expect.stringContaining('Nothing was applied.'),
    });
  });
});
