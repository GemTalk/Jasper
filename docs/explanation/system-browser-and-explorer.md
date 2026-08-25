# Why there are two browsers, and which one gets the work

Jasper ships two ways to browse and edit code in a stone: the **GemStone Explorer** and the
older **System Browser**. This explains what each is for, and why the Explorer is where new
work goes — worth reading before adding a feature to either.

## The short version

The **System Browser is frozen.** It works today, and nothing is being changed in it — but it is
not being extended either, and there is no promise, for now, about how long it keeps working as
the rest of Jasper moves underneath it. New features land in the **GemStone Explorer**, which is
the supported way to browse and edit code.

## What each one is

The **System Browser** is a webview with a five-column layout — dictionaries, class categories,
classes, method categories, methods — modelled on the classic Smalltalk browser. It came first.

The **GemStone Explorer** is a set of linked tree views in its own activity-bar container, with
the panes VS Code users expect to dock, resize and filter individually. Everything built since
it landed — the refactorings, instance-variable structure changes, the filter grammar, override
indicators, drag-and-drop — was built there.

## Why "frozen" rather than "deprecated" or "maintained"

Both of those words claim more than has been decided:

- *Maintained* would imply parity — that a feature landing in the Explorer follows into the
  browser, and that breakage in it gets repaired. Neither is committed. Keeping two front ends at
  parity is what the convergence work
  ([#289](https://github.com/GemTalk/Jasper/issues/289), [#260](https://github.com/GemTalk/Jasper/issues/260))
  exists to make cheap, and until that lands only one of them grows.
- *Deprecated* would imply a decision to remove it, with a date. There isn't one. Nobody has
  announced its end.

"Frozen" is what is actually true: **no new work goes in, and no guarantee comes out.** It works
now; if something in it breaks, whether that gets fixed is a case-by-case call rather than a
promise — so don't build a habit that depends on it.

## What that meant in practice

[#421](https://github.com/GemTalk/Jasper/issues/421) removed the two buttons that advertised the
System Browser — an inline action on every session row, and a `$(book)` item in the status bar —
because between them the older browser was the *most discoverable* route into a stone's code,
ahead of the Explorer. Discoverability was the whole problem: a newcomer met the browser first
and never learned the Explorer existed.

What deliberately did **not** change:

- The browser opens exactly as before with **Cmd+K B** (Ctrl+K B), or from the Command Palette
  as **GemStone: Open System Browser (Classic)** — retitled so anyone finding it in the palette
  or the keyboard-shortcuts list knows which of the two it opens.
- No behaviour inside the browser was touched.

Documentation follows the same rule: the README leads with the Explorer, and the onboarding
walkthrough and the "Welcome to GemStone Smalltalk" tutorial both point there.

## Closed gap: running SUnit tests

Running tests used to be browser-only, and was the one place where "prefer the Explorer" cost a
real feature. It no longer is. A test class row — in the Classes pane or the Hierarchy pane — and
a test method row in the Methods pane each carry an inline ▶, and each shows the outcome of its
last run. Both dispatch the same `gemstone.runSunitClass` / `gemstone.runSunitMethods` commands
the System Browser uses, so a run started anywhere reports in the Testing view. See
[#427](https://github.com/GemTalk/Jasper/issues/427).

## If you are about to add a feature

Add it to the Explorer. If it seems to belong in the System Browser, that is a signal either
that the Explorer is missing something the feature depends on, or that the convergence work
should come first — both worth raising rather than working around by extending the browser.
