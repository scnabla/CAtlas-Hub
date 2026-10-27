/**
 * 插件启动入口：组装项目集合、配置、标签、增强大纲和 TODO，并统一登记需要释放的资源。
 * 当前项目集合使用 registerProjectCatalogV2；阅读旧版集合代码时，不要误认为它仍是激活入口。
 * 配置来源先绑定，TODO 再等待集合初始化完成，避免启动扫描使用尚未恢复的集合配置。
 * 返回的 ProjectButlerApi 暴露实际运行实例供集成测试使用，修改注册顺序时也要检查测试调用。
 */
import * as vscode from 'vscode';
import { registerDataLocationCommand } from './configuration/dataLocationCommand';
import { initializePersonalConfiguration } from './configuration/personalConfiguration';
import { registerExcludeResourcesCommand } from './exclusions/excludeResourcesCommand';
import { ExclusionServiceV2 } from './exclusions/exclusionServiceV2';
import { registerManageExclusionsCommand } from './exclusions/manageExclusionsCommand';
import { ExternalFileMonitor } from './externalFiles/externalFileMonitor';
import { registerProjectCatalogV2 } from './projectCatalog/registerProjectCatalogV2';
import { registerSymbolOutline } from './symbolOutline/symbolOutlineViewProvider';
import { registerTabManagement } from './tabManagement/registerTabManagement';
import { registerOpenedFilesTree } from './tabManagement/registerOpenedFilesTree';
import { ProjectButlerApi } from './testing/projectButlerApi';
import { registerTodo } from './todo/registerTodo';
import { bindTodoFeatureConfigurationSource } from './todo/todoSettings';

export async function activate(context: vscode.ExtensionContext): Promise<ProjectButlerApi> {
  const personal = await initializePersonalConfiguration(context);
  context = personal.context;
  context.subscriptions.push(registerDataLocationCommand(personal.store));
  const output = vscode.window.createOutputChannel('CAtlas Hub');
  const exclusionService = new ExclusionServiceV2(output, context.workspaceState);
  const externalFileMonitor = new ExternalFileMonitor(output);

  context.subscriptions.push(
    output,
    externalFileMonitor,
    vscode.commands.registerCommand(
      'projectManager.showExternalFiles',
      async () => externalFileMonitor.showOpenExternalFiles(),
    ),
    vscode.commands.registerCommand(
      'projectManager.diagnoseActiveFile',
      async () => externalFileMonitor.diagnoseActiveFile(),
    ),
  );

  registerExcludeResourcesCommand(context, exclusionService, output);
  registerManageExclusionsCommand(context, exclusionService, output);
  const catalogs = registerProjectCatalogV2(context, output);
  context.subscriptions.push(personal.store.onChange((before, after, external) => {
    if (external && JSON.stringify(before.state['projectManager.catalogLibrary.v1']) !== JSON.stringify(after.state['projectManager.catalogLibrary.v1'])) {
      void catalogs.initialization.then(() => catalogs.service.reloadPersonalLibrary())
        .catch(() => output.appendLine('外部项目集合读取失败，请刷新后重试。'));
    }
  }));
  context.subscriptions.push(bindTodoFeatureConfigurationSource(catalogs.service));
  const tabs = registerTabManagement(context, output, catalogs.service);
  const openedFilesTree = registerOpenedFilesTree(context, output);
  const outline = registerSymbolOutline(context, output, catalogs.service);
  const todo = registerTodo(context, output, catalogs.service, catalogs.initialization);
  output.appendLine('CAtlas Hub已激活。');
  return {
    context,
    personalData: personal.store,
    output,
    exclusions: exclusionService,
    externalFiles: externalFileMonitor,
    catalogs,
    tabs,
    openedFilesTree,
    outline,
    todo,
  };
}

export function deactivate(): void {
  // 所有资源均由 ExtensionContext.subscriptions 统一释放。
}
