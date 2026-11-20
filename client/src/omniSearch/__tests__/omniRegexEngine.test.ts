/**
 * Regex search in the GemStone Search engine: the .* toggle, the scope it moves to and back from, the
 * search running only on Enter, and what the panel is told when a search is refused, cut short or
 * stopped. The stone side is a fake runner; regexSearchRunner.test.ts and the integration test cover
 * the real one.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  carriedEngineState,
  createOmniEngine,
  OmniEngineDeps,
  REGEX_PENDING_NOTICE,
  REGEX_STOPPED_NOTICE,
  regexOutcomeNotice,
} from '../omniEngine';
import { OMNI_DEFAULTS, readOmniConfig } from '../omniConfig';
import {
  CATEGORY_BY_ID,
  OmniConfig,
  OmniProvider,
  OmniResult,
  RegexSearchOutcome,
  RegexSearchRunner,
} from '../omniTypes';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

function sourceRow(className: string, selector: string): OmniResult {
  return {
    categoryId: 'source',
    label: `${className}>>${selector}`,
    description: 'Globals',
    score: 0,
    ranges: [],
    action: {
      kind: 'openMethod',
      sessionId: 1,
      dictName: 'Globals',
      className,
      isMeta: false,
      category: 'x',
      selector,
      environmentId: 0,
      dictIndex: 0,
    },
  };
}

/** A provider that records each search it is asked for. */
function spyProvider(id: 'classes' | 'source') {
  const terms: string[] = [];
  const p: OmniProvider = {
    category: CATEGORY_BY_ID[id],
    search(term) {
      terms.push(term);
      return [];
    },
  };
  return Object.assign(p, { terms });
}

interface FakeRun {
  pattern: string;
  ignoreCase: boolean;
  limit: number;
  resolve: (o: RegexSearchOutcome) => void;
  reject: (e: unknown) => void;
  cancel: ReturnType<typeof vi.fn>;
}

/** A regex runner whose searches the test answers by hand. Cancelling one answers it 'cancelled', as
 *  the real runner does once the stone lets go. */
function fakeRunner() {
  const runs: FakeRun[] = [];
  const runner: RegexSearchRunner = (pattern, ignoreCase, limit) => {
    let resolve!: (o: RegexSearchOutcome) => void;
    let reject!: (e: unknown) => void;
    const outcome = new Promise<RegexSearchOutcome>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const cancel = vi.fn(() => resolve({ kind: 'cancelled' }));
    runs.push({ pattern, ignoreCase, limit, resolve, reject, cancel });
    return { outcome, cancel };
  };
  return { runner, runs };
}

function engineWith(over: Partial<OmniEngineDeps> = {}, config: Partial<OmniConfig> = {}) {
  const classes = spyProvider('classes');
  const source = spyProvider('source');
  const { runner, runs } = fakeRunner();
  const engine = createOmniEngine({
    providers: [classes, source],
    config: cfg(config),
    regexSearch: runner,
    ...over,
  });
  return { engine, classes, source, runs };
}

const answer = (rows: OmniResult[], over: Partial<RegexSearchOutcome> = {}): RegexSearchOutcome =>
  ({
    kind: 'results',
    results: rows,
    skipped: 0,
    failed: 0,
    truncated: false,
    wholeMethods: false,
    ...over,
  }) as RegexSearchOutcome;

