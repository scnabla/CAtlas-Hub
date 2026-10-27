import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) throw new Error('--out 需要文件路径');
const output = path.resolve(args[outputIndex + 1] && outputIndex >= 0
  ? args[outputIndex + 1] : path.join(root, '.vscode-test/icon-gallery.html'));
const symbolsOnly = args.includes('--symbols-only');
const baseline = path.join(root, 'media/icons/baseline');
const manifest = JSON.parse(await readFile(path.join(baseline, 'manifest.json'), 'utf8'));
const all = new Map(manifest.icons.map(icon => [icon.id, icon]));
const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const common = ['symbol-macro-definition', 'symbol-function', 'symbol-method', 'symbol-constructor',
  'symbol-variable', 'symbol-constant', 'symbol-field', 'symbol-class', 'symbol-struct',
  'symbol-enum', 'symbol-enum-member', 'symbol-namespace', 'symbol-type-parameter'];
const groups = [
  ['常用代码符号', common.map(id => all.get(id))],
  ['其他符号类型', manifest.icons.filter(i => i.id.startsWith('symbol-') && !common.includes(i.id))],
  ...(!symbolsOnly ? [['项目与配置', manifest.icons.filter(i => !i.id.startsWith('symbol-'))]] : []),
];
const encode = (svg, color) => `data:image/svg+xml;base64,${Buffer.from(svg.replaceAll('currentColor', color)).toString('base64')}`;
async function row(icon, state = false) {
  const cells = [];
  for (const [mode, color] of [['light', '#333333'], ['dark', '#DDDDDD'], ['monochrome', '#FFFFFF']]) {
    const svg = await readFile(path.resolve(baseline, state ? icon.file : icon.files[mode]), 'utf8');
    const uri = encode(svg, color);
    const sizes = state ? [8, 12] : [16, 18, 24];
    cells.push(`<td class="${mode}">${sizes.map(size => `<img src="${uri}" width="${size}" height="${size}" alt="">`).join('')}</td>`);
  }
  return `<tr data-icon="${escape(icon.id)}"><th scope="row">${escape(icon.label)}</th>${cells.join('')}</tr>`;
}
const sections = [];
for (const [title, icons] of groups) {
  sections.push(`<section><h2>${title}</h2><table><thead><tr><th>符号</th><th>浅色</th><th>深色</th><th>单色</th></tr></thead><tbody>${(await Promise.all(icons.map(i => row(i)))).join('\n')}</tbody></table></section>`);
}
if (!symbolsOnly) sections.push(`<section><h2>状态角标</h2><p>每格显示 8px 和 12px。</p><table><thead><tr><th>状态</th><th>浅色</th><th>深色</th><th>单色</th></tr></thead><tbody>${(await Promise.all(manifest.states.map(i => row(i, true)))).join('\n')}</tbody></table></section>`);
sections.push(`<section><h2>条件编译</h2><p>指令保留 #，条件表达式紧随其后，每条指令仅显示一次。</p><table><thead><tr><th>浅色</th><th>深色</th><th>单色</th></tr></thead><tbody>${[
  ['#if', 'MODE == 1'], ['#ifdef', 'FEATURE'], ['#ifndef', 'FEATURE'], ['#elif', 'MODE == 2'], ['#else', ''],
].map(([directive, expression]) => `<tr>${['light', 'dark', 'monochrome'].map(mode => `<td class="${mode} directive-example"><strong>${directive}</strong>${expression ? ' ' + expression : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`);
const title = symbolsOnly ? 'CAtlas Hub 大纲图标' : 'CAtlas Hub 图标总览';
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#16191d;color:#eef0f3;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:auto}h1{font-size:24px;margin:0 0 12px}h2{font-size:18px;margin:28px 0 12px}p,footer{color:#bac5d0;line-height:1.7}table{border-collapse:collapse;width:100%}th,td{padding:8px 18px;border:1px solid #53606c}th{text-align:left;font-weight:500}thead th{font-weight:600}td{text-align:center;width:22%;height:46px}img{vertical-align:middle;margin:0 16px}.light{background:#fff}.dark{background:#1f1f1f}.monochrome{background:#000}.directive-example{font:14px Consolas,"DejaVu Sans Mono",monospace;text-align:left;white-space:nowrap}.directive-example.light{color:#202020}.directive-example.dark{color:#ddd}.directive-example.monochrome{color:#fff}.directive-example.light strong{color:#9A6700}.directive-example.dark strong{color:#FFCA28}a{color:#89c9ff}footer{font-size:12px;margin-top:22px}@media(max-width:600px){body{padding:12px}td,th{padding:8px}img{margin:0 5px}h1{font-size:21px}}
</style></head><body><main><h1>${title}</h1>
<p>每格显示 16px、18px 和 24px。自绘符号使用分类配色；函数使用 f，变量使用紫色 var，宏定义使用单独的 #。条件编译指令使用等宽文字。</p>
<p>大纲实际显示的类别由语言扩展提供，宏与条件编译由增强大纲补充。</p>
${sections.join('\n')}
</main></body></html>\n`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(output);
