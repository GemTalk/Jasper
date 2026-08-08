---
paths:
  - "package.json"
  - "client/package.json"
  - "tsconfig.base.json"
  - "esbuild.mjs"
  - ".github/workflows/health-check.yml"
  - ".nvmrc"
---

# VS Code / Node version pins

These paths together encode one coordinated VS Code/Node/TypeScript version floor — not independent knobs. Never change one in isolation. Read [docs/how-to/raising-the-version-floor.md](../../docs/how-to/raising-the-version-floor.md) for the full coordinated-file list and the TypeScript devDependency note before touching any of them.
