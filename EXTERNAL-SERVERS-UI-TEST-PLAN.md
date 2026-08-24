# UI test plan — servers started outside Jasper's environment

For PR #480 / issue #472, branch `eric/issue472-external-servers`.
Ordered by **risk**, not by setup convenience: the first two tests are the ones that
catch a feature doing harm, the rest check that it does good.

## Is this F5-testable?

**Yes — the extension is.** Press F5 from *this worktree* (it must be this folder;
`--extensionDevelopmentPath=${workspaceFolder}` is what makes F5 run the branch instead
of the installed extension) and use the Databases view normally.

What is **not** F5-testable is the setup for tests 3 and up. The feature is about a state
you can only create outside the editor — a server registered in a `locks/` directory
Jasper does not read — so those start in a terminal, and Jasper is the thing you observe
afterwards. There is no way to produce that state by clicking inside Jasper, because
Jasper always starts servers in its own root.

Everything here is reversible **from the terminal, not from Jasper**. If a run goes
sideways, jump to *Cleanup* rather than clicking around trying to recover.

---

## Status

**All 8 passed, 2026-08-24 (Linux).** Four real bugs came out of this pass, all fixed:
a `.bashrc` that unset `GEMSTONE` broke Jasper's own commands; the message meant to
replace GemStone's complaint was built from the issue's paraphrase and never matched;
the identity gate was too strict for a NetLDI, making the restart unreachable in its
commonest case; and the row's action promised a connect it never performed. macOS and
Windows/WSL remain untested — see the end of this file.

| Test | State |
|---|---|
| 0 · Works with a hostile `.bashrc` | ✅ **passed 2026-08-24** — all boxes |
| 1 · Stays out of the way | ✅ **passed 2026-08-24** |
| 2 · Safety gate holds | ✅ **passed 2026-08-24** — found the gate was too strict for a NetLDI |
| 3 · Tree tells the truth | ✅ **passed 2026-08-24** |
| 4 · Catches the reported bug | ✅ **passed 2026-08-24** |
| 5 · Reconcile actually reconciles | ✅ **passed 2026-08-24** — via the row action; found it promised a connect it did not do |
| 6 · Dialog says the right thing | ✅ **passed 2026-08-24** — both variants read: unconfirmed in test 2, confirmed in test 3 |
| 7 · Fails without dead-ending | ✅ **passed 2026-08-24** |

Already machine-verified, so **do not re-test by hand**: parsing, identity logic, version
matching, kill safety rules, and message wording, across 6,590 automated tests including
one that runs against a live stone. Scenario A's setup and the Cleanup section below were
also dry-run for real.

---

## Setup, once

Use **`db-2`** (stone `gs64stone2`, NetLDI `gs64ldi2`) — it is stopped, so nothing here
disturbs `db-1`, whose servers are up under Jasper. Tests 0–2 need no terminal at all.

For tests 3 and up you need an "outside Jasper" shell. **Source the setup script in
every terminal you use** — the variables do not survive a new terminal, and the failure
is quiet rather than loud: `$DB` expands to nothing, so `-l "$DB/log/x.log"` becomes
`-l /log/x.log` and GemStone complains about a missing directory rather than a missing
variable.

```bash
cd /export/uffda1/users/ewinger/worktrees/issue472-external-servers
source ./external-server-test-env.sh
```

It prints what it set. Then check that this shell and Jasper disagree about nothing yet:

```bash
gslist -cvl                                    # $OUTSIDE — empty
GEMSTONE_GLOBAL_DIR=$ROOT gslist -cvl          # Jasper's — shows db-1's servers
```

Before every `startstone` / `startnetldi` below, confirm the variables are live —
`echo "$DB"` should print a path, not a blank line.

### How identity gets decided (read once)

Jasper only offers **Restart & Connect** when it can confirm the running server is really
this database's, and the only evidence is the paths the process was started with. Two
consequences shape which tests are even reachable:

- **A working stone always reveals its database.** `startstone` derives `-e` and `-z` from
  `GEMSTONE_SYS_CONF` / `GEMSTONE_EXE_CONF`, which have to point at `db-2/conf` for it to
  run `db-2` at all. So a stone genuinely running `db-2` is always **confirmed**.
- **A NetLDI reveals nothing unless told to.** `netldid` needs no conf, so without `-l` it
  carries no database path. That is the natural **unconfirmed** case, and what test 2 uses.

---

## 0 · Works with a hostile `.bashrc` — ✅ passed 2026-08-24

**Why it is first:** this was a real bug, found by this test pass, and the fix is the kind
that only a human can confirm.

`/home/ewinger/.bashrc` line 24 is `unset GEMSTONE`, with no interactivity guard above it.
Jasper built a correct environment, handed it over, and the shell deleted that one
variable before GemStone saw it — so `startstone` insisted `GEMSTONE` was undefined while
Jasper could truthfully report it had set it. It reached both the database terminal and
the spawn.

