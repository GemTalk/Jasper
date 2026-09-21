#!/usr/bin/env node
/*
 * Tonel -> GemStone topaz-chunk (.gs) converter for the refactoring engine's
 * vendored AST substrate.
 *
 * The 3.6.2 test stone has no runtime Tonel reader, so the shipped payload must
 * be plain topaz chunk format that `GsFileIn fromPath:on:#serverUtf8File`
 * understands (the same mechanism enhancedInspectorInstall.ts uses). This script
 * reads one or more Tonel package directories (`*.class.st` class files and
 * `*.extension.st` extension files) and emits a single concatenated `.gs` file:
 *
 *   1. a provenance header (topaz `!` comment lines),
 *   2. all class declarations, topologically ordered so a superclass is defined
 *      before its subclasses,
 *   3. all instance/class method definitions, then extension methods.
 *
 * Class comments are preserved. Nothing here is committed -- the loader commits.
 *
 * Usage:
 *   node tonel-to-gs.js --dict <SymbolDictionary> --header <headerFile> \
 *        --out <out.gs> <packageDir> [<packageDir> ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- Tonel parsing ---------------------------------------------------- */

// Read a Tonel double-quoted string starting at text[i] (text[i] === '"').
// Returns { value, next } with "" decoded to " and the index past the string.
function readTonelComment(text, i) {
  let out = '';
  i++; // skip opening "
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      return { value: out, next: i + 1 };
    }
    out += ch;
    i++;
  }
  throw new Error('unterminated Tonel comment');
}

// Extract the quoted names from a `[ 'a', 'b' ]` list.
function parseNameList(s) {
  const names = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(s)) !== null) names.push(m[1].replace(/''/g, "'"));
  return names;
}

