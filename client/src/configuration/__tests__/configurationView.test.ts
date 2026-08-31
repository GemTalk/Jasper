// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate the webview script in jsdom so it registers the global GemstoneConfig,
// exactly as the panel does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../configurationView.js'), 'utf8');
  new Function(source)();
});

type Host = { postMessage: ReturnType<typeof vi.fn> };
type GemstoneConfigApi = {
  init(refs: { root: HTMLElement }, api: Host, meta?: { label: string; version: string }): void;
  render(): void;
};

function api(): GemstoneConfigApi {
  return (globalThis as unknown as { GemstoneConfig: GemstoneConfigApi }).GemstoneConfig;
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

function open(): { root: HTMLElement; host: Host } {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const host: Host = { postMessage: vi.fn() };
  api().init({ root }, host, { label: 'DataCurator on jasper', version: '3.6.2' });
  return { root, host };
}

function sendMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('opening the panel', () => {
  it('shows the working state and the session label until values arrive', () => {
    const { root } = open();
    expect(root.textContent).toContain('Reading configuration…');
    expect(root.textContent).toContain('DataCurator on jasper');
    expect(root.querySelector('.config-panel-title')?.textContent).toBe('Session Configuration');
  });

  it('re-reads when Refresh is clicked', () => {
    const { root, host } = open();
    root.querySelector<HTMLButtonElement>('[data-action="loadConfiguration"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'loadConfiguration' });
  });

  it('pings the session from the page (Ping is session maintenance, not a setting)', () => {
    const { root, host } = open();
    root.querySelector<HTMLButtonElement>('[data-action="ping"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'ping' });
  });

  it('shows a positive ping result beside the button, and auto-clears it after 5s', () => {
    vi.useFakeTimers();
    try {
      const { root } = open();
      sendMessage({ command: 'pingResult', tone: 'ok', message: 'Session 1 is active.' });

      const notice = root.querySelector('.config-panel-actions .ping-result.ok');
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toContain('active');
      // A success carries no Dismiss — it clears itself.
      expect(notice!.querySelector('[data-action="dismissPing"]')).toBeNull();

      vi.advanceTimersByTime(5000);
      expect(root.querySelector('.ping-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed ping up with Dismiss (and Copy), and does not auto-clear it', () => {
    vi.useFakeTimers();
    try {
      const { root } = open();
      sendMessage({ command: 'pingResult', tone: 'warn', message: 'Session 1 did not respond.' });

      const notice = root.querySelector('.ping-result.warn');
      expect(notice).not.toBeNull();
      expect(notice!.querySelector('[data-action="dismissPing"]')).not.toBeNull();
      expect(notice!.querySelector('[data-action="copyNotice"]')).not.toBeNull();

      vi.advanceTimersByTime(10000);
      expect(root.querySelector('.ping-result.warn')).not.toBeNull();

      root.querySelector<HTMLButtonElement>('[data-action="dismissPing"]')!.click();
      expect(root.querySelector('.ping-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('rendering the configuration', () => {
  it('renders the parameters the host sends back', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const keys = [...root.querySelectorAll('.config-key')].map((c) => c.textContent?.trim());
    expect(keys).toContain('StnGemTimeout');
    expect(keys).toContain('SHR_PAGE_CACHE_SIZE_KB');
    expect(keys).toContain('GemConvertArrayBuilder');
  });

  it('badges an editable value Editable and a config-file value Read-only', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const rowFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')].find((r) =>
        r.querySelector('.config-key')?.textContent?.trim().startsWith(key),
      )!;
    expect(rowFor('StnGemTimeout').querySelector('.badge-editable')).not.toBeNull();
    expect(rowFor('StnGemTimeout').querySelector('[data-action="editConfig"]')).not.toBeNull();
    expect(rowFor('SHR_PAGE_CACHE_SIZE_KB').querySelector('.badge-readonly')).not.toBeNull();
    expect(rowFor('SHR_PAGE_CACHE_SIZE_KB').querySelector('[data-action="editConfig"]')).toBeNull();
  });

  it('states the type and what you can do in every row info tooltip, with the description when present', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const infoFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')]
        .find((r) => r.querySelector('.config-name')?.textContent?.trim() === key)!
        .querySelector('.config-info')!
        .getAttribute('data-tip') ?? '';

    const described = infoFor('StnGemTimeout');
    expect(described).toContain('Integer');
    expect(described).toContain('Editable');
    expect(described).toContain('How long the stone waits');

    // A config-file value: type shown, and the tooltip says it can't be changed here.
    const readonly = infoFor('SHR_PAGE_CACHE_SIZE_KB');
    expect(readonly).toContain('Integer');
    expect(readonly).toContain('Read-only');
    expect(readonly).toContain('config file');

    expect(root.querySelectorAll('tr.config-item').length).toBe(
      root.querySelectorAll('tr.config-item .config-info').length,
    );
  });

  it('shows an editable value as a clickable control with a pencil, and read-only as plain text', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const rowFor = (key: string) =>
      [...root.querySelectorAll('tr.config-item')].find(
        (r) => r.querySelector('.config-name')?.textContent?.trim() === key,
      )!;

    const editable = rowFor('StnGemTimeout');
    const btn = editable.querySelector<HTMLButtonElement>(
      '.config-value-btn[data-action="editConfig"]',
    );
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('.config-pencil')).not.toBeNull();

    const readonly = rowFor('SHR_PAGE_CACHE_SIZE_KB');
    expect(readonly.querySelector('.config-value-btn')).toBeNull();
    expect(readonly.querySelector('.config-pencil')).toBeNull();
  });

  it('renders Stone and Gem as collapsible groups, and remembers a collapse across redraws', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const stone = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="stone"]',
    );
    const gem = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="gem"]',
    );
    expect(stone).not.toBeNull();
    expect(gem).not.toBeNull();
    // The panel is titled "Session Configuration", so the halves are named for
    // what they are — "Session" here would mean something narrower one line
    // below where it already means the whole panel.
    expect(stone!.querySelector('.config-group-title')?.textContent).toBe('Stone');
    expect(gem!.querySelector('.config-group-title')?.textContent).toBe('Gem');

    stone!.open = false;
    stone!.dispatchEvent(new Event('toggle'));
    sendMessage({ command: 'configuration', config: configPayload() });

    const stoneAfter = root.querySelector<HTMLDetailsElement>(
      'details.config-group[data-config-group="stone"]',
    )!;
    expect(stoneAfter.open).toBe(false);
    expect(
      root.querySelector<HTMLDetailsElement>('details.config-group[data-config-group="gem"]')!.open,
    ).toBe(true);
  });

  it('says why a parameter has no description when system.conf was read', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const tip =
      [...root.querySelectorAll('tr.config-item')]
        .find(
          (r) => r.querySelector('.config-name')?.textContent?.trim() === 'SHR_PAGE_CACHE_SIZE_KB',
        )!
        .querySelector('.config-info')!
        .getAttribute('data-tip') ?? '';
    expect(tip).toContain('no matching entry in system.conf');
  });

  it('says why there are no descriptions at all when system.conf was not found', () => {
    const { root } = open();
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

    const tip = root.querySelector('.config-info')!.getAttribute('data-tip') ?? '';
    expect(tip).toContain('system.conf was not found');
  });

  it('reads a runtime key the user cannot change as Read-only, and says why — never "changeable"', () => {
    // A stone runtime key with editable:false — a runtime parameter in principle,
    // but this session (not SystemUser) may not change it. It must NOT read as
    // changeable: it is badged Read-only, offers no editor, and the tooltip says
    // it needs SystemUser (the LogOriginTime class of complaint).
    const { root } = open();
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
    expect(row.querySelector('.badge-readonly')).not.toBeNull();
    expect(row.querySelector('.badge-editable')).toBeNull();
    expect(row.querySelector('[data-action="editConfig"]')).toBeNull();
    expect(row.querySelector('.config-info')!.getAttribute('data-tip')).toContain('SystemUser');
  });
});

