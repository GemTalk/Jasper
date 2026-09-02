import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';

import { disableBreakAtStepPoint } from '../disableBreakAtStepPoint';
import { getAllBreakpoints } from '../getAllBreakpoints';
import {
  enableAllBreakpoints,
  disableAllBreakpoints,
  removeAllBreakpoints,
  hasBreakpoints,
  breakpointByOop,
} from '../breakpointGlobals';

describe('disableBreakAtStepPoint', () => {
  it('sends GsNMethod>>disableBreakAtStepPoint: to the compiled method', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    disableBreakAtStepPoint(execute, 'Account', false, 'balance', 7);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("compiledMethodAt: #'balance'");
    expect(code).toContain('disableBreakAtStepPoint: 7');
  });

  it('targets the metaclass for a class-side method', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    disableBreakAtStepPoint(execute, 'Account', true, 'new', 1);
    expect(execute.mock.calls[0][0]).toContain('Account class compiledMethodAt:');
  });

  it('passes the environment id through', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    disableBreakAtStepPoint(execute, 'Account', false, 'balance', 2, 3);
    expect(execute.mock.calls[0][0]).toContain('environmentId: 3');
  });
});

describe('session-wide breakpoint operations', () => {
  it('enable-all uses the gem primitive, not a loop over our own list', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    enableAllBreakpoints(execute);
    expect(execute.mock.calls[0][0]).toContain('GsNMethod _enableAllBreaks');
  });

  it('disable-all keeps the breakpoints, rather than deleting them', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    disableAllBreakpoints(execute);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('GsNMethod _disableAllBreaks');
    expect(code).not.toContain('_deleteAllBreaks');
  });

  it('remove-all deletes them', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    removeAllBreakpoints(execute);
    expect(execute.mock.calls[0][0]).toContain('GsNMethod _deleteAllBreaks');
  });

  it('hasBreakpoints reads the primitive as a boolean', () => {
    expect(hasBreakpoints(vi.fn<QueryExecutor>(() => 'true'))).toBe(true);
    expect(hasBreakpoints(vi.fn<QueryExecutor>(() => 'false'))).toBe(false);
  });

  it('hasBreakpoints tolerates trailing whitespace from the fetch', () => {
    expect(hasBreakpoints(vi.fn<QueryExecutor>(() => 'true\n'))).toBe(true);
  });
});

describe('breakpointByOop', () => {
  it('reaches a method by OOP, for a doit that has no class or selector', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    breakpointByOop(execute, '405428225', 'clearBreakAtStepPoint:', 4);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('Object _objectForOop: 405428225');
    expect(code).toContain('clearBreakAtStepPoint: 4');
  });
});

describe('getAllBreakpoints', () => {
  /** One row exactly as the query's Smalltalk emits it (verified on 3.7.5). */
  const row = (over: Partial<Record<string, string>> = {}) => {
    const f = {
      breakNumber: '1',
      className: 'Account',
      isMeta: 'false',
      selector: 'balance',
      stepPoint: '3',
      disabled: 'false',
      environmentId: '0',
      methodOop: '405428225',
      dictName: 'Globals',
      category: 'accessing',
      ...over,
    };
    return [
      f.breakNumber,
      f.className,
      f.isMeta,
      f.selector,
      f.stepPoint,
      f.disabled,
      f.environmentId,
      f.methodOop,
      f.dictName,
      f.category,
    ].join('\t');
  };

  it('lets the kernel decode its own primitive, whose stride is version-dependent', () => {
    // _allMethodBreakpoints has 3-field tuples on 3.6.2 and 4-field on 3.7.5,
    // so hand-decoding it runs off the end of the array on the older release.
    const execute = vi.fn<QueryExecutor>(() => '');
    getAllBreakpoints(execute);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('GsNMethod _breakReport: true');
    expect(code).not.toContain('_allMethodBreakpoints');
  });

  it('skips breakpoints left on a superseded version of a method', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getAllBreakpoints(execute);
    // Identity against the currently installed method is what tells a live
    // breakpoint from a ghost a recompile left behind.
    expect(execute.mock.calls[0][0]).toContain('compiledMethodAt: sel environmentId:');
  });

  it('resolves the dictionary by class identity, not by name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getAllBreakpoints(execute);
    // `== base` is what makes a name shadowed in two dictionaries resolve to the
    // dictionary actually holding this class.
    expect(execute.mock.calls[0][0]).toContain('== base');
  });

  it('parses a breakpoint row', () => {
    const result = getAllBreakpoints(vi.fn<QueryExecutor>(() => row() + '\n'));
    expect(result).toEqual([
      {
        breakNumber: 1,
        className: 'Account',
        isMeta: false,
        selector: 'balance',
        stepPoint: 3,
        disabled: false,
        environmentId: 0,
        methodOop: '405428225',
        dictName: 'Globals',
        category: 'accessing',
      },
    ]);
  });

  it('reads the disabled flag', () => {
    const result = getAllBreakpoints(vi.fn<QueryExecutor>(() => row({ disabled: 'true' }) + '\n'));
    expect(result[0].disabled).toBe(true);
  });

  it('reads a class-side breakpoint as isMeta with the base class name', () => {
    const result = getAllBreakpoints(
      vi.fn<QueryExecutor>(() => row({ isMeta: 'true', selector: 'new' }) + '\n'),
    );
    expect(result[0].isMeta).toBe(true);
    expect(result[0].className).toBe('Account');
  });

  it('parses a doit row, whose class and selector are empty', () => {
    const result = getAllBreakpoints(
      vi.fn<QueryExecutor>(
        () => row({ className: '', selector: '', dictName: '', category: '' }) + '\n',
      ),
    );
    expect(result[0].className).toBe('');
    expect(result[0].selector).toBe('');
    expect(result[0].stepPoint).toBe(3);
  });

  it('parses several rows', () => {
    const raw = [row(), row({ breakNumber: '2', selector: 'deposit:' })].join('\n') + '\n';
    const result = getAllBreakpoints(vi.fn<QueryExecutor>(() => raw));
    expect(result.map((b) => b.selector)).toEqual(['balance', 'deposit:']);
  });

  it('returns nothing when no breakpoints are set', () => {
    expect(getAllBreakpoints(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });

  it('skips a truncated row rather than yielding a half-parsed breakpoint', () => {
    const raw = row() + '\n' + '9\tAccount\tfalse\n';
    const result = getAllBreakpoints(vi.fn<QueryExecutor>(() => raw));
    expect(result).toHaveLength(1);
  });
});
