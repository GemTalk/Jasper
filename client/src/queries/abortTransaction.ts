import { QueryExecutor } from './types';

export function abortTransaction(execute: QueryExecutor): string {
  return execute(`System abortTransaction. 'Transaction aborted'`);
}
