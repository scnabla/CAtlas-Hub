/**
 * 从共享 TodoIndex 构建分类、文件和标记节点；视图范围与筛选不应反向清空底层索引。
 * 分类描述应沿用统一的描述处理规则，不能仅凭相同前缀把不同任务合并。
 * 扫描进度与树重绘频率由注册入口和 todoViewRefreshPolicy 协调，避免每处理一个文件就重建整棵树。
 */
import * as vscode from 'vscode';
import { TodoIndex } from './todoIndex';
import { isMyTodoOwner } from './todoOwner';
import { getTodoSettings } from './todoSettings';
import { formatTodoDescription, todoDescriptionGroupKey } from './todoDescription';
import { TodoGrouping, TodoMatch, TodoResourceResult, TodoScope } from './todoTypes';

export type TodoOwnership = 'mine' | 'other';

export type TodoTreeNode =
  | { readonly kind: 'ownerGroup'; readonly ownership: TodoOwnership; readonly configured: boolean }
  | { readonly kind: 'category'; readonly descriptionKey: string; readonly label: string; readonly ownership?: TodoOwnership }
  | { readonly kind: 'tag'; readonly tag: string; readonly ownership?: TodoOwnership }
  | { readonly kind: 'result'; readonly resource: TodoResourceResult; readonly match: TodoMatch; readonly grouping: TodoGrouping };

type ResultNode = Extract<TodoTreeNode, { kind: 'result' }>;
const sortText = new Intl.Collator('zh-CN', { numeric: true }).compare;