describe('set results', () => {
  // The row the notice should attach to, and the banner beneath it.
  const rowOf = (root: HTMLElement, key: string) =>
    [...root.querySelectorAll('tr.config-item')].find(
      (r) => r.querySelector('.config-name')?.textContent?.trim() === key,
    )!;

  it('reports the settled value in a banner under the row that was set, and auto-clears it', () => {
    vi.useFakeTimers();
    try {
      const { root } = open();
      sendMessage({ command: 'configuration', config: configPayload() });
      sendMessage({
        command: 'setResult',
        scope: 'stone',
        key: 'StnGemTimeout',
        tone: 'ok',
        message: 'Set StnGemTimeout — the session now reports 90.',
      });

      // The banner rides directly under the StnGemTimeout row (not at the top).
      const banner = rowOf(root, 'StnGemTimeout').nextElementSibling!;
      expect(banner.classList.contains('config-notice-row')).toBe(true);
      const notice = banner.querySelector('.config-notice.ok')!;
      expect(notice.textContent).toContain('now reports 90');
      // Success clears itself and offers no Dismiss.
      expect(notice.querySelector('[data-action="dismissSet"]')).toBeNull();

      vi.advanceTimersByTime(5000);
      expect(root.querySelector('.config-notice-row')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed set under its row with Copy and Dismiss, and does not auto-clear it', () => {
    vi.useFakeTimers();
    try {
      const { root } = open();
      sendMessage({ command: 'configuration', config: configPayload() });
      sendMessage({
        command: 'setResult',
        scope: 'stone',
        key: 'StnGemTimeout',
        tone: 'warn',
        message: 'StnGemTimeout could not be set: SecurityError.',
      });

      const banner = rowOf(root, 'StnGemTimeout').nextElementSibling!;
      const notice = banner.querySelector('.config-notice.warn')!;
      expect(notice.textContent).toContain('could not be set');
      expect(notice.querySelector('[data-action="dismissSet"]')).not.toBeNull();
      expect(notice.querySelector('[data-action="copyNotice"]')).not.toBeNull();

      vi.advanceTimersByTime(10000);
      expect(root.querySelector('.config-notice.warn')).not.toBeNull();

      root.querySelector<HTMLButtonElement>('[data-action="dismissSet"]')!.click();
      expect(root.querySelector('.config-notice-row')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('copies a failed set message through the host', () => {
    const { root, host } = open();
    sendMessage({ command: 'configuration', config: configPayload() });
    sendMessage({
      command: 'setResult',
      scope: 'stone',
      key: 'StnGemTimeout',
      tone: 'warn',
      message: 'StnGemTimeout could not be set: SecurityError.',
    });
    root.querySelector<HTMLButtonElement>('[data-action="copyNotice"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'copyText',
      text: 'StnGemTimeout could not be set: SecurityError.',
    });
  });

  it('drops a set banner on the next fresh read', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });
    sendMessage({
      command: 'setResult',
      scope: 'stone',
      key: 'StnGemTimeout',
      tone: 'warn',
      message: 'StnGemTimeout could not be set.',
    });
    expect(root.querySelector('.config-notice-row')).not.toBeNull();

    sendMessage({ command: 'configuration', config: configPayload() });
    expect(root.querySelector('.config-notice-row')).toBeNull();
  });

  it('shows the error when the read is refused, and offers to try again', () => {
    const { root } = open();
    sendMessage({ command: 'configurationError', message: 'Session is busy.' });
    expect(root.textContent).toContain('Session is busy.');
    expect(root.querySelector('[data-action="loadConfiguration"]')).not.toBeNull();
  });
});

describe('filtering', () => {
  const visibleKeys = (root: HTMLElement) =>
    [...root.querySelectorAll('tr.config-item')]
      .filter((r) => (r as HTMLElement).style.display !== 'none')
      .map((r) => r.querySelector('.config-key')?.textContent?.trim());
  const typeFilter = (root: HTMLElement, text: string) => {
    const box = root.querySelector<HTMLInputElement>('[data-config-filter]')!;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('matches keys case-insensitively', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });
    typeFilter(root, 'STN'); // upper-case still matches
    expect(visibleKeys(root)).toEqual(['StnGemTimeout']);
  });

  it('matches anywhere in the key, so a word from the middle of a name finds it', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });
    // "timeout" is the end of StnGemTimeout, and "cache" the middle of
    // SHR_PAGE_CACHE_SIZE_KB — the words someone actually types to narrow the
    // report, and the case a prefix match would find nothing for.
    typeFilter(root, 'timeout');
    expect(visibleKeys(root)).toEqual(['StnGemTimeout']);
    typeFilter(root, 'cache');
    expect(visibleKeys(root)).toEqual(['SHR_PAGE_CACHE_SIZE_KB']);
  });

  it('keeps every key containing the text, including one that only contains it', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });
    typeFilter(root, 'Gem');
    // StnGemTimeout carries "Gem" in the middle, so a substring filter keeps it
    // alongside the Gem* parameter.
    expect(visibleKeys(root)).toEqual(['StnGemTimeout', 'GemConvertArrayBuilder']);
  });

  it('keeps the filter text, filtered rows, and box focus across a redraw', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const box = root.querySelector<HTMLInputElement>('[data-config-filter]')!;
    box.value = 'stn';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();

    api().render();

    const box2 = root.querySelector<HTMLInputElement>('[data-config-filter]')!;
    expect(box2.value).toBe('stn');
    const visible = [...root.querySelectorAll('tr.config-item')].filter(
      (r) => (r as HTMLElement).style.display !== 'none',
    );
    expect(visible.map((r) => r.querySelector('.config-key')?.textContent?.trim())).toEqual([
      'StnGemTimeout',
    ]);
    expect(document.activeElement).toBe(box2);
  });

  it('shows the × only when the filter has text, and clears the filter in place', () => {
    const { root, host } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const filterBox = () => root.querySelector<HTMLInputElement>('[data-config-filter]')!;
    const clearBtn = () => root.querySelector<HTMLButtonElement>('[data-config-filter-clear]')!;

    expect(clearBtn().hidden).toBe(true);

    const box = filterBox();
    box.value = 'StnGemTimeout';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clearBtn().hidden).toBe(false);
    const visible = () =>
      [...root.querySelectorAll<HTMLElement>('tr.config-item')].filter(
        (r) => r.style.display !== 'none',
      );
    expect(visible().length).toBe(1);

    host.postMessage.mockClear();
    clearBtn().click();
    expect(box.value).toBe('');
    expect(clearBtn().hidden).toBe(true);
    expect(visible().length).toBe(root.querySelectorAll('tr.config-item').length);
    expect(host.postMessage).not.toHaveBeenCalled();
  });
});

