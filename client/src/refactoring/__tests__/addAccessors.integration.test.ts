import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { accessorSpecsFor } from '../queries/addAccessors';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';

/**
 * Automatic GCI integration test for Add Accessors, over the real GCI transport.
 * No refactoring engine needed (`compileMethod:`/`includesSelector:` are base image)
 * and no gate, so it runs in both CI passes. Confirms instance-variable accessors
 * land on the instance side and class-variable accessors on the class side (with a
 * lowercased selector), that existing accessors are skipped (never clobbered), and
 * that the compiled methods actually read/write the variable. Fully transient.
 */
describe('add accessors (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);

  const dictIndexOf = async (name: string): Promise<number> =>
    parseInt(
      await exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = async (): Promise<number> => await dictIndexOf('UserGlobals');

  const CLS = 'AaccItClass';
  const defineFixture = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #(count) classVars: #(Registry) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
  };

  const addFor = async (varName: string, kind: 'ivar' | 'classvar') => {
    const { isMeta, accessors } = accessorSpecsFor(varName, kind);
    return await q.addAccessors(session(), CLS, isMeta, accessors, await userIndex());
  };

  it('creates instance-side getter and setter for an instance variable', async () => {
    await defineFixture();

    const result = await addFor('count', 'ivar');

    expect(result).toEqual({ created: 2, skipped: 0, noClass: false });
    expect((await exec(`(${CLS} includesSelector: #count) printString`)).trim()).toBe('true');
    expect((await exec(`(${CLS} includesSelector: #'count:') printString`)).trim()).toBe('true');
    // The generated getter really reads the instance variable.
    await exec(
      `(UserGlobals at: #AaccInst put: ${CLS} new). (UserGlobals at: #AaccInst) count: 41. true printString`,
    );
    expect((await exec(`(UserGlobals at: #AaccInst) count printString`)).trim()).toBe('41');
  });

  it('creates class-side accessors with a lowercased selector for a class variable', async () => {
    await defineFixture();

    const result = await addFor('Registry', 'classvar');

    expect(result).toEqual({ created: 2, skipped: 0, noClass: false });
    expect((await exec(`(${CLS} class includesSelector: #registry) printString`)).trim()).toBe(
      'true',
    );
    expect((await exec(`(${CLS} class includesSelector: #'registry:') printString`)).trim()).toBe(
      'true',
    );
    // The class-side accessor reads/writes the class variable.
    await exec(`${CLS} registry: 7. true printString`);
    expect((await exec(`${CLS} registry printString`)).trim()).toBe('7');
  });

  it('skips an accessor that already exists instead of clobbering it', async () => {
    await defineFixture();
    await addFor('count', 'ivar'); // create them once

    const again = await addFor('count', 'ivar'); // second run

    expect(again).toEqual({ created: 0, skipped: 2, noClass: false });
  });

  it('reports noClass for a name that is not a bound class', async () => {
    const { isMeta, accessors } = accessorSpecsFor('count', 'ivar');

    expect(
      await q.addAccessors(session(), 'NoSuchClassAacc', isMeta, accessors, await userIndex()),
    ).toEqual({
      created: 0,
      skipped: 0,
      noClass: true,
    });
  });
});
