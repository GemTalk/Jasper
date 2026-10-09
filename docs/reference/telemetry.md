# Telemetry events

What Jasper reports, and when. For what is collected overall, how it is
stored, and how users turn it off, see
[USAGE_DATA.md](../../USAGE_DATA.md).

Events go to Azure Application Insights and are kept for 90 days. Nothing is
sent when a user sets VS Code's `telemetry.telemetryLevel` to `off`.

## On every event

| Property        | Values                                                                             | Meaning                                                                  |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `extensionMode` | `production`, `development`, `test`, `unknown`                                     | Only `production` is a real user. Filter out the others in every report. |
| `appUriScheme`  | e.g. `vscode`, `vscode-insiders`, `cursor`, `windsurf`, or `unknown`               | Which editor app Jasper runs in, as a short id.                          |
| `appName`       | e.g. `Visual Studio Code`, `Visual Studio Code - Insiders`, `Cursor`, or `unknown` | Which editor app Jasper runs in, as the app names itself.                |

`appUriScheme` and `appName` tell VS Code apart from its forks. A fork such as
Cursor or Windsurf reports the VS Code version it is built on as
`common.vscodeversion`, so without these an old VS Code and a fork look the
same. Values are sent as the app reports them. `unknown` means the app reported
nothing. Events from Jasper versions before these properties were added have no
value at all.

In a remote window (Dev Container, SSH, WSL), both describe the app on the
user's desktop, not the remote machine, so a remote window reports the same
values as a local one. `common.remotename` says whether the window was remote.
When the editor runs in a web browser, as on github.dev, they describe that web
version of the app instead.

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

The user connected to GemStone from a login, in **Logins & Sessions** or the
**Databases & Versions** panel. Sent once per attempt, however it ends.
Nothing is sent if no folder is open, because Jasper refuses to connect before
asking for anything, or for a repeat click on a login that is already
connecting (or finished under a second ago), which Jasper ignores.

| Property          | Values                                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gemstoneVersion` | a version such as `3.7.2` or `3.7.1.4`, or `unknown`  | The GemStone version set on the login, ignoring surrounding spaces. A two-part version is padded (`3.7` becomes `3.7.0`); three- and four-part versions are kept as they are. `unknown` means the login has no version, or one that doesn't start with numbers.                                                                                                                                                                                                                                                                                                                                                                                           |
| `outcome`         | `connected`, `failed`, `cancelled`, `noClientLibrary` | `connected`: a session opened, including after Jasper started the stone. `failed`: the login was refused or errored, or the user declined to start the stone. `cancelled`: the user dismissed a password prompt. `noClientLibrary`: Jasper had no usable GemStone client library for that version, and the user did not provide one. They dismissed the download offer or the file picker, rejected a file with the wrong name, or the download failed or was cancelled. On Windows it also covers a login with no version, which Jasper cannot download a client for, and a bundled library built for a different processor than VS Code's (x64 on ARM). |
| `serverLocation`  | `local`, `remote`                                     | `local` when the login's host names this machine — `localhost`, any `127.x.x.x` address (also written as `::ffff:127.x.x.x`), `::1` in any form, `0.0.0.0`, the machine's hostname, an address on one of its network interfaces, or the address of the WSL VM Jasper last detected (a stone in WSL under NAT networking), ignoring case, surrounding spaces and IPv6 brackets — otherwise `remote`. Names are not resolved through DNS, so an alias that points back at this machine counts as `remote`. Before Jasper has detected WSL's address, such a stone counts as `remote`.                                                                       |

Two things to keep in mind when reading `gemstoneVersion`:

- It is the version the user configured, not the one the stone reports. A
  login set to the wrong version still reports the configured one.
- Versions below 3.6.2 mostly cannot have a login in Jasper, so they rarely
  show up here. Their absence does not mean nobody uses them.

## Changing this document

It must match `client/src/telemetry.ts`. Change the two together. A unit test
(`client/src/__tests__/telemetryDocs.test.ts`) fails if an event, property or
measure in the code is missing here.
