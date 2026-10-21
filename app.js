"use strict";
/* Shared offline host shell. All playable state and scoring belong to TeamEngine/TeamUI. */
const APP_VERSION = 4;
const STORAGE_KEY = 'seen-khaled-host-v4';
const LEGACY_KEY = 'seen-khaled-v1';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const localDate = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const AVATARS = ['🦁','🦉','🐉','🦅','🐺','🚀','🌙','🎮'];
const DEFAULT_PREFS = Object.freeze({theme:'dark',accent:'violet',sound:45,music:0,motion:'subtle',reduced:false,textSize:100,repetition:'recent',questionHistoryResetAt:0});
let prefs = {...DEFAULT_PREFS};
// Only shared category preferences and repetition history remain from the old profile.
let progress = {profile:{favorites:['anime','football','geo','games']},seen:{}};
let preferencesIssue = '', route = 'home', storageAvailable = true, toastHandle = null, lastFocus = null;
let audioContext = null, musicHandle = null, musicVoices = new Set();
const QUESTION_MAP = new Map(QUESTION_BANK.map(q => [q.id,q]));
function shuffled(items,rng=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function normalizeArabic(s){return String(s).normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
function parseSafeJSON(text,max=1500000){if(typeof text!=='string'||text.length>max)throw Error('الملف أكبر من الحجم المسموح.');return JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('الملف يحتوي على مفاتيح غير آمنة.');return value;});}
function validInt(n,max=1e9){return Number.isInteger(n)&&n>=0&&n<=max;}
function cleanName(value,fallback='خالد'){return String(value||'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,24)||fallback;}
/* Portable host saves conceal incidental answer text; base64 is an encoding,
   not encryption. The offline question bank is never a cryptographic secret. */
function encodeMatchBackup(kind,data){
if(kind !== 'teams')throw Error('نوع نسخة الاستئناف غير صالح.');
const text=JSON.stringify(data);parseSafeJSON(text,20000000);
const bytes=new TextEncoder().encode(text);if(bytes.length>20000000)throw Error('نسخة الاستئناف أكبر من الحجم المسموح.');let binary='';
for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
const payload=btoa(binary);if(payload.length>28000000)throw Error('نسخة الاستئناف أكبر من الحجم المسموح.');
return {format:'seen-khaled-resume',version:1,kind,encoding:'base64-utf8',payload};
}
function decodeMatchBackup(envelope,expectedKind){
if(!envelope||envelope.format!=='seen-khaled-resume'||envelope.version!==1||envelope.encoding!=='base64-utf8'||envelope.kind !== 'teams'||expectedKind&&envelope.kind!==expectedKind||Object.keys(envelope).some(key=>!['format','version','kind','encoding','payload'].includes(key))||typeof envelope.payload!=='string'||!envelope.payload.length||envelope.payload.length>28000000||envelope.payload.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.payload))throw Error('نسخة الاستئناف غير صالحة أو لا تطابق هذا النمط.');
let text;try{const binary=atob(envelope.payload);if(btoa(binary)!==envelope.payload)throw Error();if(binary.length>20000000)throw Error();text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));}catch{throw Error('تعذّرت قراءة بيانات نسخة الاستئناف.');}
return parseSafeJSON(text,20000000);
}

function hostRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('إعدادات غير صالحة.');
  const s = data.prefs;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw Error('الإعدادات غير مكتملة.');
  const next = {...DEFAULT_PREFS};
  for (const [key,values] of Object.entries({theme:['dark','light'],accent:['violet','gold'],motion:['none','subtle','full'],repetition:['recent','unseen','all']})) {
    if (s[key] !== undefined && !values.includes(s[key])) throw Error('خيار إعداد غير صالح.');
    if (s[key] !== undefined) next[key] = s[key];
  }
  for (const key of ['sound','music']) {
    if (s[key] !== undefined && !validInt(s[key],100)) throw Error('مستوى الصوت غير صالح.');
    if (s[key] !== undefined) next[key] = s[key];
  }
  for (const key of ['reduced']) {
    if (s[key] !== undefined && typeof s[key] !== 'boolean') throw Error('إعداد عرض غير صالح.');
    if (s[key] !== undefined) next[key] = s[key];
  }
  if (s.textSize !== undefined && ![90,100,115,130].includes(s.textSize)) throw Error('حجم النص غير صالح.');
  if (s.textSize !== undefined) next.textSize = s.textSize;
  if (s.questionHistoryResetAt !== undefined && !validInt(s.questionHistoryResetAt,1e14)) throw Error('تاريخ غير صالح.');
  if (s.questionHistoryResetAt !== undefined) next.questionHistoryResetAt = s.questionHistoryResetAt;
  const p = data.progress || {}, favorites = p.profile?.favorites;
  if (favorites !== undefined && (!Array.isArray(favorites) || favorites.length > 100 || favorites.some(id => typeof id !== 'string'))) throw Error('الفئات المفضلة غير صالحة.');
  const seen = {};
  if (p.seen !== undefined && (!p.seen || typeof p.seen !== 'object' || Array.isArray(p.seen) || Object.keys(p.seen).length > 10000)) throw Error('سجل الأسئلة غير صالح.');
  for (const [id,at] of Object.entries(p.seen || {})) if (QUESTION_MAP.has(id) && validInt(at,1e14)) seen[id] = at;
  return {prefs:next,progress:{profile:{favorites:favorites ? [...new Set(favorites.filter(id=>catById(id)))] : [...progress.profile.favorites]},seen}};
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify({version:APP_VERSION,prefs,progress}));
    storageAvailable = true;
    return true;
  } catch {
    if (storageAvailable) toast('تعذّر حفظ تفضيلات العرض؛ تبقى خياراتك متاحة في هذه الصفحة.');
    storageAvailable = false;
    return false;
  }
}
function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = parseSafeJSON(saved,5000000);
      if (data.version !== APP_VERSION) throw Error('إصدار إعدادات غير مدعوم.');
      ({prefs,progress} = hostRecord(data));
      return;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const data = parseSafeJSON(legacy,5000000);
    if (data.version !== 1) return;
    ({prefs,progress} = hostRecord(data));
    // Never delete the old save until the allowed preferences are safely written.
    // Team match storage is independent and never touched by this migration.
    if (persist()) {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_KEY+'-recovery');
    }
  } catch (error) {
    const unavailable = ['SecurityError','QuotaExceededError'].includes(error?.name);
    storageAvailable = !unavailable;
    preferencesIssue = unavailable ? '' : 'تعذّرت قراءة تفضيلات سابقة؛ استُخدمت الخيارات الافتراضية وبقي حفظ المباراة مستقلًا.';
  }
}
function applyPrefs(){document.documentElement.dataset.theme=prefs.theme;document.querySelector('meta[name=theme-color]').content=prefs.theme==='light'?'#f2f3f8':'#090d1e';document.documentElement.dataset.accent=prefs.accent;document.documentElement.dataset.motion=prefs.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches?'none':prefs.motion;document.documentElement.style.setProperty('--text-scale',prefs.textSize/100);if(!prefs.music)stopMusic();}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastHandle);toastHandle=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function unlockAudio(){try{if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});if(prefs.music&&!musicHandle){ambient();musicHandle=setInterval(ambient,6000);}}catch{}}
function tone(freq,duration=.12,type='sine',volume=1,delay=0){if(!audioContext||!prefs.sound)return;const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime+delay;o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.09*(prefs.sound/100)*volume,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(audioContext.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(t);o.stop(t+duration+.02);}
function sound(kind) {
  const melodies = {
    select:[[440,.09],[660,.1,.07]],
    reveal:[[392,.12],[587,.2,.1]],
    correct:[[523,.17],[659,.22,.1],[784,.3,.2]],
    steal:[[494,.12],[740,.18,.1],[988,.25,.2]],
    assist:[[330,.12],[495,.18,.09]],
    complete:[[523,.18],[659,.2,.12],[784,.22,.24],[1046,.4,.36]],
    achievement:[[523,.18],[659,.2,.12],[784,.22,.24],[1046,.4,.36]],
    wrong:[[220,.2],[165,.3,.13]],
    tick:[[440,.05]],
    click:[[560,.045]]
  };
  for(const [frequency,duration,delay=0] of melodies[kind] || melodies.click) tone(frequency,duration,'sine',kind==='tick'?.3:.8,delay);
}
function ambient(){if(!audioContext||!prefs.music||document.hidden)return;const t=audioContext.currentTime;[130.81,196,261.63,329.63].forEach(f=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.012*prefs.music/100,t+1);g.gain.linearRampToValueAtTime(0,t+5.5);o.connect(g);g.connect(audioContext.destination);const voice={o,g};musicVoices.add(voice);o.onended=()=>{o.disconnect();g.disconnect();musicVoices.delete(voice);};o.start(t);o.stop(t+6);});}
function stopMusic(){clearInterval(musicHandle);musicHandle=null;for(const voice of musicVoices){try{voice.g.gain.cancelScheduledValues(audioContext.currentTime);voice.g.gain.setTargetAtTime(0,audioContext.currentTime,.03);voice.o.stop(audioContext.currentTime+.12);}catch{}}}
function confetti(){if(document.documentElement.dataset.motion==='none')return;const el=$('#confetti');el.innerHTML=Array.from({length:prefs.motion==='full'?28:12},(_,i)=>`<span style="--x:${Math.random()*100}%;--delay:${i*.025}s;--color:${['#eac57e','#80cff5','#c5a8fb','#7cdec1'][i%4]};--rotate:${Math.random()*360}deg"></span>`).join('');setTimeout(()=>el.replaceChildren(),2400);}

