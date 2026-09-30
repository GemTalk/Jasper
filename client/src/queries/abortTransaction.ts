import { QueryExecutor } from './types';

export async function abortTransaction(execute: QueryExecutor): Promise<string> {
  return await execute(`System abortTransaction. 'Transaction aborted'`);
}
