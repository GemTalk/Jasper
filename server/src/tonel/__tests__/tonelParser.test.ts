import { describe, it, expect } from 'vitest';
import { parseTonelDocument } from '../tonelParser';
import { Lexer } from '../../lexer/lexer';
import { Parser } from '../../parser/parser';

describe('parseTonelDocument', () => {
  describe('package files', () => {
    it('parses a package file', () => {
      const regions = parseTonelDocument("Package { #name : 'GemStone-Tonel' }\n");
      expect(regions).toHaveLength(1);
      expect(regions[0].kind).toBe('tonel-header');
      expect(regions[0].className).toBe('GemStone-Tonel');
    });
  });

  describe('extension files', () => {
    it('parses extension with instance methods', () => {
      const text = [
        "Extension { #name : 'Object' }",
        '',
        "{ #category : 'testing' }",
        'Object >> isCharacter [',
        '\t^ false',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const header = regions.find((r) => r.kind === 'tonel-header');
      expect(header).toBeDefined();
      expect(header!.className).toBe('Object');

      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].className).toBe('Object');
      expect(methods[0].command).toBe('method');
      expect(methods[0].text).toContain('isCharacter');
    });

    it('parses class-side method', () => {
      const text = [
        "Extension { #name : 'Association' }",
        '',
        "{ #category : 'Instance Creation' }",
        'Association class >> newWithKey: aKey value: aValue [',
        '^ super new key: aKey value: aValue',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].command).toBe('classmethod');
      expect(methods[0].className).toBe('Association');
      expect(methods[0].text).toContain('newWithKey: aKey value: aValue');
    });

    it('parses multiple methods', () => {
      const text = [
        "Extension { #name : 'Object' }",
        '',
        "{ #category : 'testing' }",
        'Object >> isCharacter [',
        '\t^ false',
        ']',
        '',
        "{ #category : 'testing' }",
        'Object >> isCollection [',
        '\t^ false',
        ']',
        '',
        "{ #category : 'streaming' }",
        'Object >> putOn: aStream [',
        '\t^ aStream nextPut: self',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(3);
    });
  });

  describe('class files', () => {
    it('parses class header and methods', () => {
      const text = [
        'Class {',
        "\t#name : 'GsTopazRowanTool',",
        "\t#superclass : 'GemStoneRowanTool',",
        "\t#category : 'GemStone-Rowan-Tools'",
        '}',
        '',
        "{ #category : 'private' }",
        'GsTopazRowanTool >> _defaultPackageFormat [',
        "\t^ 'tonel'",
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const header = regions.find((r) => r.kind === 'tonel-header');
      expect(header).toBeDefined();
      expect(header!.className).toBe('GsTopazRowanTool');
      expect(header!.startLine).toBe(0);
      expect(header!.endLine).toBe(4);

      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].className).toBe('GsTopazRowanTool');
    });

    it('parses class with instance variables', () => {
      const text = [
        'Class {',
        "\t#name : 'GsSocket',",
        "\t#superclass : 'IO',",
        '\t#instVars : [',
        "\t\t'readWaiters',",
        "\t\t'writeWaiters'",
        '\t],',
        "\t#category : 'OSAccess-Sockets'",
        '}',
      ].join('\n');
      const regions = parseTonelDocument(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].kind).toBe('tonel-header');
      expect(regions[0].className).toBe('GsSocket');
    });
  });

  describe('leading comments', () => {
    it('handles file with leading comment', () => {
      const text = [
        '"',
        'GsSocket provides the means for creating sockets.',
        '"',
        'Class {',
        "\t#name : 'GsSocket',",
        "\t#superclass : 'IO',",
        "\t#category : 'OSAccess-Sockets'",
        '}',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const header = regions.find((r) => r.kind === 'tonel-header');
      expect(header).toBeDefined();
      expect(header!.className).toBe('GsSocket');
    });

    it('handles single-line leading comment', () => {
      const text = [
        '"A short comment"',
        "Class { #name : 'Foo', #superclass : 'Object', #category : 'Test' }",
      ].join('\n');
      const regions = parseTonelDocument(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].kind).toBe('tonel-header');
    });
  });

  describe('nested brackets', () => {
    it('handles nested blocks in method body', () => {
      const text = [
        "Extension { #name : 'Collection' }",
        '',
        "{ #category : 'enumerating' }",
        'Collection >> flattened [',
        '\tself do: [:each |',
        '\t\t(each isCollection and: [each isString not])',
        '\t\t\tifTrue: [result addAll: each]',
        '\t\t\tifFalse: [result add: each]].',
        '\t^result',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].text).toContain('flattened');
      expect(methods[0].text).toContain('result add: each');
    });

    it('handles brackets inside strings', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'testing' }",
        'Foo >> test [',
        "\t^ 'a [bracket] inside string'",
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].text).toContain('bracket');
    });

    it('does not treat a quote character literal as a string delimiter', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'printing' }",
        'Foo >> quoteForFork: aString [',
        '\t| s |',
        '\ts := WriteStream on: String new.',
        "\ts nextPut: $'.",
        "\taString do: [:c | c = $' ifTrue: [s nextPut: $']. s nextPut: c].",
        "\ts nextPut: $'.",
        '\t^s contents',
        ']',
        '',
        "{ #category : 'printing' }",
        'Foo >> after [',
        '\t^ 42',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(2);
      expect(methods[0].text).toContain('quoteForFork:');
      expect(methods[1].text).toContain('after');
    });

    it('does not treat a bracket character literal as a block delimiter', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'testing' }",
        'Foo >> openBracket [',
        '\t^ $[',
        ']',
        '',
        "{ #category : 'testing' }",
        'Foo >> after [',
        '\t^ 42',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(2);
      expect(methods[0].text).toContain('openBracket');
      expect(methods[1].text).toContain('after');
    });

    it('does not treat a double-quote character literal as a comment delimiter', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'testing' }",
        'Foo >> quote [',
        '\t^ $"',
        ']',
        '',
        "{ #category : 'testing' }",
        'Foo >> after [',
        '\t^ 42',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(2);
      expect(methods[1].text).toContain('after');
    });

    it('handles brackets inside comments', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'testing' }",
        'Foo >> test [',
        '\t"a [bracket] in comment"',
        '\t^ 42',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
    });
  });

  describe('binary selectors', () => {
    it('parses binary selector methods', () => {
      const text = [
        "Extension { #name : 'Association' }",
        '',
        "{ #category : 'Comparing' }",
        'Association >> = anObject [',
        '^(self == anObject)',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].text).toContain('= anObject');
    });

    it('parses << binary selector', () => {
      const text = [
        "Extension { #name : 'Stream' }",
        '',
        "{ #category : 'writing' }",
        'Stream >> << items [',
        '\titems putOn: self',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const methods = regions.filter((r) => r.kind === 'smalltalk-method');
      expect(methods).toHaveLength(1);
      expect(methods[0].text).toContain('<< items');
    });
  });

  describe('line tracking', () => {
    it('records correct line numbers', () => {
      const text = [
        "Extension { #name : 'Object' }", // line 0
        '', // line 1
        "{ #category : 'testing' }", // line 2
        'Object >> isCharacter [', // line 3
        '', // line 4
        '\t^ false', // line 5
        '', // line 6
        ']', // line 7
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;
      expect(method.startLine).toBe(3);
      expect(method.endLine).toBe(6);
      expect(method.annotationStartLine).toBe(2);
      expect(method.closingBracketLine).toBe(7);
    });

    it('records header line range', () => {
      const text = [
        'Class {', // line 0
        "\t#name : 'Foo',", // line 1
        "\t#superclass : 'Object',", // line 2
        "\t#category : 'Test'", // line 3
        '}', // line 4
      ].join('\n');
      const regions = parseTonelDocument(text);
      expect(regions[0].startLine).toBe(0);
      expect(regions[0].endLine).toBe(4);
    });
  });

  describe('integration with Smalltalk parser', () => {
    it('method text is parseable by Lexer + Parser', () => {
      const text = [
        "Extension { #name : 'Object' }",
        '',
        "{ #category : 'testing' }",
        'Object >> isCharacter [',
        '\t^ false',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;

      const lexer = new Lexer(method.text);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { ast, errors } = parser.parse();

      expect(errors).toHaveLength(0);
      expect(ast).toBeDefined();
      expect(ast!.pattern.selector).toBe('isCharacter');
    });

    it('keyword method text is parseable', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'accessing' }",
        'Foo >> at: index put: value [',
        '\t^self basicAt: index put: value',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;

      const lexer = new Lexer(method.text);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { ast, errors } = parser.parse();

      expect(errors).toHaveLength(0);
      expect(ast).toBeDefined();
      expect(ast!.pattern.selector).toBe('at:put:');
    });

    it('class-side method text is parseable', () => {
      const text = [
        "Extension { #name : 'Association' }",
        '',
        "{ #category : 'Instance Creation' }",
        'Association class >> newWithKey: aKey value: aValue [',
        '^ super new key: aKey value: aValue',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;

      const lexer = new Lexer(method.text);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { ast, errors } = parser.parse();

      expect(errors).toHaveLength(0);
      expect(ast!.pattern.selector).toBe('newWithKey:value:');
    });

    it('binary selector method text is parseable', () => {
      const text = [
        "Extension { #name : 'Association' }",
        '',
        "{ #category : 'Comparing' }",
        'Association >> = anObject [',
        '^(self == anObject)',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;

      const lexer = new Lexer(method.text);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { ast, errors } = parser.parse();

      expect(errors).toHaveLength(0);
      expect(ast!.pattern.selector).toBe('=');
    });

    it('complex method with blocks and cascades is parseable', () => {
      const text = [
        "Extension { #name : 'Foo' }",
        '',
        "{ #category : 'actions' }",
        'Foo >> doStuff: arg [',
        '\t| temp |',
        '\ttemp := arg size.',
        '\tself at: temp put: (arg collect: [:e | e printString]).',
        '\t^temp',
        ']',
      ].join('\n');
      const regions = parseTonelDocument(text);
      const method = regions.find((r) => r.kind === 'smalltalk-method')!;

      const lexer = new Lexer(method.text);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { ast, errors } = parser.parse();

      expect(errors).toHaveLength(0);
      expect(ast!.pattern.selector).toBe('doStuff:');
    });
  });
});
