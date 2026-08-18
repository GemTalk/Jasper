# Manually test refactoring undo

A hands-on pass over **Undo Last Refactoring** ([#434]), for an F5 dev host against a
live stone. Automated coverage already pins the engine ([GS SUnit] `GsRefactoringUndoTest`),
the client model and command ([client .ts]), and the whole round trip
([GCI integration] `refactoringUndo.integration.test.ts`) — so what is worth a human's
time is the part tests cannot see: does the affordance turn up where you expect it,
does the preview read correctly, and does the Explorer land somewhere sensible.

Work through it in order; each section builds on the fixture from **Setup**.

[#434]: https://github.com/GemTalk/Jasper/issues/434

## What undo covers

Undo reverses **the last refactoring you applied in this session**, and only the ones
that change methods:

change signature · extract method · extract temporary · inline method · inline temporary ·
move method · push up · push down · rename method · rename temporary

The refactorings that reshape a **class** (add/remove instance variable, instance-variable
structure, extract superclass, split class, rename class, rename instance variable, rename
class variable) deliberately record **no** undo — the Undo affordance simply does not
appear after one. Class shape has its own restore path (the Class Definition History
viewer's **Restore**).

There is **one** undo, not a stack: applying a second refactoring replaces the record, and
undoing uses it up.

## Setup

1. `nvm use`, then F5 to launch the dev host.
2. Connect to a stone with the refactoring engine installed. (No engine → the refactoring
   commands offer to install it; do that first.)
3. In the GemStone Explorer, create a throwaway class in `UserGlobals` and give it a few
   methods, including at least one the refactorings below will never mention:

   ```smalltalk
   Object subclass: 'UndoDemo'
     instVarNames: #('balance')
     classVars: #() classInstVars: #() poolDictionaries: #()
     inDictionary: UserGlobals
   ```

   | Side | Selector | Category | Source |
   |---|---|---|---|
   | instance | `total` | `computing` | `total ^ 40 + 2` |
   | instance | `report` | `printing` | `report ^ 'total is ', self total printString` |
   | instance | `pure` | `computing` | `pure ^ 7 * 6` |
   | instance | `untouched` | `fixture` | `untouched ^ 'kept'` |
   | class | `make` | `instance creation` | `make ^ self new` |

   `untouched` and `make` are the canaries — nothing below should ever disturb them.

4. **Do not commit.** Everything here is meant to be abortable; finish by aborting the
   transaction (Explorer → Abort) and the fixture disappears.

## 1 — The three ways in

| # | Step | Expect |
|---|---|---|
| 1.1 | Before doing anything, open the command palette and type `GemStone: Undo` | **No** "Undo Last Refactoring…" entry — there is nothing to undo yet |
| 1.2 | Right-click `UndoDemo` in the Explorer | **No** Undo item in the refactor group |
| 1.3 | Rename `total` → `sum` (Explorer → the method → Rename), apply the preview | A toast: `Renamed 'total' → 'sum' … NOT committed` **with an Undo button** |
| 1.4 | Do **not** press it. Dismiss the toast (the ✕, or just let it fade) | — |
| 1.5 | Open the command palette, type `GemStone: Undo` | "Undo Last Refactoring…" is now there |
| 1.6 | Right-click `UndoDemo` in the Explorer, and again a method, and again the class in the **Class Hierarchy** view | An **Undo Last Refactoring…** item in each, at the bottom of the refactor group |
| 1.7 | Press Escape without choosing anything | Nothing changes; the item is still there |

**The point of 1.4–1.6:** a dismissed toast must not strand the undo. If the palette entry
or the menu item is missing here, that is a bug worth reporting.

## 2 — The preview

| # | Step | Expect |
|---|---|---|
| 2.1 | Invoke Undo (any of the three ways) | A panel titled **Undo Rename #total to #sum** |
| 2.2 | Read the header | The button says **Undo _n_** and matches the "_n_ of _n_ changes selected" line |
| 2.3 | Read the rows | Each is badged **Restore**, **Revert** or **Delete** — never `methodAdd` / `methodRecompile` / `methodRemove` |
| 2.4 | Find the `total` row | Badged **Restore** (the rename deleted it) |
| 2.5 | Find the `sum` row | Badged **Delete** (the rename created it) |
| 2.6 | Find the `report` row | Badged **Revert** (the rename rewrote its send) |
| 2.7 | Click a row header | The diff expands: what is in the stone **now** on the left, what undoing leaves on the right |
| 2.8 | Click **Expand all** / **Collapse all** | Every diff opens / closes; the label flips |
| 2.9 | Click **Cancel** | The panel closes and **nothing changes** — and the Undo item is still offered |

## 3 — Undoing, and where you land

| # | Step | Expect |
|---|---|---|
| 3.1 | Open `UndoDemo>>report` in an editor and leave it open | You can see the rewritten `self sum` |
| 3.2 | Invoke Undo and press **Undo _n_** | Panel closes |
| 3.3 | The open `report` editor | Reloads by itself, showing `self total` again |
| 3.4 | The Explorer method list | Shows `total`, not `sum` |
| 3.5 | The toast | `Undid Rename #total to #sum (n changes). Compiled but NOT committed — commit when ready.` |
| 3.6 | Check `total`'s **category** in the Explorer | Back to `computing` — **not** `as yet unclassified` |
| 3.7 | Check `untouched` and `UndoDemo class>>make` | Untouched, both of them |
| 3.8 | Open the palette / the context menu again | The Undo entry is **gone** — the record was used up |

## 4 — Keeping part of an undo

| # | Step | Expect |
|---|---|---|
| 4.1 | Rename `total` → `sum` again and apply | Undo is offered again |
| 4.2 | Invoke Undo, and **un-tick** the row badged **Delete** (`sum`) | Button count drops by one |
| 4.3 | Press Undo | — |
| 4.4 | Explorer | **Both** `total` and `sum` are present — you kept the new one and got the old one back |
| 4.5 | Open the palette again | Undo is **still** offered: a partial undo is not used up |
| 4.6 | Invoke it again and undo the rest | `sum` goes; you are back to the fixture |

## 5 — Drift: editing after a refactoring

| # | Step | Expect |
|---|---|---|
| 5.1 | Rename `total` → `sum` and apply | — |
| 5.2 | Open `UndoDemo>>sum`, change the body to `^ 999`, **save** it | — |
| 5.3 | Invoke Undo | A warning banner at the top: _n_ change(s) are **not a clean reversal** |
| 5.4 | Find the `sum` row | Outlined in the warning colour, with an inline ⚠ saying it was edited since the refactoring |
| 5.5 | Press Undo anyway | It proceeds — drift is a warning, never a refusal — and `^ 999` is gone |
| 5.6 | Repeat 5.1–5.2, but this time **un-tick** the warned row before pressing Undo | Your `^ 999` edit survives; the rest of the undo runs |

## 6 — What Undo will not offer

| # | Step | Expect |
|---|---|---|
| 6.1 | With no undo recorded, run **Add Instance Variable** (or Extract Superclass, or Split Class) on `UndoDemo` and apply | The usual success message, with **no Undo button** |
| 6.2 | Palette / context menu | **No** Undo entry — a class reshape records nothing rather than offering half an undo |
| 6.3 | Rename `total` → `sum`, apply, then **without undoing** run Extract Superclass and apply | Undo is offered **before** the second refactoring and **gone after** it — a class reshape clears a stale record rather than leaving one that no longer matches the stone |

## 7 — Sessions and commits

| # | Step | Expect |
|---|---|---|
| 7.1 | Rename `total` → `sum`, apply, and **do not** undo | Undo offered |
| 7.2 | Log out and log back in to the same stone | Undo is **gone** — the record lives for the session's lifetime only |
| 7.3 | Rename again, apply, **commit**, then Undo | The undo runs and says `NOT committed` — undoing a committed refactoring needs **your** commit, exactly like applying one did |
| 7.4 | Abort instead of committing at 7.3 | The undo's changes go with the abort, as any uncommitted work does |
| 7.5 | With two sessions connected, apply a refactoring in one and switch to the other | Undo follows the **selected session**: offered in the one that applied it, not in the other |

## 8 — Tidy up

1. Abort the transaction (Explorer → Abort).
2. Confirm `UndoDemo` is gone from `UserGlobals`.

## Reporting

If something here does not behave as described, note **which numbered step**, what you saw
instead, the stone version, and whether the refactoring engine was freshly installed. The
GemStone GCI output channel (`View → Output → GemStone GCI`) carries a `[undoRefactoring]`
breadcrumb for every invocation and refusal.
