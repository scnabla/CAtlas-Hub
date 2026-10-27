import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

// 使用本机 Linux VS Code 可执行文件，测试数据和扩展仍写入项目隔离目录。
export async function prepareLocalTestConfig(root, executable, candidate, env, run) {
  if (process.platform !== 'linux' || !path.isAbsolute(executable)) {
    throw new Error('PROJECT_BUTLER_TEST_VSCODE_EXECUTABLE 必须指定 Linux VS Code 可执行文件的绝对路径。');
  }
  await access(executable, constants.X_OK);
  const cache = path.join(root, '.vscode-test');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, 'local-linux-'));
  const isolation = [
    `--user-data-dir=${path.join(directory, 'user-data')}`,
    `--extensions-dir=${path.join(directory, 'extensions')}`,
    `--shared-data-dir=${path.join(directory, 'shared-data')}`,
  ];
  const [cli] = resolveCliArgsFromVSCodeExecutablePath(executable);
  await run(cli, [...isolation, '--install-extension', candidate], root, env);
  const configPath = path.join(directory, 'config.mjs');
  await writeFile(configPath, `import configs from ${JSON.stringify(pathToFileURL(path.join(root, '.vscode-test.mjs')).href)};
import path from 'node:path';
export default configs.map(config => ({ ...config,
  files: (Array.isArray(config.files) ? config.files : [config.files]).map(file => path.resolve(${JSON.stringify(root)}, file)),
  useInstallation: { fromPath: ${JSON.stringify(executable)} },
  skipExtensionDependencies: true,
  installExtensions: [],
  launchArgs: [...config.launchArgs.filter(arg => !arg.startsWith('--shared-data-dir=')), ...${JSON.stringify(isolation)}],
}));
`, { flag: 'wx' });
  console.log(`本机测试运行时：${executable}；隔离目录：${directory}`);
  return configPath;
}
