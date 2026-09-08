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
  runTestMethodNb: vi.fn(() =>
    Promise.resolve({
      className: 'MyTestCase',
      selector: 'testAdd',
      status: 'passed',
      message: '',
      durationMs: 10,
    }),
  ),
  runTestClassNb: vi.fn(() =>
    Promise.resolve([
      {
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'passed',
        message: '',
        durationMs: 5,
      },
      {
        className: 'MyTestCase',
        selector: 'testRemove',
        status: 'failed',
        message: 'Expected true',
        durationMs: 3,
      },
    ]),
  ),
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

import { tests, window, commands, TestRunProfileKind } from '../__mocks__/vscode';
import { buildClassDefinitionUri, buildMethodUri } from '../gemstoneFileSystemProvider';
import { NbCancelledError } from '../nbRunner';
import { SunitTestController, SunitDebugOutcome } from '../sunitTestController';
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

      expect(sunit.runTestClassNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
        expect.any(Function),
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

      expect(sunit.runTestClassNb).toHaveBeenCalledTimes(2);
      expect(sunit.runTestClassNb).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
        expect.any(Function),
      );
      expect(sunit.runTestClassNb).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 1 }),
        'OtherTest',
        'UserGlobals',
        expect.any(Function),
      );
      ctrl.dispose();
    });

    it('does not run a same-named class from a different dictionary', async () => {
      // Default mock: MyTestCase is in UserGlobals, OtherTest in Globals.
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      // Ask for both names but scoped to UserGlobals — only MyTestCase matches.
      await ctrl.runClassesByName('UserGlobals', ['MyTestCase', 'OtherTest']);

      expect(sunit.runTestClassNb).toHaveBeenCalledTimes(1);
      expect(sunit.runTestClassNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'UserGlobals',
        expect.any(Function),
      );
      ctrl.dispose();
    });

    it('does not run tests for unknown class names, and says which it looked for', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassesByName('UserGlobals', ['NoSuchTest', 'AlsoMissing']);

      expect(sunit.runTestClassNb).not.toHaveBeenCalled();
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        ctrl.noTestsFoundErrorMessage('NoSuchTest, AlsoMissing'),
      );
      ctrl.dispose();
    });
  });

  describe('the "no tests found" message', () => {
    it('names what it looked for, so a test that will not run says which one', () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      expect(ctrl.noTestsFoundErrorMessage('MyTestCase>>testAdd')).toBe(
        'No tests found for MyTestCase>>testAdd',
      );
      ctrl.dispose();
    });

    it('stays bare when nothing named was being looked for', () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      expect(ctrl.noTestsFoundErrorMessage()).toBe('No tests found');
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

      expect(sunit.runTestMethodNb).toHaveBeenCalledTimes(1);
      expect(sunit.runTestMethodNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testAdd',
        'UserGlobals',
        expect.any(Function),
      );
    });

    it('runs a test method written after the class was already listed', async () => {
      // First run lists the class's methods as they stood then.
      await sunitTestController.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);
      vi.mocked(sunit.runTestMethodNb).mockClear();

      // The user writes another test and presses Run Test on it without refreshing.
      vi.mocked(sunit.discoverTestMethods).mockReturnValueOnce([
        { selector: 'testAdd', category: 'unit tests' },
        { selector: 'testRemove', category: 'unit tests' },
        { selector: 'testBrandNew', category: 'unit tests' },
      ]);

      await sunitTestController.runTestsByName('UserGlobals', 'MyTestCase', ['testBrandNew']);

      expect(window.showWarningMessage).not.toHaveBeenCalled();
      expect(sunit.runTestMethodNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testBrandNew',
        'UserGlobals',
        expect.any(Function),
      );
    });

    it('does not run tests when a class is not a test class', async () => {
      await sunitTestController.runTestsByName('UserGlobals', 'NoSuchClass', ['']);

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        sunitTestController.notATestClassErrorMessage('NoSuchClass'),
      );
      expect(sunit.runTestMethodNb).not.toHaveBeenCalled();
    });

    it('does not run tests when no tests methods were found', async () => {
      await sunitTestController.runTestsByName('UserGlobals', 'MyTestCase', ['noSuchSelector']);

      // The message names what was looked for — the point of it is telling a user whose new test
      // won't run WHICH selector the controller went hunting for.
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        sunitTestController.noTestsFoundErrorMessage('MyTestCase>>noSuchSelector'),
      );
      expect(sunit.runTestMethodNb).not.toHaveBeenCalled();
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

      expect(sunit.runTestMethodNb).toHaveBeenCalledTimes(2);
      expect(sunit.runTestMethodNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testAdd',
        'UserGlobals',
        expect.any(Function),
      );
      expect(sunit.runTestMethodNb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
        'testRemove',
        'UserGlobals',
        expect.any(Function),
      );
    });

    it('does not run tests when a class is not a test class', async () => {
      await ctrl.runMethodCategoryByName('UserGlobals', 'NoSuchClass', 'unit tests');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NoSuchClass'),
      );
      expect(sunit.runTestMethodNb).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('does not run tests when no tests methods were found', async () => {
      await ctrl.runMethodCategoryByName('UserGlobals', 'MyTestCase', 'non-existent category');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        ctrl.noTestsFoundErrorMessage("MyTestCase category 'non-existent category'"),
      );
      expect(sunit.runTestMethodNb).not.toHaveBeenCalled();
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
      const cancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      };

      // Run the UserGlobals copy — must resolve against UserGlobals, not the
      // symbol-list winner.
      await runHandler({ include: [userGlobals], exclude: undefined }, cancellationToken);
      expect(sunit.runTestClassNb).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        'AnnouncerTest',
        'UserGlobals',
        expect.any(Function),
      );

      // Run the Globals copy — must resolve against Globals.
      await runHandler({ include: [globals], exclude: undefined }, cancellationToken);
      expect(sunit.runTestClassNb).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        'AnnouncerTest',
        'Globals',
        expect.any(Function),
      );

      expect(sunit.runTestClassNb).toHaveBeenCalledTimes(2);
      ctrl.dispose();
    });
  });

  describe('result store', () => {
    // The tree rows, the code lenses and the Test Explorer all read the same
    // store, so what it holds after a run is what the user sees everywhere.
    async function runClass(ctrl: SunitTestController) {
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');
    }

    it('records each method outcome from a class run', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await runClass(ctrl);

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toMatchObject({
        outcome: 'passed',
        durationMs: 5,
      });
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toMatchObject({
        outcome: 'failed',
        message: 'Expected true',
      });
      ctrl.dispose();
    });

    it('records a passed/total roll-up on the class itself', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await runClass(ctrl);

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toMatchObject({
        outcome: 'failed',
        passedCount: 1,
        totalCount: 2,
      });
      ctrl.dispose();
    });

    it('stores no class roll-up when nothing ran, so an empty result is not a pass', async () => {
      // A class run where no selector matched (the stone answered nothing, or
      // the selectors moved under us) reports every method skipped. With
      // totalCount 0, passedCount === totalCount holds, which would otherwise
      // store the class as passed — a pass check over methods that never ran.
      vi.mocked(sunit.runTestClassNb).mockResolvedValueOnce([]);
      const ctrl = new SunitTestController(makeSessionManager(true));
      await runClass(ctrl);

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      ctrl.dispose();
    });

    it('records the outcome of a single-method run', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toMatchObject({
        outcome: 'passed',
        durationMs: 10,
      });
      ctrl.dispose();
    });

    it('publishes a running state before the outcome so the row can show a spinner', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const seen: (string | undefined)[] = [];
      ctrl.onDidChangeResults(() => {
        seen.push(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')?.outcome);
      });

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(seen[0]).toBe('running');
      expect(seen.at(-1)).toBe('passed');
      ctrl.dispose();
    });

    it('blanks a previous outcome before re-running, so a repeat run is visible', async () => {
      // Re-running a failing test that fails again would otherwise repaint the ✗
      // it was already showing, leaving no sign the run happened.
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);
      const seen: (string | undefined)[] = [];
      ctrl.onDidChangeResults(() => {
        seen.push(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')?.outcome);
      });

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(seen[0]).toBeUndefined();
      expect(seen).toContain('running');
      expect(seen.at(-1)).toBe('passed');
      ctrl.dispose();
    });

    it('batches the change event rather than firing per test', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      let fires = 0;
      ctrl.onDidChangeResults(() => {
        fires += 1;
      });

      await runClass(ctrl);

      // Once for "all running", once for the finished run — not once per test.
      expect(fires).toBe(2);
      ctrl.dispose();
    });

    it('drops every result when the session changes', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      await runClass(ctrl);

      const onSelectionChange = (sm.onDidChangeSelection as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as () => Promise<void>;
      await onSelectionChange();

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      ctrl.dispose();
    });
  });

  describe('invalidation when code is compiled', () => {
    it('drops the recompiled method and its class roll-up', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      ctrl.invalidateForMethod('UserGlobals', 'MyTestCase', 'testAdd');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      ctrl.dispose();
    });

    it('marks the results it keeps stale — they predate the edit', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      ctrl.invalidateForMethod('UserGlobals', 'MyTestCase', 'testAdd');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toMatchObject({
        outcome: 'failed',
        stale: true,
      });
      ctrl.dispose();
    });

    it('leaves other classes fresh — a method edit stales only its own class', async () => {
      // Saving one method used to grey every result in every dictionary. A test
      // in an unrelated class has no reason to doubt its outcome because this
      // method changed.
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');
      await ctrl.runClassByName('Globals', 'OtherTest');

      ctrl.invalidateForMethod('UserGlobals', 'MyTestCase', 'testAdd');

      // The edited class's sibling method is stale…
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toMatchObject({
        stale: true,
      });
      // …but the unrelated class keeps its outcomes, unstaled.
      expect(ctrl.resultFor('Globals', 'OtherTest', 'testAdd')?.stale).toBeUndefined();
      expect(ctrl.resultFor('Globals', 'OtherTest')?.stale).toBeUndefined();
      ctrl.dispose();
    });

    it('leaves other classes fresh when a class definition is recompiled', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');
      await ctrl.runClassByName('Globals', 'OtherTest');

      ctrl.invalidateForClass('UserGlobals', 'MyTestCase');

      expect(ctrl.resultFor('Globals', 'OtherTest', 'testAdd')?.stale).toBeUndefined();
      expect(ctrl.resultFor('Globals', 'OtherTest')?.stale).toBeUndefined();
      ctrl.dispose();
    });

    it('drops every result for a class whose definition was recompiled', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      ctrl.invalidateForClass('UserGlobals', 'MyTestCase');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toBeUndefined();
      ctrl.dispose();
    });

    it('fires a change event so the rows repaint', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      await ctrl.runClassByName('UserGlobals', 'MyTestCase');
      let fires = 0;
      ctrl.onDidChangeResults(() => {
        fires += 1;
      });

      ctrl.invalidateForMethod('UserGlobals', 'MyTestCase', 'testAdd');

      expect(fires).toBe(1);
      ctrl.dispose();
    });

    it('stays quiet when there is nothing to invalidate', () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      let fires = 0;
      ctrl.onDidChangeResults(() => {
        fires += 1;
      });

      ctrl.invalidateForMethod('UserGlobals', 'MyTestCase', 'testAdd');

      expect(fires).toBe(0);
      ctrl.dispose();
    });
  });

  describe('editor gutter wiring', () => {
    // VS Code matches a test item to an open editor by exact URI and draws the
    // run/status icon at the item's range. Both must therefore be the URI the
    // editor itself opens — including the ?dict=N scope — not a hand-built one.
    // Only this group cares about the dictionary index, and a persistent
    // mockReturnValue would leak into the other groups (tests are shuffled).
    function discoverWithDictIndex() {
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'MyTestCase', testCount: 2, dictIndex: 3 },
      ]);
    }

    it('points a class item at its class-definition document', async () => {
      discoverWithDictIndex();
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);

      const [, , uri] = (mockController.createTestItem as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(uri.toString()).toBe(
        'gemstone://1/UserGlobals/MyTestCase/definition/MyTestCase?dict%3D3',
      );
      ctrl.dispose();
    });

    it('points a method item at its method document', async () => {
      discoverWithDictIndex();
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      await mockController.resolveHandler(classItem);

      const methodCall = (
        mockController.createTestItem as ReturnType<typeof vi.fn>
      ).mock.calls.find((call: unknown[]) => call[1] === 'testAdd');
      expect(methodCall).toBeDefined();
      expect(methodCall![2].toString()).toBe(
        'gemstone://1/UserGlobals/MyTestCase/instance/unit%20tests/testAdd?dict%3D3',
      );
      ctrl.dispose();
    });

    it('gives class and method items a range, without which no icon is drawn', async () => {
      discoverWithDictIndex();
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      await mockController.resolveHandler(classItem);

      expect(classItem.range.start.line).toBe(0);
      const methodItems: { range: { start: { line: number } } }[] = [];
      classItem.children.forEach((child: { range: { start: { line: number } } }) =>
        methodItems.push(child),
      );
      expect(methodItems[0].range.start.line).toBe(0);
      ctrl.dispose();
    });
  });

  describe('debugging a test', () => {
    // The debugger needs the test to run WITHOUT SUnit's exception handler, so a
    // debug run can't go through runTestClass/runTestMethod. Everything else —
    // which items run, and where the outcome is recorded — must stay identical.
    function makeDebugExecutor(...outcomes: SunitDebugOutcome[]) {
      const queued = [...outcomes];
      const executeWithDebugger = vi.fn(
        async (_session: unknown, _code: string, _label: string): Promise<SunitDebugOutcome> =>
          queued.shift() ?? { raised: false },
      );
      return { executeWithDebugger };
    }

    it('offers a Debug profile alongside the Run profile', () => {
      const ctrl = new SunitTestController(makeSessionManager(true), makeDebugExecutor());
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      const kinds = (mockController.createRunProfile as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => call[1],
      );

      expect(kinds).toEqual([TestRunProfileKind.Run, TestRunProfileKind.Debug]);
      ctrl.dispose();
    });

    it('runs the test through the debug executor, not the ordinary run query', async () => {
      const debugExecutor = makeDebugExecutor();
      const ctrl = new SunitTestController(makeSessionManager(true), debugExecutor);

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd'], 'debug');

      expect(sunit.runTestMethodNb).not.toHaveBeenCalled();
      expect(debugExecutor.executeWithDebugger).toHaveBeenCalledOnce();
      const code = debugExecutor.executeWithDebugger.mock.calls[0][1];
      expect(code).toContain('MyTestCase');
      expect(code).toContain('testAdd');
      ctrl.dispose();
    });

    it('debugs a class one test at a time, not through the suite run', async () => {
      const debugExecutor = makeDebugExecutor();
      const ctrl = new SunitTestController(makeSessionManager(true), debugExecutor);

      await ctrl.runClassByName('UserGlobals', 'MyTestCase', 'debug');

      // runTestClass installs the handler that makes a failure undebuggable.
      expect(sunit.runTestClassNb).not.toHaveBeenCalled();
      expect(debugExecutor.executeWithDebugger).toHaveBeenCalledTimes(2);
      ctrl.dispose();
    });

    it('stops a class debug at the first test that raises', async () => {
      const debugExecutor = makeDebugExecutor({ raised: true, message: 'boom' });
      const ctrl = new SunitTestController(makeSessionManager(true), debugExecutor);

      await ctrl.runClassByName('UserGlobals', 'MyTestCase', 'debug');

      // A debugger now owns the suspended process; running the next test on top
      // of it would be nonsense.
      expect(debugExecutor.executeWithDebugger).toHaveBeenCalledOnce();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toMatchObject({
        outcome: 'error',
        message: 'boom',
      });
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toBeUndefined();
      ctrl.dispose();
    });

    it('records a debugged pass in the same store an ordinary run writes to', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true), makeDebugExecutor());

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd'], 'debug');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toMatchObject({
        outcome: 'passed',
      });
      ctrl.dispose();
    });

    it('leaves no duration on a debugged test — the elapsed time is stepping time', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true), makeDebugExecutor());

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd'], 'debug');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')?.durationMs).toBeUndefined();
      ctrl.dispose();
    });

    it('reports a cancelled debug run as skipped, not as a test error', async () => {
      // Cancelling a debug run (a soft or hard break) is the user's decision,
      // not a test failure — it must leave no verdict, like a stopped run,
      // rather than storing an error and blaming the test.
      const debugExecutor = makeDebugExecutor({ raised: false, cancelled: true });
      const ctrl = new SunitTestController(makeSessionManager(true), debugExecutor);

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd'], 'debug');

      expect(debugExecutor.executeWithDebugger).toHaveBeenCalledOnce();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      ctrl.dispose();
    });

    it('leaves no class verdict when a class debug is cancelled', async () => {
      // A cancel is not a raise: the class roll-up must not be stored as an
      // error (that path is for a genuine raise), and the run stops.
      const debugExecutor = makeDebugExecutor({ raised: false, cancelled: true });
      const ctrl = new SunitTestController(makeSessionManager(true), debugExecutor);

      await ctrl.runClassByName('UserGlobals', 'MyTestCase', 'debug');

      expect(debugExecutor.executeWithDebugger).toHaveBeenCalledOnce();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      ctrl.dispose();
    });
  });

  describe('resolving tests for an open document (gutter icons)', () => {
    // The URI is built with the same builder the editor opens with — a test that
    // hand-assembled it could pass while the real gutter stayed empty.
    const methodUri = (
      selector: string,
      className = 'MyTestCase',
      dictName = 'UserGlobals',
      sessionId = 1,
    ) =>
      buildMethodUri({
        kind: 'method',
        sessionId,
        dictName,
        className,
        isMeta: false,
        category: 'unit tests',
        selector,
        environmentId: 0,
      });

    async function discovered() {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      return { ctrl, mockController };
    }

    it("lists a test class's methods when one of them is opened", async () => {
      const { ctrl, mockController } = await discovered();
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      expect(classItem.children.size).toBe(0);

      await ctrl.ensureTestsForDocument(methodUri('testAdd'));

      // Without this the Testing view knows the class but not the method, and
      // VS Code has no item to hang a gutter icon on.
      expect(sunit.discoverTestMethods).toHaveBeenCalled();
      expect(classItem.children.size).toBe(2);
      ctrl.dispose();
    });

    it('does not re-resolve a class whose methods are already listed', async () => {
      const { ctrl, mockController } = await discovered();
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      await mockController.resolveHandler(classItem);
      (sunit.discoverTestMethods as ReturnType<typeof vi.fn>).mockClear();

      await ctrl.ensureTestsForDocument(methodUri('testAdd'));

      expect(sunit.discoverTestMethods).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('ignores a method of a class that is not a test class', async () => {
      const { ctrl } = await discovered();
      (sunit.discoverTestMethods as ReturnType<typeof vi.fn>).mockClear();

      await ctrl.ensureTestsForDocument(methodUri('doSomething', 'NotATest'));

      expect(sunit.discoverTestMethods).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('ignores a document belonging to another session', async () => {
      // Items are keyed by session; resolving this one would list the selected
      // stone's methods under a document from a different stone.
      const { ctrl } = await discovered();
      (sunit.discoverTestMethods as ReturnType<typeof vi.fn>).mockClear();

      await ctrl.ensureTestsForDocument(methodUri('testAdd', 'MyTestCase', 'UserGlobals', 2));

      expect(sunit.discoverTestMethods).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('ignores a document that is not a method — a class definition has its own item', async () => {
      const { ctrl } = await discovered();
      (sunit.discoverTestMethods as ReturnType<typeof vi.fn>).mockClear();

      await ctrl.ensureTestsForDocument(buildClassDefinitionUri(1, 'UserGlobals', 'MyTestCase'));
      await ctrl.ensureTestsForDocument(undefined);

      expect(sunit.discoverTestMethods).not.toHaveBeenCalled();
      ctrl.dispose();
    });
  });

  describe('naming a run', () => {
    // VS Code labels an unnamed run 'Test run at <timestamp>', which does not
    // say which tests ran.
    const runNameOf = (mockController: { createTestRun: ReturnType<typeof vi.fn> }) =>
      mockController.createTestRun.mock.calls.at(-1)?.[1];

    async function run(include?: unknown[]) {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      await runHandler(
        { include, exclude: undefined },
        { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
      );
      return { ctrl, mockController };
    }

    it('names a single-class run after the class', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');

      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      await runHandler(
        { include: [classItem], exclude: undefined },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => {} }),
        },
      );

      expect(runNameOf(mockController)).toBe('MyTestCase');
      ctrl.dispose();
    });

    it('names a single-method run Class>>selector', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      await mockController.resolveHandler(classItem);
      const methodItem = classItem.children.get('sunit/1/UserGlobals/MyTestCase/testAdd');

      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      await runHandler(
        { include: [methodItem], exclude: undefined },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => {} }),
        },
      );

      // The mock has no parent link, so the class name comes from the id.
      expect(runNameOf(mockController)).toBe('MyTestCase>>testAdd');
      ctrl.dispose();
    });

    it('names a run-everything after the number of classes', async () => {
      const { ctrl, mockController } = await run(undefined);

      expect(runNameOf(mockController)).toBe('2 test classes');
      ctrl.dispose();
    });
  });

  describe('stopping a run', () => {
    it('has nothing to stop when no run is in flight', () => {
      const ctrl = new SunitTestController(makeSessionManager(true));

      expect(ctrl.cancelActiveRun()).toBe(false);
      ctrl.dispose();
    });

    it('hands the run canceller out so a stop button can break the gem', async () => {
      // The query offers its canceller through onStart; the controller holds it for
      // as long as the call is in flight, and drops it when the call settles.
      let cancelled = false;
      const ctrl = new SunitTestController(makeSessionManager(true));
      const during: boolean[] = [];
      (sunit.runTestMethodNb as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_s, _c, _sel, _d, onStart?: (cancel: () => void) => void) => {
          onStart?.(() => {
            cancelled = true;
          });
          during.push(ctrl.cancelActiveRun());
          return Promise.resolve({
            className: 'MyTestCase',
            selector: 'testAdd',
            status: 'passed',
            message: '',
            durationMs: 1,
          });
        },
      );

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(during).toEqual([true]);
      expect(cancelled).toBe(true);
      // Settled, so there is nothing left to stop.
      expect(ctrl.cancelActiveRun()).toBe(false);
      ctrl.dispose();
    });

    it("breaks the gem when VS Code's own stop button cancels the run", async () => {
      // The Testing view's stop cancels the run profile's token. Nothing else
      // connects that to the gem, so if this wiring goes, the button goes quiet.
      let broke = false;
      let release: (() => void) | undefined;
      (sunit.runTestClassNb as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_s, _c, _d, onStart?: (cancel: () => void) => void) => {
          onStart?.(() => {
            broke = true;
          });
          return new Promise((resolve) => {
            release = () => resolve([]);
          });
        },
      );
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');

      let requestCancel: (() => void) | undefined;
      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      const running = runHandler(
        { include: [classItem], exclude: undefined },
        {
          isCancellationRequested: false,
          onCancellationRequested: (listener: () => void) => {
            requestCancel = listener;
            return { dispose: () => {} };
          },
        },
      );
      // Let the run reach the (pending) stone call before stopping it: markRunning
      // yields twice on its own (blank frame, then spinner) before the call starts.
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));

      expect(requestCancel).toBeDefined();
      requestCancel!();

      expect(broke).toBe(true);
      release?.();
      await running;
      ctrl.dispose();
    });

    it('leaves no verdict on a test whose run was stopped', async () => {
      // Reporting "error" would blame the test for the user's decision to stop.
      (sunit.runTestMethodNb as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new NbCancelledError('Execution cancelled.'),
      );
      const ctrl = new SunitTestController(makeSessionManager(true));

      await ctrl.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd']);

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      ctrl.dispose();
    });

    it('leaves no verdict on any test of a class run that was stopped', async () => {
      (sunit.runTestClassNb as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new NbCancelledError('Execution cancelled.'),
      );
      const ctrl = new SunitTestController(makeSessionManager(true));

      await ctrl.runClassByName('UserGlobals', 'MyTestCase');

      expect(ctrl.resultFor('UserGlobals', 'MyTestCase')).toBeUndefined();
      expect(ctrl.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
      ctrl.dispose();
    });
  });

  describe('a test class with no tests', () => {
    it('is not offered as runnable — a run would do nothing', async () => {
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'AbstractBase', testCount: 0 },
        { dictName: 'UserGlobals', className: 'MyTestCase', testCount: 2 },
      ]);
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);

      expect(ctrl.isTestClass('UserGlobals', 'AbstractBase')).toBe(false);
      expect(ctrl.isTestClass('UserGlobals', 'MyTestCase')).toBe(true);
      ctrl.dispose();
    });

    it('stays runnable when the stone gave no usable count', async () => {
      // Better a button that reports "no tests found" than one silently missing.
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'MyTestCase', testCount: null },
      ]);
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);

      expect(ctrl.isTestClass('UserGlobals', 'MyTestCase')).toBe(true);
      ctrl.dispose();
    });
  });

  describe('isTestItemUri', () => {
    it('recognises the documents its items point at, and nothing else', async () => {
      // The Explorer uses this to tell a Testing view row click (which it must not
      // follow) from any other open (which it must).
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const classItem = mockController.items.get('sunit/1/UserGlobals/MyTestCase');
      const methodUri = buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'UserGlobals',
        className: 'MyTestCase',
        isMeta: false,
        category: 'unit tests',
        selector: 'testAdd',
        environmentId: 0,
      });

      expect(ctrl.isTestItemUri(buildClassDefinitionUri(1, 'UserGlobals', 'MyTestCase'))).toBe(
        true,
      );
      // A method only counts once its item exists.
      expect(ctrl.isTestItemUri(methodUri)).toBe(false);
      await mockController.resolveHandler(classItem);
      expect(ctrl.isTestItemUri(methodUri)).toBe(true);

      expect(ctrl.isTestItemUri(buildClassDefinitionUri(1, 'UserGlobals', 'NotATest'))).toBe(false);
      ctrl.dispose();
    });

    it('forgets the URIs of items a rediscovery replaced', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const gone = buildClassDefinitionUri(1, 'UserGlobals', 'MyTestCase');
      expect(ctrl.isTestItemUri(gone)).toBe(true);

      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { dictName: 'UserGlobals', className: 'SomethingElseTest', testCount: 1 },
      ]);
      await mockController.refreshHandler();

      expect(ctrl.isTestItemUri(gone)).toBe(false);
      ctrl.dispose();
    });
  });

  describe('the test-running context key', () => {
    it('is set for the life of a run, and cleared when it ends', async () => {
      // Drives the ■ on the Testing view's rows; VS Code has no per-item key, so a
      // stuck `true` would leave a stop button on every row for good.
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      vi.mocked(commands.executeCommand).mockClear();

      await runHandler(
        { include: undefined, exclude: undefined },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => {} }),
        },
      );

      const contextCalls = vi
        .mocked(commands.executeCommand)
        .mock.calls.filter((c) => c[0] === 'setContext' && c[1] === 'gemstone.testRunning')
        .map((c) => c[2]);
      expect(contextCalls).toEqual([true, false]);
      ctrl.dispose();
    });

    it('is cleared even when the run throws', async () => {
      (sunit.runTestClassNb as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('stone exploded'),
      );
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);
      const runHandler = mockController.createRunProfile.mock.calls[0][2];
      vi.mocked(commands.executeCommand).mockClear();

      await runHandler(
        { include: undefined, exclude: undefined },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => {} }),
        },
      );

      expect(
        vi
          .mocked(commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'setContext' && c[1] === 'gemstone.testRunning')
          .map((c) => c[2]),
      ).toEqual([true, false]);
      ctrl.dispose();
    });
  });

  describe('revealInTestExplorer', () => {
    it('reveals a discovered test class', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);

      await expect(ctrl.revealInTestExplorer('UserGlobals', 'MyTestCase')).resolves.toBe(true);
      // The view has to be showing before the reveal, or it scrolls something
      // nobody can see.
      expect(commands.executeCommand).toHaveBeenNthCalledWith(1, 'workbench.view.testing.focus');
      expect(commands.executeCommand).toHaveBeenNthCalledWith(
        2,
        'vscode.revealTestInExplorer',
        expect.objectContaining({ id: 'sunit/1/UserGlobals/MyTestCase' }),
      );
      ctrl.dispose();
    });

    it("lists a class's methods on demand so one can be revealed", async () => {
      // Methods are discovered lazily; wanting to reveal one is a reason to have it.
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);

      await expect(ctrl.revealInTestExplorer('UserGlobals', 'MyTestCase', 'testAdd')).resolves.toBe(
        true,
      );
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'vscode.revealTestInExplorer',
        expect.objectContaining({ id: 'sunit/1/UserGlobals/MyTestCase/testAdd' }),
      );
      ctrl.dispose();
    });

    it('answers false when there is nothing to reveal', async () => {
      const ctrl = new SunitTestController(makeSessionManager(true));
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      await mockController.resolveHandler(undefined);

      await expect(ctrl.revealInTestExplorer('UserGlobals', 'NotATest')).resolves.toBe(false);
      await expect(
        ctrl.revealInTestExplorer('UserGlobals', 'MyTestCase', 'notATest'),
      ).resolves.toBe(false);
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
