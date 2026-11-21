import * as vscode from 'vscode';
import { OpenedFilesDirectoryPage } from './openedFilesDirectoryPage';
import { ProjectFeatureConfigurationSource } from '../configuration/configurationTypes';
import { TabManagementService } from './tabManagementService';

export function registerTabManagement(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  catalogService: ProjectFeatureConfigurationSource,
  directory: OpenedFilesDirectoryPage,
): TabManagementService {
  const service = new TabManagementService(output, catalogService, context.workspaceState, directory);
  context.subscriptions.push(
    service,
    vscode.commands.registerCommand('projectManager.organizeCurrentTabGroup', async () => service.organizeCurrentGroup()),
  );
  return service;
}
