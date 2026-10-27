import * as path from 'node:path';
import * as vscode from 'vscode';
import { DataLocationExistsError, PersonalDataStore } from '../storage/personalDataStore';

export function registerDataLocationCommand(store: PersonalDataStore): vscode.Disposable {
  let changing = false;
  return vscode.commands.registerCommand('projectManager.changeDataLocation', async () => {
    if (changing) return;
    changing = true;
    try {
      const selected = (await vscode.window.showOpenDialog({
        title: '修改项目集合数据保存位置', openLabel: '使用此目录',
        defaultUri: vscode.Uri.file(path.dirname(store.file)),
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      }))?.[0];
      if (!selected) return;
      if (selected.scheme !== 'file') {
        await vscode.window.showErrorMessage('请选择本机文件夹作为数据保存位置。'); return;
      }
      let result;
      try { result = await store.relocate(selected.fsPath); }
      catch (error) {
        if (!(error instanceof DataLocationExistsError)) throw error;
        const choice = await vscode.window.showWarningMessage(
          '所选目录已有插件数据。使用后将切换个人偏好和项目集合，当前数据会保留在原位置。',
          { modal: true }, '使用该目录数据',
        );
        if (choice !== '使用该目录数据') return;
        result = await store.relocate(selected.fsPath, true);
      }
      if (!result.changed) {
        await vscode.window.showInformationMessage('所选目录已经是当前数据保存位置。'); return;
      }
      if (result.retainedPreviousFile) {
        await vscode.window.showWarningMessage(`数据已保存到新位置，原文件未能删除，已保留：${result.retainedPreviousFile}`);
      } else {
        await vscode.window.showInformationMessage(`${result.usedExisting ? '已使用该目录的插件数据' : '插件数据已移动'}：${path.dirname(store.file)}`);
      }
    } catch (error) {
      await vscode.window.showErrorMessage(`无法修改项目集合数据保存位置：${error instanceof Error ? error.message : String(error)}`);
    } finally { changing = false; }
  });
}
