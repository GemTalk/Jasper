import { readWebviewScript } from '../webviewAssets';

// Reads a webview script owned by the refactoring panels in this directory.
export const readRefactoringWebviewScript = (fileName: string): string =>
  readWebviewScript(fileName, 'refactoring');
