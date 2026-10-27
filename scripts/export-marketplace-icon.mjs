import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Resvg } from '@resvg/resvg-js';

// 从现有 SVG 导出商店图标；运行环境提供字体，默认不覆盖已有文件。
const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: {
  out: { type: 'string', default: 'media/catlas-hub.png' },
  replace: { type: 'boolean', default: false },
} });
const source = await readFile(path.join(root, 'media/catlas-hub.svg'));
const renderer = new Resvg(source, {
  fitTo: { mode: 'width', value: 256 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
});
const target = path.resolve(root, values.out);
await writeFile(target, renderer.render().asPng(), { flag: values.replace ? 'w' : 'wx' });
console.log(`已生成 ${target}（256×256）。`);
