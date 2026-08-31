// Session Configuration panel — a standalone editor-tab webview that shows one logged-in
// session's stone and gem configuration and lets an editable value be changed.
// It is also where a session's live maintenance happens (Ping). Opened from the
// session's row in the Logins view (see the gemstone.showSessionConfiguration command).
// One panel per session, so two sessions' configuration can be compared side by
// side; a panel closes itself when its session logs out.
//
// The stone and gem configuration reports are read from the session over its
// GCI, and an editable value is written back through that same session. The read
// is on demand: a `loadConfiguration` message (or the panel opening) asks for it,
// and Refresh re-reads. The stone is the authority — a refused or ignored set
// comes back as a `setResult` in the stone's own words, shown beside the row that
// was changed. A load failure (a busy or logged-out session) is a
// `configurationError` shown at the top instead.
//
// Follows the webview conventions established in debuggerPanel.ts:
// createWebviewPanel with a strict CSP, all styles inline
// in the host HTML, all behavior in a companion configurationView.js read at
// module load and injected as a nonce'd <script>. It takes a dependency bag
// rather than importing extension.ts, to avoid a circular import.

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

import { SysadminStorage } from '../sysadminStorage';
import { SessionManager, ActiveSession } from '../sessionManager';
import { loginLabel } from '../loginTypes';
import { readWebviewScript } from '../webviewAssets';
import { appendSysadmin } from '../sysadminChannel';
import { defaultQueryExecutorUsing } from '../browserQueries';
import {
  stoneConfiguration,
  gemConfiguration,
  setConfiguration as setSessionConfiguration,
  sessionIsSystemUser,
  configValuesMatch,
  isEditable,
  ConfigScope,
  ConfigValueType,
  ConfigEntry,
} from './queries/configurationReport';
import { parseConfigDescriptions, descriptionFor } from './gemstoneConfigDescriptions';

const configurationViewJs = readWebviewScript('configurationView.js', 'configuration');

/** What the panel needs to read and write a session's configuration. */
export interface ConfigurationPanelDeps {
  /** Resolves the target session by id, reports when it goes away, and pings it. */
  sessionManager: SessionManager;
  /** Locates a version's product tree, to read system.conf descriptions. */
  storage: SysadminStorage;
}

// ── Wire types shared with configurationView.js ─────────────────────────────

/** One configuration parameter as the webview draws it. */
interface ConfigParam {
  key: string;
  value: string;
  type: ConfigValueType;
  /** CamelCase runtime key (as opposed to a read-only config-file parameter). */
  settable: boolean;
  /**
   * Whether this session may actually change it: a runtime key of an editable
   * kind, and — for a stone parameter — only when the session is SystemUser.
   * A settable-but-not-editable row is a runtime key the current user lacks the
   * authority to change; the panel shows why rather than offering a doomed edit.
   */
  editable: boolean;
  /** Purpose text from system.conf, shown as a tooltip when the file named it. */
  description?: string;
}

/** The configuration of the session, sent in reply to loadConfiguration. */
interface ConfigurationPayload {
  sessionId: number;
  label: string;
  version: string;
  /** SystemUser may change stone parameters; other users may not. */
  isSystemUser: boolean;
  /**
   * Whether a system.conf was found and parsed for this version. When false, no
   * parameter has a description and the panel says why (the product tree is not
   * on this machine — e.g. a remote stone); when true, a parameter with no
   * description simply had no matching entry.
   */
  descriptionsAvailable: boolean;
  stoneParams: ConfigParam[];
  gemParams: ConfigParam[];
}

type Inbound =
  | { command: 'ready' }
  | { command: 'loadConfiguration' }
  | { command: 'ping' }
  | { command: 'copyText'; text: string }
  | {
      command: 'setConfiguration';
      scope: ConfigScope;
      key: string;
      valueType: ConfigValueType;
      value: string;
    };

export class ConfigurationPanel {
  static readonly viewType = 'gemstoneConfiguration';
  // One panel per session, so several sessions' configuration can be open at once
  // (to compare two, say). Keyed by session id.
  private static panels = new Map<number, ConfigurationPanel>();

  private readonly disposables: vscode.Disposable[] = [];
  // Parsed system.conf descriptions, one map per version — the file does not
  // change under a running stone, so it is read and parsed once per version and
  // kept (an unreadable file caches as an empty map, so a remote stone whose
  // product tree is not on this machine is not re-probed on every load).
  private configDescCache = new Map<string, Map<string, string>>();

