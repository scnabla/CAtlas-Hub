const path = require('node:path');
const {writeFile} = require('node:fs/promises');
const vscode = require('vscode');
exports.activate = async function () {
  const directory=process.env.CATLAS_PERSONAL_TEST_DIRECTORY;
  const phase=process.env.CATLAS_PERSONAL_TEST_PHASE;
  if(!directory || !path.isAbsolute(directory) || !['save','restart'].includes(phase))return;
  let result;
  try {await require('../../dist/integrationTest/personalDataRestart.js').run();result={phase,passed:true};}
  catch(error){result={phase,passed:false,message:String(error)};}
  await writeFile(path.join(directory,phase+'-result.json'),JSON.stringify(result),{flag:'wx'});
  await vscode.commands.executeCommand('workbench.action.quit');
};
