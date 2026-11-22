import type { TextDocument } from 'vscode';

export const MAX_TODO_FILE_BYTES = 2 * 1024 * 1024;

export function todoDocumentText(document: TextDocument): string | undefined {
  if (document.lineCount > MAX_TODO_FILE_BYTES + 1) return undefined;
  const last = document.lineAt(document.lineCount - 1);
  if (document.offsetAt(last.range.end) > MAX_TODO_FILE_BYTES) return undefined;
  const text = document.getText();
  return Buffer.byteLength(text) <= MAX_TODO_FILE_BYTES ? text : undefined;
}
