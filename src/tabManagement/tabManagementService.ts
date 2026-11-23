import * as vscode from 'vscode';
import { openFileListTab } from './fileListPage';
import { OpenedFilesDirectoryPage } from './openedFilesDirectoryPage';
import { onDidChangePersonalConfiguration } from '../configuration/personalConfiguration';
import { ProjectFeatureConfigurationSource } from '../configuration/configurationTypes';
import { getUriComparisonKey } from '../shared/uri';
import { ExternalFileList, externalEditorId, externalTabUri, isExternalFileListTab, markerUri } from './externalFileList';
import { resolveEffectiveTabSettings } from './tabSettings';

const groups = () => vscode.window.tabGroups;
const groupAt = (column: vscode.ViewColumn) => groups().all.find(group => group.viewColumn === column);
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function uriOf(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  return tab?.input instanceof vscode.TabInputText ? tab.input.uri : undefined;
}

function externalGroup(): vscode.TabGroup | undefined {
  return groups().all.find(group => group.tabs.some(isExternalFileListTab));
}

function isFile(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' || uri.scheme === 'vscode-remote';
}

function isExternal(uri: vscode.Uri): boolean {
  return isFile(uri) && !vscode.workspace.getWorkspaceFolder(uri);
}

function findTab(group: vscode.TabGroup | undefined, uri: vscode.Uri): vscode.Tab | undefined {
  return group?.tabs.find(tab => uriOf(tab)?.toString() === uri.toString());
}

export class TabManagementService implements vscode.Disposable {
  private readonly fileList: ExternalFileList;
  private movingFile: string | undefined;
  private readonly disposables: vscode.Disposable[];
  private queue: Promise<void> = Promise.resolve();
  private scheduled = false;
  private disposed = false;
  private ownedGroup: vscode.TabGroup | undefined;

  constructor(private readonly output: vscode.OutputChannel, private readonly catalog: ProjectFeatureConfigurationSource, state: vscode.Memento,
    private readonly directory: OpenedFilesDirectoryPage) {
    this.fileList = new ExternalFileList(state);
    this.disposables = [
      this.fileList,
      vscode.window.registerCustomEditorProvider(externalEditorId, this.fileList, {
        webviewOptions: { enableFindWidget: true, retainContextWhenHidden: true },
      }),
      vscode.workspace.registerTextDocumentContentProvider(markerUri.scheme, this.fileList),
      vscode.languages.registerDocumentLinkProvider({ scheme: markerUri.scheme }, this.fileList),
      groups().onDidChangeTabs(event => {
        for (const tab of event.closed) {
          const uri = uriOf(tab);
          if (uri && isExternal(uri) && getUriComparisonKey(uri) !== this.movingFile
              && !groups().all.some(group => findTab(group, uri))) this.fileList.close(uri);
        }
        for (const tab of event.opened) {
          const uri = uriOf(tab);
          if (uri && isExternal(uri)) this.fileList.open(uri);
        }
        if (event.opened.length || event.closed.length
          || (event.changed.some(tab => !!uriOf(tab)) && this.directory.missing)) this.schedule();
      }),
      groups().onDidChangeTabGroups(() => this.schedule()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
      onDidChangePersonalConfiguration(event => {
        if (event.affectsConfiguration('projectManager.tabs') || event.affectsConfiguration('editor.multiCursorModifier')
            || event.affectsConfiguration('editor.links')) this.schedule();
      }),
      catalog.onDidChange(() => this.schedule()),
    ];
    for (const group of groups().all) for (const tab of group.tabs) {
      const uri = uriOf(tab);
      if (uri && isExternal(uri)) this.fileList.open(uri);
    }
    this.schedule();
  }

  private get enabled(): boolean {
    return resolveEffectiveTabSettings(this.catalog.currentProjectTabSettings).values.autoOrganize;
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    this.queue = this.queue.then(async () => {
      await pause(60);
      this.scheduled = false;
      if (!this.disposed) await this.reconcile(this.enabled);
    }).catch(error => this.output.appendLine('外部文件分栏失败：' + String(error)));
  }

  public async organizeCurrentGroup(_showPreview = true): Promise<void> {
    this.queue = this.queue.then(() => this.reconcile(true));
    await this.queue;
  }

  public async waitForIdleForIntegrationTest(): Promise<void> {
    let observed;
    do {
      observed = this.queue;
      await observed;
      await pause(80);
    } while (observed !== this.queue);
  }

  private async reconcile(route: boolean): Promise<void> {
    if (!groups().all.length) return;
    try {
      await this.reconcileExternalFiles(route);
    } finally {
      if (!this.disposed) await this.directory.reconcile();
    }
  }

  private async reconcileExternalFiles(route: boolean): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    let target = externalGroup();
    const active = groups().activeTabGroup.activeTab;
    const legacy = target?.tabs.find(tab => uriOf(tab)?.toString() === markerUri.toString());
    if (target && legacy && !target.tabs.some(tab => externalTabUri(tab))) {
      await vscode.commands.executeCommand('vscode.openWith', markerUri, externalEditorId,
        { viewColumn: target.viewColumn, preserveFocus: !legacy.isActive, preview: false });
      if (externalTabUri(groups().activeTabGroup.activeTab)) await vscode.commands.executeCommand('workbench.action.pinEditor');
      if (externalGroup()?.tabs.includes(legacy)) await groups().close(legacy, true);
    }
    const entries = groups().all.flatMap(group => group.tabs.map(tab => ({ tab, uri: uriOf(tab) })));
    // 先处理后台标签，最后恢复用户当前正在看的文件。
    entries.sort((a, b) => Number(a.tab === active) - Number(b.tab === active));
    const hasExternal = entries.some(({ uri }) => uri && isExternal(uri));
    if (route && folders?.length) {
      if (!target && hasExternal) target = await this.openMarker();
      if (target) {
        this.ownedGroup = target;
        for (const { tab, uri } of entries) {
          if (!uri || !isFile(uri)) continue;
          const right = externalGroup();
          if (!right) break;
          const outside = isExternal(uri);
          if (outside === (tab.group.viewColumn === right.viewColumn)) continue;
          const destination = outside ? right : groups().all.find(group => group.viewColumn !== right.viewColumn);
          if (destination) {
            const current = groups().activeTabGroup;
            const foreground = current.viewColumn === tab.group.viewColumn && uriOf(current.activeTab)?.toString() === uri.toString();
            this.movingFile = getUriComparisonKey(uri);
            try {
              await this.transfer(tab, uri, destination, foreground);
            } finally {
              this.movingFile = undefined;
            }
          }
        }
        // VS Code 会收起移走最后一个标签的组，留出左栏供打开项目文件。
        if (hasExternal && groups().all.length === 1 && externalGroup()) {
          const selected = externalGroup()?.activeTab;
          const selectedFile = selected?.input instanceof vscode.TabInputText ? selected.input.uri : undefined;
          await vscode.commands.executeCommand('workbench.action.newGroupLeft');
          const right = externalGroup();
          if (selected && selectedFile && right && findTab(right, selectedFile)) {
            await vscode.window.showTextDocument(selectedFile, { viewColumn: right.viewColumn, preview: selected.isPreview });
          }
        }
      }
    }
    const right = externalGroup();
    const files = (right?.tabs ?? []).map(uriOf).filter((uri): uri is vscode.Uri => !!uri && isExternal(uri));
    const open = groups().all.flatMap(group => group.tabs.map(uriOf))
      .filter((uri): uri is vscode.Uri => !!uri && isExternal(uri));
    await this.fileList.refresh(open, files);
    if ((!files.length && (!hasExternal || !route)) || !folders?.length) {
      const marker = right?.tabs.find(isExternalFileListTab);
      this.ownedGroup = undefined;
      if (marker && right) {
        const column = right.viewColumn;
        const count = groups().all.length;
        await groups().close(marker, true);
        const empty = groupAt(column);
        if (count > 1 && groups().all.length === count && empty?.tabs.length === 0) {
          await groups().close(empty, true);
        }
      }
    }
  }

