import * as vscode from 'vscode';
import { checkDevicetreeSyntax } from './syntax';

export function registerDevicetreeDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('catlas-devicetree');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancel(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
  }

  function check(document: vscode.TextDocument) {
    if (document.languageId !== 'dts' || document.isClosed) return;
    const diagnostics = checkDevicetreeSyntax(document.getText()).map(issue => {
      const range = new vscode.Range(document.positionAt(issue.offset), document.positionAt(issue.offset + issue.length));
      const diagnostic = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'CAtlas Hub';
      return diagnostic;
    });
    collection.set(document.uri, diagnostics);
  }

  context.subscriptions.push(collection,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      if (document.languageId !== 'dts' || !contentChanges.length) return;
      cancel(document);
      const key = document.uri.toString();
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        check(document);
      }, 250));
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      cancel(document);
      collection.delete(document.uri);
    }),
    new vscode.Disposable(() => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    }),
  );
  vscode.workspace.textDocuments.forEach(check);
}
