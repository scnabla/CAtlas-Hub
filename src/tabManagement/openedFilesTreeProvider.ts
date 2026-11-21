import { onDidChangePersonalConfiguration } from '../configuration/personalConfiguration';
/**
 * 把 VS Code 当前标签转换为文件描述，再交给 openedFilesTreeModel 生成目录结构。
 * 跳转需保留真实 URI 和编辑器组信息；目录压缩只是显示处理，不能据显示路径重新猜测文件地址。
 * 此视图不负责移动标签；调整展示不应触发编辑器分栏。
 */
import * as vscode from 'vscode';
import {
  buildOpenedFilesTree,
  flattenOpenedFileTree,
  OpenedFileDescriptor,
  OpenedFileTreeNode,
} from './openedFilesTreeModel';
import { createTreeIcon, createTreeIconPath, getConfiguredIconStyle, isHighContrastTheme } from '../visual/treeIconResources';
import { getUriComparisonKey, getWorkspaceRelativePath } from '../shared/uri';

export class OpenedFilesTreeProvider implements vscode.TreeDataProvider<OpenedFileTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<OpenedFileTreeNode | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private roots: readonly OpenedFileTreeNode[] = [];
  private readonly parents = new Map<string, OpenedFileTreeNode>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly extensionUri?: vscode.Uri,
  ) {
    this.rebuild();
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveColorTheme(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      onDidChangePersonalConfiguration((event) => {
        if (event.affectsConfiguration('projectManager.visuals.iconStyle')) this.refresh();
      }),
    );
  }

  public getTreeItem(node: OpenedFileTreeNode): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.uri !== undefined) item.resourceUri = vscode.Uri.parse(node.uri);
      if (this.extensionUri !== undefined && getConfiguredIconStyle() === 'unified' && !isHighContrastTheme()) {
        item.iconPath = createTreeIconPath(this.extensionUri, 'file');
      }
      const description = node.preview ? '预览' : node.active ? '当前' : undefined;
      if (description !== undefined) item.description = description;
      item.contextValue = 'projectManager.openedFiles.file';
      item.command = {
        command: 'projectManager.focusOpenedFile',
        title: '聚焦已打开文件',
        arguments: [node],
      };
      return item;
    }

    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.iconPath = node.kind === 'workspace'
      ? createTreeIcon(this.extensionUri, 'workspace', 'root-folder')
      : new vscode.ThemeIcon(node.kind === 'group' ? 'layout' : 'folder');
    return item;
  }

  public getChildren(node?: OpenedFileTreeNode): OpenedFileTreeNode[] {
    if (node === undefined) return [...this.roots];
    return [...node.children];
  }

  public getParent(node: OpenedFileTreeNode): OpenedFileTreeNode | undefined {
    return this.parents.get(node.id);
  }

  public refresh(): void {
    this.rebuild();
    this.changeEmitter.fire(undefined);
  }

  public async focusFile(node: OpenedFileTreeNode): Promise<void> {
    if (node.kind !== 'file' || node.uri === undefined || node.groupId === undefined) return;
    const group = vscode.window.tabGroups.all.find((candidate) => String(candidate.viewColumn) === node.groupId);
    const tab = group?.tabs.find((candidate) => getTextUri(candidate)?.toString() === node.uri);
    if (group === undefined || tab === undefined) {
      this.refresh();
      await vscode.window.showInformationMessage('该文件已经关闭，目录树已刷新。');
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.parse(node.uri), {
      viewColumn: group.viewColumn,
      preserveFocus: false,
      preview: tab.isPreview,
    });
  }

  public getRootsForIntegrationTest(): readonly OpenedFileTreeNode[] {
    return this.roots;
  }

  public dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
    this.changeEmitter.dispose();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 60);
  }

  private rebuild(): void {
    const groups = vscode.window.tabGroups.all;
    const descriptors: OpenedFileDescriptor[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      for (const tab of group.tabs) {
        const uri = getTextUri(tab);
        if (uri === undefined) continue;
        const workspace = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspace) continue;
        const relativePath = getWorkspaceRelativePath(workspace, uri);
        if (relativePath === undefined) continue;
        descriptors.push({
          id: `${group.viewColumn}:${uri.toString()}`,
          comparisonKey: getUriComparisonKey(uri),
          label: tab.label,
          uri: uri.toString(),
          groupId: String(group.viewColumn),
          groupLabel: `编辑器组 ${groupIndex + 1}`,
          workspaceId: workspace.uri.toString(),
          workspaceLabel: workspace.name,
          pathSegments: relativePath.split('/'),
          active: tab.isActive,
          preview: tab.isPreview,
        });
      }
    }
    this.roots = buildOpenedFilesTree(descriptors);
    this.parents.clear();
    for (const root of this.roots) this.indexParents(root);
    const uniqueCount = flattenOpenedFileTree(this.roots).filter((node) => node.kind === 'file').length;
    this.output.appendLine(`已打开文件已刷新：${uniqueCount} 个文件，来源于 ${descriptors.length} 个普通文件标签。`);
  }

  private indexParents(parent: OpenedFileTreeNode): void {
    for (const child of parent.children) {
      this.parents.set(child.id, parent);
      this.indexParents(child);
    }
  }
}

function getTextUri(tab: vscode.Tab): vscode.Uri | undefined {
  if (!(tab.input instanceof vscode.TabInputText) || tab.input.uri.scheme === 'catlas-external-files') return undefined;
  return tab.input.uri;
}
