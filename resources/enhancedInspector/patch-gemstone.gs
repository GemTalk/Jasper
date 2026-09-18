! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin  : https://github.com/feenkcom/gt4gemstone
! Source  : src-gs/patch-gemstone.gs
! License : MIT - Copyright (c) 2021 feenk
!           Full MIT notice and permission text: THIRD-PARTY.md and
!           NOTICE at the root of https://github.com/GemTalk/Jasper
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - refreshed from upstream by
! update_enhanced_inspector_support.sh, then post-processed by
! gs-src/enhancedInspector/build/apply_jasper_transforms.sh, which writes this
! header from its attribution table and rewrites class placement from Globals
! to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! GT patches for GemStone
! These are modifications to the core GemStone code that can't be included
! as extension methods in git.

category: 'writing'
method: STONWriter
encodeCharacter: char
  | code encoding |
  ((code := char codePoint) < 127
    and: [ (encoding := STONCharacters at: code + 1) notNil ])
    ifTrue: [ (encoding = #'pass' or: [ jsonMode and: [ char = $' ] ])
        ifTrue: [ writeStream nextPut: char ]
        ifFalse: [ writeStream nextPutAll: encoding ] ]
    ifFalse: [ | paddedStream padding digits |
      paddedStream := WriteStream on: String new.
      code printOn: paddedStream base: 16 showRadix: false.
      digits := paddedStream contents.
      padding := 4 - digits size.
      writeStream nextPutAll: '\u'.
      encoding := padding > 0
        ifTrue: [ ((String new: padding)
            atAllPut: $0;
            yourself) , digits ]
        ifFalse: [ digits ].
      writeStream nextPutAll: encoding ]
%
