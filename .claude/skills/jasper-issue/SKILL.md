---
name: jasper-issue
description: Create a Jasper Bug, Enhancement, Documentation, or Question issue on the public GemTalk/Jasper GitHub repo via the gh CLI. Use when the user asks to file/open/report a Jasper issue, log a Jasper bug, or raise a Jasper enhancement — invoked bare or with a phrase describing the problem. Drafts clean of sensitive content by default and runs a hard-blocking validation pass before creating anything (issues are public). Can create several work items in one go. Requires explicit confirmation before creating.
---

# jasper-issue

Files one or more GitHub issues on **GemTalk/Jasper** (public repo) for the Jasper VSCode
extension. Invoked with no input (extract everything from the conversation) or with a
phrase describing the problem (combine phrase + conversation). Ask the user for anything
missing. The user may ask for **several** work items at once — handle them all in one pass.

**This repo is public.** Anything written into an issue — or attached as a screenshot — is
world-readable. Confidentiality is enforced two ways: the agent drafts clean by default
(step 2), and a validation pass hard-gates on explicit approval before anything is created
(step 5).

## Workflow

1. **Classify** each report as **Bug**, **Enhancement**, **Documentation**, or **Question**
   from the context. State your pick and *ask the user to confirm or override* before
   proceeding. Most feature proposals are Enhancements.

