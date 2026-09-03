# Jasper — A Visual Studio Code Extension for a GemStone Smalltalk IDE

A full-featured GemStone/S 64 Bit development environment for Visual Studio Code. Write, browse, debug, and test GemStone Smalltalk code — and manage your GemStone infrastructure — all from a single editor.

Install from either marketplace:

- **VS Code Marketplace:** https://marketplace.visualstudio.com/items?itemName=GemTalkSystems.gemstone-ide
- **Open VSX** (VSCodium, Gitpod, code-server, etc.): https://open-vsx.org/extension/gemtalksystems/gemstone-ide

Jasper works on **macOS**, **Linux**, and **Windows**:

| Platform | Server management | Client IDE (connect to remote GemStone) |
|----------|-------------------|-----------------------------------------|
| macOS    | Yes               | Yes                                     |
| Linux    | Yes               | Yes                                     |
| Windows (with WSL) | Yes (via WSL) | Yes                              |
| Windows (no WSL)   | No            | Yes                              |

## Getting Started

### Connecting to an existing GemStone server (any platform)

If you already have a GemStone server running on another machine (or locally), you only need a login configuration and the native GCI client library for your version of GemStone.

1. Install the extension from the VS Code Marketplace or Open VSX (links above).
2. Open the **GemStone** sidebar (gem icon in the activity bar).
3. In **Logins & Sessions**, click **Add a Login** to open the login editor.
4. Fill in the connection details, top to bottom: GemStone version, gem host, stone name, NetLDI (service name or port), and your GemStone user/password. **Host User** and **Host Password** are optional — supply them only when the remote NetLDI requires host authentication; leave them blank for a local stone or a guest-mode NetLDI. (Stuck? Click **Help me login** in the login editor for per-field guidance.)
5. Click **Save**, then click the saved login to connect. A "Connecting…" notification reports success or failure, and the status bar (bottom right) shows the active session — or turns red, click-to-explain, if the connection fails.

The first time you log in with a given GemStone version, Jasper needs the native GCI library (`libgcits`) for that version:

- **On Windows**, Jasper will offer to **download the Windows client distribution** automatically. This downloads and extracts the library — no WSL or manual setup required.
- **On macOS/Linux**, the library is included in the GemStone server distribution. If you have a local installation, Jasper auto-detects it. Otherwise, use **Install Version…** in the Databases & Versions panel to download the distribution for your platform, or point Jasper to an existing library path via the `gemstone.gciLibraries` setting.

### Full local setup (macOS, Linux, or Windows with WSL)

To install, manage, and run a GemStone server locally:

1. Install the extension from the VS Code Marketplace or Open VSX (links above).
2. Open the **GemStone** sidebar (gem icon in the activity bar).
3. Check the **OS Configuration** section: on macOS/Linux run the shared-memory setup if it warns; on Windows+WSL Jasper also surfaces WSL networking and services-file configuration here.
4. Click **Manage Databases & Versions** in the **Databases** section title bar to open the panel, and install a GemStone release from its Versions list.
5. Click **New Database** in the same title bar and fill in the form.
6. Start the stone and NetLDI from the database tree.
7. Click **Create Login** on the database to generate a login configuration.
8. Click **Login** to connect and start developing.

Alternatively, run **Quick Setup** (offered in the Databases section when you have no database yet) to do all of the above in one step.

## Windows usage

Jasper runs on Windows in two modes: as a client-only IDE talking to a remote GemStone server, or as a full local server manager backed by WSL. The full Windows/WSL guide — picking a networking mode, writing the hosts file, naming the NetLDI port, the works — lives in **[docs/windows-wsl.md](docs/windows-wsl.md)**.

## Infrastructure Management

Manage your GemStone installation directly from VS Code (macOS, Linux, or Windows with WSL).

### OS Configuration

The **OS Configuration** view surfaces every host-level setting GemStone needs, with one-click actions where possible:

- **Shared memory** — checks `sysctl` on macOS, Linux, and WSL, and warns if `shmmax`/`shmall` are below 1 GB. The setup script applies the change immediately and persists it (a `LaunchDaemon` plist on macOS, `/etc/sysctl.d/60-gemstone.conf` on Linux/WSL).
- **RemoveIPC (Linux/WSL)** — verifies that `/etc/systemd/logind.conf` sets `RemoveIPC=no`, so logging out of the session that started the stone doesn't destroy its shared memory segment.
- **WSL networking (Windows only)** — mirrored vs. NAT detection with an action to enable mirrored mode (see _Reaching WSL from Windows_ above).
- **Services (Windows only)** — detects the `gs64ldi 50377/tcp` entry on both sides and offers write actions.
- **WSL distro version (Windows only)** — warns if the default distro is on WSL 1 and provides an **Upgrade to WSL 2** action.

### Version Management

Versions live in the **Databases & Versions** panel, opened with **Manage Databases & Versions** in the **Databases** section title bar. Releases on this machine are listed with their status, size and release date, and each row offers:

- **Install** — downloads the release archive from GemTalk Systems and unpacks it in one action (automatic DMG mounting on macOS, unzip on Linux). **Remove** takes away everything it put there.
- **Show in Finder** — open the product directory
- **Open Terminal** — a terminal with that version's GemStone environment set up

The panel header carries **Install Version…**, which lists the releases you do not yet have. A release you already have elsewhere needs no button: put the product tree (or a symlink to it) in your GemStone root and it is listed like any other, and a stone that already runs from such a tree is brought in with **Register Existing…** instead, which records where it really lives.

On Windows, an **Install Windows Client** row action fetches the native client distribution for connecting to remote GemStone servers.

### Database Management

The **Databases** view shows all databases under your GemStone root directory (configurable via `gemstone.rootPath`, default `~/Documents/GemStone`). Click **New Database** in its title bar to open the **Databases & Versions** panel on a form asking for the GemStone release, the base extent, a stone name and a NetLDI name — all on screen at once, with the names already in use listed beside the fields that have to avoid them. Nothing is lost if you leave VS Code to look something up. A database is made by copying an installed release, so on a machine that has none the panel opens on the lists instead and says so, with **Install Version…** waiting in the Versions section below. You do not need one to adopt a database that already exists: **Register Existing…** in the panel header works on a machine with nothing installed.

The extension creates the full directory structure (`conf/`, `data/`, `log/`, `stat/`), writes configuration files (`system.conf`, `gem.conf`, stone config), copies the key file and base extent, and writes `database.yaml`.

A database that already exists — someone else's stone, or one from another checkout — is added with **Register Existing…** in the same panel instead. It asks for the installation's product directory, reads the GemStone release from that tree's own `version.txt`, and takes the stone and NetLDI names its servers were started under (plus the NetLDI's port, which is what a login for it addresses: a NetLDI name only resolves through `/etc/services`). A registered database lists, starts, stops and gets a login like any other, but Jasper writes nothing inside the installation — only a `database.yaml` in its own directory — so **Delete Database** is disabled on it and **Unregister Database** removes just Jasper's record.

Each database node expands to show:

- **Stone** — status with start/stop buttons
- **NetLDI** — status with port number and start/stop buttons
- **Logs** — expandable list of log files (click to open in editor)
- **Config** — expandable list of configuration files (click to open in editor)

Inline buttons on each database provide:

- **Start** / **Stop** — bring the database's Stone and NetLDI up or down together, in one click; a running database offers Stop and a stopped one Start. It leaves alone whichever of the two is already in the state you asked for, so it can also finish a half-started database, and it stops if the stone does not change state — cancelling the stone's password prompt cancels the whole thing rather than taking the NetLDI down anyway. Not offered when one of the servers is **Running outside Jasper** (see below) — Jasper cannot stop that server, and starting the other half beside it would only collide with it. Also in the Command Palette as **GemStone Admin: Start Database** / **Stop Database**, which asks which database.
- **Reveal in Finder** — open the database directory
- **Open Terminal** — launch a terminal with all GemStone environment variables pre-configured
- **Create Login** — generate a login pre-filled with the database's connection details
- **Replace Extent** — replace the stopped stone's extent with a fresh base extent (deletes old extent and transaction logs)
- **Delete** — remove the database directory (requires stone and NetLDI to be stopped)

#### Server status

A stone or NetLDI row shows one of:

- **Running** — Jasper can see it and a connect should succeed.
- **Stopped** — nothing of it is running.
- **Running — not responding** — `gslist` lists it but reports it unhealthy; it may be holding a stale lock, which its row in the Databases & Versions panel offers to clear.
- **Running — not connectable** (stone only) — the stone is healthy, but a login has to come in through its NetLDI and that NetLDI is not usable, so a connect will fail.
- **Running outside Jasper** — the process is alive on this host but was started outside Jasper's environment. See below.

