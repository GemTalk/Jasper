import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { applyMethodSlotOps, captureMethodSlots } from '../queries/methodSlotQueries';
import { applyClassSlotOps, captureClassSlots, newStashKey } from '../queries/classSlotQueries';
import {
  applyClassVarOp,
  captureClassVar,
  methodsReferencingClassVar,
} from '../queries/classVarQueries';
import { planReversal, driftedSlots } from '../methodSlotPlan';
import { planClassReversal, driftedClassSlots, discardedByReversal } from '../classSlotPlan';
import { planClassVarReversal } from '../classVarPlan';
import {
  decodeEscaped,
  SMALLTALK_ESCAPER,
  SMALLTALK_ESCAPER_TEMPS,
} from '../queries/methodSlotCodec';
import { MethodSlot, ClassSlot, ClassVarSlot } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Automatic GCI integration test for Jasper's undo stack (#434), over the real GCI
 * transport and through the same doit builders and parsers the extension uses.
 *
 * Deliberately UNGATED, unlike the refactoring undo's suite beside it. Nothing here needs
 * the refactoring engine — every doit is plain Smalltalk against the kernel — so these run
 * against any stone Jasper can log in to. That is the claim the whole design rests on, and
 * a suite that runs on a bare stone is the only thing that actually proves it.
 *
 * Three layers:
 *  1. the doits themselves: what a capture reads, and what an apply does;
 *  2. record-then-reverse round trips, asserting the WHOLE slot is back — source AND
 *     category for a method, methods on BOTH sides plus the bound version for a class;
 *  3. the GemStone facts the design depends on, pinned so they cannot change underneath it
 *     without a red test: a shape-changing class redefinition answers a new EMPTY version,
 *     an identical one is a no-op, and an unbound class survives to be bound again.
 *
 * Fully transient: the harness aborts each test, so every fixture rolls back and nothing is
 * committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('undo (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  // Distinctive names so nothing here can reach a same-named class elsewhere in the image.
  const CLS = 'JfpUndoItAccount';
  const SUB = 'JfpUndoItSavings';
  const DICT = 'UserGlobals';

  const defineClass = (name: string, sup = 'Object', ivars = "'balance'"): void => {
    q.compileClassDefinition(
      session(),
      `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
        `classInstVars: #() poolDictionaries: #() inDictionary: ${DICT}`,
    );
  };

  const compile = (name: string, source: string, category = 'accessing', meta = false): void => {
    q.compileMethod(session(), name, meta, category, source, 0, DICT);
  };

  const slot = (selector: string, meta = false, className = CLS): MethodSlot => ({
    dict: DICT,
    className,
    isMeta: meta,
    selector,
    environmentId: 0,
  });

  const classSlot = (className = CLS): ClassSlot => ({ dict: DICT, className });

  const varSlot = (varName: string, className = CLS): ClassVarSlot => ({
    dict: DICT,
    className,
    varName,
  });

  const boundVersion = (className = CLS): string | null =>
    captureClassSlots(exec, [classSlot(className)])[0].oop;

  // ── Layer 1: what the doits read and do ────────────────────────────────

  describe('capturing a method slot', () => {
    it('reads a method that is there, with its source and its category', () => {
      defineClass(CLS);
      compile(CLS, 'balance\n  ^ 42', 'computing');

      const [state] = captureMethodSlots(exec, [slot('balance')]);

      expect(state.exists).toBe(true);
      expect(state.source).toBe('balance\n  ^ 42');
      expect(state.category).toBe('computing');
    });

    it('reads a selector the class does not implement as absent', () => {
      defineClass(CLS);
      expect(captureMethodSlots(exec, [slot('nope')])[0]).toEqual({
        exists: false,
        source: null,
        category: null,
      });
    });

    it('reads a class that does not exist as absent, rather than failing', () => {
      expect(captureMethodSlots(exec, [slot('any', false, 'JfpNoSuchClassAtAll')])[0].exists).toBe(
        false,
      );
    });

    it('reads the metaclass side separately from the instance side', () => {
      defineClass(CLS);
      compile(CLS, 'make\n  ^ self new', 'instance creation', true);

      const [instance, meta] = captureMethodSlots(exec, [slot('make'), slot('make', true)]);

      expect(instance.exists).toBe(false);
      expect(meta.exists).toBe(true);
      expect(meta.source).toBe('make\n  ^ self new');
    });

    it('round-trips a source with quotes, backslashes, tabs and newlines', () => {
      // The escaping contract end to end over GCI rather than against a fixture string:
      // these are the characters a tab-delimited, line-oriented result cannot carry, and a
      // lossy escape would recompile the wrong source on the way back.
      defineClass(CLS);
      const source = 'tricky\n  "a \' quote, a \\ slash"\n\t^ 1';
      compile(CLS, source, 'probing');

      expect(captureMethodSlots(exec, [slot('tricky')])[0].source).toBe(source);
    });

    it('escapes text above ASCII losslessly, which is why the payload stays a byte String', () => {
      // Tested through the escaper directly, NOT through a compiled method: on 3.6.x the
      // compiler rejects a doit whose own source carries non-ASCII, so a fixture method
      // cannot be written that way from here. The contract is the same either way — whatever
      // `sourceString` answers must survive escape-then-decode exactly — and this exercises
      // the >126 path the client's character-based GCI fetch depends on.
      const built = `| ws ${SMALLTALK_ESCAPER_TEMPS} sws src |
ws := WriteStream on: String new.
${SMALLTALK_ESCAPER}
sws := WriteStream on: Unicode16 new.
sws nextPutAll: 'caf'; nextPut: (Character codePoint: 233); nextPut: $ ; nextPut: (Character codePoint: 10003).
src := sws contents.
esc value: src value: ws.
ws contents`;

      const escaped = exec(built);

      // Pure ASCII on the wire...
      expect(escaped).toMatch(/^[\x20-\x7e]*$/);
      // ...and exactly the original text once decoded.
      expect(decodeEscaped(escaped)).toBe('café ✓');
    });

    it('reads several slots in one round trip, in order', () => {
      defineClass(CLS);
      compile(CLS, 'one\n  ^ 1');
      compile(CLS, 'two\n  ^ 2');

      const states = captureMethodSlots(exec, [slot('one'), slot('missing'), slot('two')]);

      expect(states.map((s) => s.exists)).toEqual([true, false, true]);
      expect(states[2].source).toBe('two\n  ^ 2');
    });
  });

  describe('applying method reversals', () => {
    it('restores a method that is gone, with its category', () => {
      defineClass(CLS);

      const [result] = applyMethodSlotOps(exec, [
        { kind: 'restore', slot: slot('brought'), source: 'brought\n  ^ 1', category: 'restored' },
      ]);

      expect(result.error).toBeNull();
      const [state] = captureMethodSlots(exec, [slot('brought')]);
      expect(state.source).toBe('brought\n  ^ 1');
      expect(state.category).toBe('restored');
    });

    it('removes a method', () => {
      defineClass(CLS);
      compile(CLS, 'goes\n  ^ 1');

      applyMethodSlotOps(exec, [
        { kind: 'remove', slot: slot('goes'), source: null, category: null },
      ]);

      expect(captureMethodSlots(exec, [slot('goes')])[0].exists).toBe(false);
    });

    it('treats removing an absent method as done, not as an error', () => {
      defineClass(CLS);
      const [result] = applyMethodSlotOps(exec, [
        { kind: 'remove', slot: slot('neverThere'), source: null, category: null },
      ]);
      expect(result.error).toBeNull();
    });

    it('reports a class it cannot find rather than throwing', () => {
      const [result] = applyMethodSlotOps(exec, [
        {
          kind: 'restore',
          slot: slot('x', false, 'JfpNoSuchClassAtAll'),
          source: 'x ^ 1',
          category: 'c',
        },
      ]);
      expect(result.error).toContain('no such class');
    });

    it('reports a source that will not compile, and leaves the others alone', () => {
      // One bad operation must not abandon the reversals that would have worked.
      defineClass(CLS);
      const results = applyMethodSlotOps(exec, [
        { kind: 'restore', slot: slot('good'), source: 'good\n  ^ 1', category: 'c' },
        { kind: 'restore', slot: slot('bad'), source: 'bad\n  ^ (((', category: 'c' },
      ]);

      expect(results[0].error).toBeNull();
      expect(results[1].error).not.toBeNull();
      expect(captureMethodSlots(exec, [slot('good')])[0].exists).toBe(true);
    });
  });

  // ── Layer 2: round trips ───────────────────────────────────────────────

  describe('a method edit, recorded and reversed', () => {
    const reverse = (slots: MethodSlot[], before: ReturnType<typeof captureMethodSlots>) => {
      const now = captureMethodSlots(exec, slots);
      const ops = planReversal(slots, before, now);
      return applyMethodSlotOps(exec, ops);
    };

    it('puts an edited method back, source and category', () => {
      defineClass(CLS);
      compile(CLS, 'balance\n  ^ 1', 'computing');
      const slots = [slot('balance')];
      const before = captureMethodSlots(exec, slots);

      compile(CLS, 'balance\n  ^ 2', 'accessing');
      const results = reverse(slots, before);

      expect(results.every((r) => r.error === null)).toBe(true);
      expect(captureMethodSlots(exec, slots)[0]).toEqual(before[0]);
    });

    it('takes away a method that was created', () => {
      defineClass(CLS);
      const slots = [slot('fresh')];
      const before = captureMethodSlots(exec, slots);
      expect(before[0].exists).toBe(false);

      compile(CLS, 'fresh\n  ^ 1');
      reverse(slots, before);

      expect(captureMethodSlots(exec, slots)[0].exists).toBe(false);
    });

    it('brings back a deleted method exactly, category included', () => {
      defineClass(CLS);
      compile(CLS, 'gone\n  ^ 7', 'private');
      const slots = [slot('gone')];
      const before = captureMethodSlots(exec, slots);

      q.deleteMethod(session(), CLS, false, 'gone', DICT);
      reverse(slots, before);

      const [state] = captureMethodSlots(exec, slots);
      expect(state.source).toBe('gone\n  ^ 7');
      expect(state.category).toBe('private');
    });

    it('restores the old selector and removes the new one when a pattern changed', () => {
      // Editing an existing method's message pattern compiles a NEW method and leaves the
      // original. Reversing has to do both, and restore before it removes.
      defineClass(CLS);
      compile(CLS, 'total\n  ^ 1');
      const slots = [slot('total'), slot('sum')];
      const before = captureMethodSlots(exec, slots);

      compile(CLS, 'sum\n  ^ 1');
      q.deleteMethod(session(), CLS, false, 'total', DICT);
      reverse(slots, before);

      const [total, sum] = captureMethodSlots(exec, slots);
      expect(total.exists).toBe(true);
      expect(sum.exists).toBe(false);
    });

    it('does nothing at all when the method is already back the way it was', () => {
      defineClass(CLS);
      compile(CLS, 'same\n  ^ 1');
      const slots = [slot('same')];
      const before = captureMethodSlots(exec, slots);

      expect(planReversal(slots, before, captureMethodSlots(exec, slots))).toEqual([]);
    });

    it('sees a method someone changed since as drift', () => {
      defineClass(CLS);
      compile(CLS, 'watched\n  ^ 1');
      const slots = [slot('watched')];
      const before = captureMethodSlots(exec, slots);
      compile(CLS, 'watched\n  ^ 2');
      const after = captureMethodSlots(exec, slots);

      compile(CLS, 'watched\n  ^ 3');
      const now = captureMethodSlots(exec, slots);

      expect(driftedSlots(slots, after, now)).toHaveLength(1);
      // Drift does not change what the reversal is FOR: it still puts `before` back.
      expect(planReversal(slots, before, now)[0].source).toBe('watched\n  ^ 1');
    });
  });

  // ── Layer 3: the GemStone facts the class design rests on ──────────────

  describe('what GemStone does to a class on redefinition', () => {
    it('answers a NEW version with NO methods when the shape changes', () => {
      // The reason a class revert binds the earlier OBJECT back rather than recompiling a
      // saved definition: recompiling would restore the shape and lose every method.
      defineClass(CLS);
      compile(CLS, 'kept\n  ^ 1');
      const first = boundVersion();

      defineClass(CLS, 'Object', "'balance' 'extra'");

      const [state] = captureClassSlots(exec, [classSlot()]);
      expect(state.oop).not.toBe(first);
      expect(state.selectors).toEqual([]);
    });

    it('answers the SAME version, methods intact, when the definition is unchanged', () => {
      // Which is why saving an unedited definition records nothing.
      defineClass(CLS);
      compile(CLS, 'kept\n  ^ 1');
      const first = boundVersion();

      defineClass(CLS);

      const [state] = captureClassSlots(exec, [classSlot()]);
      expect(state.oop).toBe(first);
      expect(state.selectors).toEqual(['kept']);
    });

    it('leaves a removed class usable, so the same version can be bound again', () => {
      // The reason removing a class is the one exact reversal here.
      defineClass(CLS);
      compile(CLS, 'kept\n  ^ 1');
      const key = newStashKey();
      const before = captureClassSlots(exec, [classSlot()], [key]);

      q.deleteClass(session(), DICT, CLS);
      expect(captureClassSlots(exec, [classSlot()])[0].bound).toBe(false);

      applyClassSlotOps(exec, [
        { kind: 'rebind', slot: classSlot(), stashKey: key, discarded: [] },
      ]);

      expect(captureClassSlots(exec, [classSlot()])[0]).toEqual(before[0]);
    });
  });

  describe('capturing a class slot', () => {
    it('reads the bound version and both sides of its method list', () => {
      defineClass(CLS);
      compile(CLS, 'inst\n  ^ 1');
      compile(CLS, 'make\n  ^ self new', 'instance creation', true);

      const [state] = captureClassSlots(exec, [classSlot()]);

      expect(state.bound).toBe(true);
      expect(state.oop).toMatch(/^\d+$/);
      expect(state.selectors).toEqual(['inst', 'class>>make']);
    });

    it('reads an unbound name as unbound', () => {
      expect(captureClassSlots(exec, [classSlot('JfpNoSuchClassAtAll')])[0]).toEqual({
        bound: false,
        oop: null,
        selectors: [],
      });
    });

    it('stashes the bound version only when asked to', () => {
      defineClass(CLS);
      const key = newStashKey();
      captureClassSlots(exec, [classSlot()], [key]);
      expect(exec(`(SessionTemps current at: #'${key}' ifAbsent: [nil]) isNil printString`)).toBe(
        'false',
      );

      const unused = newStashKey();
      captureClassSlots(exec, [classSlot()]);
      expect(
        exec(`(SessionTemps current at: #'${unused}' ifAbsent: [nil]) isNil printString`),
      ).toBe('true');
    });
  });

  describe('a class edit, recorded and reverted', () => {
    it('binds the earlier version back, with every method on both sides', () => {
      defineClass(CLS);
      compile(CLS, 'inst\n  ^ 1');
      compile(CLS, 'make\n  ^ self new', 'instance creation', true);
      const slots = [classSlot()];
      const key = newStashKey();
      const before = captureClassSlots(exec, slots, [key]);

      defineClass(CLS, 'Object', "'balance' 'extra'");
      const ops = planClassReversal(slots, before, captureClassSlots(exec, slots), [key]);
      const results = applyClassSlotOps(exec, ops);

      expect(results.every((r) => r.error === null)).toBe(true);
      expect(captureClassSlots(exec, slots)[0]).toEqual(before[0]);
      expect(
        captureMethodSlots(exec, [slot('inst'), slot('make', true)]).map((s) => s.exists),
      ).toEqual([true, true]);
    });

    it('names the methods written on the newer version that a revert would leave behind', () => {
      defineClass(CLS);
      compile(CLS, 'original\n  ^ 1');
      const slots = [classSlot()];
      const key = newStashKey();
      const before = captureClassSlots(exec, slots, [key]);

      defineClass(CLS, 'Object', "'balance' 'extra'");
      compile(CLS, 'writtenLater\n  ^ 2');

      const ops = planClassReversal(slots, before, captureClassSlots(exec, slots), [key]);
      expect(discardedByReversal(ops)).toEqual([`${CLS}>>#writtenLater`]);
    });

    it('unbinds a class that was created', () => {
      const slots = [classSlot()];
      const before = captureClassSlots(exec, slots, [newStashKey()]);
      expect(before[0].bound).toBe(false);

      defineClass(CLS);
      expect(captureClassSlots(exec, slots)[0].bound).toBe(true);
      const ops = planClassReversal(slots, before, captureClassSlots(exec, slots), [null]);
      applyClassSlotOps(exec, ops);

      expect(captureClassSlots(exec, slots)[0].bound).toBe(false);
    });

    it('puts a whole removed subtree back, in one plan', () => {
      defineClass(CLS);
      defineClass(SUB, CLS, "'rate'");
      compile(SUB, 'rate\n  ^ 1');
      const slots = [classSlot(CLS), classSlot(SUB)];
      const keys = [newStashKey(), newStashKey()];
      const before = captureClassSlots(exec, slots, keys);

      q.deleteClass(session(), DICT, SUB);
      q.deleteClass(session(), DICT, CLS);

      const ops = planClassReversal(slots, before, captureClassSlots(exec, slots), keys);
      const results = applyClassSlotOps(exec, ops);

      expect(results.every((r) => r.error === null)).toBe(true);
      expect(captureClassSlots(exec, slots).map((s) => s.bound)).toEqual([true, true]);
      expect(captureMethodSlots(exec, [slot('rate', false, SUB)])[0].exists).toBe(true);
    });

    it('sees a class rebound since the edit as drift', () => {
      defineClass(CLS);
      const slots = [classSlot()];
      const key = newStashKey();
      const before = captureClassSlots(exec, slots, [key]);
      defineClass(CLS, 'Object', "'balance' 'extra'");
      const after = captureClassSlots(exec, slots);

      defineClass(CLS, 'Object', "'balance' 'extra' 'third'");
      const now = captureClassSlots(exec, slots);

      expect(driftedClassSlots(slots, after, now)).toHaveLength(1);
      // And the reversal still targets the version from before the FIRST edit.
      expect(planClassReversal(slots, before, now, [key])[0].stashKey).toBe(key);
    });

    it('reports a stash the session no longer holds rather than binding nil', () => {
      // The failure mode that matters: a key that resolves to nothing must refuse, not put
      // an empty binding into the dictionary.
      defineClass(CLS);
      const [result] = applyClassSlotOps(exec, [
        { kind: 'rebind', slot: classSlot(), stashKey: 'JfpNoSuchStashKey', discarded: [] },
      ]);

      expect(result.error).toContain('no longer holds');
      expect(captureClassSlots(exec, [classSlot()])[0].bound).toBe(true);
    });

    it('reports a dictionary it cannot find', () => {
      const [result] = applyClassSlotOps(exec, [
        {
          kind: 'unbind',
          slot: { dict: 'JfpNoSuchDictionary', className: CLS },
          stashKey: null,
          discarded: [],
        },
      ]);
      expect(result.error).toContain('no such dictionary');
    });
  });

  // ── A class comment, recorded and reversed ─────────────────────────────

  describe('a class comment, recorded and reversed', () => {
    it('puts the earlier comment back', () => {
      defineClass(CLS);
      q.setClassComment(session(), CLS, 'the first comment', DICT);
      const before = q.getClassComment(session(), CLS, DICT);

      q.setClassComment(session(), CLS, 'a second comment', DICT);
      expect(q.setClassComment(session(), CLS, before, DICT)).toContain('Comment set:');

      expect(q.getClassComment(session(), CLS, DICT)).toBe(before);
    });

    it('empties a comment again on a class that had none', () => {
      // GemStone stores the empty string rather than dropping the comment, so "no comment"
      // and "empty comment" are the same state — which is what makes the reversal exact.
      defineClass(CLS);
      const before = q.getClassComment(session(), CLS, DICT);

      q.setClassComment(session(), CLS, 'a first comment', DICT);
      q.setClassComment(session(), CLS, before, DICT);

      expect(q.getClassComment(session(), CLS, DICT)).toBe(before);
    });

    it('does not re-version the class, which is why it is an undo and not a revert', () => {
      defineClass(CLS);
      const version = boundVersion();
      const history = exec(`${CLS} classHistory size printString`).trim();

      q.setClassComment(session(), CLS, 'a comment', DICT);

      expect(boundVersion()).toBe(version);
      expect(exec(`${CLS} classHistory size printString`).trim()).toBe(history);
    });

    it('reports a class it cannot resolve rather than throwing', () => {
      expect(q.setClassComment(session(), 'JfpNoSuchClassForComment', 'x', DICT)).toContain(
        'Class not found',
      );
    });
  });

  // ── A class variable, recorded and reversed ────────────────────────────

  describe('an added class variable, recorded and reversed', () => {
    it('takes the declaration away again', () => {
      defineClass(CLS);
      const before = captureClassVar(exec, varSlot('Registry'));
      expect(before.defined).toBe(false);

      q.addClassVariable(session(), CLS, 'Registry', DICT);
      const now = captureClassVar(exec, varSlot('Registry'));
      expect(now.defined).toBe(true);

      const op = planClassVarReversal(before, now);
      expect(op).toBe('undeclare');
      expect(applyClassVarOp(exec, varSlot('Registry'), op!)).toBeNull();
      expect(captureClassVar(exec, varSlot('Registry')).defined).toBe(false);
    });

    it('does not re-version the class in either direction', () => {
      // The whole reason this is an undo rather than a revert: a class variable is not part
      // of instance layout, so neither adding nor removing one gives the class a new version.
      defineClass(CLS);
      const version = boundVersion();

      q.addClassVariable(session(), CLS, 'Registry', DICT);
      expect(boundVersion()).toBe(version);

      applyClassVarOp(exec, varSlot('Registry'), 'undeclare');
      expect(boundVersion()).toBe(version);
    });

    it('only removes a name the class DECLARES, never one it inherits', () => {
      // Removing an inherited name would take the variable away from every other subclass.
      defineClass(CLS);
      defineClass(SUB, CLS, "'rate'");
      q.addClassVariable(session(), CLS, 'Registry', DICT);

      expect(applyClassVarOp(exec, varSlot('Registry', SUB), 'undeclare')).toBeNull();

      expect(captureClassVar(exec, varSlot('Registry')).defined).toBe(true);
      expect(q.getVisibleClassVarNames(session(), SUB, DICT)).toContain('Registry');
    });

    it('reads a name the class only inherits as NOT declared here', () => {
      defineClass(CLS);
      defineClass(SUB, CLS, "'rate'");
      q.addClassVariable(session(), CLS, 'Registry', DICT);

      expect(captureClassVar(exec, varSlot('Registry', SUB)).defined).toBe(false);
    });

    it('reports a class it cannot resolve', () => {
      expect(applyClassVarOp(exec, varSlot('Registry', 'JfpNoSuchClassForVar'), 'undeclare')).toBe(
        'JfpNoSuchClassForVar could not be resolved',
      );
    });

    it('finds every method that references it — both sides, whole subtree', () => {
      defineClass(CLS);
      defineClass(SUB, CLS, "'rate'");
      q.addClassVariable(session(), CLS, 'Registry', DICT);
      compile(CLS, 'registry\n  ^ Registry', 'accessing', true); // class side, declaring class
      compile(CLS, 'peek\n  ^ Registry', 'accessing'); // instance side, declaring class
      compile(SUB, 'subPeek\n  ^ Registry'); // instance side, subclass
      compile(CLS, 'unrelated\n  ^ 1', 'accessing'); // references nothing

      const found = methodsReferencingClassVar(exec, varSlot('Registry'))
        .map((m) => `${m.className}${m.isMeta ? ' class' : ''}>>#${m.selector}`)
        .sort();

      expect(found).toEqual([`${CLS} class>>#registry`, `${CLS}>>#peek`, `${SUB}>>#subPeek`]);
    });

    it('does not report a same-named GLOBAL, which is a different association', () => {
      defineClass(CLS);
      exec(`${DICT} at: #JfpUndoItStray put: 42. true printString`);
      q.addClassVariable(session(), CLS, 'JfpUndoItStray2', DICT);
      compile(CLS, 'usesGlobal\n  ^ JfpUndoItStray', 'accessing');

      expect(methodsReferencingClassVar(exec, varSlot('JfpUndoItStray2'))).toEqual([]);
    });

    it('answers nothing for a class that declares no class variables at all', () => {
      // `_classVars` itself answers nil there, which the scan has to survive.
      defineClass(CLS);

      expect(methodsReferencingClassVar(exec, varSlot('Registry'))).toEqual([]);
    });

    it('SEVERS a referencing method rather than removing it — it reads nil and will not recompile', () => {
      // This is the fact the warning exists for, pinned so it cannot change underneath it.
      defineClass(CLS);
      q.addClassVariable(session(), CLS, 'Registry', DICT);
      compile(CLS, 'peek\n  ^ Registry', 'accessing');
      exec(`(${CLS} _classVars associationAt: #Registry) value: 99. true printString`);
      expect(exec(`${CLS} new peek printString`).trim()).toBe('99');

      applyClassVarOp(exec, varSlot('Registry'), 'undeclare');

      expect(exec(`(${CLS} includesSelector: #peek) printString`).trim()).toBe('true');
      expect(exec(`${CLS} new peek printString`).trim()).toBe('nil');
      expect(
        exec(
          `[${CLS} compileMethod: 'peek\n  ^ Registry' dictionaries: System myUserProfile symbolList ` +
            `category: 'accessing' environmentId: 0. 'compiled'] on: Error do: [:e | 'refused']`,
        ).trim(),
      ).toBe('refused');
    });

    it('declares the name again, for the reversal in the other direction', () => {
      defineClass(CLS);
      q.addClassVariable(session(), CLS, 'Registry', DICT);
      applyClassVarOp(exec, varSlot('Registry'), 'undeclare');

      expect(applyClassVarOp(exec, varSlot('Registry'), 'declare')).toBeNull();
      expect(captureClassVar(exec, varSlot('Registry')).defined).toBe(true);
    });
  });
});
