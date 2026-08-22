// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate the webview script in jsdom so it registers the global
// GemstoneManager, exactly as the panel does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../gemstoneManagerView.js'), 'utf8');
  new Function(source)();
});

type Host = { postMessage: ReturnType<typeof vi.fn> };
type GemstoneManagerApi = {
  init(refs: { root: HTMLElement }, api: Host): void;
  render(state: unknown): void;
};

function api(): GemstoneManagerApi {
  return (globalThis as unknown as { GemstoneManager: GemstoneManagerApi }).GemstoneManager;
}

const HEALTHY_OS = {
  supported: true,
  platformLabel: 'macOS',
  sharedMemoryConfigured: true,
  gbLabel: '2.0',
  unknown: false,
};

/** A state with a selected session, so the Configuration section appears. */
function connectedState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'x86_64.Darwin',
    rootPath: '/gs',
    os: HEALTHY_OS,
    versions: [
      { version: '3.6.2', fileName: '', size: 0, date: '', downloaded: false, extracted: true },
    ],
    databases: [],
    logins: [],
    session: {
      connected: true,
      sessionId: 1,
      label: 'DataCurator on jasper',
      user: 'DataCurator',
      stone: 'jasper',
      version: '3.6.2',
    },
    ...overrides,
  };
}

/** The configuration payload the host posts in reply to loadConfiguration. */
function configPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 1,
    label: 'DataCurator on jasper',
    version: '3.6.2',
    stoneParams: [
      {
        key: 'StnGemTimeout',
        value: '60',
        type: 'integer',
        settable: true,
        editable: true,
        description: 'How long the stone waits for a gem.',
      },
      {
        key: 'SHR_PAGE_CACHE_SIZE_KB',
        value: '75000',
        type: 'integer',
        settable: false,
        editable: false,
      },
    ],
    gemParams: [
      {
        key: 'GemConvertArrayBuilder',
        value: 'true',
        type: 'boolean',
        settable: true,
        editable: true,
      },
    ],
    ...overrides,
  };
}

function open(managerState: Record<string, unknown>): { root: HTMLElement; host: Host } {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const host: Host = { postMessage: vi.fn() };
  api().init({ root }, host);
  api().render(managerState);
  return { root, host };
}

function sendMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function configSection(root: HTMLElement): HTMLDetailsElement | null {
  return root.querySelector<HTMLDetailsElement>('details.section[data-section="configuration"]');
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Configuration section visibility', () => {
  it('does not appear without a connected session', () => {
    const { root } = open(connectedState({ session: { connected: false } }));
    expect(configSection(root)).toBeNull();
  });

  it('appears the moment a session is selected, before any values load', () => {
    const { root } = open(connectedState());
    const section = configSection(root);
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Load configuration');
  });
});

describe('loading configuration', () => {
  it('asks the host to read the values when opened', () => {
    const { root, host } = open(connectedState());
    const section = configSection(root)!;
    section.open = true;
    section.dispatchEvent(new Event('toggle'));
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'loadConfiguration' });
  });

  it('asks again when Refresh / Load is clicked', () => {
    const { root, host } = open(connectedState());
    root.querySelector<HTMLButtonElement>('[data-action="loadConfiguration"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'loadConfiguration' });
  });

  it('renders the parameters the host sends back', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const keys = [...root.querySelectorAll('.config-key')].map((c) => c.textContent?.trim());
    expect(keys).toContain('StnGemTimeout');
    expect(keys).toContain('SHR_PAGE_CACHE_SIZE_KB');
    expect(keys).toContain('GemConvertArrayBuilder');
  });

  it('marks runtime keys settable and config-file keys read-only', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const rowFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')].find((r) =>
        r.querySelector('.config-key')?.textContent?.trim().startsWith(key),
      )!;
    expect(rowFor('StnGemTimeout').querySelector('.badge-runtime')).not.toBeNull();
    expect(rowFor('StnGemTimeout').querySelector('[data-action="editConfig"]')).not.toBeNull();
    expect(rowFor('SHR_PAGE_CACHE_SIZE_KB').querySelector('.badge-readonly')).not.toBeNull();
    expect(rowFor('SHR_PAGE_CACHE_SIZE_KB').querySelector('[data-action="editConfig"]')).toBeNull();
  });

  it('carries a description into the key tooltip', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });
    const tip = root.querySelector('.config-key span')?.getAttribute('title') ?? '';
    expect(tip).toContain('How long the stone waits');
  });

  it('shows the error when the read is refused, and offers to try again', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configurationError', message: 'Session is busy.' });
    const section = configSection(root)!;
    expect(section.textContent).toContain('Session is busy.');
    expect(section.querySelector('[data-action="loadConfiguration"]')).not.toBeNull();
  });
});

describe('filtering', () => {
  it('hides the rows whose key does not match', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const filter = root.querySelector<HTMLInputElement>('[data-config-filter]')!;
    filter.value = 'stn';
    filter.dispatchEvent(new Event('input', { bubbles: true }));

    const visible = [...root.querySelectorAll('tr.config-item')].filter(
      (r) => (r as HTMLElement).style.display !== 'none',
    );
    const keys = visible.map((r) => r.querySelector('.config-key')?.textContent?.trim());
    expect(keys).toEqual(['StnGemTimeout']);
  });
});

describe('editing a value', () => {
  it('opens an inline editor for a settable value and sends the new one', () => {
    const { root, host } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    root
      .querySelector<HTMLButtonElement>('[data-action="editConfig"][data-key="StnGemTimeout"]')!
      .click();

    const input = root.querySelector<HTMLInputElement>('.config-edit [data-config-input]')!;
    expect(input.value).toBe('60');
    input.value = '90';

    root
      .querySelector<HTMLButtonElement>('[data-action="saveConfig"][data-key="StnGemTimeout"]')!
      .click();

    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'setConfiguration',
      scope: 'stone',
      key: 'StnGemTimeout',
      valueType: 'integer',
      value: '90',
    });
  });

  it('edits a boolean through a true/false select', () => {
    const { root, host } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    root
      .querySelector<HTMLButtonElement>(
        '[data-action="editConfig"][data-key="GemConvertArrayBuilder"]',
      )!
      .click();

    const select = root.querySelector<HTMLSelectElement>('.config-edit select[data-config-input]')!;
    expect(select.value).toBe('true');
    select.value = 'false';

    root
      .querySelector<HTMLButtonElement>(
        '[data-action="saveConfig"][data-key="GemConvertArrayBuilder"]',
      )!
      .click();

    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'setConfiguration',
      scope: 'gem',
      key: 'GemConvertArrayBuilder',
      valueType: 'boolean',
      value: 'false',
    });
  });

  it('abandons an edit on Cancel without sending anything', () => {
    const { root, host } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    root
      .querySelector<HTMLButtonElement>('[data-action="editConfig"][data-key="StnGemTimeout"]')!
      .click();
    root
      .querySelector<HTMLButtonElement>('[data-action="cancelConfig"][data-key="StnGemTimeout"]')!
      .click();

    expect(root.querySelector('.config-edit')).toBeNull();
    expect(host.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'setConfiguration' }),
    );
  });
});

describe('session changes', () => {
  it('drops configuration read for a session that is no longer selected', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });
    expect(root.querySelector('tr.config-item')).not.toBeNull();

    // A different session is selected: the old values no longer describe it.
    api().render(
      connectedState({ session: { connected: true, sessionId: 2, label: 'x', version: '3.6.2' } }),
    );
    expect(root.querySelector('tr.config-item')).toBeNull();
    expect(configSection(root)!.textContent).toContain('Load configuration');
  });
});
