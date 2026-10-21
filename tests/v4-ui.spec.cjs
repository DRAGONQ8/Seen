/* V4 host UX integration tests. All checks use Chromium touch/viewport emulation,
   never claim physical-device verification. Run against a built index.html. */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const URL=process.env.SEEN_TEST_URL||'http://127.0.0.1:8765/index.html';
const checks=[],errors=[],network=[];
let browser;
const action=(page,name,extra='')=>page.locator(`[data-team-action="${name}"]${extra}`).first();
const state=page=>page.evaluate(()=>JSON.parse(JSON.stringify(SeenTeamUI.match)));
async function check(name,fn){try{await fn();checks.push({name,ok:true});console.log('PASS',name);}catch(error){checks.push({name,ok:false,error:String(error)});console.error('FAIL',name,error.stack||error);}}
async function fresh(){const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'reduce',acceptDownloads:true});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url())&&new globalThis.URL(request.url()).origin!==new globalThis.URL(URL).origin)network.push(request.url());});await page.goto(URL,{waitUntil:'load'});await page.waitForFunction(()=>window.SeenTeamUI?.ready());await page.evaluate(()=>{prefs.sound=0;prefs.music=0;prefs.reduced=true;applyPrefs();persist();});await context.setOffline(true);return{page,context};}
async function step(page,n){await action(page,'step',`[data-step="${n}"]`).click();}
async function reload(page,context){await context.setOffline(false);await page.reload();await page.waitForFunction(()=>window.SeenTeamUI?.ready());await context.setOffline(true);}
async function start(page,patch={}){await action(page,'new').click();await page.evaluate(patch=>{Object.assign(SeenTeamUI.draft,{board:'compact',timer:false},patch);render();},patch);await step(page,8);await action(page,'start-match').click();assert.equal((await state(page))?.state,'BOARD',await page.locator('#toast').innerText());}
async function startFormat(page,type){
 await action(page,'new').click();
 const chosen=await page.evaluate(type=>{
  const draft=SeenTeamUI.draft;Object.assign(draft,{board:'compact',timer:false,repetition:'all'});
  const question=TeamEngine.eligibleQuestions(QUESTION_BANK,draft).find(question=>question.type===type);
  if(!question)throw Error('No eligible bundled format: '+type);
  if(!draft.teams.some(team=>team.categories.includes(question.category)))draft.teams[0].categories[0]=question.category;
  const errors=TeamEngine.validateConfig(draft,QUESTION_BANK);if(errors.length)throw Error(errors.join('; '));
  const first=Date.now();for(let attempt=0;attempt<500;attempt++){
   const seed=first+attempt,candidate=TeamEngine.create(draft,QUESTION_BANK,{seed,now:seed,seen:{},recentMatches:[]});
   const tile=candidate.board.find(tile=>TeamEngine.getQuestion(candidate,tile.questionId,QUESTION_BANK)?.type===type);
   if(tile){globalThis.__seenV4OriginalNow=Date.now;Date.now=()=>seed;render();return{tileId:tile.id,question:TeamEngine.getQuestion(candidate,tile.questionId,QUESTION_BANK)};}
  }throw Error('Could not select bundled format: '+type);
 },type);
 await step(page,8);await action(page,'start-match').click();assert.equal((await state(page))?.state,'BOARD');await page.evaluate(()=>{Date.now=globalThis.__seenV4OriginalNow;delete globalThis.__seenV4OriginalNow;});await action(page,'tile',`[data-id="${chosen.tileId}"]`).click();assert.equal((await state(page)).state,'QUESTION_ACTIVE');return chosen.question;
}
async function noOverflow(page,label){const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,rtl:document.documentElement.dir}));assert.equal(size.rtl,'rtl');assert(size.scroll<=size.width+1,`${label}: ${JSON.stringify(size)}`);}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 await check('solo has no navigation or executable setup path in the generated application',async()=>{const{page,context}=await fresh();try{
  assert.equal(await page.locator('[data-route="play"],[data-route="setup"],[data-route="result"],[data-action="solo"],[data-value="solo"]').count(),0);
  await action(page,'new').click();assert.equal(await page.locator('[data-team-action="choose"][data-key="mode"][data-value="solo"]').count(),0);
  assert.equal(await page.evaluate(()=>typeof makeSetup),'undefined');assert.equal(await page.evaluate(()=>typeof pauseSession),'undefined');
  await page.evaluate(()=>navigate('play'));assert.notEqual(await page.evaluate(()=>route),'play');
 }finally{await context.close();}});
 await check('category favorites work by keyboard, filter correctly, and survive reload',async()=>{const{page,context}=await fresh();try{
  await action(page,'new').click();await step(page,2);const toggle=page.locator('[data-team-action="favorite-category"][aria-pressed="false"]').first();const id=await toggle.getAttribute('data-id');assert(id,'a nonfavorite category must be available');await toggle.focus();await toggle.press('Space');assert.equal(await page.locator(`[data-team-action="favorite-category"][data-id="${id}"]`).getAttribute('aria-pressed'),'true');
  await page.locator('#team-category-filter').selectOption('favorites');assert.equal(await page.locator(`#team-category-${id}`).count(),1);const favorites=await page.locator('[data-team-action="favorite-category"]').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-pressed')));assert(favorites.length>0);assert(favorites.every(value=>value==='true'));
  await reload(page,context);await action(page,'new').click();await step(page,2);await page.locator('#team-category-filter').selectOption('favorites');assert.equal(await page.locator(`#team-category-${id}`).count(),1);assert.equal(await page.locator(`[data-team-action="favorite-category"][data-id="${id}"]`).getAttribute('aria-pressed'),'true');
  await page.locator('#team-category-search').fill('غيرموجودةتماما');assert.equal(await page.locator('.team-category-card').count(),0);await page.locator('#team-category-search').fill('');assert(await page.locator(`#team-category-${id}`).isVisible());
 }finally{await context.close();}});
 await check('team name presets and classic/enhanced assistance choices leave valid team configurations',async()=>{const{page,context}=await fresh();try{
  await action(page,'new').click();await step(page,1);const before=await page.evaluate(()=>SeenTeamUI.draft.teams.map(team=>team.name));await action(page,'team-name-preset','[data-value="kuwait"]').click();const after=await page.evaluate(()=>SeenTeamUI.draft.teams.map(team=>team.name));assert.notDeepEqual(after,before);assert.equal(new Set(after).size,2);assert(after.every(name=>/[\u0600-\u06ff]/.test(name)));
  await action(page,'team-name-preset','[data-value="friends"]').click();assert.notDeepEqual(await page.evaluate(()=>SeenTeamUI.draft.teams.map(team=>team.name)),after);
  await step(page,6);await action(page,'assist-preset','[data-value="classic"]').click();let config=await page.evaluate(()=>SeenTeamUI.draft);assert(['call','twice','pit','sitout','trap'].every(key=>config.assistEnabled[key]));assert(['time','hint','double','skip','second'].every(key=>!config.assistEnabled[key]));assert.equal(await page.evaluate(()=>TeamEngine.validateConfig(SeenTeamUI.draft,QUESTION_BANK).length),0);
  await action(page,'assist-preset','[data-value="enhanced"]').click();config=await page.evaluate(()=>SeenTeamUI.draft);assert(['call','twice','pit','sitout','trap','time','hint','double','skip','second'].every(key=>config.assistEnabled[key]));assert.equal(await page.evaluate(()=>TeamEngine.validateConfig(SeenTeamUI.draft,QUESTION_BANK).length),0);
 }finally{await context.close();}});
 await check('challenge and visual variants use the shared match engine with explicit host rules',async()=>{
  for(const variant of ['challenge','visual']){const{page,context}=await fresh();try{
   await action(page,'new').click();await action(page,'preset',`[data-value="${variant}"]`).click();const draft=await page.evaluate(()=>SeenTeamUI.draft);assert.equal(draft.variant,variant);if(variant==='challenge'){assert.equal(draft.timer,true);assert.equal(draft.duration,30);assert.equal(draft.negative,true);assert.equal(draft.assistEnabled.double,true);}
   await step(page,8);await action(page,'start-match').click();let match=await state(page);assert.equal(match.state,'BOARD');assert.equal(match.config.variant,variant);assert.equal(match.board.length,18);
   if(variant==='visual'){const tile=await page.evaluate(()=>SeenTeamUI.match.board.find(tile=>TeamEngine.getQuestion(SeenTeamUI.match,tile.questionId,QUESTION_BANK).image));assert(tile,'visual variant must include at least one locally bundled image');await action(page,'tile',`[data-id="${tile.id}"]`).click();await page.locator('.match-media img').waitFor();assert(await page.locator('.match-media img').evaluate(image=>image.complete&&image.naturalWidth>0));assert.equal((await state(page)).state,'QUESTION_ACTIVE');}
  }finally{await context.close();}}
 });
 await check('custom two-category match with selected point values scores, reloads, and fits mobile',async()=>{const{page,context}=await fresh();try{
  await action(page,'new').click();await action(page,'preset','[data-value="custom"]').click();await step(page,3);await action(page,'category-count','[data-value="2"]').click();await action(page,'choose','[data-key="board"][data-value="compact"]').click();await action(page,'point-value','[data-value="400"]').click();const draft=await page.evaluate(()=>SeenTeamUI.draft);assert.equal(draft.categoryCount,2);assert.deepEqual(draft.pointValues,[200,600]);assert.deepEqual(draft.teams.map(team=>team.categories.length),[1,1]);
  await step(page,8);await action(page,'start-match').click();let match=await state(page);assert.equal(match.state,'BOARD');assert.equal(match.board.length,4);assert.deepEqual([...new Set(match.board.map(tile=>tile.value))],[200,600]);await page.setViewportSize({width:320,height:780});await noOverflow(page,'custom two-category board');
  await action(page,'tile',':not([disabled])').click();const points=(await state(page)).current.value;await action(page,'reveal').click();await action(page,'award','[data-team="1"]').click();assert.equal((await state(page)).teams[1].score,points);await reload(page,context);await action(page,'resume').click();if((await state(page)).state==='PAUSED')await action(page,'engine','[data-type="RESUME"]').click();match=await state(page);assert.equal(match.state,'BOARD');assert.equal(match.board.length,4);assert.equal(match.history.length,1);assert.equal(match.teams[1].score,points);await noOverflow(page,'custom restored board');
 }finally{await context.close();}});
 await check('one-hand host controls remain usable in portrait/landscape and reveal exactly three awards',async()=>{const{page,context}=await fresh();try{
  await start(page);await action(page,'tile',':not([disabled])').click();assert.equal((await state(page)).state,'QUESTION_ACTIVE');
  for(const viewport of [{width:360,height:780},{width:412,height:915},{width:915,height:412},{width:800,height:1280},{width:1280,height:800}]){await page.setViewportSize(viewport);await noOverflow(page,`question ${viewport.width}x${viewport.height}`);const button=action(page,'reveal');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box&&box.width>=44&&box.height>=44);}
  await action(page,'reveal').click();assert.equal((await state(page)).state,'ANSWER_REVEAL');assert.equal(await page.locator('[data-team-action="award"]').count(),3);assert.equal(await page.locator('[data-type="NEXT_TURN"]').count(),0);assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),false);
  await page.setViewportSize({width:360,height:780});await noOverflow(page,'answer portrait');await action(page,'award','[data-team="none"]').focus();await action(page,'award','[data-team="none"]').press('Enter');assert.equal((await state(page)).state,'BOARD');assert.equal((await state(page)).history.length,1);assert.deepEqual((await state(page)).teams.map(team=>team.score),[0,0]);assert(await action(page,'undo').isVisible());await action(page,'undo').click();assert.equal((await state(page)).state,'ANSWER_REVEAL');assert.equal((await state(page)).history.length,0);
 }finally{await context.close();}});
 await check('malformed structured question imports never change the local bank or edits',async()=>{const{page,context}=await fresh();try{
  await action(page,'library').click();const before=await page.evaluate(()=>({ids:QUESTION_BANK.map(question=>question.id),edits:JSON.parse(JSON.stringify(SeenTeamUI.store.edits))}));
  const question=await page.evaluate(()=>JSON.parse(JSON.stringify(QUESTION_BANK.find(question=>question.type==='ordering'))));assert(question,'bundled ordering fixture required');question.id='owner-v4-invalid-order';question.q+=' · فحص استيراد محلي';question.correctOrder[question.correctOrder.length-1]='عنصر غير موجود في السؤال';
  for(const [invalid,message] of [[question,'الترتيب الصحيح'],[{...question,id:'owner-v4-invalid-type',type:'unsupported-audio'},'غير مدعوم']]){const[chooser]=await Promise.all([page.waitForEvent('filechooser'),action(page,'import-pack').click()]);await chooser.setFiles({name:'invalid-format.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:2,questions:[invalid]}))});await page.waitForFunction(message=>document.querySelector('#toast').textContent.includes(message),message);assert.equal(await page.locator('#confirm-question-pack').count(),0);assert.deepEqual(await page.evaluate(()=>({ids:QUESTION_BANK.map(question=>question.id),edits:JSON.parse(JSON.stringify(SeenTeamUI.store.edits))})),before);}
 }finally{await context.close();}});
 await check('bundled ordering, multipart, and logic formats give explicit instructions, canonical answers, and judging',async()=>{
  for(const type of ['ordering','multipart','logic']){const{page,context}=await fresh();try{
   const question=await startFormat(page,type);assert((await page.locator('.question-instructions').innerText()).includes(question.instructions));
   if(type==='ordering')assert.deepEqual(await page.locator('.ordering-items li').allTextContents(),question.items);
   if(type==='multipart')assert.deepEqual(await page.locator('.multipart-parts li').allTextContents(),question.parts);
   await noOverflow(page,type+' portrait');await action(page,'reveal').click();assert.equal(await page.locator('.canonical-answer').innerText(),question.correctAnswer);assert((await page.locator('#main').innerText()).includes(question.judging));assert.equal(await page.locator('[data-team-action="award"]').count(),3);
   await action(page,'award','[data-team="0"]').click();assert.equal((await state(page)).state,'BOARD');assert.equal((await state(page)).teams[0].score,question.points);
  }finally{await context.close();}}
 });
 await check('progressive clue disclosure works by keyboard and survives reload without leaking the answer',async()=>{const{page,context}=await fresh();try{
  const question=await startFormat(page,'clues');const visible=()=>page.locator('.progressive-clues li');assert.equal(await visible().count(),1);assert.equal(await page.locator('.canonical-answer').count(),0);await action(page,'next-clue').focus();await action(page,'next-clue').press('Enter');assert.equal(await visible().count(),2);assert.deepEqual(await visible().allTextContents(),question.clues.slice(0,2));
  await reload(page,context);await action(page,'resume').click();if((await state(page)).state==='PAUSED')await action(page,'engine','[data-type="RESUME"]').click();assert.equal((await state(page)).state,'QUESTION_ACTIVE');assert.equal(await visible().count(),2);assert.equal(await page.locator('.canonical-answer').count(),0);
  await action(page,'reveal').click();assert.equal(await page.locator('.canonical-answer').innerText(),question.correctAnswer);assert.equal(await page.locator('[data-team-action="award"]').count(),3);assert((await page.locator('#main').innerText()).includes(question.judging));
 }finally{await context.close();}});
 await check('identical saved-storage notifications after reload do not block the host, while different writes still lock',async()=>{const{page,context}=await fresh();try{
  await start(page);await reload(page,context);await page.evaluate(()=>{const key='seen-khaled-teams-v2',raw=localStorage.getItem(key);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw,storageArea:localStorage,url:location.href}));});
  assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),false);await action(page,'resume').click();if((await state(page)).state==='PAUSED')await action(page,'engine','[data-type="RESUME"]').click();assert.equal((await state(page)).state,'BOARD');
  const before=await state(page);await page.evaluate(()=>{const key='seen-khaled-teams-v2',different=JSON.parse(localStorage.getItem(key));different.match.serial+=1;window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(different),storageArea:localStorage,url:location.href}));});
  assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),true);assert((await page.locator('#dialog').innerText()).includes('نافذة أخرى'));assert.deepEqual((await state(page)).teams.map(team=>team.score),before.teams.map(team=>team.score));assert.equal(await page.locator('[data-team-action="reload"]').count(),1);
 }finally{await context.close();}});
 await check('V4 host UX has no uncaught runtime errors or external gameplay requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
 await browser.close();const report={testURL:URL,environment:'Chromium touch/viewport emulation; no real-device testing',passed:checks.filter(check=>check.ok).length,failed:checks.filter(check=>!check.ok).length,checks,errors,network};await fs.writeFile('/tmp/seen-v4-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:'/tmp/seen-v4-ui-report.json'}));if(report.failed)process.exitCode=1;
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
