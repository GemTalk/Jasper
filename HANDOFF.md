# Handoff — issue #472, servers started outside Jasper's environment

Parked **2026-08-24** to go work on PR #476's reviewer comments. Nothing is in flight;
nothing is half-finished. Resume by reading this file and picking up *Open decisions*.

- **Worktree:** `/export/uffda1/users/ewinger/worktrees/issue472-external-servers`
- **Branch:** `eric/issue472-external-servers` — pushed, in sync with GitHub
- **PR:** [#480](https://github.com/GemTalk/Jasper/pull/480) — **draft**, assigned to
  MatiasFernandez, closes #472
- **Issue:** https://github.com/GemTalk/Jasper/issues/472

## What the change is

Jasper runs its own `gslist` against the root it manages, and a GemStone server
registers in the `locks/` directory of whatever `GEMSTONE_GLOBAL_DIR` it was started
with. A stone started by hand — from a shell whose GemStone environment differs from
Jasper's — registers somewhere Jasper does not look, so `gslist` reported it *Stopped*
while the process was alive. Jasper then offered to start it and collided with it, and
sometimes relayed a raw `GEMSTONE environment variable is not defined` that sent users
off debugging a shell profile that was fine.

Now: cross-check the host process table against Jasper's own `gslist`, mark such a
server **Running outside Jasper**, and offer to stop it and restart it under Jasper's
environment. Identity is settled by the conf/log paths the process was started with —
unconfirmed means Jasper does not touch it.

## Commits (3, on top of `origin/main` at `427cec73`)

| SHA | What |
|---|---|
| `a1d52af4` | The feature: detection, tree states, reconcile flow, message fixes |
| `9722cb3c` | Integration test against a live stone, WSL coverage, PID identity check |
| `e437d50b` | Fixes from the other session's review (see below) |

## Verified

- `npm run lint && npm run format:check && npm run compile && npm test` — all clean,
  **6,580 tests**.
- **Use `npm test`, not bare `npx vitest run`.** The latter also runs
  `src/__tests__/gci/**`, an on-demand project that never runs in CI and fails ~30 tests
  against a shared stone. I lost time to that; it is not a regression.
- The detection was dry-run against genuinely external servers on this machine (db-2,
  started by hand with `GEMSTONE_GLOBAL_DIR=/tmp/gemstone-outside`): both found, both
  `confirmed`, registration directory read correctly. Cleaned up afterwards.

## The review that already happened

A second Claude session reviewed commits 1–2 and filed findings at
`.claude/issue472-external-servers-review-findings-2026-08-21.md` (still in the
worktree). All HIGH/MED/LOW/TEST findings were addressed in `e437d50b`. The three that
mattered:

1. **An unreadable `gslist` made every live server look external, confirmed, and
   killable** — including servers Jasper started itself. Fixed with a `gslistReadable`
   flag plus a backstop that a server registered in Jasper's own root is not outside it.
2. **`ps -eo` is Linux-only.** On Darwin `-e` means "also show the environment", not "all
   processes", so the feature would have been silently inert on every Mac. Now `-A`.
3. **A force-killed external server left its lock behind.** Now cleared when identity is
   confirmed and the directory is known.

## Open decisions

1. **`EXTERNAL-SERVERS-UI-TEST-PLAN.md` is untracked.** Commit it to the branch, or keep
   it local the way `SAFE-DELETE-TEST-PLAN.md` was? It is the only artifact of this work
   not on GitHub. Safe where it is (durable storage, not `/tmp`), but not backed up.
2. **The PR is a draft** because the UI has never been clicked through. Marking it ready
   is a judgement call about whether that has to happen first.

## What is genuinely not done

- **Nobody has looked at the UI.** Every branch of the reconcile flow is unit-tested, but
  the row labels, icons, tooltips, dialog and its button set have never been seen in a
  real editor window. `EXTERNAL-SERVERS-UI-TEST-PLAN.md` exists precisely for this — 8
  scenarios, and Scenario A's setup and the cleanup are already proven to work verbatim.
- **macOS, two unknowns.** (a) `ps -Ao` selecting detached daemons is reasoned from flag
  semantics, not tested. (b) macOS may not let `ps eww` read another process's
  environment at all; if so the registration directory is always unknown there, identity
  stays unconfirmed, and **Restart & Connect** is never offered — only *Connect as-is*.
  Detection itself still works. The integration test fails loudly on a Mac rather than
  degrading quietly, which is what we want.
- **Windows/WSL** path conversion is unit-tested both directions but never run.

## To resume

```bash
cd /export/uffda1/users/ewinger/worktrees/issue472-external-servers
git fetch origin main && git log --oneline HEAD..origin/main   # has main moved?
npm test                                                       # expect ~6580 passing
```

Then either work Scenario A of the test plan in an F5 window, or take the PR out of
draft if the UI pass is not a gate.

---

## Next up, in a different session

PR [#476](https://github.com/GemTalk/Jasper/pull/476) — "Safe delete: check what still
references a method, class or variable before removing it", branch
`eric/issue433-safe-delete`, 9 reviews to work through. Different worktree:
`/export/uffda1/users/ewinger/worktrees/issue433-safe-delete`. Start that session
**there**, not here.
