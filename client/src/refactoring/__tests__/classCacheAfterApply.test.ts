import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { clearClassOrganizerStatement } from '../../queries/classOrganizer';

/**
 * Which applies drop the session's cached ClassOrganizer, and which keep it.
 *
 * The hierarchy queries read that cache, and it holds the CLASS OBJECTS of the image and their
 * superclass links. An apply that gives a class a new version, binds or unbinds one, or re-parents
 * one leaves it describing classes that are no longer current -- the Hierarchy pane then shows a
 * reshaped class with no subclasses. Those applies drop it in the same doit that changes the
 * classes. Everything else keeps it: rebuilding is cheap but not free, and a method-level
 * refactoring changes nothing the cache holds.
 *
 * Every exported query in the two folders is found here, so a new one fails the first test until
 * it is put in one list or the other -- the decision cannot be skipped by forgetting this file.
 * Only names that read, preview or decode are exempt, by prefix, since those change no classes.
 */

/** Every query module the apply builders live in, loaded by path so a new file is included too. */
const queryDirs = [join(__dirname, '../queries'), join(__dirname, '../../undo/queries')];
const loadQueryModules = async (): Promise<Record<string, Record<string, unknown>>> => {
  const entries = await Promise.all(
    queryDirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .map(async (f) => [f, (await import(join(dir, f))) as Record<string, unknown>] as const),
    ),
  );
  return Object.fromEntries(entries);
};

const READER =
  /^(get|parse|start|page|clear|capture|analyze|candidatesFor|methods|is[A-Z]|globalNameInUse|decode|resolve|accessorSpecsFor|classDefiningDictionaryName|dictionariesShadowedByRename|renameTemporaryDeclineReason|dictionaryEntryCount|refactoringUndoStatus|pushEngineClass|recordedApplyExpr|(new|forget|take|reset|release)\w*StashKeys?$)/;
const isApplyBuilder = (name: string): boolean => !READER.test(name);

const slot = { dict: 1, className: 'Foo' };

/** The arguments each builder takes after its executor. */
const DROPS: Record<string, unknown[]> = {
  // push up / push down / move instance variable, and convert temporary to instance variable
  applyInstVarStructure: ['tok'],
  // add / remove instance variable
  applyInstVar: ['tok', [], null, false, false],
  applyRenameInstVar: ['tok', []],
  applyRenameClass: ['tok', []],
  // extract superclass, and insert superclass (the same engine with no siblings)
  applyExtractSuperclass: ['tok'],
  applySplitClass: ['tok'],
  revertClassToVersion: ['Foo', 1],
  // undo of a class edit: rebinds an earlier class version, or unbinds a class
  applyClassSlotOps: [[{ kind: 'unbind', slot, stashKey: null, discarded: [] }]],
  // Undo of any refactoring, method-level ones included: the same query applies both, and the
  // client's record of which kind it is cannot be trusted to stop a class undo that fails part-way
  // from leaving a stale cache. One rebuild per explicit Undo is the cost.
  applyUndoRefactoring: ['tok', []],
  // undo of removing a dictionary: every class in it is bound again
  reinsertDictionary: ['stash', 1],
};

