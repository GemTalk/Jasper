import { describe, expect, it } from 'vitest';
import { checkExample, exampleExpressions, parseExampleCheck } from '../queries/checkExample';

describe('exampleExpressions', () => {
  it('splits the example at blank lines, keeping each comment with its expression', () => {
    const code = '"Display It"\nParser parse: \'[1]\'\n\n  \n"Inspect It"\nParser on: s\n';

    expect(exampleExpressions(code)).toEqual([
      '"Display It"\nParser parse: \'[1]\'',
      '"Inspect It"\nParser on: s',
    ]);
  });
});

describe('parseExampleCheck', () => {
  it('names each problem with the expression it is in', () => {
    const expressions = ['3 frobnicate', 'Foo new', 'Parser parse: (', '3 + 4'];
    const raw =
      'U\t1\tfrobnicate\nE\t2\tundefined symbol Foo\nE\t3\texpected start of a statement\n';

    expect(parseExampleCheck(raw, expressions)).toEqual([
      'No class implements #frobnicate: 3 frobnicate',
      'Does not compile (undefined symbol Foo): Foo new',
      'Does not compile (expected start of a statement): Parser parse: (',
    ]);
  });

  it('finds nothing wrong in an empty answer', () => {
    expect(parseExampleCheck('', ['3 + 4'])).toEqual([]);
  });
});

describe('checkExample', () => {
  it('sends each expression to the stone as a string literal, with its quotes doubled', () => {
    let sent = '';
    checkExample((code) => {
      sent = code;
      return '';
    }, "Parser parse: 'x'\n\n3 + 4");

    expect(sent).toContain("{ 'Parser parse: ''x''' . '3 + 4' }");
  });

  it('refuses an example with no expressions without asking the stone', () => {
    expect(checkExample(() => 'unused', '\n\n')).toEqual(['The example has no expressions.']);
  });
});
