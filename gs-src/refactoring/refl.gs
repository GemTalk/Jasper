| cls m sels |
cls := Object subclass: 'ReflProbe' instVarNames: #('zz') classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals.
cls compileMethod: 'foo: aParam | t1 t2 | t1 := aParam. #(1) do: [:blkArg | | blkTemp | blkTemp := blkArg]. ^t1' dictionaries: System myUserProfile symbolList category: 'probe'.
m := cls compiledMethodAt: #foo:.
sels := #(#argNames #_argNames #temporaryNames #_temporaryNames #methodTemps #allTempNames #sourceTempNames #numArgs #numTemps).
(sels collect: [:s | | v |
   v := [ (m perform: s) printString ] on: Error, MessageNotUnderstood do: [:e | 'DNU' ].
   s printString, '=', v ]) printString
%%
System abortTransaction. 'aborted'
