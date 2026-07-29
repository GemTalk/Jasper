import * as vscode from 'vscode';
import { GEMSTONE_NOTEBOOK_TYPE } from './gemstoneNotebookKernel';
import { SMALLTALK_LANGUAGE_ID } from './smalltalkNotebookController';
import { logInfo } from './gciLog';

// A GemStone Smalltalk tutorial delivered as a Jupyter notebook, modelled on
// Prof Stef (the classic in-workspace Smalltalk syntax tutorial). The lessons
// are adapted for a notebook: instead of a single workspace with
// `ProfStef next` navigation, each lesson is a Markdown cell followed by one or
// more runnable code cells — run each with Shift+Enter (or the ▷ button) and
// its result appears beneath it. A closing "Introduction to GemStone" section
// covers what makes GemStone different from other Smalltalks: the persistent,
// shared, transactional object repository.
//
// The notebook is built programmatically (not shipped as an .ipynb) and opened
// as an untitled document, so running its cells never dirties a file bundled
// with the extension — the same rationale as the untitled Getting Started
// workspace (see workspace.ts).

/**
 * One tutorial lesson: a Markdown explanation followed by zero or more
 * Smalltalk code cells. Each snippet becomes its own code cell so its result
 * renders independently.
 */
export interface TutorialLesson {
  title: string;
  /** Markdown prose shown under the title. */
  body: string;
  /** Smalltalk expressions, one runnable code cell each. */
  snippets: string[];
}

