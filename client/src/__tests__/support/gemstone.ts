import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

export function sizeInBytesOfServerFile(execute: QueryExecutor, filePath: string): number {
  return Number(
    execute(
      `(GsFile sizeOfOnServer: '${escapeString(filePath)}')
         ifNil: [ self error: 'Failed to check the size of a file on the server' ]
         ifNotNil: [ :exists | exists printString ]`,
    ),
  );
}
