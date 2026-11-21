import * as vscode from 'vscode';
import { bindFileListPage, FileListRow } from './fileListPage';
import { getUriDisplayPath } from '../shared/uri';
import { externalTabUri } from './externalFileList';
import { OpenedFileTreeNode } from './openedFilesTreeModel';
import { OpenedFilesTreeProvider } from './openedFilesTreeProvider';

export const directoryPageId = 'projectManager.openedFilesDirectory';
const pageTitle = '已打开文件';
const directoryUri = vscode.Uri.from({ scheme: 'catlas-opened-files', path: '/' + pageTitle });

export class OpenedFilesDirectoryPage implements vscode.WebviewPanelSerializer, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly provider: OpenedFilesTreeProvider) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn);
      return;
    }
    const groups = vscode.window.tabGroups;
    const primary = groups.all.find(group => !group.tabs.some(tab => externalTabUri(tab)));
    const column = groups.activeTabGroup.tabs.some(tab => externalTabUri(tab)) ? primary?.viewColumn : groups.activeTabGroup.viewColumn;
    this.attach(vscode.window.createWebviewPanel(directoryPageId, pageTitle, column ?? vscode.ViewColumn.Active,
      { enableFindWidget: true, localResourceRoots: [] }));
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel && this.panel !== panel) panel.dispose();
    else this.attach(panel);
  }

  private attach(panel: vscode.WebviewPanel): void {
    panel.title = pageTitle;
    this.panel = panel;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let positioning = false;
    const activeDirectoryTab = () => {
      const group = vscode.window.tabGroups.activeTabGroup;
      const tab = group.activeTab;
      if (this.panel !== panel || !(tab?.input instanceof vscode.TabInputWebview)) return;
      const type = tab.input.viewType;
      if (type === directoryPageId || type === `mainThreadWebview-${directoryPageId}`) return tab;
    };
    const pinFirst = async () => {
      const tab = activeDirectoryTab();
      if (!tab || positioning || (tab.isPinned && tab.group.tabs[0] === tab)) return;
      positioning = true;
      try {
        if (!tab.isPinned) await vscode.commands.executeCommand('workbench.action.pinEditor');
        const current = activeDirectoryTab();
        if (current?.isPinned && current.group.tabs[0] !== current) {
          await vscode.commands.executeCommand('moveActiveEditor', { by: 'tab', to: 'first' });
        }
      } finally {
        positioning = false;
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void pinFirst(); }, 30);
    };
    const layout = vscode.Disposable.from(
      panel.onDidChangeViewState(schedule),
      vscode.window.tabGroups.onDidChangeTabs(schedule),
      vscode.window.tabGroups.onDidChangeTabGroups(schedule),
    );
    schedule();
    panel.onDidDispose(() => {
      clearTimeout(timer);
      layout.dispose();
      if (this.panel === panel) this.panel = undefined;
    });
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

  dispose(): void {
    this.panel?.dispose();
  }
}
