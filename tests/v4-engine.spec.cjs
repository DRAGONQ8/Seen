/* Restore invariants, editorial eligibility and offline advanced format reducer. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../team-engine.js');
const bank=fs.readdirSync(path.join(__dirname,'../content')).sort().filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(path.join(__dirname,'../content',f),'utf8')));
let now=Date.now(), passed=0, failed=0;
const copy=s=>JSON.parse(JSON.stringify(s));
const act=(s,type,fields={})=>E.dispatch(s,{type,...fields},bank,now+=5);
function config(extra={}) {return Object.assign(E.defaults(),{board:'compact',timer:false},extra);}
function create(extra={}) {return E.create(config(extra),bank,{now,seed:91});}
function open(s) {s=act(s,'SELECT_TILE',{tileId:s.board.find(t=>!t.done).id});return act(s,'START_QUESTION');}
function settle(s,teamId=0) {if(s.state!=='ANSWER_REVEAL')s=act(s,'REVEAL');const c=s.current;return act(s,'RESOLVE_QUESTION',{teamId,tileId:c.tileId,questionId:c.questionId,token:c.token});}
function run(name,f) {try {f();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e.stack);}}
const rejectMutation=(s,mutate)=>{const bad=copy(s);mutate(bad);const before=JSON.stringify(bad);const result=E.restore(bad,bank);assert.equal(Boolean(result.state),false);assert.equal(result.backup,bad);assert.equal(JSON.stringify(bad),before);};
run('restoration rejects forged award amounts even when score chains and summary agree',()=>{
 const s=settle(open(create()));assert(E.validateState(s,bank));rejectMutation(s,t=>{t.transactions[0].scoreAfter=600;t.teams[0].score=600;t.lastResolution.earned=600;t.lastResolution.deltas=[600,0];});
});
run('every resolved transaction belongs to exactly one matching question and history group',()=>{
 let s=settle(open(create()));s=settle(open(s),1);assert(E.validateState(s,bank));
 for(const change of [t=>t.history[0].transactionIds=[],t=>t.history[0].transactionIds=[t.history[1].transactionIds[0]],t=>t.transactions[0].questionId=t.history[1].questionId,t=>t.transactions[0].timestamp++,t=>t.transactions[0].modifier='double',t=>t.transactions[0].reason='pit',t=>t.transactions[1].groupId=t.transactions[0].groupId])rejectMutation(s,change);
});
run('board slot identities are unique and points stay bound to the saved question',()=>{
 const s=create({board:'classic'});rejectMutation(s,t=>{t.board[1].slot=t.board[0].slot;});rejectMutation(s,t=>{t.board[0].id='wrong-identity';});
 let complete=s;while(complete.state!=='MATCH_COMPLETE')complete=settle(open(complete),null);
 rejectMutation(complete,t=>{const q=t.questions[t.board[0].questionId];q.points=600;});
});
run('completion and winner metadata cannot contradict the board and scores',()=>{
 const s=settle(open(create()));for(const change of [t=>t.winner=1,t=>t.completedAt=now,t=>{t.state='PAUSED';t.pausedFrom='MATCH_COMPLETE';}])rejectMutation(s,change);
});
run('helper identity and question linkage cannot be duplicated across histories',()=>{
 const c=config();c.teams.forEach(t=>t.assists=['hint']);let s=E.create(c,bank,{now,seed:91});s=open(s);s=act(s,'ASSIST',{key:'hint',confirmed:true});s=settle(s);s=open(s);s=act(s,'ASSIST',{key:'hint',confirmed:true});s=settle(s,1);assert(E.validateState(s,bank));
 rejectMutation(s,t=>{const old=t.teams[0].assistHistory[0].id;t.teams[1].assistHistory[0].id=old;t.history[1].assists[0].id=old;});
 rejectMutation(s,t=>{t.history[0].assists=[];});
});
run('pending disputed excluded and verification requires actual structured evidence',()=>{
 const base=bank.find(q=>E.isEligible(q,config()));assert(base);
 for(const verification of [{status:'pending'},{status:'disputed'},{status:'unknown'},{status:'source-checked',referenceUrl:'https://example.org'}])assert.equal(E.isEligible({...base,verification},config()),false);
 assert.equal(E.isEligible({...base,verification:{status:'editorial'}},config()),false);
 assert.equal(E.isEligible({...base,verification:undefined},config()),false);
 assert.equal(E.isEligible({...base,publicEligible:false},config()),false);
 for(const patch of [{level:0},{level:5},{level:'3'},{image:'javascript:alert(1)'}])assert.equal(E.isEligible({...base,...patch},config()),false);
 const verification={status:'source-checked',verifiedAt:'2026-10-21',referenceTitle:'مرجع',referenceUrl:'https://example.org/fact',section:'فقرة محددة',notes:'راجعت الادعاء المحدد'};
 assert(E.isEligible({...base,verification},config()));assert.equal(E.isEligible({...base,verification:{...verification,verifiedAt:'2026-02-30'}},config()),false);
});
run('editorial disable after match creation never discards immutable saved questions',()=>{
 const s=open(create());const revised=bank.map(q=>({...q,publicEligible:false,verification:{status:'disputed'}}));const restored=E.validateState(copy(s),revised);assert(restored);assert.equal(restored.current.questionId,s.current.questionId);
});
run('visual variant preferentially chooses images without relaxing eligibility and reports fallback',()=>{
 const c=config({variant:'visual',repetition:'all'}),template=bank.find(q=>E.isEligible(q,c)),synthetic=[];
 for(const category of c.teams.flatMap(t=>t.categories))for(const points of E.VALUES)for(let i=0;i<3;i++)synthetic.push({...template,id:`visual-${category}-${points}-${i}`,category,points,level:points/200,spoiler:false,franchiseId:'naruto',spoilerLevel:1,verification:{...template.verification},image:i===1?'local-image':undefined,q:`سؤال ${category} ${points} ${i}`});
 const s=E.create(c,synthetic,{now,seed:9});assert(s.board.every(t=>s.questions[t.questionId].image));assert.equal(s.selectionWarnings.length,0);
 const text=E.create(c,synthetic.map(q=>({...q,image:undefined})),{now,seed:9});assert(text.selectionWarnings.some(s=>s.includes('نصية')));assert.equal(text.board.length,18);assert(E.validateState(text,synthetic));
 const old=copy(s);delete old.config.variant;old.undo=[];assert(E.validateState(old,synthetic));
});
run('progressive clues persist bounded progress and stale rapid taps cannot skip clues',()=>{
 const c=config(),base=bank.find(q=>E.isEligible(q,c)),synthetic=[];
 for(const category of c.teams.flatMap(t=>t.categories))for(const points of E.VALUES)synthetic.push({...base,id:`clue-${category}-${points}`,category,points,level:points/200,spoiler:false,franchiseId:'naruto',spoilerLevel:1,verification:{...base.verification},type:'clues',instructions:'اكشف الأدلة تدريجيًا',judging:'يُقبل الاسم الصحيح كاملًا',clues:['الدليل الأول','الدليل الثاني','الدليل الثالث']});
 let s=E.create(c,synthetic,{now,seed:7});const send=(type,fields={})=>{s=E.dispatch(s,{type,...fields},synthetic,now+=10);};send('SELECT_TILE',{tileId:s.board[0].id});send('START_QUESTION');assert.equal(s.current.revealedClues,1);const token=s.current.token;send('NEXT_CLUE',{token});assert.equal(s.current.revealedClues,2);send('NEXT_CLUE',{token});assert.equal(s.current.revealedClues,2);const restored=E.validateState(copy(s),synthetic);assert(restored);s=restored;send('RESUME');send('NEXT_CLUE',{token:s.current.token});assert.equal(s.current.revealedClues,3);send('NEXT_CLUE',{token:s.current.token});assert.equal(s.current.revealedClues,3);send('REVEAL');assert.equal(s.state,'ANSWER_REVEAL');const before=copy(s);send('NEXT_CLUE',{token:s.current.token});assert.equal(s.current.revealedClues,3);const bad=copy(before);bad.current.revealedClues=4;assert.equal(E.validateState(bad,synthetic),null);
});
run('all helper outcome and floor combinations restore after award undo and corrected award',()=>{
 for(const key of E.ASSISTS)for(const negative of [true,false])for(const winner of [null,0,1]) {
  const c=config({negative,bonus:true,pitFailPenalty:true,stealPenalty:true});c.teams.forEach(t=>{t.players=['اسم'];t.assists=[key];});let s=E.create(c,bank,{seed:75,now});
  const send=(type,fields={})=>{s=act(s,type,fields);assert(E.validateState(copy(s),bank),`${key}/${negative}/${winner}/${type}`);};
  send('SELECT_TILE',{tileId:s.board[0].id});if(key==='pit')send('ASSIST',{key,confirmed:true});send('START_QUESTION');if(!['pit','time'].includes(key))send('ASSIST',{key,confirmed:true,participant:'اسم'});if(s.state==='ASSISTANCE_ACTIVE')send('RETURN_ASSISTANCE');if(s.state!=='ANSWER_REVEAL')send('REVEAL');
  const resolve=()=>send('RESOLVE_QUESTION',{teamId:winner,tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token});resolve();send('UNDO');resolve();
 }
});
run('correction ceiling preserves room for all remaining scoring transactions',()=>{
 let s=create();const n=1000-s.board.length*3;for(let i=0;i<n;i++){s.undo=[];s=act(s,'ADJUST_SCORE',{teamId:0,delta:1,reason:'تصحيح'});}assert.equal(s.transactions.length,n);assert(E.validateState(copy(s),bank));const rejected=act(s,'ADJUST_SCORE',{teamId:0,delta:1,reason:'تصحيح'});assert(rejected.lastError);assert.equal(rejected.transactions.length,n);assert.equal(rejected.teams[0].score,n);
});
run('challenge selects harder eligible questions within the same point and repetition bucket',()=>{
 const c=config({variant:'challenge',repetition:'all'}),base=bank.find(q=>E.isEligible(q,c)),synthetic=[];
 for(const category of c.teams.flatMap(t=>t.categories))for(const points of E.VALUES)for(let i=0;i<3;i++)synthetic.push({...base,id:`hard-${category}-${points}-${i}`,category,points,level:points===600?(i===1?4:3):points/200,spoiler:false,franchiseId:'naruto',spoilerLevel:1,verification:{...base.verification},q:`سؤال ${category} ${points} ${i}`});
 const s=E.create(c,synthetic,{now,seed:9});assert(s.board.filter(t=>t.value===600).every(t=>s.questions[t.questionId].level===4));assert(E.validateState(s,synthetic));
});
run('custom two four and six category boards share atomic scoring recovery and final undo',()=>{
 for(const categoryCount of [2,4,6])for(const board of ['compact','classic']) {
  const c=config({variant:'custom',categoryCount,pointValues:categoryCount===2?[600]:categoryCount===4?[200,400]:[200,400,600],board});c.teams.forEach(t=>{t.categories=t.categories.slice(0,categoryCount/2);t.assists=[];});assert.deepEqual(E.validateConfig(c,bank),[]);let s=E.create(c,bank,{now,seed:19});const expected=categoryCount*c.pointValues.length*(board==='classic'?2:1);assert.equal(s.board.length,expected);assert.equal(new Set(s.board.map(t=>t.questionId)).size,expected);assert(E.validateState(s,bank));
  let n=0;while(s.state!=='MATCH_COMPLETE'){s=settle(open(s),n%2);n++;assert(E.validateState(copy(s),bank));}assert.equal(n,expected);const scores=s.teams.map(t=>t.score);s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.history.length,expected-1);assert(E.validateState(copy(s),bank));s=settle(s,(n-1)%2);assert.equal(s.state,'MATCH_COMPLETE');assert.deepEqual(s.teams.map(t=>t.score),scores);
 }
});
run('custom limits reject malformed point and category selection before any match is built',()=>{
 for(const patch of [{categoryCount:3},{categoryCount:0},{categoryCount:8},{pointValues:[]},{pointValues:[300]},{pointValues:[200,200]},{pointValues:['200']},{pointValues:null}]){const c=config({variant:'custom',...patch});assert(E.validateConfig(c,bank).length);assert.throws(()=>E.create(c,bank,{now,seed:1}));}
 for(const patch of [{categoryCount:2},{pointValues:[600]}])assert(E.validateConfig(config(patch),bank).length);
 const c=config({variant:'custom',categoryCount:2,pointValues:[600]});c.teams.forEach(t=>t.categories=t.categories.slice(0,1));const s=E.create(c,bank,{now,seed:1});c.pointValues.push(200);assert.deepEqual(s.config.pointValues,[600]);assert.equal(s.board.length,2);rejectMutation(s,t=>{t.config.pointValues=[200];});
});
run('historical V2 fixture retains prior double ownership and opposite-team award semantics',()=>{
 const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/match-v2-historical.json'),'utf8'));const before=JSON.stringify(historical);let s=E.validateState(historical,bank);assert(s);assert.equal(s.migration.fromVersion,2);assert.deepEqual(s.teams.map(t=>t.score),[600,0]);assert.equal(s.history[1].phase,'first');assert.equal(JSON.stringify(historical),before);s=act(s,'RESUME');s=settle(open(s),0);assert.equal(s.history.at(-1).scoringVersion,2);assert(E.validateState(copy(s),bank));
});
run('ordering restore rejects permutations that contradict the canonical answer',()=>{
 const c=config(),base=bank.find(q=>q.type==='ordering');assert(base);const synthetic=[];for(const category of c.teams.flatMap(t=>t.categories))for(const points of E.VALUES)synthetic.push({...base,verification:{...bank.find(q=>E.isEligible(q,c)).verification},id:`order-${category}-${points}`,category,points,level:points/200,spoiler:false,franchiseId:'naruto',spoilerLevel:1});const s=E.create(c,synthetic,{now,seed:19});assert(E.validateState(s,synthetic));const bad=copy(s),q=bad.questions[bad.board[0].questionId];[q.correctOrder[0],q.correctOrder[1]]=[q.correctOrder[1],q.correctOrder[0]];assert.equal(E.validateState(bad,synthetic),null);assert.equal(E.isEligible(q,c),false);
});
run('restored serial cannot fall below minted score helper clock resolution and undo identities',()=>{
 let s=settle(open(create()));rejectMutation(s,t=>{t.serial=0;});rejectMutation(s,t=>{t.serial=t.undo.at(-1).serial-1;});
 const c=config();c.teams.forEach(t=>t.assists=['hint']);let helper=E.create(c,bank,{now,seed:21});helper=open(helper);helper=act(helper,'ASSIST',{key:'hint',confirmed:true});rejectMutation(helper,t=>{t.serial=0;});helper=settle(helper);helper=act(helper,'UNDO');rejectMutation(helper,t=>{t.serial=0;});
 let restored=E.validateState(copy(s),bank);assert(restored);restored=act(restored,'RESUME');restored=settle(open(restored),1);assert.equal(new Set(restored.transactions.map(tx=>tx.id)).size,restored.transactions.length);assert(E.validateState(copy(restored),bank));
});
run('extreme imported serial fails safely before any state or score mutation',()=>{
 const raw=copy(settle(open(create())));raw.serial=1000000000;const s=E.validateState(raw,bank);assert(s);const before=copy(s),result=act(s,'RESUME');assert(result.lastError);delete before.lastError;const after=copy(result);delete after.lastError;assert.deepEqual(after,before);assert(E.validateState(result,bank));
});
run('older main penalty ledgers keep their policy while newly resolved questions use explicit failures',()=>{
 const c=config({negative:true,steal:false});c.teams.forEach(t=>t.assists=['trap']);let s=E.create(c,bank,{now,seed:17});s=open(s);s=act(s,'ASSIST',{key:'trap',confirmed:true});s=act(s,'DECLARE_INCORRECT');s=settle(s,null);assert.equal(s.teams[1].score,-200);
 // Main V4 inferred a failed trap from the final winner even without an
 // explicit attempt. Preserve a historical snapshot written with that policy.
 const historical=copy(s);historical.statisticsVersion=2;delete historical.history[0].attemptAccounting;historical.history[0].attempts=[];historical.history[0].incorrectTeams=[];historical.teams[1].incorrect=0;historical.undo=[];
 s=E.validateState(historical,bank);assert(s);assert.equal(s.teams[1].score,-200);s=act(s,'RESUME');s=settle(open(s),null);assert.equal(s.history.at(-1).attemptAccounting,3);assert(E.validateState(copy(s),bank));
});
run('ending a question with consumed or deferred helpers preserves restorable inventory and Undo',()=>{
 for(const deferred of [false,true]){
  const c=config();c.teams.forEach(t=>t.assists=['hint']);let s=E.create(c,bank,{now,seed:22});s=open(s);const questionId=s.current.questionId;s=act(s,'ASSIST',{key:'hint',confirmed:true});
  if(deferred){s=settle(s);s=act(s,'UNDO');assert.equal(s.current.pendingAssists.length,1);}
  const inventory=s.teams.map(t=>t.assists.hint);s=act(s,'END_MATCH',{confirmed:true,reason:'انتهاء الجلسة'});assert.equal(s.history.length,0);assert.equal(s.board.filter(t=>t.done).length,0);assert.deepEqual(s.teams.map(t=>t.assists.hint),inventory);assert(E.validateState(copy(s),bank));
  if(!deferred){assert.equal(s.abandonedAssists.length,1);const old=copy(s);delete old.abandonedAssists;assert(E.validateState(old,bank));rejectMutation(s,t=>{t.abandonedAssists=[];});}
  s=act(s,'UNDO');assert.equal(s.current.questionId,questionId);assert.deepEqual(s.teams.map(t=>t.assists.hint),inventory);assert(E.validateState(copy(s),bank));
 }
});
run('every judgment remains bound to the serial ledger even without score transactions',()=>{
 let s=settle(open(create()),null);assert.equal(s.transactions.length,0);rejectMutation(s,t=>{t.history[0].resolutionId=t.id+'-judgment-'+(t.serial+1);t.lastResolution.id=t.history[0].resolutionId;});
 s=act(s,'UNDO');rejectMutation(s,t=>{t.current.resolutionId=t.id+'-judgment-'+(t.serial+1);});
});
run('clamped penalty deltas still match their question scoring plan exactly',()=>{
 const c=config({negative:false,steal:false});c.teams.forEach(t=>t.assists=['trap']);let s=E.create(c,bank,{now,seed:17});s=open(s);s=act(s,'ASSIST',{key:'trap',confirmed:true});s=act(s,'DECLARE_INCORRECT');s=settle(s,null);assert.equal(s.transactions[0].scoreAfter,0);assert.equal(s.transactions[0].delta,-200);rejectMutation(s,t=>{t.transactions[0].delta=-400;});
});
console.log(JSON.stringify({passed,failed,questions:bank.length}));if(failed)process.exitCode=1;