describe('editing a value', () => {
  it('opens an inline editor for a settable value and sends the new one', () => {
    const { root, host } = open();
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
    const { root, host } = open();
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
    const { root, host } = open();
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

  const openEditor = (root: HTMLElement) => {
    root
      .querySelector<HTMLButtonElement>('[data-action="editConfig"][data-key="StnGemTimeout"]')!
      .click();
    return root.querySelector<HTMLInputElement>('.config-edit [data-config-input]')!;
  };

  it('commits an edit on Enter, the keyboard twin of Set', () => {
    const { root, host } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const input = openEditor(root);
    input.value = '90';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'setConfiguration',
      scope: 'stone',
      key: 'StnGemTimeout',
      valueType: 'integer',
      value: '90',
    });
    expect(root.querySelector('.config-edit')).toBeNull();
  });

  it('abandons an edit on Escape, the keyboard twin of Cancel', () => {
    const { root, host } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const input = openEditor(root);
    input.value = '90';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(root.querySelector('.config-edit')).toBeNull();
    expect(host.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'setConfiguration' }),
    );
  });

  it('keeps an open editor across a redraw, resetting to the stored value', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const input = openEditor(root);
    input.value = '9'; // mid-type
    api().render();

    const reopened = root.querySelector<HTMLInputElement>('.config-edit [data-config-input]');
    expect(reopened).not.toBeNull();
    expect(reopened!.value).toBe('60');
  });
});

