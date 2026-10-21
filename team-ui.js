/* Two-team presentation and local persistence. The pure rules live in team-engine.js. */
const TeamUI = (() => {
  "use strict";
  const KEY = "seen-khaled-teams-v2",
    HELP = {
      call: {
        name: "اتصال بصديق",
        icon: "sound",
        rule: "تواصل فعليًا مع صديق. لا تجري اللعبة اتصالًا. تتحدد مهلة المساعدة وإيقاف مؤقّت السؤال من الإعداد.",
      },
      twice: {
        name: "جاوب جوابين",
        icon: "users",
        rule: "قدّم اقتراحين؛ تكفي صحة أحدهما. في الإجابة الشفهية يدير المقدم الاقتراحين، وفي الاختيارات والكتابة تتاح محاولة إضافية قبل السرقة.",
      },
      pit: {
        name: "الحفرة",
        icon: "shield",
        rule: "قبل ظهور السؤال فقط. الإجابة الصحيحة تمنح نقاط السؤال وتخصم قيمته الأساسية من المنافس؛ يخضع الخصم لسياسة الرصيد السالب.",
      },
      sitout: {
        name: "استريح",
        icon: "user",
        rule: "رشّح مشاركًا من الفريق الآخر ليمتنع عن المساهمة الشفهية في هذا السؤال. يؤكد المقدم الالتزام؛ لا حجب تقني للميكروفون.",
      },
      trap: {
        name: "الفخ",
        icon: "flag",
        rule: "حوّل السؤال للمنافس مرة واحدة. إخفاقه يخصم قيمة السؤال منه، ونجاحه يتبع القاعدة المختارة. لا سرقة بعد الفخ.",
      },
      time: {
        name: "وقت إضافي",
        icon: "clock",
        rule: "يضيف 15 ثانية إلى نافذة الإجابة الحالية عند تفعيل المؤقّت.",
      },
      hint: {
        name: "تلميح",
        icon: "help",
        rule: "يعرض تلميح السؤال دون كشف الإجابة. يحتاج تفعيل التلميحات.",
      },
      double: {
        name: "مضاعفة النقاط",
        icon: "bolt",
        rule: "يضاعف مكافأة صحة إجابة مستخدم المساعدة. خصم الحفرة يبقى القيمة الأساسية.",
      },
      skip: {
        name: "تخطي السؤال",
        icon: "arrow",
        rule: "ينهي السؤال بلا مكافأة عادية. إخفاق الفخ يبقى خاضعًا لقاعدته.",
      },
      second: {
        name: "فرصة ثانية",
        icon: "heart",
        rule: "يتيح محاولة إضافية ضمن المهلة الحالية، ولا يجمع مع جاوب جوابين في السؤال نفسه.",
      },
    };
  const STEPS = [
    "النمط",
    "الفريقان",
    "الفئات",
    "اللوحة",
    "الإجابة",
    "المؤقّت",
    "المساعدات",
    "القواعد",
    "الملخص",
  ];
  const TEAM_AVATARS = ["🔷", "🏆", ...AVATARS];
  const COLORS = [
    "#55b9f3",
    "#eac57e",
    "#7bdbb4",
    "#c49bff",
    "#f39caf",
    "#eeb07c",
  ];
  let draft = null,
    step = 0,
    categoryTeam = 0,
    categorySearch = "",
    categoryFilter = "all",
    store = {
      version: 3,
      presets: [],
      preferred: null,
      match: null,
      history: [],
      reports: [],
      edits: [],
      disabled: [],
    },
    tickHandle = null,
    baseBank = [],
    ready = false,
    locked = false,
    librarySearch = "",
    libraryCategory = "all",
    recoveryRaw = null,
    recoveryError = "",
    selectedPreset = "custom";
  let lastTickSound = -1, lastScores = null, armedPitTeam = null, resolutionBusy = false, resolutionToastTimer = null, storageIssue = false, lastScoreTapAt = 0, quietRestore = null, choosingSitout = false, lastObservedRaw = null;
  const deep = (v) => JSON.parse(JSON.stringify(v));
  const m = () => store.match;
  const active = () => m() && m().state !== "MATCH_COMPLETE";
  function bank() {
    return QUESTION_BANK;
  }
  function write() {
    if (locked) return false;
    try {
      const raw=JSON.stringify(store);
      localStorage.setItem(KEY, raw);
      lastObservedRaw=raw;
      storageIssue = false;
      return true;
    } catch {
      if (!storageIssue) toast("المباراة مستمرة في الذاكرة؛ تعذّر الحفظ التلقائي. صدّر حفظ متابعة للمقدم قبل إغلاق الصفحة.");
      storageIssue = true;
      return false;
    }
  }
  function storageNotice() {
    if (locked) return '<div class="match-storage-notice" role="status"><span>تغيّر حفظ المباراة في نافذة أخرى. حمّل أحدث نسخة قبل المتابعة.</span><button class="btn secondary small" data-team-action="reload">تحميل أحدث حفظ</button></div>';
    return storageIssue ? '<div class="match-storage-notice" role="status"><span>الحفظ التلقائي غير متاح؛ المباراة مستمرة. احفظ نسخة متابعة قبل إغلاق الصفحة.</span><button class="btn secondary small" data-team-action="backup">حفظ متابعة للمقدم</button></div>' : '';
  }
  function parseJSON(text) {
    if (text.length > 28100000) throw Error("الملف أكبر من الحجم المسموح.");
    return JSON.parse(text, (key, value) => {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("مفاتيح غير آمنة في الملف.");
      return value;
    });
  }
  function errText(e) {
    return /[\u0600-\u06ff]/.test(e?.message)
      ? e.message
      : "تعذّرت قراءة البيانات. تأكد من سلامة الملف.";
  }
  function pause(save = true) {
    clearInterval(tickHandle);
    tickHandle = null;
    if (
      active() &&
      ["QUESTION_ACTIVE", "STEAL_OPPORTUNITY", "ASSISTANCE_ACTIVE"].includes(
        m().state,
      )
    ) {
      store.match = TeamEngine.dispatch(
        m(),
        { type: "PAUSE" },
        bank(),
        Date.now(),
      );
      if (save) write();
    }
  }
  function go(to) {
    pause();
    route = to;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#main").focus({ preventScroll: true });
  }
  function checkLatestSave() {
    const current=m();
    if (!current) return false;
    // A failed write can leave an older, unrelated match on disk. The live
    // memory-only match must remain playable until a successful save restores
    // reliable cross-window comparisons.
    if (storageIssue) return true;
    let raw;
    try { raw=localStorage.getItem(KEY); } catch { storageIssue=true; return true; }
    if (!raw) return true;
    let latest;
    try { latest=parseJSON(raw)?.match; } catch {
      preserveRecovery(raw,"تغيّر الحفظ المحلي إلى بيانات غير صالحة. الأصل محفوظ للاسترداد.");
      locked=true; pause(false); render(); return false;
    }
    if (latest && (latest.id !== current.id || Number.isFinite(latest.serial) && latest.serial > current.serial)) {
      locked=true; pause(false); render();
      toast("تغيّرت المباراة في نافذة أخرى. حمّل أحدث حفظ لحماية النقاط.");
      return false;
    }
    return true;
  }
  function dismissResolutionToast() {
    clearTimeout(resolutionToastTimer);
    const el = $("#toast");
    if (el?.classList.contains("with-undo")) {
      el.classList.remove("show", "with-undo");
      el.querySelector("[data-team-action=undo]")?.remove();
    }
  }
  function resolutionToast(s) {
    const r = s.lastResolution;
    if (!r) return;
    const message = r.winner === null
      ? "محد جاوب صح — 0 نقطة" + (r.deltas?.some(delta => delta < 0) ? "؛ طُبّقت الخصومات المفعّلة" : "")
      : `${s.teams[r.winner].name} حصل على ${num(r.earned)} نقطة${r.phase === "steal" ? " بالسرقة" : ""}`;
    toast(message);
    const el = $("#toast"), button = document.createElement("button");
    button.className = "toast-undo";
    button.type = "button";
    button.textContent = "تراجع";
    button.dataset.teamAction = "undo";
    button.dataset.resolutionToken = r.token;
    button.setAttribute("aria-label", "تراجع عن نتيجة السؤال الأخير");
    el.classList.add("with-undo");
    el.append(button);
    clearTimeout(resolutionToastTimer);
    resolutionToastTimer = setTimeout(() => {
      if (button.isConnected) { button.remove(); el.classList.remove("with-undo"); }
    }, 4300);
  }
  function presentTransition(old, next, action) {
    if (next.state === "TURN_COMPLETE" && next.current?.resolved) next = TeamEngine.dispatch(next, {type:"NEXT_TURN"}, bank(), Date.now());
    const before = old.history?.length || 0;
    const resolved = (next.history?.length || 0) > before;
    store.match = next;
    if (next.lastError) toast(next.lastError);
    if (resolved) {
      const h = next.history[next.history.length - 1];
      if (h.questionId) { progress.seen[h.questionId] = Date.now(); persist(); }
      if (next.config.sound) sound(h.winner === null ? "wrong" : h.phase === "steal" ? "steal" : "correct");
      armedPitTeam = null;
    }
    if (action.type === "UNDO" && !next.lastError) {
      store.history = store.history.filter(h => h.id !== old.id);
      armedPitTeam = null;
    }
    if (next.state === "MATCH_COMPLETE") archive();
    write();
    render();
    if (["START_QUESTION", "START_STEAL", "OPEN_QUESTION"].includes(action.type))
      { window.scrollTo({top:0,behavior:"instant"}); $("#team-question-heading")?.focus({ preventScroll: true }); }
    if (next.state === "ANSWER_REVEAL") {
      $(".canonical-answer")?.focus({ preventScroll: true });
      $(".answer-reveal")?.scrollIntoView({ block: "start", behavior: "instant" });
    }
    if (next.state === "BOARD" && old.state !== "BOARD") {
      window.scrollTo({ top: 0, behavior: "instant" });
      $("#team-match-heading")?.focus({ preventScroll: true });
    }
    if (resolved && action.type === "RESOLVE_QUESTION") {
      const r = next.lastResolution;
      $("#announcer").textContent = `${r?.winner === null ? "محد جاوب صح" : next.teams[r?.winner ?? 0].name + " حصل على " + num(r?.earned || 0) + " نقطة"}. ${next.state === "BOARD" ? "الدور على " + next.teams[next.turn].name : "اكتملت المباراة"}.`;
      resolutionToast(next);
    }
    return next;
  }
  function dispatch(action) {
    if (locked) { toast("تغيرت المباراة في نافذة أخرى. حمّل أحدث حفظ."); return null; }
    const old = m();
    if (!old) return null;
    if (["RESOLVE_QUESTION","UNDO"].includes(action.type) && !checkLatestSave()) return null;
    dismissResolutionToast();
    return presentTransition(old, TeamEngine.dispatch(old, action, bank(), Date.now()), action);
  }
  function canArmPit(s) {
    return s?.state === "BOARD" && s.config.assistEnabled.pit && s.teams[s.turn].assists.pit > 0;
  }
  function openTile(tileId) {
    if (locked || !m() || m().state !== "BOARD" || Date.now()-lastScoreTapAt < 250) return;
    const old = m(), now = Date.now();
    dismissResolutionToast();
    let next = TeamEngine.dispatch(old, {type:"SELECT_TILE", tileId}, bank(), now);
    if (next.lastError) { toast(next.lastError); return; }
    if (armedPitTeam === old.turn && canArmPit(old)) {
      next = TeamEngine.dispatch(next, {type:"ASSIST",key:"pit",confirmed:true},bank(),now);
      if (next.lastError) { toast(next.lastError); return; }
    }
    next = TeamEngine.dispatch(next,{type:"START_QUESTION"},bank(),now);
    if (next.lastError) { toast(next.lastError); return; }
    armedPitTeam = null;
    presentTransition(old,next,{type:"OPEN_QUESTION"});
    if (next.config.sound) sound("select");
  }
  function archive() {
    const s = m();
    if (!s || s.state !== "MATCH_COMPLETE") return;
    const entry = {
      id: s.id,
      at: Date.now(),
      config: deep(s.config),
      teams: deep(s.teams),
      history: deep(s.history),
      transactions: deep(s.transactions),
      questions: deep(s.questions || {}),
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      timing: deep(s.timing || null),
      statisticsVersion: s.statisticsVersion,
    };
    store.history = store.history.filter((h) => h.id !== s.id);
    store.history.unshift(entry);
    store.history = store.history.slice(0, 30);
    if (s.config.animations) confetti();
    if (s.config.sound) sound("complete");
  }
  function applyEdits() {
    QUESTION_BANK.splice(0, QUESTION_BANK.length, ...deep(baseBank));
    for (const q of store.edits) {
      const i = QUESTION_BANK.findIndex((x) => x.id === q.id);
      if (i >= 0) QUESTION_BANK[i] = deep(q);
      else QUESTION_BANK.push(deep(q));
    }
    for (const q of QUESTION_BANK) q.disabled = q.disabled === true || store.disabled.includes(q.id);
    QUESTION_MAP.clear();
    QUESTION_BANK.forEach((q) => QUESTION_MAP.set(q.id, q));
  }
  function prepareResumeLibrary(raw) {
    if (!raw || !Array.isArray(raw.edits) || raw.edits.length>1200 || !Array.isArray(raw.disabled) || raw.disabled.length>2000) throw Error("مكتبة الأسئلة في حفظ المتابعة غير صالحة.");
    const ids=new Set(),texts=new Set();
    const incoming=raw.edits.map(item=>{
      const q=safeQuestion(item,ids,{legacy:true}),text=TeamEngine.normalizeAnswer(q.q);
      if (texts.has(text)) throw Error("تكرار أسئلة داخل حفظ المتابعة.");
      ids.add(q.id);texts.add(text);return q;
    });
    const merged=new Map(store.edits.map(q=>[q.id,q]));
    incoming.forEach(q=>merged.set(q.id,q));
    if (merged.size>1200) throw Error("دمج مكتبة المتابعة يتجاوز سعة 1200 سؤال محلي؛ صدّر المحتوى الحالي ونظّمه أولًا.");
    const edits=[...merged.values()],questions=deep(baseBank),disabled=[...new Set([...store.disabled.filter(id=>!ids.has(id)),...raw.disabled.filter(id=>typeof id==="string"&&!['__proto__','prototype','constructor'].includes(id))])];
    for(const q of edits){const index=questions.findIndex(item=>item.id===q.id);if(index>=0)questions[index]=deep(q);else questions.push(deep(q));}
    const seenText=new Set();
    for(const q of questions){const text=TeamEngine.normalizeAnswer(q.q);if(seenText.has(text))throw Error("دمج مكتبة المتابعة ينتج سؤالًا مكررًا؛ لم تتغير البيانات الحالية.");seenText.add(text);q.disabled=q.disabled===true || disabled.includes(q.id);}
    return {edits,disabled,questions};
  }
  function commitResumeLibrary(prepared) {
    if (!prepared || !Array.isArray(prepared.edits) || !Array.isArray(prepared.disabled)) throw Error("تعذّر اعتماد مكتبة المتابعة.");
    store.edits=deep(prepared.edits);store.disabled=[...prepared.disabled];applyEdits();write();
  }
  function verificationLabel(status) {
    return ({"source-checked":"مدقق بمصدر",editorial:"مراجعة تحريرية",pending:"بانتظار التحقق",disputed:"مختلف فيه أو غير يقيني","owner-reviewed":"مراجعة المالك"})[status] || "بانتظار التحقق";
  }
  function verificationData(raw, source) {
    if (raw!==undefined && (!raw || typeof raw!=="object" || Array.isArray(raw))) throw Error("بيانات التحقق غير صالحة.");
    const v = raw || {};
    const statuses=["source-checked","editorial","pending","disputed"];
    if (v.status!==undefined && !statuses.includes(v.status)) throw Error("حالة التحقق غير مدعومة؛ لم يُستورد السؤال.");
    const status = v.status || "editorial";
    const out = { status, notes: String(v.notes || v.note || "تحرير محلي بواسطة مالك النسخة").slice(0,1000) };
    for(const [key,max] of [["referenceTitle",180],["referenceUrl",1000],["bibliography",600],["section",600],["verifiedAt",10]]) if(typeof v[key] === "string")out[key]=v[key].trim().slice(0,max);
    if(out.referenceUrl && safeURL(out.referenceUrl)==="#")throw Error("رابط التحقق غير آمن.");
    if(status==="source-checked" && (!out.referenceTitle || !(out.referenceUrl || out.bibliography) || !out.section || !/^\d{4}-\d{2}-\d{2}$/.test(out.verifiedAt || "") || !out.notes.trim())) throw Error("حالة مدقق بمصدر تتطلب عنوان المرجع ورابطًا أو توثيقًا ببليوغرافيًا ومقطعًا وتاريخًا وملاحظات تحقق فعلية.");
    if(status==="source-checked") {
      const date=new Date(out.verifiedAt+"T00:00:00Z"),today=new Date().toISOString().slice(0,10);
      if(Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10)!==out.verifiedAt || out.verifiedAt>today) throw Error("تاريخ التحقق يجب أن يكون يومًا فعليًا لا يتجاوز اليوم.");
    }
    return out;
  }
  function similarQuestions(q) {
    const stop = new Set(["ما","من","هو","هي","في","التي","الذي","اي","على","الى","كان","تسمى","اسم"]);
    const tokens = text => new Set(TeamEngine.normalizeAnswer(text).split(" ").filter(x=>x.length>2&&!stop.has(x)));
    const a=tokens(q.q);
    if(a.size<4)return [];
    return bank().filter(other=>other.id!==q.id&&other.category===q.category).filter(other=>{const b=tokens(other.q), shared=[...a].filter(x=>b.has(x)).length;return shared>=4&&shared/Math.max(a.size,b.size)>=.65;}).slice(0,5);
  }
  function safeQuestion(raw, knownIds = new Set(), options = {}) {
    if (!raw || typeof raw !== "object") throw Error("السؤال غير صالح.");
    const text = (key, max, optional = false) => {
      const v = raw[key];
      if (optional && (v === undefined || v === "")) return "";
      if (typeof v !== "string" || !v.trim() || v.length > max)
        throw Error("نص سؤال أو حقل مفقود أو طويل جدًا.");
      return v.trim();
    };
    const id = text("id", 70);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ["__proto__","prototype","constructor"].includes(id) || !catById(raw.category))
      throw Error("معرّف السؤال أو فئته غير صالح.");
    if (
      ![200, 400, 600].includes(raw.points) ||
      !Array.isArray(raw.options) ||
      raw.options.length !== 4 ||
      raw.options.some(
        (x) => typeof x !== "string" || !x.trim() || x.length > 180,
      ) ||
      new Set(raw.options.map(TeamEngine.normalizeAnswer)).size !== 4 ||
      !Number.isInteger(raw.answer) ||
      raw.answer < 0 ||
      raw.answer > 3
    )
      throw Error(
        "أدخل 4 إجابات مختلفة ومفتاحًا صحيحًا وقيمة 200 أو 400 أو 600.",
      );
    if (!raw.source || typeof raw.source.title !== "string" || !raw.source.title.trim() || typeof raw.source.reference !== "string" || !raw.source.reference.trim()) throw Error("يلزم عنوان مصدر وإحالة دقيقة.");
    if (raw.source.url && (typeof raw.source.url !== "string" || safeURL(raw.source.url) === "#")) throw Error("رابط المصدر غير صالح.");
    if (!raw.source.url && !(typeof raw.source.bibliography === "string" && raw.source.bibliography.trim())) throw Error("أضف رابطًا آمنًا أو توثيقًا ببليوغرافيًا محددًا للمصدر.");
    const canonical = TeamEngine.normalizeAnswer(raw.options[raw.answer]);
    if (
      Array.isArray(raw.acceptedAnswers) &&
      raw.acceptedAnswers.some(
        (alias) =>
          typeof alias !== "string" ||
          !alias.trim() ||
          alias.length > 180 ||
          raw.options.some(
            (option, i) =>
              i !== raw.answer &&
              TeamEngine.normalizeAnswer(option) ===
                TeamEngine.normalizeAnswer(alias),
          ),
      )
    )
      throw Error("بديل الإجابة غير صالح أو يطابق خيارًا خاطئًا.");
    const oldClaim = options.legacy && raw.verification?.status === "source-checked" && !(raw.verification.referenceTitle && (raw.verification.referenceUrl || raw.verification.bibliography) && raw.verification.section && raw.verification.verifiedAt && raw.verification.notes);
    const legacyOwnerReview=options.legacy && raw.verification?.status==="owner-reviewed";
    const verified = legacyOwnerReview ? {status:"editorial",notes:String(raw.verification.notes || raw.verification.note || "مراجعة محلية بواسطة مالك النسخة السابقة؛ ليست تحققًا مستقلًا من المصدر.").slice(0,1000)} : oldClaim ? {status:"pending",notes:"ادعاء تحقق من إصدار سابق محفوظ تاريخيًا؛ يحتاج مراجعة مستقلة."} : raw.verification;
    const q = {
      id,
      category: raw.category,
      sub: text("sub", 100),
      level: raw.points === 200 ? 1 : raw.points === 400 ? 2 : 3,
      points: raw.points,
      q: text("q", 900),
      options: raw.options.map((x) => x.trim()),
      answer: raw.answer,
      correctAnswer: raw.options[raw.answer].trim(),
      acceptedAnswers: Array.isArray(raw.acceptedAnswers)
        ? raw.acceptedAnswers
            .filter((x) => typeof x === "string" && x.trim() && x.length <= 180)
            .slice(0, 12)
        : [],
      explanation: text("explanation", 1600),
      source: {
        title: raw.source.title.trim().slice(0, 180),
        url: raw.source.url ? safeURL(raw.source.url) : "",
        bibliography: String(raw.source.bibliography || "").slice(0,600),
        reference: raw.source.reference.trim().slice(0, 350),
      },
      spoiler: raw.spoiler === true,
      tags: Array.isArray(raw.tags) ? raw.tags.filter(t=>typeof t==="string"&&t.length<80).slice(0,20) : ["تحرير محلي"],
      version: 1,
      hint: text("hint", 300, true),
      type: raw.type || (raw.image ? "image" : "text"),
      verification: verificationData(verified,raw.source),
    };
    const formats = ["text","image","ordering","clues","multipart","logic"];
    if (!formats.includes(q.type)) throw Error("نوع السؤال غير مدعوم في هذه النسخة.");
    const sequence = (key,min,max) => {
      const value=raw[key];
      if (!Array.isArray(value) || value.length<min || value.length>max || value.some(item=>typeof item!=="string" || !item.trim() || item.length>300)) throw Error("عناصر صيغة السؤال غير صالحة.");
      return value.map(item=>item.trim());
    };
    if (raw.instructions !== undefined) q.instructions=text("instructions",600);
    if (raw.judging !== undefined) q.judging=text("judging",900);
    if (["ordering","clues","multipart","logic"].includes(q.type) && (!q.instructions || !q.judging)) throw Error("هذه الصيغة تحتاج تعليمات واضحة وقاعدة تحكيم كاملة.");
    if (q.type === "ordering") {
      q.items=sequence("items",3,6); q.correctOrder=sequence("correctOrder",3,6);
      if (new Set(q.items.map(TeamEngine.normalizeAnswer)).size!==q.items.length || q.correctOrder.length!==q.items.length || new Set(q.correctOrder.map(TeamEngine.normalizeAnswer)).size!==q.items.length || q.correctOrder.some(item=>!q.items.includes(item))) throw Error("الترتيب الصحيح يجب أن يضم العناصر نفسها مرة واحدة.");
      if (TeamEngine.normalizeAnswer(q.correctOrder.join("، ثم "))!==canonical) throw Error("الإجابة الصحيحة لا تطابق ترتيب العناصر الموثق.");
    }
    if (raw.publicEligible!==undefined) {
      if (typeof raw.publicEligible!=="boolean") throw Error("إتاحة السؤال العامة غير صالحة.");
      q.publicEligible=raw.publicEligible;
    }
    if (q.type === "clues") q.clues=sequence("clues",2,5);
    if (q.type === "multipart") q.parts=sequence("parts",2,5);
    if (q.type === "image" && !raw.image) throw Error("الصيغة المرئية تحتاج صورة محلية.");
    const formatText=[q.q,...q.options,q.explanation,q.instructions||"",q.judging||"",...(q.items||[]),...(q.clues||[]),...(q.parts||[])].join(" ");
    if (/[٠-٩۰-۹]/.test(formatText)) throw Error("استخدم الأرقام 0-9 في محتوى السؤال.");
    if (oldClaim || legacyOwnerReview) q.historicalVerification=deep(raw.verification);
    else if (raw.historicalVerification) q.historicalVerification = deep(raw.historicalVerification);
    if (raw.franchiseId) {
      if (!TeamEngine.FRANCHISES.some(f=>f.id===raw.franchiseId) || raw.category!=="anime")throw Error("العمل المختار لا يطابق فئة الأنمي.");
      q.franchiseId=raw.franchiseId;
      q.spoilerLevel=[1,2,3].includes(raw.spoilerLevel)?raw.spoilerLevel:raw.spoiler?2:1;
      q.spoiler=q.spoilerLevel>1;
      q.sourceMedia=String(raw.sourceMedia || TeamEngine.FRANCHISES.find(f=>f.id===raw.franchiseId).sourceMedia).slice(0,100);
      if(raw.contentCutoff)q.contentCutoff=String(raw.contentCutoff).slice(0,100);
    }
    if (raw.image) {
      if (typeof raw.image !== "string" || !VISUALS[raw.image])
        throw Error("الصورة غير موجودة ضمن الحزمة المحلية.");
      q.image = raw.image;
    }
    const duplicate = bank().find(
      (x) =>
        x.id !== id &&
        TeamEngine.normalizeAnswer(x.q) === TeamEngine.normalizeAnswer(q.q),
    );
    if (duplicate || knownIds.has(id)) throw Error("السؤال أو معرّفه مكرر.");
    return q;
  }
  function init() {
    baseBank = deep(QUESTION_BANK);
    let raw = null;
    try {
      recoveryRaw = localStorage.getItem(KEY + "-recovery");
      raw = localStorage.getItem(KEY);
      lastObservedRaw=raw;
      if (raw) {
        const data = parseJSON(raw);
        if (![2,3].includes(data.version)) throw Error("إصدار حفظ الفريقين غير مدعوم. احتُفظ بالنسخة الأصلية للتصدير.");
        let partial = false;
        // Restore each independent record so one damaged match cannot erase valid owner edits.
        store.edits = [];
        if (Array.isArray(data.edits)) for (const candidate of data.edits.slice(0,1200)) {
          try { store.edits.push(safeQuestion(candidate,new Set(),{legacy:data.version===2})); } catch { partial = true; }
        }
        store.disabled = Array.isArray(data.disabled) ? data.disabled.filter(id => typeof id === "string").slice(0,2000) : [];
        applyEdits();
        try { store.preferred = data.preferred ? sanitizePreferred(data.preferred) : null; } catch { partial = true; }
        store.presets = restorePresets(data.presets);
        const restored = data.match ? TeamEngine.restore(data.match, bank()) : {state:null};
        store.match = restored.state;
        if (restored.error) { partial = true; recoveryError = restored.error; }
        store.history = Array.isArray(data.history) ? data.history.filter(h => { const valid=validHistory(h); if(!valid)partial=true; return valid; }).slice(0,30) : [];
        store.reports = Array.isArray(data.reports) ? data.reports.filter(r => r && typeof r.id === "string" && typeof r.note === "string" && r.note.length <= 600).slice(0,200) : [];
        if (partial) preserveRecovery(raw, recoveryError || "تعذّرت استعادة بعض بيانات الفريقين. استُعيدت البيانات السليمة، وحُفظ الأصل دون تعديل للتصدير والاسترداد.");
        store.version = 3;
      }
    } catch (e) {
      if (raw === null) {
        storageIssue = true;
        toast("التخزين التلقائي غير متاح في هذا المتصفح. يمكنك اللعب وحفظ ملف متابعة يدويًا.");
      } else {
        preserveRecovery(raw, errText(e));
        toast("تعذّرت استعادة حفظ الفريقين بالكامل. الأصل محفوظ للتصدير والاسترداد.");
      }
    }
    load();
    ready = true;
    render();
  }
  function validHistory(h, questionBank = bank()) {
    const ids = new Set(questionBank.map(q=>q.id));
    return !!(
      h &&
      typeof h.id === "string" &&
      h.id.length < 100 &&
      Array.isArray(h.teams) &&
      h.teams.length === 2 &&
      h.teams.every(
        (t) =>
          typeof t.name === "string" &&
          t.name.length <= 32 &&
          /^#[0-9a-f]{6}$/i.test(t.color) &&
          typeof t.avatar === "string" &&
          t.avatar.length <= 12 &&
          ["score", "correct", "incorrect", "steals"].every(
            (k) => Number.isInteger(t[k]) && Math.abs(t[k]) < 10000000,
          ) &&
          Array.isArray(t.assistHistory) &&
          t.assistHistory.length <= 200 &&
          t.assistHistory.every(
            (a) =>
              HELP[a.key] &&
              typeof a.questionId === "string" &&
              Number.isFinite(a.at),
          ),
      ) &&
      Array.isArray(h.transactions) &&
      h.transactions.length <= 300 &&
      h.transactions.every(
        (t) =>
          t &&
          typeof t.id === "string" &&
          [0, 1].includes(t.teamId) &&
          typeof t.reason === "string" &&
          ["scoreBefore", "scoreAfter", "timestamp", "originalValue"].every(
            (k) => Number.isFinite(t[k]) && Math.abs(t[k]) < 1e14,
          ),
      ) &&
      Array.isArray(h.history) &&
      h.history.length <= 36 &&
      h.history.every(
        (r) =>
          r &&
          typeof r.questionId === "string" &&
          (ids.has(r.questionId) || h.questions?.[r.questionId]) &&
          [0, 1].includes(r.selector) &&
          [0, 1].includes(r.responder) &&
          (r.winner === null || [0, 1].includes(r.winner)),
      ) &&
      h.config &&
      ["compact", "classic"].includes(h.config.board) &&
      Number.isFinite(h.at)
    );
  }
  function sanitizePreferred(c) {
    const d = TeamEngine.defaults();
    for (const k of Object.keys(d)) {
      if (k === "teams") continue;
      if (typeof d[k] === "boolean") {
        if (typeof c[k] === "boolean") d[k] = c[k];
      } else if (typeof d[k] === "number") {
        if (Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 3600) d[k] = c[k];
      } else if (typeof d[k] === "string") {
        if (typeof c[k] === "string" && c[k].length < 40) d[k] = c[k];
      } else if (c[k] && typeof c[k] === "object" && !Array.isArray(c[k])) {
        for (const name of Object.keys(d[k]))
          if (typeof c[k][name] === typeof d[k][name]) d[k][name] = c[k][name];
      }
    }
    if (c.anime && typeof c.anime === "object") {
      const ids = TeamEngine.FRANCHISES.map(f => f.id);
      d.anime = { selected: Array.isArray(c.anime.selected) ? [...new Set(c.anime.selected.filter(id => ids.includes(id)))] : [...ids], levels: Object.fromEntries(ids.map(id => [id, [1,2,3].includes(c.anime.levels?.[id]) ? c.anime.levels[id] : 1])) };
    }
    if (!["recent", "unseen", "all"].includes(d.repetition)) d.repetition = "recent";
    d.categoryCount=d.variant==="custom"&&[2,4,6].includes(c.categoryCount)?c.categoryCount:6;
    d.pointValues=d.variant==="custom"&&Array.isArray(c.pointValues)&&c.pointValues.length&&c.pointValues.every(v=>[200,400,600].includes(v))?[...new Set(c.pointValues)].sort((a,b)=>a-b):[200,400,600];
    if (Array.isArray(c.teams) && c.teams.length === 2) {
      d.teams = c.teams.map((rawTeam, i) => {
        if (!rawTeam || typeof rawTeam !== "object" || Array.isArray(rawTeam))
          throw Error("بيانات تفضيلات الفريقين غير صالحة.");
        const t = rawTeam;
        return {
          ...d.teams[i],
          name: cleanName(t.name, i ? "الفريق الذهبي" : "الفريق الأزرق"),
          color: COLORS.includes(t.color) ? t.color : COLORS[i],
          avatar: TEAM_AVATARS.includes(t.avatar) ? t.avatar : AVATARS[i],
          players: Array.isArray(t.players)
            ? t.players
                .filter((x) => typeof x === "string")
                .map((x) => cleanName(x))
                .slice(0, 12)
            : [],
          categories: Array.isArray(t.categories)
            ? [...new Set(t.categories.filter((id) => catById(id)))].slice(0, categoryQuota(d))
            : [],
          assists: Array.isArray(t.assists)
            ? [...new Set(t.assists.filter((id) => HELP[id]))].slice(0, 5)
            : [],
        };
      });
    }
    return d;
  }
  function startSetup(random = false) {
    pause();
    draft = store.preferred
      ? sanitizePreferred(store.preferred)
      : {...TeamEngine.defaults(), repetition:prefs.repetition};
    step = 0;
    selectedPreset = store.preferred && ["classic","quick","challenge","visual","custom"].includes(draft.variant) ? draft.variant : store.preferred ? "custom" : "classic";
    categoryTeam = 0;
    categorySearch = "";
    categoryFilter = "all";
    if (random) randomCategories();
    go("teamSetup");
  }
  function categoryQuota(config = draft) { return config?.variant === "custom" ? (config.categoryCount || 6) / 2 : 3; }
  function pointValues(config = draft) { return config?.variant === "custom" && Array.isArray(config.pointValues) ? config.pointValues : [200,400,600]; }
  function boardSize(config = draft) { return categoryQuota(config) * 2 * pointValues(config).length * (config.board === "classic" ? 2 : 1); }
  function boardPoints(config = draft) { return categoryQuota(config) * 2 * pointValues(config).reduce((total,value)=>total+value,0) * (config.board === "classic" ? 2 : 1); }
  function resizeCategories(total) {
    draft.categoryCount = total;
    const quota=categoryQuota(),used=new Set();
    draft.teams.forEach(t=> { t.categories=t.categories.filter(id=>catById(id)&&!used.has(id)).slice(0,quota);t.categories.forEach(id=>used.add(id)); });
    const available=CATEGORIES.filter(c=>!used.has(c.id)&&pointValues().every(value=>countsFor(c.id)[value]>=(draft.board==="classic"?2:1)));
    draft.teams.forEach(t=> { while(t.categories.length<quota && available.length) t.categories.push(available.shift().id); });
  }
  function randomCategories() {
    const quota=categoryQuota(),selected = shuffled(CATEGORIES.filter(c=>pointValues().every(value=>countsFor(c.id)[value]>=(draft.board === "classic" ? 2 : 1)))).slice(0,quota*2);
    draft.teams[0].categories = selected.slice(0,quota).map(c=>c.id);
    draft.teams[1].categories = selected.slice(quota,quota*2).map(c=>c.id);
  }
  function countsFor(category) {
    const counts = { 200: 0, 400: 0, 600: 0 };
    for (const q of TeamEngine.eligibleQuestions(bank(), draft || TeamEngine.defaults(), { category })) {
      const value = q.points || (q.level === 1 ? 200 : q.level === 2 ? 400 : 600);
      if (value in counts) counts[value]++;
    }
    return counts;
  }
  function recoveryNotice() {
    return recoveryRaw ? `<section class="panel recovery-notice stack" role="status"><h2>الحفظ السابق محفوظ للاسترداد</h2><p>${esc(recoveryError || "توجد نسخة أصلية من حفظ تعذّر استعادته بالكامل. لم تُحذف، ويمكن تصديرها قبل بدء مباراة جديدة.")}</p><p class="muted">تبقى النسخة الأصلية دون تغيير. يتاح تصديرها قبل بدء جولة جديدة أو بعد اكتمال جميع الجولات الجارية لحماية الحلول.</p><button class="btn secondary" data-team-action="recovery-export">تصدير الحفظ الأصلي للاسترداد</button></section>` : "";
  }
  function preserveRecovery(raw, message) {
    recoveryError = message;
    if (!raw) return;
    try {
      if (!recoveryRaw) { localStorage.setItem(KEY + "-recovery", raw); recoveryRaw = raw; }
    } catch {
      locked = true;
      recoveryRaw = raw;
      recoveryError += " تعذّر إنشاء النسخة الآمنة؛ صَدّر الحفظ الأصلي قبل المتابعة.";
    }
  }
  function restorePresets(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 12).flatMap(p => {
      if (!p || typeof p.name !== "string" || !p.name.trim() || p.name.length > 40 || !p.config) return [];
      try { return [{ name: cleanName(p.name), config: sanitizePreferred(p.config) }]; } catch { return []; }
    });
  }
  function presetControls() {
    return `<div class="preset-grid" role="group" aria-label="قوالب إعداد المباراة">${[
      ["quick", "مباراة سريعة", "18 سؤالًا · إجابة شفهية · إعداد بسيط"],
      ["classic", "مباراة كلاسيكية", "36 سؤالًا · تحكم المقدم · سرقة ومساعدات"],
      ["challenge", "تحدي المخاطرة", "18 سؤالًا · تفضيل الصعوبة الأعلى المتاحة · 30 ثانية ومخاطرة"],
      ["visual", "المواجهة البصرية", "18 سؤالًا · أولوية للصور المحلية مع بديل نصي واضح"],
      ["custom", "تخصيص كامل", "المؤقّت والسرقة واللوحة والمساعدات ضمن حدود آمنة"]
    ].map(([id, name, description]) => `<button class="team-choice ${selectedPreset === id ? "selected" : ""}" data-team-action="preset" data-value="${id}" aria-pressed="${selectedPreset === id}"><strong>${name}</strong><small>${description}</small></button>`).join("")}</div>${store.presets.length ? `<div class="saved-presets row"><label for="saved-team-preset">قوالبك المحفوظة</label><select id="saved-team-preset"><option value="">اختر قالبًا</option>${store.presets.map((p,i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select><button class="btn secondary small" data-team-action="load-preset">تطبيق القالب</button><button class="btn secondary small" data-team-action="delete-preset">حذف القالب المختار</button></div>` : ""}`;
  }
  function applyPreset(kind) {
    if (!["classic","quick","challenge","visual","custom"].includes(kind)) return;
    selectedPreset = kind;
    draft.variant = kind;
    if (kind === "custom") return;
    draft.categoryCount=6; draft.pointValues=[200,400,600];
    draft.board = kind === "classic" ? "classic" : "compact";
    draft.answerStyle = "oral";
    draft.mode = kind === "classic" ? "presenter" : "teams";
    draft.transition = kind === "classic" ? "host" : "auto";
    draft.steal = true;
    draft.negative = kind === "challenge";
    draft.bonus = false;
    if (kind === "challenge") {
      draft.timer = true;
      draft.duration = 30;
      applyAssistPreset("enhanced");
    }
    resizeCategories(6);
    // Names, existing category choices, spoiler limits and ordinary preset timers remain the host's.
  }
  function applyAssistPreset(kind) {
    const classic = ["call","twice","pit","sitout","trap"];
    if (!["classic","enhanced"].includes(kind)) return;
    for (const key of Object.keys(HELP)) {
      draft.assistEnabled[key] = kind === "enhanced" || classic.includes(key);
      draft.assistLimits[key] = 1;
    }
    draft.assistSlots = 3;
    if (kind === "enhanced") draft.hints = true;
    draft.teams.forEach(t => { t.assists = kind === "classic" ? ["call","twice","pit"] : ["hint","double","second"]; });
  }
  function categorySelection() {
    const favorites = new Set(progress.profile.favorites);
    const search = normalizeArabic(categorySearch);
    const categories = CATEGORIES.filter(c => (!search || normalizeArabic(`${c.name} ${c.label || ""} ${c.desc || ""}`).includes(search)) && (categoryFilter === "all" || categoryFilter === "favorites" && favorites.has(c.id) || categoryFilter === "play" && ["anime","football","games"].includes(c.id) || categoryFilter === "culture" && !["anime","football","games"].includes(c.id)));
    return `<h2>${categoryQuota()} ${categoryQuota()===1?"فئة":"فئات"} لكل فريق</h2><p class="muted">اختر للفريق الأول ثم للفريق الثاني فئات مختلفة. يمكن للفريقين فتح أي خانة من الفئات المشتركة.</p><div class="chips">${draft.teams.map((t,i) => `<button class="chip ${categoryTeam === i ? "selected" : ""}" data-team-action="category-team" data-team="${i}" aria-pressed="${categoryTeam === i}">${esc(t.name)} · ${t.categories.length}/${categoryQuota()}</button>`).join("")}<button class="btn secondary small" data-team-action="random-categories">${icon("spark")} توزيع تلقائي</button></div><div class="searchbar"><label class="sr-only" for="team-category-search">بحث الفئات</label><input id="team-category-search" placeholder="ابحث باسم الفئة…" value="${esc(categorySearch)}" data-team-search="categories"><label class="sr-only" for="team-category-filter">موضوع الفئات</label><select id="team-category-filter" data-team-category-filter>${[["all","كل المواضيع"],["favorites","المفضلة"],["culture","التاريخ والمعرفة"],["play","الرياضة والترفيه"]].map(([id,label])=>`<option value="${id}" ${categoryFilter===id?"selected":""}>${label}</option>`).join("")}</select></div><p class="sr-only" role="status">${categories.length} فئة مطابقة</p><div class="team-category-grid">${categories.map(c => {
      const owner = draft.teams.findIndex(t=>t.categories.includes(c.id)), counts = countsFor(c.id), enough = pointValues().every(value=>counts[value] >= (draft.board === "classic" ? 2 : 1)), favorite = favorites.has(c.id);
      return `<div class="category-option"><button id="team-category-${c.id}" class="team-category-card ${owner>=0?"owned-"+owner:""}" data-team-action="category" data-id="${c.id}" style="--accent:${c.color}" aria-pressed="${owner>=0}" ${!enough&&owner<0?"disabled":""}><div class="category-art">${categoryArt(c.id)}</div><strong class="category-name">${esc(c.name)}</strong><small class="category-count">200: ${counts[200]} · 400: ${counts[400]} · 600: ${counts[600]}</small><span class="owner-label">${owner>=0?teamName(owner):enough?"متاحة":"أسئلة غير كافية"}</span></button><button class="category-favorite ${favorite?"selected":""}" data-team-action="favorite-category" data-id="${c.id}" aria-label="${favorite?"إزالة":"إضافة"} ${esc(c.name)} ${favorite?"من":"إلى"} المفضلة" aria-pressed="${favorite}">${icon("star")}</button></div>`;
    }).join("") || '<p class="inline-note">لا توجد فئات مطابقة. غيّر البحث أو أضف فئات إلى المفضلة بالنجمة.</p>'}</div>${animeControls()}`;
  }
  function animeControls() {
    const anime = draft.anime, franchises = TeamEngine.FRANCHISES;
    return `<details class="anime-settings panel" ${draft.teams.some(t => t.categories.includes("anime")) ? "open" : ""}><summary><strong>الأنمي وحدود الحرق</strong><span>${anime.selected.length} من ${franchises.length} عملًا</span></summary><p class="muted">مستوى مستقل لكل عمل. لا تتجاوز اللعبة اختيارك عند نقص الأسئلة، ويشمل الحد السؤال والخيارات والصورة والتلميح.</p><div class="row"><button class="btn secondary small" data-team-action="anime-all" data-value="on">اختيار الكل</button><button class="btn secondary small" data-team-action="anime-all" data-value="off">إلغاء الكل</button></div><div class="anime-franchises">${franchises.map(f => {
      const count = TeamEngine.eligibleQuestions(bank(), draft, { category: "anime" }).filter(q => q.franchiseId === f.id).length;
      return `<div class="anime-franchise"><label class="team-toggle"><span>${esc(f.title)}<small>${f.sourceMedia === "novel/manhwa" ? "رواية ومانهوا" : "مانغا"}</small></span><input type="checkbox" data-anime-selected="${f.id}" ${anime.selected.includes(f.id) ? "checked" : ""}></label><label class="sr-only" for="anime-level-${f.id}">حد الحرق في ${esc(f.title)}</label><select id="anime-level-${f.id}" data-anime-level="${f.id}" ${!anime.selected.includes(f.id) ? "disabled" : ""}>${[[1,"بلا حرق"],[2,"أحداث الأنمي"],[3,"كامل العمل"]].map(([level,name]) => `<option value="${level}" ${anime.levels[f.id] === level ? "selected" : ""}>${name}</option>`).join("")}</select><small class="muted">${count} سؤالًا متاحًا ضمن الحد</small></div>`;
    }).join("")}</div><p class="inline-note">الأسئلة القديمة التي لا تحمل تصنيف عمل موثق تبقى خاضعة لحماية الحرق، ولا تُعرض عند اختيار أعمال محددة.</p></details>`;
  }
  function teamName(i, config = draft) {
    return esc(config.teams[i].name);
  }
  function teamField(label, id, content) {
    return `<div class="team-field"><label for="${id}">${label}</label>${content}</div>`;
  }
  function selectField(key, label, options) {
    const id = "tc-" + key;
    return teamField(
      label,
      id,
      `<select id="${id}" data-team-pref="${key}">${options.map(([value, text]) => `<option value="${value}" ${String(draft[key]) === String(value) ? "selected" : ""}>${text}</option>`).join("")}</select>`,
    );
  }
  function numberField(key, label, min, max) {
    const id = "tc-" + key;
    return teamField(
      label,
      id,
      `<input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${draft[key]}" data-team-pref="${key}">`,
    );
  }
  function toggleField(key, label, detail = "") {
    return `<label class="team-toggle"><span><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ""}</span><input type="checkbox" data-team-pref="${key}" ${draft[key] ? "checked" : ""}></label>`;
  }
  function choices(key, items) {
    return `<div class="team-choice-grid">${items.map((item) => `<button id="team-choice-${key}-${item.id}" class="team-choice ${draft[key] === item.id ? "selected" : ""}" data-team-action="choose" data-key="${key}" data-value="${item.id}" aria-pressed="${draft[key] === item.id}">${icon(item.icon || "star")}<strong>${item.name}</strong><small>${item.desc || ""}</small></button>`).join("")}</div>`;
  }
  function setupScreen() {
    if (!draft) draft = TeamEngine.defaults();
    const errors = TeamEngine.validateConfig(draft, bank());
    return `<div class="team-page"><div class="wizard-header"><span class="eyebrow">مباراتكم… بقواعدكم</span><h1 id="team-wizard-heading" tabindex="-1">${STEPS[step]}</h1><p class="muted">الخطوة ${step + 1} من 9 · يمكنك مراجعة كل الخيارات قبل البداية.</p></div><nav class="wizard-steps" aria-label="خطوات تجهيز المباراة">${STEPS.map((s, i) => `<button id="team-step-${i}" class="step-dot ${step === i ? "active" : step > i ? "done" : ""}" data-team-action="step" data-step="${i}" aria-label="الخطوة ${i + 1}: ${s}" ${step === i ? 'aria-current="step"' : ""}><span>${i + 1}</span><small>${s}</small></button>`).join("")}</nav><div class="wizard-grid"><section class="wizard-content panel stack">${wizardBody()}<div class="wizard-footer"><button class="btn secondary" data-team-action="${step ? "back" : "home"}">${step ? "السابق" : "الرئيسية"}</button><button class="btn primary" data-team-action="${step === 8 ? "start-match" : "next-step"}">${step === 8 ? "ابدأ المباراة" : "التالي"} ${icon("arrow")}</button></div>${step === 8 && errors.length ? `<div class="inline-note warning" role="status">${errors.map(esc).join("<br>")}</div>` : ""}</section><aside class="wizard-summary panel stack"><span class="eyebrow">نظرة سريعة</span><h2>${teamName(0)} <span class="muted">×</span> ${teamName(1)}</h2><p>${draft.board === "compact" ? "خانة واحدة لكل قيمة" : "خانتان لكل قيمة"} · ${boardSize()} سؤالًا</p><p class="muted">قيم الخانات: ${pointValues().join(" · ")}</p><div class="summary-line"><span>الفئات المختارة</span><strong>${draft.teams.reduce((n, t) => n + t.categories.length, 0)} / ${categoryQuota()*2}</strong></div><div class="summary-line"><span>الإجابة</span><strong>${answerLabel(draft)}</strong></div><div class="summary-line"><span>الوقت</span><strong>${draft.timer ? `${draft.duration} ثانية` : "بلا مؤقّت"}</strong></div><p class="muted">يمكن لكل فريق اختيار أي سؤال متاح من الفئات المشتركة. تُقفل القواعد بعد بداية المباراة.</p><button class="text-btn" data-team-action="rules">دليل القواعد والمساعدات ${icon("help")}</button></aside></div></div>`;
  }
  function wizardBody() {
    switch (step) {
      case 0:
        return `${!TeamEngine.validateConfig(draft,bank()).length ? `<section class="fast-start panel stack"><span class="eyebrow">جاهزة للعب</span><h2>${draft.board === "classic" ? "مباراة كلاسيكية" : "مباراة سريعة"} · ${boardSize()} سؤالًا</h2><p>${teamName(0)} × ${teamName(1)}</p><p class="muted">${draft.teams.flatMap(t=>t.categories).map(id=>catById(id).name).join(" · ")}</p><button class="btn primary" data-team-action="start-match">ابدأ ${boardSize()} سؤالًا</button><button class="btn secondary" data-team-action="customize">تخصيص الفريقين والقواعد</button></section>` : ""}<h2>اختر أجواء اللعب</h2>${presetControls()}<h3>طريقة إدارة المباراة</h3>${choices("mode", [
          {
            id: "teams",
            name: "منافسة فريقين",
            icon: "cup",
            desc: "التجربة الأساسية: فريقان ولوحة مشتركة.",
          },
          {
            id: "party",
            name: "تحدي الحفلة المحلي",
            icon: "users",
            desc: "قسّم الأصدقاء إلى فريقين مع تسجيل المشاركين.",
          },
          {
            id: "presenter",
            name: "وضع المقدم",
            icon: "user",
            desc: "بداية يدوية للمؤقّت والسرقة وتحكم بالمباراة.",
          },
        ])}`;
      case 1:
        return `<h2>عرّفنا بالفريقين</h2><div class="chips team-name-presets" role="group" aria-label="أسماء جاهزة للفريقين">${[["colors","الأزرق والذهبي"],["kuwait","الديرة والبحر"],["friends","النجوم والأبطال"]].map(([id,label])=>`<button class="chip" data-team-action="team-name-preset" data-value="${id}">${label}</button>`).join("")}</div><div class="team-config-grid">${draft.teams.map((t, i) => `<section class="team-config-card stack" style="--team-color:${t.color}"><h3>${i ? "الفريق الثاني" : "الفريق الأول"}</h3>${teamField("اسم الفريق", `team-name-${i}`, `<input id="team-name-${i}" maxlength="24" value="${esc(t.name)}" data-team-index="${i}" data-team-field="name">`)}${teamField("اللون", `team-color-${i}`, `<select id="team-color-${i}" data-team-index="${i}" data-team-field="color">${COLORS.map((c, j) => `<option value="${c}" ${c === t.color ? "selected" : ""}>${["أزرق", "ذهبي", "أخضر", "بنفسجي", "وردي", "برتقالي"][j]}</option>`).join("")}</select>`)}<div class="team-avatar-picks">${TEAM_AVATARS.map((a) => `<button class="team-avatar ${t.avatar === a ? "selected" : ""}" data-team-action="team-avatar" data-team="${i}" data-value="${a}" aria-label="رمز الفريق ${a}" aria-pressed="${t.avatar === a}">${a}</button>`).join("")}</div>${teamField("أسماء المشاركين · اسم في كل سطر", `team-players-${i}`, `<textarea id="team-players-${i}" rows="3" maxlength="400" data-team-index="${i}" data-team-field="players">${esc(t.players.join("\n"))}</textarea>`)}</section>`).join("")}</div>${selectField(
          "starter",
          "من يبدأ؟",
          [
            ["0", "الفريق الأول"],
            ["1", "الفريق الثاني"],
            ["random", "اختيار عشوائي عند بدء المباراة"],
          ],
        )}`;
      case 2:
        return categorySelection();
      case 3:
        return `<h2>أي لوحة تفضلون؟</h2>${draft.variant==="custom"?`<section class="custom-board-options stack"><h3>حجم المباراة المخصصة</h3><div class="chips" role="group" aria-label="عدد الفئات">${[2,4,6].map(n=>`<button class="chip ${draft.categoryCount===n?"selected":""}" data-team-action="category-count" data-value="${n}" aria-pressed="${draft.categoryCount===n}">${n} فئات</button>`).join("")}</div><div class="chips" role="group" aria-label="قيم النقاط">${[200,400,600].map(value=>`<button class="chip ${pointValues().includes(value)?"selected":""}" data-team-action="point-value" data-value="${value}" aria-pressed="${pointValues().includes(value)}">${value} نقطة</button>`).join("")}</div><p class="muted">فئتان أو 4 أو 6 بالتساوي بين الفريقين، وقيمة واحدة على الأقل. لكل قيمة خانة واحدة أو خانتان حسب اللوحة.</p></section>`:""}${choices("board", [
          {
            id: "compact",
            name: "المختصرة · مباراة سريعة",
            icon: "bolt",
            desc: "خانة واحدة لكل قيمة مختارة في الفئة. الافتراضي: 18 سؤالًا من 6 فئات.",
          },
          {
            id: "classic",
            name: "الكلاسيكية",
            icon: "cup",
            desc: "خانتان بسؤالين مختلفين لكل قيمة مختارة. الافتراضي: 36 سؤالًا من 6 فئات.",
          },
        ])}<p class="muted">المجموع الأساسي المتاح: ${num(boardPoints())} نقطة، قبل أي مساعدات أو مكافآت. لا تُغيّر اللوحة أثناء المباراة.</p>`;
      case 4:
        return `<h2>طريقة الإجابة</h2>${choices("answerStyle", [
          {
            id: "oral",
            name: "شفهي بإدارة المقدم",
            icon: "sound",
            desc: "بلا خيارات ظاهرة. ناقشوا الإجابة ثم يدير المقدم السرقة والكشف والتحكيم.",
          },
          {
            id: "choice",
            name: "اختيارات متعددة",
            icon: "check",
            desc: "اختيارات مخلوطة ومفتاح صحيح واحد. الإجابة الخاطئة تفتح السرقة إن كانت مفعلة.",
          },
          {
            id: "typed",
            name: "كتابة الإجابة",
            icon: "book",
            desc: "مطابقة بعد إزالة التشكيل وتوحيد الهمزات، مع بدائل معتمدة وتصحيح يدوي للمقدم.",
          },
        ])}${
          draft.answerStyle === "choice"
            ? selectField("choiceCount", "عدد الاختيارات", [
                [4, "4 خيارات · الافتراضي"],
                [3, "3 خيارات"],
              ])
            : ""
        }<p class="muted">في الشفهي: استخدم «إجابة خاطئة · فرصة السرقة» عند المحاولة الخاطئة، أو «بلا إجابة · تمرير للمنافس» دون تسجيل خطأ قبل كشف الإجابة إذا أخفق الفريق. بعد الكشف، اختر الفريق أو «محد جاوب صح» للعودة إلى اللوحة مباشرة.</p>`;
      case 5:
        return `<h2>الوقت على راحتكم</h2>${toggleField("timer", "تفعيل مؤقّت الإجابة")}<div class="chips">${[15, 30, 45, 60, 90, 120].map((n) => `<button class="chip ${draft.duration === n ? "selected" : ""}" data-team-action="duration" data-value="${n}">${n} ثانية</button>`).join("")}</div><div class="team-settings-grid">${numberField("duration", "مدة الإجابة المخصصة · ثانية", 5, 600)}${numberField("stealDuration", "مدة السرقة المستقلة · ثانية", 5, 120)}${numberField("callDuration", "مهلة الاتصال بصديق · ثانية", 10, 300)}${selectField(
          "transition",
          "بداية فرصة السرقة",
          [
            ["auto", "تلقائية عند إخفاق الفريق"],
            ["host", "بأمر المقدم بعد شاشة الاستعداد"],
          ],
        )}</div>${toggleField("callPause", "إيقاف مؤقّت السؤال أثناء الاتصال")}<p class="muted">الافتراضي 60 ثانية للفريق و10 للمنافس. لا يعمل المؤقّت أثناء كشف الإجابة أو شرح النقاط أو اللوحة.</p>`;
      case 6:
        return `<h2>اختاروا أدواتكم</h2><div class="assist-presets" role="group" aria-label="قوالب المساعدات"><button class="team-choice" data-team-action="assist-preset" data-value="classic"><strong>كلاسيكي</strong><small>المفاهيم الأصلية الخمسة؛ لكل فريق 3 أنواع. تفاصيل الحسم غير الموثقة قواعد منزلية.</small></button><button class="team-choice" data-team-action="assist-preset" data-value="enhanced"><strong>موسّع</strong><small>يضيف التلميح والمضاعفة والوقت والفرصة الثانية والتخطي كقواعد مخصصة واضحة.</small></button></div><details class="assist-advanced" id="team-assist-custom"><summary>تخصيص المساعدات لكل فريق</summary><div class="row"><button class="btn secondary small" data-team-action="helpers-all" data-value="on">إتاحة الجميع</button><button class="btn secondary small" data-team-action="helpers-all" data-value="off">تعطيل الجميع</button></div>${selectField(
          "assistSlots",
          "عدد أنواع المساعدات لكل فريق",
          Array.from({ length: 6 }, (_, i) => [i, String(i)]),
        )}<div class="assist-config-grid">${Object.entries(HELP)
          .map(
            ([id, h]) =>
              `<div class="assist-config-card"><label class="team-toggle"><span>${icon(h.icon)} <strong>${h.name}</strong></span><input type="checkbox" data-assist-enable="${id}" ${draft.assistEnabled[id] ? "checked" : ""}></label><p class="muted">${h.rule}</p>${teamField("مرات الاستخدام لكل فريق", `limit-${id}`, `<input id="limit-${id}" type="number" inputmode="numeric" min="0" max="5" value="${draft.assistLimits[id]}" data-assist-limit="${id}">`)}</div>`,
          )
          .join("")}</div>${draft.teams
          .map(
            (t, i) =>
              `<section class="assist-team-picks"><h3>${esc(t.name)} · ${t.assists.length}/${draft.assistSlots}</h3><div class="chips">${Object.entries(
                HELP,
              )
                .filter(
                  ([id]) =>
                    draft.assistEnabled[id] && draft.assistLimits[id] > 0,
                )
                .map(
                  ([id, h]) =>
                    `<button class="assist-chip chip ${t.assists.includes(id) ? "selected" : ""}" data-team-action="pick-assist" data-team="${i}" data-key="${id}" aria-pressed="${t.assists.includes(id)}">${h.name}</button>`,
                )
                .join("")}</div></section>`,
          )
          .join(
            "",
          )}<small class="muted">لكل فريق رصيد مستقل. المساعدات المعطلة أو النافدة لا تظهر أثناء اللعب، ولا تُستهلك إلا عند تفعيلها.</small></details>`;
      case 7:
        return `<h2>قواعد إضافية واضحة</h2>${toggleField("steal", "إتاحة سرقة السؤال")}${toggleField("stealPenalty", "خصم قيمة السؤال عند إخفاق السرقة", "متوقف افتراضيًا. لا يغيّر عقوبة الفخ المستقلة.")}${toggleField("negative", "السماح بالأرصدة السالبة", "عند التعطيل يتوقف أي خصم عند 0.")}${toggleField("bonus", "مكافأة صاحب الاختيار", "قاعدة مخصصة: +50 نقطة إذا أجاب صاحب الاختيار إجابة صحيحة، قبل أي خصم مستقل. ليست مكافأة زمنية.")}${toggleField("sound", "مؤثرات المباراة الصوتية")}${toggleField("animations", "حركات المباراة")}${toggleField("explanations", "عرض الشروح والمصادر بعد الكشف")}${toggleField("hints", "إتاحة التلميحات")}${selectField("repetition", "تكرار الأسئلة", [["recent","تجنب الأسئلة الحديثة · الافتراضي"],["unseen","تفضيل غير المشاهد"],["all","السماح بالجميع"]])}<p class="muted">تُتجنب أسئلة آخر 3 مباريات أو آخر 30 يومًا متى كفى البديل. عند نفاد البدائل، تُستخدم أقدم الأسئلة المسموح بها مع تنبيه؛ لا تتغير حدود الحرق.</p>${toggleField("pitFailPenalty", "خصم قيمة السؤال عند إخفاق مستخدم الحفرة")}${selectField(
          "trapSuccess",
          "عند نجاح الفريق الذي استقبل الفخ",
          [
            ["responder", "يحصل على قيمة السؤال"],
            ["none", "لا يمنح أحد نقاطًا"],
          ],
        )}<p class="muted">هذه الخيارات مخصصة لنسختكم. لا تُنسب خيارات الفخ والرصيد السالب والمكافآت إلى قواعد رسمية لم توثقها الصفحات العامة.</p>`;
      case 8:
        return `<h2>كل شيء جاهز للمواجهة؟</h2>${summary(draft)}<button class="btn secondary" data-team-action="save-preset">حفظ هذه الإعدادات باسم</button><p class="inline-note">بعد البدء، تُحفظ نسخة ثابتة من القواعد. تعديل الإعدادات العامة لا يغير المباراة الجارية.</p>`;
    }
  }
  function answerLabel(c) {
    return c.answerStyle === "oral"
      ? "إجابة شفهية"
      : c.answerStyle === "typed"
        ? "إجابة مكتوبة"
        : `${c.choiceCount} اختيارات`;
  }
  function summary(c) {
    return `<div class="team-config-grid">${c.teams
      .map(
        (t, i) =>
          `<div class="team-config-card stack" style="--team-color:${t.color}"><h3>${esc(t.avatar)} ${esc(t.name)}</h3><p>${t.categories.map((id) => catById(id)?.name || "").join(" · ") || "لم تُختر الفئات"}</p><small>${
            t.assists
              .filter((id) => c.assistEnabled[id] && c.assistLimits[id] > 0)
              .map((id) => `${HELP[id].name} ×${c.assistLimits[id]}`)
              .join(" · ") || "بلا مساعدات"
          }</small></div>`,
      )
      .join(
        "",
      )}</div><div class="grid-2"><p>اللوحة: <strong>${c.board === "compact" ? "خانة واحدة لكل قيمة" : "خانتان لكل قيمة"} · ${boardSize(c)} سؤالًا</strong></p><p>النقاط الأساسية: <strong>${num(boardPoints(c))}</strong></p><p>الإجابة: <strong>${answerLabel(c)}</strong></p><p>البداية: <strong>${c.starter === "random" ? "اختيار عشوائي" : teamName(Number(c.starter), c)}</strong></p><p>المؤقّت: <strong>${c.timer ? `${c.duration} ثانية` : "معطل"}</strong></p><p>السرقة: <strong>${c.steal ? `${c.stealDuration} ثانية${c.timer ? "" : " · بلا مؤقّت"}` : "معطلة"}</strong></p><p>الرصيد السالب: <strong>${c.negative ? "مسموح" : "غير مسموح"}</strong></p><p>المكافآت: <strong>${c.bonus ? "مفعلة" : "معطلة"}</strong></p></div>`;
  }
  function validateStep() {
    if (step === 1) {
      if (draft.teams.some((t) => !t.name.trim())) {
        toast("أدخل اسمًا لكل فريق.");
        return false;
      }
    }
    if (step === 2) {
      const cats = draft.teams.flatMap((t) => t.categories);
      if (
        draft.teams.some((t) => t.categories.length !== categoryQuota()) ||
        new Set(cats).size !== categoryQuota()*2
      ) {
        toast(`اختر ${categoryQuota()} ${categoryQuota()===1?"فئة":"فئات"} مختلفة لكل فريق.`);
        return false;
      }
    }
    if (
      step === 5 &&
      (!Number.isInteger(draft.duration) ||
        draft.duration < 5 ||
        draft.duration > 600 ||
        !Number.isInteger(draft.stealDuration) ||
        draft.stealDuration < 5 ||
        draft.stealDuration > 120)
    ) {
      toast("اضبط وقت الإجابة من 5 إلى 600 ثانية والسرقة من 5 إلى 120 ثانية.");
      return false;
    }
    return true;
  }
  function startMatch() {
    const errors = TeamEngine.validateConfig(draft, bank());
    if (errors.length) {
      toast(errors[0]);
      render();
      return;
    }
    const run = () => {
      try {
        store.match = TeamEngine.create(draft, bank(), {
          seed: Date.now(),
          now: Date.now(),
          seen: progress.seen,
          recentMatches: store.history.map(h => ({at:h.at,questionIds:h.history.filter(r=>r.at >= (prefs.questionHistoryResetAt || 0)).map(r=>r.questionId)})).filter(h=>h.questionIds.length).slice(0,3),
        });
        store.preferred = deep(draft);
        write();
        closeDialog();
        go("teamMatch");
        if (store.match.selectionWarnings?.length) toast(store.match.selectionWarnings[0]);
      } catch (e) {
        toast(errText(e));
      }
    };
    if (active()) {
      openDialog(
        "استبدال المباراة المحفوظة؟",
        "<p>المباراة الحالية لم تكتمل. استبدالها لا يمس سجل المباريات المكتملة. يمكنك تصدير حفظ متابعة أولًا.</p>",
        '<button class="btn primary" id="team-confirm-start">بدء المباراة الجديدة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>',
      );
      $("#team-confirm-start").addEventListener("click", run, { once: true });
    } else run();
  }
  function scoreboard(s) {
    const changed = s.teams.map((t,i)=>lastScores?.[i] !== undefined && lastScores[i] !== t.score); lastScores=s.teams.map(t=>t.score);
    return `<section class="team-scoreboard" aria-label="رصيد الفريقين">${s.teams.map((t, i) => `<div class="team-scorecard ${s.turn === i ? "active" : ""} ${changed[i] ? "score-changed" : ""}" style="--team-color:${t.color}"><span class="team-score-avatar">${esc(t.avatar)}</span><div><span class="score-name">${esc(t.name)}</span><strong class="score-value" dir="ltr">${num(t.score)}</strong><small class="score-detail">صح ${t.correct} · خطأ ${t.incorrect} · سرقات ${t.steals}</small></div>${s.turn === i ? '<span class="team-turn-badge">صاحب الاختيار</span>' : ""}</div>`).join("")}</section>`;
  }
  function toolbar(s) {
    const left = s.board.filter((t) => !t.done).length;
    return `<div class="match-toolbar"><div><span class="eyebrow">${s.config.board === "compact" ? "اللوحة المختصرة" : "اللوحة الكلاسيكية"} · ${left} سؤالًا متبقيًا</span><h1 id="team-match-heading" tabindex="-1">${s.state === "BOARD" ? `الدور على ${esc(s.teams[s.turn].name)}` : "سين جيم خالد"}</h1></div><div class="match-controls"><button class="icon-btn" data-team-action="quiet" aria-label="${prefs.sound || prefs.music ? "تفعيل الوضع الهادئ" : "إلغاء الوضع الهادئ"}" aria-pressed="${!prefs.sound && !prefs.music}">${icon("sound")}</button><button class="icon-btn" data-team-action="pause-menu" aria-label="قائمة المباراة">${icon("pause")}</button><button class="icon-btn" data-team-action="rules" aria-label="دليل القواعد">${icon("help")}</button><button class="icon-btn" data-action="fullscreen" aria-label="ملء الشاشة">${icon("expand")}</button></div></div>`;
  }
  function matchScreen() {
    const s = m();
    if (!s)
      return `<div class="panel match-empty"><h1>لنجهّز أول مباراة</h1><button class="btn primary" data-team-action="new">إعداد فريقين</button></div>`;
    if (s.state === "MATCH_COMPLETE") return storageNotice() + resultsScreen();
    let content = "";
    if (s.state === "BOARD") content = boardScreen(s);
    else if (s.state === "QUESTION_PREVIEW") content = previewScreen(s);
    else if (s.state === "PAUSED")
      content = `<div class="panel pause-card stack"><span class="mode-icon">${icon("pause")}</span><h2>المباراة متوقفة مؤقتًا</h2><p class="muted">الوقت والنقاط محفوظة. لن تبدأ المهلة إلا عند المتابعة.</p><button class="btn primary" data-team-action="engine" data-type="RESUME">متابعة المباراة ${icon("play")}</button><button class="btn secondary" data-team-action="home">حفظ والعودة للرئيسية</button></div>`;
    else if (s.state === "TURN_COMPLETE") content = receiptScreen(s);
    else content = questionScreen(s);
    return `<div class="team-page ${s.config.mode === "presenter" ? "presenter-view" : ""}">${storageNotice()}${toolbar(s)}${scoreboard(s)}${content}</div>`;
  }
  function liveHistory(s) {
    if (!s.history.length && !s.transactions.length) return "";
    return `<details class="match-live-history panel"><summary>سجل هذه المباراة · ${s.history.length} سؤالًا مكتملًا</summary><div class="stack">${s.history.slice().reverse().map(h => `<div class="live-outcome"><span>${catById(s.board.find(t=>t.id===h.tileId)?.category)?.name || "سؤال"} · ${h.value} نقطة</span><strong>${h.winner === null ? "محد جاوب صح" : esc(s.teams[h.winner].name)}</strong>${h.phase === "steal" && h.winner !== null ? '<small>سرقة ناجحة</small>' : ""}</div>`).join("")}${transactionList(s)}<button class="btn secondary" data-team-action="undo" ${s.undo.length ? "" : "disabled"}>تراجع عن آخر إجراء</button></div></details>`;
  }
  function boardScreen(s) {
    const completed = s.board.filter(t=>t.done).length;
    const outcomes = new Map(s.history.map(h=>[h.tileId,h]));
    return `${!completed ? `<section class="team-introduction" aria-label="بداية المواجهة"><strong>${esc(s.teams[0].avatar)} ${esc(s.teams[0].name)}</strong><span>تبدأ المواجهة</span><strong>${esc(s.teams[1].avatar)} ${esc(s.teams[1].name)}</strong></section>` : ""}<div class="board-tools"><p class="board-progress-label">اكتمل <strong>${completed}</strong> من ${s.board.length} سؤالًا</p><div class="row"><button class="btn secondary board-undo" data-team-action="undo" ${s.undo.length ? "" : "disabled"}>${icon("history")} تراجع عن آخر إجراء</button>${canArmPit(s) ? `<button class="btn secondary ${armedPitTeam === s.turn ? "pit-armed" : ""}" data-team-action="arm-pit" aria-pressed="${armedPitTeam === s.turn}">${icon("shield")} ${armedPitTeam === s.turn ? "الحفرة جاهزة · اضغط لإلغائها" : "الحفرة للسؤال التالي"}</button>` : ""}</div></div>${armedPitTeam === s.turn ? '<p class="inline-note" role="status">ستُفعّل الحفرة قبل فتح السؤال التالي. لن تُستهلك قبل اختيار خانة.</p>' : ""}<div class="match-progress" role="progressbar" aria-label="تقدم المباراة" aria-valuemin="0" aria-valuemax="${s.board.length}" aria-valuenow="${completed}"><span style="width:${completed / s.board.length * 100}%"></span></div><div class="match-board" data-board="${s.config.board}" data-category-count="${s.categories.length}" style="--columns:${s.categories.length}">${s.categories.map(id => {
      const cat=catById(id), owner=s.config.teams.findIndex(t=>t.categories.includes(id)), tiles=s.board.filter(t=>t.category===id), allDone=tiles.every(t=>t.done);
      return `<section class="match-category ${allDone ? "category-complete" : ""}" style="--accent:${cat.color}"><div class="board-art">${categoryArt(id)}</div><h2 class="board-title">${cat.name}${allDone ? '<span class="sr-only"> · اكتملت الفئة</span>' : ''}</h2><small class="muted">اختيار ${esc(s.teams[owner].name)}</small><div class="match-tiles ${s.config.board}" style="--value-count:${pointValues(s.config).length}">${tiles.map(t=>{
        const h=outcomes.get(t.id), winner=h?.winner ?? null, label=t.done ? winner===null ? "محد جاوب صح" : s.teams[winner].name : s.config.board === "classic" ? `السؤال ${t.slot+1}` : "نقطة";
        return `<button class="match-tile ${t.done ? "used" : ""} ${t.done && winner !== null ? "won-team-"+winner : ""}" data-team-action="tile" data-id="${esc(t.id)}" data-value="${t.value}" data-winner="${t.done ? winner ?? "none" : ""}" ${t.done ? "disabled" : ""} ${t.done && winner !== null ? `style="--tile-team-color:${s.teams[winner].color}"` : ""} aria-label="${cat.name}، ${t.value} نقطة، السؤال ${t.slot+1}${t.done ? "، مكتمل، "+esc(label) : ""}"><strong>${t.value}</strong><small>${t.done ? icon(winner===null ? "close" : "check") : ""}${esc(label)}</small></button>`;
      }).join("")}</div></section>`;
    }).join("")}</div>${liveHistory(s)}`;
  }
  function previewScreen(s) {
    const c = s.current,
      q = TeamEngine.getQuestion(s, c.questionId, bank());
    return `<section class="panel pause-card stack"><span class="eyebrow">قبل كشف السؤال</span><h2>${catById(q.category).name} · ${c.value} نقطة</h2><p>يجيب ${esc(s.teams[c.responder].name)}. يمكن تفعيل الحفرة الآن فقط؛ بعد ظهور السؤال تُغلق هذه المساعدة.</p>${assists(s, true)}<button class="btn primary" data-team-action="engine" data-type="START_QUESTION">${icon("eye")} إظهار السؤال${s.config.timer && s.config.mode !== "presenter" ? " وبدء الوقت" : ""}</button></section>`;
  }
  function formatInstructions(q, s, revealed = false) {
    const labels={ordering:"ترتيب العناصر",clues:"من صاحب القرائن؟",multipart:"سؤال متعدد الأجزاء",logic:"منطق واستنتاج"};
    const instructions=q.instructions ? `<p class="question-instructions">${esc(q.instructions)}</p>` : "";
    let content="";
    if (q.type === "ordering" && q.items) content=`<ul class="ordering-items" aria-label="العناصر المطلوب ترتيبها">${(revealed?q.correctOrder:q.items).map(item=>`<li>${esc(item)}</li>`).join("")}</ul>`;
    if (q.type === "multipart" && q.parts) content=`<ol class="multipart-parts" aria-label="أجزاء السؤال">${q.parts.map(part=>`<li>${esc(part)}</li>`).join("")}</ol>`;
    if (q.type === "clues" && q.clues) {
      const shown=revealed?q.clues.length:Math.max(1,Math.min(q.clues.length,s?.current?.revealedClues || 1));
      content=`<div class="progressive-clues" id="progressive-clues" tabindex="-1"><ol aria-label="القرائن المكشوفة">${q.clues.slice(0,shown).map(clue=>`<li>${esc(clue)}</li>`).join("")}</ol>${!revealed&&shown<q.clues.length&&["QUESTION_ACTIVE","STEAL_OPPORTUNITY"].includes(s?.state)?`<button class="btn secondary" data-team-action="next-clue" data-token="${esc(s.current.token)}">القرينة التالية · ${shown}/${q.clues.length}</button>`:""}<span class="sr-only" role="status">${shown} من ${q.clues.length} قرائن مكشوفة</span></div>`;
    }
    return `${labels[q.type]?`<span class="pill format-label">${labels[q.type]}</span>`:""}${instructions}${content}`;
  }
  function questionMedia(q, revealed = false) {
    if (!q.image) return "";
    if (!VISUALS[q.image]) return '<p class="inline-note warning" role="alert">الصورة اللازمة لهذا السؤال غير متاحة في هذه النسخة. أوقف المؤقّت ومرّر السؤال بلا إجابة إذا تعذّر حسمه بعدل؛ حُفظ نصه وسجل المباراة.</p>';
    const v = VISUALS[q.image];
    return `<figure class="match-media"><img src="${imageSrc(q.image)}" alt="${esc(questionAlt(q,revealed))}" width="600" height="360" decoding="async"><button class="zoom-btn icon-btn" data-team-action="zoom" data-key="${esc(q.image)}" aria-label="تكبير صورة السؤال">${icon("expand")}</button><figcaption>صورة محلية للسؤال · الإسناد والرخصة بعد الكشف</figcaption></figure>`;
  }
  function questionScreen(s) {
    const c=s.current, q=TeamEngine.getQuestion(s,c.questionId,bank()), revealed=c.revealed || ["ANSWER_REVEAL","SCORE_ADJUDICATION"].includes(s.state), steal=c.phase==="steal", trap=c.phase==="trap";
    if (s.state === "ASSISTANCE_ACTIVE") return `<section class="panel pause-card stack"><span class="mode-icon">${icon("sound")}</span><h2>اتصال بصديق · ${esc(s.teams[c.responder].name)}</h2><p>استعينوا بصديق الآن؛ لا تجري اللعبة اتصالًا تلقائيًا.</p><div class="panel stack"><h3>السؤال للصديق</h3><p>${esc(q.q)}</p>${questionMedia(q)}${formatInstructions(q,s)}</div><div class="match-timer" id="team-timer" role="timer" aria-label="الوقت المتبقي للمساعدة">${timerLabel(s)}</div><p class="muted">${s.config.callPause ? "مؤقّت السؤال متوقف خلال المساعدة." : "مؤقّت السؤال مستمر."}</p><button class="btn primary" data-team-action="engine" data-type="RETURN_ASSISTANCE">العودة للسؤال</button></section>`;
    const question = `${questionMedia(q,revealed)}<h2 class="match-question-text" id="team-question-heading" tabindex="-1">${esc(q.q)}</h2>${formatInstructions(q,s,revealed)}`;
    const modifiers = `${c.hint && !revealed ? `<p class="hint-box">${icon("help")} ${esc(safeHint(q))}</p>` : ""}${c.twice && !revealed ? '<p class="pill">جاوب جوابين: اقتراحان ضمن المهلة نفسها</p>' : ""}${c.doubleTeam === c.responder ? '<p class="pill">مضاعفة النقاط مفعّلة</p>' : ""}${c.pitTeam !== null ? `<p class="pill">الحفرة لصالح ${esc(s.teams[c.pitTeam].name)}</p>` : ""}${c.sitout ? `<p class="pill">استريح: ${esc(c.sitout.participant)}</p>` : ""}`;
    return `${steal && !revealed ? `<section class="steal-banner"><span>${icon("bolt")} فرصة السرقة</span><strong>${esc(s.teams[c.responder].name)}</strong></section>` : ""}${trap && !revealed ? `<section class="trap-banner"><strong>${icon("flag")} سؤال الفخ · ${esc(s.teams[c.responder].name)}</strong><p>تُطبّق عقوبة الإخفاق المفعّلة عند الحسم.</p></section>` : ""}<div class="match-question-grid ${revealed ? "answer-state" : ""}"><section class="match-question-panel panel stack"><div class="question-context row"><span class="pill">${catById(q.category).name} · ${c.value} نقطة</span><span class="muted">${revealed ? "صاحب الاختيار" : "المستجيب"}: ${esc(s.teams[revealed ? c.selector : c.responder].name)}</span>${!revealed ? `<span class="match-timer" id="team-timer" role="timer" aria-label="الوقت المتبقي">${timerLabel(s)}</span>` : ""}</div>${revealed ? `${revealScreen(s,q)}<details class="original-question"><summary>السؤال${q.image ? " والصورة" : ""}</summary><div class="stack">${question}</div></details>` : `${question}${modifiers}${answerControls(s,q)}`}</section><aside class="match-aside">${!revealed ? assists(s) : ""}<section class="panel question-report"><button class="text-btn" data-team-action="report" data-id="${esc(q.id)}">الإبلاغ عن سؤال ${icon("flag")}</button></section></aside></div>`;
  }
  function answerControls(s, q) {
    const c = s.current,
      extra = c.twiceTeam === c.responder || c.secondTeam === c.responder,
      attemptCount = c.attempts.filter((a) => a.teamId === c.responder).length;
    let html = "";
    if (s.config.answerStyle === "choice")
      html = `<div class="answers-grid">${c.choices.map((idx, i) => `<button class="answer-card" data-team-action="answer" data-value="${idx}" ${c.attempts?.some((a) => a.teamId === c.responder && a.values?.includes(idx)) ? "disabled" : ""}><span class="answer-key">${i + 1}</span><span class="answer-label" dir="auto">${esc(q.options[idx])}</span></button>`).join("")}</div>`;
    if (s.config.answerStyle === "typed")
      html = `<form id="team-answer-form" class="stack"><label for="team-answer-input">إجابة ${esc(s.teams[c.responder].name)}</label><input id="team-answer-input" name="answer" maxlength="180" autocomplete="off" required><small class="muted">تُوحّد الهمزات ويُحذف التشكيل. تظل التاء المربوطة والهاء، والألف المقصورة والياء، حروفًا متميزة. للمقدم تصحيح المطابقة بعد الكشف.</small><button class="btn primary" type="submit">اعتماد الإجابة</button></form>`;
    return `${extra && attemptCount === 1 ? '<p class="inline-note" role="status">الاقتراح الأول غير مطابق؛ بقيت محاولة ثانية.</p>' : ""}${html}<div class="question-actions"><button class="btn primary reveal-primary" data-team-action="reveal">${icon("eye")} كشف الإجابة</button><div class="host-inline-controls">${s.config.timer && !c.timerStarted ? `<button class="btn secondary" data-team-action="engine" data-type="${s.state === "STEAL_OPPORTUNITY" ? "START_STEAL" : "START_TIMER"}">${icon("clock")} ابدأ المؤقّت</button>` : ""}<button class="btn secondary" data-team-action="pause-menu">${icon("pause")} إيقاف مؤقت</button></div><details class="attempt-controls"><summary>إدارة المحاولات والسرقة</summary><div class="row"><button class="btn secondary" data-team-action="incorrect">${extra && attemptCount === 0 ? "الاقتراح الأول غير صحيح" : c.phase === "first" && s.config.steal ? "إجابة خاطئة · فرصة السرقة" : "إجابة خاطئة · إنهاء المحاولة"}</button><button class="btn secondary" data-team-action="engine" data-type="PASS">${c.phase === "first" && s.config.steal ? "بلا إجابة · تمرير للمنافس" : "بلا إجابة · إنهاء السؤال"}</button></div></details></div>`;
  }
  function revealScreen(s, q) {
    const c=s.current;
    const outcomes=s.teams.map((_,i)=>TeamEngine.scoreOutcome(s,i));
    const nobody=TeamEngine.scoreOutcome(s,null);
    const identity=`data-question-id="${esc(c.questionId)}" data-tile-id="${esc(c.tileId)}" data-token="${esc(c.token)}"`;
    const notes=outcomes.map((outcome,i)=>`<p><strong>${esc(s.teams[i].name)}:</strong> ${outcome.deltas.map((delta,index)=>`${esc(s.teams[index].name)} ${delta>0?"+":""}${num(delta)}`).join(" · ")}</p>`).join("");
    return `<section class="answer-reveal stack"><span class="eyebrow">الإجابة الصحيحة</span><strong class="canonical-answer" tabindex="-1" dir="auto">${esc(q.correctAnswer || q.options[q.answer])}</strong><div class="adjudication-grid scoring-actions" role="group" aria-label="حسم السؤال بضغطة واحدة">${s.teams.map((t,i)=>`<button class="award-team btn" data-team-action="award" data-team="${i}" ${identity} style="--team-color:${t.color}"><span class="scoring-team-name">${esc(t.avatar)} ${esc(t.name)}<span class="sr-only"> أجاب إجابة صحيحة</span></span><strong class="scoring-points" dir="ltr">${outcomes[i].earned>0?"+":""}${num(outcomes[i].earned)}</strong></button>`).join("")}<button class="btn scoring-nobody" data-team-action="award" data-team="none" ${identity}><span>⚪ محد جاوب صح</span><strong class="scoring-points" dir="ltr">0</strong></button></div>${c.skip ? '<p class="muted">سؤال متخطّى؛ لا مكافأة نقاط لأي فريق.</p>' : ""}${q.judging ? `<p class="full-credit-judging"><strong>التحكيم:</strong> ${esc(q.judging)}</p>` : ""}${s.config.explanations ? `<p class="answer-explanation">${esc(q.explanation)}</p>` : ""}<details class="answer-reference"><summary>المراجع وتفاصيل الاحتساب</summary><div class="stack">${q.acceptedAnswers?.length ? `<p>بدائل مقبولة: ${q.acceptedAnswers.map(esc).join("، ")}</p>` : ""}${s.config.explanations ? `<p>${esc(q.source.title)} · ${esc(q.source.reference)}</p>${q.source.url ? `<a class="source-link" href="${esc(safeURL(q.source.url))}" target="_blank" rel="noopener noreferrer">فتح المرجع</a>` : `<p>${esc(q.source.bibliography || "")}</p>`}` : ""}${q.image ? mediaCredit(q.image) : ""}<p class="muted">اختيار الفريق المنافس يُسجّل سرقة عند تفعيلها، ما لم يكن السؤال فخًا. لا تُضاف إجابة خاطئة دون محاولة مسجلة. «محد جاوب صح» لا يضيف نقاطًا؛ الخصومات تتبع القواعد المفعّلة فقط.</p>${notes}${nobody.deltas.some(delta=>delta<0) ? `<p>عند عدم الإجابة: ${nobody.deltas.map((delta,i)=>`${esc(s.teams[i].name)} ${delta>0?"+":""}${num(delta)}`).join(" · ")}</p>` : ""}</div></details></section>`;
  }
  function assists(s, preview = false) {
    const c = s.current,
      t = s.teams[c.responder];
    const ids = Object.keys(t.assists || {}).filter(
      (id) =>
        t.assists[id] > 0 &&
        s.config.assistEnabled[id] &&
        HELP[id] &&
        (preview ? id === "pit" : id !== "pit") &&
        (!["hint"].includes(id) || s.config.hints) &&
        (!["time"].includes(id) || s.config.timer) &&
        (!["trap"].includes(id) || c.phase === "first") &&
        !c.usedAssists?.some((a) => a.key === id && a.teamId === c.responder) &&
        (!["trap"].includes(id) || !c.attempts.length) &&
        (!["twice", "second"].includes(id) ||
          (!c.attempts.some((a) => a.teamId === c.responder) &&
            c.twiceTeam !== c.responder &&
            c.secondTeam !== c.responder)),
    );
    if (!ids.length) return "";
    const sitout=choosingSitout && ids.includes("sitout") ? `<div class="inline-sitout" role="group" aria-label="اختيار المشارك المستريح"><label for="sitout-inline-participant">المشارك الذي يستريح من ${esc(s.teams[1-c.responder].name)}</label><select id="sitout-inline-participant">${s.teams[1-c.responder].players.map(name=>`<option>${esc(name)}</option>`).join("")}</select><div class="row"><button class="btn secondary" data-team-action="use-sitout">إراحة المشارك</button><button class="btn secondary" data-team-action="cancel-sitout">إلغاء</button></div></div>` : "";
    return `<section class="assist-bar panel"><h2>مساعدات ${esc(t.name)}</h2><div class="assist-actions">${ids.map((id) => `<button class="assist-action" data-team-action="assist" data-key="${id}">${icon(HELP[id].icon)}<span>${HELP[id].name}</span><small>${t.assists[id]} متبقية</small></button>`).join("")}${sitout}</div></section>`;
  }
  function reasonLabel(reason) {
    const labels = {
      correct: "إجابة صحيحة",
      steal: "سرقة ناجحة",
      pit: "خصم الحفرة",
      pit_penalty: "إخفاق الحفرة",
      trap: "الفخ",
      trap_penalty: "إخفاق الفخ",
      double: "مضاعفة النقاط",
      bonus: "مكافأة",
      correction: "تصحيح المقدم",
      "host-correction": "تصحيح المقدم",
      "trap-correct": "نجاح الفخ",
      "trap-failed": "إخفاق الفخ",
      "pit-failed": "إخفاق الحفرة",
      "steal-failed": "إخفاق السرقة",
      undo: "تراجع",
      normal: "إجابة صحيحة",
      trap_success: "نجاح الفخ",
      steal_penalty: "إخفاق السرقة",
    };
    return labels[reason] || "حركة نقاط";
  }
  function receiptScreen(s) {
    const c = s.current,
      transactions = s.transactions.filter(
        (t) => t.questionId === c.questionId,
      );
    return `<section class="panel pause-card stack"><span class="eyebrow">اكتمل السؤال · النقاط مسجلة</span><h2>الاختيار التالي لـ ${esc(s.teams[s.turn].name)}</h2><div class="stack">${transactions.map((t) => `<div class="match-transaction"><strong>${esc(s.teams[Number(t.teamId === 0 || t.teamId === "team-0" ? 0 : 1)].name)}</strong><span>${reasonLabel(t.reason)}${t.modifier === "double" ? " · مضاعفة النقاط" : t.modifier === "bonus" ? " · مكافأة 50 نقطة" : ""}${!s.config.negative && t.scoreAfter === 0 && t.scoreBefore < t.originalValue && ["pit", "trap-failed", "pit-failed", "steal-failed"].includes(t.reason) ? " · الخصم محدود بالرصيد المتاح" : ""}</span><b dir="ltr">${num(t.scoreBefore)} → ${num(t.scoreAfter)}</b></div>`).join("") || "<p>لا أحد استحق مكافأة لهذا السؤال.</p>"}</div><button class="btn primary" data-team-action="engine" data-type="NEXT_TURN">${s.board.every((t) => t.done) ? "نتيجة المباراة" : "العودة للوحة"} ${icon("arrow")}</button><button class="btn secondary" data-team-action="undo">التراجع عن حسم السؤال</button></section>`;
  }
  function mediaCredit(key) {
    const v = VISUALS[key];
    return v
      ? `<p class="muted media-credit">${esc(v.credit)} · ${esc(v.license)} ${v.source ? `<a class="source-link" href="${esc(safeURL(v.source))}" target="_blank" rel="noopener noreferrer">مصدر الصورة</a>` : ""} ${v.licenseUrl ? `<a class="source-link" href="${esc(safeURL(v.licenseUrl))}" target="_blank" rel="noopener noreferrer">رخصة الصورة</a>` : ""}</p>`
      : "";
  }
  function timerLabel(s) {
    const c = s.current;
    if (!s.config.timer && s.state !== "ASSISTANCE_ACTIVE") return "بلا مؤقّت";
    const deadline =
      s.state === "ASSISTANCE_ACTIVE"
        ? c.assistance?.deadline || c.assistDeadline || c.deadline
        : c.deadline;
    return deadline
      ? `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))} ث`
      : c.timerStarted ? `${Math.ceil((c.remainingMs || 0) / 1000)} ث · متوقف` : `${Math.ceil((c.remainingMs || 0) / 1000)} ث · لم يبدأ`;
  }
  function startTicker() {
    clearInterval(tickHandle);
    tickHandle = null;
    const s = m();
    if (
      route !== "teamMatch" ||
      !s ||
      !["QUESTION_ACTIVE", "STEAL_OPPORTUNITY", "ASSISTANCE_ACTIVE"].includes(
        s.state,
      ) ||
      (!s.config.timer && s.state !== "ASSISTANCE_ACTIVE")
    )
      return;
    const token = s.current?.token;
    const tick = () => {
      if (route !== "teamMatch" || m()?.current?.token !== token) return;
      const current = m(),
        c = current.current,
        now = Date.now(),
        deadline =
          current.state === "ASSISTANCE_ACTIVE"
            ? c.assistance?.deadline
            : c.deadline;
      const due =
        deadline !== null && Number.isFinite(deadline) && now >= deadline;
      const mainDue =
        current.state === "ASSISTANCE_ACTIVE" &&
        c.deadline !== null &&
        Number.isFinite(c.deadline) &&
        now >= c.deadline;
      if (due || mainDue) {
        store.match = TeamEngine.dispatch(
          current,
          { type: "TICK", token },
          bank(),
          now,
        );
        write();
        render();
        return;
      }
      const el = $("#team-timer");
      if (el) {
        el.textContent = timerLabel(current);
        const sec = Number.parseInt(el.textContent);
        el.classList.toggle("is-urgent", sec <= 5);
        if (
          sec !== lastTickSound &&
          sec <= 5 &&
          sec > 0 &&
          current.config.sound
        )
          sound("tick");
        lastTickSound = sec;
      }
    };
    tickHandle = setInterval(tick, 200);
    tick();
  }
  function revealAnswer() {
    if (!m()?.current) return;
    const next=dispatch({type:"REVEAL"});
    if (next?.state === "ANSWER_REVEAL" && next.config.sound) sound("reveal");
  }
  function resolveAward(button) {
    if (resolutionBusy) return;
    const s = m(), c = s?.current;
    if (!c?.revealed || c.resolved || button.dataset.questionId !== c.questionId || button.dataset.tileId !== c.tileId || button.dataset.token !== c.token) return;
    const winner = button.dataset.team === "none" ? null : Number(button.dataset.team);
    if (winner !== null && ![0,1].includes(winner)) return;
    resolutionBusy = true;
    lastScoreTapAt = Date.now();
    try {
      document.querySelectorAll('[data-team-action="award"]').forEach(el => { el.disabled = true; });
      dispatch({type:"RESOLVE_QUESTION",teamId:winner,questionId:c.questionId,tileId:c.tileId,token:c.token});
    } finally { resolutionBusy = false; }
  }
  function useAssist(key) {
    if (!m()?.current || !HELP[key]) return;
    if (key === "sitout") {
      choosingSitout=true;render();$("#sitout-inline-participant")?.focus({preventScroll:true});return;
    }
    const next=dispatch({type:"ASSIST",key,confirmed:true});
    if (next && !next.lastError) {
      $("#announcer").textContent=HELP[key].name+" مفعّلة";
      if (next.config.sound) sound("assist");
      if (next.state === "ASSISTANCE_ACTIVE") $("[data-type=RETURN_ASSISTANCE]")?.focus({preventScroll:true});
      else $("#team-question-heading")?.focus({preventScroll:true});
    }
  }
  function pauseMenu() {
    pause();
    render();
    openDialog(
      "إدارة المباراة",
      `<div class="stack"><p>الوقت متوقف أثناء هذه القائمة. يمكنك تصدير حفظ متابعة الآن إذا كان الحفظ التلقائي غير متاح.</p><button class="btn primary" data-team-action="resume-menu">متابعة المباراة</button><button class="btn secondary" data-team-action="score-panel">تصحيح النقاط يدويًا</button><button class="btn secondary" data-team-action="assist-history">سجل استخدام المساعدات</button><button class="btn secondary" data-team-action="undo">التراجع عن آخر إجراء</button><button class="btn secondary" data-team-action="history">سجل المباريات</button><button class="btn secondary" data-team-action="backup">حفظ متابعة للمقدم</button><button class="btn secondary" data-team-action="home">حفظ والعودة للرئيسية</button></div>`,
    );
  }
  function scorePanel() {
    const s = m();
    openDialog(
      "تصحيح النقاط · تحكم المقدم",
      `<form id="team-score-form" class="stack"><label for="correct-team">الفريق</label><select id="correct-team" name="team">${s.teams.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join("")}</select><label for="correct-delta">التعديل · موجب للإضافة وسالب للخصم</label><input id="correct-delta" name="delta" type="number" min="-10000" max="10000" step="1" required value="200"><label for="correct-reason">سبب التصحيح</label><input id="correct-reason" name="reason" maxlength="140" required><button class="btn primary" type="submit">تسجيل التصحيح</button></form>`,
    );
  }
  function matchStatistics(s) {
    return {
      completedQuestions: s.history.length,
      durationMs: Number.isFinite(s.timing?.elapsedMs) ? s.timing.elapsedMs : null,
      teams: s.teams.map((t,i)=>{
        const success=s.history.filter(h=>h.winner===i);
        const categoryPerformance=CATEGORIES.map(cat=>({category:cat.id,title:cat.name,correct:success.filter(h=>TeamEngine.getQuestion(s,h.questionId,bank())?.category===cat.id).length,incorrect:s.history.every(h=>Array.isArray(h.incorrectTeams)) ? s.history.filter(h=>h.incorrectTeams.includes(i)&&TeamEngine.getQuestion(s,h.questionId,bank())?.category===cat.id).length : null})).filter(row=>row.correct||row.incorrect);
        return {name:t.name,score:t.score,correct:t.correct,incorrect:t.incorrect,steals:t.steals,assistsUsed:t.assistHistory.length,accuracy:t.correct+t.incorrect?Math.round(100*t.correct/(t.correct+t.incorrect)):null,highestValue:success.length?Math.max(...success.map(h=>h.value)):null,categoryPerformance};
      })
    };
  }
  function statisticsPanel(s) {
    const stats=matchStatistics(s);
    return `<div class="result-stats-grid">${stats.teams.map(t=>`<section class="panel stack result-team-stats"><h3>${esc(t.name)}</h3><dl><div><dt>إجابات صحيحة</dt><dd>${t.correct}</dd></div><div><dt>محاولات خاطئة محسومة</dt><dd>${t.incorrect}</dd></div><div><dt>سرقات ناجحة</dt><dd>${t.steals}</dd></div><div><dt>مساعدات مستخدمة</dt><dd>${t.assistsUsed}</dd></div><div><dt>دقة الإجابات المحسومة</dt><dd>${t.accuracy===null?"—":t.accuracy+"%"}</dd></div><div><dt>أعلى قيمة لإجابة صحيحة</dt><dd>${t.highestValue===null?"—":t.highestValue+" نقطة"}</dd></div></dl>${t.categoryPerformance.length?`<h4>الأداء حسب الفئة</h4><div class="result-category-stats">${t.categoryPerformance.map(row=>`<p><span>${row.title}</span><strong>صح ${row.correct} · خطأ ${row.incorrect===null?"—":row.incorrect}</strong></p>`).join("")}</div>`:""}</section>`).join("")}</div><p class="muted">${stats.completedQuestions} سؤالًا محسومًا. ${stats.durationMs===null?"":`مدة اللعب المسجلة: ${Math.floor(stats.durationMs/60000)} دقيقة و${Math.floor(stats.durationMs/1000)%60} ثانية، باستثناء التوقفات الصريحة.`} لا تُعدّ التفويضات أو التخطي أو انتهاء الوقت إجابات خاطئة. ${s.statisticsVersion!==2?"إحصاءات الحفظ القديم محفوظة كما سُجلت؛ قد لا تتوافر تفاصيل محاولاته.":""}</p>`;
  }
  function resultsScreen() {
    const s = m(),
      scores = s.teams.map((t) => t.score),
      tie = scores[0] === scores[1],
      winner = s.teams[scores[1] > scores[0] ? 1 : 0];
    return `<div class="team-page">${scoreboard(s)}<section class="winner-card panel stack"><div class="result-trophy">${icon("cup")}</div><span class="eyebrow">اكتملت ${s.board.length} خانة</span><h1>${tie ? "تعادل يستحق جولة أخرى" : `الكأس لـ ${esc(winner.name)}`}</h1><p>${tie ? "معرفة متكافئة… والتحدي مستمر." : "مباراة جميلة، ومعرفة تستحق الاحتفال."}</p><div class="row"><button class="btn primary" data-team-action="rematch">إعادة بنفس القواعد</button><button class="btn secondary" data-team-action="new">تخصيص مباراة جديدة</button><button class="btn secondary" data-team-action="home">الرئيسية</button><button class="btn secondary" data-team-action="history">سجل المباريات</button><button class="btn secondary" data-team-action="undo" ${s.undo.length ? "" : "disabled"}>تراجع عن آخر نتيجة</button></div></section><div class="section-heading"><h2>حصيلة المباراة</h2><button class="text-btn" data-team-action="match-summary">تصدير الملخص ${icon("download")}</button></div>${statisticsPanel(s)}${transactionList(s)}<div class="section-heading"><h2>الأسئلة وتفسيراتها</h2></div><div class="stack">${s.history
      .map((h) => {
        const q = TeamEngine.getQuestion(s, h.questionId, bank());
        if (!q) return "";
        if (isAnswerProtected(q.id)) return `<div class="panel">حل هذا السؤال مخفي أثناء الجولة الجارية.</div>`;
        return `<details class="panel review-item"><summary>${esc(q.q)}</summary><div><strong>${esc(q.correctAnswer || q.options[q.answer])}</strong><p>${esc(q.explanation)}</p><a class="source-link" href="${esc(safeURL(q.source.url))}" target="_blank" rel="noopener noreferrer">${esc(q.source.title)} · ${esc(q.source.reference)}</a></div></details>`;
      })
      .join("")}</div></div>`;
  }
  function transactionList(s) {
    return `<div class="stack">${s.transactions.map((t) => `<div class="panel match-transaction"><strong>${esc(s.teams[t.teamId === "team-0" || t.teamId === 0 ? 0 : 1].name)}</strong><span>${reasonLabel(t.reason)}${t.modifier === "double" ? " · مضاعفة النقاط" : t.modifier === "bonus" ? " · مكافأة 50 نقطة" : ""}${t.reason === "host-correction" ? " · " + esc(t.modifier) : ""}</span><b dir="ltr">${num(t.scoreBefore)} → ${num(t.scoreAfter)}</b></div>`).join("") || '<div class="panel">لم تسجل حركات نقاط.</div>'}</div>`;
  }
  function historyScreen() {
    return `<div class="team-page">${recoveryNotice()}${title("كل مواجهة لها حكاية", "سجل مباريات الفريقين", "آخر 30 مباراة مكتملة محفوظة على هذا الجهاز.")}<div class="row"><button class="btn secondary" data-team-action="backup">حفظ متابعة للمقدم</button><button class="btn secondary" data-team-action="restore">استيراد نسخة احتياطية</button><button class="btn secondary" data-team-action="paste-backup">استيراد من نص</button>${m() ? '<button class="btn primary" data-team-action="resume">العودة للمباراة</button>' : ""}</div>${historyOverview()}<div class="stack">${store.history.map((h, i) => `<details class="panel match-history"><summary><strong>${esc(h.teams[0].name)} ${num(h.teams[0].score)} × ${num(h.teams[1].score)} ${esc(h.teams[1].name)}</strong><span>${h.history.length} سؤالًا · ${new Date(h.at).toLocaleDateString("en-GB")}</span></summary><div class="stack">${statisticsPanel(h)}${transactionList(h)}<button class="btn secondary" data-team-action="historic-summary" data-index="${i}">تصدير ملخص المباراة</button></div></details>`).join("") || '<div class="panel match-empty">ابدأ مباراة وأكملها لتظهر هنا نتيجتها وسجل تسجيلها.</div>'}</div></div>`;
  }
  function homeAddon() {
    if (!ready) return "";
    return `${recoveryNotice()}${m() ? `<section class="match-resume-banner panel row"><div><span class="eyebrow">مباراتك محفوظة</span><h2>${esc(m().teams[0].name)} × ${esc(m().teams[1].name)}</h2><p class="muted">${m().board.filter((t) => t.done).length}/${m().board.length} سؤالًا مكتملًا · ${num(m().teams[0].score)} مقابل ${num(m().teams[1].score)}</p></div><button class="btn primary" data-team-action="resume">${m().state === "MATCH_COMPLETE" ? "عرض النتيجة" : "متابعة المباراة"}</button></section>` : ""}<section class="team-dashboard-card panel"><div><span class="eyebrow">منافسة أصلية، على جهاز واحد</span><h2>فريقان، 6 فئات، و36 سؤالًا.</h2><p class="muted">مباراة كلاسيكية بإجابات شفهية وحسم بضغطة واحدة، مع سرقة ومساعدات اختيارية. تتوفر مباراة سريعة من 18 سؤالًا؛ خصّص القواعد قبل البدء.</p></div><div class="hero-actions"><button class="btn primary" data-team-action="new">إعداد مباراة فريقين ${icon("cup")}</button><button class="btn secondary" data-team-action="random">مباراة بفئات عشوائية</button><button class="text-btn" data-team-action="history">سجل المباريات</button><button class="text-btn" data-team-action="library">مكتبة الأسئلة</button></div></section>`;
  }
  function historyOverview() {
    const played = store.history.length,
      steals = store.history.reduce(
        (n, h) => n + h.teams.reduce((n, t) => n + (t.steals || 0), 0),
        0,
      ),
      correct = store.history.reduce(
        (n, h) => n + h.teams.reduce((n, t) => n + (t.correct || 0), 0),
        0,
      );
    return `<div class="section-heading"><h2>حصيلة مواجهات الفريقين</h2></div><div class="grid-3"><div class="panel achievement-card ${played ? "" : "locked"}"><h3>أولى المواجهات</h3><p>${played} مباراة مكتملة محفوظة</p></div><div class="panel achievement-card ${steals ? "" : "locked"}"><h3>اقتناص الفرصة</h3><p>${steals} سرقة ناجحة</p></div><div class="panel achievement-card ${correct >= 50 ? "" : "locked"}"><h3>معرفة مشتركة</h3><p>${correct} إجابة صحيحة · الهدف 50</p></div></div><p class="muted">تُستخرج إحصاءات الفريقين من المباريات المكتملة المحفوظة على هذا الجهاز.</p>`;
  }
  function libraryScreen() {
    const qs = bank().filter(
      (q) =>
        (libraryCategory === "all" || q.category === libraryCategory) &&
        (!librarySearch ||
          normalizeArabic(q.q + " " + q.sub).includes(
            normalizeArabic(librarySearch),
          )),
    );
    return `<div class="team-page team-library">${title("أدوات المالك المحلية", "مكتبة الأسئلة", `${bank().length} سؤالًا في المكتبة · ${TeamEngine.eligibleQuestions(bank(),TeamEngine.defaults()).length} مؤهلًا للإعداد الافتراضي`)}<p class="muted owner-tools-note">هذه مساحة مقدم اللعبة ومالك الجهاز لمراجعة الحلول والمراجع وإدارة المحتوى محليًا. لا توجد حسابات أو مصادقة في ملف اللعبة دون إنترنت.</p><div class="library-tools row"><button class="btn primary" data-team-action="edit-question">إضافة سؤال</button><button class="btn secondary" data-team-action="export-pack">تصدير بنك الأسئلة</button><button class="btn secondary" data-team-action="import-pack">استيراد حزمة أسئلة</button><button class="btn secondary" data-team-action="reports">بلاغاتي المحلية</button></div>${active() ? '<p class="inline-note warning">لمنع تسريب حلول المباراة وتغيير أسئلتها، تتوقف إدارة المحتوى وكشف الحلول حتى اكتمال المباراة.</p>' : ""}<div class="searchbar"><label class="sr-only" for="library-search">بحث الأسئلة</label><input id="library-search" data-team-search="library" value="${esc(librarySearch)}" placeholder="ابحث في الأسئلة…"><label class="sr-only" for="library-category">فئة الأسئلة</label><select id="library-category" data-library-category><option value="all">كل الفئات</option>${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === libraryCategory ? "selected" : ""}>${c.name}</option>`).join("")}</select></div><p class="muted">${qs.length} نتيجة · تعرض أول 60، ضيّق البحث للوصول إلى بقية الأسئلة.</p><div class="stack">${qs
      .slice(0, 60)
      .map(
        (q) =>
          `<details class="library-card panel"><summary><span class="badge">${catById(q.category).name} · ${q.points || (q.level === 1 ? 200 : q.level === 2 ? 400 : 600)}</span><strong>${esc(q.q)}</strong><small>${q.disabled ? "معطل محليًا" : verificationLabel(q.verification?.status)}</small></summary>${!isAnswerProtected(q.id) ? `<div class="stack">${questionMedia(q)}<p><strong>${esc(q.correctAnswer || q.options[q.answer])}</strong></p><p>${esc(q.explanation)}</p><p>${esc(q.source.title)} · ${esc(q.source.reference)}</p>${q.source.url?`<a class="source-link" href="${esc(safeURL(q.source.url))}" target="_blank" rel="noopener noreferrer">فتح المرجع</a>`:`<p class="muted">${esc(q.source.bibliography || "")}</p>`}<div class="row"><button class="btn secondary" data-team-action="edit-question" data-id="${esc(q.id)}">تعديل السؤال</button><button class="btn secondary" data-team-action="toggle-question" data-id="${esc(q.id)}">${q.disabled ? "إعادة التفعيل" : "تعطيل السؤال"}</button><button class="btn secondary" data-team-action="report" data-id="${esc(q.id)}">إبلاغ محلي</button></div></div>` : ""}</details>`,
      )
      .join("")}</div></div>`;
  }
  function editor(id) {
    if (active()) {
      toast("أكمل المباراة أو الجولة الجارية قبل تعديل الأسئلة.");
      return;
    }
    const q = id ? QUESTION_MAP.get(id) : null;
    const source = q?.source || {};
    openDialog(
      q ? "تعديل سؤال محليًا" : "سؤال جديد",
      `<form id="question-editor" class="stack">${q && !["text","image"].includes(q.type) ? `<p class="inline-note">صيغة ${esc(q.type)} محفوظة. لتعديل العناصر أو القرائن والتعليمات، صدّر الحزمة ثم أعد استيراد ملف JSON بعد التعديل والتحقق.</p>` : ""}<input type="hidden" name="id" value="${esc(q?.id || "owner-" + Date.now())}"><label for="edit-q">السؤال</label><textarea id="edit-q" name="q" required maxlength="900">${esc(q?.q || "")}</textarea><label for="edit-cat">الفئة</label><select id="edit-cat" name="category">${CATEGORIES.map((c) => `<option value="${c.id}" ${q?.category === c.id ? "selected" : ""}>${c.name}</option>`).join("")}</select><label for="edit-sub">الموضوع الفرعي</label><input id="edit-sub" name="sub" required maxlength="100" value="${esc(q?.sub || "")}"><label for="edit-points">القيمة</label><select id="edit-points" name="points">${[200, 400, 600].map((n) => `<option ${n === (q?.points || (q?.level === 1 ? 200 : q?.level === 2 ? 400 : 600)) ? "selected" : ""}>${n}</option>`).join("")}</select>${Array.from({ length: 4 }, (_, i) => `<label for="edit-option-${i}">الإجابة ${i + 1}</label><input id="edit-option-${i}" name="option${i}" required maxlength="180" value="${esc(q?.options[i] || "")}">`).join("")}<label for="edit-answer">رقم الإجابة الصحيحة</label><select id="edit-answer" name="answer">${[0, 1, 2, 3].map((i) => `<option value="${i}" ${q?.answer === i ? "selected" : ""}>${i + 1}</option>`).join("")}</select><label for="edit-aliases">بدائل صحيحة موثقة · سطر لكل بديل</label><textarea id="edit-aliases" name="aliases" maxlength="1500">${esc(q?.acceptedAnswers?.join("\n") || "")}</textarea><label for="edit-explanation">التفسير</label><textarea id="edit-explanation" name="explanation" required maxlength="1600">${esc(q?.explanation || "")}</textarea><label for="edit-hint">التلميح</label><input id="edit-hint" name="hint" maxlength="300" value="${esc(q?.hint || "")}"><label for="edit-source">اسم المصدر</label><input id="edit-source" name="sourceTitle" required maxlength="180" value="${esc(source.title || "")}"><label for="edit-url">رابط المصدر</label><input id="edit-url" name="sourceURL" type="url" dir="ltr" value="${esc(source.url || "")}"><label for="edit-reference">الإحالة الدقيقة</label><input id="edit-reference" name="sourceReference" required maxlength="350" value="${esc(source.reference || "")}"><label for="edit-bibliography">توثيق ببليوغرافي · عند عدم وجود رابط</label><input id="edit-bibliography" name="bibliography" maxlength="600" value="${esc(source.bibliography || "")}"><label for="edit-verification">حالة التحقق</label><select id="edit-verification" name="verificationStatus">${["source-checked","editorial","pending","disputed"].map(status=>`<option value="${status}" ${(q?.verification?.status || "editorial")===status?"selected":""}>${verificationLabel(status)}</option>`).join("")}</select><label for="edit-verified-date">تاريخ المراجعة الفعلية</label><input id="edit-verified-date" name="verifiedAt" type="date" value="${esc(q?.verification?.verifiedAt || "")}"><label for="edit-verified-section">الآية أو المقطع أو الصفحة التي تدعم الإجابة</label><input id="edit-verified-section" name="verifiedSection" maxlength="600" value="${esc(q?.verification?.section || "")}"><label for="edit-verification-notes">ملاحظات التحقق</label><textarea id="edit-verification-notes" name="verificationNotes" maxlength="1000">${esc(q?.verification?.notes || q?.verification?.note || "")}</textarea><label class="team-toggle"><span>راجعت المرجع فعليًا ووجدت أنه يدعم الإجابة · لازم لحالة مدقق بمصدر</span><input type="checkbox" name="verifiedAttestation"></label><label for="edit-franchise">عمل الأنمي · عند اختيار فئة الأنمي</label><select id="edit-franchise" name="franchiseId"><option value="">غير مصنف</option>${TeamEngine.FRANCHISES.map(f=>`<option value="${f.id}" ${q?.franchiseId===f.id?"selected":""}>${esc(f.title)}</option>`).join("")}</select><label for="edit-spoiler-level">حد الحرق</label><select id="edit-spoiler-level" name="spoilerLevel">${[[1,"بلا حرق"],[2,"أحداث الأنمي"],[3,"كامل العمل"]].map(([level,title])=>`<option value="${level}" ${(q?.spoilerLevel || (q?.spoiler?2:1))===level?"selected":""}>${title}</option>`).join("")}</select><label for="edit-cutoff">حد المحتوى المتحقق منه · إصدار أو فصل عند الحاجة</label><input id="edit-cutoff" name="contentCutoff" maxlength="100" value="${esc(q?.contentCutoff || "")}"><label for="edit-image">صورة من الحزمة · تظهر الرخصة والإسناد أدناه</label><select id="edit-image" name="image"><option value="">بلا صورة</option>${Object.keys(
        VISUALS,
      )
        .filter((key) => !key.startsWith("symbol-"))
        .map(
          (key) =>
            `<option value="${key}" ${q?.image === key ? "selected" : ""}>${esc(VISUALS[key].alt).slice(0, 80)} · ${key}</option>`,
        )
        .join(
          "",
        )}</select><div id="editor-image-credit" class="inline-note">${q?.image ? mediaCredit(q.image) : "الصورة اختيارية. تُقبل الصور الموجودة في الحزمة فقط للحفاظ على العمل دون إنترنت."}</div><p class="muted">التعديلات محلية في هذا المتصفح. صدّر الحزمة لنقلها. لا تعني إضافة مرجع أن المعلومة خضعت لمراجعة مستقلة.</p><button class="btn primary" type="submit">التحقق وحفظ السؤال</button></form>`,
    );
  }
  function downloadRaw(text, name) {
    downloadLocalSave(text,name);
  }
  function download(obj, name) {
    return downloadLocalSave(obj,name);
  }
  function pickFile(kind) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => readFile(input.files[0], kind), {
      once: true,
    });
    input.click();
  }
  async function readFile(file, kind) {
    if (!file) return;
    try {
      if (file.size > 28100000) throw Error("الملف كبير جدًا.");
      let data = parseJSON(await file.text());
      if (data?.format === "seen-khaled-resume") {
        if (kind === "pack" || data.kind !== "teams") throw Error("اختر حفظ متابعة خاصًا بمباراة الفريقين.");
        data = decodeMatchBackup(data);
      }
      if (kind === "pack") {
        if (active())
          throw Error("أكمل المباراة أو الجولة قبل استيراد الأسئلة.");
        if (
          data.version !== 2 ||
          !Array.isArray(data.questions) ||
          data.questions.length > 1200
        )
          throw Error("حزمة الأسئلة غير صالحة.");
        const ids = new Set(),
          texts = new Set(),
          qs = data.questions.map((raw) => {
            const q = safeQuestion(raw, ids,{legacy:data.version===2});
            ids.add(q.id);
            const key = TeamEngine.normalizeAnswer(q.q);
            if (texts.has(key)) throw Error("تكرار سؤال داخل الحزمة.");
            texts.add(key);
            return q;
          });
        openDialog(
          "استيراد حزمة أسئلة",
          `<p>اجتاز ${qs.length} سؤالًا التحقق البنيوي. قد تستبدل الحزمة أسئلة بالمعرفات نفسها؛ راجع مصادرها قبل اللعب.</p>`,
          '<button class="btn primary" id="confirm-question-pack">استيراد الحزمة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>',
        );
        $("#confirm-question-pack").addEventListener(
          "click",
          () => {
            const map = new Map(store.edits.map((q) => [q.id, q]));
            qs.forEach((q) => map.set(q.id, q));
            if (map.size > 1200) {
              toast(
                "بلغ المحتوى المحلي الحد الأقصى: 1200 سؤال معدل أو مضاف. صدّر نسخة ونظّم المحتوى أولًا.",
              );
              return;
            }
            store.edits = [...map.values()];
            applyEdits();
            write();
            closeDialog();
            render();
            toast("تم استيراد الحزمة.");
          },
          { once: true },
        );
      } else {
        if (![2,3].includes(data.version) || !data.save)
          throw Error("النسخة الاحتياطية غير صالحة.");
        const s = data.save;
        if (
          !s ||
          typeof s !== "object" ||
          ![2,3].includes(s.version) ||
          !Array.isArray(s.edits) ||
          s.edits.length > 1200 ||
          !Array.isArray(s.disabled) ||
          s.disabled.length > 2000 ||
          !Array.isArray(s.history) ||
          s.history.length > 30 ||
          !Array.isArray(s.reports) ||
          s.reports.length > 200 ||
          !Object.prototype.hasOwnProperty.call(s, "match")
        )
          throw Error("بنية النسخة الاحتياطية غير مكتملة.");
        const restoredPreferred = s.preferred
          ? sanitizePreferred(s.preferred)
          : null;
        const ids = new Set(),
          texts = new Set(),
          edits = s.edits.map((raw) => {
            const q = safeQuestion(raw, ids,{legacy:s.version===2}),
              key = TeamEngine.normalizeAnswer(q.q);
            if (texts.has(key)) throw Error("تكرار أسئلة في النسخة.");
            ids.add(q.id);
            texts.add(key);
            return q;
          }),
          candidate = deep(baseBank);
        for (const q of edits) {
          const i = candidate.findIndex((x) => x.id === q.id);
          if (i >= 0) candidate[i] = q;
          else candidate.push(q);
        }
        const candidateIds=new Set(candidate.map(q=>q.id)),candidateTexts=new Set();
        for (const question of candidate) {
          const text=TeamEngine.normalizeAnswer(question.q);
          if (candidateTexts.has(text)) throw Error("تكرار سؤال بعد دمج النسخة؛ لم يتغير الحفظ الحالي.");
          candidateTexts.add(text);
        }
        if (new Set(s.disabled).size!==s.disabled.length || s.disabled.some(id=>typeof id!=="string" || !candidateIds.has(id))) throw Error("قائمة الأسئلة المعطلة في النسخة غير صالحة.");
        if (s.reports.some(r=>!r || typeof r!=="object" || Array.isArray(r) || !candidateIds.has(r.id) || typeof r.note!=="string" || r.note.length>600 || !Number.isFinite(r.at) || r.at<0 || r.at>1e14)) throw Error("البلاغات المحلية في النسخة غير صالحة.");
        if (s.presets!==undefined && (!Array.isArray(s.presets) || s.presets.length>12 || restorePresets(s.presets).length!==s.presets.length)) throw Error("قوالب المباراة في النسخة غير صالحة.");
        const restored = s.match
          ? TeamEngine.validateState(s.match, candidate)
          : null;
        if (s.match && !restored)
          throw Error("المباراة في النسخة غير متوافقة أو تالفة.");
        if (s.history.some((h) => !validHistory(h,candidate)))
          throw Error("سجل المباريات في النسخة غير صالح.");
        const history = deep(s.history);
        const disabled = Array.isArray(s.disabled)
          ? s.disabled
              .filter((id) => candidate.some((q) => q.id === id))
              .slice(0, 2000)
          : [];
        openDialog(
          "استبدال حفظ مباريات الفريقين؟",
          "<p>سيستبدل هذا حفظ الفريقين والمحتوى المحلي. صدّر النسخة الحالية أولًا إذا احتجتها.</p>",
          '<button class="btn primary" id="confirm-team-backup">استعادة النسخة</button><button class="btn secondary" data-action="close-dialog">إلغاء</button>',
        );
        $("#confirm-team-backup").addEventListener(
          "click",
          () => {
            store = {
              version: 3,
              presets: restorePresets(s.presets),
              preferred: restoredPreferred,
              match: restored,
              history,
              reports: s.reports
                .filter(
                  (r) =>
                    r &&
                    typeof r.id === "string" &&
                    candidate.some((q) => q.id === r.id) &&
                    typeof r.note === "string" &&
                    r.note.length <= 600,
                )
                .slice(0, 200),
              edits,
              disabled,
            };
            applyEdits();
            write();
            closeDialog();
            go("teamHistory");
            toast("استُعيدت النسخة. المباراة متوقفة حتى المتابعة.");
          },
          { once: true },
        );
      }
    } catch (e) {
      toast(errText(e));
    }
  }
  function rules() {
    pause();
    if (route === "teamMatch") render();
    openDialog(
      "دليل مباراة الفريقين",
      `<div class="stack"><p>تجربة مستقلة أصلية مستلهمة من نوع مسابقات الفرق. اللوحة المختصرة ذات 18 سؤالًا اختيار خاص بهذه النسخة. الكلاسيكية 36 سؤالًا؛ القيم 200 و400 و600 ولكل قيمة خانتان مستقلتان.</p><p>تؤكد الصفحات الرسمية اختيار 3 فئات و3 مساعدات لكل فريق، وإتاحة الفئات الست للجميع، ومهلة 60 ثانية ثم 10 للمنافس. الحفرة قبل ظهور السؤال والمساعدات الأربع الأساسية الأخرى بعده.</p><p>يتناوب الفريقان على اختيار السؤال. السرقة والفخ لا يغيران هذا الجدول. اكشف الإجابة ثم اضغط الفريق أو «محد جاوب صح»؛ تُسجّل النتيجة وتعود اللوحة مباشرة. اختيار المنافس يُسجّل سرقة عند تفعيلها، باستثناء الفخ، دون افتراض أن صاحب الاختيار حاول وأخطأ.</p><p>الإجابة الصحيحة تمنح قيمة الخانة. عند تفعيل المكافأة، تضاف 50 نقطة لصحة إجابة صاحب الاختيار. المضاعفة تضاعف قيمة السؤال للفريق المؤهل دون الخصومات؛ تبقى مكافأة 50 إضافة ثابتة. الحفرة تخصم القيمة الأساسية من الخصم. الفخ: إخفاق المستجيب يخصم قيمة السؤال، ولا سرقة بعده؛ نجاحه يتبع الإعداد. خصم السرقة وإخفاق الحفرة والرصيد السالب والمكافآت خيارات مخصصة، وليست قواعد رسمية مؤكدة.</p>${Object.values(
        HELP,
      )
        .map((h) => `<p><strong>${h.name}:</strong> ${h.rule}</p>`)
        .join(
          "",
        )}<p>تصحيح النقاط والتراجع متاحان من قائمة المقدم. يمكن جمع مساعدات مختلفة للسؤال؛ لا تجمع «جاوب جوابين» و«فرصة ثانية»، ولا يُستخدم النوع نفسه مرتين في السؤال. التراجع يعيد حسم السؤال وحركاته وتبادل الدور معًا. لا يُعيد تشغيل محاولة مكشوفة أمام اللاعبين.</p><p>للجوال: تختفي قائمة التنقل السفلية أثناء المباراة. عند إخفاء الصفحة أو الانتقال للرئيسية يتوقف الوقت تلقائيًا. تدوير الشاشة لا يغير المباراة.</p><a class="source-link" href="https://seenjeemkw.com/" target="_blank" rel="noopener noreferrer">القواعد العامة والأسئلة الشائعة في الموقع الرسمي</a><a class="source-link" href="https://seenjeemkw.com/start-game" target="_blank" rel="noopener noreferrer">الصفحة الرسمية لاختيار الفئات</a><p class="muted">لا ننسخ محتوى أو صور أو شيفرة الموقع الرسمي. المراجع للقراءة الاختيارية، واللعب نفسه دون إنترنت.</p></div>`,
    );
  }
  function eventClick(e) {
    const b = e.target.closest("[data-team-action]");
    if (!b || b.disabled) return;
    e.preventDefault();
    if (locked && b.dataset.teamAction !== "reload") {
      toast("أعد تحميل أحدث حفظ للمتابعة.");
      return;
    }
    unlockAudio();
    const a = b.dataset.teamAction;
    if (a === "new") startSetup();
    else if (a === "random") startSetup(true);
    else if (a === "resume") {
      closeDialog();
      go("teamMatch");
    } else if (a === "home") {
      closeDialog();
      go("home");
    } else if (a === "preset") {
      applyPreset(b.dataset.value); render();
      document.querySelector(`[data-team-action="preset"][data-value="${b.dataset.value}"]`)?.focus({preventScroll:true});
    } else if (a === "save-preset") {
      if (TeamEngine.validateConfig(draft, bank()).length) { toast("أكمل إعدادات مباراة صالحة قبل حفظ القالب."); return; }
      openDialog("حفظ قالب مباراة", '<form id="team-preset-form" class="stack"><label for="team-preset-name">اسم القالب</label><input id="team-preset-name" name="name" maxlength="32" required><button class="btn primary" type="submit">حفظ القالب</button></form>');
    } else if (a === "load-preset") {
      const index = $("#saved-team-preset")?.value;
      if (index === "" || !store.presets[Number(index)]) return;
      draft = sanitizePreferred(store.presets[Number(index)].config); selectedPreset="custom"; render(); toast("طُبّق القالب. راجع الفئات المتاحة قبل البداية.");
    } else if (a === "delete-preset") {
      const index = $("#saved-team-preset")?.value;
      if (index === "" || !store.presets[Number(index)]) return;
      store.presets.splice(Number(index),1); write(); render(); toast("حُذف القالب المختار.");
    } else if (a === "anime-all") {
      draft.anime.selected = b.dataset.value === "on" ? TeamEngine.FRANCHISES.map(f => f.id) : []; render();
    } else if (a === "recovery-export") {
      if (hasActiveTrivia()) { toast("تبقى نسخة الاسترداد محفوظة كما هي. يتاح تصديرها بعد اكتمال الجولة أو المباراة الجارية لحماية الحلول."); return; }
      if (recoveryRaw) downloadRaw(recoveryRaw, `seen-recovery-original-${localDate()}.json`);
    } else if (a === "choose") {
      draft[b.dataset.key] = b.dataset.value;
      if (b.dataset.key === "mode" && b.dataset.value === "presenter")
        draft.transition = "host";
      render();
    } else if (a === "step") {
      step = Number(b.dataset.step);
      render();
      $("#team-step-" + step)?.focus({ preventScroll: true });
    } else if (a === "back") {
      step = Math.max(0, step - 1);
      render();
      $("#team-wizard-heading")?.focus({ preventScroll: true });
    } else if (a === "customize") { step=1;render();$("#team-wizard-heading")?.focus({preventScroll:true});window.scrollTo(0,0);
    } else if (a === "next-step") {
      if (!validateStep()) return;
      step = Math.min(8, step + 1);
      render();
      $("#team-wizard-heading")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else if (a === "team-name-preset") {
      const names = {colors:["الفريق الأزرق","الفريق الذهبي"],kuwait:["الديرة","البحر"],friends:["النجوم","الأبطال"]}[b.dataset.value];
      if (!names) return;
      draft.teams.forEach((t,i)=>t.name=names[i]); render();
      document.querySelector(`[data-team-action="team-name-preset"][data-value="${b.dataset.value}"]`)?.focus({preventScroll:true});
    } else if (a === "assist-preset") {
      applyAssistPreset(b.dataset.value); render();
      document.querySelector(`[data-team-action="assist-preset"][data-value="${b.dataset.value}"]`)?.focus({preventScroll:true});
      toast("طُبّق قالب المساعدات. يمكنك تخصيص اختيارات كل فريق.");
    } else if (a === "favorite-category") {
      const id=b.dataset.id;
      if (!catById(id)) return;
      const favorites = new Set(progress.profile.favorites);
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      progress.profile.favorites = [...favorites]; persist(); render();
      document.querySelector(`[data-team-action="favorite-category"][data-id="${id}"]`)?.focus({preventScroll:true});
    } else if (a === "team-avatar") {
      draft.teams[Number(b.dataset.team)].avatar = b.dataset.value;
      render();
      document.querySelector(`[data-team-action="team-avatar"][data-team="${b.dataset.team}"][data-value="${CSS.escape(b.dataset.value)}"]`)?.focus({preventScroll:true});
    } else if (a === "category-team") {
      categoryTeam = Number(b.dataset.team);
      render();
      document.querySelector(`[data-team-action="category-team"][data-team="${categoryTeam}"]`)?.focus({preventScroll:true});
    } else if (a === "random-categories") {
      randomCategories();
      render();
    } else if (a === "category") {
      const id = b.dataset.id,
        owner = draft.teams.findIndex((t) => t.categories.includes(id));
      if (owner >= 0) {
        draft.teams[owner].categories = draft.teams[owner].categories.filter(
          (x) => x !== id,
        );
      } else if (catById(id) && pointValues().every(value=>countsFor(id)[value] >= (draft.board === "classic" ? 2 : 1)) && draft.teams[categoryTeam].categories.length < categoryQuota()) {
        draft.teams[categoryTeam].categories.push(id);
        if (
          draft.teams[categoryTeam].categories.length === categoryQuota() &&
          draft.teams[1 - categoryTeam].categories.length < categoryQuota()
        )
          categoryTeam = 1 - categoryTeam;
      } else toast("اكتملت فئات هذا الفريق. اختر الفريق الآخر أو ألغِ فئة.");
      render();
      document.getElementById("team-category-" + id)?.focus({preventScroll:true});
    } else if (a === "category-count") {
      if (draft.variant!=="custom" || ![2,4,6].includes(Number(b.dataset.value))) return;
      resizeCategories(Number(b.dataset.value)); render();
      document.querySelector(`[data-team-action="category-count"][data-value="${b.dataset.value}"]`)?.focus({preventScroll:true});
    } else if (a === "point-value") {
      if (draft.variant!=="custom" || ![200,400,600].includes(Number(b.dataset.value))) return;
      const value=Number(b.dataset.value),values=new Set(pointValues());
      if (values.has(value) && values.size===1) { toast("اختر قيمة نقاط واحدة على الأقل.");return; }
      values.has(value)?values.delete(value):values.add(value);
      draft.pointValues=[...values].sort((a,b)=>a-b); render();
      document.querySelector(`[data-team-action="point-value"][data-value="${value}"]`)?.focus({preventScroll:true});
    } else if (a === "duration") {
      draft.duration = Number(b.dataset.value);
      render();
    } else if (a === "helpers-all") {
      const on = b.dataset.value === "on";
      Object.keys(HELP).forEach((id) => (draft.assistEnabled[id] = on));
      if (!on) draft.teams.forEach((t) => (t.assists = []));
      render();
    } else if (a === "pick-assist") {
      const t = draft.teams[Number(b.dataset.team)],
        id = b.dataset.key;
      if (t.assists.includes(id)) t.assists = t.assists.filter((x) => x !== id);
      else if (t.assists.length < draft.assistSlots) t.assists.push(id);
      else toast("وصلت إلى عدد المساعدات المختار. ألغِ واحدة أولًا.");
      render();
    } else if (a === "start-match") startMatch();
    else if (a === "tile") openTile(b.dataset.id);
    else if (a === "arm-pit") {
      if (!canArmPit(m())) return;
      armedPitTeam = armedPitTeam === m().turn ? null : m().turn;
      render();
      document.querySelector('[data-team-action="arm-pit"]')?.focus({preventScroll:true});
    }
    else if (a === "engine") dispatch({ type: b.dataset.type });
    else if (a === "answer")
      dispatch({ type: "ANSWER", value: Number(b.dataset.value) });
    else if (a === "incorrect") dispatch({ type: "DECLARE_INCORRECT" });
    else if (a === "reveal") revealAnswer();
    else if (a === "next-clue") {
      const next=dispatch({type:"NEXT_CLUE",token:b.dataset.token});
      const current=next?.current,question=current&&TeamEngine.getQuestion(next,current.questionId,bank());
      if (current && !next.lastError) $("#announcer").textContent=`القرينة ${current.revealedClues}: ${question?.clues?.[current.revealedClues-1] || ""}`;
      (document.querySelector('[data-team-action="next-clue"]') || $("#progressive-clues"))?.focus({preventScroll:true});
    }
    else if (a === "award") resolveAward(b);
    else if (a === "assist") useAssist(b.dataset.key);
    else if (a === "use-sitout") {
      const participant=$("#sitout-inline-participant")?.value;
      choosingSitout=false;
      dispatch({type:"ASSIST",key:"sitout",confirmed:true,participant});
      $("#team-question-heading")?.focus({preventScroll:true});
    } else if (a === "cancel-sitout") { choosingSitout=false;render();document.querySelector('[data-team-action="assist"][data-key="sitout"]')?.focus({preventScroll:true}); }
    else if (a === "pause-menu") pauseMenu();
    else if (a === "resume-menu") {
      closeDialog();
      if (m().state === "PAUSED") dispatch({ type: "RESUME" });
      else go("teamMatch");
    } else if (a === "quiet") {
      if (prefs.sound || prefs.music) { quietRestore={sound:prefs.sound,music:prefs.music};prefs.sound=0;prefs.music=0; }
      else { prefs.sound=quietRestore?.sound || 45;prefs.music=quietRestore?.music || 0; }
      applyPrefs();persist();render();
      document.querySelector('[data-team-action="quiet"]')?.focus({preventScroll:true});
    } else if (a === "score-panel") scorePanel();
    else if (a === "assist-history") {
      openDialog(
        "سجل المساعدات",
        `<div class="stack">${m()
          .teams.map(
            (t) =>
              `<section><h3>${esc(t.name)}</h3>${t.assistHistory.map((h) => `<p>${HELP[h.key].name}${h.participant ? " · " + esc(h.participant) : ""} · ${esc(TeamEngine.getQuestion(m(), h.questionId, bank())?.q || "")}</p>`).join("") || '<p class="muted">لم تستخدم مساعدات بعد.</p>'}</section>`,
          )
          .join("")}</div>`,
      );
    } else if (a === "undo") {
      if (b.dataset.resolutionToken && b.dataset.resolutionToken !== m()?.lastResolution?.token) return;
      closeDialog();
      dispatch({type:"UNDO"});
    } else if (a === "history") {
      closeDialog();
      go("teamHistory");
    } else if (a === "library") {
      go("library");
    } else if (a === "rules") rules();
    else if (a === "zoom") {
      pause();
      render();
      const v = VISUALS[b.dataset.key];
      if (v)
        openDialog(
          "صورة السؤال",
          `<img class="zoom-image" src="${imageSrc(b.dataset.key)}" alt="${esc(questionAlt(TeamEngine.getQuestion(m(), m()?.current?.questionId, bank()) || {},!!m()?.current?.revealed))}">${m()?.current?.revealed || !active() ? mediaCredit(b.dataset.key) : '<p class="muted">يمكن عرض الإسناد والرخصة بعد انتهاء المحاولة.</p>'}`,
        );
    } else if (a === "backup") {
      pause();
      try {
        if (download(encodeMatchBackup("teams",{version:3,save:store}),`seen-teams-resume-${localDate()}.json`))
          toast("أُعدّت نسخة متابعة للمقدم للتنزيل؛ احتفظ بالملف بعيدًا عن اللاعبين.");
      } catch (error) {
        toast(/[\u0600-\u06ff]/.test(error.message) ? error.message : "تعذّر إعداد نسخة المتابعة. تبقى المباراة مفتوحة دون تغيير.");
      }
    } else if (a === "restore") pickFile("backup");
    else if (a === "paste-backup") pasteLocalSave(file=>readFile(file,"backup"));
    else if (a === "rematch") {
      draft = deep(m().config);
      startMatch();
    } else if (a === "match-summary") {
      if(active()) {toast("يتاح تصدير الملخص بعد اكتمال المباراة والجولة الجارية.");return;}
      download(
        {
          version: 3,
          match: store.history.find((h) => h.id === m().id) || m(),
          statistics: matchStatistics(m()),
        },
        `seen-match-${localDate()}.json`,
      );
    } else if (a === "historic-summary") {
      if(active()) {toast("يتاح تصدير الملخص بعد اكتمال المباراة والجولة الجارية.");return;}
      download(
        { version: 3, match: store.history[Number(b.dataset.index)], statistics: matchStatistics(store.history[Number(b.dataset.index)]) },
        `seen-match-${localDate()}.json`,
      );
    } else if (a === "edit-question") editor(b.dataset.id);
    else if (a === "toggle-question") {
      if (active()) {
        toast("أكمل الجولة قبل تغيير المحتوى.");
        return;
      }
      const id = b.dataset.id;
      store.disabled = store.disabled.includes(id)
        ? store.disabled.filter(x=>x!==id)
        : [...store.disabled,id];
      applyEdits(); write(); render();
      toast(store.disabled.includes(id) ? "عُطّل السؤال محليًا. يمكن إعادة تفعيله من المكتبة." : "أُعيد تفعيل السؤال محليًا.");
    } else if (a === "export-pack") {
      if (active()) {
        toast("أكمل المباراة أو الجولة قبل تصدير حلولها.");
        return;
      }
      download(
        {
          version: 2,
          questions: bank()
            .filter((q) => !q.disabled)
            .map((q) => ({
              ...q,
              points:
                q.points || (q.level === 1 ? 200 : q.level === 2 ? 400 : 600),
            })),
        },
        "seen-question-pack.json",
      );
    } else if (a === "import-pack") pickFile("pack");
    else if (a === "report") {
      pause();
      if (route === "teamMatch") render();
      openDialog(
        "بلاغ محلي عن سؤال",
        `<form id="team-report-form" class="stack"><input type="hidden" name="id" value="${esc(b.dataset.id)}"><label for="question-report">ما الملاحظة أو التصحيح المقترح؟</label><textarea id="question-report" name="note" maxlength="600" required></textarea><p class="muted">يُحفظ البلاغ على جهازك فقط، ولا يرسل لأي شخص.</p><button class="btn primary" type="submit">حفظ البلاغ محليًا</button></form>`,
      );
    } else if (a === "reports")
      openDialog(
        "بلاغاتي المحلية",
        `<div class="stack">${store.reports.map((r) => `<div class="panel"><strong>${esc(QUESTION_MAP.get(r.id)?.q || r.id)}</strong><p>${esc(r.note)}</p></div>`).join("") || "<p>لا توجد بلاغات محفوظة.</p>"}</div>`,
      );
    else if (a === "reload") location.reload();
    if (draft && route === "teamSetup") { store.preferred=deep(draft); write(); }
  }
  document.addEventListener("click", eventClick);
  document.addEventListener("change", (e) => {
    const t = e.target;
    if(t.matches("#edit-image")) { $("#editor-image-credit").innerHTML = t.value ? mediaCredit(t.value) : "بلا صورة";
    } else if (t.matches("[data-anime-selected]")) {
      const id=t.dataset.animeSelected;
      draft.anime.selected = t.checked ? [...new Set([...draft.anime.selected,id])] : draft.anime.selected.filter(x=>x!==id);
      render(); document.querySelector(`[data-anime-selected="${id}"]`)?.focus({preventScroll:true});
    } else if (t.matches("[data-anime-level]")) {
      const id=t.dataset.animeLevel;
      draft.anime.levels[id]=Number(t.value); render(); document.getElementById("anime-level-"+id)?.focus({preventScroll:true});
    } else if (t.matches("[data-team-pref]")) {
      const key = t.dataset.teamPref;
      draft[key] =
        t.type === "checkbox"
          ? t.checked
          : typeof draft[key] === "number"
            ? Number(t.value)
            : t.value;
      if (key === "assistSlots")
        draft.teams.forEach(
          (team) => (team.assists = team.assists.slice(0, draft.assistSlots)),
        );
      if (key === "hints" && !draft.hints)
        draft.teams.forEach(
          (team) => (team.assists = team.assists.filter((id) => id !== "hint")),
        );
      if (t.type !== "number") render();
    } else if (t.matches("[data-team-field]")) {
      const team = draft.teams[Number(t.dataset.teamIndex)];
      team[t.dataset.teamField] =
        t.dataset.teamField === "players"
          ? t.value
              .split("\n")
              .map((x) => cleanName(x, ""))
              .filter(Boolean)
              .slice(0, 12)
          : t.dataset.teamField === "name"
            ? cleanName(t.value)
            : t.value;
      if (t.dataset.teamField === "color") { const id=t.id; render(); document.getElementById(id)?.focus({preventScroll:true}); }
    } else if (t.matches("[data-assist-enable]")) {
      draft.assistEnabled[t.dataset.assistEnable] = t.checked;
      if (!t.checked)
        draft.teams.forEach(
          (team) =>
            (team.assists = team.assists.filter(
              (id) => id !== t.dataset.assistEnable,
            )),
        );
      render();
    } else if (t.matches("[data-assist-limit]")) {
      draft.assistLimits[t.dataset.assistLimit] = Number(t.value);
      if (Number(t.value) === 0)
        draft.teams.forEach(
          (team) =>
            (team.assists = team.assists.filter(
              (id) => id !== t.dataset.assistLimit,
            )),
        );
    } else if (t.matches("[data-team-category-filter]")) {
      categoryFilter = t.value;
      render();
    } else if (t.matches("[data-library-category]")) {
      libraryCategory = t.value;
      render();
    }
    if(draft && route === "teamSetup") { store.preferred=deep(draft); write(); }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-team-search]")) {
      if (t.dataset.teamSearch === "categories") categorySearch = t.value;
      else librarySearch = t.value;
      const start = t.selectionStart;
      render();
      const el = document.getElementById(t.id);
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(start, start);
    }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target,
      formId = f.getAttribute("id");
    if (formId === "team-preset-form") {
      e.preventDefault();
      const name=cleanName(new FormData(f).get("name"), "");
      if (!name) return;
      const prior=store.presets.findIndex(p=>p.name===name);
      if (prior>=0) store.presets[prior]={name,config:deep(draft)};
      else { if(store.presets.length>=12) {toast("يمكن حفظ 12 قالبًا. احذف قالبًا قبل إضافة غيره.");return;} store.presets.push({name,config:deep(draft)}); }
      store.preferred=deep(draft); write(); closeDialog(); render(); toast("حُفظ القالب على هذا الجهاز.");
    } else if (formId === "team-answer-form") {
      e.preventDefault();
      dispatch({ type: "ANSWER", value: new FormData(f).get("answer") });
    } else if (formId === "team-score-form") {
      e.preventDefault();
      const d = new FormData(f),
        delta = Number(d.get("delta"));
      if (!Number.isInteger(delta) || Math.abs(delta) > 10000) {
        toast("أدخل تعديلًا صحيحًا من -10000 إلى 10000.");
        return;
      }
      const reason = String(d.get("reason")).trim();
      if (!reason) {
        toast("أدخل سبب التصحيح.");
        return;
      }
      closeDialog();
      dispatch({
        type: "ADJUST_SCORE",
        teamId: Number(d.get("team")),
        delta,
        reason,
      });
    } else if (formId === "question-editor") {
      e.preventDefault();
      try {
        const d = new FormData(f);
        if(d.get("verificationStatus")==="source-checked" && !d.has("verifiedAttestation")) throw Error("أكد مراجعتك الفعلية للمرجع قبل تسجيل حالة مدقق بمصدر.");
        const previous = QUESTION_MAP.get(d.get("id"));
        const format = previous ? Object.fromEntries(["type","instructions","judging","items","correctOrder","clues","parts"].filter(key=>previous[key]!==undefined).map(key=>[key,deep(previous[key])])) : {};
        const q = safeQuestion({
            ...format,
            id: d.get("id"),
            category: d.get("category"),
            sub: d.get("sub"),
            points: Number(d.get("points")),
            q: d.get("q"),
            options: [0, 1, 2, 3].map((i) => d.get("option" + i)),
            answer: Number(d.get("answer")),
            acceptedAnswers: String(d.get("aliases"))
              .split("\n")
              .filter(Boolean),
            explanation: d.get("explanation"),
            hint: d.get("hint"),
            source: {
              title: d.get("sourceTitle"),
              url: d.get("sourceURL"),
              reference: d.get("sourceReference"),
              bibliography: d.get("bibliography"),
            },
            verification: {status:d.get("verificationStatus"),referenceTitle:d.get("sourceTitle"),referenceUrl:d.get("sourceURL"),bibliography:d.get("bibliography"),section:d.get("verifiedSection"),verifiedAt:d.get("verifiedAt"),notes:d.get("verificationNotes")},
            franchiseId: d.get("category")==="anime" ? d.get("franchiseId") : undefined,
            spoilerLevel: Number(d.get("spoilerLevel")),
            spoiler: Number(d.get("spoilerLevel"))>1,
            contentCutoff: d.get("contentCutoff"),
            image: d.get("image") || undefined,
          });
        if (
          store.edits.length >= 1200 &&
          !store.edits.some((x) => x.id === q.id)
        )
          throw Error("بلغت الحد الأقصى للمحتوى المحلي: 1200 سؤال.");
        const saveQuestion = () => {
          store.edits = store.edits.filter(x=>x.id!==q.id); store.edits.push(q);
          applyEdits(); write(); closeDialog(); render(); toast("اجتاز السؤال التحقق وحُفظ محليًا.");
        };
        const similar=similarQuestions(q);
        if(similar.length) {
          openDialog("راجع احتمال التشابه", `<p>لم يُحذف أي سؤال. تشترك هذه الأسئلة في موضوع وصياغة قريبين؛ راجع اختلاف المعلومة قبل الحفظ.</p><ul>${similar.map(x=>`<li>${esc(x.q)}</li>`).join("")}</ul>`, '<button class="btn primary" id="confirm-similar-question">المعلومة مختلفة · حفظ السؤال</button><button class="btn secondary" data-action="close-dialog">إلغاء للمراجعة</button>');
          $("#confirm-similar-question").addEventListener("click", saveQuestion, {once:true});
        } else saveQuestion();
      } catch (err) {
        toast(errText(err));
      }
    } else if (formId === "team-report-form") {
      e.preventDefault();
      const d = new FormData(f);
      store.reports.unshift({
        id: String(d.get("id")),
        note: String(d.get("note")).trim().slice(0, 600),
        at: Date.now(),
      });
      store.reports = store.reports.slice(0, 200);
      write();
      closeDialog();
      toast("حُفظ البلاغ على جهازك.");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pause();
      if (route === "teamMatch") render();
    }
  });
  window.addEventListener("pagehide", () => pause());
  window.addEventListener("beforeunload", () => pause());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue && e.newValue !== lastObservedRaw && !locked) {
      locked = true;
      pause(false);
      openDialog(
        "تغيّر حفظ المباراة في نافذة أخرى",
        "<p>أُوقف الحفظ هنا لتجنب تعارض النقاط. أغلق النسخة الأخرى ثم حمّل أحدث حفظ.</p>",
        '<button class="btn primary" data-team-action="reload">تحميل أحدث حفظ</button>',
      );
    }
  });
  return {
    init,
    startSetup,
    setupScreen,
    matchScreen,
    historyScreen,
    homeAddon,
    libraryScreen,
    mediaCredit,
    prepareResumeLibrary,
    commitResumeLibrary,
    rules,
    pause,
    startTicker,
    get match() {
      return m();
    },
    get draft() {
      return draft;
    },
    get store() {
      return store;
    },
    dispatch,
    go,
    ready: () => ready,
  };
})();
window.SeenTeamUI = TeamUI;
TeamUI.init();
