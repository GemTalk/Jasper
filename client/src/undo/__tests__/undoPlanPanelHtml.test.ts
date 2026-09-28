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

  it('asks the host to apply, and to cancel', () => {
    const { posted } = mount();

    (document.getElementById('apply') as HTMLButtonElement).click();
    (document.getElementById('cancel') as HTMLButtonElement).click();

    expect(posted).toEqual([{ command: 'apply' }, { command: 'cancel' }]);
  });
});
