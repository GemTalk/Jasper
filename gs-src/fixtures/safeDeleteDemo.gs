! ---------------------------------------------------------------------------
! Safe-delete demo fixture  (Jasper issue #433)
!
! Four classes in UserGlobals. For each of the four things safe delete guards there
! is one that NOTHING references and one that something does, so both paths can be
! walked by hand in a real editor window. What to click, and what should happen:
!
!  ── deletes that should go WITHOUT a confirmation (a notification instead) ──
!
!   method             SdDemoAccount >> unusedHelper
!   method             SdDemoAccount >> mentionsSpareInAComment
!   instance variable  SdDemoAccount   spare
!   class variable     SdDemoAccount   SdDemoSpareVar
!   class              SdDemoOrphan
!
!  ── deletes that should ASK, and name what still uses it ──
!
!   method             SdDemoAccount >> sdDemoDeposit:
!                        → sender: SdDemoTeller >> serve
!   method             SdDemoAccount >> sdDemoBalance
!                        → sender: none, BUT see the note below
!   instance variable  SdDemoAccount   sdDemoBalance
!                        → accessors: SdDemoAccount >> sdDemoBalance,
!                                     SdDemoAccount >> sdDemoDeposit:,
!                                     SdDemoSavings >> accrue
!   class variable     SdDemoAccount   SdDemoOpenCount
!                        → accessors: SdDemoAccount >> sdDemoDeposit:,
!                                     SdDemoAccount class >> resetCount
!   class              SdDemoAccount
!                        → references: SdDemoTeller >> serve
!                        → subclasses: SdDemoSavings
!                        (SdDemoAccount >> makeAnother names the class too, but it
!                         goes away WITH the class, so it must NOT be listed)
!
!  ── the three discriminations worth seeing fail to fire ──
!
!   SdDemoAccount >> mentionsSpareInAComment names both `spare` and
!     `SdDemoSpareVar` in a comment only. Neither variable's delete may list it.
!   SdDemoTeller >> readsTheGlobal reads the GLOBAL SdDemoOpenCount, not the class
!     variable of the same name. The class variable's delete may not list it.
!   safeDeleteDemoShadow.gs (the companion file) adds a SECOND class also called
!     SdDemoShadow, in its own dictionary, referenced by its own caller. Deleting
!     either must name only its own caller. Load that one separately — it inserts a
!     dictionary at the front of the symbol list.
!
! Note on `sdDemoBalance`: it is BOTH a method and an instance variable here.
! Deleting the METHOD asks about senders (there are none, so it goes quietly);
! deleting the VARIABLE asks about accessors (there are three). That is the pair to
! look at if you want to see the two scans are not the same question.
!
! Why the `sdDemo` prefix on the selectors: a SELECTOR is image-wide, so a fixture
! method called `balance` or `deposit:` picks up every unrelated sender in the stone
! and the expected lists above stop being reproducible (Eric's dev stone has
! AiDemoBankAccount, which implements and sends both). Instance variable names are
! per-class, so `spare` needs no prefix.
!
! THIS IS TOPAZ INPUT, NOT SMALLTALK. The `run … %` and `method: … %` blocks are
! topaz commands, so this file cannot be pasted into a Jasper editor and Executed,
! and Jasper has no "file in this document" command either (its topaz file-in fires
! only for .gs files saved inside a session's own export area). Load it with topaz:
!
!     topaz -l -I <your .topazini>
!     input gs-src/fixtures/safeDeleteDemo.gs
!
! Take it back out:  SdDemoAccount removeDemo
!
! Not loaded by any test and installed in no stone by the build. Loading it leaves
! the change uncommitted, so it lasts only for that session unless you commit.
! ---------------------------------------------------------------------------

! Each definition gets its own `run` block: topaz compiles a block as ONE method, so a
! later statement naming a class an earlier statement created would not resolve yet.

run
UserGlobals at: #SdDemoOpenCount put: 999.
true
%

run
Object
  subclass: 'SdDemoAccount'
  instVarNames: #( sdDemoBalance spare )
  classVars: #( SdDemoOpenCount SdDemoSpareVar )
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
SdDemoAccount
  subclass: 'SdDemoSavings'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdDemoTeller'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdDemoOrphan'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

! ── SdDemoAccount, instance side ──────────────────────────────────────────────

method: SdDemoAccount
sdDemoBalance
  "Reads the instance variable, so removing the VARIABLE must ask. Nothing sends
   this method, so removing the METHOD must not -- the instructive pair."
  ^sdDemoBalance
%

method: SdDemoAccount
sdDemoDeposit: anAmount
  "Sent by SdDemoTeller, and touches both sdDemoBalance and the class variable."
  sdDemoBalance := (sdDemoBalance ifNil: [0]) + anAmount.
  SdDemoOpenCount := (SdDemoOpenCount ifNil: [0]) + 1.
  ^sdDemoBalance
%

method: SdDemoAccount
unusedHelper
  "Nothing sends this: deleting it should not ask."
  ^42
%

method: SdDemoAccount
mentionsSpareInAComment
  "spare and SdDemoSpareVar are only named in this comment, so neither scan
   should count this method as a reference."
  ^0
%

method: SdDemoAccount
makeAnother
  "A reference to the class from inside the class itself — it goes away with the
   class, so it is no reason to ask about deleting SdDemoAccount."
  ^SdDemoAccount new
%

! ── SdDemoAccount, class side ─────────────────────────────────────────────────

classmethod: SdDemoAccount
resetCount
  "The class variable is reachable from this side too."
  SdDemoOpenCount := 0
%

classmethod: SdDemoAccount
removeDemo
  "Take the whole fixture back out again, including the optional shadow section."
  | dict |
  #( SdDemoSavings SdDemoTeller SdDemoOrphan SdDemoAccount SdDemoOpenCount
     SdDemoShadow SdDemoShadowUserCaller SdDemoShadowOtherCaller )
    do: [:each | UserGlobals removeKey: each ifAbsent: [nil]].
  "UserProfile has no removeDictionary: -- the symbol list itself is what you edit
   (the same way Jasper's own Remove Dictionary does it)."
  dict := System myUserProfile symbolList
    detect: [:d | d name = #SdDemoOtherDict] ifNone: [nil].
  dict ifNotNil: [System myUserProfile symbolList remove: dict].
  ^'Safe-delete demo removed. Commit or abort as you like.'
%

! ── SdDemoSavings ─────────────────────────────────────────────────────────────

method: SdDemoSavings
accrue
  "A subclass touching the inherited instance variable, so the accessor list for
   sdDemoBalance spans two classes."
  sdDemoBalance := (sdDemoBalance ifNil: [0]) + 1
%

! ── SdDemoTeller ──────────────────────────────────────────────────────────────

method: SdDemoTeller
serve
  "Names the class AND sends sdDemoDeposit:, so both scans have something to find."
  ^SdDemoAccount new sdDemoDeposit: 10
%

method: SdDemoTeller
readsTheGlobal
  "Reads the GLOBAL SdDemoOpenCount, not the class variable of the same name —
   the class-variable scan must not report this method."
  ^SdDemoOpenCount
%

run
'Safe-delete demo loaded. Nothing is committed yet.'
%
