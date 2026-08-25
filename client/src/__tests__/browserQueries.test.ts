import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    executeAndFetchString: vi.fn(() => executeFetchData),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    GciTsPerform: vi.fn(),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('browserQueries', () => {
  describe('compileMethod', () => {
    it('uses pure Smalltalk (no GciTsPerform) via Behavior>>compileMethod:dictionaries:category:environmentId:', () => {
      const session = createMockSession('Compiled: Array >> foo');

      queries.compileMethod(session, 'Array', false, 'test', 'foo\n  ^ 42');

      const mockPerform = session.gci.GciTsPerform as ReturnType<typeof vi.fn>;
      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      expect(mockPerform).not.toHaveBeenCalled();
      expect(mockExec).toHaveBeenCalledTimes(1);
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('compileMethod:');
      expect(code).toContain('dictionaries: System myUserProfile symbolList');
    });

    it('branches on isMeta inside the Smalltalk, not via a GCI perform', () => {
      const session = createMockSession('ok');
      queries.compileMethod(session, 'Array', true, 'test', 'foo');
      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('target := base class');
    });
  });

  describe('sendersOf', () => {
    it('parses tab-separated GsNMethod results', () => {
      const payload =
        'Globals\tArray\t0\tsize\taccessing\nUserGlobals\tMyClass\t1\tprintOn:\tprinting\n';
      const session = createMockSession(payload);

      const results = queries.sendersOf(session, 'size');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
        environmentId: 0,
      });
      expect(results[1]).toEqual({
        dictName: 'UserGlobals',
        className: 'MyClass',
        isMeta: true,
        selector: 'printOn:',
        category: 'printing',
        environmentId: 0,
      });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.sendersOf(session, 'nonExistent')).toEqual([]);
    });

    it('passes environmentId to Smalltalk code', () => {
      const session = createMockSession('');
      queries.sendersOf(session, 'size', 2);

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('environmentId: 2');
    });
  });

  describe('implementorsOf', () => {
    it('parses tab-separated GsNMethod results', () => {
      const payload = 'Globals\tArray\t0\tsize\taccessing\n';
      const session = createMockSession(payload);

      const results = queries.implementorsOf(session, 'size');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
        environmentId: 0,
      });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.implementorsOf(session, 'nonExistent')).toEqual([]);
    });

    it('uses asArray to handle non-Array collections', () => {
      const session = createMockSession('');
      queries.implementorsOf(session, 'size');

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('asArray');
    });
  });

  describe('getClassHierarchy', () => {
    it('parses superclass/self/subclass entries', () => {
      const payload =
        'Globals\tObject\tsuperclass\nGlobals\tSequenceableCollection\tsuperclass\nGlobals\tArray\tself\nGlobals\tFoo\tsubclass\n';
      const session = createMockSession(payload);

      const results = queries.getClassHierarchy(session, 'Array');

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({ dictName: 'Globals', className: 'Object', kind: 'superclass' });
      expect(results[1]).toEqual({
        dictName: 'Globals',
        className: 'SequenceableCollection',
        kind: 'superclass',
      });
      expect(results[2]).toEqual({ dictName: 'Globals', className: 'Array', kind: 'self' });
      expect(results[3]).toEqual({ dictName: 'Globals', className: 'Foo', kind: 'subclass' });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.getClassHierarchy(session, 'NonExistent')).toEqual([]);
    });
  });

  describe('fileOutClass', () => {
    it('returns Topaz file-out string for a class', () => {
      const topazSource = "! Class definition\nObject subclass: 'MyClass'\n";
      const session = createMockSession(topazSource);

      const result = queries.fileOutClass(session, 'MyClass');

      expect(result).toBe(topazSource);
    });

    it('defaults to global objectNamed: lookup when no dict is given', () => {
      const session = createMockSession('');
      queries.fileOutClass(session, 'MyClass');

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain("objectNamed: #'MyClass'");
      expect(code).toContain('fileOutClass');
    });

    it('scopes to a dictionary by 1-based index when given a number', () => {
      const session = createMockSession('');
      queries.fileOutClass(session, 'MyClass', 3);

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('symbolList at: 3');
      expect(code).toContain("#'MyClass' ifAbsent: [nil]");
    });

    it('escapes single quotes in class names', () => {
      const session = createMockSession('');
      queries.fileOutClass(session, "Class'Name");

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain("#'Class''Name'");
    });
  });

  describe('getDictionaryClassFileOutOrder', () => {
    it('returns class names ordered by inheritance depth then name', () => {
      const session = createMockSession('2\tAnimal\n1\tObject\n3\tDog\n');

      expect(queries.getDictionaryClassFileOutOrder(session, 1)).toEqual([
        'Object',
        'Animal',
        'Dog',
      ]);
    });

    it('scopes to a dictionary by 1-based index', () => {
      const session = createMockSession('');
      queries.getDictionaryClassFileOutOrder(session, 5);

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('symbolList at: 5');
    });
  });

  describe('getGlobalsForDictionary', () => {
    it('parses tab-separated globals results', () => {
      const payload =
        '_remoteNil\tUndefinedObject\tremoteNil\nAllUsers\tUserProfileSet\tanUserProfileSet(...)\n';
      const session = createMockSession(payload);

      const results = queries.getGlobalsForDictionary(session, 1);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        name: '_remoteNil',
        className: 'UndefinedObject',
        value: 'remoteNil',
      });
      expect(results[1]).toEqual({
        name: 'AllUsers',
        className: 'UserProfileSet',
        value: 'anUserProfileSet(...)',
      });
    });

    it('returns empty array for empty result', () => {
      const session = createMockSession('');
      expect(queries.getGlobalsForDictionary(session, 1)).toEqual([]);
    });

    it('skips lines without two tabs', () => {
      const payload = 'noTabs\noneTab\tonly\n_remoteNil\tUndefinedObject\tremoteNil\n';
      const session = createMockSession(payload);

      const results = queries.getGlobalsForDictionary(session, 1);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('_remoteNil');
    });

    it('preserves tabs within the value field', () => {
      const payload = 'SomeGlobal\tArray\tvalue\twith\ttabs\n';
      const session = createMockSession(payload);

      const results = queries.getGlobalsForDictionary(session, 1);
      expect(results[0].value).toBe('value\twith\ttabs');
    });

    it('embeds the dictIndex in the Smalltalk code', () => {
      const session = createMockSession('');
      queries.getGlobalsForDictionary(session, 3);

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('symbolList at: 3');
    });
  });

  describe('searchMethodSource', () => {
    it('parses tab-separated method results', () => {
      const payload = 'Globals\tString\t0\tsubarray\taccessing\n';
      const session = createMockSession(payload);

      const results = queries.searchMethodSource(session, 'subarray', true);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'String',
        isMeta: false,
        selector: 'subarray',
        category: 'accessing',
        environmentId: 0,
      });
    });
  });

  describe('getMethodList', () => {
    it('parses instance and class methods with categories', () => {
      const payload = '0\taccessing\tname\n0\taccessing\tname:\n1\tinstance creation\tnew\n';
      const session = createMockSession(payload);

      const results = queries.getMethodList(session, 'Array');

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ isMeta: false, category: 'accessing', selector: 'name' });
      expect(results[1]).toEqual({ isMeta: false, category: 'accessing', selector: 'name:' });
      expect(results[2]).toEqual({ isMeta: true, category: 'instance creation', selector: 'new' });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.getMethodList(session, 'EmptyClass')).toEqual([]);
    });

    it('skips lines with fewer than 3 tab-separated fields', () => {
      const payload = 'incomplete\tonly\n0\taccessing\tsize\n';
      const session = createMockSession(payload);

      const results = queries.getMethodList(session, 'Array');
      expect(results).toHaveLength(1);
      expect(results[0].selector).toBe('size');
    });

    it('embeds the class name in the Smalltalk code', () => {
      const session = createMockSession('');
      queries.getMethodList(session, 'MyClass');

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('class := MyClass');
    });
  });

  describe('sessionNeedsCommit', () => {
    it('reports pending work when the image says a commit is needed', () => {
      const session = createMockSession('true');
      expect(queries.sessionNeedsCommit(session)).toBe(true);
    });

    it('reports a clean transaction when the image says no commit is needed', () => {
      const session = createMockSession('false');
      expect(queries.sessionNeedsCommit(session)).toBe(false);
    });

    it('tolerates surrounding whitespace in the reply', () => {
      const session = createMockSession('  true\n');
      expect(queries.sessionNeedsCommit(session)).toBe(true);
    });

    it('cannot tell when the reply is unrecognized', () => {
      const session = createMockSession('nil');
      expect(queries.sessionNeedsCommit(session)).toBeUndefined();
    });

    it('cannot tell when the session is busy with another operation', () => {
      const session = createMockSession('true');
      (session.gci.GciTsCallInProgress as ReturnType<typeof vi.fn>).mockReturnValue({ result: 1 });
      expect(queries.sessionNeedsCommit(session)).toBeUndefined();
    });

    it('asks the image via System needsCommit', () => {
      const session = createMockSession('false');

      queries.sessionNeedsCommit(session);

      const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
      expect(mockExec.mock.calls[0][1]).toContain('System needsCommit');
    });
  });
});
