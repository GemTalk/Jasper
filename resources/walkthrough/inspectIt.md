# Inspect an object

**Inspect It** — `Cmd/Ctrl + K` then `I` — evaluates the expression and opens the
result in the **Inspector**, an editor tab beside your code, where you can drill into
its fields and follow references object by object.

In the workspace you opened, put the cursor on the `System myUserProfile` line and
Inspect It. The Inspector presents the object as tabs — its **Slots**, its **Items**
or **Entries** if it holds any, its full **Print** string, and **Meta** for the class
behind it — its methods, definition and comment. Double-click any row to open that
object in a new column to the right, so the trail you followed stays on screen. The
**Evaluate** tab runs an expression with the inspected object bound to `self`, on the
same `Cmd/Ctrl + K` keys you use in an editor — `D` to display the result, `E` to
execute, `I` to inspect it — and lists the names in scope beside it, ready to click in.

From here, explore the **GemStone Explorer** — its own icon in the activity bar (the
far-left strip) — to read and edit classes and methods, and the rest of the GemStone
views for sessions, processes, and databases.
