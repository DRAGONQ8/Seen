'use strict';
/* Multiplayer application shell. Rules and host state live in TeamEngine/TeamUI. */
const APP_VERSION=4, STORAGE_KEY='seen-khaled-preferences-v4';
const DEFAULT_PREFS={theme:'dark',accent:'gold',sound:0,music:0,motion:'subtle',reduced:false,images:true,textSize:100,repetition:'recent',questionHistoryResetAt:0};
let prefs={...DEFAULT_PREFS},progress={profile:{favorites:['anime','football','geo','games']},seen:{}},route='home',storageAvailable=true,audioContext=null,toastHandle=null,lastFocus=null;
const QUESTION_MAP=new Map(QUESTION_BANK.map(q=>[q.id,q]));
let migration={from:null,version:4},preferencesProtected=false;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Math.round(Number(n)||0).toLocaleString('en-US');
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function shuffled(items,rng=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function normalizeArabic(s){return String(s).normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
const defaultAnime=()=>({selected:TeamEngine.FRANCHISES.map(f=>f.id),levels:Object.fromEntries(TeamEngine.FRANCHISES.map(f=>[f.id,1]))});
function validateBank(bank){const errors=[],ids=new Set(),texts=new Set();for(const q of bank){if(!q.id||ids.has(q.id))errors.push('معرّف مكرر');ids.add(q.id);const text=normalizeArabic(q.q);if(texts.has(text))errors.push('سؤال مكرر');texts.add(text);if(!catById(q.category)||![1,2,3,4].includes(q.level)||!Array.isArray(q.options)||q.options.length!==4||new Set(q.options.map(normalizeArabic)).size!==4||!Number.isInteger(q.answer)||q.answer<0||q.answer>3||!q.explanation||!q.source?.title||!q.source?.reference||(q.source?.url?safeURL(q.source.url)==='#':!q.source?.bibliography?.trim())||!q.sub||!q.tags||![1,2,3,4].includes(q.version))errors.push(`بيانات غير مكتملة: ${q.id}`);if(q.image&&!VISUALS[q.image])errors.push(`صورة غير موجودة: ${q.id}`);if(/[٠-٩۰-۹]/.test(q.q+q.options.join('')+q.explanation+q.source.reference))errors.push(`أرقام غير مدعومة: ${q.id}`);}return errors;}
function parseSafeJSON(text,max=1500000){if(typeof text!=='string'||text.length>max)throw Error('الملف أكبر من الحجم المسموح.');return JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('الملف يحتوي على مفاتيح غير آمنة.');return value;});}
function encodeMatchBackup(kind,data){
if(!['teams'].includes(kind))throw Error('نوع نسخة الاستئناف غير صالح.');
const text=JSON.stringify(data);parseSafeJSON(text,20000000);
const bytes=new TextEncoder().encode(text);if(bytes.length>20000000)throw Error('نسخة الاستئناف أكبر من الحجم المسموح.');let binary='';
for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
const payload=btoa(binary);if(payload.length>28000000)throw Error('نسخة الاستئناف أكبر من الحجم المسموح.');
return {format:'seen-khaled-resume',version:1,kind,encoding:'base64-utf8',payload};
}
function decodeMatchBackup(envelope,expectedKind){
if(!envelope||envelope.format!=='seen-khaled-resume'||envelope.version!==1||envelope.encoding!=='base64-utf8'||!['teams'].includes(envelope.kind)||expectedKind&&envelope.kind!==expectedKind||Object.keys(envelope).some(key=>!['format','version','kind','encoding','payload'].includes(key))||typeof envelope.payload!=='string'||!envelope.payload.length||envelope.payload.length>28000000||envelope.payload.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.payload))throw Error('نسخة الاستئناف غير صالحة أو لا تطابق هذا النمط.');
let text;try{const binary=atob(envelope.payload);if(btoa(binary)!==envelope.payload)throw Error();if(binary.length>20000000)throw Error();text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));}catch{throw Error('تعذّرت قراءة بيانات نسخة الاستئناف.');}
return parseSafeJSON(text,20000000);
}
function validInt(n,max=1e9){return Number.isInteger(n)&&n>=0&&n<=max;}
function cleanName(value,fallback='خالد'){return String(value||'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,24)||fallback;}
const AVATARS=['🦁','🦉','🐉','🦅','🐺','🚀','🌙','🎮'];
function validatedAnime(value){const ids=TeamEngine.FRANCHISES.map(f=>f.id);if(!value||!Array.isArray(value.selected)||value.selected.some(id=>!ids.includes(id))||new Set(value.selected).size!==value.selected.length||!value.levels||ids.some(id=>![1,2,3].includes(value.levels[id])))throw Error('تفضيلات حرق الأنمي غير صالحة.');return {selected:[...value.selected],levels:Object.fromEntries(ids.map(id=>[id,value.levels[id]]))};}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastHandle);toastHandle=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function tone(freq,duration=.12,type='sine',volume=1,delay=0){if(!audioContext||!prefs.sound)return;const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime+delay;o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.09*(prefs.sound/100)*volume,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(audioContext.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(t);o.stop(t+duration+.02);}
function sound(kind){if(kind==='correct'){tone(523,.17);tone(659,.22,'sine',1,.1);tone(784,.3,'sine',1,.2);}else if(kind==='wrong'){tone(220,.2,'triangle');tone(165,.3,'triangle',.7,.13);}else if(kind==='tick')tone(440,.05,'sine',.3);else tone(560,.045,'sine',.2);}
function confetti(){if(document.documentElement.dataset.motion==='none')return;const el=$('#confetti');el.innerHTML=Array.from({length:prefs.motion==='full'?28:12},(_,i)=>`<span style="--x:${Math.random()*100}%;--delay:${i*.025}s;--color:${['#eac57e','#80cff5','#c5a8fb','#7cdec1'][i%4]};--rotate:${Math.random()*360}deg"></span>`).join('');setTimeout(()=>el.replaceChildren(),2400);}
function title(eyebrow,heading,desc=''){return `<div class="section-heading page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1>${desc?`<p>${desc}</p>`:''}</div></div>`;}
function stat(ic,value,label){return `<div class="stat-card"><span class="stat-icon">${icon(ic)}</span><div><strong>${value}</strong><small>${label}</small></div></div>`;}
function questionAlt(q,revealed=false){return revealed?(VISUALS[q.image]?.alt||'دليل السؤال البصري'):'دليل بصري للسؤال؛ الوصف التعريفي متاح بعد الإجابة.';}
function safeHint(q){const hint=q.hint||'',normalized=normalizeArabic(hint),answers=[q.correctAnswer||q.options[q.answer],...(q.acceptedAnswers||[])].map(normalizeArabic).filter(Boolean);return hint&&!answers.some(a=>a.length===1?normalized.split(' ').includes(a):normalized.includes(a))?hint:'فكّر في سياق السؤال واستبعد الخيارات التي تنتمي إلى موضوع مختلف.';}
function safeURL(url){try{if(typeof url!=='string'||/[\u0000-\u0020\u007f]/.test(url))return '#';const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'#';}catch{return '#';}}
function selectPref(id,label,options){return `<div class="field"><label for="pref-${id}">${label}</label><select id="pref-${id}" data-pref="${id}">${options.map(([value,text,disabled])=>`<option value="${value}" ${String(prefs[id])===String(value)?'selected':''} ${disabled?'disabled':''}>${text}</option>`).join('')}</select></div>`;}
function togglePref(id,label){return `<label class="toggle-row" for="pref-${id}"><span>${label}</span><input id="pref-${id}" type="checkbox" data-pref="${id}" ${prefs[id]?'checked':''}></label>`;}
function openDialog(heading,body,actions=''){lastFocus=document.activeElement;const d=$('#dialog');d.innerHTML=`<div class="modal"><div class="dialog-head"><h2>${heading}</h2><button class="icon-btn" data-action="close-dialog" aria-label="إغلاق">${icon('close')}</button></div><div class="dialog-body">${body}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}</div>`;if(!d.open)d.showModal();d.querySelector('button, input')?.focus();}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('الشاشة الكاملة غير متاحة هنا. يمكنك اللعب بالعرض الحالي.');}catch{toast('تعذّر تفعيل ملء الشاشة. اللعبة متاحة بالعرض الحالي.');}}
function downloadLocalSave(data,filename){
const text=typeof data==='string'?data:JSON.stringify(data,null,2);
try{
const a=document.createElement('a');
if(typeof Blob!=='function'||typeof URL.createObjectURL!=='function'||!('download'in a))throw Error();
const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);return true;
}catch{
openDialog('نسخة حفظ يدوية',`<p>هذا المتصفح لا يتيح التنزيل المباشر هنا. انسخ النص واحتفظ به خارج اللعبة، ثم استخدم «استيراد من نص» لاستعادته. ويمكن حفظه في ملف باسم <b dir="ltr">${esc(filename)}</b>.</p><label for="manual-save-text">بيانات نسخة الحفظ</label><textarea id="manual-save-text" dir="ltr" readonly spellcheck="false">${esc(text)}</textarea>`,'<button class="btn primary" data-action="copy-save">نسخ بيانات الحفظ</button>');return false;
}
}
async function copyManualSave(){const input=$('#manual-save-text');if(!input)return;input.focus();input.select();try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(input.value);toast('نُسخت بيانات الحفظ. احتفظ بها خارج اللعبة لاستيرادها لاحقًا.');}catch{toast('النص محدد؛ اضغط مطولًا واختر نسخ، ثم احتفظ به خارج اللعبة.');}}
function pasteLocalSave(onFile){
if(typeof onFile!=='function')return;
window.SeenTeamUI?.pause();openDialog('استيراد من نص','<p>الصق بيانات نسخة الحفظ التي صدّرتها اللعبة. تُفحص البيانات قبل عرض تأكيد الاستيراد؛ تبقى جولتك الحالية محفوظة حتى تعتمد النسخة.</p><label for="paste-save-text">بيانات نسخة الحفظ</label><textarea id="paste-save-text" dir="ltr" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>','<button class="btn primary" id="prepare-pasted-save">فحص النسخة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>');
const input=$('#paste-save-text'),button=$('#prepare-pasted-save');input.focus();let pending=false;
button.addEventListener('click',async()=>{if(pending)return;const text=input.value;if(!text.trim()){toast('الصق بيانات نسخة الحفظ أولًا.');input.focus();return;}if(text.length>28100000){toast('بيانات الحفظ أكبر من الحجم المسموح.');return;}const size=new TextEncoder().encode(text).length;if(size>28100000){toast('بيانات الحفظ أكبر من الحجم المسموح.');return;}pending=true;button.disabled=true;try{await onFile({name:'seen-pasted-save.json',size,text:async()=>text});}catch{toast('تعذّر استيراد النص. تبقى الجولة الحالية دون تغيير.');}finally{pending=false;if(button.isConnected)button.disabled=false;}});
}

