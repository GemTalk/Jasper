| p |
p := '/tmp/issue360-worktree/resources/refactoring/engine-tests.gs'.
[GsFileIn fromServerPath: p] on: Error do: [:e | GsFileIn fromPath: p on: #serverUtf8File to: nil].
'filed in'
%%
| t |
t := GsInstVarRefactoringTest new.
t setTestSelector: #testApplyStopsAtTheFirstFailure.
[t setUp. t testApplyStopsAtTheFirstFailure. 'PASSED']
  on: Error do: [:e | 'ERROR: ', e class name asString, ' -- ', e messageText]
%%
System abortTransaction. 'ok'
