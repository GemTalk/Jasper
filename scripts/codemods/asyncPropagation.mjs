// Shared engine for the codemods that turn a blocking fetch async.
//
// A seed marks where promises start: a call that now answers one, a
// function made async, or a function type whose return becomes a promise.
// From there the type checker drives everything else, over production code
// only (tests are neither rewritten nor followed, so a test caller can never
// shape the production rewrite):
//
// - A call that now answers a promise is awaited, and the function holding
//   it becomes async with its declared return type wrapped in Promise<>.
// - A function that now answers a promise sends that on to every call that
//   resolves to its signature, and to whatever slot its value flows into.
// - A slot (a function type such as a callback parameter or a type alias)
//   that now answers a promise sends that on to every call made through it,
//   and makes every function handed to it async, unless that function
//   already forwards a promise.
//
// Calls that already answered a promise are left alone, and `return p`
// inside a function made async becomes `return await p`, as the lint's
// return-await rule requires. Prettier then reflows the touched files.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const repo = path.resolve(import.meta.dirname, '../..');

const PRODUCTION_ROOTS = ['client/src', 'mcp-server/src'].map((r) => path.join(repo, r));

function isProduction(fileName) {
  return (
    PRODUCTION_ROOTS.some((root) => fileName.startsWith(root + path.sep)) &&
    !fileName.includes('/__tests__/')
  );
}

/**
 * Runs each project's seed against that TypeScript project, propagates from
 * what it marks, then writes every edit and reflows the touched files. Edits
 * on a file several projects share are made once.
 *
 * @param projects - tsconfig path (relative to the repo) → seed function.
 */
export function runCodemod(projects) {
  /** fileName → Map<"pos:end:text", {pos, end, text}>, deduplicated. */
  const edits = new Map();
  for (const [project, seed] of Object.entries(projects)) {
    const propagation = new Propagation(path.join(repo, project), edits);
    seed(propagation);
    propagation.drain();
    if (propagation.blocked.size) {
      throw new Error(['Needs a hand-written change first:', ...propagation.blocked].join('\n  '));
    }
  }
  writeEdits(edits);
}

