// Experimental chat panel: a Claude conversation whose only tools are Jasper's MCP tools.
//
// It runs the user's installed Claude Code headless (`claude -p` with stream-json in and out),
// so it uses their existing Claude login and needs no API key. The process lives as long as
// the conversation; Stop kills it, and the next message resumes the same session with
// `--resume`. The webview (assistantView.js) does all the rendering from the raw events.
//
// The tools reach GemStone through the same stdio proxy and socket Claude Code uses, so they
// work only while this window owns the MCP server.

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { readWebviewScript } from '../webviewAssets';
import { McpReport } from '../mcpWindowStatus';
import { OMNI_VIEW_ID } from '../omniSearch/omniSearchViewProvider';
import { ASSISTANT_RESULTS_VIEW_ID } from '../omniSearch/assistantResultsView';
import { HeldDisplay } from './heldDisplay';

const assistantViewJs = readWebviewScript('assistantView.js', 'assistant');

const GUI_UPDATES_KEY = 'jasper.assistant.guiUpdates';
// The tools that change what Jasper shows. Turning GUI updates off withholds them from Claude
// rather than telling it not to call them: on --resume Claude Code reuses the system prompt it
// recorded first, so a prompt change would not reach a running conversation.
const GUI_TOOLS = [
  'mcp__jasper__show_regex_source_search',
  'mcp__jasper__show_methods_in_search',
  'mcp__jasper__show_classes_in_search',
  'mcp__jasper__show_trail_in_search',
  'mcp__jasper__show_class_in_explorer',
  'mcp__jasper__show_example_in_workspace',
];

const SYSTEM_PROMPT = `You are the Jasper Assistant, running inside Jasper, a VS Code IDE for GemStone/S Smalltalk.
The user is a GemStone developer. Your tools (mcp__jasper__*) act on their live, logged-in GemStone session.
Answer by using the tools rather than from memory whenever the question is about their code or data.
Never commit, abort, delete a class or method, or remove a dictionary unless the user has asked for that in this conversation.
When the answer is a set of methods or classes and one of your tools can show them in Jasper, use it and answer in a sentence or two instead of listing them.
When you create a class, give it a class comment (set_class_comment) that says what it is for and what its instance variables hold. Give a method a comment only when its name does not say what it does.
Write a method as \`Class>>selector\` or \`Class class>>selector\`, in backticks: the user can click it to open the method.
After you create or redefine one class, show it with show_class_in_explorer; then, if you created methods, show them with show_methods_in_search, titled for example "Methods created in OrderLine". End your answer with "Start reading at:" and the methods find_starting_points gives.
When one request creates several classes, show them instead with show_classes_in_search and withMethods, titled for example "Classes created for order entry", then show the one the user would call first with show_class_in_explorer.
After creating classes and showing them, open one example with show_example_in_workspace, using the class the user would call first, and say the user can try it in that Workspace.
When the user asks how something works or where something happens, trace the real sends and show them with show_trail_in_search, titled for example "How an order is priced", one note per step.
Keep answers short. When you show Smalltalk, use fenced code blocks.`;

export interface AssistantPanelDeps {
  extensionPath: string;
  socketPath: () => string;
  proxyScriptPath: string;
  mcpReport: () => McpReport;
  memento: vscode.Memento;
  /** Held from each message sent until its answer ends. */
  heldDisplay: HeldDisplay;
}

/** What the chat shows, as posted to the webview: kept so a reopened panel can show it again. */
type LogMessage =
  | { command: 'user'; text: string; about?: string }
  | { command: 'event'; event: unknown }
  | { command: 'error'; text: string }
  | { command: 'stopped' };

type Inbound =
  | { command: 'ready' }
  | { command: 'send'; text: string }
  | { command: 'stop' }
  | { command: 'newConversation' }
  | { command: 'claimMcp' }
  | { command: 'setGuiUpdates'; on: boolean }
  | { command: 'openMethod'; className: string; isMeta: boolean; selector: string }
  | { command: 'revealSearch' }
  | { command: 'revealResults' }
  | { command: 'clearAbout' };

/** What the next question is about (Ask about this, in Assistant Results): `label` is shown over
 *  the chat's input; `context` goes to Claude in front of the question. */
export interface AskAbout {
  label: string;
  context: string;
}

/** What Claude is sent for a question typed in the chat, with what it is about in front. */
export function messageFor(about: AskAbout | undefined, question: string): string {
  return about ? `${about.context}\n\nTheir question: ${question}` : question;
}

