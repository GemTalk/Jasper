# Manually test undo

A hands-on pass over **Undo** ([#434]), for an F5 dev host against a live stone.

This is a PLAN, not a checklist: the passes are ordered by how likely they are to be wrong,
each one says what it verifies and what a failure looks like, and the table below says where
your time is actually worth spending. Automation already covers a great deal of this — 174
unit tests plus 31 GCI integration tests that run against a bare stone — so the passes that
matter most are the ones no test can reach.

[#434]: https://github.com/GemTalk/Jasper/issues/434

## Where your time is worth spending

| What | Already proven by | Worth a human? |
|---|---|---|
| The doits: what a capture reads, what an apply does, escaping, failure reporting | `undo.integration.test.ts`, 31 tests over real GCI | **No** |
| The reversal and drift rules, the stack, the recorders | `methodSlotPlan` / `classSlotPlan` / `undoStack` / `record*Edit` unit tests | **No** |
| Toast, button and tooltip *wording* | `undoUi` / `undoableToast` unit tests | **No** |
| **Abort clears the stack** | **nothing** — needs the extension host | **Yes — Pass D** |
| **Logout clears the stack** | **nothing** — needs the extension host | **Yes — Pass D** |
| Where the affordances actually SIT, and whether you can find them again | `package.json` contributions only | **Yes — Pass A** |
| A modal actually blocking, and reading clearly | unit tests assert the arguments, not the rendering | **Yes — Pass C** |
| Open editors reloading; the Explorer landing on what came back | unit tests against a mocked `vscode` | **Yes — Passes B, C** |
| The keybinding firing for real | `keybindings.test.ts` asserts registration only | **Yes — Pass A** |

If you only have twenty minutes, do **A** and **D**. Those are the two with no safety net.

## How to run a pass

Every pass is self-contained and starts from a clean fixture:

1. Execute `UndoDemoFixture reset` — from a Jasper workspace is fine; `reset` is ordinary
   Smalltalk, unlike the `.gs` file that installs it. It **aborts first**, so whatever the
   previous pass left uncommitted is discarded rather than swept into the commit, and then
   rebuilds and commits only the fixture.
2. Refresh the Explorer, so the client is not holding a tree from before the reset.
3. Work the steps in order. Each pass ends with what a **failure** looks like, so a wrong
   result is recognisable rather than something you have to judge.

Nothing you do during a pass is committed unless you commit it. The fixture itself IS
committed, deliberately — see Setup.

> If you are mid-experiment and do **not** want it thrown away, commit or finish first:
> `reset` deliberately discards uncommitted work.

## What undo covers

Undo reverses **the last thing you did in this session**, and there is one Undo for
everything — a saved method and an applied refactoring come off the same stack, most
recent first.

Two kinds of thing go on it, and they behave differently on purpose:

**A class edit — creating a class, changing its definition, removing it — is a REVERT, and
the word is not pedantry.** GemStone has no transaction savepoints and re-versions a class on
every shape change, so reversing binds the *earlier version* again: the class history grows,
it never shrinks, and anything written on the newer version since is left behind on it. There
is no preview, but there is a modal that names what would be left behind, by method, before
anything happens. Removing a class is the exception that really is exact — `deleteClass` only
unbinds the name, so the very same version goes back with its methods, its history and its
instances intact.

**An ordinary method edit — saving a method, adding one, deleting one — reverses
immediately, with no preview.** You just made it, and it is one method. The only thing
that stops and asks is *drift*: if the method has changed since, undoing discards that
change, so it says so first. This needs **no refactoring engine on the stone** — it is
plain `compileMethod:` / `removeSelector:`, so it works wherever Jasper can log in.

Both kinds are reached the same way, by the same button and the same key — semantically they
are the same act, and splitting them into two commands would only make the user pick. The
button and its tooltip say which of the two it is about to do: **Undo** for a method edit or a
refactoring, **Revert** for a class edit, always naming the specific change.

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
   commands offer to install it; do that first. Sections **0** and **0b** need no engine at
   all — they are the point of the client-side undo — so they can be run on a bare stone.)
3. File in the fixture with topaz — `gs-src/fixtures/undoDemo.gs`, loaded with the recipe in
   `/eric worktree`. It is a topaz file and **cannot** be pasted into a Jasper editor and
   Executed (`run … %` is a topaz command, not Smalltalk).

   It builds three classes in `UserGlobals`, under class category `Undo Demo`:

   | Class | Instance variables | Methods |
   |---|---|---|
   | `UndoDemoAccount` | `udBalance`, `udSpare` | `udTotal` (computing) · `udReport` (printing, sends `udTotal`) · `udPure` (computing) · `udBalanceValue` (accessing, reads `udBalance`) · `udUntouched` (fixture) · class-side `udMake` (instance creation) |
   | `UndoDemoSavings` | `udRate` | `udRateValue` (accessing) |
   | `UndoDemoLedger` | — | `udPost` (posting) |

   Each element earns its place: `udReport` is the caller a rename must rewrite and an undo
   must put back; `udBalanceValue` gives Remove Instance Variable a method to drop; `udSpare`
   is read by nothing, so pushing it down is *declined*; `udUntouched` and `udMake` are the
   canaries — nothing below should ever disturb them, and `udMake` is also the class-side
   slot a class revert has to bring back.

   Every selector is `ud`-prefixed because a selector is **image-wide**. Verified in
   `gs64stone_375`: one implementor each, zero foreign.

4. Between sections, run `UndoDemoFixture reset` to get back to a clean fixture. You will
   want it — the walkthrough mutates this fixture on purpose (methods deleted, a definition
   turned into an empty new version, a class left renamed), and the next section assumes the
   original shape.

5. **The fixture is committed; your edits are not.** That is deliberate: steps 0.12 and 7.4
   exercise **Abort**, and an uncommitted fixture would vanish underneath you at exactly that
   point. Nothing you do during the pass is committed unless you commit it.

6. When you are done, `UndoDemoFixture removeDemo` takes the whole thing out and commits, so
   an abort cannot bring it back.

## Pass A — can you find it? (the highest-risk part)

**Verifies** the five ways in, and that the status-bar button is *learnable* — it stays in
one place instead of appearing and vanishing, which is what made it unfindable before.

**Reset first.** Uses `UndoDemoAccount>>udTotal`.

| # | Step | Expect |
|---|---|---|
| A.1 | Connect, and before editing anything look at the **left end of the status bar** | A **dimmed ↩ Undo** button is already there, tooltip **GemStone — nothing to undo yet (Ctrl+K U)** |
| A.2 | Click it while dimmed | A plain "there is nothing to undo" message. The button explains itself rather than doing nothing |
| A.3 | Open `UndoDemoAccount>>udTotal`, change the body to `^ 99`, **save** | Toast `Compiled method UndoDemoAccount>>#udTotal` **carrying an Undo button** |
| A.4 | Without touching the toast, look at the status bar | The **same button, same place**, now **purple**. Tooltip: **GemStone — Undo: Save UndoDemoAccount>>#udTotal (Ctrl+K U)** — it names the edit and the shortcut |
| A.5 | Look at the **Methods** pane title bar and the **editor** title bar | An ↩ icon in both. **Not** on the Dictionaries pane — undo is not a dictionary operation |
| A.6 | Open the Command Palette, type `GemStone: Undo` | **Undo Last Change…**, with **Ctrl+K U** shown beside it |
| A.7 | Press **Ctrl+K U** | The undo runs. This is the path that needs no hunting at all |
| A.8 | Status bar again | Back to **dimmed**, still in the same place |
| A.9 | Right-click a class, a method, an instance variable | **No** Undo item on any context menu — one button, not an entry on every row |

**Fails if:** the status-bar button disappears when there is nothing to undo (that is the
original bug); the tooltip says only "Undo" without naming the edit; `Ctrl+K U` does nothing;
or the icon is still on the Dictionaries pane.

## Pass B — undoing an ordinary method edit (no preview)

**Verifies** the core new path: save / add / delete a method, reversed on the spot, with no
panel. This is also the path that needs **no refactoring engine** — worth running once on a
bare stone to see that for yourself.

**Reset first.** Uses `udTotal`, `udUntouched`, and a new `udScratch`.

| # | Step | Expect |
|---|---|---|
| B.1 | Save `udTotal` as `^ 99`, then press Undo | **No panel.** The open editor reloads showing `^ 40 + 2` again, and a toast reads `Undid Save UndoDemoAccount>>#udTotal — reverted UndoDemoAccount>>#udTotal. Compiled but NOT committed` |
| B.2 | Add a new method `udScratch ^ 1` and save, then Undo | Tooltip said **Add**, not Save. `udScratch` disappears from the Methods pane |
| B.3 | Delete `udUntouched` (🗑 on the row), confirm | Toast `Removed UndoDemoAccount>>#udUntouched` with an Undo button |
| B.4 | Press Undo | It is **back**, with its original source *and* its original category `fixture` — **not** `as yet unclassified`. The Explorer selects it |
| B.5 | Save `udTotal` three times with three different bodies, then Undo three times | Each press walks back one save, newest first. It is a stack, not a single slot |
| B.6 | Edit `udTotal`'s **message pattern** to `udTotalled` and save, then Undo | `udTotal` comes back **and** `udTotalled` goes away. GemStone leaves both behind on such a save; undoing has to do both |
| B.7 | Open `udPure` in two editors. Save from the first, then change and save from the second. Undo | A **modal**: the method changed since that save, and undoing discards the change. **Cancel** — nothing happens, and the Undo button stays |
| B.8 | Repeat B.7 and press **Undo Anyway** | It proceeds. Drift is a warning, never a refusal |
| B.9 | With an editor open on `udPure` **and dirty** (unsaved edits), undo something else | The dirty editor is **left alone** — an undo elsewhere must not discard your typing |

**Fails if:** a preview panel opens for any of these; a restored method lands in `as yet
unclassified`; the drift modal does not appear at B.7; or B.9 wipes unsaved text.

## Pass C — reverting a class edit

**Verifies** the class path, which is a **revert** and says so everywhere. GemStone
re-versions a class on every shape change, so this binds the *earlier version* back — the
history grows, and anything written on the newer version is left behind.

**Reset first.** Uses `UndoDemoAccount` and `UndoDemoSavings`.

| # | Step | Expect |
|---|---|---|
| C.1 | Create a class `UndoDemoScratch` in `UserGlobals` and save | Toast `Class created: UndoDemoScratch` with a **Revert** button — note the word. Status-bar button reads **↩ Revert** |
| C.2 | Press Revert | The class is gone. **No modal** — nothing had been written on it |
| C.3 | Open `UndoDemoAccount`'s **definition**, make it `instVarNames: #('udBalance' 'udSpare' 'udExtra')`, save | Toast `Class definition updated…` with a Revert button. **Look at the Methods pane: it is now empty.** That is GemStone, not Jasper — see "A sharp edge" below |
| C.4 | Press Revert | `Reverted Redefine class UndoDemoAccount — restored … to its earlier version. The class keeps its history.` The instance variable is gone **and all six methods are back**, class-side `udMake` included |
| C.5 | Class History on `UndoDemoAccount` | **More** versions than before, not fewer. A revert binds an earlier version; it does not delete a later one |
| C.6 | Repeat C.3, then write `udWrittenLater ^ 1` on the emptied class and save. Now Revert | A **modal first**: reverting leaves 1 method behind, and it **names** `UndoDemoAccount>>#udWrittenLater`. Cancel — nothing happens |
| C.7 | Do it again and press **Revert Anyway** | The original methods are back; `udWrittenLater` is **not**. It belongs to the version no longer bound, exactly as warned |
| C.8 | Remove `UndoDemoAccount` from the Explorer (right-click → Remove), confirm — this takes `UndoDemoSavings` with it | Toast naming **2 classes**, with a Revert button |
| C.9 | Press Revert | **Both** classes are back, same versions, with their methods and `UndoDemoSavings` still under `UndoDemoAccount`. No modal — nothing newer existed to leave behind |
| C.10 | Save a definition change, then **log out and back in**, then look at the status bar | Dimmed. The earlier version was held in the session, and the session is gone |

**Fails if:** any message says "Undo" rather than "Revert" for these; C.4 comes back without
its methods; C.6 shows a count but no method name; C.9 restores only one of the two classes;
or C.5 shows *fewer* versions (that would mean something is deleting history).

### A sharp edge worth knowing

Saving a **shape change** from the class-definition editor is a GemStone re-version, and
GemStone does **not** carry methods forward: the new version arrives **empty**. That is why
the refactoring engine has its own Add/Remove Instance Variable — it recompiles the methods
onto the new version. It is not something this undo work introduced, and step 0b.4 is now the
quickest way back from it without aborting the whole transaction.

Saving a definition you have **not** changed is a true no-op — GemStone answers the same
class object — so no version is created, no methods are lost, and nothing is recorded.

## Pass D — session boundaries (nothing automated covers this)

**Verifies** the two rules that live in `extension.ts` wiring and that no test can reach: an
**abort** and a **logout** each clear the undo stack. Both matter because an entry that
outlives its transaction describes a state the stone no longer has, and acting on it would
put back source the abort already discarded.

**Reset first.**

| # | Step | Expect |
|---|---|---|
| D.1 | Save `udTotal` as `^ 99`. Confirm the status-bar button is purple | Something to undo |
| D.2 | **Explorer → Abort** | The method is back at `^ 40 + 2` (the abort did that, not the undo) |
| D.3 | Look at the status bar | **Dimmed.** The entry is gone, because the stone was rewound underneath it |
| D.4 | Save `udTotal` again, then **log out** of the session | — |
| D.5 | Status bar with no session | The button is **gone entirely** — undo is per session, and there is none |
| D.6 | Log back in to the same stone | Button is back and **dimmed**. A new session starts with an empty stack |
| D.7 | With **two** sessions connected, save a method in one and switch to the other | Undo follows the **selected session**: offered in the one that made the edit, dimmed in the other |

**Fails if:** the button is still purple after D.2 or D.6 — that is an entry that would try to
reverse against a transaction that no longer exists, and pressing it is how you would find
out the hard way. This is the single most valuable pass in the document.

## Pass E — one stack, two kinds

**Verifies** that method edits and refactorings share one stack in the order they happened,
and that the button names whichever is on top.

**Reset first.** Needs the refactoring engine installed.

| # | Step | Expect |
|---|---|---|
| E.1 | Save `udPure`, then rename `udTotal` → `udSum` (Explorer → the method → Rename) and apply | Post-apply toast with an Undo button |
| E.2 | Status bar tooltip | Names the **rename**, not the save — most recent first |
| E.3 | Undo once | The rename is reversed, through its **preview panel** (a refactoring keeps its preview) |
| E.4 | Status bar tooltip now | Names the **save** of `udPure`. The stack carried on underneath |
| E.5 | Undo again | The save reverses **with no panel**. Same button, two different behaviours, each appropriate to what it is reversing |
| E.6 | Apply a refactoring, then apply a second one **without** undoing the first | Only the second is offered. The stone keeps one refactoring record, so the first is dropped rather than left as a dead offer |
| E.7 | Redefine a class, then save a method, then look at the button | Reads **↩ Undo** (the method edit is on top). Undo it, and the button flips to **↩ Revert** for the class edit underneath |

**Fails if:** two Undo buttons appear; the tooltip names the wrong entry; E.5 opens a panel;
or E.7 does not change the verb.

## Pass F — the refactoring walkthrough

The original per-refactoring passes, unchanged. Run these when the change under
review touches the engine rather than the stack.

## 1 — A dismissed toast must not strand the undo

Pass A covers where the affordances live. This covers the one thing it does not: that
letting the post-refactoring toast go does not lose the undo with it.

| # | Step | Expect |
|---|---|---|
| 1.1 | Rename `udTotal` → `udSum` (Explorer → the method → Rename), apply the preview | A toast: `Renamed 'udTotal' → 'udSum' … NOT committed` **with an Undo button** |
| 1.2 | Do **not** press it. Dismiss the toast (the ✕, or just let it fade) | — |
| 1.3 | Status bar | Purple, tooltip **GemStone — Undo: Rename 'udTotal' → 'udSum' (Ctrl+K U)** — naming the refactoring, which a static menu title never could |
| 1.4 | Press **Ctrl+K U** | The undo runs. The dismissed toast cost nothing |

**Fails if:** the undo is unreachable after 1.2. The record lives until it is used, and every
other affordance must still reach it.

## 2 — The preview

| # | Step | Expect |
|---|---|---|
| 2.1 | Invoke Undo (any of the three ways) | A panel titled **Undo Rename #udTotal to #udSum** |
| 2.2 | Read the header | The button says **Undo _n_** and matches the "_n_ of _n_ changes selected" line |
| 2.3 | Read the rows | Each is badged **Restore**, **Revert** or **Delete** — never `methodAdd` / `methodRecompile` / `methodRemove` |
| 2.4 | Find the `udTotal` row | Badged **Restore** (the rename deleted it) |
| 2.5 | Find the `udSum` row | Badged **Delete** (the rename created it) |
| 2.6 | Find the `udReport` row | Badged **Revert** (the rename rewrote its send) |
| 2.7 | Click a row header | The diff expands: what is in the stone **now** on the left, what undoing leaves on the right |
| 2.8 | Click **Expand all** / **Collapse all** | Every diff opens / closes; the label flips |
| 2.9 | Click **Cancel** | The panel closes and **nothing changes** — and the Undo item is still offered |

## 3 — Undoing, and where you land

| # | Step | Expect |
|---|---|---|
| 3.1 | Open `UndoDemoAccount>>udReport` in an editor and leave it open | You can see the rewritten `self udSum` |
| 3.2 | Invoke Undo and press **Undo _n_** | Panel closes |
| 3.3 | The open `udReport` editor | Reloads by itself, showing `self udTotal` again |
| 3.4 | The Explorer method list | Shows `udTotal`, not `udSum` |
| 3.5 | The toast | `Undid Rename #udTotal to #udSum (n changes). Compiled but NOT committed — commit when ready.` |
| 3.6 | Check `udTotal`'s **category** in the Explorer | Back to `computing` — **not** `as yet unclassified` |
| 3.6b | Where the Explorer is pointing | The **restored method is selected** in the Methods pane — you should not have to hunt for what came back |
| 3.7 | Check `udUntouched` and `UndoDemoAccount class>>make` | Untouched, both of them |
| 3.8 | The Methods-pane and editor title-bar buttons | **Gone** — the record was used up. The status-bar button stays, dimmed |
| 3.9 | Apply another refactoring | The status-bar button goes **purple** again, with the new refactoring named in its tooltip |

## 4 — Keeping part of an undo

| # | Step | Expect |
|---|---|---|
| 4.1 | Rename `udTotal` → `udSum` again and apply | Undo is offered again |
| 4.2 | Invoke Undo, and **un-tick** the row badged **Delete** (`udSum`) | Button count drops by one |
| 4.3 | Press Undo | — |
| 4.4 | Explorer | **Both** `udTotal` and `udSum` are present — you kept the new one and got the old one back |
| 4.5 | The status-bar button | **Still purple**: a partial undo is not used up |
| 4.6 | Invoke it again and undo the rest | `udSum` goes; you are back to the fixture |

## 5 — Drift: editing after a refactoring

| # | Step | Expect |
|---|---|---|
| 5.1 | Rename `udTotal` → `udSum` and apply | — |
| 5.2 | Open `UndoDemoAccount>>udSum`, change the body to `^ 999`, **save** it | — |
| 5.3 | Invoke Undo | A warning banner at the top: _n_ change(s) are **not a clean reversal** |
| 5.4 | Find the `udSum` row | Outlined in the warning colour, with an inline ⚠ saying it was edited since the refactoring |
| 5.5 | Press Undo anyway | It proceeds — drift is a warning, never a refusal — and `^ 999` is gone |
| 5.6 | Repeat 5.1–5.2, but this time **un-tick** the warned row before pressing Undo | Your `^ 999` edit survives; the rest of the undo runs |

## 6 — What Undo will not offer

| # | Step | Expect |
|---|---|---|
| 6.1 | Run **Add Instance Variable** with **Migrate instances** ticked, and apply | The usual success message, with **no Undo button** — a migration moved user data |
| 6.2 | Status bar / title bars | The status-bar button is **dimmed** and the title-bar icons are **absent** — nothing was recorded for it |
| 6.3 | Rename `udTotal` → `udSum`, apply, then **without undoing** run an **Add Instance Variable with Migrate ticked** | Undo is offered **before** the second refactoring and **gone after** it — an irreversible apply clears a stale record rather than leaving one that no longer matches the stone |

## 6b — Reversing a rename (the not-a-rollback path)

| # | Step | Expect |
|---|---|---|
| 6b.1 | Rename the class `UndoDemoAccount` → `UndoDemoRenamed` and apply | Success toast **with an Undo button** — renames are reversible now |
| 6b.2 | Add a method to `UndoDemoRenamed` (say `udWrittenLater ^ 1`) and save it | — |
| 6b.3 | Invoke Undo | The panel is titled **Undo Rename class UndoDemoAccount to UndoDemoRenamed** and carries a **↩ note**: it reverses by renaming again, is not a rollback, the class keeps its history, and work since the rename is carried forward |
| 6b.4 | Read the rows | Badged **Rename back** / **Re-version** / **Rewrite** — never `classRename` / `classReparent` |
| 6b.5 | The `Rename back` row's label | `UndoDemoRenamed → UndoDemoAccount`, with no phantom `>>` (a class row has no selector) |
| 6b.6 | Press Undo | Explorer shows `UndoDemoAccount` again; `UndoDemoRenamed` is gone |
| 6b.6b | The Classes pane | Still lists the **other classes in the dictionary**, with `UndoDemoAccount` **selected** — not narrowed to just it |
| 6b.7 | Check `UndoDemoAccount>>udWrittenLater` | **Still there** — carried forward through the reversal. This is the point of 6b.2 |
| 6b.8 | Toast | Says it **reversed by renaming back** and that the class keeps its history — not a bare "Undid" |
| 6b.9 | Class History on `UndoDemoAccount` | More versions than before, not fewer — a reversal adds one |
| 6b.10 | Now: rename `UndoDemoAccount` → `UndoDemoRenamed`, apply, then create a **new** class called `UndoDemoAccount`, then invoke Undo | It **refuses** and names the collision. The new `UndoDemoAccount` is untouched and `UndoDemoRenamed` still exists |
| 6b.11 | Repeat 6b.1 for an **instance variable** rename, then for a **class variable** rename | Both offer Undo and both put the name back |
| 6b.12 | **Add Instance Variable** `udExtra` to `UndoDemoAccount`, apply, then Undo | Boxes are **disabled** ("all-or-nothing"), the counter reads "(all applied)", and the banner says reversing removes it again. After Undo, `udExtra` is gone |
| 6b.13 | Add `udExtra` again, then add a method `udUsesExtra ^ udExtra`, save it, then Undo | The banner now names the count: it will **DELETE 1 method**. After Undo, `udUsesExtra` is gone with the variable — as warned |
| 6b.14 | **Remove Instance Variable** `udBalance` (which `udBalance` accessor reads), apply, then Undo | The banner says the values and the dropped methods do **not** come back. After Undo the variable is declared again; the dropped accessor is **not** restored |
| 6b.15 | Do an Add Instance Variable **with Migrate instances ticked**, apply, then check the menu | **No** Undo offer — a migration moved user data, so no reversal is promised |

## 6c — Returning a reshape to its pre-refactoring state

| # | Step | Expect |
|---|---|---|
| 6c.1 | **Push Instance Variable Down** (or Up) on `UndoDemoAccount`, apply | Success toast **with an Undo button** |
| 6c.2 | Invoke Undo | Rows badged **Restore**, one per class the refactoring reshaped, each showing a **definition diff** — what it is now vs what reverting restores |
| 6c.3 | The banner | Says it returns the classes to their state **BEFORE the refactoring**, shape *and* methods, and that nothing extra is lost |
| 6c.4 | The checkboxes | **Disabled** — all-or-nothing, because each subclass is restored onto its parent |
| 6c.5 | Press Undo, then check the class | Instance variables back where they were, and the methods came with them |
| 6c.6 | Now redo the push-down, then **add a method** to one affected class and save it, then Undo | The banner turns into a **⚠ warning** naming the count, and the row for that class names **your method** specifically |
| 6c.7 | Press Undo, then look for that method | **Gone** — this is the pre-refactoring state, as warned. That is the trade-off; make sure the warning made it obvious enough |
| 6c.8 | **Extract Superclass** on `UndoDemoAccount`, apply, then Undo | Rows include a **Delete class** row for the new superclass (it has no earlier version to revert to). After Undo, the extracted superclass is gone and `UndoDemoAccount` is back under its original parent |
| 6c.9 | **Split Class**, apply, then Undo | Same shape: the source restored, the component class deleted |
| 6c.10 | Class History on an affected class, after any 6c undo | More versions, not fewer — a revert adds one |
| 6c.11 | Where the Explorer is pointing after any 6c undo | The reshaped **class is selected**, in the dictionary's full class list |
## 7 — Sessions and commits

| # | Step | Expect |
|---|---|---|
| 7.1 | Rename `udTotal` → `udSum`, apply, and **do not** undo | Undo offered |
| 7.2 | Log out and log back in to the same stone | Undo is **dimmed** again — both the stone's record and the client's stack live for the session's lifetime only |
| 7.2b | Log out and stay logged out | The status-bar button **disappears** entirely: undo is per session, and there is none |
| 7.3 | Rename again, apply, **commit**, then Undo | The undo runs and says `NOT committed` — undoing a committed refactoring needs **your** commit, exactly like applying one did |
| 7.4 | Abort instead of committing at 7.3 | The undo's changes go with the abort, as any uncommitted work does |
| 7.5 | With two sessions connected, apply a refactoring in one and switch to the other | Undo follows the **selected session**: offered in the one that applied it, not in the other |

## Tidy up

1. **Explorer → Abort**, to drop anything you left uncommitted.
2. `UndoDemoFixture removeDemo` — takes the whole fixture out and commits, so the abort in
   step 1 cannot bring it back.
3. Confirm `UndoDemoAccount`, `UndoDemoSavings`, `UndoDemoLedger` and `UndoDemoFixture` are
   all gone from `UserGlobals`.

Between passes, `UndoDemoFixture reset` is the one you want instead — it rebuilds the fixture
without removing it.

## Reporting

If something here does not behave as described, note **which step** (they are labelled
`A.1`, `C.6`, `6b.3` and so on for exactly this reason), what you saw instead, the stone
version, and whether the refactoring engine was freshly installed. The
GemStone GCI output channel (`View → Output → GemStone GCI`) carries a breadcrumb for every
recording, invocation and refusal — `[undo]` for the stack and method edits, and
`[undoRefactoring]` for the engine's side of it.