Only plain **Running** means a connect is expected to work; the others say why it will not, rather than showing a healthy status that a failing login then contradicts.

#### Servers started outside Jasper

Jasper runs its own `gslist` against the root it manages, and GemStone servers register in the `locks/` directory of whatever `GEMSTONE_GLOBAL_DIR` they were started with. A stone or NetLDI started by hand — from a shell whose GemStone environment differs from Jasper's — therefore registers somewhere Jasper does not look, and `gslist` alone would report it as *Stopped* while the process is plainly alive.

Jasper cross-checks the host process table against its own `gslist` and marks such a server **Running outside Jasper**, with its PID and registration directory in the row's tooltip. Connecting to that database — or the row's **Restart Under Jasper's Environment** action — offers to stop the external servers and start them again under Jasper's environment, so they land in the directory Jasper manages. The prompt warns that restarting the stone drops any uncommitted sessions, and offers **Connect as-is** if you would rather leave the running servers alone.

Because two databases can use the same stone name, Jasper stops a server only when it can confirm from the paths that server was started with that it really is the managed database's. When it cannot, it says so and does not offer the restart. If a stop or kill fails, Jasper reports both names, the PIDs, the registration directory, and the `gslist` invocation that will show the servers where they actually are, so the situation can be finished by hand.

### Processes

A database's own stone and NetLDI are shown on its row in the **Databases & Versions** panel, with version, PID, port and status, and Start/Stop for each.

