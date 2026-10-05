# Telemetry events

What Jasper reports, and when. For what is collected overall, how it is
stored, and how users turn it off, see
[USAGE_DATA.md](../../USAGE_DATA.md).

Events go to Azure Application Insights and are kept for 90 days. Nothing is
sent when a user sets VS Code's `telemetry.telemetryLevel` to `off`.

## On every event

| Property        | Values                                         | Meaning                                                                  |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `extensionMode` | `production`, `development`, `test`, `unknown` | Only `production` is a real user. Filter out the others in every report. |

VS Code adds its own `common.*` properties too (machine id, OS, VS Code
version, extension version). [USAGE_DATA.md](../../USAGE_DATA.md) lists them.

## The events

### `activated`

The extension host finished activating a VS Code window. Sent only when
activation completes; an activation that fails sends nothing.

| Property / measure | Values                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `activationMs`     | how long the extension's synchronous startup took, in milliseconds, not including the language server starting |

### `loginAttempted`

The user connected to GemStone from a login in **Logins & Sessions**. Sent
once per attempt, however it ends. Nothing is sent if no folder is open,
because Jasper refuses to connect before asking for anything.

| Property          | Values                                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gemstoneVersion` | a version such as `3.7.2`, or `unknown`               | The GemStone version set on the login. A two-part version is padded (`3.7` becomes `3.7.0`). `unknown` means the login has no version, or one that doesn't start with numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `outcome`         | `connected`, `failed`, `cancelled`, `noClientLibrary` | `connected`: a session opened, including after Jasper started the stone. `failed`: the login was refused or errored, or the user declined to start the stone. `cancelled`: the user dismissed a password prompt. `noClientLibrary`: Jasper had no usable GemStone client library for that version, and the user did not provide one. They dismissed the download offer or the file picker, rejected a file with the wrong name, or the download failed or was cancelled. On Windows it also covers a login with no version, which Jasper cannot download a client for, and a bundled library built for a different processor than VS Code's (x64 on ARM). |
| `serverLocation`  | `local`, `remote`                                     | `local` when the login's host is this machine (`localhost`, `127.0.0.1`, `::1` or `[::1]`), otherwise `remote`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Two things to keep in mind when reading `gemstoneVersion`:

- It is the version the user configured, not the one the stone reports. A
  login set to the wrong version still reports the configured one.
- Versions below 3.6.2 mostly cannot have a login in Jasper, so they rarely
  show up here. Their absence does not mean nobody uses them.

## Changing this document

It must match `client/src/telemetry.ts`. Change the two together. A unit test
(`client/src/__tests__/telemetryDocs.test.ts`) fails if an event, property or
measure in the code is missing here.