Same class of bug as #472 itself, in the opposite direction: the issue was about the
shell's leftovers *leaking into* Jasper's discovery, this is the shell *overwriting* what
Jasper set.

- [x] With `unset GEMSTONE` **present** in `.bashrc`, Start Stone on `db-2` succeeds.
- [x] Stop and restart from Jasper both work.
- [x] `db-2 → Open Terminal` → `printenv GEMSTONE` prints the product path. Confirmed
      separately from the spawn fix, since the two use different mechanisms: the terminal
      re-exports after your startup files run, the spawn refuses to read them at all.

**A fix that requires editing your shell is not a fix**; the point is that the line can
stay.

---

## 1 · Stays out of the way ⚠️ highest risk · ~5 min · no setup

The control. Every other test proves the feature works; this one proves it does not
**misfire**. A false positive means Jasper offers to kill a stone you are happily using —
worse than the bug being fixed. The code guards it twice, but nobody has watched it stay
quiet.

**`db-1` (running, healthy):**
- [ ] Stone reads plain **Running**, green play icon
- [ ] NetLDI reads **Running (port …)**, green
- [ ] No warning icons, no "outside Jasper", no nagging tooltip
- [ ] Logging in connects normally, with no dialog

**`db-2` (stopped):**
- [ ] Both rows read **Stopped**
- [ ] Logging in gives the **ordinary "Start the database?" prompt** — *not* the new
      external-servers dialog
- [ ] Accepting it starts and connects as before

---

## 2 · Safety gate holds ⚠️ ~10 min

What stops Jasper killing a stranger's server that happens to share a name.

> **The name has to be `gs64ldi2`.** Detection is per *managed database*: for each one
> Jasper asks whether a process is running under **that database's** configured stone or
> NetLDI name that its own `gslist` cannot see. A NetLDI called anything else — `ldibert0`,
> say — matches no database and is correctly ignored, and it will not appear in the
> Processes view either, since that view is Jasper's `gslist` and an external server is not
> in it. Nothing to see is the right answer there, not a bug.
>
> **Stop db-2's NetLDI from Jasper first** if it is running from an earlier test — two
> servers cannot hold the same name.

```bash
source ./external-server-test-env.sh           # in a new terminal, or $DB is empty
startnetldi -a "$USER" -g gs64ldi2             # the database's real name, and no -l
```

Confirm it gives nothing away:

```bash
ps -Ao pid=,command= | grep 'sys/netldid' | grep gs64ldi2
```

- [ ] The NetLDI row still reads **Running outside Jasper** — detection does not depend on
      identity
- [ ] Logging in warns it **could not confirm** whose NetLDI this is
- [ ] **Restart & Connect is not offered** — only *Connect as-is* and Cancel
- [ ] The row's **Restart Under Jasper's Environment** action refuses too. The action must
      not become a way around the gate.
- [ ] Nothing is stopped — PID unchanged afterwards

### 2b · A same-named server that really is a different database (optional)

```bash
cp -r "$DB" /tmp/other-db-2
export GEMSTONE_SYS_CONF=/tmp/other-db-2/conf
export GEMSTONE_EXE_CONF=/tmp/other-db-2/conf
startstone -l /tmp/other-db-2/log/gs64stone2.log gs64stone2
```

- [ ] The dialog says its paths point **outside this database**, so it is probably a
      different database sharing the name
- [ ] **Restart & Connect** is not offered

Clean up: `stopstone gs64stone2 DataCurator swordfish` and `rm -rf /tmp/other-db-2`.

---

## 3 · Tree tells the truth · ~10 min

```bash
source ./external-server-test-env.sh           # in a new terminal, or $DB is empty
echo "$DB"                                     # must print a path, not a blank line

export GEMSTONE_SYS_CONF=$DB/conf              # these two are what make the
export GEMSTONE_EXE_CONF=$DB/conf              # servers identifiable as db-2's
startnetldi -a "$USER" -g -l "$DB/log/gs64ldi2.log" gs64ldi2
startstone  -l "$DB/log/gs64stone2.log" gs64stone2
```

- [ ] Both `db-2` rows read **Running outside Jasper**, warning icon — not Stopped, not
      green
- [ ] Tooltips name the **PID** and say **registered in /tmp/gemstone-outside**, contrasted
      with the Jasper root
- [ ] Tooltips say the server will not appear in the Processes view
- [ ] **Processes view**: neither server is listed. That view *is* Jasper's `gslist` view,
      and the tooltip's claim has to hold.

Then, purely inside Jasper (no terminal): start both of `db-2`'s servers from Jasper, stop
only the **NetLDI**.

- [ ] Stone changes to **Running — not connectable** — it does not stay plain green

---

## 4 · Catches the reported bug · ~10 min

The original symptom: both processes alive, tree claiming one Running and one Stopped.

1. From Jasper, start only `db-2`'s **stone**.
2. From the outside shell (with `GEMSTONE_SYS_CONF`/`EXE_CONF` set as in test 3):
   `startnetldi -a "$USER" -g -l "$DB/log/gs64ldi2.log" gs64ldi2`

