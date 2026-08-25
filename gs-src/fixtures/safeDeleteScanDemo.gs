! ---------------------------------------------------------------------------
! Safe-delete demo fixture — the cases a review found the guard getting wrong
!
! Companion to safeDeleteDemo.gs, which walks the ordinary paths (referenced vs
! unreferenced, for each of the four kinds). This one sets up only the situations
! where the guard used to UNDER-REPORT — telling you nothing depends on the target
! when something still does. That is the direction that matters, because a delete
! that looks safe goes through with no question at all.
!
! Everything here is prefixed SdScan / sdScan. A SELECTOR is image-wide, so an
! unprefixed fixture method picks up unrelated senders elsewhere in the stone and
! the expected counts below stop being reproducible.
!
! REQUIRES `gemstone.maxEnvironment` set to 1 or more in VS Code settings for the
! environment sections. With it left at 0 the environment sections load fine but
! Jasper never looks past environment 0 and they cannot be exercised.
!
! ── what to click, and what should happen ──────────────────────────────────
!
!  A. A doomed subclass's name reused by an unrelated class
!
!     Remove class  SdScanRoot   (UserGlobals)
!       → MUST ask, and name  SdScanTwin >> #sdScanUsesRoot
!       The SdScanTwin in SdScanOtherDict is a different class that merely shares
!       a name with the doomed subclass. Its reference survives the deletion.
!       → must NOT name  SdScanTwin >> #sdScanGoesAwayToo
!       That one is the real subclass, in UserGlobals, and goes away with the root.
!       Before the fix: deleted silently, announcing that nothing referenced it.
!
!  B. A scan that came back full, then lost a row to an exclusion
!
!     Remove method  SdScanCapTarget >> sdScanCapped
!       → MUST say "At least 499 methods still reference it" AND
!         "(the list below is not complete)".
!       499 callers plus the method's own recursive send is exactly the 500-row
!       cap; the self-send is then excluded, taking the count under it.
!       Before the fix: "499 methods still reference it", stated as exact fact.
!
!     Remove method  SdScanCapTarget >> sdScanBusy
!       → MUST say "At least 500" and "not complete"  (600 callers, plainly capped)
!
!     Remove method  SdScanCapTarget >> sdScanQuiet
!       → MUST say "3 methods still reference it:" with no hedge at all.
!       Well under the cap, so the count is exact and saying so is right.
!
!  C. The same selector implemented in two environments
!
!     Remove method  SdScanEnvTarget >> sdScanTwoEnv   (the Methods pane row)
!       → MUST ask, naming  SdScanEnvTarget [env 1] >> #sdScanTwoEnv  — the label says
!         which environment the surviving sender is in, and the dialog also says
!         "SdScanEnvTarget also implements #sdScanTwoEnv in environment 1; only the
!          environment 0 method is removed".
!       Both environments implement it and both send it to themselves. The pane
!       removes the environment-0 one, so only ITS self-send goes away; the
!       environment-1 method stays, and its send with it.
!       Before the fix: deleted silently — the environment-1 method was crossed
!       off as if it were the removed method's own recursion.
!       (Verified on 3.7.5: removeSelector:, which is what the delete calls, takes
!        the environment-0 method and leaves the environment-1 one standing.)
!
!     Remove method  SdScanEnvTarget >> sdScanOneEnvOnly
!       → MUST go quietly, and the notification must NOT claim an implementation
!         survives. Only environment 0 implements it, and its self-send really does
!         go away with it. (The check that the fix did not simply turn every
!         recursive method back into a question.)
!
!  D. Opening a result that lives outside environment 0
!
!     Implementors of  #sdScanTwoEnv
!       → MUST list TWO rows for SdScanEnvTarget, not one.
!         Picking each must open that environment's own source; the two bodies
!         say which environment they are in, so a wrong open is visible.
!       Try it BOTH with a System Browser already open and with none open —
!         those are different code paths, and the already-open one is the path
!         that used to ignore the row's environment entirely.
!
!     Senders of  #sdScanOnlyInEnvOne
!       → MUST find  SdScanEnvCaller >> #sdScanCallsEnvOne, which exists only in
!         environment 1. Picking it must switch the browser to Env 1 and open it.
!
! ── loading ────────────────────────────────────────────────────────────────
!
! THIS IS TOPAZ INPUT, NOT SMALLTALK — `run … %` and `method: … %` are topaz
! commands, so it cannot be pasted into a Jasper editor and Executed.
!
!     topaz -l -I <your .topazini>
!     input gs-src/fixtures/safeDeleteScanDemo.gs
!
! Take it back out:  SdScanFixture removeDemo
!
! Section A INSERTS A DICTIONARY at the front of the symbol list, which shifts
! every other dictionary's 1-based index by one. Jasper caches those indexes in
! Explorer state, so refresh the Explorer after loading or a tree built earlier
! aims at the wrong dictionary. removeDemo takes the dictionary back out.
!
! Loading COMMITS, because Jasper logs in as its own session and cannot see another
! session's uncommitted work. Not loaded by any test and installed in no stone by
! the build.
! ---------------------------------------------------------------------------