/* Versioned allowlist migration: the old envelope is retained untouched. Only
   shared preferences, favorites and seen IDs are read. Removed game state and
   statistics cannot be restored or imported into a team match. */
function readPreferences(data,legacy=false){
  if(!data||typeof data!=='object'||(!legacy&&data.version!==4))throw Error('إصدار التفضيلات غير مدعوم.');
  const raw=data.prefs||{},next={...DEFAULT_PREFS};
  for(const [key,allowed] of Object.entries({theme:['dark','light'],accent:['gold','violet'],motion:['none','subtle','full'],repetition:['recent','unseen','all']}))if(allowed.includes(raw[key]))next[key]=raw[key];
  if(validInt(raw.sound,100))next.sound=raw.sound;
  if([90,100,115,130].includes(raw.textSize))next.textSize=raw.textSize;
  for(const key of ['reduced','images'])if(typeof raw[key]==='boolean')next[key]=raw[key];
  if(validInt(raw.questionHistoryResetAt,1e14))next.questionHistoryResetAt=raw.questionHistoryResetAt;
  if(raw.anime){try{next.anime=validatedAnime(raw.anime);}catch{next.anime=defaultAnime();}}
  const incoming=data.progress||{},favorites=incoming.profile?.favorites;
  const seen={};
  if(incoming.seen&&typeof incoming.seen==='object'&&!Array.isArray(incoming.seen))for(const [id,at]of Object.entries(incoming.seen))if(QUESTION_MAP.has(id)&&validInt(at,1e14))seen[id]=at;
  return {prefs:next,progress:{profile:{favorites:Array.isArray(favorites)?[...new Set(favorites.filter(id=>catById(id)))]:[...progress.profile.favorites]},seen}};
}
function load(){
  let raw=null;
  try{
    raw=localStorage.getItem(STORAGE_KEY);
    if(raw){const data=parseSafeJSON(raw,3000000),clean=readPreferences(data);prefs=clean.prefs;progress=clean.progress;migration=data.migration||migration;}
    else{
      const legacy=localStorage.getItem('seen-khaled-v1');
      if(legacy){const clean=readPreferences(parseSafeJSON(legacy,5000000),true);prefs=clean.prefs;progress=clean.progress;migration={from:'seen-khaled-v1',version:4,legacyRetired:true};persist();}
    }
  }catch{
    storageAvailable=false;
    if(raw){
      try{localStorage.setItem(STORAGE_KEY+'-recovery',raw);}catch{preferencesProtected=true;}
    }
  }
  applyPrefs();
}
function persist(){
  if(preferencesProtected)return false;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:4,prefs,progress,migration}));storageAvailable=true;return true;}
  catch{storageAvailable=false;return false;}
}
function applyPrefs(){
  const root=document.documentElement;
  root.dataset.theme=prefs.theme;root.dataset.accent=prefs.accent;
  root.dataset.motion=prefs.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches?'none':prefs.motion;
  root.style.setProperty('--text-scale',prefs.textSize/100);
  document.querySelector('meta[name=theme-color]').content=prefs.theme==='light'?'#f2f3f8':'#090d1e';
}
function unlockAudio(){
  if(!prefs.sound)return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  try{if(!audioContext)audioContext=new Audio();if(audioContext.state==='suspended')audioContext.resume().catch(()=>toast('تعذّر تشغيل الصوت. يمكنك متابعة اللعب.'));}
  catch{toast('الصوت غير متاح في هذا المتصفح.');}
}
function closeDialog(){const d=$('#dialog');if(d.open)d.close();if(lastFocus?.isConnected)lastFocus.focus();}
function hasActiveTrivia(){const m=window.SeenTeamUI?.match;return !!(m&&m.state!=='MATCH_COMPLETE');}
function isAnswerProtected(id){const m=window.SeenTeamUI?.match;return !!(m&&m.state!=='MATCH_COMPLETE'&&m.board.some(t=>t.questionId===id&&!t.done)&&!(m.current?.questionId===id&&m.current.revealed));}
const ROUTES=new Set(['home','categories','settings','teamSetup','teamMatch','teamHistory','library','tournament']);
function navigate(to){
  if(route==='teamMatch'&&to!=='teamMatch')window.SeenTeamUI?.pause();
  route=ROUTES.has(to)?to:'home';render();window.scrollTo({top:0,behavior:'instant'});$('#main').focus({preventScroll:true});
}
function shell(){
  const nav=[['home','home','الرئيسية'],['categories','globe','الفئات'],['teamHistory','history','المباريات'],['settings','settings','الإعدادات']];
  const links=()=>nav.map(([id,ic,label])=>`<button class="nav-link ${route===id?'active':''}" data-action="nav" data-route="${id}" ${route===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span></button>`).join('');
  $('#sidebar').innerHTML=`<div class="sidebar-label">المعرفة تجمعنا</div>${links()}<button class="nav-link" data-action="nav" data-route="tournament">${icon('flag')}<span>البطولة</span></button><div class="sidebar-bottom"><span class="pill">${icon('shield')} دون إنترنت</span><button class="nav-link" data-action="help">${icon('help')}<span>دليل اللعب</span></button><button class="nav-link" data-action="about">${icon('book')}<span>المحتوى والتراخيص</span></button><p class="footer-note">سين جيم خالد<br>مواجهة جميلة، ومعرفة جديدة.</p></div>`;
  $('#bottom-nav').innerHTML=links();
  $('#header-actions').innerHTML=`<button class="icon-btn" data-action="mute" aria-label="${prefs.sound?'كتم الصوت':'تشغيل الصوت'}" aria-pressed="${!prefs.sound}">${prefs.sound?icon('sound'):'🔇'}</button><button class="icon-btn" data-action="fullscreen" aria-label="ملء الشاشة">${icon('expand')}</button><button class="icon-btn" data-action="theme" aria-label="تبديل المظهر">${prefs.theme==='dark'?'☀':'☾'}</button>`;
}
function render(){
  if(!ROUTES.has(route))route='home';
  document.documentElement.dataset.teamPlay=route==='teamMatch'?'true':'false';
  document.documentElement.dataset.teamMotion=route==='teamMatch'&&window.SeenTeamUI?.match?.config.animations===false?'none':'auto';
  const focused=document.activeElement?.id,open=$$('details[id][open]').map(el=>el.id);
  shell();
  const screens={home:renderHome,categories:renderCategories,settings:renderSettings,teamSetup:()=>window.SeenTeamUI?.setupScreen()||'',teamMatch:()=>window.SeenTeamUI?.matchScreen()||'',teamHistory:()=>window.SeenTeamUI?.historyScreen()||'',library:()=>window.SeenTeamUI?.libraryScreen()||'',tournament:()=>window.SeenTournamentUI?.screen()||'<p>تعذّر تحميل البطولة. أعد فتح الملف.</p>'};
  $('#main').innerHTML=`<div class="page">${screens[route]()}</div>`;
  for(const id of open)document.getElementById(id)?.setAttribute('open','');
  if(route==='teamMatch')window.SeenTeamUI?.startTicker();
  if(focused&&focused!=='main')document.getElementById(focused)?.focus({preventScroll:true});
}
function renderHome(){
  return `<section class="multiplayer-hero"><div><span class="eyebrow">سين جيم خالد · المعرفة تجمعنا</span><h1>اجمع فريقك.<br><span>لحظة الفوز تبدأ هنا.</span></h1><p>اختاروا الفئات، افتحوا السؤال، واحسموا الإجابة بلمسة. منافسة عربية لفريقين على جهاز واحد، تعمل بالكامل دون إنترنت.</p><div class="hero-actions"><button class="btn primary" data-team-action="quick-start">ابدأ الآن ${icon('play')}</button><button class="btn secondary" data-team-action="new">اختيار الفرق والفئات</button></div><div class="hero-facts"><span>6 فئات</span><span>18 أو 36 سؤالًا</span><span>حفظ تلقائي</span></div></div><div class="hero-emblem" aria-hidden="true">${HERO_ART}</div></section>${window.SeenTeamUI?.homeAddon()||''}<section class="panel tournament-invite row"><div><span class="eyebrow">للمنافسة حكاية أطول</span><h2>بطولة الفرق</h2><p class="muted">مباريات متتابعة، تأهل واضح، وبطل واحد.</p></div><button class="btn secondary" data-action="nav" data-route="tournament">افتح البطولة ${icon('flag')}</button></section>`;
}
function renderCategories(){
  const config=TeamEngine.defaults();
  return `${title('اختيارات تستحق اللعب','عوالم المعرفة','الفئات المتاحة تحقق عدد الأسئلة المدققة المطلوب لكل مستوى. اختر ست فئات في ردهة المباراة.')}<div class="category-grid">${CATEGORIES.map(c=>{const pool=TeamEngine.eligibleQuestions(QUESTION_BANK,config,{category:c.id}),counts=[200,400,600].map(v=>pool.filter(q=>q.points===v).length),available=counts.every(n=>n>=2);return `<section class="category-card" style="--accent:${c.color}"><div class="category-art">${categoryArt(c.id)}</div><div class="category-info"><span class="category-kicker">${c.label}</span><h2>${c.name}</h2><p>${pool.length} سؤالًا مدققًا</p><small dir="auto">200: ${counts[0]} · 400: ${counts[1]} · 600: ${counts[2]}</small><p class="muted">${available?'متاحة للمباراة الكلاسيكية':'المخزون لا يكفي للوحة كلاسيكية بعد الفلترة'}</p><button class="btn secondary small" data-action="favorite" data-id="${c.id}" aria-pressed="${progress.profile.favorites.includes(c.id)}">${progress.profile.favorites.includes(c.id)?'★ ضمن المفضلة':'☆ أضف للمفضلة'}</button></div></section>`;}).join('')}</div><div class="row"><button class="btn primary" data-team-action="new">اختر فئات المباراة</button><button class="btn secondary" data-team-action="library">مكتبة الأسئلة والمصادر</button></div>`;
}
function renderSettings(){
  return `${title('على راحتكم','الإعدادات','إعدادات المباراة والمساعدات متاحة من ردهة الفرق.')}<div class="settings-grid"><section class="panel stack"><h2>العرض والقراءة</h2>${selectPref('theme','المظهر',[['dark','ليلي'],['light','نهاري']])}${selectPref('textSize','حجم النص',[[90,'90%'],[100,'100%'],[115,'115%'],[130,'130%']])}${selectPref('motion','الحركة',[['none','متوقفة'],['subtle','هادئة'],['full','كاملة']])}${togglePref('reduced','تقليل الحركة دائمًا')}${togglePref('images','عرض صور الأسئلة')}<p class="muted">تحترم اللعبة إعداد تقليل الحركة في الجهاز.</p></section><section class="panel stack"><h2>الصوت والشاشة</h2><label for="pref-sound">المؤثرات الصوتية · ${prefs.sound}%</label><input id="pref-sound" type="range" min="0" max="100" data-pref="sound" value="${prefs.sound}"><button class="btn secondary" data-action="test-sound">تجربة الصوت</button><button class="btn secondary" data-action="fullscreen">ملء الشاشة</button><p class="muted">مؤثرات توليدية أصلية. يبدأ الصوت بعد تفاعلك فقط. ملء الشاشة بحسب دعم المتصفح.</p></section><section class="panel stack"><h2>الحفظ واستعادة المباريات</h2><p class="muted">${storageAvailable?'التفضيلات محفوظة محليًا على هذا الجهاز.':'تعذّر حفظ التفضيلات تلقائيًا. تبقى اللعبة متاحة في هذه الصفحة.'} لحماية تقدمك، صدّر نسخة متابعة قبل نقل الملف أو مسح بيانات المتصفح.</p><button class="btn secondary" data-team-action="backup">تصدير تقدم الفريقين</button><button class="btn secondary" data-team-action="restore">استيراد تقدم الفريقين</button><button class="btn secondary" data-team-action="paste-backup">استيراد من نص</button><button class="btn secondary" data-action="reset-seen">بدء دورة جديدة للأسئلة</button><p class="muted">دورة الأسئلة الجديدة تسمح بالتكرار دون حذف سجل المباريات أو النتائج أو تغيير اللوحة الجارية.</p></section><section class="panel stack"><h2>المحتوى والمساعدة</h2><button class="btn secondary" data-team-action="library">مكتبة الأسئلة</button><button class="btn secondary" data-action="help">دليل اللعب</button><button class="btn secondary" data-action="about">المصادر والتراخيص</button></section></div>`;
}
function showAbout(){
  window.SeenTeamUI?.pause();
  const checked=QUESTION_BANK.filter(q=>q.verification?.status==='source-checked').length;
  openDialog('المحتوى والتراخيص',`<div class="stack"><p>سين جيم خالد · الإصدار 4 · ${QUESTION_BANK.length} سؤالًا في ${CATEGORIES.length} فئات؛ ${checked} سؤالًا يحمل توثيق مراجعة بمصدر. تستخدم المباريات الجديدة الأسئلة المدققة فقط، بحسب الفلاتر والمخزون.</p><p>المراجع اختيارية للقراءة على الإنترنت. لا تحتاج اللعبة إلى اتصال. لا تعني إحالة المصدر وحدها أنه جرت مراجعته؛ يبقى المحتوى غير المتحقق خارج المباريات الجديدة.</p><p>رسوم الفئات أصلية ورمزية. الخرائط من Natural Earth؛ تعرض رخصة كل صورة وإسنادها بعد كشف الإجابة. لا توجد صور للأنبياء. المؤثرات والرسوم الأصلية متاحة وفق CC0-1.0.</p><p>يحفظ التطبيق البيانات محليًا فقط. نسخة متابعة المقدم قد تستخدم Base64 للترميز، وهو ليس تشفيرًا؛ احتفظ بها للمقدم.</p><p>خط Noto Sans Arabic مضمن وفق SIL Open Font License 1.1.</p><details><summary>رخصة الخط</summary><pre class="license-text" dir="ltr">${esc(FONT_LICENSE)}</pre></details><p>المنتج النهائي هو ملف index.html. لا خادم ولا حساب ولا خدمة مطلوبة للعب.</p></div>`);
}
function requestQuestionHistoryReset(){
  window.SeenTeamUI?.pause();
  openDialog('بدء دورة جديدة للأسئلة؟','<p>يمكن ظهور الأسئلة السابقة مجددًا. تبقى نتائج الفريقين وسجل المباريات واللوحة الجارية محفوظة.</p>','<button class="btn primary" id="confirm-reset-seen">ابدأ دورة جديدة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>');
  $('#confirm-reset-seen').addEventListener('click',()=>{progress.seen={};prefs.questionHistoryResetAt=Date.now();persist();closeDialog();render();toast('بدأت دورة جديدة؛ بقي سجل المباريات محفوظًا.');},{once:true});
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
  const action=b.dataset.action;
  if(action==='nav')navigate(b.dataset.route);
  else if(action==='close-dialog')closeDialog();
  else if(action==='fullscreen')fullscreen();
  else if(action==='theme'){prefs.theme=prefs.theme==='dark'?'light':'dark';applyPrefs();persist();render();}
  else if(action==='mute'){prefs.sound=prefs.sound?0:45;persist();unlockAudio();render();}
  else if(action==='test-sound'){unlockAudio();sound('correct');}
  else if(action==='help')window.SeenTeamUI?.rules();
  else if(action==='about')showAbout();
  else if(action==='reset-seen')requestQuestionHistoryReset();
  else if(action==='copy-save')copyManualSave();
  else if(action==='favorite'&&catById(b.dataset.id)){const id=b.dataset.id;progress.profile.favorites=progress.profile.favorites.includes(id)?progress.profile.favorites.filter(x=>x!==id):[...progress.profile.favorites,id];persist();render();}
});
document.addEventListener('change',event=>{
  const t=event.target;if(!t.matches('[data-pref]'))return;
  const k=t.dataset.pref;if(!Object.hasOwn(DEFAULT_PREFS,k))return;
  const next=t.type==='checkbox'?t.checked:['sound','textSize'].includes(k)?Number(t.value):t.value;
  const checked=readPreferences({version:4,prefs:{...prefs,[k]:next},progress});prefs=checked.prefs;applyPrefs();persist();unlockAudio();render();
});
document.addEventListener('error',event=>{if(event.target.tagName==='IMG'){event.target.classList.add('image-error');event.target.alt='تعذّر عرض الدليل البصري. يمكن للمقدم إلغاء السؤال أو الإبلاغ عنه من أدوات المقدم.';}},true);
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog'))closeDialog();});
window.addEventListener('popstate',()=>{window.SeenTeamUI?.pause();render();});
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY||!event.newValue)return;
  try{const data=readPreferences(parseSafeJSON(event.newValue,3000000));prefs=data.prefs;progress={profile:data.progress.profile,seen:{...progress.seen,...data.progress.seen}};applyPrefs();if(route!=='teamMatch')render();}
  catch{toast('تعذّرت قراءة تفضيلات نافذة أخرى. بقيت المباراة محفوظة.');}
});
load();
const BANK_ERRORS=validateBank(QUESTION_BANK);
if(BANK_ERRORS.length){$('#main').textContent='تعذّر التحقق من بنك الأسئلة. استخدم نسخة سليمة من اللعبة.';console.error(BANK_ERRORS);}
else render();
window.SeenDiagnostics=Object.freeze({version:APP_VERSION,validateBank:()=>validateBank(QUESTION_BANK),questionCount:QUESTION_BANK.length,normalizeArabic,counts:()=>Object.fromEntries(CATEGORIES.map(c=>[c.id,QUESTION_BANK.filter(q=>q.category===c.id).length]))});