function shell() {
  const nav = [['home','home','الرئيسية'],['categories','globe','الفئات'],['teamHistory','history','المباريات'],['settings','settings','الإعدادات']];
  const links = () => nav.map(([id,ic,label])=>`<button class="nav-link ${route===id?'active':''}" data-action="nav" data-route="${id}" ${route===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span></button>`).join('');
  $('#sidebar').innerHTML = `<div class="sidebar-label">معرفة تجمعنا</div>${links()}<div class="sidebar-bottom"><button class="nav-link" data-action="help">${icon('help')}<span>دليل اللعب</span></button><button class="nav-link" data-action="nav" data-route="library">${icon('book')}<span>مكتبة المقدم</span></button><button class="nav-link" data-action="about">${icon('shield')}<span>المحتوى والتراخيص</span></button><p class="footer-note">فريقان · منافسة واحدة<br>تعمل دون إنترنت</p></div>`;
  $('#bottom-nav').innerHTML = links();
  $('#header-actions').innerHTML = `<button class="icon-btn" data-action="fullscreen" aria-label="ملء الشاشة">${icon('expand')}</button><button class="icon-btn" data-action="theme" aria-label="تبديل المظهر">${prefs.theme==='dark'?'☀':'☾'}</button>`;
}
function navigate(to) {
  const allowed = ['home','categories','settings','teamHistory','teamSetup','teamMatch','library'];
  if (!allowed.includes(to)) to = 'home';
  if (route === 'teamMatch' && to !== 'teamMatch') window.SeenTeamUI?.pause();
  route = to;
  render();
  window.scrollTo({top:0,behavior:'instant'});
  $('#main').focus({preventScroll:true});
}
function render() {
  document.documentElement.dataset.teamPlay = route === 'teamMatch' ? 'true' : 'false';
  document.documentElement.dataset.teamMotion = route === 'teamMatch' && window.SeenTeamUI?.match?.config.animations === false ? 'none' : 'auto';
  const focusedId = document.activeElement?.id;
  const details = $$('details[id][open]').map(el=>el.id);
  shell();
  const screens = {home:renderHome,categories:renderCategories,settings:renderSettings,teamSetup:()=>window.SeenTeamUI?.setupScreen() || '',teamMatch:()=>window.SeenTeamUI?.matchScreen() || '',teamHistory:()=>window.SeenTeamUI?.historyScreen() || '',library:()=>window.SeenTeamUI?.libraryScreen() || ''};
  $('#main').innerHTML = `<div class="page">${(screens[route] || renderHome)()}</div>`;
  for (const id of details) document.getElementById(id)?.setAttribute('open','');
  if (route === 'teamMatch') window.SeenTeamUI?.startTicker();
  const focus = focusedId && document.getElementById(focusedId);
  if (focus && focusedId !== 'main' && !focus.disabled) focus.focus({preventScroll:true});
}
function title(eyebrow,heading,desc=''){return `<div class="section-heading page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1>${desc?`<p>${desc}</p>`:''}</div></div>`;}
function stat(ic,value,label){return `<div class="stat-card"><span class="stat-icon">${icon(ic)}</span><div><strong>${value}</strong><small>${label}</small></div></div>`;}

