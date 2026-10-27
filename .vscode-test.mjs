import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';
import { candidateConfig, isolatedStorageArgs, testVscodeVersion } from './.vscode-test-installed-candidate.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    label: 'todoOomRegression',
    files: 'dist/integrationTest/todoOomRegression.test.js',
    version: testVscodeVersion,
    env: { CATLAS_PERSONAL_DATA_DIRECTORY: process.env.CATLAS_PERSONAL_DATA_DIRECTORY ?? path.join(projectRoot, '.vscode-test', 'personal-data-source') },
    extensionDevelopmentPath: projectRoot,
    workspaceFolder: path.join(projectRoot, 'test-fixtures', 'workspace-one'),
    launchArgs: [
      ...isolatedStorageArgs,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    mocha: {
      ui: 'tdd',
      timeout: 10_000,
      color: true,
    },
  },
  {
    label: 'extensionHost',
    files: [
      'dist/integrationTest/extensionHost.test.js',
      'dist/integrationTest/configuration.test.js',
      'dist/integrationTest/dataLocation.test.js',
      'dist/integrationTest/contextAndCatalog.test.js',
      'dist/integrationTest/tabs.test.js',
      'dist/integrationTest/exclusions.test.js',
      'dist/integrationTest/externalFiles.test.js',
      'dist/integrationTest/outline.test.js',
      'dist/integrationTest/buildAndSafety.test.js',
      'dist/integrationTest/compatibility.test.js',
      'dist/integrationTest/visuals.test.js',
      'dist/integrationTest/todo.test.js',
    ],
    version: testVscodeVersion,
    env: { CATLAS_PERSONAL_DATA_DIRECTORY: process.env.CATLAS_PERSONAL_DATA_DIRECTORY ?? path.join(projectRoot, '.vscode-test', 'personal-data-source') },
    extensionDevelopmentPath: projectRoot,
    workspaceFolder: path.join(projectRoot, 'test-fixtures', 'workspace-one'),
    launchArgs: [
      ...isolatedStorageArgs,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    mocha: {
      ui: 'tdd',
      timeout: 30_000,
      color: true,
    },
  },
  { ...candidateConfig, label: 'installedVsix' },
]);
