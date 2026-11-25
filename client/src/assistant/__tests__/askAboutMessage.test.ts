import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { messageFor } from '../assistantPanel';

describe('the message Claude is sent', () => {
  it('puts what the question is about in front of it', () => {
    const about = { label: 'Results 2: X>>y', context: 'The user is asking about X>>y.' };

    expect(messageFor(about, 'Tell me more')).toBe(
      'The user is asking about X>>y.\n\nTheir question: Tell me more',
    );
  });

  it('sends a plain question as typed', () => {
    expect(messageFor(undefined, 'Tell me more')).toBe('Tell me more');
  });
});
