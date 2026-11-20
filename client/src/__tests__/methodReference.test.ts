import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { parseMethodReference } from '../methodReference';
import { formatFrameForClipboard } from '../debugger/debuggerPanel';

// The GsNMethod strings below were printed by a 3.7.5 stone (`aMethod printString`), and the frame
// labels are `formatFrameLabel`'s shapes — the two things a user actually copies and pastes.

describe('parseMethodReference', () => {
  it('reads an instance-side reference', () => {
    expect(parseMethodReference('Object>>printString')).toEqual({
      className: 'Object',
      isMeta: false,
      selector: 'printString',
      inBlock: false,
    });
  });

  it('reads a class-side reference', () => {
    expect(parseMethodReference('String class>>new')).toEqual({
      className: 'String',
      isMeta: true,
      selector: 'new',
      inBlock: false,
    });
  });

  it('tolerates spaces around >> and a # on the selector', () => {
    expect(parseMethodReference('  Object >> #printString ')).toMatchObject({
      className: 'Object',
      selector: 'printString',
    });
    expect(parseMethodReference('String class >> #new')).toMatchObject({
      className: 'String',
      isMeta: true,
      selector: 'new',
    });
  });

  it('reads keyword and binary selectors', () => {
    expect(parseMethodReference('Dictionary>>at:put:')?.selector).toBe('at:put:');
    expect(parseMethodReference('Number>>+')?.selector).toBe('+');
    expect(parseMethodReference('Collection>>,')?.selector).toBe(',');
  });

  it('splits on the FIRST >>, so > and >> are themselves selectors', () => {
    expect(parseMethodReference('Magnitude>>>')).toMatchObject({
      className: 'Magnitude',
      selector: '>',
    });
    expect(parseMethodReference('Integer>>>>')).toMatchObject({
      className: 'Integer',
      selector: '>>',
    });
  });

  it("strips a GsNMethod's printString prefix", () => {
    expect(parseMethodReference('GsNMethod Object>>printString')).toMatchObject({
      className: 'Object',
      selector: 'printString',
      inBlock: false,
    });
    expect(parseMethodReference('GsNMethod String class>>new')).toMatchObject({
      className: 'String',
      isMeta: true,
      selector: 'new',
    });
  });

  it('reads a block as the method it lives in, and says it was a block', () => {
    expect(parseMethodReference('GsNMethod [] in Jasper677Tmp>>blk')).toEqual({
      className: 'Jasper677Tmp',
      isMeta: false,
      selector: 'blk',
      inBlock: true,
    });
    expect(parseMethodReference('GsNMethod [] in Jasper677Tmp class>>blk')).toMatchObject({
      isMeta: true,
      inBlock: true,
    });
    expect(parseMethodReference('[] in JasperFoo>>#bar')).toMatchObject({
      className: 'JasperFoo',
      selector: 'bar',
      inBlock: true,
    });
  });

  it("reads a debugger frame's `Receiver (DefiningClass)` as the defining class", () => {
    expect(parseMethodReference('OrderedCollection (Collection)>>#detect:')).toEqual({
      className: 'Collection',
      isMeta: false,
      selector: 'detect:',
      inBlock: false,
    });
  });

  it("reads the debugger's Copy Frame text, position and all", () => {
    const copied = formatFrameForClipboard({
      level: 2,
      label: 'SmallInteger (Integer)>>#factorial',
      position: '@1 line 1',
    });
    expect(parseMethodReference(copied)).toEqual({
      className: 'Integer',
      isMeta: false,
      selector: 'factorial',
      inBlock: false,
    });
  });

  it('reads one line of Copy Stack, frame number and all', () => {
    expect(parseMethodReference('[3] [] in Account class>>#open:  @4 line 7')).toEqual({
      className: 'Account',
      isMeta: true,
      selector: 'open:',
      inBlock: true,
    });
  });

  it('reads a position that has only a step point', () => {
    expect(parseMethodReference('Account>>#balance  @2')?.selector).toBe('balance');
  });

  it("reads a position that has only a line, when the step point couldn't be read", () => {
    expect(parseMethodReference('Account>>#balance  line 12')?.selector).toBe('balance');
  });

  it("reads a reference to GsNMethod's own methods, not mistaking the class for the prefix", () => {
    expect(parseMethodReference('GsNMethod class>>new')).toEqual({
      className: 'GsNMethod',
      isMeta: true,
      selector: 'new',
      inBlock: false,
    });
    expect(parseMethodReference('GsNMethod >> sourceString')).toMatchObject({
      className: 'GsNMethod',
      isMeta: false,
      selector: 'sourceString',
    });
    expect(parseMethodReference('GsNMethod GsNMethod>>sourceString')).toMatchObject({
      className: 'GsNMethod',
      selector: 'sourceString',
    });
  });

  it('reads a binary selector of any length', () => {
    expect(parseMethodReference('Number>>\\\\')?.selector).toBe('\\\\');
    expect(parseMethodReference('Number>>\\')?.selector).toBe('\\');
    expect(parseMethodReference('PPParser>>==>')?.selector).toBe('==>');
    expect(parseMethodReference('PPParser>>>=>')?.selector).toBe('>=>');
  });

  it('takes the selector as written, leaving the lookup to find nothing for a name no method has', () => {
    expect(parseMethodReference('Object>>print String')?.selector).toBe('print String');
    expect(parseMethodReference("Object>>foo'bar")?.selector).toBe("foo'bar");
  });

  it('is not a reference: a doit block, which has no class and no selector', () => {
    expect(parseMethodReference('GsNMethod [] in <nil>>><anonymous>')).toBeNull();
  });

  it('is not a reference: a bare selector, a bare class name, or half of one', () => {
    for (const term of ['printString', 'Object', '>>', 'Object>>', '>>printString', 'Object>>#']) {
      expect(parseMethodReference(term), term).toBeNull();
    }
  });

  it('is not a reference: a malformed class half', () => {
    for (const term of ['Foo Bar>>x', '123>>balance']) {
      expect(parseMethodReference(term), term).toBeNull();
    }
  });
});
