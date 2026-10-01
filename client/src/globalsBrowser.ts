import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

export class GlobalsBrowser {
  private static panels = new Map<number, GlobalsBrowser>();

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private isReady = false;
  private pendingGlobals: queries.GlobalEntry[] | null = null;

  static async showOrUpdate(
    session: ActiveSession,
    dictName: string,
    dictIndex: number,
  ): Promise<void> {
    const globals = await queries.getGlobalsForDictionary(session, dictIndex);

    const existing = GlobalsBrowser.panels.get(session.id);
    if (existing) {
      existing.panel.title = `Globals: ${dictName}`;
      existing.panel.reveal(undefined, true);
      existing.send(globals);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneGlobalsBrowser',
      `Globals: ${dictName}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    const browser = new GlobalsBrowser(panel, session);
    GlobalsBrowser.panels.set(session.id, browser);
    browser.send(globals);
  }

  static disposeForSession(sessionId: number): void {
    const browser = GlobalsBrowser.panels.get(sessionId);
    if (browser) browser.panel.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'ready') {
          this.isReady = true;
          this.flush();
        } else if (message.command === 'inspectGlobal') {
          vscode.commands.executeCommand('gemstone.inspectGlobal', {
            className: message.name as string,
          });
        }
      },
      null,
      this.disposables,
    );
  }

  private send(globals: queries.GlobalEntry[]): void {
    this.pendingGlobals = globals;
    this.flush();
  }

  private flush(): void {
    if (this.isReady && this.pendingGlobals !== null) {
      this.panel.webview.postMessage({ command: 'loadGlobals', items: this.pendingGlobals });
      this.pendingGlobals = null;
    }
  }

  private dispose(): void {
    GlobalsBrowser.panels.delete(this.session.id);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Globals</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .table-wrap {
      flex: 1;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    colgroup col:nth-child(1) { width: 22%; }
    colgroup col:nth-child(2) { width: 20%; }
    colgroup col:nth-child(3) { width: 58%; }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--vscode-editor-background);
      padding: 4px 8px;
      text-align: left;
      cursor: pointer;
      user-select: none;
      border-bottom: 2px solid var(--vscode-panel-border);
      white-space: nowrap;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    thead th:hover { background: var(--vscode-list-hoverBackground); }
    .sort-arrow { margin-left: 4px; font-size: 0.75em; }
    td {
      padding: 2px 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .col-class { color: var(--vscode-descriptionForeground); }
    .col-value {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .empty {
      padding: 16px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="table-wrap">
    <table>
      <colgroup><col><col><col></colgroup>
      <thead>
        <tr>
          <th data-col="0">Name<span class="sort-arrow" id="arr0">&#9650;</span></th>
          <th data-col="1">Class<span class="sort-arrow" id="arr1"></span></th>
          <th data-col="2">Value<span class="sort-arrow" id="arr2"></span></th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let rows = [];
    let sortCol = 0;
    let sortAsc = true;

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function render() {
      const sorted = [...rows].sort((a, b) => {
        const va = [a.name, a.className, a.value][sortCol] ?? '';
        const vb = [b.name, b.className, b.value][sortCol] ?? '';
        const cmp = va.localeCompare(vb);
        return sortAsc ? cmp : -cmp;
      });

      const tbody = document.getElementById('tbody');
      if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty">No globals in this dictionary.</td></tr>';
      } else {
        tbody.innerHTML = sorted.map(r =>
          '<tr data-name="' + esc(r.name) + '">' +
          '<td>' + esc(r.name) + '</td>' +
          '<td class="col-class">' + esc(r.className) + '</td>' +
          '<td class="col-value" title="' + esc(r.value) + '">' + esc(r.value) + '</td>' +
          '</tr>'
        ).join('');
        tbody.querySelectorAll('tr').forEach(tr => {
          tr.addEventListener('dblclick', () => {
            vscode.postMessage({ command: 'inspectGlobal', name: tr.dataset.name });
          });
        });
      }

      [0, 1, 2].forEach(i => {
        document.getElementById('arr' + i).innerHTML =
          i === sortCol ? (sortAsc ? '&#9650;' : '&#9660;') : '';
      });
    }

    document.querySelectorAll('thead th').forEach(th => {
      th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col, 10);
        if (sortCol === col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = col;
          sortAsc = true;
        }
        render();
      });
    });

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.command === 'loadGlobals') {
        rows = msg.items;
        render();
      }
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
