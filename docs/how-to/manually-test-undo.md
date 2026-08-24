# Manually test undo

A hands-on pass over **Undo** ([#434]), for an F5 dev host against a live stone.
Automated coverage already pins the refactoring engine ([GS SUnit] `GsRefactoringUndoTest`),
the client model, stack and commands ([client .ts]), and the whole round trip
([GCI integration] `refactoringUndo.integration.test.ts`) — so what is worth a human's
time is the part tests cannot see: does the affordance turn up where you expect it,
does the preview read correctly, and does the Explorer land somewhere sensible.

Work through it in order; each section builds on the fixture from **Setup**.

[#434]: https://github.com/GemTalk/Jasper/issues/434

## What undo covers

Undo reverses **the last thing you did in this session**, and there is one Undo for
everything — a saved method and an applied refactoring come off the same stack, most
recent first.

Two kinds of thing go on it, and they behave differently on purpose:

**An ordinary method edit — saving a method, adding one, deleting one — reverses
immediately, with no preview.** You just made it, and it is one method. The only thing
that stops and asks is *drift*: if the method has changed since, undoing discards that
change, so it says so first. This needs **no refactoring engine on the stone** — it is
plain `compileMethod:` / `removeSelector:`, so it works wherever Jasper can log in.

Undo is reached five ways, and the first is the one that matters: **the Undo button on the
notice that follows the action**, where you are already looking. If that is missed, there is a
**dimmed-or-purple ↩ Undo button in the status bar** that stays in one place whether or not
there is anything to undo, **Ctrl+K U**, an ↩ icon on the **Methods** pane and on an open
method editor's title bar, and the **Command Palette**.

**A refactoring keeps its preview**, because it can have rewritten dozens of methods
across a hierarchy. It is reversed by the engine, by one of three mechanisms, and the
difference is visible in the UI.

**Recorded inverse** — the refactorings that change methods:

change signature · extract method · extract temporary · inline method · inline temporary ·
move method · push up · push down · rename method · rename temporary

**Reversed by the opposite operation** — renames, and instance-variable add/remove:

rename class · rename instance variable · rename class variable ·
add instance variable · remove instance variable

The second kind is **not a rollback**, and the preview says so in a banner whose wording
depends on which operation it is. GemStone has no transaction savepoints, so the reversal is a
fresh forward operation: the class keeps its history (a reversal adds a version, it never
removes one).

- For a **rename** the compensation is real — anything written after it is carried forward,
  which a history revert would have discarded.
- Reversing an **added** instance variable removes it again, which **deletes** any method
  written since that uses it. The banner names the number.
- Reversing a **removed** instance variable declares the name again but does **not** restore
  the values it held, nor the methods the removal dropped. The banner says so.

Un-ticking a row also means three different things, and the panel reflects each: normally the
change is skipped; for an instance-variable **rename** un-ticking **deletes** that method; and
for the all-or-nothing reshapes the boxes are **disabled** because the engine applies its whole
change set regardless.

**Returned to their pre-refactoring state** — the remaining class reshapes:

instance-variable push up / push down · convert temporary to instance variable ·
extract superclass · insert superclass · split class

These have no opposite operation, so the reversal puts every class the refactoring reshaped back
to the version it had **before** it — shape *and* methods — and unbinds any class the refactoring
created. That means **anything written on those classes since the refactoring is discarded**, and
the preview says so: the banner names how many methods, and each row names its own. It is
all-or-nothing (each subclass is restored onto its parent), so the boxes are disabled.

An apply that **migrated instances** or **deleted old versions from the class history** records
no undo at all — both commit and both are irreversible.

There is **one** REFACTORING undo: applying a second refactoring replaces the stone's
record, and undoing uses it up. Method edits are not limited that way — the last 25 of them
stay reversible, most recent first. Both are per session: a reconnect starts empty, and an
**abort** clears the stack, since it rewinds the stone underneath every entry.

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

## 0 — Undoing an ordinary edit (no preview)

Start here: this is the path that does not involve the refactoring engine at all.

| # | Step | Expect |
|---|---|---|
| 0.0 | Connect, and before editing anything look at the **status bar** (left end) | A **dimmed ↩ Undo** button is already there, tooltip **GemStone — nothing to undo yet (Ctrl+K U)**. It does not come and go — that is the point: you can learn where it lives |
| 0.0b | Click it while dimmed | A plain "there is nothing to undo" message — the button explains itself rather than being inert |
| 0.1 | Open `UndoDemo>>total` in an editor, change the body to `^ 99`, **save** | Toast: `Compiled method UndoDemo>>#total` **with an Undo button** |
| 0.2 | Look at the **status bar** | The same button, now **purple**, tooltip **GemStone — Undo Save UndoDemo>>#total (Ctrl+K U)** — it names the edit, not just "undo" |
| 0.2b | Look at the **editor title bar** and the **Methods** pane title | The ↩ icon is in both — beside the method you just saved, and above the list you just changed |
| 0.3 | Press the toast's Undo (or the status-bar button, or **Ctrl+K U**) | **No panel.** The method reverts on the spot, the open editor reloads showing `^ 40 + 2` again, and a toast says `Undid Save UndoDemo>>#total — reverted UndoDemo>>#total. Compiled but NOT committed` |
| 0.3b | The status-bar button now | Back to **dimmed** — still there, just nothing left to undo |
| 0.4 | The Undo button | **Gone** — the entry was used up |
| 0.5 | Create a **new** method on `UndoDemo` (`scratch ^ 1`) and save it | Tooltip now reads **Undo Add UndoDemo>>#scratch** |
| 0.6 | Press Undo | `scratch` is **removed** from the Explorer's method list |
| 0.7 | Delete `untouched` from the Explorer (the 🗑 on the row), confirm | Toast `Removed UndoDemo>>#untouched` **with an Undo button**; the status-bar tooltip reads **Undo Delete UndoDemo>>#untouched** |
| 0.8 | Press Undo | `untouched` is **back**, with its original source *and* its original category — not `as yet unclassified` |
| 0.9 | Save `total` three times with three different bodies, then press Undo three times | Each press walks back one save, newest first — it is a stack, not a single slot |
| 0.10 | Save `total`, then open it in a second editor, change it there and save, then Undo | A **modal** warning: the method changed since that save, and undoing discards the change. **Cancel** leaves everything alone and the Undo button stays |
| 0.11 | Do 0.10 again and press **Undo Anyway** | It proceeds — drift is a warning, never a refusal |
| 0.12 | Save a method, then **Abort** (Explorer → Abort), then look at the status bar | Undo is **dimmed** — an abort already rewound the stone, so every entry describes a state that no longer exists |
| 0.13 | Save a method on a stone with **no refactoring engine installed** | Undo still works — a method edit needs no engine |

## 1 — The ways in

| # | Step | Expect |
|---|---|---|
| 1.1 | Before doing anything, open the command palette and type `GemStone: Undo` | "Undo Last Change…" is there, showing **Ctrl+K U** beside it — that is how the shortcut gets learned |
| 1.2 | Look at the **status bar** (left end), the **Methods** pane title bar, and an open method editor's title bar | The status-bar button is present but **dimmed**; the Methods pane and editor title icons are **absent** — those are contextual cues, the status bar is the fixed landmark |
| 1.3 | Rename `total` → `sum` (Explorer → the method → Rename), apply the preview | A toast: `Renamed 'total' → 'sum' … NOT committed` **with an Undo button** |
| 1.4 | Do **not** press it. Dismiss the toast (the ✕, or just let it fade) | — |
| 1.5 | Press **Ctrl+K U** | The undo runs — no hunting for a button at all. (Undo it back, or re-apply, before continuing) |
| 1.6 | Look at the **status bar** | The ↩ Undo button has gone from dimmed to **purple** — it should catch your eye against the neutral items |
| 1.6b | Hover it | Tooltip reads **GemStone — Undo Rename 'total' → 'sum' (Ctrl+K U)**: it says which extension it belongs to, *which* refactoring it will undo, and the shortcut |
| 1.6c | **Methods** pane title bar, and the title bar of any open method editor | The same action is in both. It is **not** on the Dictionaries pane — undo is not a dictionary operation |
| 1.7 | Right-click a class, a method, an instance variable | **No** Undo item on any context menu — one button, not an entry on every row |

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
| 3.6b | Where the Explorer is pointing | The **restored method is selected** in the Methods pane — you should not have to hunt for what came back |
| 3.7 | Check `untouched` and `UndoDemo class>>make` | Untouched, both of them |
| 3.8 | The Methods-pane and editor title-bar buttons | **Gone** — the record was used up. The status-bar button stays, dimmed |
| 3.9 | Apply another refactoring | The status-bar button goes **purple** again, with the new refactoring named in its tooltip |

## 4 — Keeping part of an undo

| # | Step | Expect |
|---|---|---|
| 4.1 | Rename `total` → `sum` again and apply | Undo is offered again |
| 4.2 | Invoke Undo, and **un-tick** the row badged **Delete** (`sum`) | Button count drops by one |
| 4.3 | Press Undo | — |
| 4.4 | Explorer | **Both** `total` and `sum` are present — you kept the new one and got the old one back |
| 4.5 | The status-bar button | **Still purple**: a partial undo is not used up |
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
| 6.1 | Run **Add Instance Variable** with **Migrate instances** ticked, and apply | The usual success message, with **no Undo button** — a migration moved user data |
| 6.2 | Status bar / title bars | The status-bar button is **dimmed** and the title-bar icons are **absent** — nothing was recorded for it |
| 6.3 | Rename `total` → `sum`, apply, then **without undoing** run an **Add Instance Variable with Migrate ticked** | Undo is offered **before** the second refactoring and **gone after** it — an irreversible apply clears a stale record rather than leaving one that no longer matches the stone |

## 6b — Reversing a rename (the not-a-rollback path)

| # | Step | Expect |
|---|---|---|
| 6b.1 | Rename the class `UndoDemo` → `UndoRenamed` and apply | Success toast **with an Undo button** — renames are reversible now |
| 6b.2 | Add a method to `UndoRenamed` (say `writtenLater ^ 1`) and save it | — |
| 6b.3 | Invoke Undo | The panel is titled **Undo Rename class UndoDemo to UndoRenamed** and carries a **↩ note**: it reverses by renaming again, is not a rollback, the class keeps its history, and work since the rename is carried forward |
| 6b.4 | Read the rows | Badged **Rename back** / **Re-version** / **Rewrite** — never `classRename` / `classReparent` |
| 6b.5 | The `Rename back` row's label | `UndoRenamed → UndoDemo`, with no phantom `>>` (a class row has no selector) |
| 6b.6 | Press Undo | Explorer shows `UndoDemo` again; `UndoRenamed` is gone |
| 6b.6b | The Classes pane | Still lists the **other classes in the dictionary**, with `UndoDemo` **selected** — not narrowed to just it |
| 6b.7 | Check `UndoDemo>>writtenLater` | **Still there** — carried forward through the reversal. This is the point of 6b.2 |
| 6b.8 | Toast | Says it **reversed by renaming back** and that the class keeps its history — not a bare "Undid" |
| 6b.9 | Class History on `UndoDemo` | More versions than before, not fewer — a reversal adds one |
| 6b.10 | Now: rename `UndoDemo` → `UndoRenamed`, apply, then create a **new** class called `UndoDemo`, then invoke Undo | It **refuses** and names the collision. The new `UndoDemo` is untouched and `UndoRenamed` still exists |
| 6b.11 | Repeat 6b.1 for an **instance variable** rename, then for a **class variable** rename | Both offer Undo and both put the name back |
| 6b.12 | **Add Instance Variable** `extra` to `UndoDemo`, apply, then Undo | Boxes are **disabled** ("all-or-nothing"), the counter reads "(all applied)", and the banner says reversing removes it again. After Undo, `extra` is gone |
| 6b.13 | Add `extra` again, then add a method `usesExtra ^ extra`, save it, then Undo | The banner now names the count: it will **DELETE 1 method**. After Undo, `usesExtra` is gone with the variable — as warned |
| 6b.14 | **Remove Instance Variable** `balance` (which `balance` accessor reads), apply, then Undo | The banner says the values and the dropped methods do **not** come back. After Undo the variable is declared again; the dropped accessor is **not** restored |
| 6b.15 | Do an Add Instance Variable **with Migrate instances ticked**, apply, then check the menu | **No** Undo offer — a migration moved user data, so no reversal is promised |

## 7 — Sessions and commits

| # | Step | Expect |
|---|---|---|
| 7.1 | Rename `total` → `sum`, apply, and **do not** undo | Undo offered |
| 7.2 | Log out and log back in to the same stone | Undo is **dimmed** again — both the stone's record and the client's stack live for the session's lifetime only |
| 7.2b | Log out and stay logged out | The status-bar button **disappears** entirely: undo is per session, and there is none |
| 7.3 | Rename again, apply, **commit**, then Undo | The undo runs and says `NOT committed` — undoing a committed refactoring needs **your** commit, exactly like applying one did |
| 7.4 | Abort instead of committing at 7.3 | The undo's changes go with the abort, as any uncommitted work does |
| 7.5 | With two sessions connected, apply a refactoring in one and switch to the other | Undo follows the **selected session**: offered in the one that applied it, not in the other |

## 8 — Tidy up

1. Abort the transaction (Explorer → Abort).
2. Confirm `UndoDemo` is gone from `UserGlobals`.

## Reporting

If something here does not behave as described, note **which numbered step**, what you saw
instead, the stone version, and whether the refactoring engine was freshly installed. The
GemStone GCI output channel (`View → Output → GemStone GCI`) carries a breadcrumb for every
recording, invocation and refusal — `[undo]` for the stack and method edits, and
`[undoRefactoring]` for the engine's side of it.

## 6c — Returning a reshape to its pre-refactoring state

| # | Step | Expect |
|---|---|---|
| 6c.1 | **Push Instance Variable Down** (or Up) on `UndoDemo`, apply | Success toast **with an Undo button** |
| 6c.2 | Invoke Undo | Rows badged **Restore**, one per class the refactoring reshaped, each showing a **definition diff** — what it is now vs what reverting restores |
| 6c.3 | The banner | Says it returns the classes to their state **BEFORE the refactoring**, shape *and* methods, and that nothing extra is lost |
| 6c.4 | The checkboxes | **Disabled** — all-or-nothing, because each subclass is restored onto its parent |
| 6c.5 | Press Undo, then check the class | Instance variables back where they were, and the methods came with them |
| 6c.6 | Now redo the push-down, then **add a method** to one affected class and save it, then Undo | The banner turns into a **⚠ warning** naming the count, and the row for that class names **your method** specifically |
| 6c.7 | Press Undo, then look for that method | **Gone** — this is the pre-refactoring state, as warned. That is the trade-off; make sure the warning made it obvious enough |
| 6c.8 | **Extract Superclass** on `UndoDemo`, apply, then Undo | Rows include a **Delete class** row for the new superclass (it has no earlier version to revert to). After Undo, the extracted superclass is gone and `UndoDemo` is back under its original parent |
| 6c.9 | **Split Class**, apply, then Undo | Same shape: the source restored, the component class deleted |
| 6c.10 | Class History on an affected class, after any 6c undo | More versions, not fewer — a revert adds one |
| 6c.11 | Where the Explorer is pointing after any 6c undo | The reshaped **class is selected**, in the dictionary's full class list |