function renderHome() {
  return `<section class="hero grid"><div class="hero-copy"><span class="pill gold">${icon('spark')} ليلة أسئلة… تستحق المنافسة</span><h1>اجمع فريقك.<br><em>والباقي معرفة.</em></h1><p>فريق أزرق وفريق ذهبي، وأسئلة تجمع الجميع. اختروا فئاتكم وابدأوا؛ كل إجابة لها لحظة.</p><div class="hero-actions"><button class="btn primary" data-team-action="new">ابدأ مباراة فريقين ${icon('arrow')}</button><button class="btn secondary" data-action="nav" data-route="categories">استكشف الفئات ${icon('globe')}</button></div><div class="hero-facts"><span><b>${CATEGORIES.length}</b> فئة</span><i></i><span><b>${num(QUESTION_BANK.length)}</b> سؤال في المكتبة</span><i></i><span>دون إنترنت</span></div></div><div class="hero-art">${HERO_ART}<span class="art-label">معرفة تجمعنا</span></div></section>${window.SeenTeamUI?.homeAddon() || ''}<div class="section-heading"><div><span class="eyebrow">اختياركم يصنع التحدي</span><h2>عوالم تستحق السؤال</h2></div><button class="text-btn" data-action="nav" data-route="categories">كل الفئات ${icon('arrow')}</button></div><section class="category-grid">${CATEGORIES.slice(0,4).map(categoryCard).join('')}</section><p class="footer-note">سين جيم خالد · تجربة عربية أصلية للفريقين.</p>`;
}
function categoryCard(c) {
  const count = TeamEngine.eligibleQuestions(QUESTION_BANK,TeamEngine.defaults(),{category:c.id}).length;
  return `<div class="category-card" style="--accent:${c.color}"><div class="category-art">${categoryArt(c.id)}</div><div class="category-info"><span class="category-kicker">${esc(c.label)}</span><h2>${esc(c.name)}</h2><small>${num(count)} سؤالًا مؤهلًا</small><button class="chip ${progress.profile.favorites.includes(c.id)?'selected':''}" data-action="favorite" data-id="${c.id}" aria-pressed="${progress.profile.favorites.includes(c.id)}" aria-label="${esc(c.name)}: المفضلة">${icon('star')} المفضلة</button></div></div>`;
}
function renderCategories() {
  return `${title('اختر فضولك','فئات للجميع','يختار كل فريق 3 فئات في المباراة الكلاسيكية، ويستطيع الفريقان فتح أي خانة.')}<div class="hero-actions"><button class="btn primary" data-team-action="new">اختر فئات المباراة ${icon('arrow')}</button></div><div class="category-grid">${CATEGORIES.map(categoryCard).join('')}</div><p class="muted">العدد يعكس الأسئلة المؤهلة مع حماية الحرق الافتراضية. الأسئلة المعلّقة والمختلف فيها تبقى للمراجعة ولا تدخل مباراة جديدة.</p>`;
}
function hasActiveTrivia() { const team=window.SeenTeamUI?.match; return !!(team && team.state!=='MATCH_COMPLETE'); }
function isAnswerProtected(id) { const team=window.SeenTeamUI?.match; return !!(team && team.state!=='MATCH_COMPLETE' && team.board.some(t=>t.questionId===id&&!t.done) && !(team.current?.questionId===id&&team.current.revealed)); }
function questionAlt(q,revealed=false){return revealed?(VISUALS[q.image]?.alt||'دليل السؤال البصري'):'دليل بصري للسؤال؛ الوصف التعريفي متاح بعد الإجابة.';}
function safeHint(q){const hint=q.hint||'',normalized=normalizeArabic(hint),answers=[q.correctAnswer||q.options[q.answer],...(q.acceptedAnswers||[])].map(normalizeArabic).filter(Boolean);return hint&&!answers.some(a=>a.length===1?normalized.split(' ').includes(a):normalized.includes(a))?hint:'فكّر في سياق السؤال واستبعد الخيارات التي تنتمي إلى موضوع مختلف.';}
function safeURL(url){try{if(typeof url!=='string'||/[\u0000-\u0020\u007f]/.test(url))return '#';const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'#';}catch{return '#';}}
function selectPref(id,label,options){return `<div class="field"><label for="pref-${id}">${label}</label><select id="pref-${id}" data-pref="${id}">${options.map(([value,text,disabled])=>`<option value="${value}" ${String(prefs[id])===String(value)?'selected':''} ${disabled?'disabled':''}>${text}</option>`).join('')}</select></div>`;}
function togglePref(id,label){return `<label class="toggle-row" for="pref-${id}"><span>${label}</span><input id="pref-${id}" type="checkbox" data-pref="${id}" ${prefs[id]?'checked':''}></label>`;}

