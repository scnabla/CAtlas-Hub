import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { closeAllEditors, delay, getApi, openText, projectUri } from './helpers';

suite('工作区外文件识别', () => {
  setup(closeAllEditors);

  test('INT-123 已打开外部文件列表可以作为查看命令数据源', async () => {
    const api = await getApi();
    const uri = projectUri(api, 'test-fixtures/external/outside.txt');
    await openText(uri);
    const files = api.externalFiles.getOpenExternalFiles();
    assert.ok(files.some((candidate) => candidate.toString() === uri.toString()));
    assert.ok((await vscode.commands.getCommands(true)).includes('projectManager.showExternalFiles'));
  });

  test('INT-124 诊断依据能区分工作区内和工作区外文件', async () => {
    const api = await getApi();
    const internal = projectUri(api, 'test-fixtures/workspace-one/normal.txt');
    const external = projectUri(api, 'test-fixtures/external/outside.txt');
    assert.equal(api.externalFiles.isExternalFileForIntegrationTest(internal), false);
    assert.equal(api.externalFiles.isExternalFileForIntegrationTest(external), true);
    assert.ok((await vscode.commands.getCommands(true)).includes('projectManager.diagnoseActiveFile'));
  });

  test('INT-125 当前工作区根内的深层文件不被误报', async () => {
    const api = await getApi();
    const nested = projectUri(api, 'test-fixtures/workspace-one/中文 空格目录/说明 文件.txt');
    assert.ok(vscode.workspace.getWorkspaceFolder(nested));
    assert.equal(api.externalFiles.isExternalFileForIntegrationTest(nested), false);
  });

  test('INT-126 非文件编辑器不进入外部文本文件集合', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('workbench.action.openSettings');
    await delay(100);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText, false);
    assert.equal(api.externalFiles.getOpenExternalFiles().length, 0);
  });

  test('INT-127 关闭外部文件后从外部集合移除', async () => {
    const api = await getApi();
    const uri = projectUri(api, 'test-fixtures/external/outside.txt');
    await openText(uri);
    assert.equal(api.externalFiles.getOpenExternalFiles().length, 1);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await delay(100);
    assert.equal(api.externalFiles.getOpenExternalFiles().length, 0);
  });

});