interface OwnerRows {
  readonly results: Map<string, ResultNode[]>;
  readonly groups: TodoTreeNode[];
  count: number;
}
function emptyRows(): OwnerRows { return { results: new Map(), groups: [], count: 0 }; }

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TodoTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  public scope: TodoScope = 'workspace';
  public grouping: TodoGrouping = 'category';
  public filter = '';

  public constructor(public readonly index: TodoIndex) {}

  private cached: ReturnType<TodoTreeProvider['buildRows']> | undefined;
  public refresh(): void { this.cached = undefined; this.emitter.fire(undefined); }

  public get totalResultCount(): number { return this.index.total; }
  public get visibleResultCount(): number { const { mine, other } = this.rows; return mine.count + other.count; }

  private get rows() {
    if (!this.cached || this.cached.version !== this.index.version || this.cached.filter !== this.filter || this.cached.grouping !== this.grouping) {
      this.cached = this.buildRows();
    }
    return this.cached;
  }

  private buildRows() {
    const settings = getTodoSettings();
    const filter = this.filter.trim().toLocaleLowerCase();
    const mine = emptyRows(), other = emptyRows();
    for (const resource of this.index.values()) {
      for (const match of resource.matches) {
        if (filter && !`${match.tag} ${match.owner ?? ''} ${match.text} ${resource.relativePath}`.toLocaleLowerCase().includes(filter)) continue;
        const rows = isMyTodoOwner(match.owner, settings.ownerIdentities) ? mine : other;
        rows.count++;
        const key = this.grouping === 'tag' ? match.tag : todoDescriptionGroupKey(match.text);
        let group = rows.results.get(key);
        if (!group) { group = []; rows.results.set(key, group); }
        group.push({ kind: 'result', match, resource, grouping: this.grouping });
      }
    }
    for (const ownership of ['mine', 'other'] as const) {
      const rows = ownership === 'mine' ? mine : other;
      const keys = [...rows.results.keys()];
      if (this.grouping === 'tag') keys.sort();
      else keys.sort((a, b) => sortText(formatTodoDescription(a), formatTodoDescription(b)) || sortText(a, b));
      for (const key of keys) {
        rows.groups.push(this.grouping === 'tag' ? { kind: 'tag', tag: key, ownership }
          : { kind: 'category', descriptionKey: key, label: formatTodoDescription(key), ownership });
        rows.results.get(key)!.sort((a, b) => sortText(formatTodoDescription(a.match.text), formatTodoDescription(b.match.text))
          || sortText(a.resource.relativePath, b.resource.relativePath) || a.match.line - b.match.line);
      }
    }
    return { mine, other, settings, filter: this.filter, grouping: this.grouping, version: this.index.version };
  }

  public getChildren(node?: TodoTreeNode): TodoTreeNode[] {
    const rows = this.rows;
    if (!node) {
      const configured = rows.settings.owner !== undefined;
      return [{ kind: 'ownerGroup', ownership: 'mine', configured },
        ...(rows.settings.showProjectMarkers && rows.other.count ? [{ kind: 'ownerGroup' as const, ownership: 'other' as const, configured }] : [])];
    }
    if (node.kind === 'result') return [];
    if (node.kind === 'ownerGroup') return !node.configured && node.ownership === 'mine' ? [] : rows[node.ownership].groups;
    const key = node.kind === 'tag' ? node.tag : node.descriptionKey;
    return node.ownership ? rows[node.ownership].results.get(key) ?? []
      : [...(rows.mine.results.get(key) ?? []), ...(rows.other.results.get(key) ?? [])];
  }

  public getTreeItem(node: TodoTreeNode): vscode.TreeItem {
    if (node.kind === 'ownerGroup') {
      const isMine = node.ownership === 'mine';
      const count = this.rows[node.ownership].count;
      const item = new vscode.TreeItem(
        isMine ? '我的标记' : '项目已有标记',
        !node.configured && isMine
          ? vscode.TreeItemCollapsibleState.None
          : isMine
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = !node.configured && isMine ? '设置个人标识' : String(count);
      item.iconPath = new vscode.ThemeIcon(isMine ? 'account' : 'repo');
      item.id = `projectManager.todo.owner.${node.ownership}`;
      item.contextValue = `projectManager.todo.ownerGroup.${node.ownership}`;
      if (!node.configured && isMine) {
        item.command = { command: 'projectManager.todo.configureOwner', title: '设置个人标记标识' };
        item.tooltip = '设置后，TODO(个人标识) 会优先显示在“我的标记”中。';
      }
      return item;
    }
    if (node.kind === 'tag') {
      const count = this.getChildren(node).length;
      const item = new vscode.TreeItem(node.tag, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(count);
      item.iconPath = this.tagIcon(node.tag);
      item.id = `projectManager.todo.tag.${node.ownership ?? 'all'}.${node.tag}`;
      return item;
    }
    if (node.kind === 'category') {
      const count = this.getChildren(node).length;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(count);
      item.iconPath = new vscode.ThemeIcon('list-tree');
      item.id = `projectManager.todo.description.${node.ownership ?? 'all'}.${node.descriptionKey}`;
      return item;
    }
    const fileName = node.resource.relativePath.split('/').pop() ?? node.resource.relativePath;
    const location = `${fileName}:${node.match.line + 1}`;
    const label = node.grouping === 'category' ? location : formatTodoDescription(node.match.text);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = node.grouping === 'category' ? node.match.tag : `${node.match.tag} · ${location}`;
    item.iconPath = this.tagIcon(node.match.tag);
    const mine = isMyTodoOwner(node.match.owner, this.rows.settings.ownerIdentities);
    item.contextValue = `projectManager.todo.result.${mine ? 'mine' : 'other'}`;
    item.command = { command: 'projectManager.todo.open', title: '打开 TODO', arguments: [node] };
    const owner = node.match.owner === undefined ? '未分配' : node.match.owner;
    const fullDescription = node.match.text.trim().length === 0 ? '未填写描述' : node.match.text.trim();
    item.tooltip = `${fullDescription}\n类型：${node.match.tag}\n负责人：${owner}\n${node.resource.relativePath}:${node.match.line + 1}`;
    return item;
  }

  public dispose(): void { this.emitter.dispose(); }

  private tagIcon(tag: string): vscode.ThemeIcon {
    const definition = this.rows.settings.tags.find((item) => item.name === tag);
    return new vscode.ThemeIcon(definition?.icon ?? 'check');
  }
}
