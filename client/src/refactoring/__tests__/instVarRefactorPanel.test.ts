// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderInstVarPanelHtml } from '../instVarRefactorPanelHtml';
import { InstVarChange, InstVarOutOfScope } from '../instVarRefactorPreview';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../instVarRefactorPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    chosenOptions: () => string[];
    appendChanges: (html: string, done: boolean) => void;
  };
}
function api(): PanelApi {
  return (globalThis as unknown as { InstVarRefactorPanel: PanelApi }).InstVarRefactorPanel;
}

const edit: InstVarChange = {
  id: '1',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Foo',
  oldSource: 'a',
  newSource: 'b',
};

const oos: InstVarOutOfScope = {
  decline: null,
  willNotRecompile: [],
  actedOnClass: 'Foo',
  currentOptions: ['logCreation'],
  optionVocabulary: ['logCreation', 'modifiable'],
  note: 'commit note',
};

function mount(done = true) {
  const full = renderInstVarPanelHtml({
    title: 'Add tally to Foo',
    total: 1,
    changes: [edit],
    done,
    outOfScope: oos,
    nonce: 'test',
    script: '',
  });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.setAttribute('data-total', '1');
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode };
}

describe('instance-variable refactor panel view', () => {
  it('apply reports the checked class options and both commit flags off by default', () => {
    const { vscode } = mount();
    (document.getElementById('apply') as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'apply',
      deselected: [],
      options: ['logCreation'],
      migrate: false,
      deleteHistory: false,
    });
  });

  it('apply reflects toggled options and the migrate/delete-history checkboxes', () => {
    const { vscode } = mount();
    (document.querySelector('input.opt[value="modifiable"]') as HTMLInputElement).checked = true;
    (document.getElementById('migrate') as HTMLInputElement).checked = true;
    (document.getElementById('deleteHistory') as HTMLInputElement).checked = true;
    (document.getElementById('apply') as HTMLButtonElement).click();
    const msg = vscode.postMessage.mock.calls[0][0] as {
      options: string[];
      migrate: boolean;
      deleteHistory: boolean;
    };
    expect(msg.options.sort()).toEqual(['logCreation', 'modifiable']);
    expect(msg.migrate).toBe(true);
    expect(msg.deleteHistory).toBe(true);
  });

  it('shows an "Apply & Commit" hint when a committing option is checked', () => {
    mount();
    const apply = document.getElementById('apply') as HTMLButtonElement;
    expect(apply.textContent).toBe('Apply');
    const migrate = document.getElementById('migrate') as HTMLInputElement;
    migrate.checked = true;
    migrate.dispatchEvent(new Event('change'));
    expect(apply.textContent).toBe('Apply & Commit');
    expect(apply.classList.contains('commits')).toBe(true);
  });

  it('cancel posts a cancel message', () => {
    const { vscode } = mount();
    (document.getElementById('cancel') as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'cancel' });
  });

  it('More requests another page', () => {
    const { vscode } = mount(false);
    (document.getElementById('more') as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'loadMore' });
  });

  it('appendChanges adds rows and wires their diff toggle', () => {
    const { handle } = mount(false);
    handle.appendChanges(
      '<li class="change" data-id="9"><div class="change-head"><span class="label">Sub</span><button class="toggle">▸</button></div><pre class="diff hidden">x</pre></li>',
      true,
    );
    expect(document.querySelectorAll('li.change').length).toBe(2);
  });
});
