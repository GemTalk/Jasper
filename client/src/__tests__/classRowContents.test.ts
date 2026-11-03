import { describe, it, expect, vi } from 'vitest';
import { classRowContents } from '../queries/classRowContents';

describe("an Explorer class row's contents", () => {
  it("answers the class's own variables of both kinds and whether it has subclasses", async () => {
    const execute = vi.fn().mockResolvedValue('x\ty\t\nCount\t\ntrue');

    const contents = await classRowContents(execute, 'Point', 1);

    expect(contents).toEqual({
      instVarNames: ['x', 'y'],
      classVarNames: ['Count'],
      ivarsCanMoveDown: true,
    });
  });

  it('answers empty lists and no subclasses for a class that declares nothing', async () => {
    const execute = vi.fn().mockResolvedValue('\n\nfalse');

    const contents = await classRowContents(execute, 'Leaf', 1);

    expect(contents).toEqual({ instVarNames: [], classVarNames: [], ivarsCanMoveDown: false });
  });

  it('answers empty lists and no subclasses for a class the dictionary does not bind', async () => {
    const execute = vi.fn().mockResolvedValue('');

    const contents = await classRowContents(execute, 'Missing', 1);

    expect(contents).toEqual({ instVarNames: [], classVarNames: [], ivarsCanMoveDown: false });
  });

  it('asks about the class in the given dictionary', async () => {
    const execute = vi.fn().mockResolvedValue('');

    await classRowContents(execute, 'Point', 5);

    expect(execute.mock.calls[0][0]).toContain('symbolList at: 5');
  });
});
