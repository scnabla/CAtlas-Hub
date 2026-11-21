import * as vscode from 'vscode';

import { devicetreeTokens } from '../devicetree/tokens';

export function devicetreeNodes(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const source = document.getText();
  const roots: vscode.DocumentSymbol[] = [];
  const parents: vscode.DocumentSymbol[] = [];
  const end = document.positionAt(source.length);
  let labels: string[] = [];
  let first = 0;
  let name = '';
  let nameEnd = 0;
  let ignoreValue = false;

  for (const match of devicetreeTokens(source)) {
    const token = match[0];
    const offset = match.index!;
    if (token.startsWith('/*') || token.startsWith('//') || match.groups?.directive !== undefined) continue;

    if (token === ';' || token === '}') {
      if (token === '}') {
        const closed = parents.pop();
        if (closed) closed.range = new vscode.Range(closed.range.start, document.positionAt(offset + 1));
      }
      labels = [];
      name = '';
      ignoreValue = false;
    } else if (ignoreValue) {
      continue;
    } else if (token === '=') {
      ignoreValue = true;
    } else if (token === ':' && name) {
      labels.push(name);
      name = '';
    } else if (token === '{' && name) {
      const title = [...labels.map(label => label + ':'), name].join(' ');
      const start = document.positionAt(first);
      const symbol = new vscode.DocumentSymbol(title, '', vscode.SymbolKind.Namespace,
        new vscode.Range(start, end), new vscode.Range(start, document.positionAt(nameEnd)));
      (parents.at(-1)?.children ?? roots).push(symbol);
      parents.push(symbol);
      labels = [];
      name = '';
    } else if (/^(?:\/$|&|[\w,.+?#@-])/.test(token)) {
      if (labels.length === 0) first = offset;
      name = token;
      nameEnd = offset + token.length;
    }
  }
  return roots;
}
