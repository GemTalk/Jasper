---
paths:
  - "package.json"
  - ".npmrc"
  - "package-lock.json"
---

# npm install-script allowlist

Never unblock a failing install with `--dangerously-allow-all-scripts` or `--ignore-scripts` — that's the control the failure exists to enforce.

Instead, run `npm approve-scripts <pkg>` and actually review the package before approving it. See [docs/how-to/add-a-dependency-with-install-scripts.md](../../docs/how-to/add-a-dependency-with-install-scripts.md) for the bootstrap sequence.