class Propagation {
  constructor(configPath, edits) {
    this.edits = edits;
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
        },
      },
    );
    this.program = ts.createProgram(config.fileNames, config.options);
    this.checker = this.program.getTypeChecker();
    this.sourceFiles = this.program
      .getSourceFiles()
      .filter((sf) => !sf.isDeclarationFile && isProduction(sf.fileName));

    this.madeAsync = new Set();
    this.retyped = new Set();
    this.visitedCalls = new Set();
    this.visitedValues = new Set();
    this.queue = [];
    this.mustAnswer = [];
    this.voidCandidates = [];
    /** Rewrites this codemod refuses to make, reported together at the end. */
    this.blocked = new Set();
    this.index();
  }

  // ── Index ───────────────────────────────────────────────

  index() {
    /** Signature declaration → the calls that resolve to it. */
    this.callsBySignature = new Map();
    /** Signature declaration → function values of that signature in flow positions. */
    this.valuesBySignature = new Map();
    /** Slot (signature declaration) → function values contextually typed by it. */
    this.flowsBySlot = new Map();
    /** Method → interface members it fills where its object is passed as that interface. */
    this.structuralSlots = new Map();

    const push = (map, key, value) => {
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(value);
    };

    for (const sf of this.sourceFiles) {
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const decl = this.signatureOf(node);
          if (decl) push(this.callsBySignature, decl, node);
        }
        if (ts.isMethodDeclaration(node)) {
          for (const slot of this.memberSlots(node)) push(this.flowsBySlot, slot, node);
        }
        if (this.isFlowPosition(node)) {
          const slot = this.contextualSlot(node);
          if (slot) push(this.flowsBySlot, slot, node);
          const own = this.ownSignature(node);
          if (own && own !== node) push(this.valuesBySignature, own, node);
          for (const [method, member] of this.structuralFills(node)) {
            push(this.structuralSlots, method, member);
            push(this.flowsBySlot, member, method);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  signatureOf(call) {
    return this.checker.getResolvedSignature(call)?.getDeclaration() ?? undefined;
  }

  /** The declaration of the signature a function value has. */
  ownSignature(expr) {
    const type = this.checker.getNonNullableType(this.checker.getTypeAtLocation(expr));
    return type.getCallSignatures()[0]?.getDeclaration() ?? undefined;
  }

  /** A value in a position some type annotation governs. */
  isFlowPosition(node) {
    const kinds = [
      ts.isArrowFunction,
      ts.isFunctionExpression,
      ts.isIdentifier,
      ts.isPropertyAccessExpression,
      ts.isCallExpression,
      ts.isNewExpression,
    ];
    if (!kinds.some((is) => is(node)) && node.kind !== ts.SyntaxKind.ThisKeyword) return false;
    const parent = node.parent;
    return (
      ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.arguments?.includes(node)) ||
      (ts.isVariableDeclaration(parent) && parent.initializer === node) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      (ts.isReturnStatement(parent) && parent.expression === node) ||
      (ts.isArrowFunction(parent) && parent.body === node)
    );
  }

  /** The production function type that contextually types `expr`, if any. */
  contextualSlot(expr) {
    const type = this.checker.getContextualType(expr);
    if (!type) return undefined;
    const [signature] = this.checker.getNonNullableType(type).getCallSignatures();
    const decl = signature?.getDeclaration();
    if (!decl || decl === expr || !isProduction(decl.getSourceFile().fileName)) return undefined;
    return ts.isFunctionTypeNode(decl) || ts.isMethodSignature(decl) ? decl : undefined;
  }

  /**
   * The production interface members a class or object-literal method
   * implements: what its signature has to keep matching.
   */
  memberSlots(method) {
    const types = [];
    if (ts.isObjectLiteralExpression(method.parent)) {
      const type = this.checker.getContextualType(method.parent);
      if (type) types.push(type);
    } else if (ts.isClassLike(method.parent)) {
      for (const clause of method.parent.heritageClauses ?? []) {
        for (const t of clause.types) types.push(this.checker.getTypeAtLocation(t));
      }
    }
    const slots = [...(this.structuralSlots.get(method) ?? [])];
    for (const type of types) {
      const nonNull = this.checker.getNonNullableType(type);
      for (const part of nonNull.isUnion() ? nonNull.types : [nonNull]) {
        for (const decl of part.getProperty(method.name.getText())?.declarations ?? []) {
          const slot = this.memberSlot(decl);
          if (slot) slots.push(slot);
        }
      }
    }
    return slots;
  }

  /**
   * Where an object goes in as a production interface, the (method, member)
   * pairs it fills: its method has to keep matching that member.
   */
  structuralFills(expr) {
    const expected = this.checker.getContextualType(expr);
    if (!expected) return [];
    const target = this.checker.getNonNullableType(expected);
    if (target.getCallSignatures().length) return [];
    const declared = target.getSymbol()?.declarations?.[0];
    if (!declared || !isProduction(declared.getSourceFile().fileName)) return [];

    const actual = this.checker.getNonNullableType(this.checker.getTypeAtLocation(expr));
    const fills = [];
    for (const prop of target.getProperties()) {
      const member = this.memberSlot(prop.declarations?.[0]);
      if (!member) continue;
      for (const decl of actual.getProperty(prop.name)?.declarations ?? []) {
        if (ts.isMethodDeclaration(decl) && isProduction(decl.getSourceFile().fileName)) {
          fills.push([decl, member]);
        }
      }
    }
    return fills;
  }

  /** The slot an interface member declares, for a method or function-typed property. */
  memberSlot(decl) {
    if (!decl || !isProduction(decl.getSourceFile().fileName)) return undefined;
    if (ts.isMethodSignature(decl)) return decl;
    if (ts.isPropertySignature(decl) && decl.type && ts.isFunctionTypeNode(decl.type)) {
      return decl.type;
    }
    return undefined;
  }

  // ── Edits ───────────────────────────────────────────────

  addEdit(sf, pos, end, text) {
    if (!isProduction(sf.fileName)) throw new Error(`would edit ${sf.fileName}`);
    let fileEdits = this.edits.get(sf.fileName);
    if (!fileEdits) this.edits.set(sf.fileName, (fileEdits = new Map()));
    fileEdits.set(`${pos}:${end}:${text}`, { pos, end, text });
  }

  insert(node, text, at = node.getStart()) {
    this.addEdit(node.getSourceFile(), at, at, text);
  }

  wrapInPromise(typeNode) {
    if (isPromiseType(typeNode)) return;
    this.insert(typeNode, 'Promise<');
    this.insert(typeNode, '>', typeNode.end);
  }

  // ── Seeds ───────────────────────────────────────────────

  sourceFile(file) {
    const sf = this.program.getSourceFile(path.join(repo, file));
    if (!sf) throw new Error(`${file} is not in this project`);
    return sf;
  }

  findFunction(file, name) {
    let found;
    const visit = (node) => {
      if (found) return;
      if (isFunctionLike(node) && node.name?.getText() === name) found = node;
      else ts.forEachChild(node, visit);
    };
    visit(this.sourceFile(file));
    if (!found) throw new Error(`no function ${name} in ${file}`);
    return found;
  }

  findTypeAlias(file, name) {
    const alias = this.sourceFile(file).statements.find(
      (s) => ts.isTypeAliasDeclaration(s) && s.name.text === name,
    );
    if (!alias) throw new Error(`no type ${name} in ${file}`);
    return alias;
  }

  /**
   * Moves every `x.gci.executeAndFetchString(x.handle, code)` inside `name`
   * onto the async `fetchString(x, code)` seam, and imports the seam.
   */
  moveFetchesOntoSeam(file, name) {
    const fn = this.findFunction(file, name);
    const calls = [];
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'executeAndFetchString' &&
        /\.gci$/.test(node.expression.expression.getText())
      ) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    if (calls.length === 0) throw new Error(`${name} has no direct fetch`);

    const sf = fn.getSourceFile();
    for (const call of calls) {
      const [handle, code] = call.arguments;
      const session = call.expression.expression.getText().replace(/\.gci$/, '');
      if (handle.getText() !== `${session}.handle`) throw new Error(`odd handle at ${where(call)}`);
      this.addEdit(sf, call.getStart(), call.end, `fetchString(${session}, ${code.getText()})`);
      this.promiseCall(call);
    }
    this.importSeam(sf);
  }

  importSeam(sf) {
    const gciLog = sf.statements.find(
      (s) => ts.isImportDeclaration(s) && /\/gciLog'$/.test(s.moduleSpecifier.getText()),
    );
    if (!gciLog) throw new Error(`no gciLog import to anchor on in ${sf.fileName}`);
    const seam = path.join(repo, 'client/src/stringFetch');
    let spec = path.relative(path.dirname(sf.fileName), seam);
    if (!spec.startsWith('.')) spec = `./${spec}`;
    this.insert(gciLog, `\nimport { fetchString } from '${spec}';`, gciLog.end);
  }

  /** Makes the function `name` async, as though something inside it now awaited. */
  makeFunctionAsync(file, name) {
    this.makeAsync(this.findFunction(file, name));
  }

  /** Makes the function type aliased by `name` answer a promise. */
  retypeAlias(file, name) {
    const alias = this.findTypeAlias(file, name);
    if (!ts.isFunctionTypeNode(alias.type)) throw new Error(`${name} is not a function type`);
    this.retypeSlot(alias.type);
  }

  // ── Propagation ─────────────────────────────────────────

  /**
   * Runs the queue dry, then settles what had to wait until nothing else
   * could still change it: whether a function handed to a slot already
   * forwards a promise, and whether a void slot ended up retyped after all.
   */
  drain() {
    for (;;) {
      while (this.queue.length) this.queue.shift()();
      if (this.voidCandidates.length) {
        for (const { value, slot } of this.voidCandidates.splice(0)) {
          if (!this.retyped.has(slot)) this.fireAndForget(value, slot);
        }
      } else if (this.mustAnswer.length) {
        for (const value of this.mustAnswer.splice(0)) this.answerPromise(value);
      } else {
        return;
      }
    }
  }

  /** A call that now answers a promise: await it and make its holder async. */
  promiseCall(call) {
    if (this.visitedCalls.has(call)) return;
    this.visitedCalls.add(call);

    const parent = call.parent;
    if (ts.isAwaitExpression(parent) || ts.isVoidExpression(parent)) return;
    if (ts.isArrowFunction(parent) && parent.body === call) {
      // `() => f()` hands the promise straight back to whoever called the
      // arrow: awaited if the arrow is async (return-await), fired off with
      // `void` where the arrow's caller ignores what it returns
      // (no-misused-promises), and otherwise passed on.
      if (this.isAsync(parent)) this.insert(call, 'await ');
      else if (this.returnsIgnored(parent)) this.insert(call, 'void ');
      else this.promiseFunction(parent);
      return;
    }

    // Where a promise is as good as its value (`Promise.resolve(p)`), pass it.
    if (isPromiseResolveArgument(call)) return;
    if (!this.isAsync(enclosingFunction(call)) && this.acceptsPromise(call)) return;

    const operand =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === call;
    if (operand) {
      this.insert(call, '(await ');
      this.insert(call, ')', call.end);
    } else {
      this.insert(call, 'await ');
    }
    this.makeAsync(enclosingFunction(call));
  }

  /** Whether `fn` is passed where a function returning void is expected. */
  returnsIgnored(fn) {
    const type = this.checker.getContextualType(fn);
    if (!type) return false;
    const [signature] = this.checker.getNonNullableType(type).getCallSignatures();
    if (!signature) return false;
    return !!(this.checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Void);
  }

  /** Whether the type expected at `expr`'s position admits a promise. */
  acceptsPromise(expr) {
    const type = this.checker.getContextualType(expr);
    if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    return (type.isUnion() ? type.types : [type]).some((t) => t.getProperty('then'));
  }

  /** Whether a function type's return already admits a promise. */
  returnAdmitsPromise(typeNode) {
    const type = this.checker.getTypeFromTypeNode(typeNode);
    return (type.isUnion() ? type.types : [type]).some((t) => t.getProperty('then'));
  }

  isTypeParameter(typeNode) {
    return !!(this.checker.getTypeFromTypeNode(typeNode).flags & ts.TypeFlags.TypeParameter);
  }

  isAsync(fn) {
    return hasAsyncModifier(fn) || this.madeAsync.has(fn);
  }

  /** Whether `expr` answers a promise, already or because of this rewrite. */
  answersPromise(expr) {
    if (ts.isAwaitExpression(expr)) return false;
    if (ts.isCallExpression(expr) && this.visitedCalls.has(expr)) return true;
    const type = this.checker.getTypeAtLocation(expr);
    return (type.isUnion() ? type.types : [type]).some((t) => t.getProperty('then'));
  }

  makeAsync(fn) {
    if (this.madeAsync.has(fn)) return;
    this.madeAsync.add(fn);
    if (hasAsyncModifier(fn)) return;
    if (ts.isConstructorDeclaration(fn) || ts.isAccessor(fn)) {
      throw new Error(`cannot make ${where(fn)} async`);
    }
    // `xs.filter(async …)` type-checks and is silently wrong; that needs a
    // hand-written loop before this runs.
    if (isArrayCallback(fn)) {
      this.blocked.add(`array callback would turn async at ${where(fn)}`);
      return;
    }

    if (ts.isMethodDeclaration(fn)) this.insert(fn, 'async ', fn.name.getStart());
    else if (ts.isFunctionDeclaration(fn) && fn.modifiers?.length) {
      const sf = fn.getSourceFile();
      this.insert(fn, 'async ', ts.skipTrivia(sf.text, fn.modifiers.end));
    } else this.insert(fn, 'async ');

    if (fn.type) this.wrapInPromise(fn.type);
    this.awaitReturnedPromises(fn);
    this.promiseFunction(fn);
  }

  awaitReturnedPromises(fn) {
    if (!ts.isBlock(fn.body)) {
      if (this.answersPromise(fn.body)) this.insert(fn.body, 'await ');
      return;
    }
    const visit = (node) => {
      if (isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression && this.answersPromise(node.expression)) {
        this.insert(node.expression, 'await ');
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
  }

  /** `fn` (a function or a slot) now answers a promise. */
  promiseFunction(fn) {
    for (const call of this.callsBySignature.get(fn) ?? []) {
      this.queue.push(() => this.promiseCall(call));
    }
    for (const value of this.valuesBySignature.get(fn) ?? []) this.promiseValue(value);
    if (ts.isMethodDeclaration(fn)) {
      for (const slot of this.memberSlots(fn)) this.queue.push(() => this.retypeSlot(slot));
    }
    if (!fn.name && !ts.isFunctionTypeNode(fn) && !ts.isMethodSignature(fn)) this.promiseValue(fn);
  }

  /** `expr` evaluates to a function that now answers a promise. */
  promiseValue(expr) {
    if (this.visitedValues.has(expr)) return;
    this.visitedValues.add(expr);
    const slot = this.contextualSlot(expr);
    if (!slot) return;
    // A named function handed to a callback whose result is ignored is fired
    // off instead (no-misused-promises), unless the slot is retyped anyway. A
    // callback passed along, or a function literal, carries the retype on.
    const own = this.ownSignature(expr);
    const named =
      own && isFunctionLike(own) && !ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr);
    if (named && slot.type?.kind === ts.SyntaxKind.VoidKeyword) {
      this.voidCandidates.push({ value: expr, slot });
    } else {
      this.queue.push(() => this.retypeSlot(slot));
    }
  }

  /** `f` → `(a) => void f(a)`, for a void slot taking `(a)`. */
  fireAndForget(value, slot) {
    const params = slot.parameters.map((p) => {
      if (!ts.isIdentifier(p.name)) throw new Error(`destructured slot at ${where(slot)}`);
      return p.name.text;
    });
    const list = params.join(', ');
    this.addEdit(
      value.getSourceFile(),
      value.getStart(),
      value.end,
      `(${list}) => void ${value.getText()}(${list})`,
    );
  }

  /** A function type now answers a promise: retype it and follow it. */
  retypeSlot(slot) {
    if (this.retyped.has(slot)) return;
    this.retyped.add(slot);
    if (!slot.type) throw new Error(`untyped slot at ${where(slot)}`);
    // `() => T` already lets a promise through as T, and `() => T | Promise<T>`
    // already admits one.
    if (this.isTypeParameter(slot.type) || this.returnAdmitsPromise(slot.type)) return;
    this.wrapInPromise(slot.type);
    this.promiseFunction(slot);
    for (const value of this.flowsBySlot.get(slot) ?? []) this.mustAnswer.push(value);
  }

  /** A function value handed to a slot that now answers a promise. */
  answerPromise(value) {
    const fn = isFunctionLike(value) ? value : this.ownSignature(value);
    if (!fn || !isProduction(fn.getSourceFile().fileName)) return;
    if (ts.isFunctionTypeNode(fn) || ts.isMethodSignature(fn)) return this.retypeSlot(fn);
    if (!isFunctionLike(fn)) return;
    // `(x) => f(x)` already answers the promise `f` now does.
    const forwards = fn.body && !ts.isBlock(fn.body) && this.answersPromise(fn.body);
    if (!forwards) this.makeAsync(fn);
  }
}

// ── Helpers ───────────────────────────────────────────────

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isAccessor(node)
  );
}