function parseTonelFile(text) {
  let i = 0;
  // Skip leading whitespace.
  while (i < text.length && /\s/.test(text[i])) i++;
  let comment = '';
  if (text[i] === '"') {
    const r = readTonelComment(text, i);
    comment = r.value;
    i = r.next;
  }
  // Find the Class {...} / Extension {...} header.
  const rest = text.slice(i);
  const headMatch = rest.match(/(Class|Extension)\s*\{/);
  if (!headMatch) throw new Error('no Class/Extension header');
  const kind = headMatch[1] === 'Extension' ? 'extension' : 'class';
  const braceStart = i + headMatch.index + headMatch[0].length - 1; // at the {
  // Find the matching } for the header block (no nested braces in practice).
  let depth = 0,
    j = braceStart,
    headerBody = '';
  for (; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
    headerBody += text[j];
  }
  const nameM = headerBody.match(/#name\s*:\s*'((?:[^']|'')*)'/);
  const name = nameM ? nameM[1].replace(/''/g, "'") : null;
  const superM = headerBody.match(/#superclass\s*:\s*'((?:[^']|'')*)'/);
  const superclass = superM ? superM[1].replace(/''/g, "'") : null;
  const instVars = listField(headerBody, 'instVars');
  const classVars = listField(headerBody, 'classVars');
  const classInstVars = listField(headerBody, 'classInstVars');
  const catM = headerBody.match(/#category\s*:\s*'((?:[^']|'')*)'/);
  const category = catM ? catM[1].replace(/''/g, "'") : '';

  const methods = parseMethods(text.slice(j), name);
  return { kind, name, superclass, instVars, classVars, classInstVars, category, comment, methods };
}

function listField(headerBody, field) {
  const m = headerBody.match(new RegExp('#' + field + '\\s*:\\s*\\[([^\\]]*)\\]'));
  return m ? parseNameList(m[1]) : [];
}

// Parse the method chunks that follow the header. Each is:
//   { #category : '...' }
//   Name [class ]>> selector args [
//       body...
//   ]
function parseMethods(text, _className) {
  const lines = text.split('\n');
  const methods = [];
  let k = 0;
  while (k < lines.length) {
    const line = lines[k];
    const catM = line.match(/^\{\s*#category\s*:\s*'((?:[^']|'')*)'\s*\}\s*$/);
    if (!catM) {
      k++;
      continue;
    }
    const category = catM[1].replace(/''/g, "'");
    const sig = lines[k + 1];
    if (sig === undefined) break;
    // Name >> pattern [   or   Name class >> pattern [   (trailing space after [ is common)
    const sigM = sig.match(/^(\S+)\s+(class\s+)?>>\s*(.*?)\s*\[\s*$/);
    if (!sigM) {
      k++;
      continue;
    }
    const side = sigM[2] ? 'class' : 'instance';
    const pattern = sigM[3];
    // Body runs until a line that is just ']' (column 0, maybe trailing space) --
    // the Tonel convention: body lines are indented, the closing bracket is not.
    let b = k + 2;
    const bodyLines = [];
    while (b < lines.length && !/^\]\s*$/.test(lines[b])) {
      bodyLines.push(lines[b]);
      b++;
    }
    methods.push({ side, category, source: pattern + '\n' + bodyLines.join('\n') });
    k = b + 1;
  }
  return methods;
}

/* ---- .gs emission ----------------------------------------------------- */

function gsString(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function gsSymbol(s) {
  return "#'" + String(s).replace(/'/g, "''") + "'";
}
function symbolArray(names) {
  return '#(' + names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(' ') + ')';
}

// Derive a selector symbol from a Tonel method pattern line, e.g.
//   'readStreamPortable'                       -> 'readStreamPortable'  (unary)
//   'lastIndexOf: e startingAt: i ifAbsent: b' -> 'lastIndexOf:startingAt:ifAbsent:'
//   '+ aNumber'                                -> '+'  (binary)
function selectorFromPattern(pattern) {
  const p = pattern.trim();
  const kw = p.match(/[A-Za-z_][A-Za-z0-9_]*:/g);
  if (kw && kw.length) return kw.join('');
  return p.split(/\s+/)[0];
}

function topoSortClasses(classes) {
  const byName = new Map(classes.map((c) => [c.name, c]));
  const done = new Set(),
    out = [];
  function visit(c) {
    if (done.has(c.name)) return;
    const sup = byName.get(c.superclass); // undefined => base-kernel superclass
    if (sup) visit(sup);
    done.add(c.name);
    out.push(c);
  }
  classes.forEach(visit);
  return out;
}

function emitClassDeclaration(c, dict) {
  return [
    'doit',
    '| cls |',
    `cls := ${c.superclass} subclass: ${gsString(c.name)}`,
    `  instVarNames: ${symbolArray(c.instVars)}`,
    `  classVars: ${symbolArray(c.classVars)}`,
    `  classInstVars: ${symbolArray(c.classInstVars)}`,
    '  poolDictionaries: #()',
    `  inDictionary: ${dict}.`,
    `cls category: ${gsString(c.category)}.`,
    c.comment && c.comment.length ? `cls comment: ${gsString(c.comment)}.` : '"no comment"',
    'true.',
    '%',
    '',
    `removeallmethods ${c.name}`,
    `removeallclassmethods ${c.name}`,
    '',
  ].join('\n');
}

function emitMethod(className, m) {
  const directive = m.side === 'class' ? 'classmethod:' : 'method:';
  return [`category: ${gsString(m.category)}`, `${directive} ${className}`, m.source, '%', ''].join(
    '\n',
  );
}

// Emit an extension method as a self-gating doit: compile it ONLY if the target
// class does not already understand the selector. This is how the compat
// backports install on exactly the releases that lack them and never shadow a
// kernel method a newer release already provides (shadowing a real kernel
// method is the bug this avoids). Feature detection is per method, baked into
// the payload, so both the human and the client load paths get it for free.
function emitFeatureDetectedMethod(className, m) {
  const receiver = m.side === 'class' ? `${className} class` : className;
  const selector = selectorFromPattern(m.source.split('\n')[0]);
  return [
    'doit',
    `(${receiver} canUnderstand: ${gsSymbol(selector)}) ifFalse: [`,
    `  ${receiver}`,
    `    compileMethod: ${gsString(m.source)}`,
    '    dictionaries: System myUserProfile symbolList',
    `    category: ${gsString(m.category)} ].`,
    'true.',
    '%',
    '',
  ].join('\n');
}

// Emit a kernel extension method as a doit that compiles it ONLY if the target
// class does not already DEFINE the selector itself.
//
// Why `includesSelector:` and not the `canUnderstand:` of
// `emitFeatureDetectedMethod`: these extensions come as a family that overrides
// itself down a hierarchy — `CharacterCollection>>rbStoreOn:` and
// `Symbol>>rbStoreOn:` are different methods, and `CharacterCollection` files in
// first. `canUnderstand:` would see the inherited one and silently drop Symbol's
// override. A backport asks "can anything answer this?"; an extension asks "does
// THIS class define it?".
//
// Why gate them at all: on a rowan3 extent Rowan has already installed this exact
// family (AST-Kernel-Core is where we vendored them from — byte-identical), and
// re-filing them would overwrite Rowan's copies with ours. Skipping leaves the
// stone's own methods alone; on a base extent nothing is present and every one
// installs, exactly as before.
function emitPresenceGatedMethod(className, m) {
  const receiver = m.side === 'class' ? `${className} class` : className;
  const selector = selectorFromPattern(m.source.split('\n')[0]);
  return [
    'doit',
    `(${receiver} includesSelector: ${gsSymbol(selector)}) ifFalse: [`,
    `  ${receiver}`,
    `    compileMethod: ${gsString(m.source)}`,
    '    dictionaries: System myUserProfile symbolList',
    `    category: ${gsString(m.category)} ].`,
    'true.',
    '%',
    '',
  ].join('\n');
}

// Emit the load manifest: expected persistent classes + per-class defined-method
// counts, stored into the dedicated dictionary for the loader's post-load
// completeness check. The counts come from the same Tonel the payload is built
// from, so a file-in that silently drops classes or methods (the converter once
// dropped ~40% of methods) shows up as a shortfall against the manifest.
function emitManifest(classes, dict) {
  const rows = classes.map(
    (c) => `m add: (Array with: ${gsString(c.name)} with: ${c.methods.length}).`,
  );
  return [
    '! GENERATED FILE - DO NOT EDIT BY HAND. Rebuild via',
    '! gs-src/refactoring/build/build-refactoring.sh from gs-src/refactoring/ source.',
    '! Load manifest (expected classes + defined-method counts) for the',
    "! loader's post-load completeness check. Generated by tonel-to-gs.js.",
    'doit',
    '| m |',
    'm := OrderedCollection new.',
    ...rows,
    `${dict} at: #GsRefactoringManifest put: m.`,
    'true.',
    '%',
    '',
  ].join('\n');
}

/* ---- main ------------------------------------------------------------- */

function main() {
  const args = process.argv.slice(2);
  let dict = 'UserGlobals',
    headerFile = null,
    out = null,
    manifest = null;
  let featureDetect = false;
  let gateExtensions = false;
  const dirs = [];
  for (let a = 0; a < args.length; a++) {
    if (args[a] === '--dict') dict = args[++a];
    else if (args[a] === '--header') headerFile = args[++a];
    else if (args[a] === '--out') out = args[++a];
    else if (args[a] === '--manifest') manifest = args[++a];
    else if (args[a] === '--feature-detect') featureDetect = true;
    else if (args[a] === '--gate-extensions') gateExtensions = true;
    else dirs.push(args[a]);
  }
  if ((!out && !manifest) || dirs.length === 0) {
    console.error(
      'usage: tonel-to-gs.js --dict D [--header H] [--feature-detect] ' +
        '[--gate-extensions] (--out O | --manifest M) <packageDir>...',
    );
    process.exit(2);
  }

  const classes = [],
    extensions = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (f === 'package.st') continue;
      const full = path.join(dir, f);
      if (f.endsWith('.class.st')) classes.push(parseTonelFile(fs.readFileSync(full, 'utf8')));
      else if (f.endsWith('.extension.st'))
        extensions.push(parseTonelFile(fs.readFileSync(full, 'utf8')));
    }
  }

  // Manifest mode: emit only the expected-classes/counts file and stop.
  if (manifest) {
    fs.writeFileSync(manifest, emitManifest(topoSortClasses(classes), dict));
    console.error(`wrote ${manifest}: manifest of ${classes.length} classes`);
    if (!out) return;
  }

  const parts = [];
  if (headerFile) parts.push(fs.readFileSync(headerFile, 'utf8').replace(/\n?$/, '\n'));
  parts.push('! Class declarations\n');
  for (const c of topoSortClasses(classes)) parts.push(emitClassDeclaration(c, dict));
  parts.push('! Class implementations\n');
  for (const c of classes) {
    for (const m of c.methods.filter((m) => m.side === 'instance'))
      parts.push(emitMethod(c.name, m));
    for (const m of c.methods.filter((m) => m.side === 'class')) parts.push(emitMethod(c.name, m));
  }
  parts.push('! Extension methods\n');
  for (const e of extensions)
    for (const m of e.methods) {
      if (featureDetect) parts.push(emitFeatureDetectedMethod(e.name, m));
      else if (gateExtensions) parts.push(emitPresenceGatedMethod(e.name, m));
      else parts.push(emitMethod(e.name, m));
    }

  // Topaz file-in does not run class-side `initialize` the way a Pharo image
  // load does, so classes that rely on it (e.g. RBScanner's character tables,
  // RBConfigurableFormatter's default settings) come up with nil class vars.
  // Emit an explicit initialize doit for every class that defines one.
  const initClasses = topoSortClasses(classes)
    .filter((c) =>
      c.methods.some((m) => m.side === 'class' && m.source.split('\n')[0].trim() === 'initialize'),
    )
    .map((c) => c.name);
  if (initClasses.length) {
    parts.push('! Class-side initializers (topaz file-in does not auto-run them)\n');
    for (const name of initClasses) parts.push(`doit\n${name} initialize.\ntrue.\n%\n`);
  }

  fs.writeFileSync(out, parts.join('\n'));
  const nMethods =
    classes.reduce((s, c) => s + c.methods.length, 0) +
    extensions.reduce((s, e) => s + e.methods.length, 0);
  console.error(
    `wrote ${out}: ${classes.length} classes, ${extensions.length} extensions, ${nMethods} methods`,
  );
}

main();
