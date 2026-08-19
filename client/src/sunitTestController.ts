import type { TestItem } from 'vscode';
import * as vscode from 'vscode';
import { buildClassDefinitionUri, buildMethodUri } from './gemstoneFileSystemProvider';
import { debugTestMethodCode } from './queries/debugTestMethod';
import { ActiveSession, SessionManager } from './sessionManager';
import * as sunit from './sunitQueries';

/**
 * Test item ID scheme (dictionary-qualified — the same class name can exist
 * in two dictionaries as two genuinely different test suites, so the
 * dictionary is part of every id and is always known before a test runs):
 *   Class:  sunit/<sessionId>/<dictName>/<className>
 *   Method: sunit/<sessionId>/<dictName>/<className>/<selector>
 *
 * These three functions are the single source of truth for that layout — build
 * ids only via make*Id and read them only via parseTestId, so the segment
 * offsets live in one place. (Segments are raw, not encoded: GemStone
 * dictionary names, class names, and test selectors cannot contain '/'.)
 */
function makeClassId(sessionId: number, dictName: string, className: string): string {
  return `sunit/${sessionId}/${dictName}/${className}`;
}

function makeMethodId(
  sessionId: number,
  dictName: string,
  className: string,
  selector: string,
): string {
  return `${makeClassId(sessionId, dictName, className)}/${selector}`;
}

interface ParsedTestId {
  dictName: string;
  className: string;
  /** undefined for a class id; present for a method id. */
  selector?: string;
}

function parseTestId(id: string): ParsedTestId {
  const [, , dictName, className, selector] = id.split('/');
  return { dictName, className, selector };
}

/**
 * How a test was launched. Everything above the innermost "execute one test"
 * step is shared between the two — discovery, id parsing, reporting, and the
 * result store all behave identically, so a debugged test lights up the same
 * places a run one does.
 */
export type SunitRunKind = 'run' | 'debug';

/**
 * What the controller needs in order to run one test under the GemStone
 * debugger. Narrower than the whole code executor on purpose: the two share the
 * one debug-enabled execution path (suspend on error, hand the process to a
 * debugger) without the controller depending on the rest of it.
 */
export interface SunitDebugExecutor {
  executeWithDebugger(
    session: ActiveSession,
    code: string,
    label: string,
  ): Promise<SunitDebugOutcome>;
}

/** What became of one test run under the debugger. */
export interface SunitDebugOutcome {
  /** True when the test raised and the suspended process went to a debugger. */
  raised: boolean;
  /** The GemStone error message, when it raised. */
  message?: string;
}

/** State of the most recent run of one test class or test method. */
export type SunitOutcome = 'running' | 'passed' | 'failed' | 'error';

/**
 * The last-known outcome of a class or method, kept so the tree rows, code
 * lenses, and anything else outside the Test Explorer can show it. Written in
 * exactly one place (`setResult`, reached only from `reportOutcome`), so every
 * entry point — Explorer button, gutter, code lens, Test Explorer — produces
 * the same indicator.
 */
export interface SunitResult {
  outcome: SunitOutcome;
  /** One-line failure/error text. Empty for a pass. */
  message?: string;
  /** Elapsed time as measured on the stone. Absent when it wasn't measured. */
  durationMs?: number;
  /** Class rows only: how many of the class's tests passed, out of how many. */
  passedCount?: number;
  totalCount?: number;
  /**
   * True once code has been compiled since this result was produced, so the
   * outcome may no longer describe the code in the stone. Stale results are
   * shown dimmed rather than dropped — "this was green before your edit" is
   * more useful than a blank row, as long as it doesn't masquerade as current.
   */
  stale?: boolean;
}

/** Key into the result store. Session-scoped implicitly: the store is cleared
 * whenever the selected session changes, so ids need no session segment. */
function resultKey(dictName: string, className: string, selector?: string): string {
  return selector === undefined
    ? `${dictName}/${className}`
    : `${dictName}/${className}/${selector}`;
}

/** Test items are one-method (or one class-definition) documents, so the run
 * icon always belongs on the first line. */
function topOfDocument(): vscode.Range {
  return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
}

/**
 * Integrates GemStone SUnit tests with VS Code's Test Explorer.
 */