2. **Draft clean — self-censor, don't interrogate.** While gathering fields and writing the
   body, never carry the following into the draft even if it's sitting right there in the
   conversation or pulled context:
   - customer names, identifiers, or any customer reference
   - customer data or records
   - stone / host / server names
   - connection strings
   - credentials, passwords, tokens, API keys, license keys
   - internal-only URLs
   - personal or employee data

   Generalize instead (a real customer name → `<customer>` or "a customer's"; a specific
   host → `<stone host>`). Do this silently as part of drafting — do not stop and ask the
   user about it here. The **only** time to interrupt the user during drafting is when the
   report cannot be made to make sense without a concrete reference to one of the items
   above (e.g. the bug is inherently about a specific customer's data shape); in that case,
   ask how they'd like it generalized or whether to include it anyway, but default to
   pushing for generalization.

3. **Gather the fields** per the matching template below. Pull what you can from the
   conversation/phrase; ask only for what's genuinely missing.

   Grounding the ticket in the actual Jasper source (this repo's root) makes titles and
   implementation notes reference concrete files/mechanisms — useful for both enhancements
   and bugs. But a code scan costs time, so **ask the user whether it's worth scanning the
   source first** — unless they already asked for it (or clearly want that depth), in which
   case just do it. Reference source locations relative to the repo root, not an absolute
   path.

4. **Resolve labels live** (names drift — never hardcode):
   ```bash
   gh label list --repo GemTalk/Jasper
   ```
   Apply two labels:
   - **Type:** `bug` / `enhancement` / `documentation` / `question`, from step 1.
   - **Component:** infer the best of `ide` / `package-management` / `sysadmin` from
     context (default guess is usually `ide`), state the pick, and ask the user to
     confirm/override — same pattern as the type classification.

   Do **not** apply any status/roadmap label (`not ready` / `now` / `next` / `later` /
   `roadmap`) — those are maintainer-managed triage labels, not something a contributor
   sets. Match against the live label list by keyword and use the exact returned strings in
   `-l`.

5. **Present the draft(s)** as a temp markdown file in the scratchpad (one file covering all
   candidate tickets — title, labels, rendered body). Give the user the path so they can
   tweak wording/scope manually, and get **explicit confirmation** before creating anything.

   **Validation pass (hard-block).** After the user confirms, re-read the file (they may have
   edited it) and re-scan it against the step-2 list — the user's own edits are exactly what
   this pass exists to catch. If nothing is found, proceed to creation. If anything is found,
   **stop and do not create**: list each suspected item with its location in the draft, and
   require the user's **explicit approval** ("yes, include it" / a redaction) before
   proceeding — a generic re-confirmation of the whole draft is not enough, they must address
   each flagged item.

   **Screenshot recommendation.** While presenting each draft, judge whether a screenshot
   would materially strengthen the issue — most valuable for UI/`ide` bugs (error states,
   misrendered views, unexpected editor behavior), sometimes useful for enhancements/docs,
   rarely useful for `question` or pure server-side issues. When it would help, **name the
   specific shot(s) to capture** (e.g. "the diagnostics panel showing the error",
   "before/after of the tree view") so the user can grab them while context is fresh. Remind
   them **screenshots must be added by hand** after creation — `gh` can't attach images — and
   that the same confidentiality rule applies to images: no customer data, host names, or
   secrets visible in the capture.

6. **Create each** with `gh` (write each body to its own scratchpad file to preserve
   newlines):
   ```bash
   gh issue create --repo GemTalk/Jasper \
     -t "<title>" \
     -l "enhancement" -l "ide" \
     -F "<scratchpad>/body1.md"
   ```
   No `--yes` needed — the user already confirmed in step 5. Use one `-l` flag per label.

7. **Report a summary.** Plain markdown. List each created
   issue as a normal markdown link using the URL `gh` returns:
   ```
   - [#123](https://github.com/GemTalk/Jasper/issues/123) — <title>
   ```
   For any issue flagged in step 5 as benefiting from a screenshot, **restate that reminder
   here with the live issue URL**, formatted to stand out from the rest of the summary (e.g.
   a leading 📸 emoji and its own line/blockquote — not folded into a plain sentence), so it
   doesn't get missed once the user is done skimming the created-issues list. Say the user
   needs to open the issue and attach the image by hand (drag into the GitHub comment box).
   Repeat the sanitization caveat: no sensitive content visible in the shot.

## Body templates

Pick by type. Keep bodies lean — only include sections that carry real information.

**Agent note on implementation-notes/potential-fix/suggested-change sections (all types):**
word it as *possibilities*, not prescriptions. The user does not necessarily know how a
given thing should be solved, so write "one approach could be…", "potentially…", "a possible
direction…" rather than "do X" / "add Y". Only state a solution as settled if the user
explicitly framed it that way. (Do not add an in-ticket disclaimer — just keep the prose
tentative.)

### Enhancement (feature proposal)

No version/environment block: these target the latest Jasper and propose something not yet
supported, so versions add nothing. Don't use "Steps to reproduce" or "Actual vs expected"
framing — nothing is being reproduced. Lead with the intent, then acceptance criteria.

```markdown
## Summary
<one or two sentences: what the feature is and why it helps>

## Acceptance criteria
- <observable behavior 1>
- <observable behavior 2>

## Implementation notes
<optional — only when there's concrete technical context worth recording
(specific files, existing queries/URIs, a sketch of the wiring)>
```

Drop `## Acceptance criteria` if the Summary already fully pins the behavior, and drop
`## Implementation notes` when you have nothing concrete.

### Bug

```markdown
## Summary
<one or two sentences>

## Environment
- **Jasper:** <version — read "version" from the repo root's package.json;
  fallback: git describe --tags (run from the repo root); else ask. Always include.>
- **GemStone server:** <version | N/A>
  (include only if relevant — anything touching server/GCI/stone behavior; mark N/A for
  pure-UI/editor bugs. If relevant and unknown, ask or query a connected stone via the
  `jasper:status` MCP tool.)

## Steps to reproduce
1. <step>
2. <step>

## Expected behavior
<what should happen>

## Actual behavior
<what happens instead>

## Potential fix
<optional — only if you have a concrete idea>
```

### Documentation

```markdown
## Summary
<what's wrong, missing, or unclear>

## Where
<doc file/page or feature area>

## Suggested change
<optional — only if you have a concrete idea>
```

### Question

```markdown
## Question
<the question, stated plainly>

## Context
<optional — what was tried, or where this came up>
```

No environment/repro framing for Documentation or Question issues.

## Reference

- Project: `GemTalk/Jasper` on github.com (public repo, issues enabled). Always pass
  `--repo GemTalk/Jasper`.
- Current labels (resolve live via `gh label list --repo GemTalk/Jasper`; this is orientation
  only, not a source of truth):
  - types: `bug`, `enhancement`, `documentation`, `question`
  - components: `ide`, `package-management`, `sysadmin`
  - status/roadmap (maintainer-managed — this skill never applies these): `not ready`,
    `now`, `next`, `later`, `roadmap`
