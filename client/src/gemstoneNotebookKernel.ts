import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { logError } from './gciLog';
import { drainTranscript } from './transcriptSink';
import { appendTranscriptOutput } from './transcriptChannel';
import { describeSession, onDidChangeActiveSession } from './activeSessionDisplay';

// Shared base for GemStone-backed notebook kernels. VS Code's built-in ipynb
// support owns the `jupyter-notebook` notebook type (Microsoft's Jupyter
// extension adds kernels to it but is not needed); any NotebookController
// registered against that type appears in its kernel picker, so opening a .ipynb and selecting a GemStone kernel routes cell
// execution through the active GemStone session. Concrete kernels (Grail
// Python, GemStone Smalltalk) differ only in id/label/cell language and in
// how a cell's source is evaluated.

export const GEMSTONE_NOTEBOOK_TYPE = 'jupyter-notebook';

export interface NotebookKernelSpec {
  id: string;
  label: string;
  description: string;
  supportedLanguages: string[];
  /**
   * Evaluate one cell's source on the session and return the result string.
   * scopeId identifies the notebook (its URI) for kernels that keep
   * per-notebook state on the GemStone side; stateless kernels ignore it.
   * May be async (the Smalltalk kernel runs cells non-blocking so Transcript
   * output streams live while the cell executes).
   */
  evaluate: (session: ActiveSession, source: string, scopeId: string) => string | Promise<string>;
  /**
   * Run every cell in this one session instead of the active one. Jasper makes
   * one such kernel per logged-in session (see sessionKernels.ts), so the
   * kernel picker lists each session.
   */
  sessionId?: number;
}

export interface NotebookCellResult {
  success: boolean;
  /** Cell output text: the eval result, or the error / hint message. */
  message: string;
}

// Both evaluation paths report compile and runtime errors *inline* in the
// result string (see queries/python.ts and queries/executeCode.ts):
// `Error: <class> — <messageText>`, plus a fixed hint when Grail isn't
// installed in the session. Classify by prefix. A genuine string result can
// never collide with the `Error: ` prefix because both paths return
// printString output, which wraps strings in quotes (`'Error: ...'`).
const ERROR_PREFIX = 'Error: ';
const GRAIL_HINT_PREFIX = 'Grail (GemStone-Python) not detected';

export function classifyCellResult(result: string): NotebookCellResult {
  if (result.startsWith(ERROR_PREFIX) || result.startsWith(GRAIL_HINT_PREFIX)) {
    return { success: false, message: result };
  }
  return { success: true, message: result };
}

