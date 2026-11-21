import * as path from 'node:path';
import * as vscode from 'vscode';
import { getUriDisplayPath } from '../shared/uri';

interface ExternalFileQuickPickItem extends vscode.QuickPickItem {
  readonly uri: vscode.Uri;
}

export class ExternalFileMonitor {
  public constructor(private readonly output: vscode.OutputChannel) {}

  public getOpenExternalFiles(): readonly vscode.Uri[] {
    const unique = new Map<string, vscode.Uri>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.isExternalFile(tab.input.uri)) {
          unique.set(tab.input.uri.toString(), tab.input.uri);
        }
      }
    }
    return [...unique.values()];
  }

  public isExternalFileForIntegrationTest(uri: vscode.Uri): boolean {
    return this.isExternalFile(uri);
  }

  public async showOpenExternalFiles(): Promise<void> {
    const files = this.getOpenExternalFiles();
    if (files.length === 0) {
      await vscode.window.showInformationMessage('当前没有打开的工作区外文件。');
      return;
    }

    const items: ExternalFileQuickPickItem[] = files.map((uri) => ({
      label: `$(file) ${path.posix.basename(uri.path)}`,
      description: getUriDisplayPath(uri),
      detail: '该文件不属于当前工作区',
      uri,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要打开的工作区外文件',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (selected !== undefined) {
      await vscode.window.showTextDocument(selected.uri, { preview: false });
    }
  }

  public async diagnoseActiveFile(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri === undefined) {
      await vscode.window.showInformationMessage('当前编辑器不是普通文本文件。');
      return;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    const owningFolder = vscode.workspace.getWorkspaceFolder(uri);
    const external = this.isExternalFile(uri);
    const result = external
      ? '判定结果：工作区外文件'
      : owningFolder !== undefined
        ? `判定结果：工作区内文件，所属根目录为“${owningFolder.name}”`
        : '判定结果：没有打开工作区或当前文件不属于可识别的文件类型';
    const details = [
      result,
      `文件：${getUriDisplayPath(uri)}`,
      `工作区根目录：${folders.length > 0 ? folders.map((folder) => getUriDisplayPath(folder.uri)).join('；') : '无'}`,
    ].join('\n');

    this.output.appendLine(`[诊断]\n${details}`);
    await vscode.window.showInformationMessage(result, { modal: true, detail: details });
  }

  private isExternalFile(uri: vscode.Uri): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0 || !this.isFileLikeUri(uri, folders)) {
      return false;
    }

    return vscode.workspace.getWorkspaceFolder(uri) === undefined;
  }

  private isFileLikeUri(
    uri: vscode.Uri,
    folders: readonly vscode.WorkspaceFolder[],
  ): boolean {
    if (uri.scheme === 'file') {
      return true;
    }

    return folders.some(
      (folder) => folder.uri.scheme === uri.scheme && folder.uri.authority === uri.authority,
    );
  }

}
