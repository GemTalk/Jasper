import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import * as debug from '../debugQueries';
import { OOP_ILLEGAL, OOP_NIL } from '../gciConstants';

/**
 * What the debugger can see of a suspended frame, driven against a REAL halt.
 *
 * Every assertion here failed before the fix, and none of them could fail in the
 * unit suite: `fetchFrameVariables` is mocked wholesale wherever the panel is
 * tested, and `debugQueries.test.ts` exercises only the payload parsers against
 * hand-written strings. The faults were all in Smalltalk the mocks never run:
 *
 *  - the variable doits filtered names with `startsWith:`, which GemStone does
 *    not implement (it is `beginsWith:`). The MessageNotUnderstood landed in the
 *    doit's own best-effort `on: Error do: []`, so every frame came back with a
 *    receiver and instance variables and NO arguments or temporaries at all —
 *    on every frame, of every halt, on every release;
 *  - the eval bar and the Variables pane read the frame's *receiver* (slot 10 of
 *    `_frameContentsAt:`) as `self`. In a block frame that is the ExecBlock, so
 *    `self`, instance variables and class variables all failed there.
 *
 * The fixture class is created inside the harness transaction and never
 * committed. Each halt's suspended process is released with `GciTsClearStack`.
 */
describe('suspended frame context (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const TEST_CLASS = 'JasperFrameContextTest';

  /**
   * A class with an instance variable, a class variable, a method that halts
   * inside a block that never mentions `self` (so the compiler copies no home
   * receiver into it — the case that needs the walk out to the home activation),
   * a sibling whose block does mention `self` (the case slot 8 answers on its
   * own), and a plain method with one argument and one temporary.
   */
  const defineFixture = (): void => {
    gci.executeAndFetchString(
      handle,
      `| cls compile |
cls := Object subclass: '${TEST_CLASS}'
  instVarNames: #('limit')
  classVars: #('Threshold')
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
compile := [:src | cls compileMethod: src
  dictionaries: System myUserProfile symbolList category: 'jasper-test'].
cls class compileMethod: 'setup Threshold := 42'
  dictionaries: System myUserProfile symbolList category: 'jasper-test'.
compile value: 'limit ^ limit'.
compile value: 'limit: anInteger limit := anInteger'.
compile value: 'scanNoSelf: coll
| total tag |
total := 0.
tag := 7.
coll do: [:each | total := total + each. UserGlobals at: #JasperFrameZork put: (1/0)].
^ total'.
compile value: 'scanWithSelf: coll
| total tag |
total := 0.
tag := 7.
coll do: [:each | total := total + each. self error: ''halt in block''].
^ total'.
compile value: 'haltWithArgAndTemp: anArg
| aTemp |
aTemp := anArg * 2.
^ self error: ''halt in method'''.
cls setup.
'ok'`,
    );
  };

  /** Runs `code` to its halt and answers the suspended GsProcess's oop. */
  const haltAt = (code: string): bigint => {
    const { err } = gci.GciTsExecute(
      handle,
      code,
      gci.utf8ClassOop(handle),
      OOP_ILLEGAL,
      gci.nilOop(),
      0,
      0,
    );
    expect(err.number).not.toBe(0);
    const gsProcess = BigInt(err.context ?? 0);
    expect(gsProcess).not.toBe(0n);
    expect(gsProcess).not.toBe(OOP_NIL);
    return gsProcess;
  };

  /** Runs `body` against a halt, always releasing the suspended process after. */
  const atHalt = (code: string, body: (gsProcess: bigint, s: ActiveSession) => void): void => {
    defineFixture();
    const gsProcess = haltAt(code);
    try {
      body(gsProcess, session());
    } finally {
      gci.GciTsClearStack(handle, gsProcess);
    }
  };

  /** The level of the topmost frame running a block whose home is `selector`. */
  const blockFrameLevel = (s: ActiveSession, gsProcess: bigint, selector: string): number => {
    const depth = debug.getStackDepth(s, gsProcess);
    for (let level = 1; level <= depth; level++) {
      const info = debug.getFrameInfo(s, gsProcess, level);
      if (info.homeMethodOop === OOP_NIL) continue;
      if (debug.getMethodInfo(s, info.homeMethodOop).selector === selector) return level;
    }
    throw new Error(`no block frame with home #${selector} on the stack`);
  };

  /** The level of the topmost frame running `className >> selector` itself. */
  const methodFrameLevel = (
    s: ActiveSession,
    gsProcess: bigint,
    className: string,
    selector: string,
  ): number => {
    const depth = debug.getStackDepth(s, gsProcess);
    for (let level = 1; level <= depth; level++) {
      const info = debug.getFrameInfo(s, gsProcess, level);
      if (info.homeMethodOop !== OOP_NIL) continue; // a block frame, not the method
      const method = debug.getMethodInfo(s, info.methodOop);
      if (method.className === className && method.selector === selector) return level;
    }
    throw new Error(`no ${className}>>#${selector} frame on the stack`);
  };

  const namedValues = (rows: debug.FrameVarRow[], group: debug.FrameVarRow['group']) =>
    Object.fromEntries(rows.filter((r) => r.group === group).map((r) => [r.name, r.value]));

  describe('Variables pane rows', () => {
    it("shows a user method's argument AND its temporary, with their values", () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) haltWithArgAndTemp: 21`, (gsProcess, s) => {
        const level = methodFrameLevel(s, gsProcess, TEST_CLASS, 'haltWithArgAndTemp:');
        const argTemps = namedValues(debug.fetchFrameVariables(s, gsProcess, level), 'argtemps');
        expect(argTemps).toMatchObject({ anArg: '21', aTemp: '42' });
      });
    });

    it("shows a kernel primitive-backed frame's arguments (String >> at:put:)", () => {
      // The report that started this: an out-of-range at:put: on a String showed
      // no argument values at all. Nothing about at:put: was special — the whole
      // named group was empty on every frame.
      atHalt('String new at: 5 put: $a', (gsProcess, s) => {
        const level = methodFrameLevel(s, gsProcess, 'String', 'at:put:');
        const argTemps = namedValues(debug.fetchFrameVariables(s, gsProcess, level), 'argtemps');
        expect(argTemps.anIndex).toBe('5');
        expect(argTemps.aChar).toBe('$a');
      });
    });

    it('shows the HOME receiver and its instVars on a block frame, not the ExecBlock', () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) scanNoSelf: #(1 2 3)`, (gsProcess, s) => {
        const level = blockFrameLevel(s, gsProcess, 'scanNoSelf:');
        const rows = debug.fetchFrameVariables(s, gsProcess, level);
        expect(namedValues(rows, 'receiver').self).toBe(`a${TEST_CLASS}`);
        expect(namedValues(rows, 'instvars')).toMatchObject({ limit: '99' });
        // …and the block's own argument and the temp it shares with its home.
        expect(namedValues(rows, 'argtemps')).toMatchObject({ each: '1', total: '1' });
      });
    });

    it('carries arguments into the whole-stack dump too (Copy/Dump Stack)', () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) haltWithArgAndTemp: 21`, (gsProcess, s) => {
        const level = methodFrameLevel(s, gsProcess, TEST_CLASS, 'haltWithArgAndTemp:');
        const named = debug
          .fetchStackDump(s, gsProcess)
          .filter((r) => r.serverLevel === level && r.group === 'argtemps');
        expect(Object.fromEntries(named.map((r) => [r.name, r.value]))).toMatchObject({
          anArg: '21',
          aTemp: '42',
        });
      });
    });
  });

  describe('getFrameInfo resolves a block frame’s self', () => {
    it('takes it from the home activation when the block never captured self', () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) scanNoSelf: #(1 2 3)`, (gsProcess, s) => {
        const blockLevel = blockFrameLevel(s, gsProcess, 'scanNoSelf:');
        const homeLevel = methodFrameLevel(s, gsProcess, TEST_CLASS, 'scanNoSelf:');
        const block = debug.getFrameInfo(s, gsProcess, blockLevel);
        expect(block.homeMethodOop).not.toBe(OOP_NIL);
        expect(block.selfIsUnavailable).toBe(false);
        expect(block.selfOop).toBe(debug.getFrameInfo(s, gsProcess, homeLevel).selfOop);
        expect(debug.getObjectClassName(s, block.selfOop)).toBe(TEST_CLASS);
      });
    });

    it('takes it straight from slot 8 when the block did capture self', () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) scanWithSelf: #(1 2 3)`, (gsProcess, s) => {
        const blockLevel = blockFrameLevel(s, gsProcess, 'scanWithSelf:');
        const block = debug.getFrameInfo(s, gsProcess, blockLevel);
        expect(block.selfIsUnavailable).toBe(false);
        expect(debug.getObjectClassName(s, block.selfOop)).toBe(TEST_CLASS);
      });
    });
  });

  describe('eval bar inside a block frame', () => {
    // The table from the bug report, expression by expression: everything reached
    // through the receiver used to fail, and everything belonging to the home
    // method was invisible.
    const expectations: [expression: string, printString: string][] = [
      ['self class', TEST_CLASS],
      ['limit', '99'], // instance variable, through self
      ['self limit', '99'], // …and through a send to self
      ['Threshold', '42'], // class variable
      ['each', '1'], // the block's own argument
      ['total', '1'], // a temporary the block shares with its home
      ['coll', 'anArray( 1, 2, 3)'], // the home method's argument
      ['tag', '7'], // a home temporary the block never touches
      ['each > limit', 'false'], // one expression spanning both scopes
    ];

    for (const homeSelector of ['scanNoSelf:', 'scanWithSelf:']) {
      describe(`in ${homeSelector}`, () => {
        for (const [expression, printString] of expectations) {
          it(`resolves \`${expression}\``, () => {
            atHalt(
              `(${TEST_CLASS} new limit: 99; yourself) ${homeSelector} #(1 2 3)`,
              (gsProcess, s) => {
                const level = blockFrameLevel(s, gsProcess, homeSelector);
                expect(debug.evaluateInFrame(s, gsProcess, expression, level)).toBe(printString);
              },
            );
          });
        }
      });
    }

    it('binds the block name, not the home name, when both are spelled the same', () => {
      atHalt(`(${TEST_CLASS} new limit: 99; yourself) scanNoSelf: #(1 2 3)`, (gsProcess, s) => {
        const level = blockFrameLevel(s, gsProcess, 'scanNoSelf:');
        // `total` is the home method's temporary AND is shared into the block;
        // the block's layer is applied last, so its live value is what shows.
        expect(debug.evaluateInFrame(s, gsProcess, 'total', level)).toBe('1');
      });
    });
  });

  it('evaluates in a plain method frame with no named temps at all', () => {
    // `AbstractException >> signal` takes no arguments and declares no temps, so
    // the frame contributes no names and the evaluation runs against the session's
    // symbol list alone — the shape that fails on 3.6.2 if the one-argument
    // `evaluateInContext:` is ever sent again.
    atHalt(`(${TEST_CLASS} new limit: 99; yourself) haltWithArgAndTemp: 21`, (gsProcess, s) => {
      const level = methodFrameLevel(s, gsProcess, 'AbstractException', 'signal');
      expect(debug.evaluateInFrame(s, gsProcess, '3 + 4', level)).toBe('7');
    });
  });
});
