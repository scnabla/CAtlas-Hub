import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { analyzeShell, ShellAnalysis } from './shellAnalysis';

const cache = new WeakMap<vscode.TextDocument, { version: number; result: Promise<ShellAnalysis> }>();

export function supportsShell(document: vscode.TextDocument): boolean {
  if (document.languageId !== 'shellscript') return false;
  const first = document.lineAt(0).text;
  if (first.startsWith('#!')) {
    const interpreter = first.slice(2).trim().split(/\s+/);
    const exe = path.posix.basename(interpreter.shift() ?? '');
    const shell = exe === 'env' ? interpreter.find(arg => !arg.startsWith('-') && !arg.includes('=')) : exe;
    return /^(?:ba|da|a)?sh$/.test(path.posix.basename(shell ?? ''));
  }
  const filename = path.basename(document.fileName);
  return document.isUntitled || /(?:\.sh|\.bash|\.bashrc|\.bash_profile|\.bash_login|\.bash_logout|\.bash_aliases|\.profile)$/i.test(filename);
}

// 大脚本串行交给工作线程，跳过排队期间已关闭或已修改的文档。
let previousLargeDocument = Promise.resolve();
function analyzeLargeDocument(document: vscode.TextDocument, version: number): Promise<ShellAnalysis> {
  const result = previousLargeDocument.then(() => {
    if (document.isClosed || document.version !== version) return { functions: [], functionTokens: [], links: [] };
    return new Promise<ShellAnalysis>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'shellWorker.js'), { workerData: document.getText() });
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => {
        if (code !== 0) reject(new Error(`Shell 解析线程退出，状态码 ${code}`));
      });
    });
  });
  previousLargeDocument = result.then(() => {}, () => {});
  return result;
}

function analysis(document: vscode.TextDocument): Promise<ShellAnalysis> {
  const cached = cache.get(document);
  if (cached?.version === document.version) return cached.result;
  const end = document.lineAt(document.lineCount - 1).range.end;
  const result = document.offsetAt(end) > 64 * 1024
    ? analyzeLargeDocument(document, document.version)
    : analyzeShell(document.getText());
  cache.set(document, { version: document.version, result });
  return result;
}

export async function shellSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
  return (await analysis(document)).functions.map(fn => new vscode.DocumentSymbol(fn.name, '',
    vscode.SymbolKind.Function, new vscode.Range(document.positionAt(fn.start), document.positionAt(fn.end)),
    new vscode.Range(document.positionAt(fn.selection.start), document.positionAt(fn.selection.end))));
}

export function registerShellNavigation(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(document => cache.delete(document)),
    vscode.languages.registerDefinitionProvider('shellscript', {
      async provideDefinition(document, position, token) {
        if (!supportsShell(document)) return;
        const version = document.version;
        const offset = document.offsetAt(position);
        const { links } = await analysis(document);
        if (token.isCancellationRequested || version !== document.version) return;
        const link = links.find(item => item.start <= offset && offset < item.end);
        if (!link) return;
        const range = new vscode.Range(document.positionAt(link.target.start), document.positionAt(link.target.end));
        return [{ originSelectionRange: new vscode.Range(document.positionAt(link.start), document.positionAt(link.end)),
          targetUri: document.uri, targetRange: range, targetSelectionRange: range }];
      },
    }),
    vscode.languages.registerDocumentSemanticTokensProvider('shellscript', {
      async provideDocumentSemanticTokens(document, token) {
        if (!supportsShell(document)) return;
        const version = document.version;
        const { functionTokens } = await analysis(document);
        if (token.isCancellationRequested || version !== document.version) return;
        const builder = new vscode.SemanticTokensBuilder();
        for (const item of functionTokens) {
          const start = document.positionAt(item.start);
          builder.push(start.line, start.character, item.end - item.start, 0, 0);
        }
        return builder.build();
      },
    }, new vscode.SemanticTokensLegend(['function'])),
  );
}
