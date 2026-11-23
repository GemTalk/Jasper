#!/usr/bin/env node
/*
 * Adapt the vendored GLASS Regex packages for GemStone and write them as Tonel,
 * ready for gs-src/refactoring/build/tonel-to-gs.js.
 *
 * The vendored filetree under gs-src/regex/vendor/glass-regex/ is never edited.
 * Every change is applied here, to an in-memory copy, and every change carries an
 * expected count: if a re-vendor makes a count drift, the build stops instead of
 * shipping a change that no longer means what PROVENANCE.md says it means.
 *
 * The changes, in the order applied (PROVENANCE.md lists the same ones for people):
 *   1. Leave out the package's only extension, the 12 convenience methods it adds to
 *      String. Jasper never adds methods to a kernel class for this feature.
 *   2. Delete one test, RxMatcherTest>>testRegex004 (see REMOVED_METHODS).
 *   3. Port Pharo/GLASS idioms to plain GemStone (PORTS).
 *   4. Make `:` an ordinary character (COLON_IS_LITERAL), and count `_` as part of a word
 *      for \< \> \b \B (UNDERSCORE_IN_WORDS).
 *   5. Add a class-side #new that sends #initialize where the library relies on it.
 *   6. Rewrite the tests' calls to the String helpers as calls to Jasper's GsRegex.
 *   7. Prefix every class name with `Gs`, in code only: comments and strings, which
 *      hold the library's own documentation, keep the original names.
 *
 * Usage: node adapt-glass-regex.js <vendorDir> <stageDir>
 * Writes <stageDir>/Regex-Core/*.class.st and <stageDir>/Regex-Tests-Core/*.class.st.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CLASS_PREFIX = 'Gs';
const CORE = 'Regex-Core.package';
const TESTS = 'Regex-Tests-Core.package';

/* ---- reading the filetree --------------------------------------------- */

function readMethods(dir) {
  const out = [];
  for (const side of ['instance', 'class']) {
    const sideDir = path.join(dir, side);
    if (!fs.existsSync(sideDir)) continue;
    for (const f of fs.readdirSync(sideDir).sort()) {
      if (!f.endsWith('.st')) continue;
      const text = fs.readFileSync(path.join(sideDir, f), 'utf8');
      const nl = text.indexOf('\n');
      const category = text.slice(0, nl).trim();
      const source = text.slice(nl + 1).replace(/\s+$/, '');
      out.push({ side, category, source, selector: selectorOf(source) });
    }
  }
  return out;
}

// The selector named by the first line of a method's source.
function selectorOf(source) {
  const pattern = source.split('\n')[0].trim();
  const keywords = pattern.match(/[A-Za-z_][A-Za-z0-9_]*:/g);
  return keywords ? keywords.join('') : pattern.split(/\s+/)[0];
}

function readPackage(dir) {
  const classes = [];
  const extensions = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (entry.endsWith('.class')) {
      const props = JSON.parse(fs.readFileSync(path.join(full, 'properties.json'), 'utf8'));
      if (props.type !== 'normal')
        throw new Error(`${props.name}: unsupported class type ${props.type}`);
      const readme = path.join(full, 'README.md');
      classes.push({
        name: props.name,
        superclass: props.super,
        instVars: props.instvars,
        classVars: props.classvars,
        classInstVars: props.classinstvars,
        category: props.category,
        comment: fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8').replace(/\s+$/, '') : '',
        methods: readMethods(full),
      });
    } else if (entry.endsWith('.extension')) {
      extensions.push({ name: entry.slice(0, -'.extension'.length), methods: readMethods(full) });
    }
  }
  return { classes, extensions };
}

/* ---- audited changes ---------------------------------------------------- */

function fail(message) {
  console.error(`ERROR: ${message}`);
  console.error('Upstream changed, or a change below no longer fits it. Review before shipping.');
  process.exit(1);
}

