// The reference-graph queries, without a stone: the Smalltalk each one builds, and how
// each reply is read back.
//
// objectGraph.integration.test.ts asserts what a live stone answers. This file asserts the
// two halves either side of that -- the preconditions written into the generated code, and
// the parsing of a reply -- because those are where a malformed answer turns into a picture
// that looks fine and says something untrue. The reply format is deliberately awkward in
// one respect (a free-text printString last on the line, flattened server-side) and most of
// what follows pins exactly that.
import { describe, it, expect } from 'vitest';

import * as og from '../objectGraph';

/** An `ok` reply: status and elapsed milliseconds, then the body. */
const ok = (millis: number, body: string): string => `ok\t${millis}\n${body}`;

describe('buildReferrersOf', () => {
  it('refuses before scanning rather than after, so no work can be lost', () => {
    // A repository-wide scan aborts the session. Asking `needsCommit` first is the same
    // precondition GemStone would enforce, tested where nothing has happened yet -- and it
    // does not depend on matching a GemStone error number.
    const code = og.buildReferrersOf(12345n);

    expect(code.indexOf('System needsCommit')).toBeLessThan(
      code.indexOf('allReferencesByParentClass'),
    );
  });

  it('asks about the object the OOP names', () => {
    expect(og.buildReferrersOf(31553793n)).toContain('Object objectForOop: 31553793');
  });
});

describe('parseReferrersOf', () => {
  it('reads a class, its OOP and its count from each line', () => {
    const result = og.parseReferrersOf(
      ok(24, 'GsNMethod\t144897\t496\t0\nClassHistory\t82689\t3\t0\n'),
    );

    expect(result).toEqual({
      kind: 'ok',
      scanMillis: 24,
      groups: [
        { referrerClass: 'GsNMethod', referrerClassOop: '144897', count: 496 },
        { referrerClass: 'ClassHistory', referrerClassOop: '82689', count: 3 },
      ],
    });
  });

  it('puts the biggest group first however the stone ordered them', () => {
    const result = og.parseReferrersOf(ok(1, 'A\t1\t2\t0\nB\t2\t97\t0\nC\t3\t5\t0\n'));

    expect(result.kind === 'ok' && result.groups.map((g) => g.referrerClass)).toEqual([
      'B',
      'C',
      'A',
    ]);
  });

  it('keeps the sole object when a group holds exactly one', () => {
    // What lets the panel draw the object instead of a box around one object, without
    // paying for a second scan.
    const result = og.parseReferrersOf(ok(3, 'Association\t67073\t1\t31553793\tArray->8\n'));

    expect(result).toMatchObject({
      kind: 'ok',
      groups: [{ count: 1, soleOop: '31553793', solePrintString: 'Array->8' }],
    });
  });

  it('rejoins a printString that was flattened to spaces', () => {
    // The printString is last on the line precisely so it cannot shift a column, and any
    // whitespace inside it has already been turned into spaces server-side. Splitting on
    // tab therefore over-splits it, and the tail has to come back together.
    const result = og.parseReferrersOf(ok(3, 'Array\t66817\t1\t999\tanArray( 1, 2, 3 )\n'));

    expect(result).toMatchObject({
      kind: 'ok',
      groups: [{ solePrintString: 'anArray( 1, 2, 3 )' }],
    });
  });

  it('carries no sole object when the group holds more than one', () => {
    const result = og.parseReferrersOf(ok(3, 'GsNMethod\t144897\t496\t0\n'));

    expect(result.kind === 'ok' && result.groups[0].soleOop).toBeUndefined();
  });

  it('skips a line too short to be a group rather than inventing one', () => {
    const result = og.parseReferrersOf(ok(3, 'truncated\t1\nGsNMethod\t144897\t2\t0\n'));

    expect(result.kind === 'ok' && result.groups).toHaveLength(1);
  });

  it('reports a dirty session as its own answer, not as a failure', () => {
    // The panel says something specific and offers to commit; an `unavailable` here would
    // read as the scan being broken.
    expect(og.parseReferrersOf('needsCommit')).toEqual({ kind: 'needsCommit' });
  });

  it('carries the stone’s own reason when it declines', () => {
    const result = og.parseReferrersOf('unavailable\nargument is not a Pom oop');

    expect(result).toEqual({ kind: 'unavailable', reason: 'argument is not a Pom oop' });
  });

  it('still says something when the stone declines without saying why', () => {
    expect(og.parseReferrersOf('unavailable\n')).toEqual({
      kind: 'unavailable',
      reason: 'GemStone declined the reference scan',
    });
  });

  it('treats a reply it does not recognise as unavailable, never as an empty graph', () => {
    // An empty graph is a real, meaningful answer -- "nothing points at this" -- so a
    // garbled reply must never be able to impersonate one.
    const result = og.parseReferrersOf('a Error occurred');

    expect(result.kind).toBe('unavailable');
  });
});