! Each definition gets its own `run` block: topaz compiles a block as ONE method,
! so a later statement naming a class an earlier statement created would not
! resolve yet.

! ── the removal hook ──────────────────────────────────────────────────────────
! On its own class, deliberately: every other class here is something you are
! meant to delete by hand, and a removal hook on one of those stops working the
! moment the fixture is used as intended.

run
Object
  subclass: 'SdScanFixture'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

classmethod: SdScanFixture
removeDemo
  "Take the whole fixture back out again, dictionary included."
  | dict |
  #( SdScanRoot SdScanTwin SdScanOutsider
     SdScanCapTarget SdScanCappedCrowd SdScanBusyCrowd SdScanQuietCrowd
     SdScanEnvTarget SdScanEnvCaller SdScanFixture )
    do: [:each | UserGlobals removeKey: each ifAbsent: [nil]].
  "UserProfile has no removeDictionary: -- the symbol list itself is what you
   edit, the same way Jasper's own Remove Dictionary does it."
  dict := System myUserProfile symbolList
    detect: [:d | d name = #SdScanOtherDict] ifNone: [nil].
  dict ifNotNil: [System myUserProfile symbolList remove: dict].
  ^'Safe-delete scan demo removed. Commit to make that stick.'
%

! ── A. a doomed subclass's name reused by an unrelated class ─────────────────
! The scan resolves the class it is asked about through the dictionary, by object
! identity, so a same-named class elsewhere is a different class. The exclusion of
! the subtree that goes away WITH the target has to be just as careful: matching on
! the bare name threw away the reference below, from a class that is not going
! anywhere.

run
Object
  subclass: 'SdScanRoot'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
SdScanRoot
  subclass: 'SdScanTwin'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

method: SdScanTwin
sdScanGoesAwayToo
  "The REAL subclass naming its own root. It is removed with the root, so it is no
   reason to ask and must not be listed."
  ^SdScanRoot new
%

! The dictionary goes in AFTER the UserGlobals classes are built, so those bound
! the UserGlobals names; what follows binds against the new dictionary first.
run
| d |
d := SymbolDictionary new.
d name: #SdScanOtherDict.
System myUserProfile insertDictionary: d at: 1.
d
%

run
Object
  subclass: 'SdScanTwin'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: (System myUserProfile symbolList at: 1)
  options: #()
%

method: SdScanTwin
sdScanUsesRoot
  "A DIFFERENT class that merely shares the doomed subclass's name, in its own
   dictionary, referencing the root. Nothing removes this method, so the reference
   survives the deletion and the confirmation has to name it."
  ^SdScanRoot new
%

! ── B. a scan that came back full, then lost a row to an exclusion ────────────
! The scan returns at most 500 rows per query and the client cannot tell a full
! page from an exact answer, so at the cap the count is a floor, not a fact.
! Whether the cap was hit has to be read off the RAW rows: the exclusions run
! afterwards and can take a capped 500 back under the cap, where it stops looking
! capped. Crowds of senders are built as many methods on ONE class rather than
! many classes — a sender is a method, so it counts the same and compiles faster.

run
Object
  subclass: 'SdScanCapTarget'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

method: SdScanCapTarget
sdScanCapped
  "Recursive on purpose. With 499 outside callers this makes exactly 500 senders —
   the cap — and its own send is then excluded, taking the reported count to 499.
   The hedge must survive that. Never actually run it."
  ^self sdScanCapped
%

method: SdScanCapTarget
sdScanBusy
  "600 callers: plainly past the cap, with nothing excluded."
  ^42
%

method: SdScanCapTarget
sdScanQuiet
  "Three callers: well under the cap, so the count is exact and is stated as fact."
  ^42
%

run
Object
  subclass: 'SdScanCappedCrowd'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdScanBusyCrowd'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdScanQuietCrowd'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

! 499 senders + the recursive self-send = exactly the 500-row cap.
run
1 to: 499 do: [:i |
  SdScanCappedCrowd
    compileMethod: 'sdScanCalls', i printString, '
  ^SdScanCapTarget new sdScanCapped'
    dictionaries: System myUserProfile symbolList
    category: 'sd scan callers'
    environmentId: 0].
SdScanCappedCrowd selectors size
%

! 600 senders: past the cap on its own.
run
1 to: 600 do: [:i |
  SdScanBusyCrowd
    compileMethod: 'sdScanCalls', i printString, '
  ^SdScanCapTarget new sdScanBusy'
    dictionaries: System myUserProfile symbolList
    category: 'sd scan callers'
    environmentId: 0].
SdScanBusyCrowd selectors size
%

run
1 to: 3 do: [:i |
  SdScanQuietCrowd
    compileMethod: 'sdScanCalls', i printString, '
  ^SdScanCapTarget new sdScanQuiet'
    dictionaries: System myUserProfile symbolList
    category: 'sd scan callers'
    environmentId: 0].
SdScanQuietCrowd selectors size
%

! ── C & D. the same selector implemented in two environments ─────────────────
! A class can implement the same selector on the same side in more than one
! environment, and those are different methods: removing one leaves the other, and
! the other's sends with it. The Methods pane collapses environments into one row
! and acts on environment 0.

run
Object
  subclass: 'SdScanEnvTarget'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdScanEnvCaller'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

! The bodies name their environment so a result that opens the wrong one is
! visible on sight rather than having to be inferred.
run
SdScanEnvTarget
  compileMethod: 'sdScanTwoEnv
  "Implemented in environment 0 AND environment 1. Both send it to themselves;
   removing this one leaves the other, and the other''s send survives."
  ^''environment 0'', self sdScanTwoEnv'
  dictionaries: System myUserProfile symbolList
  category: 'sd scan environments'
  environmentId: 0.
SdScanEnvTarget
  compileMethod: 'sdScanTwoEnv
  "The environment 1 twin. Nothing the Methods pane does removes this one."
  ^''environment 1'', self sdScanTwoEnv'
  dictionaries: System myUserProfile symbolList
  category: 'sd scan environments'
  environmentId: 1.
SdScanEnvTarget
  compileMethod: 'sdScanOneEnvOnly
  "Recursive, but implemented in environment 0 only, so its own send really does
   go away with it and removing it must ask nothing."
  ^self sdScanOneEnvOnly'
  dictionaries: System myUserProfile symbolList
  category: 'sd scan environments'
  environmentId: 0.
SdScanEnvTarget
  compileMethod: 'sdScanOnlyInEnvOne
  "Implemented only in environment 1, so Implementors must open Env 1 to show it."
  ^''only in environment 1'''
  dictionaries: System myUserProfile symbolList
  category: 'sd scan environments'
  environmentId: 1.
SdScanEnvCaller
  compileMethod: 'sdScanCallsEnvOne
  "A sender that exists only in environment 1. A search that looks at environment 0
   alone never sees it; one that finds it must open it in environment 1."
  ^SdScanEnvTarget new sdScanOnlyInEnvOne'
  dictionaries: System myUserProfile symbolList
  category: 'sd scan environments'
  environmentId: 1.
true
%

! ── commit ───────────────────────────────────────────────────────────────────
! Deliberate, and unlike safeDeleteDemo.gs which leaves the choice to you. Jasper
! logs in as its own session and cannot see another session's uncommitted work, so
! an uncommitted fixture is invisible to the thing it exists to test — and topaz
! logging out would throw it away. Take it back out with SdScanFixture removeDemo
! (and commit that too).
commit

! ── check the setup is what the notes above claim ─────────────────────────────
! Cheap to run and it fails loudly, which beats hand-testing against a fixture
! that quietly did not build the situation being tested.
run
| problems senders envs twinA twinB |
problems := OrderedCollection new.

"The two SdScanTwins must really be different classes."
twinA := UserGlobals at: #SdScanTwin ifAbsent: [nil].
twinB := (System myUserProfile symbolList
  detect: [:d | d name = #SdScanOtherDict] ifNone: [nil])
    ifNil: [nil] ifNotNil: [:d | d at: #SdScanTwin ifAbsent: [nil]].
(twinA notNil and: [twinB notNil and: [twinA ~~ twinB]])
  ifFalse: [problems add: 'the two SdScanTwin classes did not come out distinct'].

"Sender counts, as the notes above promise them. sendersOf: answers a two-element
 Array -- the methods, then the classes reached through a special selector -- so the
 count lives at 1, not in the Array itself. Reading the Array's own size answers 2
 whatever the truth is, which looks like a working check and never fails."
senders := ((ClassOrganizer new environmentId: 0; yourself) sendersOf: #sdScanCapped) at: 1.
senders size = 500
  ifFalse: [problems add: 'sdScanCapped has ', senders size printString, ' senders, expected 500'].
senders := ((ClassOrganizer new environmentId: 0; yourself) sendersOf: #sdScanBusy) at: 1.
senders size = 600
  ifFalse: [problems add: 'sdScanBusy has ', senders size printString, ' senders, expected 600'].
senders := ((ClassOrganizer new environmentId: 0; yourself) sendersOf: #sdScanQuiet) at: 1.
senders size = 3
  ifFalse: [problems add: 'sdScanQuiet has ', senders size printString, ' senders, expected 3'].

"sdScanTwoEnv in both environments; sdScanOneEnvOnly in environment 0 only."
envs := (0 to: 1) select: [:e |
  (SdScanEnvTarget compiledMethodAt: #sdScanTwoEnv environmentId: e otherwise: nil) notNil].
envs asArray = #(0 1)
  ifFalse: [problems add: 'sdScanTwoEnv is in environments ', envs printString, ', expected 0 and 1'].
envs := (0 to: 1) select: [:e |
  (SdScanEnvTarget compiledMethodAt: #sdScanOneEnvOnly environmentId: e otherwise: nil) notNil].
envs asArray = #(0)
  ifFalse: [problems add: 'sdScanOneEnvOnly is in environments ', envs printString, ', expected 0 only'].
envs := (0 to: 1) select: [:e |
  (SdScanEnvCaller compiledMethodAt: #sdScanCallsEnvOne environmentId: e otherwise: nil) notNil].
envs asArray = #(1)
  ifFalse: [problems add: 'sdScanCallsEnvOne is in environments ', envs printString, ', expected 1 only'].

problems isEmpty
  ifTrue: ['Safe-delete scan demo loaded, committed and verified.']
  ifFalse: ['FIXTURE DID NOT BUILD AS INTENDED: ', problems asArray printString]
%
