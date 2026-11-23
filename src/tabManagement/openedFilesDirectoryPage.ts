import * as vscode from 'vscode';
import { bindFileListPage, fileListRow, openFileListTab } from './fileListPage';
import { isExternalFileListTab } from './externalFileList';
import { OpenedFileTreeNode } from './openedFilesTreeModel';
import { OpenedFilesTreeProvider } from './openedFilesTreeProvider';

export const directoryPageId = 'projectManager.openedFilesDirectory';
const pageTitle = '已打开文件';
const directoryUri = vscode.Uri.from({ scheme: 'catlas-opened-files', path: '/' + pageTitle });

const isDirectoryTab = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === directoryPageId;

export class OpenedFilesDirectoryPage implements vscode.CustomReadonlyEditorProvider, vscode.WebviewPanelSerializer {
  private previousGroup: vscode.TabGroup | undefined;

  constructor(private readonly provider: OpenedFilesTreeProvider, private readonly enabled: () => boolean) {}

  get missing(): boolean {
    return this.enabled() && !vscode.window.tabGroups.all.some(group => group.tabs.some(isDirectoryTab));
  }

  async reconcile(): Promise<void> {
    const groups = vscode.window.tabGroups.all;
    const existing = groups.flatMap(group => group.tabs).filter(isDirectoryTab);
    const ordinaryGroups = groups.filter(group => !group.tabs.some(isExternalFileListTab));
    const workspaceGroups = ordinaryGroups.filter(group => group.tabs.some(tab =>
      tab.input instanceof vscode.TabInputText && vscode.workspace.getWorkspaceFolder(tab.input.uri)));
    const hasExternalSplit = ordinaryGroups.length < groups.length && !!vscode.workspace.workspaceFolders?.length;
    const candidates = hasExternalSplit && !workspaceGroups.length ? ordinaryGroups : workspaceGroups;
    if (!this.enabled() || !candidates.length) {
      if (existing.length) await vscode.window.tabGroups.close(existing, true);
      return;
    }
    const tab = existing.find(item => ordinaryGroups.includes(item.group));
    const group = tab?.group ?? candidates.find(item => item === this.previousGroup) ?? candidates[0]!;
    this.previousGroup = group;
    if (!tab || !tab.isPinned || group.tabs[0] !== tab) {
      await openFileListTab(directoryUri, directoryPageId, group.viewColumn, true);
    }
    const duplicates = existing.filter(item => item.group !== group);
    if (duplicates.length) await vscode.window.tabGroups.close(duplicates, true);
  }

  async show(): Promise<void> {
    if (!this.enabled()) return;
    const groups = vscode.window.tabGroups;
    const group = groups.all.find(item => item.tabs.some(isDirectoryTab))
      ?? (groups.activeTabGroup.tabs.some(isExternalFileListTab) ? groups.all.find(item => !item.tabs.some(isExternalFileListTab)) : groups.activeTabGroup);
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
    bindFileListPage(panel, directoryUri, '当前工作区没有已打开的文件', () => {
      items.clear();
      return this.provider.getChildren().map(root => fileListRow(root, file => items.set(file.id, file)));
    }, this.provider.onDidChangeTreeData, async key => {
      const node = items.get(key);
      if (node) await this.provider.focusFile(node);
    });
  }

}
