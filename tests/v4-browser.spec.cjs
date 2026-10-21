/* Actual V4 release regressions across available browser engines.
 * No physical mobile-device claim. Runtime game has no Playwright dependency.
 * Run through npm test (local HTTP server) or set SEEN_TEST_URL.
 */
'use strict';
const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const URL = process.env.SEEN_TEST_URL || 'http://127.0.0.1:8765/index.html';
const root = path.resolve(__dirname, '..');
const checks = [], unavailable = [], errors = [], network = [], layouts = [], engines = [];
const action = (page, key, extra = '') => page.locator(`[data-team-action="${key}"]${extra}`);
const snap = page => page.evaluate(() => JSON.parse(JSON.stringify(SeenTeamUI.match)));
let browserName;
async function check(name, fn) {
  if (process.env.SEEN_V4_PATTERN && !new RegExp(process.env.SEEN_V4_PATTERN).test(name)) return;
  try { await fn(); checks.push({browser:browserName, name, ok:true}); console.log('PASS', browserName, name); }
  catch (error) { checks.push({browser:browserName, name, ok:false, error:String(error), stack:error.stack}); console.error('FAIL', browserName, name, error.stack); }
}
async function fresh(browser, {initial, denied = false, viewport = {width:412,height:915}, deviceScaleFactor = 3} = {}) {
  const context = await browser.newContext({viewport, deviceScaleFactor, hasTouch:true, reducedMotion:'reduce', acceptDownloads:true});
  if (initial) await context.addInitScript(initial);
  if (denied) await context.addInitScript(() => { Storage.prototype.setItem = function(){throw new DOMException('Storage denied','QuotaExceededError');}; });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({browser:browserName, error:error.message}));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new globalThis.URL(request.url()).origin !== new globalThis.URL(URL).origin) network.push({browser:browserName,url:request.url()}); });
  await page.goto(URL, {waitUntil:'load'}); await page.waitForFunction(() => window.SeenTeamUI?.ready());
  await page.evaluate(() => { prefs.sound=0; prefs.music=0; prefs.reduced=true; applyPrefs(); persist(); });
  return {context,page};
}
async function start(page, patch={}) {
  await action(page,'new').first().click();
  await page.evaluate(patch => { Object.assign(SeenTeamUI.draft,{timer:false,board:'compact'},patch); render(); },patch);
  await action(page,'step','[data-step="8"]').click(); await action(page,'start-match').click();
  if (await page.locator('#team-confirm-start').isVisible()) await page.locator('#team-confirm-start').click();
  assert.equal((await snap(page)).state,'BOARD');
}
async function open(page) { await action(page,'tile',':not([disabled])').first().click(); assert.equal((await snap(page)).state,'QUESTION_ACTIVE'); }
async function reveal(page) { await action(page,'reveal').click(); assert.equal((await snap(page)).state,'ANSWER_REVEAL'); assert.equal(await action(page,'award').count(),3); }
async function resume(page) {
  await page.reload(); await page.waitForFunction(()=>window.SeenTeamUI?.ready());
  await action(page,'resume').first().click();
  if ((await snap(page)).state==='PAUSED') await action(page,'engine','[data-type="RESUME"]').click();
}
async function upload(page, name, data) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),action(page,name).first().click()]);
  await chooser.setFiles({name:'untrusted.json',mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
  await page.waitForTimeout(150);
}
async function layout(page, label) {
  const dimensions = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,rtl:document.documentElement.dir,buttons:[...document.querySelectorAll('[data-team-action="award"]')].map(button=>{const r=button.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}),digits:/[٠-٩۰-۹]/.test(document.body.innerText)}));
  layouts.push({browser:browserName,label,...dimensions}); assert.equal(dimensions.rtl,'rtl'); assert.equal(dimensions.digits,false); assert(dimensions.scroll<=dimensions.width+1,label+' horizontal overflow');
  for(const button of dimensions.buttons) { assert(button.width>=43.5&&button.height>=43.5,label+' tiny scoring target'); assert(button.left>=-1&&button.right<=dimensions.width+1,label+' clipped scoring target'); }
}
async function suite(browser) {
  await check('removed individual-play APIs and UI cannot open a game',async()=>{
    const f=await fresh(browser);try{
      for(const route of ['home','categories','settings']){
        await f.page.locator(`[data-action="nav"][data-route="${route}"]:visible`).first().click();
        assert.equal(await f.page.locator('[data-action="setup"],[data-mode="solo"],[data-value="solo"],[data-route="play"],[data-route="result"],[data-route="profile"]').count(),0);
      }
      assert.equal(await f.page.evaluate(()=>typeof session),'undefined'); assert.equal(await f.page.evaluate(()=>typeof makeSetup),'undefined');
      await f.page.locator('[data-action="nav"][data-route="home"]:visible').first().click();await start(f.page);assert.equal((await snap(f.page)).teams.length,2);
    }finally{await f.context.close();}
  });
  await check('legacy data migrates only display preferences, favorites and seen IDs after a safe write',async()=>{
    const f=await fresh(browser,{initial:()=>{localStorage.setItem('seen-khaled-v1',JSON.stringify({version:1,prefs:{theme:'light',accent:'gold',motion:'none',textSize:115,reduced:true,images:false,sound:12,music:0,repetition:'unseen',duration:999},progress:{profile:{name:'تقدم قديم',favorites:['geo','geo','anime','unknown']},seen:{'geo-001':1800000000000,'unknown':1800000000000},xp:12345,achievements:['removed'],history:[{legacy:true}]},session:{mode:'solo',status:'active'}}));}});
    try{
      const data=await f.page.evaluate(()=>({saved:JSON.parse(localStorage.getItem('seen-khaled-host-v4')),legacy:localStorage.getItem('seen-khaled-v1'),state:{prefs,progress},oldAPI:typeof session}));
      assert.equal(data.legacy,null);assert.equal(data.saved.version,4);assert.equal(data.state.prefs.theme,'light');assert.equal(data.state.prefs.textSize,115);assert.equal(data.state.prefs.images,undefined);assert.equal(data.state.prefs.repetition,'unseen');assert.deepEqual(data.state.progress,{profile:{favorites:['geo','anime']},seen:{'geo-001':1800000000000}});assert.equal(data.saved.session,undefined);assert.equal(data.saved.progress.xp,undefined);assert.equal(data.saved.progress.achievements,undefined);assert.equal(data.saved.prefs.duration,undefined);assert.equal(data.oldAPI,'undefined');
      await start(f.page);assert.equal((await snap(f.page)).teams.length,2);assert.equal((await snap(f.page)).config.repetition,'unseen');
    }finally{await f.context.close();}
  });
  await check('interrupted migration preserves the exact legacy save until new persistence succeeds',async()=>{
    const f=await fresh(browser,{denied:true,initial:()=>{localStorage.setItem('seen-khaled-v1','{"version":1,"prefs":{"theme":"light","textSize":115},"progress":{"profile":{"favorites":["geo"]},"seen":{"geo-001":1800000000000},"xp":900},"session":{"mode":"solo"}}');}});
    try{
      const data=await f.page.evaluate(()=>({legacy:localStorage.getItem('seen-khaled-v1'),host:localStorage.getItem('seen-khaled-host-v4'),favorites:progress.profile.favorites,prefs}));
      assert.equal(data.legacy,'{"version":1,"prefs":{"theme":"light","textSize":115},"progress":{"profile":{"favorites":["geo"]},"seen":{"geo-001":1800000000000},"xp":900},"session":{"mode":"solo"}}');assert.equal(data.host,null);assert.deepEqual(data.favorites,['geo']);assert.equal(data.prefs.theme,'light');
      await start(f.page);assert(await f.page.locator('.match-storage-notice').isVisible());
    }finally{await f.context.close();}
  });
  await check('corrupt legacy storage leaves the independently saved team match intact',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);await open(p);await reveal(p);await action(p,'award','[data-team="1"]').click();const before=await snap(p);
      await p.evaluate(()=>{localStorage.removeItem('seen-khaled-host-v4');localStorage.setItem('seen-khaled-v1','{"version":1,"prefs":{"theme":"invalid"},"progress":{},"session":{"mode":"solo"}}');});
      await resume(p);const after=await snap(p);assert.deepEqual(after.teams,before.teams);assert.deepEqual(after.board,before.board);assert.deepEqual(after.transactions,before.transactions);assert.equal(after.history.length,1);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('seen-khaled-v1')).prefs.theme),'invalid');
    }finally{await f.context.close();}
  });
  await check('question reload, rapid award, persisted board and atomic undo preserve identity',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);assert.equal((await snap(p)).board.length,18);await open(p);const original=(await snap(p)).current;
      await resume(p);assert.equal((await snap(p)).current.questionId,original.questionId);assert.equal(await p.locator('.canonical-answer').count(),0);
      await reveal(p);const before=(await snap(p)).current;
      await p.evaluate(()=>{const b=document.querySelector('[data-team-action="award"][data-team="0"]');b.click();b.click();});
      let s=await snap(p);assert.equal(s.state,'BOARD');assert.equal(s.history.length,1);assert.equal(s.transactions.length,1);assert.equal(s.board.filter(t=>t.done).length,1);assert.equal(s.turn,1);
      await p.evaluate(c=>SeenTeamUI.dispatch({type:'RESOLVE_QUESTION',teamId:1,questionId:c.questionId,tileId:c.tileId,token:c.token}),before);assert.equal((await snap(p)).history.length,1);
      await resume(p);s=await snap(p);assert.equal(s.history.length,1);assert.equal(s.board.filter(t=>t.done).length,1);assert.equal(s.teams[0].score,original.value);
      await action(p,'undo',':visible:not([disabled])').first().click();s=await snap(p);assert.equal(s.state,'ANSWER_REVEAL');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.equal(s.history.length,0);assert.notEqual(s.current.token,before.token);
      await action(p,'award','[data-team="none"]').click();assert.equal((await snap(p)).state,'BOARD');assert.equal((await snap(p)).history.length,1);assert.deepEqual((await snap(p)).teams.map(t=>t.score),[0,0]);
    }finally{await f.context.close();}
  });
  await check('storage interruption during scoring retains usable in-memory game and a backup',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);await open(p);await reveal(p);
      await p.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Interrupted save','QuotaExceededError');};});
      await action(p,'award','[data-team="1"]').click();const s=await snap(p);assert.equal(s.state,'BOARD');assert.equal(s.history.length,1);assert(s.teams[1].score>0);
      assert(await p.locator('.match-storage-notice').isVisible());assert((await p.locator('.match-storage-notice').innerText()).includes('الحفظ التلقائي غير متاح'));
      await action(p,'pause-menu').first().click();const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#dialog [data-team-action="backup"]').click()]);
      const data=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(data.kind,'teams');const decoded=await p.evaluate(data=>decodeMatchBackup(data,'teams'),data);assert.equal(decoded.save.match.history.length,1);assert.equal(decoded.save.match.teams[1].score,s.teams[1].score);
    }finally{await f.context.close();}
  });
  await check('repeated storage events for an already loaded or written save do not lock the host',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);
      const repeat=()=>p.evaluate(()=>{const key='seen-khaled-teams-v2',text=localStorage.getItem(key);window.dispatchEvent(new StorageEvent('storage',{key,newValue:text,oldValue:null,url:location.href,storageArea:localStorage}));});
      await repeat();assert.equal(await p.locator('#dialog').evaluate(d=>d.open),false);assert.equal((await snap(p)).state,'BOARD');
      await resume(p);await repeat();assert.equal(await p.locator('#dialog').evaluate(d=>d.open),false);await open(p);await reveal(p);await action(p,'award','[data-team="1"]').click();assert.equal((await snap(p)).state,'BOARD');assert.equal((await snap(p)).history.length,1);
    }finally{await f.context.close();}
  });
  await check('a stale second host window cannot overwrite an awarded question',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);await open(p);await reveal(p);const pending=(await snap(p)).current;
      const newer=await f.context.newPage();newer.on('pageerror',error=>errors.push({browser:browserName,error:error.message}));await newer.goto(URL);await newer.waitForFunction(()=>window.SeenTeamUI?.ready());await action(newer,'resume').first().click();if((await snap(newer)).state==='PAUSED')await action(newer,'engine','[data-type="RESUME"]').click();assert.equal((await snap(newer)).state,'ANSWER_REVEAL');await action(newer,'award','[data-team="1"]').click();assert.equal((await snap(newer)).history.length,1);
      await p.waitForFunction(()=>document.querySelector('[data-team-action="reload"]'));
      await p.evaluate(c=>SeenTeamUI.dispatch({type:'RESOLVE_QUESTION',teamId:0,tileId:c.tileId,questionId:c.questionId,token:c.token}),pending);
      const disk=await p.evaluate(()=>JSON.parse(localStorage.getItem('seen-khaled-teams-v2')).match);assert.deepEqual(disk.teams.map(t=>t.score),[0,pending.value]);assert.equal(disk.history.length,1);
      const reloadButton=p.locator('#dialog [data-team-action="reload"]');await reloadButton.click();await p.waitForFunction(()=>window.SeenTeamUI?.ready());await action(p,'resume').first().click();assert.deepEqual((await snap(p)).teams.map(t=>t.score),[0,pending.value]);assert.equal((await snap(p)).history.length,1);
    }finally{await f.context.close();}
  });
  await check('malformed untrusted backups never mutate the active game or library',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);await open(p);await reveal(p);await action(p,'award','[data-team="0"]').click();await p.evaluate(()=>SeenTeamUI.go('teamHistory'));
      const before=await p.evaluate(()=>JSON.parse(JSON.stringify(SeenTeamUI.store)));
      const badState=structuredClone(before);badState.match.teams[0].score=999999;
      for(const input of ['{invalid','{"version":3,"save":{},"__proto__":{"polluted":true}}',{version:3,save:1},{version:3,save:badState}]){
        await upload(p,'restore',input);assert.equal(await p.locator('#confirm-team-backup').count(),0);assert.deepEqual(await p.evaluate(()=>JSON.parse(JSON.stringify(SeenTeamUI.store))),before);assert.equal(await p.evaluate(()=>({}).polluted),undefined);
      }
    }finally{await f.context.close();}
  });
  await check('long Arabic reveal and three scoring targets fit phone and tablet orientations',async()=>{
    const f=await fresh(browser);const p=f.page;try{
      await start(p);await p.evaluate(()=>{const m=SeenTeamUI.match,t=m.board[0],q=JSON.parse(JSON.stringify(TeamEngine.getQuestion(m,t.questionId,QUESTION_BANK)));q.q='سؤال اختبار العرض العربي الطويل؟ '+('ترتيب الكلمات ووضوح العبارة يساعدان المضيف على قراءة السؤال براحة. '.repeat(12));m.questions=Object.freeze({...m.questions,[q.id]:Object.freeze(q)});prefs.textSize=130;applyPrefs();render();});
      await open(p);await reveal(p);for(const viewport of [{width:320,height:780},{width:412,height:915},{width:915,height:412},{width:800,height:1280},{width:1024,height:1536},{width:1536,height:1024}]){await p.setViewportSize(viewport);await layout(p,`${viewport.width}x${viewport.height} text130`);}
      await p.setViewportSize({width:412,height:915});await action(p,'award','[data-team="1"]').focus();await p.keyboard.press('Enter');assert.equal((await snap(p)).state,'BOARD');
    }finally{await f.context.close();}
  });
  await check('touch hosting works at explicit phone and tablet viewport sizes and pixel ratios',async()=>{
    for(const device of [{label:'Android phone emulation',viewport:{width:412,height:915},deviceScaleFactor:3.5},{label:'iPhone-size emulation',viewport:{width:393,height:852},deviceScaleFactor:3},{label:'large tablet emulation',viewport:{width:924,height:1480},deviceScaleFactor:2}]){
      const f=await fresh(browser,device);const p=f.page;try{
        await start(p);assert.equal(await p.evaluate(()=>devicePixelRatio),device.deviceScaleFactor);await action(p,'tile',':not([disabled])').first().tap();assert.equal((await snap(p)).state,'QUESTION_ACTIVE');await action(p,'reveal').tap();assert.equal(await action(p,'award').count(),3);await layout(p,device.label+` DPR${device.deviceScaleFactor}`);await action(p,'award','[data-team="0"]').tap();assert.equal((await snap(p)).state,'BOARD');assert.equal((await snap(p)).history.length,1);await p.setViewportSize({width:device.viewport.height,height:device.viewport.width});await layout(p,device.label+' landscape');
      }finally{await f.context.close();}
    }
  });
  await check('local HTML bytes boot and play with network disabled before startup',async()=>{
    const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true});await context.setOffline(true);const p=await context.newPage();const requests=[];p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});p.on('pageerror',e=>errors.push({browser:browserName,error:e.message}));
    try{await p.setContent(await fs.readFile(path.join(root,'index.html'),'utf8'),{waitUntil:'load'});await p.waitForFunction(()=>window.SeenTeamUI?.ready());await start(p);await open(p);await reveal(p);await action(p,'award','[data-team="0"]').click();assert.equal((await snap(p)).state,'BOARD');assert.deepEqual(requests,[]);}finally{await context.close();}
  });
}
(async()=>{
  for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
    browserName=name;let browser;
    try{browser=await engine.launch(name==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}:{headless:true});}
    catch(error){unavailable.push({browser:name,reason:String(error)});console.log('UNAVAILABLE',name,String(error).slice(0,800));continue;}
    engines.push({name,version:browser.version()});
    try{
      await suite(browser);
      const context=await browser.newContext();await context.setOffline(true);const page=await context.newPage();let opened=false;
      try{
        try{await page.goto(pathToFileURL(path.join(root,'index.html')).href,{timeout:10000});await page.waitForFunction(()=>window.SeenTeamUI?.ready(),null,{timeout:10000});opened=true;}
        catch(error){
          if(/ERR_BLOCKED_BY_ADMINISTRATOR|ERR_ACCESS_DENIED|NS_ERROR_FILE_ACCESS_DENIED/.test(String(error)))unavailable.push({browser:name,feature:'file URL startup',reason:String(error)});
          else{checks.push({browser:name,name:'actual file URL startup',ok:false,error:String(error)});console.error('FAIL',name,'actual file URL startup',String(error));}
        }
        if(opened)await check('actual file URL offline startup and scoring',async()=>{await start(page);await open(page);await reveal(page);await action(page,'award','[data-team="0"]').click();assert.equal((await snap(page)).state,'BOARD');});
      }finally{await context.close();}
    }finally{await browser.close();}
  }
  browserName='all available engines';await check('no uncaught runtime errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert(checks.some(c=>c.browser==='chromium'&&c.ok),'Chromium must execute');});
  const report={environment:'Linux Playwright engines and touch/viewport emulation; no physical Samsung or iPhone testing',testURL:URL,engines,filter:process.env.SEEN_V4_PATTERN||null,checks,passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,unavailable,errors,network,layouts};
  const reportPath=process.env.SEEN_V4_PATTERN?'/tmp/seen-v4-browser-focused-report.json':'/tmp/seen-v4-browser-report.json';await fs.writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,unavailable:unavailable.map(x=>({browser:x.browser,feature:x.feature})),report:reportPath}));if(report.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