export const TUTORIAL_LESSONS: TutorialLesson[] = [
  {
    title: 'Welcome to GemStone Smalltalk',
    body: `Hello! This notebook is a hands-on tour of **GemStone Smalltalk**, adapted from the classic *Prof Stef* tutorial.

**Before you start:**
1. Choose the **GemStone Smalltalk** kernel (top-right of this notebook).
2. Make sure a GemStone session is logged in (the *GemStone Logins* view — *Add a Login*, then connect). Cells run against the selected session.

**How to use it:** read a lesson, then run the code cell beneath it with **Shift+Enter** (or the ▷ button). The result — the \`printString\` of the last expression — appears below the cell. Text written to the \`Transcript\` shows up in the **GemStone Transcript** output panel.

Edit any cell and re-run it — experimenting is the whole point. Let's begin.`,
    snippets: ['3 + 4'],
  },
  {
    title: 'Evaluating and displaying',
    body: `You just executed a Smalltalk expression and saw its value. Every cell evaluates its code and shows the result of the **last expression**.

Smalltalk has very little syntax: you send *messages* to *objects*. \`3 + 4\` sends the message \`+ 4\` to the object \`3\`. Run each cell below.`,
    snippets: ['1 + 2', 'DateAndTime now', 'Date today weekDayName', 'Time now'],
  },
  {
    title: 'The Transcript',
    body: `The \`Transcript\` is a global output stream — the Smalltalk "console". Writing to it does not change a cell's result; instead the text appears in the **GemStone Transcript** output panel (View ▸ Output ▸ *GemStone Transcript*), which comes forward when it receives output.

\`show:\` writes a string; \`cr\` starts a new line.`,
    snippets: [
      "Transcript show: 'Hello world!'; cr.",
      "Transcript show: 'GemStone says: '; show: 42 printString; cr.",
    ],
  },
  {
    title: 'Inspecting',
    body: `Displaying a result gives a simple string. When you have a richer object you want to explore, **inspect** it. In a GemStone Workspace or the Inspector view you can *Inspect It* on an expression to open it in the object Inspector and drill into its instance variables.

Here, run the expressions and read their printed form; each is an object you could inspect.`,
    snippets: ['DateAndTime now', '(1 to: 5) asArray', 'System myUserProfile'],
  },
  {
    title: 'Basic types: Numbers',
    body: `\`1\`, \`2\`, \`100\`, \`2/3\` … are all **Number** objects and respond to many arithmetic messages.

Notice that fractions stay exact (they are not reduced to floating point), and integers grow arbitrarily large.`,
    snippets: [
      '2',
      '(1/3)',
      '(1/3) + (4/5)',
      '(18/5) rounded',
      '200 factorial',
      '1 class',
      '200 factorial class',
      '1 negated negated',
      '(1 + 3) odd',
    ],
  },
  {
    title: 'Basic types: Characters',
    body: `A **Character** literal is written with a \`$\` prefix. Any Unicode character can also be built from its code point.`,
    snippets: [
      '$A',
      '$A class',
      '$B codePoint',
      'Character cr codePoint',
      'Character space codePoint',
      '"A gem stone emoji from its hex code point:"\n(Character codePoint: 16r1F48E) asString',
    ],
  },
  {
    title: 'Basic types: Strings',
    body: `A **String** is a collection of characters, written between single quotes. To include a single quote in a string, double it: \`'it''s here'\`.`,
    snippets: [
      "'ProfStef'",
      "'ProfStef' size",
      "'abc' asUppercase",
      "'Hello World' reverse",
      "'ProfStef' at: 1",
      "'GemStone', ' ', 'Smalltalk'",
    ],
  },
  {
    title: 'Basic types: Symbols',
    body: `A **Symbol** is a String that is guaranteed globally unique. Write one with a \`#\` prefix: \`#ProfStef\`, or \`#'has spaces'\`.

There is only ever *one* \`#ProfStef\` symbol, but there can be many equal \`'ProfStef'\` strings. \`==\` tests whether two references are the *same* object.`,
    snippets: [
      "'ProfStef' asSymbol",
      '#ProfStef asString',
      '"Two separate strings - same characters, different objects:"\n(2 printString) == (2 printString)',
      '"The same symbol, always:"\n(2 printString) asSymbol == (2 printString) asSymbol',
    ],
  },
  {
    title: 'Basic types: Arrays',
    body: `A literal **Array** is written \`#( … )\` and is built when the code is parsed. Arrays are indexed from **1**.`,
    snippets: [
      '#(1 2 3)',
      '#(1 2 3 #(4 5 6)) size',
      '#(1 2 4) isEmpty',
      '#(1 2 3) first',
      "#('hello' 'GemStone') at: 2",
    ],
  },
  {
    title: 'Message syntax: Unary messages',
    body: `Messages come in three kinds. **Unary** messages take no argument — just a name sent to an object: \`anObject aMessage\`.`,
    snippets: [
      '5 factorial',
      '10 printString',
      "'hello' asUppercase",
      '3.7 truncated',
      '$a asInteger',
    ],
  },
  {
    title: 'Message syntax: Binary messages',
    body: `**Binary** messages use symbolic names and take one argument: \`anObject + anotherObject\`.`,
    snippets: [
      '3 * 2',
      'false | true',
      'true & false',
      "'key' -> 'value'",
      '10 <= 12',
      "'ab', 'cd'",
    ],
  },
  {
    title: 'Message syntax: Keyword messages',
    body: `**Keyword** messages take one or more arguments, each introduced by a keyword ending in a colon. The parts combine into a single *selector* like \`between:and:\`.`,
    snippets: [
      '3 between: 1 and: 10',
      '10 gcd: 15',
      "'Hello World' copyFrom: 1 to: 5",
      'Array with: 1 with: 2 with: 3',
    ],
  },
  {
    title: 'Message syntax: Execution order',
    body: `When kinds mix, precedence is fixed: **Unary → Binary → Keyword**. There are no per-operator precedence rules beyond that, and messages of equal precedence run left to right.`,
    snippets: [
      '"rounded (unary) runs before + (binary): 3.8 rounded = 4, then 2.5 + 4"\n2.5 + 3.8 rounded',
      '"2 + 2 (binary) runs before max: (keyword)"\n3 max: 2 + 2',
      '(1 -> 2) class',
      '"left to right among unary sends:"\n-12345 negated printString reverse',
    ],
  },
  {
    title: 'Mathematical precedence',
    body: `Because binary messages all share one precedence and run left to right, familiar maths precedence does **not** apply. Use parentheses when you need a different order.`,
    snippets: [
      '"* does not bind tighter than +; left to right: (2 * 10) + 2"\n2 * 10 + 2',
      '"left to right: (2 + 2) * 10"\n2 + 2 * 10',
      '2 + (2 * 10)',
      '8 - 5 / 2',
      '(8 - 5) / 2',
      '8 - (5 / 2)',
    ],
  },
  {
    title: 'Cascades',
    body: `A **cascade** — the \`;\` operator — sends several messages to the *same* receiver. These two cells are equivalent; the second uses a cascade.`,
    snippets: [
      "Transcript show: 'hello '.\nTranscript show: 'Smalltalk'.\nTranscript cr.",
      "Transcript\n  show: 'hello ';\n  show: 'Smalltalk';\n  cr.",
    ],
  },
  {
    title: 'Blocks',
    body: `A **block** is an anonymous function, delimited by square brackets \`[ ]\`. It is an object: creating one does not run it. Send it \`value\` (or \`value:\`) to execute it. \`[:x | … ]\` declares a block that takes an argument \`x\`.`,
    snippets: [
      '"Just creates the block; nothing runs:"\n[3 + 4]',
      '[3 + 4] value',
      '[:x | x + 2] value: 5',
      '[:x :y | x + y] value: 3 value: 5',
    ],
  },
  {
    title: 'Blocks and variables',
    body: `Like any object, a block can be stored in a variable and used later. \`| b |\` declares a temporary variable named \`b\`; \`:=\` assigns to it.

Run the whole cell together — the temporary lives only while the cell runs.`,
    snippets: ['| b |\nb := [:x | x + 2].\nb value: 12'],
  },
  {
    title: 'Conditionals',
    body: `Conditionals are just keyword messages sent to **Boolean** objects, taking blocks as arguments: \`ifTrue:ifFalse:\`.`,
    snippets: [
      '1 < 2\n  ifTrue: [100]\n  ifFalse: [42]',
      "3 > 10\n  ifTrue: ['maybe there''s a bug...']\n  ifFalse: ['all good: 3 is less than 10']",
    ],
  },
  {
    title: 'Loops',
    body: `Basic counting loops are ordinary keyword messages on numbers: \`to:do:\` and \`to:by:do:\`. The block receives the loop variable. (Output goes to the **GemStone Transcript** panel.)`,
    snippets: [
      '| sum |\nsum := 0.\n1 to: 10 do: [:i | sum := sum + i].\nsum',
      "0 to: 30 by: 3 do: [:i | Transcript show: i printString; show: ' '].\nTranscript cr.",
      "10 to: 0 by: -2 do: [:i | Transcript show: i printString; show: ' '].\nTranscript cr.",
    ],
  },
  {
    title: 'Iterators',
    body: `Collections understand higher-level iteration messages, each taking a block:
- \`do:\` — run the block for every element
- \`collect:\` — a new collection of the block's results
- \`select:\` / \`reject:\` — keep / drop elements the block answers \`true\` for
- \`inject:into:\` — fold the elements into a single value`,
    snippets: [
      "#(11 38 3 -2 10) do: [:each | Transcript show: each printString; show: ' '].\nTranscript cr.",
      '#(11 38 3 -2 10) collect: [:each | each negated]',
      '#(11 38 3 -2 10) select: [:each | each odd]',
      '#(11 38 3 -2 10) reject: [:each | each > 10]',
      '#(11 38 3 -2 10) inject: 0 into: [:sum :each | sum + each]',
    ],
  },
  {
    title: 'Creating objects',
    body: `Objects are **instances** of a class. Usually you send \`new\` to a class to create one. An \`OrderedCollection\` is like an Array whose size can grow and shrink.

The second cell keeps the collection in a variable so it can be changed step by step; run it all together.`,
    snippets: [
      "OrderedCollection new\n  add: 'Some text';\n  add: 3;\n  yourself",
      "| aCollection |\naCollection := OrderedCollection new.\naCollection add: 'Some text'; add: 3.\nTranscript show: aCollection printString; cr.\naCollection remove: 3.\naCollection add: 'Some more text!'.\nTranscript show: aCollection printString; cr.\naCollection",
    ],
  },
  {
    title: 'Reflection',
    body: `Smalltalk can examine itself at runtime. Classes, methods, and their source are all objects you can query.`,
    snippets: [
      '"The source of a method, as a string:"\n(Integer compiledMethodAt: #bitInvert) sourceString',
      '"Every place that sends #bitInvert:"\n(ClassOrganizer new allReferencesTo: #bitInvert) size',
      '"Walk a class up its superclass chain:"\n| c names |\nc := SmallInteger.\nnames := OrderedCollection new.\n[c notNil] whileTrue: [names add: c name. c := c superclass].\nnames',
      'Integer selectors size',
    ],
  },
  {
    title: 'The debugger',
    body: `The debugger is one of Smalltalk's signature tools. When code raises an unhandled error, GemStone can open a debugger *on the live, suspended execution* — you inspect variables, evaluate expressions in context, edit the method, and continue.

Notebook cells report an error inline rather than opening the debugger. To experience the debugger, use **Debug It** on an expression in a GemStone Workspace, or run failing code there — for example \`nil foo\` or \`self halt\`. Jasper offers both a VS Code debugger and an Enhanced (Smalltalk-style) debugger.

Run the cell below to see how an error is reported here.`,
    snippets: ['"An intentional error - a nil does not understand #foo:"\nnil foo'],
  },
  {
    title: 'Introduction to GemStone',
    body: `You now know the Smalltalk *language*. What makes **GemStone/S** different from other Smalltalks is where the objects live.

In most Smalltalks your objects live in an in-memory *image* that belongs to one process. In GemStone they live in a **persistent, shared, transactional object repository** on disk that many sessions connect to at once. A few consequences worth understanding:

- **Persistence by reachability.** Anything reachable from a *persistent root* survives after your session ends — no save/load, no serialization. \`UserGlobals\` and \`Globals\` are such roots (symbol dictionaries).
- **Transactions.** Your session sees a stable snapshot. \`System commitTransaction\` publishes your changes to everyone; \`System abortTransaction\` discards them and refreshes your view. Nothing you do is permanent until you commit.
- **Shared and multi-user.** Classes, methods, and data are all in the repository, visible to every session (subject to security). Many users work in the same object space.
- **Sessions.** You are logged in as a *UserProfile*; \`SessionTemps\` holds per-session scratch state that is never committed.

Run these read-only cells to look around. (This lesson changes nothing permanent — it ends with an abort.)`,
    snippets: [
      '"The GemStone version you are connected to:"\nSystem gemVersionAt: #gsVersion',
      '"Who you are logged in as:"\nSystem myUserProfile userId',
      '"Do you have uncommitted changes right now?"\nSystem needsCommit',
      '"Globals holds system classes; UserGlobals is your personal namespace:"\nUserGlobals class',
      '"Persist a value by storing it in a root, then read it back. It would\n survive logout ONLY after a commit - here we abort at the end."\nUserGlobals at: #JasperTutorialGreeting put: (Array with: DateAndTime now with: \'hello\').\nUserGlobals at: #JasperTutorialGreeting',
      '"Undo the change above so nothing is left behind:"\nUserGlobals removeKey: #JasperTutorialGreeting ifAbsent: [nil].\nSystem abortTransaction.\n\'view refreshed - no changes committed\'',
    ],
  },
  {
    title: 'The end',
    body: `That's the tour. You've run Smalltalk expressions; met numbers, strings, symbols, arrays, and blocks; learned message precedence and cascades; iterated over collections; used reflection; and seen what GemStone's persistent, shared, transactional repository adds on top of the language.

**Where to go next:**
- Open a **Workspace** (command: *GemStone: Open Getting Started Workspace*) for free-form experimenting with *Display It*, *Inspect It*, and *Debug It*.
- Browse the image in the **System Browser** and the **Globals Browser**.
- Re-run this tutorial any time from the command *GemStone: Open Tutorial Notebook*.

Happy hacking!`,
    snippets: [],
  },
];

