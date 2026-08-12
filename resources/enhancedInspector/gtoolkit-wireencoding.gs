! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin : https://github.com/feenkcom/gtoolkit-wireencoding
! Source : src-gs/gtoolkit-wireencoding.gs
! License: MIT - Copyright (c) feenk gmbh. See LICENSE in the origin repository.
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - regenerated from upstream by
! update_gemstone_gt_support.sh, which re-applies this header and rewrites
! class placement from Globals to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! Class Declarations
! Generated file, do not Edit

doit
(Error
	subclass: 'GtWireUnsupportedObject'
	instVarNames: #(object)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireUnsupportedObject
removeallclassmethods GtWireUnsupportedObject

doit
(Object
	subclass: 'GtWireEncoderDecoder'
	instVarNames: #(stream map reverseMap classCache)
	classVars: #(GtDefaultMap GtDefaultReverseMap)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireEncoderDecoder
removeallclassmethods GtWireEncoderDecoder

doit
(GtWireEncoderDecoder
	subclass: 'GtWireDecoder'
	instVarNames: #(proxyObjectMap)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireDecoder
removeallclassmethods GtWireDecoder

doit
(GtWireDecoder
	subclass: 'GtWireInspectionDecoder'
	instVarNames: #(stack root byteArray)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireInspectionDecoder
removeallclassmethods GtWireInspectionDecoder

doit
(GtWireEncoderDecoder
	subclass: 'GtWireEncoder'
	instVarNames: #(defaultEncoder maxObjects objectCount remainingDepth maxDepthEncoder)
	classVars: #(DefaultEncoder)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireEncoder
removeallclassmethods GtWireEncoder

doit
(GtWireEncoder
	subclass: 'GtRemoteObjectWireEncoder'
	instVarNames: #(maxProxyDepth currentProxyDepth)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtRemoteObjectWireEncoder is used when all objects up to the specified depth are to be returned as remote objects, i.e. they are returned by value with a proxy object registered with GtRsrProxyServiceClient.';
		immediateInvariant.
true.
%

removeallmethods GtRemoteObjectWireEncoder
removeallclassmethods GtRemoteObjectWireEncoder

doit
(Object
	subclass: 'GtWireEncodingDummyProxy'
	instVarNames: #(description)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireEncodingDummyProxy
removeallclassmethods GtWireEncodingDummyProxy

doit
(Object
	subclass: 'GtWireEncodingExampleInstVarObject'
	instVarNames: #(var1 var2 var3 var4)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireEncodingExampleInstVarObject
removeallclassmethods GtWireEncodingExampleInstVarObject

doit
(Object
	subclass: 'GtWireEncodingExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding-Examples';
		immediateInvariant.
true.
%

removeallmethods GtWireEncodingExamples
removeallclassmethods GtWireEncodingExamples

doit
(Object
	subclass: 'GtWireEncodingInspectionObject'
	instVarNames: #(startIndex object decoder parent children components endIndex)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireEncodingInspectionObject
removeallclassmethods GtWireEncodingInspectionObject

doit
(Object
	subclass: 'GtWireGbsReplicationSpecConverter'
	instVarNames: #(maxDepth)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireGbsReplicationSpecConverter takes a dictionary of Gbs replicationSpecs and modifies the supplied {{gtClass:GtWireEncoder}} to match the dictionary.';
		immediateInvariant.
true.
%

removeallmethods GtWireGbsReplicationSpecConverter
removeallclassmethods GtWireGbsReplicationSpecConverter

doit
(Object
	subclass: 'GtWireGbsReplicationSpecConverterExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding-Examples';
		immediateInvariant.
true.
%

removeallmethods GtWireGbsReplicationSpecConverterExamples
removeallclassmethods GtWireGbsReplicationSpecConverterExamples

doit
(Object
	subclass: 'GtWireGbsReplicationSpecEncodingExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding-Examples';
		immediateInvariant.
true.
%

removeallmethods GtWireGbsReplicationSpecEncodingExamples
removeallclassmethods GtWireGbsReplicationSpecEncodingExamples

doit
(Object
	subclass: 'GtWireNestedEncodingExamples'
	instVarNames: #(signals)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding-Examples';
		immediateInvariant.
true.
%

removeallmethods GtWireNestedEncodingExamples
removeallclassmethods GtWireNestedEncodingExamples

doit
(Object
	subclass: 'GtWireObjectEncoder'
	instVarNames: #()
	classVars: #(DefaultMap)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireObjectEncoder
removeallclassmethods GtWireObjectEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireAssociationEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireAssociationEncoder
removeallclassmethods GtWireAssociationEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireBlockClosureEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireBlockClosureEncoder
removeallclassmethods GtWireBlockClosureEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireBooleanEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireBooleanEncoder
removeallclassmethods GtWireBooleanEncoder

doit
(GtWireBooleanEncoder
	subclass: 'GtWireFalseEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireFalseEncoder
removeallclassmethods GtWireFalseEncoder

doit
(GtWireBooleanEncoder
	subclass: 'GtWireTrueEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireTrueEncoder
removeallclassmethods GtWireTrueEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireByteArrayEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireByteArrayEncoder
removeallclassmethods GtWireByteArrayEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireCharacterArrayEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireCharacterArrayEncoder
removeallclassmethods GtWireCharacterArrayEncoder

doit
(GtWireCharacterArrayEncoder
	subclass: 'GtWireStringEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireStringEncoder
removeallclassmethods GtWireStringEncoder

doit
(GtWireCharacterArrayEncoder
	subclass: 'GtWireSymbolEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireSymbolEncoder
removeallclassmethods GtWireSymbolEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireCharacterEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireCharacterEncoder
removeallclassmethods GtWireCharacterEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireClassEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireClassEncoder passes class references by name, assuming that the local and remote class definitions are equivalent.';
		immediateInvariant.
true.
%

removeallmethods GtWireClassEncoder
removeallclassmethods GtWireClassEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireCollectionEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireCollectionEncoder
removeallclassmethods GtWireCollectionEncoder

doit
(GtWireCollectionEncoder
	subclass: 'GtWireArrayEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireArrayEncoder
removeallclassmethods GtWireArrayEncoder

doit
(GtWireCollectionEncoder
	subclass: 'GtWireDictionaryEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireDictionaryEncoder
removeallclassmethods GtWireDictionaryEncoder

doit
(GtWireCollectionEncoder
	subclass: 'GtWireOrderedCollectionEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireOrderedCollectionEncoder
removeallclassmethods GtWireOrderedCollectionEncoder

doit
(GtWireCollectionEncoder
	subclass: 'GtWireSetEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireSetEncoder
removeallclassmethods GtWireSetEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireDateAndTimeEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireDateAndTimeEncoder
removeallclassmethods GtWireDateAndTimeEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireDummyProxyEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireDummyProxyEncoder is used for testing as the real proxy encoders require the associated environment to be instantiated.';
		immediateInvariant.
true.
%

removeallmethods GtWireDummyProxyEncoder
removeallclassmethods GtWireDummyProxyEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireFloatEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireFloatEncoder
removeallclassmethods GtWireFloatEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireGemStoneOopEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireGemStoneOopEncoder
removeallclassmethods GtWireGemStoneOopEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireGemStoneRemoteObjectEncoder'
	instVarNames: #(encoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireGemStoneRemoteObjectEncoder is used in a replication spec to specify that instances of the registered class should be returned as remote objects, i.e. they are returned by value and a proxy is registered with GtRsrProxyServiceClient.

Note that GtWireGemStoneRemoteObjectEncoder has no typeIdentifier as it doesn''t directly encode objects, they are encoded by GtWireGemStoneWithRsrEncoder and the appropriate value encoder.';
		immediateInvariant.
true.
%

removeallmethods GtWireGemStoneRemoteObjectEncoder
removeallclassmethods GtWireGemStoneRemoteObjectEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireGemStoneRsrEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireGemStoneRsrEncoder is used to pass GemStone Rsr proxy objects via wire encoding.';
		immediateInvariant.
true.
%

removeallmethods GtWireGemStoneRsrEncoder
removeallclassmethods GtWireGemStoneRsrEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireGemStoneWithRsrEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireGemStoneWithRsrEncoder is used to pass a remote object back from GemStone to GT.

A remote object is one which is passed back by value, but is also registered with GtRsrProxyServiceClient so that it''s proxy object automatically accessible.

GtWireGemStoneWithRsrEncoder is not used directly in a replication spec, but either by the GtRemoteObjectWireEncoder or GtWireGemStoneRemoteObjectEncoder.';
		immediateInvariant.
true.
%

removeallmethods GtWireGemStoneWithRsrEncoder
removeallclassmethods GtWireGemStoneWithRsrEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireGsBareProxyEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireGsBareProxyEncoder
removeallclassmethods GtWireGsBareProxyEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireInstVarEncoder'
	instVarNames: #(instVarMap)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireInstVarEncoder uses the specified mapping to encode the supplied objects.  No mapping is required for decoding.';
		immediateInvariant.
true.
%

removeallmethods GtWireInstVarEncoder
removeallclassmethods GtWireInstVarEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireIntegerEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireIntegerEncoder
removeallclassmethods GtWireIntegerEncoder

doit
(GtWireIntegerEncoder
	subclass: 'GtWireNegativeIntegerEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireNegativeIntegerEncoder
removeallclassmethods GtWireNegativeIntegerEncoder

doit
(GtWireIntegerEncoder
	subclass: 'GtWirePositiveIntegerEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWirePositiveIntegerEncoder
removeallclassmethods GtWirePositiveIntegerEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireMaxDepthEncoder'
	instVarNames: #(depth encoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireMaxDepthEncoder
removeallclassmethods GtWireMaxDepthEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireMinDepthEncoder'
	instVarNames: #(depth encoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireMinDepthEncoder
removeallclassmethods GtWireMinDepthEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireNilEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireNilEncoder
removeallclassmethods GtWireNilEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireObjectByNameEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireObjectByNameEncoder
removeallclassmethods GtWireObjectByNameEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireReplicationEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		comment: 'GtWireReplicationEncoder uses the current mapping for the supplied object, unless it would return a type of proxy, in which case {{gtClass:GtWireObjectByNameEncoder}} is used.';
		immediateInvariant.
true.
%

removeallmethods GtWireReplicationEncoder
removeallclassmethods GtWireReplicationEncoder

doit
(GtWireObjectEncoder
	subclass: 'GtWireStonEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireStonEncoder
removeallclassmethods GtWireStonEncoder

doit
(Stream
	subclass: 'GtWireStream'
	instVarNames: #(wrappedStream)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-WireEncoding';
		immediateInvariant.
true.
%

removeallmethods GtWireStream
removeallclassmethods GtWireStream

! Class implementation for 'GtWireUnsupportedObject'

!		Class methods for 'GtWireUnsupportedObject'

category: 'signaling'
classmethod: GtWireUnsupportedObject
signal: anObject

	self new
		object: anObject;
		messageText: 'Unable to serialize', anObject class name;
		signal
%

!		Instance methods for 'GtWireUnsupportedObject'

category: 'accessing'
method: GtWireUnsupportedObject
object
	^ object
%

category: 'accessing'
method: GtWireUnsupportedObject
object: anObject
	object := anObject
%

! Class implementation for 'GtWireEncoderDecoder'

!		Class methods for 'GtWireEncoderDecoder'

category: 'maintenance'
classmethod: GtWireEncoderDecoder
generateDefaultGsMapMethod
	"Generate and save the defaultMap method for GS.
	Traversing a class hierarchy is very expensive, especially on GemStone.
	Generate a method to create the map by traversing the required class hierarchies."
	| mapping source |
	
	mapping := self defaultMapping.
	source := self generateDefaultGsMapMethodFrom: mapping.
	"How to compile on GemStone when under Rowan control?"
	"self class
		compileMethod: source
		dictionaries: GsCurrentSession currentSession symbolList
		category: '*GToolkit-WireEncoding-GemStone'
		environmentId: 0."
	^ source
%

category: 'maintenance'
classmethod: GtWireEncoderDecoder
generateDefaultGsMapMethodFrom: aDictionary
	"Answer the source code for the #defaultMap method from the supplied map dictionary.
	.gs files don't allow undeclared classes to be referenced... 
	hack around it by deferring class lookup."
	| source |

	source := String streamContents: [ :stream |
		stream
			<< 'getDefaultMap'; lf;
			tab; << '"Generated by #generateDefaultMapMethodFrom:.'; lf;
			tab; << 'Original source is #defaultMapping, changes should be made there and the code regenerated."'; lf;
			lf;
			tab; << '^ IdentityDictionary new'; lf.
		(aDictionary keys asSortedCollection: [ :a :b | a name < b name ]) do: [ :key |
				stream
					tab; tab; << 'at: ((self lookupClass: #';
					<< key name;
					<< (') ifNil: [ self error: ''Unable to find: ', key name asString, ''' ]) put: ');
					<< (aDictionary at: key) class name;
					<< ' new' ]
			separatedBy: [ stream << ';'; lf ].
		stream
			<< ';'; lf;
			tab; tab; << 'yourself.'; lf ].
	^ source
%

category: 'maintenance'
classmethod: GtWireEncoderDecoder
generateDefaultGsReverseMapMethod
	"Generate and save the defaultMap method for GS.
	Traversing a class hierarchy is very expensive, especially on GemStone.
	Generate a method to create the map by traversing the required class hierarchies."
	| reverse source |
	
	reverse := self reverseMapFrom: self defaultMapping.
	source := self generateDefaultReverseMapMethodFrom: reverse.
	"How to compile on GemStone when under Rowan control?"
	"self class
		compileMethod: source
		dictionaries: GsCurrentSession currentSession symbolList
		category: '*GToolkit-WireEncoding-GemStone'
		environmentId: 0."
	^ source
%

category: 'maintenance'
classmethod: GtWireEncoderDecoder
generateDefaultGtMapMethod
	"Generate and save the defaultMap method for Gt.
	Traversing a class hierarchy is very expensive, especially on GemStone.
	Generate a method to create the map by traversing the required class hierarchies."
	| mapping source reverse |

	mapping := self defaultMapping.
	source := self generateDefaultMapMethodFrom: mapping.
	self class
		compile: source
		classified: '*GToolkit-WireEncoding-GT'.

	reverse := self reverseMapFrom: mapping.
	source := self generateDefaultReverseMapMethodFrom: reverse.
	self class
		compile: source
		classified: '*GToolkit-WireEncoding-GT'.
	self  initialize.
%

category: 'maintenance'
classmethod: GtWireEncoderDecoder
generateDefaultMapMethodFrom: aDictionary
	"Answer the source code for the #defaultMap method from the supplied map dictionary"
	| source |

	source := String streamContents: [ :stream |
		stream
			<< 'getDefaultMap'; lf;
			tab; << '"Generated by #generateDefaultMapMethodFrom:.'; lf;
			tab; << 'Original source is #defaultMapping, changes should be made there and the code regenerated."'; lf;
			lf;
			tab; << '^ IdentityDictionary new'; lf.
		(aDictionary keys asSortedCollection: [ :a :b | a name < b name ]) do: [ :key |
				stream
					tab; tab; << 'at: ';
					<< key name;
					<< ' put: ';
					<< (aDictionary at: key) class name;
					<< ' new' ]
			separatedBy: [ stream << ';'; lf ].
		stream
			<< ';'; lf;
			tab; tab; << 'yourself.'; lf ].
	^ source
%

category: 'utilities'
classmethod: GtWireEncoderDecoder
generateDefaultReverseMapMethodFrom: aDictionary
	"Answer the source code for the #defaultMap method from the supplied map dictionary"
	| source maxKey |

	maxKey := aDictionary keys asArray max.
	source := String streamContents: [ :stream |
		stream
			<< 'getDefaultReverseMap'; lf;
			tab; << '"Generated by #generateDefaultReverseMapMethodFrom:.'; lf;
			tab; << 'Original source is #defaultMapping, changes should be made there and the code regenerated."'; lf;
			lf;
			tab; << '^ (Array new: ';
			<< maxKey asString;
			<< ')'; lf.
		aDictionary keys asSortedCollection do: [ :key |
				stream
					tab; tab; << 'at: ';
					<< key asString;
					<< ' put: ';
					<< (aDictionary at: key) class name;
					<< ' new' ]
			separatedBy: [ stream << ';'; lf ].
		stream
			<< ';'; lf;
			tab; tab; << 'yourself.'; lf ].
	^ source
%

category: 'initialization'
classmethod: GtWireEncoderDecoder
initialize
	"NOTE: GtDefaultMap and GtDefaultReverseMap should only be used on GT.
	On GemStone they should always be nil."

	GtDefaultMap := GtDefaultReverseMap := nil
%

category: 'private'
classmethod: GtWireEncoderDecoder
lookupClass: className
	"Answer the class with the supplied name or nil if not found.
	For GemStone, see STONReader>>lookupClass: for inspiration."

	^ self
		gtDo: [ self class environment classOrTraitNamed: className ]
		gemstoneDo: [ System myUserProfile objectNamed: className asSymbol ]
%

category: 'private'
classmethod: GtWireEncoderDecoder
map: aClass withSubclassesTo: anEncoder in: mapping
	"Add the mapping for aClass and all its subclasses"
	
	"GemStone doesn't have #withAllSubclasses"
	mapping at: aClass put: anEncoder.
	aClass allSubclasses do: [ :cls |
		mapping at: cls put: anEncoder ].
%

category: 'accessing'
classmethod: GtWireEncoderDecoder
reverseMapFrom: aDictionary
	"Construct the reverse map.
	Build a default reverse map and then  overwrite with the supplied configured encoders."
	| reverseMap |

	reverseMap := IdentityDictionary new.
	GtWireObjectEncoder allSubclasses do: [ :cls |
		cls typeIdentifierOrNil ifNotNil:
			[ :id | reverseMap at: id put: cls new ] ].
	aDictionary associationsDo: [ :assoc |
		assoc value class typeIdentifierOrNil ifNotNil: [ :id |
			reverseMap at: id put: assoc value ] ].
	^ reverseMap
%

!		Instance methods for 'GtWireEncoderDecoder'

category: 'accessing'
method: GtWireEncoderDecoder
addMapping: aClass to: anEncoder
	"Add/Overwrite the supplied encoder.
	Be careful not to accidentally overwrite the default map unintentionally."
	| typeIdentifier |
	
	self map at: aClass put: anEncoder.
	typeIdentifier := anEncoder class typeIdentifierOrNil.
	typeIdentifier ifNotNil:
		[ self reverseMap at: typeIdentifier put: anEncoder ]
%

category: 'as yet unclassified'
method: GtWireEncoderDecoder
classCache

	^ classCache ifNil: [ classCache := Dictionary new ]
%

category: 'accessing'
method: GtWireEncoderDecoder
contents

	^ stream contents
%

category: 'testing'
method: GtWireEncoderDecoder
hasValidConfiguration

	^ (self map values allSatisfy: [ :each | each hasValidConfiguration ]) and:
		[ self reverseMap allSatisfy: [ :each | each hasValidConfiguration ] ]
%

category: 'accessing'
method: GtWireEncoderDecoder
map

	^ map ifNil: 
		[ reverseMap := self class defaultReverseMap copy.
		map := self class defaultMap copy ]
%

category: 'accessing'
method: GtWireEncoderDecoder
map: aDictionary

	map := aDictionary.
	reverseMap := nil.
%

category: 'copying'
method: GtWireEncoderDecoder
postCopy

	super postCopy.
	stream := stream copy.
%

category: 'private - helpers'
method: GtWireEncoderDecoder
replaceMappingsMatching: matchBlock with: replacementBlock
	"Replace all the mappings matching matchBlock with the encoder returned by replacementBlock.
	Used by examples to avoid needing live servers."

	self map associationsDo: [ :assoc |
		(matchBlock value: assoc value) ifTrue:
			[ assoc value: replacementBlock value ]
		ifFalse:
			[ assoc value replaceMappingsMatching: matchBlock with: replacementBlock ] ]
%

category: 'initialization'
method: GtWireEncoderDecoder
reset

	stream reset
%

category: 'accessing'
method: GtWireEncoderDecoder
reverseMap

	^ reverseMap ifNil: 
		[ "Requesting the map will potentially also load the reverseMap.
		Check if it still needs to be calculated."
		self map.
		reverseMap ifNil:
			[ reverseMap := self class defaultReverseMap ] ]
%

category: 'accessing'
method: GtWireEncoderDecoder
reverseMap: anObject
	reverseMap := anObject
%

category: 'accessing'
method: GtWireEncoderDecoder
stream

	^ stream ifNil: [ stream := GtWireStream on:
		(ByteArray new: 64 * 1024) ]
%

category: 'accessing'
method: GtWireEncoderDecoder
stream: aGtWireReadWriteStream

	stream := aGtWireReadWriteStream
%

! Class implementation for 'GtWireDecoder'

!		Class methods for 'GtWireDecoder'

category: 'instance creation'
classmethod: GtWireDecoder
on: aReadStream

	^ self basicNew initialize stream:
		(GtWireStream on: aReadStream)
%

!		Instance methods for 'GtWireDecoder'

category: 'accessing'
method: GtWireDecoder
next
	| type |

	type := self nextTypeIdentifier.
	^ (self reverseMap at: type) decodeWith: self.
%

category: 'decoding'
method: GtWireDecoder
nextByteArray

	^ stream next: self nextSize
%

category: 'decoding'
method: GtWireDecoder
nextFloat64

	^ stream float64
%

category: 'decoding'
method: GtWireDecoder
nextInt64

	^ stream int64
%

category: 'decoding'
method: GtWireDecoder
nextPackedInteger

	^ stream packedInteger
%

category: 'decoding'
method: GtWireDecoder
nextSize

	^ stream packedInteger
%

category: 'decoding'
method: GtWireDecoder
nextString
	"Answer the next string.
	GemStone requires conversion from a Unicode object to a String (asString)"

	^ (stream next: self nextSize) utf8Decoded asString
%

category: 'decoding'
method: GtWireDecoder
nextTypeIdentifier

	^ stream packedInteger
%

! Class implementation for 'GtWireInspectionDecoder'

!		Class methods for 'GtWireInspectionDecoder'

category: 'instance creation'
classmethod: GtWireInspectionDecoder
byteArray: aByteArray

	^ (self on: aByteArray readStream)
		byteArray: aByteArray;
		next;
		root
%

!		Instance methods for 'GtWireInspectionDecoder'

category: 'accessing'
method: GtWireInspectionDecoder
byteArray
	^ byteArray
%

category: 'accessing'
method: GtWireInspectionDecoder
byteArray: anObject
	byteArray := anObject
%

category: 'initialization'
method: GtWireInspectionDecoder
initialize

	super initialize.
	"Use an OrderedCollection for the stack since GemStone doesn't have a Stack"
	stack := OrderedCollection new.
%

category: 'accessing'
method: GtWireInspectionDecoder
next
	| inspectionObject object parent |

	inspectionObject := GtWireEncodingInspectionObject new.
	root ifNil: [ root := inspectionObject ].
	parent := stack
			ifEmpty: [ nil ]
			ifNotEmpty: [ stack last ].
	inspectionObject 
		parent: parent;
		startIndex: stream position + 1;
		decoder: self.
	stack addLast: inspectionObject.
	object := super next.
	inspectionObject 
		object: object;
		endIndex: stream position.
	parent ifNotNil: [ parent addComponent: #object ->inspectionObject ].
	stack removeLast.
	^ object
%

category: 'accessing'
method: GtWireInspectionDecoder
nextByteArray
	| ba |
	ba := super nextByteArray.
	stack last addComponent: #byteArray -> ba.
	^ ba.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextFloat64
	| float64 |

	float64 := super nextFloat64.
	stack last addComponent: #float64 -> float64.
	^ float64.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextInt64
	| int64 |

	int64 := super nextInt64.
	stack last addComponent: #int64 -> int64.
	^ int64.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextPackedInteger
	| packedInteger |

	packedInteger := super nextPackedInteger.
	stack last addComponent: #packedInteger -> packedInteger.
	^ packedInteger.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextSize
	| size |

	size := super nextSize.
	stack last addComponent: #size -> size.
	^ size.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextString
	| string |

	string := super nextString.
	stack last addComponent: #string -> string.
	^ string.
%

category: 'accessing'
method: GtWireInspectionDecoder
nextTypeIdentifier
	| typeIdentifier |

	typeIdentifier := super nextTypeIdentifier.
	stack last addComponent: #typeIdentifier -> typeIdentifier.
	^ typeIdentifier.
%

category: 'accessing'
method: GtWireInspectionDecoder
root
	^ root
%

! Class implementation for 'GtWireEncoder'

!		Class methods for 'GtWireEncoder'

category: 'accessing'
classmethod: GtWireEncoder
byNameEncoder

	^ [ :anObject | GtWireObjectByNameEncoder new ]
%

category: 'cleanup'
classmethod: GtWireEncoder
cleanUp

	DefaultEncoder := nil
%

category: 'accessing'
classmethod: GtWireEncoder
defaultEncoder
	"Answer the default encoder.
	Normally fall back to encoding objects by name."

	^ DefaultEncoder ifNil: [ self byNameEncoder ]
%

category: 'accessing'
classmethod: GtWireEncoder
defaultEncoder: aBlockClosure

	DefaultEncoder := aBlockClosure
%

category: 'testing'
classmethod: GtWireEncoder
hasDefaultEncoder

	^ DefaultEncoder isNotNil
%

category: 'instance creation'
classmethod: GtWireEncoder
on: aWriteStream

	^ self basicNew initialize stream:
		(GtWireStream on: aWriteStream)
%

category: 'instance creation'
classmethod: GtWireEncoder
onByteArray

	^ self on: (WriteStream on: (ByteArray new: 100))
%

!		Instance methods for 'GtWireEncoder'

category: 'accessing'
method: GtWireEncoder
decoderOn: aReadStream
	| decoder |
	
	decoder := GtWireDecoder on: aReadStream.
	decoder 
		map: self map;
		reverseMap: self reverseMap.
	^ decoder
%

category: 'accessing'
method: GtWireEncoder
defaultEncoder

	^ defaultEncoder ifNil: [ defaultEncoder := self class defaultEncoder ]
%

category: 'accessing'
method: GtWireEncoder
defaultEncoder: anObject
	defaultEncoder := anObject
%

category: 'initialization'
method: GtWireEncoder
initialize

	super initialize.
	maxObjects := 5000000.
	objectCount := 0.
	remainingDepth := maxObjects.
	maxDepthEncoder := GtWireNilEncoder new.
%

category: 'accessing'
method: GtWireEncoder
isMaxDepthLiteral: anObject
	"Answer a boolean indicating whether the supplied object is considered a literal, and so can be returned even if the max depth has been reached.
	Based on observed behaviour by GemStone Gbs."

	^ { Number. String. Boolean. } anySatisfy: [ :cls |
		anObject isKindOf: cls ].
%

category: 'accessing'
method: GtWireEncoder
maxDepthEncoder
	^ maxDepthEncoder
%

category: 'accessing'
method: GtWireEncoder
maxDepthEncoder: anObject
	maxDepthEncoder := anObject
%

category: 'accessing'
method: GtWireEncoder
maxObjects
	"Answer the maximum number of objects encoded.
	This is intended as a guard against infinite recursion and is only approximate,
	as enforcing max or min depth is currently counted as an object."
	<return: #Integer>

	^ maxObjects
%

category: 'accessing'
method: GtWireEncoder
maxObjects: anInteger
	"Set the maximum number of objects encoded.
	This is intended as a guard against infinite recursion and is only approximate,
	as enforcing max or min depth is currently counted as an object."

	maxObjects := anInteger
%

category: 'accessing'
method: GtWireEncoder
nextPut: anObject

	self nextPut: anObject objectEncoder: nil
%

category: 'private - encoding'
method: GtWireEncoder
nextPut: anObject objectEncoder: objectEncoder
	| saveDepth |
	objectCount > maxObjects
		ifTrue: [ self error: 'Exceeded maximum object count' ].
	remainingDepth := remainingDepth - 1.
	[ saveDepth := remainingDepth.
	"remainingDepth includes the first (root) object, so compare to -1."
	remainingDepth < 0 ifTrue: 
		[ (self isMaxDepthLiteral: anObject)
			ifTrue: [ self privateNextPutMapEncoded: anObject objectEncoder: objectEncoder ]
			ifFalse: [ maxDepthEncoder encode: anObject with: self ] ]
		ifFalse:
			[ self privateNextPutMapEncoded: anObject objectEncoder: objectEncoder ] ]
				ensure: [ remainingDepth := remainingDepth + 1 ].
%

category: 'accessing'
method: GtWireEncoder
objectEncoderFor: anObject
	"Answer the encoder for anObject.
	Classes (and meta-classes) are a special case as asking a class for its class doesn't result in a unique class."

	anObject isClass ifTrue:
		[ ^ GtWireClassEncoder new ].
	^ self map  at: anObject class ifAbsent: [ self defaultEncoder value: anObject ]
%

category: 'accessing'
method: GtWireEncoder
privateNextPutMapEncoded: anObject

	(self objectEncoderFor: anObject)
		encode: anObject
		with: self
%

category: 'accessing'
method: GtWireEncoder
privateNextPutMapEncoded: anObject objectEncoder: objectEncoder

	(objectEncoder ifNil: [ self objectEncoderFor: anObject ])
			encode: anObject
			with: self.
	objectCount := objectCount + 1.
%

category: 'private - encoding'
method: GtWireEncoder
putByteArray: aByteArray

	self putSize: aByteArray size.
	stream nextPutAll: aByteArray.
%

category: 'private - encoding'
method: GtWireEncoder
putFloat64: aFloat

	"GtWireEncodingFloat64Signal new
		float: aFloat;
		emit."
	stream float64: aFloat.
%

category: 'private - encoding'
method: GtWireEncoder
putInt64: anInteger

	"GtWireEncodingInt64Signal new
		integer: anInteger;
		emit."
	stream int64: anInteger.
%

category: 'accessing'
method: GtWireEncoder
putNil

	self putTypeIdentifier: GtWireNilEncoder typeIdentifier.
%

category: 'private - encoding'
method: GtWireEncoder
putPackedInteger: aPositiveInteger

	"GtWireEncodingPositiveIntegerSignal new
		integer: aPositiveInteger;
		emit."
	stream packedInteger: aPositiveInteger.
%

category: 'private - encoding'
method: GtWireEncoder
putSize: anInteger

	"GtWireEncodingSizeSignal new
		size: anInteger;
		emit."
	stream packedInteger: anInteger.
%

category: 'private - encoding'
method: GtWireEncoder
putString: aString
	| encoded |

	encoded := aString utf8Encoded.
	self putSize: encoded size.
	stream nextPutAll: encoded.
%

category: 'private - encoding'
method: GtWireEncoder
putTypeIdentifier: anInteger

	"GtWireEncodingTypeIdentifierSignal new
		typeIdentifier: anInteger;
		emit."
	stream packedInteger: anInteger.
%

category: 'accessing'
method: GtWireEncoder
remainingDepth
	^ remainingDepth
%

category: 'accessing'
method: GtWireEncoder
remainingDepth: anInteger
	"Set the remaining depth.
	The count includes the first (root) or current object."

	remainingDepth := anInteger
%

category: 'initialization'
method: GtWireEncoder
reset

	super reset.
	objectCount := 0.
%

! Class implementation for 'GtRemoteObjectWireEncoder'

!		Instance methods for 'GtRemoteObjectWireEncoder'

category: 'accessing'
method: GtRemoteObjectWireEncoder
currentProxyDepth
	^ currentProxyDepth
%

category: 'accessing'
method: GtRemoteObjectWireEncoder
currentProxyDepth: anObject
	^ currentProxyDepth := anObject
%

category: 'initialization'
method: GtRemoteObjectWireEncoder
initialize
	super initialize.
	currentProxyDepth := -1
%

category: 'accessing'
method: GtRemoteObjectWireEncoder
maxProxyDepth
	"Answer the maximum depth to which proxy objects will be returned along with the object by value.
	nil = unlimited"

	^ maxProxyDepth
%

category: 'accessing'
method: GtRemoteObjectWireEncoder
maxProxyDepth: anIntegerOrNil

	maxProxyDepth := anIntegerOrNil
%

category: 'private - encoding'
method: GtRemoteObjectWireEncoder
nextPut: anObject objectEncoder: objectEncoder
	currentProxyDepth := currentProxyDepth + 1.
	^ [ super nextPut: anObject objectEncoder: objectEncoder ] 
		ensure: [ currentProxyDepth := currentProxyDepth - 1 ]
%

category: 'encoding'
method: GtRemoteObjectWireEncoder
privateNextPutMapEncoded: anObject objectEncoder: objectEncoder
	| encoder |
	
	encoder := objectEncoder ifNil:
		[ self map at: anObject class ifAbsent: [ self defaultEncoder value: anObject ] ].
	(anObject isNil or: 
	[ encoder isProxyObjectEncoder or:
	[ self shouldEncodeWithProxyAtCurrentDepth not ] ]) ifTrue:
		[ encoder encode: anObject with: self. ]
	ifFalse:
		[ GtWireGemStoneWithRsrEncoder new encode: anObject with: self objectEncoder: encoder ].
	objectCount := objectCount + 1.
%

category: 'testing'
method: GtRemoteObjectWireEncoder
shouldEncodeWithProxyAtCurrentDepth
	maxProxyDepth ifNil: [ ^ true ].
	^ currentProxyDepth <= maxProxyDepth
%

! Class implementation for 'GtWireEncodingDummyProxy'

!		Instance methods for 'GtWireEncodingDummyProxy'

category: 'accessing'
method: GtWireEncodingDummyProxy
description
	^ description
%

category: 'accessing'
method: GtWireEncodingDummyProxy
description: anObject
	description := anObject
%

! Class implementation for 'GtWireEncodingExampleInstVarObject'

!		Class methods for 'GtWireEncodingExampleInstVarObject'

category: 'accessing'
classmethod: GtWireEncodingExampleInstVarObject
leJsonV4Name

	^  #gtWireEncodingExampleInstVarObject
%

!		Instance methods for 'GtWireEncodingExampleInstVarObject'

category: 'as yet unclassified'
method: GtWireEncodingExampleInstVarObject
= anObject

	self == anObject ifTrue: [ ^ true ].
	anObject class = self class ifFalse: [ ^ false ].
	^ anObject var1 = var1 and:
		[ anObject var2 = var2 and:
		[ anObject var3 = var3 and:
		[ anObject var4 = var4 ] ] ]
%

category: 'as yet unclassified'
method: GtWireEncodingExampleInstVarObject
hash

	^ var1 hash bitXor:
		(var2 hash bitXor:
		(var3 hash bitXor:
		var4 hash))
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var1
	^ var1
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var1: anObject
	var1 := anObject
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var2
	^ var2
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var2: anObject
	var2 := anObject
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var3
	^ var3
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var3: anObject
	var3 := anObject
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var4
	^ var4
%

category: 'accessing'
method: GtWireEncodingExampleInstVarObject
var4: anObject
	var4 := anObject
%

! Class implementation for 'GtWireEncodingExamples'

!		Instance methods for 'GtWireEncodingExamples'

category: 'examples'
method: GtWireEncodingExamples
array
	<gtExample>
	<return: #ByteArray>
	| array encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	array := {1.
			'hello'.
			#hello}.
	encoder nextPut: array.
	byteArray := encoder contents.
	self assert: byteArray size equals: 18.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next = array.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
association
	<gtExample>
	<return: #GtWireEncodingExamples>
	| association encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	association := 1 -> 'one'.
	encoder nextPut: association.
	byteArray := encoder contents.
	self assert: byteArray size equals: 8.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Association.
	self assert: next = association
%

category: 'examples'
method: GtWireEncodingExamples
blockClosure
	<gtExample>
	<return: #ByteArray>
	| blockClosure encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	blockClosure := [ :a :b | a + b ].
	encoder nextPut: blockClosure.
	byteArray := encoder contents.
	self assert: byteArray size equals: 20.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: (#(FullBlockClosure ExecBlock) includes: next class name).
	self assert: (next value: 4 value: 3) equals: 7.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
boolean
	<gtExample>
	<return: #GtWireEncodingExamples>
	| encoder byteArray decoder |
	encoder := GtWireEncoder onByteArray.
	encoder nextPut: true.
	encoder nextPut: false.
	byteArray := encoder contents.
	self assert: byteArray size equals: 2.
	decoder := GtWireDecoder on: byteArray readStream.
	self assert: decoder next.
	self assert: decoder next not
%

category: 'examples'
method: GtWireEncodingExamples
byteArray
	<gtExample>
	<return: #GtWireEncodingExamples>
	| source encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	source := #[3 1 4 1 5].
	encoder nextPut: source.
	byteArray := encoder contents.
	self assert: byteArray size equals: source size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: ByteArray.
	self assert: next equals: source
%

category: 'examples'
method: GtWireEncodingExamples
byteString
	<gtExample>
	<return: #ByteArray>
	| string encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	string := 'Hello, World'.
	encoder nextPut: string.
	byteArray := encoder contents.
	self assert: byteArray size equals: string size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: (#(ByteString String) includes: next class name).
	self assert: next equals: string.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
byteStringWithNull
	<gtExample>
	<return: #ByteArray>
	| string encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	string := 'abc' , (String with: Character null) , 'def'.
	encoder nextPut: string.
	byteArray := encoder contents.
	self assert: byteArray size equals: string size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: (#(ByteString String) includes: next class name).
	self assert: next equals: string.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
byteSymbol
	<gtExample>
	<return: #ByteArray>
	| string encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	string := #'Hello, World'.
	encoder nextPut: string.
	byteArray := encoder contents.
	self assert: byteArray size equals: string size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.	"Allow for differences in GT & GS class hierarchy"
	self assert: (#(ByteSymbol Symbol) includes: next class name).
	self assert: next equals: string.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
character
	<gtExample>
	<return: #GtWireEncodingExamples>
	| encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	encoder nextPut: $§.
	byteArray := encoder contents.
	self assert: byteArray size equals: 3.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Character.
	self assert: next == $§
%

category: 'examples'
method: GtWireEncodingExamples
classByName
	<gtExample>
	| exampleClass encoder byteArray next |
	
	encoder := GtWireEncoder onByteArray.
	exampleClass := Array.
	encoder nextPut: exampleClass.
	byteArray := encoder contents.
	self assert: byteArray size equals: exampleClass name size + 3.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next identicalTo: exampleClass.
%

category: 'examples'
method: GtWireEncodingExamples
dateAndTime
	<gtExample>
	<return: #GtWireEncodingExamples>
	| dateAndTime encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	dateAndTime := DateAndTime now.
	encoder nextPut: dateAndTime.
	byteArray := encoder contents.
	self assert: (byteArray size between: 10 and: 25).
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: (next isKindOf: DateAndTime).
	self assert: next = dateAndTime
%

category: 'examples'
method: GtWireEncodingExamples
deepArray
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	array := Array new: 2.
	currentArray := array.
	1
		to: 5
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	encoder nextPut: array.
	byteArray := encoder contents.
	self assert: byteArray size equals: 24.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next = array.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
dictionary
	<gtExample>
	<return: #GtWireEncodingExamples>
	| dictionary encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	dictionary := {1 -> 'one'.
			2 -> 'two'} asDictionary.
	encoder nextPut: dictionary.
	byteArray := encoder contents.
	self assert: byteArray size equals: 16.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Dictionary.
	self assert: next = dictionary
%

category: 'examples'
method: GtWireEncodingExamples
encoderDecoderHasInvalidConfigurationWithInvalidMapping
	<gtExample>
	| encoder |
	encoder := GtWireEncoder onByteArray.
	encoder addMapping: Object to: GtWireGemStoneRemoteObjectEncoder new.
	self assert: encoder hasValidConfiguration not.
	^ encoder
%

category: 'examples'
method: GtWireEncodingExamples
encoderDecoderHasValidConfigurationWithDefaultMap
	<gtExample>
	| encoder |
	encoder := GtWireEncoder onByteArray.
	self assert: encoder hasValidConfiguration.
	^ encoder
%

category: 'examples'
method: GtWireEncodingExamples
encoderHasValidConfigurationByDefault
	<gtExample>
	| encoder |
	encoder := GtWireObjectEncoder new.
	self assert: encoder hasValidConfiguration.
	^ encoder
%

category: 'examples'
method: GtWireEncodingExamples
float
	<gtExample>
	<return: #GtWireEncodingExamples>
	| encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	{Float fmin.
		Float fmax.
		1.25}
		doWithIndex: [ :f :i | 
			encoder reset.
			encoder nextPut: f.
			byteArray := encoder contents.
			self assert: byteArray size equals: 9.
			next := (GtWireDecoder on: byteArray readStream) next.
			self assert: next equals: f ]
%

category: 'examples'
method: GtWireEncodingExamples
gemStoneRemoteObjectEncoderHasInvalidConfigurationWithoutEncoder
	<gtExample>
	| encoder |
	encoder := GtWireGemStoneRemoteObjectEncoder new.
	self assert: encoder hasValidConfiguration not.
	^ encoder
%

category: 'examples'
method: GtWireEncodingExamples
generalObject
	<gtExample>
	<return: #GtWireEncodingExamples>
	| object encoder byteArray next root |
	encoder := GtWireEncoder onByteArray.
	object := self
			gtDo: [ (self class environment classOrTraitNamed: #AdditionalMethodState) new: 3 ]
			gemstoneDo: [ ^ self ].
	object
		selector: #one;
		method: 'fake'.
	1 to: 3 do: [ :i | object basicAt: i put: 2 ** i ].
	encoder nextPut: object.
	byteArray := encoder contents.
	self assert: byteArray size equals: 60.
	root := GtWireInspectionDecoder byteArray: byteArray.
	next := root object.
	self assert: (#(AdditionalMethodState) includes: next class name).
	self assert: next basicSize equals: 3.
	1 to: 3 do: [ :i | self assert: (next basicAt: i) equals: 2 ** i ].
	self assert: next selector equals: #one.
	self assert: next method equals: 'fake'
%

category: 'examples'
method: GtWireEncodingExamples
maxDepth
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	array := Array new: 2.
	currentArray := array.
	1
		to: 5
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	encoder
		remainingDepth: 2;
		nextPut: array.
	byteArray := encoder contents.
	self assert: byteArray size equals: 9.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next first equals: 1.
	next := next second.
	self assert: next equals: #(2 nil).
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
metaClassByName
	<gtExample>
	| exampleClass encoder byteArray next |
	
	encoder := GtWireEncoder onByteArray.
	exampleClass := Array class.
	encoder nextPut: exampleClass.
	byteArray := encoder contents.
	self assert: byteArray size equals: exampleClass instanceSide name size + 3.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next identicalTo: exampleClass.
%

category: 'examples'
method: GtWireEncodingExamples
nil
	<gtExample>
	<return: #GtWireEncodingExamples>
	| encoder byteArray |
	encoder := GtWireEncoder onByteArray.
	encoder nextPut: nil.
	byteArray := encoder contents.
	self assert: byteArray size equals: 1.
	self assert: (GtWireDecoder on: byteArray readStream) next isNil
%

category: 'examples'
method: GtWireEncodingExamples
orderedCollection
	<gtExample>
	<return: #GtWireEncodingExamples>
	| orderedCollection encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	orderedCollection := {1.
			'hello'.
			#hello} asOrderedCollection.
	encoder nextPut: orderedCollection.
	byteArray := encoder contents.
	self assert: byteArray size equals: 18.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: OrderedCollection.
	self assert: next = orderedCollection
%

category: 'examples'
method: GtWireEncodingExamples
packedInteger
	<gtExample>
	<return: #GtWireEncodingExamples>
	| encoder byteArray integer |
	encoder := GtWireEncoder onByteArray.
	encoder nextPut: 0.
	byteArray := encoder contents.
	self assert: byteArray equals: #[13 0].
	self assert: (GtWireDecoder on: byteArray readStream) next equals: 0.
	integer := 1.	"GemStone is slow at this test, if it works in GT for the full range, testing a small range in
	GemStone is probably enough"
	[ integer < ((self gtDo: [ SmallInteger maxVal ] gemstoneDo: [ 10 ]) * 10) ]
		whileTrue: [ encoder reset.
			encoder nextPut: integer.
			byteArray := encoder contents.
			self assert: (GtWireDecoder on: byteArray readStream) next equals: integer.
			encoder reset.
			encoder nextPut: integer negated.
			byteArray := encoder contents.
			encoder reset.
			self
				assert: (GtWireDecoder on: byteArray readStream) next
				equals: integer negated.
			integer := (1.001 * integer) ceiling ]
%

category: 'examples'
method: GtWireEncodingExamples
set
	<gtExample>
	<return: #GtWireEncodingExamples>
	| set encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	set := {1.
			'hello'.
			true} asSet.
	encoder nextPut: set.
	byteArray := encoder contents.
	self assert: byteArray size equals: 12.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Set.
	self assert: next = set
%

category: 'examples'
method: GtWireEncodingExamples
wideString
	<gtExample>
	<return: #ByteArray>
	| string encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	string := 'čtyři'.
	encoder nextPut: string.
	byteArray := encoder contents.
	self assert: byteArray size equals: string asString utf8Encoded size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self
		assert: (#(WideString DoubleByteString Unicode16) includes: next class name).
	self assert: next equals: string.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
wideStringWithNull
	<gtExample>
	<return: #ByteArray>
	| string encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	string := 'čty' , (String with: Character null) , 'ři'.
	encoder nextPut: string.
	byteArray := encoder contents.
	self assert: byteArray size equals: string asString utf8Encoded size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self
		assert: (#(WideString DoubleByteString Unicode16) includes: next class name).
	self assert: next equals: string.
	^ byteArray
%

category: 'examples'
method: GtWireEncodingExamples
wideSymbol
	<gtExample>
	<return: #GtWireEncodingExamples>
	| wideSymbol encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	wideSymbol := #'kancelař'.
	encoder nextPut: wideSymbol.
	byteArray := encoder contents.
	self assert: byteArray size equals: wideSymbol asString utf8Encoded size + 2.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: (#(WideSymbol DoubleByteSymbol) includes: next class name).
	self assert: next equals: wideSymbol
%

! Class implementation for 'GtWireEncodingInspectionObject'

!		Instance methods for 'GtWireEncodingInspectionObject'

category: 'accessing'
method: GtWireEncodingInspectionObject
addComponent: anObject

	components add: anObject
%

category: 'accessing'
method: GtWireEncodingInspectionObject
byteArray

	^ decoder byteArray
%

category: 'accessing'
method: GtWireEncodingInspectionObject
decoder
	^ decoder
%

category: 'accessing'
method: GtWireEncodingInspectionObject
decoder: anObject
	decoder := anObject
%

category: 'accessing'
method: GtWireEncodingInspectionObject
endIndex
	^ endIndex
%

category: 'accessing'
method: GtWireEncodingInspectionObject
endIndex: anObject
	endIndex := anObject
%

category: 'ui'
method: GtWireEncodingInspectionObject
gtChildrenFor: aView
	<gtView>

	^ aView columnedList
		  title: 'Components';
		  priority: 15;
		  items: [ components ];
		  column: 'Field' text: [ :item | item key ];
		  column: 'Value' text: [ :item | item value ];
		  send: [ :item | item value ];
		  actionUpdateButton
%

category: 'ui'
method: GtWireEncodingInspectionObject
gtHexDumpFor: aView
	<gtView>

	^ aView forward
		title: 'Buffer';
		priority: 20;
		object: [ self objectByteArray ];
		view: #gtHexDumpFor:
%

category: 'ui'
method: GtWireEncodingInspectionObject
gtSummaryFor: aView
	<gtView>

	^ aView columnedList
		  title: 'Summary';
		  priority: 10;
		  items: [ self summaryAttributes ];
		  column: #Attribute text: [ :item | item first ];
		  column: #Value text: [ :item | item second ];
		  send: [ :item | item last ];
		  actionUpdateButton
%

category: 'initialization'
method: GtWireEncodingInspectionObject
initialize

	super initialize.
	components := OrderedCollection new.
%

category: 'accessing'
method: GtWireEncodingInspectionObject
object
	^ object
%

category: 'accessing'
method: GtWireEncodingInspectionObject
object: anObject
	object := anObject
%

category: 'as yet unclassified'
method: GtWireEncodingInspectionObject
objectByteArray

	^ self byteArray copyFrom: startIndex to: endIndex
%

category: 'accessing'
method: GtWireEncodingInspectionObject
parent
	^ parent
%

category: 'accessing'
method: GtWireEncodingInspectionObject
parent: anObject
	parent := anObject
%

category: 'as yet unclassified'
method: GtWireEncodingInspectionObject
printOn: aStream

	aStream
		<< self type name;
		<< '(';
		print: object;
		<< ')'.
%

category: 'accessing'
method: GtWireEncodingInspectionObject
startIndex
	^ startIndex
%

category: 'accessing'
method: GtWireEncodingInspectionObject
startIndex: anObject
	startIndex := anObject
%

category: 'accessing'
method: GtWireEncodingInspectionObject
summaryAttributes

	^ {
		{ 'Start Index'. startIndex. }.
		{ 'Type Indicator'. self typeIndicator. }.
		{ 'Type'. self type. }.
		{ 'Object'. object. }.
	}
%

category: 'accessing'
method: GtWireEncodingInspectionObject
type

	^ decoder reverseMap at: self typeIndicator
%

category: 'accessing'
method: GtWireEncodingInspectionObject
typeIndicator
	| stream |

	stream := ReadStream on: self byteArray.
	stream position: startIndex - 1.
	^ (GtWireDecoder on: stream) stream packedInteger.
%

! Class implementation for 'GtWireGbsReplicationSpecConverter'

!		Instance methods for 'GtWireGbsReplicationSpecConverter'

category: 'actions'
method: GtWireGbsReplicationSpecConverter
flattenSpec: anArray
	"Remove entries that are later overridden.
	This answers the array in reverse order, which doesn't affect the final outcome."
	| seen |

	seen := Set new.
	^ Array streamContents: [ :stream |
		anArray size to: 1 by: -1 do: [ :i | | iVarEntry |
			iVarEntry := anArray at: i.
			(seen includes: iVarEntry first) ifFalse:
				[ stream nextPut: iVarEntry.
				seen add: iVarEntry first. ] ] ].
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
forwarderEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray

	instVarMap
		at: replicationSpecArray first
		put: GtWireGemStoneRsrEncoder new.
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
indexablePartEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray
	"Indexable objects aren't supported at the moment"

	self notYetImplemented
%

category: 'accessing'
method: GtWireGbsReplicationSpecConverter
maxDepth
	"Answer the maximum depth to replicate to.
	The default (4) is taken from the GBS User's Guide faultLevelRpc."

	^ maxDepth ifNil: [ 4 ]
%

category: 'accessing'
method: GtWireGbsReplicationSpecConverter
maxDepth: anObject
	maxDepth := anObject
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
maxEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray

	instVarMap
		at: replicationSpecArray first
		put: (GtWireMaxDepthEncoder new depth: replicationSpecArray third).
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
minEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray

	instVarMap
		at: replicationSpecArray first
		put: (GtWireMinDepthEncoder new depth: replicationSpecArray third).
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
replicateEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray

	instVarMap
		at: replicationSpecArray first
		put: GtWireReplicationEncoder new.
%

category: 'actions'
method: GtWireGbsReplicationSpecConverter
replicationSpecKeywordToWireObjectEncoderMap
	"Answer the map from replicationSpec keyword to Wire encoder.
	#replicate and #indexable_part are special cases."

	^ {
		#stub -> #stubEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
		#forwarder -> #forwarderEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
		#min -> #minEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
		#max -> #maxEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
		#replicate -> #replicateEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
		#indexable_part -> #indexablePartEncodingFor:class:objectEncoder:instVarMap:replicationSpec:.
	} asDictionary.
%

category: 'private'
method: GtWireGbsReplicationSpecConverter
stubEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray
	"Stubs aren't supported at the moment, return a proxy (forwarder)"

	self forwarderEncodingFor: aGtWireEncoder class: aClass objectEncoder: aGtWireInstVarEncoder instVarMap: instVarMap replicationSpec: replicationSpecArray
%

category: 'actions'
method: GtWireGbsReplicationSpecConverter
update: aGtWireEncoder class: aClass spec: aSpecArray
	| flattenedSpec objectEncoder rsWireMap instVarMap defaultSpec |

	defaultSpec := aClass allInstVarNames collect: [ :name | { name. #replicate. } ].
	flattenedSpec := self flattenSpec: defaultSpec, aSpecArray.
	rsWireMap := self replicationSpecKeywordToWireObjectEncoderMap.
	objectEncoder := GtWireInstVarEncoder new.
	instVarMap := Dictionary new.
	flattenedSpec do: [ :anArray |
		self perform: (rsWireMap at: anArray second)
			withArguments: { aGtWireEncoder. aClass. objectEncoder. instVarMap. anArray. }
		].
	objectEncoder instVarMap: instVarMap.
	aGtWireEncoder map at: aClass put: objectEncoder.
%

category: 'actions'
method: GtWireGbsReplicationSpecConverter
update: aGtWireEncoder from: aGbsReplicationSpecDictionary

	aGbsReplicationSpecDictionary associationsDo: [ :assoc |
		self update: aGtWireEncoder class: assoc key spec: assoc value ].
	aGtWireEncoder remainingDepth: self maxDepth.
%

! Class implementation for 'GtWireGbsReplicationSpecConverterExamples'

!		Instance methods for 'GtWireGbsReplicationSpecConverterExamples'

category: 'examples'
method: GtWireGbsReplicationSpecConverterExamples
flattenSpec
	"Check that the spec is correctly flattened."

	<gtExample>
	<return: #GtWireGbsReplicationSpecConverterExamples>
	| spec actual expected |
	spec := #(#(a 1) #(b 1) #(a 2)).
	actual := GtWireGbsReplicationSpecConverter new flattenSpec: spec.
	expected := #(#(a 2) #(b 1)).
	self assert: actual equals: expected
%

! Class implementation for 'GtWireGbsReplicationSpecEncodingExamples'

!		Instance methods for 'GtWireGbsReplicationSpecEncodingExamples'

category: 'examples'
method: GtWireGbsReplicationSpecEncodingExamples
gbsAllInstVarsExample
	"Check that all instance variables are encoded with `replicate` by default"

	<gtExample>
	<return: #ByteArray>
	| replicationSpec object encoder byteArray decoder next now |
	replicationSpec := {GtWireEncodingExampleInstVarObject -> #()} asDictionary.
	now := DateAndTime now.
	object := GtWireEncodingExampleInstVarObject new
			var1: 1;
			var2: '2';
			var3: now;
			var4: #(1 2 3).
	encoder := GtWireEncoder onByteArray.
	GtWireGbsReplicationSpecConverter new update: encoder from: replicationSpec.	"GemStone isn't available here, so replace all GtGemStoneRsrEncoders with dummies"
	encoder
		replaceMappingsMatching: [ :each | each isKindOf: GtWireGemStoneRsrEncoder ]
		with: [ GtWireDummyProxyEncoder new ].
	encoder nextPut: object.
	byteArray := encoder contents.
	decoder := GtWireDecoder on: byteArray readStream.
	next := decoder next.

	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	self assert: next var1 equals: 1.
	self assert: next var2 equals: '2'.
	self assert: next var3 equals: now.
	self assert: next var4 equals: #(1 2 3).
	^ byteArray
%

category: 'examples'
method: GtWireGbsReplicationSpecEncodingExamples
gbsDefaultMaxDepthToWireExample
	"Demonstrate the default max depth in a replication spec"
	<gtExample>
	<return: #GtWireGbsReplicationSpecEncodingExamples>
	| object encoder byteArray decoder next array currentArray |

	array := Array new: 2.
	currentArray := array.
	1
		to: 10
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	object := GtWireEncodingExampleInstVarObject new var1: array.
	encoder := GtWireEncoder onByteArray.
	GtWireGbsReplicationSpecConverter new 
		maxDepth: 4;
		update: encoder from: Dictionary new.
	"GemStone isn't available here, so replace all GtGemStoneRsrEncoders with dummies"
	encoder
		replaceMappingsMatching: [ :each | each isKindOf: GtWireGemStoneRsrEncoder ]
		with: [ GtWireDummyProxyEncoder new ].
	encoder nextPut: object.
	byteArray := encoder contents.
	decoder := GtWireDecoder on: byteArray readStream.
	next := decoder next.

	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	self assert: next var1 class equals: Array.
	self assert: next var1 first equals: 1.
	next := next var1 second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next class equals: Array.
	self assert: next equals: #(3 nil)
%

category: 'examples'
method: GtWireGbsReplicationSpecEncodingExamples
gbsMaxDepthIncreaseToWireExample
	"Demonstrate `max` and `min` keywords in a replication spec.
	Since the replicationSpec max is greater than the default, it has no 
	effect in practice."
	<gtExample>
	<return: #GtWireGbsReplicationSpecEncodingExamples>
	| replicationSpec object encoder byteArray decoder next array currentArray |

	replicationSpec := {GtWireEncodingExampleInstVarObject -> #(#(var1 max 8))}
			asDictionary.
	array := Array new: 2.
	currentArray := array.
	1 to: 10 do: [ :i | 
		currentArray
			at: 1 put: i;
			at: 2 put: (Array new: 2).
		currentArray := currentArray second ].
	object := GtWireEncodingExampleInstVarObject new var1: array.
	encoder := GtWireEncoder onByteArray.
	GtWireGbsReplicationSpecConverter new 
		maxDepth: 4;
		update: encoder from: replicationSpec.
	"GemStone isn't available here, so replace all GtGemStoneRsrEncoders with dummies"
	encoder
		replaceMappingsMatching: [ :each | each isKindOf: GtWireGemStoneRsrEncoder ]
		with: [ GtWireDummyProxyEncoder new ].
	encoder nextPut: object.
	byteArray := encoder contents.
	decoder := GtWireDecoder on: byteArray readStream.
	next := decoder next.

	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	self assert: next var1 class equals: Array.
	self assert: next var1 first equals: 1.
	next := next var1 second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next class equals: Array.
	self assert: next equals: #(3 nil)
%

category: 'examples'
method: GtWireGbsReplicationSpecEncodingExamples
gbsMaxDepthToWireExample
	"Demonstrate `max` and `min` keywords in a replication spec"

	<gtExample>
	<return: #GtWireGbsReplicationSpecEncodingExamples>
	| replicationSpec object encoder byteArray decoder next array currentArray |
	replicationSpec := {GtWireEncodingExampleInstVarObject -> #(#(var1 max 2))}
			asDictionary.
	array := Array new: 2.
	currentArray := array.
	1
		to: 10
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	object := GtWireEncodingExampleInstVarObject new var1: array.
	encoder := GtWireEncoder onByteArray.
	GtWireGbsReplicationSpecConverter new 
		maxDepth: 100;
		update: encoder from: replicationSpec.
	"GemStone isn't available here, so replace all GtGemStoneRsrEncoders with dummies"
	encoder
		replaceMappingsMatching: [ :each | each isKindOf: GtWireGemStoneRsrEncoder ]
		with: [ GtWireDummyProxyEncoder new ].
	encoder nextPut: object.
	byteArray := encoder contents.
	decoder := GtWireDecoder on: byteArray readStream.
	next := decoder next.

	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	self assert: next var1 class equals: Array.
	self assert: next var1 first equals: 1.
	next := next var1 second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next class equals: Array.
	self assert: next equals: #(3 nil)
%

category: 'examples'
method: GtWireGbsReplicationSpecEncodingExamples
gbsToWireExample1
	"Demonstrate `replicate`, `forwarder` and `stub` keywords in a replication spec"

	<gtExample>
	<return: #GtWireGbsReplicationSpecEncodingExamples>
	| replicationSpec object encoder byteArray decoder next |
	replicationSpec := {GtWireEncodingExampleInstVarObject
				-> #(#(var1 replicate) #(var2 forwarder) #(var3 stub))} asDictionary.	"var4 is default, replicate"
	object := GtWireEncodingExampleInstVarObject new
			var1: (GtWireEncodingExampleInstVarObject new var1: 'replicated');
			var2: (GtWireEncodingExampleInstVarObject new var1: 'forwarded (proxy)');
			var3: (GtWireEncodingExampleInstVarObject new var1: 'stub (proxy)');
			var4: (GtWireEncodingExampleInstVarObject new var1: 'default replication').
	encoder := GtWireEncoder onByteArray.
	GtWireGbsReplicationSpecConverter new update: encoder from: replicationSpec.	"GemStone isn't available here, so replace all GtGemStoneRsrEncoders with dummies"
	encoder
		replaceMappingsMatching: [ :each | each isKindOf: GtWireGemStoneRsrEncoder ]
		with: [ GtWireDummyProxyEncoder new ].
	encoder nextPut: object.
	byteArray := encoder contents.
	decoder := GtWireDecoder on: byteArray readStream.
	next := decoder next.

	self assert: next var1 class equals: GtWireEncodingExampleInstVarObject.
	self assert: next var1 var1 equals: 'replicated'.
	self assert: next var1 var2 isNil.
	self assert: next var1 var3 isNil.
	self assert: next var1 var4 isNil.
	self assert: next var2 class equals: GtWireEncodingDummyProxy.
	self
		assert: next var2 description
		equals: '(GtWireEncodingExampleInstVarObject basicNew instVarAt: 1 put: ''forwarded (proxy)''; instVarAt: 2 put: nil; instVarAt: 3 put: nil; instVarAt: 4 put: nil; yourself)'.
	self assert: next var3 class equals: GtWireEncodingDummyProxy.
	self
		assert: next var3 description
		equals: '(GtWireEncodingExampleInstVarObject basicNew instVarAt: 1 put: ''stub (proxy)''; instVarAt: 2 put: nil; instVarAt: 3 put: nil; instVarAt: 4 put: nil; yourself)'.
	self assert: next var4 var1 equals: 'default replication'
%

! Class implementation for 'GtWireNestedEncodingExamples'

!		Instance methods for 'GtWireNestedEncodingExamples'

category: 'private'
method: GtWireNestedEncodingExamples
cleanUp

	signals ifNotNil: [ signals stop ].
%

category: 'examples'
method: GtWireNestedEncodingExamples
defaultMaxDepth
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	encoder
		maxDepthEncoder: GtWireDummyProxyEncoder new;
		remainingDepth: 4.
	array := Array new: 2.
	currentArray := array.
	1
		to: 10
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	encoder nextPut: array.
	byteArray := encoder contents.	"self assert: byteArray size equals: 57."
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next first equals: 1.
	next := next second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second second.
	self assert: next size equals: 2.
	self assert: next first equals: 4.
	self assert: next second class = GtWireEncodingDummyProxy.
	^ byteArray
%

category: 'examples'
method: GtWireNestedEncodingExamples
defaultReverseMapIsArray
	<gtExample>
	<return: #Array>
	| reverseMap |

	reverseMap := GtWireEncoderDecoder defaultReverseMap.
	self assert: reverseMap isArray.
	self assert: reverseMap size equals: 28.
	self assert: (reverseMap at: 1) class equals: GtWireNilEncoder.
	^ reverseMap
%

category: 'examples'
method: GtWireNestedEncodingExamples
maxDepth2
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next object |
	encoder := GtWireEncoder onByteArray
			maxDepthEncoder: GtWireDummyProxyEncoder new.
	array := Array new: 2.
	currentArray := array.
	1
		to: 10
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	object := GtWireEncodingExampleInstVarObject new var1: array.
	encoder
		addMapping: Array
		to: (GtWireMaxDepthEncoder depth: 2 encoder: GtWireArrayEncoder new).
	encoder nextPut: object.
	byteArray := encoder contents.	"self assert: byteArray size equals: 24."
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	next := next var1.
	self assert: next class equals: Array.
	self assert: next first equals: 1.
	next := next second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next class equals: Array.
	self assert: next first equals: 3.
	self assert: next second class equals: GtWireEncodingDummyProxy.
	self
		assert: next second description
		equals: '#(4 #(5 #(6 #(7 #(8 #(9 #(10 #(nil nil))))))))'.
	^ byteArray
%

category: 'examples'
method: GtWireNestedEncodingExamples
maxDepth2RootObject
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	array := Array new: 2.
	currentArray := array.
	1
		to: 10
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	encoder
		addMapping: Array
		to: (GtWireMaxDepthEncoder depth: 2 encoder: GtWireArrayEncoder new).
	encoder nextPut: array.
	byteArray := encoder contents.	"self assert: byteArray size equals: 24."
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next first equals: 1.
	next := next second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next class equals: Array.
	self assert: next equals: #(3 nil).
	^ byteArray
%

category: 'examples'
method: GtWireNestedEncodingExamples
minDepth2
	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	array := Array new: 2.
	currentArray := array.
	1
		to: 5
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			currentArray := currentArray second ].
	encoder
		addMapping: Array
		to: (GtWireMinDepthEncoder depth: 2 encoder: GtWireArrayEncoder new).
	encoder
		remainingDepth: 2;
		nextPut: array.
	byteArray := encoder contents.
	self assert: byteArray size equals: 24.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next = array.
	^ byteArray
%

category: 'examples'
method: GtWireNestedEncodingExamples
proxyScaledDecimal
	"Configure the encoding to always return scaled decimals as proxies
	(as opposed to the general GtWireObjectByNameEncoder serialisation)."

	<gtExample>
	<return: #ByteArray>
	| array currentArray encoder byteArray next |
	encoder := GtWireEncoder onByteArray.
	encoder map at: ScaledDecimal put: GtWireDummyProxyEncoder new.
	array := Array new: 2.
	currentArray := array.
	1
		to: 5
		do: [ :i | 
			currentArray
				at: 1 put: i;
				at: 2 put: (Array new: 2).
			i = 3 ifTrue: [ currentArray at: 1 put: 1.25 asScaledDecimal ].
			currentArray := currentArray second ].
	encoder nextPut: array.
	byteArray := encoder contents.
	self assert: byteArray size equals: 43.
	next := (GtWireDecoder on: byteArray readStream) next.
	self assert: next class equals: Array.
	self assert: next first equals: 1.
	next := next second.
	self assert: next class equals: Array.
	self assert: next first equals: 2.
	next := next second.
	self assert: next size equals: 2.
	self assert: next first class equals: GtWireEncodingDummyProxy.
	self assert: next first description equals: '1.25000000000000s14'.
	self assert: next second class equals: Array.
	^ byteArray
%

category: 'examples'
method: GtWireNestedEncodingExamples
stonEncoding
	<gtExample>
	<return: #GtWireNestedEncodingExamples>
	| object encoder decoder byteArray next |
	"signals := CircularMemoryLogger new startFor: GtWireEncodingSignal."
	encoder := GtWireEncoder onByteArray.
	encoder
		addMapping: GtWireEncodingExampleInstVarObject
		to: GtWireStonEncoder new.
	object := GtWireEncodingExampleInstVarObject new.
	object
		var1: 1;
		var2: 'two'.
	encoder nextPut: object.
	byteArray := encoder contents.
	self assert: byteArray size equals: 57.
	decoder := GtWireDecoder on: byteArray readStream.
	decoder
		map: encoder map;
		reverseMap: encoder reverseMap.
	next := decoder next.
	self assert: next class equals: GtWireEncodingExampleInstVarObject.
	self assert: next = object
%

! Class implementation for 'GtWireObjectEncoder'

!		Class methods for 'GtWireObjectEncoder'

category: 'accessing'
classmethod: GtWireObjectEncoder
typeIdentifier

	^ self subclassResponsibility
%

category: 'accessing'
classmethod: GtWireObjectEncoder
typeIdentifierOrNil

	^ [ self typeIdentifier ]
		on: Error
		do: [ :ex | 
			self gtDo: [ ex class name = #SubclassResponsibility ifFalse: [ ex pass ] ]
				gemstoneDo: [].
			nil ]
%

category: 'test'
classmethod: GtWireObjectEncoder
validateTypeIdentifiers
	 "Validate that there aren't duplicate type identifiers and answer the maximum value"
	| visited |
	
	visited := Set new.
	self allSubclassesDo: [ :cls | | typeIdentifier |
		typeIdentifier := cls typeIdentifierOrNil.
		typeIdentifier ifNotNil:
			[ (visited includes: typeIdentifier) ifTrue:
				[ self error: 'Duplicate typeIdentifier found' ].
			visited add: typeIdentifier ] ].
	^ visited max
%

!		Instance methods for 'GtWireObjectEncoder'

category: 'encoding - decoding'
method: GtWireObjectEncoder
decodeWith: aGtWireEncoderContext
	
	^ self subclassResponsibility
%

category: 'encoding - decoding'
method: GtWireObjectEncoder
encode: anObject with: aGtWireEncoderContext

	aGtWireEncoderContext putTypeIdentifier: self class typeIdentifier
%

category: 'testing'
method: GtWireObjectEncoder
hasValidConfiguration

	^ true
%

category: 'testing'
method: GtWireObjectEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ false.
%

category: 'as yet unclassified'
method: GtWireObjectEncoder
name

	^ self class name
%

category: 'private - helpers'
method: GtWireObjectEncoder
replaceMappingsMatching: matchBlock with: replacementBlock
	"Replace all the mappings matching matchBlock with the encoder returned by replacementBlock.
	Used by examples to avoid needing live servers.
	Overwritten by encoders as required."
%

category: 'accessing'
method: GtWireObjectEncoder
typeIdentifier

	^ self class typeIdentifier
%

! Class implementation for 'GtWireAssociationEncoder'

!		Class methods for 'GtWireAssociationEncoder'

category: 'accessing'
classmethod: GtWireAssociationEncoder
typeIdentifier

	^ 15
%

!		Instance methods for 'GtWireAssociationEncoder'

category: 'encoding - decoding'
method: GtWireAssociationEncoder
decodeWith: aGtWireEncoderContext

	^ Association
		key: aGtWireEncoderContext next
		value: aGtWireEncoderContext next
%

category: 'encoding - decoding'
method: GtWireAssociationEncoder
encode: anInteger with: aGtWireEncoderContext

	aGtWireEncoderContext putTypeIdentifier: self typeIdentifier.
	aGtWireEncoderContext
		nextPut: anInteger key;
		nextPut: anInteger value
%

! Class implementation for 'GtWireBlockClosureEncoder'

!		Class methods for 'GtWireBlockClosureEncoder'

category: 'accessing'
classmethod: GtWireBlockClosureEncoder
typeIdentifier

	^ 21
%

!		Instance methods for 'GtWireBlockClosureEncoder'

category: 'encoding - decoding'
method: GtWireBlockClosureEncoder
decodeWith: aGtWireEncoderContext

	^ self
		gtDo: [ BlockClosure compiler 
			evaluate: aGtWireEncoderContext next ]
		gemstoneDo: [ | bindings receiver |
			bindings := GsCurrentSession currentSession symbolList.
			receiver := self.
			aGtWireEncoderContext next evaluate.
				"_compileInContext: receiver symbolList: bindings" ].
%

category: 'encoding - decoding'
method: GtWireBlockClosureEncoder
encode: aBlockClosure with: aGtWireEncoderContext

	aBlockClosure isClean ifFalse:
		[ self error: 'BlockClosures must be clean' ].
	aGtWireEncoderContext 
		putTypeIdentifier: self class typeIdentifier;
		nextPut: (self
			gtDo: [ aBlockClosure printString ]
			gemstoneDo: [ aBlockClosure method _sourceStringForBlock  ]).
%

! Class implementation for 'GtWireBooleanEncoder'

!		Instance methods for 'GtWireBooleanEncoder'

category: 'encoding - decoding'
method: GtWireBooleanEncoder
encode: anObject with: aGtWireEncoderContext

	aGtWireEncoderContext putTypeIdentifier: (anObject
		ifTrue: [ GtWireTrueEncoder ]
		ifFalse: [ GtWireFalseEncoder ])
			typeIdentifier
%

! Class implementation for 'GtWireFalseEncoder'

!		Class methods for 'GtWireFalseEncoder'

category: 'accessing'
classmethod: GtWireFalseEncoder
typeIdentifier

	^ 3
%

!		Instance methods for 'GtWireFalseEncoder'

category: 'encoding - decoding'
method: GtWireFalseEncoder
decodeWith: aGtWireEncoderContext

	^ false
%

! Class implementation for 'GtWireTrueEncoder'

!		Class methods for 'GtWireTrueEncoder'

category: 'accessing'
classmethod: GtWireTrueEncoder
typeIdentifier

	^ 2
%

!		Instance methods for 'GtWireTrueEncoder'

category: 'encoding - decoding'
method: GtWireTrueEncoder
decodeWith: aGtWireEncoderContext

	^ true
%

! Class implementation for 'GtWireByteArrayEncoder'

!		Class methods for 'GtWireByteArrayEncoder'

category: 'accessing'
classmethod: GtWireByteArrayEncoder
typeIdentifier

	^ 4
%

!		Instance methods for 'GtWireByteArrayEncoder'

category: 'encoding - decoding'
method: GtWireByteArrayEncoder
decodeWith: aGtWireEncoderContext

	^ aGtWireEncoderContext nextByteArray
%

category: 'encoding - decoding'
method: GtWireByteArrayEncoder
encode: aByteArray with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putByteArray: aByteArray
%

! Class implementation for 'GtWireCharacterArrayEncoder'

!		Instance methods for 'GtWireCharacterArrayEncoder'

category: 'encoding - decoding'
method: GtWireCharacterArrayEncoder
decodeWith: aGtWireEncoderContext

	^ aGtWireEncoderContext nextString
%

category: 'encoding - decoding'
method: GtWireCharacterArrayEncoder
encode: aString with: aGtWireEncoderContext

	aGtWireEncoderContext 
		putTypeIdentifier: self typeIdentifier;
		putString: aString
%

! Class implementation for 'GtWireStringEncoder'

!		Class methods for 'GtWireStringEncoder'

category: 'accessing'
classmethod: GtWireStringEncoder
typeIdentifier

	^ 5
%

! Class implementation for 'GtWireSymbolEncoder'

!		Class methods for 'GtWireSymbolEncoder'

category: 'accessing'
classmethod: GtWireSymbolEncoder
typeIdentifier

	^ 6
%

!		Instance methods for 'GtWireSymbolEncoder'

category: 'encoding - decoding'
method: GtWireSymbolEncoder
decodeWith: aGtWireEncoderContext
	
	^ (super decodeWith: aGtWireEncoderContext) asSymbol
%

! Class implementation for 'GtWireCharacterEncoder'

!		Class methods for 'GtWireCharacterEncoder'

category: 'accessing'
classmethod: GtWireCharacterEncoder
typeIdentifier

	^ 7
%

!		Instance methods for 'GtWireCharacterEncoder'

category: 'encoding - decoding'
method: GtWireCharacterEncoder
decodeWith: aGtWireEncoderContext

	^ Character value: aGtWireEncoderContext nextPackedInteger
%

category: 'encoding - decoding'
method: GtWireCharacterEncoder
encode: aCharacter with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putPackedInteger: aCharacter codePoint.
%

! Class implementation for 'GtWireClassEncoder'

!		Class methods for 'GtWireClassEncoder'

category: 'accessing'
classmethod: GtWireClassEncoder
typeIdentifier

	^ 28
%

!		Instance methods for 'GtWireClassEncoder'

category: 'encoding - decoding'
method: GtWireClassEncoder
decodeWith: aGtWireEncoderContext
	| className isMeta instanceClass |

	className := aGtWireEncoderContext nextString.
	isMeta := aGtWireEncoderContext next.
	instanceClass := self
		gtDo: [ self class environment classOrTraitNamed: className ]
		gemstoneDo: [ (System myUserProfile resolveSymbol: className asSymbol) value ].
	^ isMeta
		ifTrue: [ instanceClass class ]
		ifFalse: [ instanceClass ].
%

category: 'encoding - decoding'
method: GtWireClassEncoder
encode: aClass with: aGtWireEncoderContext

	aGtWireEncoderContext 
		putTypeIdentifier: self typeIdentifier;
		putString: (self
			gtDo: [ aClass instanceSide name ]
			gemstoneDo: [ aClass thisClass name ]);
		nextPut: aClass isMeta.
%

! Class implementation for 'GtWireCollectionEncoder'

!		Instance methods for 'GtWireCollectionEncoder'

category: 'encoding - decoding'
method: GtWireCollectionEncoder
decodeWith: aGtWireEncoderContext
	"Decode the array on the supplied context"
	| count |

	count := aGtWireEncoderContext nextSize.
	^ Array new: count streamContents: [ :arrayStream |
		count timesRepeat:
			[ arrayStream nextPut: aGtWireEncoderContext next ] ]
%

category: 'encoding - decoding'
method: GtWireCollectionEncoder
encode: aCollection with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putSize: aCollection size.
	aCollection do: [ :each |
		aGtWireEncoderContext nextPut: each ].
%

! Class implementation for 'GtWireArrayEncoder'

!		Class methods for 'GtWireArrayEncoder'

category: 'accessing'
classmethod: GtWireArrayEncoder
typeIdentifier

	^ 8
%

! Class implementation for 'GtWireDictionaryEncoder'

!		Class methods for 'GtWireDictionaryEncoder'

category: 'accessing'
classmethod: GtWireDictionaryEncoder
typeIdentifier

	^ 9
%

!		Instance methods for 'GtWireDictionaryEncoder'

category: 'encoding - decoding'
method: GtWireDictionaryEncoder
decodeWith: aGtWireEncoderContext
	"Decode the dictionary on the supplied context"
	| count dictionary |

	count := aGtWireEncoderContext nextSize.
	dictionary := Dictionary new: count * 2.
	count timesRepeat:
		[ dictionary
			at: aGtWireEncoderContext next
			put: aGtWireEncoderContext next ].
	^ dictionary
%

category: 'encoding - decoding'
method: GtWireDictionaryEncoder
encode: aDictionary with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putSize: aDictionary size.
	aDictionary associationsDo: [ :each |
		aGtWireEncoderContext 
			nextPut: each key;
			nextPut: each value ].
%

! Class implementation for 'GtWireOrderedCollectionEncoder'

!		Class methods for 'GtWireOrderedCollectionEncoder'

category: 'accessing'
classmethod: GtWireOrderedCollectionEncoder
typeIdentifier

	^ 10
%

!		Instance methods for 'GtWireOrderedCollectionEncoder'

category: 'encoding - decoding'
method: GtWireOrderedCollectionEncoder
decodeWith: aGtWireEncoderContext
	"Decode the OrderedCollection on the supplied context"
	| count |

	count := aGtWireEncoderContext nextSize.
	^ OrderedCollection new: count streamContents: [ :arrayStream |
		count timesRepeat:
			[ arrayStream nextPut: aGtWireEncoderContext next ] ]
%

! Class implementation for 'GtWireSetEncoder'

!		Class methods for 'GtWireSetEncoder'

category: 'accessing'
classmethod: GtWireSetEncoder
typeIdentifier

	^ 11
%

!		Instance methods for 'GtWireSetEncoder'

category: 'encoding - decoding'
method: GtWireSetEncoder
decodeWith: aGtWireEncoderContext
	"Decode the OrderedCollection on the supplied context"
	| count set |

	count := aGtWireEncoderContext nextSize.
	set := Set new: count * 2.
	count timesRepeat:
		[ set add: aGtWireEncoderContext next ].
	^ set
%

! Class implementation for 'GtWireDateAndTimeEncoder'

!		Class methods for 'GtWireDateAndTimeEncoder'

category: 'accessing'
classmethod: GtWireDateAndTimeEncoder
typeIdentifier

	^ 12
%

!		Instance methods for 'GtWireDateAndTimeEncoder'

category: 'encoding - decoding'
method: GtWireDateAndTimeEncoder
decodeWith: aGtWireEncoderContext
	"Decode the array on the supplied context"
	| unixSeconds nanoSeconds offset |

	unixSeconds :=  aGtWireEncoderContext nextPackedInteger.
	nanoSeconds := aGtWireEncoderContext nextPackedInteger.
	offset := aGtWireEncoderContext next.
	^ self
		gtDo: [ (DateAndTime fromUnixTime: unixSeconds)
			setNanoSeconds: nanoSeconds;
			translateTo: offset ]
		gemstoneDo: [ DateAndTime posixSeconds: (unixSeconds + (nanoSeconds / (10 raisedTo: 9))) offset: (Duration seconds: offset) ].
%

category: 'encoding - decoding'
method: GtWireDateAndTimeEncoder
encode: aDateAndTime with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		putPackedInteger: aDateAndTime asUnixTime truncated;
		putPackedInteger: aDateAndTime nanoSecond;
		nextPut: aDateAndTime offset asSeconds.
%

! Class implementation for 'GtWireDummyProxyEncoder'

!		Class methods for 'GtWireDummyProxyEncoder'

category: 'access'
classmethod: GtWireDummyProxyEncoder
typeIdentifier

	^ 25
%

!		Instance methods for 'GtWireDummyProxyEncoder'

category: 'encoding - decoding'
method: GtWireDummyProxyEncoder
decodeWith: aGtWireEncoderContext
	"Decode the object on the supplied context"

	^ GtWireEncodingDummyProxy new description: aGtWireEncoderContext nextString.
%

category: 'encoding - decoding'
method: GtWireDummyProxyEncoder
encode: anObject with: aGtWireEncoderContext

	anObject ifNil:
		[ ^ GtWireNilEncoder new encode: anObject with: aGtWireEncoderContext ].

	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		putString: anObject storeString.
%

category: 'as yet unclassified'
method: GtWireDummyProxyEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ true.
%

! Class implementation for 'GtWireFloatEncoder'

!		Class methods for 'GtWireFloatEncoder'

category: 'accessing'
classmethod: GtWireFloatEncoder
typeIdentifier

	^ 17
%

!		Instance methods for 'GtWireFloatEncoder'

category: 'encoding - decoding'
method: GtWireFloatEncoder
decodeWith: aGtWireEncoderContext

	^ aGtWireEncoderContext nextFloat64.
%

category: 'encoding - decoding'
method: GtWireFloatEncoder
encode: aFloat with: aGtWireEncoderContext

	aGtWireEncoderContext 
		putPackedInteger: self typeIdentifier;
		putFloat64: aFloat
%

! Class implementation for 'GtWireGemStoneOopEncoder'

!		Class methods for 'GtWireGemStoneOopEncoder'

category: 'accessing'
classmethod: GtWireGemStoneOopEncoder
typeIdentifier

	^ 23
%

!		Instance methods for 'GtWireGemStoneOopEncoder'

category: 'encoding - decoding'
method: GtWireGemStoneOopEncoder
decodeWith: aGtWireEncoderContext
	"It is up to the user to ensure the Object isn't GCd during transfer and decoding
	(which would allow the oop to be reused and the wrong object returned), or that the
	session is aborted."

	^ self
		gtDo: [ #GtGemStoneCurrentSession asClass value evaluateAndWaitReturnProxy:
			'Object objectForOop: ', aGtWireEncoderContext nextPackedInteger asString ]
		gemstoneDo: [ Object objectForOop: aGtWireEncoderContext nextPackedInteger ]
%

category: 'encoding - decoding'
method: GtWireGemStoneOopEncoder
encode: anObject with: aGtWireEncoderContext
	"It is up to the user to ensure that anObject isn't GCd during transfer and decoding
	(which would allow the oop to be reused and the wrong object returned), or that the
	session is aborted."

	aGtWireEncoderContext 
		putTypeIdentifier: self class typeIdentifier;
		putPackedInteger: anObject asOop
%

category: 'testing'
method: GtWireGemStoneOopEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ true.
%

! Class implementation for 'GtWireGemStoneRemoteObjectEncoder'

!		Instance methods for 'GtWireGemStoneRemoteObjectEncoder'

category: 'encoding - decoding'
method: GtWireGemStoneRemoteObjectEncoder
decodeWith: aGtWireEncoderContext

	self error: self class name asString, ' should never need decoding'
%

category: 'encoding - decoding'
method: GtWireGemStoneRemoteObjectEncoder
encode: anObject with: aGtWireEncoderContext
	"Encode the supplied object as a remote object, i.e. it is returned by value and a proxy is registered with GtRsrProxyServiceClient"

	GtWireGemStoneWithRsrEncoder new
		encode: anObject 
		with: aGtWireEncoderContext
		objectEncoder: encoder.
%

category: 'accessing'
method: GtWireGemStoneRemoteObjectEncoder
encoder
	^ encoder
%

category: 'accessing'
method: GtWireGemStoneRemoteObjectEncoder
encoder: anObject
	encoder := anObject
%

category: 'testing'
method: GtWireGemStoneRemoteObjectEncoder
hasValidConfiguration
	"An encoder must be supplied as using the default encoder will result in an infinite loop"
	
	^ encoder isKindOf: GtWireObjectEncoder
%

! Class implementation for 'GtWireGemStoneRsrEncoder'

!		Class methods for 'GtWireGemStoneRsrEncoder'

category: 'accessing'
classmethod: GtWireGemStoneRsrEncoder
typeIdentifier

	^ 24
%

!		Instance methods for 'GtWireGemStoneRsrEncoder'

category: 'testing'
method: GtWireGemStoneRsrEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ true.
%

! Class implementation for 'GtWireGemStoneWithRsrEncoder'

!		Class methods for 'GtWireGemStoneWithRsrEncoder'

category: 'accessing'
classmethod: GtWireGemStoneWithRsrEncoder
typeIdentifier

	^ 27
%

!		Instance methods for 'GtWireGemStoneWithRsrEncoder'

category: 'testing'
method: GtWireGemStoneWithRsrEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ true.
%

! Class implementation for 'GtWireGsBareProxyEncoder'

!		Instance methods for 'GtWireGsBareProxyEncoder'

category: 'encoding - decoding'
method: GtWireGsBareProxyEncoder
decodeWith: aGtWireEncoderContext

	^ GtWireGemStoneRsrEncoder new
		decodeWith: aGtWireEncoderContext
%

category: 'encoding - decoding'
method: GtWireGsBareProxyEncoder
encode: aBareProxy with: aGtWireEncoderContext

	^ GtWireGemStoneRsrEncoder new
		encode: aBareProxy asGtProxyObject
		with: aGtWireEncoderContext
%

category: 'testing'
method: GtWireGsBareProxyEncoder
isProxyObjectEncoder
	"Answer a boolean indicating whether the receiver is a type of proxy encoder.
	Proxy encoding is platform dependent."

	^ true.
%

! Class implementation for 'GtWireInstVarEncoder'

!		Class methods for 'GtWireInstVarEncoder'

category: 'accessing'
classmethod: GtWireInstVarEncoder
typeIdentifier

	^ 20
%

!		Instance methods for 'GtWireInstVarEncoder'

category: 'as yet unclassified'
method: GtWireInstVarEncoder
decodeWith: aGtWireEncoderContext
	| count instance className |

	count := aGtWireEncoderContext nextSize.
	className := aGtWireEncoderContext next.
	instance := (self class environment classOrTraitNamed: className) basicNew.
	count timesRepeat:
		[ | instVarName |
		instVarName := aGtWireEncoderContext next.
		instance
			instVarNamed: instVarName
			put: aGtWireEncoderContext next ].
	^ instance
%

category: 'as yet unclassified'
method: GtWireInstVarEncoder
encode: anObject with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		putSize: instVarMap size.
	aGtWireEncoderContext nextPut: anObject class name.
	instVarMap keysAndValuesDo: [ :key :value |
		aGtWireEncoderContext 
			nextPut: key;
			nextPut: (anObject instVarNamed: key) objectEncoder: value ].
%

category: 'accessing'
method: GtWireInstVarEncoder
instVarMap
	^ instVarMap
%

category: 'accessing'
method: GtWireInstVarEncoder
instVarMap: anObject
	instVarMap := anObject
%

category: 'private - helpers'
method: GtWireInstVarEncoder
replaceMappingsMatching: matchBlock with: replacementBlock
	"Replace all the mappings matching matchBlock with the encoder returned by replacementBlock.
	Used by examples to avoid needing live servers."

	instVarMap associationsDo: [ :assoc |
		(matchBlock value: assoc value) ifTrue:
			[ assoc value: replacementBlock value ]
		ifFalse:
			[ assoc value replaceMappingsMatching: matchBlock with: replacementBlock ] ]
%

! Class implementation for 'GtWireIntegerEncoder'

!		Class methods for 'GtWireIntegerEncoder'

category: 'accessing'
classmethod: GtWireIntegerEncoder
typeIdentifier

	^ 16
%

!		Instance methods for 'GtWireIntegerEncoder'

category: 'encoding - decoding'
method: GtWireIntegerEncoder
encode: anInteger with: aGtWireEncoderContext

	anInteger >= 0
		ifTrue: [ GtWirePositiveIntegerEncoder new encode: anInteger with: aGtWireEncoderContext ]
		ifFalse: [ GtWireNegativeIntegerEncoder new encode: anInteger with: aGtWireEncoderContext ]
%

! Class implementation for 'GtWireNegativeIntegerEncoder'

!		Class methods for 'GtWireNegativeIntegerEncoder'

category: 'accessing'
classmethod: GtWireNegativeIntegerEncoder
typeIdentifier

	^ 14
%

!		Instance methods for 'GtWireNegativeIntegerEncoder'

category: 'encoding - decoding'
method: GtWireNegativeIntegerEncoder
decodeWith: aGtWireEncoderContext

	^ aGtWireEncoderContext nextPackedInteger negated
%

category: 'encoding - decoding'
method: GtWireNegativeIntegerEncoder
encode: anInteger with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putPackedInteger: anInteger negated
%

! Class implementation for 'GtWirePositiveIntegerEncoder'

!		Class methods for 'GtWirePositiveIntegerEncoder'

category: 'accessing'
classmethod: GtWirePositiveIntegerEncoder
typeIdentifier

	^ 13
%

!		Instance methods for 'GtWirePositiveIntegerEncoder'

category: 'encoding - decoding'
method: GtWirePositiveIntegerEncoder
decodeWith: aGtWireEncoderContext

	^ aGtWireEncoderContext nextPackedInteger
%

category: 'encoding - decoding'
method: GtWirePositiveIntegerEncoder
encode: anInteger with: aGtWireEncoderContext

	aGtWireEncoderContext
		putTypeIdentifier: self typeIdentifier;
		putPackedInteger: anInteger
%

! Class implementation for 'GtWireMaxDepthEncoder'

!		Class methods for 'GtWireMaxDepthEncoder'

category: 'instance creation'
classmethod: GtWireMaxDepthEncoder
depth: anInteger encoder: aGtWireEncoder

	^ self new
		depth: anInteger;
		encoder: aGtWireEncoder
%

!		Instance methods for 'GtWireMaxDepthEncoder'

category: 'encoding - decoding'
method: GtWireMaxDepthEncoder
decodeWith: aGtWireEncoderContext

	self error: 'Should not be decoded'
%

category: 'accessing'
method: GtWireMaxDepthEncoder
depth
	^ depth
%

category: 'accessing'
method: GtWireMaxDepthEncoder
depth: anObject
	depth := anObject
%

category: 'encoding - decoding'
method: GtWireMaxDepthEncoder
encode: anObject with: aGtWireEncoderContext
	"Ensure the remaining depth is no more than the receiver's depth - 1.
	Subtract one from the depth since we are inside anObject's nextPut:objectEncoder: and the remaining depth has already been decremented for anObject."
	| oldDepth |

	oldDepth := aGtWireEncoderContext remainingDepth.
	aGtWireEncoderContext remainingDepth: (oldDepth min: depth).
	aGtWireEncoderContext privateNextPutMapEncoded: anObject objectEncoder: encoder.
	aGtWireEncoderContext remainingDepth: oldDepth.
%

category: 'accessing'
method: GtWireMaxDepthEncoder
encoder
	^ encoder
%

category: 'accessing'
method: GtWireMaxDepthEncoder
encoder: anObject
	encoder := anObject
%

category: 'private - helpers'
method: GtWireMaxDepthEncoder
replaceMappingsMatching: matchBlock with: replacementBlock
	"Replace all the mappings matching matchBlock with the encoder returned by replacementBlock.
	Used by examples to avoid needing live servers."

	encoder ifNotNil:
		[ encoder replaceMappingsMatching: matchBlock with: replacementBlock ]
%

! Class implementation for 'GtWireMinDepthEncoder'

!		Class methods for 'GtWireMinDepthEncoder'

category: 'instance creation'
classmethod: GtWireMinDepthEncoder
depth: anInteger encoder: aGtWireEncoder

	^ self new
		depth: anInteger;
		encoder: aGtWireEncoder
%

!		Instance methods for 'GtWireMinDepthEncoder'

category: 'encoding - decoding'
method: GtWireMinDepthEncoder
decodeWith: aGtWireEncoderContext

	self error: 'Should not be decoded'
%

category: 'accessing'
method: GtWireMinDepthEncoder
depth
	^ depth
%

category: 'accessing'
method: GtWireMinDepthEncoder
depth: anObject
	depth := anObject
%

category: 'encoding - decoding'
method: GtWireMinDepthEncoder
encode: anObject with: aGtWireEncoderContext
	"Ensure the remaining depth is at least the receiver's depth - 1.
	Subtract one from the depth since we are inside anObject's nextPut:objectEncoder: and the remaining depth has already been decremented for anObject."
	| oldDepth |

	oldDepth := aGtWireEncoderContext remainingDepth.
	aGtWireEncoderContext remainingDepth: (oldDepth max: depth).
	aGtWireEncoderContext privateNextPutMapEncoded: anObject objectEncoder: encoder.
	aGtWireEncoderContext remainingDepth: oldDepth.
%

category: 'accessing'
method: GtWireMinDepthEncoder
encoder
	^ encoder
%

category: 'accessing'
method: GtWireMinDepthEncoder
encoder: anObject
	encoder := anObject
%

category: 'private - helpers'
method: GtWireMinDepthEncoder
replaceMappingsMatching: matchBlock with: replacementBlock
	"Replace all the mappings matching matchBlock with the encoder returned by replacementBlock.
	Used by examples to avoid needing live servers."

	encoder replaceMappingsMatching: matchBlock with: replacementBlock
%

! Class implementation for 'GtWireNilEncoder'

!		Class methods for 'GtWireNilEncoder'

category: 'accessing'
classmethod: GtWireNilEncoder
typeIdentifier

	^ 1
%

!		Instance methods for 'GtWireNilEncoder'

category: 'encoding - decoding'
method: GtWireNilEncoder
decodeWith: aGtWireEncoderContext
	
	^ nil
%

! Class implementation for 'GtWireObjectByNameEncoder'

!		Class methods for 'GtWireObjectByNameEncoder'

category: 'instance creation'
classmethod: GtWireObjectByNameEncoder
typeIdentifier

	^ 22
%

!		Instance methods for 'GtWireObjectByNameEncoder'

category: 'encoding - decoding'
method: GtWireObjectByNameEncoder
decodeWith: aGtWireEncoderContext
	| count instance className cls |

	className := aGtWireEncoderContext nextString.
	"Retrieve the number of variable slots"
	count := aGtWireEncoderContext nextSize.
	cls := self lookupClass: className context: aGtWireEncoderContext.
	cls ifNil: [ self error: 'Unknown class: ', className asString ].
	instance := cls isVariable
		ifTrue: [ cls basicNew: count ]
		ifFalse: [ cls basicNew ].
	1 to: count do: [ :i |
		instance basicAt: i put: aGtWireEncoderContext next ].
	count := aGtWireEncoderContext nextSize.
	count timesRepeat:
		[ | instVarName |
		instVarName := self
			gtDo: [ aGtWireEncoderContext next asString ]
			gemstoneDo: [ aGtWireEncoderContext next asSymbol ].
		instance
			instVarNamed: instVarName
			put: aGtWireEncoderContext next ].
	^ instance
%

category: 'encoding - decoding'
method: GtWireObjectByNameEncoder
encode: anObject with: aGtWireEncoderContext
	| instVarNames namesAndValues |

	(anObject isKindOf: RsrService) ifTrue:
		[ self error: 'Attempt to encode proxy by name' ].
	instVarNames := anObject class allInstVarNames.
	namesAndValues := OrderedCollection new.
	instVarNames do: [ :name |
		(anObject instVarNamed: name) ifNotNil: [ :value |
			namesAndValues add: name -> value ] ].
	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		putString: anObject class name asString.
	anObject class isVariable ifTrue:
		[ | basicSize |
		basicSize := anObject basicSize.
		self gtDo: [] gemstoneDo:
			[ basicSize := basicSize - instVarNames size ].
		aGtWireEncoderContext putSize: basicSize.
		1 to: basicSize do: [ :i |
			aGtWireEncoderContext nextPut: (anObject basicAt: i) ] ]
	ifFalse:
		[ aGtWireEncoderContext putSize: 0 ].
	aGtWireEncoderContext putSize: namesAndValues size.
	namesAndValues do: [ :assoc |
		aGtWireEncoderContext nextPut: assoc key asString.
		aGtWireEncoderContext nextPut: assoc value ].
%

category: 'private'
method: GtWireObjectByNameEncoder
lookupClass: className context: aGtWireEncoderContext
	"Answer the class with the supplied name or nil if not found.
	For GemStone, see STONReader>>lookupClass: for inspiration."

	^ self
		gtDo: [ aGtWireEncoderContext classCache
			at: className
			ifAbsentPut: [ self class environment classOrTraitNamed: className ] ]
		gemstoneDo: [ System myUserProfile objectNamed: className asSymbol ].
%

! Class implementation for 'GtWireReplicationEncoder'

!		Instance methods for 'GtWireReplicationEncoder'

category: 'encoding - decoding'
method: GtWireReplicationEncoder
decodeWith: aGtWireEncoderContext
	
	^ self error: 'This can''t be serialised directly'
%

category: 'as yet unclassified'
method: GtWireReplicationEncoder
encode: anObject with: aGtWireEncoderContext
	"Encode the supplied object using its default encoding, unless it would return a type of proxy, in which case {{gtClass:GtWireObjectByNameEncoder}} is used."
	| encoder |

	encoder := aGtWireEncoderContext map at: anObject class.
	encoder isProxyObjectEncoder ifTrue:
		[ encoder := GtWireObjectByNameEncoder new ].
	encoder encode: anObject with: aGtWireEncoderContext.
%

! Class implementation for 'GtWireStonEncoder'

!		Class methods for 'GtWireStonEncoder'

category: 'accessing'
classmethod: GtWireStonEncoder
typeIdentifier

	^ 19
%

!		Instance methods for 'GtWireStonEncoder'

category: 'encoding - decoding'
method: GtWireStonEncoder
decodeWith: aGtWireEncoderContext

	^ STON fromString: aGtWireEncoderContext nextByteArray utf8Decoded.
%

category: 'encoding - decoding'
method: GtWireStonEncoder
encode: anObject with: aGtWireEncoderContext
	| stonEncoded |

	stonEncoded := (STON toString: anObject) utf8Encoded.
	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		putByteArray: stonEncoded.
%

! Class implementation for 'GtWireStream'

!		Class methods for 'GtWireStream'

category: 'instance creation'
classmethod: GtWireStream
on: aStream

	^ self basicNew on: aStream
%

!		Instance methods for 'GtWireStream'

category: 'accessing'
method: GtWireStream
contents

	^ wrappedStream contents
%

category: 'encoding - decoding'
method: GtWireStream
float64
	| byteArray |

	byteArray := self next: 8.
	^ byteArray doubleAt: 1.
%

category: 'encoding - decoding'
method: GtWireStream
float64: aFloat
	| byteArray |

	byteArray := ByteArray new: 8.
	byteArray doubleAt: 1 put: aFloat.
	self nextPutAll: byteArray.
%

category: 'as yet unclassified'
method: GtWireStream
int64
	"Answer the next signed, 32-bit integer from this (binary) stream."
	"Details: As a fast check for negative number, check the high bit of the first digit"
	| n firstDigit |
	n := firstDigit := self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	n := (n bitShift: 8) + self next.
	firstDigit >= 128 ifTrue: [n := -16r10000000000000000 + n].  "decode negative 64-bit integer"
	^ n
%

category: 'as yet unclassified'
method: GtWireStream
int64: anInteger
	| n |
	(anInteger < -16r8000000000000000) | (anInteger >= 16r8000000000000000)
		ifTrue: [self error: 'outside 64-bit integer range'].

	anInteger < 0
		ifTrue: [n := 16r10000000000000000 + anInteger]
		ifFalse: [n := anInteger].
	self nextPut: (n digitAt: 8).
	self nextPut: (n digitAt: 7).
	self nextPut: (n digitAt: 6).
	self nextPut: (n digitAt: 5).
	self nextPut: (n digitAt: 4).
	self nextPut: (n digitAt: 3).
	self nextPut: (n digitAt: 2).
	self nextPut: (n digitAt: 1).
%

category: 'accessing'
method: GtWireStream
next

	^ wrappedStream next
%

category: 'accessing'
method: GtWireStream
next: anInteger
	"Answer the next anInteger number of objects accessible by the receiver."

	^ wrappedStream next: anInteger
%

category: 'accessing'
method: GtWireStream
nextPut: aByte

	wrappedStream nextPut: aByte
%

category: 'as yet unclassified'
method: GtWireStream
on: aStream

	wrappedStream := aStream
%

category: 'encoding - decoding'
method: GtWireStream
packedInteger
	| result |

	result := 0.
	[ | byte |
	byte := self next.
	result := (result bitShift: 7) + (byte bitAnd: 16r7F).
	byte >= 16r80 ] whileTrue.
	^ result
%

category: 'encoding - decoding'
method: GtWireStream
packedInteger: anInteger
	| bitCount byteCount |

	anInteger isInteger ifFalse:
		[ self error: anInteger asString, ' isn''t integer' ].
	anInteger < 0 ifTrue:
		[ self error: anInteger asString, ' is less than 0' ].
	anInteger = 0 ifTrue:
		[ self nextPut: 0.
		^ self ].

	bitCount := (anInteger log: 2) floor + 1.
	byteCount := (bitCount / 7) ceiling.
	byteCount to: 1 by: -1 do: [ :byteOffset |
		| byte |
		byte := (anInteger bitShift: (byteOffset - 1 * -7)) bitAnd: 16r7F.
		byteOffset > 1 ifTrue: [ byte := byte bitOr: 16r80 ].
		self nextPut: byte ].
%

category: 'accessing'
method: GtWireStream
position

	^ wrappedStream position
%

category: 'as yet unclassified'
method: GtWireStream
postCopy
	"Creating a copy of a WriteStream doesn't copy the underlying collection.
	For now, create a new WriteStream."
	
	 super postCopy.
	 wrappedStream := WriteStream on: (ByteArray new: 100).
%

category: 'as yet unclassified'
method: GtWireStream
reset

	wrappedStream reset
%

! Class extensions for 'DateAndTimeANSI'

!		Instance methods for 'DateAndTimeANSI'

category: '*GToolkit-WireEncoding-GemStone'
method: DateAndTimeANSI
asUnixTime

	^ self asPosixSeconds
%

category: '*GToolkit-WireEncoding-GemStone'
method: DateAndTimeANSI
nanoSecond

	^ (self second fractionPart * (10 raisedTo: 9)) rounded
%

category: '*GToolkit-WireEncoding-GemStone'
method: DateAndTimeANSI
setNanoSeconds: nanoSeconds
	"Set the fractional seconds of the receiver"

	^ DateAndTime posixSeconds: self asPosixSeconds truncated + (nanoSeconds / (10 raisedTo: 9))
		offset: self offset
%

! Class extensions for 'GtWireDecoder'

!		Instance methods for 'GtWireDecoder'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireDecoder
nextNullTerminatedUtf8
	| ch wStream |

	wStream := WriteStream on: (ByteArray new: 1024).
	[ (ch := stream next) = 0 ] whileFalse:
		[ wStream nextPut: ch ].
	^ wStream contents utf8Decoded asString
%

! Class extensions for 'GtWireEncoder'

!		Instance methods for 'GtWireEncoder'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireEncoder
putNullTerminatedUtf8: aString

	stream nextPutAll: aString utf8Encoded.
	stream nextPut: 0.
%

! Class extensions for 'GtWireEncoderDecoder'

!		Class methods for 'GtWireEncoderDecoder'

category: '*GToolkit-WireEncoding-GemStone'
classmethod: GtWireEncoderDecoder
defaultMap

	^ SessionTemps current
		at: #gtGsWireEncodingDefaultMap
		ifAbsentPut: [ self getDefaultMap ]
%

category: '*GToolkit-WireEncoding-GemStone'
classmethod: GtWireEncoderDecoder
defaultMapping
	"The default mapping only encodes directly supported classes"
	| mapping |

	mapping := IdentityDictionary new.
	self map: ExecBlock withSubclassesTo: GtWireBlockClosureEncoder new in: mapping.
	self map: RsrService withSubclassesTo: GtWireGemStoneRsrEncoder new in: mapping.
	mapping
		at: Association put: GtWireAssociationEncoder new;
		at: Boolean put: GtWireBooleanEncoder new;
		at: ByteArray put: GtWireByteArrayEncoder new;
		at: String  put: GtWireStringEncoder new;
		at: DoubleByteString put: GtWireStringEncoder new;
		at: Unicode7 put: GtWireStringEncoder new;
		at: Unicode16 put: GtWireStringEncoder new;
		at: Unicode32 put: GtWireStringEncoder new;
		at: Symbol put: GtWireSymbolEncoder new;
		at: DoubleByteSymbol put: GtWireSymbolEncoder new;
		at: Character put: GtWireCharacterEncoder new;
		at: Array put: GtWireArrayEncoder new;
		at: Dictionary put: GtWireDictionaryEncoder new;
		at: OrderedCollection put: GtWireOrderedCollectionEncoder new;
		at: Set put: GtWireSetEncoder new;
		at: SmallInteger put: GtWireIntegerEncoder new;
		at: LargeInteger put: GtWireIntegerEncoder new;
		at: Float put: GtWireFloatEncoder new;
		at: SmallDouble put: GtWireFloatEncoder new;
		at: UndefinedObject put: GtWireNilEncoder new;
		at: DateAndTime put: GtWireDateAndTimeEncoder new;
		at: SmallDateAndTime put: GtWireDateAndTimeEncoder new.
	^ mapping
%

category: '*GToolkit-WireEncoding-GemStone'
classmethod: GtWireEncoderDecoder
defaultReverseMap

	^ SessionTemps current
		at: #gtGsWireEncodingDefaultReverseMap
		ifAbsentPut: [ self getDefaultReverseMap ]
%

category: '*GToolkit-WireEncoding-GemStone'
classmethod: GtWireEncoderDecoder
getDefaultMap
	"Generated by #generateDefaultMapMethodFrom:.
	Original source is #defaultMapping, changes should be made there and the code regenerated."

	^ IdentityDictionary new
		at: ((self lookupClass: #Array) ifNil: [ self error: 'Unable to find: Array' ]) put: GtWireArrayEncoder new;
		at: ((self lookupClass: #Association) ifNil: [ self error: 'Unable to find: Association' ]) put: GtWireAssociationEncoder new;
		at: ((self lookupClass: #Boolean) ifNil: [ self error: 'Unable to find: Boolean' ]) put: GtWireBooleanEncoder new;
		at: ((self lookupClass: #ByteArray) ifNil: [ self error: 'Unable to find: ByteArray' ]) put: GtWireByteArrayEncoder new;
		at: ((self lookupClass: #Character) ifNil: [ self error: 'Unable to find: Character' ]) put: GtWireCharacterEncoder new;
		at: ((self lookupClass: #DateAndTime) ifNil: [ self error: 'Unable to find: DateAndTime' ]) put: GtWireDateAndTimeEncoder new;
		at: ((self lookupClass: #Dictionary) ifNil: [ self error: 'Unable to find: Dictionary' ]) put: GtWireDictionaryEncoder new;
		at: ((self lookupClass: #DoubleByteString) ifNil: [ self error: 'Unable to find: DoubleByteString' ]) put: GtWireStringEncoder new;
		at: ((self lookupClass: #DoubleByteSymbol) ifNil: [ self error: 'Unable to find: DoubleByteSymbol' ]) put: GtWireSymbolEncoder new;
		at: ((self lookupClass: #ExecBlock) ifNil: [ self error: 'Unable to find: ExecBlock' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock0) ifNil: [ self error: 'Unable to find: ExecBlock0' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock1) ifNil: [ self error: 'Unable to find: ExecBlock1' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock2) ifNil: [ self error: 'Unable to find: ExecBlock2' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock3) ifNil: [ self error: 'Unable to find: ExecBlock3' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock4) ifNil: [ self error: 'Unable to find: ExecBlock4' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlock5) ifNil: [ self error: 'Unable to find: ExecBlock5' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #ExecBlockN) ifNil: [ self error: 'Unable to find: ExecBlockN' ]) put: GtWireBlockClosureEncoder new;
		at: ((self lookupClass: #Float) ifNil: [ self error: 'Unable to find: Float' ]) put: GtWireFloatEncoder new;
		at: ((self lookupClass: #GtRsrEvaluatorFeaturesService) ifNil: [ self error: 'Unable to find: GtRsrEvaluatorFeaturesService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrEvaluatorFeaturesServiceServer) ifNil: [ self error: 'Unable to find: GtRsrEvaluatorFeaturesServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrEvaluatorService) ifNil: [ self error: 'Unable to find: GtRsrEvaluatorService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrEvaluatorServiceServer) ifNil: [ self error: 'Unable to find: GtRsrEvaluatorServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrProxyService) ifNil: [ self error: 'Unable to find: GtRsrProxyService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrProxyServiceServer) ifNil: [ self error: 'Unable to find: GtRsrProxyServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrTestService) ifNil: [ self error: 'Unable to find: GtRsrTestService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrTestServiceClient) ifNil: [ self error: 'Unable to find: GtRsrTestServiceClient' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrTestServiceServer) ifNil: [ self error: 'Unable to find: GtRsrTestServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrWireTransferService) ifNil: [ self error: 'Unable to find: GtRsrWireTransferService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #GtRsrWireTransferServiceServer) ifNil: [ self error: 'Unable to find: GtRsrWireTransferServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #LargeInteger) ifNil: [ self error: 'Unable to find: LargeInteger' ]) put: GtWireIntegerEncoder new;
		at: ((self lookupClass: #OrderedCollection) ifNil: [ self error: 'Unable to find: OrderedCollection' ]) put: GtWireOrderedCollectionEncoder new;
		at: ((self lookupClass: #RsrPolicyRejectedService) ifNil: [ self error: 'Unable to find: RsrPolicyRejectedService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrPolicyRejectedServiceClient) ifNil: [ self error: 'Unable to find: RsrPolicyRejectedServiceClient' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrPolicyRejectedServiceServer) ifNil: [ self error: 'Unable to find: RsrPolicyRejectedServiceServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrReasonService) ifNil: [ self error: 'Unable to find: RsrReasonService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrRemoteException) ifNil: [ self error: 'Unable to find: RsrRemoteException' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrRemoteExceptionClient) ifNil: [ self error: 'Unable to find: RsrRemoteExceptionClient' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrRemoteExceptionServer) ifNil: [ self error: 'Unable to find: RsrRemoteExceptionServer' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #RsrService) ifNil: [ self error: 'Unable to find: RsrService' ]) put: GtWireGemStoneRsrEncoder new;
		at: ((self lookupClass: #Set) ifNil: [ self error: 'Unable to find: Set' ]) put: GtWireSetEncoder new;
		at: ((self lookupClass: #SmallDateAndTime) ifNil: [ self error: 'Unable to find: SmallDateAndTime' ]) put: GtWireDateAndTimeEncoder new;
		at: ((self lookupClass: #SmallDouble) ifNil: [ self error: 'Unable to find: SmallDouble' ]) put: GtWireFloatEncoder new;
		at: ((self lookupClass: #SmallInteger) ifNil: [ self error: 'Unable to find: SmallInteger' ]) put: GtWireIntegerEncoder new;
		at: ((self lookupClass: #String) ifNil: [ self error: 'Unable to find: String' ]) put: GtWireStringEncoder new;
		at: ((self lookupClass: #Symbol) ifNil: [ self error: 'Unable to find: Symbol' ]) put: GtWireSymbolEncoder new;
		at: ((self lookupClass: #UndefinedObject) ifNil: [ self error: 'Unable to find: UndefinedObject' ]) put: GtWireNilEncoder new;
		at: ((self lookupClass: #Unicode16) ifNil: [ self error: 'Unable to find: Unicode16' ]) put: GtWireStringEncoder new;
		at: ((self lookupClass: #Unicode32) ifNil: [ self error: 'Unable to find: Unicode32' ]) put: GtWireStringEncoder new;
		at: ((self lookupClass: #Unicode7) ifNil: [ self error: 'Unable to find: Unicode7' ]) put: GtWireStringEncoder new;
		yourself.
%

category: '*GToolkit-WireEncoding-GemStone'
classmethod: GtWireEncoderDecoder
getDefaultReverseMap
	"Generated by #generateDefaultReverseMapMethodFrom:.
	Original source is #defaultMapping, changes should be made there and the code regenerated."

	^ (Array new: 28)
		at: 1 put: GtWireNilEncoder new;
		at: 2 put: GtWireTrueEncoder new;
		at: 3 put: GtWireFalseEncoder new;
		at: 4 put: GtWireByteArrayEncoder new;
		at: 5 put: GtWireStringEncoder new;
		at: 6 put: GtWireSymbolEncoder new;
		at: 7 put: GtWireCharacterEncoder new;
		at: 8 put: GtWireArrayEncoder new;
		at: 9 put: GtWireDictionaryEncoder new;
		at: 10 put: GtWireOrderedCollectionEncoder new;
		at: 11 put: GtWireSetEncoder new;
		at: 12 put: GtWireDateAndTimeEncoder new;
		at: 13 put: GtWirePositiveIntegerEncoder new;
		at: 14 put: GtWireNegativeIntegerEncoder new;
		at: 15 put: GtWireAssociationEncoder new;
		at: 16 put: GtWireIntegerEncoder new;
		at: 17 put: GtWireFloatEncoder new;
		at: 19 put: GtWireStonEncoder new;
		at: 20 put: GtWireInstVarEncoder new;
		at: 21 put: GtWireBlockClosureEncoder new;
		at: 22 put: GtWireObjectByNameEncoder new;
		at: 23 put: GtWireGemStoneOopEncoder new;
		at: 24 put: GtWireGemStoneRsrEncoder new;
		at: 25 put: GtWireDummyProxyEncoder new;
		at: 27 put: GtWireGemStoneWithRsrEncoder new;
		at: 28 put: GtWireClassEncoder new;
		yourself.
%

! Class extensions for 'GtWireEncodingExamples'

!		Instance methods for 'GtWireEncodingExamples'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireEncodingExamples
assert: aBoolean

	self
		assert: aBoolean
		description: 'Assertion failed'.
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireEncodingExamples
assert: aBoolean description: aString

	aBoolean == true ifFalse:
		[ TestResult failure signal: aString value ]
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireEncodingExamples
assert: actual equals: expected

	self
		assert: actual = expected
		description: actual printString, ' is not equal to ', expected printString.
%

! Class extensions for 'GtWireGemStoneRsrEncoder'

!		Instance methods for 'GtWireGemStoneRsrEncoder'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneRsrEncoder
connection

	^ (SessionTemps current at: #GtRsrServer) connection
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneRsrEncoder
currentWireService

	^ SessionTemps current at: #GtRsrCurrentWireService
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneRsrEncoder
decodeWith: aGtWireEncoderContext
	"It is up to the user to ensure the Object isn't GCd during transfer and decoding
	(which would allow the oop to be reused and the wrong object returned), or that the
	session is aborted."

	^ (self connection serviceAt: aGtWireEncoderContext next) asGtGsArgument
%

! Class extensions for 'GtWireGemStoneWithRsrEncoder'

!		Instance methods for 'GtWireGemStoneWithRsrEncoder'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneWithRsrEncoder
connection

	^ (SessionTemps current at: #GtRsrServer) connection
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneWithRsrEncoder
currentWireService

	^ SessionTemps current at: #GtRsrCurrentWireService
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireGemStoneWithRsrEncoder
decodeWith: aGtWireEncoderContext

	self notYetImplemented
%

! Class extensions for 'GtWireNestedEncodingExamples'

!		Instance methods for 'GtWireNestedEncodingExamples'

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireNestedEncodingExamples
assert: aBoolean

	self
		assert: aBoolean
		description: 'Assertion failed'.
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireNestedEncodingExamples
assert: aBoolean description: aString

	aBoolean == true ifFalse:
		[ TestResult failure signal: aString value ]
%

category: '*GToolkit-WireEncoding-GemStone'
method: GtWireNestedEncodingExamples
assert: actual equals: expected

	self
		assert: actual = expected
		description: actual printString, ' is not equal to ', expected printString.
%

! Class Initialization

run
GtWireEncoderDecoder initialize.
true
%
