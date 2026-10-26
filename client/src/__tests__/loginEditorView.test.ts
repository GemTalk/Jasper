// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

import { loginEditorHtml } from '../loginEditorHtml';

// The login form's own script, run in jsdom against the HTML the panel writes:
// what a new user sees when the version they need is not on this machine yet.

let posted: { command: string; [k: string]: unknown }[];
/** Stands in for `window` in each render, so one test's listener never hears the next test. */
let messages: EventTarget;

function renderForm(): void {
  const html = loginEditorHtml('0123456789abcdef0123456789abcdef');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.className = '';
  document.body.innerHTML = doc.body.innerHTML;
  posted = [];
  const script = doc.querySelector('script')!.textContent;
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (m: { command: string }) => posted.push(m),
  });
  messages = new EventTarget();
  new Function('window', script)(messages);
}

function send(data: unknown): void {
  messages.dispatchEvent(new MessageEvent('message', { data }));
}

function select(): HTMLSelectElement {
  return document.getElementById('version') as HTMLSelectElement;
}

function choose(version: string): void {
  select().value = version;
  select().dispatchEvent(new Event('change'));
}

function note(): HTMLElement {
  return document.getElementById('versionDownload')!;
}

const login = { label: '', version: '3.7.5', stone: '', gem_host: '', netldi: '', gs_user: '' };

beforeEach(() => {
  renderForm();
  send({
    command: 'loadData',
    data: login,
    versions: ['3.7.5', '3.7.4', '3.6.2'],
    notDownloaded: ['3.7.4', '3.6.2'],
    readOnly: false,
  });
});

