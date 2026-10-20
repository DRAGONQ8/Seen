/* Actual hostile-content build, offline startup and long Arabic visual layouts.
   Requires only development Playwright; run against the local server on 8765. */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const url=process.env.SEEN_TEST_URL||'http://127.0.0.1:8765/index.html';
const checks=[],errors=[],network=[],layouts=[];
let browser;
async function check(name,fn){try{await fn();checks.push({name,ok:true});console.log('PASS',name);}catch(e){checks.push({name,ok:false,error:String(e)});console.error('FAIL',name,e.stack);}}
async function fresh(){const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true,reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(url).origin)network.push(r.url());});await page.goto(url);await page.waitForFunction(()=>window.SeenTeamUI?.ready());await context.setOffline(true);await page.evaluate(()=>{prefs.sound=0;prefs.music=0;prefs.reduced=true;applyPrefs();});return{context,page};}
async function layout(page,label){const data=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dir:document.documentElement.dir,buttons:[...document.querySelectorAll('.question-actions button,.match-tile,.assist-action,[data-team-action="award"],#dialog button')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent.trim().slice(0,60),left:r.left,right:r.right,width:r.width,height:r.height};}),images:[...document.querySelectorAll('.match-media img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.getBoundingClientRect().width})),dialog:document.querySelector('#dialog').open?{height:document.querySelector('#dialog').getBoundingClientRect().height,viewport:innerHeight}:null}));layouts.push({label,...data});assert.equal(data.dir,'rtl');assert(data.scroll<=data.width+1,JSON.stringify(data));for(const b of data.buttons){assert(b.left>=-1&&b.right<=data.width+1,JSON.stringify(b));assert(b.width>=43.5&&b.height>=43.5,JSON.stringify(b));}assert(data.images.every(i=>i.loaded&&i.width<=data.width));if(data.dialog)assert(data.dialog.height<=data.dialog.viewport);}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 await check('generated HTML starts from local bytes with network disabled before startup',async()=>{
  const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true});
  await context.setOffline(true);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.setContent(await fs.readFile(path.join(root,'index.html'),'utf8'),{waitUntil:'load'});await page.waitForFunction(()=>window.SeenTeamUI?.ready());
  await page.locator('[data-team-action="new"]').first().click();await page.evaluate(()=>{SeenTeamUI.draft.timer=false;render();});await page.locator('[data-team-action="step"][data-step="8"]').click();await page.locator('[data-team-action="start-match"]').click();
  assert.equal(await page.locator('.match-tile').count(),36);assert.equal(await page.evaluate(()=>SeenDiagnostics.validateBank().length),0);await context.close();
 });
 await check('malicious mixed-case script, comments and Unicode survive actual Python build without execution',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'seen-v3-build-'));
  try{
   for(const file of ['build.py','content_tools.py','ui.css','team-ui.css','graphics.js','media-v2.js','team-engine.js','app.js','team-ui.js'])await fs.copyFile(path.join(root,file),path.join(dir,file));
   for(const folder of ['content','assets'])await fs.cp(path.join(root,folder),path.join(dir,folder),{recursive:true});
   const pack=JSON.parse(await fs.readFile(path.join(root,'content','pop.json'),'utf8'));
   const hostile='نص اختبار سلامة </ScRiPt><script>globalThis.pwned=true</script><!-- --> " \\ \u2028\u2029 🎮';
   const q={...pack[0],id:'security-probe',q:hostile,verification:{status:'editorial'},source:{title:'مرجع <img src=x onerror="globalThis.pwned=true">',url:'https://example.org/test',reference:'مقطع اختبار'}};
   await fs.writeFile(path.join(dir,'content','security.json'),JSON.stringify([q]));
   execFileSync('python',['build.py'],{cwd:dir});const html=await fs.readFile(path.join(dir,'index.html'),'utf8');
   execFileSync('python',['build.py'],{cwd:dir});assert.equal(await fs.readFile(path.join(dir,'index.html'),'utf8'),html,'two hostile builds must be identical');
   const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/security-v3.html',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
   await page.goto(new URL('security-v3.html',url).href);await page.waitForFunction(()=>window.SeenTeamUI?.ready());
   assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);assert.equal(await page.locator('script').count(),1);
   assert.equal(await page.evaluate(()=>QUESTION_MAP.get('security-probe').q),hostile);
   await page.evaluate(()=>SeenTeamUI.go('library'));await page.locator('#library-search').fill('نص اختبار سلامة');
   assert.equal(await page.locator('img[src="x"]').count(),0);assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
   await context.close();
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });
 const f=await fresh();const p=f.page;
 await check('long Arabic visual snapshot can open through actual team controls',async()=>{
  await p.locator('[data-team-action="new"]').first().click();
  await p.evaluate(()=>{SeenTeamUI.draft.timer=false;render();});await p.locator('[data-team-action="step"][data-step="8"]').click();await p.locator('[data-team-action="start-match"]').click();
  // Fixture changes the library after generation. The match snapshot must retain it.
  await p.evaluate(()=>{const match=SeenTeamUI.match,tile=match.board[0],q=JSON.parse(JSON.stringify(TeamEngine.getQuestion(match,tile.questionId,QUESTION_BANK)));q.q='أي خيار يصف هذا الدليل البصري؟ '+('هذا نص عربي طويل لاختبار التفاف الكلمات ووضوح السؤال على شاشة الهاتف واللوح. '.repeat(8));q.image='map-kuwait';match.questions=Object.freeze({...match.questions,[q.id]:Object.freeze(q)});render();});
  await p.locator('[data-team-action="tile"]').first().click();assert.equal(await p.evaluate(()=>SeenTeamUI.match.state),'QUESTION_ACTIVE');await p.waitForFunction(()=>document.querySelector('.match-media img')?.naturalWidth>0);
  assert.equal(await p.locator('.canonical-answer').count(),0);
 });
 for(const scale of [100,130])for(const viewport of [{width:412,height:915},{width:915,height:412},{width:1024,height:1536},{width:1536,height:1024},{width:320,height:780}]){
  await check(`long visual interaction ${viewport.width}x${viewport.height} text ${scale}%`,async()=>{
   await p.setViewportSize(viewport);await p.evaluate(scale=>{prefs.textSize=scale;applyPrefs();render();},scale);await layout(p,`question ${viewport.width}x${viewport.height} ${scale}`);
   await p.locator('[data-team-action="zoom"]').click();assert(await p.locator('.zoom-image').isVisible());await layout(p,`zoom ${viewport.width}x${viewport.height} ${scale}`);
   await p.locator('#dialog [data-action="close-dialog"]').first().click();if(await p.evaluate(()=>SeenTeamUI.match.state==='PAUSED'))await p.locator('[data-team-action="engine"][data-type="RESUME"]').click();
  });
 }
 await check('long visual answer exposes exactly three reachable scoring choices and completes without another screen',async()=>{
  await p.locator('[data-team-action="reveal"]').click();assert.equal(await p.locator('#dialog').evaluate(d=>d.open),false);assert.equal(await p.locator('[data-team-action="award"]').count(),3);await layout(p,'long visual scoring 320 text130');
  const choices=await p.locator('[data-team-action="award"]').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};}));assert(choices.every(r=>r.top>=-1&&r.bottom<=r.height+1),'one-tap choices must remain in view after reveal, even with a long question');
  await p.locator('[data-team-action="award"][data-team="0"]').click();assert.equal(await p.evaluate(()=>SeenTeamUI.match.state),'BOARD');assert.equal(await p.locator('#confirm-team-award').count(),0);
 });
 await f.context.close();
 await check('no uncaught errors and no external runtime requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
 await browser.close();const report={checks,passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,skipped:0,errors,network,layouts,environment:'Chromium touch emulation; no physical Samsung hardware'};await fs.writeFile('/tmp/seen-v3-build-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
