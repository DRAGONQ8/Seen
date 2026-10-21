/* Seeded long-run state-invariant regression; optional: node tests/engine-fuzz.cjs. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),E=require('../team-engine.js');
const contentRoot=path.join(__dirname,'../content');
const bank=fs.readdirSync(contentRoot).filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(path.join(contentRoot,f),'utf8')));
let seed=43182337;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const pick=a=>a[Math.floor(random()*a.length)];
let count=0,steps=0,restores=0,undos=0,rejections=0,history=[];
for(let scenario=0;scenario<120;scenario++){
 const config=E.defaults();config.board=scenario%2?'classic':'compact';config.timer=scenario%3!==0;config.negative=scenario%5===0;config.bonus=scenario%7===0;config.steal=scenario%4!==0;config.trapSuccess=scenario%2?'none':'responder';config.pitFailPenalty=true;config.stealPenalty=true;config.answerStyle=pick(['oral','choice','typed']);config.transition=pick(['auto','host']);config.callPause=!!(scenario%2);config.starter=pick(['0','1','random']);config.assistSlots=5;config.teams.forEach(t=>{t.players=['خالد','سعد'];t.assists=[...E.ASSISTS].sort(()=>random()-.5).slice(0,5);});
 let now=Date.now(),s=E.create(config,bank,{seed:scenario+5000,now}),actions=[];
 const send=action=>{now+=100+Math.floor(random()*100);const prev=s;s=E.dispatch(s,action,bank,now);steps++;if(s.lastError)rejections++;actions.push(action);if(actions.length>25)actions.shift();const validated=E.validateState({...s,undo:[]},bank);if(!validated){fs.writeFileSync('/tmp/seen-fuzz-failure.json',JSON.stringify({scenario,steps,action,actions,prev,s},null,2));throw Error('Invalid state scenario '+scenario+' after '+action.type);} };
 for(let step=0;step<600&&s.state!=='MATCH_COMPLETE';step++){
  if(step>0&&step%27===0){s=E.validateState(JSON.parse(JSON.stringify(s)),bank);if(!s)throw Error('roundtrip invalid');restores++;}
  if(random()<.035&&s.undo.length){send({type:'UNDO'});undos++;continue;}
  if(random()<.025){send({type:'ADJUST_SCORE',teamId:Math.floor(random()*2),delta:pick([-200,200,400]),reason:'تصحيح عشوائي مضبوط',operationId:'fuzz-correction-'+scenario+'-'+step});continue;}
  const c=s.current;
  if(s.state==='PAUSED'){if(c&&!c.revealed&&['QUESTION_ACTIVE','STEAL_OPPORTUNITY'].includes(s.pausedFrom)&&random()<.2)send({type:'SET_TIMER',seconds:pick([15,30,60])});else send({type:'RESUME'});continue;}
  if(s.state==='BOARD'){send({type:'SELECT_TILE',tileId:pick(s.board.filter(t=>!t.done)).id});continue;}
  if(s.state==='QUESTION_PREVIEW'){if(s.teams[c.responder].assists.pit>0&&random()<.5)send({type:'ASSIST',key:'pit',confirmed:true});else send({type:'START_QUESTION'});continue;}
  if(s.state==='ASSISTANCE_ACTIVE'){if(random()<.4){now=(c.assistance.deadline||now)+100;send({type:'TICK',token:c.token});}else send({type:'RETURN_ASSISTANCE'});continue;}
  if(['QUESTION_ACTIVE','STEAL_OPPORTUNITY'].includes(s.state)){
   const p=random(),keys=Object.keys(s.teams[c.responder].assists).filter(k=>s.teams[c.responder].assists[k]>0&&k!=='pit');
   if(p<.19&&keys.length)send({type:'ASSIST',key:pick(keys),participant:'خالد',confirmed:true});
   else if(p<.27)send({type:'PAUSE'});
   else if(p<.43&&c.timed&&c.deadline){now=c.deadline+100;send({type:'TICK',token:c.token});}
   else if(p<.59)send({type:'DECLARE_INCORRECT'});
   else if(p<.65)send({type:'PASS'});
   else if(p<.85&&config.answerStyle!=='oral'){const q=E.getQuestion(s,c.questionId,bank);send({type:'ANSWER',value:config.answerStyle==='typed'?(random()<.6?q.correctAnswer:'مقترح غير صحيح'):pick(c.choices)});}
   else send({type:'REVEAL'});
   continue;
  }
  if(['ANSWER_REVEAL','SCORE_ADJUDICATION'].includes(s.state)){send({type:'RESOLVE_QUESTION',teamId:pick([0,1,null]),token:c.token,tileId:c.tileId,questionId:c.questionId,resolutionId:c.resolutionId});continue;}
  if(s.state==='TURN_COMPLETE'){send({type:'NEXT_TURN'});continue;}
  throw Error('Unknown '+s.state);
 }
 if(s.state!=='MATCH_COMPLETE')throw Error('Not complete scenario '+scenario);
 if(!E.validateState(s,bank))throw Error("final full validation failed");count++;if(count%10===0)console.log(JSON.stringify({scenarios:count,steps,restores,undos,rejections}));
}
console.log(JSON.stringify({passed:count,steps,restores,undos,rejections}));