describe('turning regex on and off', () => {
  it('is unavailable without a runner, and the toggle then does nothing', async () => {
    const engine = createOmniEngine({ providers: [], config: cfg() });

    await engine.toggleRegex();

    expect(engine.state()).toMatchObject({ regex: false, regexAvailable: false });
  });

  it('asks whether the session has regex support each time, so an install takes effect', async () => {
    let installed = false;
    const { engine } = engineWith({ regexAvailable: () => installed });

    expect(engine.state().regexAvailable).toBe(false);
    await engine.toggleRegex();
    expect(engine.state().regex).toBe(false);

    installed = true;
    await engine.toggleRegex();
    expect(engine.state()).toMatchObject({ regex: true, regexAvailable: true });
  });

  // The session only sees support another session installed after its next commit or abort, so the
  // check at login, or right after the install, can come too early to find it.
  it('checks the stone again when built, on every resync and on refresh', async () => {
    let installed = false;
    const refreshRegexAvailable = vi.fn(() => {
      installed = true;
    });
    const { engine } = engineWith({ regexAvailable: () => installed, refreshRegexAvailable });
    expect(refreshRegexAvailable).toHaveBeenCalledTimes(1);
    expect(engine.state().regexAvailable).toBe(true);

    await engine.resync();
    await engine.refresh();

    expect(refreshRegexAvailable).toHaveBeenCalledTimes(3);
  });

  it('offers regex once a commit or abort lets the session see a fresh install', async () => {
    let onStone = false;
    let latched = false;
    const { engine } = engineWith({
      regexAvailable: () => latched,
      refreshRegexAvailable: () => {
        latched = onStone;
      },
    });
    expect(engine.state().regexAvailable).toBe(false);

    onStone = true;
    await engine.resync();

    expect(engine.state().regexAvailable).toBe(true);
  });

  it('keeps the last answer when the check itself fails', async () => {
    const { engine } = engineWith({
      regexAvailable: () => true,
      refreshRegexAvailable: () => {
        throw new Error('session busy');
      },
    });

    await engine.resync();

    expect(engine.state().regexAvailable).toBe(true);
  });

  it('moves to the Source scope, the only one regex searches', async () => {
    const { engine } = engineWith();
    await engine.setScope('classes');

    await engine.toggleRegex();

    expect(engine.state()).toMatchObject({ regex: true, scopeId: 'source' });
  });

  it('returns to the scope the user was on when turned off', async () => {
    const { engine } = engineWith();
    await engine.setScope('classes');
    await engine.toggleRegex();

    await engine.toggleRegex();

    expect(engine.state()).toMatchObject({ regex: false, scopeId: 'classes' });
  });

  it('returns to All when that is where the user was', async () => {
    const { engine } = engineWith();
    await engine.toggleRegex();

    await engine.toggleRegex();

    expect(engine.state().scopeId).toBeNull();
  });

  it('ignores a click on another scope while on, staying in Source', async () => {
    const { engine } = engineWith();
    await engine.toggleRegex();

    await engine.setScope('classes');

    expect(engine.state().scopeId).toBe('source');
  });

  it('starts on, in Source, when the setting says so and the session supports it', () => {
    const { engine } = engineWith({}, { regex: true });

    expect(engine.state()).toMatchObject({ regex: true, scopeId: 'source' });
  });

  it('starts off when the setting says on but the session has no support', () => {
    const { engine } = engineWith({ regexAvailable: () => false }, { regex: true });

    expect(engine.state()).toMatchObject({ regex: false, scopeId: null });
  });

  it('can be turned off even after the support went away', async () => {
    let installed = true;
    const { engine } = engineWith({ regexAvailable: () => installed });
    await engine.toggleRegex();
    installed = false;

    await engine.toggleRegex();

    expect(engine.state().regex).toBe(false);
  });

  it('runs the ordinary search again on the way out', async () => {
    const { engine, classes } = engineWith();
    await engine.setScope('classes');
    await engine.toggleRegex();
    await engine.search('Ordered');

    await engine.toggleRegex();

    expect(classes.terms.at(-1)).toBe('Ordered');
  });
});

