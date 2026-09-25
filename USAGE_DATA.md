# Usage data

This notice covers only the Jasper extension (`gemtalksystems.gemstone-ide`).
It does not cover any other GemTalk product.

**Data controller:** GemTalk Systems LLC - **Contact:** <info@gemdb.com>

## What we collect

Jasper sends a single usage event, `activated`, when the extension starts up,
so we can count how many installations use it, on which operating systems and
VS Code versions, and in which regions. It
carries only non-identifying, extension-level information — never the
contents of your work (see "What we do not collect" below).
[docs/reference/telemetry.md](docs/reference/telemetry.md) lists the event
and what each of its properties and measures can say.

VS Code automatically attaches its own common properties to every event:
`common.extname`, `common.extversion`, `common.vscodemachineid`,
`common.vscodesessionid`, `common.vscodecommithash`, `common.vscodeversion`,
`common.vscodereleasedate`, `common.os`, `common.platformversion`,
`common.nodeArch`, `common.product`, `common.uikind`, `common.remotename`,
`common.isnewappinstall`, `common.sqmid`, `common.devDeviceId`,
`common.telemetryclientversion`.

Jasper adds one property of its own to every event:

- `extensionMode`, which is `production` for an installed extension and
  `development` or `test` when a Jasper developer is running it from source.

`common.vscodemachineid` is a pseudonymous identifier VS Code generates per
installation. It is not tied to your name or email, but under GDPR it counts
as an online identifier, which is why this notice exists.

**Approximate location.** Azure derives a coarse location — city, state or
province, and country — from the IP address your events arrive from, and
stores those three fields alongside each event. Your IP address itself is
**not** stored: Azure masks it to `0.0.0.0` before the event is written. We
do not use the location to identify anyone; it tells us which regions Jasper
is used in.

## What we do not collect

File paths, file names, Smalltalk source code, method bodies, class names,
query text, database contents, GemStone session or cache names, usernames,
email addresses, environment variables, error messages, or exception text, or
your IP address (see "Approximate location" above for what Azure derives from
it before discarding it).

## Why we collect it

To understand, in aggregate, how many people use Jasper, on which operating
systems and VS Code versions, and in which regions. That lets us prioritize fixes and
improvements. We do not use it to see what any individual does with their
code (see "What we do not collect"), and it is never used for advertising or
profiling. This relies on legitimate interest (GDPR Art. 6(1)(f)).

## How it is transmitted and stored

Events go over TLS to Azure Application Insights / Azure Monitor, to a
separate Application Insights resource from GemDB's own, in the same Log
Analytics workspace, in an Azure subscription owned by GemTalk. They are
stored in the **West US 2** region (United States) and are **retained for 90
days**, after which Azure deletes them.

## Disclosure

Microsoft/Azure processes this data as our infrastructure provider. We do
not sell it, use it for advertising, or share it with any other third party.

## Your controls

Jasper honours VS Code's `telemetry.telemetryLevel` setting via
`vscode.env.createTelemetryLogger`:

- `off` — no telemetry is sent.
- `crash` / `error` — only events containing an error are sent. Jasper's
  `activated` event does not contain an error, so nothing is sent at either
  of these levels.
- `all` — the usage event described above is sent.

## Accessing or deleting your data

Events are keyed only by `common.vscodemachineid`, so we cannot look up or
delete data for you without that value. To find yours, run **Help: About**
in VS Code's Command Palette, or check the `machineId` field on
`vscode.env`. If you send it to the contact address above, we will locate
and delete the matching records.

## Changes

Last updated: 2026-09-24. Changes to this notice will be published in this
repository.