describe('info tooltip pinning', () => {
  const infoFor = (root: HTMLElement, key: string) =>
    [...root.querySelectorAll('tr.config-item')]
      .find((r) => r.querySelector('.config-name')?.textContent?.trim() === key)!
      .querySelector<HTMLButtonElement>('.config-info')!;

  it('shows the same styled bubble on hover and on click — no native title', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const info = infoFor(root, 'StnGemTimeout');
    // The look is the panel's own bubble, not a browser title: there is no title
    // attribute; the text lives in data-tip.
    expect(info.getAttribute('title')).toBeNull();
    expect(info.getAttribute('data-tip')).toContain('How long the stone waits');

    // Hover shows the styled bubble (transient).
    info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const hoverPop = document.querySelector('.config-info-pop');
    expect(hoverPop).not.toBeNull();
    expect(hoverPop!.textContent).toContain('How long the stone waits');

    // Moving away closes the transient bubble.
    info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('pins the bubble on click and closes it on a second click', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    const info = infoFor(root, 'StnGemTimeout');
    info.click();
    const pop = document.querySelector('.config-info-pop');
    expect(pop).not.toBeNull();
    expect(pop!.textContent).toContain('How long the stone waits');

    // A pinned bubble survives a mouseout (unlike the hover one).
    info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    info.click();
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('closes the pinned tooltip on a redraw', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    infoFor(root, 'StnGemTimeout').click();
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    api().render();
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('closes on a click away, but not on a click inside the bubble', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    infoFor(root, 'StnGemTimeout').click();
    const pop = document.querySelector<HTMLElement>('.config-info-pop')!;
    expect(pop).not.toBeNull();

    pop.click();
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    document.body.click();
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('closes the pinned tooltip on Escape', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    infoFor(root, 'StnGemTimeout').click();
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });

  it('closes the pinned tooltip on scroll (it is fixed to the icon position)', () => {
    const { root } = open();
    sendMessage({ command: 'configuration', config: configPayload() });

    infoFor(root, 'StnGemTimeout').click();
    expect(document.querySelector('.config-info-pop')).not.toBeNull();

    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.config-info-pop')).toBeNull();
  });
});
