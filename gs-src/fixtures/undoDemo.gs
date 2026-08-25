! gs-src/fixtures/undoDemo.gs
!
! Manual-review fixture for Undo (#434). Builds the classes and methods
! docs/how-to/manually-test-undo.md walks through, so a review pass starts from a known
! state instead of hand-building one in the Explorer.
!
! A topaz file. It CANNOT be pasted into a Jasper editor and Executed -- `run ... %` and
! `method: ... %` are topaz commands, not Smalltalk. Load it with the topaz recipe in
! `/eric worktree`; this file carries no credentials, so the login preamble comes from the
! command line.
!
!   UndoDemoFixture reset       "back to a clean fixture between sections"
!   UndoDemoFixture removeDemo  "take the whole thing out when you are done"
!
! IT COMMITS, deliberately. The walkthrough exercises Abort (steps 0.12 and 7.4), and an
! uncommitted fixture would disappear underneath the reviewer at exactly that point. Your
! own edits during the pass stay uncommitted and abortable; only the fixture is committed.
!
! Every selector is `ud`-prefixed because a selector is IMAGE-WIDE: the unprefixed names
! this fixture replaces (`total`, `report`, `make`) are implemented by other demo classes in
! the dev stone, which would make the refactoring sections' sender lists wrong. Instance
! variables are per-class and need no prefix; they carry one anyway so the whole fixture
! greps as `ud`.
!
! Deliberately NO extra dictionary. Nothing in the undo work tests shadowing, and inserting
! a dictionary shifts every symbol-list index -- which has bitten two earlier fixtures.

run
"Idempotent: re-loading starts from clean. Unbinds the names directly rather than calling
 removeDemo, so a half-loaded or older version of this fixture cannot make the re-load fail."
#(#UndoDemoSavings #UndoDemoAccount #UndoDemoLedger #UndoDemoFixture)
  do: [:n | UserGlobals removeKey: n ifAbsent: [nil]].
System commitTransaction.
'cleared'
%

run
Object subclass: 'UndoDemoFixture'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #().
(UserGlobals at: #UndoDemoFixture) category: 'Undo Demo'.
'UndoDemoFixture defined'
%

classmethod: UndoDemoFixture
udMaterialNames
  "The classes this fixture builds, in the order they must be removed -- subclass first, so
   no class is unbound while something still names it as a superclass."
  ^ #(#UndoDemoSavings #UndoDemoAccount #UndoDemoLedger)
%

classmethod: UndoDemoFixture
udDefine: aName super: aSuperclass ivars: ivarNames
  "Define one fixture class in UserGlobals and answer it."
  | cls |
  cls := aSuperclass
    subclass: aName
    instVarNames: ivarNames
    classVars: #()
    classInstVars: #()
    poolDictionaries: #()
    inDictionary: UserGlobals
    options: #().
  cls category: 'Undo Demo'.
  ^ cls
%

classmethod: UndoDemoFixture
udCompile: aClass meta: isMeta category: aCategory source: aSource
  "Compile one method onto the instance or class side of aClass."
  | target |
  target := isMeta ifTrue: [aClass class] ifFalse: [aClass].
  target
    compileMethod: aSource
    dictionaries: System myUserProfile symbolList
    category: aCategory
    environmentId: 0
%

classmethod: UndoDemoFixture
install
  "Build the fixture. Does not commit -- `reset` and the load script do that."
  | account savings ledger |
  account := self udDefine: 'UndoDemoAccount' super: Object ivars: #('udBalance' 'udSpare').
  savings := self udDefine: 'UndoDemoSavings' super: account ivars: #('udRate').
  ledger := self udDefine: 'UndoDemoLedger' super: Object ivars: #().

  "The rename/extract target, and the caller that has to be rewritten with it -- and put
   back when the refactoring is undone."
  self udCompile: account meta: false category: 'computing'
    source: 'udTotal
  ^ 40 + 2'.
  self udCompile: account meta: false category: 'printing'
    source: 'udReport
  ^ ''total is '', self udTotal printString'.

  "Self-contained arithmetic, for extract/inline temporary."
  self udCompile: account meta: false category: 'computing'
    source: 'udPure
  ^ 7 * 6'.

  "Reads udBalance, so Remove Instance Variable has a method to drop and the preview has a
   number to name."
  self udCompile: account meta: false category: 'accessing'
    source: 'udBalanceValue
  ^ udBalance'.

  "The canaries. Nothing in the walkthrough should ever disturb these two, and udMake is
   also the CLASS-SIDE slot a class revert has to bring back."
  self udCompile: account meta: false category: 'fixture'
    source: 'udUntouched
  ^ ''kept'''.
  self udCompile: account meta: true category: 'instance creation'
    source: 'udMake
  ^ self new'.

  "A real subclass: push up / push down and extract superclass need a hierarchy, and the
   Explorer''s subtree removal needs two classes to take out at once."
  self udCompile: savings meta: false category: 'accessing'
    source: 'udRateValue
  ^ udRate'.

  "An unrelated sibling: the move-method target, and something for the Classes pane to still
   be listing after a reveal."
  self udCompile: ledger meta: false category: 'posting'
    source: 'udPost
  ^ ''posted'''.

  "udSpare is read by NOTHING on purpose -- pushing it down is declined, which is a case the
   walkthrough checks."
  ^ 'installed'
%

classmethod: UndoDemoFixture
udRemoveMaterial
  "Unbind the three demo classes, leaving UndoDemoFixture itself in place so `reset` can
   still be called. Does not commit."
  self udMaterialNames do: [:n | UserGlobals removeKey: n ifAbsent: [nil]].
  ^ 'material removed'
%

classmethod: UndoDemoFixture
reset
  "Back to a clean fixture, and commit it.

   Worth having between sections: a manual pass MUTATES this fixture on purpose -- methods
   deleted, a class definition changed into an empty new version, a class renamed and left
   renamed -- and the next section assumes the original shape."
  self udRemoveMaterial.
  self install.
  System commitTransaction.
  ^ 'UndoDemoFixture reset'
%

classmethod: UndoDemoFixture
removeDemo
  "Take the whole fixture out, this class included, and commit -- so an abort cannot bring
   it back. This is the end-of-review cleanup."
  self udRemoveMaterial.
  UserGlobals removeKey: #UndoDemoFixture ifAbsent: [nil].
  System commitTransaction.
  ^ 'UndoDemoFixture removed'
%

run
UndoDemoFixture install.
System commitTransaction.
'installed and committed: ',
  ((System myUserProfile symbolList objectNamed: #UndoDemoAccount) isNil
     ifTrue: ['FAILED'] ifFalse: ['UndoDemoAccount, UndoDemoSavings, UndoDemoLedger'])
%
