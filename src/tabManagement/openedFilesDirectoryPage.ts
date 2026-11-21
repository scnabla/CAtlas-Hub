import * as vscode from 'vscode';
import { bindFileListPage, FileListRow, openFileListTab } from './fileListPage';
import { getUriDisplayPath } from '../shared/uri';
import { externalTabUri } from './externalFileList';
import { OpenedFileTreeNode } from './openedFilesTreeModel';
import { OpenedFilesTreeProvider } from './openedFilesTreeProvider';

export const directoryPageId = 'projectManager.openedFilesDirectory';
const pageTitle = '已打开文件';
const directoryUri = vscode.Uri.from({ scheme: 'catlas-opened-files', path: '/' + pageTitle });

const isDirectoryTab = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === directoryPageId;

export class OpenedFilesDirectoryPage implements vscode.CustomReadonlyEditorProvider, vscode.WebviewPanelSerializer {
  private previousGroup: vscode.TabGroup | undefined;

  constructor(private readonly provider: OpenedFilesTreeProvider, private readonly enabled: () => boolean) {}

  async reconcile(): Promise<void> {
    const groups = vscode.window.tabGroups.all;
    const existing = groups.flatMap(group => group.tabs).filter(isDirectoryTab);
    const candidates = groups.filter(group => !group.tabs.some(externalTabUri) && group.tabs.some(tab =>
      tab.input instanceof vscode.TabInputText && vscode.workspace.getWorkspaceFolder(tab.input.uri)));
    if (!this.enabled() || !candidates.length) {
      if (existing.length) await vscode.window.tabGroups.close(existing, true);
      return;
    }
    const tab = existing[0];
    const group = tab && !tab.group.tabs.some(externalTabUri) ? tab.group
      : this.previousGroup && candidates.includes(this.previousGroup) ? this.previousGroup : candidates[0]!;
    this.previousGroup = group;
    if (!tab || tab.group !== group || !tab.isPinned || group.tabs[0] !== tab) {
      await openFileListTab(directoryUri, directoryPageId, group.viewColumn, true);
    }
    const duplicates = existing.filter(item => item.group !== group);
    if (duplicates.length) await vscode.window.tabGroups.close(duplicates, true);
  }

  async show(): Promise<void> {
    if (!this.enabled()) return;
    const groups = vscode.window.tabGroups;
    const group = groups.all.find(item => item.tabs.some(isDirectoryTab))
      ?? (groups.activeTabGroup.tabs.some(externalTabUri) ? groups.all.find(item => !item.tabs.some(externalTabUri)) : groups.activeTabGroup);
    if (group) await openFileListTab(directoryUri, directoryPageId, group.viewColumn, false);
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
    // 升级时把旧的网页标签换成按 URI 恢复的只读编辑器。
    const active = panel.active;
    panel.dispose();
    if (active) await this.show();
    else await this.reconcile();
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    if (uri.toString() !== directoryUri.toString()) throw vscode.FileSystemError.FileNotFound(uri);
    return { uri, dispose() { /* 清单由当前工作区标签生成。 */ } };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const items = new Map<string, OpenedFileTreeNode>();
    const row = (node: OpenedFileTreeNode): FileListRow => {
      if (node.kind === 'file') {
        items.set(node.id, node);
        return { key: node.id, label: node.label, title: node.uri ? getUriDisplayPath(vscode.Uri.parse(node.uri)) : node.label };
      }
      return {
        key: node.id, label: node.label,
        children: node.children.map(row),
      };
    };
    bindFileListPage(panel, directoryUri, '文件名', () => {
      items.clear();
      return this.provider.getChildren().map(row);
    }, this.provider.onDidChangeTreeData, async key => {
      const node = items.get(key);
      if (node) await this.provider.focusFile(node);
    });
  }

}