export class AssistantPanel {
  static readonly viewType = 'jasperAssistant';
  private static current: AssistantPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private child: ChildProcessWithoutNullStreams | undefined;
  // The conversation outlives the panel: closing it and opening it again shows the same messages,
  // and the next one continues the same Claude session. Only Clear (or a window reload) ends it.
  private static conversation: { sessionId?: string; log: LogMessage[] } = { log: [] };
  private stdoutBuffer = '';
  // Processes we ended ourselves. Claude Code traps SIGTERM and exits with 143, so the exit
  // signal alone can't tell a Stop from a crash.
  private readonly killed = new WeakSet<ChildProcessWithoutNullStreams>();
  // The running process was started with the other GUI-updates setting; restart it before the
  // next message so the change applies.
  private restartBeforeNextSend = false;
  // Set by Ask about this, until the next message is sent or the user removes it.
  private about: AskAbout | undefined;

  static show(deps: AssistantPanelDeps): void {
    if (AssistantPanel.current) {
      AssistantPanel.current.panel.reveal(undefined, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      AssistantPanel.viewType,
      'Jasper Assistant',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    AssistantPanel.current = new AssistantPanel(panel, deps);
  }

  /** Open the chat ready for a question about `about`. */
  static askAbout(deps: AssistantPanelDeps, about: AskAbout): void {
    AssistantPanel.show(deps);
    AssistantPanel.current?.setAbout(about);
  }

  private setAbout(about: AskAbout | undefined): void {
    this.about = about;
    this.post({ command: 'about', label: about?.label ?? null });
  }

  /** Redraw the MCP status line; called wherever the MCP Server tab is told ownership changed. */
  static refreshIfOpen(): void {
    AssistantPanel.current?.postMcpStatus();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: AssistantPanelDeps,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Inbound) => void this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private async handleMessage(msg: Inbound): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.postMcpStatus();
        this.post({ command: 'guiUpdates', on: this.guiUpdates() });
        if (AssistantPanel.conversation.log.length > 0) {
          this.post({ command: 'replay', log: AssistantPanel.conversation.log });
        }
        if (this.about) this.post({ command: 'about', label: this.about.label });
        return;
      case 'send': {
        this.postMcpStatus();
        const about = this.about;
        this.about = undefined;
        // The webview shows the message itself; kept only for a reopened panel.
        AssistantPanel.conversation.log.push({
          command: 'user',
          text: msg.text,
          about: about?.label,
        });
        this.send(messageFor(about, msg.text), msg.text);
        return;
      }
      case 'clearAbout':
        this.about = undefined;
        return;
      case 'stop':
        this.killChild();
        this.postLog({ command: 'stopped' });
        return;
      case 'newConversation':
        this.killChild();
        this.about = undefined;
        AssistantPanel.conversation = { log: [] };
        this.post({ command: 'cleared' });
        return;
      case 'claimMcp':
        await vscode.commands.executeCommand('jasper.claimMcpServer');
        this.postMcpStatus();
        return;
      case 'setGuiUpdates':
        await this.deps.memento.update(GUI_UPDATES_KEY, msg.on);
        this.restartBeforeNextSend = this.child !== undefined;
        return;
      case 'openMethod':
        void vscode.commands.executeCommand(
          'gemstone.explorer.findClass',
          msg.className,
          undefined,
          undefined,
          { selector: msg.selector, isMeta: msg.isMeta === true },
        );
        return;
      case 'revealSearch':
        await vscode.commands.executeCommand(`${OMNI_VIEW_ID}.focus`);
        return;
      case 'revealResults':
        await vscode.commands.executeCommand(`${ASSISTANT_RESULTS_VIEW_ID}.focus`);
        return;
    }
  }

  private guiUpdates(): boolean {
    return this.deps.memento.get<boolean>(GUI_UPDATES_KEY, true);
  }

  /** Send `text` to Claude; `question` is what the user typed, for Assistant Results. */
  private send(text: string, question: string): void {
    if (this.restartBeforeNextSend) {
      this.restartBeforeNextSend = false;
      this.killChild();
    }
    const child = this.child ?? this.startChild();
    if (!child) {
      return;
    }
    const line = { type: 'user', message: { role: 'user', content: text } };
    this.deps.heldDisplay.hold(question);
    child.stdin.write(JSON.stringify(line) + '\n');
  }

