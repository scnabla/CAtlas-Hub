import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Resvg} from '@resvg/resvg-js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2] || path.join(root,'.vscode-test/icon-metrics.json'));
const baseline=path.join(root,'media/icons/baseline');
const manifest=JSON.parse(fs.readFileSync(path.join(baseline,'manifest.json'),'utf8'));
const measurements=[];
for(const icon of manifest.icons){
 for(const size of [16,18,24]){
  const svg=fs.readFileSync(path.join(baseline,icon.files.monochrome),'utf8').replaceAll('currentColor','#FFFFFF');
  const rendered=new Resvg(svg,{fitTo:{mode:'width',value:size}}).render();
  const pixels=rendered.pixels;let left=size,right=-1,top=size,bottom=-1;
  for(let y=0;y<rendered.height;y++)for(let x=0;x<rendered.width;x++){
   if(pixels[(y*rendered.width+x)*4+3]<32)continue;
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left || bottom<top)throw Error(icon.id+' empty icon');
  measurements.push({id:icon.id,size,left,top,width:right-left+1,height:bottom-top+1,centerX:(left+right+1)/2,centerY:(top+bottom+1)/2});
 }
}
for(const [a,b] of [['symbol-function','symbol-method'],['symbol-number','symbol-macro-definition']]){
 const get=id=>measurements.filter(m=>m.id===id).map(({id,...m})=>m);
 if(JSON.stringify(get(a))!==JSON.stringify(get(b)))throw Error(a+' and '+b+' differ in size');
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({icons:manifest.icons.length,sizes:[16,18,24],measurements},null,2)+'\n');
console.log('图标尺寸检查通过：'+manifest.icons.length+' 个图标，16px、18px、24px。');