function findMethod(pkg, className, side, selector) {
  const cls = pkg.classes.find((c) => c.name === className);
  if (!cls) fail(`no class ${className}`);
  const m = cls.methods.find((x) => x.side === side && x.selector === selector);
  return { cls, m };
}

// 2. Test removed: it checks the `:name:` syntax (change 4 deletes it), and its
// expectation that `y` is not a vowel does not hold on GemStone, whose
// Character>>isVowel answers true for $y.
const REMOVED_METHODS = [
  { package: TESTS, className: 'RxMatcherTest', side: 'instance', selector: 'testRegex004' },
];

// 3. Pharo/GLASS idioms that plain GemStone 3.6.2 and 3.7.x lack, each replaced by
// the GemStone equivalent. `count` is the exact number of sites across Regex-Core.
const PORTS = [
  {
    why: 'Character class>>escape does not exist in GemStone; Character class>>esc does',
    find: /Character escape/g,
    replace: 'Character esc',
    count: 1,
  },
  {
    why: 'Association class>>key:value: does not exist in GemStone; -> builds the same Association',
    find: /\(Association key: ([A-Za-z]+) value: (#[A-Za-z]+)\)/g,
    replace: '($1 -> $2)',
    count: 10,
  },
  {
    why: 'String>>writeStream does not exist in GemStone',
    find: /\(String new: ([^)]*)\) writeStream/g,
    replace: '(WriteStream on: (String new: $1))',
    count: 4,
  },
  {
    why: 'Collection>>contains: does not exist in GemStone; anySatisfy: is the same test',
    find: / contains:/g,
    replace: ' anySatisfy:',
    count: 9,
  },
  {
    why: 'Character>>sameAs: does not exist in GemStone; comparing asLowercase is the same test',
    find: /(char1|char|prefixChar|wanted) sameAs: (char2|prefixChar|wanted)/g,
    replace: '$1 asLowercase = $2 asLowercase',
    count: 3,
  },
];

// 3, in the tests: Pharo idioms only the tests use.
const TEST_PORTS = [
  {
    why: 'String class>>cr does not exist in GemStone',
    find: /String cr\b/g,
    replace: '(String with: Character cr)',
    count: 4,
  },
  {
    why: 'String>>reversed does not exist in GemStone 3.6.2; reverse is the same',
    find: /\breversed\b/g,
    replace: 'reverse',
    count: 3,
  },
];

// 4. In this dialect `:name:` means "a character that answers true to #name", so
// `printOn:` was a syntax error and `at:put:` searched for something else.
// Smalltalk selectors are full of colons, and the syntax let the pattern choose
// a message to send, so the branch that reads it is removed and `:` falls
// through to the ordinary-character case below it. `[:alpha:]` inside a
// character set is parsed elsewhere (RxCharSetParser) and keeps working.
const COLON_IS_LITERAL = {
  className: 'RxParser',
  side: 'instance',
  selector: 'atom',
  find: [
    '\tlookahead = $: ifTrue: ',
    "\t\t\t[\"<atom> ::= ':' <messagePredicate> ':' \"",
    '',
    '\t\t\tself match: $:.',
    '\t\t\tatom := self messagePredicate.',
    '\t\t\tself match: $:.',
    '\t\t\t^atom].',
    '',
  ].join('\n'),
};

// 4, continued. `\<`, `\>`, `\b` and `\B` decide where a word starts and ends with
// RxMatcher>>isWordChar:, whose comment says "alphanumeric or _" but whose code checks
// alphanumeric only. So `\<halt\>` matched the `halt` in `_halt:`, which no other regex
// tool does, and which disagrees with this library's own `\w` (letters, digits and `_`).
const UNDERSCORE_IN_WORDS = {
  className: 'RxMatcher',
  side: 'instance',
  selector: 'isWordChar:',
  find: '\t\tand: [aCharacterOrNil isAlphaNumeric]',
  replace: '\t\tand: [aCharacterOrNil isAlphaNumeric or: [aCharacterOrNil == $_]]',
};

// 5. Pharo's Behavior>>new sends #initialize; GemStone's does not, so these two
// classes came up with nil instance variables and nearly every match failed.
const ADDED_METHODS = ['RxmBranch', 'RxmSubstring'].map((className) => ({
  className,
  side: 'class',
  category: 'instance creation',
  source: [
    'new',
    '\t"GemStone port (Jasper): Pharo\'s #new sends #initialize; GemStone\'s does not."',
    '',
    '\t^super new initialize',
  ].join('\n'),
}));

// 6. The tests call the String helpers (change 1 leaves them out) on string
// literals. Each call becomes the GsRegex call that does the same thing; the
// pattern, the text and the expected result are unchanged. `count` is exact.
const LIT = "'(?:[^']|'')*'";
const TEST_REWRITES = [
  {
    find: new RegExp(`(${LIT}) matchesRegex: (${LIT})`, 'g'),
    replace: 'GsRegex matches: $1 pattern: $2',
    count: 55,
  },
  {
    find: new RegExp(`(${LIT}) matchesRegexIgnoringCase: (${LIT})`, 'g'),
    replace: 'GsRegex matchesIgnoringCase: $1 pattern: $2',
    count: 3,
  },
  {
    find: new RegExp(`(${LIT}) prefixMatchesRegex: (${LIT})`, 'g'),
    replace: 'GsRegex prefixMatches: $1 pattern: $2',
    count: 2,
  },
  {
    find: new RegExp(`(${LIT}) prefixMatchesRegexIgnoringCase: (${LIT})`, 'g'),
    replace: 'GsRegex prefixMatchesIgnoringCase: $1 pattern: $2',
    count: 2,
  },
  {
    find: new RegExp(`(${LIT}) asRegexIgnoringCase\\b`, 'g'),
    replace: '(GsRegex patternIgnoringCase: $1)',
    count: 3,
  },
  { find: new RegExp(`(${LIT}) asRegex\\b`, 'g'), replace: '(GsRegex pattern: $1)', count: 5 },
  {
    find: new RegExp(`(${LIT}) allRegexMatches: (${LIT})`, 'g'),
    replace: 'GsRegex allMatchesIn: $1 pattern: $2',
    count: 1,
  },
  {
    find: new RegExp(`(${LIT}) allRangesOfRegexMatches: (${LIT})`, 'g'),
    replace: 'GsRegex allRangesIn: $1 pattern: $2',
    count: 1,
  },
  {
    find: new RegExp(`(${LIT})\\s+copyWithRegex: (${LIT}) matchesReplacedWith: `, 'g'),
    replace: 'GsRegex copy: $1 replacing: $2 with: ',
    count: 1,
  },
  {
    find: new RegExp(`(${LIT})\\s+copyWithRegex: (${LIT})\\s+matchesTranslatedUsing: `, 'g'),
    replace: 'GsRegex copy: $1 translating: $2 using: ',
    count: 1,
  },
  {
    find: new RegExp(`(${LIT}) regex: (${LIT}) matchesDo: `, 'g'),
    replace: 'GsRegex in: $1 pattern: $2 do: ',
    count: 1,
  },
  {
    find: new RegExp(`(${LIT}) regex: (${LIT}) matchesCollect: `, 'g'),
    replace: 'GsRegex in: $1 pattern: $2 collect: ',
    count: 1,
  },
];
// A send of any of the 12 helpers, as it would appear in code.
const STRING_HELPER_SEND =
  /\b(asRegex|asRegexIgnoringCase)\b|\b(matchesRegex|matchesRegexIgnoringCase|prefixMatchesRegex|prefixMatchesRegexIgnoringCase|allRegexMatches|allRangesOfRegexMatches|copyWithRegex|regex):/;

// Count and apply one global rule over a set of methods, failing on drift.
function applyRule(methods, rule, label) {
  let total = 0;
  const touched = [];
  for (const m of methods) {
    const n = (m.source.match(rule.find) || []).length;
    if (n) {
      m.source = m.source.replace(rule.find, rule.replace);
      total += n;
      touched.push(`${m.owner}${m.side === 'class' ? ' class' : ''}>>${m.selector}`);
    }
  }
  if (total !== rule.count) fail(`${label}: expected ${rule.count} site(s), found ${total}`);
  console.error(`  ${label}: ${total} site(s) in ${touched.length} method(s)`);
}

/* ---- class renames, outside comments and strings ----------------------- */

// Walk Smalltalk source, handing each identifier to `onWord` and each "comment",
// 'string' or $c character literal to `onOther`, and join what they return.
function mapCode(source, onWord, onOther) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === ch) {
          if (ch === "'" && source[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += onOther(source.slice(i, j + 1));
      i = j + 1;
    } else if (ch === '$') {
      out += onOther(source.slice(i, i + 2));
      i += 2;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      out += onWord(source.slice(i, j));
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Rename class names in code only, so the library's documentation (most of it is
// in comments) keeps the names it was written with.
function renameIdentifiers(source, renames) {
  return mapCode(
    source,
    (word) => (Object.prototype.hasOwnProperty.call(renames, word) ? renames[word] : word),
    (other) => other,
  );
}

// The source with every comment, string and character literal blanked out.
function codeOnly(source) {
  return mapCode(
    source,
    (word) => word,
    (other) => ' '.repeat(other.length),
  );
}

/* ---- Tonel output -------------------------------------------------------- */

function tonelString(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}
function tonelList(names) {
  return names.length ? `[ ${names.map(tonelString).join(', ')} ]` : '[ ]';
}

function toTonel(c) {
  const lines = [];
  if (c.comment) lines.push('"', c.comment.replace(/"/g, '""'), '"');
  lines.push(
    'Class {',
    `\t#name : ${tonelString(c.name)},`,
    `\t#superclass : ${tonelString(c.superclass)},`,
    `\t#instVars : ${tonelList(c.instVars)},`,
    `\t#classVars : ${tonelList(c.classVars)},`,
    `\t#classInstVars : ${tonelList(c.classInstVars)},`,
    `\t#category : ${tonelString(c.category)}`,
    '}',
    '',
  );
  for (const m of c.methods) {
    const [pattern, ...body] = m.source.split('\n');
    if (body.some((l) => /^\]\s*$/.test(l)))
      fail(`${c.name}>>${m.selector}: a body line would end the Tonel method early`);
    lines.push(`{ #category : ${tonelString(m.category)} }`);
    lines.push(`${c.name}${m.side === 'class' ? ' class' : ''} >> ${pattern.trim()} [`);
    lines.push(...body, ']', '');
  }
  return lines.join('\n');
}

/* ---- main ---------------------------------------------------------------- */

function main() {
  const [vendorDir, stageDir] = process.argv.slice(2);
  if (!vendorDir || !stageDir) {
    console.error('usage: adapt-glass-regex.js <vendorDir> <stageDir>');
    process.exit(2);
  }
  const core = readPackage(path.join(vendorDir, CORE));
  const tests = readPackage(path.join(vendorDir, TESTS));
  for (const pkg of [core, tests])
    for (const c of pkg.classes) for (const m of c.methods) m.owner = c.name;
  const pkgByName = { [CORE]: core, [TESTS]: tests };

  // 1. The String extension is the package's only extension; it is not shipped.
  const extMethods = core.extensions.reduce((n, e) => n + e.methods.length, 0);
  const extNames = core.extensions.map((e) => e.name).join(', ');
  if (extNames !== 'String' || extMethods !== 12 || tests.extensions.length)
    fail(
      `expected one extension (String, 12 methods), found ${extNames || 'none'} with ${extMethods}`,
    );
  core.extensions = [];
  console.error('  1. left out the String extension: 12 methods');

  // 2.
  for (const r of REMOVED_METHODS) {
    const { cls, m } = findMethod(pkgByName[r.package], r.className, r.side, r.selector);
    if (!m) fail(`method to remove not found: ${r.className}>>${r.selector}`);
    cls.methods.splice(cls.methods.indexOf(m), 1);
    console.error(`  2. removed ${r.className}>>${r.selector}`);
  }

  // 3.
  const coreMethods = core.classes.flatMap((c) => c.methods);
  PORTS.forEach((rule, k) => applyRule(coreMethods, rule, `3.${k + 1} ${rule.why}`));
  const testMethodsToPort = tests.classes.flatMap((c) => c.methods);
  TEST_PORTS.forEach((rule, k) =>
    applyRule(testMethodsToPort, rule, `3.t${k + 1} tests: ${rule.why}`),
  );

  // 4.
  {
    const { m } = findMethod(
      core,
      COLON_IS_LITERAL.className,
      COLON_IS_LITERAL.side,
      COLON_IS_LITERAL.selector,
    );
    const n = m ? m.source.split(COLON_IS_LITERAL.find).length - 1 : 0;
    if (n !== 1) fail(`4. expected the :name: branch once in RxParser>>atom, found ${n}`);
    m.source = m.source.replace(COLON_IS_LITERAL.find, '');
    console.error('  4. removed the :name: branch from RxParser>>atom');
  }
  {
    const u = UNDERSCORE_IN_WORDS;
    const { m } = findMethod(core, u.className, u.side, u.selector);
    const n = m ? m.source.split(u.find).length - 1 : 0;
    if (n !== 1)
      fail(`4. expected the alphanumeric test once in RxMatcher>>isWordChar:, found ${n}`);
    m.source = m.source.replace(u.find, u.replace);
    console.error('  4. RxMatcher>>isWordChar: counts _ as a word character');
  }

  // 5.
  for (const a of ADDED_METHODS) {
    const { cls, m } = findMethod(core, a.className, a.side, selectorOf(a.source));
    if (m) fail(`5. ${a.className} class>>new already exists upstream`);
    cls.methods.push({
      side: a.side,
      category: a.category,
      source: a.source,
      selector: selectorOf(a.source),
      owner: a.className,
    });
    console.error(`  5. added ${a.className} class>>new`);
  }

  // 6.
  const testMethods = tests.classes.flatMap((c) => c.methods);
  TEST_REWRITES.forEach((rule, k) =>
    applyRule(
      testMethods,
      rule,
      `6.${k + 1} tests: ${rule.replace.split(' ').slice(0, 2).join(' ')}`,
    ),
  );
  const leftover = testMethods.filter((m) => STRING_HELPER_SEND.test(codeOnly(m.source)));
  if (leftover.length)
    fail(`6. tests still call a String helper: ${leftover.map((m) => m.selector).join(', ')}`);

  // 7.
  const renames = {};
  for (const c of [...core.classes, ...tests.classes]) renames[c.name] = CLASS_PREFIX + c.name;
  let renamedSites = 0;
  for (const pkg of [core, tests])
    for (const c of pkg.classes) {
      for (const m of c.methods) {
        const before = m.source;
        m.source = renameIdentifiers(m.source, renames);
        if (before !== m.source) renamedSites++;
      }
      c.name = renames[c.name];
      if (renames[c.superclass]) c.superclass = renames[c.superclass];
    }
  console.error(
    `  7. prefixed ${Object.keys(renames).length} class names with ${CLASS_PREFIX}, in ${renamedSites} method(s)`,
  );

  for (const [dirName, pkg] of [
    ['Regex-Core', core],
    ['Regex-Tests-Core', tests],
  ]) {
    const out = path.join(stageDir, dirName);
    fs.mkdirSync(out, { recursive: true });
    for (const c of pkg.classes) fs.writeFileSync(path.join(out, `${c.name}.class.st`), toTonel(c));
  }
}

main();
