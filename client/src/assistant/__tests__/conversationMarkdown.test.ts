import { describe, expect, it } from 'vitest';
import { conversationMarkdown } from '../conversationMarkdown';

const ask = {
  command: 'user' as const,
  text: 'How does lending work?',
  about: 'Results 1: Library>>lend:to:',
};
const answer = {
  command: 'event' as const,
  event: {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'It checks the book first.' },
        {
          type: 'tool_use',
          name: 'mcp__jasper__get_method_source',
          input: { selector: 'lend:to:' },
        },
      ],
    },
  },
};
const result = (text: string) => ({
  command: 'event' as const,
  event: { type: 'user', message: { content: [{ type: 'tool_result', content: text }] } },
});

describe('the conversation written out as Markdown', () => {
  it('keeps the questions, answers and tools in order', () => {
    const md = conversationMarkdown([
      ask,
      answer,
      result('lend: aBook to: aMember'),
      { command: 'event', event: { type: 'result', duration_ms: 1500, total_cost_usd: 0.0123 } },
    ]);

    expect(md).toMatch(
      /## You\n\n\*About: Results 1: Library>>lend:to:\*\n\nHow does lending work\?\n\n## Assistant\n\nIt checks the book first\.\n\n\*\*Tool:\*\* `get_method_source`[\s\S]*"selector": "lend:to:"[\s\S]*\*\*Result:\*\*[\s\S]*lend: aBook to: aMember[\s\S]*\*1\.5s · \$0\.0123\*/,
    );
  });

  it('shortens a long tool result and says how much was left out', () => {
    const md = conversationMarkdown([result('x'.repeat(2500))]);

    expect(md).toContain('… (500 more characters)');
    expect(md).not.toContain('x'.repeat(2001));
  });

  it('fences a result that holds backticks so they cannot end the block', () => {
    const md = conversationMarkdown([result('a ``` b')]);

    expect(md).toContain('````\na ``` b\n````');
  });

  it('notes errors and stops', () => {
    const md = conversationMarkdown([
      { command: 'error', text: 'Claude Code exited.' },
      { command: 'stopped' },
    ]);

    expect(md).toContain('**Error:** Claude Code exited.');
    expect(md).toContain('*Stopped.*');
  });
});
