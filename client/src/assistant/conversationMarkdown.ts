/** A message the chat showed, as AssistantPanel keeps it for a reopened panel. */
export type LogMessage =
  | { command: 'user'; text: string; about?: string }
  | { command: 'event'; event: unknown }
  | { command: 'error'; text: string }
  | { command: 'stopped' };

/** The most of one tool result written out; the rest is cut, since a list can run to pages. */
const MAX_RESULT_CHARS = 2000;
const TOOL_PREFIX = 'mcp__jasper__';

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

function blocksOf(event: unknown): Block[] {
  const content = (event as { message?: { content?: unknown } }).message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: Block) => (c?.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
}

function fenced(text: string, lang = ''): string {
  // A fence longer than any run of backticks inside, so the text cannot close it early.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** The conversation as Markdown, for Copy Log and Save Log: what was asked, what the assistant
 *  answered, and each tool it used with its input and (shortened) result. */
export function conversationMarkdown(log: readonly LogMessage[]): string {
  const out: string[] = ['# Jasper Assistant conversation'];
  for (const m of log) {
    switch (m.command) {
      case 'user':
        out.push('## You', ...(m.about ? [`*About: ${m.about}*`] : []), m.text);
        break;
      case 'error':
        out.push(`**Error:** ${m.text}`);
        break;
      case 'stopped':
        out.push('*Stopped.*');
        break;
      case 'event': {
        const event = m.event as { type?: string; duration_ms?: number; total_cost_usd?: number };
        if (event.type === 'assistant') {
          for (const b of blocksOf(event)) {
            if (b.type === 'text' && b.text) out.push('## Assistant', b.text);
            if (b.type === 'tool_use') {
              const name = (b.name ?? '').replace(TOOL_PREFIX, '');
              out.push(
                `**Tool:** \`${name}\``,
                fenced(JSON.stringify(b.input ?? {}, null, 2), 'json'),
              );
            }
          }
        } else if (event.type === 'user') {
          for (const b of blocksOf(event)) {
            if (b.type !== 'tool_result') continue;
            const text = resultText(b.content);
            const cut =
              text.length > MAX_RESULT_CHARS
                ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (${text.length - MAX_RESULT_CHARS} more characters)`
                : text;
            out.push('**Result:**', fenced(cut));
          }
        } else if (event.type === 'result' && typeof event.duration_ms === 'number') {
          const cost =
            typeof event.total_cost_usd === 'number'
              ? ` · $${event.total_cost_usd.toFixed(4)}`
              : '';
          out.push(`*${(event.duration_ms / 1000).toFixed(1)}s${cost}*`);
        }
        break;
      }
    }
  }
  return out.join('\n\n') + '\n';
}
