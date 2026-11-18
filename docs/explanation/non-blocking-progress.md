# Non-blocking GemStone calls: progress since the hand-off

[Non-blocking GemStone calls](non-blocking-gemstone-calls.md) is the hand-off of this work as it
stood on 2026-11-13, kept as written at
[`48f11032`](https://github.com/GemTalk/Jasper/blob/48f1103213c44a5edede4cfc7d15c60bb79df3c2/docs/explanation/non-blocking-gemstone-calls.md).
Read it first: its design principles, contention categories and verified GCI facts still apply.
This page records what has moved since; read its "Where it stands" and "Remaining work" together
with the tables below.

## Already non-blocking at the hand-off

Copied from the hand-off's
[Where it stands](non-blocking-gemstone-calls.md#where-it-stands), which also lists the supporting
work on `main`.

| Feature                                                 | PR               |
| ------------------------------------------------------- | ---------------- |
| Search Method Source / Browse Methods Containing…       | #827             |
| Expanding a class row in the Explorer                   | #855             |
| Clicking a class or dictionary in the Explorer          | #864, #877, #908 |
| Opening method, class definition and class comment tabs | #918             |

## Made non-blocking since the hand-off

| Feature                                                           | Category | PR   |
| ----------------------------------------------------------------- | -------- | ---- |
| VS Code's Find All References on a selector in a Smalltalk editor | E        | #940 |
| The **Class Hierarchy** command, once a class is picked           | E        | #940 |

## Still blocking, though it looks done

The senders and references searches behind these still freeze Jasper. #940 does not change them,
although they could reuse its `sendersOfAsync` and `sweepEnvironmentsAsync`.
Most other GemStone calls still block too; the hand-off's
[Where it stands](non-blocking-gemstone-calls.md#where-it-stands) lists them under "Still blocking".

| Feature                                                                         | Code                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GemStone Search (Omni Search): references to a class, and senders of a selector | `omniSearch/omniSearchCommand.ts`, `resolveReferencesUsing` |
| The **Senders of…** command                                                     | `extension.ts`, `gemstone.sendersOf`                        |
| Senders of a method in the GemStone Explorer                                    | `gemstoneExplorer.ts`                                       |
| Sender and implementor counts in hover and CodeLens                             | `gemstoneHoverProvider.ts`, `gemstoneCodeLensProvider.ts`   |

## Remaining work

The hand-off's "Remaining work" list, by its own numbers. Items not listed have not started.

| Item | Work                                                                   | PR   |
| ---- | ---------------------------------------------------------------------- | ---- |
| 2    | More E and D features (VS Code's Find All References, Class Hierarchy) | #940 |

## Open issues fixed since the hand-off

From the hand-off's "Open issues from this work" list.

| Issue | Fix                                                                                          | PR   |
| ----- | -------------------------------------------------------------------------------------------- | ---- |
| #933  | Closing a debugger while another run holds the session clears its process once that run ends | #956 |
