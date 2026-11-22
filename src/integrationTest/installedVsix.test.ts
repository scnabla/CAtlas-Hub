import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createEmptyCatalogLibrary } from '../projectCatalog/catalogStore';
import type { ProjectButlerApi } from '../testing/projectButlerApi';

const EXTENSION_ID = process.env.PROJECT_BUTLER_TEST_ID;
const EXPECTED_VERSION = process.env.PROJECT_BUTLER_TEST_VERSION;
if (!EXTENSION_ID || !EXPECTED_VERSION) throw new Error('安装测试必须由准确候选包验证流程提供扩展 ID 和版本。');

suite('已安装 VSIX', () => {
  test('INT-158 隔离环境安装 VSIX 后扩展标识、版本和激活正确', async () => {
    const extension = vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID);
    assert.ok(extension);
    assert.equal(extension.packageJSON.version, EXPECTED_VERSION);
    const api = await extension.activate();
    assert.equal(api.context.extensionMode, vscode.ExtensionMode.Production);
    assert.ok(api.catalogs.service);
    const toolbar = extension.packageJSON.contributes.menus['view/title'].filter((item: { when?: string }) => item.when?.includes('view == projectManager.projectsView'));
    assert.deepEqual(toolbar.map((item: { command: string }) => item.command), [
      'projectManager.addProjectToCatalog', 'projectManager.selectCatalog', 'projectManager.changeDataLocation',
      'projectManager.refreshProjects', 'projectManager.exitCatalog',
    ]);
    const command = extension.packageJSON.contributes.commands.find((item: { command: string }) => item.command === 'projectManager.changeDataLocation');
    assert.equal(command.icon, '$(folder-opened)');
    assert.equal(command.title, 'CAtlas Hub: 修改项目集合数据保存位置');
    const iconRegistry = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'out', 'vs', 'workbench', 'workbench.desktop.main.js'));
    assert.ok(Buffer.from(iconRegistry).toString('utf8').includes('"folder-opened"'), '保存位置图标必须存在于当前 VS Code 图标注册表');

  });

  test('INT-243 设备树 overlay 文件按内容分色', async () => {
    const sample = vscode.Uri.file(path.resolve(__dirname, '../../test-fixtures/devicetree/board.overlay'));
    const doc = await vscode.workspace.openTextDocument(sample);
    assert.equal(doc.languageId, 'dts');

    type Token = { c: string; t: string };
    const tokens = await vscode.commands.executeCommand<Token[]>('_workbench.captureSyntaxTokens', sample);
    const expected = [
      ['sensor', 'entity.name.type.node'], ['48', 'constant.numeric.address'],
      ['sensor0', 'entity.name.function.label'], ['#address-cells', 'variable.other.property'],
      ['#include', 'keyword.control.directive'], ['alert-gpios', 'variable.other.property'],
      ['&gpio2', 'variable.other.constant.reference'], ['7', 'constant.numeric'],
      ['GPIO_ACTIVE_LOW', 'entity.name.function.preprocessor'], ['FF', 'constant.numeric.byte'],
      ['"okay"', 'string.quoted'], ['&{/soc/i2c@4000}', 'variable.other.constant.reference'],
    ] as const;
    for (const [text, scope] of expected) {
      assert.ok(tokens.some(token => token.c.trim() === text && token.t.includes(scope)), text);
    }
  });

  test('INT-244 设备树大纲只列节点，按源码层级跳转并跟随光标', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const uri = vscode.Uri.file(path.resolve(__dirname, '../../test-fixtures/devicetree/atlas-sensor-board.dts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await api.outline.refreshSymbols('设备树节点跳转');
    const roots = api.outline.getStateForIntegrationTest().symbols;
    assert.deepEqual(roots.map(node => node.name), ['/', '&i2c0', '&{/soc/spi@40020000}']);
    const bus = roots[1]!;
    assert.deepEqual(bus.children.map(node => node.name),
      ['temp_board: temperature-sensor@48', 'temp_air: temperature-sensor@49']);
    const sensor = bus.children[1]!;
    assert.equal(sensor.children.length, 0);
    const partition = roots[2]!.children[0]?.children[0]?.children[1];
    assert.equal(partition?.name, 'sample_log: partition@10000');
    for (const node of [bus, sensor, partition!]) {
      await api.outline.jumpToSymbolForIntegrationTest(node.id);
      assert.equal(doc.getText(editor.selection), node.name);
      assert.equal(api.outline.getStateForIntegrationTest().currentId, node.id);
    }
    const reg = doc.getText().indexOf('reg = <0x49>');
    assert.ok(reg >= 0);
    const pos = doc.positionAt(reg);
    editor.selection = new vscode.Selection(pos, pos);
    assert.equal(api.outline.getStateForIntegrationTest().currentId, sensor.id);
  });

  test('INT-245 四种设备树后缀在打开时报告错误，修正后清除诊断', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'catlas-dts-'));
    const invalid = '&external { data = [01 GG]; };';
    const valid = invalid.replace('GG', 'FF');
    async function waitFor(uri: vscode.Uri, count: number) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const items = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'CAtlas Hub');
        if (items.length === count) return items;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('设备树诊断数量未更新：' + uri.fsPath);
    }
    try {
      for (const suffix of ['dts', 'dtsi', 'dtso', 'overlay']) {
        const uri = vscode.Uri.file(path.join(dir, 'board.' + suffix));
        await fs.writeFile(uri.fsPath, invalid);
        const doc = await vscode.workspace.openTextDocument(uri);
        const [error] = await waitFor(uri, 1);
        assert.equal(doc.getText(error!.range), 'GG');
        assert.equal(error!.severity, vscode.DiagnosticSeverity.Error);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, error!.range, 'FF');
        assert.ok(await vscode.workspace.applyEdit(edit));
        assert.equal(doc.getText(), valid);
        assert.ok(doc.isDirty);
        await waitFor(uri, 0);
        await doc.save();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('INT-159 已安装扩展在空集合状态显示首次使用入口', async () => {
    const extension = vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!;
    const api = await extension.activate();
    await api.catalogs.service.replaceLibraryForIntegrationTest(createEmptyCatalogLibrary());
    assert.equal(api.catalogs.service.catalogs.length, 0);
    assert.match(api.catalogs.projectView.message ?? '', /添加项目|请选择/);
  });

  test('INT-160 已安装扩展重载服务状态不产生重复命令', async () => {
    const extension = vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!;
    const api = await extension.activate();
    const before = (await vscode.commands.getCommands(true)).filter((command) => command.startsWith('projectManager.'));
    await api.catalogs.service.refresh();
    const after = (await vscode.commands.getCommands(true)).filter((command) => command.startsWith('projectManager.'));
    assert.deepEqual(after.sort(), before.sort());
    assert.equal(new Set(after).size, after.length);
  });
  test('INT-246 首个外部文件独立分栏、保留未保存内容并在全部关闭后收起', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const config = vscode.workspace.getConfiguration('projectManager.tabs');
    const original = config.inspect<boolean>('autoOrganize')?.workspaceValue;
    const folder = vscode.workspace.workspaceFolders![0]!.uri;
    const dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'catlas-group-')));
    const externalUri = vscode.Uri.file(path.join(dir, 'external.txt'));
    const secondUri = vscode.Uri.file(path.join(dir, 'second.txt'));
    const groupList = () => vscode.window.tabGroups.all;
    const uriOf = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined;
    const groupOf = (uri: vscode.Uri) => groupList().find(group => group.tabs.some(tab => uriOf(tab)?.toString() === uri.toString()));
    const marker = (tab: vscode.Tab) => uriOf(tab)?.scheme === 'catlas-external-files';
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await config.update('autoOrganize', undefined, vscode.ConfigurationTarget.Workspace);
      assert.equal(vscode.workspace.getConfiguration('projectManager.tabs').get('autoOrganize'), true);
      const settings = vscode.workspace.getConfiguration('workbench.editor');
      assert.equal(settings.get('showTabs'), 'multiple');
      assert.equal(settings.get('wrapTabs'), true);
      const internal = vscode.Uri.joinPath(folder, 'README.md');
      await vscode.window.showTextDocument(internal, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupList().length, 1);
      const userTab = vscode.Uri.joinPath(folder, 'src', 'app.ts');
      await vscode.window.showTextDocument(userTab, { viewColumn: vscode.ViewColumn.Two, preview: false });
      await fs.writeFile(externalUri.fsPath, 'original');
      await fs.writeFile(secondUri.fsPath, 'second');
      const editor = await vscode.window.showTextDocument(externalUri, { preview: false });
      await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'dirty '));
      await api.tabs.waitForIdleForIntegrationTest();
      const right = groupOf(externalUri);
      assert.equal(groupList().length, 3, JSON.stringify(groupList().map(g => g.tabs.map(t => t.label))));
      assert.equal(right?.viewColumn, vscode.ViewColumn.Three);
      assert.ok(right?.tabs[0] && marker(right.tabs[0]) && right.tabs[0].isPinned);
      assert.ok(!vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'catlas-external-files'), '外部文件页应能独立于文本文档打开');
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), externalUri.toString());
      assert.equal(editor.document.getText(), 'dirty original');
      assert.equal(editor.document.isDirty, true);
      assert.equal(await fs.readFile(externalUri.fsPath, 'utf8'), 'original');
      await vscode.window.showTextDocument(secondUri, { viewColumn: vscode.ViewColumn.One, preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupOf(secondUri)?.viewColumn, right.viewColumn);
      const list = await vscode.workspace.openTextDocument(uriOf(right.tabs[0])!);
      // 内容提供器的变更由 VS Code 异步应用到已打开的只读文档。
      const listsBothFiles = () => list.getText().includes(externalUri.fsPath) && list.getText().includes(secondUri.fsPath);
      for (let attempt = 0; attempt < 40 && !listsBothFiles(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(listsBothFiles(), list.getText());
      await vscode.window.showTextDocument(internal, { viewColumn: right.viewColumn, preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupOf(internal)?.viewColumn, vscode.ViewColumn.One);
      assert.ok(!right.tabs.some(tab => uriOf(tab)?.toString() === internal.toString()));
      await editor.document.save();
      await vscode.window.tabGroups.close(right.tabs.filter(tab => !marker(tab)));
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupList().length, 2);
      assert.equal(groupOf(userTab)?.viewColumn, vscode.ViewColumn.Two);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.window.showTextDocument(secondUri, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupList().length, 2, '仅打开外部文件时应保留左栏');
      assert.equal(groupOf(secondUri)?.viewColumn, vscode.ViewColumn.Two);
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), secondUri.toString());
      await vscode.window.showTextDocument(internal, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(groupOf(internal)?.viewColumn, vscode.ViewColumn.One);
      const layout = vscode.workspace.getConfiguration('workbench.editor');
      const closeEmpty = layout.inspect<boolean>('closeEmptyGroups')?.workspaceValue;
      try {
        await layout.update('closeEmptyGroups', false, vscode.ConfigurationTarget.Workspace);
        const outside = groupOf(secondUri)?.tabs.find(tab => uriOf(tab)?.toString() === secondUri.toString());
        assert.ok(outside);
        await vscode.window.tabGroups.close(outside);
        await api.tabs.waitForIdleForIntegrationTest();
        assert.equal(groupList().length, 1, '外部栏收起后项目恢复为单栏');
      } finally {
        await layout.update('closeEmptyGroups', closeEmpty, vscode.ConfigurationTarget.Workspace);
      }
      for (const delay of [0, 35, 55]) {
        await vscode.window.showTextDocument(secondUri, { viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: false });
        await new Promise(resolve => setTimeout(resolve, delay));
        await vscode.window.showTextDocument(internal, { viewColumn: vscode.ViewColumn.One, preview: false });
        await api.tabs.waitForIdleForIntegrationTest();
        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), internal.toString(), '切回项目文件后应保留焦点');
        const group = groupOf(secondUri);
        const outside = group?.tabs.find(tab => uriOf(tab)?.toString() === secondUri.toString());
        assert.ok(outside && group?.viewColumn === vscode.ViewColumn.Two);
        await vscode.window.tabGroups.close(outside);
        await api.tabs.waitForIdleForIntegrationTest();
      }
    } finally {
      const doc = vscode.workspace.textDocuments.find(item => item.uri.toString() === externalUri.toString());
      if (doc?.isDirty) await doc.save();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await config.update('autoOrganize', original, vscode.ConfigurationTarget.Workspace);
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs));
      await api.tabs.waitForIdleForIntegrationTest();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test('INT-247 外部文件路径原生跳转，按目录及打开顺序排列', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const config = vscode.workspace.getConfiguration('projectManager.tabs');
    const original = config.inspect<boolean>('autoOrganize')?.workspaceValue;
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'catlas-path-links-')));
    const file = (relative: string) => vscode.Uri.file(path.join(root, relative));
    const a = file('A/src/一 #%.txt');
    const b = file('B/src/同名 file.txt');
    const c = file('A/src/同名 file.txt');
    const marker = vscode.Uri.from({ scheme: 'catlas-external-files', path: '/↗ 外部文件' });
    const list = () => vscode.workspace.openTextDocument(marker);
    const column = () => vscode.window.tabGroups.all.find(group => group.tabs.some(tab =>
      (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) && tab.input.uri.scheme === marker.scheme))?.viewColumn;
    const show = async (uri: vscode.Uri) => {
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
    };
    const checkRows = async (uris: vscode.Uri[]) => {
      const doc = await list();
      const expected = ['双击路径，或按住 Ctrl 并点击路径，跳转到文件', ...uris.map(uri => uri.fsPath)];
      for (let i = 0; i < 80 && doc.getText().split(/\r?\n/).join('\n') !== expected.join('\n'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.deepEqual(doc.getText().split(/\r?\n/), expected);
      const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', marker);
      assert.deepEqual(links?.map(link => [link.range.start.line, doc.getText(link.range), link.target?.toString()]),
        uris.map((uri, index) => [index + 1, uri.fsPath, uri.toString()]));
    };
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await config.update('autoOrganize', true, vscode.ConfigurationTarget.Workspace);
      await show(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'README.md'));
      for (const uri of [a, b, c]) {
        await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.writeFile(uri.fsPath, 'test');
        await show(uri);
      }
      await checkRows([a, c, b]);
      const provider = api.openedFilesTree.provider;
      provider.refresh();
      const roots = provider.getChildren();
      assert.equal(roots.length, 1);
      assert.deepEqual(roots[0]?.children.map(node => node.uri),
        [vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'README.md').toString()]);

      await vscode.commands.executeCommand('moveActiveEditor', { by: 'tab', to: 'first' });
      await checkRows([a, c, b]);
      const right = column();
      assert.ok(right);
      const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', marker);
      assert.ok(links?.[0]?.target);
      await vscode.commands.executeCommand('vscode.open', links[0].target, { viewColumn: right });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), a.toString());
      assert.equal(vscode.window.activeTextEditor?.viewColumn, right);
      const first = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(first);
      await vscode.window.tabGroups.close(first);
      await api.tabs.waitForIdleForIntegrationTest();
      await checkRows([c, b]);
      await show(a);
      await checkRows([c, a, b]);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await config.update('autoOrganize', original, vscode.ConfigurationTarget.Workspace);
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs));
      await api.tabs.waitForIdleForIntegrationTest();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
  test('INT-248 编辑区只打开一个已打开文件，文件位于公共目录下', async () => {
    const extension = vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!;
    const api = await extension.activate();
    const contributions = extension.packageJSON.contributes;
    const command = 'projectManager.openOpenedFilesDirectory';
    assert.ok(contributions.menus['editor/title'].some((item: { command: string }) => item.command === command));
    assert.ok(!contributions.views.explorer.some((item: { id: string }) => item.id === 'projectManager.openedFilesView'));
    try {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'src', 'app.ts');
      await vscode.window.showTextDocument(uri, { preview: false });
      await vscode.commands.executeCommand(command);
      await vscode.commands.executeCommand(command);
      const pages = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'projectManager.openedFilesDirectory' && tab.label === '已打开文件');
      for (let i = 0; i < 50 && pages().length === 0; i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(pages().length, 1);
      const provider = api.openedFilesTree.provider;
      provider.refresh();
      const pending = provider.getChildren();
      while (pending.length) {
        const node = pending.pop()!;
        if (node.kind === 'directory' && node.label === 'src/' && node.children.some(file => file.uri === uri.toString())) return;
        pending.push(...node.children);
      }
      assert.fail('src/ 下缺少 app.ts');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
  test('INT-249 已有固定文件时目录页仍固定在首位', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const readme = vscode.Uri.joinPath(root, 'README.md');
    const app = vscode.Uri.joinPath(root, 'src', 'app.ts');
    const group = () => vscode.window.tabGroups.activeTabGroup;
    const tabs = () => group().tabs.map(tab => [tab.label, tab.isPinned]);
    try {
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(item => item.tabs));
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.window.showTextDocument(readme, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.commands.executeCommand('workbench.action.pinEditor');
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.window.showTextDocument(app, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      assert.equal(group().activeTab?.label, 'app.ts');
      await vscode.commands.executeCommand('projectManager.openOpenedFilesDirectory');
      const expected = [['已打开文件', true], ['README.md', true], ['app.ts', false]];
      for (let i = 0; i < 80 && JSON.stringify(tabs()) !== JSON.stringify(expected); i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.deepEqual(tabs(), expected);
      await vscode.window.showTextDocument(app, { preview: false });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), app.toString());
      assert.deepEqual(tabs(), expected);
      await vscode.commands.executeCommand('projectManager.openOpenedFilesDirectory');
      assert.deepEqual(tabs(), expected);
    } finally {
      await vscode.window.tabGroups.close([...group().tabs]);
    }
  });
  test('INT-250 安装后不再注册过时的大纲选项和工作区外文件提醒', async () => {
    const extension = vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!;
    const { contributes } = extension.packageJSON;
    const api = await extension.activate();
    const roots = api.catalogs.configurationProvider.getChildren();
    assert.ok(!roots.some(node => node.kind === 'group' && String(node.id) === 'external'));
    const settings = contributes.configuration.properties;
    for (const key of ['externalFiles.enabled', 'externalFiles.showColor', 'externalFiles.showBadge',
      'externalFiles.showStatusBar', 'symbolOutline.hierarchy', 'symbolOutline.followActiveEditor']) {
      assert.ok(!Object.hasOwn(settings, 'projectManager.' + key), key);
    }
    const colors = contributes.colors.map((entry: { id: string }) => entry.id);
    assert.ok(!colors.includes('projectManager.externalFileForeground'));
    assert.ok(colors.includes('projectManager.fileListPathForeground'));
    assert.ok(colors.includes('projectManager.fileListNameForeground'));
    assert.ok(!contributes.menus['editor/title'].some((entry: { command: string }) => entry.command === 'projectManager.diagnoseActiveFile'));
  });
  test('INT-251 已打开文件按工作区标签和视图配置自动恢复或收起', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const config = vscode.workspace.getConfiguration('projectManager.tabs');
    const original = config.inspect<string>('openFilesView')?.workspaceValue;
    const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
    const pages = () => tabs().filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'projectManager.openedFilesDirectory' && tab.label === '已打开文件');
    const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'README.md');
    const wait = async (expected: boolean) => {
      for (let i = 0; i < 80; i++) {
        const current = pages();
        if (expected ? current.length === 1 && current[0]!.isPinned && current[0]!.group.tabs[0] === current[0]
          && vscode.window.activeTextEditor?.document.uri.toString() === file.toString() : !current.length) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(JSON.stringify(tabs().map(tab => [tab.label, tab.isPinned, tab.isActive, tab.group.viewColumn])));
    };
    try {
      await vscode.window.tabGroups.close(tabs());
      await api.tabs.waitForIdleForIntegrationTest();
      await vscode.window.showTextDocument(file, { preview: false });
      await wait(true);
      const column = pages()[0]!.group.viewColumn;
      for (let i = 0; i < 2; i++) {
        await vscode.window.tabGroups.close(pages()[0]!, true);
        await wait(true);
        assert.equal(pages()[0]!.group.viewColumn, column);
      }
      await config.update('openFilesView', 'native', vscode.ConfigurationTarget.Workspace);
      await api.tabs.waitForIdleForIntegrationTest();
      await wait(false);
      await vscode.commands.executeCommand('projectManager.openOpenedFilesDirectory');
      await wait(false);
      // 避免切回目录树时出现原生视图选择提示，保留该窗口原有选择。
      const key = 'projectManager.openedFilesView.nativeOpenEditorsDecision';
      const decision = api.context.globalState.get(key);
      try {
        await api.context.globalState.update(key, 'declined');
        await config.update('openFilesView', 'directoryTree', vscode.ConfigurationTarget.Workspace);
        await wait(true);
        const source = tabs().find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === file.toString());
        assert.ok(source);
        await vscode.window.tabGroups.close(source);
        await api.tabs.waitForIdleForIntegrationTest();
        await wait(false);
      } finally {
        await api.context.globalState.update(key, decision);
      }
    } finally {
      await config.update('openFilesView', original, vscode.ConfigurationTarget.Workspace);
      await vscode.window.tabGroups.close(tabs());
    }
  });

  test('INT-252 修改块注释保留源码，过期条目重定位到原任务', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const config = vscode.workspace.getConfiguration('projectManager.todo');
    const original = config.inspect('showProjectMarkers')?.workspaceValue;
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const uri = vscode.Uri.joinPath(root, 'todo-edit-' + Date.now() + '.cpp');
    const scope = api.todo.provider.scope;
    const state = api.context.workspaceState;
    const key = 'projectManager.todo.lastTag';
    const last = state.get(key);
    const marker = api.todo.marker as unknown as { requestDescription: () => Promise<string>; quickMark(repeat: boolean): Promise<boolean> };
    const request = marker.requestDescription;
    const ownerConfig = config.inspect('owner')?.workspaceValue;
    try {
      await config.update('owner', 'dev', vscode.ConfigurationTarget.Workspace);
      await config.update('showProjectMarkers', true, vscode.ConfigurationTarget.Workspace);
      await state.update(key, 'TODO');
      await vscode.workspace.fs.writeFile(uri, Buffer.from('/* TODO(dev): old */ int value = 1;\nconst char *s = "// TODO: literal"; // TODO(dev): real\n'));
      const editor = await vscode.window.showTextDocument(uri, { preview: false });
      await api.tabs.waitForIdleForIntegrationTest();
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      marker.requestDescription = async () => 'new';
      assert.equal(await marker.quickMark(true), true);
      assert.equal(editor.document.lineAt(0).text, '/* TODO(dev): new */ int value = 1;');
      api.todo.provider.scope = 'currentFile';
      await api.todo.refresh(true);
      const resource = api.todo.index.get(uri.toString());
      const match = resource?.matches.find(m => m.text === 'real');
      assert.ok(resource && match);
      const node = { kind: 'result', resource, match, grouping: 'category' };
      await editor.edit(e => e.insert(new vscode.Position(0, 0), '// header\n'));
      assert.equal(await vscode.commands.executeCommand('projectManager.todo.toggleCompleted', node), true);
      assert.equal(editor.document.lineAt(2).text, 'const char *s = "// TODO: literal"; // TODO(dev) [x]: real');
      assert.equal(editor.document.lineAt(1).text, '/* TODO(dev): new */ int value = 1;');
      await editor.edit(e => e.insert(new vscode.Position(0, 0), '// TODO(dev): real\n'));
      assert.equal(await vscode.commands.executeCommand('projectManager.todo.removeMark', node), false);
    } finally {
      marker.requestDescription = request;
      api.todo.provider.scope = scope;
      await state.update(key, last);
      await config.update('showProjectMarkers', original, vscode.ConfigurationTarget.Workspace);
      await config.update('owner', ownerConfig, vscode.ConfigurationTarget.Workspace);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (doc?.isDirty) await doc.save();
      await vscode.workspace.fs.delete(uri);
    }
  });

  test('INT-253 文件夹、单文件和同类型文件屏蔽均不影响 TODO 索引', async () => {
    const api = await vscode.extensions.getExtension<ProjectButlerApi>(EXTENSION_ID)!.activate();
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const name = '.todo-hidden-' + Date.now();
    const directory = vscode.Uri.joinPath(root, name);
    const nested = vscode.Uri.joinPath(directory, 'build', 'nested');
    const file = vscode.Uri.joinPath(nested, 'driver.c');
    const extra = vscode.Uri.joinPath(nested, 'second.c');
    const settings = [
      { section: 'files', key: 'exclude', patterns: [name, name + '/build/nested/driver.c'] },
      { section: 'search', key: 'exclude', patterns: [name + '/**', '**/*.c'] },
      { section: 'files', key: 'watcherExclude', patterns: [name + '/**'] },
    ].map(entry => ({ ...entry, config: vscode.workspace.getConfiguration(entry.section, root),
      original: vscode.workspace.getConfiguration(entry.section, root).inspect<Record<string, boolean>>(entry.key)?.workspaceValue }));
    const confirmation = vscode.workspace.getConfiguration('projectManager.exclusions', root);
    const previousConfirmation = confirmation.inspect<boolean>('confirmBeforeApply')?.workspaceValue;
    const todo = vscode.workspace.getConfiguration('projectManager.todo', root);
    const show = todo.inspect<boolean>('showProjectMarkers')?.workspaceValue;
    const scope = api.todo.provider.scope;
    const matches = (uri: vscode.Uri) => api.todo.index.get(uri.toString())?.matches.map(m => m.text) ?? [];
    try {
      await vscode.workspace.fs.createDirectory(nested);
      await vscode.workspace.fs.writeFile(file, Buffer.from('// TODO: disk'));
      await confirmation.update('confirmBeforeApply', false, vscode.ConfigurationTarget.Workspace);
      const files = vscode.workspace.getConfiguration('files', root);
      const watchBefore = files.get('watcherExclude');
      assert.equal((await api.exclusions.exclude([directory])).resourceCount, 1);
      assert.equal((await api.exclusions.excludeFileTypes([file])).typeCount, 1);
      assert.equal(vscode.workspace.getConfiguration('files', root).get<Record<string, boolean>>('watcherExclude')?.[name + '/**'], undefined);
      assert.deepEqual(vscode.workspace.getConfiguration('files', root).get('watcherExclude'), watchBefore);
      await todo.update('showProjectMarkers', true, vscode.ConfigurationTarget.Workspace);
      api.todo.provider.scope = 'workspace';
      await api.todo.refresh(true);
      assert.deepEqual(matches(file), ['disk']);
      await fs.writeFile(file.fsPath, '// TODO: external edit');
      for (let i = 0; i < 100 && matches(file)[0] !== 'external edit'; i++) {
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      assert.deepEqual(matches(file), ['external edit'], '新屏蔽规则下应能收到已关闭文件的磁盘修改');
      for (const rule of settings) {
        const hidden = Object.fromEntries(rule.patterns.map(pattern => [pattern, true]));
        await rule.config.update(rule.key, { ...rule.original, ...hidden }, vscode.ConfigurationTarget.Workspace);
      }
      await api.todo.refresh(true);
      assert.deepEqual(matches(file), ['external edit']);
      const editor = await vscode.window.showTextDocument(file, { preview: false });
      await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// FIXME: unsaved\n'));
      await api.todo.refresh(true);
      assert.deepEqual(matches(file), ['unsaved', 'external edit']);
      assert.equal(await editor.document.save(), true);
      const tab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === file.toString());
      assert.ok(tab);
      await vscode.window.tabGroups.close(tab);
      await api.todo.waitForIdleForIntegrationTest();
      assert.deepEqual(matches(file), ['unsaved', 'external edit']);
      await vscode.workspace.fs.writeFile(file, Buffer.from('// TODO: changed'));
      await vscode.workspace.fs.writeFile(extra, Buffer.from('// FIXME: added'));
      await api.todo.refresh(false);
      assert.deepEqual(matches(file), ['changed']);
      assert.deepEqual(matches(extra), ['added']);
      await vscode.workspace.fs.delete(extra);
      await api.todo.refresh(false);
      assert.deepEqual(matches(extra), []);
    } finally {
      api.todo.provider.scope = scope;
      await confirmation.update('confirmBeforeApply', previousConfirmation, vscode.ConfigurationTarget.Workspace);
      await todo.update('showProjectMarkers', show, vscode.ConfigurationTarget.Workspace);
      for (const rule of settings) await rule.config.update(rule.key, rule.original, vscode.ConfigurationTarget.Workspace);
      await vscode.workspace.fs.delete(directory, { recursive: true });
    }
  });

});
