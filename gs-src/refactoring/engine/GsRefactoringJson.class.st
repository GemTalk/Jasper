"
Shared JSON serialization helpers for the refactoring engine.

Every Gs*Refactoring serializer emits its preview/analysis payloads as JSON, and
each used to carry a byte-identical copy of the same three helpers (RB catalog C1).
They now live here, class-side, and each refactoring's `jsonQuote:` / `jsonEscape:` /
`hex2:` delegates to this one implementation -- one place to fix, one place to test.

The escaper emits PURE ASCII (control chars and code points above 126 become
\\uXXXX), so the client's non-blocking GCI fetch is never handed a Unicode-promoted
(wide) result.
"
Class {
	#name : 'GsRefactoringJson',
	#superclass : 'Object',
	#category : 'Refactoring-Core'
}

{ #category : 'json' }
GsRefactoringJson class >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]

{ #category : 'json' }
GsRefactoringJson class >> jsonEscape: aString [
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126
	 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a
	 Unicode-promoted result."
	| ws |
	ws := WriteStream on: String new.
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [ws nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [ws nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [ws nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [ws nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [ws nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [ws nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
		ifFalse: [code > 126
			ifTrue: [code > 65535
				ifTrue: [ws nextPut: $?]
				ifFalse: [ws nextPutAll: '\u';
					nextPutAll: (self hex2: code // 256);
					nextPutAll: (self hex2: code \\ 256)]]
			ifFalse: [ws nextPut: ch]]]]]]]].
	^ws contents
]

{ #category : 'json' }
GsRefactoringJson class >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]
