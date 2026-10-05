---
paths:
  - 'client/src/telemetry.ts'
  - 'docs/reference/telemetry.md'
  - 'USAGE_DATA.md'
---

# Telemetry docs

Two documents describe `client/src/telemetry.ts` to people who never read it:

- `docs/reference/telemetry.md` — every event, when it fires, how often, and
  what each property and measure means. Written for a product owner reading
  the data.
- `USAGE_DATA.md` — the privacy notice users see. It names categories, not
  events.

A change to any event, property or measure updates `docs/reference/telemetry.md`
in the same commit. `client/src/__tests__/telemetryDocs.test.ts` catches a
missing name; it cannot catch a changed meaning or cadence, so check the
prose by hand.

A change to what kind of data is collected — a new category of data, a new
common property, a change to storage or retention — also updates
`USAGE_DATA.md` and moves its "Last updated" date. A new event of an
existing kind does not need it.

Keep `docs/reference/telemetry.md` plain: no function names, no internals.
Say what the user did, not which code path ran.
