# Install recommended server support

Jasper has two recommended server-side supports that aren't part of a stock GemStone
image, so each is installed once per stone:

- **Enhanced Inspector** — replaces the plain list of instance variables with
  rich, object-specific views. Requires **GemStone 3.7.5 or later**.
- **Refactoring engine** — server-side refactorings (starting with rename
  instance variable), previewed before they recompile. Loads on **any supported
  release (3.6.2+)**.

They install together as one bundle. When you connect to a stone that is missing
them, Jasper's behavior follows the `gemstone.serverSupport.autoInstall` setting:

- **Ask on connect** — offer to install with one Install / Not Now / Always / Never
  prompt (the default).
- **Always** — install automatically on connect.
- **Never** — do nothing.

[Install GemStone Support…](command:gemstone.installServerSupport)

You can install anytime from the Command Palette — press `Ctrl+Shift+P`
(`⇧⌘P` on macOS) and run
[GemStone: Install Server Support](command:workbench.action.quickOpen?%5B%22%3EInstall%20Server%20Support%22%5D).
Installing requires a SystemUser login and commits the supporting classes to the
database.

<!-- The link above pre-fills the Command Palette with a search string that must
     match the command's palette label (package.json command title "Install
     Server Support (Enhanced Inspector + Refactoring)"). If that title is
     renamed, update this search too. -->
