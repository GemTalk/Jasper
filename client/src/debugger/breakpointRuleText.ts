import * as vscode from 'vscode';
import { methodSourceRef } from '../languageIds';
import { methodLabel } from '../methodResultsPicker';
import type { TriggerRef } from './breakpointManager';

/**
 * The text of a breakpoint's rule (condition, log message, trigger) for every
 * view that shows it. Shared so the views cannot drift apart; per-view wording
 * differences are deliberate.
 */

/** Why a trigger cannot arm the breakpoint waiting on it, when it cannot. */
export type TriggerProblem = 'disabled' | 'removed';

/** Everything about a breakpoint that its rule text is made from. */
export interface RuleParts {
  condition?: string;
  logMessage?: string;
  triggeredBy?: TriggerRef;
  /** Set when `triggeredBy` names a breakpoint that is disabled or gone. */
  triggerProblem?: TriggerProblem;
}

export const EDITOR_LABEL_MAX = 48;

export const ROW_LABEL_MAX = 40;

export function elide(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** The breakpoint a trigger names, e.g. `Account>>deposit: @4`. */
export function triggerWhere(ref: TriggerRef): string {
  const method = methodSourceRef(vscode.Uri.parse(ref.uri));
  return method ? `${methodLabel(method)} @${ref.stepPoint}` : `@${ref.stepPoint}`;
}

function triggerClause(ref: TriggerRef, problem: TriggerProblem | undefined, max: number): string {
  return `${elide(triggerWhere(ref), max)}${problem === undefined ? '' : ` (${problem})`}`;
}

export function conditionLabel(condition: string): string {
  return `Break if ${elide(condition, EDITOR_LABEL_MAX)}`;
}

export function logpointLabel(logMessage: string, condition?: string): string {
  return condition === undefined
    ? `Log ${elide(logMessage, EDITOR_LABEL_MAX)}`
    : `Log if ${elide(condition, EDITOR_LABEL_MAX)}`;
}

/**
 * The label at the end of a breakpoint's line, or undefined when it has no rule.
 * The trigger leads, since it decides whether the breakpoint stops at all.
 * `stepPoint` is given when the line holds more than one breakpoint.
 */
export function editorLabel(rule: RuleParts, stepPoint?: number): string | undefined {
  const own =
    rule.logMessage !== undefined
      ? logpointLabel(rule.logMessage, rule.condition)
      : rule.condition !== undefined
        ? conditionLabel(rule.condition)
        : undefined;
  let label = own;
  if (rule.triggeredBy !== undefined) {
    const head = `Break after ${triggerClause(rule.triggeredBy, rule.triggerProblem, EDITOR_LABEL_MAX)}`;
    // `Break if …` would repeat the verb; the condition rides as a bare clause.
    label = own === undefined ? head : `${head}, ${own.replace(/^Break /, '')}`;
  }
  if (label === undefined) return undefined;
  return stepPoint === undefined ? label : `@${stepPoint} ${label}`;
}

export function rowDescription(rule?: RuleParts): string {
  if (!rule) return '';
  const parts: string[] = [];
  if (rule.triggeredBy) {
    parts.push(`after ${triggerClause(rule.triggeredBy, rule.triggerProblem, ROW_LABEL_MAX)}`);
  }
  if (rule.condition !== undefined) parts.push(`if ${elide(rule.condition, ROW_LABEL_MAX)}`);
  if (rule.logMessage !== undefined) parts.push('logs');
  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`;
}

export function pickerSummary(bp: {
  enabled: boolean;
  condition?: string;
  logMessage?: string;
}): string {
  const parts: string[] = [];
  if (bp.logMessage !== undefined) parts.push(logpointLabel(bp.logMessage, bp.condition));
  else if (bp.condition !== undefined) parts.push(conditionLabel(bp.condition));
  else parts.push('Stops every time');
  // A disabled trigger never arms what waits on it.
  if (!bp.enabled) parts.push('disabled');
  return parts.join(' · ');
}

/**
 * `text` as a fenced code block that nothing inside it can close: the text is
 * the developer's, in hovers that carry command links, so a ``` inside it would
 * otherwise end the fence and let the rest render as Markdown, links included.
 */
export function fenced(text: string, language = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

export function appendRuleMarkdown(md: vscode.MarkdownString, rule: RuleParts): void {
  if (rule.condition !== undefined) {
    md.appendMarkdown(
      `\n\n${rule.logMessage === undefined ? 'Stops only when' : 'Logs only when'}:` +
        `\n\n${fenced(rule.condition, 'smalltalk')}`,
    );
  }
  if (rule.logMessage !== undefined) {
    md.appendMarkdown(
      `\n\nWrites to the **GemStone Logpoints** panel in Output, without stopping:` +
        `\n\n${fenced(rule.logMessage)}`,
    );
  }
  if (rule.triggeredBy !== undefined) {
    md.appendMarkdown(`\n\n${triggerSentence(rule.triggeredBy, rule.triggerProblem)}`);
  }
}

function triggerSentence(ref: TriggerRef, problem: TriggerProblem | undefined): string {
  // Backslash-escaped so a selector's `*` or `_` cannot turn into emphasis.
  const where = `**${triggerWhere(ref).replace(/[\\`*_[\]]/g, '\\$&')}**`;
  switch (problem) {
    case 'disabled':
      return (
        `Waits for ${where}, which is disabled, so this breakpoint is passed over every ` +
        'time until that one is enabled again.'
      );
    case 'removed':
      return (
        `Waits for ${where}, which no longer has a breakpoint, so this one is passed over ` +
        'every time. Choose another with Break Only After…, or choose Always armed.'
      );
    default:
      return (
        `Armed only once ${where} has been reached. Until then it is passed over. ` +
        'Arming starts over on each run.'
      );
  }
}
