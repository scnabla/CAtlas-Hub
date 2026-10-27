import { getPersonalConfiguration } from '../configuration/personalConfiguration';
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { applyPersonalSettingValue, ConfigurationTreeNode } from '../configuration/configurationTreeProvider';
import { createStoredCatalog } from '../projectCatalog/catalogStore';
import { flattenOpenedFileTree } from '../tabManagement/openedFilesTreeModel';
import {
  closeAllEditors,
  delay,
  getApi,
  openText,
  projectUri,
  seedCatalogs,
  setGlobalSetting,
  waitUntil,
} from './helpers';

suite('统一图标风格与实时刷新', () => {
  setup(async () => {
    await setGlobalSetting('projectManager.visuals', 'iconStyle', 'unified');
  });

  teardown(async () => {
    await closeAllEditors();
    await setGlobalSetting('projectManager.visuals', 'iconStyle', undefined);
  });

  test('INT-192 Manifest 默认使用统一标识且侧栏可以写入原生风格', async () => {
    const inspected = getPersonalConfiguration('projectManager.visuals')
      .inspect<string>('iconStyle');
    assert.equal(inspected?.defaultValue, 'unified');

    const result = await applyPersonalSettingValue('iconStyle', 'native');
    assert.equal(result.globalValue, 'native');

    const api = await getApi();
    const projectGroup = api.catalogs.configurationProvider.getChildren()
      .find((node) => node.kind === 'group' && node.id === 'project');
    assert.ok(projectGroup);
    const iconStyleNode = api.catalogs.configurationProvider.getChildren(projectGroup)
      .find((node) => node.kind === 'personalSetting' && node.key === 'iconStyle');
    assert.ok(iconStyleNode);
    const item = api.catalogs.configurationProvider.getTreeItem(iconStyleNode as ConfigurationTreeNode);
    assert.match(String(item.description), /VS Code 原生/);
  });

  test('INT-193 项目树和配置树在两种风格间切换', async () => {
    const api = await getApi();
    const catalog = createStoredCatalog('图标测试集合', []);
    await seedCatalogs(api, [catalog], catalog.id);

    const summary = api.catalogs.projectProvider.getChildren()[0];
    assert.ok(summary);
    const unifiedProjectIcon = api.catalogs.projectProvider.getTreeItem(summary).iconPath;
    assert.equal(isTreeIconPath(unifiedProjectIcon), true);

    const configurationSummary = api.catalogs.configurationProvider.getChildren()[0];
    const unifiedConfigurationIcon = api.catalogs.configurationProvider
      .getTreeItem(configurationSummary as ConfigurationTreeNode).iconPath;
    assert.equal(isTreeIconPath(unifiedConfigurationIcon), true);

    await setGlobalSetting('projectManager.visuals', 'iconStyle', 'native');
    assert.ok(api.catalogs.projectProvider.getTreeItem(summary).iconPath instanceof vscode.ThemeIcon);
    assert.ok(api.catalogs.configurationProvider
      .getTreeItem(configurationSummary as ConfigurationTreeNode).iconPath instanceof vscode.ThemeIcon);
  });

  test('INT-194 图标风格变化会刷新三个树视图并立即更新大纲状态', async () => {
    const api = await getApi();
    let projectRefreshes = 0;
    let configurationRefreshes = 0;
    let openedFilesRefreshes = 0;
    const subscriptions = [
      api.catalogs.projectProvider.onDidChangeTreeData(() => { projectRefreshes += 1; }),
      api.catalogs.configurationProvider.onDidChangeTreeData(() => { configurationRefreshes += 1; }),
      api.openedFilesTree.provider.onDidChangeTreeData(() => { openedFilesRefreshes += 1; }),
    ];
    try {
      await setGlobalSetting('projectManager.visuals', 'iconStyle', 'native');
      await delay(100);
      assert.ok(projectRefreshes > 0);
      assert.ok(configurationRefreshes > 0);
      assert.ok(openedFilesRefreshes > 0);
      assert.equal(api.outline.getStateForIntegrationTest().preferences.iconStyle, 'native');
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
    }
  });

  test('INT-195 已打开文件目录在统一风格使用自有文件图标，原生风格恢复文件主题图标', async () => {
    const api = await getApi();
    await openText(projectUri(api, 'test-fixtures/workspace-one/src/app.ts'));
    api.openedFilesTree.provider.refresh();
    const fileNode = flattenOpenedFileTree(api.openedFilesTree.provider.getRootsForIntegrationTest())
      .find((node) => node.kind === 'file');
    assert.ok(fileNode);
    assert.equal(isTreeIconPath(api.openedFilesTree.provider.getTreeItem(fileNode).iconPath), true);

    await setGlobalSetting('projectManager.visuals', 'iconStyle', 'native');
    assert.equal(api.openedFilesTree.provider.getTreeItem(fileNode).iconPath, undefined);
    assert.ok(api.openedFilesTree.provider.getTreeItem(fileNode).resourceUri);
  });
  test('INT-237 高对比度主题自动回退原生树图标并在普通主题恢复彩色', async () => {
    const api = await getApi();
    const previousTheme = getPersonalConfiguration('workbench').inspect<string>('colorTheme')?.globalValue;
    const previousAutoDetect = getPersonalConfiguration('window').inspect<boolean>('autoDetectColorScheme')?.globalValue;
    const themes = vscode.extensions.getExtension('vscode.theme-defaults')?.packageJSON.contributes.themes as
      Array<{ id: string; uiTheme: string }> | undefined;
    assert.ok(themes);
    const catalog = createStoredCatalog('主题切换测试', []);
    await seedCatalogs(api, [catalog], catalog.id);
    await openText(projectUri(api, 'test-fixtures/workspace-one/src/app.ts'));
    api.openedFilesTree.provider.refresh();
    let projectRefreshes = 0;
    let configurationRefreshes = 0;
    let fileRefreshes = 0;
    const subscriptions = [
      api.catalogs.projectProvider.onDidChangeTreeData(() => { projectRefreshes += 1; }),
      api.catalogs.configurationProvider.onDidChangeTreeData(() => { configurationRefreshes += 1; }),
      api.openedFilesTree.provider.onDidChangeTreeData(() => { fileRefreshes += 1; }),
    ];
    try {
      await setGlobalSetting('window', 'autoDetectColorScheme', false);
      for (const [uiTheme, kind, highContrast] of [
        ['hc-black', vscode.ColorThemeKind.HighContrast, true],
        ['hc-light', vscode.ColorThemeKind.HighContrastLight, true],
        ['vs-dark', vscode.ColorThemeKind.Dark, false],
        ['vs', vscode.ColorThemeKind.Light, false],
      ] as const) {
        const theme = themes.find((candidate) => candidate.uiTheme === uiTheme);
        assert.ok(theme);
        const before = [projectRefreshes, configurationRefreshes, fileRefreshes];
        await setGlobalSetting('workbench', 'colorTheme', theme.id);
        await waitUntil(() => vscode.window.activeColorTheme.kind === kind
          && projectRefreshes > before[0]! && configurationRefreshes > before[1]! && fileRefreshes > before[2]!,
        `主题 ${theme.id} 未刷新三个树视图`);
        const summary = api.catalogs.projectProvider.getChildren()[0];
        assert.ok(summary);
        const projectIcon = api.catalogs.projectProvider.getTreeItem(summary).iconPath;
        const configNode = api.catalogs.configurationProvider.getChildren()[0] as ConfigurationTreeNode;
        const configIcon = api.catalogs.configurationProvider.getTreeItem(configNode).iconPath;
        const fileNode = flattenOpenedFileTree(api.openedFilesTree.provider.getRootsForIntegrationTest())
          .find((node) => node.kind === 'file');
        assert.ok(fileNode);
        const fileItem = api.openedFilesTree.provider.getTreeItem(fileNode);
        if (highContrast) {
          assert.ok(projectIcon instanceof vscode.ThemeIcon);
          assert.ok(configIcon instanceof vscode.ThemeIcon);
          assert.equal(fileItem.iconPath, undefined);
          assert.ok(fileItem.resourceUri);
        } else {
          assert.ok(isTreeIconPath(projectIcon));
          assert.ok(isTreeIconPath(configIcon));
          assert.ok(isTreeIconPath(fileItem.iconPath));
        }
        assert.equal(getPersonalConfiguration('projectManager.visuals').get('iconStyle'), 'unified');
      }
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      await setGlobalSetting('workbench', 'colorTheme', previousTheme);
      await setGlobalSetting('window', 'autoDetectColorScheme', previousAutoDetect);
    }
  });

});

function isTreeIconPath(value: unknown): boolean {
  return value !== undefined
    && value !== null
    && typeof value === 'object'
    && !(value instanceof vscode.ThemeIcon)
    && !(value instanceof vscode.Uri)
    && 'light' in value
    && 'dark' in value;
}
