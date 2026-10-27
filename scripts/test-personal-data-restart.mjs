import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,mkdtemp,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolveCliArgsFromVSCodeExecutablePath} from '@vscode/test-electron';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.argv.length!==4)throw Error('需要准确安装包路径和 VS Code 可执行文件路径。');
const [candidate,exe]=process.argv.slice(2).map(p=>path.resolve(p));
const hash=async()=>createHash('sha256').update(await readFile(candidate)).digest('hex');const before=await hash();
await mkdir(path.join(root,'.vscode-test'),{recursive:true});
const directory=await mkdtemp(path.join(root,'.vscode-test/personal-restart-'));
console.log('个人数据重启验证目录：'+directory);
await mkdir(path.join(directory,'user-data/User'),{recursive:true});
await writeFile(path.join(directory,'user-data/User/settings.json'),JSON.stringify({'projectManager.todo.owner':'old-native-setting'}));
const env={...process.env,CATLAS_PERSONAL_DATA_DIRECTORY:path.join(directory,'personal-data'),CATLAS_PERSONAL_TEST_DIRECTORY:directory};delete env.ELECTRON_RUN_AS_NODE;
const isolation=['user-data','extensions','shared-data'].map(name=>'--'+name+'-dir='+path.join(directory,name));
const run=(program,args,e=env)=>new Promise((resolve,reject)=>{const p=spawn(program,args,{cwd:root,env:e,stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('退出码 '+code)));});
let cli,cliArgs;
if(process.platform==='win32'){
 const base=path.dirname(exe);
 for(const p of [path.join(base,'resources/app/out/cli.js'),...(await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>path.join(base,e.name,'resources/app/out/cli.js'))]){
  try{await access(p);cli=exe;cliArgs=[p];break;}catch{}
 }
 if(!cli)throw Error('找不到 VS Code CLI');
}else{[cli,...cliArgs]=resolveCliArgsFromVSCodeExecutablePath(exe);}
await run(cli,[...cliArgs,...isolation,'--install-extension',candidate,'--force'],process.platform==='win32'?{...env,ELECTRON_RUN_AS_NODE:'1'}:env);
for(const phase of ['save','restart']){
 await run(exe,[...isolation,'--use-inmemory-secretstorage',...(process.platform==='linux'?['--no-sandbox','--disable-gpu-sandbox']:[]),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--extensionDevelopmentPath='+path.join(root,'test-fixtures/personal-data-harness'),path.join(root,'test-fixtures/workspace-one')],{...env,CATLAS_PERSONAL_TEST_PHASE:phase});
 const result=JSON.parse(await readFile(path.join(directory,phase+'-result.json'),'utf8'));
 if(!result.passed)throw Error(JSON.stringify(result));
 if(await hash()!==before)throw Error('安装包发生变化');
 console.log(phase+' passed');
}
await writeFile(path.join(directory,'result.json'),JSON.stringify({passed:true,exe,candidate,sha256:before,phases:['save','restart']},null,2));
