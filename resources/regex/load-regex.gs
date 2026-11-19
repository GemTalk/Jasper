! ============================================================================
! Thin bootstrap for loading Jasper's regular-expression support into a stone.
!
! Run this under topaz in a SystemUser session on a LOCAL stone (the gem must be
! able to read this directory). It files in the loader class, then asks the
! loader to do the real work: create the GsRegexLibrary dictionary, file in the
! library and Jasper's classes, run a completeness check, and commit on success
! (abort on failure).
!
! Jasper's install command and CI use the same loader, so every path loads the
! same way. See gs-src/regex/README.md for the full runbook.
!
! BEFORE RUNNING: replace every <PAYLOAD_DIR> below with the absolute server-side
! path to this directory, e.g.
!   /export/.../Jasper/resources/regex
! (There are two.)
! ============================================================================

input <PAYLOAD_DIR>/regex-loader.gs

run
| ldr |
ldr := GsRegexLoader loadFromServerDir: '<PAYLOAD_DIR>'.
ldr reportString, (ldr allOk ifTrue: ['[GsRegex] Committed.']
	ifFalse: ['[GsRegex] Aborted -- nothing was committed.'])
%
