import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The build that turns the vendored GLASS Regex into the shipped payload
 * (gs-src/regex/build/). The adapter applies every change with an expected count,
 * so a re-vendor that no longer fits a change stops the build; these tests check
 * that it does, and that the committed payload is what the build produces today.
 */
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const VENDOR = path.join(REPO, 'gs-src', 'regex', 'vendor', 'glass-regex');
const ADAPTER = path.join(REPO, 'gs-src', 'regex', 'build', 'adapt-glass-regex.js');
const CONVERTER = path.join(REPO, 'gs-src', 'refactoring', 'build', 'tonel-to-gs.js');
const CORE_PKG = 'Regex-Core.package';

let scratch: string;
let ok: ReturnType<typeof adapt>;
let okStage: string;
beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'regex-build-'));
  okStage = path.join(scratch, 'ok');
  ok = adapt(VENDOR, okStage);
});
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function adapt(vendorDir: string, stage: string) {
  return spawnSync(process.execPath, [ADAPTER, vendorDir, stage], { encoding: 'utf8' });
}

/** A writable copy of the vendored packages, for a test to tamper with. */
function vendorCopy(name: string): string {
  const dir = path.join(scratch, name);
  fs.cpSync(VENDOR, dir, { recursive: true });
  return dir;
}

function appendToMethod(vendorDir: string, relative: string, text: string): void {
  const file = path.join(vendorDir, CORE_PKG, relative);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + text);
}

describe('adapt-glass-regex.js', () => {
  it('adapts the vendored packages: 26 library classes and 2 test classes, all prefixed Gs', () => {
    expect(ok.status, ok.stderr).toBe(0);
    const core = fs.readdirSync(path.join(okStage, 'Regex-Core'));
    const tests = fs.readdirSync(path.join(okStage, 'Regex-Tests-Core'));
    expect(core).toHaveLength(26);
    expect(tests.sort()).toEqual(['GsRxMatcherTest.class.st', 'GsRxParserTest.class.st']);
    expect([...core, ...tests].every((f) => f.startsWith('Gs'))).toBe(true);
  });

  it('writes no extension of String or any other kernel class', () => {
    const all = fs.readdirSync(path.join(okStage, 'Regex-Core'));

    expect(all.some((f) => f.endsWith('.extension.st'))).toBe(false);
  });

  it("removes the :name: branch from the parser's atom", () => {
    const parser = fs.readFileSync(path.join(okStage, 'Regex-Core', 'GsRxParser.class.st'), 'utf8');
    const atom = parser.slice(parser.indexOf('GsRxParser >> atom ['));

    expect(atom.slice(0, atom.indexOf('\n]\n'))).not.toContain('messagePredicate');
  });

  it("keeps the library's documentation as written: comments still name RxParser", () => {
    const parser = fs.readFileSync(path.join(okStage, 'Regex-Core', 'GsRxParser.class.st'), 'utf8');

    expect(parser).toContain('(C) 1996, 1999 Vassili Bykov');
    expect(parser).toContain('RxParser');
  });

  it('stops the build when a port finds more sites than it expects', () => {
    const vendor = vendorCopy('drift-port');
    appendToMethod(vendor, 'RxParser.class/class/initialize.st', '.\n\tCharacter escape');

    const run = adapt(vendor, path.join(scratch, 'drift-port-out'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('expected 1 site(s), found 2');
  });

  it('stops the build when upstream adds an extension method', () => {
    const vendor = vendorCopy('drift-ext');
    fs.writeFileSync(
      path.join(vendor, CORE_PKG, 'String.extension', 'instance', 'asRegexNew.st'),
      '*Regex-Core\nasRegexNew\n\t^self asRegex',
    );

    const run = adapt(vendor, path.join(scratch, 'drift-ext-out'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('expected one extension (String, 12 methods)');
  });

  it('makes word boundaries count _ as part of a word', () => {
    const matcher = fs.readFileSync(
      path.join(okStage, 'Regex-Core', 'GsRxMatcher.class.st'),
      'utf8',
    );

    expect(matcher).toContain('aCharacterOrNil isAlphaNumeric or: [aCharacterOrNil == $_]');
  });

  it('stops the build when the word-character test is no longer what it was', () => {
    const vendor = vendorCopy('drift-word');
    const file = path.join(vendor, CORE_PKG, 'RxMatcher.class', 'instance', 'isWordChar..st');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('isAlphaNumeric]', 'isLetter]'));

    const run = adapt(vendor, path.join(scratch, 'drift-word-out'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('isWordChar:');
  });

  it('stops the build when the :name: branch is no longer where it was', () => {
    const vendor = vendorCopy('drift-colon');
    const atom = path.join(vendor, CORE_PKG, 'RxParser.class', 'instance', 'atom.st');
    fs.writeFileSync(
      atom,
      fs.readFileSync(atom, 'utf8').replace('lookahead = $: ifTrue: ', 'lookahead = $; ifTrue: '),
    );

    const run = adapt(vendor, path.join(scratch, 'drift-colon-out'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(':name: branch');
  });
});

describe('the committed payload', () => {
  // A changed source with a stale payload would ship the old behaviour while the
  // source reads as the new one.
  it('is what build-regex.sh produces from the current source', () => {
    expect(ok.status, ok.stderr).toBe(0);
    const out = path.join(scratch, 'fresh-out.gs');
    const convert = spawnSync(
      process.execPath,
      [
        CONVERTER,
        '--dict',
        'GsRegexLibrary',
        '--header',
        path.join(REPO, 'gs-src', 'regex', 'build', 'regex-provenance-header.gs'),
        '--out',
        out,
        path.join(okStage, 'Regex-Core'),
      ],
      { encoding: 'utf8' },
    );
    expect(convert.status, convert.stderr).toBe(0);

    expect(fs.readFileSync(out, 'utf8')).toBe(
      fs.readFileSync(path.join(REPO, 'resources', 'regex', 'regex-core.gs'), 'utf8'),
    );
  });
});