const KEEPS: Record<string, unknown[]> = {
  applyRenameMethod: ['tok', [], 'label'],
  applyChangeSignature: ['tok', [], 'label'],
  applyPushMethod: ['up', 'tok', [], 'label'],
  applyExtractMethod: ['tok', [], 'label'],
  applyInlineMethod: ['tok', [], 'label'],
  applyMoveMethod: ['tok', [], 'label'],
  applyRenameTemporary: ['tok', 'label'],
  applyExtractTemporary: ['tok', 'label'],
  applyInlineTemporary: ['tok', 'label'],
  applyMethodSlotOps: [
    [
      {
        kind: 'remove',
        slot: { ...slot, isMeta: false, selector: 'foo', environmentId: 0 },
        source: null,
        category: null,
      },
    ],
  ],
  // A class variable is a binding in the class's pool: renaming, adding or removing one creates
  // no class version (addClassVarName: / removeClassVarName:), so no class object changes.
  applyRenameClassVar: ['tok'],
  applyClassVarOp: [{ ...slot, varName: 'V' }, 'declare'],
  addClassVariable: ['Foo', 'V'],
  deleteClassVariable: ['Foo', 'V'],
  // Compiles methods onto an existing class.
  addAccessors: ['Foo', false, [{ selector: 'a', source: 'a ^a' }]],
  // Undo bookkeeping: these record or discard what an undo will do, and change no class.
  recordReverseRename: [
    'instVarRename',
    'Foo',
    'a',
    'b',
    'label',
    'GsRenameInstanceVariableRefactoring',
  ],
  discardPendingCapture: [],
  commitHistoryRevert: ['label', 'GsInstVarRefactoring'],
  // Takes an old version out of the history list; no current class or superclass link changes.
  removeClassVersion: ['Foo', 1],
};

type Builder = { file: string; name: string; fn: (...args: unknown[]) => unknown };

/** Every apply builder, with the module it lives in. */
let builders: Builder[] = [];
beforeAll(async () => {
  const modules = await loadQueryModules();
  builders = Object.entries(modules).flatMap(([file, mod]) =>
    Object.entries(mod)
      .filter(([name, value]) => isApplyBuilder(name) && typeof value === 'function')
      .map(([name, fn]) => ({ file, name, fn: fn as (...args: unknown[]) => unknown })),
  );
});

/** The code of each call a builder makes, whether its executor is sync or async. */
async function callsMadeBy(name: string, args: unknown[]): Promise<string[]> {
  const builder = builders.find((b) => b.name === name);
  if (!builder) throw new Error(`no apply builder named ${name}`);
  const execute = vi.fn((...callArgs: unknown[]) => {
    const result = '{"applied":0,"failed":[]}';
    return callArgs.length > 1 ? Promise.resolve(result) : result;
  });
  try {
    await builder.fn(execute, ...args);
  } catch {
    // Parsing the canned reply may fail; only the code that was sent matters here.
  }
  return execute.mock.calls.map((c) => String(c[c.length - 1]));
}

// The drop itself, not the cache key: a builder that only READS the cache names the key too.
const dropsTheCache = (code: string): boolean => code.includes(clearClassOrganizerStatement());

describe('applies and the cached class list', () => {
  it('decides, for every apply builder, whether it drops the cached class list', () => {
    // Guards against a loader that finds nothing, which would make every list below vacuous.
    expect(builders.length).toBeGreaterThan(Object.keys(DROPS).length);
    const undecided = builders
      .map((b) => b.name)
      .filter((name) => !(name in DROPS) && !(name in KEEPS));

    expect(undecided).toEqual([]);
  });

  it.each(Object.entries(DROPS))(
    '%s drops it in the doit that changes the classes',
    async (name, args) => {
      // A doit that is nothing but the drop is a separate call, run before or after the apply.
      const dropping = (await callsMadeBy(name, args)).filter(
        (code) => dropsTheCache(code) && code.trim() !== clearClassOrganizerStatement(),
      );

      expect(dropping).toHaveLength(1);
      // First, after any temporaries: an apply that fails part-way has still re-versioned classes.
      const afterTemps = dropping[0].replace(/^\s*\|[^|]*\|/, '').trimStart();
      expect(afterTemps.startsWith(clearClassOrganizerStatement())).toBe(true);
    },
  );

  it.each(Object.entries(KEEPS))('%s keeps it', async (name, args) => {
    const calls = await callsMadeBy(name, args);

    // Sent something, or "keeps it" would pass for a builder this call never reached.
    expect(calls).not.toEqual([]);
    expect(calls.some(dropsTheCache)).toBe(false);
  });
});
