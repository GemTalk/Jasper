/**
 * Webview-side behavior for the login editor (loginEditorHtml.ts): the form,
 * its help toggle, and the GemStone Version list with its Download files offer.
 *
 * Read at runtime with readWebviewScript and injected as a <script> tag, not
 * bundled, so it must stay listed in .vscodeignore's re-includes. Tested in
 * jsdom by loginEditorView.test.ts.
 */
const vscode = acquireVsCodeApi();
const fields = [
  'version',
  'gem_host',
  'stone',
  'gs_user',
  'gs_password',
  'netldi',
  'host_user',
  'host_password',
];
let originalLabel = null;

let helpOn = false;
function setHelp(on) {
  helpOn = on;
  document.body.classList.toggle('help-on', on);
  const btn = document.getElementById('helpToggle');
  btn.textContent = on ? 'Hide help' : 'Help me login';
  btn.setAttribute('aria-expanded', String(on));
}
document.getElementById('helpToggle').addEventListener('click', () => setHelp(!helpOn));
document.getElementById('docsLink').addEventListener('click', () => {
  vscode.postMessage({ command: 'openDocs' });
});

// Versions with nothing on this machine yet, and download sizes as the host
// reports them (null: no small download is published for this computer).
let notDownloaded = new Set();
const sizes = {};
let downloading = null;
let readOnly = false;
const versionSelect = document.getElementById('version');
const downloadBtn = document.getElementById('downloadVersionBtn');

function fillVersions(versions, missing, chosen) {
  notDownloaded = new Set(missing || []);
  const list = [...(versions || [])];
  if (chosen && !list.includes(chosen)) list.unshift(chosen);
  versionSelect.innerHTML = '';
  for (const v of list) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = notDownloaded.has(v) ? v + ' (not yet downloaded)' : v;
    versionSelect.appendChild(opt);
  }
  versionSelect.value = chosen || '';
}

function showVersionNote() {
  const v = versionSelect.value;
  const note = document.getElementById('versionDownload');
  note.hidden = readOnly || !v || !notDownloaded.has(v);
  if (note.hidden) return;
  const text = document.getElementById('versionDownloadText');
  const sizeText = document.getElementById('versionDownloadSize');
  const size = sizes[v];
  if (size === null) {
    text.textContent =
      'GemTalk publishes no small download of GemStone ' +
      v +
      ' for this computer. Install the full version from the GemStone manager to log in to it.';
    sizeText.textContent = '';
    downloadBtn.hidden = true;
    return;
  }
  text.textContent = 'Jasper needs a few files to talk to GemStone ' + v + '.';
  sizeText.textContent =
    typeof size === 'number' ? '(about ' + Math.max(1, Math.round(size / 1e6)) + ' MB)' : '';
  downloadBtn.hidden = false;
  downloadBtn.disabled = downloading === v;
  downloadBtn.textContent = downloading === v ? 'Downloading…' : 'Download files';
}

function versionChosen() {
  const v = versionSelect.value;
  if (v && notDownloaded.has(v) && !(v in sizes)) {
    vscode.postMessage({ command: 'checkVersion', version: v });
  }
  showVersionNote();
}

versionSelect.addEventListener('change', versionChosen);
downloadBtn.addEventListener('click', () => {
  downloading = versionSelect.value;
  vscode.postMessage({ command: 'downloadVersion', version: downloading });
  showVersionNote();
});

vscode.postMessage({ command: 'requestData' });

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'versions') {
    // A fresh list, from the download site or after a download: the form
    // keeps what the user typed and the version they chose. Only the end of
    // its own download frees the button; the catalog can arrive mid-run.
    if (msg.downloaded && msg.downloaded === downloading) downloading = null;
    fillVersions(msg.versions, msg.notDownloaded, versionSelect.value || (msg.versions || [])[0]);
    versionChosen();
    return;
  }
  if (msg.command === 'versionInfo') {
    sizes[msg.version] = msg.size;
    if (versionSelect.value === msg.version) showVersionNote();
    return;
  }
  if (msg.command === 'loadData') {
    originalLabel = msg.data.label || null;
    readOnly = Boolean(msg.readOnly);
    // A new login starts on the newest version, whichever message brings the
    // list; a saved login shows its own, even a blank one.
    const fallback = originalLabel ? '' : (msg.versions || [])[0];
    fillVersions(msg.versions, msg.notDownloaded, msg.data.version || fallback || '');
    // Populate other fields
    for (const f of fields) {
      if (f === 'version') continue;
      const el = document.getElementById(f);
      if (el) el.value = msg.data[f] || '';
    }
    document.getElementById('password_in_keychain').checked = Boolean(
      msg.data.password_in_keychain,
    );
    // Default on when unset, so existing logins keep syncing.
    document.getElementById('sync_classes').checked = msg.data.sync_classes !== false;

    // Read-only view (an active session, or a keychain that can't be read): show fields but disable
    // every control, hide the Save/Cancel row, and surface the banner.
    versionChosen();
    for (const el of document.querySelectorAll('input, select')) {
      el.disabled = readOnly;
    }
    document.getElementById('readOnlyBanner').style.display = readOnly ? 'block' : 'none';
    document.getElementById('activeSessionNote').hidden = Boolean(msg.keychainUnreadable);
    document.getElementById('keychainUnreadableNote').hidden = !msg.keychainUnreadable;
    document.querySelector('.button-row').style.display = readOnly ? 'none' : 'flex';

    // Default the help open for a brand-new login (the first-use case this is
    // for); keep it closed when editing/viewing an existing one so it stays
    // out of the way. The user can toggle it either way.
    setHelp(!readOnly && !originalLabel);
  }
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const data = {};
  for (const f of fields) {
    data[f] = document.getElementById(f).value;
  }
  data.password_in_keychain = document.getElementById('password_in_keychain').checked;
  data.sync_classes = document.getElementById('sync_classes').checked;
  vscode.postMessage({ command: 'save', data, originalLabel });
});

document.getElementById('editAnywayBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'editAnyway' });
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'cancel' });
});
