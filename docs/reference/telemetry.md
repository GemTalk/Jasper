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

| Property / measure | Values                                    |
| ------------------ | ----------------------------------------- |
| `activationMs`     | how long activation took, in milliseconds |

## Querying the data

Example: distinct users per country/OS/VS Code version who activated Jasper,
over the retention window:

```kusto
customEvents
| where name endswith "activated"
| summarize users = dcount(tostring(customDimensions["common.vscodemachineid"]))
    by client_CountryOrRegion, tostring(customDimensions["common.os"]), tostring(customDimensions["common.vscodeversion"])
```

## Changing this document

It must match `client/src/telemetry.ts`. Change the two together. A unit test
(`client/src/__tests__/telemetryDocs.test.ts`) fails if an event, property or
measure in the code is missing here.