function renderSettings() {
  return `${title('على راحتك','إعدادات المقدم','خيارات العرض والصوت محفوظة على هذا الجهاز. قواعد المباراة تضبط عند الإنشاء.')}${preferencesIssue?`<p class="inline-note" role="status">${esc(preferencesIssue)}</p>`:''}<div class="settings-grid"><section class="panel stack"><h2>${icon('spark')} العرض والحركة</h2>${selectPref('theme','المظهر',[['dark','ليلي'],['light','نهاري']])}${selectPref('accent','اللمسة اللونية',[['violet','بنفسجي'],['gold','ذهبي']])}${selectPref('textSize','حجم النص',[[90,'90%'],[100,'100%'],[115,'115%'],[130,'130%']])}${selectPref('motion','كثافة الحركة',[['none','متوقفة'],['subtle','هادئة'],['full','كاملة']])}${togglePref('reduced','تقليل الحركة دائمًا')}<small class="muted">يُحترم خيار تقليل الحركة في نظام الجهاز تلقائيًا.</small></section><section class="panel stack"><h2>${icon('sound')} الصوت</h2><div class="field"><label for="pref-sound">المؤثرات الصوتية ${prefs.sound}%</label><input id="pref-sound" type="range" min="0" max="100" data-pref="sound" value="${prefs.sound}"></div><div class="field"><label for="pref-music">الموسيقى الهادئة ${prefs.music}%</label><input id="pref-music" type="range" min="0" max="100" data-pref="music" value="${prefs.music}"></div><button class="btn secondary" data-action="test-sound">تجربة الصوت ${icon('sound')}</button><p class="muted">أصوات أصلية داخل الملف، تبدأ بعد تفاعلك مع الصفحة.</p></section><section class="panel stack"><h2>${icon('shield')} الحفظ والمحتوى</h2><p class="muted">${storageAvailable?'تفضيلاتك محفوظة محليًا.':'تعذّر حفظ تفضيلاتك في هذا المتصفح.'} لحفظ المباراة أو استيرادها افتح سجل المباريات. نسخة المتابعة خاصة بالمقدم وتحتوي الحلول.</p><button class="btn secondary" data-action="nav" data-route="teamHistory">المباريات والنسخ الاحتياطية</button><button class="btn secondary" data-action="nav" data-route="library">مكتبة المقدم والتحرير</button><button class="btn secondary" data-action="reset-seen">بدء دورة جديدة للأسئلة</button><p class="muted">تبدأ تفضيل أسئلة جديدة دون تغيير اللوحة الحالية أو سجل النتائج.</p></section><section class="panel stack"><h2>${icon('help')} دليل الاستخدام</h2><button class="btn secondary" data-action="help">قواعد اللعب والمفاتيح</button><button class="btn secondary" data-action="about">المحتوى والمراجع والتراخيص</button><button class="btn secondary" data-action="fullscreen">ملء الشاشة ${icon('expand')}</button><p class="muted">احفظ index.html وافتحه دون إنترنت. على iPhone يمكنك استخدام العرض الحالي أو إضافة الصفحة إلى الشاشة الرئيسية وفق خيارات Safari.</p></section></div>`;
}
function openDialog(heading,body,actions=''){lastFocus=document.activeElement;const d=$('#dialog');d.innerHTML=`<div class="modal"><div class="dialog-head"><h2>${heading}</h2><button class="icon-btn" data-action="close-dialog" aria-label="إغلاق">${icon('close')}</button></div><div class="dialog-body">${body}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}</div>`;if(!d.open)d.showModal();d.querySelector('button, input')?.focus();}
function closeDialog(){const d=$('#dialog');if(d.open)d.close();lastFocus?.focus?.();}

