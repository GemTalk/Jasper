import { describe, expect, it, vi } from 'vitest';
import { HeldDisplay } from '../heldDisplay';

describe('holding what the assistant shows until its answer ends', () => {
  it('shows straight away when no answer is in progress', async () => {
    const held = new HeldDisplay(vi.fn());
    const show = vi.fn(async () => 'Showing it.');

    const said = await held.show(show, 'Will show it.');

    expect(show).toHaveBeenCalledTimes(1);
    expect(said).toBe('Showing it.');
  });

  it('keeps what is shown during an answer, and says it will come', async () => {
    const held = new HeldDisplay(vi.fn());
    const show = vi.fn(async () => 'Showing it.');
    held.hold();

    const said = await held.show(show, 'Will show it.');

    expect(show).not.toHaveBeenCalled();
    expect(said).toBe('Will show it.');
  });

  it('shows everything held, in the order it came, when the answer ends', async () => {
    const held = new HeldDisplay(vi.fn());
    const order: string[] = [];
    held.hold();
    await held.show(async () => (order.push('list'), ''), '');
    await held.show(async () => (order.push('explorer'), ''), '');
    await held.show(async () => (order.push('example'), ''), '');

    await held.release();

    expect(order).toEqual(['list', 'explorer', 'example']);
  });

  it('reports a failure and still shows the rest', async () => {
    const onError = vi.fn();
    const held = new HeldDisplay(onError);
    const after = vi.fn(async () => '');
    held.hold();
    await held.show(async () => {
      throw new Error('No class named Gone');
    }, '');
    await held.show(after, '');

    await held.release();

    expect(onError).toHaveBeenCalledWith('No class named Gone');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('shows straight away again after the answer ends, and never shows a held thing twice', async () => {
    const held = new HeldDisplay(vi.fn());
    const first = vi.fn(async () => '');
    held.hold();
    await held.show(first, '');
    await held.release();
    const next = vi.fn(async () => 'Showing it.');

    const said = await held.show(next, 'Will show it.');
    await held.release();

    expect(said).toBe('Showing it.');
    expect(first).toHaveBeenCalledTimes(1);
  });
});