  private async openMarker(): Promise<vscode.TabGroup | undefined> {
    const sourceColumn = groups().activeTabGroup.viewColumn;
    const lastColumn = Math.max(...groups().all.map(group => group.viewColumn));
    const previous = this.ownedGroup;
    const reuse = previous && groups().all.includes(previous) && previous.tabs.some(tab => {
      const uri = uriOf(tab);
      return uri && isExternal(uri);
    });
    const column = reuse ? previous.viewColumn : lastColumn + 1;
    const splitDown = vscode.workspace.getConfiguration('workbench.editor').get('openSideBySideDirection') === 'down';
    if (!reuse && splitDown) {
      if (sourceColumn !== lastColumn) await vscode.commands.executeCommand('workbench.action.focusLastEditorGroup');
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
    }
    await openFileListTab(markerUri, externalEditorId, column, true);
    if (!reuse && splitDown && groups().activeTabGroup.viewColumn === column) {
      const names = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
      const name = names[sourceColumn - 1];
      if (name) await vscode.commands.executeCommand('workbench.action.focus' + name + 'EditorGroup');
    }
    return externalGroup();
  }

  private async transfer(tab: vscode.Tab, uri: vscode.Uri, destination: vscode.TabGroup, foreground: boolean): Promise<void> {
    const source = groupAt(tab.group.viewColumn);
    if (!source || !findTab(source, uri) || source.viewColumn === destination.viewColumn) return;
    if (foreground || tab.isDirty || tab.isPinned) {
      const previous = vscode.window.activeTextEditor;
      if (!foreground) await vscode.window.showTextDocument(uri, { viewColumn: source.viewColumn, preview: tab.isPreview });
      const focused = groups().activeTabGroup;
      if (focused.viewColumn !== source.viewColumn || uriOf(focused.activeTab)?.toString() !== uri.toString()) return;
      await vscode.commands.executeCommand('moveActiveEditor', { by: 'group', to: 'position', value: destination.viewColumn });
      if (!foreground && previous?.viewColumn && isFile(previous.document.uri) && previous.document.uri.toString() !== uri.toString()) {
        await vscode.window.showTextDocument(previous.document, { viewColumn: previous.viewColumn, preview: false });
      }
      return;
    }
    // 后台标签在目的栏打开成功后才关闭来源，不切换用户焦点。
    const previous = vscode.window.activeTextEditor;
    const editor = await vscode.window.showTextDocument(uri, {
      viewColumn: destination.viewColumn, preserveFocus: true, preview: false,
    });
    if (editor.viewColumn !== destination.viewColumn || !findTab(groupAt(destination.viewColumn), uri)) return;
    const original = findTab(groupAt(source.viewColumn), uri);
    if (original) await groups().close(original, true);
    if (previous?.viewColumn && previous.document.uri.toString() !== uri.toString()
        && vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()
        && findTab(groupAt(previous.viewColumn), previous.document.uri)) {
      await vscode.window.showTextDocument(previous.document, { viewColumn: previous.viewColumn });
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const disposable of this.disposables) disposable.dispose();
  }
}
