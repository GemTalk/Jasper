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

async function statusAfter(report: Record<string, unknown>): Promise<HTMLElement> {
  document.body.innerHTML = PAGE;
  const view = (
    window as unknown as { JasperAssistantView: { init: (d: Document, v: unknown) => void } }
  ).JasperAssistantView;
  view.init(document, { postMessage: vi.fn(), getState: () => undefined, setState: vi.fn() });
  window.dispatchEvent(new MessageEvent('message', { data: { command: 'mcpStatus', ...report } }));
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
