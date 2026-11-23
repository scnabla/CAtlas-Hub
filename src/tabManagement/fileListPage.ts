import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { getUriDisplayPath } from '../shared/uri';
import type { OpenedFileTreeNode } from './openedFilesTreeModel';

export interface FileListRow {
  key: string;
  label: string;
  children?: FileListRow[];
  title?: string;
}

export function fileListRow(node: OpenedFileTreeNode, onFile?: (file: OpenedFileTreeNode) => void): FileListRow {
  const label = node.label.replace(/\r/g, '␍').replace(/\n/g, '␊');
  if (node.kind === 'file') {
    onFile?.(node);
    return { key: node.id, label, title: node.uri ? getUriDisplayPath(vscode.Uri.parse(node.uri)) : label };
  }
  return { key: node.id, label, children: node.children.map(child => fileListRow(child, onFile)) };
}

// vscode.openWith 的公开选项无法同时指定后台打开、固定和首位。
// 使用其工作台命令，以一次操作插入清单，避免切走正在编辑的文档。
export async function openFileListTab(uri: vscode.Uri, editorId: string, column: vscode.ViewColumn, background: boolean): Promise<void> {
  await vscode.commands.executeCommand('_workbench.openWith', uri, editorId, [
    column - 1, { sticky: true, index: 0, pinned: true, inactive: background, preserveFocus: background },
  ]);
}

export function fileListGesture(uri: vscode.Uri, subject: '路径' | '文件名') {
  const config = vscode.workspace.getConfiguration('editor', { uri, languageId: 'plaintext' });
  const mac = process.platform === 'darwin';
  const key = config.get('multiCursorModifier') === 'ctrlCmd' ? 'altKey' : mac ? 'metaKey' : 'ctrlKey';
  const name = key === 'altKey' ? (mac ? 'Option' : 'Alt') : mac ? 'Cmd' : 'Ctrl';
  const modifier = config.get('links', true) ? key : undefined;
  return { modifier, hint: modifier ? `双击${subject}，或按住 ${name} 并点击${subject}，跳转到文件` : `双击${subject}，跳转到文件` };
}

export function bindFileListPage(
  panel: vscode.WebviewPanel, uri: vscode.Uri, emptyHint: string,
  getRows: () => FileListRow[], changed: vscode.Event<unknown>,
  select: (key: string) => void | Promise<void>,
): void {
  panel.webview.options = { enableScripts: true, localResourceRoots: [] };
  const nonce = randomUUID();
  function pageData() {
    const rows = getRows();
    const gesture = fileListGesture(uri, '文件名');
    return { ...gesture, hint: rows.length ? gesture.hint : emptyHint, rows };
  }
  const initial = JSON.stringify(pageData());
  let previous = initial;
  let ready = false;
  function update() {
    if (!ready || !panel.visible) return;
    const data = pageData();
    const signature = JSON.stringify(data);
    if (signature !== previous) {
      previous = signature;
      void panel.webview.postMessage(data);
    }
  }
  const listeners = vscode.Disposable.from(
    changed(() => update()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('editor.multiCursorModifier') || event.affectsConfiguration('editor.links')) update();
    }),
    panel.onDidChangeViewState(() => update()),
    panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'ready') {
        ready = true;
        previous = initial;
        update();
      }
      if (message?.type === 'select' && typeof message.key === 'string') await select(message.key);
    }),
  );
  panel.onDidDispose(() => listeners.dispose());
  panel.webview.html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">
body{color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:var(--vscode-editor-font-size) var(--vscode-editor-font-family);padding:8px 14px;line-height:1.6}
strong{display:block;margin-bottom:.45em}ul{margin:0;padding:0;list-style:none}
.entry{display:flex;align-items:baseline}
.tree-item{position:relative;padding-inline-start:1em}
.tree-item::before,.tree-item::after{content:"";position:absolute;inset-inline-start:.12em;pointer-events:none;border-color:var(--vscode-descriptionForeground)}
.tree-item::before{top:0;bottom:0;border-inline-start-style:solid;border-inline-start-width:2px}
.tree-item:last-child::before{bottom:auto;height:.8em}
.tree-item::after{top:.8em;width:.55em;border-top-style:solid;border-top-width:2px}
.folder,.file{min-width:0;overflow-wrap:anywhere}
button{all:unset;font:inherit;color:inherit;cursor:pointer;white-space:pre-wrap;overflow-wrap:anywhere}
.file{user-select:text;color:var(--vscode-projectManager-fileListNameForeground,var(--vscode-editor-foreground))}.file:hover,.file:focus-visible{text-decoration:underline}.folder{color:var(--vscode-projectManager-fileListPathForeground,var(--vscode-editor-foreground))}
button:focus-visible{outline:1px solid var(--vscode-focusBorder)}
</style></head><body><strong id="hint"></strong><ul id="rows"></ul><script nonce="${nonce}">
const host=acquireVsCodeApi(),rows=document.getElementById('rows'),hint=document.getElementById('hint');
let modifier;
function renderRows(items,showBranches){
  return items.map(row=>{
    const li=document.createElement('li'),entry=document.createElement('div');
    entry.className='entry';li.append(entry);
    if(showBranches)li.className='tree-item';
    if(row.children){
      const folder=document.createElement('span'),list=document.createElement('ul');
      folder.className='folder';folder.textContent=row.label;entry.append(folder);
      list.append(...renderRows(row.children,true));li.append(list);
    }else{
      const button=document.createElement('button');button.type='button';button.className='file';
      button.append(row.label);button.dataset.key=row.key;if(row.title)button.title=row.title;
      entry.append(button);
    }
    return li;
  });
}
function select(button){host.postMessage({type:'select',key:button.dataset.key});}
rows.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||event.button!==0)return;
  if(event.detail===0||(modifier&&event[modifier]&&event.detail===1))select(b);
});
rows.addEventListener('dblclick',event=>{
  const b=event.target.closest('button.file');
  if(b&&event.button===0&&!(modifier&&event[modifier])){event.preventDefault();select(b);}
});
function render(data){
  const focused=document.activeElement?.dataset?.key;
  modifier=data.modifier;hint.textContent=data.hint;
  rows.replaceChildren(...renderRows(data.rows,data.rows.length>1));
  if(focused){const next=[...rows.querySelectorAll('button')].find(b=>b.dataset.key===focused);next?.focus({preventScroll:true});}
}
window.addEventListener('message',({data})=>render(data));
render(${initial.replace(/</g, '\\u003c')});
host.postMessage({type:'ready'});
</script></body></html>`;
}
