import { QueryExecutor } from './types';

export function commitTransaction(execute: QueryExecutor): string {
  return execute(
    `System commitTransaction
  ifTrue: ['Transaction committed']
  ifFalse: ['Commit failed — possible conflict. Use abort to reset, then retry.']`,
  );
}
