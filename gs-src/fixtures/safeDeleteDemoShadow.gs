! ---------------------------------------------------------------------------
! Safe-delete demo fixture — OPTIONAL shadowed-class-name section
!
! Load safeDeleteDemo.gs FIRST (this file's removal hook lives on SdDemoAccount).
!
! Two different classes both called SdDemoShadow, one in UserGlobals and one in a
! dictionary of its own, each with its own referencing method. Deleting either must
! name ONLY its own caller: the scan resolves the class through the dictionary the
! row came from and matches by object identity, so the same name elsewhere is a
! different class and not a reason to keep this one.
!
!   SdDemoShadow in UserGlobals        → referenced by SdDemoShadowUserCaller >> usesIt
!   SdDemoShadow in SdDemoOtherDict    → referenced by SdDemoShadowOtherCaller >> usesIt
!
! Kept separate, and deliberately NOT part of the committed fixture, because it
! INSERTS A DICTIONARY at the front of your symbol list. That is the point of the
! test, but anything resolving `symbolList at: 1` would then find SdDemoOtherDict
! instead of UserGlobals — not something to leave committed in a dev stone.
! Prefer to load it, try it, and abort.
!
! Load it:      input gs-src/fixtures/safeDeleteDemoShadow.gs
! Take it out:  SdDemoAccount removeDemo   (removes the dictionary too)
!
! The order below matters: the first caller is compiled while only the UserGlobals
! class exists, so it binds that one; the dictionary then goes in AHEAD of
! UserGlobals, so the second caller binds the other class instead.
! ---------------------------------------------------------------------------
run
Object
  subclass: 'SdDemoShadow'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

run
Object
  subclass: 'SdDemoShadowUserCaller'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

method: SdDemoShadowUserCaller
usesIt
  "References the SdDemoShadow in UserGlobals — the only one that exists yet."
  ^SdDemoShadow new
%

run
| d |
d := SymbolDictionary new.
d name: #SdDemoOtherDict.
System myUserProfile insertDictionary: d at: 1.
d
%

run
Object
  subclass: 'SdDemoShadow'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: (System myUserProfile symbolList at: 1)
  options: #()
%

run
Object
  subclass: 'SdDemoShadowOtherCaller'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()
%

method: SdDemoShadowOtherCaller
usesIt
  "Compiled after SdDemoOtherDict went in ahead of UserGlobals, so this binds the
   OTHER SdDemoShadow — the shadow, not the one SdDemoShadowUserCaller uses."
  ^SdDemoShadow new
%

run
| a b |
a := (SdDemoShadowUserCaller compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
b := (SdDemoShadowOtherCaller compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
(a value == b value)
  ifTrue: ['SHADOW SETUP FAILED — both callers reference the same class.']
  ifFalse: ['Shadow section loaded: the two callers reference different classes.']
%