- [ ] NetLDI reads **Running outside Jasper**
- [ ] Stone reads **Running — not connectable**, *not* plain Running
- [ ] Logging in offers the reconcile, and does **not** offer a plain "start the database?"
      prompt

---

## 5 · Reconcile actually reconciles · ~10 min

From test 3's state (both external, confirmed), log in and choose **Restart & Connect**.

- [ ] Progress names each server as it is stopped
- [ ] The login then succeeds and a session appears
- [ ] Both rows go plain green **Running**
- [ ] Both now appear in the **Processes view**

```bash
gslist -cvl                                    # $OUTSIDE — empty now
GEMSTONE_GLOBAL_DIR=$ROOT gslist -cvl          # Jasper's — db-2 is here
ls "$OUTSIDE/locks"                            # no gs64stone2/gs64ldi2 locks left
```
- [ ] The servers moved into Jasper's root and left no lock behind

Then repeat the setup and try the other two answers:
- [ ] **Connect as-is** — nothing stopped (PIDs unchanged), login attempted anyway
- [ ] **Cancel / Esc** — nothing stopped, and **no error notification follows**. The dialog
      already explained; re-showing the raw login error would be nagging.
- [ ] The row's **Restart Under Jasper's Environment** action does the same thing without
      needing a login first
- [ ] With only the **NetLDI** external and the stone already up under Jasper, that action
      still starts the NetLDI — it must not report failure because the stone was running

---

## 6 · Dialog says the right thing · ~5 min

Read it once, carefully, from test 3's state.

- [ ] Describes an environment **mismatch** — "started outside Jasper's environment … so
      they're registered where Jasper's own gslist doesn't look"
- [ ] Says **nothing** about GemStone not being installed. A user looking at live processes
      who is told their install is missing goes off to debug their shell — the exact detour
      this replaced.
- [ ] Explains that Jasper's `gslist` can differ from the host's
- [ ] Lists both servers with PIDs and the registration directory
- [ ] Warns that restarting drops **uncommitted sessions**
- [ ] Buttons: **Restart & Connect**, **Connect as-is**, Cancel
- [ ] It is **modal** — it interrupts rather than passing by in a toast

---

## 7 · Fails without dead-ending · ~15 min

With `db-2`'s stone running **externally** (test 3 setup):

**Destructive operations refuse, usefully:**
- [ ] **Delete** on `db-2` is refused, and the message names the **PID** and **registration
      directory** and points at **Restart Under Jasper's Environment**
- [ ] It does **not** merely say "Stop it before deleting" — a dead end, since the External
      row offers no Stop button
- [ ] **Replace Extent** refuses the same way, touching no extent file

**A stop Jasper cannot complete** (hardest to stage; skip if short on time). Change
`db-2`'s DataCurator password away from the stock one so the clean stop fails and the kill
takes over:
- [ ] The restart still completes
- [ ] `ls "$OUTSIDE/locks"` — no `gs64stone2..LCK` left behind
- [ ] If the kill itself fails, the error names **both server names, the PIDs, the
      registration directory**, the `GEMSTONE_GLOBAL_DIR=… gslist -cvl` command, **and the
      lock files to remove**

---

## Cleanup

Always finish here — an orphan in `$OUTSIDE` will confuse the next run.

```bash
stopstone gs64stone2 DataCurator swordfish || true
stopnetldi gs64ldi2 || true

ps -Ao pid=,command= | grep -E 'sys/(stoned|netldid)' | grep gs64stone2
# kill <pid> anything that survived, then:
rm -f "$OUTSIDE/locks/"*.LCK
rm -rf "$OUTSIDE"

GEMSTONE_GLOBAL_DIR=$ROOT gslist -cvl     # back to just db-1's servers
```

---

## Things to watch for that no checkbox covers

- **Any message mentioning installing or extracting GemStone** while servers are plainly
  running. That phrasing is what sent users off debugging their shell profile.
- **A raw `The environment variable 'GEMSTONE' is not defined`** surfacing. It should
  always be replaced by text saying Jasper *did* set it, naming the path, and offering the
  `printenv` check first.
- **A confident explanation that does not fit what you are seeing.** Today's pass caught
  the replacement message asserting "a server was started outside Jasper" when nothing
  external existed — a new misdirection replacing the old one.
- **A plain green Running on a row while a login fails.** The tree and the login must never
  contradict each other now.
- **The tooltip pointing at the Processes view** for an external server. It should say that
  view cannot see it, not send you there.

## Not covered here

- **macOS.** `ps -Ao` selecting detached daemons is reasoned from flag semantics, not
  tested. And if `ps eww` will not expose a process's environment there, the registration
  directory is unknown, identity stays unconfirmed, and test 3 degrades into test 2 —
  **Restart & Connect never offered**. Run test 3 on a Mac specifically to see which.
- **Windows / WSL.** The path conversion between a Windows database path and the WSL paths
  a server reports is unit-tested both directions but has never been run.
