/* Pure deterministic engine tests. Run: node tests/team-engine.spec.cjs.
   No browser/server/build/package dependency is needed. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../team-engine.js');
const bank = fs.readdirSync(path.join(__dirname, '../content')).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(fs.readFileSync(path.join(__dirname, '../content', f), 'utf8')));
let count = 0, failures = 0;
let clock = Date.now();
function run(name, fn) { try { fn(); count++; console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e); } }
function config(extra = {}) { const c = E.defaults(); c.board = 'compact'; c.timer = false; Object.assign(c, extra); return c; }
function create(c = config(), seed = 8) { return E.create(c, bank, { seed, now: clock }); }
function act(s, type, fields = {}, at = clock += 50) { const identity = type === 'ADJUDICATE' && s.current ? {tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token} : {}; return E.dispatch(s, { type, ...identity, ...fields }, bank, at); }
function question(s, value = 200) { s = act(s, 'SELECT_TILE', { tileId: s.board.find(t => !t.done && t.value === value).id }); return act(s, 'START_QUESTION'); }
function oralWin(s, team = s.current.responder) { s = act(s, 'REVEAL'); return act(s, 'ADJUDICATE', { teamId: team }); }
function helpers(keys, extra = {}) { const c = config(extra); c.assistSlots = 5; c.teams.forEach(t => t.assists = [...keys]); return c; }
function use(s, key, extra = {}) { return act(s, 'ASSIST', { key, confirmed: true, ...extra }); }
run('default rules: classic36, values200400600, exactlythreecategorieseach', () => {
 const c=E.defaults();assert.equal(c.board,'classic');assert.equal(c.answerStyle,'oral');assert.equal(c.duration,60);assert.equal(c.stealDuration,10);assert.equal(c.assistSlots,3);
 const s=create(c);assert.equal(s.board.length,36);assert.equal(new Set(s.board.map(t=>t.questionId)).size,36);assert.deepEqual([...new Set(s.board.map(t=>t.value))],[200,400,600]);
 s.categories.forEach(cat=>assert.deepEqual(s.board.filter(t=>t.category===cat).map(t=>t.value),[200,200,400,400,600,600]));assert.equal(s.board.reduce((a,t)=>a+t.value,0),14400);
});
run('classic36 has six independentquestions percategory, eachvaluetwice',()=>{
 const s=create(config({board:'classic'}));assert.equal(s.board.length,36);assert.equal(new Set(s.board.map(t=>t.questionId)).size,36);s.categories.forEach(cat=>assert.deepEqual(s.board.filter(t=>t.category===cat).map(t=>t.value),[200,200,400,400,600,600]));
});
run('strict configuration rejects repeatedteamcategories, disabledpool and unfitrules',()=>{
 let c=config();c.teams[1].categories[0]=c.teams[0].categories[0];assert(E.validateConfig(c,bank).length);assert.throws(()=>create(c));
 c=config();assert(E.validateConfig(c,bank.map(q=>({...q,disabled:true}))).length);c.duration=0;assert(E.validateConfig(c,bank).length);c=config();c.teams[0].assists.push('double');assert(E.validateConfig(c,bank).length);
});
run('custom teamnames/colors/participants persist; allcategories selectable bybothteams',()=>{
 const c=config();c.teams[0].name='الأسود';c.teams[1].name='الصقور';c.teams[0].players=['خالد'];c.teams[1].players=['سعد'];const s=create(c);assert.equal(s.teams[0].name,'الأسود');assert.equal(s.teams[1].name,'الصقور');
 const t=s.board.find(t=>c.teams[1].categories.includes(t.category));const selected=act(s,'SELECT_TILE',{tileId:t.id});assert.equal(selected.state,'QUESTION_PREVIEW');assert.equal(selected.current.selector,0);
});
run('questionpreview hides answer andclock, thenquestionstarts',()=>{
 let s=create(config({timer:true}));const raw=JSON.stringify(s);s=act(s,'SELECT_TILE',{tileId:s.board[0].id});assert.equal(s.current.timerStarted,false);assert.equal(s.current.revealed,false);assert.equal(s.current.deadline,null);assert(!('answer' in s.current));s=act(s,'START_QUESTION');assert.equal(s.state,'QUESTION_ACTIVE');assert.equal(s.current.deadline,clock+60000);assert.equal(s.current.revealed,false);assert.equal(JSON.parse(raw).current,null);
});
run('normal award touches onlycorrectteam, isidempotent andadvancesscheduledturnonce',()=>{
 let s=question(create());s=oralWin(s,0);assert.equal(s.teams[0].score,200);assert.equal(s.teams[1].score,0);assert.equal(s.state,'TURN_COMPLETE');assert.equal(s.turn,1);assert(s.board[0].done);assert.equal(s.teams[0].correct,1);assert.equal(s.transactions.length,1);
 const repeated=act(s,'ADJUDICATE',{teamId:0});assert.equal(repeated.teams[0].score,200);assert.equal(repeated.transactions.length,1);s=act(s,'NEXT_TURN');assert.equal(s.state,'BOARD');assert.equal(s.turn,1);const invalid=act(s,'SELECT_TILE',{tileId:s.board[0].id});assert.equal(invalid.current,null);assert(invalid.lastError);
});
run('stealing preserveshiddenanswer and awardsopponent withoutdoubleturn',()=>{
 let s=question(create());s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'STEAL_OPPORTUNITY');assert.equal(s.current.responder,1);assert.equal(s.current.revealed,false);s=oralWin(s,1);assert.equal(s.teams[0].score,0);assert.equal(s.teams[1].score,200);assert.equal(s.teams[0].incorrect,1);assert.equal(s.teams[1].steals,1);assert.equal(s.turn,1);s=act(s,'NEXT_TURN');assert.equal(s.turn,1);
});
run('stealdisabled ends firstfailedattempt; nobodycorrect awardsnopoints',()=>{
 let s=question(create(config({steal:false})));s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.phase,'first');s=act(s,'ADJUDICATE',{teamId:null});assert.equal(s.transactions.length,0);assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.equal(s.teams[0].incorrect,1);
 s=question(create());s=act(s,'DECLARE_INCORRECT');s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'ANSWER_REVEAL');s=act(s,'ADJUDICATE',{teamId:null});assert.deepEqual(s.teams.map(t=>t.incorrect),[1,1]);assert.equal(s.transactions.length,0);
});
run('revealing answer permanentlyclosesattempts and preventslatesteal',()=>{
 let s=question(create());s=act(s,'REVEAL');assert.equal(s.current.revealed,true);const later=act(s,'STEAL');assert.equal(later.state,'ANSWER_REVEAL');assert.equal(later.current.phase,'first');assert(later.lastError);assert.equal(later.current.responder,0);
});
run('timers: expiredfirstopens10ssteal, staleclockcannotmodifynewphase',()=>{
 let s=question(create(config({timer:true})));const token=s.current.token,deadline=s.current.deadline;s=act(s,'TICK',{token},deadline);assert.equal(s.state,'STEAL_OPPORTUNITY');assert.equal(s.current.deadline,deadline+10000);assert.notEqual(s.current.token,token);
 const unchanged=act(s,'TICK',{token},deadline+999999);assert.equal(unchanged.state,'STEAL_OPPORTUNITY');assert.equal(unchanged.current.deadline,deadline+10000);s=act(s,'TICK',{token:s.current.token},deadline+10000);assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.pendingWinner,null);assert.equal(s.current.deadline,null);
});
run('disabledtimer neverexpires; hosttransition waitsmanualstealstart',()=>{
 let s=question(create());s=act(s,'TICK',{token:s.current.token},clock+9e6);assert.equal(s.state,'QUESTION_ACTIVE');assert.equal(s.current.deadline,null);
 s=question(create(config({timer:true,transition:'host'})));s=act(s,'DECLARE_INCORRECT');assert.equal(s.current.timerStarted,false);assert.equal(s.current.deadline,null);s=act(s,'START_STEAL');assert.equal(s.current.deadline,clock+10000);const deadline=s.current.deadline;s=act(s,'START_STEAL');assert.equal(s.current.deadline,deadline);
});
run('lateanswer/reveal cannotwintimer race',()=>{
 let s=question(create(config({timer:true})));const expired=s.current.deadline;s=act(s,'REVEAL',{},expired+1);assert.equal(s.state,'STEAL_OPPORTUNITY');assert.equal(s.current.revealed,false);assert(s.lastError);
});
run('presenter revealsquestionwithoutstartingclockuntilmanualSTART_TIMER',()=>{
 let s=question(create(config({mode:'presenter',timer:true})));const oldToken=s.current.token;assert.equal(s.current.deadline,null);assert.equal(s.current.timerStarted,false);s=act(s,'TICK',{token:oldToken},clock+9e6);assert.equal(s.state,'QUESTION_ACTIVE');s=act(s,'START_TIMER');assert.equal(s.current.timerStarted,true);assert.equal(s.current.deadline,clock+60000);assert.notEqual(s.current.token,oldToken);const deadline=s.current.deadline;s=act(s,'START_TIMER');assert.equal(s.current.deadline,deadline);s=act(s,'TICK',{token:oldToken},deadline+9e6);assert.equal(s.state,'QUESTION_ACTIVE');
});
run('presenter extra-timebeforemanualclock ispreserved',()=>{
 let s=question(create(helpers(['time'],{mode:'presenter',timer:true})));s=use(s,'time');s=act(s,'START_TIMER');assert.equal(s.current.deadline,clock+75000);
});
run('pause/resume preservesremainingtime and rotates token',()=>{
 let s=question(create(config({timer:true})));const deadline=s.current.deadline,token=s.current.token;s=act(s,'PAUSE',{},deadline-40000);assert.equal(s.state,'PAUSED');assert.equal(s.current.remainingMs,40000);assert.equal(s.current.deadline,null);s=act(s,'RESUME',{},deadline+100000);assert.equal(s.current.deadline,deadline+140000);assert.notEqual(s.current.token,token);
});
run('assistancefullydisabled is notusable andconsumesnothing',()=>{
 const c=config();c.assistSlots=0;c.teams.forEach(t=>t.assists=[]);E.ASSISTS.forEach(k=>c.assistEnabled[k]=false);let s=question(create(c));s=use(s,'call');assert(s.lastError);assert.deepEqual(s.teams[0].assists,{});assert.equal(s.teams[0].assistHistory.length,0);
});
run('pit mustbeconfirmedbeforequestion; correct addsownbaseanddeductsopponent',()=>{
 let s=create(helpers(['pit']));s=act(s,'ADJUST_SCORE',{teamId:0,delta:500,reason:'اختبار'});s=act(s,'ADJUST_SCORE',{teamId:1,delta:900,reason:'اختبار'});s=act(s,'SELECT_TILE',{tileId:s.board.find(t=>t.value===400).id});
 const unconfirmed=act(s,'ASSIST',{key:'pit'});assert.equal(unconfirmed.teams[0].assists.pit,1);s=use(s,'pit');assert.equal(s.teams[0].assists.pit,0);s=act(s,'START_QUESTION');s=oralWin(s);assert.deepEqual(s.teams.map(t=>t.score),[900,500]);assert.equal(s.transactions.filter(t=>t.questionId===s.current.questionId).length,2);
 const pit=act(s,'ASSIST',{key:'pit',confirmed:true});assert.equal(pit.transactions.length,s.transactions.length);
});
run('pit failednormallydeductsnothing; optionalfailurepenaltyandnegativepolicies',()=>{
 let s=create(helpers(['pit'],{steal:false}));s=act(s,'SELECT_TILE',{tileId:s.board[0].id});s=use(s,'pit');s=act(s,'START_QUESTION');s=act(s,'DECLARE_INCORRECT');s=act(s,'ADJUDICATE',{teamId:null});assert.deepEqual(s.teams.map(t=>t.score),[0,0]);
 s=create(helpers(['pit'],{steal:false,pitFailPenalty:true,negative:true}));s=act(s,'SELECT_TILE',{tileId:s.board[0].id});s=use(s,'pit');s=act(s,'START_QUESTION');s=act(s,'DECLARE_INCORRECT');s=act(s,'ADJUDICATE',{teamId:null});assert.equal(s.teams[0].score,-200);
 s=create(helpers(['pit']));s=act(s,'SELECT_TILE',{tileId:s.board[0].id});s=use(s,'pit');s=act(s,'START_QUESTION');s=oralWin(s);assert.equal(s.teams[1].score,0);assert.equal(s.transactions.at(-1).scoreBefore,0);assert.equal(s.transactions.at(-1).scoreAfter,0);
});
run('trap transfersonce, failswithdeduction, nofurthersteal; nextselectorunchanged',()=>{
 let s=question(create(helpers(['trap'],{negative:true})));s=use(s,'trap');assert.equal(s.current.phase,'trap');assert.equal(s.current.responder,1);assert.equal(s.current.selector,0);assert.equal(s.teams[0].assists.trap,0);
 const second=use(s,'trap');assert(second.lastError);assert.equal(second.current.responder,1);assert.equal(second.teams[1].assists.trap,1);s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'ANSWER_REVEAL');s=act(s,'ADJUDICATE',{teamId:null});assert.equal(s.teams[1].score,-200);assert.equal(s.turn,1);assert.equal(s.history[0].phase,'trap');
});
run('trap success configurable: respondentpoints ornone',()=>{
 for(const rule of ['responder','none']){let s=question(create(helpers(['trap'],{trapSuccess:rule})));s=use(s,'trap');s=oralWin(s,1);assert.equal(s.teams[1].score,rule==='responder'?200:0);assert.equal(s.teams[1].correct,1);assert.equal(s.teams[1].steals,0);}
});
run('answertwice oral permits2attempts, preservesclock, cannotbereused',()=>{
 let s=question(create(helpers(['twice'],{timer:true})));const deadline=s.current.deadline;s=use(s,'twice');s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'QUESTION_ACTIVE');assert.equal(s.current.deadline,deadline);assert.equal(s.current.attempts.length,1);s=use(s,'twice');assert(s.lastError);assert.equal(s.teams[0].assists.twice,0);s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'STEAL_OPPORTUNITY');
});
run('three/fouroptionquestions containoneanswer andcorrectauto-suggestswithoutscoring',()=>{
 for(const choiceCount of [3,4]){let s=question(create(config({answerStyle:'choice',choiceCount})));const q=bank.find(q=>q.id===s.current.questionId);assert.equal(s.current.choices.length,choiceCount);assert.equal(s.current.choices.filter(i=>i===q.answer).length,1);s=act(s,'ANSWER',{value:q.answer});assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.pendingWinner,0);assert.equal(s.teams[0].score,0);s=act(s,'ADJUDICATE',{teamId:0});assert.equal(s.teams[0].score,200);}
});
run('choiceanswertwice acceptstwoverifiedproposalsandrequiresadjudication',()=>{
 let s=question(create(helpers(['twice'],{answerStyle:'choice'})));const q=bank.find(q=>q.id===s.current.questionId);s=use(s,'twice');s=act(s,'ANSWER',{values:[s.current.choices.find(i=>i!==q.answer),q.answer]});assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.pendingWinner,0);assert.equal(s.teams[0].score,0);
});
run('typednormalization preservesdistinctletters andacceptsverifiedaliasesonly',()=>{
 assert.equal(E.normalizeAnswer(' إِبْرَاهِيمُ  '),'ابراهيم');assert.notEqual(E.normalizeAnswer('علي'),E.normalizeAnswer('على'));assert.notEqual(E.normalizeAnswer('هبة'),E.normalizeAnswer('هبه'));
 let s=question(create(config({answerStyle:'typed'})));const q=bank.find(q=>q.id===s.current.questionId);s=act(s,'ANSWER',{value:q.options[q.answer]});assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.pendingWinner,0);
 const modified=bank.map(q=>({...q,acceptedAnswers:['صياغة موثقة']}));s=E.create(config({answerStyle:'typed'}),modified,{now:clock,seed:9});s=E.dispatch(s,{type:'SELECT_TILE',tileId:s.board[0].id},modified,clock);s=E.dispatch(s,{type:'START_QUESTION'},modified,clock);s=E.dispatch(s,{type:'ANSWER',value:'صِيَاغَة مُوَثَّقَة'},modified,clock);assert.equal(s.current.pendingWinner,0);
});
run('callfriend pausesconfigurablemainclock andreturnswithoutfakecall',()=>{
 let s=question(create(helpers(['call'],{timer:true,callDuration:30,callPause:true})));const remaining=s.current.deadline-clock;s=use(s,'call');assert.equal(s.state,'ASSISTANCE_ACTIVE');assert.equal(s.current.deadline,null);assert(s.current.assistance.deadline>clock);assert.equal(s.teams[0].assists.call,0);const returnedAt=clock+5000;s=act(s,'RETURN_ASSISTANCE',{},returnedAt);assert.equal(s.state,'QUESTION_ACTIVE');assert(s.current.deadline-returnedAt<=remaining);assert.equal(s.current.assistance,null);
});
run('callwithoutpause respectsmainexpiration; completedassistancecannotreturnagain',()=>{
 let s=question(create(helpers(['call'],{timer:true,duration:15,callDuration:60,callPause:false})));s=use(s,'call');s=act(s,'TICK',{token:s.current.token},s.current.deadline);assert.equal(s.state,'STEAL_OPPORTUNITY');s=act(s,'RETURN_ASSISTANCE');assert(s.lastError);assert.equal(s.state,'STEAL_OPPORTUNITY');
});
run('sitout requiresrealnominatedopponent+hostconfirmation andlogsparticipant',()=>{
 const c=helpers(['sitout']);c.teams[0].players=['خالد'];c.teams[1].players=['سعد','فهد'];let s=question(create(c));s=use(s,'sitout',{participant:'غير مسجل'});assert.equal(s.teams[0].assists.sitout,1);s=use(s,'sitout',{participant:'سعد'});assert.equal(s.teams[0].assists.sitout,0);assert.equal(s.current.sitout.participant,'سعد');assert.equal(s.teams[0].assistHistory[0].participant,'سعد');
});
run('extra-time adds15seconds; hint/double/second/skip haveindependentrules',()=>{
 let s=question(create(helpers(['time','hint','double','second','skip'],{timer:true})));const deadline=s.current.deadline;s=use(s,'time');assert.equal(s.current.deadline,deadline+15000);s=use(s,'hint');assert(s.current.hint);s=use(s,'double');s=use(s,'second');s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'QUESTION_ACTIVE');s=oralWin(s);assert.equal(s.teams[0].score,400);
 s=act(s,'NEXT_TURN');s=question(s);s=use(s,'skip');assert.equal(s.state,'ANSWER_REVEAL');s=act(s,'ADJUDICATE',{teamId:1});assert.equal(s.teams[1].score,0);assert.equal(s.current.winner,null);
});
run('assistanceusage limitsallow0..5butneverreuseconsumeditem',()=>{
 const c=helpers(['hint']);c.assistLimits.hint=2;let s=question(create(c));s=use(s,'hint');s=use(s,'hint');assert(s.lastError);assert.equal(s.teams[0].assists.hint,1);s=oralWin(s);s=act(s,'NEXT_TURN');s=question(s);s=oralWin(s);s=act(s,'NEXT_TURN');s=question(s);s=use(s,'hint');assert.equal(s.teams[0].assists.hint,0);assert.equal(s.teams[0].assistHistory.length,2);
});
run('transactionscontainfullaudit andimmutableinputs',()=>{
 const before=create(),original=JSON.stringify(before);let s=question(before);s=oralWin(s);assert.equal(JSON.stringify(before),original);const tx=s.transactions[0];for(const k of ['id','questionId','teamId','originalValue','reason','modifier','scoreBefore','scoreAfter','timestamp','groupId'])assert(Object.hasOwn(tx,k));assert.equal(tx.originalValue,200);assert.equal(tx.reason,'correct');
});
run('undo reversescompletepitresolution,turnstatsandbothtransactions atomically',()=>{
 let s=create(helpers(['pit']));s=act(s,'ADJUST_SCORE',{teamId:1,delta:900,reason:'بداية'});s=act(s,'SELECT_TILE',{tileId:s.board[0].id});s=use(s,'pit');s=act(s,'START_QUESTION');s=oralWin(s);const lastId=s.transactions.at(-1).id;s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.deepEqual(s.teams.map(t=>t.score),[0,900]);assert.deepEqual(s.teams.map(t=>t.correct),[0,0]);assert.equal(s.turn,0);assert.equal(s.board[0].done,false);assert.equal(s.history.length,0);assert.equal(s.teams[0].assists.pit,0);s=act(s,'ADJUDICATE',{teamId:0});assert.notEqual(s.transactions.at(-1).id,lastId);
});
run('manualscorecorrection clamp/negative policies andundo',()=>{
 let s=create();s=act(s,'ADJUST_SCORE',{teamId:0,delta:-200,reason:'تصحيح'});assert.equal(s.teams[0].score,0);s=act(s,'ADJUST_SCORE',{teamId:1,delta:500,reason:'تصحيح'});assert.equal(s.teams[1].score,500);s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);
 s=create(config({negative:true}));s=act(s,'ADJUST_SCORE',{teamId:0,delta:-200,reason:'تصحيح'});assert.equal(s.teams[0].score,-200);
});
run('fullcompactmatch completes18uniquequestions,winnerandtiecorrect',()=>{
 for(const tie of [false,true]){let s=create();while(s.state!=='MATCH_COMPLETE'){s=question(s,s.board.find(t=>!t.done).value);s=oralWin(s,tie?s.current.selector:0);s=act(s,'NEXT_TURN');}assert.equal(s.history.length,18);assert.equal(new Set(s.history.map(h=>h.questionId)).size,18);assert(s.board.every(t=>t.done));assert.equal(s.winner,tie?null:0);assert.equal(s.teams.reduce((sum,t)=>sum+t.score,0),7200);}
});
run('fullclassicmatch completes36uniquequestions andstablealternatingturns',()=>{
 let s=create(config({board:'classic'}));let expected=0;while(s.state!=='MATCH_COMPLETE'){assert.equal(s.turn,expected);s=question(s,s.board.find(t=>!t.done).value);s=oralWin(s,expected);s=act(s,'NEXT_TURN');expected=1-expected;}assert.equal(s.history.length,36);assert.equal(s.board.reduce((a,t)=>a+t.value,0),14400);
});
run('repetitionprotectionprefersunseenwithinexactdifficultybucket',()=>{
 const first=create(config(),100),seen=first.board.map(t=>t.questionId),second=E.create(config(),bank,{seed:100,now:clock,seen});for(const tile of second.board){const pool=E.eligibleQuestions(bank,config(),{category:tile.category,value:tile.value});assert(!seen.includes(tile.questionId)||pool.every(q=>seen.includes(q.id)));}assert.deepEqual(second.board.map(t=>t.value),first.board.map(t=>t.value));
});
run('configuration snapshotlocked againstexternalobjectmutations',()=>{
 const c=config();const s=create(c);c.board='classic';c.teams[0].name='اسم آخر';c.assistLimits.pit=5;assert.equal(s.config.board,'compact');assert.equal(s.teams[0].name,'الفريق الأزرق');assert.equal(s.config.assistLimits.pit,1);assert.equal(s.board.length,18);
});
run('savedboard/questionrestorevalidated,paused,completedtilesremainclosed',()=>{
 let s=question(create());s=oralWin(s);s=act(s,'NEXT_TURN');s=question(s,400);const restored=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(restored);assert.equal(restored.state,'PAUSED');assert.equal(restored.pausedFrom,'QUESTION_ACTIVE');assert.equal(restored.current.deadline,null);assert(restored.board[0].done);assert.equal(restored.teams[0].score,200);assert.equal(restored.history.length,1);const resumed=act(restored,'RESUME');assert.equal(resumed.current.questionId,s.current.questionId);assert.equal(resumed.state,'QUESTION_ACTIVE');
});
run('corruptedrestore rejectsduplicatetiles,scores,config,assistsandunsafesnapshots',()=>{
 let s=question(create());s=oralWin(s);assert(E.validateState(s,bank));for(const mutate of [t=>t.board[1].questionId=t.board[0].questionId,t=>t.teams[0].score=999,t=>t.config.board='classic',t=>t.teams[0].assists.pit=99,t=>t.current.choices=[0,0,0,0],t=>t.turn=0,t=>t.current.responder=1,t=>t.undo[0].teams[0].score=999]){const bad=JSON.parse(JSON.stringify(s));mutate(bad);assert.equal(E.validateState(bad,bank),null);}
});
run('skip thenUNDO cannotmakealreadyrevealedquestion stealableagain',()=>{
 let s=question(create(helpers(['skip'])));const id=s.current.questionId;s=use(s,'skip');assert.equal(s.current.revealed,true);assert(s.knownAnswers.includes(id));s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.revealed,true);assert.equal(s.current.closed,true);assert.equal(s.current.pendingWinner,null);assert.equal(s.teams[0].assists.skip,1);const stolen=act(s,'STEAL');assert.equal(stolen.state,'ANSWER_REVEAL');assert(stolen.lastError);assert.equal(stolen.current.responder,0);
});
run('multi-levelUNDO afterhelper/reveal/scoring retainsdurableanswerknowledge',()=>{
 let s=question(create(helpers(['twice'])));const id=s.current.questionId;s=use(s,'twice');s=oralWin(s);s=act(s,'NEXT_TURN');s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.questionId,id);assert.equal(s.current.revealed,true);assert.equal(s.current.pendingWinner,null);assert(s.knownAnswers.includes(id));assert.equal(s.teams[0].assists.twice,1);assert.equal(s.history.length,0);assert.deepEqual(s.teams.map(t=>t.score),[0,0]);s=act(s,'DECLARE_INCORRECT');assert.equal(s.state,'ANSWER_REVEAL');assert(s.lastError);
});
run('deepUNDOtoboard reopeningknownquestion opensonlyadjudication',()=>{
 let s=create(helpers(['hint']));s=act(s,'ADJUST_SCORE',{teamId:0,delta:200,reason:'تصحيح'});s=question(s);const tileId=s.current.tileId,id=s.current.questionId;s=use(s,'hint');s=act(s,'REVEAL');s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');s=act(s,'UNDO');assert.equal(s.state,'BOARD');assert.equal(s.current,null);assert(s.knownAnswers.includes(id));s=act(s,'SELECT_TILE',{tileId});assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.revealed,true);assert.equal(s.current.deadline,null);assert.equal(s.current.pendingWinner,null);assert.equal(s.current.closed,true);s=act(s,'START_QUESTION');assert.equal(s.state,'ANSWER_REVEAL');assert(s.lastError);
});
run('revealknowledge survivesrefreshandlegacyledger migration',()=>{
 let s=question(create(helpers(['skip'])));s=use(s,'skip');s=act(s,'UNDO');const id=s.current.questionId;let loaded=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(loaded);assert(loaded.knownAnswers.includes(id));loaded=act(loaded,'RESUME');assert.equal(loaded.state,'ANSWER_REVEAL');loaded=act(loaded,'STEAL');assert.equal(loaded.state,'ANSWER_REVEAL');assert(loaded.lastError);const legacy=JSON.parse(JSON.stringify(s));delete legacy.knownAnswers;loaded=E.validateState(legacy,bank);assert(loaded);assert(loaded.knownAnswers.includes(id));
});
run('storedknownanswer cannotbehiddenagainandoldcallbacks cannotreopenattempt',()=>{
 let s=question(create(config({timer:true})));const token=s.current.token;s=act(s,'REVEAL');const bad=JSON.parse(JSON.stringify(s));bad.state='QUESTION_ACTIVE';bad.current.revealed=false;bad.current.closed=false;bad.current.deadline=clock+60000;const loaded=E.validateState(bad,bank);assert(loaded);assert.equal(loaded.state,'ANSWER_REVEAL');assert.equal(loaded.current.revealed,true);assert.equal(loaded.current.pendingWinner,null);const ticked=act(loaded,'TICK',{token},clock+900000);assert.equal(ticked.state,'ANSWER_REVEAL');assert.equal(ticked.current.responder,0);
});
run('V3 manualsteal extra-time survives start pause reload resume withoutduplication',()=>{
 let s=question(create(helpers(['time'],{timer:true,transition:'host'})));s=act(s,'DECLARE_INCORRECT');s=use(s,'time');assert.equal(s.current.remainingMs,25000);assert.equal(s.current.deadline,null);s=act(s,'START_STEAL');assert.equal(s.current.deadline,clock+25000);const deadline=s.current.deadline;s=act(s,'START_STEAL');assert.equal(s.current.deadline,deadline);s=use(s,'time');assert.equal(s.teams[1].assists.time,0);assert.equal(s.current.deadline,deadline);s=act(s,'PAUSE',{},deadline-17000);assert.equal(s.current.remainingMs,17000);s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);const resumedAt=clock+300000;s=act(s,'RESUME',{},resumedAt);assert.equal(s.current.deadline,resumedAt+17000);assert.equal(s.teams[1].assists.time,0);
});
run('V3 trapdelegation neverrecordsincorrect fordelegator onsuccess orfailure',()=>{
 for(const correct of [true,false]) {let s=question(create(helpers(['trap'],{negative:true})));s=use(s,'trap');if(correct)s=oralWin(s,1);else{s=act(s,'DECLARE_INCORRECT');s=act(s,'ADJUDICATE',{teamId:null});}assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[1].incorrect,correct?0:1);assert.equal(s.teams[1].correct,correct?1:0);assert.equal(s.teams[1].score,correct?200:-200);assert.deepEqual(s.history[0].incorrectTeams,correct?[]:[1]);}
});
run('V3 doubleentitlement survives bothteams activating andhostcorrectingwinner',()=>{
 let s=question(create(helpers(['double'])));s=use(s,'double');s=act(s,'DECLARE_INCORRECT');s=use(s,'double');s=act(s,'REVEAL');assert.equal(s.current.pendingWinner,1);s=act(s,'ADJUDICATE',{teamId:0});assert.deepEqual(s.teams.map(t=>t.score),[400,0]);assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);assert.equal(s.transactions[0].modifier,'double');const awarded=s;s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.equal(s.current.usedAssists.filter(a=>a.key==='double').length,2);s=act(s,'ADJUDICATE',{teamId:1});assert.deepEqual(s.teams.map(t=>t.score),[0,400]);assert.equal(s.teams[0].incorrect,1);s=act(s,'ADJUDICATE',{teamId:1});assert.equal(s.teams[1].score,400);assert.equal(s.transactions.length,1);assert.equal(awarded.teams[0].score,400);
});
run('V3 revealwithoutattempt skip timeout andpass donotfabricateincorrectanswers',()=>{
 for(const action of ['REVEAL','PASS','timeout','skip']){let s=question(create(helpers(['skip'],{timer:true,steal:false})));if(action==='timeout')s=act(s,'TICK',{token:s.current.token},s.current.deadline);else if(action==='skip')s=use(s,'skip');else s=act(s,action);s=act(s,'ADJUDICATE',{teamId:null});assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0],action);assert.deepEqual(s.history[0].incorrectTeams,[]);}
 let s=question(create());s=act(s,'PASS');assert.equal(s.current.phase,'steal');s=oralWin(s,1);assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[1].steals,1);
});
run('V3 finalhostdecision overrides automaticcorrectness withoutinventingattempts',()=>{
 let s=question(create(config({answerStyle:'choice',steal:false})));const q=E.getQuestion(s,s.current.questionId,bank);s=act(s,'ANSWER',{value:q.answer});s=act(s,'ADJUDICATE',{teamId:null});assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[0].correct,0);s=act(s,'UNDO');assert.equal(s.teams[0].incorrect,0);s=act(s,'ADJUDICATE',{teamId:0});assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[0].correct,1);const restored=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(restored);assert.equal(restored.teams[0].correct,1);
});
run('V3 questionsnapshots survive library edits removal sourceandmedia changes',()=>{
 let s=create();const id=s.board[0].questionId,original=E.getQuestion(s,id,bank),changed=bank.filter(q=>q.id!==id);assert(Object.isFrozen(s.questions));assert(Object.isFrozen(original));assert(Object.isFrozen(original.options));assert(!s.undo.some(h=>Object.hasOwn(h,'questions')));s=E.dispatch(s,{type:'SELECT_TILE',tileId:s.board[0].id},changed,clock);s=E.dispatch(s,{type:'START_QUESTION'},changed,clock);assert.equal(E.getQuestion(s,id,changed).q,original.q);const restored=E.validateState(JSON.parse(JSON.stringify(s)),[]);assert(restored);assert.equal(E.getQuestion(restored,id,[]).q,original.q);s=act(s,'REVEAL');s=act(s,'ADJUDICATE',{teamId:0});assert(s.undo.length);assert(s.undo.every(h=>!Object.hasOwn(h,'questions')));const undone=act(s,'UNDO');assert.equal(undone.questions,s.questions);assert.equal(E.getQuestion(undone,id,[]).options[original.answer],original.options[original.answer]);
});
run('V3 snapshot input isdetached fromownerbank includingnestedmetadata',()=>{
 const edited=JSON.parse(JSON.stringify(bank));let s=E.create(config(),edited,{now:clock,seed:8}),id=s.board[0].questionId;const before=JSON.stringify(E.getQuestion(s,id,edited));const q=edited.find(q=>q.id===id);q.q='تعديل';q.options[0]='جواب مختلف';q.source.reference='مرجع مختلف';q.image='asset-changed';assert.equal(JSON.stringify(E.getQuestion(s,id,edited)),before);
});
run('V3 legacyversion2 migratesprogress scoresassists andundowithoutduplicatedsnapshots',()=>{
 let s=question(create(helpers(['double'])));s=use(s,'double');s=oralWin(s);s=act(s,'NEXT_TURN');const old=JSON.parse(JSON.stringify(s));delete old.questions;old.version=2;delete old.config.anime;delete old.config.repetition;old.undo.forEach(h=>{h.version=2;delete h.config.anime;delete h.config.repetition;delete h.questions;});const before=JSON.stringify(old);const restored=E.validateState(old,bank);assert(restored);assert.equal(restored.version,3);assert.equal(restored.teams[0].score,400);assert.equal(restored.history.length,1);assert.equal(restored.teams[0].assists.double,0);assert.equal(restored.undo.length,old.undo.length);assert(restored.undo.every(h=>!h.questions));assert.equal(JSON.stringify(old),before);assert.equal(restored.migration.fromVersion,2);assert.equal(E.restore(old,bank).error,null);
});
run('V3 failedmigration preservesbackupanddoesnotresetunrelateduserdata',()=>{
 let s=create();const old=JSON.parse(JSON.stringify(s));old.version=2;delete old.questions;const missing=old.board[0].questionId,result=E.restore(old,bank.filter(q=>q.id!==missing));assert.equal(result.state,null);assert(result.error.includes('لم تُحذف'));assert.equal(result.backup,old);assert.equal(old.version,2);const bad=JSON.parse(JSON.stringify(s));bad.questions[missing].options=['مكرر','مكرر','ثالث','رابع'];assert.equal(E.validateState(bad,bank),null);const polluted=JSON.parse(JSON.stringify(s));polluted.questions[missing].source=JSON.parse('{"__proto__":{"polluted":true}}');assert.equal(E.validateState(polluted,bank),null);assert.equal({}.polluted,undefined);
});
run('V3 threespoilerlevels independent franchise filters alwaysstrict',()=>{
 const template={...bank.find(q=>q.category==='anime'&&E.verifiedForPlay(q)),id:'anime-v3-test',sub:'Naruto',franchiseId:'naruto',spoiler:false};const c=config();c.anime.selected=['naruto'];c.anime.levels.naruto=1;assert(E.isEligible({...template,spoilerLevel:1},c));assert(!E.isEligible({...template,spoilerLevel:2},c));c.spoilerProtection=false;assert(!E.isEligible({...template,spoilerLevel:2},c));c.anime.levels.naruto=2;assert(E.isEligible({...template,spoilerLevel:2},c));assert(!E.isEligible({...template,spoilerLevel:3},c));c.anime.levels.naruto=3;assert(E.isEligible({...template,spoilerLevel:3},c));assert(!E.isEligible({...template,franchiseId:'bleach',spoilerLevel:1},c));c.anime.selected.push('bleach');assert(E.isEligible({...template,franchiseId:'bleach',spoilerLevel:1},c));assert(!E.isEligible({...template,franchiseId:'bleach',spoilerLevel:2},c));assert.equal(E.FRANCHISES.length,12);
});
run('V3 sharedeligibility drives preview validation andgeneration withoutspoilerfallback',()=>{
 const c=config();c.anime.selected=[];assert.equal(E.eligibleQuestions(bank,c,{category:'anime'}).length,0);assert(E.validateConfig(c,bank).length);assert.throws(()=>E.create(c,bank));const c2=config();const enabled=E.eligibleQuestions(bank,c2,{category:'anime',value:600});assert(enabled.every(q=>!q.spoiler));assert.equal(E.eligibleQuestions(bank.map(q=>({...q,unavailable:true})),c2).length,0);assert.equal(E.eligibleQuestions(bank.map(q=>({...q,disabled:true})),c2).length,0);
});
run('V3 recentselectionavoids30daysandlastthreematcheswithdeterministicoldestfallback',()=>{
 const c=config(),first=create(c,50),ids=first.board.map(t=>t.questionId),seen=Object.fromEntries(ids.map(id=>[id,clock-1000]));const next=E.create(c,bank,{now:clock,seed:50,seen});for(const tile of next.board){const pool=E.eligibleQuestions(bank,c,{category:tile.category,value:tile.value});assert(!ids.includes(tile.questionId)||pool.every(q=>ids.includes(q.id)));}const recent=E.create(c,bank,{now:clock,seed:50,recentMatches:[{at:clock-40*86400000,questionIds:ids}]});for(const tile of recent.board){const pool=E.eligibleQuestions(bank,c,{category:tile.category,value:tile.value});assert(!ids.includes(tile.questionId)||pool.every(q=>ids.includes(q.id)));}const stale=Object.fromEntries(bank.map((q,i)=>[q.id,clock-1000-i*10]));const fallback=E.create(c,bank,{now:clock,seed:50,seen:stale});assert(fallback.selectionWarnings.length);assert.deepEqual(fallback.board,E.create(c,bank,{now:clock,seed:50,seen:stale}).board);for(const tile of fallback.board){const candidates=E.eligibleQuestions(bank,c,{category:tile.category,value:tile.value});assert.equal(tile.questionId,candidates.sort((a,b)=>stale[a.id]-stale[b.id])[0].id);}c.repetition='all';const all=E.create(c,bank,{now:clock,seed:50,seen:stale});assert.deepEqual(all.board,E.create(c,bank,{now:clock,seed:50}).board);
});
run('V3 measuredtime excludes pausesandundodoesnotrollbackorstopduration',()=>{
 const at=clock+1000;let s=E.create(config(),bank,{now:at,seed:8});s=E.dispatch(s,{type:'ADJUST_SCORE',teamId:0,delta:100,reason:'تصحيح'},bank,at+5000);assert.equal(s.timing.elapsedMs,5000);s=E.dispatch(s,{type:'UNDO'},bank,at+10000);assert.equal(s.state,'BOARD');assert.equal(s.timing.elapsedMs,10000);s=E.dispatch(s,{type:'PAUSE'},bank,at+15000);assert.equal(s.timing.elapsedMs,15000);s=E.dispatch(s,{type:'RESUME'},bank,at+115000);assert.equal(s.timing.elapsedMs,15000);s=E.dispatch(s,{type:'SELECT_TILE',tileId:s.board[0].id},bank,at+120000);assert.equal(s.timing.elapsedMs,20000);s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);assert.equal(s.timing.elapsedMs,20000);assert.equal(s.timing.lastActiveAt,null);
});
run('V3 invalidfranchisepreferencesrejectwithoutthrowingandlegacytimerbonusmigrates',()=>{
 for(const anime of [{},{selected:null,levels:{}},{selected:['naruto'],levels:null}]){const c=config({anime});assert.doesNotThrow(()=>E.validateConfig(c,bank));assert(E.validateConfig(c,bank).length);assert.throws(()=>E.create(c,bank));}
 let s=question(create(helpers(['time'],{timer:true,transition:'host'})));s=act(s,'DECLARE_INCORRECT');s=use(s,'time');const old=JSON.parse(JSON.stringify(s));old.version=2;delete old.questions;old.undo.forEach(h=>h.version=2);s=E.validateState(old,bank);assert(s);s=act(s,'RESUME');assert.equal(s.current.remainingMs,25000);s=act(s,'START_STEAL');assert.equal(s.current.deadline,clock+25000);
});
run('V3 dangerousquestionidentifiersandsnapshotssourcesrejected',()=>{
 assert.equal(E.getQuestion({questions:{}},'constructor',[]),null);for(const id of ['__proto__','constructor','id" onclick="x','<bad>'])assert(!E.isEligible({...bank[0],id},config()));let s=create();for(const mutate of [q=>delete q.source,q=>q.source.url='javascript:alert(1)',q=>q.id='"onclick"',q=>q.category='<img>']){const bad=JSON.parse(JSON.stringify(s));mutate(bad.questions[s.board[0].questionId]);assert.equal(E.validateState(bad,bank),null);}const multiline=JSON.parse(JSON.stringify(s));multiline.questions[s.board[0].questionId].q+='\nتفصيل السؤال';assert(E.validateState(multiline,bank));
});
run('V3 legacymigrationpreservesassignedpointsevenwhenlibrarypointswerelateredited',()=>{
 let s=create();const old=JSON.parse(JSON.stringify(s));old.version=2;delete old.questions;const id=s.board[0].questionId,edited=bank.map(q=>q.id===id?{...q,points:600}:q);const restored=E.validateState(old,edited);assert(restored);assert.equal(restored.board[0].value,200);assert.equal(E.getQuestion(restored,id,edited).points,200);
});
run('V3 selectorprefersvariedanswersandsubtopicswithineligiblepriority',()=>{
 const c=config(),template=bank.find(q=>q.category==='football'&&E.verifiedForPlay(q)),synthetic=[];for(const category of c.teams.flatMap(t=>t.categories))for(const points of [200,400,600])for(let i=0;i<4;i++)synthetic.push({...template,id:`variety-${category}-${points}-${i}`,category,sub:`موضوع ${i}`,q:`سؤال ${category} ${points} ${i}`,points,level:points/200,franchiseId:'naruto',spoilerLevel:1,spoiler:false,image:undefined,correctAnswer:`${category} إجابة ${i}`,acceptedAnswers:[],options:[`${category} إجابة ${i}`,'خيار أول','خيار ثان','خيار ثالث'],answer:0});
 const s=E.create(c,synthetic,{now:clock,seed:120});for(const category of s.categories){const qs=s.board.filter(t=>t.category===category).map(t=>E.getQuestion(s,t.questionId,synthetic));assert.equal(new Set(qs.map(q=>q.sub)).size,3);assert.equal(new Set(qs.map(q=>q.options[q.answer])).size,3);}assert.deepEqual(s.board,E.create(c,synthetic,{now:clock,seed:120}).board);
});
run('V3 snapshotansweraliasesandexplicitpointsrejectcontradictionswithoutrepair',()=>{
 const saved=create(),id=saved.board[0].questionId;
 const mutations=[q=>q.correctAnswer=q.options[(q.answer+1)%4],q=>delete q.correctAnswer,q=>q.acceptedAnswers=[q.options[(q.answer+1)%4]],q=>q.acceptedAnswers=[25],q=>q.acceptedAnswers={},q=>delete q.acceptedAnswers,q=>q.points=300,q=>q.points='200',q=>delete q.points,q=>q.answer=(q.answer+1)%4,q=>q.image='javascript:alert(1)'];
 for(const mutate of mutations){const bad=JSON.parse(JSON.stringify(saved));mutate(bad.questions[id]);const before=JSON.stringify(bad),result=E.restore(bad,bank);assert.equal(result.state,null);assert.equal(result.backup,bad);assert(result.error.includes('لم تُحذف'));assert.equal(JSON.stringify(bad),before);}
 const aliases=JSON.parse(JSON.stringify(saved));aliases.questions[id].acceptedAnswers=[aliases.questions[id].options[aliases.questions[id].answer]];assert(E.validateState(aliases,bank));
});
run('V3 missinglegacylibraryanswerfieldsnormalizedbutinvalidexplicitvaluesrejected',()=>{
 const legacyBank=bank.map(q=>{const copy={...q};delete copy.correctAnswer;delete copy.acceptedAnswers;delete copy.points;return copy;}),saved=E.create(config(),legacyBank,{now:clock,seed:88});
 for(const q of Object.values(saved.questions)){assert.equal(q.correctAnswer,q.options[q.answer]);assert.deepEqual(q.acceptedAnswers,[]);assert([200,400,600].includes(q.points));}assert(E.validateState(saved,legacyBank));
 const old=JSON.parse(JSON.stringify(saved));old.version=2;delete old.questions;const restored=E.validateState(old,legacyBank);assert(restored);assert.equal(restored.version,3);assert(Object.values(restored.questions).every(q=>q.correctAnswer===q.options[q.answer]));
 const q=bank.find(q=>q.category==='football');assert(!E.isEligible({...q,points:300},config()));assert(!E.isEligible({...q,correctAnswer:q.options[(q.answer+1)%4]},config()));assert(!E.isEligible({...q,acceptedAnswers:[q.options[(q.answer+1)%4]]},config()));
});

function resolved(s, teamId = null) {
 if(!s.current.revealed)s=act(s,'REVEAL');
 return act(s,'RESOLVE_QUESTION',{teamId,tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token});
}
run('one-tap resolution awards200400600 andreturnsboard atomicallywithoutmutatinginput',()=>{
 for(const value of [200,400,600]){
  let s=question(create(),value);s=act(s,'REVEAL');const original=JSON.stringify(s),id=s.current.questionId,tileId=s.current.tileId,preview=E.scoreOutcome(s,0);assert.equal(JSON.stringify(s),original);assert.equal(preview.earned,value);assert.deepEqual(preview.deltas,[value,0]);
  const awarded=resolved(s,0);assert.equal(JSON.stringify(s),original);assert.equal(awarded.questions,s.questions);assert.equal(awarded.state,'BOARD');assert.equal(awarded.current,null);assert.equal(awarded.turn,1);assert(awarded.board.find(t=>t.id===tileId).done);assert.deepEqual(awarded.teams.map(t=>t.score),[value,0]);assert.equal(awarded.teams[0].correct,1);assert.equal(awarded.history.length,1);assert.equal(awarded.lastResolution.questionId,id);assert.deepEqual(awarded.lastResolution.deltas,preview.deltas);assert(E.validateState(awarded,bank));
 }
});
run('one-tap opposingwinner usesexplicitdefaultstealconvention onlywhenenabled',()=>{
 for(const steal of [true,false])for(const value of [200,400,600]){
  let s=question(create(config({steal})),value);s=resolved(s,1);assert.equal(s.state,'BOARD');assert.deepEqual(s.teams.map(t=>t.score),[0,value]);assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);assert.equal(s.teams[1].correct,1);assert.equal(s.teams[1].steals,steal?1:0);assert.equal(s.history[0].phase,steal?'steal':'first');assert.equal(s.lastResolution.steal,steal);assert(E.validateState(s,bank));
 }
});
run('one-tap nobodycompleteswithnoinventedattempts andUndo reversescompletion',()=>{
 let s=question(create());const id=s.current.questionId;s=resolved(s,null);assert.equal(s.state,'BOARD');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.deepEqual(s.teams.map(t=>t.correct+t.incorrect),[0,0]);assert.equal(s.transactions.length,0);assert.equal(s.history[0].winner,null);assert(E.validateState(s,bank));s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.current.questionId,id);assert.equal(s.current.revealed,true);assert.equal(s.current.resolved,false);assert.equal(s.board.filter(t=>t.done).length,0);assert.equal(s.turn,0);assert.equal(s.history.length,0);assert(E.validateState(s,bank));
 for(const both of [false,true]){let q=question(create());q=act(q,'DECLARE_INCORRECT');if(both)q=act(q,'DECLARE_INCORRECT');q=resolved(q,null);assert.deepEqual(q.teams.map(t=>t.incorrect),both?[1,1]:[1,0]);assert.equal(q.teams.reduce((sum,t)=>sum+t.correct,0),0);}
});
run('one-tap duplicate andstaleresolutions cannot score afterreloadornewquestion',()=>{
 let s=question(create());s=act(s,'REVEAL');const action={teamId:0,tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token};s=act(s,'RESOLVE_QUESTION',action);const before=JSON.stringify({teams:s.teams,history:s.history,transactions:s.transactions,lastResolution:s.lastResolution});
 s=act(s,'RESOLVE_QUESTION',action);assert(s.lastError);assert.equal(JSON.stringify({teams:s.teams,history:s.history,transactions:s.transactions,lastResolution:s.lastResolution}),before);
 s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);if(s.state==='PAUSED')s=act(s,'RESUME');s=act(s,'RESOLVE_QUESTION',action);assert(s.lastError);assert.equal(s.teams[0].score,200);s=question(s,400);s=act(s,'REVEAL');const newId=s.current.questionId;s=act(s,'RESOLVE_QUESTION',action);assert(s.lastError);assert.equal(s.current.questionId,newId);assert.equal(s.history.length,1);assert.equal(s.teams[0].score,200);s=resolved(s,1);assert.deepEqual(s.teams.map(t=>t.score),[200,400]);
});
run('one-tap requiresfreshcompletequestionidentity andUndo invalidatesoldbuttons',()=>{
 let s=question(create());const early={teamId:0,tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token};assert(act(s,'RESOLVE_QUESTION',early).lastError);s=act(s,'REVEAL');const good={teamId:0,tileId:s.current.tileId,questionId:s.current.questionId,token:s.current.token};
 for(const patch of [{token:undefined},{tileId:undefined},{questionId:undefined},{token:early.token},{tileId:'missing-tile'},{questionId:'missing-question'},{teamId:2},{teamId:undefined}]){const rejected=act(s,'RESOLVE_QUESTION',{...good,...patch});assert(rejected.lastError);assert.equal(rejected.history.length,0);assert.deepEqual(rejected.teams.map(t=>t.score),[0,0]);}
 s=act(s,'RESOLVE_QUESTION',good);s=act(s,'UNDO');assert.notEqual(s.current.token,good.token);s=act(s,'RESOLVE_QUESTION',good);assert(s.lastError);assert.equal(s.history.length,0);assert.deepEqual(s.teams.map(t=>t.score),[0,0]);
});
run('one-tap sharedpreview matchesDoubleBonusPit transactionsandzerofloor',()=>{
 for(const value of [200,400,600]){
  let s=create(helpers(['pit','double'],{bonus:true}));s=act(s,'ADJUST_SCORE',{teamId:0,delta:10,reason:'رصيد'});s=act(s,'ADJUST_SCORE',{teamId:1,delta:100,reason:'رصيد'});s=act(s,'SELECT_TILE',{tileId:s.board.find(t=>t.value===value).id});s=use(s,'pit');s=act(s,'START_QUESTION');s=use(s,'double');s=act(s,'REVEAL');const original=JSON.stringify(s),preview=E.scoreOutcome(s,0);assert.equal(JSON.stringify(s),original);assert.equal(preview.earned,value*2+50);assert.deepEqual(preview.deltas,[value*2+50,-100]);s=resolved(s,0);assert.deepEqual(s.teams.map(t=>t.score),[10+value*2+50,0]);assert.equal(s.lastResolution.transactionIds.length,2);assert.deepEqual(s.lastResolution.deltas,preview.deltas);assert(E.validateState(s,bank));
  s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[10,100]);assert.equal(s.teams[0].assists.pit,1);assert.equal(s.teams[0].assists.double,1);assert.equal(s.current.pendingAssists.length,2);assert.equal(E.scoreOutcome(s,0).earned,value*2+50);assert(E.validateState(s,bank));s=resolved(s,0);assert.equal(s.teams[0].assists.double,0);assert.equal(s.teams[0].assists.pit,0);assert.equal(s.teams[0].assistHistory.length,2);assert.deepEqual(s.teams.map(t=>t.score),[10+value*2+50,0]);
 }
});
run('one-tap trap successfailure andUndo retainconfiguredruleswithoutsteal',()=>{
 for(const trapSuccess of ['responder','none'])for(const success of [true,false]){
  let s=question(create(helpers(['trap'],{trapSuccess,negative:true})),600);s=use(s,'trap');if(!success)s=act(s,'DECLARE_INCORRECT');s=resolved(s,success?1:null);assert.equal(s.state,'BOARD');assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[1].incorrect,success?0:1);assert.equal(s.teams[1].correct,success?1:0);assert.equal(s.teams[1].score,success?(trapSuccess==='responder'?600:0):-600);assert.equal(s.teams[1].steals,0);assert(E.validateState(s,bank));s=act(s,'UNDO');assert.equal(s.teams[0].assists.trap,1);assert.equal(s.current.pendingAssists.length,1);assert.equal(s.current.phase,'trap');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert(E.validateState(s,bank));s=resolved(s,1);assert.equal(s.teams[0].assists.trap,0);assert.equal(s.teams[1].score,trapSuccess==='responder'?600:0);assert.equal(s.teams[1].steals,0);
 }
 let floored=question(create(helpers(['trap'])),600);floored=act(floored,'ADJUST_SCORE',{teamId:1,delta:100,reason:'رصيد'});floored=use(floored,'trap');floored=act(floored,'REVEAL');assert.deepEqual(E.scoreOutcome(floored,null).deltas,[0,0]);floored=resolved(floored,null);assert.equal(floored.teams[1].score,100);
});
run('one-tap configuredPitandstealpenalties runonce andUndo restoresbothteams',()=>{
 let s=create(helpers(['pit'],{negative:true,pitFailPenalty:true,stealPenalty:true}));s=act(s,'SELECT_TILE',{tileId:s.board.find(t=>t.value===400).id});s=use(s,'pit');s=act(s,'START_QUESTION');s=act(s,'DECLARE_INCORRECT');s=act(s,'PASS');const preview=E.scoreOutcome(s,null);assert.deepEqual(preview.deltas,[-400,0]);s=resolved(s,null);assert.deepEqual(s.teams.map(t=>t.score),[-400,0]);assert.deepEqual(s.teams.map(t=>t.incorrect),[1,0]);assert.equal(s.transactions.length,1);s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);assert.equal(s.teams[0].assists.pit,1);assert(E.validateState(s,bank));s=resolved(s,1);assert.deepEqual(s.teams.map(t=>t.score),[-400,400]);assert.equal(s.teams[0].assists.pit,0);assert.equal(s.history.length,1);
});
run('one-tap Doubleentitlement surviveswrongwinnerUndoreloadandcorrection foreachteam',()=>{
 let s=question(create(helpers(['double'])),600);s=use(s,'double');s=act(s,'DECLARE_INCORRECT');s=use(s,'double');s=resolved(s,1);assert.deepEqual(s.teams.map(t=>t.score),[0,1200]);s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.assists.double),[1,1]);assert.deepEqual(s.teams.map(t=>t.assistHistory.length),[0,0]);assert.equal(s.current.pendingAssists.length,2);assert.equal(E.scoreOutcome(s,0).earned,1200);assert.equal(E.scoreOutcome(s,1).earned,1200);s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);if(s.state==='PAUSED')s=act(s,'RESUME');s=resolved(s,0);assert.deepEqual(s.teams.map(t=>t.score),[1200,0]);assert.deepEqual(s.teams.map(t=>t.assists.double),[0,0]);assert.deepEqual(s.teams.map(t=>t.assistHistory.length),[1,1]);assert.equal(s.teams[0].incorrect,0);assert(E.validateState(s,bank));
});
run('one-tap Undo refundsallquestionhelpers andreadjudication consumesexactlyonce',()=>{
 let s=question(create(helpers(['time','hint','double','call','twice'],{timer:true})));for(const key of ['time','hint','double','twice'])s=use(s,key);s=use(s,'call');s=act(s,'RETURN_ASSISTANCE');s=resolved(s,0);assert.equal(s.teams[0].assistHistory.length,5);s=act(s,'UNDO');assert.equal(s.current.pendingAssists.length,5);assert.equal(s.current.usedAssists.length,0);assert.equal(s.teams[0].assistHistory.length,0);assert(Object.values(s.teams[0].assists).every(n=>n===1));assert.equal(E.scoreOutcome(s,0).earned,400);assert(E.validateState(s,bank));s=resolved(s,0);assert.equal(s.teams[0].assistHistory.length,5);assert(Object.values(s.teams[0].assists).every(n=>n===0));assert.equal(s.teams[0].score,400);
});
run('one-tap Skip remainsanunscorablequestion andrefundshelperonUndo',()=>{
 let s=question(create(helpers(['skip'])));s=use(s,'skip');assert.equal(E.scoreOutcome(s,0).earned,0);assert.equal(E.scoreOutcome(s,1).earned,0);s=resolved(s,0);assert.equal(s.lastResolution.winner,null);assert.deepEqual(s.teams.map(t=>t.score),[0,0]);s=act(s,'UNDO');assert.equal(s.teams[0].assists.skip,1);assert.equal(s.current.pendingAssists.length,1);assert(E.validateState(s,bank));s=resolved(s,null);assert.equal(s.teams[0].assists.skip,0);assert.equal(s.teams[0].correct,0);
});
run('one-tap Undo preservesinterleavedmanualadjustments anddoesnotresurrecthelperusage',()=>{
 let s=question(create(helpers(['double'])));s=use(s,'double');s=act(s,'ADJUST_SCORE',{teamId:1,delta:500,reason:'تصحيح مستقل'});s=resolved(s,0);assert.deepEqual(s.teams.map(t=>t.score),[400,500]);s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[0,500]);assert.equal(s.teams[0].assists.double,1);assert.equal(s.current.pendingAssists.length,1);assert(E.validateState(s,bank));s=act(s,'UNDO');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.equal(s.teams[0].assists.double,1);assert.equal(s.teams[0].assistHistory.length,0);assert.equal(E.scoreOutcome(s,0).earned,400);s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);if(s.state==='PAUSED')s=act(s,'RESUME');s=resolved(s,0);assert.deepEqual(s.teams.map(t=>t.score),[400,0]);assert.equal(s.teams[0].assists.double,0);assert.equal(s.teams[0].assistHistory.length,1);assert(E.validateState(s,bank));
});
run('one-tap pendinghelpersandresultmetadatarejectcorruptionwithoutlosingbackup',()=>{
 let s=question(create(helpers(['double'])));s=use(s,'double');s=resolved(s,0);const scored=JSON.parse(JSON.stringify(s));for(const mutate of [t=>t.lastResolution.deltas=[999,0],t=>t.lastResolution.earned=200,t=>t.lastResolution.token='<unsafe>',t=>t.lastResolution.transactionIds=[],t=>t.lastResolution.steal=true]){const bad=structuredClone(scored);mutate(bad);assert.equal(E.restore(bad,bank).state,null);}
 s=act(s,'UNDO');const pending=JSON.parse(JSON.stringify(s));assert(E.validateState(pending,bank));for(const mutate of [t=>t.current.pendingAssists.push({...t.current.pendingAssists[0]}),t=>t.current.pendingAssists[0].teamId=2,t=>t.current.pendingAssists[0].key='missing',t=>t.current.pendingAssists[0].questionId='other-question',t=>t.teams[0].assists.double=0,t=>t.current.pendingAssists[0].participant='<bad>'.repeat(20),t=>t.current.doubleTeam=1,t=>t.current.pendingAssists[0].id='constructor',t=>{t.state='QUESTION_ACTIVE';t.current.revealed=t.current.closed=false;}]){const bad=structuredClone(pending);mutate(bad);const before=JSON.stringify(bad),result=E.restore(bad,bank);assert.equal(result.state,null);assert.equal(result.backup,bad);assert.equal(JSON.stringify(bad),before);}
});
run('one-tap timeoutrecordsnoinventedwronganswers andcanresolvewithoutanextraaction',()=>{
 let s=question(create(config({timer:true})));s=act(s,'TICK',{token:s.current.token},s.current.deadline);s=act(s,'TICK',{token:s.current.token},s.current.deadline);assert.equal(s.state,'ANSWER_REVEAL');s=resolved(s,null);assert.equal(s.state,'BOARD');assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);assert.equal(s.history[0].attempts.length,2);assert(E.validateState(s,bank));
});
run('one-tap completeClassic36 supportsfinalwinner tiesandlastquestionUndo',()=>{
 for(const nobody of [false,true]){let s=create(config({board:'classic'}));let n=0;while(s.state!=='MATCH_COMPLETE'){s=act(s,'SELECT_TILE',{tileId:s.board.find(t=>!t.done).id});s=act(s,'START_QUESTION');s=resolved(s,nobody?null:n%3===0?null:n%2);n++;if(n<36)assert.equal(s.state,'BOARD');assert(n<=36);}assert.equal(n,36);assert.equal(s.current,null);assert.equal(s.history.length,36);assert(s.completedAt);assert.equal(s.board.filter(t=>t.done).length,36);assert.equal(s.winner,nobody?null:s.teams[0].score===s.teams[1].score?null:s.teams[0].score>s.teams[1].score?0:1);assert(E.validateState(s,bank));const scores=s.teams.map(t=>t.score),before=s.lastResolution;s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.equal(s.completedAt,null);assert.equal(s.board.filter(t=>t.done).length,35);assert.equal(s.current.questionId,before.questionId);assert(E.validateState(s,bank));s=resolved(s,before.winner);assert.equal(s.state,'MATCH_COMPLETE');assert.deepEqual(s.teams.map(t=>t.score),scores);assert(E.validateState(s,bank));}
});


run('one-tap postresolutionmanualadjustUndo preserveshelpercostuntilquestionUndo',()=>{
 let s=question(create(helpers(['double'])));s=use(s,'double');s=resolved(s,0);s=act(s,'ADJUST_SCORE',{teamId:1,delta:300,reason:'تصحيح بعد الحسم'});assert.deepEqual(s.teams.map(t=>t.score),[400,300]);s=act(s,'UNDO');assert.equal(s.state,'BOARD');assert.deepEqual(s.teams.map(t=>t.score),[400,0]);assert.equal(s.teams[0].assists.double,0);assert(E.validateState(s,bank));s=act(s,'UNDO');assert.equal(s.state,'ANSWER_REVEAL');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert.equal(s.teams[0].assists.double,1);assert.equal(s.current.pendingAssists.length,1);assert(E.validateState(s,bank));s=resolved(s,0);assert.deepEqual(s.teams.map(t=>t.score),[400,0]);assert.equal(s.teams[0].assists.double,0);assert.equal(s.teams[0].assistHistory.length,1);assert(E.validateState(s,bank));
});
run('one-tap restorationrejectsunearnedmodifiers withoutconsumedordeferredhelperledger',()=>{
 const active=question(create(helpers(['pit','double','hint','skip','second'])));
 for(const mutate of [t=>t.current.pitTeam=0,t=>t.current.doubleTeam=0,t=>t.current.twiceTeam=0,t=>t.current.secondTeam=0,t=>t.current.trapTeam=0,t=>t.current.hint=true,t=>t.current.skip=true]){const bad=JSON.parse(JSON.stringify(active));mutate(bad);assert.equal(E.validateState(bad,bank),null);}
 let s=use(active,'double');s=resolved(s,0);s=act(s,'UNDO');const bad=JSON.parse(JSON.stringify(s));bad.current.pendingAssists=Array.from({length:11},(_,i)=>({...bad.current.pendingAssists[0],id:'pending-'+i}));assert.equal(E.validateState(bad,bank),null);
});


run('checked-only eligibility rejects editorial pending disputed and incomplete evidence without mutating snapshots',()=>{
 const template=bank.find(q=>E.verifiedForPlay(q));assert(template);
 for(const status of ['editorial','pending','disputed'])assert(!E.isEligible({...template,verification:{...template.verification,status}},config()));
 for(const field of ['referenceTitle','section','notes','verifiedAt']){const verification={...template.verification};delete verification[field];assert(!E.isEligible({...template,verification},config()));}
 for(const verifiedAt of ['2026-02-30','invalid','2026-1-01'])assert(!E.isEligible({...template,verification:{...template.verification,verifiedAt}},config()));
 assert(!E.isEligible({...template,verification:{status:'source-checked'},source:{title:'رابط فقط',url:'https://example.com/',reference:'صفحة'}},config()));
 const s=create(),saved=JSON.parse(JSON.stringify(s)),id=s.board[0].questionId; saved.questions[id].verification={status:'pending'};
 // An already assigned legacy team question remains resumable, without enabling
 // pending material for any newly allocated board.
 assert(E.validateState(saved,bank));assert(!E.isEligible(saved.questions[id],s.config));
});
run('exact-tier shortages reject before allocating any broken or substituted board slot',()=>{
 const c=config(),category=c.teams[0].categories[0],thin=bank.filter(q=>q.category!==category||E.pointValue(q)!==600);
 assert(E.validateConfig(c,thin).some(message=>message.includes('600')));assert.throws(()=>E.create(c,thin));
 const s=create();assert(s.board.every(tile=>E.pointValue(E.getQuestion(s,tile.questionId,bank))===tile.value&&E.isEligible(E.getQuestion(s,tile.questionId,bank),s.config)));
});
run('attempt-specific penalties require explicit wrong answers rather than winner inference pass or expiration',()=>{
 for(const step of ['REVEAL','PASS','timeout']){
  let s=question(create(helpers(['trap'],{timer:true,negative:true,stealPenalty:true})));s=use(s,'trap');
  if(step==='timeout')s=act(s,'TICK',{token:s.current.token},s.current.deadline);else s=act(s,step);
  if(!s.current.revealed)s=act(s,'REVEAL');assert.deepEqual(E.scoreOutcome(s,null).deltas,[0,0]);s=resolved(s,null);assert.deepEqual(s.teams.map(t=>[t.score,t.incorrect]),[[0,0],[0,0]]);
 }
 let s=create(helpers(['pit'],{pitFailPenalty:true,negative:true}));s=act(s,'SELECT_TILE',{tileId:s.board[0].id});s=use(s,'pit');s=act(s,'START_QUESTION');s=resolved(s,1);assert.deepEqual(s.teams.map(t=>t.score),[0,200]);assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);
 s=question(create(helpers(['trap'],{negative:true})));s=use(s,'trap');s=act(s,'DECLARE_INCORRECT');s=resolved(s,null);assert.deepEqual(s.teams.map(t=>t.score),[0,-200]);assert.equal(s.teams[1].incorrect,1);
});
run('correct automatic answer overridden by host never becomes an invented wrong attempt',()=>{
 let s=question(create(config({answerStyle:'choice',steal:false})));const q=E.getQuestion(s,s.current.questionId,bank);s=act(s,'ANSWER',{value:q.answer});s=resolved(s,null);assert.equal(s.history[0].attempts[0].correct,true);assert.deepEqual(s.history[0].incorrectTeams,[]);assert.deepEqual(s.teams.map(t=>t.incorrect),[0,0]);assert(E.validateState(s,bank));
});
run('resolution identifiers are question-specific persisted and invalidated by correction',()=>{
 let s=question(create());s=act(s,'REVEAL');const c={...s.current};assert(c.resolutionId);let rejected=act(s,'RESOLVE_QUESTION',{teamId:0,tileId:c.tileId,questionId:c.questionId,token:c.token,resolutionId:'other-judgment'});assert(rejected.lastError);assert.equal(rejected.history.length,0);
 s=act(s,'RESOLVE_QUESTION',{teamId:0,tileId:c.tileId,questionId:c.questionId,token:c.token,resolutionId:c.resolutionId});assert.equal(s.history[0].resolutionId,c.resolutionId);assert.equal(s.lastResolution.id,c.resolutionId);assert.equal(s.transactions[0].groupId,c.resolutionId);assert(E.validateState(s,bank));
 s=act(s,'UNDO');assert.notEqual(s.current.resolutionId,c.resolutionId);assert.notEqual(s.current.token,c.token);assert(s.current.revealed);assert(E.validateState(s,bank));
 const bad=JSON.parse(JSON.stringify(s));bad.current.resolutionId='<invalid>';assert.equal(E.validateState(bad,bank),null);
});
run('legacy adjudication and stale question handlers cannot bypass current question identity',()=>{
 let s=question(create());const active={...s.current};s=act(s,'REVEAL');assert(E.dispatch(s,{type:'ADJUDICATE',teamId:0},bank,clock).lastError);
 for(const type of ['REVEAL','ANSWER','ASSIST','RETURN_ASSISTANCE']){const rejected=act(s,type,{token:active.token,questionId:active.questionId,tileId:active.tileId,value:0,key:'hint',confirmed:true});assert(rejected.lastError);assert.deepEqual(rejected.teams.map(t=>t.score),[0,0]);}
 const old={...s.current};s=act(s,'ADJUDICATE',{teamId:0});s=act(s,'UNDO');assert.notEqual(s.current.token,old.token);assert(E.dispatch(s,{type:'ADJUDICATE',teamId:1,token:old.token,tileId:old.tileId,questionId:old.questionId},bank,clock).lastError);
});
run('score corrections require reason reject duplicate operation and validate ledger deltas',()=>{
 let s=create();for(const reason of ['',undefined,'   ']){const rejected=act(s,'ADJUST_SCORE',{teamId:0,delta:200,reason});assert(rejected.lastError);assert.equal(rejected.transactions.length,0);}
 s=act(s,'ADJUST_SCORE',{teamId:0,delta:500,reason:'تصحيح الجولة',operationId:'host-correction-one'});assert.equal(s.teams[0].score,500);const before=JSON.stringify({teams:s.teams,transactions:s.transactions,undo:s.undo});s=act(s,'ADJUST_SCORE',{teamId:0,delta:500,reason:'تصحيح الجولة',operationId:'host-correction-one'});assert(s.lastError);assert.equal(JSON.stringify({teams:s.teams,transactions:s.transactions,undo:s.undo}),before);assert(E.validateState(s,bank));
 const bad=JSON.parse(JSON.stringify(s));bad.transactions[0].delta=600;assert.equal(E.validateState(bad,bank),null);
});
run('complete one-tap compact matches support either winner nobody and mid-question reload',()=>{
 for(const winner of [0,1,null]){let s=create(),n=0;while(s.state!=='MATCH_COMPLETE'){s=question(s,s.board.find(t=>!t.done).value);s=act(s,'REVEAL');const id=s.current.questionId;s=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(s);s=act(s,'RESUME');assert.equal(s.current.questionId,id);assert(s.current.revealed);s=resolved(s,winner);assert(!s.lastError);n++;assert(n<=18);}assert.equal(n,18);assert.equal(s.winner,winner);assert.deepEqual(s.teams.map(t=>t.score),winner===0?[7200,0]:winner===1?[0,7200]:[0,0]);assert.equal(new Set(s.history.map(h=>h.resolutionId)).size,18);assert(E.validateState(s,bank));}
});


run('presenter timer changes require pause preserve hidden question and undo clock configuration safely',()=>{
 let s=question(create(config({timer:true})));const oldToken=s.current.token,remaining=s.current.remainingMs;
 assert(act(s,'SET_TIMER',{seconds:30}).lastError);s=act(s,'PAUSE');s=act(s,'SET_TIMER',{seconds:30});assert.equal(s.state,'PAUSED');assert.equal(s.current.remainingMs,30000);assert.equal(s.current.deadline,null);assert.notEqual(s.current.token,oldToken);assert(!s.current.revealed);assert(E.validateState(s,bank));
 const editedToken=s.current.token;s=act(s,'RESUME');assert.equal(s.current.deadline,clock+30000);s=act(s,'TICK',{token:editedToken},clock+60000);assert.equal(s.state,'QUESTION_ACTIVE');s=act(s,'UNDO');assert.equal(s.state,'PAUSED');assert(s.current.remainingMs<=remaining);assert(E.validateState(s,bank));
 s=act(s,'RESUME');s=act(s,'REVEAL');s=act(s,'PAUSE');assert(act(s,'SET_TIMER',{seconds:30}).lastError);
});
run('explicit end-match preserves true partial results no invented tiles and can be undone or resumed from save',()=>{
 let s=question(create());s=resolved(s,1);s=question(s,400);const current=s.current.questionId;assert(act(s,'END_MATCH').lastError);s=act(s,'END_MATCH',{confirmed:true,reason:'انتهى وقت الجلسة'});assert.equal(s.state,'MATCH_COMPLETE');assert(s.endedEarly);assert.equal(s.history.length,1);assert.equal(s.board.filter(t=>t.done).length,1);assert.deepEqual(s.teams.map(t=>t.score),[0,200]);assert.equal(s.winner,1);assert.equal(s.current,null);assert(E.validateState(s,bank));assert(E.validateState(JSON.parse(JSON.stringify(s)),bank));
 s=act(s,'UNDO');assert.equal(s.state,'PAUSED');assert.equal(s.current.questionId,current);assert.equal(s.history.length,1);assert(!s.endedEarly);assert.equal(s.completedAt,null);assert(E.validateState(s,bank));s=act(s,'RESUME');assert.equal(s.state,'QUESTION_ACTIVE');
});


run('stale Undo rejects old revisions and cannot undo an intervening score correction',()=>{
 let s=question(create());s=resolved(s,0);const expectedSerial=s.serial,resolutionId=s.lastResolution.id;s=act(s,'ADJUST_SCORE',{teamId:1,delta:200,reason:'تصحيح مستقل'});let rejected=act(s,'UNDO',{expectedSerial,resolutionId});assert(rejected.lastError);assert.deepEqual(rejected.teams.map(t=>t.score),[200,200]);
 rejected=act(s,'UNDO',{resolutionId});assert(rejected.lastError);assert.deepEqual(rejected.teams.map(t=>t.score),[200,200]);
 const currentSerial=s.serial;s=act(s,'UNDO',{expectedSerial:currentSerial});assert(s.serial>currentSerial);assert.deepEqual(s.teams.map(t=>t.score),[200,0]);rejected=act(s,'UNDO',{expectedSerial:currentSerial});assert(rejected.lastError);assert.equal(rejected.history.length,1);s=act(s,'UNDO',{resolutionId,expectedSerial:s.serial});assert.equal(s.state,'ANSWER_REVEAL');assert.deepEqual(s.teams.map(t=>t.score),[0,0]);assert(E.validateState(s,bank));
});

run('family12 preset uses exactly reviewed short age-suitable facts across six complete categories',()=>{
 const c=config({contentPreset:'family',timer:false}),categories=[...new Set(bank.map(q=>q.category))].filter(category=>[200,400,600].every(value=>E.eligibleQuestions(bank,c,{category,value}).length>=1));
 assert.equal(categories.length,6);c.teams.forEach((t,i)=>t.categories=categories.slice(i*3,i*3+3));
 assert.deepEqual(E.validateConfig(c,bank),[]);const s=create(c);assert.equal(s.config.contentPreset,'family');assert.equal(s.board.length,18);
 for(const q of Object.values(s.questions)){assert.equal(q.familyFriendly,true);assert(q.minAge<=12);assert(q.q.length<=180);assert.equal(q.familyReview.status,'editorial-suitability-reviewed');assert.equal(q.verification.status,'source-checked');}
 assert(E.validateState(s,bank));assert(E.validateConfig({...c,board:'classic'},bank).length,'insufficient family tiers must not silently broaden selection');
});
run('family age text and attestation filters fail closed, visual filters never admit text questions',()=>{
 const q=bank.find(q=>q.familyFriendly&&E.isEligible(q,{contentPreset:'family'}));assert(q);
 for(const patch of [{familyFriendly:false},{familyReview:undefined},{minAge:13},{minAge:undefined},{q:'س'.repeat(181)},{verification:{...q.verification,status:'pending'}}])assert(!E.isEligible({...q,...patch},{contentPreset:'family'}));
 assert(E.eligibleQuestions(bank,{contentPreset:'visual'}).every(q=>!!q.image));
 const c=config({contentPreset:'unknown'});assert(E.validateConfig(c,bank).length);
 const legacy=config();delete legacy.contentPreset;assert.deepEqual(E.validateConfig(legacy,bank),[]);assert.equal(create(legacy).config.contentPreset,'standard');
});

console.log(JSON.stringify({passed:count,failed:failures,questions:bank.length}));
if(failures)process.exitCode=1;
