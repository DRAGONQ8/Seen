/* Arabic knockout lobby. All individual matches use the shared TeamEngine. */
const TournamentUI = (() => {
  'use strict';
  const KEY='seen-khaled-tournament-v1';
  let state=null,board='compact',storageIssue=false,locked=false,recoveryRaw=null,error='',busy=false;
  const deep=x=>JSON.parse(JSON.stringify(x));
  function parse(text) {
    if(typeof text!=='string'||text.length>600000)throw Error('ملف البطولة أكبر من الحجم المسموح.');
    const value=JSON.parse(text,(key,value)=>{if(['__proto__','prototype','constructor'].includes(key))throw Error('مفاتيح غير آمنة في الملف.');return value;});
    if(value?.format!=='seen-khaled-tournament'||value.version!==1||!['compact','classic'].includes(value.board)||!Tournament.validate(value.state))throw Error('صيغة حفظ البطولة غير صالحة.');
    return value;
  }
  const envelope=(s=state)=>({format:'seen-khaled-tournament',version:1,board,state:s});
  function load() {
    try {const raw=localStorage.getItem(KEY);if(raw){try{const saved=parse(raw);state=saved.state;board=saved.board;}catch(e){recoveryRaw=raw;error='تعذّرت قراءة حفظ البطولة. بقي الأصل محفوظًا للاسترداد.';locked=true;}}}
    catch(e){storageIssue=true;error='الحفظ التلقائي للبطولة غير متاح؛ صدّر نسخة قبل إغلاق الصفحة.';}
  }
  function save(next) {
    if(locked)return false;
    if(!Tournament.validate(next)){error='تعذّر التحقق من البطولة؛ لم يتغير الحفظ الحالي.';return false;}
    let raw;
    try {raw=localStorage.getItem(KEY);}
    catch(e){storageIssue=true;state=next;error='النتيجة محفوظة في هذه الصفحة فقط؛ صدّر البطولة قبل إغلاقها.';return true;}
    if(!storageIssue&&raw) {
      let saved;
      try{saved=parse(raw).state;}
      catch(e){locked=true;recoveryRaw=raw;error='تغيّر حفظ البطولة إلى بيانات غير صالحة. بقي الأصل محفوظًا؛ صدّره للاسترداد.';return false;}
      if(!state||saved.id!==state.id||saved.revision!==state.revision){locked=true;error='تغيّرت البطولة في نافذة أخرى. حمّل أحدث حفظ قبل المتابعة.';return false;}
    }
    try {
      const data=JSON.stringify(envelope(next));localStorage.setItem(KEY,data);
      if(localStorage.getItem(KEY)!==data){locked=true;error='تعارض حفظ البطولة. حمّل أحدث نسخة لحماية التأهل.';return false;}
      storageIssue=false;state=next;return true;
    }catch(e){storageIssue=true;state=next;error='النتيجة محفوظة في هذه الصفحة فقط؛ صدّر البطولة قبل إغلاقها.';return true;}
  }
  function mutationError(matchId) {
    if(!state)return '';
    const all=state.rounds.flat(),index=all.findIndex(g=>g.results.some(r=>r.matchId===matchId));
    return index>=0&&all.slice(index+1).some(g=>g.boundMatchId||g.results.length)?'بدأت مواجهة لاحقة في البطولة؛ لا يمكن تعديل نتيجة تأهل سابقة.':
      locked&&ownsMatch(matchId)?'حفظ البطولة متعارض. حمّل أحدث حفظ قبل تعديل هذه المباراة.':'';
  }
  function enter() {window.SeenTeamUI?.pause();route='tournament';render();window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main')?.focus({preventScroll:true});}
  function ownsMatch(id) {return !!state&&state.rounds.flat().some(g=>g.boundMatchId===id||g.results.some(r=>r.matchId===id));}
  function screen() {
    const notice=error?`<section class="inline-note warning" role="status">${esc(error)} ${locked?'<button class="btn secondary" data-tournament-action="reload">تحميل أحدث حفظ</button>':''}</section>`:'';
    if(!state)return `${notice}<section class="panel stack"><span class="eyebrow">فرق أكثر · محرك واحد</span><h1>بطولة الأصدقاء</h1><p>خروج مغلوب بين 2 أو 4 أو 8 فرق. يتأهل الفائز بكل مباراة إلى الدور التالي.</p><form id="tournament-setup" class="stack"><label for="cup-teams">أسماء الفرق · كل فريق في سطر</label><textarea id="cup-teams" name="teams" rows="8" maxlength="300" required placeholder="الصقور\nالأسود\nالنجوم\nالأبطال"></textarea><label for="cup-board">طول المباراة</label><select id="cup-board" name="board"><option value="compact">سريعة · 18 سؤالًا</option><option value="classic">كلاسيكية · 36 سؤالًا</option></select><p class="muted">عند التعادل تُلعب مباراة سريعة إضافية من 18 سؤالًا بين الفريقين نفسيهما، وتتكرر عند استمرار التعادل. لا يتأهل فريق بالقرعة أو بالاسم.</p><button class="btn primary" ${locked?'disabled':''}>إنشاء البطولة</button></form><div class="match-controls"><button class="btn secondary" data-tournament-action="import">استيراد بطولة</button>${recoveryRaw?'<button class="btn secondary" data-tournament-action="recovery">تصدير الحفظ الأصلي</button><button class="btn secondary" data-tournament-action="clear-corrupt">بدء حفظ جديد</button>':''}</div></section>`;
    const current=Tournament.nextGame(state),match=window.SeenTeamUI?.match,bound=current?.boundMatchId,hasMatch=bound&&match?.id===bound,complete=hasMatch&&match.state==='MATCH_COMPLETE'&&match.board.every(t=>t.done),champion=Tournament.team(state,state.champion);
    return `${notice}<div class="section-heading"><div><span class="eyebrow">بطولة خروج مغلوب · ${state.teams.length} فرق</span><h1>${champion?'الكأس لـ '+esc(champion.name):'الطريق إلى الكأس'}</h1><p class="muted">${board==='classic'?'36':'18'} سؤالًا للمباراة. التعادل: مباراة سريعة إضافية من 18 سؤالًا حتى يُحسم التأهل.</p></div></div><section class="tournament-bracket" aria-label="جدول البطولة">${state.rounds.map((round,ri)=>`<section class="panel stack"><h2>${ri===state.rounds.length-1?'النهائي':ri===state.rounds.length-2?'نصف النهائي':'الدور الأول'}</h2>${round.map(g=>`<article class="cup-game ${current?.id===g.id?'cup-current':''}"><div>${[g.a,g.b].map((id,i)=>`<p class="${id===g.winner?'cup-winner':''}"><span>${esc(Tournament.team(state,id)?.name||'بانتظار المتأهل')}</span><b dir="ltr">${g.scores?num(g.scores[i]):'—'}</b></p>`).join('')}</div><small>${({waiting:'بانتظار التأهل',ready:'جاهزة للعب',playing:'المباراة محفوظة',tie:'تعادل · مباراة إضافية',complete:'تأهل الفائز'})[g.status]}${g.results.length>1?' · '+g.results.length+' مباريات':''}</small></article>`).join('')}</section>`).join('')}</section>${current?`<section class="panel stack"><h2>${esc(Tournament.team(state,current.a).name)} × ${esc(Tournament.team(state,current.b).name)}</h2>${bound?(hasMatch?`<button class="btn primary" data-tournament-action="resume">${complete?'عرض النتيجة':'متابعة المباراة'}</button>${complete?'<button class="btn primary" data-tournament-action="accept">اعتماد النتيجة والتأهل</button>':''}`:'<p class="warning">ملف المباراة المرتبطة غير مفتوح. استعد حفظ المباراة من سجل الفريقين، أو أعد المباراة من البداية.</p>'):`<button class="btn primary" data-tournament-action="play" ${locked?'disabled':''}>${current.status==='tie'?'ابدأ مباراة كسر التعادل · 18 سؤالًا':'ابدأ المباراة'}</button>`}${bound&&!complete?'<button class="btn secondary" data-tournament-action="restart">إعادة المباراة من البداية</button>':''}<p class="muted">لا تُعتمد النتيجة إلا بعد إكمال جميع الأسئلة. يظل تصحيح الحكم متاحًا قبل اعتماد التأهل.</p></section>`:'<section class="panel stack"><h2>🏆 بطل البطولة: '+esc(champion?.name||'')+'</h2><p>اكتملت جميع الأدوار.</p></section>'}<section class="panel stack"><h2>ترتيب الفرق</h2><table class="cup-standings"><thead><tr><th scope="col">الفريق</th><th scope="col">المواجهات</th><th scope="col">الفوز</th></tr></thead><tbody>${Tournament.standings(state).map(t=>`<tr><th scope="row">${t.champion?'🏆 ':''}${esc(t.name)}</th><td>${t.played}</td><td>${t.wins}</td></tr>`).join('')}</tbody></table></section><div class="match-controls"><button class="btn secondary" data-tournament-action="export">تصدير البطولة</button><button class="btn secondary" data-tournament-action="import">استيراد بطولة</button><button class="btn secondary" data-tournament-action="new">بطولة جديدة</button></div>`;
  }
  function configForGame(game) {
    const config=TeamEngine.defaults();config.board=game.results.length?'compact':board;config.mode='teams';config.timer=false;
    const seenCats=new Set(),categories=CATEGORIES.filter(cat=>[200,400,600].every(value=>TeamEngine.eligibleQuestions(QUESTION_BANK,config,{category:cat.id,value}).length>=(config.board==='classic'?2:1))).map(c=>c.id);
    if(categories.length<6)throw Error('لا تتوفر 6 فئات مدققة لهذه اللوحة. اختر مباراة سريعة أو راجع المحتوى.');
    const preferred=window.SeenTeamUI?.store?.preferred?.teams?.flatMap(t=>t.categories)||config.teams.flatMap(t=>t.categories);
    const selected=[...preferred,...categories].filter(id=>categories.includes(id)&&!seenCats.has(id)&&seenCats.add(id)).slice(0,6);
    config.teams.forEach((t,i)=>{t.name=Tournament.team(state,i?game.b:game.a).name;t.categories=selected.slice(i*3,i*3+3);});return config;
  }
  async function guarded(fn) {
    if(busy)return;busy=true;
    try {if(navigator.locks?.request)await navigator.locks.request(KEY,{mode:'exclusive'},fn);else await fn();}
    catch(e){toast(/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذّرت متابعة البطولة. بقي الحفظ الحالي كما هو.');}
    finally{busy=false;if(route==='tournament')render();}
  }
  function play() {
    if(locked)throw Error('حمّل أحدث حفظ للبطولة قبل المتابعة.');
    const game=Tournament.nextGame(state);if(!game||game.boundMatchId)return;
    const config=configForGame(game),match=window.SeenTeamUI.startConfiguredMatch(config);
    if(!match || match.state==='MATCH_COMPLETE' || match.teams[0].name!==config.teams[0].name || match.teams[1].name!==config.teams[1].name)throw Error('أكمل المباراة الجارية أو صدّرها وأنهِها قبل بدء مواجهة البطولة.');
    if(!save(Tournament.bind(state,game.id,match.id)))throw Error(error);
  }
  function download(data,name) {
    const text=typeof data==='string'?data:JSON.stringify(data,null,2),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function confirm(title,text,fn) {openDialog(title,`<p>${text}</p>`,'<button class="btn primary" id="cup-confirm">متابعة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>');document.querySelector('#cup-confirm').addEventListener('click',()=>{closeDialog();guarded(fn);},{once:true});}
  function sync(match) {
    if(!state||!match||locked)return;
    const accepted=state.rounds.flat().find(g=>g.results.some(r=>r.matchId===match.id));
    if(accepted){const result=accepted.results.find(r=>r.matchId===match.id);if(result.signature!==Tournament.signature(match)){error='تغيّر حكم مباراة معتمدة. راجع التأهل قبل بدء مواجهة أخرى.';try{const next=Tournament.undoResult(state,accepted.id);if(save(next))error='أُلغي اعتماد التأهل بعد تعديل الحكم. اعتمد النتيجة الصحيحة من البطولة.';}catch(e){locked=true;error=e.message+' احتُفظ بجدول البطولة؛ صدّره للمراجعة.';}}}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-tournament-action]');if(!b||b.disabled)return;const action=b.dataset.tournamentAction;
    if(action==='open'||action==='return'){enter();return;}
    if(action==='reload'){location.reload();return;}
    if(action==='resume'){window.SeenTeamUI.go('teamMatch');return;}
    if(action==='export'){if(state)download(envelope(),`seen-tournament-${state.id}.json`);return;}
    if(action==='recovery'){if(recoveryRaw)download(recoveryRaw,'seen-tournament-recovery.json');return;}
    if(action==='play'){guarded(play);return;}
    if(action==='accept'){guarded(()=>{const game=Tournament.nextGame(state),match=window.SeenTeamUI.match;if(!game)return;if(save(Tournament.result(state,game.id,match)))toast(state.status==='complete'?'اكتملت البطولة!':Tournament.nextGame(state)?.status==='tie'?'تعادل؛ العب مباراة إضافية.':'اعتُمد التأهل.');});return;}
    if(action==='restart'){confirm('إعادة مواجهة البطولة؟','لن تُحذف نتائج المباريات المكتملة. ستبدأ لوحة جديدة لهذه المواجهة؛ لا تُعتمد نتيجتها السابقة.',()=>{const game=Tournament.nextGame(state);if(!game?.boundMatchId)return;if(save(Tournament.unbind(state,game.id,game.boundMatchId)))toast('يمكن بدء مواجهة جديدة بعد إنهاء المباراة القديمة من قائمة المقدم.');});return;}
    if(action==='new'){confirm('بدء بطولة جديدة؟','ستُستبدل البطولة الحالية. صدّرها أولًا إذا أردت الاحتفاظ بجدولها؛ تبقى مباريات الفريقين في سجلها.',()=>{if(locked)throw Error(error);localStorage.removeItem(KEY);state=null;error='';});return;}
    if(action==='clear-corrupt'){confirm('بدء حفظ جديد؟','ستُحفظ نسخة أصلية للاسترداد قبل إنشاء بطولة جديدة.',()=>{localStorage.setItem(KEY+'-recovery',recoveryRaw);localStorage.removeItem(KEY);locked=false;state=null;error='';});return;}
    if(action==='import') {const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;if(file.size>600000)throw Error('ملف البطولة أكبر من الحجم المسموح.');const incoming=parse(await file.text());confirm('استعادة بطولة محفوظة؟','سيُستبدل جدول البطولة الحالي بعد التحقق. لا تتغير مباريات الفريقين أو سجلها. يحتاج استئناف مواجهة جارية إلى ملف حفظ المباراة أيضًا.',()=>{if(locked)throw Error(error);const previousBoard=board;board=incoming.board;if(save(Tournament.restore(incoming.state))){error='استُعيد جدول البطولة. صدّر حفظ المباراة أيضًا عند نقل مواجهة جارية.';}else board=previousBoard;});}catch(err){toast(/[\u0600-\u06ff]/.test(err.message)?err.message:'تعذّرت قراءة ملف البطولة؛ لم يتغير الحفظ.');}},{once:true});input.click();}
  });
  document.addEventListener('submit',e=>{if(e.target.id!=='tournament-setup')return;e.preventDefault();const form=new FormData(e.target);guarded(()=>{if(locked)throw Error(error);const names=String(form.get('teams')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);board=form.get('board')==='classic'?'classic':'compact';if(save(Tournament.create(names,{id:'cup-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)})))toast('البطولة جاهزة.');});});
  window.addEventListener('seen-match-change',e=>sync(e.detail?.match));
  window.addEventListener('storage',e=>{if(e.key===KEY&&!locked){locked=true;error='تغيّرت البطولة في نافذة أخرى. حمّل أحدث حفظ لحماية التأهل.';if(route==='tournament')render();}});
  load();
  return Object.freeze({screen,ownsMatch,mutationError,sync,get state(){return state?deep(state):null;}});
})();
window.SeenTournamentUI=TournamentUI;
