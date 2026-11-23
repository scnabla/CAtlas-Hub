import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist/shell/vendor');
await mkdir(output, { recursive: true });
for (const [module, files] of [
  ['web-tree-sitter', ['tree-sitter.cjs', 'tree-sitter.wasm', 'LICENSE']],
  ['tree-sitter-bash', ['tree-sitter-bash.wasm', 'LICENSE']],
]) {
  for (const file of files) {
    const name = file === 'LICENSE' ? module + '-LICENSE' : file;
    await copyFile(path.join(root, 'node_modules', module, file), path.join(output, name));
  }
}
