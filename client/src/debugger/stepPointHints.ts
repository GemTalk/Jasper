import * as vscode from 'vscode';
import { StepPointModel } from './stepPointModel';

/** The command that flips the numbers on and off — the hover's way out of the numbered view, and
 *  the same one the editor context menu and the command palette invoke. */
const TOGGLE_COMMAND = 'gemstone.breakpoints.toggleStepPoints';

/** When the numbers are drawn. */
export type StepPointDisplay = 'off' | 'debugging' | 'always';

export function readDisplaySetting(): StepPointDisplay {
  const value = vscode.workspace
    .getConfiguration('gemstone')
    .get<string>('stepPoints.display', 'debugging');
  return value === 'off' || value === 'always' || value === 'debugging' ? value : 'debugging';
}

/**
 * Whether step point numbers should be drawn right now.
 *
 * The default, `debugging`, is the whole point of the setting: step point
 * numbers matter when you are reasoning about where execution is, and are
 * clutter when you are just reading or writing code. So they appear while a
 * debug session is live and stay out of the way the rest of the time.
 */
export function shouldShow(display: StepPointDisplay, debugSessionActive: boolean): boolean {
  if (display === 'off') return false;
  if (display === 'always') return true;
  return debugSessionActive;
}

/**
 * Numbers every step point of a method, as inlay hints.
 *
 * Inlay hints rather than text decorations on purpose: VS Code already renders
 * them in a dim, deliberately recessive style, they never change the document,
 * and a developer who finds them noisy can turn them off with the editor's own
 * `editor.inlayHints.*` settings instead of hunting for ours. Each number is
 * clickable and toggles the breakpoint at that step point, which makes the
 * numbering useful rather than merely informative.
 *
 * Numbers come from `GsNMethod >> _sourceOffsets`, so every step point gets one
 * — including those starting at `:=`, `^` or a block bracket, which have no
 * selector token to hang off.
 */
export class StepPointHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  private display: StepPointDisplay = readDisplaySetting();

  constructor(private stepPoints: StepPointModel) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this._onDidChangeInlayHints,
      vscode.languages.registerInlayHintsProvider([{ scheme: 'gemstone' }], this),
      // The hints are gated on whether a debug session is live, so both edges
      // have to redraw them.
      vscode.debug.onDidStartDebugSession(() => this.refresh()),
      vscode.debug.onDidTerminateDebugSession(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gemstone.stepPoints.display')) {
          this.display = readDisplaySetting();
          this.refresh();
        }
      }),
    );
  }

  /**
   * Flip the numbers on or off, and remember it in the user's settings.
   *
   * `display` is claimed *before* the settings write, not after. Writing a
   * setting is slow enough that a double-click on the editor-title icon, or a
   * held keybinding, gets a second call in while the first is still awaiting —
   * and if the flag were still the old value then, both calls would compute the
   * same `next` and two toggles would collapse into one net change. Claiming it
   * up front makes the second call read the first one's answer and flip back,
   * which is what the developer asked for. The configuration listener still
   * redraws when the write lands; this only decides what the *next* call sees.
   */
  async toggle(): Promise<void> {
    const next: StepPointDisplay = this.visible() ? 'off' : 'always';
    this.display = next;
    this.refresh();
    await vscode.workspace
      .getConfiguration('gemstone')
      .update('stepPoints.display', next, vscode.ConfigurationTarget.Global);
  }

  /** Whether numbers are showing at this moment. */
  visible(): boolean {
    return shouldShow(this.display, vscode.debug.activeDebugSession !== undefined);
  }

  refresh(): void {
    this._onDidChangeInlayHints.fire();
  }

  /**
   * What a step point number says when you hover it: which step point it is, that
   * clicking toggles a breakpoint there, and — the part that was missing — a way
   * back OUT of the numbered view.
   *
   * The way off does exist elsewhere (Toggle Step Point Numbers in the editor's
   * right-click menu, the command palette, the `gemstone.stepPoints.display`
   * setting), but it sits far down a long menu and there is no keybinding, so a
   * developer who switched the numbers on can struggle to switch them off again.
   * The hover is where they are already looking. A plain click is spoken for by
   * the breakpoint toggle, so the hide action is a link in the tooltip rather
   * than a second gesture on the number itself.
   *
   * `isTrusted` is what makes a `command:` link fire at all, and it is scoped to
   * the single command this tooltip offers rather than granted wholesale.
   */
  private hintTooltip(stepPoint: number, total: number): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(
      `Step point **${stepPoint}** of ${total} — click to toggle a breakpoint here.` +
        `\n\n[Hide step point numbers](command:${TOGGLE_COMMAND} "Stop numbering step points")`,
    );
    tooltip.isTrusted = { enabledCommands: [TOGGLE_COMMAND] };
    return tooltip;
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] | undefined {
    if (!this.visible()) return undefined;

    const info = this.stepPoints.get(document);
    if (!info) return undefined;

    const from = document.offsetAt(range.start);
    const to = document.offsetAt(range.end);

    const hints: vscode.InlayHint[] = [];
    for (let i = 0; i < info.offsets.length; i++) {
      const at = info.offsets[i];
      if (at < from || at > to) continue;

      const stepPoint = i + 1;
      const part = new vscode.InlayHintLabelPart(String(stepPoint));
      part.tooltip = this.hintTooltip(stepPoint, info.offsets.length);
      part.command = {
        title: `Toggle breakpoint at step point ${stepPoint}`,
        command: 'gemstone.breakpoints.toggleAtStepPoint',
        arguments: [{ uri: document.uri.toString(), stepPoint }],
      };

      const hint = new vscode.InlayHint(
        document.positionAt(at),
        [part],
        vscode.InlayHintKind.Parameter,
      );
      hint.paddingRight = true;
      hints.push(hint);
    }
    return hints;
  }
}
