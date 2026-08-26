import { describe, it, expect } from 'vitest';

import { referenceRequestFor, methodRowsToResults } from '../references';
import { OmniResult } from '../omniTypes';
import { MethodSearchResult } from '../../queries/methodSearch';

const methodResult: OmniResult = {
  categoryId: 'methods',
  label: 'Object>>printString',
  score: 1,
  ranges: [],
  action: {
    kind: 'openMethod',
    sessionId: 1,
    dictName: 'Globals',
    className: 'Object',
    isMeta: false,
    category: 'printing',
    selector: 'printString',
    environmentId: 0,
    dictIndex: 0,
  },
};

const classResult: OmniResult = {
  categoryId: 'classes',
  label: 'OrderedCollection',
  score: 1,
  ranges: [],
  action: {
    kind: 'openClass',
    sessionId: 1,
    dictName: 'Globals',
    className: 'OrderedCollection',
    dictIndex: 1,
  },
};

const dictResult: OmniResult = {
  categoryId: 'dictionaries',
  label: 'UserGlobals',
  score: 1,
  ranges: [],
  action: { kind: 'revealDictionary', sessionId: 1, dictName: 'UserGlobals' },
};

describe('referenceRequestFor', () => {
  it('asks for senders of a method row, titled by the selector', () => {
    expect(referenceRequestFor(methodResult)).toEqual({
      title: 'Senders of printString',
      kind: 'senders',
      selector: 'printString',
    });
  });

  it('asks for references to a class row, titled by the class', () => {
    expect(referenceRequestFor(classResult)).toEqual({
      title: 'References to OrderedCollection',
      kind: 'references',
      className: 'OrderedCollection',
    });
  });

  it('asks for references to a global row by its name', () => {
    const globalResult: OmniResult = {
      categoryId: 'globals',
      label: 'Transcript',
      score: 1,
      ranges: [],
      action: {
        kind: 'revealGlobal',
        sessionId: 1,
        dictName: 'Globals',
        name: 'Transcript',
        className: 'GsTerminalStream',
      },
    };

    expect(referenceRequestFor(globalResult)).toEqual({
      title: 'References to Transcript',
      kind: 'references',
      className: 'Transcript',
    });
  });

  it('has no reference sense for a dictionary row', () => {
    expect(referenceRequestFor(dictResult)).toBeNull();
  });
});

describe('methodRowsToResults', () => {
  it('shapes rows into method results that open the method, labeling the class side', () => {
    const rows: MethodSearchResult[] = [
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'do:',
        category: 'enumerating',
        environmentId: 0,
      },
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: true,
        selector: 'with:',
        category: 'instance creation',
        environmentId: 0,
      },
    ];

    const results = methodRowsToResults(rows, 7);

    expect(results.map((r) => r.label)).toEqual(['Array>>do:', 'Array class>>with:']);
    expect(results[0].description).toBe('Globals'); // home dictionary only — no method category
    expect(results[0].action).toMatchObject({
      kind: 'openMethod',
      sessionId: 7,
      selector: 'do:',
      isMeta: false,
    });
    expect(results[1].action).toMatchObject({
      kind: 'openMethod',
      isMeta: true,
      selector: 'with:',
    });
  });

  it('carries the given method environment into each open action (defaults to 0)', () => {
    const rows: MethodSearchResult[] = [
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'do:',
        category: 'enumerating',
        environmentId: 0,
      },
    ];

    // Default: env 0 (the Source/Literals scopes rely on this).
    expect(methodRowsToResults(rows, 7)[0].action).toMatchObject({ environmentId: 0 });
    // Explicit non-zero env (a references-pivot hit found in environment 2) must open there, not env 0.
    expect(methodRowsToResults(rows, 7, 'methods', 2)[0].action).toMatchObject({
      environmentId: 2,
    });
  });
});
