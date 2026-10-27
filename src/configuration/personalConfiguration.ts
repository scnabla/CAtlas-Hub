import * as vscode from 'vscode';
import * as path from 'node:path';
import { PersonalDataStore, personalDataPath } from '../storage/personalDataStore';

const EXTERNAL_STATE_KEYS = new Set([
  'projectManager.catalogLibrary.v1', 'projectManager.catalogLibrary.lastActiveId',
  'projectManager.catalogLibrary.projectBindings', 'projectManager.configurationView.groupExpansion',
]);
let store: PersonalDataStore | undefined;
const changed = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();

export async function initializePersonalConfiguration(context: vscode.ExtensionContext): Promise<{
  context: vscode.ExtensionContext; store: PersonalDataStore;
}> {
  // 测试和开发宿主使用隔离目录；安装态测试也必须由运行器显式提供隔离路径。
  const isolation = process.env.CATLAS_PERSONAL_DATA_DIRECTORY;
  const file = isolation ? path.join(isolation, 'personal-data.dat')
    : context.extensionMode === vscode.ExtensionMode.Production ? personalDataPath()
      : path.join(context.globalStorageUri.fsPath, 'isolated-personal-data.dat');
  const next = new PersonalDataStore(file);
  try { await next.initialize(); }
  catch (error) {
    next.dispose();
    await vscode.window.showErrorMessage('无法读取或保存 CAtlas Hub 个人数据，原文件已保留。请检查数据保存目录是否可访问，以及目录权限和可用空间。');
    throw error;
  }
  store = next;
  context.subscriptions.push(next, { dispose() { if (store === next) store = undefined; } });
  context.subscriptions.push(next.onChange((before, after) => {
    const keys = [...new Set([...Object.keys(before.preferences), ...Object.keys(after.preferences)])]
      .filter((key) => JSON.stringify(before.preferences[key]) !== JSON.stringify(after.preferences[key]));
    if (keys.length) changed.fire({ affectsConfiguration: (section) => keys.some((key) => key === section || key.startsWith(section + '.')) });
  }));
  let warned = false;
  next.watch(() => {
    if (warned) return; warned = true;
    void vscode.window.showErrorMessage('CAtlas Hub 个人数据读取失败，当前配置继续使用上次成功读取的内容。请检查数据文件和目录权限。');
  });
  const original = context.globalState;
  const globalState: vscode.ExtensionContext['globalState'] = {
    keys: () => [...new Set([...original.keys().filter((key) => !EXTERNAL_STATE_KEYS.has(key)), ...Object.keys(next.snapshot().state)])],
    get: <T>(key: string, fallback?: T): T | undefined => EXTERNAL_STATE_KEYS.has(key) ? next.get<T>('state', key, fallback) : original.get<T>(key, fallback as T),
    update: (key: string, value: unknown) => EXTERNAL_STATE_KEYS.has(key) ? next.update('state', key, value) : original.update(key, value),
    setKeysForSync: (keys: readonly string[]) => original.setKeysForSync(keys.filter((key) => !EXTERNAL_STATE_KEYS.has(key))),
  };
  const wrapped = new Proxy({} as vscode.ExtensionContext, { get: (_target, key) => key === 'globalState' ? globalState : Reflect.get(context, key, context) });
  return { context: wrapped, store: next };
}

/** 插件个人值来自独立文件；工作区覆盖和 VS Code 自身设置继续遵循 VS Code。 */
export function getPersonalConfiguration(section?: string, scope?: vscode.ConfigurationScope | null): vscode.WorkspaceConfiguration {
  const native = vscode.workspace.getConfiguration(section, scope);
  const fullKey = (key: string): string => section ? section + '.' + key : key;
  const isPersonal = (key: string): boolean => !!store && fullKey(key).startsWith('projectManager.');
  const inspect = <T>(key: string): ReturnType<vscode.WorkspaceConfiguration['inspect']> => {
    const value = native.inspect<T>(key);
    return !isPersonal(key) ? value : { ...value, key: fullKey(key), globalValue: store!.get<T>('preferences', fullKey(key)) };
  };
  return {
    ...native,
    has: (key) => isPersonal(key) ? native.has(key) || store!.get('preferences', fullKey(key)) !== undefined : native.has(key),
    inspect: inspect as vscode.WorkspaceConfiguration['inspect'],
    get: (<T>(key: string, fallback?: T): T | undefined => {
      if (!isPersonal(key)) return native.get<T>(key, fallback as T);
      const value = inspect<T>(key);
      return (value?.workspaceFolderLanguageValue ?? value?.workspaceLanguageValue
        ?? value?.workspaceFolderValue ?? value?.workspaceValue ?? value?.globalValue
        ?? value?.defaultLanguageValue ?? value?.defaultValue ?? fallback) as T | undefined;
    }) as vscode.WorkspaceConfiguration['get'],
    update: async (key, value, target, overrideInLanguage) => {
      if (!isPersonal(key) || (target !== true && target !== vscode.ConfigurationTarget.Global)) {
        return native.update(key, value, target, overrideInLanguage);
      }
      await store!.update('preferences', fullKey(key), value);
    },
  };
}

export const onDidChangePersonalConfiguration: vscode.Event<vscode.ConfigurationChangeEvent> = (listener, thisArgs, disposables) => {
  const result = vscode.Disposable.from(
    vscode.workspace.onDidChangeConfiguration(listener, thisArgs), changed.event(listener, thisArgs),
  );
  disposables?.push(result); return result;
};