describe('searching with regex on', () => {
  it('does not search as you type: the view asks for Enter instead', async () => {
    const { engine, source, runs } = engineWith();
    await engine.toggleRegex();

    const view = await engine.search('Ordered\\w+');

    expect(runs).toHaveLength(0);
    expect(source.terms).toEqual([]);
    expect(view).toMatchObject({ rows: [], notice: REGEX_PENDING_NOTICE, regexPending: true });
  });

  it('shows nothing, and asks for nothing, for an empty box', async () => {
    const { engine } = engineWith();
    await engine.toggleRegex();

    const view = await engine.search('   ');

    expect(view?.notice).toBeUndefined();
    expect(view?.regexPending).toBeUndefined();
  });

  it('searches on Enter, honouring Aa', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    await engine.search('Ordered\\w+');

    await engine.toggleCase();
    void engine.submit('Ordered\\w+');

    expect(runs.map((r) => [r.pattern, r.ignoreCase])).toEqual([['Ordered\\w+', false]]);
  });

  it('searches again under the new case when Aa is clicked over an answer', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('Ordered\\w+');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await first;

    const again = engine.toggleCase();
    runs[1].resolve(answer([sourceRow('B', 'b')]));
    const view = await again;

    expect(runs.map((r) => [r.pattern, r.ignoreCase])).toEqual([
      ['Ordered\\w+', true],
      ['Ordered\\w+', false],
    ]);
    expect(view?.rows.map((r) => r.label)).toEqual(['B>>b']);
    expect(view?.regexPending).toBeUndefined();
  });

  it('replaces a search still running when Aa is clicked, rather than waiting for it', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('(a+)+b');

    void engine.toggleCase();

    expect(runs[0].cancel).toHaveBeenCalled();
    expect(await first).toBeNull();
    expect(runs.map((r) => r.ignoreCase)).toEqual([true, false]);
  });

  it('leaves a pattern not yet searched waiting for Enter when Aa is clicked', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    await engine.search('x+');

    const view = await engine.toggleCase();

    expect(runs).toHaveLength(0);
    expect(view?.regexPending).toBe(true);
  });

  it("asks the stone for at most maxServerScan methods, the Methods tab's limit", async () => {
    const { engine, runs } = engineWith({}, { maxServerScan: 750 });
    await engine.toggleRegex();

    void engine.submit('x');

    expect(runs[0].limit).toBe(750);
  });

  it('shows the answer in method order, not the order the stone found it', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('x');

    runs[0].resolve(answer([sourceRow('Zeta', 'b'), sourceRow('Alpha', 'a')]));
    const view = await pending;

    expect(view?.rows.map((r) => r.label)).toEqual(['Alpha>>a', 'Zeta>>b']);
    expect(view?.regexPending).toBeUndefined();
    expect(view?.notice).toBeUndefined();
    expect(view?.exact).toBe(true);
    expect(view?.moreMatch).toBeUndefined();
  });

  it('keeps the answer while the box still holds its pattern', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('x+');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await pending;

    const view = await engine.search('x+');

    expect(runs).toHaveLength(1);
    expect(view?.rows).toHaveLength(1);
  });

  it('marks the rows stale once the pattern changes', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('x+');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await pending;

    expect((await engine.search('x+y'))?.regexPending).toBe(true);
    expect((await engine.search('x+'))?.regexPending).toBeUndefined();
  });

  it('turning .* off waits for the stopped search to let go of the session before searching', async () => {
    let letGo!: () => void;
    const { engine, classes } = engineWith({
      regexSearch: () => ({
        outcome: new Promise<RegexSearchOutcome>(() => {}),
        cancel: () => new Promise<void>((resolve) => (letGo = resolve)),
      }),
    });
    await engine.toggleRegex();
    await engine.search('Arr');
    void engine.submit('Arr');

    const off = engine.toggleRegex();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(classes.terms).toEqual([]);

    letGo();
    await off;
    expect(classes.terms).toEqual(['Arr']);
  });

  it('says the search stopped, and waits for Enter, when it is cancelled from its progress notice', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('(=+)+x');

    runs[0].resolve({ kind: 'cancelled' });
    const view = await pending;

    expect(view).toMatchObject({ rows: [], notice: REGEX_STOPPED_NOTICE, regexPending: true });
  });

  it('stops a search still running on the stone when the pattern is edited', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('(a+)+b');

    await engine.search('(a+)+bc');

    expect(runs[0].cancel).toHaveBeenCalled();
    expect(await first).toBeNull();
  });

  it('stops a newer search still running when the box goes back to a pattern already answered', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('a');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await first;
    void engine.submit('(a+)+b');

    const view = await engine.search('a');

    expect(runs[1].cancel).toHaveBeenCalled();
    expect(view?.rows.map((r) => r.label)).toEqual(['A>>a']);
  });

  it('leaves a search running for the pattern in the box alone when the box is unchanged', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    void engine.submit('(a+)+b');

    await engine.search('(a+)+b');

    expect(runs[0].cancel).not.toHaveBeenCalled();
  });

  it('Aa does not search a pattern that was never searched, whatever else ran before', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('a');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await first;
    void engine.submit('(a+)+b');
    await engine.search('c');

    const view = await engine.toggleCase();

    expect(runs).toHaveLength(2);
    expect(view?.regexPending).toBe(true);
  });

  it('stops the previous search when Enter starts a new one, and shows only the new answer', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const first = engine.submit('a');
    const second = engine.submit('b');

    expect(runs[0].cancel).toHaveBeenCalled();
    runs[1].resolve(answer([sourceRow('B', 'b')]));

    expect(await first).toBeNull();
    expect((await second)?.rows.map((r) => r.label)).toEqual(['B>>b']);
  });

  it('stops a running search when regex is turned off', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    void engine.submit('a');

    await engine.toggleRegex();

    expect(runs[0].cancel).toHaveBeenCalled();
  });

  it("shows a refused pattern's reason as an error, with no rows", async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('a{3}');

    runs[0].resolve({ kind: 'refused', message: "This pattern can't be used: counted repetition" });
    const view = await pending;

    expect(view).toMatchObject({
      rows: [],
      notice: "This pattern can't be used: counted repetition",
      noticeIsError: true,
    });
  });

  it('says so when the search failed outright', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('a');

    runs[0].reject(new Error('the session dropped'));
    const view = await pending;

    expect(view).toMatchObject({
      notice: 'Regex search failed: the session dropped',
      noticeIsError: true,
    });
  });

  it('says how many methods were skipped and that the rows were capped', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    const pending = engine.submit('a\\nb');

    runs[0].resolve(answer([sourceRow('A', 'a')], { skipped: 3, truncated: true }));
    const view = await pending;

    expect(view?.exact).toBe(false);
    expect(view?.moreMatch).toBe(true);
    expect(view?.notice).toBe(
      'Showing the first 1 matching methods; more match. Narrow the pattern, or raise gemstone.omniSearch.maxServerScan, to see them. ' +
        '3 methods were too long to search and were skipped.',
    );
    expect(view?.noticeIsError).toBeUndefined();
  });

  it('runs the search again on an explicit refresh, once one has run', async () => {
    const { engine, runs } = engineWith();
    await engine.toggleRegex();
    await engine.search('a');
    void engine.refresh();
    await Promise.resolve();
    expect(runs).toHaveLength(0);

    const pending = engine.submit('a');
    runs[0].resolve(answer([]));
    await pending;
    void engine.refresh();
    await vi.waitFor(() => expect(runs).toHaveLength(2));
  });

  it('leaves the view alone on a class compile', async () => {
    const { engine } = engineWith();
    await engine.toggleRegex();
    await engine.search('a');

    expect(
      await engine.applyChange({ kind: 'class', className: 'A', dictName: 'UserGlobals' } as never),
    ).toBeNull();
  });

  it('shows the answer again after a references pivot, without searching again', async () => {
    const view = { title: 'Senders of a', target: 'a', results: [sourceRow('S', 's')] };
    const { engine, runs } = engineWith({ resolveReferences: () => view });
    await engine.toggleRegex();
    const pending = engine.submit('a');
    runs[0].resolve(answer([sourceRow('A', 'a')]));
    await pending;

    await engine.pivot(0);
    const back = await engine.exitPivot();

    expect(runs).toHaveLength(1);
    expect(back?.rows.map((r) => r.label)).toEqual(['A>>a']);
  });

  it('does nothing different on Enter while regex is off', async () => {
    const { engine, classes, runs } = engineWith();

    await engine.submit('Arr');

    expect(runs).toHaveLength(0);
    expect(classes.terms).toEqual(['Arr']);
  });
});

