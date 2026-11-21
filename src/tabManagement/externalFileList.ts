import * as vscode from 'vscode';
import { getUriComparisonKey, getUriDisplayPath } from '../shared/uri';

import { bindFileListPage, fileListGesture } from './fileListPage';

export const externalEditorId = 'projectManager.externalFileList';
export const externalTabUri = (tab: vscode.Tab | undefined) => tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === externalEditorId
  ? tab.input.uri : undefined;
export const markerUri = vscode.Uri.from({ scheme: 'catlas-external-files', path: '/↗ 外部文件' });
const orderSetting = 'catlas.externalFiles.openOrder';

function directoryKey(uri: vscode.Uri): string {
  return getUriComparisonKey(vscode.Uri.joinPath(uri, '..').with({ query: '', fragment: '' }));
}

function pathLine(uri: vscode.Uri): string {
  // Linux 文件名可以含换行；只转义显示文字，链接始终使用原 URI。
  return getUriDisplayPath(uri).replace(/\r/g, '␍').replace(/\n/g, '␊');
}

function clickHint(): string {
  return fileListGesture(markerUri, '路径').hint;
}

export class ExternalFileList implements vscode.CustomReadonlyEditorProvider, vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider, vscode.Disposable {
  private readonly hintStyle = vscode.window.createTextEditorDecorationType({ fontWeight: 'bold' });
  private readonly editorEvents: vscode.Disposable;
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly directories = new Map<string, Map<string, vscode.Uri>>();
  private files: vscode.Uri[] = [];
  private text = clickHint();
  private savedOrder: string[];

  constructor(private readonly state: vscode.Memento) {
    this.editorEvents = vscode.Disposable.from(
      vscode.window.onDidChangeVisibleTextEditors(editors => this.styleHint(editors)),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.contentChanges.length && event.document.uri.scheme === markerUri.scheme) {
          this.styleHint(vscode.window.visibleTextEditors);
        }
      }),
    );
    this.styleHint(vscode.window.visibleTextEditors);
    this.savedOrder = state.get<string[]>(orderSetting, []);
    for (const serialized of this.savedOrder) this.open(vscode.Uri.parse(serialized));
  }

  private styleHint(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      if (editor.document.uri.scheme === markerUri.scheme) {
        editor.setDecorations(this.hintStyle, [editor.document.lineAt(0).range]);
      }
    }
  }

  open(uri: vscode.Uri): void {
    const parent = directoryKey(uri);
    const members = this.directories.get(parent) ?? new Map<string, vscode.Uri>();
    members.set(getUriComparisonKey(uri), uri);
    this.directories.set(parent, members);
  }

  close(uri: vscode.Uri): void {
    const parent = directoryKey(uri);
    const members = this.directories.get(parent);
    if (members?.delete(getUriComparisonKey(uri)) && !members.size) this.directories.delete(parent);
  }

  async refresh(open: readonly vscode.Uri[], visible: readonly vscode.Uri[]): Promise<void> {
    const live = new Set(open.map(getUriComparisonKey));
    for (const members of this.directories.values()) {
      for (const [key, uri] of members) if (!live.has(key)) this.close(uri);
    }
    for (const uri of open) this.open(uri);
    const shown = new Set(visible.map(getUriComparisonKey));
    this.files = [];
    for (const members of this.directories.values()) {
      for (const [key, uri] of members) if (shown.has(key)) this.files.push(uri);
    }
    const text = [clickHint(), ...this.files.map(pathLine)].join('\n');
    if (this.text !== text) {
      this.text = text;
      this.changed.fire(markerUri);
    }
    const order = this.files.map(uri => uri.toString());
    if (order.length !== this.savedOrder.length || order.some((uri, i) => uri !== this.savedOrder[i])) {
      await this.state.update(orderSetting, order.length ? order : undefined);
      this.savedOrder = order;
    }
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    if (uri.toString() !== markerUri.toString()) throw vscode.FileSystemError.FileNotFound(uri);
    return { uri, dispose() { /* 清单数据由标签组维护。 */ } };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    bindFileListPage(panel, markerUri, '路径',
      () => this.files.map(uri => {
        const fullPath = pathLine(uri);
        const parentPath = uri.path.slice(0, uri.path.lastIndexOf('/') + 1);
        const pathPrefix = pathLine(uri.with({ path: parentPath, query: '', fragment: '' }));
        return { key: uri.toString(), label: fullPath.slice(pathPrefix.length), pathPrefix };
      }),
      this.onDidChange, async key => {
        const group = vscode.window.tabGroups.all.find(item => item.viewColumn === panel.viewColumn);
        const tab = group?.tabs.find(item => item.input instanceof vscode.TabInputText && item.input.uri.toString() === key);
        if (group && tab?.input instanceof vscode.TabInputText && this.files.some(file => file.toString() === key)) {
          await vscode.window.showTextDocument(tab.input.uri, { viewColumn: group.viewColumn, preview: tab.isPreview });
        }
      });
  }

  provideTextDocumentContent(): string {
    return this.text;
  }

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    for (const [index, uri] of this.files.entries()) {
      if (index + 1 >= document.lineCount) break;
      const line = document.lineAt(index + 1);
      if (line.text === pathLine(uri)) links.push(new vscode.DocumentLink(line.range, uri));
    }
    return links;
  }

  dispose(): void {
    this.editorEvents.dispose();
    this.hintStyle.dispose();
    this.changed.dispose();
  }
}
