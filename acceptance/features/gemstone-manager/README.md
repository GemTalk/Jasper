# The GemStone Manager

Running GemStone means keeping four things in order: an operating system
configured to hand out shared memory, a version of GemStone installed from it, a
database made from that version, and a login that reaches the database. Each has
its own view in the sidebar, which is fine once everything is up — and four
separate lists to walk when it isn't.

The manager puts all four on one screen, in the order they matter. What is
blocking you leads: a machine that cannot hand out enough shared memory says so
before anything else, and a machine with nothing installed leads with the
versions. Once neither is true the screen leads with connecting, because that is
what it is usually opened to do.

It is an ordinary editor tab, so it can sit beside the code it describes, and it
keeps itself current — starting a stone, adding a login or logging in redraws it
where it stands rather than leaving a stale picture to be refreshed by hand.

Everything below was captured from a real editor window driving a real database.
