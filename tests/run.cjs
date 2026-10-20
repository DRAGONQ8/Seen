/* Development-only complete, serial validation. npm test builds first. */
'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const env={...process.env,SEEN_AXE_PATH:require.resolve('axe-core/axe.min.js')};
const results=[];
let server;
function command(name,args){return new Promise(resolve=>{const child=spawn(name,args,{cwd:root,env,stdio:'inherit'});child.on('error',error=>resolve({name,args,code:1,error:String(error)}));child.on('exit',code=>resolve({name,args,code:code??1}));});}
(async()=>{
 if(!process.env.SEEN_TEST_URL){
  try{const response=await fetch('http://127.0.0.1:8765/index.html');if(!response.ok)throw Error('No test server');}
  catch{server=spawn('python',['-m','http.server','8765','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:8765/index.html');if(r.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}}
 }
 const commands=[['python',['-m','unittest','discover','-s','tests','-p','test_*.py']],
  ...['team-engine','team-content','solo-v3','v3-media','one-tap','game','reliability','team-browser','solo-v3-browser','v3-team-ui','v3-build-browser','accessibility','team-accessibility'].map(name=>['node',[`tests/${name}.spec.cjs`]]),
  ['node',['tests/team-content.spec.cjs','--browser']],['node',['tests/v3-media.spec.cjs','--browser']]];
 for(const [name,args]of commands){console.log('\nRUN',name,...args);results.push(await command(name,args));}
 await fs.writeFile('/tmp/seen-release-suites.json',JSON.stringify({results,passed:results.filter(r=>r.code===0).length,failed:results.filter(r=>r.code!==0).length},null,2));
 console.log('Suites:',results.filter(r=>r.code===0).length,'passed,',results.filter(r=>r.code!==0).length,'failed');if(results.some(r=>r.code!==0))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server?.kill());
