/* Pure source regressions for solo eligibility, daily determinism and UI concealment.
   Run: node tests/solo-v3.spec.cjs. Browser interactions are covered by game.spec.cjs. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const TeamEngine=require('../team-engine.js');
const bank=fs.readdirSync(path.join(root,'content')).filter(f=>f.endsWith('.json')).sort().flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,'content',f),'utf8')));
const storage=new Map();
const context={console,TeamEngine,URL,Date,Math,Set,Map,JSON,structuredClone,TextEncoder,TextDecoder,Uint8Array,btoa,atob,window:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:()=>({textContent:'',classList:{add(){},remove(){}},focus(){}}),querySelectorAll:()=>[]},clearInterval(){},setTimeout(){},clearTimeout(){}};
vm.createContext(context);
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').split("document.addEventListener('click'")[0];
vm.runInContext('const QUESTION_BANK='+JSON.stringify(bank)+';\n'+fs.readFileSync(path.join(root,'graphics.js'),'utf8')+'\nVISUALS.test={alt:"تعريف الإجابة الصحيحة"};\n'+source,context);
const evaluate=code=>vm.runInContext(code,context);
let passed=0,failed=0;
function run(name,fn){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e.stack);}}
run('runtime content validator accepts supported release schemas and rejects unknown versions',()=>{
  assert.equal(evaluate(`validateBank(QUESTION_BANK.filter(q=>!q.image)).length`),0);
  assert.equal(evaluate(`validateBank([{...QUESTION_BANK.find(q=>!q.image),source:{title:'مرجع مطبوع',reference:'الجزء 1، الصفحة 20',bibliography:'مرجع اختبار، طبعة محددة، الجزء 1، الصفحة 20'}}]).length`),0);
  assert(evaluate(`validateBank([{...QUESTION_BANK.find(q=>!q.image),version:99}]).length`)>0);
});
run('daily skips empty and exhausted categories, fills actual capacity without repetition',()=>{
  const result=evaluate(`(()=>{const pool=QUESTION_BANK.filter(q=>q.category==='geo').slice(0,8);return chooseDaily(pool,10,7).map(q=>q.id);})()`);
  assert.equal(result.length,8);assert.equal(new Set(result).size,8);
});
run('daily excludes disabled and unavailable IDs and remains stable across source ordering',()=>{
  const result=evaluate(`(()=>{const pool=QUESTION_BANK.slice(0,30).map((q,i)=>({...q,disabled:i%4===0}));pool[1].unavailable=true;pool[2].available=false;pool.push({...pool[1],id:'unavailable-question'});return {one:chooseDaily(pool,10,37).map(q=>q.id),two:chooseDaily([...pool].reverse(),10,37).map(q=>q.id),disabled:pool.filter(q=>q.disabled||q.unavailable||q.available===false).map(q=>q.id)};})()`);
  assert.deepEqual([...result.one],[...result.two]);assert.equal(result.one.length,10);assert(!result.one.some(id=>result.disabled.includes(id)));assert(!result.one.includes('unavailable-question'));
});
run('daily seed affects selection and an empty pool is safe',()=>{
  const result=evaluate(`({one:chooseDaily(QUESTION_BANK,10,4).map(q=>q.id),two:chooseDaily(QUESTION_BANK,10,5).map(q=>q.id),empty:chooseDaily([],10,1)})`);
  assert.notDeepEqual([...result.one],[...result.two]);assert.equal(result.empty.length,0);
});
run('daily start records actual total and preserves one-question challenge on restoration',()=>{
  const result=evaluate(`(()=>{const original=QUESTION_BANK.map(q=>q.disabled);QUESTION_BANK.forEach(q=>q.disabled=true);QUESTION_BANK[0].disabled=false;const wasSpoiler=QUESTION_BANK[0].spoiler,wasLevel=QUESTION_BANK[0].spoilerLevel;QUESTION_BANK[0].spoiler=false;QUESTION_BANK[0].spoilerLevel=1;prefs.anime=defaultAnime();setup={mode:'daily',players:1,names:['خالد'],cats:CATEGORIES.map(c=>c.id),format:'choice',series:'all'};render=()=>{};navigate=()=>{};startGame('daily',true);const result={total:session.total,target:session.target,remaining:session.remaining.length,valid:!!validateSession(session)};QUESTION_BANK.forEach((q,i)=>q.disabled=original[i]);QUESTION_BANK[0].spoiler=wasSpoiler;QUESTION_BANK[0].spoilerLevel=wasLevel;return result;})()`);
  assert.equal(result.total,1);assert.equal(result.target,1);assert.equal(result.remaining,0);assert.equal(result.valid,true);
});
run('daily restore rejects mismatched totals and overlapping progress IDs',()=>{
  assert.equal(evaluate(`validateSession({...session,total:10,target:10})`),null);
  assert.equal(evaluate(`validateSession({...session,remaining:[session.current.id],total:2,target:2})`),null);
});
run('all solo save modes reject replaying a resolved answer or contradictory score ledgers',()=>{
  const result=evaluate(`(()=>{const base=structuredClone(session);base.mode='solo';base.remaining=[];base.results=[{id:base.current.id,correct:true,points:200,player:0}];base.players[0].answered=base.players[0].correct=1;base.players[0].score=200;base.current.phase='feedback';base.current.correct=true;base.current.earned=200;base.current.deadline=null;base.current.chosen=QUESTION_MAP.get(base.current.id).answer;const valid=!!validateSession(base);const mutations=[s=>{s.current.phase='answer';s.current.correct=null;s.current.earned=0;},s=>{s.remaining=[s.current.id]},s=>{s.players[0].score++},s=>{s.players[0].correct=0},s=>{s.current.earned++},s=>{s.format='unknown'}];return {valid,rejected:mutations.map(change=>{const bad=structuredClone(base);change(bad);return validateSession(bad)===null;})};})()`);
  assert.equal(result.valid,true);assert(result.rejected.every(Boolean));
});
run('legacy preference imports retain progress and gain conservative spoiler defaults',()=>{
  const result=evaluate(`(()=>{const oldPrefs={...prefs};delete oldPrefs.anime;delete oldPrefs.repetition;const x=validateSave({version:1,prefs:oldPrefs,progress:freshProgress()});return {count:x.prefs.anime.selected.length,levels:Object.values(x.prefs.anime.levels),policy:x.prefs.repetition};})()`);
  assert.equal(result.count,12);assert(result.levels.every(n=>n===1));assert.equal(result.policy,'recent');
});
run('all forbidden JSON keys and dangerous URL schemes are rejected',()=>{
  for(const key of ['__proto__','prototype','constructor'])assert.throws(()=>evaluate(`parseSafeJSON(${JSON.stringify('{"nested":{"'+key+'":{"polluted":true}}}')})`));
  for(const url of ['javascript:alert(1)','data:text/html,x','http://example.org','https://user:pass@example.org','https://example.org/\npage'])assert.equal(evaluate('safeURL('+JSON.stringify(url)+')'),'#');
  assert.equal(evaluate("safeURL('https://example.org/a?q=1')"),'https://example.org/a?q=1');
});
run('portable host backup roundtrips Arabic and Unicode without plain answer text',()=>{
  const result=evaluate(`(()=>{const data={version:3,answer:'إجابة عربية 🎮 </script>',remainingMs:15000,helper:'double'},envelope=encodeMatchBackup('teams',data);return {format:envelope.format,encoding:envelope.encoding,raw:JSON.stringify(envelope),restored:decodeMatchBackup(envelope,'teams')};})()`);
  assert.equal(result.format,'seen-khaled-resume');assert.equal(result.encoding,'base64-utf8');
  assert(!result.raw.includes('إجابة عربية'));assert(!result.raw.includes('</script>'));
  assert.equal(result.restored.answer,'إجابة عربية 🎮 </script>');assert.equal(result.restored.remainingMs,15000);
});
run('portable imports reject malformed encoding, wrong mode and hostile JSON before state changes',()=>{
  for(const patch of [{version:99},{kind:'solo'},{encoding:'rot13'},{payload:'###='},{payload:'YQ='},{payload:'/w=='},{payload:Buffer.from('{"nested":{"__proto__":{"polluted":true}}}').toString('base64')}]){
    assert.throws(()=>evaluate(`decodeMatchBackup({...encodeMatchBackup('teams',{value:1}),...${JSON.stringify(patch)}},'teams')`));
  }
  assert.equal({}.polluted,undefined);
});
run('active answer protection covers assigned solo IDs and unrevealed team questions',()=>{
  assert.equal(evaluate('isAnswerProtected(session.current.id)'),true);
  assert.equal(evaluate(`(()=>{window.SeenTeamUI={match:{state:'QUESTION_ACTIVE',board:[{questionId:'team-only',done:false}],current:{questionId:'team-only',revealed:false}}};return isAnswerProtected('team-only');})()`),true);
  assert.equal(evaluate(`(()=>{window.SeenTeamUI.match.current.revealed=true;return isAnswerProtected('team-only');})()`),false);
});
run('visual descriptions and hint text do not reveal a canonical answer before reveal',()=>{
  const result=evaluate(`(()=>{const q={image:'test',options:['الإجابة الصحيحة','ب','ج','د'],answer:0,hint:'ابحث عن الإجابة الصحيحة'};return {alt:questionAlt(q),reveal:questionAlt(q,true),hint:safeHint(q)};})()`);
  assert(!result.alt.includes('الإجابة الصحيحة'));assert(!result.hint.includes('الإجابة الصحيحة'));assert(result.reveal.includes('الإجابة الصحيحة'));
  assert.notEqual(evaluate(`safeHint({options:['L','A','B','C'],answer:0,hint:'L'})`),'L');
});
run('restored board identifiers cannot inject markup and in-memory rendering escapes keys',()=>{
  const result=evaluate(`(()=>{const saved=session,s=structuredClone(session),id=s.current.id;s.mode='classic';s.current=null;s.board=[{id,category:QUESTION_MAP.get(id).category,points:200,done:false,key:'valid-tile-0'}];const valid=!!validateSession(s);s.board[0].key='\" required data-malicious=\"injection';const invalid=validateSession(s)===null;session=s;const html=renderBoard();session=saved;return {valid,invalid,escaped:html.includes('data-key=\"&quot; required data-malicious=&quot;injection\"')};})()`);
  assert.equal(result.valid,true);assert.equal(result.invalid,true);assert.equal(result.escaped,true);
});
run('custom solo saves restore after owner library loads without a false recovery notice',()=>{
  const result=evaluate(`(()=>{const q={...QUESTION_BANK[0],id:'owner-custom-solo'},s=structuredClone(session);s.current.id=q.id;s.board=[];s.remaining=[];s.results=[];s.target=s.total=1;s.mode='daily';const raw=JSON.stringify({version:1,prefs,progress:{...freshProgress(),seen:{[q.id]:123}},session:s});localStorage.setItem(STORAGE_KEY,raw);soloRecovery=null;load(false);const deferred=!soloRecovery&&session===null;QUESTION_BANK.push(q);QUESTION_MAP.set(q.id,q);load();const result={deferred,restored:session?.current?.id===q.id,seen:progress.seen[q.id],recovery:soloRecovery};QUESTION_BANK.pop();QUESTION_MAP.delete(q.id);return result;})()`);
  assert.equal(result.deferred,true);assert.equal(result.restored,true);assert.equal(result.seen,123);assert.equal(result.recovery,null);
});
run('portable solo import validates a staged custom library without changing the current game',()=>{
  const result=evaluate(`(()=>{const previous=window.SeenTeamUI,q={...QUESTION_BANK[0],id:'owner-portable-new'},candidate=new Map(QUESTION_MAP);candidate.set(q.id,q);const saved=structuredClone(session);saved.current.id=q.id;saved.mode='daily';saved.remaining=[];saved.board=[];saved.results=[];saved.total=saved.target=1;const data={version:1,prefs,progress:{...freshProgress(),seen:{[q.id]:123}},session:saved,library:{edits:[q],disabled:[]}};window.SeenTeamUI={prepareResumeLibrary:raw=>({edits:raw.edits,disabled:[],questions:[...candidate.values()]})};const original=JSON.stringify(session),prepared=prepareSoloResume(encodeMatchBackup('solo',data));window.SeenTeamUI=previous;return {id:prepared.checked.session.current.id,paused:prepared.checked.session.current.paused,seen:prepared.checked.progress.seen[q.id],same:JSON.stringify(session)===original,installed:QUESTION_MAP.has(q.id)};})()`);
  assert.equal(result.id,'owner-portable-new');assert.equal(result.paused,true);assert.equal(result.seen,123);assert.equal(result.same,true);assert.equal(result.installed,false);
});
run('question-cycle reset preserves results, achievements, profile and active state',()=>{
  const result=evaluate(`(()=>{progress.seen={[QUESTION_BANK[0].id]:123};progress.answers=5;progress.correct=3;progress.achievements=['first'];const before=JSON.stringify({...progress,seen:{}}),live=JSON.stringify(session);resetQuestionHistory();return {empty:Object.keys(progress.seen).length===0,same:JSON.stringify(progress)===before,live:JSON.stringify(session)===live,cutoff:prefs.questionHistoryResetAt};})()`);
  assert.equal(result.empty,true);assert.equal(result.same,true);assert.equal(result.live,true);assert(result.cutoff>0);
});
run('storage denial never erases an in-memory solo round and persistence reports failure',()=>{
  const result=evaluate(`(()=>{const original=localStorage.setItem,before=JSON.stringify(session);localStorage.setItem=()=>{throw Error('denied')};storageAvailable=true;const saved=persist();localStorage.setItem=original;return {saved,available:storageAvailable,intact:before===JSON.stringify(session)};})()`);
  assert.equal(result.saved,false);assert.equal(result.available,false);assert.equal(result.intact,true);
});
run('recovery export eligibility remains closed for active or paused team and solo matches',()=>{
  const states=evaluate(`(()=>{const saved=session,ui=window.SeenTeamUI;session={status:'active'};window.SeenTeamUI={match:null};const solo=hasActiveTrivia();session={status:'done'};window.SeenTeamUI={match:{state:'BOARD'}};const board=hasActiveTrivia();window.SeenTeamUI.match.state='PAUSED';const paused=hasActiveTrivia();window.SeenTeamUI.match.state='MATCH_COMPLETE';const complete=hasActiveTrivia();session=null;window.SeenTeamUI={match:null};const none=hasActiveTrivia();session=saved;window.SeenTeamUI=ui;return {solo,board,paused,complete,none};})()`);
  assert.equal(states.solo,true);assert.equal(states.board,true);assert.equal(states.paused,true);assert.equal(states.complete,false);assert.equal(states.none,false);
});
run('failed solo restoration preserves valid profile and exact raw recovery backup',()=>{
  const result=evaluate(`(()=>{const raw=JSON.stringify({version:1,prefs,progress:{...freshProgress(),xp:99},session:{schema:999}});localStorage.setItem(STORAGE_KEY,raw);session=null;load();return {xp:progress.xp,active:session,recovery:soloRecovery,raw,backup:localStorage.getItem(STORAGE_KEY+'-recovery')};})()`);
  assert.equal(result.xp,99);assert.equal(result.active,null);assert.equal(result.recovery,result.raw);assert.equal(result.backup,result.raw);
});
console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