  /**
   * Open the configuration panel for a session, revealing the session's existing
   * panel if it already has one. Each session gets its own panel, so two can be
   * open at once.
   */
  static show(deps: ConfigurationPanelDeps, sessionId: number): void {
    // Already open for this session — just reveal it, so a second session keeps
    // its own panel rather than replacing this one.
    const existing = ConfigurationPanel.panels.get(sessionId);
    if (existing) {
      existing.panel.reveal(undefined, false);
      return;
    }
    const session = deps.sessionManager.getSession(sessionId);
    const title = session
      ? `Session Configuration — ${loginLabel(session.login)}`
      : 'Session Configuration';
    const panel = vscode.window.createWebviewPanel(
      ConfigurationPanel.viewType,
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Glyphs are inline SVG, so the webview loads no external resource.
        localResourceRoots: [],
      },
    );
    ConfigurationPanel.panels.set(sessionId, new ConfigurationPanel(panel, deps, sessionId));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: ConfigurationPanelDeps,
    private readonly sessionId: number,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Inbound) => this.handleMessage(msg),
      null,
      this.disposables,
    );
    // This panel describes one session; when it logs out, its values describe
    // nothing reachable — close the panel rather than leave a dead tab behind.
    this.deps.sessionManager.onDidRemoveSession(
      (id) => {
        if (id === this.sessionId) this.dispose();
      },
      null,
      this.disposables,
    );
  }

  private handleMessage(msg: Inbound): void {
    switch (msg.command) {
      case 'ready':
      case 'loadConfiguration':
        this.loadConfiguration();
        return;
      case 'setConfiguration':
        this.setConfiguration(msg.scope, msg.key, msg.valueType, msg.value);
        return;
      case 'ping':
        this.pingSession();
        return;
      case 'copyText':
        void vscode.env.clipboard.writeText(msg.text);
        return;
    }
  }

  /**
   * Check the session is alive and responsive, reporting the result as a notice
   * in the panel rather than a transient toast — the Session Configuration page is where a
   * session's live maintenance happens. A ping is not a settings change, so it
   * leaves the values on screen untouched.
   */
  private pingSession(): void {
    const session = this.deps.sessionManager.getSession(this.sessionId);
    if (!session) {
      this.configurationError('No GemStone session is selected. Log in and try again.');
      return;
    }
    const { success, err } = this.deps.sessionManager.ping(session.id);
    void this.panel.webview.postMessage({
      command: 'pingResult',
      tone: success ? 'ok' : 'warn',
      message: success
        ? `Session ${session.id} is active and responsive.`
        : `Session ${session.id} did not respond — ${err.message || `error ${err.number}`}.`,
    });
  }

  /**
   * Read the session's stone and gem configuration reports and post them to the
   * panel. A busy or dropped session, or a report that raises, becomes a
   * `configurationError` the panel can show rather than a thrown rejection.
   */
  private loadConfiguration(): void {
    const session = this.deps.sessionManager.getSession(this.sessionId);
    if (!session) {
      this.configurationError('No GemStone session is selected. Log in and try again.');
      return;
    }
    try {
      void this.panel.webview.postMessage({
        command: 'configuration',
        config: this.readConfiguration(session),
      });
    } catch (e: unknown) {
      this.configurationError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Read both reports for a session and shape them for the panel. */
  private readConfiguration(session: ActiveSession): ConfigurationPayload {
    const execute = defaultQueryExecutorUsing(session);
    const isSystemUser = sessionIsSystemUser(execute);
    const stone = stoneConfiguration(execute);
    const gem = gemConfiguration(execute);
    const descriptions = this.configDescriptions(session.login.version);
    return {
      sessionId: session.id,
      label: loginLabel(session.login),
      version: session.login.version,
      isSystemUser,
      descriptionsAvailable: descriptions.size > 0,
      stoneParams: stone.map((e) => this.toConfigParam(e, descriptions, 'stone', isSystemUser)),
      gemParams: gem.map((e) => this.toConfigParam(e, descriptions, 'gem', isSystemUser)),
    };
  }

  /**
   * Set one runtime-settable value through the session, then re-read and report
   * the *settled* value. The stone is the authority: a refusal (a SystemUser-only
   * stone key, a gem key frozen after login) comes back as a `configurationError`
   * with the stone's own words. But some parameters are accepted without error
   * and then ignored — set at cache/gem creation, not at runtime — so a bare
   * "OK" would read as success while the value snapped back. Comparing what the
   * session now reports against what was asked turns that silent revert into a
   * plain statement of what actually happened.
   */
  private setConfiguration(
    scope: ConfigScope,
    key: string,
    valueType: ConfigValueType,
    value: string,
  ): void {
    const session = this.deps.sessionManager.getSession(this.sessionId);
    if (!session) {
      this.configurationError('No GemStone session is selected. Log in and try again.');
      return;
    }
    try {
      const execute = defaultQueryExecutorUsing(session);
      const result = setSessionConfiguration(execute, scope, key, valueType, value);
      if (!result.ok) {
        // A refused set is not a panel-wide failure — it belongs beside the row
        // the user was editing, with the stone's own words.
        this.setResult(scope, key, 'warn', result.message ?? `Could not set ${key}.`);
        return;
      }
      appendSysadmin(`Session Configuration: set ${scope} configuration ${key} = ${value}`);

      const config = this.readConfiguration(session);
      void this.panel.webview.postMessage({ command: 'configuration', config });

      const settled = (scope === 'stone' ? config.stoneParams : config.gemParams).find(
        (p) => p.key === key,
      );
      const now = settled ? settled.value : '(unknown)';
      const took = settled !== undefined && configValuesMatch(valueType, value, settled.value);
      this.setResult(
        scope,
        key,
        took ? 'ok' : 'warn',
        took
          ? `Set ${key} — the session now reports ${now}.`
          : `${key} was accepted without error, but the session still reports ${now}, not ${value.trim()}. ` +
              `This parameter is likely read-only at runtime — many settings can only change in the config ` +
              `file before startup, and stone-level settings need SystemUser.`,
      );
    } catch (e: unknown) {
      this.setResult(scope, key, 'warn', e instanceof Error ? e.message : String(e));
    }
  }

  /** The outcome of a set, shown by the panel beside the row it belongs to. */
  private setResult(scope: ConfigScope, key: string, tone: 'ok' | 'warn', message: string): void {
    if (tone === 'warn') appendSysadmin(`Session Configuration: ${message}`);
    void this.panel.webview.postMessage({ command: 'setResult', scope, key, tone, message });
  }

  private configurationError(message: string): void {
    appendSysadmin(`Session Configuration: ${message}`);
    void this.panel.webview.postMessage({ command: 'configurationError', message });
  }

  private toConfigParam(
    entry: ConfigEntry,
    descriptions: Map<string, string>,
    scope: ConfigScope,
    isSystemUser: boolean,
  ): ConfigParam {
    const description = descriptionFor(descriptions, entry.key);
    // A stone parameter can only be changed by SystemUser; a gem parameter may be
    // attempted by any user (whether it takes is up to the stone, reported after
    // the set). So a non-SystemUser sees stone runtime keys as not-editable.
    const editable = isEditable(entry) && (scope === 'gem' || isSystemUser);
    return {
      key: entry.key,
      value: entry.value,
      type: entry.type,
      settable: entry.settable,
      editable,
      ...(description ? { description } : {}),
    };
  }

  /**
   * The parsed system.conf descriptions for a version, read from the installed
   * product tree this machine knows about. Best-effort: a version whose tree is
   * not local (a remote stone) simply yields no descriptions, cached as an empty
   * map so it is not read again.
   */
  private configDescriptions(version: string): Map<string, string> {
    const cached = this.configDescCache.get(version);
    if (cached) return cached;
    let map = new Map<string, string>();
    try {
      const gsPath = this.deps.storage.getGemstonePath(version);
      if (gsPath) {
        const confPath = path.join(gsPath, 'data', 'system.conf');
        map = parseConfigDescriptions(fs.readFileSync(confPath, 'utf8'));
      }
    } catch {
      // No readable system.conf for this version — tooltips are optional.
    }
    this.configDescCache.set(version, map);
    return map;
  }

  private dispose(): void {
    if (ConfigurationPanel.panels.get(this.sessionId) === this) {
      ConfigurationPanel.panels.delete(this.sessionId);
    }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const session = this.deps.sessionManager.getSession(this.sessionId);
    const label = session ? loginLabel(session.login) : '';
    const version = session ? session.login.version : '';
    // Glyphs are inline SVG, so nothing external is loaded: no font-src, no
    // style/link to a webfont — just inline styles and the nonce'd scripts.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Session Configuration</title>
  <style>${CSS}</style>
</head>
<body>
  <main id="root" class="content" aria-busy="false"></main>
  <script nonce="${nonce}">${configurationViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    GemstoneConfig.init(
      { root: document.getElementById('root') },
      vscode,
      { label: ${JSON.stringify(label)}, version: ${JSON.stringify(version)} },
    );
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}

// Styles live in the host (convention: styling in the host <style>, behavior in
// the companion .js). Everything is a plain element styled through --vscode-*
// theme variables, so the panel matches VS Code's own chrome in either theme and
// never depends on a component library's shadow DOM to look right.
const CSS = `
:root {
  --gm-ok: var(--vscode-testing-iconPassed, #2ea043);
  --gm-warn: var(--vscode-editorWarning-foreground, #cca700);
  --gm-line: var(--vscode-widget-border, rgba(128,128,128,.22));
}
* { box-sizing: border-box; }
/* Anchor rem to the user's workbench font size, so every size below is expressed
   relative to it and tracks that setting instead of freezing at a fixed pixel
   size. */
html { font-size: var(--vscode-font-size, 13px); }
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: 1rem;
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
}
.content { padding: 16px 22px 56px; max-width: 1040px; }
.dim { color: var(--vscode-descriptionForeground, #9d9d9d); }
/* Inline-SVG glyphs, sized by the surrounding text (codicon paths on a 16px
   viewBox). No webfont is loaded — the markup carries the SVG directly. */
.ico { display: inline-flex; align-items: center; justify-content: center; vertical-align: -0.14em; }
.ico svg { width: 1.05em; height: 1.05em; display: block; }

/* ── Header ───────────────────────────────────────────────────────────────── */
.config-panel-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 14px; }
.config-panel-title { font-size: 1.08rem; font-weight: 700; }
.config-panel-sub { font-size: 0.92rem; }
.config-panel-actions { margin-left: auto; align-self: center; display: inline-flex; align-items: center; gap: 8px; }
/* The Ping result sits to the left of the Ping button — a compact banner that
   clears itself after a success and lingers (with Dismiss) after a warning. */
.ping-result {
  display: inline-flex; align-items: center; gap: 6px; max-width: 520px;
  padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;
}
.ping-result.ok { background: color-mix(in srgb, var(--gm-ok) 14%, transparent); }
.ping-result.warn { background: color-mix(in srgb, var(--gm-warn) 14%, transparent); }
.ping-result.ok .ico { color: var(--gm-ok); }
.ping-result.warn .ico { color: var(--gm-warn); }

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 11px; font: inherit; font-size: 0.92rem; line-height: 18px;
  border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
  color: var(--vscode-button-secondaryForeground, inherit); cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn .ico svg { width: 1em; height: 1em; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: var(--vscode-icon-foreground, inherit); cursor: pointer;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
.btn:focus-visible, .icon-btn:focus-visible, summary:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}

/* ── Badges ───────────────────────────────────────────────────────────────── */
.badge {
  display: inline-flex; align-items: center; padding: 0 6px; height: 16px;
  font-size: 0.85rem; border-radius: 8px; white-space: nowrap;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.section-count { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
/* The disclosure twisty: a chevron that points right when collapsed and rotates
   to point down when the group is open — the same affordance VS Code's own tree
   sections use, so the Stone / Session groups read as collapsible at a glance. */
.section-twist { transition: transform .12s ease; color: var(--vscode-foreground); flex: none; }
details[open] > summary .section-twist { transform: rotate(90deg); }
.empty { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 8px 4px; }
.empty > div { margin-top: 8px; }

/* ── Configuration ────────────────────────────────────────────────────────── */
.badge-editable { background: color-mix(in srgb, var(--vscode-charts-blue, #4daafc) 26%, transparent); color: var(--vscode-foreground); }
.badge-readonly { background: transparent; color: var(--vscode-descriptionForeground, #9d9d9d); border: 1px solid var(--gm-line); }
.config-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.config-filter-wrap { position: relative; display: flex; flex: 1 1 220px; min-width: 160px; align-items: center; }
.config-filter {
  flex: 1 1 auto; min-width: 0; padding: 3px 26px 3px 8px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gm-line)); border-radius: 4px;
}
.config-filter:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.config-filter-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 0; padding: 2px; border-radius: 3px; line-height: 1;
  color: var(--vscode-descriptionForeground, #9d9d9d); cursor: pointer; opacity: .7;
}
.config-filter-clear:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
.config-filter-clear:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; opacity: 1; }
.config-filter-clear[hidden] { display: none; }
.config-legend { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-loading { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 16px 4px; }
.config-error {
  margin: 0 0 10px; padding: 6px 10px; font-size: 0.92rem; border-radius: 4px;
  background: color-mix(in srgb, var(--gm-warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-warn) 40%, transparent);
}
/* The result of a set: a plain confirmation (which clears itself), or a warning
   that the stone refused the change or accepted it without applying it (which
   stays, with Copy and Dismiss). It rides directly under the row it belongs to. */
.config-notice {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 0 6px; padding: 6px 10px; font-size: 0.92rem; border-radius: 4px;
}
.config-notice .notice-msg { min-width: 0; }
.config-notice.ok {
  background: color-mix(in srgb, var(--gm-ok) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-ok) 40%, transparent);
}
.config-notice.ok .ico { color: var(--gm-ok); }
.config-notice.warn {
  background: color-mix(in srgb, var(--gm-warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-warn) 40%, transparent);
}
.config-notice.warn .ico { color: var(--gm-warn); }
/* The set banner is a full-width row spanning the parameter table, sitting
   flush under its own row. */
.config-notice-row td { padding: 4px 8px 8px; border-bottom: none; }
.config-notice-row .config-notice { margin: 0; }
.notice-actions { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
.notice-btn {
  background: none; border: 0; padding: 0; font: inherit; font-size: 0.85rem;
  color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline;
}
.notice-btn:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
.notice-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.config-group { margin: 0 0 16px; }
.config-group-head {
  list-style: none; cursor: pointer; user-select: none;
  font-weight: 600; margin: 0 0 6px; padding: 3px 4px; border-radius: 4px;
  display: flex; align-items: center; gap: 8px;
}
.config-group-head::-webkit-details-marker { display: none; }
.config-group-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.config-group-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.config-group .section-twist svg { width: 1.2em; height: 1.2em; }
.config-note { font-size: 0.85rem; font-weight: 400; color: var(--vscode-descriptionForeground, #9d9d9d); }
.config-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.config-table td { padding: 3px 8px; border-bottom: 1px solid var(--gm-line); vertical-align: top; }
.config-key { white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem; }
.config-info { font: inherit; font-size: 0.92rem; line-height: 1; background: none; border: 0; padding: 0; color: var(--vscode-descriptionForeground, #9d9d9d); cursor: pointer; margin-left: 5px; vertical-align: -1px; opacity: .6; }
.config-item:hover .config-info, .config-info:hover { opacity: 1; }
.config-info:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; opacity: 1; }
/* The ⓘ tooltip pinned on screen after a click, so a long description can be
   read without holding the pointer still. Positioned in the viewport by script. */
.config-info-pop {
  position: fixed; z-index: 40; max-width: 340px; white-space: pre-line;
  padding: 8px 10px; font-size: 0.92rem; line-height: 1.4;
  background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--gm-line));
  border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}
.config-val { width: 100%; }
.config-value { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem; word-break: break-all; }
/* An editable value is a subtle button carrying a persistent pencil, so which
   rows can be changed is visible without hovering each one. */
.config-value-btn {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 1px 6px; margin: -1px -6px; text-align: left; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: inherit; font: inherit;
}
.config-value-btn:hover { background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); border-color: var(--gm-line); }
.config-value-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 0; }
.config-pencil { flex: none; color: var(--vscode-descriptionForeground, #9d9d9d); opacity: .55; vertical-align: -1px; }
.config-value-btn:hover .config-pencil, .config-value-btn:focus-visible .config-pencil { opacity: 1; color: var(--vscode-charts-blue, #4daafc); }
.config-tag { text-align: right; white-space: nowrap; }
.config-edit { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-input {
  padding: 2px 6px; min-width: 120px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gm-line)); border-radius: 4px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem;
}
.config-input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
`;
