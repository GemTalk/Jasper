import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { classListResults, trailResults } from '../omniSearchViewProvider';
import type { MethodSearchResult } from '../../queries/methodSearch';
import { methodNoteKey } from '../../assistant/queries/startingPoints';

function method(className: string, selector: string, isMeta = false): MethodSearchResult {
  return { dictName: 'UserGlobals', className, isMeta, selector, category: 'x', environmentId: 0 };
}

const classes = [
  { dictIndex: 1, dictName: 'UserGlobals', className: 'Library' },
  { dictIndex: 1, dictName: 'UserGlobals', className: 'Book' },
];

describe('a list of classes with their methods', () => {
  it('follows each class with its own methods, indented and named by selector', () => {
    const methods = [
      method('Book', 'isOnLoan'),
      method('Library', 'addBook:'),
      method('Library', 'new', true),
    ];

    const rows = classListResults(classes, methods, 7);

    expect(rows.map((r) => [r.label, r.nested ?? false])).toEqual([
      ['Library', false],
      ['addBook:', true],
      ['class new', true],
      ['Book', false],
      ['isOnLoan', true],
    ]);
  });

  it('opens a method row as its method, on its class side', () => {
    const rows = classListResults(classes.slice(0, 1), [method('Library', 'new', true)], 7);

    expect(rows[1].action).toMatchObject({
      kind: 'openMethod',
      sessionId: 7,
      className: 'Library',
      isMeta: true,
      selector: 'new',
    });
  });

  it('does not list a method under a same-named class from another dictionary', () => {
    const elsewhere = { ...method('Library', 'stray'), dictName: 'Published' };

    const rows = classListResults(classes.slice(0, 1), [elsewhere], 7);

    expect(rows.map((r) => r.label)).toEqual(['Library']);
  });

  it('marks a method where reading its class starts, with the reason on hover', () => {
    const notes = new Map([
      [methodNoteKey('Library', false, 'addBook:'), { text: 'no senders in Library', tip: 'why' }],
    ]);

    const rows = classListResults(
      classes.slice(0, 1),
      [method('Library', 'addBook:'), method('Library', 'books')],
      7,
      notes,
    );

    expect(rows.slice(1).map((r) => [r.label, r.description, r.detail])).toEqual([
      ['addBook:', 'no senders in Library', 'why'],
      ['books', undefined, undefined],
    ]);
  });
});

describe('a trail of methods to read', () => {
  it('numbers each step in order, with its note in the row and in its card', () => {
    const steps = [
      { method: method('Library', 'lend:to:'), note: 'checks the book is in' },
      { method: method('Book', 'isOnLoan'), note: 'asks the borrower' },
    ];

    const rows = trailResults(steps, 7);

    expect(rows.map((r) => [r.label, r.description, r.coach])).toEqual([
      ['1. Library>>lend:to:', 'checks the book is in', 'checks the book is in'],
      ['2. Book>>isOnLoan', 'asks the borrower', 'asks the borrower'],
    ]);
    expect(rows[1].action).toMatchObject({
      kind: 'openMethod',
      className: 'Book',
      selector: 'isOnLoan',
    });
  });

  it('numbers the methods a step dives into under it, as an outline, and indents them', () => {
    const steps = [
      { method: method('Library', 'lend:to:'), note: 'a', depth: 0 },
      { method: method('Book', 'isOnLoan'), note: 'b', depth: 1 },
      { method: method('Book', 'borrower'), note: 'c', depth: 2 },
      { method: method('Member', 'canBorrow'), note: 'd', depth: 1 },
      { method: method('Library', 'return:'), note: 'e', depth: 0 },
    ];

    const rows = trailResults(steps, 7);

    expect(rows.map((r) => [r.label, r.depth])).toEqual([
      ['1. Library>>lend:to:', 0],
      ['1.1. Book>>isOnLoan', 1],
      ['1.1.1. Book>>borrower', 2],
      ['1.2. Member>>canBorrow', 1],
      ['2. Library>>return:', 0],
    ]);
  });

  it('never indents a step more than one deeper than the step above it', () => {
    const steps = [
      { method: method('Library', 'lend:to:'), note: 'a', depth: 0 },
      { method: method('Book', 'borrower'), note: 'c', depth: 3 },
    ];

    const rows = trailResults(steps, 7);

    expect(rows.map((r) => [r.label, r.depth])).toEqual([
      ['1. Library>>lend:to:', 0],
      ['1.1. Book>>borrower', 1],
    ]);
  });

  it("marks in each step's source where the steps under it are sent", () => {
    const steps = [
      { method: method('Library', 'lend:to:'), note: 'a', depth: 0 },
      { method: method('Book', 'isOnLoan'), note: 'b', depth: 1 },
      { method: method('Book', 'borrower'), note: 'c', depth: 2 },
      { method: method('Member', 'canBorrow'), note: 'd', depth: 1 },
      { method: method('Library', 'return:'), note: 'e', depth: 0 },
    ];

    const rows = trailResults(steps, 7);

    expect(rows.map((r) => r.highlight)).toEqual([
      'isOnLoan canBorrow',
      'borrower',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('marks the next step in a trail of main steps only', () => {
    const steps = [
      { method: method('Library', 'lend:to:'), note: 'a' },
      { method: method('Book', 'isOnLoan'), note: 'b' },
    ];

    const rows = trailResults(steps, 7);

    expect(rows.map((r) => r.highlight)).toEqual(['isOnLoan', undefined]);
  });
});
