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
    isSystemUser: false,
    descriptionsAvailable: true,
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

  it('states the type and settability in every row info tooltip, with the description when present', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const infoFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')]
        .find((r) => r.querySelector('.config-name')?.textContent?.trim() === key)!
        .querySelector('.config-info')!
        .getAttribute('title') ?? '';

    // The type was invisible before; it now leads the tooltip (issue #232 item 2).
    const described = infoFor('StnGemTimeout');
    expect(described).toContain('Integer');
    expect(described).toContain('runtime-settable');
    expect(described).toContain('How long the stone waits');

    // A read-only config-file key: type shown, marked read-only, no description here.
    const readonly = infoFor('SHR_PAGE_CACHE_SIZE_KB');
    expect(readonly).toContain('Integer');
    expect(readonly).toContain('read-only');

    // Every row has the info affordance, even without a description.
    expect(root.querySelectorAll('tr.config-item').length).toBe(
      root.querySelectorAll('tr.config-item .config-info').length,
    );
  });

  it('shows an editable value as a clickable control with a pencil, and read-only as plain text', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const rowFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')].find(
        (r) => r.querySelector('.config-name')?.textContent?.trim() === key,
      )!;

    // Editable: a value button carrying an always-present pencil (no hover needed).
    const editable = rowFor('StnGemTimeout');
    const btn = editable.querySelector<HTMLButtonElement>(
      '.config-value-btn[data-action="editConfig"]',
    );
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('.config-pencil')).not.toBeNull();

    // Read-only: plain value, no button, no pencil.
    const readonly = rowFor('SHR_PAGE_CACHE_SIZE_KB');
    expect(readonly.querySelector('.config-value-btn')).toBeNull();
    expect(readonly.querySelector('.config-pencil')).toBeNull();
  });

  it('renders Stone and Gem as collapsible groups, and remembers a collapse across redraws', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    const stone = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="stone"]',
    );
    const gem = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="gem"]',
    );
    expect(stone).not.toBeNull();
    expect(gem).not.toBeNull();
    expect(stone!.querySelector('summary.config-group-head')).not.toBeNull();

    // Collapse Stone, then force a redraw — it must stay collapsed.
    stone!.open = false;
    stone!.dispatchEvent(new Event('toggle'));
    sendMessage({ command: 'configuration', config: configPayload() });

    const stoneAfter = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="stone"]',
    )!;
    expect(stoneAfter.open).toBe(false);
    // Gem was left open.
    expect(
      root.querySelector<HTMLDetailsElement>('details.config-group[data-config-group="gem"]')!.open,
    ).toBe(true);
  });

  it('says why a parameter has no description when system.conf was read', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    // SHR_PAGE_CACHE_SIZE_KB has no description in the payload; descriptions were
    // available, so the tooltip explains the miss rather than showing nothing.
    const tip =
      [...root.querySelectorAll('tr.config-item')]
        .find(
          (r) => r.querySelector('.config-name')?.textContent?.trim() === 'SHR_PAGE_CACHE_SIZE_KB',
        )!
        .querySelector('.config-info')!
        .getAttribute('title') ?? '';
    expect(tip).toContain('no matching entry in system.conf');
  });

  it('says why there are no descriptions at all when system.conf was not found', () => {
    const { root } = open(connectedState());
    sendMessage({
      command: 'configuration',
      config: configPayload({
        descriptionsAvailable: false,
        stoneParams: [
          {
            key: 'SHR_PAGE_CACHE_SIZE_KB',
            value: '75000',
            type: 'integer',
            settable: false,
            editable: false,
          },
        ],
        gemParams: [],
      }),
    });

    const tip = root.querySelector('.config-info')!.getAttribute('title') ?? '';
    expect(tip).toContain('system.conf was not found');
  });

  it('marks a runtime key the user cannot change, and offers no editor for it', () => {
    const { root } = open(connectedState());
    // A stone runtime key with editable:false — settable in principle, but this
    // session (not SystemUser) may not change it.
    sendMessage({
      command: 'configuration',
      config: configPayload({
        isSystemUser: false,
        stoneParams: [
          {
            key: 'StnCheckpointInterval',
            value: '300',
            type: 'integer',
            settable: true,
            editable: false,
          },
        ],
        gemParams: [],
      }),
    });

    const row = [...root.querySelectorAll('tr.config-item')].find(
      (r) => r.querySelector('.config-name')?.textContent?.trim() === 'StnCheckpointInterval',
    )!;
    // Still classified runtime, but no editor, and the tooltip says why.
    expect(row.querySelector('.badge-runtime')).not.toBeNull();
    expect(row.querySelector('[data-action="editConfig"]')).toBeNull();
    expect(row.querySelector('.config-info')!.getAttribute('title')).toContain(
      'needs SystemUser to change',
    );
  });

  it('reports the settled value after a set that took', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });
    sendMessage({
      command: 'configurationNotice',
      tone: 'ok',
      message: 'Set StnGemTimeout — the session now reports 90.',
    });

    const notice = root.querySelector('.config-notice');
    expect(notice).not.toBeNull();
    expect(notice!.classList.contains('ok')).toBe(true);
    expect(notice!.textContent).toContain('now reports 90');
  });

  it('warns when a set was accepted but the value did not change', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });
    sendMessage({
      command: 'configurationNotice',
      tone: 'warn',
      message:
        'SpinLockCount was accepted without error, but the session still reports 5000, not 6000.',
    });

    const notice = root.querySelector('.config-notice.warn');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('still reports 5000');
  });

  it('drops a set notice on the next fresh read', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });
    sendMessage({
      command: 'configurationNotice',
      tone: 'ok',
      message: 'Set StnGemTimeout — the session now reports 90.',
    });
    expect(root.querySelector('.config-notice')).not.toBeNull();

    sendMessage({ command: 'configuration', config: configPayload() });
    expect(root.querySelector('.config-notice')).toBeNull();
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