Stale processes — where `gslist` reports a `frozen`, `killed`, or `exe deleted` status — are marked, and a **Delete Stale Lock File** action lets you remove the orphaned `*.LCK` after Jasper confirms the recorded PID is either gone or has been reused by an unrelated process. (On macOS, `gslist -c` can't detect a recycled PID on its own, so this manual step is sometimes necessary; see [docs/mcp-server.md](docs/mcp-server.md#limitations) for context.)

A server started outside Jasper's environment does not appear in Jasper's own `gslist` at all; it shows on its database's row as **Running outside Jasper** (see [Servers started outside Jasper](#servers-started-outside-jasper) above), which is also where **Restart Under Jasper's Environment** is offered.

### MCP Server view

The **MCP Server** view shows which Jasper window is currently serving MCP tool calls, the active session it's bound to, the socket path, and the HTTPS URL when available. Click **Socket:** or **HTTPS:** to copy the value to the clipboard. See the [MCP Server design doc](docs/mcp-server.md) for the full picture.

## IDE Features

### Logins & Sessions

The **Logins & Sessions** view stores connection configurations for your GemStone databases and shows the live sessions started from each one. Each login specifies:

- GemStone version and GCI library path
- Host, stone name, and NetLDI
- GemStone and host credentials
- Optional per-login export path template

Each login is a row in the tree; click **Login** to start a session, which appears as a child beneath it. A login with no children is idle; a login with children is connected — so the tree itself shows what's running.

**Login rows** offer Edit, Duplicate, Delete, and Login. A login **cannot be edited or deleted while it has an active session** — log out first. **Session rows** (the children) offer:

- **Commit** / **Abort** — transaction control
- **Session Configuration** (gear) — open this session's stone and gem configuration in its own editor tab, where the runtime-settable values can be changed
- **Logout** — disconnect
- **Export** and **Make Active Session** (context menu)

**Open Workspace** is in this view's title bar rather than on a session row: a workspace runs against the *active* session (as Display It and Inspect It do), so it is not something you do "to" one session in particular. **Ping** lives on a session row in the **Databases & Versions** panel, which has the room to show its answer beside the row that asked.

The active session (used for code execution) is highlighted, and the status bar shows which session is active.

#### Single vs. multiple sessions

By default Jasper runs in **single-session mode**: each login may have at most one session at a time. This keeps a simpler mental model — there is one session, so the active session, the GemStone Explorer, and any open workspace can never point at different sessions.

If you need concurrent connections, enable the **beta** multiple-session mode:

```jsonc
// settings.json
"gemstone.sessionMode": "multiple"
```

The only difference is cardinality: a login may now have several session children, and its **Login** action stays available while connected so you can start more.

> **Note:** In multiple-session mode, an open workspace/editor stays bound to the session that opened it even after you switch the active session, so the active session, the Explorer, and an open editor can point at different sessions at once. If you use a custom `gemstone.exportPath`, include the `{session}` variable so concurrent sessions don't overwrite each other's exported files.

> **Breakpoints follow the editor, not the active session.** Because an editor stays bound to the session that opened it, a breakpoint set in that editor is armed in that session's gem — so it stops the code you are looking at rather than the session that happens to be selected. **Enable All**, **Disable All** and **Remove All Breakpoints** go the other way and sweep *every* logged-in session, because VS Code keeps a single breakpoint list for the whole window. See [Breakpoints](#breakpoints).

### Code Execution

With an active session, execute Smalltalk code from any editor:

| Command | macOS | Windows/Linux | Description |
|---------|-------|---------------|-------------|
| Display It | Cmd+K D | Ctrl+K D | Evaluate selection and show the result inline |
| Execute It | Cmd+K E | Ctrl+K E | Evaluate selection silently |
| Inspect It | Cmd+K I | Ctrl+K I | Evaluate selection and show result in Inspector |

By default, **Display It** shows its result as a non-destructive inline overlay — an annotation that is not part of the document, so the file is never modified. Hover the result for **Copy** and **Expand** actions; **Enter** inserts the full result into the document, **Backspace** or **Escape** dismisses it. Set `gemstone.displayItMode` to `"insert"` for the classic behavior of inserting the result as editable text.

Long-running expressions show a progress notification with soft-break and hard-break options. The **GemStone Transcript** output channel captures transcript output from the session.

### GemStone Explorer

The **GemStone Explorer** is the primary way to browse and edit code, and the view to reach for first. It lives in its own activity-bar container as a set of linked panes — **Dictionaries**, **Class Categories**, **Classes**, **Hierarchy**, and **Methods**. Your open editors appear as ordinary editor tabs; a status-bar button tallies them and closes them all at once (**GemStone: Close All GemStone Editors**).

Selecting down the panes narrows what the next one shows. Click a method to open its source; **Cmd+S** (Ctrl+S) compiles it back to GemStone. Class definitions and comments are editable the same way. A single click previews a method in one reusable tab, so clicking another replaces it — double-click a method (or use **Keep Method Open**) to keep it open while you browse others.

Beyond browsing, the Explorer is where the code-changing operations live:

- Filter the Dictionaries, Class Categories and Classes panes by name, with `*` as a wildcard; the Methods pane's Filter button opens VS Code's own find box inside the pane, whose toggle hides the rows that don't match, and an instance variable's context menu filters the pane to the methods that read, write or reference it
- Group methods by category, or list them flat
- Add, rename, and delete dictionaries, class categories, classes, method categories, methods, instance variables, and class variables
- Deleting first looks for what still references the target: nothing does, and it just goes (and says so); something does, and you are shown the methods before you decide
- The refactorings — rename, extract/inline method and temporary, change signature, move/push up/push down method, instance-variable structure changes, extract superclass, split class — each previewed before it is applied
- Browse senders, implementors, references, and the class hierarchy
- Drag and drop methods between categories, classes onto a class category to refile them, and classes between dictionaries

### System Browser

> **Note:** the System Browser is **frozen** — the older, five-column browser that predates the **GemStone Explorer** above. It works today, but it is not being extended, and how long it keeps working is not guaranteed: new features land in the Explorer. Prefer the Explorer unless you specifically want this layout. Why, and the one gap that is still browser-only: [docs/explanation/system-browser-and-explorer.md](docs/explanation/system-browser-and-explorer.md).

Open with **Cmd+K B** (Ctrl+K B), or from the Command Palette via **GemStone: Open System Browser (Classic)**. It is deliberately not offered as a button anywhere, so the Explorer is what you meet first. The browser provides a five-column layout:

- **Dictionaries** — your symbol list dictionaries
- **Class Categories** — classes grouped by category
- **Classes** — class list with hierarchy toggle
- **Method Categories** — method categories with `** ALL METHODS **`
- **Methods** — method selectors

Click a method to view and edit its source. **Cmd+S** (Ctrl+S) compiles changes back to GemStone. Class definitions and comments are also editable.

Context menu operations include:

- Add/delete/rename dictionaries, categories, classes, and methods
- Move classes between dictionaries, reclassify by category
- Drag-and-drop methods to recategorize
- Drag-and-drop classes between dictionaries
- Browse references, senders, implementors, and class hierarchy
- Run SUnit tests on a class

### Object Inspector

The **Inspector** sidebar view displays GemStone objects with drill-down into named and indexed instance variables. Pin objects via **Inspect It** or by clicking globals in the Explorer. Large collections are paginated.

#### Enhanced Inspector

With the optional server-side support installed (GemStone 3.7.5+), **Inspect It** opens the **Enhanced Inspector** instead: a miller-column panel with rich, per-class object views in the style of Glamorous Toolkit. On stones without the support — or older GemStone versions — Jasper falls back to the classic sidebar inspector. When you connect to a stone that lacks the support, Jasper offers to install it (together with the refactoring engine); the `gemstone.serverSupport.autoInstall` setting (`ask` / `always` / `never`) controls that prompt.

### Search and Navigation

- **Senders Of** — find all methods sending a selector (editor context menu or browser)
- **Implementors Of** — find all implementations of a selector
- **Browse References** — find methods referencing a dictionary or class
- **Search Method Source** — full-text search across method source code
- **Class Hierarchy** — view superclass chain and subclasses
- **Workspace Symbol** (Cmd+T / Ctrl+T) — search classes and methods across both local files and the active GemStone session
- **Go to Definition** (Cmd+Click / Ctrl+Click / F12) — jump to implementors of a selector or a class definition

### Debugging

When code execution hits an error, a **Debug** button opens the VS Code debugger with:

- Full stack trace with `ClassName >> #selector` frame names
- Click any frame to view its method source
- **Arguments & Temps** and **Receiver** variable scopes with drill-down
- Step Over, Step Into, Step Out, and Continue
- Restart Frame support
- Evaluate expressions in the Debug Console in any frame context

### Breakpoints

Breakpoints live in VS Code's own breakpoint list, so the familiar gutter,
checkbox and Enable/Disable/Remove All controls all drive GemStone. Each one is
applied to the session as a step-point break.

**A GemStone breakpoint is tied to the compiled method it was set in.** It lives
in the gem, not the repository — no `commit` persists it — so it goes away when
the thing it was set in goes away:

- **logging out** clears it, from VS Code's list as well as the gem, so no marker
  is left for something that no longer exists. Unlike a breakpoint on a file, it
  does not come back when you reopen the window;
- **recompiling the method** clears it too. The recompile replaces the method, and
  after an edit the same step point may be a different expression — so the
  breakpoint is dropped rather than quietly moved somewhere you didn't put it.

- **Only in a method editor.** A breakpoint names a step point in a method that
  lives in the gem, so a `gemstone://` method editor with no unsaved edits is
  the only place one can be set. Not a workspace, not a `.gst` file, and not an
  **Executed Code** (doit) frame in the call stack — a doit's method is compiled
  for that one execution and gone afterwards, so a breakpoint on it could never
  be hit again. VS Code offers its gutter per *language*, which is the same for
  all four, so a breakpoint set in the wrong one is taken back out with a message
  saying where it belongs
- **Unsaved edits hold a method's breakpoints as they are.** Step point numbers
  come from the compiled method, and VS Code moves its breakpoints as you type,
  so while an editor is dirty the two describe different code. No new breakpoint
  is accepted — it is taken back out of the list, with a message naming the two
  ways on: save the method, or **File: Revert File** to drop the edits. What is
  already set is left alone rather than re-applied against positions that have
  moved, so it is still there, on the same step points, once the editor is clean
- **Line breakpoints** — click the editor gutter in a `gemstone://` method. A
  gutter click means "this line", and lands on the leftmost step point on it
- **Step-point breakpoints** — a Smalltalk line usually holds several step
  points. **Toggle Breakpoint at Cursor** (`Shift+F9`) breaks at the step point
  under the caret, not the first one on the line, and the token that will
  actually break is outlined
- **Enable / disable** — per breakpoint from the Breakpoints view checkbox or
  **Enable/Disable Breakpoint at Cursor**. A disabled breakpoint stays set in the
  gem so re-arming it is instant; its token marker turns grey and faded, matching
  the grey the gutter dot goes
- **A breakpoint belongs to the session its method came from.** A method editor
  stays bound to the session that opened it, so a breakpoint set in it is armed
  in *that* session's gem — not in whichever session happens to be active. With
  one session live there is no difference; with several, this is what makes the
  breakpoint stop the code you were looking at. A row in the **GemStone
  Breakpoints** view can likewise only act on a method from the session the view
  is reading
- **All at once** — **Enable All**, **Disable All** and **Remove All
  Breakpoints** act on every GemStone breakpoint in **every logged-in session**,
  including any set outside Jasper by topaz or a `halt` left in the code. VS Code
  keeps one breakpoint list for the window, so "all" means all of it: sweeping
  only the active session would leave rows reading *disabled* over breakpoints
  that still stop execution. If one session's gem refuses, the others are still
  swept and the message names the one that failed
- **Clear All Breakpoints in Method** drops every breakpoint in the method you
  are in
- **Not honoured: conditions, hit counts and log messages.** VS Code's *Edit
  Breakpoint* accepts all three; GemStone breakpoints stop every time the step
  point is reached, so Jasper warns when you set one rather than quietly ignoring
  it. Conditional breakpoints are tracked under
  [#277](https://github.com/GemTalk/Jasper/issues/277)
- **Avoid VS Code's own "Deactivate Breakpoints"** button (the filled-dot icon in
  the Breakpoints panel header). It greys the breakpoints out in the panel, but
  the VS Code API exposes no way for an extension to observe that state — so
  Jasper never hears about it and GemStone keeps stopping on them. Use
  **Disable All Breakpoints** instead, which disarms them in the gem
- **Break on entry by name** — the `+` button in VS Code's Breakpoints panel
  takes a method name instead of a location. Type a selector (`balance`) and
  Jasper finds the implementors, asking which class you meant when there is more
  than one; or qualify it yourself (`Account>>balance`, `Account class>>new`).
  The name is then replaced by an ordinary breakpoint on the method's first step
  point, so it gets a real location, a red dot, and everything else breakpoints
  do — handy for stopping in a method without going to find it first

#### Step points

- **Numbered inline** — step point numbers are drawn as inlay hints, and each is
  clickable to toggle a breakpoint there. `gemstone.stepPoints.display` controls
  when: `debugging` (the default — visible while a debug session runs, out of the
  way otherwise), `always`, or `off`. **Toggle Step Point Numbers** flips them
  without leaving the editor — it's the `123` button in the editor title bar, and
  on the right-click menu
- **On hover** — hovering a step point always reports its number and breakpoint
  state, with links to set, clear, enable or disable it, whatever the numbering
  is set to
- Numbers are suppressed while a buffer has unsaved edits, since the stone's
  offsets no longer line up with what you are looking at

#### Breakpoint manager

The **Breakpoints** view in the GemStone sidebar lists what the current session's
gem actually holds, grouped by class and method with the step point each
breakpoint resolved to. It shows breakpoints Jasper never set, which are
otherwise invisible until execution stops on one. Rows carry an enable checkbox;
clicking one opens the method with the caret on the step point.

### SUnit Test Runner

The extension integrates with VS Code's native Test Explorer:

- Auto-discovers all `TestCase` subclasses and their `test*` methods
- Run individual tests or entire test classes
- Debug a test, or a whole class, under the GemStone debugger — a debug run omits SUnit's exception handler, so a failing test suspends on a live stack instead of being recorded and discarded
- Pass/fail/error results with failure messages
- Stop a long-running test: the Testing view's stop button, the ■ that replaces a row's ▶ in the Explorer while it runs, or the Cancel on the progress notification. First press asks the gem to stop at a safe point; a second interrupts it
- Test items link to method source, and a run/status icon appears in the editor gutter beside an open test class or test method
- Run from the GemStone Explorer too: a ▶ on a test class row (Classes or Hierarchy pane) or a test method row (Methods pane), each showing the outcome of its last run
- Clicking a row in the Testing view opens the code without moving the Explorer; **Reveal in GemStone Explorer** — the ⊟ on the row, or its context menu — navigates the panes when you want it
- The reverse too: **Reveal in Testing View** on a test class or test method row in the Explorer selects it in the Testing view
- **Clear Test Results** wipes the outcome icons — in the Explorer and in the Testing view both — when a run in progress is hard to see. Right-click a test row in either place, or use the `…` overflow on the Classes / Hierarchy / Methods pane headers, or the Command Palette

### Jupyter Notebooks (Smalltalk and Grail Python)

Jasper registers two kernels with Microsoft's [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter). Open any `.ipynb` notebook and pick one from the kernel picker; cells execute in the active GemStone session, so notebook code sees — and can modify — the same objects as the GemStone Explorer and Display It. Compile and runtime errors appear as cell error outputs.

**GemStone Smalltalk** runs each cell as an independent doit — multi-statement bodies are fine, and the value of the last statement is printed as the cell output. There is no notebook-local variable scope (Smalltalk has no REPL globals concept); state persists the way it does everywhere else in the session, e.g. `UserGlobals at: #x put: ...`, class definitions, and commits.

**Grail (GemStone Python)** requires [Grail](https://github.com/GemTalk/Grail) (GemStone-Python) in your stone:

- Globals persist across cells (Jupyter REPL semantics): `x = 1` in one cell, `x + 2` in the next. Each notebook gets its own module scope within the session, so two open notebooks don't share variables.
- **GemStone: Reset Grail Notebook Scope** (command palette) clears the active notebook's globals — the equivalent of restarting a kernel.
- Without Grail in the stone, running a cell reports "Grail (GemStone-Python) not detected".

### Class Sync (File Export)

Jasper keeps a local mirror of a session's classes as `.gs` files in Topaz format, so VS Code's search, Go to Definition, and find-in-files have something to work with. Files land in `{workspaceRoot}/.gemstone/{host}/{stone}/{user}/{index}-{dictName}/` by default — a hidden directory, keyed by connection target so it's shared across that target's sessions. Override the layout with the `gemstone.exportPath` template setting (variables: `{workspaceRoot}`, `{session}`, `{host}`, `{stone}`, `{user}`, `{index}`, `{dictName}`).

The mirror syncs **incrementally**: Jasper diffs a server-side manifest of per-class hashes against the last sync and re-fetches only what changed, so login/commit/abort stay fast even on a large schema over a slow connection. It's kept across logout (reconnecting re-syncs the difference) and is updated immediately as you edit, so search reflects a change before you commit. A per-login **Sync classes** toggle (on by default) turns the mirror off for slow/remote connections, where server-side search still works.

Exported `.gs` files are **read-only on disk** by default (`chmod 0o444`) — not for editing; disabling `gemstone.classSync.readOnlyMirror` skips the permission changes, roughly halving the filesystem operations per class on slow or network filesystems. Edit methods through the **GemStone Explorer**, which round-trips through the `gemstone://` virtual filesystem and compiles on save. Creating a new `.gs` file under a dictionary directory does still file in a class template; deleting one deletes the class in GemStone.

## Claude / MCP Integration

Jasper exposes its GemStone IDE surface to MCP-aware AI clients (Claude Code, Claude Desktop, MCP Inspector, and any other client that speaks the protocol). All tools run against the **currently active session** in the window the user is actually working in — no separate credentials, no per-database subprocesses, no off-host exposure.

Two transports are served in parallel:

| Transport | Endpoint | Used by |
|-----------|----------|---------|
| stdio (proxy) | local socket / named pipe | Claude Code, Claude Desktop |
| HTTPS/SSE | `https://127.0.0.1:27101/sse` | "Add custom connector" UIs, MCP Inspector, any URL-based client |

Both Claude Code (`~/.claude.json`) and Claude Desktop (`claude_desktop_config.json`) are registered automatically when the extension activates, on macOS, Linux, and Windows. The **MCP Server** view in the GemStone sidebar shows which Jasper window is currently serving requests and which GemStone session it's bound to.

To use the HTTPS/SSE surface from Claude Desktop's "Add custom connector" dialog (or any URL-based client), trust the self-signed cert Jasper generates on first run:

1. Run **`GemStone: Install MCP TLS Certificate`** from the Command Palette.
2. Choose **Run in Terminal** (macOS will prompt for an admin password) or copy the command and run it yourself.
3. Run **`GemStone: Copy MCP Server URL`** and paste it into the connector dialog.

For the full architecture (ownership model, multi-window behavior, tool catalogue, limitations, how to wire up other MCP clients), see **[docs/mcp-server.md](docs/mcp-server.md)**.

The server registers under the name `jasper` (so the name `gemstone` stays free for the separate GemStone-native MCP server); its tools appear to clients as `mcp__jasper__*`. Disable Claude Desktop registration with `jasper.mcp.registerWithClaudeDesktop: false`. Override the HTTPS port per-workspace with `jasper.mcp.httpPort` to run multiple MCP-serving windows simultaneously.

## Language Support

The extension provides language support for three GemStone file formats:

- **Topaz** (`.gs`, `.tpz`) — Topaz command language with 40+ commands (`run`, `doit`, `printit`, `method`, `classmethod`, etc.) and embedded Smalltalk
- **Tonel** (`.st`) — Rowan package manager format with STON metadata headers
- **Smalltalk** — bare Smalltalk for browser documents and scratch files

All formats include:

- Syntax highlighting (TextMate grammars)
- Semantic token highlighting (LSP)
- Hover documentation
- Autocompletion
- Go to Definition and Find References
- Document and workspace symbols
- Code formatting with configurable options
- Diagnostics
- Code folding

The Smalltalk formatter has eleven knobs under `gemstoneSmalltalk.formatter.*` (spacing, line wrapping, continuation indent, etc.). The VS Code Settings UI shows every option live; the full reference is in **[docs/formatter.md](docs/formatter.md)**.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gemstone.rootPath` | `~/Documents/GemStone` | Root directory for GemStone installations and databases |
| `gemstone.gciLibraries` | `{}` | Map of GemStone versions to GCI library paths |
| `gemstone.exportPath` | `""` | Root path for class file export (supports `{workspaceRoot}`) |
| `gemstone.classSync.readOnlyMirror` | true | Write exported `.gs` mirror files as read-only; turn off to speed up syncing on slow or network filesystems |
| `gemstone.displayItMode` | `overlay` | How Display It shows its result: `overlay` (non-destructive annotation) or `insert` (into the document) |
| `gemstone.maxEnvironment` | 0 | Method environments to display in browser |
| `gemstone.serverSupport.autoInstall` | `ask` | What to do when a stone lacks the optional server-side support (Enhanced Inspector, refactoring engine): `ask`, `always`, or `never` |
| `gemstone.sessionMode` | `single` | Concurrent sessions allowed: `single` (default) or `multiple` (beta — reveals the Sessions panel) |
| `jasper.mcp.httpPort` | 27101 | Port on 127.0.0.1 where Jasper serves the MCP HTTPS/SSE surface |
| `jasper.mcp.registerWithClaudeDesktop` | true | Auto-register the jasper MCP server in Claude Desktop's global config |

> **Tip:** VS Code's Quick Open file search (Cmd+P / Ctrl+P) and the title bar search respect `.gitignore` by default, so exported `.gs` files in gitignored directories won't appear in search results. To include them, set `"search.useIgnoreFiles": false` in your VS Code settings. If there are some ignored things you want to continue to exclude, you can tell VS Code to exclude certain paths with the `files.exclude` setting.

## GCI Library

The extension communicates with GemStone databases using the GemStone C Interface (GCI) thread-safe library (`libgcits`), loaded at runtime via [koffi](https://koffi.dev/). The library path is resolved in this order:

1. **Auto-detected** from extracted distributions (server or Windows client) matching the login's GemStone version
2. **Configured** per-version in the `gemstone.gciLibraries` setting
3. **Prompted** — on Windows you are offered an automatic download; on all platforms you can browse to the library manually

The Windows client distribution exports a subset of the full GCI interface — non-blocking login and debug-attach functions are not available, but all standard session operations work normally.

## Documentation

| Topic | Where |
|-------|-------|
| Windows / WSL networking, hosts file, NetLDI port naming | [docs/windows-wsl.md](docs/windows-wsl.md) |
| MCP server architecture, ownership model, client registration, tool catalog | [docs/mcp-server.md](docs/mcp-server.md) |
| Smalltalk formatter reference (all options) | [docs/formatter.md](docs/formatter.md) |
| Why the System Browser is frozen and the Explorer gets new work | [docs/explanation/system-browser-and-explorer.md](docs/explanation/system-browser-and-explorer.md) |
| Building, testing, integration test environment setup, releasing | [CONTRIBUTING.md](CONTRIBUTING.md) |

## License

MIT