export class GemStoneNotebookKernel {
  protected readonly controller: vscode.NotebookController;
  private readonly evaluate: NotebookKernelSpec['evaluate'];
  private readonly baseLabel: string;
  private readonly sessionId: number | undefined;
  private executionOrder = 0;
  // Notebooks bound to this kernel, or that it is Preferred for — the ones
  // whose toolbar must redraw when the label changes (see refreshLabel).
  private readonly selected = new Set<vscode.NotebookDocument>();
  private readonly preferred = new Set<vscode.NotebookDocument>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    protected sessionManager: SessionManager,
    spec: NotebookKernelSpec,
  ) {
    this.evaluate = spec.evaluate;
    this.controller = vscode.notebooks.createNotebookController(
      spec.id,
      GEMSTONE_NOTEBOOK_TYPE,
      spec.label,
    );
    this.controller.supportedLanguages = spec.supportedLanguages;
    this.controller.supportsExecutionOrder = true;
    this.controller.description = spec.description;
    this.controller.executeHandler = (cells) => this.executeCells(cells);

    this.baseLabel = spec.label;
    this.sessionId = spec.sessionId;
    this.subscriptions.push(
      this.controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
        if (selected) {
          this.selected.add(notebook);
          void this.adoptEmptyCells(notebook, spec.supportedLanguages);
        } else {
          this.selected.delete(notebook);
        }
      }),
      vscode.workspace.onDidCloseNotebookDocument((doc) => {
        this.selected.delete(doc);
        this.preferred.delete(doc);
      }),
    );
    if (this.sessionId === undefined) {
      this.subscriptions.push(onDidChangeActiveSession(sessionManager, () => this.refreshLabel()));
      this.refreshLabel();
    } else {
      const session = sessionManager.getSession(this.sessionId);
      this.controller.label = session
        ? `${this.baseLabel} · ${describeSession(session)}`
        : this.baseLabel;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.subscriptions.forEach((d) => d.dispose());
    this.controller.dispose();
  }

  // Switching kernels should switch the language of the cells not yet written
  // in, so a blank notebook follows the kernel. Written cells keep theirs:
  // Smalltalk source does not become Python by relabelling it.
  private async adoptEmptyCells(
    notebook: vscode.NotebookDocument,
    languages: string[],
  ): Promise<void> {
    const [language] = languages;
    for (const cell of notebook.getCells()) {
      if (
        cell.kind === vscode.NotebookCellKind.Code &&
        cell.document.getText().trim() === '' &&
        !languages.includes(cell.document.languageId)
      ) {
        await vscode.languages.setTextDocumentLanguage(cell.document, language);
      }
    }
  }

  protected prefer(doc: vscode.NotebookDocument): void {
    this.preferred.add(doc);
    this.controller.updateNotebookAffinity(doc, vscode.NotebookControllerAffinity.Preferred);
  }

  // Cells run in the active session, so the kernel label — the notebook's
  // top-right corner — names it, marked "active" to tell it apart from the
  // kernel bound to that same session. VS Code's kernel toolbar does not redraw on a
  // label change, only on an affinity change, so re-apply affinity after it.
  // After, not with: a label change reaches VS Code on a microtask while an
  // affinity change goes at once, so an immediate nudge redraws the old label.
  private refreshLabel(): void {
    const session = this.sessionManager.getSelectedSession();
    this.controller.label = session
      ? `${this.baseLabel} · active ${describeSession(session)}`
      : this.baseLabel;
    setTimeout(() => {
      if (this.disposed) return;
      for (const doc of new Set([...this.selected, ...this.preferred])) {
        this.controller.updateNotebookAffinity(doc, vscode.NotebookControllerAffinity.Preferred);
      }
    }, 0);
  }

  // Cells run sequentially: each shares the single GemStone session, and the
  // GCI execute call is blocking, so there is no parallelism to exploit.
  private async executeCells(cells: vscode.NotebookCell[]): Promise<void> {
    for (const cell of cells) {
      await this.executeCell(cell);
    }
  }

  private async executeCell(cell: vscode.NotebookCell): Promise<void> {
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this.executionOrder;
    execution.start(Date.now());

    const source = cell.document.getText();
    if (!source.trim()) {
      await execution.replaceOutput([]);
      execution.end(true, Date.now());
      return;
    }

    const session =
      this.sessionId === undefined
        ? await this.sessionManager.resolveSession()
        : this.sessionManager.getSession(this.sessionId);
    if (!session) {
      await this.endWithError(
        execution,
        this.sessionId === undefined
          ? 'No GemStone session is active. Log in from the GemStone Logins view, then re-run the cell.'
          : `Session ${this.sessionId} has logged out. Pick another kernel, then re-run the cell.`,
      );
      return;
    }

    let result: NotebookCellResult;
    try {
      const scopeId = cell.notebook.uri.toString();
      result = classifyCellResult(await this.evaluate(session, source, scopeId));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `Notebook cell failed: ${msg}`);
      await this.endWithError(execution, msg);
      return;
    } finally {
      // Show Transcript output the cell buffered server-side (kernels running
      // on the blocking path — e.g. Grail Python — can't stream it live; for
      // the live Smalltalk path this is an empty no-op drain).
      appendTranscriptOutput(drainTranscript(session));
    }

    if (result.success) {
      await execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(result.message, 'text/plain'),
        ]),
      ]);
      execution.end(true, Date.now());
    } else {
      await this.endWithError(execution, result.message);
    }
  }

  protected async endWithError(
    execution: vscode.NotebookCellExecution,
    message: string,
  ): Promise<void> {
    const error = new Error(message);
    error.name = 'GemStoneError';
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]),
    ]);
    execution.end(false, Date.now());
  }
}