  private startChild(): ChildProcessWithoutNullStreams | undefined {
    // `npm run compile` (the F5 task) only type-checks the proxy; `npm run bundle` builds it.
    if (!fs.existsSync(this.deps.proxyScriptPath)) {
      this.postLog({
        command: 'error',
        text: `Jasper's MCP proxy has not been built: ${this.deps.proxyScriptPath} is missing. Run \`npm run bundle\`.`,
      });
      return undefined;
    }
    const mcpConfig = {
      mcpServers: {
        jasper: {
          type: 'stdio',
          command: 'node',
          args: [this.deps.proxyScriptPath, '--proxy-socket', this.deps.socketPath()],
        },
      },
    };
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config',
      JSON.stringify(mcpConfig),
      '--strict-mcp-config',
      // No built-in tools (Bash, Edit, Read...): the only reach is through Jasper's tools.
      '--tools',
      '',
      '--allowedTools',
      'mcp__jasper',
      '--permission-prompts',
      'none',
      // Without this the user's own CLAUDE.md files and hooks steer the assistant too.
      '--setting-sources',
      '',
      '--append-system-prompt',
      SYSTEM_PROMPT,
      ...(this.guiUpdates() ? [] : ['--disallowedTools', ...GUI_TOOLS]),
    ];
    const { sessionId } = AssistantPanel.conversation;
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('claude', args, { cwd, env: process.env });
    } catch (err) {
      this.postLog({ command: 'error', text: `Could not start Claude Code: ${String(err)}` });
      return undefined;
    }
    this.child = child;
    this.stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      const text =
        err.code === 'ENOENT'
          ? 'Claude Code (`claude`) is not on the PATH VS Code was started with.'
          : `Claude Code failed: ${err.message}`;
      this.postLog({ command: 'error', text });
    });
    child.on('close', (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
        // Stopped or crashed mid-answer: no `result` comes, but what was done so far still shows.
        void this.showHeld();
      }
      if (!this.killed.has(child) && signal === null && code !== 0) {
        this.postLog({
          command: 'error',
          text: `Claude Code exited with code ${code}.${stderr ? '\n' + stderr.trim() : ''}`,
        });
      }
    });
    return child;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let event: { type?: string; session_id?: string };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.session_id) {
        AssistantPanel.conversation.sessionId = event.session_id;
      }
      // Streamed deltas and the start-up notice only matter live; the complete events replace them.
      if (event.type === 'stream_event' || event.type === 'system') {
        this.post({ command: 'event', event });
      } else {
        this.postLog({ command: 'event', event });
      }
      if (event.type === 'result') {
        void this.showHeld();
      }
    }
  }

  /** Show what the answer's tools held back. That may open an editor over this tab (a class
   *  definition lands in the active group, which is this one), so then bring the answer back beside
   *  it, for the user to read the end of it. */
  private async showHeld(): Promise<void> {
    await this.deps.heldDisplay.release();
    if (!this.panel.visible) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
  }

  private postMcpStatus(): void {
    const report = this.deps.mcpReport();
    this.post({
      command: 'mcpStatus',
      state: report.state,
      detail: report.detail,
      servedSession: report.servedSession,
    });
  }

  private postLog(message: LogMessage): void {
    AssistantPanel.conversation.log.push(message);
    this.post(message);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private killChild(): void {
    const child = this.child;
    this.child = undefined;
    if (child) {
      this.killed.add(child);
      child.kill();
    }
    // An answer cut short shows what its tools did so far; `close` will not, as this is no longer
    // the current child. Not showHeld: this also runs as the panel is disposed.
    void this.deps.heldDisplay.release();
  }

  private dispose(): void {
    AssistantPanel.current = undefined;
    this.killChild();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
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
  <title>Jasper Assistant</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="status" class="status" hidden></div>
  <main id="log" class="log" aria-live="polite"></main>
  <div id="working" class="working" hidden>
    <span class="spinner"></span><span id="workingLabel"></span><span id="workingTime" class="time"></span>
  </div>
  <label class="option"><input type="checkbox" id="guiUpdates" checked> Show results in Jasper (if possible)</label>
  <div id="about" class="about" hidden><span>About:</span><span id="aboutLabel"></span><button type="button" id="aboutClear" title="Ask without it" aria-label="Ask without it">×</button></div>
  <form id="composer" class="composer">
    <textarea id="input" rows="3" placeholder="Ask about your GemStone code, or ask for new classes. Enter sends, Shift+Enter for a new line, /help for more."></textarea>
    <div class="buttons">
      <button type="button" id="newConversation" class="secondary">Clear</button>
      <button type="button" id="stop" class="secondary" hidden>Stop</button>
      <button type="submit" id="send">Send</button>
    </div>
  </form>
  <script nonce="${nonce}">${assistantViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    JasperAssistantView.init(document, vscode);
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}

const CSS = `
:root {
  --line: var(--vscode-widget-border, rgba(128,128,128,.22));
  --muted: var(--vscode-descriptionForeground);
  --ok: var(--vscode-testing-iconPassed, #2ea043);
  --bad: var(--vscode-errorForeground, #f14c4c);
  --warn: var(--vscode-editorWarning-foreground, #cca700);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; display: flex; flex-direction: column;
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
  color: var(--vscode-foreground); background: var(--vscode-editor-background);
}
.status {
  padding: .5rem 1rem; border-bottom: 1px solid var(--line); color: var(--warn);
  display: flex; gap: .75rem; align-items: center; flex-wrap: wrap;
}
.status.ok { color: var(--muted); }
.status.alert {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-errorBackground, rgba(241, 76, 76, .15));
  border-bottom: 2px solid var(--bad); font-weight: 600;
}
.log { flex: 1; overflow-y: auto; padding: 1rem; }
.msg { margin: 0 0 1rem; line-height: 1.5; max-width: 90ch; }
.msg.user {
  background: var(--vscode-input-background); border: 1px solid var(--line);
  border-radius: 4px; padding: .5rem .75rem; white-space: pre-wrap;
}
.msg.assistant p { margin: .4rem 0; }
.msg.assistant pre, .tool pre {
  background: var(--vscode-textCodeBlock-background); padding: .5rem .75rem; border-radius: 3px;
  overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
}
code { font-family: var(--vscode-editor-font-family); }
code.mlink { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
.msg.error { color: var(--bad); white-space: pre-wrap; }
.msg.meta { color: var(--muted); font-size: .85em; }
.tool { margin: 0 0 .75rem; border: 1px solid var(--line); border-radius: 4px; max-width: 90ch; }
.tool summary { cursor: pointer; padding: .35rem .6rem; display: flex; gap: .5rem; align-items: baseline; }
.tool summary .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
.tool summary .args { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tool summary .state::before { content: '…'; }
.tool.done summary .state::before { content: '✓'; color: var(--ok); }
.tool.failed summary .state::before { content: '✗'; color: var(--bad); }
.tool .body { padding: 0 .6rem .5rem; }
.tool .label { color: var(--muted); font-size: .85em; margin-top: .4rem; }
.tool pre { max-height: 24rem; overflow: auto; white-space: pre-wrap; margin: .25rem 0; }
.working { display: flex; align-items: center; gap: .5rem; padding: .4rem 1rem; color: var(--muted); border-top: 1px solid var(--line); }
.working[hidden] { display: none; }
.working .time { margin-left: auto; font-variant-numeric: tabular-nums; }
.spinner {
  width: .85rem; height: .85rem; border-radius: 50%; flex: none;
  border: 2px solid var(--line); border-top-color: var(--vscode-progressBar-background, #0e70c0);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.option { padding: .4rem 1rem 0; color: var(--muted); display: flex; gap: .4rem; align-items: center; border-top: 1px solid var(--line); }
.gui-result {
  display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; max-width: 90ch;
  margin: 0 0 1rem; padding: .6rem .8rem; border-radius: 4px;
  border: 1px solid var(--vscode-focusBorder);
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.12));
}
.gui-result .headline { font-weight: 600; }
.gui-result .pattern { color: var(--muted); flex-basis: 100%; }
.gui-result button { margin-left: auto; }
.about { margin: .4rem 1rem 0; padding: .2rem .5rem; display: flex; gap: .4rem; align-items: center; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-editorWidget-background); color: var(--muted); }
.about[hidden] { display: none; }
.about #aboutLabel { color: var(--vscode-foreground); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.about button { background: none; border: none; color: inherit; cursor: pointer; padding: 0 .2rem; }
.msg .about-line { color: var(--muted); font-size: .9em; margin-bottom: .2rem; }
.composer { border-top: 1px solid var(--line); padding: .6rem 1rem; display: flex; gap: .5rem; align-items: flex-end; }
textarea {
  flex: 1; resize: vertical; font-family: inherit; font-size: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--line)); padding: .4rem .5rem;
}
textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.buttons { display: flex; flex-direction: column; gap: .35rem; }
button {
  font-family: inherit; font-size: inherit; padding: .3rem .8rem; border: none; border-radius: 2px; cursor: pointer;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:disabled { opacity: .5; cursor: default; }
`;
