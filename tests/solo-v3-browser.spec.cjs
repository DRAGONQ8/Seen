/* Focused V3 interactions against the generated, offline-capable HTML.
   Start python -m http.server 8765, then node tests/solo-v3-browser.spec.cjs. */
'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const URL=process.env.SEEN_TEST_URL||'http://127.0.0.1:8765/index.html';
const report={passed:0,failed:0,tests:[],errors:[],requests:[]};
let browser;
async function fresh({deniedStorage=false,downloadUnavailable=false}={}){const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,reducedMotion:'reduce',acceptDownloads:true});await context.addInitScript(({deniedStorage,downloadUnavailable})=>{if(deniedStorage){Storage.prototype.getItem=()=>{throw new DOMException('denied','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('denied','SecurityError');};}if(downloadUnavailable)URL.createObjectURL=undefined;},{deniedStorage,downloadUnavailable});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(new global.URL(URL).origin+'/'))report.requests.push(r.url());});await page.goto(URL,{waitUntil:'load'});await page.waitForFunction(()=>window.SeenDiagnostics);await page.evaluate(()=>{prefs.sound=0;prefs.music=0;prefs.timer=false;prefs.reduced=true;applyPrefs();persist();});await context.setOffline(true);return {page,context};}
async function downloadSolo(page){const pending=page.waitForEvent('download');await page.locator('[data-action=solo-export]').first().click();const file=await pending;return JSON.parse(await fs.readFile(await file.path(),'utf8'));}
async function uploadSolo(page,data){await page.locator('#import-file').setInputFiles({name:'resume.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});}
async function ensureAnimePanel(page){const panel=page.locator("#solo-anime-preferences");if(!await panel.evaluate(el=>el.open))await panel.locator("summary").click();}
async function run(name,fn){try{await fn();report.passed++;report.tests.push({name,ok:true});console.log('PASS',name);}catch(e){report.failed++;report.tests.push({name,ok:false,error:String(e)});console.error('FAIL',name,e.stack);}}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 await run('daily uses enabled questions, survives exhausted categories and completes actual count',async()=>{
  const {page,context}=await fresh();
  await page.evaluate(()=>{const available=QUESTION_BANK.filter(q=>q.category==='geo').slice(0,3);QUESTION_BANK.forEach(q=>q.disabled=!available.includes(q));render();});
  assert.match(await page.locator('.daily-banner h2').textContent(),/3/);
  await page.locator('[data-action=daily]').click();
  const state=await page.evaluate(()=>({target:session.target,total:session.total,ids:[session.current.id,...session.remaining],disabled:QUESTION_BANK.filter(q=>q.disabled).map(q=>q.id)}));
  assert.equal(state.target,3);assert.equal(state.total,3);assert.equal(new Set(state.ids).size,3);assert(!state.ids.some(id=>state.disabled.includes(id)));
  for(let i=0;i<3;i++){const index=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${index}"]`).click();await page.locator('[data-action=next]').click();}
  assert.equal(await page.evaluate(()=>session.status),'done');assert.equal(await page.evaluate(()=>session.results.length),3);assert.equal(await page.evaluate(()=>progress.daily[session.date].completed),true);
  await context.close();
 });
 await run('daily reload preserves selected IDs, completed progress, date and paused timer',async()=>{
  const {page,context}=await fresh();await page.locator('[data-action=daily]').click();
  const before=await page.evaluate(()=>({ids:[session.current.id,...session.remaining],date:session.date,total:session.total}));
  const answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();await page.locator('[data-action=next]').click();
  const active=await page.evaluate(()=>({id:session.current.id,remaining:[...session.remaining],answered:progress.answers}));
  await context.setOffline(false);await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.SeenDiagnostics);await context.setOffline(true);
  const restored=await page.evaluate(()=>({id:session.current.id,remaining:session.remaining,answers:progress.answers,total:session.total,date:session.date,paused:session.current.paused}));
  assert.equal(restored.id,active.id);assert.deepEqual(restored.remaining,active.remaining);assert.equal(restored.answers,active.answered);assert.equal(restored.date,before.date);assert.equal(restored.total,before.total);assert.equal(restored.paused,true);
  await page.locator('[data-action=resume]').click();await page.locator('[data-action=unpause]').click();assert.equal(await page.evaluate(()=>session.current.paused),false);
  await context.close();
 });
 await run('solo history conceals a previously encountered answer assigned to the active round',async()=>{
  const {page,context}=await fresh();await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();
  await page.evaluate(()=>{progress.history=[{id:session.current.id,correct:true,at:Date.now()-1000}];persist();});
  await page.locator('[data-action=nav][data-route=profile]:visible').first().click();await page.locator('[data-action=nav][data-route=history]').click();
  await page.locator('.review-item summary').click();assert.equal(await page.locator('.review-item strong').count(),0);assert.equal(await page.locator('.review-item .source-link').count(),0);assert.match(await page.locator('.review-item').textContent(),/الإجابة محجوبة/);
  await page.locator('[data-action=nav][data-route=home]:visible').first().click();await page.locator('[data-action=resume]').click();await page.locator('[data-action=unpause]').click();
  const answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();assert.equal(await page.locator('.feedback').count(),1);assert.equal(await page.locator('.feedback .source-line .source-link').count(),1);
  await context.close();
 });
 await run('image alt and enlarged view keep identification and attribution hidden until answer reveal',async()=>{
  const {page,context}=await fresh();await page.locator('[data-action=setup][data-mode=images]').click();await page.locator('[data-action=start]').click();
  const alt=await page.locator('.question-media img').getAttribute('alt');assert.equal(alt,'دليل بصري للسؤال؛ الوصف التعريفي متاح بعد الإجابة.');assert.equal(await page.locator('.media-credit').count(),0);
  await page.locator('[data-action=zoom]').click();assert.equal(await page.locator('#dialog img').getAttribute('alt'),alt);assert.equal(await page.locator('#dialog .source-link').count(),0);await page.locator('[data-action=close-dialog]').click();
  await page.locator('[data-action=unpause]').click();const answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();assert.equal(await page.locator('.source-link').count()>0,true);
  await context.close();
 });
 await run('independent anime selection and three spoiler levels persist without weakening limits',async()=>{
  const {page,context}=await fresh();await page.locator('[data-action=setup][data-mode=solo]').click();await ensureAnimePanel(page);
  await page.locator('[data-action=solo-anime-none]').click();await ensureAnimePanel(page);await page.locator('[data-solo-anime=naruto]').check();
  await ensureAnimePanel(page);await page.locator('[data-solo-anime=one-piece]').check();
  await ensureAnimePanel(page);await page.locator('[data-solo-spoiler=naruto]').selectOption('2');
  await ensureAnimePanel(page);await page.locator('[data-solo-spoiler=one-piece]').selectOption('3');
  const before=await page.evaluate(()=>({anime:prefs.anime,pool:eligible(['anime']).map(q=>({id:q.id,franchise:q.franchiseId||q.sub,level:q.spoilerLevel||Number(q.spoiler)+1}))}));assert.deepEqual(new Set(before.anime.selected),new Set(['naruto','one-piece']));assert.equal(before.anime.levels.naruto,2);assert.equal(before.anime.levels['one-piece'],3);
  await context.setOffline(false);await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.SeenDiagnostics);await context.setOffline(true);
  assert.deepEqual(await page.evaluate(()=>prefs.anime),before.anime);assert.equal(await page.evaluate(()=>eligible(['anime']).every(q=>TeamEngine.isEligible(q,soloEligibility()))),true);
  await context.close();
 });
 await run('unrestorable solo session retains profile and provides an exact recovery export',async()=>{
  const {page,context}=await fresh();const raw=await page.evaluate(()=>{progress.xp=123;const raw=JSON.stringify({version:1,prefs,progress,session:{schema:999}});localStorage.setItem(STORAGE_KEY,raw);return raw;});
  await context.setOffline(false);await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.SeenDiagnostics);await context.setOffline(true);
  const restored=await page.evaluate(()=>({xp:progress.xp,session,backup:localStorage.getItem(STORAGE_KEY+'-recovery')}));assert.equal(restored.xp,123);assert.equal(restored.session,null);assert.equal(restored.backup,raw);
  await page.locator('[data-action=nav][data-route=settings]:visible').first().click();const downloaded=page.waitForEvent('download');await page.locator('[data-action=solo-recovery]').click();const download=await downloaded;assert.match(download.suggestedFilename(),/^seen-recovery-/);const file=await download.path();assert.equal(await fs.readFile(file,'utf8'),raw);await context.close();
 });
 await run('raw recovery exports wait for active matches and retain exact bytes after completion',async()=>{
  const {page,context}=await fresh();const soloRaw='{"version":999,"protectedAnswer":"جواب استرداد فردي"}',teamRaw='{"version":999,"questions":{"old":{"correctAnswer":"جواب استرداد فريقين"}}}';
  await page.evaluate(({soloRaw,teamRaw})=>{localStorage.setItem(STORAGE_KEY+'-recovery',soloRaw);localStorage.setItem('seen-khaled-teams-v2-recovery',teamRaw);},{soloRaw,teamRaw});
  await context.setOffline(false);await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.SeenDiagnostics);await context.setOffline(true);await page.waitForTimeout(700);let downloads=0;page.on('download',()=>downloads++);
  // Install a newly generated board fixture; the tested export actions are actual UI controls.
  await page.evaluate(()=>{const config=TeamEngine.defaults();config.timer=false;SeenTeamUI.store.match=TeamEngine.create(config,QUESTION_BANK,{seed:17});navigate('home');});
  await page.locator('[data-team-action=recovery-export]').click();await page.waitForTimeout(100);assert.equal(downloads,0);assert.match(await page.locator('#toast').textContent(),/بعد اكتمال/);
  await page.locator('[data-action=nav][data-route=settings]:visible').first().click();await page.locator('[data-action=solo-recovery]').click();await page.waitForTimeout(100);assert.equal(downloads,0);
  await page.evaluate(()=>{SeenTeamUI.store.match=null;navigate('home');prefs.timer=false;});await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();
  await page.locator('[data-action=nav][data-route=settings]:visible').first().click();await page.locator('[data-action=solo-recovery]').click();await page.waitForTimeout(100);assert.equal(downloads,0);
  await page.locator('[data-action=nav][data-route=home]:visible').first().click();await page.locator('[data-team-action=recovery-export]').click();await page.waitForTimeout(100);assert.equal(downloads,0);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem(STORAGE_KEY+'-recovery'),localStorage.getItem('seen-khaled-teams-v2-recovery')]),[soloRaw,teamRaw]);
  await page.locator('[data-action=resume]').click();await page.locator('[data-action=unpause]').click();
  while(await page.evaluate(()=>session.status==='active')){const answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();await page.locator('[data-action=next]').click();}
  await page.locator('[data-action=nav][data-route=settings]:visible').first().click();let pending=page.waitForEvent('download');await page.locator('[data-action=solo-recovery]').click();let downloaded=await pending;assert.equal(await fs.readFile(await downloaded.path(),'utf8'),soloRaw);
  await page.locator('[data-action=nav][data-route=home]:visible').first().click();pending=page.waitForEvent('download');await page.locator('[data-team-action=recovery-export]').click();downloaded=await pending;assert.equal(await fs.readFile(await downloaded.path(),'utf8'),teamRaw);assert.equal(downloads,2);await context.close();
 });
 await run('active solo host export restores order, helper consumption, scores and a paused timer',async()=>{
  const {page,context}=await fresh();await page.evaluate(()=>{prefs.timer=true;prefs.duration=30;});await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();
  let answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();await page.locator('[data-action=next]').click();await page.locator('[data-action=helper][data-helper=double]').click();
  await page.locator('[data-action=nav][data-route=settings]:visible').first().click();const before=await page.evaluate(()=>JSON.parse(JSON.stringify({session,progress}))),envelope=await downloadSolo(page);assert.equal(envelope.kind,'solo');assert(!JSON.stringify(envelope).includes('"correctAnswer"'));
  await page.evaluate(()=>{session.players[0].score=9999;});await uploadSolo(page,envelope);await page.locator('#confirm-import').click();assert.equal(await page.evaluate(()=>route),'play');
  const restored=await page.evaluate(()=>JSON.parse(JSON.stringify({session,progress})));assert.deepEqual(restored.session.remaining,before.session.remaining);assert.deepEqual(restored.session.results,before.session.results);assert.deepEqual(restored.session.players,before.session.players);assert.deepEqual(restored.session.bags,before.session.bags);assert.equal(restored.session.current.double,true);assert.equal(restored.session.current.paused,true);assert.equal(restored.session.current.deadline,null);assert.equal(restored.session.current.remainingMs,before.session.current.remainingMs);assert.equal(restored.progress.answers,before.progress.answers);
  await context.setOffline(false);await page.reload();await page.waitForFunction(()=>window.SeenTeamUI?.ready());await context.setOffline(true);assert.equal(await page.evaluate(()=>session.current.double),true);assert.equal(await page.evaluate(()=>session.current.id),before.session.current.id);await context.close();
 });
 await run('solo resume carries owner questions to a fresh browser and rejects corrupt library without mutation',async()=>{
  const first=await fresh();await first.page.evaluate(()=>{const template=QUESTION_BANK.find(q=>q.category==='geo'&&!q.image),q={...template,id:'owner-portable-browser',q:'أي خيار يمثل الجواب في سؤال الاستئناف المحلي المخصص للاختبار؟'};const staged=SeenTeamUI.prepareResumeLibrary({edits:[q],disabled:[]});SeenTeamUI.commitResumeLibrary(staged);QUESTION_BANK.forEach(question=>question.disabled=question.id!==q.id);render();});await first.page.locator('[data-action=daily]').click();await first.page.locator('[data-action=nav][data-route=settings]:visible').first().click();const envelope=await downloadSolo(first.page);await first.context.close();
  const {page,context}=await fresh();assert.equal(await page.evaluate(()=>QUESTION_MAP.has('owner-portable-browser')),false);const malformed=await page.evaluate(envelope=>{const data=decodeMatchBackup(envelope,'solo');data.library.edits[0].answer=9;return encodeMatchBackup('solo',data);},envelope);await uploadSolo(page,malformed);assert.equal(await page.locator('#confirm-import').count(),0);assert.equal(await page.evaluate(()=>QUESTION_MAP.has('owner-portable-browser')),false);assert.equal(await page.evaluate(()=>session),null);
  await uploadSolo(page,envelope);await page.locator('#confirm-import').click();assert.equal(await page.evaluate(()=>session.current.id),'owner-portable-browser');assert.equal(await page.evaluate(()=>SeenTeamUI.store.edits.some(q=>q.id==='owner-portable-browser')),true);await context.setOffline(false);await page.reload();await page.waitForFunction(()=>window.SeenTeamUI?.ready());await context.setOffline(true);assert.equal(await page.evaluate(()=>session.current.id),'owner-portable-browser');assert.equal(await page.evaluate(()=>session.current.paused),true);await context.close();
 });
 await run('denied storage keeps an active solo game portable without claiming automatic save',async()=>{
  const {page,context}=await fresh({deniedStorage:true});await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();assert.match(await page.locator('.inline-note.warning').first().innerText(),/الحفظ التلقائي غير متاح/);const before=await page.evaluate(()=>session.current.id),envelope=await downloadSolo(page);assert.equal(await page.evaluate(()=>storageAvailable),false);await uploadSolo(page,envelope);await page.locator('#confirm-import').click();assert.equal(await page.evaluate(()=>session.current.id),before);assert.equal(await page.evaluate(()=>session.current.paused),true);assert.equal(await page.evaluate(()=>storageAvailable),false);await context.close();
 });
 await run('download API fallback roundtrips encoded resume text without files and rejects hostile pasted data',async()=>{
  const {page,context}=await fresh({downloadUnavailable:true});await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();const before=await page.evaluate(()=>session.current.id);await page.locator('[data-action=nav][data-route=settings]:visible').first().click();await page.locator('[data-action=solo-export]').click();const text=await page.locator('#manual-save-text').inputValue(),envelope=JSON.parse(text);assert.equal(envelope.kind,'solo');assert.equal(await page.locator('#manual-save-text').getAttribute('readonly'),'');assert.equal(await page.evaluate(()=>session.current.id),before);assert.equal(await page.evaluate(()=>session.current.paused),true);await page.locator('[data-action=copy-save]').click();await page.waitForTimeout(100);await page.locator('[data-action=close-dialog]').click();await page.locator('[data-action=paste-save]').click();await page.locator('#paste-save-text').fill('{"__proto__":{"polluted":true}}');await page.locator('#prepare-pasted-save').click();assert.equal(await page.locator('#confirm-import').count(),0);assert.equal(await page.evaluate(()=>session.current.id),before);assert.equal(await page.evaluate(()=>({}).polluted),undefined);await page.locator('#paste-save-text').fill(text);await page.locator('#prepare-pasted-save').click();await page.locator('#confirm-import').click();assert.equal(await page.evaluate(()=>route),'play');assert.equal(await page.evaluate(()=>session.current.id),before);assert.equal(await page.evaluate(()=>session.current.paused),true);await context.close();
 });
 await run('starting a new question cycle clears repetition only and retains the saved round',async()=>{
  const {page,context}=await fresh();await page.locator('[data-action=setup][data-mode=solo]').click();await page.locator('[data-action=start]').click();const answer=await page.evaluate(()=>QUESTION_MAP.get(session.current.id).answer);await page.locator(`[data-action=answer][data-index="${answer}"]`).click();await page.locator('[data-action=nav][data-route=settings]:visible').first().click();const before=await page.evaluate(()=>JSON.parse(JSON.stringify({progress,session})));assert(Object.keys(before.progress.seen).length>0);await page.locator('[data-action=reset-seen]').click();await page.locator('#confirm-reset-seen').click();const after=await page.evaluate(()=>JSON.parse(JSON.stringify({progress,session,cutoff:prefs.questionHistoryResetAt})));assert.deepEqual(after.progress,{...before.progress,seen:{}});assert.deepEqual(after.session,before.session);assert(after.cutoff>0);await context.close();
 });
 await run('V3 solo interactions have no uncaught errors or external requests',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);});
 await browser.close();await fs.writeFile('/tmp/seen-solo-v3-browser-report.json',JSON.stringify(report,null,2));console.log(`\n${report.passed} passed, ${report.failed} failed`);if(report.failed)process.exitCode=1;
})().catch(async e=>{console.error(e.stack);await browser?.close();process.exitCode=1;});
