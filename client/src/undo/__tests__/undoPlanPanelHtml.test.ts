// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderUndoPlanHtml } from '../undoPlanPanelHtml';
import type { UndoPlan } from '../undoPlan';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../undoPlanPanelView.js'), 'utf8');
  new Function(source)();
});

function api(): { wire: (doc: Document, vscode: { postMessage: (m: unknown) => void }) => void } {
  return (globalThis as unknown as { UndoPlanPanel: ReturnType<typeof api> }).UndoPlanPanel;
}

const plan: UndoPlan = {
  verb: 'Undo',
  label: 'Add class variable Registry to Shadowed (DictionaryB)',
  rows: [
    { id: 'a0', action: 'remove', target: 'Shadowed class >> #registry' },
    { id: 'a1', action: 'remove', target: 'Shadowed class >> #registry:' },
    { id: 'var', action: 'remove class variable', target: 'Shadowed  Registry' },
  ],
};

const html = (p: UndoPlan = plan): string =>
  renderUndoPlanHtml({ plan: p, nonce: 'n', script: '' });

function mount(p: UndoPlan = plan): { posted: unknown[] } {
  document.documentElement.innerHTML = html(p);
  const posted: unknown[] = [];
  api().wire(document, { postMessage: (m) => posted.push(m) });
  return { posted };
}

/**
 * The panel every undo now opens (#396 review). Its job is to say what the reversal will do
 * before it does it, in the same shape the refactoring undo already used -- so that "Undo" is one
 * experience rather than two.
 */
describe('renderUndoPlanHtml', () => {
  it('titles itself with the verb and the recorded label, dictionary and all', () => {
    expect(html()).toContain(
      'Undo <code>Add class variable Registry to Shadowed (DictionaryB)</code>',
    );
  });

  it('uses the entry\u2019s own verb, so a class edit still calls itself a Revert', () => {
    const out = html({ ...plan, verb: 'Revert' });
    expect(out).toContain('Revert <code>');
    expect(out).toContain('>Revert 3<');
  });

  it('lists every row with its action and target', () => {
    mount();
    const rows = Array.from(document.querySelectorAll('li.change'));
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.action')?.textContent).toBe('remove');
    expect(rows[2].querySelector('.label')?.textContent).toBe('Shadowed  Registry');
  });

  it('shows the rows ticked and fixed, because a reversal applies whole', () => {
    // A tick the user could clear would be a lie: the local reversers have no partial mode.
    mount();
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input.sel'));
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.checked && b.disabled)).toBe(true);
    expect(document.body.textContent).toContain('all applied together');
  });

  // Informational, true of every undo, and worth knowing once -- so a disclosure rather than a
  // banner. Boxed at the top of every single reversal it is noise sitting above the one thing
  // the reader opened the panel for.
  describe('the standing caveat about which change is on top', () => {
    it('is present, and says what it always said', () => {
      expect(html()).toContain('not necessarily');
      expect(html()).toContain('an action that cannot be reversed records nothing');
    });

    it('is collapsed behind a disclosure rather than shown as a banner', () => {
      mount();
      const why = document.querySelector('details.why') as HTMLDetailsElement;

      expect(why).not.toBeNull();
      expect(why.open).toBe(false);
      expect(why.querySelector('summary')?.textContent).toBe('Why this change?');
      // not in the warning box -- that is reserved for what THIS reversal costs
      expect(document.querySelector('.oos')).toBeNull();
    });

    it('keeps the warning box for a reversal that really costs something', () => {
      document.documentElement.innerHTML = html({
        ...plan,
        note: 'anything written since is left behind',
      });

      expect(document.querySelector('.oos')?.textContent).toBe(
        'anything written since is left behind',
      );
      // the caveat is still its own disclosure, not merged into the box
      expect(document.querySelector('.oos')?.textContent).not.toContain('not necessarily');
      expect(document.querySelector('details.why')).not.toBeNull();
    });
  });

  it('shows a note above the rows when the reversal costs something', () => {
    const out = html({ ...plan, note: 'anything written since is left behind' });
    expect(out).toContain('anything written since is left behind');
  });

  it('shows a detail line only for the rows that have one', () => {
    const out = html({
      ...plan,
      rows: [
        { id: 'a', action: 'restore', target: 'A >> #b', detail: 'back to its earlier source' },
      ],
    });
    expect(out).toContain('back to its earlier source');
    expect(html()).not.toContain('class="detail"');
  });

  it('escapes a label rather than letting it reach the DOM as markup', () => {
    const out = html({ ...plan, label: '<img src=x>' });
    expect(out).not.toContain('<img src=x>');
    expect(out).toContain('&lt;img src=x&gt;');
  });

  // The script must wire ITSELF in the webview: exporting `wire` is enough for a test that calls
  // it, and nothing else ever would -- so the panel rendered with dead buttons.
  it('wires itself when the webview api is present, without anyone calling wire', () => {
    const posted: unknown[] = [];
    document.documentElement.innerHTML = html();
    (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m),
    });
    try {
      const source = fs.readFileSync(path.resolve(__dirname, '../undoPlanPanelView.js'), 'utf8');
      new Function(source)();

      (document.getElementById('apply') as HTMLButtonElement).click();

      expect(posted).toEqual([{ command: 'apply' }]);
    } finally {
      delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    }
  });

  it('asks the host to apply, and to cancel', () => {
    const { posted } = mount();

    (document.getElementById('apply') as HTMLButtonElement).click();
    (document.getElementById('cancel') as HTMLButtonElement).click();

    expect(posted).toEqual([{ command: 'apply' }, { command: 'cancel' }]);
  });

  // The same Enter-to-Enter flow as the refactoring panels: whatever opened this panel, Enter
  // runs it, so a keyboard user is not stranded at the last step.
  describe('Enter applies', () => {
    const press = (target: Element | Document): void => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    };

    it('focuses Apply when the panel opens, making it the default button', () => {
      mount();

      expect(document.activeElement).toBe(document.getElementById('apply'));
    });

    it('applies on Enter from the page', () => {
      const { posted } = mount();

      press(document.body);

      expect(posted).toEqual([{ command: 'apply' }]);
    });

    it('leaves Enter alone on a button, so Cancel with focus stays Cancel', () => {
      const { posted } = mount();

      press(document.getElementById('cancel')!);

      expect(posted).toEqual([]);
    });

    it('leaves Enter alone on the disclosure, which toggles itself', () => {
      const { posted } = mount();

      press(document.querySelector('details.why summary')!);

      expect(posted).toEqual([]);
    });
  });
});
