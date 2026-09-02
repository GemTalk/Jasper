# Download GemStone and create a database

Before you can connect, you need a running **stone** — a GemStone/S 64 database
process. **Quick Setup** does the whole thing for you in one step:

1. Downloads a GemStone/S 64 version (you choose which).
2. Creates a database from it.
3. Starts the stone and its NetLDI.
4. Adds a **DataCurator** login so you can connect right away.

Click **Quick Setup** below to begin. On macOS and Linux, the first time you
start a stone Jasper may need to configure shared memory — it opens a terminal
and prompts for your password before continuing.

## Prefer to do it by hand?

Quick Setup just automates these steps — you can run them yourself:

- **Databases & Versions** panel, Versions section — **Install** a version.
- The same panel — **New Database...** fills in a form against an installed
  version, then **Start Stone**. Creating a database also adds a **DataCurator**
  login for it (just as Quick Setup does), so there's nothing extra to set up
  before connecting.

Either way, once a stone is running, continue to **Connect to a stone**.