describe('filter clear', () => {
  const filterBox = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>('[data-config-filter]')!;
  const clearBtn = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('[data-config-filter-clear]')!;

  it('shows the × only when the filter has text, and clears the filter in place', () => {
    const { root, host } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    // Empty filter: no × to see.
    expect(clearBtn(root).hidden).toBe(true);

    // Type a filter: rows narrow and the × appears.
    const box = filterBox(root);
    box.value = 'StnGemTimeout';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clearBtn(root).hidden).toBe(false);
    const visible = () =>
      [...root.querySelectorAll<HTMLElement>('tr.config-item')].filter(
        (r) => r.style.display !== 'none',
      );
    expect(visible().length).toBe(1);

    // Click the ×: the box empties, every row is shown again, and the × hides —
    // all in place, with no message to the host.
    host.postMessage.mockClear();
    clearBtn(root).click();
    expect(box.value).toBe('');
    expect(clearBtn(root).hidden).toBe(true);
    expect(visible().length).toBe(root.querySelectorAll('tr.config-item').length);
    expect(host.postMessage).not.toHaveBeenCalled();
  });
});

describe('info tooltip pinning', () => {
  const infoFor = (root: HTMLElement, key: string) =>
    [...root.querySelectorAll('tr.config-item')]
      .find((r) => r.querySelector('.config-name')?.textContent?.trim() === key)!
      .querySelector<HTMLButtonElement>('.config-info')!;

  it('pins the tooltip on click and closes it on a second click', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    // Hover still works: the title is untouched.
    const info = infoFor(root, 'StnGemTimeout');
    expect(info.getAttribute('title')).toContain('How long the stone waits');

    // Click pins a bubble carrying the same text.
    info.click();
    const pop = document.querySelector('.config-info-pop');
    expect(pop).not.toBeNull();
    expect(pop!.textContent).toContain('How long the stone waits');

    // A second click on the same ⓘ dismisses it.
    info.click();
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('closes the pinned tooltip on a redraw', () => {
    const { root } = open(connectedState());
    sendMessage({ command: 'configuration', config: configPayload() });

    infoFor(root, 'StnGemTimeout').click();
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    api().render(connectedState());
    expect(document.querySelector('.config-info-pop')).toBeNull();
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
