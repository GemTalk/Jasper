# Security

If you find a security problem in Jasper, please tell us privately rather than in public, so we can
fix it before anyone can take advantage of it.

## Reporting a vulnerability

Don't open a public issue, pull request or discussion about it. Instead, use GitHub's private
reporting:

1. Go to the repository's [Security tab](https://github.com/GemTalk/Jasper/security) and click
   **Report a vulnerability**, or go straight to the
   [new report form](https://github.com/GemTalk/Jasper/security/advisories/new).
2. Fill in the form. Only you and the Jasper maintainers can see the report.

It helps to include:

1. What an attacker could do, and what they would need first (for example, access to the same
   machine, a file you open, or a stone they control).
2. Your Jasper, VS Code, GemStone and operating system versions.
3. Steps to reproduce the problem, or a proof of concept.

We'll reply in the report, work on the fix there with you, and publish a security advisory once a
fixed release is out. Tell us if you'd like to be credited in it.

## Supported versions

Security fixes go into the next Jasper release; older releases don't get them. The VS Code
Marketplace and Open VSX update extensions automatically, so leave automatic updates on, or update
Jasper by hand when a release mentions a security fix.

## What isn't covered here

1. **GemStone/S itself.** Problems in the GemStone server, the GCI library or GemStone's own tools
   belong to GemStone, not Jasper. Report them to GemTalk Systems through your usual support channel.
2. **Known vulnerabilities in Jasper's dependencies.** GitHub already tells us about these. Report
   one only if you've found a way to exploit it through Jasper.
