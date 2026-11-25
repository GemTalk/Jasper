// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

beforeAll(() => {
  new Function(fs.readFileSync(path.resolve(__dirname, '../assistantView.js'), 'utf8'))();
});

const PAGE =
  '<div id="status" class="status" hidden></div><main id="log"></main>' +
  '<div id="working" hidden><span id="workingLabel"></span><span id="workingTime"></span></div>' +
  '<input type="checkbox" id="guiUpdates" checked>' +
  '<form id="composer"><textarea id="input"></textarea><button id="newConversation"></button>' +
  '<button id="stop" hidden></button><button id="send"></button></form>';

function mount(): { postMessage: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = PAGE;
  const view = (
    window as unknown as { JasperAssistantView: { init: (d: Document, v: unknown) => void } }
  ).JasperAssistantView;
  const vscode = { postMessage: vi.fn(), getState: () => undefined, setState: vi.fn() };
  view.init(document, vscode);
  return vscode;
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

async function statusAfter(report: Record<string, unknown>): Promise<HTMLElement> {
  mount();
  post({ command: 'mcpStatus', ...report });
  return document.getElementById('status')!;
}

describe("the assistant's status line", () => {
  it('names the session the tools act on', async () => {
    const status = await statusAfter({ state: 'this', servedSession: 'DataCurator on gs64stone' });

    expect(status.textContent).toBe('Tools act on: DataCurator on gs64stone');
    expect(status.classList.contains('alert')).toBe(false);
  });

  it('stands out, and says to log in, when no session is logged in', async () => {
    const status = await statusAfter({ state: 'this' });

    expect(status.classList.contains('alert')).toBe(true);
    expect(status.textContent).toMatch(/No GemStone session is logged in.*Log in, then ask\./);
  });
});

describe('a reopened assistant panel', () => {
  it('shows the conversation so far, questions and answers in order', () => {
    mount();

    post({
      command: 'replay',
      log: [
        { command: 'user', text: 'How many classes?' },
        {
          command: 'event',
          event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Three.' }] } },
        },
        { command: 'event', event: { type: 'result', subtype: 'success', duration_ms: 1500 } },
      ],
    });

    const log = document.getElementById('log')!;
    expect(log.textContent).toMatch(/How many classes\?.*Three\..*1\.5s/s);
    expect(document.getElementById('send')!.hasAttribute('disabled')).toBe(false);
  });

  it('replaces what it showed rather than adding to it', () => {
    mount();
    const once = { command: 'replay', log: [{ command: 'user', text: 'Hello' }] };

    post(once);
    post(once);

    expect(document.querySelectorAll('#log .msg.user').length).toBe(1);
  });
});

describe('the banner under a result shown in Jasper', () => {
  function showResult(tool: string): HTMLButtonElement | null {
    post({
      command: 'event',
      event: {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: `mcp__jasper__${tool}`, input: {} }],
        },
      },
    });
    post({
      command: 'event',
      event: {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Showing 3.' }] },
      },
    });
    return document.querySelector<HTMLButtonElement>('.gui-result button');
  }

  it('brings up Assistant Results for a list', () => {
    const vscode = mount();

    const button = showResult('show_trail_in_search')!;
    button.click();

    expect(button.textContent).toBe('Show Assistant Results');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'revealResults' });
  });

  it('brings up GemStone Search for a regular-expression search', () => {
    mount();

    const button = showResult('show_regex_source_search');

    expect(button!.textContent).toBe('Show GemStone Search');
  });

  it('has no button for what opens in the Explorer', () => {
    mount();

    const button = showResult('show_class_in_explorer');

    expect(button).toBeNull();
  });
});
