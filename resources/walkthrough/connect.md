# Connect to a stone

Jasper talks to a running GemStone/S 64 stone through the GCI client library.

If you ran **Quick Setup**, a **DataCurator** login is already waiting in the
**Logins & Sessions** view — just click it to connect.

To reach a stone you set up yourself, or a remote one, follow these steps in the
order the login editor presents them:

1. Open the **GemStone** view in the Activity Bar (the GemStone icon on the left).
2. In **Logins & Sessions**, click **Add a Login** to open the login editor.
3. Fill in the fields, top to bottom:
   - **GemStone Version** — the version whose GCI client library to use.
   - **Gem Host** — the machine the stone runs on (`localhost` for a local stone).
   - **Stone** — the stone's name (e.g. `gs64stone`).
   - **NetLDI (name or port)** — a NetLDI service name (e.g. `gs64ldi`) or a port
     number (e.g. `50377`); a port is often easiest for a remote stone.
   - **GemStone User** / **GemStone Password** — your GemStone credentials (e.g.
     `DataCurator`). Leave the password blank to be prompted on each login.
   - **Host User** / **Host Password** — *optional.* The OS account on the Gem's
     host machine, required only when the remote NetLDI requires host
     authentication. Leave blank for a local stone or a guest-mode NetLDI.
4. Click **Save**.
5. Back in **Logins & Sessions**, click the saved login (the plug) to connect.

While connecting, a "Connecting to…" notification appears. On success it reports
**Connected**, the session appears under its login row, and the status bar (bottom
right) shows the active session. If the connection fails, the status bar turns red
— click it to see why.

Once connected, the editor commands (Display It, Execute It, Inspect It) become
available in any GemStone Smalltalk document — a workspace, a `.gst` file, or a
method editor.