describe('regexOutcomeNotice', () => {
  it('says nothing when nothing was left out', () => {
    expect(regexOutcomeNotice({ results: [1], skipped: 0, truncated: false })).toBeUndefined();
  });

  it('says so when nothing matched', () => {
    expect(regexOutcomeNotice({ results: [], skipped: 0, truncated: false })).toBe(
      'No methods match.',
    );
  });

  it('uses the singular for one skipped method', () => {
    expect(regexOutcomeNotice({ results: [1], skipped: 1, truncated: false })).toBe(
      '1 method was too long to search and was skipped.',
    );
  });

  // A fault on the stone is not a method being too long, and must not read as one.
  it('says apart how many methods could not be searched because of an error', () => {
    expect(regexOutcomeNotice({ results: [1], skipped: 1, failed: 2, truncated: false })).toBe(
      '1 method was too long to search and was skipped. ' +
        '2 methods could not be searched because of an error on the stone.',
    );
    expect(regexOutcomeNotice({ results: [1], skipped: 0, failed: 1, truncated: false })).toBe(
      '1 method could not be searched because of an error on the stone.',
    );
  });

  it('says nothing matched and that some methods were skipped', () => {
    expect(regexOutcomeNotice({ results: [], skipped: 2, truncated: false })).toBe(
      'No methods match. 2 methods were too long to search and were skipped.',
    );
  });
});

