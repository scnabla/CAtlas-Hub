import { onDidChangePersonalConfiguration } from '../configuration/personalConfiguration';
import * as vscode from 'vscode';
import { ProjectCatalogServiceV2, ResolvedCatalogProject } from './catalogServiceV2';
import { IconSemantic } from '../visual/iconSemantics';
import { createTreeIcon } from '../visual/treeIconResources';

interface CatalogSummaryNode { readonly kind: 'summary' }
interface CatalogContextNode { readonly kind: 'context' }

export type ProjectCatalogTreeNodeV2 = ResolvedCatalogProject | CatalogSummaryNode | CatalogContextNode;

export class ProjectCatalogTreeProviderV2 implements vscode.TreeDataProvider<ProjectCatalogTreeNodeV2>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ProjectCatalogTreeNodeV2 | undefined>();
  private readonly subscriptions: vscode.Disposable[];
  private readonly summaryNode: CatalogSummaryNode = { kind: 'summary' };
  private readonly contextNode: CatalogContextNode = { kind: 'context' };
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly service: ProjectCatalogServiceV2,
    private readonly extensionUri?: vscode.Uri,
  ) {
    this.subscriptions = [
      service.onDidChange(() => this.changeEmitter.fire(undefined)),
      vscode.window.onDidChangeActiveColorTheme(() => this.changeEmitter.fire(undefined)),
      onDidChangePersonalConfiguration((event) => {
        if (event.affectsConfiguration('projectManager.visuals.iconStyle')) {
          this.changeEmitter.fire(undefined);
        }
      }),
    ];
  }

  public getChildren(node?: ProjectCatalogTreeNodeV2): ProjectCatalogTreeNodeV2[] {
    const catalog = this.service.current;
    if (!catalog) return [];
    if (!node) return [this.summaryNode];
    return 'kind' in node && node.kind === 'summary' ? [this.contextNode, ...catalog.projects] : [];
  }

  public getParent(node: ProjectCatalogTreeNodeV2): ProjectCatalogTreeNodeV2 | undefined {
    return !this.service.current || ('kind' in node && node.kind === 'summary') ? undefined : this.summaryNode;
  }

  public getTreeItem(node: ProjectCatalogTreeNodeV2): vscode.TreeItem {
    if ('kind' in node) {
      if (node.kind === 'summary') {
        const catalog = this.service.current;
        const item = new vscode.TreeItem(catalog?.name ?? '项目集合', vscode.TreeItemCollapsibleState.Expanded);
        item.description = catalog === undefined ? '' : `${catalog.projects.length} 个项目`;
        item.iconPath = this.iconPath('catalog', 'library');
        item.contextValue = 'projectCatalog.summary';
        item.id = `catalog:${catalog?.id}`;
        item.tooltip = catalog?.name ?? '项目集合';
        return item;
      }
      const item = this.createContextItem();
      item.id = `catalog-context:${this.service.current?.id}`;
      return item;
    }
    const item = new vscode.TreeItem(node.alias, vscode.TreeItemCollapsibleState.None);
    item.id = `project:${node.catalogId}:${node.id}`;
    item.description = node.description ?? node.path;
    item.iconPath = node.available
      ? node.type === 'workspace'
        ? this.iconPath('workspace', 'window')
        : this.iconPath('project', 'root-folder')
      : node.type === 'workspace'
        ? this.iconPath('project.unavailable.workspace', 'warning')
        : this.iconPath('project.unavailable.folder', 'warning');
    item.contextValue = node.available ? 'projectCatalog.availableProject' : 'projectCatalog.invalidProject';
    item.command = { command: 'projectManager.openProject', title: '打开项目', arguments: [node] };
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${escapeMarkdown(node.alias)}**\n\n`);
    tooltip.appendMarkdown(`位置：\`${escapeMarkdown(node.path)}\`\n\n`);
    tooltip.appendMarkdown(`类型：${node.type === 'workspace' ? 'VS Code 工作区' : '文件夹'}\n\n`);
    if (node.description !== undefined) tooltip.appendMarkdown(`说明：${escapeMarkdown(node.description)}\n\n`);
    if (node.tags.length > 0) tooltip.appendMarkdown(`标签：${node.tags.map((tag) => `\`${escapeMarkdown(tag)}\``).join(' ')}\n\n`);
    if (node.runtimeIssue !== undefined) tooltip.appendMarkdown(`$(warning) ${escapeMarkdown(node.runtimeIssue)}`);
    item.tooltip = tooltip;
    return item;
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.changeEmitter.dispose();
  }

  private createContextItem(): vscode.TreeItem {
    const context = this.service.projectContext;
    if (context.kind === 'member') {
      const item = new vscode.TreeItem(`当前项目：${context.project.alias}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = this.iconPath('context.member', 'pass-filled');
      return item;
    }
    if (context.kind === 'external') {
      const item = new vscode.TreeItem(`当前项目：${vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '未命名工作区'}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = this.iconPath('context.external', 'link-external');
      return item;
    }
    const item = new vscode.TreeItem('当前项目：未打开', vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.iconPath('context.empty', 'window');
    return item;
  }

  private iconPath(
    semantic: IconSemantic,
    fallback: string,
  ): ReturnType<typeof createTreeIcon> {
    return createTreeIcon(this.extensionUri, semantic, fallback);
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/gu, '\\$&');
}
