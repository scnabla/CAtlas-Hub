import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ProjectButlerApi } from '../testing/projectButlerApi';
import { createStoredCatalog } from '../projectCatalog/catalogStore';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<ProjectButlerApi>('scnabla.catlas-hub-tools');
  assert.ok(extension);
  const api = await extension.activate(); await api.catalogs.initialization;
  assert.equal(api.context.extensionMode, vscode.ExtensionMode.Production);
  assert.equal(vscode.workspace.getConfiguration('projectManager.todo').inspect('owner')?.globalValue, 'old-native-setting');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(!commands.includes('projectManager.exportIdentityMigration'));
  assert.ok(!commands.includes('projectManager.importIdentityMigration'));
  if (process.env.CATLAS_PERSONAL_TEST_PHASE === 'save') {
    assert.equal(api.personalData.get('preferences', 'projectManager.todo.owner'), undefined);
    assert.equal(api.catalogs.service.catalogs.length, 0);
    const catalog = createStoredCatalog('外部存储集合', [{ alias: '项目别名', uri: vscode.workspace.workspaceFolders![0]!.uri.toString(), type: 'folder' }]);
    await api.catalogs.service.replaceLibraryForIntegrationTest({ storageVersion: 3, catalogs: [catalog] }, catalog.id);
    await api.personalData.update('preferences', 'projectManager.todo.owner', 'personal-owner');
    await api.personalData.update('preferences', 'projectManager.todo.markdownTasks', false);
    await api.personalData.update('preferences', 'projectManager.todo.markdownTasks', undefined);
    await api.context.workspaceState.update('catlas-test.workspace-only', true);
    await api.personalData.relocate(path.join(process.env.CATLAS_PERSONAL_TEST_DIRECTORY!, '数据 新位置'));
    await assert.rejects(fs.stat(api.personalData.defaultFile), { code: 'ENOENT' });
  } else {
    assert.equal(process.env.CATLAS_PERSONAL_TEST_PHASE, 'restart');
    assert.equal(api.personalData.get('preferences', 'projectManager.todo.owner'), 'personal-owner');
    assert.equal(api.personalData.get('preferences', 'projectManager.todo.markdownTasks'), undefined);
    assert.equal(api.catalogs.service.catalogs[0]?.name, '外部存储集合');
    assert.equal(api.catalogs.service.catalogs[0]?.projects[0]?.alias, '项目别名');
    assert.equal(api.context.workspaceState.get('catlas-test.workspace-only'), true);
    assert.equal(path.basename(path.dirname(api.personalData.file)), '数据 新位置');
    await api.personalData.update('preferences', 'restart-write', true);
    const saved = JSON.parse(await fs.readFile(api.personalData.file, 'utf8'));
    assert.equal(saved.preferences['restart-write'], true);
  }
  assert.equal(api.personalData.get('state', 'catlas-test.workspace-only'), undefined);
}
