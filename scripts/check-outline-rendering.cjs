const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[3] || path.join(root, '.vscode-test/outline-rendering'));
fs.mkdirSync(output, {recursive:true});
const originalLoad = Module._load;
const uri = p => ({fsPath:p,toString:()=>pathToFileURL(p).href});
Module._load = function(name,...args){
  if(name==='vscode') return {Uri:{joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts))}};
  return originalLoad.call(this,name,...args);
};
const {getSymbolOutlineHtml} = require(path.join(root,'dist/symbolOutline/webviewHtml.js'));
const {getOutlineSymbolPresentation} = require(path.join(root,'dist/symbolOutline/symbolModel.js'));
const {getSymbolIconMetadata} = require(path.join(root,'dist/visual/iconSemantics.js'));
const examples=[['#if MODE == 1','PreprocessorRegion'],['#ifdef FEATURE','PreprocessorRegion'],['#ifndef FEATURE','PreprocessorRegion'],['#elif MODE == 2','PreprocessorBranch'],['#else','PreprocessorBranch'],['calculate','Function'],['value','Variable'],['MAX_COUNT','MacroDefinition'],['42','Number']];
const symbols=examples.map(([name,kind],line)=>({id:'row-'+line,editKey:'row-'+line,name,kind,detail:'',containerName:'',parentPath:'',range:{start:{line,character:0},end:{line,character:25}},selectionRange:{start:{line,character:0},end:{line,character:25}},span:1,isLong:false,isEdited:false,isContext:false,children:[],iconSemantic:getSymbolIconMetadata(kind,name).semantic,...getOutlineSymbolPresentation(kind,name)}));
const state={status:'ready',message:'',fileName:'',filePath:'',languageId:'c',external:false,dirty:false,query:'',currentId:'',totalCount:9,visibleCount:9,symbols,preferences:{mode:'both',scope:'all',sort:'source',appearance:'vscode',showLineMetrics:false,highlightLongFunctions:false,highlightEditedSymbols:false,scale:100,iconStyle:'unified'},nativeOutlineNotice:false,nativeOutlineNoticeExpanded:false};
let html=getSymbolOutlineHtml({cspSource:'data:',asWebviewUri:x=>({toString:()=> 'data:image/svg+xml;base64,'+fs.readFileSync(x.fsPath).toString('base64')})},uri(root));
const nonce=html.match(/<style nonce="([^"]+)"/)[1];
const css=`:root{--vscode-sideBar-background:#1f1f1f;--vscode-sideBar-foreground:#ddd;--vscode-font-family:system-ui;--vscode-editor-font-family:${process.platform === 'win32' ? 'Consolas,"Courier New"' : '"DejaVu Sans Mono"'},monospace;--vscode-list-activeSelectionBackground:#264f78;--vscode-list-activeSelectionForeground:white;--vscode-focusBorder:#007acc;--vscode-descriptionForeground:#aaa;--vscode-list-hoverBackground:#333}.toolbar,.count{display:none}body{padding:24px}.shell{height:auto}.list-wrap{overflow:visible}h1{font:20px system-ui;margin:0 0 20px}.symbol-row{min-height:34px}#verification{display:none}`;
const boot=`window.testMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.testMessages.push(m)});`;
const check=`
const state=${JSON.stringify(state)};
const checks=[];
for(const theme of ['vscode-light','vscode-dark','vscode-high-contrast','vscode-high-contrast-light']){
 for(const scale of [90,100,150]){
  document.body.className=theme;state.preferences.scale=scale;
  window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));
  const rows=[...document.querySelectorAll('.symbol-row')];
  if(rows.length!==9)throw Error('row count');
  rows.slice(0,5).forEach((row,i)=>{
   const prefix=row.querySelector('.preprocessor-directive');const label=row.querySelector('.symbol-name');
   if(!prefix || row.querySelector('.kind-icon'))throw Error('directive has icon or missing prefix');
   if(prefix.textContent.trimEnd()!==state.symbols[i].directive || label.textContent!==state.symbols[i].displayName)throw Error('duplicate or wrong directive');
   if(label.title!==state.symbols[i].name)throw Error('original name lost');
   const style=getComputedStyle(prefix);
   if(style.fontStyle!=='normal' || style.transform!=='none')throw Error('distorted font');
   if(prefix.getBoundingClientRect().width<parseFloat(style.fontSize)*prefix.textContent.length*.45)throw Error('compressed width');
   row.click();if(window.testMessages.at(-1).id!==state.symbols[i].id)throw Error('jump target changed');
  });
  for(const query of ['#elif MODE','MODE == 2','#ELIF MODE','#elif','MODE','not-found']) {
    state.query=query;
    window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));
    const row=document.querySelector('[data-id="row-3"]');
    const highlighted=[...row.querySelectorAll('mark')].map(node=>node.textContent).join('');
    if(highlighted.toLowerCase()!==(query==='not-found'?'':query.toLowerCase()))throw Error('cross-fragment highlight: '+query);
    const directive=row.querySelector('.preprocessor-directive');
    const label=row.querySelector('.symbol-name');
    if(directive.textContent+label.textContent!=='#elif MODE == 2')throw Error('directive spacing or duplicate');
    row.click();if(window.testMessages.at(-1).id!=='row-3')throw Error('highlight changed jump');
  }
  state.query='';
  checks.push({theme,scale,rows:5,highlightQueries:6,passed:true});
 }
}
// 两份不同内容的设备树以不同顺序渲染，颜色取决于深度，而非文件或节点名称。
const dtsState = {...state, languageId:'dts', preferences:{...state.preferences}};
function node(id, children=[]) {
  return {...state.symbols[0], id, name:id, displayName:id, kind:'Namespace',
    iconSemantic:'symbol.namespace', directive:'', children};
}
for (const theme of ['vscode-light','vscode-dark','vscode-high-contrast','vscode-high-contrast-light']) {
  document.body.className=theme;
  for (const scale of [90,100,150]) {
    dtsState.preferences.scale=scale;
    let firstColors;
    for (const file of ['a.dts','b.overlay']) {
      dtsState.fileName=file;
      const branch=node(file+'-bus',[node(file+'-sensor')]);
      const sibling=node(file+'-gpio');
      dtsState.symbols=[node(file,file==='a.dts'?[branch,sibling]:[sibling,branch])];
      window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:dtsState}}));
      const rows=[...document.querySelectorAll('.symbol-row')];
      const getRow=id=>rows.find(row=>row.dataset.id===id);
      const color=row=>getComputedStyle(row.querySelector('.dts-marker')).color;
      const root=getRow(file), bus=getRow(branch.id), leaf=getRow(sibling.id), sensor=getRow(file+'-sensor');
      if(color(bus)!==color(leaf))throw Error('同层父节点与末级节点颜色不同');
      const colors=[color(root),color(bus),color(sensor)];
      if(firstColors && colors.join()!==firstColors.join())throw Error('切换文件后层级颜色变化');
      firstColors=colors;
      if(!theme.includes('contrast') && new Set(colors).size!==3)throw Error('层级颜色未生效');
      const dot=leaf.querySelector('.dts-leaf');
      if(Math.abs(parseFloat(getComputedStyle(dot,'::before').width)-6*scale/100)>0.02)throw Error('末级圆点尺寸不符');
      if(bus.querySelector('.dts-leaf') || !bus.querySelector('[data-icon-semantic="symbol.namespace"]'))throw Error('父节点图标变化');
      const arrow=bus.querySelector('.caret');
      arrow.click();
      if(arrow.textContent!=='▸' || bus.getAttribute('aria-expanded')!=='false')throw Error('折叠箭头异常');
      arrow.click();
      if(arrow.textContent!=='▾' || bus.getAttribute('aria-expanded')!=='true')throw Error('展开箭头异常');
      leaf.click();
      if(window.testMessages.at(-1).id!==sibling.id)throw Error('末级节点跳转异常');
    }
  }
}
document.body.className='vscode-dark';state.preferences.scale=100;state.query='';window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));
const result=document.createElement('pre');result.id='verification';result.textContent=JSON.stringify({passed:true,checks});document.body.append(result);
`;
html=html.replace('</head>',`<style nonce="${nonce}">${css}</style><script nonce="${nonce}">${boot}</script></head>`).replace('<main class="shell">','<h1>宏与条件编译</h1><main class="shell">').replace('</body>',`<script nonce="${nonce}">try{${check}}catch(error){const result=document.createElement('pre');result.id='verification';result.textContent=JSON.stringify({passed:false,error:String(error)});document.body.append(result);}</script></body>`);
const htmlPath=path.join(output,'branch-preview.html');
fs.writeFileSync(htmlPath,html);
Module._load=originalLoad;
const {spawnSync}=require('node:child_process');
const os=require('node:os');
const browser=process.argv[2] || process.env.CATLAS_TEST_BROWSER || (process.platform==='win32'
  ? [process.env['ProgramFiles(x86)'],process.env.ProgramFiles].filter(Boolean).map(dir=>path.join(dir,'Microsoft/Edge/Application/msedge.exe')).find(file=>fs.existsSync(file))
  : 'google-chrome');
if(!browser)throw Error('找不到浏览器，请设置 CATLAS_TEST_BROWSER');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'catlas-outline-rendering-'));
try {
 const result=spawnSync(browser,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--user-data-dir='+profile,'--window-size=700,500','--hide-scrollbars','--dump-dom','--screenshot='+path.join(output,'branch-preview.png'),pathToFileURL(htmlPath).href],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
 fs.writeFileSync(path.join(output,'browser.log'),result.stderr || '');
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('浏览器退出码 '+result.status);
 const match=result.stdout.match(/<pre id="verification">(.*?)<\/pre>/s);
 if(!match)throw Error('缺少渲染结果');
 const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
 fs.writeFileSync(path.join(output,'browser-verification.json'),JSON.stringify(report,null,2)+'\n');
 if(!report.passed)throw Error(report.error);
 console.log('大纲渲染检查通过：4 种主题、3 档缩放、6 种搜索，共 72 组高亮检查。');
} finally {
 fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
