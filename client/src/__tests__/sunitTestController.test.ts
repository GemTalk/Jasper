import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../sunitQueries', () => ({
  discoverTestClasses: vi.fn(() => [
    { dictName: 'UserGlobals', className: 'MyTestCase', testCount: 2 },
    { dictName: 'Globals', className: 'OtherTest', testCount: 3 },
  ]),
  discoverTestMethods: vi.fn(() => [
    { selector: 'testAdd', category: 'unit tests' },
    { selector: 'testRemove', category: 'unit tests' },
  ]),
  runTestMethod: vi.fn(() => ({
    className: 'MyTestCase',
    selector: 'testAdd',
    status: 'passed',
    message: '',
    durationMs: 10,
  })),
  runTestClass: vi.fn(() => [
    { className: 'MyTestCase', selector: 'testAdd', status: 'passed', message: '', durationMs: 5 },
    {
      className: 'MyTestCase',
      selector: 'testRemove',
      status: 'failed',
      message: 'Expected true',
      durationMs: 3,
    },
  ]),
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
}));

import { tests, window } from '../__mocks__/vscode';
import { SunitTestController } from '../sunitTestController';
import { SessionManager } from '../sessionManager';
import * as sunit from '../sunitQueries';

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined,
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('SunitTestController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a TestController on construction', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    expect(tests.createTestController).toHaveBeenCalledWith(
      'gemstone-sunit',
      'GemStone SUnit Tests',
    );
    ctrl.dispose();
  });

  it('creates a Run profile', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0]
      .value;
    expect(mockController.createRunProfile).toHaveBeenCalledOnce();
    ctrl.dispose();
  });

  it('listens for session changes', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    expect(sm.onDidChangeSelection).toHaveBeenCalledOnce();
    ctrl.dispose();
  });

  describe('discovery via resolveHandler', () => {
    it('discovers test classes when resolveHandler is called with no item', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // Call resolveHandler at root level
      await mockController.resolveHandler(undefined);

      expect(sunit.discoverTestClasses).toHaveBeenCalledOnce();
      expect(mockController.createTestItem).toHaveBeenCalledTimes(2);
      ctrl.dispose();
    });

    it('gives same-named classes in different dictionaries distinct, dict-qualified ids', async () => {
      // The original crash: two distinct AnnouncerTest classes collapse to one
      // name-only id `sunit/1/AnnouncerTest` and items.replace() throws. With
      // dict-qualified ids they coexist as two items.
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'AnnouncerTest', testCount: 7 },
        { dictName: 'Globals', className: 'AnnouncerTest', testCount: 19 },
      ]);
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      expect(mockController.items.size).toBe(2);
      const userGlobals = mockController.items.get('sunit/1/UserGlobals/AnnouncerTest');
      const globals = mockController.items.get('sunit/1/Globals/AnnouncerTest');
      expect(userGlobals).toBeDefined();
      expect(globals).toBeDefined();
      // Ambiguous names are qualified with the dictionary in braces in the
      // label (so the Test Results tab can disambiguate). The dictionary is
      // never in the description — that's just the count.
      expect(userGlobals.label).toBe('AnnouncerTest {UserGlobals}');
      expect(globals.label).toBe('AnnouncerTest {Globals}');
      expect(userGlobals.description).toBe('(7)');
      expect(globals.description).toBe('(19)');
      expect(window.showErrorMessage).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('leaves unique class names unqualified, with only the count in the description', async () => {
      // Default mock: MyTestCase (UserGlobals) and OtherTest (Globals) are
      // both unique names — no brace qualifier, no dictionary anywhere.
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      const my = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      expect(my.label).toBe('MyTestCase');
      expect(my.description).toBe('(2)');
      ctrl.dispose();
    });

    it('shows (?) in the description when the test count is unknown', async () => {
      // A null testCount means the stone returned an unparseable value; the
      // description must say it's unknown rather than fake a "(0)".
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'WeirdTest', testCount: null },
      ]);
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      const weird = mockController.items.get('sunit/1/UserGlobals/WeirdTest');
      expect(weird.description).toBe('(?)');
      expect(weird.label).toBe('WeirdTest');
      ctrl.dispose();
    });

    it('returns empty when no session is active', async () => {
      const sm = makeSessionManager(false);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      expect(sunit.discoverTestClasses).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('discovers test methods when resolveHandler is called with a class item', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // First discover classes
      await mockController.resolveHandler(undefined);

      // Get first class item and resolve its children
      const classItem = mockController.createTestItem.mock.results[0].value;
      await mockController.resolveHandler(classItem);

      expect(sunit.discoverTestMethods).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
      );
      ctrl.dispose();
    });

    it('shows error message when discovery fails', async () => {
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('TestCase not found');
      });

      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('TestCase not found'),
      );
      ctrl.dispose();
    });
  });

  describe('refresh', () => {
    it('clears items on refresh', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // Discover first
      await mockController.resolveHandler(undefined);

      // Items were populated
      expect(mockController.items.size).toBe(2);

      // Refresh clears them
      ctrl.refresh();
      expect(mockController.items.size).toBe(0);

      ctrl.dispose();
    });
  });

  describe('session change', () => {
    it('re-discovers tests when session changes', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // Discover
      await mockController.resolveHandler(undefined);
      expect(mockController.items.size).toBe(2);
      expect(sunit.discoverTestClasses).toHaveBeenCalledTimes(1);

      // Simulate session change — should clear and re-discover
      const listener = (sm.onDidChangeSelection as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await listener(2);

      expect(sunit.discoverTestClasses).toHaveBeenCalledTimes(2);
      expect(mockController.items.size).toBe(2);
      ctrl.dispose();
    });
  });

  describe('runClassByName', () => {
    it('runs tests for a discovered class', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // Discover
      await mockController.resolveHandler(undefined);

      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      expect(sunit.runTestClass).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
      );
      ctrl.dispose();
    });

    it('shows warning when class is not a TestCase subclass', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassByName('UserGlobals', 'NotATestClass');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NotATestClass'),
      );
      ctrl.dispose();
    });

    it('shows error when no session', async () => {
      const sm = makeSessionManager(false);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      expect(window.showErrorMessage).toHaveBeenCalledWith('No active GemStone session.');
      ctrl.dispose();
    });
  });

  describe('runClassesByName', () => {
    it('runs all provided classes in one dictionary in a single test run', async () => {
      // Both classes live in the same dictionary (a category/dictionary run is
      // always scoped to one dictionary).
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'MyTestCase', testCount: 2 },
        { dictName: 'UserGlobals', className: 'OtherTest', testCount: 3 },
      ]);
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassesByName('UserGlobals', ['MyTestCase', 'OtherTest']);

      expect(sunit.runTestClass).toHaveBeenCalledTimes(2);
      expect(sunit.runTestClass).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
      );
      expect(sunit.runTestClass).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 1 }),
        'OtherTest',
        'UserGlobals',
      );
      ctrl.dispose();
    });

    it('does not run a same-named class from a different dictionary', async () => {
      // Default mock: MyTestCase is in UserGlobals, OtherTest in Globals.
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      // Ask for both names but scoped to UserGlobals — only MyTestCase matches.
      await ctrl.runClassesByName('UserGlobals', ['MyTestCase', 'OtherTest']);

      expect(sunit.runTestClass).toHaveBeenCalledTimes(1);
      expect(sunit.runTestClass).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
      );
      ctrl.dispose();
    });

    it('does not run tests for unknown class names', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassesByName('UserGlobals', ['NoSuchTest']);

      expect(sunit.runTestClass).not.toHaveBeenCalled();
      ctrl.dispose();
    });
  });

  describe('runTestsByName', () => {
    let sunitTestController: SunitTestController;

    beforeEach(() => {
      const sm = makeSessionManager(true);
      sunitTestController = new SunitTestController(sm);
    });

    afterEach(() => {
      sunitTestController.dispose();
    });

    it('runs a single test', async () => {
      await sunitTestController.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(sunit.runTestMethod).toHaveBeenCalledTimes(1);
      expect(sunit.runTestMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testAdd',
        'UserGlobals',
      );
    });

    it('does not run tests when a class is not a test class', async () => {
      await sunitTestController.runTestsByName('UserGlobals', 'NoSuchClass', ['']);

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        sunitTestController.notATestClassErrorMessage('NoSuchClass'),
      );
      expect(sunit.runTestMethod).not.toHaveBeenCalled();
    });

    it('does not run tests when no tests methods were found', async () => {
      await sunitTestController.runTestsByName('UserGlobals', 'MyTestCase', ['noSuchSelector']);

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        sunitTestController.noTestsFoundErrorMessage(),
      );
      expect(sunit.runTestMethod).not.toHaveBeenCalled();
    });
  });

  describe('runMethodCategoryByName', () => {
    let ctrl: SunitTestController;

    beforeEach(() => {
      const sm = makeSessionManager(true);
      ctrl = new SunitTestController(sm);
    });

    afterEach(() => {
      ctrl.dispose();
    });

    it('runs all methods in the given category', async () => {
      // 'testAdd' and 'testRemove' are both in 'unit tests' per the mock
      await ctrl.runMethodCategoryByName('UserGlobals', 'MyTestCase', 'unit tests');

      expect(sunit.runTestMethod).toHaveBeenCalledTimes(2);
      expect(sunit.runTestMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testAdd',
        'UserGlobals',
      );
      expect(sunit.runTestMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testRemove',
        'UserGlobals',
      );
    });

    it('does not run tests when a class is not a test class', async () => {
      await ctrl.runMethodCategoryByName('UserGlobals', 'NoSuchClass', 'unit tests');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NoSuchClass'),
      );
      expect(sunit.runTestMethod).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('does not run tests when no tests methods were found', async () => {
      await ctrl.runMethodCategoryByName('UserGlobals', 'MyTestCase', 'non-existent category');

      expect(window.showWarningMessage).toHaveBeenCalledWith(ctrl.noTestsFoundErrorMessage());
      expect(sunit.runTestMethod).not.toHaveBeenCalled();
      ctrl.dispose();
    });
  });

  describe('running an ambiguous class from the Test Explorer', () => {
    it('routes each same-named class to its own dictionary', async () => {
      // Two distinct AnnouncerTest classes, one per dictionary.
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'AnnouncerTest', testCount: 7 },
        { dictName: 'Globals', className: 'AnnouncerTest', testCount: 19 },
      ]);
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      // Discover both copies.
      await mockController.resolveHandler(undefined);
      const userGlobals = mockController.items.get('sunit/1/UserGlobals/AnnouncerTest');
      const globals = mockController.items.get('sunit/1/Globals/AnnouncerTest');

      // The Run profile is created as createRunProfile(name, kind, handler, isDefault);
      // grab the handler the Test Explorer invokes when you click "Run".
      const runHandler = (mockController.createRunProfile as ReturnType<typeof vi.fn>).mock
        .calls[0][2];
      const cancellationToken = { isCancellationRequested: false };

      // Run the UserGlobals copy — must resolve against UserGlobals, not the
      // symbol-list winner.
      await runHandler({ include: [userGlobals], exclude: undefined }, cancellationToken);
      expect(sunit.runTestClass).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        'AnnouncerTest',
        'UserGlobals',
      );

      // Run the Globals copy — must resolve against Globals.
      await runHandler({ include: [globals], exclude: undefined }, cancellationToken);
      expect(sunit.runTestClass).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        'AnnouncerTest',
        'Globals',
      );

      expect(sunit.runTestClass).toHaveBeenCalledTimes(2);
      ctrl.dispose();
    });
  });

  describe('dispose', () => {
    it('disposes the controller', () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      ctrl.dispose();

      expect(mockController.dispose).toHaveBeenCalledOnce();
    });
  });
});
