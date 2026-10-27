import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { PersonalDataStore } from '../storage/personalDataStore';
import { getPersonalConfiguration } from '../configuration/personalConfiguration';
import { getApi, createCatalogForWorkspace, seedCatalogs, resetCatalogs, waitUntil } from './helpers';

suite('统一数据保存位置', () => {
  test('INT-241 原有工具栏操作保留且数据位置入口可用', async () => {
    const api = await getApi();
    const manifest = api.context.extension.packageJSON;
    const buttons = manifest.contributes.menus['view/title'].filter((item: { when?: string; group?: string }) =>
      item.when?.includes('view == projectManager.projectsView') && item.group?.startsWith('navigation'));
    assert.deepEqual(buttons, [
      {
        "command": "projectManager.addProjectToCatalog",
        "when": "view == projectManager.projectsView",
        "group": "navigation@1"
      },
      {
        "command": "projectManager.selectCatalog",
        "when": "view == projectManager.projectsView",
        "group": "navigation@2"
      },
      {
        "command": "projectManager.changeDataLocation",
        "when": "view == projectManager.projectsView",
        "group": "navigation@3"
      },
      {
        "command": "projectManager.refreshProjects",
        "when": "view == projectManager.projectsView && projectManager.hasActiveCatalog",
        "group": "navigation@5"
      },
      {
        "command": "projectManager.exitCatalog",
        "when": "view == projectManager.projectsView && projectManager.hasActiveCatalog",
        "group": "navigation@6"
      }
    ]);
    const locationCommand = manifest.contributes.commands.find((item: { command: string }) => item.command === 'projectManager.changeDataLocation');
    assert.equal(locationCommand.title, 'CAtlas Hub: 修改项目集合数据保存位置');
    assert.equal(locationCommand.icon, '$(folder-opened)');
    const commands = await vscode.commands.getCommands(true);
    for (const button of buttons) assert.ok(commands.includes(button.command), button.command);
    assert.ok(!commands.includes('projectManager.importCatalog'));
    assert.ok(!commands.includes('projectManager.exportCatalog'));
    const catalog = createCatalogForWorkspace('统一数据验收');
    await seedCatalogs(api, [catalog], catalog.id);
    const treeItem = api.catalogs.projectProvider.getTreeItem({ kind: 'summary' });
    assert.doesNotMatch(String(treeItem.description) + String(treeItem.tooltip), /内部存储|内部管理|配置修订/);
    const oldDirectory = path.dirname(api.personalData.file);
    const oldFile = api.personalData.file;
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'catlas-location-command-'));
    const sandbox = sinon.createSandbox();
    const picker = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').callsFake(async message => { assert.fail(String(message)); });
    const oldOwner = api.personalData.get('preferences', 'projectManager.todo.owner');
    try {
      await vscode.commands.executeCommand('projectManager.changeDataLocation');
      assert.equal(api.personalData.file, oldFile);
      await api.personalData.update('preferences', 'projectManager.todo.owner', 'moved-owner');
      picker.resolves([vscode.Uri.file(target)]);
      await vscode.commands.executeCommand('projectManager.changeDataLocation');
      assert.equal(api.personalData.file, path.join(await fs.realpath(target), 'personal-data.dat'));
      await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });
      const other = new PersonalDataStore(api.personalData.defaultFile);
      await other.initialize();
      try {
        assert.equal(other.file, api.personalData.file);
        assert.equal(other.get('preferences', 'projectManager.todo.owner'), 'moved-owner');
        assert.equal(other.get<{catalogs: {name: string}[]}>('state', 'projectManager.catalogLibrary.v1')?.catalogs[0]?.name, '统一数据验收');
      } finally { other.dispose(); }
      await vscode.commands.executeCommand('projectManager.changeDataLocation');
      assert.equal(api.personalData.file, path.join(await fs.realpath(target), 'personal-data.dat'));
    } finally {
      sandbox.restore();
      if (path.dirname(api.personalData.file) !== oldDirectory) await api.personalData.relocate(oldDirectory);
      await api.personalData.update('preferences', 'projectManager.todo.owner', oldOwner);
      await resetCatalogs(api);
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  test('INT-242 目标已有数据取消不变，确认后个人偏好与集合一起切换', async () => {
    const api = await getApi();
    const oldDirectory = path.dirname(api.personalData.file);
    const before = await fs.readFile(api.personalData.file);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'catlas-existing-data-'));
    const existing = new PersonalDataStore(path.join(target, 'personal-data.dat'));
    await existing.initialize();
    const catalog = createCatalogForWorkspace('所选目录集合');
    await existing.update('state', 'projectManager.catalogLibrary.v1', { storageVersion: 3, catalogs: [catalog] });
    await existing.update('preferences', 'projectManager.todo.owner', 'existing-owner');
    existing.dispose();
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(target)]);
    const warning = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').callsFake(async message => { assert.fail(String(message)); });
    try {
      await vscode.commands.executeCommand('projectManager.changeDataLocation');
      assert.equal(path.dirname(api.personalData.file), oldDirectory);
      assert.deepEqual(await fs.readFile(api.personalData.file), before);
      warning.resolves('使用该目录数据' as never);
      await vscode.commands.executeCommand('projectManager.changeDataLocation');
      assert.equal(path.dirname(api.personalData.file), await fs.realpath(target));
      await waitUntil(() => api.catalogs.service.catalogs.some(item => item.name === '所选目录集合'), '所选目录的集合应更新');
      assert.equal(getPersonalConfiguration('projectManager.todo').get('owner'), 'existing-owner');
      assert.deepEqual(await fs.readFile(path.join(oldDirectory, 'personal-data.dat')), before);
    } finally {
      sandbox.restore();
      if (path.dirname(api.personalData.file) !== oldDirectory) await api.personalData.relocate(oldDirectory, true);
      await api.catalogs.service.reloadPersonalLibrary();
      await resetCatalogs(api);
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
