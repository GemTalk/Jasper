// The reference-graph queries against a live stone.
//
// objectGraph.test.ts asserts the Smalltalk each one builds and how each reply is parsed;
// this file asserts what the stone actually ANSWERS, which is the only thing that can tell
// us the picture is true. Everything the panel draws comes through here: the class boxes
// and their counts, the objects listed inside one, and the slot each edge stands for. A
// selector that no longer exists on a release, a reply shape the parser mis-reads, or a
// scan that quietly returns nothing would all leave the drawing looking perfectly well
// formed and simply wrong.
//
// Ungated: every query here needs only a running stone. Nothing commits — the fixtures are
// transient and the harness aborts after each test — which is also why the slot-edge suite
// and the repository-scan suite are separate: defining a fixture class dirties the session,
// and a repository-wide scan is refused while a session holds uncommitted work. That
// refusal is itself asserted below rather than worked around.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import * as og from '../objectGraph';
import type { ActiveSession } from '../../sessionManager';

describe('reference-graph queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  /** The OOP of a committed kernel object, for the scans that refuse a dirty session. */
  const oopOf = (expression: string): bigint =>
    BigInt(exec(`${expression} asOop printString`).trim());

  describe('slotEdgesAmong', () => {
    // The three ways GemStone can hold a reference, in one fixture, all pointing at the
    // same object: a named instance variable, an indexed slot, and membership of an
    // unordered collection. These are exactly the three things a selected edge's tooltip
    // claims, so this is the test that says the tooltip tells the truth.
    //
    // Transient throughout. The class definition dirties the session and the objects are
    // never committed, which is the point: reading slots is a handful of reads rather than
    // a repository scan, so it neither needs a clean session nor aborts one.
    const FIXTURE = 'JasperSlotEdgeDemo';

    /** Builds the fixture and answers `[holder, target, array, bag]` as OOP strings. */
    const buildFixture = (): string[] => {
      q.compileClassDefinition(
        session(),
        `Object subclass: '${FIXTURE}' instVarNames: #('label' 'partner' 'items') ` +
          'classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      // Anchored in SessionTemps so nothing is scavenged between building it and asking
      // about it. SessionTemps is session-local, so this does not add to needsCommit.
      return exec(`| holder target arr bag all ws |
holder := ${FIXTURE} new.
target := ${FIXTURE} new.
holder instVarAt: 2 put: target.
arr := Array new: 3.
arr at: 3 put: target.
bag := IdentityBag new.
bag add: target.
all := Array with: holder with: target with: arr with: bag.
SessionTemps current at: #JasperSlotEdgeFixture put: all.
ws := WriteStream on: String new.
all do: [:o | ws nextPutAll: o asOop printString; tab].
ws contents`)
        .trim()
        .split('\t')
        .filter(Boolean);
    };

    it('names the instance variable a reference sits in', () => {
      const [holder, target, ,] = buildFixture();
      const result = og.slotEdgesAmong(exec, [holder, target]);

      expect(result).toEqual({
        kind: 'ok',
        edges: [{ fromOop: holder, toOop: target, via: 'partner' }],
      });
    });

    it('names the index an array holds a reference at', () => {
      const [, target, array] = buildFixture();
      const result = og.slotEdgesAmong(exec, [array, target]);

      // One-based, and the slot the object is actually in -- not the first free one.
      expect(result).toEqual({
        kind: 'ok',
        edges: [{ fromOop: array, toOop: target, via: '[3]' }],
      });
    });

    it('says an unordered collection has no addressable slot', () => {
      const [, target, , bag] = buildFixture();
      const result = og.slotEdgesAmong(exec, [bag, target]);

      expect(result).toEqual({
        kind: 'ok',
        edges: [{ fromOop: bag, toOop: target, via: '(element)' }],
      });
    });

    it('finds every reference among the objects asked about, in one pass', () => {
      const [holder, target, array, bag] = buildFixture();
      const result = og.slotEdgesAmong(exec, [holder, target, array, bag]);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      // Order is the scan's, not ours, so compare as a set.
      expect([...result.edges].sort((a, b) => a.fromOop.localeCompare(b.fromOop))).toEqual(
        [
          { fromOop: holder, toOop: target, via: 'partner' },
          { fromOop: array, toOop: target, via: '[3]' },
          { fromOop: bag, toOop: target, via: '(element)' },
        ].sort((a, b) => a.fromOop.localeCompare(b.fromOop)),
      );
    });

    it('reports only references that run BETWEEN the objects asked about', () => {
      // The graph draws a fixed set of boxes, so an edge to something not on the picture
      // would be an arrow into thin air. Ask about the holder and the array alone: both
      // point at the target, neither points at the other, so there is nothing to report.
      const [holder, , array] = buildFixture();

      expect(og.slotEdgesAmong(exec, [holder, array])).toEqual({ kind: 'ok', edges: [] });
    });

    it('needs no clean session, unlike the repository scans', () => {
      const [holder, target] = buildFixture();
      expect(exec('System needsCommit printString').trim()).toBe('true');

      // Same answer with the session dirty as with it clean.
      expect(og.slotEdgesAmong(exec, [holder, target])).toEqual({
        kind: 'ok',
        edges: [{ fromOop: holder, toOop: target, via: 'partner' }],
      });
    });

    it('asks the stone nothing when there is nothing to ask about', () => {
      // Fewer than two objects cannot have an edge between them, so the builder answers
      // undefined and the panel never makes the round trip.
      expect(og.buildSlotEdgesAmong([])).toBeUndefined();
      expect(og.buildSlotEdgesAmong(['12345'])).toBeUndefined();
    });
  });

  describe('referrersOf', () => {
    // Against a committed kernel object, so the scan is allowed to run. The class Array is
    // the same shape of subject as anything a user asks about: pointed at from several
    // directions, one of them a group of exactly one.
    const arrayClass = (): bigint => oopOf('(Globals at: #Array)');

    it('answers the classes that hold a reference, with a count each', () => {
      const result = og.referrersOf(exec, arrayClass());

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.groups.length).toBeGreaterThan(0);
      for (const group of result.groups) {
        expect(group.referrerClass).not.toBe('');
        // Kept as a digit STRING: an OOP outgrows a JS float, and class versions share a
        // name, so this is what a caller must key a map on.
        expect(group.referrerClassOop).toMatch(/^\d+$/);
        expect(group.count).toBeGreaterThanOrEqual(1);
      }
      expect(result.scanMillis).toBeGreaterThanOrEqual(0);
    });

    it('puts the biggest group first, which is the order the picture is built in', () => {
      const result = og.referrersOf(exec, arrayClass());

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      const counts = result.groups.map((g) => g.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('resolves a group of one to the object itself, in the same scan', () => {
      // A group of one is just an object with a box around it, so the panel draws the
      // object -- which it can only do because the scan already answered which object it
      // is. Every kernel class is bound by exactly one Association in its dictionary.
      const result = og.referrersOf(exec, arrayClass());

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      const singles = result.groups.filter((g) => g.count === 1);
      expect(singles.length).toBeGreaterThan(0);
      for (const group of singles) {
        expect(group.soleOop).toMatch(/^\d+$/);
        expect(group.solePrintString).not.toBe('');
        expect(group.solePrintString).toBeDefined();
      }
      // A group of more than one carries no sole object; there is no single answer.
      for (const group of result.groups.filter((g) => g.count > 1)) {
        expect(group.soleOop).toBeUndefined();
      }
    });

    it('declines rather than discarding work when the session is dirty', () => {
      // A repository-wide scan aborts the session, so GemStone refuses to run one while
      // there is uncommitted work. Checked BEFORE the scan, so nothing is lost -- this is
      // the case a workspace selection lands in constantly, since evaluating anything that
      // creates an object dirties the session.
      const target = arrayClass();
      exec("UserGlobals at: #JasperDirtyProbe put: 'dirty'");
      expect(exec('System needsCommit printString').trim()).toBe('true');

      expect(og.referrersOf(exec, target)).toEqual({ kind: 'needsCommit' });
    });

    it('answers unavailable for an OOP that names no object', () => {
      const result = og.referrersOf(exec, 999999999998n);

      expect(result.kind).toBe('unavailable');
      if (result.kind !== 'unavailable') return;
      // The kernel's own words reach the user, so they are the contract.
      expect(result.reason).toContain('not a Pom oop');
    });

    it('answers unavailable for an immediate, which has no identity to scan for', () => {
      // A SmallInteger is not a stored object, so there is nothing that can point at it.
      const result = og.referrersOf(exec, oopOf('7'));

      expect(result.kind).toBe('unavailable');
      if (result.kind !== 'unavailable') return;
      expect(result.reason).toContain('not a Pom oop');
    });
  });

  describe('referrerObjectsOf', () => {
    it('lists the individual objects of one class that point at the target', () => {
      // What clicking a class box opens, and the hop that makes the graph walkable.
      const target = oopOf('(Globals at: #Array)');
      const groups = og.referrersOf(exec, target);
      expect(groups.kind).toBe('ok');
      if (groups.kind !== 'ok') return;
      const group = groups.groups[0];

      const result = og.referrerObjectsOf(exec, target, BigInt(group.referrerClassOop));

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      // The true count, whatever the page holds -- so the panel can say what it is not
      // showing rather than implying the page is the whole set.
      expect(result.total).toBe(group.count);
      expect(result.objects.length).toBe(Math.min(group.count, og.REFERRER_PAGE_SIZE));
      for (const object of result.objects) {
        expect(object.oop).toMatch(/^\d+$/);
        // Flattened server-side to one line, so it can never shift a column in the reply.
        expect(object.printString).not.toContain('\n');
        expect(object.printString).not.toContain('\t');
        expect(typeof object.isClass).toBe('boolean');
      }
    });

    it('answers an empty page for a class that points at nothing here', () => {
      // Asking for the wrong class is not an error, it is an empty answer -- which is what
      // lets the panel offer a class row without first proving it has objects behind it.
      const target = oopOf('(Globals at: #Array)');
      const unrelated = oopOf('(Globals at: #Float)');

      const result = og.referrerObjectsOf(exec, target, unrelated);

      expect(result).toMatchObject({ kind: 'ok', total: 0, objects: [] });
    });
  });

  describe('referrerCollectionOf', () => {
    it('gathers the referrers into one collection the inspector can open', () => {
      const target = oopOf('(Globals at: #Array)');
      const groups = og.referrersOf(exec, target);
      expect(groups.kind).toBe('ok');
      if (groups.kind !== 'ok') return;
      const group = groups.groups[0];

      const result = og.referrerCollectionOf(exec, target, BigInt(group.referrerClassOop));

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.total).toBe(group.count);
      expect(result.returned).toBe(Math.min(group.count, og.REFERRER_COLLECTION_LIMIT));
      // The collection has to still be there when the inspector reaches for it: it is held
      // in SessionTemps precisely because a repository scan aborts, and an unanchored
      // transient Array could be scavenged before the first read.
      expect(exec(`(Object objectForOop: ${result.oop}) size printString`).trim()).toBe(
        String(result.returned),
      );
    });
  });

  describe('classCensus', () => {
    it('counts the instances of every class a dictionary binds', () => {
      const result = og.classCensus(exec, 'Globals');

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.classes.length).toBeGreaterThan(0);
      const array = result.classes.find((c) => c.className === 'Array');
      expect(array).toBeDefined();
      expect(array?.dictionary).toBe('Globals');
      expect(array?.instanceCount).toBeGreaterThan(0);
      const counts = result.classes.map((c) => c.instanceCount);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('declines while the session is dirty, like the other repository scans', () => {
      exec("UserGlobals at: #JasperDirtyProbe put: 'dirty'");

      expect(og.classCensus(exec, 'Globals')).toEqual({ kind: 'needsCommit' });
    });
  });

  describe('referenceEdges', () => {
    it('answers the class-to-class edges among the classes asked about', () => {
      const result = og.referenceEdges(exec, ['Array', 'Association']);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      for (const edge of result.edges) {
        expect(['Array', 'Association']).toContain(edge.from);
        expect(['Array', 'Association']).toContain(edge.to);
        expect(edge.count).toBeGreaterThan(0);
      }
      // References from OUTSIDE the named set are reported separately rather than dropped,
      // so a diagram of five classes cannot imply those five are all that point at them.
      for (const outside of result.unattributed) {
        expect(['Array', 'Association']).toContain(outside.to);
        expect(outside.count).toBeGreaterThan(0);
      }
    });
  });
});
