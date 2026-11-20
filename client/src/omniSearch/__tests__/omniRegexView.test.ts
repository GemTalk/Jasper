// @vitest-environment jsdom
/**
 * The .* button in the GemStone Search webview: greyed out without the server plugin's regex support,
 * the scopes and match chip greyed while it is on, the notice line, and Enter searching rather than
 * opening a row while the rows are not for the pattern in the box.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOmniView, mountOmniView } from './omniViewHarness';

beforeAll(loadOmniView);

const CATEGORIES = [
  { id: 'classes', label: 'Classes', explicitOnly: false },
  { id: 'methods', label: 'Methods', explicitOnly: false },
  { id: 'source', label: 'Source', explicitOnly: true },
];

const regexButton = () => document.getElementById('regex') as HTMLButtonElement;
const field = () => document.getElementById('query') as HTMLInputElement;
const notice = () => document.getElementById('notice') as HTMLElement;
const tab = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.tab')].find((b) => b.textContent === label)!;

function mount(state: { regex?: boolean; regexAvailable?: boolean } = {}) {
  return mountOmniView({
    categories: CATEGORIES,
    scopeId: state.regex ? 'source' : null,
    regex: state.regex ?? false,
    regexAvailable: state.regexAvailable ?? true,
  });
}

function results(view: ReturnType<typeof mount>['view'], over: Record<string, unknown> = {}) {
  view.onMessage({
    data: {
      command: 'results',
      rows: [],
      categories: CATEGORIES,
      scopeId: 'source',
      regex: true,
      regexAvailable: true,
      ...over,
    },
  });
}

const row = (id: number, label: string) => ({
  id,
  label,
  categoryId: 'source',
  categoryLabel: 'Source',
  icon: 'symbol-method',
  ranges: [],
  referenceable: true,
});

function pressEnter(on: HTMLElement = field()) {
  on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('the .* button', () => {
  it('sits beside Aa', () => {
    mount();
    expect(document.getElementById('case')!.nextElementSibling).toBe(regexButton());
    expect(regexButton().textContent).toBe('.*');
  });

  it('is greyed out, saying how to get it, without the server plugin', () => {
    mount({ regexAvailable: false });

    expect(regexButton().disabled).toBe(true);
    expect(regexButton().title).toContain('Install or update the server plugin');
  });

  it('is usable when the session has regex support, and says it runs on Enter', () => {
    mount();

    expect(regexButton().disabled).toBe(false);
    expect(regexButton().title).toContain('press Enter');
  });

  it('asks the engine to toggle when clicked', () => {
    const { posted } = mount();

    regexButton().click();

    expect(posted.at(-1)).toEqual({ command: 'toggleRegex' });
  });

  it('shows as pressed while on, with the full tooltip', () => {
    mount({ regex: true });

    expect(regexButton().classList.contains('active')).toBe(true);
    expect(regexButton().getAttribute('aria-pressed')).toBe('true');
    expect(regexButton().title).toContain('Press Enter to search');
    expect(regexButton().title).toContain('\\n or \\r to match across lines');
  });

  it('stays usable while on, even after the support went away, so it can be turned off', () => {
    mount({ regex: true, regexAvailable: false });

    expect(regexButton().disabled).toBe(false);
  });
});

describe('while regex is on', () => {
  it('greys out every scope but Source, saying why', () => {
    mount({ regex: true });

    expect(tab('Source').disabled).toBe(false);
    for (const label of ['All', 'Classes', 'Methods']) {
      expect(tab(label).disabled, label).toBe(true);
      expect(tab(label).title).toBe('Regex searches method source only');
    }
  });

  it('greys out the match algorithm chip', () => {
    mount({ regex: true });
    const chip = document.getElementById('matchMode') as HTMLButtonElement;

    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Has no effect on a regular expression search');
  });

  it('enables everything again when it is turned off', () => {
    const { view } = mount({ regex: true });

    results(view, { regex: false, scopeId: null });

    expect(tab('Classes').disabled).toBe(false);
    expect((document.getElementById('matchMode') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not cycle scopes with Tab', () => {
    const { posted } = mount({ regex: true });

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(posted.some((m) => m.command === 'setScope')).toBe(false);
  });
});

describe('Enter while regex is on', () => {
  it('searches when the rows are not for the pattern in the box', () => {
    const { view, posted } = mount({ regex: true });
    results(view, { regexPending: true, notice: 'Press Enter to search.' });
    field().value = 'Ordered\\w+';

    pressEnter();

    expect(posted.at(-1)).toEqual({ command: 'submit', value: 'Ordered\\w+' });
  });

  it('searches when there are no rows at all', () => {
    const { posted } = mount({ regex: true });
    field().value = 'x';

    pressEnter();

    expect(posted.at(-1)).toEqual({ command: 'submit', value: 'x' });
  });

  it('opens the active row once the rows answer the pattern', () => {
    const { view, posted } = mount({ regex: true });
    field().value = 'x';
    results(view, { rows: [row(0, 'A>>a')], regexPending: false });
    view.setActive(0);

    pressEnter();

    expect(posted.at(-1)).toMatchObject({ command: 'activate', id: 0 });
  });

  it('searches, rather than opening an old row, when Enter follows typing before the reply', () => {
    const { view, posted } = mount({ regex: true });
    field().value = 'x';
    results(view, { rows: [row(0, 'A>>a')], regexPending: false });
    view.setActive(0);

    field().value = 'xy';
    field().dispatchEvent(new Event('input'));
    pressEnter();

    expect(posted.at(-1)).toEqual({ command: 'submit', value: 'xy' });
  });

  it('does nothing for an empty box', () => {
    const { posted } = mount({ regex: true });
    field().value = '  ';

    pressEnter();

    expect(posted.some((m) => m.command === 'submit')).toBe(false);
  });

  it('still opens a row the usual way while regex is off', () => {
    const { view, posted } = mount();
    field().value = 'Arr';
    view.onMessage({
      data: { command: 'results', rows: [row(0, 'Array')], categories: CATEGORIES, scopeId: null },
    });
    view.setActive(0);

    pressEnter();

    expect(posted.at(-1)).toMatchObject({ command: 'activate', id: 0 });
  });
});

describe('the count under the results', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i, `A>>m${i}`));
  const count = () => document.getElementById('count')!.textContent;

  it('says the count is a floor when the stone stopped at its limit with more matching', () => {
    const { view } = mount({ regex: true });

    results(view, { rows: rows(3), shownCount: 3, exact: false, moreMatch: true });

    expect(count()).toBe('3+ shown');
  });

  it('gives the plain total when the stone found them all', () => {
    const { view } = mount({ regex: true });

    results(view, { rows: rows(3), shownCount: 3, exact: true });

    expect(count()).toBe('3 results');
  });
});

describe('the notice line', () => {
  it('shows what the engine says, plainly', () => {
    const { view } = mount({ regex: true });

    results(view, { notice: '3 methods were too long to search as a whole and were skipped.' });

    expect(notice().style.display).toBe('block');
    expect(notice().textContent).toBe(
      '3 methods were too long to search as a whole and were skipped.',
    );
    expect(notice().classList.contains('error')).toBe(false);
  });

  it('shows a refused pattern as an error', () => {
    const { view } = mount({ regex: true });

    results(view, { notice: "This pattern can't be used: …", noticeIsError: true });

    expect(notice().classList.contains('error')).toBe(true);
  });

  it('says the search is running from Enter until the answer arrives', () => {
    const { view } = mount({ regex: true });
    field().value = 'x';

    pressEnter();
    expect(notice().textContent).toBe('Searching…');
    expect(notice().style.display).toBe('block');

    results(view, { notice: 'No methods match.' });
    expect(notice().textContent).toBe('No methods match.');
  });

  it('says the search is running again when Aa is clicked over an answer', () => {
    const { view, posted } = mount({ regex: true });
    field().value = 'x';
    results(view, { rows: [row(0, 'A>>a')], regexPending: false });

    (document.getElementById('case') as HTMLButtonElement).click();

    expect(posted.at(-1)).toEqual({ command: 'toggleCase' });
    expect(notice().textContent).toBe('Searching…');
  });

  it('does not claim a search when Aa is clicked over a pattern waiting for Enter', () => {
    const { view } = mount({ regex: true });
    field().value = 'x';
    results(view, { regexPending: true, notice: 'Press Enter to search.' });

    (document.getElementById('case') as HTMLButtonElement).click();

    expect(notice().textContent).toBe('Press Enter to search.');
  });

  it('drops the running line when the search fails', () => {
    const { view } = mount({ regex: true });
    field().value = 'x';
    pressEnter();

    view.onMessage({ data: { command: 'error', message: 'This session is busy' } });

    expect(notice().style.display).toBe('none');
  });

  it('drops the running line when the search stops without an answer', () => {
    const { view } = mount({ regex: true });
    field().value = 'x';
    pressEnter();

    view.onMessage({ data: { command: 'busy', on: false } });

    expect(notice().style.display).toBe('none');
  });

  it('is hidden when there is nothing to say', () => {
    const { view } = mount({ regex: true });
    results(view, { notice: 'Press Enter to search.' });

    results(view, {});

    expect(notice().style.display).toBe('none');
  });
});

describe('the preview of a regex hit', () => {
  // Two matches: one on the first line, one running from the second line onto the third.
  const SOURCE = 'bar\n  ^self at: 1\n    put: 2. #at:put:';
  const AT = SOURCE.indexOf('at: 1');
  const PUT_END = SOURCE.indexOf('put: 2') + 4;

  function preview(matches: unknown) {
    const { view } = mount({ regex: true });
    field().value = 'at:.*\\n.*put:';
    results(view, { rows: [row(0, 'Foo>>bar')], regexPending: false });
    view.setActive(0);
    view.onMessage({
      data: { command: 'preview', id: 0, source: SOURCE, title: 'Foo>>bar', matches },
    });
    return [...document.querySelectorAll('#preview mark')].map((m) => m.textContent);
  }

  it('marks every match the stone found, not the typed pattern', () => {
    expect(
      preview([
        { start: 0, end: 3 },
        { start: AT, end: PUT_END },
      ]),
    ).toEqual(['bar', 'at: 1\n    put:']);
  });

  it('marks a match that runs across a line break as one mark, line break included', () => {
    expect(preview([{ start: AT, end: PUT_END }])).toEqual(['at: 1\n    put:']);
  });

  it('keeps the source text whole around the marks', () => {
    preview([{ start: AT, end: PUT_END }]);
    expect(document.querySelector('#preview .preview-src')?.textContent).toBe(SOURCE);
  });

  it('skips an empty match, one past the end, and an overlap', () => {
    expect(
      preview([
        { start: 2, end: 2 },
        { start: 0, end: 3 },
        { start: 1, end: 5 },
        { start: 5, end: SOURCE.length + 10 },
      ]),
    ).toEqual(['bar']);
  });

  it('marks nothing when there are no matches, rather than the pattern as text', () => {
    expect(preview(undefined)).toEqual([]);
  });

  it('keeps its marks while the pattern is edited', () => {
    preview([{ start: 0, end: 3 }]);
    field().value = 'bar';
    field().dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('#preview mark')].map((m) => m.textContent)).toEqual([
      'bar',
    ]);
  });
});