function showHelp() { window.SeenTeamUI?.rules(); }
function showAbout() {
  window.SeenTeamUI?.pause();
  const counts = Object.fromEntries(['source-checked','editorial','pending','disputed'].map(status=>[status,QUESTION_BANK.filter(q=>q.verification?.status===status).length]));
  openDialog('سين جيم خالد · المحتوى والتراخيص',`<div class="stack"><p>الإصدار 4 · ${num(QUESTION_BANK.length)} سؤالًا في ${CATEGORIES.length} فئة.</p><p>حالات المحتوى: ${num(counts['source-checked'])} بمطابقة مصدر موثقة، ${num(counts.editorial)} بمراجعة تحريرية، ${num(counts.pending)} بانتظار التحقق، ${num(counts.disputed)} مختلف فيها. حفظنا أدلة التحقق السابقة؛ لا يعني وجود رابط أن السؤال تحقق منه أحد في هذا الإصدار.</p><p>تستبعد المباريات الجديدة الحالات المعلقة والمختلف فيها. المصادر اختيارية للقراءة بعد الكشف؛ لا تعتمد اللعبة على اتصال بها. يمكن للمقدم مراجعة المحتوى وتعطيله واستيراده وتصديره من مكتبته، خارج المباراة النشطة.</p><p>الرسوم الأصلية والأصوات وفق CC0-1.0. الخرائط والصور المرخصة وإسنادها محفوظة وتظهر بعد الإجابة. أسماء الأعمال والعلامات لأصحابها. لا توجد صور للأنبياء.</p><p>خط Noto Sans Arabic مضمّن بترخيص SIL Open Font License 1.1.</p><details><summary>رخصة الخط</summary><pre class="license-text" dir="ltr">${esc(FONT_LICENSE)}</pre></details><p>هذا ملف محلي للمقدم، دون حسابات أو خادم؛ أدوات التحرير تنظيمية ولا تحمي الحلول ممن يملك الملف أو أدوات المتصفح.</p></div>`);
}
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

