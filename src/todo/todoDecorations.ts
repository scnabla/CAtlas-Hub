import * as vscode from 'vscode';
import { todoDocumentText } from './todoDocumentText';
import { parseTodoText } from './todoParser';
import { createTodoParseOptions, getTodoSettings } from './todoSettings';
import { TodoSeverity } from './todoTypes';

const COLORS: Readonly<Record<TodoSeverity, string>> = {
  info: 'descriptionForeground',
  normal: 'editorInfo.foreground',
  attention: 'editorWarning.foreground',
  important: 'editorError.foreground',
};

export class TodoDecorations implements vscode.Disposable {
  private readonly types = new Map<TodoSeverity, vscode.TextEditorDecorationType>();

  public constructor() {
    for (const [severity, color] of Object.entries(COLORS) as Array<[TodoSeverity, string]>) {
      this.types.set(severity, vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor(color),
        fontWeight: 'bold',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }));
    }
  }

  public updateVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) this.updateEditor(editor);
  }

  private readonly pending = new Map<vscode.TextDocument, NodeJS.Timeout>();

  public updateDocument(document: vscode.TextDocument): void {
    if (!vscode.window.visibleTextEditors.some((editor) => editor.document === document)) return;
    clearTimeout(this.pending.get(document));
    this.pending.set(document, setTimeout(() => {
      this.pending.delete(document);
      this.updateVisibleDocument(document);
    }, 140));
  }

  private updateVisibleDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) this.updateEditor(editor);
    }
  }

  public dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const type of this.types.values()) type.dispose();
    this.types.clear();
  }

  private updateEditor(editor: vscode.TextEditor): void {
    const settings = getTodoSettings();
    const options = createTodoParseOptions(editor.document.languageId, settings);
    const ranges = new Map<TodoSeverity, vscode.Range[]>();
    for (const severity of Object.keys(COLORS) as TodoSeverity[]) ranges.set(severity, []);
    if (settings.enabled && settings.highlight && options !== undefined) {
      for (const match of parseTodoText(todoDocumentText(editor.document) ?? '', options)) {
        const severity = settings.tags.find((tag) => tag.name === match.tag)?.severity ?? 'normal';
        ranges.get(severity)?.push(new vscode.Range(
          match.line, match.startCharacter,
          match.line, match.endCharacter,
        ));
      }
    }
    for (const [severity, type] of this.types) editor.setDecorations(type, ranges.get(severity) ?? []);
  }
}