const ARRAY_CALLBACK_METHODS = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'some',
  'sort',
]);

function isArrayCallback(fn) {
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.includes(fn) &&
    ts.isPropertyAccessExpression(call.expression) &&
    ARRAY_CALLBACK_METHODS.has(call.expression.name.text)
  );
}

function isPromiseResolveArgument(expr) {
  const call = expr.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.includes(expr) &&
    call.expression.getText() === 'Promise.resolve'
  );
}

function hasAsyncModifier(fn) {
  return (fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

function isPromiseType(typeNode) {
  return ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText() === 'Promise';
}

function enclosingFunction(node) {
  for (let n = node.parent; n; n = n.parent) if (isFunctionLike(n)) return n;
  throw new Error(`top-level await needed at ${where(node)}`);
}

function where(node) {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
  return `${path.relative(repo, sf.fileName)}:${line + 1}:${character + 1}`;
}

function writeEdits(edits) {
  const touched = [];
  for (const [fileName, fileEdits] of edits) {
    let text = fs.readFileSync(fileName, 'utf8');
    // Back to front so earlier offsets stay valid; at one offset, later-added
    // inserts land first so `(await ` stays outside an inner `await `.
    const sorted = [...fileEdits.values()]
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => b.pos - a.pos || b.end - a.end || a.i - b.i);
    for (const { pos, end, text: replacement } of sorted) {
      text = text.slice(0, pos) + replacement + text.slice(end);
    }
    fs.writeFileSync(fileName, text);
    touched.push(fileName);
  }

  // Prettier can need a second pass to settle (a wrapped signature whose
  // return type it then reflows), so run it until it stops changing anything.
  const prettier = path.join(repo, 'node_modules/.bin/prettier');
  for (let pass = 0; touched.length && pass < 5; pass++) {
    execFileSync(prettier, ['--write', ...touched], { cwd: repo, stdio: 'ignore' });
    try {
      execFileSync(prettier, ['--check', ...touched], { cwd: repo, stdio: 'ignore' });
      break;
    } catch {
      // not settled yet
    }
  }
  for (const f of touched.sort()) console.log(path.relative(repo, f));
}
