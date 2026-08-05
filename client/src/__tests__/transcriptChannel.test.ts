import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from 'vscode';
import {
  getTranscriptChannel,
  appendTranscript,
  appendTranscriptOutput,
  showTranscript,
  _resetTranscriptChannelForTests,
} from '../transcriptChannel';

describe('transcriptChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The channel is a module-level singleton; reset it so each test re-creates
    // it. Otherwise "creates an output channel" only passes when it runs first
    // (the create call happens once per process, and clearAllMocks wipes the
    // record) — an order dependency under sequence.shuffle.
    _resetTranscriptChannelForTests();
  });

  describe('getTranscriptChannel', () => {
    it('creates an output channel', () => {
      const channel = getTranscriptChannel();
      expect(channel).toBeDefined();
      expect(window.createOutputChannel).toHaveBeenCalledWith('GemStone Transcript');
    });

    it('returns the same channel on subsequent calls', () => {
      const ch1 = getTranscriptChannel();
      const ch2 = getTranscriptChannel();
      expect(ch1).toBe(ch2);
    });
  });

  describe('appendTranscript', () => {
    it('appends non-empty text to channel', () => {
      const channel = getTranscriptChannel();
      appendTranscript('Hello from Transcript');
      expect(channel.appendLine).toHaveBeenCalledWith('Hello from Transcript');
    });

    it('skips empty strings', () => {
      const channel = getTranscriptChannel();
      appendTranscript('');
      expect(channel.appendLine).not.toHaveBeenCalled();
    });
  });

  describe('appendTranscriptOutput', () => {
    it('appends verbatim — the server controls its own line breaks', () => {
      const channel = getTranscriptChannel();

      appendTranscriptOutput('no newline');

      expect(channel.append).toHaveBeenCalledWith('no newline');
      expect(channel.appendLine).not.toHaveBeenCalled();
    });

    it('brings the channel to the front on every write, preserving focus', () => {
      const channel = getTranscriptChannel();

      appendTranscriptOutput('output');

      expect(channel.show).toHaveBeenCalledWith(true);
    });

    it('does nothing (no reveal) for empty output', () => {
      const channel = getTranscriptChannel();

      appendTranscriptOutput('');

      expect(channel.append).not.toHaveBeenCalled();
      expect(channel.show).not.toHaveBeenCalled();
    });
  });

  describe('showTranscript', () => {
    it('shows the output channel', () => {
      showTranscript();
      const channel = getTranscriptChannel();
      expect(channel.show).toHaveBeenCalledWith(true);
    });
  });
});
