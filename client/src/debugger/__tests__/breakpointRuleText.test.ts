import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { MarkdownString } from '../../__mocks__/vscode';
import type * as vscode from 'vscode';
import {
  appendRuleMarkdown,
  editorLabel,
  fenced,
  logpointLabel,
  pickerSummary,
  rowDescription,
} from '../breakpointRuleText';

const SIZE = { uri: 'gemstone://1/Globals/Array/instance/accessing/size', stepPoint: 4 };

/** The Markdown `appendRuleMarkdown` writes for `rule`. */
function markdownFor(rule: Parameters<typeof appendRuleMarkdown>[1]): string {
  const md = new MarkdownString();
  appendRuleMarkdown(md as unknown as vscode.MarkdownString, rule);
  return md.value;
}

describe('the label at the end of a line', () => {
  it('reads Log for a logpoint, and Log if when it has a condition', () => {
    expect(logpointLabel('x={x}')).toBe('Log x={x}');
    expect(logpointLabel('x={x}', 'i > 3')).toBe('Log if i > 3');
  });

  it('says why a breakpoint waiting on a disabled one will not stop', () => {
    expect(editorLabel({ triggeredBy: SIZE, triggerProblem: 'disabled' })).toBe(
      'Break after Array>>size @4 (disabled)',
    );
  });

  it('keeps the condition after the trigger and its problem', () => {
    expect(editorLabel({ triggeredBy: SIZE, triggerProblem: 'removed', condition: 'n > 1' })).toBe(
      'Break after Array>>size @4 (removed), if n > 1',
    );
  });

  it('names the step point when asked to, for a line with more than one', () => {
    expect(editorLabel({ condition: 'n > 1' }, 3)).toBe('@3 Break if n > 1');
  });

  it('draws nothing for a breakpoint with no rule', () => {
    expect(editorLabel({})).toBeUndefined();
    expect(editorLabel({}, 3)).toBeUndefined();
  });
});

describe('a GemStone Breakpoints row', () => {
  it('says why the breakpoint will not stop when its trigger cannot fire', () => {
    expect(rowDescription({ triggeredBy: SIZE, triggerProblem: 'disabled' })).toBe(
      ' · after Array>>size @4 (disabled)',
    );
  });
});

describe('the trigger picker', () => {
  it('says what each breakpoint does, and that a disabled one is disabled', () => {
    expect(pickerSummary({ enabled: true })).toBe('Stops every time');
    expect(pickerSummary({ enabled: false, condition: 'n > 1' })).toBe('Break if n > 1 · disabled');
    expect(pickerSummary({ enabled: true, logMessage: 'x={x}' })).toBe('Log x={x}');
  });
});

describe('the rule in a hover or tooltip', () => {
  it('says what a breakpoint waits for', () => {
    expect(markdownFor({ triggeredBy: SIZE })).toContain(
      'Armed only once **Array>>size @4** has been reached.',
    );
  });

  it('says a disabled trigger leaves the breakpoint passed over until it is enabled', () => {
    const text = markdownFor({ triggeredBy: SIZE, triggerProblem: 'disabled' });
    expect(text).toContain('which is disabled, so this breakpoint is passed over every time');
  });

  it('says a removed trigger leaves the breakpoint passed over, and how to change that', () => {
    const text = markdownFor({ triggeredBy: SIZE, triggerProblem: 'removed' });
    expect(text).toContain('which no longer has a breakpoint');
    expect(text).toContain('Always armed');
  });

  it('shows the condition and the log message in full, each in a code block', () => {
    const text = markdownFor({ condition: 'n > 1', logMessage: 'n={n}' });
    expect(text).toContain('Logs only when:\n\n```smalltalk\nn > 1\n```');
    expect(text).toContain('in Output, without stopping:\n\n```\nn={n}\n```');
  });

  it('keeps a condition containing a fence inside its code block', () => {
    // A ``` inside the developer's text would otherwise close the block, and
    // what followed it would be read as Markdown, command links included.
    const sneaky = 'x = 1\n```\n[run](command:workbench.action.quit)';
    const text = markdownFor({ condition: sneaky });
    expect(text).toContain(`\`\`\`\`smalltalk\n${sneaky}\n\`\`\`\``);
  });
});

describe('fenced', () => {
  it('uses three backticks for ordinary text', () => {
    expect(fenced('a > b', 'smalltalk')).toBe('```smalltalk\na > b\n```');
  });

  it('uses a fence longer than any run of backticks in the text', () => {
    expect(fenced('a ````` b')).toBe('``````\na ````` b\n``````');
  });
});
