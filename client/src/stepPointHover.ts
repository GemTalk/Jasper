import * as vscode from 'vscode';
import { StepPointModel, stepPointAtOffset, rangesForStepPoint } from './stepPointModel';
import { BreakpointManager } from './breakpointManager';

/**
 * Tells you the step point under the pointer, and lets you act on it.
 *
 * This is the answer to "show me step points without putting them in my face":
 * it costs nothing visually and is always available, whether or not the inlay
 * hint numbers are switched on. The hovered range is the step point's own token,
 * so the highlight itself shows how far the step point reaches.
 *
 * Registered separately from `GemStoneHoverProvider` rather than folded into it
 * — VS Code merges hovers from every provider, and keeping this one free of that
 * provider's senders/implementors queries means a hover over a method still
 * reports its step point when the LSP is not ready or the selector can't be
 * resolved.
 */
export class StepPointHoverProvider implements vscode.HoverProvider {
  constructor(
    private stepPoints: StepPointModel,
    private breakpoints: BreakpointManager,
  ) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    if (document.uri.scheme !== 'gemstone') return null;

    const info = this.stepPoints.get(document);
    if (!info || info.offsets.length === 0) return null;

    const offset = document.offsetAt(position);
    const resolved = stepPointAtOffset(info, offset);
    if (!resolved) return null;

    // Only speak up when the pointer is actually on the step point's token. The
    // caret rule behind `stepPointAtOffset` deliberately falls forward to the
    // next step point, which is right for "run to cursor" but would make a hover
    // anywhere on a blank line claim to describe a step point elsewhere.
    const spans = rangesForStepPoint(info, resolved.stepPoint);
    const span = spans.find((s) => offset >= s.start && offset <= s.end);
    if (!span) return null;

    const applied = this.breakpoints
      .appliedFor(document.uri)
      .find((bp) => bp.stepPoint === resolved.stepPoint);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.appendMarkdown(`**Step point ${resolved.stepPoint}** of ${info.offsets.length}`);

    if (applied) {
      const logs = applied.logMessage !== undefined;
      const conditional = applied.condition !== undefined;
      const kind = logs ? 'Logpoint' : conditional ? 'Conditional breakpoint' : 'Breakpoint';
      const icon = logs
        ? 'debug-breakpoint-log'
        : conditional
          ? 'debug-breakpoint-conditional'
          : 'debug-breakpoint';
      md.appendMarkdown(
        applied.enabled
          ? `\n\n$(${icon}) ${kind} set`
          : `\n\n$(debug-breakpoint-disabled) ${kind} set but disabled`,
      );
      // In full, unelided — the label beside the code shortens a long one, and
      // this is where the rest of it lives.
      if (applied.condition !== undefined) {
        md.appendMarkdown(
          `\n\n${logs ? 'Logs only when' : 'Stops only when'}:` +
            `\n\n\`\`\`smalltalk\n${applied.condition}\n\`\`\``,
        );
      }
      if (applied.logMessage !== undefined) {
        md.appendMarkdown(
          `\n\nWrites to the **GemStone Logpoints** panel in Output, without stopping:` +
            `\n\n\`\`\`\n${applied.logMessage}\n\`\`\``,
        );
      }
    }

    const arg = encodeURIComponent(
      JSON.stringify([{ uri: document.uri.toString(), stepPoint: resolved.stepPoint }]),
    );
    const links: string[] = [];
    if (applied) {
      links.push(
        `[$(debug-breakpoint-unsupported) Clear](command:gemstone.breakpoints.clearAtStepPoint?${arg} "Clear the breakpoint at step point ${resolved.stepPoint}")`,
      );
      links.push(
        applied.enabled
          ? `[$(debug-breakpoint-disabled) Disable](command:gemstone.breakpoints.disableAtStepPoint?${arg} "Disable the breakpoint at step point ${resolved.stepPoint}")`
          : `[$(debug-breakpoint) Enable](command:gemstone.breakpoints.enableAtStepPoint?${arg} "Enable the breakpoint at step point ${resolved.stepPoint}")`,
      );
      links.push(
        applied.condition === undefined
          ? `[$(debug-breakpoint-conditional) Add condition](command:gemstone.breakpoints.editConditionAtStepPoint?${arg} "Only stop here when an expression answers true")`
          : `[$(debug-breakpoint-conditional) Edit condition](command:gemstone.breakpoints.editConditionAtStepPoint?${arg} "Change the condition on the breakpoint at step point ${resolved.stepPoint}")`,
      );
      // A logpoint's output is in a panel that has to be found; from here it is
      // one click.
      if (applied.logMessage !== undefined) {
        links.push(
          `[$(output) Show logpoint output](command:gemstone.breakpoints.showLogpointOutput "Open the GemStone Logpoints panel in Output")`,
        );
      }
    } else {
      links.push(
        `[$(debug-breakpoint) Set breakpoint](command:gemstone.breakpoints.toggleAtStepPoint?${arg} "Set a breakpoint at step point ${resolved.stepPoint}")`,
      );
    }
    md.appendMarkdown(`\n\n${links.join('  ·  ')}`);

    return new vscode.Hover(
      md,
      new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
    );
  }
}
