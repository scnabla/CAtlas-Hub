import * as vscode from 'vscode';
import { directoryPageId, OpenedFilesDirectoryPage } from './openedFilesDirectoryPage';
import { OpenedFilesTreeProvider } from './openedFilesTreeProvider';
import { OpenedFilesViewModeService } from './openedFilesViewModeService';

export interface RegisteredOpenedFilesTree {
  readonly page: OpenedFilesDirectoryPage;
  readonly provider: OpenedFilesTreeProvider;
  readonly modeService: OpenedFilesViewModeService;
}

export function registerOpenedFilesTree(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): RegisteredOpenedFilesTree {
  const provider = new OpenedFilesTreeProvider(output, context.extensionUri);
  const modeService = new OpenedFilesViewModeService(context.globalState, output);
  const page = new OpenedFilesDirectoryPage(provider, () => modeService.mode === 'directoryTree');
  context.subscriptions.push(
    provider,
    vscode.window.registerCustomEditorProvider(directoryPageId, page, { webviewOptions: { enableFindWidget: true } }),
    vscode.window.registerWebviewPanelSerializer(directoryPageId, page),
    vscode.commands.registerCommand('projectManager.openOpenedFilesDirectory', () => page.show()),
    modeService,
    vscode.commands.registerCommand('projectManager.focusOpenedFile', async (node) => provider.focusFile(node)),
    vscode.commands.registerCommand('projectManager.hideNativeOpenEditors', async () => modeService.requestNativeMutualExclusion()),
    vscode.commands.registerCommand('projectManager.restoreNativeOpenEditors', async () => modeService.restoreNativeOpenEditors()),
  );
  return { provider, modeService, page };
}
