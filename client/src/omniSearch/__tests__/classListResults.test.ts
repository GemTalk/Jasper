import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { classListResults } from '../omniSearchViewProvider';
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