export class SunitTestController implements vscode.Disposable {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];

  /** category cache populated during method discovery, keyed by dictName/className/selector */
  private methodCategory = new Map<string, string>();

  /** SymbolList index per class item id, captured at discovery — needed to
   * build `?dict=N` URIs that match the documents the editor actually opens. */
  private classDictIndex = new Map<string, number | undefined>();

  /** Last-known outcome per class/method. See SunitResult. */
  private results = new Map<string, SunitResult>();
  private resultsDirty = false;

  private _onDidChangeResults = new vscode.EventEmitter<void>();
  /**
   * Fires when one or more stored results changed. Batched: a class run of
   * fourteen tests fires twice (all-running, then all-done), not twenty-eight
   * times, so a listening tree view refreshes twice too.
   */
  readonly onDidChangeResults = this._onDidChangeResults.event;

  constructor(
    private sessionManager: SessionManager,
    /**
     * Absent only where nothing can be debugged anyway (tests of the run path).
     * The extension always supplies one, so the Debug profile is always there
     * for a user.
     */
    private debugExecutor?: SunitDebugExecutor,
  ) {
    this.controller = vscode.tests.createTestController('gemstone-sunit', 'GemStone SUnit Tests');

    this.controller.resolveHandler = async (item) => {
      if (!item) {
        await this.discoverTests();
      } else {
        await this.resolveTestMethods(item);
      }
    };

    this.controller.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runTests(request, token),
      true,
    );

    if (this.debugExecutor) {
      this.controller.createRunProfile(
        'Debug Tests',
        vscode.TestRunProfileKind.Debug,
        (request, token) => this.runTests(request, token, 'debug'),
        true,
      );
    }

    this.controller.refreshHandler = async () => {
      this.resetDiscovery();
      await this.discoverTests();
    };

    this.disposables.push(
      sessionManager.onDidChangeSelection(async () => {
        // Results belong to the stone they ran against, so a different session
        // means every stored outcome is meaningless, not merely stale.
        this.clearResults();
        this.resetDiscovery();
        await this.discoverTests();
      }),
    );
  }

  dispose(): void {
    this.controller.dispose();
    this._onDidChangeResults.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** Clear items and let resolveHandler re-discover on next view. */
  refresh(): void {
    this.resetDiscovery();
  }

  private resetDiscovery(): void {
    this.methodCategory.clear();
    this.classDictIndex.clear();
    this.controller.items.replace([]);
  }

  // ── Result store ───────────────────────────────────────────

  /**
   * The last-known outcome for a class (omit `selector`) or one of its test
   * methods, or undefined if it hasn't run since the last invalidation.
   */
  resultFor(dictName: string, className: string, selector?: string): SunitResult | undefined {
    return this.results.get(resultKey(dictName, className, selector));
  }

  private setResult(
    dictName: string,
    className: string,
    selector: string | undefined,
    result: SunitResult,
  ): void {
    this.results.set(resultKey(dictName, className, selector), result);
    this.resultsDirty = true;
  }

  private flushResultChanges(): void {
    if (!this.resultsDirty) return;
    this.resultsDirty = false;
    this._onDidChangeResults.fire();
  }

  /** Drop every stored result (e.g. the session changed underneath them). */
  clearResults(): void {
    if (this.results.size > 0) {
      this.results.clear();
      this.resultsDirty = true;
    }
    this.flushResultChanges();
  }

  /**
   * A method was recompiled: its own result and its class's roll-up no longer
   * describe what is in the stone, so they go. Everything else is marked stale
   * rather than dropped — recompiling any method can change what any test does,
   * but only the edited one is known to be wrong.
   */
  invalidateForMethod(dictName: string, className: string, selector: string): void {
    this.deleteResult(dictName, className, selector);
    this.deleteResult(dictName, className);
    this.markRemainingStale();
    this.flushResultChanges();
  }

  /**
   * A class definition was recompiled: every result for that class goes (its
   * methods may not even exist any more), and the rest go stale.
   */
  invalidateForClass(dictName: string, className: string): void {
    const classPrefix = `${resultKey(dictName, className)}/`;
    const classOwn = resultKey(dictName, className);
    for (const key of [...this.results.keys()]) {
      if (key === classOwn || key.startsWith(classPrefix)) {
        this.results.delete(key);
        this.resultsDirty = true;
      }
    }
    this.markRemainingStale();
    this.flushResultChanges();
  }

  private deleteResult(dictName: string, className: string, selector?: string): void {
    if (this.results.delete(resultKey(dictName, className, selector))) this.resultsDirty = true;
  }

  /** Mark every settled result stale. A running test is left alone — it is
   * about to be overwritten with a fresh outcome anyway. */
  private markRemainingStale(): void {
    for (const [key, result] of this.results) {
      if (result.stale || result.outcome === 'running') continue;
      this.results.set(key, { ...result, stale: true });
      this.resultsDirty = true;
    }
  }

  // ── Named entry points (Explorer rows, browser menus, code lenses) ──

  /** Run all tests in a named class. */
  async runClassByName(
    dictName: string,
    className: string,
    kind: SunitRunKind = 'run',
  ): Promise<void> {
    const classItem = await this.ensureClassItem(dictName, className);
    if (!classItem) return;
    await this.runTestItems([classItem], kind);
  }

  /**
   * Run all tests in the provided class names, all within one dictionary,
   * using a single TestRun.
   */
  async runClassesByName(
    dictName: string,
    classNames: string[],
    kind: SunitRunKind = 'run',
  ): Promise<void> {
    if (!this.requireSession()) return;
    await this.discoverTests();
    const classItems: TestItem[] = this.itemsForClasses(dictName, classNames);

    await this.runTestItems(classItems, kind);
  }

  /** Run all test methods in a method category from browser context menus. */
  async runMethodCategoryByName(
    dictName: string,
    className: string,
    category: string,
    kind: SunitRunKind = 'run',
  ): Promise<void> {
    const classItem = await this.ensureClassItem(dictName, className);
    if (!classItem) return;

    const methodItems: TestItem[] = [];
    classItem.children.forEach((child) => {
      if (this.methodCategory.get(`${dictName}/${className}/${child.label}`) === category) {
        methodItems.push(child);
      }
    });

    await this.runTestItems(methodItems, kind);
  }

  /** Run named test methods of one class. */
  async runTestsByName(
    dictName: string,
    className: string,
    selectors: string[],
    kind: SunitRunKind = 'run',
  ): Promise<void> {
    const classItem = await this.ensureClassItem(dictName, className);
    if (!classItem) return;

    const methodItems = selectors
      .map((selector) => this.itemForMethodNamed(classItem, selector))
      .filter((result) => result !== undefined);

    await this.runTestItems(methodItems, kind);
  }

  /**
   * The class item for a named class, with its methods resolved — discovering
   * first if it isn't known yet. Reports to the user and answers undefined when
   * the class isn't a test class, so every named entry point above fails the
   * same way.
   */
  private async ensureClassItem(
    dictName: string,
    className: string,
  ): Promise<TestItem | undefined> {
    if (!this.requireSession()) return undefined;

    let classItem = this.findClassItem(dictName, className);
    if (!classItem) {
      await this.discoverTests();
      classItem = this.findClassItem(dictName, className);
    }

    if (!classItem) {
      vscode.window.showWarningMessage(this.notATestClassErrorMessage(className));
      return undefined;
    }

    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    return classItem;
  }

  /**
   * The selected session, or undefined after telling the user there isn't one.
   * Checked before anything else so a logged-out user is told that, rather than
   * that their class "is not a test class" — which is what an empty discovery
   * would otherwise look like.
   */
  private requireSession(): ActiveSession | undefined {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return undefined;
    }
    return session;
  }

  public notATestClassErrorMessage(className: string) {
    return `${className} is not a test class.`;
  }

  public noTestsFoundErrorMessage() {
    return `No tests found`;
  }

  // ── Discovery ──────────────────────────────────────────────

  private async discoverTests(): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    try {
      const classes = sunit.discoverTestClasses(session);
      const items: vscode.TestItem[] = [];

      // A class name is ambiguous when it exists in more than one dictionary.
      // Only then do we qualify the label with the dictionary — the Test
      // Results tab renders only labels (not the dimmed description), so this
      // is the one place the dictionary can disambiguate same-named classes
      // there. Unique names stay clean.
      const nameCounts = new Map<string, number>();
      for (const cls of classes) {
        nameCounts.set(cls.className, (nameCounts.get(cls.className) ?? 0) + 1);
      }

      for (const cls of classes) {
        const ambiguous = (nameCounts.get(cls.className) ?? 0) > 1;
        const label = ambiguous ? `${cls.className} {${cls.dictName}}` : cls.className;

        const id = makeClassId(session.id, cls.dictName, cls.className);
        const classItem = this.controller.createTestItem(
          id,
          label,
          this.classDefinitionUri(session.id, cls.dictName, cls.className, cls.dictIndex),
        );
        classItem.canResolveChildren = true;
        // A range is what puts the run/status icon in the editor gutter. The
        // class definition is its own document, so line 1 is the definition
        // itself.
        classItem.range = topOfDocument();
        // Dimmed qualifier (sidebar only): test count. The dictionary never
        // goes here — it lives in the label, and only when the name is
        // ambiguous. A null count means the stone returned an unparseable
        // value; show "(?)" rather than a misleading "(0)".
        classItem.description = cls.testCount === null ? '(?)' : `(${cls.testCount})`;
        this.classDictIndex.set(id, cls.dictIndex);
        items.push(classItem);
      }

      this.controller.items.replace(items);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`SUnit discovery failed: ${msg}`);
    }
  }

  private async resolveTestMethods(classItem: vscode.TestItem): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    // dictName and className come from the class item's own id, so the
    // methods are discovered from the exact class the user is looking at (not
    // a same-named class in another dictionary). The label is NOT the class
    // name — for ambiguous names it carries a " {Dict}" suffix.
    const { dictName, className } = parseTestId(classItem.id);
    const dictIndex = this.classDictIndex.get(classItem.id);

    try {
      const methods = sunit.discoverTestMethods(session, className, dictName);
      const children: vscode.TestItem[] = [];

      for (const { selector, category } of methods) {
        this.methodCategory.set(`${dictName}/${className}/${selector}`, category);

        const methodItem = this.controller.createTestItem(
          makeMethodId(session.id, dictName, className, selector),
          selector,
          this.methodUri(session.id, dictName, className, category, selector, dictIndex),
        );
        // Gutter icon on line 1 of the method's own document (see above).
        methodItem.range = topOfDocument();
        children.push(methodItem);
      }

      classItem.children.replace(children);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      classItem.error = new vscode.MarkdownString(`Discovery failed: ${msg}`);
    }
  }

  /**
   * The URIs below must be built with the same builders the editor uses, not
   * assembled by hand: VS Code matches a test item to an open document by exact
   * URI, so a differing query string or a hand-encoded segment silently costs
   * the gutter icon. A malformed name (a category containing '/', say) makes the
   * builder throw — answer undefined rather than lose the whole discovery pass;
   * the item still works everywhere except the gutter.
   */
  private classDefinitionUri(
    sessionId: number,
    dictName: string,
    className: string,
    dictIndex: number | undefined,
  ): vscode.Uri | undefined {
    try {
      return buildClassDefinitionUri(sessionId, dictName, className, dictIndex);
    } catch {
      return undefined;
    }
  }

  private methodUri(
    sessionId: number,
    dictName: string,
    className: string,
    category: string,
    selector: string,
    dictIndex: number | undefined,
  ): vscode.Uri | undefined {
    try {
      return buildMethodUri({
        kind: 'method',
        sessionId,
        dictName,
        className,
        isMeta: false,
        category: category || 'as yet unclassified',
        selector,
        environmentId: 0,
        dictIndex,
      });
    } catch {
      return undefined;
    }
  }

  // ── Test Execution ─────────────────────────────────────────

  private async runTests(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    kind: SunitRunKind = 'run',
  ): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    const run = this.controller.createTestRun(request);
    const queue = this.getTestsToRun(request);

    try {
      for (const item of queue) {
        if (token.isCancellationRequested) {
          run.skipped(item);
          continue;
        }

        const { dictName, className, selector } = parseTestId(item.id);

        if (selector === undefined) {
          await this.runClassTests(session, run, item, className, dictName, kind);
        } else {
          await this.runSingleTest(session, run, item, className, selector, dictName, kind);
        }
      }
    } finally {
      run.end();
      this.flushResultChanges();
    }
  }

  private getTestsToRun(request: vscode.TestRunRequest): vscode.TestItem[] {
    const queue: vscode.TestItem[] = [];

    if (request.include) {
      for (const item of request.include) {
        queue.push(item);
      }
    } else {
      this.controller.items.forEach((item) => queue.push(item));
    }

    const excluded = new Set(request.exclude?.map((i) => i.id) ?? []);
    return queue.filter((i) => !excluded.has(i.id));
  }

  private async runSingleTest(
    session: ActiveSession,
    run: vscode.TestRun,
    item: vscode.TestItem,
    className: string,
    selector: string,
    dictName: string,
    kind: SunitRunKind,
  ): Promise<void> {
    run.started(item);
    await this.markRunning([item]);

    if (kind === 'debug' && this.debugExecutor) {
      await this.debugSingleTest(session, run, item, className, selector, dictName);
      return;
    }

    try {
      const result = sunit.runTestMethod(session, className, selector, dictName);
      this.reportResult(run, item, result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.reportError(run, item, `Execution error: ${msg}`);
    }
  }

  /**
   * Run one test under the debugger. Reports into the same store as an ordinary
   * run — the whole point is that a test debugged from a row or a gutter icon
   * leaves the same mark as one that was merely run.
   */
  private async debugSingleTest(
    session: ActiveSession,
    run: vscode.TestRun,
    item: vscode.TestItem,
    className: string,
    selector: string,
    dictName: string,
  ): Promise<boolean> {
    try {
      const outcome = await this.debugExecutor!.executeWithDebugger(
        session,
        debugTestMethodCode(className, selector, dictName),
        `${className}>>${selector}`,
      );

      if (!outcome.raised) {
        this.reportPassed(run, item);
        return false;
      }

      // Once the process is suspended and a debugger owns it, we no longer know
      // whether an assertion failed or something else was raised — SUnit does
      // that classification inside the handler a debug run deliberately omits.
      // Report the honest "it raised", with the message, rather than guessing.
      this.reportError(run, item, outcome.message ?? 'Test raised an exception.');
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.reportError(run, item, `Execution error: ${msg}`);
      return true;
    }
  }

  private async runClassTests(
    session: ActiveSession,
    run: vscode.TestRun,
    classItem: vscode.TestItem,
    className: string,
    dictName: string,
    kind: SunitRunKind,
  ): Promise<void> {
    // Ensure children are resolved
    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    if (kind === 'debug' && this.debugExecutor) {
      await this.debugClassTests(session, run, classItem, className, dictName);
      return;
    }

    // Mark all children as started
    run.started(classItem);
    classItem.children.forEach((child) => run.started(child));
    const running: vscode.TestItem[] = [classItem];
    classItem.children.forEach((child) => running.push(child));
    await this.markRunning(running);

    try {
      const results = sunit.runTestClass(session, className, dictName);
      const resultMap = new Map(results.map((r) => [r.selector, r]));

      let passedCount = 0;
      let totalCount = 0;
      classItem.children.forEach((child) => {
        // Children are always method ids, so selector is present.
        const selector = parseTestId(child.id).selector!;
        const result = resultMap.get(selector);

        if (!result) {
          this.reportSkipped(run, child);
          return;
        }

        totalCount += 1;
        this.reportResult(run, child, result);
        if (result.status === 'passed') passedCount += 1;
      });

      const allPassed = passedCount === totalCount;
      if (allPassed) {
        run.passed(classItem);
      } else {
        run.failed(classItem, new vscode.TestMessage('Some tests failed.'));
      }
      this.setResult(dictName, className, undefined, {
        outcome: allPassed ? 'passed' : 'failed',
        passedCount,
        totalCount,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.reportError(run, classItem, `Execution error: ${msg}`);
      classItem.children.forEach((child) => {
        this.reportError(run, child, `Class execution error: ${msg}`);
      });
    }
  }

  /**
   * Debug every test in a class, one at a time — a suite run would install the
   * handler that makes a failure undebuggable — and stop at the first test that
   * raises, because from that moment a debugger owns the suspended process and
   * running the next test on top of it would be nonsense. Tests after that one
   * are left with no result rather than a made-up one.
   */
  private async debugClassTests(
    session: ActiveSession,
    run: vscode.TestRun,
    classItem: vscode.TestItem,
    className: string,
    dictName: string,
  ): Promise<void> {
    const children: vscode.TestItem[] = [];
    classItem.children.forEach((child) => children.push(child));

    run.started(classItem);
    await this.markRunning([classItem]);

    let passedCount = 0;
    for (const child of children) {
      const selector = parseTestId(child.id).selector!;
      run.started(child);
      await this.markRunning([child]);

      const raised = await this.debugSingleTest(session, run, child, className, selector, dictName);
      if (raised) {
        run.errored(classItem, new vscode.TestMessage(`${selector} raised.`));
        this.setResult(dictName, className, undefined, {
          outcome: 'error',
          passedCount,
          totalCount: children.length,
        });
        return;
      }
      passedCount += 1;
    }

    run.passed(classItem);
    this.setResult(dictName, className, undefined, {
      outcome: 'passed',
      passedCount,
      totalCount: children.length,
    });
  }

  /**
   * Show the tests as running before the (blocking) stone call starts. The
   * yield matters: the queries are synchronous, so without handing the event
   * loop back the spinner would only ever appear after the answer arrived.
   */
  private async markRunning(items: vscode.TestItem[]): Promise<void> {
    for (const item of items) {
      const { dictName, className, selector } = parseTestId(item.id);
      this.setResult(dictName, className, selector, { outcome: 'running' });
    }
    this.flushResultChanges();
    await new Promise((resolve) => setImmediate(resolve));
  }

  private reportResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    result: sunit.TestRunResult,
  ): void {
    switch (result.status) {
      case 'passed':
        run.passed(item, result.durationMs);
        break;
      case 'failed':
        run.failed(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
      case 'error':
        run.errored(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
    }
    this.reportOutcome(item, {
      outcome: result.status,
      message: result.message,
      durationMs: result.durationMs,
    });
  }

  /** A pass with no measured duration — a debugged test's elapsed time is the
   * user's stepping time, which would be a lie on the row. */
  private reportPassed(run: vscode.TestRun, item: vscode.TestItem): void {
    run.passed(item);
    this.reportOutcome(item, { outcome: 'passed' });
  }

  private reportError(run: vscode.TestRun, item: vscode.TestItem, message: string): void {
    run.errored(item, new vscode.TestMessage(message));
    this.reportOutcome(item, { outcome: 'error', message });
  }

  /** A test the class run didn't report on — it has no current outcome at all,
   * so drop any older one rather than leave a result the run didn't produce. */
  private reportSkipped(run: vscode.TestRun, item: vscode.TestItem): void {
    run.skipped(item);
    const { dictName, className, selector } = parseTestId(item.id);
    this.deleteResult(dictName, className, selector);
  }

  /** The one place a settled outcome enters the store. */
  private reportOutcome(item: vscode.TestItem, result: SunitResult): void {
    const { dictName, className, selector } = parseTestId(item.id);
    this.setResult(dictName, className, selector, result);
  }

  /**
   * True when a class item belongs to dictName and is named className.
   * Both come from the id — the label carries the test-count suffix and is
   * NOT the class name.
   */
  private classItemMatches(item: TestItem, dictName: string, className: string): boolean {
    const { dictName: itemDict, className: itemClass } = parseTestId(item.id);
    return itemDict === dictName && itemClass === className;
  }

  private itemsForClasses(dictName: string, classNames: string[]): TestItem[] {
    const result: TestItem[] = [];

    this.controller.items.forEach((testItem) => {
      const { dictName: itemDict, className: itemClass } = parseTestId(testItem.id);
      if (itemDict === dictName && classNames.includes(itemClass)) {
        result.push(testItem);
      }
    });

    return result;
  }

  private findClassItem(dictName: string, className: string): TestItem | undefined {
    let classItem: TestItem | undefined;

    this.controller.items.forEach((testItem) => {
      if (this.classItemMatches(testItem, dictName, className)) {
        classItem = testItem;
      }
    });

    return classItem;
  }

  private itemForMethodNamed(classItem: TestItem, selector: string): TestItem | undefined {
    let methodItem: TestItem | undefined;

    classItem.children.forEach((child) => {
      if (child.label === selector) {
        methodItem = child;
      }
    });

    return methodItem;
  }

  /**
   * The single funnel every named entry point runs through — so a test started
   * from an Explorer button, a gutter icon, a code lens, or the browser's
   * context menu takes exactly the same path (and gets the same reporting and
   * cancellation) as one started from the Test Explorer itself.
   */
  private async runTestItems(testItems: TestItem[], kind: SunitRunKind = 'run'): Promise<void> {
    if (testItems.length === 0) {
      vscode.window.showWarningMessage(this.noTestsFoundErrorMessage());
      return;
    }

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      await this.runTests(
        {
          include: testItems,
          exclude: undefined,
          preserveFocus: false,
          profile: undefined,
          continuous: false,
        },
        tokenSource.token,
        kind,
      );
    } finally {
      tokenSource.dispose();
    }
  }
}