/**
 * Build the notebook cells for the tutorial: a Markdown cell per lesson
 * (heading + prose) followed by one code cell per snippet.
 */
export function buildTutorialCells(
  lessons: TutorialLesson[] = TUTORIAL_LESSONS,
): vscode.NotebookCellData[] {
  const cells: vscode.NotebookCellData[] = [];
  for (const lesson of lessons) {
    cells.push(
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `## ${lesson.title}\n\n${lesson.body}`,
        'markdown',
      ),
    );
    for (const snippet of lesson.snippets) {
      cells.push(
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, snippet, SMALLTALK_LANGUAGE_ID),
      );
    }
  }
  return cells;
}

/** Build the full tutorial notebook document data. */
export function buildTutorialNotebook(
  lessons: TutorialLesson[] = TUTORIAL_LESSONS,
): vscode.NotebookData {
  return new vscode.NotebookData(buildTutorialCells(lessons));
}

/**
 * Open the tutorial as a fresh, untitled GemStone Smalltalk notebook. Untitled
 * (not a bundled file) so running its cells never dirties a shipped resource;
 * the user can Save As if they want to keep their edits.
 */
export async function openTutorialNotebook(): Promise<void> {
  logInfo('[Tutorial] opening GemStone Smalltalk tutorial notebook');
  try {
    const data = buildTutorialNotebook();
    const doc = await vscode.workspace.openNotebookDocument(GEMSTONE_NOTEBOOK_TYPE, data);
    await vscode.window.showNotebookDocument(doc);
    logInfo('[Tutorial] tutorial notebook opened');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`[Tutorial] ERROR: ${msg}`);
    vscode.window.showErrorMessage(
      `Could not open the tutorial notebook: ${msg}. ` +
        'Notebook support requires the Jupyter extension.',
    );
  }
}
