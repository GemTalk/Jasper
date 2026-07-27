# Jasper Roadmap

This is the public roadmap for Jasper, organized by component (IDE · System Administration · Project & Package Management) and by priority within each component:

- **Now** — actively being worked.
- **Next** — queued behind Now.
- **Later** — intended, but unscheduled.

There are **no dates** — order is priority, and Jasper's near-weekly release cadence carries the schedule. Each entry names a **theme** (the unit of communication), links its **tracking issue** (the unit of work — with a checklist of concrete sub-items and links to related issues), states the user-visible outcome, and notes the tier of gap it closes (**Essential** / **Expected** / **Differentiating**). Discussion belongs on the linked issues; corrections and reprioritizations to this document are welcome as pull requests. Each theme also has a matching [milestone](https://github.com/GemTalk/Jasper/milestones) for tracking execution.

## IDE

### Now

- **[Debugging parity](https://github.com/GemTalk/Jasper/issues/277)** — a full debug session (breakpoints of every kind, stepping, watches, fix-and-continue) becomes dependable, closing out the known debugger bugs. *Essential.*
- **[Browser convergence](https://github.com/GemTalk/Jasper/issues/289)** *(already in flight)* — one shared backend for the System Browser and the GemStone Explorer ([#260](https://github.com/GemTalk/Jasper/issues/260)), dogfooding the Explorer ([#266](https://github.com/GemTalk/Jasper/issues/266)), settling the target browser shape ([#250](https://github.com/GemTalk/Jasper/issues/250)) with filtered searches ([#259](https://github.com/GemTalk/Jasper/issues/259)), and fixing the refresh/Unicode/rendering bugs ([#237](https://github.com/GemTalk/Jasper/issues/237), [#249](https://github.com/GemTalk/Jasper/issues/249), [#235](https://github.com/GemTalk/Jasper/issues/235), [#247](https://github.com/GemTalk/Jasper/issues/247)). *Essential.*

### Next

- **[Transaction awareness](https://github.com/GemTalk/Jasper/issues/278)** — failed commits show which objects conflicted and why; transaction mode is visible and settable; dirty/stale indicators make the session's state obvious. *Essential.*
- **[Code history](https://github.com/GemTalk/Jasper/issues/290)** — method-level versions with display, diff, and edit ([#253](https://github.com/GemTalk/Jasper/issues/253)) plus a class version browser ([#255](https://github.com/GemTalk/Jasper/issues/255)). *Expected.*
- **[LSP completeness](https://github.com/GemTalk/Jasper/issues/291)** — implement Rename Symbol and align the three language modes ([#231](https://github.com/GemTalk/Jasper/issues/231)), fixing the semantic-token mis-highlights ([#241](https://github.com/GemTalk/Jasper/issues/241)). *Expected.*

### Later

- **[Object Log / continuation (post-mortem) debugging](https://github.com/GemTalk/Jasper/issues/292)** — browse the Object Log and debug saved continuations after the fact. *Expected.*
- **[Multi-user awareness](https://github.com/GemTalk/Jasper/issues/293)** — see other sessions' commits, "view is stale", last-changed-by. *Differentiating.*
- **[Code critics / lint](https://github.com/GemTalk/Jasper/issues/294)** — findings surfaced as navigable editor diagnostics. *Expected.*
- **[Refactoring canon completion](https://github.com/GemTalk/Jasper/issues/295)** — add/remove parameter, push up/pull down, safe-delete ([#252](https://github.com/GemTalk/Jasper/issues/252)), plus RB engine version management ([#269](https://github.com/GemTalk/Jasper/issues/269), [#270](https://github.com/GemTalk/Jasper/issues/270), [#267](https://github.com/GemTalk/Jasper/issues/267)) and engine cleanups ([#273](https://github.com/GemTalk/Jasper/issues/273), [#274](https://github.com/GemTalk/Jasper/issues/274)). *Expected.*
- **[Traits support](https://github.com/GemTalk/Jasper/issues/296)** ([#258](https://github.com/GemTalk/Jasper/issues/258)) and **[undoable IDE actions](https://github.com/GemTalk/Jasper/issues/297)** ([#174](https://github.com/GemTalk/Jasper/issues/174)). *Differentiating.*

## System Administration

### Now

- **[Stone-wide session administration](https://github.com/GemTalk/Jasper/issues/279)** — see every session on a stone (user, gem PID, transaction state, commit-record backlog holder) and stop one from Jasper. *Essential.*
- **[Transaction log management & point-in-time restore](https://github.com/GemTalk/Jasper/issues/280)** — completes the recently shipped backup/restore work with tranlog status, archiving, and log replay to a chosen point in time. *Essential.*

### Next

- **[UserProfile & security administration](https://github.com/GemTalk/Jasper/issues/281)** — add users, reset passwords, and adjust privileges and security policies without opening topaz. *Essential.*
- **[Repository GC](https://github.com/GemTalk/Jasper/issues/282)** — markForCollection, reclaim, and epoch GC with progress and reclaim-blocker visibility. *Essential.*
- **[Config viewer/editor & inline process management](https://github.com/GemTalk/Jasper/issues/298)** — round out day-to-day stone care ([#232](https://github.com/GemTalk/Jasper/issues/232), [#234](https://github.com/GemTalk/Jasper/issues/234)), including the temp-obj-space warning ([#230](https://github.com/GemTalk/Jasper/issues/230)) and a one-click Topaz console. *Expected.*

### Later

- **[Statistics & monitoring](https://github.com/GemTalk/Jasper/issues/310)** — statmonitor recording with built-in stats viewing, page-cache/extent monitoring, and audits. *Expected.*
- **[Headless CLI](https://github.com/GemTalk/Jasper/issues/299)** over the same admin operations. *Expected.*
- **[Dashboards/alerting, verified backup automation, container stones](https://github.com/GemTalk/Jasper/issues/300)**. *Differentiating.*

## Project & Package Management

### Now

- **[Rowan reliability](https://github.com/GemTalk/Jasper/issues/301)** — fix the diff ([#264](https://github.com/GemTalk/Jasper/issues/264)) and unload ([#265](https://github.com/GemTalk/Jasper/issues/265)) failure paths. *Essential.*
- **[Reproducible loads](https://github.com/GemTalk/Jasper/issues/283)** — a queryable "what is loaded right now" manifest with git SHAs, and pinned loads from that manifest. *Essential.*

### Next

- **[Rowan audit](https://github.com/GemTalk/Jasper/issues/311)** — verify in-stone code against package metadata from the IDE, and headless for CI. *Expected.*
- **[Package-scoped browsing & structure tooling](https://github.com/GemTalk/Jasper/issues/284)** — packages become a first-class browsing dimension; move classes/methods between packages; run a package's tests in one action. *Expected.*

### Later

- **[CI integration](https://github.com/GemTalk/Jasper/issues/312)** — headless load-and-test into scratch stones with JUnit output. *Expected.*
- **[Metacello & Monticello interop](https://github.com/GemTalk/Jasper/issues/285)** — load community projects (Seaside, GLASS-era code) distributed as baselines or .mcz packages. *Expected.*
- **[Method-level merge UI](https://github.com/GemTalk/Jasper/issues/302)** and **[branch-per-task workflow](https://github.com/GemTalk/Jasper/issues/303)**. *Expected.*

## Cross-cutting

As each theme ships, its operations should also land on the **MCP/AI surface** (session-admin tools, Rowan-audit tools, …) — AI-first GemStone workflows ([#229](https://github.com/GemTalk/Jasper/issues/229)) are Jasper's ongoing differentiator.

## Recently shipped

See [CHANGELOG.md](CHANGELOG.md) — Jasper releases near-weekly. Highlights land there first; when a roadmap theme above ships, it moves into this section with a link to its CHANGELOG entry.
