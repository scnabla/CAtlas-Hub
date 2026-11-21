import * as vscode from 'vscode';
import { onDidChangePersonalConfiguration } from '../configuration/personalConfiguration';
import { directoryPageId, OpenedFilesDirectoryPage } from './openedFilesDirectoryPage';
import { OpenedFilesTreeProvider } from './openedFilesTreeProvider';
import { OpenedFilesViewModeService } from './openedFilesViewModeService';

export interface RegisteredOpenedFilesTree {
  readonly provider: OpenedFilesTreeProvider;
  readonly modeService: OpenedFilesViewModeService;
}

export function registerOpenedFilesTree(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): RegisteredOpenedFilesTree {
  const provider = new OpenedFilesTreeProvider(output, context.extensionUri);
  const page = new OpenedFilesDirectoryPage(provider);
  const modeService = new OpenedFilesViewModeService(context.globalState, output);
  context.subscriptions.push(
    provider,
    page,
    vscode.window.registerWebviewPanelSerializer(directoryPageId, page),
    vscode.commands.registerCommand('projectManager.openOpenedFilesDirectory', () => page.show()),
    onDidChangePersonalConfiguration(event => {
      if (event.affectsConfiguration('projectManager.tabs.openFilesView') && modeService.mode === 'native') page.dispose();
    }),
    modeService,
    vscode.commands.registerCommand('projectManager.focusOpenedFile', async (node) => provider.focusFile(node)),
    vscode.commands.registerCommand('projectManager.hideNativeOpenEditors', async () => modeService.requestNativeMutualExclusion()),
    vscode.commands.registerCommand('projectManager.restoreNativeOpenEditors', async () => modeService.restoreNativeOpenEditors()),
  );
  return { provider, modeService };
}
