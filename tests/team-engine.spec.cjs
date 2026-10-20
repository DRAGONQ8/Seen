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
function config(extra = {}) { const c = E.defaults(); c.timer = false; Object.assign(c, extra); return c; }
function create(c = config(), seed = 8) { return E.create(c, bank, { seed, now: clock }); }
function act(s, type, fields = {}, at = clock += 50) { return E.dispatch(s, { type, ...fields }, bank, at); }
function question(s, value = 200) { s = act(s, 'SELECT_TILE', { tileId: s.board.find(t => !t.done && t.value === value).id }); return act(s, 'START_QUESTION'); }
function oralWin(s, team = s.current.responder) { s = act(s, 'REVEAL'); return act(s, 'ADJUDICATE', { teamId: team }); }
function helpers(keys, extra = {}) { const c = config(extra); c.assistSlots = 5; c.teams.forEach(t => t.assists = [...keys]); return c; }
function use(s, key, extra = {}) { return act(s, 'ASSIST', { key, confirmed: true, ...extra }); }
run('default rules: compact18, values200400600, exactlythreecategorieseach', () => {
 const c=E.defaults();assert.equal(c.board,'compact');assert.equal(c.answerStyle,'oral');assert.equal(c.duration,60);assert.equal(c.stealDuration,10);assert.equal(c.assistSlots,3);
 const s=create(c);assert.equal(s.board.length,18);assert.equal(new Set(s.board.map(t=>t.questionId)).size,18);assert.deepEqual([...new Set(s.board.map(t=>t.value))],[200,400,600]);
 s.categories.forEach(cat=>assert.deepEqual(s.board.filter(t=>t.category===cat).map(t=>t.value),[200,400,600]));assert.equal(s.board.reduce((a,t)=>a+t.value,0),7200);
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
 const first=create(config(),100),seen=first.board.map(t=>t.questionId),second=E.create(config(),bank,{seed:100,now:clock,seen});assert(second.board.every(t=>!seen.includes(t.questionId)));assert.deepEqual(second.board.map(t=>t.value),first.board.map(t=>t.value));
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
 let s=question(create(config({answerStyle:'choice',steal:false})));const q=E.getQuestion(s,s.current.questionId,bank);s=act(s,'ANSWER',{value:q.answer});s=act(s,'ADJUDICATE',{teamId:null});assert.equal(s.teams[0].incorrect,1);assert.equal(s.teams[0].correct,0);s=act(s,'UNDO');assert.equal(s.teams[0].incorrect,0);s=act(s,'ADJUDICATE',{teamId:0});assert.equal(s.teams[0].incorrect,0);assert.equal(s.teams[0].correct,1);const restored=E.validateState(JSON.parse(JSON.stringify(s)),bank);assert(restored);assert.equal(restored.teams[0].correct,1);
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
 const template={...bank.find(q=>q.category==='anime'),id:'anime-v3-test',sub:'Naruto',franchiseId:'naruto',spoiler:false};const c=config();c.anime.selected=['naruto'];c.anime.levels.naruto=1;assert(E.isEligible({...template,spoilerLevel:1},c));assert(!E.isEligible({...template,spoilerLevel:2},c));c.spoilerProtection=false;assert(!E.isEligible({...template,spoilerLevel:2},c));c.anime.levels.naruto=2;assert(E.isEligible({...template,spoilerLevel:2},c));assert(!E.isEligible({...template,spoilerLevel:3},c));c.anime.levels.naruto=3;assert(E.isEligible({...template,spoilerLevel:3},c));assert(!E.isEligible({...template,franchiseId:'bleach',spoilerLevel:1},c));c.anime.selected.push('bleach');assert(E.isEligible({...template,franchiseId:'bleach',spoilerLevel:1},c));assert(!E.isEligible({...template,franchiseId:'bleach',spoilerLevel:2},c));assert.equal(E.FRANCHISES.length,12);
});
run('V3 sharedeligibility drives preview validation andgeneration withoutspoilerfallback',()=>{
 const c=config();c.anime.selected=[];assert.equal(E.eligibleQuestions(bank,c,{category:'anime'}).length,0);assert(E.validateConfig(c,bank).length);assert.throws(()=>E.create(c,bank));const c2=config();const enabled=E.eligibleQuestions(bank,c2,{category:'anime',value:600});assert(enabled.every(q=>!q.spoiler));assert.equal(E.eligibleQuestions(bank.map(q=>({...q,unavailable:true})),c2).length,0);assert.equal(E.eligibleQuestions(bank.map(q=>({...q,disabled:true})),c2).length,0);
});
run('V3 recentselectionavoids30daysandlastthreematcheswithdeterministicoldestfallback',()=>{
 const c=config(),first=create(c,50),ids=first.board.map(t=>t.questionId),seen=Object.fromEntries(ids.map(id=>[id,clock-1000]));const next=E.create(c,bank,{now:clock,seed:50,seen});assert(next.board.every(t=>!ids.includes(t.questionId)));const recent=E.create(c,bank,{now:clock,seed:50,recentMatches:[{at:clock-40*86400000,questionIds:ids}]});assert(recent.board.every(t=>!ids.includes(t.questionId)));const stale=Object.fromEntries(bank.map((q,i)=>[q.id,clock-1000-i*10]));const fallback=E.create(c,bank,{now:clock,seed:50,seen:stale});assert(fallback.selectionWarnings.length);assert.deepEqual(fallback.board,E.create(c,bank,{now:clock,seed:50,seen:stale}).board);for(const tile of fallback.board){const candidates=E.eligibleQuestions(bank,c,{category:tile.category,value:tile.value});assert.equal(tile.questionId,candidates.sort((a,b)=>stale[a.id]-stale[b.id])[0].id);}c.repetition='all';const all=E.create(c,bank,{now:clock,seed:50,seen:stale});assert.deepEqual(all.board,E.create(c,bank,{now:clock,seed:50}).board);
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
 const c=config(),template=bank.find(q=>q.category==='football'),synthetic=[];for(const category of c.teams.flatMap(t=>t.categories))for(const points of [200,400,600])for(let i=0;i<4;i++)synthetic.push({...template,id:`variety-${category}-${points}-${i}`,category,sub:`موضوع ${i}`,q:`سؤال ${category} ${points} ${i}`,points,level:points/200,franchiseId:'naruto',spoilerLevel:1,spoiler:false,image:undefined,correctAnswer:`${category} إجابة ${i}`,acceptedAnswers:[],options:[`${category} إجابة ${i}`,'خيار أول','خيار ثان','خيار ثالث'],answer:0});
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
console.log(JSON.stringify({passed:count,failed:failures,questions:bank.length}));
if(failures)process.exitCode=1;