describe('the GemStone Version field', () => {
  it('lists every version, marking the ones not on this machine yet', () => {
    expect(Array.from(select().options).map((o) => [o.value, o.textContent])).toEqual([
      ['3.7.5', '3.7.5'],
      ['3.7.4', '3.7.4 (not yet downloaded)'],
      ['3.6.2', '3.6.2 (not yet downloaded)'],
    ]);
  });

  it('says nothing about downloading for a version already here', () => {
    expect(note().hidden).toBe(true);
  });

  it('choosing a version not here yet reads as a small extra step', () => {
    choose('3.7.4');

    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain('Jasper needs a few files to talk to GemStone 3.7.4.');
    expect(posted).toContainEqual({ command: 'checkVersion', version: '3.7.4' });
  });

  it('shows the download size once the host knows it', () => {
    choose('3.7.4');
    send({ command: 'versionInfo', version: '3.7.4', size: 18_246_198 });

    expect(note().textContent).toContain('(about 18 MB)');
  });

  it('ignores a size answer for a version no longer chosen', () => {
    choose('3.7.4');
    choose('3.6.2');
    send({ command: 'versionInfo', version: '3.7.4', size: 18_246_198 });

    expect(note().textContent).not.toContain('18 MB');
  });

  it('the download button asks the host for that version’s files', () => {
    choose('3.7.4');
    (document.getElementById('downloadVersionBtn') as HTMLButtonElement).click();

    expect(posted).toContainEqual({ command: 'downloadVersion', version: '3.7.4' });
    expect((document.getElementById('downloadVersionBtn') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('when GemTalk publishes no small download, says so and offers no button', () => {
    choose('3.6.2');
    send({ command: 'versionInfo', version: '3.6.2', size: null });

    expect(note().textContent).toContain('no small download of GemStone 3.6.2');
    expect(note().textContent).toContain('GemStone manager');
    expect((document.getElementById('downloadVersionBtn') as HTMLElement).hidden).toBe(true);
  });

  it('a new version list keeps what the user typed and the version they chose', () => {
    choose('3.7.4');
    (document.getElementById('stone') as HTMLInputElement).value = 'typed';

    send({ command: 'versions', versions: ['3.7.5', '3.7.4', '3.6.2'], notDownloaded: ['3.6.2'] });

    expect((document.getElementById('stone') as HTMLInputElement).value).toBe('typed');
    expect(select().value).toBe('3.7.4');
    expect(select().selectedOptions[0].textContent).toBe('3.7.4');
    expect(note().hidden).toBe(true);
  });

  it('a failed download lets the user try again', () => {
    choose('3.7.4');
    (document.getElementById('downloadVersionBtn') as HTMLButtonElement).click();
    send({
      command: 'versions',
      versions: ['3.7.5', '3.7.4'],
      notDownloaded: ['3.7.4'],
      downloaded: '3.7.4',
    });

    expect((document.getElementById('downloadVersionBtn') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a version list arriving mid-download leaves the button busy', () => {
    choose('3.7.4');
    const button = document.getElementById('downloadVersionBtn') as HTMLButtonElement;
    button.click();

    send({ command: 'versions', versions: ['3.7.5', '3.7.4'], notDownloaded: ['3.7.4'] });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Downloading…');
  });

  it('a new login with nothing chosen takes the newest version once the list arrives', () => {
    renderForm();
    send({ command: 'loadData', data: { ...login, version: '' }, versions: [], notDownloaded: [] });
    send({ command: 'versions', versions: ['3.7.5', '3.7.4'], notDownloaded: ['3.7.5', '3.7.4'] });

    expect(select().value).toBe('3.7.5');
    expect(note().hidden).toBe(false);
  });

  it('a new login takes the newest version when the form arrives with the list', () => {
    renderForm();
    send({
      command: 'loadData',
      data: { ...login, version: '' },
      versions: ['3.7.6', '3.7.5'],
      notDownloaded: ['3.7.6', '3.7.5'],
    });

    expect(select().value).toBe('3.7.6');
  });

  it('a new login keeps a version when the form arrives after the list', () => {
    renderForm();
    send({ command: 'versions', versions: ['3.7.6', '3.7.5'], notDownloaded: ['3.7.6', '3.7.5'] });
    send({
      command: 'loadData',
      data: { ...login, version: '' },
      versions: ['3.7.6', '3.7.5'],
      notDownloaded: ['3.7.6', '3.7.5'],
    });

    expect(select().value).toBe('3.7.6');
  });

  it('a saved login with no version shows none rather than a guess', () => {
    renderForm();
    send({
      command: 'loadData',
      data: { ...login, label: 'DataCurator on gs64stone', version: '' },
      versions: ['3.7.6', '3.7.5'],
      notDownloaded: [],
    });

    expect(select().value).toBe('');
  });

  it('saves a version not downloaded yet like any other', () => {
    choose('3.7.4');
    document.getElementById('saveBtn')!.click();

    expect(posted).toContainEqual(
      expect.objectContaining({
        command: 'save',
        data: expect.objectContaining({ version: '3.7.4' }),
      }),
    );
  });

  it('starts from the stone, not the mechanism, in what a new user reads', () => {
    const field = select().closest('.field-group')!;
    const label = field.querySelector('label[for="version"]')!.textContent;
    const help = field.querySelector('.field-help')!.textContent.trim();

    expect(label).toBe('GemStone Version');
    expect(help.startsWith('The GemStone version of the stone you are connecting to.')).toBe(true);
    choose('3.7.4');
    const visible = [label, help.split('.')[0], note().textContent].join(' ');
    expect(visible).not.toMatch(/GCI|client librar|DLL/i);
  });
});

describe('the read-only banner', () => {
  const banner = (id: string) => document.getElementById(id)!;

  it('says the login has an active session when it does', () => {
    send({ command: 'loadData', data: login, versions: [], readOnly: true });

    expect(banner('activeSessionNote').hidden).toBe(false);
    expect(banner('keychainUnreadableNote').hidden).toBe(true);
  });

  it("says the keychain couldn't be read when that is why", () => {
    send({
      command: 'loadData',
      data: login,
      versions: [],
      readOnly: true,
      keychainUnreadable: true,
    });

    expect(banner('activeSessionNote').hidden).toBe(true);
    expect(banner('keychainUnreadableNote').hidden).toBe(false);
  });

  it('asks the host to unlock the form when Edit anyway is clicked', () => {
    (document.getElementById('editAnywayBtn') as HTMLButtonElement).click();

    expect(posted).toContainEqual({ command: 'editAnyway' });
  });
});