function resetQuestionHistory() { progress.seen={}; prefs.questionHistoryResetAt=Date.now(); persist(); }
function requestQuestionHistoryReset() {
  window.SeenTeamUI?.pause();
  openDialog('بدء دورة جديدة للأسئلة؟','<p>يمكن ظهور الأسئلة السابقة مجددًا في المباريات الجديدة. تبقى اللوحة الحالية والنتائج وسجلات المباريات محفوظة.</p>','<button class="btn primary" id="confirm-reset-seen">ابدأ دورة جديدة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>');
  $('#confirm-reset-seen').addEventListener('click',()=>{resetQuestionHistory();closeDialog();render();toast('بدأت دورة جديدة للأسئلة.');},{once:true});
}
function validateBank(bank) {
  const errors=[],ids=new Set(),texts=new Set();
  for(const q of bank) {
    if(ids.has(q.id) || (!Array.isArray(q.options) || q.options.length!==4 || new Set(q.options.map(normalizeArabic)).size!==4 || !Number.isInteger(q.answer) || q.answer<0 || q.answer>3 || q.correctAnswer!==q.options[q.answer] || ![200,400,600].includes(q.points) || !q.explanation || !q.source?.title || !q.source?.reference || (q.source.url ? safeURL(q.source.url)==='#' : !q.source.bibliography)) || !catById(q.category)) errors.push(`بيانات سؤال غير صالحة: ${q.id}`);
    ids.add(q.id);
    const text=normalizeArabic(q.q);if(texts.has(text))errors.push(`سؤال مكرر: ${q.id}`);texts.add(text);
    if(q.image && !VISUALS[q.image])errors.push(`صورة مفقودة: ${q.id}`);
    if(/[٠-٩۰-۹]/.test(q.q+q.options.join('')+q.explanation))errors.push(`أرقام غير مدعومة: ${q.id}`);
  }
  return errors;
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b || b.disabled)return;
  unlockAudio();sound('click');
  const action=b.dataset.action;
  if(action==='nav')navigate(b.dataset.route);
  else if(action==='close-dialog')closeDialog();
  else if(action==='theme'){prefs.theme=prefs.theme==='dark'?'light':'dark';applyPrefs();persist();render();}
  else if(action==='fullscreen')fullscreen();
  else if(action==='favorite'){
    const id=b.dataset.id;if(!catById(id))return;
    progress.profile.favorites=progress.profile.favorites.includes(id)?progress.profile.favorites.filter(x=>x!==id):[...progress.profile.favorites,id];persist();render();
  }
  else if(action==='test-sound')sound('correct');
  else if(action==='help')showHelp();
  else if(action==='about')showAbout();
  else if(action==='copy-save')copyManualSave();
  else if(action==='reset-seen')requestQuestionHistoryReset();
});
document.addEventListener('change',e=>{
  const t=e.target;if(!t.matches('[data-pref]'))return;
  const key=t.dataset.pref;if(!Object.hasOwn(DEFAULT_PREFS,key))return;
  const value=t.type==='checkbox'?t.checked:['sound','music','textSize'].includes(key)?Number(t.value):t.value;
  try { prefs=hostRecord({prefs:{...prefs,[key]:value},progress}).prefs; applyPrefs();persist();unlockAudio();render(); } catch { toast('إعداد غير صالح.'); }
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stopMusic();
  else if(audioContext?.state==='running' && prefs.music && !musicHandle){ambient();musicHandle=setInterval(ambient,6000);}
});
window.addEventListener('pagehide',stopMusic);
window.addEventListener('storage',event=>{
  if(event.key===STORAGE_KEY && event.newValue){load();applyPrefs();if(route!=='teamMatch')render();}
});
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.classList.add('image-error');e.target.alt='تعذّر عرض الصورة المحلية. يرجى مراجعة السؤال مع المقدم.';}},true);
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog'))closeDialog();});
load();applyPrefs();
const BANK_ERRORS=validateBank(QUESTION_BANK);
if(BANK_ERRORS.length){$('#main').textContent='تعذّر التحقق من بنك الأسئلة. يرجى استخدام نسخة سليمة من اللعبة.';console.error(BANK_ERRORS);}else render();
window.SeenDiagnostics=Object.freeze({version:APP_VERSION,validateBank:()=>validateBank(QUESTION_BANK),questionCount:QUESTION_BANK.length,normalizeArabic,counts:()=>Object.fromEntries(CATEGORIES.map(c=>[c.id,QUESTION_BANK.filter(q=>q.category===c.id).length]))});