describe('buildSlotEdgesAmong', () => {
  it('asks nothing when fewer than two objects could have an edge between them', () => {
    expect(og.buildSlotEdgesAmong([])).toBeUndefined();
    expect(og.buildSlotEdgesAmong(['31553793'])).toBeUndefined();
  });

  it('drops anything that is not an OOP before it reaches the stone', () => {
    // The list is interpolated into a Smalltalk literal array, so nothing but digits may
    // reach it: an injected fragment would be a syntax error at best, and the sender is
    // the webview. The junk is dropped and the real OOPs still go.
    const code = og.buildSlotEdgesAmong([
      '31553793',
      'Array new. UserGlobals removeKey: #x',
      '999',
    ]);

    expect(code).toContain('#( 31553793 999 )');
    expect(code).not.toContain('removeKey');
  });

  it('asks nothing when the junk leaves fewer than two OOPs standing', () => {
    expect(og.buildSlotEdgesAmong(['31553793', 'Array new'])).toBeUndefined();
  });

  it('reads slots rather than scanning, so it needs no clean session', () => {
    const code = og.buildSlotEdgesAmong(['1', '2']) ?? '';

    expect(code).not.toContain('System needsCommit');
    expect(code).not.toContain('allReferencesByParentClass');
    expect(code).toContain('instVarAt:');
  });
});

describe('parseSlotEdgesAmong', () => {
  it('reads the two ends and the slot from each line', () => {
    const result = og.parseSlotEdgesAmong(
      ok(0, '10\t20\tpartner\n30\t20\t[3]\n40\t20\t(element)\n'),
    );

    expect(result).toEqual({
      kind: 'ok',
      edges: [
        { fromOop: '10', toOop: '20', via: 'partner' },
        { fromOop: '30', toOop: '20', via: '[3]' },
        { fromOop: '40', toOop: '20', via: '(element)' },
      ],
    });
  });

  it('answers no edges for objects that do not reference each other', () => {
    expect(og.parseSlotEdgesAmong(ok(0, ''))).toEqual({ kind: 'ok', edges: [] });
  });

  it('never answers an empty graph for a needsCommit it cannot actually get', () => {
    // Nothing in this query aborts, so this reply is unreachable today. It is mapped
    // anyway, so that a future change which does introduce a scan fails loudly instead of
    // drawing a picture with every edge silently missing.
    expect(og.parseSlotEdgesAmong('needsCommit')).toMatchObject({ kind: 'unavailable' });
  });
});

describe('slotEdgesAmong', () => {
  it('makes no round trip when there is nothing to ask', () => {
    let asked = 0;
    const result = og.slotEdgesAmong(() => {
      asked += 1;
      return '';
    }, ['31553793']);

    expect(asked).toBe(0);
    expect(result).toEqual({ kind: 'ok', edges: [] });
  });
});

describe('parseReferrerObjectsOf', () => {
  it('reads the true total ahead of the page it is showing', () => {
    // The page is capped; the total is not. The panel can only be honest about what it is
    // leaving out because these are separate numbers.
    const result = og.parseReferrerObjectsOf(
      ok(12, '496\n100\t0\tanArray( 1, 2 )\n101\t1\tArray\n'),
    );

    expect(result).toMatchObject({ kind: 'ok', total: 496, scanMillis: 12 });
  });

  it('keeps a printString whole, tabs having ended before it', () => {
    const result = og.parseReferrerObjectsOf(ok(1, '1\n100\t0\tLineItem(SO-1197: 39 x Widget)\n'));

    expect(result.kind === 'ok' && result.objects[0]).toEqual({
      oop: '100',
      isClass: false,
      printString: 'LineItem(SO-1197: 39 x Widget)',
    });
  });

  it('marks a referrer that is itself a class, which has somewhere else to go', () => {
    const result = og.parseReferrerObjectsOf(ok(1, '2\n100\t1\tArray\n101\t0\tanArray( )\n'));

    expect(result.kind === 'ok' && result.objects.map((o) => o.isClass)).toEqual([true, false]);
  });

  it('skips a line missing either tab rather than inventing an object', () => {
    const result = og.parseReferrerObjectsOf(ok(1, '2\n100\n101\t0\tanArray( )\n'));

    expect(result.kind === 'ok' && result.objects).toHaveLength(1);
  });
});

describe('parseReferrerCollectionOf', () => {
  it('reads the collection’s OOP alongside what it holds', () => {
    expect(og.parseReferrerCollectionOf(ok(30, '4096\t4096\t31553793'))).toEqual({
      kind: 'ok',
      total: 4096,
      returned: 4096,
      oop: '31553793',
      scanMillis: 30,
    });
  });

  it('says so when the stone answered without a collection to open', () => {
    const result = og.parseReferrerCollectionOf(ok(30, '0\t0'));

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'The stone did not answer a collection',
    });
  });
});