describe('the gemstone.omniSearch.regex setting', () => {
  it('is read as the starting position of the button, off unless set to true', () => {
    const read = (value: unknown) =>
      readOmniConfig({ get: <T>(key: string, d: T) => (key === 'regex' ? (value as T) : d) }).regex;

    expect(read(true)).toBe(true);
    expect(read(false)).toBe(false);
    expect(read('yes')).toBe(false);
    expect(read(undefined)).toBe(false);
  });

  it('is declared in the manifest, off by default', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
    );
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((s: { properties?: object }) => s.properties ?? {}),
    );
    expect(props['gemstone.omniSearch.regex']).toMatchObject({ type: 'boolean', default: false });
  });
});

describe('after a settings change rebuilds the engine', () => {
  it('keeps .* on, on the Source tab, with the scope to go back to', async () => {
    const { engine: before } = engineWith();
    await before.setScope('classes');
    await before.toggleRegex();

    const { engine } = engineWith({ carryOver: carriedEngineState(before.state(), () => false) });

    expect(engine.state()).toMatchObject({ regex: true, scopeId: 'source' });
    await engine.toggleRegex();
    expect(engine.state()).toMatchObject({ regex: false, scopeId: 'classes' });
  });

  it('keeps Aa and the match algorithm', async () => {
    const { engine: before } = engineWith();
    await before.toggleCase();
    await before.setMatchMode('prefix');

    const { engine } = engineWith({ carryOver: carriedEngineState(before.state(), () => false) });

    expect(engine.state()).toMatchObject({ caseSensitive: true, matchMode: 'prefix' });
  });

  it('takes the new setting for a toggle whose own setting changed', async () => {
    const { engine: before } = engineWith();
    await before.toggleCase();
    await before.toggleRegex();
    const carry = carriedEngineState(before.state(), (k) => k === 'caseSensitive' || k === 'regex');

    const { engine } = engineWith({ carryOver: carry }, { caseSensitive: false, regex: false });

    expect(engine.state()).toMatchObject({ caseSensitive: false, regex: false, scopeId: null });
  });

  it('leaves .* off when the session lost regex support meanwhile', async () => {
    const { engine: before } = engineWith();
    await before.toggleRegex();

    const { engine } = engineWith({
      carryOver: carriedEngineState(before.state(), () => false),
      regexAvailable: () => false,
    });

    expect(engine.state()).toMatchObject({ regex: false });
  });

  it('drops a carried scope that is no longer enabled', async () => {
    const { engine: before } = engineWith();
    await before.setScope('classes');

    const { engine } = engineWith(
      { carryOver: carriedEngineState(before.state(), () => false) },
      { enabledCategories: ['methods', 'source'] },
    );

    expect(engine.state().scopeId).toBeNull();
  });
});
