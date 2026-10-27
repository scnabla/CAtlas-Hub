import { getPersonalConfiguration } from '../configuration/personalConfiguration';
import * as vscode from 'vscode';
import {
  isRegisteredCommand,
  resolveVscodeCapabilities,
  VscodeCapabilities,
} from './vscodeCapabilitiesModel';

export type { CapabilityStatus, VscodeCapabilities } from './vscodeCapabilitiesModel';

export function detectVscodeCapabilities(): VscodeCapabilities {
  const chatSetting = getPersonalConfiguration('chat').inspect<unknown>('disableAIFeatures');
  return resolveVscodeCapabilities(vscode.version, {
    chatDisableAiFeatures: chatSetting !== undefined && typeof chatSetting.defaultValue === 'boolean',
  });
}

export async function hasVscodeCommand(command: string): Promise<boolean> {
  return isRegisteredCommand(command, await vscode.commands.getCommands(true));
}
