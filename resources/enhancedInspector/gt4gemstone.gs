! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin  : https://github.com/feenkcom/gt4gemstone
! Source  : src-gs/gt4gemstone.gs
! License : MIT - Copyright (c) 2021 feenk
!           Full MIT notice and permission text: THIRD-PARTY.md and
!           NOTICE at the root of https://github.com/GemTalk/Jasper
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - regenerated from upstream by
! update_enhanced_inspector_support.sh, which re-applies this header and rewrites
! class placement from Globals to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! Class Declarations
! Generated file, do not Edit

doit
(Error
	subclass: 'GtGemStoneAssertionFailure'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneAssertionFailure
removeallclassmethods GtGemStoneAssertionFailure

doit
(Object
	subclass: 'AkgDebuggerPlay'
	instVarNames: #(process trace allFrames allFramesString count block)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods AkgDebuggerPlay
removeallclassmethods AkgDebuggerPlay

doit
(Object
	subclass: 'GtGemStoneCompilationContext'
	instVarNames: #(receiver frame frameIdentifier frameLevel evaluationContext clientBindings frameBindings)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneCompilationContext
removeallclassmethods GtGemStoneCompilationContext

doit
(Object
	subclass: 'GtGemStoneDebuggerState'
	instVarNames: #(summary isResumable isSuspended isTerminated messageText remoteMetadata callStackSpecification)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'GtGemStoneDebuggerInitialState holds the information required to open the GS debugger in GT:

- display information for the call stack
- exception displayString';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneDebuggerState
removeallclassmethods GtGemStoneDebuggerState

doit
(Object
	subclass: 'GtGemStoneDoubleLocalCallFrame'
	instVarNames: #(previousCallFrame newCallFrame sender)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneDoubleLocalCallFrame
removeallclassmethods GtGemStoneDoubleLocalCallFrame

doit
(Object
	subclass: 'GtGemStoneDoubleLocalCallStack'
	instVarNames: #(previousCallStack newCallStack callFrames)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneDoubleLocalCallStack
removeallclassmethods GtGemStoneDoubleLocalCallStack

doit
(Object
	subclass: 'GtGemStoneEvaluationContext'
	instVarNames: #(exception process semaphore serializationStrategy result evaluationResult completed devMessage evalServer block callStack compilationContext)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneEvaluationContext
removeallclassmethods GtGemStoneEvaluationContext

doit
(Object
	subclass: 'GtGemStoneEvaluationFrameContext'
	instVarNames: #(frameIdentifier evaluationContext)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneEvaluationFrameContext
removeallclassmethods GtGemStoneEvaluationFrameContext

doit
(Object
	subclass: 'GtGemstoneEvaluationResult'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationResult
removeallclassmethods GtGemstoneEvaluationResult

doit
(GtGemstoneEvaluationResult
	subclass: 'GtGemstoneEvaluationCancelledResult'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationCancelledResult
removeallclassmethods GtGemstoneEvaluationCancelledResult

doit
(GtGemstoneEvaluationResult
	subclass: 'GtGemstoneEvaluationComputedResult'
	instVarNames: #(computedResult)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationComputedResult
removeallclassmethods GtGemstoneEvaluationComputedResult

doit
(GtGemstoneEvaluationResult
	subclass: 'GtGemstoneEvaluationExceptionResult'
	instVarNames: #(evaluationContext)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationExceptionResult
removeallclassmethods GtGemstoneEvaluationExceptionResult

doit
(GtGemstoneEvaluationResult
	subclass: 'GtGemstoneEvaluationInProgressResult'
	instVarNames: #(evaluationContext)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationInProgressResult
removeallclassmethods GtGemstoneEvaluationInProgressResult

doit
(GtGemstoneEvaluationResult
	subclass: 'GtGemstoneEvaluationResumedResult'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneEvaluationResumedResult
removeallclassmethods GtGemstoneEvaluationResumedResult

doit
(Object
	subclass: 'GtGemStoneExampleObjectForLocalDelegate'
	instVarNames: #(targetValueOne targetValueTwo anotherDelegate)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneExampleObjectForLocalDelegate
removeallclassmethods GtGemStoneExampleObjectForLocalDelegate

doit
(Object
	subclass: 'GtGemStoneExampleResult'
	instVarNames: #(example result exception)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneExampleResult
removeallclassmethods GtGemStoneExampleResult

doit
(Object
	subclass: 'GtGemStoneExampleRunner'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneExampleRunner
removeallclassmethods GtGemStoneExampleRunner

doit
(Object
	subclass: 'GtGemstoneHttpClient'
	instVarNames: #(url contents headers query)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneHttpClient
removeallclassmethods GtGemstoneHttpClient

doit
(Object
	subclass: 'GtGemstoneHttpJsonSerializer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemstoneHttpJsonSerializer
removeallclassmethods GtGemstoneHttpJsonSerializer

doit
(Object
	subclass: 'GtGemStoneLocalCallFrame'
	instVarNames: #(frameContents homeMethod frameIdentifier)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneLocalCallFrame
removeallclassmethods GtGemStoneLocalCallFrame

doit
(Object
	subclass: 'GtGemStoneLocalCallStack'
	instVarNames: #(callFrames gsProcess nextFrameIdentifier)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneLocalCallStack
removeallclassmethods GtGemStoneLocalCallStack

doit
(Object
	subclass: 'GtGemStoneLocalCallStackUpdater'
	instVarNames: #(targetCallStack)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneLocalCallStackUpdater
removeallclassmethods GtGemStoneLocalCallStackUpdater

doit
(Object
	subclass: 'GtGemStoneRemotePhlowCollectionPrinter'
	instVarNames: #(targetCollection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneRemotePhlowCollectionPrinter
removeallclassmethods GtGemStoneRemotePhlowCollectionPrinter

doit
(GtGemStoneRemotePhlowCollectionPrinter
	subclass: 'GtGemStoneRemotePhlowDictionaryPrinter'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneRemotePhlowDictionaryPrinter
removeallclassmethods GtGemStoneRemotePhlowDictionaryPrinter

doit
(Object
	subclass: 'GtGemStoneSemanticVersionNumber'
	instVarNames: #(major minor patch iceTag)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSemanticVersionNumber
removeallclassmethods GtGemStoneSemanticVersionNumber

doit
(Object
	subclass: 'GtGemStoneSerializationExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSerializationExamples
removeallclassmethods GtGemStoneSerializationExamples

doit
(Object
	subclass: 'GtGemStoneSessionFeature'
	instVarNames: #(enabled featureId)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSessionFeature
removeallclassmethods GtGemStoneSessionFeature

doit
(Object
	subclass: 'GtGemStoneSessionFeatures'
	instVarNames: #(featuresById)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSessionFeatures
removeallclassmethods GtGemStoneSessionFeatures

doit
(Object
	subclass: 'GtGemStoneSessionTransactionConflictsReport'
	instVarNames: #(transactionConflicts)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSessionTransactionConflictsReport
removeallclassmethods GtGemStoneSessionTransactionConflictsReport

doit
(Object
	subclass: 'GtGemStoneSpecification'
	instVarNames: #(remoteMetadata)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSpecification
removeallclassmethods GtGemStoneSpecification

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneCallFrameIdentifier'
	instVarNames: #(identityIndex)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneCallFrameIdentifier
removeallclassmethods GtGemStoneCallFrameIdentifier

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneClassBasicDetails'
	instVarNames: #(targetClassName targetClassIconName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneClassBasicDetails
removeallclassmethods GtGemStoneClassBasicDetails

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneFeatureSpecification'
	instVarNames: #(enabled featureId)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneFeatureSpecification
removeallclassmethods GtGemStoneFeatureSpecification

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneFeaturesSpecification'
	instVarNames: #(featureSpecifications)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneFeaturesSpecification
removeallclassmethods GtGemStoneFeaturesSpecification

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneMethodSpecification'
	instVarNames: #(coderClassName selector isMeta sourceString protocolName categoryName coderClassIconName explicitProviderBehaviourDetails)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneMethodSpecification
removeallclassmethods GtGemStoneMethodSpecification

doit
(GtGemStoneMethodSpecification
	subclass: 'GtGemStoneContextSpecification'
	instVarNames: #(isForBlock ipOffset frameIdentifier programCounterMarkers)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneContextSpecification
removeallclassmethods GtGemStoneContextSpecification

doit
(GtGemStoneSpecification
	subclass: 'GtGemStoneMethodsSpecification'
	instVarNames: #(methodCoderSpecifications)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneMethodsSpecification
removeallclassmethods GtGemStoneMethodsSpecification

doit
(GtGemStoneMethodsSpecification
	subclass: 'GtGemStoneProcessSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneProcessSpecification
removeallclassmethods GtGemStoneProcessSpecification

doit
(Object
	subclass: 'GtGemStoneSpecificationMedatada'
	instVarNames: #(apiVersion schemaVersion)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneSpecificationMedatada
removeallclassmethods GtGemStoneSpecificationMedatada

doit
(Object
	subclass: 'GtGemStoneTranscript'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-Transcript';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneTranscript
removeallclassmethods GtGemStoneTranscript

doit
(GtGemStoneTranscript
	subclass: 'GtGemStoneInImageTranscript'
	instVarNames: #(contentStream enabled)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-Transcript';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneInImageTranscript
removeallclassmethods GtGemStoneInImageTranscript

doit
(Object
	subclass: 'GtGemStoneTranscriptHandler'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-Transcript';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneTranscriptHandler
removeallclassmethods GtGemStoneTranscriptHandler

doit
(Object
	subclass: 'GtGsRelease'
	instVarNames: #(versionString)
	classVars: #()
	classInstVars: #(default)
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGsRelease
removeallclassmethods GtGsRelease

doit
(Object
	subclass: 'GtRsrSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrSerializationStrategy
removeallclassmethods GtRsrSerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrDirectLocalObjectSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrDirectLocalObjectSerializationStrategy
removeallclassmethods GtRsrDirectLocalObjectSerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrLegacySerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrLegacySerializationStrategy
removeallclassmethods GtRsrLegacySerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrLiteralAndProxySerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'GtRsrLiteralAndProxySerializationStrategy answers nil, numbers and booleans by value and everything else by proxy (including strings).';
		immediateInvariant.
true.
%

removeallmethods GtRsrLiteralAndProxySerializationStrategy
removeallclassmethods GtRsrLiteralAndProxySerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrLocalObjectSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrLocalObjectSerializationStrategy
removeallclassmethods GtRsrLocalObjectSerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrPrimitiveOnlySerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'GtRsrPrimitiveOnlySerializationStrategy will answer anything that RSR regards as a primitive type by value, everything else is will trigger an exception.';
		immediateInvariant.
true.
%

removeallmethods GtRsrPrimitiveOnlySerializationStrategy
removeallclassmethods GtRsrPrimitiveOnlySerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrProxyOnlySerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrProxyOnlySerializationStrategy
removeallclassmethods GtRsrProxyOnlySerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrStonSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'STON serialisation answers everything by value, using STON to serialise the object tree.';
		immediateInvariant.
true.
%

removeallmethods GtRsrStonSerializationStrategy
removeallclassmethods GtRsrStonSerializationStrategy

doit
(GtRsrSerializationStrategy
	subclass: 'GtRsrWireSerializationStrategy'
	instVarNames: #(encoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrWireSerializationStrategy
removeallclassmethods GtRsrWireSerializationStrategy

doit
(GtRsrWireSerializationStrategy
	subclass: 'GtRsrRemoteObjectWireSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'GtRsrWithProxyWireSerializationStrategy provides the same functionality as its parent class, but having the separate name allows clients to choose whether to retrieve objects by value (wire serialisation) or with the object''s associated proxy.';
		immediateInvariant.
true.
%

removeallmethods GtRsrRemoteObjectWireSerializationStrategy
removeallclassmethods GtRsrRemoteObjectWireSerializationStrategy

doit
(Object
	subclass: 'STONJSON'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods STONJSON
removeallclassmethods STONJSON

doit
(Object
	subclass: 'ZnBase64Encoder'
	instVarNames: #(alphabet inverse lineLength lineEnd whitespace padding strict)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods ZnBase64Encoder
removeallclassmethods ZnBase64Encoder

doit
(RsrService
	subclass: 'GtRsrEvaluatorFeaturesService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrEvaluatorFeaturesService
removeallclassmethods GtRsrEvaluatorFeaturesService

doit
(GtRsrEvaluatorFeaturesService
	subclass: 'GtRsrEvaluatorFeaturesServiceServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrEvaluatorFeaturesServiceServer
removeallclassmethods GtRsrEvaluatorFeaturesServiceServer

doit
(RsrService
	subclass: 'GtRsrEvaluatorService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		comment: 'GtRsrEvaluatorService provides the ability to evaluate scripts on a GemStone server from a Gtoolkit client, using GemStone''s RemoteServiceReplicator facility.';
		immediateInvariant.
true.
%

removeallmethods GtRsrEvaluatorService
removeallclassmethods GtRsrEvaluatorService

doit
(GtRsrEvaluatorService
	subclass: 'GtRsrEvaluatorServiceServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrEvaluatorServiceServer
removeallclassmethods GtRsrEvaluatorServiceServer

doit
(RsrService
	subclass: 'GtRsrProxyService'
	instVarNames: #(remoteClass)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrProxyService
removeallclassmethods GtRsrProxyService

doit
(GtRsrProxyService
	subclass: 'GtRsrProxyServiceServer'
	instVarNames: #(object)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrProxyServiceServer
removeallclassmethods GtRsrProxyServiceServer

doit
(RsrService
	subclass: 'GtRsrTestService'
	instVarNames: #(object)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrTestService
removeallclassmethods GtRsrTestService

doit
(GtRsrTestService
	subclass: 'GtRsrTestServiceClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrTestServiceClient
removeallclassmethods GtRsrTestServiceClient

doit
(GtRsrTestService
	subclass: 'GtRsrTestServiceServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrTestServiceServer
removeallclassmethods GtRsrTestServiceServer

doit
(RsrService
	subclass: 'GtRsrWireTransferService'
	instVarNames: #(buffer roots)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrWireTransferService
removeallclassmethods GtRsrWireTransferService

doit
(GtRsrWireTransferService
	subclass: 'GtRsrWireTransferServiceServer'
	instVarNames: #(object encoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrWireTransferServiceServer
removeallclassmethods GtRsrWireTransferServiceServer

doit
(TestCase
	subclass: 'GtGemStoneEvaluationContextTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtGemStoneEvaluationContextTest
removeallclassmethods GtGemStoneEvaluationContextTest

doit
(TestCase
	subclass: 'GtRsrEvaluatorServiceTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-GemStone-GemStone';
		immediateInvariant.
true.
%

removeallmethods GtRsrEvaluatorServiceTest
removeallclassmethods GtRsrEvaluatorServiceTest

! Class implementation for 'AkgDebuggerPlay'

!		Class methods for 'AkgDebuggerPlay'

category: 'playing'
classmethod: AkgDebuggerPlay
two
	"AkgDebuggerPlay two"

	^ self new initialize two
%

!		Instance methods for 'AkgDebuggerPlay'

category: 'other'
method: AkgDebuggerPlay
createProcess

	process := [ 
		self evalBlock
			on: ControlInterrupt
			do: [ :ex |
				trace nextPut: #ControlInterrupt -> ex.
				process suspend.
				ex resume ] ] newProcess.
	process
		priority: Processor activeProcess priority - 1;
		breakpointLevel: 1.
	^ process
%

category: 'rewind'
method: AkgDebuggerPlay
doBlock: aBlock
self halt.
	^ aBlock value
%

category: 'other'
method: AkgDebuggerPlay
evalBlock

	^ [ trace nextPut: #StartedProcessExecution.
		self haltMethod.
		trace nextPut: #AfterHalt1.
		trace nextPut: self getString. 
		[ trace nextPut: #AfterHalt3. 
		trace nextPut: #AfterHalt4. ]
			value.
		trace nextPut: #AfterHalt5. 
		trace nextPut: #AfterHalt6. 
		#akgDebuggerPlayDone.
		]
%

category: 'accessing'
method: AkgDebuggerPlay
getString

	^ 'get', 'String'
%

category: 'other'
method: AkgDebuggerPlay
haltMethod

	trace nextPut: #BeforeHalt.
	self halt.
	trace nextPut: #AfterHalt.
%

category: 'initialization'
method: AkgDebuggerPlay
initialize

	super initialize.
	trace := SharedQueue new.
	count := 0.
%

category: 'other'
method: AkgDebuggerPlay
printOn: aStream

	trace ifNil: [ ^ super printOn: aStream ].
	trace printOn: aStream.
%

category: 'other'
method: AkgDebuggerPlay
process

	^ process
%

category: 'other'
method: AkgDebuggerPlay
run
	| whichProc |

	self createProcess.
	process resume.
	self waitMS: 100.
	allFrames := process gtAllFrames.
	allFramesString := allFrames at: 10.
	whichProc := Processor activeProcess == process.
	process setStepOverBreaksAtLevel: 11.
	process resume.
	self waitMS: 100.
	"process resume."
	"self waitMS: 100."
	self halt.
%

category: 'other'
method: AkgDebuggerPlay
trace

	^ trace
%

category: 'rewind'
method: AkgDebuggerPlay
two

	count := count + 1.
	count = 1 ifTrue: [ block := [ ^ 'v 001' ] ].
	count = 2 ifTrue: 
		[ self doBlock: block ]
	ifFalse: 
		[ count < 2 ifTrue: [ self two ] ].
	count := count + 1.
	^ count
%

category: 'other'
method: AkgDebuggerPlay
waitMS: milliseconds
	(Delay forMilliseconds: milliseconds) wait
%

! Class implementation for 'GtGemStoneCompilationContext'

!		Class methods for 'GtGemStoneCompilationContext'

category: 'instance creation'
classmethod: GtGemStoneCompilationContext
receiver: anObject  frameIdentifierIndex: aFrameIdentifierIndex evaluationContext: aTargetEvaluationContext clientBindings: aDictionary 
	^ self new 
			setReceiver: anObject  
			frameIdentifierIndex: aFrameIdentifierIndex 
			evaluationContext: aTargetEvaluationContext 
			clientBindings: aDictionary
%

!		Instance methods for 'GtGemStoneCompilationContext'

category: 'accessing'
method: GtGemStoneCompilationContext
allBindings
	| allBindings |
	allBindings := GsCurrentSession currentSession symbolList
		, (Array with: clientBindings).

	^ frame
		ifNil: [allBindings ]
		ifNotNil: [ allBindings, (Array with: frameBindings) ]
%

category: 'bindings'
method: GtGemStoneCompilationContext
createClientBindingsFrom: aDictionary
	| newBindings |

	newBindings := SymbolDictionary new
		name: #'Explicit client bindings'.
	aDictionary keysAndValuesDo: [ :key :value |
		newBindings at: key put: value asGtGsArgument ].

	^ newBindings
%

category: 'bindings'
method: GtGemStoneCompilationContext
createFrameBindignsForFrame: aCallFrame ofEvaluationContext: aTargetEvaluationContext
	^ aCallFrame createFrameBindings
			name: ('Frame bindings for frame index ' 
				, frame frameIdentifier identityIndex printString
				,  ' in process with oop '
				,  aTargetEvaluationContext processOop printString) asSymbol;
			yourself
%

category: 'accessing'
method: GtGemStoneCompilationContext
currentReceiver
	^ frame 
		ifNil: [ receiver ]
		ifNotNil: [ frame receiver ]
%

category: 'private'
method: GtGemStoneCompilationContext
initializeFrameWithFrameIdentifierIndex: aFrameIdentifierIndex
	frame := evaluationContext frameForIdentifierIndex: aFrameIdentifierIndex.
	frameIdentifier := frame frameIdentifier.
	frameLevel := evaluationContext frameLevelForIdentifier: frameIdentifier.
	frameBindings := self 
		createFrameBindignsForFrame: frame 
		ofEvaluationContext: evaluationContext
%

category: 'private'
method: GtGemStoneCompilationContext
setReceiver: anObject  frameIdentifierIndex: aFrameIdentifierIndex evaluationContext: aTargetEvaluationContext clientBindings: aDictionary
	receiver := anObject.
	clientBindings := self createClientBindingsFrom: aDictionary.

	(aFrameIdentifierIndex notNil and: [
		aTargetEvaluationContext notNil]) ifTrue: [
			evaluationContext := aTargetEvaluationContext.
			self initializeFrameWithFrameIdentifierIndex: aFrameIdentifierIndex ]
%

category: 'updating'
method: GtGemStoneCompilationContext
updatedFrameBindings
	frame ifNil: [ ^ self ].

	evaluationContext 
			updateBindingsForFrame: frame
			atLevel: frameLevel
			with: frameBindings
%

! Class implementation for 'GtGemStoneDebuggerState'

!		Class methods for 'GtGemStoneDebuggerState'

category: 'instance creation'
classmethod: GtGemStoneDebuggerState
fromJsonString: aString
	^ self new 
		initializeFromJsonString: aString
%

category: 'instance creation'
classmethod: GtGemStoneDebuggerState
process: aGsProcess exception: anException
	"Create a new instance of the receiver populated for the supplied process and exception"

	^ self new 
		initializeProcess: aGsProcess 
		exception: anException
%

category: 'instance creation'
classmethod: GtGemStoneDebuggerState
process: aGsProcess exception: anException callStack: aCallStack
	"Create a new instance of the receiver populated for the supplied process and exception"

	^ self new 
		initializeProcess: aGsProcess 
		exception: anException
		callStack: aCallStack
%

!		Instance methods for 'GtGemStoneDebuggerState'

category: 'converting'
method: GtGemStoneDebuggerState
asDictionaryForExport

	^ Dictionary new
		at: 'messageText' put: messageText;
		at: 'isSuspended' put: isSuspended;
		at: 'isResumable' put: isResumable;
		at: 'isTerminated' put: isTerminated;
		at: 'summary' put: summary;
		at: 'callStack' put: callStackSpecification asDictionaryForExport;
		addAll: self localMetadata asMetadataAttributesForExport;
		yourself
%

category: 'converting'
method: GtGemStoneDebuggerState
asJsonForExport 
	"Answer the receiver serialised in JSON format"

	^STON toJsonString: self asDictionaryForExport
%

category: 'accessing'
method: GtGemStoneDebuggerState
callStack

	^ callStackSpecification
%

category: 'accessing'
method: GtGemStoneDebuggerState
callStackSpecification

	^ callStackSpecification
%

category: 'gt - extensions'
method: GtGemStoneDebuggerState
gtViewCallFrameSpecificationsFor: aView 
	<gtView>
	
	^ aView forward 
		title: 'Frame specifications';
		object: [ self callStackSpecification ];
		view: #gtViewCallFrameSpecificationsFor: 
%

category: 'converting'
method: GtGemStoneDebuggerState
initializeFromJSONDictionary: aDictionary
	
	messageText := aDictionary at: 'messageText'.
	isResumable := aDictionary at: 'isResumable'.
	isSuspended := aDictionary at: 'isSuspended'.
	isTerminated := aDictionary at: 'isTerminated'.
	summary := aDictionary at: 'summary'.
	
	callStackSpecification := GtGemStoneProcessSpecification 
		fromJSONDictionary:  (aDictionary at: 'callStack').
		
	self initializeMetadataFromJSONDictionary: aDictionary.
%

category: 'converting'
method: GtGemStoneDebuggerState
initializeFromJsonString: aString
	| dictionary |

	dictionary := STON fromString: aString.
	
	self initializeFromJSONDictionary: dictionary.
%

category: 'converting'
method: GtGemStoneDebuggerState
initializeMetadataFromJSONDictionary: aDictionary 
	remoteMetadata := GtGemStoneSpecificationMedatada 
		fromObjectDictionary: aDictionary
%

category: 'initialize'
method: GtGemStoneDebuggerState
initializeProcess2: aGsProcess exception: anException

	messageText := [ anException messageText ifNil: [ anException printString ] ]
		on: Error
		do: [ :ex | 'Error while attempting to obtain messageText' ].
	isResumable := anException isResumable.
	isSuspended := aGsProcess _isSuspended.
	isTerminated := aGsProcess _isTerminated.
	summary := aGsProcess _isTerminated
		ifTrue: [ 'Terminated: ', messageText ]
		ifFalse: [ messageText ].

	callStackSpecification := aGsProcess gtAllFrames collect: [ :frameArray |
		| homeMethod |
		homeMethod := frameArray first homeMethod.
		{ homeMethod inClass ifNotNil: [ :cls | cls name ].
		homeMethod selector.
		frameArray first isMethodForBlock. } ].
%

category: 'initialize'
method: GtGemStoneDebuggerState
initializeProcess: aGsProcess exception: anException

	messageText := [ anException messageText ifNil: [ anException printString ] ]
		on: Error
		do: [ :ex | 'Error while attempting to obtain messageText' ].
	isResumable := anException isResumable.
	isSuspended := aGsProcess _isSuspended.
	isTerminated := aGsProcess _isTerminated.
	summary := aGsProcess _isTerminated
		ifTrue: [ 'Terminated: ', messageText ]
		ifFalse: [ messageText ].

	callStackSpecification := (GtGemStoneLocalCallStack forProcess: aGsProcess) createSpecification
%

category: 'initialize'
method: GtGemStoneDebuggerState
initializeProcess: aGsProcess exception: anException callStack: aCallStack

	messageText := [ anException messageText ifNil: [ anException printString ] ]
		on: Error
		do: [ :ex | 'Error while attempting to obtain messageText' ].
	isResumable := anException isResumable.
	isSuspended := aGsProcess _isSuspended.
	isTerminated := aGsProcess _isTerminated.
	summary := aGsProcess _isTerminated
		ifTrue: [ 'Terminated: ', messageText ]
		ifFalse: [ messageText ].

	callStackSpecification := aCallStack createSpecification
%

category: 'accessing'
method: GtGemStoneDebuggerState
isResumable

	^ isResumable
%

category: 'accessing'
method: GtGemStoneDebuggerState
isSuspended

	^ isSuspended
%

category: 'accessing'
method: GtGemStoneDebuggerState
isTerminated

	^ isTerminated
%

category: 'converting'
method: GtGemStoneDebuggerState
llmDataViewFor: aDataView
	<gtLlmDataView>
	
	^aDataView jsonData
			title: 'Exception properties';
			data: [ 
				{
					'summary' -> self summary.
					'messageText' -> self messageText.
					'callStack' -> (self callStackSpecification frameSpecifications
						collect: [ :aStackFrame |
							String streamContents: [:aStream |
								aStream 
									<< aStackFrame printBehaviorName;
									<< '>>';
									<< (aStackFrame selector ifNil: [ '<none>' ]) ]])
				} asDictionary]
%

category: 'accessing - metadata'
method: GtGemStoneDebuggerState
localApiVersion
	^ GtGemStoneSemanticVersionNumber oneZeroZero
%

category: 'accessing - metadata'
method: GtGemStoneDebuggerState
localMetadata
	^ GtGemStoneSpecificationMedatada new 
		apiVersion: self localApiVersion;
		schemaVersion: self localSchemaVersion
%

category: 'accessing - metadata'
method: GtGemStoneDebuggerState
localSchemaVersion
	^ GtGemStoneSemanticVersionNumber oneZeroZero
%

category: 'accessing'
method: GtGemStoneDebuggerState
messageText

	^ messageText
%

category: 'accessing - metadata'
method: GtGemStoneDebuggerState
remoteMetadata
	^ remoteMetadata
%

category: 'accessing'
method: GtGemStoneDebuggerState
summary

	^ summary
%

! Class implementation for 'GtGemStoneDoubleLocalCallFrame'

!		Class methods for 'GtGemStoneDoubleLocalCallFrame'

category: 'instance creation'
classmethod: GtGemStoneDoubleLocalCallFrame
forPreviousCallFrame: aPreviousCallFrame newCallFrame: aNewCallFrame
	^ self new 
		initializeForPreviousCallFrame: aPreviousCallFrame 
		newCallFrame: aNewCallFrame
%

!		Instance methods for 'GtGemStoneDoubleLocalCallFrame'

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
frameIdentifierDescription
	^ String streamContents: [ :aStream | 
		self printFrameIdentifierDescriptionOn: aStream ]
%

category: 'testing'
method: GtGemStoneDoubleLocalCallFrame
hasCallFrames 
	^ previousCallFrame notNil and: [ newCallFrame notNil ]
%

category: 'testing'
method: GtGemStoneDoubleLocalCallFrame
hasSameProperties
	^ self hasCallFrames and: [ 
			previousCallFrame hasSamePropertiesAs: newCallFrame ]
%

category: 'testing'
method: GtGemStoneDoubleLocalCallFrame
hasSamePropertiesSinceTheBeginning
	| currentContext |
	currentContext := self.
	[ currentContext notNil and: [currentContext hasSameProperties ] ]
		whileTrue: [ currentContext := currentContext sender ].
		
	^ currentContext isNil
%

category: 'initialization'
method: GtGemStoneDoubleLocalCallFrame
initializeForPreviousCallFrame: aPreviousCallFrame newCallFrame: aNewCallFrame 
	previousCallFrame := aPreviousCallFrame.
	newCallFrame := aNewCallFrame.
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
ipOffsetDescription
	^ String streamContents: [ :aStream | 
		self printIpOffsetDescriptionOn: aStream ]
%

category: 'testing'
method: GtGemStoneDoubleLocalCallFrame
isForSameMethodOrBlock
	^ self hasCallFrames and: [
			previousCallFrame isForSameMethodOrBlockAs: newCallFrame ]
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
methodDescription
	^ String streamContents: [ :aStream | 
		self printMethodDescriptionOn: aStream ]
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
newCallFrame
	^ newCallFrame
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
newFrameIdentifier
	^ newCallFrame 
		ifNil: [ nil ]
		ifNotNil: [ :aCallFrame | aCallFrame frameIdentifier ]
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
newIpOffset
	^ newCallFrame 
		ifNil: [ nil ]
		ifNotNil: [ :aCallFrame | aCallFrame ipOffset ]
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
phlowBackgroundColor
	^ nil
	"| allSendersMatch |
	allSendersMatch := self sender
		ifNil: [true] 
		ifNotNil: [ :aSender | aSender hasSamePropertiesSinceTheBeginning ].
	
	^ (self hasSameProperties and: [ allSendersMatch ])
			ifTrue: [ GtPhlowColor named: #green alpha: 0.4 ]
			ifFalse: [ 
				allSendersMatch
					ifTrue: [ GtPhlowColor named: #orange alpha: 0.4 ]
					ifFalse: [ GtPhlowColor transparent ]  ]"
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
phlowBackgroundColorInIsolation
	^ nil
	"| senderMatches |
	senderMatches := self sender
		ifNil: [true] 
		ifNotNil: [ :aSender | aSender hasSameProperties ].
	
	^ self hasSameProperties
			ifTrue: [ GtPhlowColor named: #green alpha: 0.4 ]
			ifFalse: [ 
				senderMatches
					ifTrue: [ GtPhlowColor named: #orange alpha: 0.4 ]
					ifFalse: [ GtPhlowColor transparent ]  ]"
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
previousCallFrame
	^ previousCallFrame
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
previousFrameIdentifier
	^ previousCallFrame 
		ifNil: [ nil ]
		ifNotNil: [ :aCallFrame | aCallFrame frameIdentifier ]
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
previousIpOffset
	^ previousCallFrame 
		ifNil: [ nil ]
		ifNotNil: [ :aCallFrame | aCallFrame ipOffset ]
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
printComparisonBetween: anObject and: anotherObject withFormat: aFormatBlock on: aStream
	| previousDescription newDescription|
	previousDescription := anObject
		ifNil: [ ' - '] ifNotNil: [ :targetObject | aFormatBlock cull: targetObject ].
	newDescription := anotherObject
		ifNil: [ ' - '] ifNotNil: [ :targetObject | aFormatBlock cull: targetObject ].
	
	anObject = anotherObject
		ifTrue: [
			aStream
				nextPutAll: previousDescription ]
		ifFalse: [
			aStream
				nextPutAll: previousDescription;
				nextPutAll: ' / ';
				nextPutAll: newDescription ]
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
printFrameIdentifierDescriptionOn: aStream
	^ self 
		printComparisonBetween: self previousFrameIdentifier 
		and: self newFrameIdentifier 
		withFormat: [ :anIdentifier | anIdentifier description ] 
		on: aStream
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
printIpOffsetDescriptionOn: aStream
	^ self 
		printComparisonBetween: self previousIpOffset 
		and: self newIpOffset 
		withFormat: [ :anOffset | anOffset asString ]
		on: aStream
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
printMethodDescriptionOn: aStream
	| previousDescription newDescription|
	previousDescription := self previousCallFrame
		ifNil: [ ' - '] ifNotNil: [ :aCallFrame | aCallFrame methodDescription ].
	newDescription := self newCallFrame
		ifNil: [ ' - '] ifNotNil: [ :aCallFrame | aCallFrame methodDescription ].
	
	self isForSameMethodOrBlock
		ifTrue: [
			aStream
				nextPutAll: previousDescription ]
		ifFalse: [
			aStream
				nextPutAll: previousDescription;
				nextPutAll: ' / ';
				nextPutAll: newDescription ]
%

category: 'printing'
method: GtGemStoneDoubleLocalCallFrame
printOn: aStream
	super printOn: aStream.
	
	self isForSameMethodOrBlock ifTrue: [
		aStream parenthesize: [ 
			previousCallFrame printMethodDescriptionOn: aStream.
			aStream 
				nextPutAll: ' ['.
			self printIpOffsetDescriptionOn: aStream.
			aStream
				nextPutAll: ']; id='.
			self printFrameIdentifierDescriptionOn: aStream ].
		^ self ].
		
	aStream parenthesize: [ 
		previousCallFrame
			ifNil: [ aStream nextPutAll: ' - ']
			ifNotNil: [ 
				previousCallFrame printMethodDescriptionOn: aStream.
				aStream nextPutAll: ' '.
				previousCallFrame printExtraDetailsOn: aStream. ].
		aStream nextPutAll: ' / '.
		newCallFrame
			ifNil: [ aStream nextPutAll: ' - ']
			ifNotNil: [ 
				newCallFrame printMethodDescriptionOn: aStream.
				aStream nextPutAll: ' '.
				newCallFrame printExtraDetailsOn: aStream. ] ] 
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
sender
	^ sender
%

category: 'accessing'
method: GtGemStoneDoubleLocalCallFrame
sender: aDoubleStackFrame
	(sender isNil and: [ aDoubleStackFrame notNil ]) ifFalse: [ Error signal] .
	
	sender := aDoubleStackFrame
%

! Class implementation for 'GtGemStoneDoubleLocalCallStack'

!		Class methods for 'GtGemStoneDoubleLocalCallStack'

category: 'instance creation'
classmethod: GtGemStoneDoubleLocalCallStack
forPreviousCallStack: aPreviousCallStack newCallStack: aNewCallStack
	^ self new 
		initializeForPreviousCallStack: aPreviousCallStack 
		newCallStack: aNewCallStack
%

!		Instance methods for 'GtGemStoneDoubleLocalCallStack'

category: 'accessing'
method: GtGemStoneDoubleLocalCallStack
firstDivergentContentsIndex
	"This looks for the first different pair of contexts between the two stack."
	| currentIndex newIndex |
	currentIndex := previousCallStack numberOfCallFrames.
	newIndex := newCallStack numberOfCallFrames.

	[ 
		(1 <= currentIndex) and: [
			(1 <= newIndex) and: [
				(previousCallStack callFramesAt: currentIndex)
					hasSamePropertiesAs:(newCallStack callFramesAt: newIndex) ] ]
	] whileTrue: [ 
		currentIndex := currentIndex - 1.
		newIndex := newIndex - 1 ].
	
	^ {currentIndex . newIndex}
%

category: 'gt - extensions'
method: GtGemStoneDoubleLocalCallStack
gtViewDoubleStackFramesBasicFor: aView
	"<gtView>"
	"Create a view where the background color is determined by doing looking
	only at the context in isolation (ignoring senders)"
	
	^ (self 
		gtViewDoubleStackFramesFor: aView 
		withBackground:  [ :aDescription :aDoubleFrame |
			aDoubleFrame phlowBackgroundColorInIsolation ])
				title: 'Call Frames - in isolation';
				priority: 15
%

category: 'gt - extensions'
method: GtGemStoneDoubleLocalCallStack
gtViewDoubleStackFramesFor: aView withBackground: aBackgroundBlock
	
	^ aView columnedList 
		items: [ callFrames ];
		column: 'Index' textDo: [ :aColumn |
			aColumn
				format: [ :aDoubleFrame :anIndex | anIndex ];
				width: 75;
				background: aBackgroundBlock ];
		column: 'Identifier' textDo: [ :aColumn | 
			aColumn
				format: [ :aDoubleFrame |
					aDoubleFrame frameIdentifierDescription ];
				width: 75;
				background: aBackgroundBlock ];
		column: 'IP Offset' textDo: [ :aColumn | 
			aColumn
				format: [ :aDoubleFrame |
					aDoubleFrame ipOffsetDescription ];
				width: 75;
				background: aBackgroundBlock ];
		column: 'New Stack'  textDo: [ :aColumn | 
			aColumn
				format: [ :aDoubleFrame |
					aDoubleFrame newCallFrame 
						ifNil: [ '-' ] ifNotNil: [ :aCallFrame | 
							aCallFrame methodDescription ] ];
				background: aBackgroundBlock ];
		column: 'Previous Stack'  textDo: [ :aColumn | 
			aColumn
				format: [ :aDoubleFrame |
					(aDoubleFrame isForSameMethodOrBlock not and: [
						aDoubleFrame newCallFrame notNil ])
							ifFalse: [ ''] 
							ifTrue: [ 
								aDoubleFrame newCallFrame methodDescription ] ];
				background: [ :aDescription :aDoubleFrame |
					aDoubleFrame isForSameMethodOrBlock 
						ifTrue: ["GtPhlowColor transparent" nil]
						ifFalse: [ 
							aBackgroundBlock cull: aDescription cull: aDoubleFrame ] ] ]
%

category: 'gt - extensions'
method: GtGemStoneDoubleLocalCallStack
gtViewDoubleStackFramesListFor: aView
	"<gtView>"
	"Create a view where the background color is determined by doing looking
	at the full stack."
	
	^ (self 
		gtViewDoubleStackFramesFor: aView 
		withBackground:  [ :aDescription :aDoubleFrame |
			aDoubleFrame phlowBackgroundColor ])
				title: 'Call Frames';
				priority: 10
%

category: 'gt - extensions'
method: GtGemStoneDoubleLocalCallStack
gtViewNewStackFramesFor: aView
	<gtView>
	
	^ aView forward 
		title: 'New Call Frames';
		priority: 41;
		object: [ newCallStack ];
		view: #gtViewStackFramesFor: 
%

category: 'gt - extensions'
method: GtGemStoneDoubleLocalCallStack
gtViewPreviousStackFramesFor: aView
	<gtView>
	
	^ aView forward 
		title: 'Previous Call Frames';
		priority: 40;
		object: [ previousCallStack ];
		view: #gtViewStackFramesFor: 
%

category: 'initialization'
method: GtGemStoneDoubleLocalCallStack
initializeCallStackFrames
	| previousIndex newIndex reversedCallFrames |
	
	previousIndex := previousCallStack numberOfCallFrames.
	newIndex := newCallStack numberOfCallFrames.
	reversedCallFrames := OrderedCollection new.

	[ 
		(1 <= previousIndex) and: [ (1 <= newIndex) ]
	] whileTrue: [ 
		reversedCallFrames add: (GtGemStoneDoubleLocalCallFrame
			forPreviousCallFrame: (previousCallStack callFramesAt: previousIndex)
			newCallFrame: (newCallStack callFramesAt: newIndex)).
		previousIndex := previousIndex - 1.
		newIndex := newIndex - 1 ].
		
	[ 1 <= previousIndex ] whileTrue: [
		reversedCallFrames add: (GtGemStoneDoubleLocalCallFrame
			forPreviousCallFrame: (previousCallStack callFramesAt: previousIndex)
			newCallFrame: nil).
		previousIndex := previousIndex - 1 ].
	
	[ 1 <= newIndex ] whileTrue: [
		reversedCallFrames add: (GtGemStoneDoubleLocalCallFrame
			forPreviousCallFrame: nil
			newCallFrame: (newCallStack callFramesAt: newIndex)).
		newIndex := newIndex - 1 ].
		
	callFrames := reversedCallFrames reversed.
%

category: 'initialization'
method: GtGemStoneDoubleLocalCallStack
initializeForPreviousCallStack: aPreviousCallStack newCallStack: aNewCallStack
	previousCallStack := aPreviousCallStack.
	newCallStack := aNewCallStack. 
	
	self initializeCallStackFrames.
	self initializeStackFrameSenders
%

category: 'initialization'
method: GtGemStoneDoubleLocalCallStack
initializeStackFrameSenders
	1 to: callFrames size -1 do: [ :anIndex |
		(callFrames at: anIndex) sender: (callFrames at: anIndex + 1)  ]
%

! Class implementation for 'GtGemStoneEvaluationContext'

!		Instance methods for 'GtGemStoneEvaluationContext'

category: 'private'
method: GtGemStoneEvaluationContext
assertNotSignalled

	semaphore isLocked ifFalse:
		[ self error: 'Process semaphore already signalled' ]
%

category: 'accessing'
method: GtGemStoneEvaluationContext
buildMessageText

	^ exception buildMessageText
%

category: 'private'
method: GtGemStoneEvaluationContext
callStack
	^ callStack ifNil: [
			callStack := self createNewCallStack ]
%

category: 'accessing'
method: GtGemStoneEvaluationContext
compilationContext: aCompilationContext
	compilationContext := aCompilationContext
%

category: 'private'
method: GtGemStoneEvaluationContext
createNewCallStack
	^ GtGemStoneLocalCallStack forProcess: process
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
debuggerState
	callStack := self createNewCallStack.
	
	^ GtGemStoneDebuggerState
		process: process
		exception: exception
		callStack: callStack
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
debuggerStateDictionaryForExport

	^ self debuggerState asDictionaryForExport
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
debuggerStateJsonForExport

	^ self debuggerState asJsonForExport
%

category: 'accessing'
method: GtGemStoneEvaluationContext
devMessage
	^devMessage
%

category: 'accessing'
method: GtGemStoneEvaluationContext
devMessage: object
	devMessage := object
%

category: 'accessing'
method: GtGemStoneEvaluationContext
evalServer
	^evalServer
%

category: 'accessing'
method: GtGemStoneEvaluationContext
evalServer: object
	evalServer := object
%

category: 'actions - api'
method: GtGemStoneEvaluationContext
evaluateAndWaitBlock: aBlock from: anEvaluationServer
	"Evaluate the supplied block.
	If it completes successfully, answer the result.
	If an exception is raised, suspend the evaluation process and answer the receiver."

	self evaluateBlock: aBlock from: anEvaluationServer priority: Processor userBackgroundPriority.
	^ self waitForEvaluationResult.
%

category: 'actions - api'
method: GtGemStoneEvaluationContext
evaluateBlock: aBlock from: anEvaluationServer priority: anInteger
	"Start evaluation of the supplied block.
	If it completes successfully, result is the return value of aBlock.
	If an exception is raised, suspend the evaluation process and set result to the receiver."

	block := aBlock.
	semaphore := Semaphore new.
	completed := false.
	evalServer := anEvaluationServer.

	process := [
		[ | computationResult |
		computationResult := block value.

		result := self serializationStrategy
			ifNil: [ computationResult  ]
			ifNotNil: [ :aSerializationStrategy | 
				| strategies strategy |
				strategies := SessionTemps current
					at: #GtSerializationStrategies
					ifAbsent: [].
				strategy := strategies ifNotNil:
					[ strategies at: aSerializationStrategy ifAbsent: [] ].
				strategy ifNil:
					[ strategy := (GsSession currentSession objectNamed: aSerializationStrategy) new ].
				strategy serialize: computationResult ].
		evaluationResult := GtGemstoneEvaluationComputedResult new 
			computedResult: result.
		completed := true.
		semaphore signal ]
			on: Exception
			do: (self handlerBlock: nil) ] newProcess.

	"Need to figure out the circumstances when the debugActionBlock: is called"
	process debugActionBlock: (self handlerBlock: 'debugActionBlock:').

	process
		name: 'GT evaluation';
		priority: anInteger;
		breakpointLevel: 1;
		resume.

	^ GtGemstoneEvaluationInProgressResult new
		 evaluationContext: self
%

category: 'accessing'
method: GtGemStoneEvaluationContext
exception

	^ exception
%

category: 'accessing'
method: GtGemStoneEvaluationContext
exception: anException

	exception := anException
%

category: 'accessing'
method: GtGemStoneEvaluationContext
frameContentsAtLevel: anInteger

	^ process _frameContentsAt: anInteger
%

category: 'private'
method: GtGemStoneEvaluationContext
frameForIdentifier: aFrameIdentifier
	callStack ifNil: [ Error signal: 'Call stack not initialized!' ].

	^ callStack frameForIdentifier: aFrameIdentifier
%

category: 'private'
method: GtGemStoneEvaluationContext
frameForIdentifierIndex: aFrameIdentifierIndex
	^ self frameForIdentifier: (GtGemStoneCallFrameIdentifier forIndex: aFrameIdentifierIndex)
%

category: 'private'
method: GtGemStoneEvaluationContext
frameLevelForIdentifier: aFrameIdentifier
	callStack ifNil: [ Error signal: 'Call stack not initialized!' ].

	^ callStack frameLevelForIdentifier: aFrameIdentifier
%

category: 'private'
method: GtGemStoneEvaluationContext
frameLevelForIdentifierIndex: aFrameIdentifierIndex
	^ self frameLevelForIdentifier: (GtGemStoneCallFrameIdentifier forIndex: aFrameIdentifierIndex)
%

category: 'private'
method: GtGemStoneEvaluationContext
handlerBlock: anObject
	"Answer the block that will be evaluated if an exception occurs.
	In this case, suspend the evaluation process and answer the receiver.
	If the user resumes the process it will then resume from where the exception was originally raised."

	^ [ :ex |
	
		exception := ex.
		devMessage := anObject.
	
		result := self asGtRsrProxyObjectForConnection: evalServer _connection.
		evaluationResult := GtGemstoneEvaluationExceptionResult new
			evaluationContext: self.
	
		semaphore signal.
		process suspend.
		ex resume ]
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
interruptAsyncComputation

	process suspend.

	self createNewCallStack firstNonCriticalFrameIndex
		ifNil: [ "Possibly handle the case of processes that we cannot interrupt" ]
		ifNotNil: [ :anIndex | 
			process setStepIntoBreaksAtLevel: 	anIndex ].
	
	process resume.

	^ #interruptedAsync
%

category: 'testing'
method: GtGemStoneEvaluationContext
isCompleted
	"Answer a boolean indicating whether the receiver's process has completed and successfully answered a result"

	^ completed
%

category: 'testing'
method: GtGemStoneEvaluationContext
isResumable

	^ exception isResumable
%

category: 'testing'
method: GtGemStoneEvaluationContext
isSuspended

	^ process _isSuspended
%

category: 'testing'
method: GtGemStoneEvaluationContext
isTerminated

	^ process _isTerminated
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
methodAtFrameLevel: anInteger

	^ (process _frameContentsAt: anInteger) first
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
newDebuggerState
	callStack := self createNewCallStack.
	
	^ GtGemStoneDebuggerState
		process: process
		exception: exception
		callStack: callStack
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
newDebuggerStateDictionaryForExport

	^ self newDebuggerState asDictionaryForExport
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
newDebuggerStateJsonForExport

	^ self newDebuggerState asJsonForExport
%

category: 'accessing'
method: GtGemStoneEvaluationContext
process

	^ process
%

category: 'accessing'
method: GtGemStoneEvaluationContext
processOop
	^ process asOop
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
programCounterMarkersAtFrameIdentifierIndex: aFrameIdentifierIndex
	^ (self frameForIdentifierIndex: aFrameIdentifierIndex) programCounterMarkers
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
restartFrameIdentifierIndex: aFrameIdentifierIndex
	^ self restartFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
restartFrameLevel: anInteger

	process _trimStackToLevel: anInteger.
	^ #restart
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
resume

	self assertNotSignalled.
	process resume.
	
	^ self waitForEvaluationResult asDictionaryForExport
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
resumeAsyncComputation

	self assertNotSignalled.
	process resume.

	^ GtGemstoneEvaluationResumedResult new asDictionaryForExport
%

category: 'accessing'
method: GtGemStoneEvaluationContext
serializationStrategy
	^serializationStrategy
%

category: 'accessing'
method: GtGemStoneEvaluationContext
serializationStrategy: object
	serializationStrategy := object
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
sourceCodeAtFrameLevel: anInteger

	^ (self stackFrames at: anInteger) first sourceString
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
sourceInfoAtFrameIdentifierIndex: aFrameIdentifierIndex
	^ self sourceInfoAtFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
sourceInfoAtFrameLevel: anInteger
	| frameContents source ipOffset markers startIndex endIndex i |

	frameContents := self stackFrames at: anInteger.
	source := frameContents first sourceString.
	ipOffset := frameContents second.
	markers := frameContents first _buildIpMarkerArray.
	startIndex := markers indexOf: ipOffset.
	startIndex = 0 ifTrue:
		[ ^ { 1. source size. source } ].
	i := startIndex + 1.

	[ endIndex isNil and: [ i <= markers size ] ] whileTrue:
		[ (markers at: i) notNil ifTrue:
			[ endIndex := i ].
		i := i + 1 ].
	endIndex ifNil: [ endIndex := source size ].
	^ { startIndex. endIndex. source. }
%

category: 'accessing'
method: GtGemStoneEvaluationContext
stackFrames

	^ process gtAllFrames
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
stdout

	^ System gemLogFileName asFileReference contents
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
stepIntoFrameIdentifierIndex: aFrameIdentifierIndex
	^ self stepIntoFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
stepIntoFrameLevel: anInteger

	process setStepIntoBreaksAtLevel: anInteger.
	self resume.
	^ #stepInto
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
stepOverFrameIdentifierIndex: aFrameIdentifierIndex
	^ self stepOverFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
stepOverFrameLevel: anInteger

	process setStepOverBreaksAtLevel: anInteger.
	self resume.
	^ #stepOver
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
stepThroughFrameIdentifierIndex: aFrameIdentifierIndex
	^ self stepThroughFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
stepThroughFrameLevel: anInteger

	process setStepThroughBreaksAtLevel: anInteger.
	self resume.
	^ #stepThrough
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
synchronizeCallStack
	| currentCallStack stackUpdater |
	currentCallStack := self callStack.
	stackUpdater := GtGemStoneLocalCallStackUpdater forCallStack: currentCallStack.

	stackUpdater updateBasedOn: self createNewCallStack.

	^ (GtGemStoneDebuggerState
		process: process
		exception: exception
		callStack: currentCallStack) asJsonForExport
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
synchronizeCallStackDictionaryForExport
	| currentCallStack stackUpdater |
	currentCallStack := self callStack.
	stackUpdater := GtGemStoneLocalCallStackUpdater forCallStack: currentCallStack.

	stackUpdater updateBasedOn: self createNewCallStack.

	^ (GtGemStoneDebuggerState
		process: process
		exception: exception
		callStack: currentCallStack) asDictionaryForExport
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
terminateAsyncComputation

	process terminate.
 
	evaluationResult := GtGemstoneEvaluationCancelledResult new.
	semaphore signal.

	^ #terminatedAsync
%

category: 'actions - debug'
method: GtGemStoneEvaluationContext
terminateProcess

	process terminate
%

category: 'actions - frame'
method: GtGemStoneEvaluationContext
updateBindingsForFrame: aCallFrame atLevel: frameLevel with: frameBindings
	self callStack 
		updateBindingsForFrame:aCallFrame
		atLevel: frameLevel
		with: frameBindings
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
variable: aSymbol atFrameLevel: anInteger
	"Answer the variables from the specified frame.

	This method is deprecated in favour of #variableIndex:atFrameLevel: as it doesn't handle instance variables."
	| frameContents varNames index |

	frameContents := process _frameContentsAt: anInteger.
	varNames := frameContents at: 9.
	index := varNames indexOf: aSymbol asSymbol.
	^ frameContents at: index + 10.
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
variableArrayAtFrameLevel: anInteger
	"Answer an Array of Associations of the items to be displayed in the Variable pane of the specified frame."
	| frameContents associations varNames selfObject |

	frameContents := process _frameContentsAt: anInteger.
	selfObject := frameContents at: 8.
	associations := SortedCollection sortBlock: [ :a :b | a first < b first ].

	varNames := frameContents at: 9.
	1 to: varNames size do: [ :i | | object |
		object := frameContents at: i + 10.
		associations add: { varNames at: i. object. #frame. object class gtSystemIconName.  } ].

	associations := associations asOrderedCollection.

	(selfObject gtRemoteVariableValuePairsWithSelfIf: false) do:
		[ :assoc | associations add: { assoc key. assoc value. #instVar.  assoc value class gtSystemIconName. }. ].

	associations addAllFirst:
		{ { #self. selfObject. #self. selfObject class gtSystemIconName. }.
			{ #receiver. (frameContents at: 10). #receiver. (frameContents at: 10) class gtSystemIconName } }.

	^ associations asArray.
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
variableIndex: index atFrameIdentifierIndex: aFrameIdentifierIndex
	^ self variableIndex: index atFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
variableIndex: index atFrameLevel: anInteger
	"Answer the variable from the specified frame"

	^ ((self variableArrayAtFrameLevel: anInteger) at: index) second
%

category: 'actions - debug (identifier)'
method: GtGemStoneEvaluationContext
variableInfoAtFrameIdentifierIndex: aFrameIdentifierIndex
	^ self variableInfoAtFrameLevel: (self frameLevelForIdentifierIndex: aFrameIdentifierIndex)
%

category: 'actions - debug (level)'
method: GtGemStoneEvaluationContext
variableInfoAtFrameLevel: anInteger
	"Answer the variables from the specified frame, including self's instance variables"

	^ (self variableArrayAtFrameLevel: anInteger) collect: [ :each | | displayData |
		displayData := each copy.
		displayData at: 2 put: each second gtDisplayString.
		displayData ]
%

category: 'actions - api'
method: GtGemStoneEvaluationContext
wait

	^ self waitForEvaluationResult asDictionaryForExport
%

category: 'actions - api'
method: GtGemStoneEvaluationContext
waitForComputationResult

	semaphore wait.
	^ result
%

category: 'actions - api'
method: GtGemStoneEvaluationContext
waitForEvaluationResult

	semaphore wait.
	^ evaluationResult
%

category: 'private'
method: GtGemStoneEvaluationContext
waitMS: milliseconds
	(Delay forMilliseconds: milliseconds) wait
%

! Class implementation for 'GtGemStoneEvaluationFrameContext'

!		Class methods for 'GtGemStoneEvaluationFrameContext'

category: 'instance creation'
classmethod: GtGemStoneEvaluationFrameContext
frameIdentifier: aFrameIdentifier evaluationContext: anEvaluationContext
	^ self new 
		initializeWithFrameIdentifier: aFrameIdentifier 
		evaluationContext: anEvaluationContext
%

!		Instance methods for 'GtGemStoneEvaluationFrameContext'

category: 'accessing'
method: GtGemStoneEvaluationFrameContext
evaluationContext
	^ evaluationContext
%

category: 'accessing'
method: GtGemStoneEvaluationFrameContext
frameIdentifier
	^ frameIdentifier
%

category: 'initialization'
method: GtGemStoneEvaluationFrameContext
initializeWithFrameIdentifier: aFrameIdentifier evaluationContext: anEvaluationContext
	frameIdentifier := aFrameIdentifier.
	evaluationContext := anEvaluationContext.
%

! Class implementation for 'GtGemstoneEvaluationResult'

!		Class methods for 'GtGemstoneEvaluationResult'

category: 'instance creation'
classmethod: GtGemstoneEvaluationResult
fromJSONDictionary: aDictionary
	^ self new  
		initializeFromJSONDictionary: aDictionary
%

category: 'testing'
classmethod: GtGemstoneEvaluationResult
isSerializedData: aValue
	^ self subclasses anySatisfy: [ :aClass |
		aClass isSerializedDataForCurrentClass: aValue ]
%

category: 'testing'
classmethod: GtGemstoneEvaluationResult
isSerializedDataForCurrentClass: aValue
	^ (aValue class = Dictionary and: [
		aValue 
			at: '__typeName'
			ifPresent: [ :aClassName | 
				aClassName = self name ] 
			ifAbsent: [ false ] ])
%

!		Instance methods for 'GtGemstoneEvaluationResult'

category: 'accessing'
method: GtGemstoneEvaluationResult
computedResult
	"The value that will be returned to the called as the result of the evaluation"
	^ self subclassResponsibility
%

category: 'testing'
method: GtGemstoneEvaluationResult
hasEvaluationException
	^ false
%

category: 'initialization '
method: GtGemstoneEvaluationResult
initializeFromJSONDictionary: aDictionary
%

category: 'testing'
method: GtGemstoneEvaluationResult
isEvaluationCancelledResult
	^ false
%

category: 'testing'
method: GtGemstoneEvaluationResult
isEvaluationComputedResult
	^ false
%

category: 'testing'
method: GtGemstoneEvaluationResult
isResumedExecutionResult
	^ false
%

! Class implementation for 'GtGemstoneEvaluationCancelledResult'

!		Instance methods for 'GtGemstoneEvaluationCancelledResult'

category: 'accessing'
method: GtGemstoneEvaluationCancelledResult
computedResult
	^ nil
%

category: 'testing'
method: GtGemstoneEvaluationCancelledResult
isEvaluationCancelledResult
	^ true
%

! Class implementation for 'GtGemstoneEvaluationComputedResult'

!		Instance methods for 'GtGemstoneEvaluationComputedResult'

category: 'accessing'
method: GtGemstoneEvaluationComputedResult
computedResult
	^ computedResult
%

category: 'accessing'
method: GtGemstoneEvaluationComputedResult
computedResult: anObject
	computedResult := anObject
%

category: 'initialization '
method: GtGemstoneEvaluationComputedResult
gtPharoProxyInitializeWithSession: aGemStoneSession
	computedResult gtPharoProxyInitializeWithSession: aGemStoneSession
%

category: 'initialization '
method: GtGemstoneEvaluationComputedResult
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'computedResult' 
		ifPresent: [ :anObject |
			computedResult := anObject ]
%

category: 'testing'
method: GtGemstoneEvaluationComputedResult
isEvaluationComputedResult
	^ true
%

! Class implementation for 'GtGemstoneEvaluationExceptionResult'

!		Instance methods for 'GtGemstoneEvaluationExceptionResult'

category: 'testing'
method: GtGemstoneEvaluationExceptionResult
canHandleSpecificDebugger
	^ true
%

category: 'accessing'
method: GtGemstoneEvaluationExceptionResult
computedResult
	^ self evaluationContext
%

category: 'accessing'
method: GtGemstoneEvaluationExceptionResult
evaluationContext
	^ evaluationContext
%

category: 'accessing'
method: GtGemstoneEvaluationExceptionResult
evaluationContext: aGemStoneEvaluationContext
	evaluationContext := aGemStoneEvaluationContext
%

category: 'initialization '
method: GtGemstoneEvaluationExceptionResult
gtPharoProxyInitializeWithSession: aGemStoneSession
	evaluationContext gtPharoProxyInitializeWithSession: aGemStoneSession
%

category: 'testing'
method: GtGemstoneEvaluationExceptionResult
hasEvaluationException
	^ true
%

category: 'initialization '
method: GtGemstoneEvaluationExceptionResult
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'evaluationContextProxy' 
		ifPresent: [ :anObject |
			evaluationContext := anObject ]
%

! Class implementation for 'GtGemstoneEvaluationInProgressResult'

!		Instance methods for 'GtGemstoneEvaluationInProgressResult'

category: 'accessing'
method: GtGemstoneEvaluationInProgressResult
computedResult
	^ self evaluationContext
%

category: 'accessing'
method: GtGemstoneEvaluationInProgressResult
evaluationContext
	^ evaluationContext
%

category: 'accessing'
method: GtGemstoneEvaluationInProgressResult
evaluationContext: aGemStoneEvaluationContext
	evaluationContext := aGemStoneEvaluationContext
%

category: 'initialization '
method: GtGemstoneEvaluationInProgressResult
gtPharoProxyInitializeWithSession: aGemStoneSession
	evaluationContext gtPharoProxyInitializeWithSession: aGemStoneSession
%

category: 'initialization '
method: GtGemstoneEvaluationInProgressResult
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'evaluationContextProxy' 
		ifPresent: [ :anObject |
			evaluationContext := anObject ]
%

! Class implementation for 'GtGemstoneEvaluationResumedResult'

!		Instance methods for 'GtGemstoneEvaluationResumedResult'

category: 'accessing'
method: GtGemstoneEvaluationResumedResult
computedResult
	^ nil
%

category: 'testing'
method: GtGemstoneEvaluationResumedResult
isResumedExecutionResult
	^ true
%

! Class implementation for 'GtGemStoneExampleObjectForLocalDelegate'

!		Instance methods for 'GtGemStoneExampleObjectForLocalDelegate'

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
anotherDelegate
	^ anotherDelegate
%

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
anotherDelegate: anObject
	anotherDelegate := anObject
%

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
targetValueOne
	^ targetValueOne
%

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
targetValueOne: anObject
	targetValueOne := anObject
%

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
targetValueTwo
	^ targetValueTwo
%

category: 'accessing'
method: GtGemStoneExampleObjectForLocalDelegate
targetValueTwo: anObject
	targetValueTwo := anObject
%

! Class implementation for 'GtGemStoneExampleResult'

!		Instance methods for 'GtGemStoneExampleResult'

category: 'other'
method: GtGemStoneExampleResult
example
	^ example
%

category: 'other'
method: GtGemStoneExampleResult
example: anExample
	example := anExample
%

category: 'other'
method: GtGemStoneExampleResult
exception
	^ exception
%

category: 'other'
method: GtGemStoneExampleResult
exception: anException
	exception := anException
%

category: 'other'
method: GtGemStoneExampleResult
gtSourceFor: aView
	<gtView>
	^ aView textEditor
		title: 'Source';
		priority: 10;
		text: [ self example fullSource ]
%

category: 'other'
method: GtGemStoneExampleResult
isError
	^ exception isNotNil
		and: [ (exception isKindOf: GtGemStoneAssertionFailure) not ]
%

category: 'other'
method: GtGemStoneExampleResult
isFailure
	^ exception isNotNil and: [ exception isKindOf: GtGemStoneAssertionFailure ]
%

category: 'other'
method: GtGemStoneExampleResult
isSuccess
	^ result isNotNil
%

category: 'other'
method: GtGemStoneExampleResult
result
	^ result
%

category: 'other'
method: GtGemStoneExampleResult
result: aValue
	result := aValue
%

! Class implementation for 'GtGemStoneExampleRunner'

!		Instance methods for 'GtGemStoneExampleRunner'

category: 'other'
method: GtGemStoneExampleRunner
newResultFor: anExample
	^ GtGemStoneExampleResult new example: anExample
%

category: 'other'
method: GtGemStoneExampleRunner
runExample: anExample in: aClass
	| result |
	[ 
	result := (self newResultFor: anExample)
		result: (aClass new perform: anExample selector) ]
		on: self signalableExceptions
		do: [ :anException | 
			result := (self newResultFor: anExample) exception: anException ].
	System abortTransaction.
	^ result
%

category: 'other'
method: GtGemStoneExampleRunner
runExampleClass: aClass
	^ self
		runExamples:
			((Pragma allNamed: #'gtExample' from: aClass to: Object)
				collect: [ :aPragma | aPragma method ])
		in: aClass
%

category: 'other'
method: GtGemStoneExampleRunner
runExamples: aListOfExamples in: aClass
	^ aListOfExamples collect: [:anExample | self runExample: anExample in: aClass ]
%

category: 'other'
method: GtGemStoneExampleRunner
signalableExceptions
	^ ExceptionSet new ,
		Halt ,
		Error ,
		TestFailure,
		GtGemStoneAssertionFailure
%

! Class implementation for 'GtGemstoneHttpClient'

!		Class methods for 'GtGemstoneHttpClient'

category: 'other'
classmethod: GtGemstoneHttpClient
new
	^ self basicNew initialize
%

!		Instance methods for 'GtGemstoneHttpClient'

category: 'other'
method: GtGemstoneHttpClient
authorization: aString
	headers at: 'Authorization' put: aString
%

category: 'other'
method: GtGemstoneHttpClient
beOneShot
%

category: 'other'
method: GtGemstoneHttpClient
contents
	^ contents
%

category: 'other'
method: GtGemstoneHttpClient
contents: aDict
	contents := aDict
%

category: 'other'
method: GtGemstoneHttpClient
contentType: aString
	headers at: 'Content-Type' put: aString
%

category: 'other'
method: GtGemstoneHttpClient
defaultContentType
	^ 'application/json'
%

category: 'other'
method: GtGemstoneHttpClient
entity: aDict
	contents := aDict
%

category: 'other'
method: GtGemstoneHttpClient
get
	^ STONJSON fromString: (self performMethod: 'GET')
%

category: 'other'
method: GtGemstoneHttpClient
headerAt: aKey put: aValue
	headers at: aKey put: aValue
%

category: 'other'
method: GtGemstoneHttpClient
initialize
	super initialize.
	headers := Dictionary new.
	query := Dictionary new.
	self contentType: self defaultContentType
%

category: 'other'
method: GtGemstoneHttpClient
performMethod: aMethod
	| callUrl curlArguments dataFile |
	callUrl := self url , '?'.

	query
		keysAndValuesDo: [ :aKey :aValue | callUrl := callUrl , aKey , '=' , aValue , '&' ].

	callUrl := callUrl allButLast.

	curlArguments := {'curl'.
	'-s'.
	'--post301'.
	'-L'.
	'''', callUrl, ''''.
	'-X'.
	aMethod} asOrderedCollection.

	headers
		keysAndValuesDo: [ :aKey :aValue | 
			curlArguments
				addAll:
					{'-H'.
					('''' , aKey , ': ' , aValue , '''')} ].

	^ [ self contents ifNotNil: [ :aContents |
		dataFile := FileReference newTempFilePrefix: self class name asString, '-' suffix: '.json'.
		dataFile writeStreamDo: [ :stream |
			stream nextPutAll: (GtGemstoneHttpJsonSerializer serialize: aContents) ].
		curlArguments addAll:
			{'--data'.
			('@', dataFile fullName)} ].

		System performOnServer: (' ' join: curlArguments) ]
			ensure: [ dataFile ifNotNil: [ dataFile ensureDelete ] ].
%

category: 'other'
method: GtGemstoneHttpClient
post
	^ STONJSON fromString: (self performMethod: 'POST')
%

category: 'other'
method: GtGemstoneHttpClient
postStreaming
	^ (Character cr split: (self performMethod: 'POST')) collect: [:aLine | STONJSON fromString: aLine]
%

category: 'other'
method: GtGemstoneHttpClient
queryAt: aKey put: aValue
	query at: aKey put: aValue asString
%

category: 'other'
method: GtGemstoneHttpClient
url
	^ url
%

category: 'other'
method: GtGemstoneHttpClient
url: aString
	url := aString
%

! Class implementation for 'GtGemstoneHttpJsonSerializer'

!		Class methods for 'GtGemstoneHttpJsonSerializer'

category: 'other'
classmethod: GtGemstoneHttpJsonSerializer
serialize: anObject
	^ STONJSON toString: (self serializeObject: anObject)
%

category: 'other'
classmethod: GtGemstoneHttpJsonSerializer
serializeCollection: aCollection
	^ (aCollection collect: [:aValue | self serializeObject: aValue]) asArray
%

category: 'other'
classmethod: GtGemstoneHttpJsonSerializer
serializeDict: anObject
	^ anObject collect: [:aValue | self serializeObject: aValue]
%

category: 'other'
classmethod: GtGemstoneHttpJsonSerializer
serializeObject: anObject
	(anObject isKindOf: Dictionary)
		ifTrue: [ ^ self serializeDict: anObject ].
	(anObject isKindOf: String)
		ifTrue: [ ^ anObject ].
	(anObject isKindOf: Collection)
		ifTrue: [ ^ self serializeCollection: anObject ].
	^ anObject
%

! Class implementation for 'GtGemStoneLocalCallFrame'

!		Class methods for 'GtGemStoneLocalCallFrame'

category: 'accessing'
classmethod: GtGemStoneLocalCallFrame
forFrameContents: aFrameArray 
	^ self 
		forFrameContents: aFrameArray 
		withIdentifier: nil
%

category: 'accessing'
classmethod: GtGemStoneLocalCallFrame
forFrameContents: aFrameArray withIdentifier: aFrameIdentifier
	^ self new 
		initializeForFrameContents: aFrameArray 
		withIdentifier: aFrameIdentifier
%

!		Instance methods for 'GtGemStoneLocalCallFrame'

category: 'bindings'
method: GtGemStoneLocalCallFrame
createFrameBindings
	| frameBindings |

	frameBindings := SymbolDictionary new.

	1 to: (frameContents at: 9) size do: [ :index | 
				((frameContents at: 9) at: index) first = $.
					ifFalse: [ 
						frameBindings
							at: ((frameContents at: 9) at: index) asSymbol
							put: (frameContents at: 11 + index - 1) ] ].

	^ frameBindings
%

category: 'printing'
method: GtGemStoneLocalCallFrame
description
	^ String streamContents: [ :aStream |
		self printDescriptionOn: aStream]
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
frameIdentifier
	^ frameIdentifier
%

category: 'gt - extensions'
method: GtGemStoneLocalCallFrame
gtFrameArrayItemsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Frame Contents';
		priority: 25;
		items: [ frameContents ];
		column: 'Index' 
			text: [ :eachItem :eachIndex | eachIndex  ]
			width: 45;
		column: 'Item' 
			text: [ :eachItem | eachItem gtDisplayString ].
%

category: 'testing'
method: GtGemStoneLocalCallFrame
hasSamePropertiesAs: anotherContext
	^ (self isForSameMethodOrBlockAs: anotherContext) and: [
		self ipOffset = anotherContext ipOffset ] 
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
homeMethod
	^ homeMethod
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
homeMethodOop
	^ self homeMethod asOop
%

category: 'initialization'
method: GtGemStoneLocalCallFrame
initializeForFrameContents: aFrameArray withIdentifier: aFrameIdentifier 
	frameIdentifier := aFrameIdentifier.
	self updateWithFrameContents: aFrameArray
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
ipOffset
	^ frameContents at: 2
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
isForBlock
	^ frameContents first isMethodForBlock
%

category: 'testing'
method: GtGemStoneLocalCallFrame
isForCriticalMethod
	^ ProcessorScheduler scheduler _criticalMethods 
		includes: self homeMethod
%

category: 'testing'
method: GtGemStoneLocalCallFrame
isForSameMethodOrBlockAs: anotherContext
	"This amims to detect of two contexts are different"
	^ self methodClassName = anotherContext methodClassName and: [
		self selector = anotherContext selector and: [
			self homeMethodOop = anotherContext homeMethodOop  ] ]
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
methodClass
	^ homeMethod inClass
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
methodClassName
	^ self methodClass ifNotNil: [ :aClass | 
		aClass name ]
%

category: 'printing'
method: GtGemStoneLocalCallFrame
methodDescription
	^ String streamContents: [ :aStream |
	 	self printMethodDescriptionOn: aStream ]
%

category: 'printing'
method: GtGemStoneLocalCallFrame
printClassLabelOn: aStream
	self selfObjectClass ~= self methodClass
		ifTrue: [
			aStream 
				nextPutAll: self selfObjectClassName;
				nextPutAll: '('; 
				nextPutAll: (self methodClassName ifNil: [ '<unknown>']);
				nextPutAll: ')' ]
		ifFalse: [
			aStream nextPutAll: (self methodClassName ifNil: [ '<unknown>']) ]
%

category: 'printing'
method: GtGemStoneLocalCallFrame
printDescriptionOn: aStream
	self printMethodDescriptionOn:  aStream.
	aStream nextPutAll: ' '.
	self printExtraDetailsOn: aStream. 
%

category: 'printing'
method: GtGemStoneLocalCallFrame
printExtraDetailsOn: aStream
	aStream 
		nextPutAll: '[';
		nextPutAll: self ipOffset asString;
		nextPutAll: ']; id=';
		nextPutAll: self frameIdentifier description 
%

category: 'printing'
method: GtGemStoneLocalCallFrame
printMethodDescriptionOn: aStream
	self isForBlock ifTrue: [
		aStream nextPutAll: '[] in ' ].
	self printClassLabelOn: aStream.
	aStream 
		nextPutAll: '>>#'.
	self selector 
		ifNil: [ aStream nextPutAll: '<none>']
		ifNotNil: [ :aSelector | 
			aStream nextPutAll: aSelector ]
%

category: 'printing'
method: GtGemStoneLocalCallFrame
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize:  [
		self printDescriptionOn: aStream ]
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
programCounterMarkers
	| currentSourceInfo |
	currentSourceInfo := self sourceInfo.
	^ { currentSourceInfo first . currentSourceInfo second }
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
receiver
	^ frameContents at: 10
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
receiverClass
	^ self receiver class
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
receiverClassName
	^ self receiverClass name
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
selector
	^ homeMethod selector.
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
selfObject
	^ frameContents at: 8
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
selfObjectClass
	^ self selfObject class
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
selfObjectClassName
	^ self selfObjectClass name
%

category: 'accessing'
method: GtGemStoneLocalCallFrame
sourceInfo
	| source ipOffset markers startIndex endIndex i |

	source := frameContents first sourceString.
	ipOffset := frameContents second.
	markers := frameContents first _buildIpMarkerArray.
	startIndex := markers indexOf: ipOffset.
	startIndex = 0 ifTrue:
		[ ^ { 1. source size. source } ].
	i := startIndex + 1.

	[ endIndex isNil and: [ i <= markers size ] ] whileTrue:
		[ (markers at: i) notNil ifTrue:
			[ endIndex := i ].
		i := i + 1 ].
	endIndex ifNil: [ endIndex := source size ].
	^ { startIndex. endIndex. source. }
%

category: 'updating'
method: GtGemStoneLocalCallFrame
updateBindingsWith: frameBindings  forFrameAtLevel: aFrameLevel inProcess: gsProcess
	
	1 to: (frameContents at: 9) size do: [ :index | 
				| argsAndTemps |
				argsAndTemps := frameContents at: 9.
				(argsAndTemps at: index) first = $.
					ifFalse: [ 
						gsProcess
							_frameAt: aFrameLevel
							tempAt: index
							put: (frameBindings at: (argsAndTemps at: index))  ] ].

	"After updating the bindings in the process, reinitialize the contents of the frame"
	self updateWithFrameContents: (gsProcess _frameContentsAt: aFrameLevel).
%

category: 'updating'
method: GtGemStoneLocalCallFrame
updateIdentifierBasedOn: aCallFrame
	self updateIdentifierTo:  aCallFrame frameIdentifier
%

category: 'updating'
method: GtGemStoneLocalCallFrame
updateIdentifierTo: anIdentifier
	frameIdentifier := anIdentifier
%

category: 'updating'
method: GtGemStoneLocalCallFrame
updateWithFrameContents: aFrameArray 
	frameContents := aFrameArray.
	homeMethod := frameContents first homeMethod.
%

! Class implementation for 'GtGemStoneLocalCallStack'

!		Class methods for 'GtGemStoneLocalCallStack'

category: 'instance creation'
classmethod: GtGemStoneLocalCallStack
forProcess: aGsProcess 
	^ self new 
		initializeForProcess: aGsProcess 
%

!		Instance methods for 'GtGemStoneLocalCallStack'

category: 'updating'
method: GtGemStoneLocalCallStack
appendCallFramesFromIndex: anIndex from: aNewCallStack 
	(aNewCallStack callFrames copyFrom: 1 to: anIndex) 
		reverseDo: [ :aNewCallFrame |
			self appendFirstNewCallFrame: aNewCallFrame ]
%

category: 'updating'
method: GtGemStoneLocalCallStack
appendFirstNewCallFrame: aNewCallFrame 
	aNewCallFrame updateIdentifierTo: self generateIdentifier.
	callFrames addFirst: aNewCallFrame
%

category: 'accessing'
method: GtGemStoneLocalCallStack
callFrames
	^ callFrames
%

category: 'accessing'
method: GtGemStoneLocalCallStack
callFramesAt: anIndex
	^ self callFrames at: anIndex
%

category: 'accessing'
method: GtGemStoneLocalCallStack
createSpecification
	^ GtGemStoneProcessSpecification forGsCallStack: self
%

category: 'accessing'
method: GtGemStoneLocalCallStack
firstNonCriticalFrameIndex
	1 to: self numberOfCallFrames do: [ :anIndex |
		(self callFrames at: anIndex) isForCriticalMethod 
			ifFalse: [ ^ anIndex ] ].
		
	^ nil
%

category: 'accessing'
method: GtGemStoneLocalCallStack
frameForIdentifier: aFrameIdentifier 
	| frameLevel |
	frameLevel := self frameLevelForIdentifier: aFrameIdentifier.
	^ self callFrames at: frameLevel
%

category: 'accessing'
method: GtGemStoneLocalCallStack
frameLevelForIdentifier: aFrameIdentifier
	aFrameIdentifier ifNil: [
		Error signal: 'aFrameIdentifier cannot be nil' ].

	1 to: self callFrames size do: [ :anIndex |
		(self callFrames at: anIndex) frameIdentifier = aFrameIdentifier
			ifTrue: [ ^ anIndex ] ].

	Error signal: 'Could not find frame with identifier: ', aFrameIdentifier printString
%

category: 'accessing'
method: GtGemStoneLocalCallStack
generateIdentifier
	| currentIdentifier |
	currentIdentifier := nextFrameIdentifier.
	nextFrameIdentifier := currentIdentifier nextIdentifier.
	^ currentIdentifier
%

category: 'gt - extensions'
method: GtGemStoneLocalCallStack
gtViewStackFramesFor: aView 
	<gtView>
	
	^ aView columnedList 
		title: 'Call frames';
		items: [ self callFrames ];
		column: 'Index' 
			text: [ :aStackFrame :anIndex |
				anIndex ]
			width: 75;
		column: 'Identifier' 
			text: [ :aStackFrame |
				aStackFrame frameIdentifier identityIndex ]
			width: 75;
		column: 'IP Offset' 
			text: [ :aStackFrame |
				aStackFrame ipOffset ]
			width: 75;
		column: 'Method' text: [ :aStackFrame |
			aStackFrame methodDescription ]
%

category: 'initialization'
method: GtGemStoneLocalCallStack
initializeForProcess: aGsProcess 
	nextFrameIdentifier := GtGemStoneCallFrameIdentifier initialIdentifier.

	gsProcess := aGsProcess.
	callFrames := OrderedCollection withAll: (aGsProcess gtAllFrames 
		collect: [ :aFrameArray |
			GtGemStoneLocalCallFrame 
				forFrameContents: aFrameArray 
				withIdentifier: self generateIdentifier ]).
%

category: 'testing'
method: GtGemStoneLocalCallStack
isEmpty
	^ self numberOfCallFrames = 0
%

category: 'accessing'
method: GtGemStoneLocalCallStack
numberOfCallFrames
	^ self callFrames size
%

category: 'printing'
method: GtGemStoneLocalCallStack
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream print: self numberOfCallFrames.
		aStream nextPutAll: ' frames' ]
%

category: 'accessing'
method: GtGemStoneLocalCallStack
removeAllCallFrames
	callFrames := OrderedCollection new
%

category: 'updating'
method: GtGemStoneLocalCallStack
removeCallFramesUpwardsFromIndex: anIndex 
	"Remove all call frames upwards starting from the given 1-based index"
	
	anIndex = 0 ifTrue: [ ^ self ].
	callFrames := callFrames 
		copyFrom: anIndex + 1 
		to: callFrames size
%

category: 'updating'
method: GtGemStoneLocalCallStack
replaceFrameAt: anIndex with: aNewContext
	self callFrames at: anIndex put: aNewContext
%

category: 'updating'
method: GtGemStoneLocalCallStack
updateBindingsForFrame: aCallFrame atLevel: aFrameLevel with: frameBindings
	aCallFrame 
		updateBindingsWith: frameBindings 
		forFrameAtLevel: aFrameLevel 
		inProcess: gsProcess
%

! Class implementation for 'GtGemStoneLocalCallStackUpdater'

!		Class methods for 'GtGemStoneLocalCallStackUpdater'

category: 'instance creation'
classmethod: GtGemStoneLocalCallStackUpdater
forCallStack: aCallStack
	^ self new 
		initializeForCallStack: aCallStack
%

!		Instance methods for 'GtGemStoneLocalCallStackUpdater'

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
appendCallFramesFromIndexPair: anIndexPair from: aNewCallStack 
	targetCallStack 
		appendCallFramesFromIndex: anIndexPair second
		from: aNewCallStack 
%

category: 'testing'
method: GtGemStoneLocalCallStackUpdater
hasCommonMethodContextAtIndex: anIndexPair with: aNewCallStack 
	^ (anIndexPair first >= 1) and: [
			(anIndexPair second >= 1) and: [
				(targetCallStack callFramesAt: anIndexPair first)
					isForSameMethodOrBlockAs:(aNewCallStack 
						callFramesAt: anIndexPair second) ] ]
%

category: 'initialization'
method: GtGemStoneLocalCallStackUpdater
initializeForCallStack: aCallStack 
	targetCallStack := aCallStack
%

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
removeCallFramesFromIndexPair: anIndexPair 
	targetCallStack removeCallFramesUpwardsFromIndex: anIndexPair first
%

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
updateBasedOn: aNewCallStack
	| firstDifferentIndexes doubleCallStack |
	
	aNewCallStack isEmpty ifTrue: [
		^ self updateBasedOnEmptyStack ].
		
	doubleCallStack := GtGemStoneDoubleLocalCallStack 
		forPreviousCallStack: targetCallStack 
		newCallStack: aNewCallStack.
	
	firstDifferentIndexes := doubleCallStack firstDivergentContentsIndex.
	^ self 
		updateStackFromIndex: firstDifferentIndexes
		basedOn: aNewCallStack
%

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
updateBasedOnEmptyStack
	targetCallStack removeAllCallFrames.
	^ targetCallStack
%

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
updateStackFromIndex: anIndexPair basedOn: aNewCallStack 
	| currentIndexPair |
	currentIndexPair := anIndexPair.
	(self hasCommonMethodContextAtIndex: currentIndexPair with: aNewCallStack)
		ifTrue: [
			self 
				updateTopCommonContextAtIndexPair: currentIndexPair 
				basedOn: aNewCallStack.
			currentIndexPair := {
				currentIndexPair first - 1.
				currentIndexPair second - 1 } ].
	
	self removeCallFramesFromIndexPair: currentIndexPair.
	self appendCallFramesFromIndexPair: currentIndexPair from: aNewCallStack.
	
	^ targetCallStack
%

category: 'updating'
method: GtGemStoneLocalCallStackUpdater
updateTopCommonContextAtIndexPair: anIndexPair basedOn: aNewCallStack 
	| existingContext newContext |
	existingContext := targetCallStack callFramesAt: anIndexPair first.
	newContext := aNewCallStack callFramesAt: anIndexPair second.
	
	newContext updateIdentifierBasedOn: existingContext.
	targetCallStack replaceFrameAt: anIndexPair first with: newContext.
%

! Class implementation for 'GtGemStoneRemotePhlowCollectionPrinter'

!		Class methods for 'GtGemStoneRemotePhlowCollectionPrinter'

category: 'api'
classmethod: GtGemStoneRemotePhlowCollectionPrinter
displayStringFor: aCollection on: aStream
	^ (self forTargetCollection: aCollection)
		writeDisplayStringOn: aStream
%

category: 'api'
classmethod: GtGemStoneRemotePhlowCollectionPrinter
forTargetCollection: aCollection
	^ self new 
		targetCollection: aCollection
%

!		Instance methods for 'GtGemStoneRemotePhlowCollectionPrinter'

category: 'enumerating'
method: GtGemStoneRemotePhlowCollectionPrinter
elementsDo: aBlock
	targetCollection do: aBlock
%

category: 'accessing'
method: GtGemStoneRemotePhlowCollectionPrinter
targetCollection: aCollection
	targetCollection := aCollection
%

category: 'printing'
method: GtGemStoneRemotePhlowCollectionPrinter
writeClassDescriptionOn: aStream 
	aStream nextPutAll: targetCollection class name describeClassName 
%

category: 'api'
method: GtGemStoneRemotePhlowCollectionPrinter
writeCollectionItemsOn: aStream
	| maxPrint count collectionSize |
	
	aStream 
		space;
		nextPutAll: '(' .
	maxPrint := 180.
	count := 1 .
	collectionSize := targetCollection size .
	self elementsDo: [ :anElement |
	  aStream position > maxPrint ifTrue:[
		aStream nextPutAll: '...)' .
		^ self ].
	  anElement printOn: aStream.
	  count < collectionSize ifTrue:[ aStream space ].
	  count := count + 1 ].
	aStream nextPut: $).
%

category: 'printing'
method: GtGemStoneRemotePhlowCollectionPrinter
writeCollectionSizeOn: aStream
	| collectionSize |
	collectionSize := targetCollection size. 
	aStream
		space;
		nextPut: $[;
		print: collectionSize;
		space;
		nextPutAll: (collectionSize = 1 
			ifTrue: [ 'item' ]
			ifFalse: [ 'items' ]);
		nextPut: $].
%

category: 'api'
method: GtGemStoneRemotePhlowCollectionPrinter
writeDisplayStringOn: aStream
	"Put a displayable representation of the receiver on the given stream."
	
	self writeClassDescriptionOn: aStream.
	self writeCollectionSizeOn: aStream.
	self writeCollectionItemsOn: aStream.
%

! Class implementation for 'GtGemStoneRemotePhlowDictionaryPrinter'

!		Instance methods for 'GtGemStoneRemotePhlowDictionaryPrinter'

category: 'enumerating'
method: GtGemStoneRemotePhlowDictionaryPrinter
elementsDo: aBlock
	targetCollection associationsDo: aBlock
%

! Class implementation for 'GtGemStoneSemanticVersionNumber'

!		Class methods for 'GtGemStoneSemanticVersionNumber'

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
major: majorNumber minor: minorNumber patch: patchNumber
	^ self new 
		initializeMajor: majorNumber
		minor: minorNumber
		patch: patchNumber
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
oneZeroZero
	^ self major: 1 minor: 0 patch: 0
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
pointOne
	^ self major: 0 minor: 0 patch: 1
%

category: 'converting'
classmethod: GtGemStoneSemanticVersionNumber
readFromString: aString
	| tokens |
	tokens := (aString trimBoth trimLeft: [:char | char = $v]) findTokens: '.'.
	^ self 
		major: tokens first asInteger
		minor: tokens second asInteger
		patch: tokens third asInteger. 
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
v1_0_1098
	"Support for v1.0.1098 was dropped on 2025-06-06"

	^ self major: 1 minor: 0 patch: 1098
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
v1_0_1501

	^ self major: 1 minor: 0 patch: 1501
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
v1_0_1502

	^ self major: 1 minor: 0 patch: 1502
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
v1_1_199

	^ self major: 1 minor: 1 patch: 199
%

category: 'accessing'
classmethod: GtGemStoneSemanticVersionNumber
versionNumberRegexString
	^ 'v[0-9]+\.[0-9]+\.[0-9]+'
%

category: 'instance creation'
classmethod: GtGemStoneSemanticVersionNumber
zero
	^ self major: 0 minor: 0 patch: 0
%

!		Instance methods for 'GtGemStoneSemanticVersionNumber'

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
< aSemanticVersionNumber
	self major < aSemanticVersionNumber major ifTrue: [ ^ true ].
		self major = aSemanticVersionNumber major ifTrue: [ 
			self minor < aSemanticVersionNumber minor ifTrue: [ ^ true ].
			self minor = aSemanticVersionNumber minor ifTrue: [ 
				self patch < aSemanticVersionNumber patch ifTrue: [ ^ true ]]].
	^ false.
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
<= aSemanticVersionNumber
	"Answer whether the receiver is less than or equal to the given version number."
	^ (self > aSemanticVersionNumber) not
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
= anObject
	self == anObject ifTrue: [ ^ true ].
	self class = anObject class ifFalse: [ ^ false ].
	^ self major = anObject major and: [ 
		 self minor = anObject minor and: [ 
			self patch = anObject patch ] ]
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
> aSemanticVersionNumber 
	"Answer whether the receiver is greater than the argument."

	^aSemanticVersionNumber < self
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
>= aSemanticVersionNumber 
	"Answer whether the receiver is greater than or equal to the argument."

	^ aSemanticVersionNumber <= self
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
between: min and: max
	"Answer whether the receiver is less than or equal to the argument, max,
	and greater than or equal to the argument, min."

	^self >= min and: [self <= max]
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
exBetween: min and: max
	"Answer whether the receiver is less than or equal to the argument, max,
	and greater than or equal to the argument, min."

	^self > min and: [self < max]
%

category: 'comparing'
method: GtGemStoneSemanticVersionNumber
hash
	^ ((self species hash
		bitXor: self major hash)
		bitXor: self minor hash)
		bitXor: self patch hash
%

category: 'initialization'
method: GtGemStoneSemanticVersionNumber
initializeMajor: aMajorNumber minor: aMinorNumber patch: aPatchNumber
	 (aMajorNumber notNil and: [ aMinorNumber notNil and: [ aPatchNumber notNil ] ])
	 	ifFalse: [ 
	 		Error signal: 'The components of a semantic version cannot be null' ].
	(aMajorNumber >= 0 and: [ aMinorNumber >= 0 and: [ aPatchNumber >= 0 ] ])
		ifFalse: [ 
			Error signal: 'The components of a semantic version should not be negative' ].
	(major isNil and: [ minor isNil and: [ patch isNil ] ]) 
		ifFalse: [
			Error signal: 'Semantic version numbers are immutable' ].
	
	major := aMajorNumber.
	minor := aMinorNumber.
	patch := aPatchNumber.
%

category: 'testing'
method: GtGemStoneSemanticVersionNumber
isZero
	^ self = self class zero
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
major
	^ major
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
minor
	^ minor
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
patch
	^ patch 
%

category: 'printing'
method: GtGemStoneSemanticVersionNumber
printOn: aStream
	super printOn: aStream.
	
	aStream 
		nextPut: $(;
		nextPutAll: self versionString;
		nextPut: $)
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
tag
	^ iceTag
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
tag: anIceTag
	iceTag := anIceTag 
%

category: 'accessing'
method: GtGemStoneSemanticVersionNumber
versionString
	^ String streamContents: [ :aStream |
		aStream 
			<< 'v';
			<< self major printString;
			<< '.';
			<< self minor printString;
			<< '.';
			<< self patch printString ]
%

! Class implementation for 'GtGemStoneSerializationExamples'

!		Instance methods for 'GtGemStoneSerializationExamples'

category: 'examples'
method: GtGemStoneSerializationExamples
gbsMaxDepthToWireExample
	"Demonstrate `max` and `min` keywords in a replication spec"
	<gtExample>
	| replicationSpec object encoder byteArray next array currentArray transferService |

	replicationSpec := {GtWireEncodingExampleInstVarObject -> #(#(var1 max 2))}
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
	GtWireGbsReplicationSpecConverter new update: encoder from: replicationSpec.
	transferService := GtRsrWireTransferService gtClientGsServer new
		encoder: encoder;
		object: object.
	byteArray := transferService buffer.
	transferService := GtRsrWireTransferService gtClientGsServer new
		buffer: byteArray.
	next := transferService object.

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

! Class implementation for 'GtGemStoneSessionFeature'

!		Class methods for 'GtGemStoneSessionFeature'

category: 'instance creation'
classmethod: GtGemStoneSessionFeature
fromFeatureSpecification: aFeatureSpecification 
	^ self new 
		initializeFromFeatureSpecification: aFeatureSpecification 
%

category: 'instance creation'
classmethod: GtGemStoneSessionFeature
withId: anSymbol
	^ self basicNew initialize 
		featureId: anSymbol
%

!		Instance methods for 'GtGemStoneSessionFeature'

category: 'converting'
method: GtGemStoneSessionFeature
createSpecification
	^ GtGemStoneFeatureSpecification forFeature: self
%

category: 'actions'
method: GtGemStoneSessionFeature
disable
	enabled := false
%

category: 'actions'
method: GtGemStoneSessionFeature
enable
	enabled := true
%

category: 'accessing'
method: GtGemStoneSessionFeature
featureId
	^ featureId
%

category: 'accessing'
method: GtGemStoneSessionFeature
featureId: anSymbol
	featureId := anSymbol
%

category: 'initialization'
method: GtGemStoneSessionFeature
initializeFromFeatureSpecification: aFeatureSpecification 
	enabled := aFeatureSpecification enabled.
	featureId := aFeatureSpecification featureId.
%

category: 'testing'
method: GtGemStoneSessionFeature
isEnabled
	^ enabled ifNil: [ false ]
%

category: 'printing'
method: GtGemStoneSessionFeature
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream 
			nextPutAll: 'id: ';
			nextPutAll: featureId;
			nextPutAll: '; enabled: ';
			print: enabled ]
%

category: 'accessing'
method: GtGemStoneSessionFeature
statusDescription
	^ self isEnabled
		ifTrue: [ 'Enabled' ] 
		ifFalse: [ 'Disabled' ]
%

! Class implementation for 'GtGemStoneSessionFeatures'

!		Class methods for 'GtGemStoneSessionFeatures'

category: 'accessing'
classmethod: GtGemStoneSessionFeatures
collectFeaturesDefinitions
	| featureSelectors |
	featureSelectors := ((Pragma 
		allNamed: #gtGemStoneFeature
		from: self  class
		to: self  class ) collect: [ :each | each method selector ]) asSet asArray.
	
	^ featureSelectors collect: [ :aSelector |
		self perform: aSelector asSymbol ]
%

category: 'accessing'
classmethod: GtGemStoneSessionFeatures
currentFeatures
	^ SessionTemps current 
		at: self featuresKeyName
		ifAbsentPut: [ self forCurrentDefinitions ]
%

category: 'features'
classmethod: GtGemStoneSessionFeatures
exampleFeatureV1
	<gtGemStoneFeature>
	
	^ (GtGemStoneSessionFeature
		withId: #exampleFeatureV1)
			enable
%

category: 'accessing'
classmethod: GtGemStoneSessionFeatures
featuresKeyName
	^#GT_FEATURES_LIST_NAME
%

category: 'instance creation'
classmethod: GtGemStoneSessionFeatures
forCurrentDefinitions
	^ self withAll: self collectFeaturesDefinitions
%

category: 'views'
classmethod: GtGemStoneSessionFeatures
gtViewCurrentFeaturesFor: aView
	<gtView>
	<gtClassView>
	
	^ self 
		gtDo: [ aView empty ] 
		gemstoneDo: [
			aView forward
				title: 'Current Features';
				priority: 30;
				object: [ self currentFeatures ];
				view: #gtViewFeaturesFor: ]
%

category: 'views'
classmethod: GtGemStoneSessionFeatures
gtViewDefinedFeaturesFor: aView
	<gtView>
	<gtClassView>
	
	^ aView forward
		title: 'Defined Features';
		priority: 31;
		object: [ self forCurrentDefinitions ];
		view: #gtViewFeaturesFor:
%

category: 'accessing'
classmethod: GtGemStoneSessionFeatures
resetFeatures
	^ SessionTemps current 
		removeKey: self featuresKeyName
		ifAbsent: [  ]
%

category: 'features'
classmethod: GtGemStoneSessionFeatures
spawnPrimitiveTypeAsProxyExampleFeature
	<gtGemStoneFeature>
	"Only needed to indicate if GtRemotePhlowDeclarativeTestInspectable>>#gtColumnedListSpawnTextFor: has a column for spawning primitive types"
	^ (GtGemStoneSessionFeature
		withId: #spawnPrimitiveTypeAsProxyExampleFeature)
			enable
%

category: 'features'
classmethod: GtGemStoneSessionFeatures
transcriptV1
	<gtGemStoneFeature>
	
	^ (GtGemStoneSessionFeature
		withId: #transcriptV1)
			enable
%

category: 'instance creation'
classmethod: GtGemStoneSessionFeatures
withAll: aCollection
	^ self new 
		initializeWithFeatures: aCollection
%

!		Instance methods for 'GtGemStoneSessionFeatures'

category: 'adding'
method: GtGemStoneSessionFeatures
addFeature: aFeature
	featuresById at: aFeature featureId put: aFeature
%

category: 'converting'
method: GtGemStoneSessionFeatures
createSpecification
	^ GtGemStoneFeaturesSpecification forFeatures: self
%

category: 'actions'
method: GtGemStoneSessionFeatures
disableFeatureWithId: aFeatureId 
	self
		featureWithId: aFeatureId
		ifPresent: [ :aFeature | aFeature disable ] 
		ifAbsent: [ Error signal: 'Feature not found' ] 
%

category: 'actions'
method: GtGemStoneSessionFeatures
enableFeatureWithId: aFeatureId 
	self
		featureWithId: aFeatureId
		ifPresent: [ :aFeature | aFeature enable ] 
		ifAbsent: [ Error signal: 'Feature not found' ] 
%

category: 'enumerating'
method: GtGemStoneSessionFeatures
featureWithId: aFeatureId 
	^ featuresById
		at: aFeatureId
%

category: 'enumerating'
method: GtGemStoneSessionFeatures
featureWithId: aFeatureId ifPresent: aPresentBlock 
	^ featuresById
		at: aFeatureId
		ifPresent: aPresentBlock
%

category: 'enumerating'
method: GtGemStoneSessionFeatures
featureWithId: aFeatureId ifPresent: aPresentBlock ifAbsent: anAbsentBlock
	| feature |
	feature := featuresById
		at: aFeatureId
		ifAbsent: [ ^ anAbsentBlock value ].
		
	^ aPresentBlock cull: feature
%

category: 'views'
method: GtGemStoneSessionFeatures
gtViewFeaturesFor: aView
	<gtView>
	
	featuresById ifNil: [ ^ aView empty ].
	
	^ aView columnedList
		title: 'Features';
		items: [ (self 
			gtDo: [ featuresById associations ] 
			gemstoneDo: [ featuresById associationsAsArray ] )
				sort: [ :a :b | a value featureId < b value featureId ] ];
		column: 'Id' text: [ :assoc | assoc key ];
		column: 'Status' text: [ :assoc | assoc value statusDescription ];
		send: [ :assoc | assoc value ]
%

category: 'initialization'
method: GtGemStoneSessionFeatures
initializeWithFeatures: aCollection 
	featuresById := Dictionary new.
	
	aCollection do: [ :aFeature |
		self addFeature: aFeature ]
%

category: 'testing'
method: GtGemStoneSessionFeatures
isFeatureEnabledWithId: aFeatureId
	^ self
		featureWithId: aFeatureId
		ifPresent: [ :aFeature | aFeature isEnabled ] 
		ifAbsent: [ false ] 
%

category: 'accessing'
method: GtGemStoneSessionFeatures
items
	^ featuresById values
%

category: 'accessing'
method: GtGemStoneSessionFeatures
numberOfFeatures
	^ featuresById size
%

category: 'printing'
method: GtGemStoneSessionFeatures
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< ' [';
		print: self numberOfFeatures;
		<< ' ';
		<< (self numberOfFeatures = 1 
			ifTrue: [ 'feature' ]
			ifFalse: [ 'features' ]);
		<< ']'
%

! Class implementation for 'GtGemStoneSessionTransactionConflictsReport'

!		Class methods for 'GtGemStoneSessionTransactionConflictsReport'

category: 'instance - creation'
classmethod: GtGemStoneSessionTransactionConflictsReport
forCurrentConflicts
	^ self new initializeFromCurrentConflicts
%

!		Instance methods for 'GtGemStoneSessionTransactionConflictsReport'

category: 'accessing'
method: GtGemStoneSessionTransactionConflictsReport
commitResult 
	^ transactionConflicts  
		at: #commitResult
		ifAbsent: [ 'unknown' ]
%

category: 'gt - extensions'
method: GtGemStoneSessionTransactionConflictsReport
gtViewTransactionConflictsFor: aView 
	<gtView>
	
	^ aView forward
		title: 'Transaction Conflicts';
		priority: 5;
		object: [ transactionConflicts ];
		view: #gtItemsFor:
%

category: 'initialization'
method: GtGemStoneSessionTransactionConflictsReport
initializeFromCurrentConflicts
	transactionConflicts := System transactionConflicts
%

category: 'printing'
method: GtGemStoneSessionTransactionConflictsReport
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream << self commitResult asString ]
%

category: 'converting'
method: GtGemStoneSessionTransactionConflictsReport
reportDictionaryForExport
	^ Dictionary new
		at: 'commitResult' put: self commitResult;
		at: 'conflictsReport'
			put: (self asGtRsrProxyObjectForConnection: nil);
		yourself
%

category: 'accessing'
method: GtGemStoneSessionTransactionConflictsReport
transactionConflicts
	^ transactionConflicts
%

! Class implementation for 'GtGemStoneSpecification'

!		Class methods for 'GtGemStoneSpecification'

category: 'instance creation'
classmethod: GtGemStoneSpecification
fromJSONDictionary: aDictionary
	^ self new  
		initializeFromJSONDictionary: aDictionary
%

category: 'instance creation'
classmethod: GtGemStoneSpecification
fromJsonString: aString
	| dictionary |

	dictionary := STON fromString: aString.
	^ self fromJSONDictionary: dictionary
%

!		Instance methods for 'GtGemStoneSpecification'

category: 'converting'
method: GtGemStoneSpecification
asDictionaryForExport

	^ Dictionary new
		addAll: self localMetadata asMetadataAttributesForExport;
		yourself
%

category: 'converting'
method: GtGemStoneSpecification
asJsonForExport 
	"Answer the receiver serialised in JSON format"

	^STON toJsonString: self asDictionaryForExport
%

category: 'initialization'
method: GtGemStoneSpecification
initializeFromJSONDictionary: aDictionary
	self initializeMetadataFromJSONDictionary: aDictionary.
%

category: 'initialization'
method: GtGemStoneSpecification
initializeMetadataFromJSONDictionary: aDictionary 
	remoteMetadata := GtGemStoneSpecificationMedatada 
		fromObjectDictionary: aDictionary
%

category: 'accessing - metadata'
method: GtGemStoneSpecification
localApiVersion
	^ GtGemStoneSemanticVersionNumber oneZeroZero
%

category: 'accessing - metadata'
method: GtGemStoneSpecification
localMetadata
	^ GtGemStoneSpecificationMedatada new 
		apiVersion: self localApiVersion;
		schemaVersion: self localSchemaVersion
%

category: 'accessing - metadata'
method: GtGemStoneSpecification
localSchemaVersion
	^ GtGemStoneSemanticVersionNumber oneZeroZero
%

category: 'accessing - metadata'
method: GtGemStoneSpecification
remoteMetadata
	^ remoteMetadata
%

! Class implementation for 'GtGemStoneCallFrameIdentifier'

!		Class methods for 'GtGemStoneCallFrameIdentifier'

category: 'instance creation'
classmethod: GtGemStoneCallFrameIdentifier
forIndex: anIndex
	^ self new 
		initializeForIndex: anIndex
%

category: 'instance creation'
classmethod: GtGemStoneCallFrameIdentifier
initialIdentifier
	^ self forIndex: 1
%

!		Instance methods for 'GtGemStoneCallFrameIdentifier'

category: 'comparing'
method: GtGemStoneCallFrameIdentifier
= anObject
	self == anObject ifTrue: [ ^ true ].
	self class = anObject class ifFalse: [ ^ false ].
	
	^ self identityIndex = anObject identityIndex
%

category: 'converting'
method: GtGemStoneCallFrameIdentifier
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'identityIndex' put: identityIndex;
		yourself
%

category: 'accessing'
method: GtGemStoneCallFrameIdentifier
description
	^ self identityIndex asString
%

category: 'comparing'
method: GtGemStoneCallFrameIdentifier
hash
	^ self identityIndex hash
%

category: 'accessing'
method: GtGemStoneCallFrameIdentifier
identityIndex
	^ identityIndex
%

category: 'initialization'
method: GtGemStoneCallFrameIdentifier
initializeForIndex: anIndex
	identityIndex := anIndex
%

category: 'initialization'
method: GtGemStoneCallFrameIdentifier
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	identityIndex := aDictionary at: 'identityIndex'.
%

category: 'accessing'
method: GtGemStoneCallFrameIdentifier
nextIdentifier
	^ self class forIndex: self identityIndex + 1
%

category: 'printing'
method: GtGemStoneCallFrameIdentifier
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream
			nextPutAll: self description ]
%

! Class implementation for 'GtGemStoneClassBasicDetails'

!		Class methods for 'GtGemStoneClassBasicDetails'

category: 'instance creation'
classmethod: GtGemStoneClassBasicDetails
forClass: aGsClass
	^ self new 
		intializeForClass: aGsClass
%

!		Instance methods for 'GtGemStoneClassBasicDetails'

category: 'converting'
method: GtGemStoneClassBasicDetails
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'targetClassName' put: targetClassName;
		at: 'targetClassIconName' put: targetClassIconName;
		yourself
%

category: 'initialization'
method: GtGemStoneClassBasicDetails
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	targetClassName := aDictionary at: 'targetClassName'.
	targetClassIconName := aDictionary at: 'targetClassIconName'.
%

category: 'initialization'
method: GtGemStoneClassBasicDetails
intializeForClass: aGsClass 
	"We should handle here metaclasses through an explicit isMetaclass flag"
	targetClassName := aGsClass name.
	targetClassIconName := aGsClass gtSystemIconName.
%

category: 'accessing'
method: GtGemStoneClassBasicDetails
targetClassIconName
	^ targetClassIconName
%

category: 'accessing'
method: GtGemStoneClassBasicDetails
targetClassName
	^ targetClassName
%

! Class implementation for 'GtGemStoneFeatureSpecification'

!		Class methods for 'GtGemStoneFeatureSpecification'

category: 'instance creation'
classmethod: GtGemStoneFeatureSpecification
forFeature: aFeature
	^ self new 
		initializeForFeature: aFeature
%

!		Instance methods for 'GtGemStoneFeatureSpecification'

category: 'converting'
method: GtGemStoneFeatureSpecification
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'enabled' put: enabled;
		at: 'featureId' put: featureId;
		yourself
%

category: 'accessing'
method: GtGemStoneFeatureSpecification
enabled
	^ enabled
%

category: 'accessing'
method: GtGemStoneFeatureSpecification
enabled: anObject
	enabled := anObject
%

category: 'accessing'
method: GtGemStoneFeatureSpecification
featureId
	^ featureId
%

category: 'accessing'
method: GtGemStoneFeatureSpecification
featureId: anObject
	featureId := anObject
%

category: 'initialization'
method: GtGemStoneFeatureSpecification
initializeForFeature: aFeature 
	enabled := aFeature isEnabled.
	featureId := aFeature featureId.
%

category: 'initialization'
method: GtGemStoneFeatureSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	enabled := aDictionary at: 'enabled'.
	featureId := aDictionary at: 'featureId'.
%

! Class implementation for 'GtGemStoneFeaturesSpecification'

!		Class methods for 'GtGemStoneFeaturesSpecification'

category: 'instance creation'
classmethod: GtGemStoneFeaturesSpecification
forFeatures: aFeaturesObject
	^ self new 
		initializeFromFeatures: aFeaturesObject
%

!		Instance methods for 'GtGemStoneFeaturesSpecification'

category: 'converting'
method: GtGemStoneFeaturesSpecification
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'featureSpecifications' put: (featureSpecifications collect: [ :each |
			each asDictionaryForExport ]);
		yourself
%

category: 'instance creation'
method: GtGemStoneFeaturesSpecification
initializeFromFeatures: aFeaturesObject 
	featureSpecifications := (aFeaturesObject items collect: [ :each |
		each createSpecification ]) asArray
%

category: 'initialization'
method: GtGemStoneFeaturesSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	featureSpecifications := (aDictionary at: 'featureSpecifications') collect: [ :each |
		GtGemStoneFeatureSpecification fromJSONDictionary: each ].
%

! Class implementation for 'GtGemStoneMethodSpecification'

!		Class methods for 'GtGemStoneMethodSpecification'

category: 'instance creation'
classmethod: GtGemStoneMethodSpecification
forClass: aClass selector: aSelector
	| gsMethod | 
	gsMethod := (aClass methodDictForEnv: 0) at: aSelector.
	^ self forGsMethod: gsMethod.
%

category: 'instance creation'
classmethod: GtGemStoneMethodSpecification
forGsMethod: aGsMethod 
	"Creation method on the GemStone side starting from a GemStone method"
	
	^ self new 
		initializeForGsMethod: aGsMethod 
%

!		Instance methods for 'GtGemStoneMethodSpecification'

category: 'converting'
method: GtGemStoneMethodSpecification
asDictionaryForExport

	| exportData| 
	exportData := super asDictionaryForExport.
	exportData
		at: 'coderClassName' put: coderClassName;
		at: 'coderClassIconName' put: coderClassIconName;
		at: 'isMeta' put: isMeta;
		at: 'categoryName' put: categoryName;
		at: 'sourceString' put: sourceString;
		at: 'protocolName' put: protocolName;
		at: 'selector' put: selector.
		
	self explicitProviderBehaviourDetails ifNotNil: [ :anObject | 
		exportData 
			at: 'explicitProviderBehaviourDetails'
			put: anObject asDictionaryForExport ].
	
	^ exportData
%

category: 'accessing'
method: GtGemStoneMethodSpecification
categoryName
	^categoryName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
coderClassIconName
	^ coderClassIconName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
coderClassName
	^ coderClassName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
explicitProviderBehaviourDetails
	^ explicitProviderBehaviourDetails
%

category: 'gt - extensions'
method: GtGemStoneMethodSpecification
gtViewSourceStringFor: aView 
	<gtView>
	
	^ aView textEditor 
		title: 'Source string';
		priority: 25;
		text: [ self sourceString ]
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeForBehaviour: aMethodBehaviour ofMethod: aGsMethod
	self 
		initializeForClassName: aMethodBehaviour theNonMetaClass name
		iconName: aMethodBehaviour gtSystemIconName
		isMeta: aMethodBehaviour isMeta  
		categoryName: aMethodBehaviour category 
		protocolName: (aMethodBehaviour 
			categoryOfSelector: aGsMethod selector )
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeForClassName: aClassName iconName: aClassIconName isMeta: aBoolean categoryName: aCategoryName protocolName: aProtocolName
	coderClassName := aClassName.
	coderClassIconName := aClassIconName.
	isMeta := aBoolean.
	categoryName := aCategoryName.
	protocolName := aProtocolName.
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeForClassName: aClassName iconName: aClassIconName isMeta: aBoolean categoryName: aCategoryName selector: aSelector sourceString: aSourceCode protocolName: aProtocolName explicitProvider: aProviderDetails
	self 
		initializeForClassName: aClassName 
		iconName: aClassIconName 
		isMeta: aBoolean 
		categoryName: aCategoryName 
		protocolName: aProtocolName.
	
	sourceString := aSourceCode.
	selector := aSelector.
	explicitProviderBehaviourDetails := aProviderDetails.
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeForGsMethod: aGsMethod 
	| methodBehavior |
	selector := aGsMethod selector.
	sourceString := aGsMethod sourceString.
	
	methodBehavior := aGsMethod inClass.
	methodBehavior ifNotNil: [
		self 
			initializeForBehaviour: methodBehavior 
			ofMethod: aGsMethod ]
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeForSelector: aSelector sourceString: aSourceString 
	selector := aSelector.
	sourceString := aSourceString.
%

category: 'initialization'
method: GtGemStoneMethodSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.

	self
		initializeForClassName: (aDictionary at: #coderClassName)
		iconName: (aDictionary at: #coderClassIconName ifAbsent: [ nil ])
		isMeta: (aDictionary at: #isMeta)
		categoryName: (aDictionary at: #categoryName)
		selector: (aDictionary at: #selector)
		sourceString: (aDictionary at: #sourceString)
		protocolName: (aDictionary at: #protocolName)
		explicitProvider: ((aDictionary includesKey: #explicitProviderBehaviourDetails)
			ifTrue: [ GtGemStoneClassBasicDetails  fromJSONDictionary: (
				aDictionary at: #explicitProviderBehaviourDetails)]
			ifFalse: [ nil ])
%

category: 'accessing'
method: GtGemStoneMethodSpecification
isMeta
	^ isMeta ifNil: [ false ]
%

category: 'accessing'
method: GtGemStoneMethodSpecification
packageName
	^ categoryName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
printBehaviorName
	self coderClassName ifNil: [ ^ '<none>' ].
	^ self isMeta 
		ifTrue: [ self coderClassName, ' class' ] 
		ifFalse: [ self coderClassName ]
%

category: 'printing'
method: GtGemStoneMethodSpecification
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream 
			<< self printBehaviorName;
			<< '>>';
			<< (self selector ifNil: [ ^ '<none>' ]) ]
%

category: 'accessing'
method: GtGemStoneMethodSpecification
protocol
	^ protocolName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
protocolName
	^protocolName
%

category: 'accessing'
method: GtGemStoneMethodSpecification
selector
	^ selector
%

category: 'accessing'
method: GtGemStoneMethodSpecification
sourceString
	^ sourceString
%

! Class implementation for 'GtGemStoneContextSpecification'

!		Class methods for 'GtGemStoneContextSpecification'

category: 'instance creation'
classmethod: GtGemStoneContextSpecification
forGsCallFrame: aGsCallFrame
	^ self new 
		initializeForGsCallFrame: aGsCallFrame 
%

!		Instance methods for 'GtGemStoneContextSpecification'

category: 'converting'
method: GtGemStoneContextSpecification
asDictionaryForExport

	^ super asDictionaryForExport
		at: #isForBlock put: isForBlock;
		at: #ipOffset put: ipOffset;
		at: #frameIdentifier put: frameIdentifier asDictionaryForExport;
		at: #programCounterMarkers put: programCounterMarkers;
		yourself
%

category: 'accessing'
method: GtGemStoneContextSpecification
frameIdentifier
	^ frameIdentifier
%

category: 'initialization'
method: GtGemStoneContextSpecification
initializeForGsCallFrame: aGsCallFrame 
	self initializeForGsMethod: aGsCallFrame homeMethod.
	self initializeProviderBehaviorFromFrame: aGsCallFrame.
	
	isForBlock := aGsCallFrame isForBlock.
	ipOffset := aGsCallFrame ipOffset.
	frameIdentifier := aGsCallFrame frameIdentifier. 
	programCounterMarkers := aGsCallFrame programCounterMarkers. 
%

category: 'initialization'
method: GtGemStoneContextSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	isForBlock := aDictionary at: #isForBlock.
	ipOffset := aDictionary at: #ipOffset ifAbsent: [ nil ].
	programCounterMarkers := aDictionary at: #programCounterMarkers ifAbsent: [ nil ].
	
	(aDictionary includesKey: #frameIdentifier) ifTrue: [
		frameIdentifier := GtGemStoneCallFrameIdentifier 
			fromJSONDictionary: (aDictionary at: #frameIdentifier) ]
%

category: 'initialization'
method: GtGemStoneContextSpecification
initializeProviderBehaviorFromFrame: aGsCallFrame 
	| selfObjectClass |
	selfObjectClass := aGsCallFrame selfObjectClass.
	aGsCallFrame methodClass ~= selfObjectClass ifTrue: [
		explicitProviderBehaviourDetails := GtGemStoneClassBasicDetails 
			forClass: selfObjectClass ]
%

category: 'accessing'
method: GtGemStoneContextSpecification
ipOffset
	^ ipOffset
%

category: 'accessing'
method: GtGemStoneContextSpecification
isForBlock
	^ isForBlock ifNil: [ false ]
%

category: 'accessing'
method: GtGemStoneContextSpecification
programCounterMarkers
	^ programCounterMarkers
%

! Class implementation for 'GtGemStoneMethodsSpecification'

!		Class methods for 'GtGemStoneMethodsSpecification'

category: 'instance creation'
classmethod: GtGemStoneMethodsSpecification
forGsMethods: aCollection 
	^ self new 
		initializeForGsMethods: aCollection 
%

!		Instance methods for 'GtGemStoneMethodsSpecification'

category: 'accessing'
method: GtGemStoneMethodsSpecification
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'methodCoderSpecifications' put: (methodCoderSpecifications
			collect: [ :aMethodCoderSpecification |
				aMethodCoderSpecification asDictionaryForExport]);
		yourself
%

category: 'accessing'
method: GtGemStoneMethodsSpecification
at: anInteger

	^ methodCoderSpecifications at: anInteger
%

category: 'accessing'
method: GtGemStoneMethodsSpecification
initializeForGsMethods: aCollectionOfGsMethods
	methodCoderSpecifications := aCollectionOfGsMethods asArray 
		collect: [ :aGsMethod |
			GtGemStoneMethodSpecification forGsMethod: aGsMethod ]
%

category: 'initialization'
method: GtGemStoneMethodsSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	methodCoderSpecifications := (aDictionary at: #methodCoderSpecifications)
		collect: [ :aCoderJsonData  |
			self instantiateCoderSpecificationFromJsonData: aCoderJsonData ]
%

category: 'initialization'
method: GtGemStoneMethodsSpecification
instantiateCoderSpecificationFromJsonData: aCoderJsonData 
	^ GtGemStoneMethodSpecification  fromJSONDictionary: aCoderJsonData
%

category: 'accessing'
method: GtGemStoneMethodsSpecification
methodCoderSpecifications
	^ methodCoderSpecifications
%

category: 'accessing'
method: GtGemStoneMethodsSpecification
size

	^ methodCoderSpecifications size
%

! Class implementation for 'GtGemStoneProcessSpecification'

!		Class methods for 'GtGemStoneProcessSpecification'

category: 'instance creation'
classmethod: GtGemStoneProcessSpecification
forGsCallStack: aCallStack
	^ self new 
		initializeForGsCallStack: aCallStack
%

!		Instance methods for 'GtGemStoneProcessSpecification'

category: 'accessing'
method: GtGemStoneProcessSpecification
frameSpecifications
	^ self methodCoderSpecifications
%

category: 'gt - extensions'
method: GtGemStoneProcessSpecification
gtViewCallFrameSpecificationsFor: aView 
	<gtView>
	
	^ aView columnedList 
		title: 'Frame specifications';
		priority: 50;
		items: [ self frameSpecifications ];
		actionUpdateButtonTooltip: 'Update item list';
		column: 'Index' 
			text: [ :eachItem :eachIndex | eachIndex  ]
			width: 45;
		column: 'ID' 
			text: [ :eachItem | eachItem frameIdentifier description  ]
			width: 45;
		column: 'Ip Offset' 
			text: [ :eachItem | eachItem ipOffset ]
			width: 45;
		column: 'Item' 
			text: [ :eachItem | eachItem gtDisplayText ]
%

category: 'accessing'
method: GtGemStoneProcessSpecification
initializeForGsCallStack: aCallStack
	methodCoderSpecifications := (aCallStack callFrames 
		collect: [ :aGsCallFrame |
			GtGemStoneContextSpecification forGsCallFrame: aGsCallFrame ]) asArray
%

category: 'accessing'
method: GtGemStoneProcessSpecification
instantiateCoderSpecificationFromJsonData: aCoderJsonData 
	^ GtGemStoneContextSpecification  fromJSONDictionary: aCoderJsonData
%

! Class implementation for 'GtGemStoneSpecificationMedatada'

!		Class methods for 'GtGemStoneSpecificationMedatada'

category: 'instance creation'
classmethod: GtGemStoneSpecificationMedatada
fromJSONDictionary: aDictionary
	^ self new  
		initializeFromJSONDictionary: aDictionary
%

category: 'instance creation'
classmethod: GtGemStoneSpecificationMedatada
fromJsonString: aString
	| dictionary |

	dictionary := STON fromString: aString.
	^ self fromJSONDictionary: dictionary
%

category: 'instance creation'
classmethod: GtGemStoneSpecificationMedatada
fromObjectDictionary: aDictionary 
	^ self fromJSONDictionary: (aDictionary 
		at: '__metadata' 
		ifAbsent: [ ^ self new
			apiVersion: GtGemStoneSemanticVersionNumber zero;
			schemaVersion: GtGemStoneSemanticVersionNumber zero ])
%

!		Instance methods for 'GtGemStoneSpecificationMedatada'

category: 'accessing'
method: GtGemStoneSpecificationMedatada
apiVersion
	^ apiVersion
%

category: 'accessing'
method: GtGemStoneSpecificationMedatada
apiVersion: anObject
	apiVersion := anObject
%

category: 'converting'
method: GtGemStoneSpecificationMedatada
asDictionaryForExport
	^ {
		'apiVersion' -> self apiVersion versionString.
		'schemaVersion' -> self schemaVersion versionString
	} asDictionary
%

category: 'converting'
method: GtGemStoneSpecificationMedatada
asMetadataAttributesForExport
	^ {'__metadata' -> self asDictionaryForExport} asDictionary
%

category: 'initialization'
method: GtGemStoneSpecificationMedatada
initializeFromJSONDictionary: aDictionary
	apiVersion := GtGemStoneSemanticVersionNumber 
		readFromString: (aDictionary at: 'apiVersion').
	schemaVersion := GtGemStoneSemanticVersionNumber 
		readFromString: (aDictionary at: 'schemaVersion').
%

category: 'accessing'
method: GtGemStoneSpecificationMedatada
schemaVersion
	^ schemaVersion
%

category: 'accessing'
method: GtGemStoneSpecificationMedatada
schemaVersion: anObject
	schemaVersion := anObject
%

! Class implementation for 'GtGemStoneTranscript'

!		Class methods for 'GtGemStoneTranscript'

category: 'accessing'
classmethod: GtGemStoneTranscript
current
	^ GtGemStoneTranscriptHandler currentTranscript
%

category: 'accessing'
classmethod: GtGemStoneTranscript
registerAsCurrentTranscript
	^ GtGemStoneTranscriptHandler registerTranscriptClass: self
%

category: 'accessing'
classmethod: GtGemStoneTranscript
reset
	^ GtGemStoneTranscriptHandler resetTranscript
%

!		Instance methods for 'GtGemStoneTranscript'

category: 'actions'
method: GtGemStoneTranscript
clearContent
	self subclassResponsibility
%

category: 'api - streaming'
method: GtGemStoneTranscript
cr
	self nextPut: Character cr
%

category: 'api - streaming'
method: GtGemStoneTranscript
crShow: anObject
	self 
		cr; 
		show: anObject 
%

category: 'actions'
method: GtGemStoneTranscript
disable
	self subclassResponsibility
%

category: 'actions'
method: GtGemStoneTranscript
enable
	self subclassResponsibility
%

category: 'testing'
method: GtGemStoneTranscript
isEnabled
	^ self subclassResponsibility
%

category: 'api - streaming'
method: GtGemStoneTranscript
lf
	self nextPut: Character lf
%

category: 'api - streaming'
method: GtGemStoneTranscript
lfShow: anObject
	self 
		lf; 
		show: anObject
%

category: 'api - streaming'
method: GtGemStoneTranscript
newLine
	self lf
%

category: 'api - streaming'
method: GtGemStoneTranscript
nextPut: aCharacter
	self subclassResponsibility
%

category: 'api - streaming'
method: GtGemStoneTranscript
nextPutAll: aString
	self subclassResponsibility
%

category: 'api - streaming'
method: GtGemStoneTranscript
print: anObject
	self nextPutAll: anObject asString 
%

category: 'api - streaming'
method: GtGemStoneTranscript
show: anObject
	self print: anObject
%

category: 'accessing'
method: GtGemStoneTranscript
statusDescription
	^ self isEnabled
		ifTrue: [ 'Enabled' ] 
		ifFalse: [ 'Disabled' ]
%

category: 'actions'
method: GtGemStoneTranscript
toggleStatus
	self isEnabled 
		ifTrue: [ self disable ]	
		ifFalse: [ self enable ].
	
	^ self isEnabled 
%

category: 'actions'
method: GtGemStoneTranscript
toggleStatusWithLogging
	self isEnabled 
		ifTrue: [ 
			self lfShow: 'Deactivate GemStone transcript on current session'.
			self disable]
		ifFalse: [ 
			self enable.
			self lfShow: 'Activate GemStone transcript on current session' ].
	^ self isEnabled
%

category: 'utils'
method: GtGemStoneTranscript
whenEnabledDo: aBlock
	self isEnabled ifTrue: [
		aBlock value ]
%

! Class implementation for 'GtGemStoneInImageTranscript'

!		Instance methods for 'GtGemStoneInImageTranscript'

category: 'configuration'
method: GtGemStoneInImageTranscript
clearContent
	contentStream := PrintStream printingOn: String new.
%

category: 'accessing'
method: GtGemStoneInImageTranscript
contents
	^ contentStream contents
%

category: 'configuration'
method: GtGemStoneInImageTranscript
disable
	enabled := false
%

category: 'configuration'
method: GtGemStoneInImageTranscript
enable
	enabled := true
%

category: 'gt - extensions'
method: GtGemStoneInImageTranscript
gtViewContentsFor: aView
	<gtView>
	
	^ aView text 
		title: 'Contents';
		priority: 10;
		text: [ contentStream contents ]
%

category: 'initialization'
method: GtGemStoneInImageTranscript
initialize
	super initialize.
	
	self clearContent.
	self disable.
%

category: 'testing'
method: GtGemStoneInImageTranscript
isEnabled
	^ enabled
%

category: 'api - streaming'
method: GtGemStoneInImageTranscript
nextPut: aCharacter
	self whenEnabledDo: [  
		contentStream nextPut: aCharacter ]
%

category: 'api - streaming'
method: GtGemStoneInImageTranscript
nextPutAll: aString
	self whenEnabledDo: [  
		contentStream nextPutAll: aString ]
%

! Class implementation for 'GtGemStoneTranscriptHandler'

!		Class methods for 'GtGemStoneTranscriptHandler'

category: 'utils'
classmethod: GtGemStoneTranscriptHandler
createNewTranscript
	^ ((System myUserProfile objectNamed: self transcriptClassName asSymbol)
		ifNil: [ GtGemStoneInImageTranscript  ]
		ifNotNil: [ :aClass | aClass ]) basicNew initialize
%

category: 'transcript - api'
classmethod: GtGemStoneTranscriptHandler
currentTranscript
	^ SessionTemps current 
		at: self transcriptInstanceKeyName
		ifAbsentPut: [ self createNewTranscript  ]
%

category: 'transcript - api'
classmethod: GtGemStoneTranscriptHandler
registerTranscriptClass: aClass
	^ SessionTemps current 
		at: self transcriptClassKeyName
		put: aClass name
%

category: 'transcript - api'
classmethod: GtGemStoneTranscriptHandler
resetTranscript
	"Remove the current transcript instance.
	If called from the GT side, the caller should ensure
	that the old instance is no longer used on the GT side."
	
	SessionTemps current 
		removeKey: self transcriptInstanceKeyName
		ifAbsent: [ ]
%

category: 'accessing'
classmethod: GtGemStoneTranscriptHandler
transcriptClassKeyName
	^#GT_TRANSCRIPT_INSTANCE
%

category: 'accessing'
classmethod: GtGemStoneTranscriptHandler
transcriptClassName
	^ SessionTemps current 
		at: self transcriptClassKeyName
		ifAbsent: [ GtGemStoneInImageTranscript name ]
%

category: 'accessing'
classmethod: GtGemStoneTranscriptHandler
transcriptInstanceKeyName
	^#GT_TRANSCRIPT_CLASS_NAME
%

! Class implementation for 'GtGsRelease'

!		Class methods for 'GtGsRelease'

category: 'accessing'
classmethod: GtGsRelease
default
	^ default ifNil: [ 
		default := self new ]
%

category: 'accessing'
classmethod: GtGsRelease
versionString
	^ default
		ifNil: [ '<none>' ]
		ifNotNil: [
			self default versionString ]
%

category: 'accessing'
classmethod: GtGsRelease
versionString: aString
	self default versionString: aString
%

!		Instance methods for 'GtGsRelease'

category: 'accessing'
method: GtGsRelease
versionString

	^ versionString
%

category: 'accessing'
method: GtGsRelease
versionString: aString

	versionString := aString
%

! Class implementation for 'GtRsrSerializationStrategy'

!		Class methods for 'GtRsrSerializationStrategy'

category: 'accessing'
classmethod: GtRsrSerializationStrategy
strategyLabel
	^ ((self className
		withoutPrefix: 'GtRsr')
		withoutSuffix: 'SerializationStrategy class')
			ifEmpty: [ 'SerializationStrategy' ]
%

!		Instance methods for 'GtRsrSerializationStrategy'

category: 'converting'
method: GtRsrSerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ self subclassResponsibility
%

category: 'converting'
method: GtRsrSerializationStrategy
serialize: anObject
	"Serialize the object to something that RSR can return"
	
	^ self subclassResponsibility
%

! Class implementation for 'GtRsrDirectLocalObjectSerializationStrategy'

!		Instance methods for 'GtRsrDirectLocalObjectSerializationStrategy'

category: 'converting'
method: GtRsrDirectLocalObjectSerializationStrategy
serialize: anObject 
	| names instVarDictionary |
	
	"This code that sets the attributes be delegated through the class of the object"
	names := anObject class allInstVarNames.
	instVarDictionary := Dictionary new.
	1 to: names size do: [ :i |
		instVarDictionary at: (names at: i) put: (self instVarAt: i) ].
	
	^ Dictionary new 	
		at: 'instanceVariables' put: instVarDictionary;
		at: 'remoteInstance' put: (anObject asGtRsrProxyObjectForConnection: nil);
		at: 'remoteClassName' put: anObject class name;
		yourself
%

! Class implementation for 'GtRsrLegacySerializationStrategy'

!		Instance methods for 'GtRsrLegacySerializationStrategy'

category: 'converting'
method: GtRsrLegacySerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ anObject
%

category: 'converting'
method: GtRsrLegacySerializationStrategy
serialize: anObject 
	^ anObject asGtRsrProxyObjectForConnection: nil
%

! Class implementation for 'GtRsrLiteralAndProxySerializationStrategy'

!		Instance methods for 'GtRsrLiteralAndProxySerializationStrategy'

category: 'converting'
method: GtRsrLiteralAndProxySerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ anObject
%

! Class implementation for 'GtRsrLocalObjectSerializationStrategy'

!		Instance methods for 'GtRsrLocalObjectSerializationStrategy'

category: 'converting'
method: GtRsrLocalObjectSerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ anObject asGtBareProxyObject asGtpoLocalObject
%

category: 'converting'
method: GtRsrLocalObjectSerializationStrategy
serialize: anObject 
	^ anObject asGtRsrProxyObjectForConnection: nil
%

! Class implementation for 'GtRsrPrimitiveOnlySerializationStrategy'

!		Instance methods for 'GtRsrPrimitiveOnlySerializationStrategy'

category: 'converting'
method: GtRsrPrimitiveOnlySerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ anObject
%

category: 'converting'
method: GtRsrPrimitiveOnlySerializationStrategy
serialize: anObject
	"Serialize the object to something that RSR can return.
	In this case we're requiring that the object can be returned as an RSR primitive.  If it can't RSR will raise an exception."
	
	^ anObject
%

! Class implementation for 'GtRsrProxyOnlySerializationStrategy'

!		Instance methods for 'GtRsrProxyOnlySerializationStrategy'

category: 'converting'
method: GtRsrProxyOnlySerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"
	
	^ anObject
%

! Class implementation for 'GtRsrStonSerializationStrategy'

!		Instance methods for 'GtRsrStonSerializationStrategy'

category: 'converting'
method: GtRsrStonSerializationStrategy
deserialize: anObject
	"Deserialize the supplied object"

	anObject isString ifFalse: [ ^ anObject ].

	^ self stonClass fromString: anObject
%

category: 'converting'
method: GtRsrStonSerializationStrategy
serialize: anObject
	"Serialize the object to a String, except RSR services"

	(anObject isKindOf: RsrService) ifTrue: [ ^ anObject ].
	^ self stonClass toString: anObject
%

category: 'private'
method: GtRsrStonSerializationStrategy
stonClass
	| stonClass |

	stonClass := self
		gtDo: [ self class environment at: #STON ifAbsent: [ nil ] ]
		gemstoneDo: [ GsCurrentSession currentSession symbolList objectNamed: #STON ].
	stonClass ifNil: [ self error: 'STON not installed' ].

	^ stonClass
%

! Class implementation for 'GtRsrWireSerializationStrategy'

!		Instance methods for 'GtRsrWireSerializationStrategy'

category: 'converting'
method: GtRsrWireSerializationStrategy
deserialize: aGtRsrWireTransferService
	"Deserialize the supplied object"
	
	^ aGtRsrWireTransferService object
%

category: 'accessing'
method: GtRsrWireSerializationStrategy
encoder

	^ encoder
%

category: 'accessing'
method: GtRsrWireSerializationStrategy
encoder: aGtWireEncoder

	"self assert: aGtWireEncoder hasValidConfiguration
		description: 'Supplied wire encoder has invalid configuration'."
	encoder := aGtWireEncoder
%

category: 'converting'
method: GtRsrWireSerializationStrategy
serialize: anObject
	"Serialize the object to something that RSR can return"
	
	^ (self gtDo: [ GtRsrWireTransferService clientClass ] gemstoneDo: [ GtRsrWireTransferService serverClass ]) new 
		encoder: encoder copy;
		object: anObject
%

! Class implementation for 'STONJSON'

!		Class methods for 'STONJSON'

category: 'other'
classmethod: STONJSON
fromString: aString
	^ JsonParser parse: aString
%

category: 'other'
classmethod: STONJSON
toString: object
	^ STON toJsonString: object
%

category: 'other'
classmethod: STONJSON
toStringPretty: object
	^ STON toJsonStringPretty: object
%

! Class implementation for 'ZnBase64Encoder'

!		Class methods for 'ZnBase64Encoder'

category: 'other'
classmethod: ZnBase64Encoder
new
	^ self basicNew initialize
%

!		Instance methods for 'ZnBase64Encoder'

category: 'other'
method: ZnBase64Encoder
beStrict
	"Configure me to enforce padding when decoding"

	strict := true
%

category: 'other'
method: ZnBase64Encoder
characterCountFor: bytes
	| n characterCount |
	"This assumes that padding is used"
	n := bytes size.
	characterCount := (n // 3 + (n \\ 3) sign) * 4.
	^ lineLength
		ifNil: [ characterCount ]
		ifNotNil: [ characterCount + (characterCount // lineLength * lineEnd size) ]
%

category: 'other'
method: ZnBase64Encoder
characterForValue: value
	^ alphabet at: value + 1
%

category: 'other'
method: ZnBase64Encoder
defaultAlphabet
	^ 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
%

category: 'other'
method: ZnBase64Encoder
defaultInverse
	| defaultInverse |
	defaultInverse := Array new: 128.
	0 to: 127 do: [ :each | 
		| offset |
		offset := self defaultAlphabet indexOf: each asCharacter ifAbsent: [ nil ].
		defaultInverse at: each + 1 put: (offset ifNotNil: [ offset - 1 ]) ].
	^ defaultInverse
%

category: 'other'
method: ZnBase64Encoder
encode: byteArray
	"Encode byteArray using Base64 encoding and return the resulting string"

	^ String
		new: (self characterCountFor: byteArray)
		streamContents: [ :stringStream |
			self encode: byteArray readStream to: stringStream ]
%

category: 'other'
method: ZnBase64Encoder
encode: byte1 and: byte2 and: byte3 to: stream
	stream nextPut: (self characterForValue: (byte1 bitShift: -2)).
	byte2
		ifNil: [
			stream nextPut: (self characterForValue: ((byte1 bitAnd: 2r11) bitShift: 4)).
			padding ifNotNil: [ stream nextPut: padding; nextPut: padding ] ]
		ifNotNil: [
			stream nextPut: (self characterForValue: (((byte1 bitAnd: 2r11) bitShift: 4) + (byte2 bitShift: -4))).
			byte3
				ifNil: [
					stream nextPut: (self characterForValue: ((byte2 bitAnd: 2r1111) bitShift: 2)).
					padding ifNotNil: [ stream nextPut: $= ] ]
				ifNotNil: [
					stream nextPut: (self characterForValue: (((byte2 bitAnd: 2r1111) bitShift: 2) + (byte3 bitShift: -6))).
					stream nextPut: (self characterForValue: (byte3 bitAnd: 2r111111)) ] ]
%

category: 'other'
method: ZnBase64Encoder
encode: byteStream to: stringStream
	| byte1 byte2 byte3 count |
	lineLength
		ifNil: [
			[ byteStream atEnd ] whileFalse: [
				byte1 := byteStream next.
				byte2 := byteStream next.
				byte3 := byteStream next.
				self encode: byte1 and: byte2 and: byte3 to: stringStream ] ]
		ifNotNil: [
			count := 0.
			[ byteStream atEnd ] whileFalse: [
				byte1 := byteStream next.
				byte2 := byteStream next.
				byte3 := byteStream next.
				self encode: byte1 and: byte2 and: byte3 to: stringStream.
				(count := count + 4) = lineLength
					ifTrue: [
						stringStream nextPutAll: lineEnd.
						count := 0 ] ] ]
%

category: 'other'
method: ZnBase64Encoder
initialize
	super initialize.
	alphabet := self defaultAlphabet.
	inverse := self defaultInverse.
	self padding: $=.
	self whitespace: #any.
	self beStrict
%

category: 'other'
method: ZnBase64Encoder
padding: character
	"Configure me to use character as padding.
	One or two padding character might be needed to complete each quad.
	Use nil to disable padding."

	padding := character
%

category: 'other'
method: ZnBase64Encoder
whitespace: mode
	"Set the whitespace mode:
	nil is no whitespace allowed,
	#separator is CR, LF, FF, SPACE, TAB allowed,
	#any is all non-alphabet characters allowed (the default)"

	whitespace := mode
%

! Class implementation for 'GtRsrEvaluatorFeaturesService'

!		Class methods for 'GtRsrEvaluatorFeaturesService'

category: 'accessing'
classmethod: GtRsrEvaluatorFeaturesService
templateClassName

	^ #GtRsrEvaluatorFeaturesService
%

! Class implementation for 'GtRsrEvaluatorFeaturesServiceServer'

!		Instance methods for 'GtRsrEvaluatorFeaturesServiceServer'

category: 'accessing'
method: GtRsrEvaluatorFeaturesServiceServer
featuresDictionary
	"Answer a dictionary of primitives defining the server's evaluation features."

	^ Dictionary new
		at: #gtRsrEvaluator put: (Dictionary new
			at: #version put: '0.1.0';
			yourself);
		yourself.
%

! Class implementation for 'GtRsrEvaluatorService'

!		Class methods for 'GtRsrEvaluatorService'

category: 'testing'
classmethod: GtRsrEvaluatorService
isRsrImmediate: anObject
	"Answer a boolean indicating whether the supplied object is considered a primitive type, meaining:
	- it has an RSR service mapping, or
	- it is a service object"

	^ (RsrReference referenceMapping includesKey: anObject class) or:
		[ anObject isKindOf: RsrService ]
%

category: 'accessing'
classmethod: GtRsrEvaluatorService
templateClassName

	^ #GtRsrEvaluatorService
%

! Class implementation for 'GtRsrEvaluatorServiceServer'

!		Class methods for 'GtRsrEvaluatorServiceServer'

category: 'logging'
classmethod: GtRsrEvaluatorServiceServer
stdout
	"Cache stdout in the session temps as in a large database reflection is very slow,
	so the initial call could take 10 - 20 seconds."

	^ SessionTemps current
		at: #stdout
		ifAbsentPut: [ FsFileDescriptor stdout ].
%

category: 'logging'
classmethod: GtRsrEvaluatorServiceServer
stdoutLog: aMessage
	| msgStream |

	msgStream := WriteStream on: String new.
	msgStream
		nextPutAll: Time now printString;
		nextPutAll: ': ';
		nextPutAll: (aMessage isString
			ifTrue: [ aMessage asString ]
			ifFalse: [ aMessage printString ]);
		lf.
	self stdout write: msgStream contents utf8Encoded.
%

!		Instance methods for 'GtRsrEvaluatorServiceServer'

category: 'actions'
method: GtRsrEvaluatorServiceServer
evaluate: aString for: anObject bindings: aDictionary
	"Evaluate the receiver's script, answering the result.
	On the server this is a synchronous operation."

	^ self 
			evaluate: aString 
			for: anObject 
			bindings: aDictionary 
			serializationStrategy: #GtRsrLegacySerializationStrategy
%

category: 'actions'
method: GtRsrEvaluatorServiceServer
evaluate: aString for: anObject bindings: aDictionary serializationStrategy: aSymbol
	"Evaluate the receiver's script, answering the serialized result.
	On the server this is a synchronous operation."
	
	| evaluationResult |

	evaluationResult := self 
		gsEvaluate: aString 
		for: anObject 
		bindings: aDictionary 
		serializationStrategy: aSymbol.

	^ evaluationResult ifNotNil: [ :anEvaluationResult |  
		anEvaluationResult asDictionaryForExport ]
%

category: 'actions'
method: GtRsrEvaluatorServiceServer
evaluate: aString for: anObject inFrameIdentifierIndex: aFrameIndex ofEvaluationContext: aTargetEvaluationContext bindings: aDictionary serializationStrategy: aSymbol
	"Evaluate the receiver's script, answering the serialized result.
	On the server this is a synchronous operation."
	
	| evaluationResult |

	evaluationResult := self 
		gsEvaluate: aString 
		for: anObject 
		inFrameIdentifierIndex: aFrameIndex 
		ofEvaluationContext: aTargetEvaluationContext
		bindings: aDictionary 
		serializationStrategy: aSymbol.

	^ evaluationResult ifNotNil: [ :anEvaluationResult |  
		anEvaluationResult asDictionaryForExport ]
%

category: 'actions'
method: GtRsrEvaluatorServiceServer
evaluateReturnProxy: aString for: anObject bindings: aDictionary
	"Evaluate the receiver's script, answering the result as a proxy.
	On the server this is a synchronous operation."

	^ self 
			evaluate: aString 
			for: anObject 
			bindings: aDictionary 
			serializationStrategy: #GtRsrProxyOnlySerializationStrategy
%

category: 'private - GemStone'
method: GtRsrEvaluatorServiceServer
gsEvaluate: aString for: anObject bindings: aDictionary
	^ self gsEvaluate: aString for: anObject bindings: aDictionary serializationStrategy: nil
%

category: 'private - GemStone'
method: GtRsrEvaluatorServiceServer
gsEvaluate: aString for: anObject bindings: aDictionary serializationStrategy: aSymbol
	"Evaluate the receiver's script, answering the result"
	| receiver symbolDictionary bindings |

	SessionTemps current at: #GtRsrServer put: self.
	receiver := anObject asGtGsArgument.
	symbolDictionary := SymbolDictionary new.
	aDictionary asGtGsArgument keysAndValuesDo: [ :key :value |
		symbolDictionary at: key put: value asGtGsArgument ].
	bindings := GsCurrentSession currentSession symbolList, (Array with: symbolDictionary).

	^ GtGemStoneEvaluationContext new
		serializationStrategy: aSymbol;
		evaluateAndWaitBlock: 
			[ | method |
			method := aString _compileInContext: receiver symbolList: bindings.
			method _executeInContext: receiver ]
		from: self.
%

category: 'private - GemStone'
method: GtRsrEvaluatorServiceServer
gsEvaluate: aString for: anObject  inFrameIdentifierIndex: aFrameIdentifierIndex ofEvaluationContext: aTargetEvaluationContext bindings: aDictionary serializationStrategy: aSymbol
	"Evaluate the receiver's script, answering the result"
	| compilationContext receiver  allBindings  |

	SessionTemps current at: #GtRsrServer put: self.
	compilationContext := GtGemStoneCompilationContext 
		receiver: anObject asGtGsArgument
		frameIdentifierIndex: aFrameIdentifierIndex 
		evaluationContext: aTargetEvaluationContext asGtGsArgument
		clientBindings: aDictionary asGtGsArgument.

	receiver := compilationContext currentReceiver.
	allBindings := compilationContext allBindings.

	^ GtGemStoneEvaluationContext new
		serializationStrategy: aSymbol;
		compilationContext: compilationContext;
		evaluateAndWaitBlock: 
			[ | method |
			method := aString _compileInContext: receiver symbolList: allBindings.
			[ method _executeInContext: receiver] ensure: [
				compilationContext updatedFrameBindings ] ]
		from: self
%

category: 'private - GemStone'
method: GtRsrEvaluatorServiceServer
gsStartEvaluate: aString for: anObject bindings: aDictionary serializationStrategy: aSymbol
	"Evaluate the receiver's script, answering the result"
	| receiver symbolDictionary bindings |

	SessionTemps current at: #GtRsrServer put: self.
	receiver := anObject asGtGsArgument.
	symbolDictionary := SymbolDictionary new.
	aDictionary asGtGsArgument keysAndValuesDo: [ :key :value |
		symbolDictionary at: key put: value asGtGsArgument ].
	bindings := GsCurrentSession currentSession symbolList, (Array with: symbolDictionary).

	^ GtGemStoneEvaluationContext new
		serializationStrategy: aSymbol;
		evaluateBlock: 
			[ | method |
			method := aString _compileInContext: receiver symbolList: bindings.
			method _executeInContext: receiver ]
		from: self
		priority: Processor userBackgroundPriority - 2
%

category: 'actions'
method: GtRsrEvaluatorServiceServer
startEvaluate: aString for: anObject bindings: aDictionary serializationStrategy: aSymbol
	"Start the receiver's script, answering the result."
	| evaluationResult |

	evaluationResult := self gsStartEvaluate: aString for: anObject bindings: aDictionary serializationStrategy: aSymbol.
	^ evaluationResult asDictionaryForExport
			asGtRsrProxyObjectForConnection: nil
%

! Class implementation for 'GtRsrProxyService'

!		Class methods for 'GtRsrProxyService'

category: 'accessing'
classmethod: GtRsrProxyService
templateClassName

	^ #GtRsrProxyService
%

!		Instance methods for 'GtRsrProxyService'

category: 'testing'
method: GtRsrProxyService
isGtGemStoneRsrProxy

	^ true
%

category: 'testing'
method: GtRsrProxyService
isGtProxyObject

	^ true
%

category: 'testing'
method: GtRsrProxyService
isProxyObjectActive
	"Answer a boolean indicating whether the receiver is expected to be functioning,
	i.e. it has a connection that is open, and it's connection is the current one."

	_connection ifNil: [ ^ false ].
	_connection isOpen ifFalse: [ ^ false ].
	^ true
%

category: 'accessing'
method: GtRsrProxyService
remoteClass
	"Answer the name of the class of the remote object"

	^ remoteClass
%

category: 'accessing'
method: GtRsrProxyService
remoteClass: aSymbol
	"Set the name of the class of the remote object"

	remoteClass := aSymbol
%

! Class implementation for 'GtRsrProxyServiceServer'

!		Class methods for 'GtRsrProxyServiceServer'

category: 'other'
classmethod: GtRsrProxyServiceServer
object: anObject

	^ self new object: anObject
%

!		Instance methods for 'GtRsrProxyServiceServer'

category: 'accessing'
method: GtRsrProxyServiceServer
asGtGsArgument
	"Answer the the local object of the receiver"

	^ object
%

category: 'private'
method: GtRsrProxyServiceServer
basicPerform: aSymbol withArguments: anArray  serializationStrategy: aSerialisationStrategySymbol
	"Perform the requested operation, catching errors and returning exception information"

	SessionTemps current at: #GtRsrServer put: self.

	^ (GtGemStoneEvaluationContext new
		serializationStrategy: aSerialisationStrategySymbol)
			evaluateAndWaitBlock: [ 
				object perform: aSymbol withArguments: anArray asGtGsArgument ]
			from: self.
%

category: 'accessing'
method: GtRsrProxyServiceServer
object
	"Answer the object being proxied"

	^ object
%

category: 'accessing'
method: GtRsrProxyServiceServer
object: anObject
	"Set the object being proxied"

	object := anObject.
	remoteClass := anObject class name.
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerform: aSymbol
	^ self proxyPerform: aSymbol withArguments: #()
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerform: aSymbol serializationStrategy: serializationSymbol
	^ self 
		proxyPerform: aSymbol 
		withArguments: #() 
		serializationStrategy: serializationSymbol
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerform: aSymbol withArguments: anArray
	^ self 
		proxyPerform: aSymbol 
		withArguments: anArray
		serializationStrategy: #GtRsrLegacySerializationStrategy
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerform: aSymbol withArguments: anArray serializationStrategy: aSerializationStrategySymbol
	| evaluationResult |

	evaluationResult := self 
		basicPerform: aSymbol 
		withArguments: anArray 
		serializationStrategy: aSerializationStrategySymbol.

	^ evaluationResult ifNotNil: [ :anEvaluationResult |  
		anEvaluationResult asDictionaryForExport ]
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerformReturnProxy: aSymbol
	^ self proxyPerformReturnProxy: aSymbol withArguments: #()
%

category: 'performing'
method: GtRsrProxyServiceServer
proxyPerformReturnProxy: aSymbol withArguments: anArray
	^ self 
		proxyPerform: aSymbol 
		withArguments: anArray
		serializationStrategy: #GtRsrProxyOnlySerializationStrategy
%

! Class implementation for 'GtRsrTestService'

!		Class methods for 'GtRsrTestService'

category: 'accessing'
classmethod: GtRsrTestService
templateClassName

	^ #GtRsrTestService
%

!		Instance methods for 'GtRsrTestService'

category: 'testing'
method: GtRsrTestService
isGtGemStoneRsrProxy

	^ true
%

category: 'accessing'
method: GtRsrTestService
object
	^ object
%

category: 'accessing'
method: GtRsrTestService
object: anObject
	object := anObject
%

! Class implementation for 'GtRsrWireTransferService'

!		Class methods for 'GtRsrWireTransferService'

category: 'accessing'
classmethod: GtRsrWireTransferService
templateClassName

	^ #GtRsrWireTransferService
%

!		Instance methods for 'GtRsrWireTransferService'

category: 'private'
method: GtRsrWireTransferService
addRoot: anObject
	"Hold on to the supplied object so it is included in the RSR analysis."

	roots add: anObject.
%

category: 'accessing'
method: GtRsrWireTransferService
buffer
	^ buffer
%

category: 'accessing'
method: GtRsrWireTransferService
buffer: anObject
	buffer := anObject
%

category: 'accessing'
method: GtRsrWireTransferService
bufferObject
	"Answer the object.
	nil should never be passed using the wire transfer service, it should use RsrNilObject"
	| decoder |

		buffer class = ByteArray ifFalse:
			[ self error: 'buffer not set' ].
		decoder := GtWireDecoder on: (ReadStream on: buffer).
		^ decoder next
%

category: 'accessing'
method: GtRsrWireTransferService
bufferObject: anObject
	| encoder |

	encoder := self encoder.
	roots := IdentitySet new.
	encoder nextPut: anObject.
	buffer := encoder contents.
	"IdentitySets can't be replicated"
	roots := roots asArray.
%

category: 'accessing'
method: GtRsrWireTransferService
encoder

	^ GtWireEncoder onByteArray
%

! Class implementation for 'GtRsrWireTransferServiceServer'

!		Instance methods for 'GtRsrWireTransferServiceServer'

category: 'accessing'
method: GtRsrWireTransferServiceServer
asGtGsArgument

	^ self object
%

category: 'accessing'
method: GtRsrWireTransferServiceServer
encoder

	^ encoder ifNil: [ super encoder ]
%

category: 'accessing'
method: GtRsrWireTransferServiceServer
encoder: aGtWireEncoder

	encoder := aGtWireEncoder
%

category: 'accessing'
method: GtRsrWireTransferServiceServer
object
	"Answer the object.
	nil should never be passed using the wire transfer service, it should use RsrNilObject"

	^ object ifNil: [ object := self bufferObject ]
%

category: 'accessing'
method: GtRsrWireTransferServiceServer
object: anObject

	object := anObject.
	SessionTemps current at: #GtRsrCurrentWireService put: self.
	self bufferObject: object.
%

! Class implementation for 'GtGemStoneEvaluationContextTest'

!		Instance methods for 'GtGemStoneEvaluationContextTest'

category: 'tests'
method: GtGemStoneEvaluationContextTest
testSourceInfoAtFrameLevel
	| context allFrames info |

	context := (GtGemStoneEvaluationContext new
		evaluateAndWaitBlock: [ AkgDebuggerPlay new initialize evalBlock value ]
		from: GtRsrEvaluatorServiceServer new) object.
	allFrames := context process gtAllFrames.
	
	info := context sourceInfoAtFrameLevel: 10.

	self assert: info first = 48.
	"This is wrong, but let the test pass for now"
	self assert: info second = 61.
	self assert: info third size = 80.
	context process terminate.
%

category: 'tests'
method: GtGemStoneEvaluationContextTest
testVariableInfoAtFrameLevel
	| context variables |

	context := (GtGemStoneEvaluationContext new
		evaluateAndWaitBlock: [ AkgDebuggerPlay new initialize evalBlock value ]
		from: GtRsrEvaluatorServiceServer new) object.
	variables := context variableInfoAtFrameLevel: 10.

	self assert: variables first first = #self.
	self assert: variables first second class = String.
	context process terminate.
%

! Class implementation for 'GtRsrEvaluatorServiceTest'

!		Instance methods for 'GtRsrEvaluatorServiceTest'

category: 'private'
method: GtRsrEvaluatorServiceTest
gsErrorClass

	^ CompileError
%

category: 'private'
method: GtRsrEvaluatorServiceTest
should: testBlock raise: anErrorClass withExceptionDo: exceptionBlock

	testBlock
		on: anErrorClass
		do: [ :ex | 
			exceptionBlock value: ex.
			^ self ].
	self error: anErrorClass printString, ' not raised'.
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testCompilationError
	"Confirm that a compilation error is caught and returned in"
	| script evaluator context |

	evaluator := GtRsrEvaluatorServiceServer new.
	script := 'self error:'. 
	context := (evaluator evaluate: script for: nil bindings: Dictionary new) object.
	self deny: context isCompleted.
	self assert: context isSuspended.
	self assert: context exception class = CompileError.
	self assert: context exception messageText = 'a CompileError occurred (error 1001), expected a primary expression '.
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testInitialState
	"Check that the initial state answers the expected information"
	| process exception state encodedState deserializedState contextSpecification |

	process := [ [ self halt ]
		on: Exception
		do: [ :ex | 
			exception := ex.
			process suspend ] ] fork.
	(Delay forMilliseconds: 100) wait.
	self assert: process _isSuspended.
	self assert: exception notNil.
	state := GtGemStoneDebuggerState
		process: process
		exception: exception.

	self assert: state summary = 'a Halt occurred (error 2709)'.
	self assert: state callStackSpecification size = 15.
	contextSpecification := state callStackSpecification at: 10.
	self assert: contextSpecification coderClassName = #GtRsrEvaluatorServiceTest.
	self assert: contextSpecification selector = #testInitialState.
	self assert: contextSpecification isForBlock.
	self assert: state messageText = 'a Halt occurred (error 2709)'.
	self assert: state isResumable.
	self assert: state isSuspended.
	self deny: state isTerminated.

	encodedState := state asJsonForExport.
	self assert: encodedState isString.
	deserializedState := GtGemStoneDebuggerState fromJsonString: encodedState.
	self assert: deserializedState summary = 'a Halt occurred (error 2709)'.
	self assert: deserializedState callStackSpecification size = 15.
	contextSpecification := deserializedState callStackSpecification at: 10.
	self assert: contextSpecification coderClassName = 'GtRsrEvaluatorServiceTest'.
	self assert: contextSpecification selector = 'testInitialState'.
	self assert: contextSpecification isForBlock.
	self assert: deserializedState messageText = 'a Halt occurred (error 2709)'.
	self assert: deserializedState isResumable.
	self assert: deserializedState isSuspended.
	self deny: deserializedState isTerminated.
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testProxiedObjectScript
	"Test answering a complex object.
	Assumes that Associations are not immediate"
	| script evaluator result dict proxy |

	evaluator := GtRsrEvaluatorServiceServer new.
	script := 
'| resultDict aDict anArray |

aDict := Dictionary new.
aDict at: #a put: 1.
aDict at: #b put: #c -> 2.
anArray := Array new: 3.
anArray at: 1 put: 3.
anArray at: 2 put: aDict.
anArray at: 3 put: #d -> 4.
anArray.'. 
	result := evaluator evaluate: script for: nil bindings: Dictionary new.
	self assert: result class equals: Array.
	self assert: result size equals: 3.
	self assert: (result at: 1) equals: 3.
	dict := result at: 2.
	self assert: (dict at: #a) equals: 1.
	proxy := dict at: #b.
	proxy := result at: 3.
	self assert: proxy class equals: GtRsrProxyServiceServer.
	self assert: proxy object equals: #d -> 4.
	^ result.
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testRuntimeErrorScript
	| script evaluator result object |

	evaluator := GtRsrEvaluatorServiceServer new.
	script := 'self + ''NaN'''.
	"'4 + ''NaN''' raises a MNU which is trapped, resulting in a GtGemStoneEvaluationContext being returned"
	result := evaluator evaluate: script for: 4 bindings: Dictionary new.
	self assert: result class = GtRsrProxyServiceServer.
	object := result object.
	self assert: object class = GtGemStoneEvaluationContext.
	"Pharo raises #adaptToNumber:andSend:, GemStone raises #_generality"
	self assert: (#(#adaptToNumber:andSend: #'_generality') includes: object exception message selector).
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testSelfScript
	| script evaluator result |

	evaluator := GtRsrEvaluatorServiceServer new.
	script := 'self + 3'. 
	result := evaluator evaluate: script for: 4 bindings: Dictionary new.
	self assert: result equals: 7.
%

category: 'tests'
method: GtRsrEvaluatorServiceTest
testSimpleScript
	| script evaluator result |

	evaluator := GtRsrEvaluatorServiceServer new.
	script := '4+3'. 
	result := evaluator evaluate: script for: nil bindings: Dictionary new.
	self assert: result equals: 7.
%

! Class extensions for 'AbstractCollisionBucket'

!		Instance methods for 'AbstractCollisionBucket'

category: '*GToolkit-GemStone-GemStone'
method: AbstractCollisionBucket
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	(GtRsrEvaluatorService isRsrImmediate: self) ifFalse: 
		[ ^ GtRsrProxyServiceServer object: self ].
	^ self
%

! Class extensions for 'AbstractDictionary'

!		Instance methods for 'AbstractDictionary'

category: '*GToolkit-GemStone-GemStone'
method: AbstractDictionary
isDictionary
	^ true
%

! Class extensions for 'Array'

!		Instance methods for 'Array'

category: '*GToolkit-GemStone'
method: Array
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	^ self collect: [ :each | each asGtRsrProxyObjectForConnection: aRsrConnection ]
%

! Class extensions for 'Association'

!		Class methods for 'Association'

category: '*GToolkit-GemStone-GemStone'
classmethod: Association
key: aKey value: aValue

	^ self new key: aKey value: aValue
%

! Class extensions for 'ByteArray'

!		Instance methods for 'ByteArray'

category: '*GToolkit-GemStone-GemStone'
method: ByteArray
base64Encoded
	"Encode the receiver using Base64, returning a String.
	Base64 encoding is a technique to represent binary data as ASCII text.
	The inverse operation is String>>#base64Decoded"

	"(0 to: 255) asByteArray base64Encoded"
	"(Integer primesUpTo: 255) asByteArray base64Encoded"
	"'Hello World!' utf8Encoded base64Encoded"

	^ ZnBase64Encoder new encode: self
%

! Class extensions for 'Character'

!		Class methods for 'Character'

category: '*GToolkit-GemStone-GemStone'
classmethod: Character
null

	^ self value: 0
%

category: '*GToolkit-GemStone-GemStone'
classmethod: Character
value: aCodePointInteger

	^ self withValue: aCodePointInteger
%

!		Instance methods for 'Character'

category: '*GToolkit-GemStone-GemStone'
method: Character
join: aSequenceableCollection
	^ self asString join: aSequenceableCollection
%

! Class extensions for 'CharacterCollection'

!		Instance methods for 'CharacterCollection'

category: '*GToolkit-GemStone-GemStone'
method: CharacterCollection
asGtGsArgument
	"Answer the the local object of the receiver"

	^ self
%

! Class extensions for 'Collection'

!		Instance methods for 'Collection'

category: '*GToolkit-GemStone-GemStone'
method: Collection
anyOne

	self do: [ :each | ^ each ].
	self error: 'Receiver is empty'.
%

category: '*GToolkit-GemStone-GemStone'
method: Collection
detect: aBlock ifFound: foundBlock ifNone: exceptionBlock
	self
		do: [ :each |
			(aBlock value: each)
				ifTrue: [ ^ foundBlock cull: each ] ].
	^ exceptionBlock value
%

category: '*GToolkit-GemStone-GemStone'
method: Collection
isNotEmpty

"Returns true if the receiver is not empty.  Returns false otherwise."

^self size ~~ 0
%

category: '*GToolkit-GemStone-GemStone'
method: Collection
max
	"Answer the maximum value of the receiver"

	^ self inject: self anyOne into: [ :max :each | max max: each ]
%

category: '*GToolkit-GemStone-GemStone'
method: Collection
select: selectBlock thenCollect: collectBlock
	^ (self select: selectBlock) collect: collectBlock
%

category: '*GToolkit-GemStone-GemStone'
method: Collection
sorted: aBlock
	^ self sortWithBlock: aBlock
%

! Class extensions for 'DateAndTime'

!		Class methods for 'DateAndTime'

category: '*GToolkit-GemStone-GemStone'
classmethod: DateAndTime
fromUnixTime: anInteger
	^ self posixSeconds: anInteger offset: Duration new
%

! Class extensions for 'DateAndTimeANSI'

!		Class methods for 'DateAndTimeANSI'

category: '*GToolkit-GemStone-GemStone'
classmethod: DateAndTimeANSI
readFrom: aStream
	"Basic compatibility with Pharo DateAndTime>>readFrom:.	
	Assumes that the DateAndTime is the last thing in the stream."

	^ self fromString: aStream upToEnd
%

! Class extensions for 'Dictionary'

!		Instance methods for 'Dictionary'

category: '*GToolkit-GemStone-GemStone'
method: Dictionary
, aCollection
	^self copy addAll: aCollection; yourself
%

category: '*GToolkit-GemStone-GemStone'
method: Dictionary
asGtGsArgument
	"Answer the the local object of the receiver"
	| local |

	local := self copy.
	local associationsDo: [ :assoc |
		assoc value: assoc value asGtGsArgument ].
	^ local
%

category: '*GToolkit-GemStone-GemStone'
method: Dictionary
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported (non-immediate) objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet.
	If not all keys are immediate, answer the entire dictionary as a proxy."

	| proxyDict |

	(self keys allSatisfy: [ :key | GtRsrEvaluatorService isRsrImmediate: key ]) ifFalse:
		[ ^ GtRsrProxyServiceServer object: self ].
	proxyDict := self class new: self size.
	self keysAndValuesDo: [ :key :value |
		proxyDict
			at: key 
			put: (value asGtRsrProxyObjectForConnection: aRsrConnection) ].
	^ proxyDict
%

category: '*GToolkit-GemStone-GemStone'
method: Dictionary
associations
	^Array new: self size streamContents: [ :stream |
		self associationsDo: [ :each | stream nextPut: each ] ]
%

! Class extensions for 'Duration'

!		Class methods for 'Duration'

category: '*GToolkit-GemStone-GemStone'
classmethod: Duration
nanoSeconds: nanoSeconds
	^ self seconds: nanoSeconds / 1000000000
%

!		Instance methods for 'Duration'

category: '*GToolkit-GemStone-GemStone'
method: Duration
asDelay
	^ Delay forSeconds: seconds
%

category: '*GToolkit-GemStone-GemStone'
method: Duration
wait
	^ self asDelay wait
%

! Class extensions for 'ExecBlock'

!		Instance methods for 'ExecBlock'

category: '*GToolkit-GemStone-GemStone'
method: ExecBlock
gtSourceFor: aView
	<gtView>

	^ aView textEditor
		title: 'Source';
		priority: 10;
		text: [ self _sourceString ].
%

category: '*GToolkit-GemStone-GemStone'
method: ExecBlock
isClean

	^ self _isCopyingBlock not and: [ self _cost = 1 ]
%

category: '*GToolkit-GemStone-GemStone'
method: ExecBlock
timeToRun
	| start end |

	start := Time millisecondClockValue.
	self value.
	end := Time millisecondClockValue.
	^ Duration seconds: (end - start) / 1000
%

! Class extensions for 'GsProcess'

!		Instance methods for 'GsProcess'

category: '*GToolkit-GemStone-GemStone'
method: GsProcess
gtAllFrames

	^ (1 to: self stackDepth) collect: [ :i |
		self _frameContentsAt: i ]
%

! Class extensions for 'GsStackBuffer'

!		Instance methods for 'GsStackBuffer'

category: '*GToolkit-GemStone-GemStone'
method: GsStackBuffer
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	(GtRsrEvaluatorService isRsrImmediate: self) ifFalse: 
		[ ^ GtRsrProxyServiceServer object: self ].
	^ self
%

! Class extensions for 'GtGemstoneEvaluationComputedResult'

!		Instance methods for 'GtGemstoneEvaluationComputedResult'

category: '*GToolkit-GemStone-GemStone'
method: GtGemstoneEvaluationComputedResult
asDictionaryForExport

	^ super asDictionaryForExport
			at: 'computedResult' put: computedResult;
			yourself
%

! Class extensions for 'GtGemstoneEvaluationExceptionResult'

!		Instance methods for 'GtGemstoneEvaluationExceptionResult'

category: '*GToolkit-GemStone-GemStone'
method: GtGemstoneEvaluationExceptionResult
asDictionaryForExport

	^ super asDictionaryForExport
			at: 'evaluationContextProxy' put: (GtRsrProxyServiceServer object: evaluationContext);
			yourself
%

! Class extensions for 'GtGemstoneEvaluationInProgressResult'

!		Instance methods for 'GtGemstoneEvaluationInProgressResult'

category: '*GToolkit-GemStone-GemStone'
method: GtGemstoneEvaluationInProgressResult
asDictionaryForExport

	^ super asDictionaryForExport
			at: 'evaluationContextProxy' put: (GtRsrProxyServiceServer object: evaluationContext);
			yourself
%

! Class extensions for 'GtGemstoneEvaluationResult'

!		Instance methods for 'GtGemstoneEvaluationResult'

category: '*GToolkit-GemStone-GemStone'
method: GtGemstoneEvaluationResult
asDictionaryForExport
	^ Dictionary new 
			at: '__typeName' put: self class name;
			yourself.
%

! Class extensions for 'GtGemStoneSerializationExamples'

!		Instance methods for 'GtGemStoneSerializationExamples'

category: '*GToolkit-GemStone-GemStone'
method: GtGemStoneSerializationExamples
assert: aBoolean description: aString

	aBoolean == true ifFalse:
		[ TestResult failure signal: aString value ]
%

category: '*GToolkit-GemStone-GemStone'
method: GtGemStoneSerializationExamples
assert: actual equals: expected

	self
		assert: actual = expected
		description: actual printString, ' is not equal to ', expected printString.
%

! Class extensions for 'GtRsrLiteralAndProxySerializationStrategy'

!		Instance methods for 'GtRsrLiteralAndProxySerializationStrategy'

category: '*GToolkit-GemStone-GemStone'
method: GtRsrLiteralAndProxySerializationStrategy
serialize: anObject
	"Serialize the object to something that RSR can return.
	In this case we're requiring that the object can be returned as an RSR primitive.  If it can't RSR will raise an exception."
	
	(anObject isNil or: 
		[ anObject isNumber or: 
		[ anObject isKindOf: Boolean ] ]) 
			ifTrue: [ ^ anObject ].
	^ self
		gtDo: [ anObject ]
		gemstoneDo: [ GtRsrProxyServiceServer object: anObject ]
%

! Class extensions for 'GtRsrProxyOnlySerializationStrategy'

!		Instance methods for 'GtRsrProxyOnlySerializationStrategy'

category: '*GToolkit-GemStone-GemStone'
method: GtRsrProxyOnlySerializationStrategy
serialize: anObject
	 ^ GtRsrProxyServiceServer object: anObject
%

! Class extensions for 'GtRsrSerializationStrategy'

!		Class methods for 'GtRsrSerializationStrategy'

category: '*GToolkit-GemStone-GemStone'
classmethod: GtRsrSerializationStrategy
serializationStrategies
	"Answer the session specific dictionary of serialisation strategies"

	^ SessionTemps current
		at: #GtSerializationStrategies
		ifAbsentPut: [ Dictionary new ].
%

category: '*GToolkit-GemStone-GemStone'
classmethod: GtRsrSerializationStrategy
serializationStrategyNamed: aSymbol
	"Answer the session specific strategy, creating it if required"

	^ self serializationStrategies
		at: aSymbol
		ifAbsentPut: [ (GsSession currentSession objectNamed: aSymbol) new ]
%

! Class extensions for 'GtRsrWireTransferService'

!		Instance methods for 'GtRsrWireTransferService'

category: '*GToolkit-GemStone-GemStone'
method: GtRsrWireTransferService
serialize: anObject

	^ GtRsrWireTransferServiceServer new object: anObject
%

! Class extensions for 'GtWireGemStoneRsrEncoder'

!		Instance methods for 'GtWireGemStoneRsrEncoder'

category: '*GToolkit-GemStone-GemStone'
method: GtWireGemStoneRsrEncoder
encode: anObject with: aGtWireEncoderContext
	"It is up to the user to ensure that anObject isn't GCd during transfer and decoding
	(which would allow the oop to be reused and the wrong object returned), or that the
	session is aborted."
	| rsrService |

	rsrService := anObject isGtGemStoneRsrProxy
		ifTrue: [ anObject ]
		ifFalse: [ GtRsrProxyServiceServer object: anObject ].
	"Ensure that the service is at least registered so that it has an _id
	and has a reference in the service.
	Remaining set up will be done during snapshot analysis."

	self connection _ensureRegistered: rsrService.
	self currentWireService addRoot: rsrService.
	aGtWireEncoderContext
		putTypeIdentifier: self class typeIdentifier;
		nextPut: rsrService _id
%

! Class extensions for 'GtWireGemStoneWithRsrEncoder'

!		Instance methods for 'GtWireGemStoneWithRsrEncoder'

category: '*GToolkit-GemStone-GemStone'
method: GtWireGemStoneWithRsrEncoder
encode: anObject with: aGtWireEncoderContext

	self error: self class name asString, '>>encode:with: should not be reached'
%

category: '*GToolkit-GemStone-GemStone'
method: GtWireGemStoneWithRsrEncoder
encode: anObject with: aGtWireEncoderContext objectEncoder: objectEncoder
	| rsrService |

	anObject isGtGemStoneRsrProxy ifTrue: 
		[ self error: 'Proxies should not be encoded with RSR encoder' ].

	"Put the proxy object on the wire first"
	rsrService := GtRsrProxyServiceServer object: anObject.
	"Ensure that the service is at least registered so that it has an _id
	and has a reference in the service.
	Remaining set up will be done during snapshot analysis."
	self connection _ensureRegistered: rsrService.
	self currentWireService addRoot: rsrService.
	aGtWireEncoderContext putTypeIdentifier: self class typeIdentifier.
	"To avoid attempting to create a proxy for the service ID,
	instead of passing back to the GtWireEncoder, call the integer object encoder directly."
	GtWireIntegerEncoder new encode: rsrService _id with: aGtWireEncoderContext.

	"Then put the object itself"
	objectEncoder encode: anObject with: aGtWireEncoderContext.
%

! Class extensions for 'Integer'

!		Instance methods for 'Integer'

category: '*GToolkit-GemStone-GemStone'
method: Integer
isInteger

	^ true
%

! Class extensions for 'MultiByteString'

!		Instance methods for 'MultiByteString'

category: '*GToolkit-GemStone-GemStone'
method: MultiByteString
utf8Encoded
	"Answer a ByteArray of the receiver in UTF8 format"

	^ self encodeAsUTF8 asByteArray
%

! Class extensions for 'Number'

!		Instance methods for 'Number'

category: '*GToolkit-GemStone-GemStone'
method: Number
nanoSeconds
	^ Duration nanoSeconds: self
%

category: '*GToolkit-GemStone-GemStone'
method: Number
seconds
	^ Duration seconds: self
%

! Class extensions for 'Object'

!		Instance methods for 'Object'

category: '*GToolkit-GemStone-GemStone'
method: Object
asGtGsArgument
	"Answer the the local object of the receiver"

	^ self
%

category: '*GToolkit-GemStone-GemStone'
method: Object
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	(GtRsrEvaluatorService isRsrImmediate: self) ifFalse: 
		[ ^ GtRsrProxyServiceServer object: self ].
	^ self
%

category: '*GToolkit-GemStone-GemStone'
method: Object
gtDo: gtoolkitBlock gemstoneDo: gemstoneBlock
	"Evaluate the supplied platform specific block"

	^ gemstoneBlock value
%

category: '*GToolkit-GemStone-GemStone'
method: Object
instVarNamed: instVarName
	| index |

	index := self class allInstVarNames indexOf: instVarName.
	index = 0 ifTrue: [ self error: 'Unknown instance variable: ', instVarName printString ].
	^ self instVarAt: index
%

category: '*GToolkit-GemStone-GemStone'
method: Object
instVarNamed: instVarName put: anObject
	| index |

	index := self class allInstVarNames indexOf: instVarName.
	index = 0 ifTrue: [ self error: 'Unknown instance variable: ', instVarName printString ].
	self instVarAt: index put: anObject
%

category: '*GToolkit-GemStone-GemStone'
method: Object
isDictionary
	^ false
%

category: '*GToolkit-GemStone'
method: Object
isGtGemStoneRsrProxy

	^ false
%

category: '*GToolkit-GemStone-GemStone'
method: Object
isInteger

	^ false
%

category: '*GToolkit-GemStone-GemStone'
method: Object
isNotNil
	^ self ~~ nil
%

! Class extensions for 'OrderedCollection'

!		Instance methods for 'OrderedCollection'

category: '*GToolkit-GemStone-GemStone'
method: OrderedCollection
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver with unsupported objects converted to GtRsrProxyServiceServers.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	^ self collect: [ :each | 
			each asGtRsrProxyObjectForConnection: aRsrConnection ]
   "^ GtRsrProxyServiceServer object: self"
%

! Class extensions for 'Pragma'

!		Instance methods for 'Pragma'

category: '*GToolkit-GemStone-GemStone'
method: Pragma
methodSelector
	"Answer the selector of the method containing the pragma."

	^ method selector.
%

! Class extensions for 'RsrService'

!		Class methods for 'RsrService'

category: '*GToolkit-GemStone'
classmethod: RsrService
gtClientGsServer
	"Answer the receiver's client class on GT and server class on GS"

	^ self
		gtDo: [ self clientClass] 
		gemstoneDo: [ self serverClass ]
%

! Class extensions for 'SequenceableCollection'

!		Instance methods for 'SequenceableCollection'

category: '*GToolkit-GemStone-GemStone'
method: SequenceableCollection
allButFirstDo: block

	2 to: self size do:
		[ :index | block value: (self at: index) ]
%

category: '*GToolkit-GemStone-GemStone'
method: SequenceableCollection
asGtGsArgument
	"Answer the the local object of the receiver"

	^ self collect: [ :each | each asGtGsArgument ]
%

category: '*GToolkit-GemStone-GemStone'
method: SequenceableCollection
flatCollect: aBlock
	"Evaluate aBlock for each of the receiver's elements and answer the
	list of all resulting values flatten one level. Assumes that aBlock returns some kind
	of collection for each element. optimized version for Sequencable Collection and subclasses
	implementing #writeStream"

	"(#( (2 -3) (4 -5) #(-6)) flatCollect: [ :e | e abs  ]) >>> #(2 3 4 5 6)"

	"(#( (2 -3) #((4 -5)) #(-6)) flatCollect: [ :e | e abs  ]) >>> #(2 3 #(4 5) 6)"

	self isEmpty
		ifTrue: [ ^ self copy ].
	^ self class 
		new: 0
		streamContents: [ :stream | self do: [ :each | stream nextPutAll: (aBlock value: each) ] ]
%

! Class extensions for 'Set'

!		Instance methods for 'Set'

category: '*GToolkit-GemStone-GemStone'
method: Set
asGtRsrProxyObjectForConnection: aRsrConnection
	"Answer the receiver as a proxy object.
	To avoid dealing with equality at the moment, always answer as a proxy object.
	Ideally we would look up objects in the connection and use the same proxy, but that isn't happening yet."

	^ GtRsrProxyServiceServer object: self
%

! Class extensions for 'String'

!		Class methods for 'String'

category: '*GToolkit-GemStone-GemStone'
classmethod: String
cr
	^ self with: Character cr
%

!		Instance methods for 'String'

category: '*GToolkit-GemStone-GemStone'
method: String
/ anotherString
	^ self , '/', anotherString
%

category: '*GToolkit-GemStone-GemStone'
method: String
asZnUrl
	^ self
%

category: '*GToolkit-GemStone-GemStone'
method: String
repeat: aNumber
	"Returns a new string concatenated by itself repeated n times"
	"('abc' repeat: 3) >>> 'abcabcabc'"

	aNumber < 0 ifTrue: [ self error: 'aNumber cannot be negative' ].
	^ self species
		new: self size * aNumber
		streamContents: [ :stringStream |
			1 to: aNumber do: [ :idx | stringStream nextPutAll: self ] ]
%

category: '*GToolkit-GemStone-GemStone'
method: String
utf8Encoded
	"Answer a ByteArray of the receiver in UTF8 format"

	^ self encodeAsUTF8 asByteArray
%

! Class extensions for 'Symbol'

!		Instance methods for 'Symbol'

category: '*GToolkit-GemStone-GemStone'
method: Symbol
asMutator
	^ self, ':'
%

category: '*GToolkit-GemStone-GemStone'
method: Symbol
cull: anObject

	^ anObject perform: self
%

category: '*GToolkit-GemStone-GemStone'
method: Symbol
cull: anObject cull: arg2

	^ anObject perform: self
%

category: '*GToolkit-GemStone-GemStone'
method: Symbol
cull: anObject cull: arg2 cull: arg3

	^ anObject perform: self
%

category: '*GToolkit-GemStone-GemStone'
method: Symbol
cull: anObject cull: arg2 cull: arg3 cull: arg4

	^ anObject perform: self
%

category: '*GToolkit-GemStone-GemStone'
method: Symbol
value: anObject

	^ anObject perform: self
%

