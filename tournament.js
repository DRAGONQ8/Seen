/* Original knockout tournament coordinator. Match scoring belongs to TeamEngine. */
const Tournament = (() => {
  'use strict';
  const VERSION = 1;
  const clone = x => JSON.parse(JSON.stringify(x));
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
  const nameOK = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 32 && !/[\u0000-\u001f\u007f<>]/.test(value);
  const int = n => Number.isSafeInteger(n) && n >= 0;
  const signature = match => JSON.stringify([match.id,match.state,match.teams.map(t=>t.score),match.board.map(t=>!!t.done),match.history.map(h=>[h.questionId,h.winner,h.resolutionId || h.token || null])]);
  function create(names, options = {}) {
    if (!Array.isArray(names) || ![2,4,8].includes(names.length) || names.some(n=>!nameOK(n)) || new Set(names.map(n=>n.trim())).size !== names.length) throw Error('اختر 2 أو 4 أو 8 فرق بأسماء مختلفة، حتى 32 حرفًا.');
    const now = options.now ?? Date.now(), id = options.id || 'cup-' + now;
    if (!int(now) || !idOK(id)) throw Error('معرّف البطولة غير صالح.');
    const teams = names.map((name,i)=>({id:'t-'+i,name:name.trim()})), rounds=[];
    for (let count=names.length/2,r=0;count>=1;count/=2,r++) rounds.push(Array.from({length:count},(_,i)=>({id:`r${r}-m${i}`,a:r===0?teams[i*2].id:null,b:r===0?teams[i*2+1].id:null,status:r===0?'ready':'waiting',winner:null,scores:null,boundMatchId:null,results:[]})));
    return {version:VERSION,id,revision:0,createdAt:now,teams,rounds,status:'active',champion:null,events:[]};
  }
  const games = state => state.rounds.flat();
  const nextGame = state => games(state).find(g=>['ready','playing','tie'].includes(g.status)) || null;
  const team = (state,id) => state.teams.find(t=>t.id===id) || null;
  function checked(state) { if (!validate(state)) throw Error('حفظ البطولة غير صالح؛ لم يتغير الحفظ الحالي.'); return clone(state); }
  function bind(state, gameId, matchId, now=Date.now()) {
    const s=checked(state),g=nextGame(s);
    if (!g || g.id!==gameId || !idOK(matchId) || !int(now) || g.boundMatchId && g.boundMatchId!==matchId || games(s).some(x=>x.results.some(r=>r.matchId===matchId))) throw Error('المباراة لا تطابق الدور الحالي في البطولة.');
    if (g.boundMatchId===matchId) return s;
    g.boundMatchId=matchId;g.status='playing';s.revision++;s.events.push({type:'bind',gameId,matchId,at:now});return s;
  }
  function unbind(state,gameId,matchId,now=Date.now()) {
    const s=checked(state),g=nextGame(s);
    if (!g || g.id!==gameId || g.boundMatchId!==matchId || !int(now)) throw Error('لا توجد مباراة حالية قابلة لإعادة البدء.');
    g.boundMatchId=null;g.status=g.results.length?'tie':'ready';s.revision++;s.events.push({type:'abandon',gameId,matchId,at:now});return s;
  }
  function validateMatch(state,g,match) {
    return match && idOK(match.id) && match.id===g.boundMatchId && match.state==='MATCH_COMPLETE' && Array.isArray(match.teams) && match.teams.length===2 && match.teams.every((t,i)=>t.name===team(state,i?g.b:g.a)?.name && Number.isSafeInteger(t.score) && Math.abs(t.score)<1e9) && Array.isArray(match.board) && [18,36].includes(match.board.length) && match.board.every(t=>t && t.done===true) && new Set(match.board.map(t=>t.questionId)).size===match.board.length && Array.isArray(match.history) && match.history.length===match.board.length && new Set(match.history.map(h=>h.questionId)).size===match.history.length && Number.isSafeInteger(match.serial) && match.serial>=0;
  }
  function result(state,gameId,match,now=Date.now()) {
    const s=checked(state),existing=games(s).flatMap(g=>g.results).find(r=>r.matchId===match?.id);
    if (existing) {
      if(existing.signature===signature(match)) return s;
      throw Error('تغيّرت نتيجة مباراة اعتُمدت سابقًا. صحّحها في البطولة قبل المتابعة.');
    }
    const g=nextGame(s);
    if(!g || g.id!==gameId || !int(now) || !validateMatch(s,g,match)) throw Error('أكمل جميع أسئلة المباراة الحالية قبل اعتماد نتيجتها.');
    const scores=match.teams.map(t=>t.score),winner=scores[0]===scores[1]?null:scores[0]>scores[1]?g.a:g.b;
    g.results.push({matchId:match.id,scores,signature:signature(match),at:now});g.boundMatchId=null;
    if(winner===null) {g.status='tie';s.events.push({type:'tie',gameId,matchId:match.id,at:now});}
    else {
      g.status='complete';g.winner=winner;g.scores=scores;
      const ri=s.rounds.findIndex(round=>round.some(x=>x.id===g.id)),mi=s.rounds[ri].findIndex(x=>x.id===g.id);
      if(ri===s.rounds.length-1) {s.status='complete';s.champion=winner;}
      else {const target=s.rounds[ri+1][Math.floor(mi/2)];target[mi%2?'b':'a']=winner;if(target.a&&target.b)target.status='ready';}
      s.events.push({type:'advance',gameId,matchId:match.id,winner,at:now});
    }
    s.revision++;return s;
  }
  /* Accepting a result is reversible while no subsequent match has started. The
     original match remains known; this never resets any question or score. */
  function undoResult(state,gameId,now=Date.now()) {
    const s=checked(state),g=games(s).find(x=>x.id===gameId);
    if(!g || !g.results.length || !int(now)) throw Error('لا توجد نتيجة معتمدة قابلة للتراجع.');
    const ri=s.rounds.findIndex(round=>round.includes(g)),mi=s.rounds[ri].indexOf(g),later=games(s).slice(games(s).indexOf(g)+1);
    if(later.some(x=>x.boundMatchId || x.results.length)) throw Error('بدأت مباراة لاحقة؛ لا يمكن تغيير التأهل السابق أثناء تقدم البطولة.');
    const removed=g.results.pop();g.winner=null;g.scores=null;g.boundMatchId=removed.matchId;g.status='playing';s.status='active';s.champion=null;
    if(ri+1<s.rounds.length) {const target=s.rounds[ri+1][Math.floor(mi/2)];target[mi%2?'b':'a']=null;target.status='waiting';}
    s.revision++;s.events.push({type:'undo-result',gameId,matchId:removed.matchId,at:now});return s;
  }
  function validate(s) {
    try {
      if(!s || s.version!==VERSION || !idOK(s.id) || !int(s.revision) || !int(s.createdAt) || !Array.isArray(s.teams) || ![2,4,8].includes(s.teams.length) || !Array.isArray(s.rounds) || s.rounds.length!==Math.log2(s.teams.length) || !['active','complete'].includes(s.status) || !Array.isArray(s.events) || s.events.length>1000 || s.events.some(e=>!e || !['bind','abandon','tie','advance','undo-result'].includes(e.type) || !idOK(e.gameId) || !idOK(e.matchId) || !int(e.at)))return false;
      if(s.teams.some((t,i)=>t?.id!=='t-'+i || !nameOK(t.name)) || new Set(s.teams.map(t=>t.name)).size!==s.teams.length)return false;
      const resultIds=new Set(),boundIds=new Set();let playing=0;
      for(let ri=0;ri<s.rounds.length;ri++) {
        const round=s.rounds[ri];if(!Array.isArray(round)||round.length!==s.teams.length/2**(ri+1))return false;
        for(let mi=0;mi<round.length;mi++) {
          const g=round[mi],a=ri===0?s.teams[mi*2].id:s.rounds[ri-1][mi*2].winner,b=ri===0?s.teams[mi*2+1].id:s.rounds[ri-1][mi*2+1].winner;
          if(!g || g.id!==`r${ri}-m${mi}` || g.a!==a || g.b!==b || !['waiting','ready','playing','tie','complete'].includes(g.status) || !Array.isArray(g.results) || g.results.length>100)return false;
          for(let i=0;i<g.results.length;i++) {const r=g.results[i];if(!r || !idOK(r.matchId) || resultIds.has(r.matchId) || !Array.isArray(r.scores) || r.scores.length!==2 || r.scores.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>=1e9) || !int(r.at) || typeof r.signature!=='string' || r.signature.length>30000 || i<g.results.length-1 && r.scores[0]!==r.scores[1])return false;resultIds.add(r.matchId);}
          if(g.status==='waiting') {if(a&&b || g.boundMatchId!==null || g.results.length || g.winner!==null || g.scores!==null)return false;continue;}
          if(!a||!b||a===b)return false;
          if(g.status==='playing') {playing++;if(!idOK(g.boundMatchId)||boundIds.has(g.boundMatchId)||resultIds.has(g.boundMatchId)||g.winner!==null||g.scores!==null)return false;boundIds.add(g.boundMatchId);}
          else if(g.boundMatchId!==null)return false;
          if(g.status==='complete') {const last=g.results.at(-1);if(!last || last.scores[0]===last.scores[1] || !Array.isArray(g.scores) || JSON.stringify(g.scores)!==JSON.stringify(last.scores) || g.winner!==(last.scores[0]>last.scores[1]?a:b))return false;}
          else if(g.winner!==null || g.scores!==null || g.results.some(r=>r.scores[0]!==r.scores[1]))return false;
          if(g.status==='ready'&&g.results.length || g.status==='tie'&&!g.results.length)return false;
        }
      }
      const champion=s.rounds.at(-1)[0].winner;
      return playing<=1 && s.champion===champion && s.status===(champion?'complete':'active');
    }catch{return false;}
  }
  function standings(s) {
    if(!validate(s))return [];
    return s.teams.map(t=>({...t,wins:games(s).filter(g=>g.winner===t.id).length,played:games(s).filter(g=>g.results.length&&(g.a===t.id||g.b===t.id)).length,champion:s.champion===t.id})).sort((a,b)=>Number(b.champion)-Number(a.champion)||b.wins-a.wins||a.id.localeCompare(b.id));
  }
  function restore(value) {if(!validate(value))throw Error('ملف البطولة غير صالح أو بإصدار غير مدعوم.');return clone(value);}
  return Object.freeze({VERSION,create,validate,restore,nextGame,team,bind,unbind,result,undoResult,standings,signature});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Tournament;
