// What the conflict doit in queries/transactionConflicts.ts answers for a
// write-write refusal on two objects — shared so the R/K/O record format is
// spelled once, however many suites feed it to a stubbed executor.
export const WRITE_WRITE_ANSWER =
  [
    'R\tfailure',
    'K\tWrite-Write\t2',
    "O\t12086785\tSymbolDictionary\taSymbolDictionary( name: #'UserGlobals' )",
    'O\t12200449\tAccount\tan Account',
  ].join('\n') + '\n';
