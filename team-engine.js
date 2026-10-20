/* Independent, pure two-team match engine. No DOM, storage, timers or network.
   Dispatch returns a new serializable state. The UI owns one clock and persists
   state after each action. Invalid/stale actions never mutate the supplied state. */
const TeamEngine = (() => {
  'use strict';
  const VERSION = 2;
  const VALUES = [200, 400, 600];
  const ASSISTS = ['call', 'twice', 'pit', 'sitout', 'trap', 'time', 'hint', 'double', 'skip', 'second'];
  const STATES = ['BOARD', 'QUESTION_PREVIEW', 'QUESTION_ACTIVE', 'STEAL_OPPORTUNITY', 'ASSISTANCE_ACTIVE', 'ANSWER_REVEAL', 'SCORE_ADJUDICATION', 'TURN_COMPLETE', 'PAUSED', 'MATCH_COMPLETE'];
  const PLAY_STATES = ['QUESTION_ACTIVE', 'STEAL_OPPORTUNITY'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = (n, min = 0, max = 1e9) => Number.isInteger(n) && n >= min && n <= max;
  const safeText = (value, max = 60) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const cleanText = (value, fallback, max = 32) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) || fallback;
  const pointValue = q => VALUES.includes(q.points) ? q.points : q.level === 1 ? 200 : q.level === 2 ? 400 : 600;
  const teamIndex = value => value === 0 || value === 'team-0' ? 0 : value === 1 || value === 'team-1' ? 1 : null;
  const normalizeAnswer = value => String(value ?? '').normalize('NFKC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  function rngFor(seed) {
    let n = Number(seed) >>> 0;
    return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, n | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(items, rng) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  function defaults() {
    return {
      mode: 'teams', board: 'compact', answerStyle: 'oral', choiceCount: 4,
      timer: true, duration: 60, steal: true, stealDuration: 10, negative: false,
      bonus: false, sound: true, animations: true, explanations: true, hints: true,
      spoilerProtection: true, transition: 'auto', starter: '0', assistSlots: 3,
      assistEnabled: Object.fromEntries(ASSISTS.map(key => [key, true])),
      assistLimits: Object.fromEntries(ASSISTS.map(key => [key, 1])),
      callDuration: 60, callPause: true, trapSuccess: 'responder', pitFailPenalty: false, stealPenalty: false,
      teams: [
        { name: 'الفريق الأزرق', color: '#55b9f3', avatar: '🔷', players: [], categories: ['anime', 'football', 'prophets'], assists: ['call', 'twice', 'pit'] },
        { name: 'الفريق الذهبي', color: '#eac57e', avatar: '🏆', players: [], categories: ['seerah', 'arabia', 'islamic'], assists: ['call', 'twice', 'pit'] }
      ]
    };
  }
  function configErrors(config, bank) {
    const errors = [], c = config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return ['إعدادات المباراة غير صالحة.'];
    for (const [key, allowed] of Object.entries({ mode: ['teams', 'presenter', 'party'], board: ['compact', 'classic'], answerStyle: ['oral', 'choice', 'typed'], choiceCount: [3, 4], transition: ['auto', 'host'], starter: ['0', '1', 'random'], trapSuccess: ['responder', 'none'] })) {
      if (!allowed.includes(c[key])) errors.push(`خيار ${ {mode:'نوع المباراة',board:'اللوحة',answerStyle:'الإجابة',choiceCount:'عدد الخيارات',transition:'الانتقال',starter:'البداية',trapSuccess:'الفخ'}[key] } غير صالح.`);
    }
    for (const key of ['timer', 'steal', 'negative', 'bonus', 'sound', 'animations', 'explanations', 'hints', 'spoilerProtection', 'callPause', 'pitFailPenalty', 'stealPenalty']) if (typeof c[key] !== 'boolean') errors.push('أحد مفاتيح القواعد غير صالح.');
    if (!integer(c.duration, 5, 600) || !integer(c.stealDuration, 3, 120) || !integer(c.callDuration, 10, 300)) errors.push('زمن السؤال أو السرقة أو الاتصال خارج النطاق المسموح.');
    if (!integer(c.assistSlots, 0, 5)) errors.push('اختر من 0 إلى 5 مساعدات لكل فريق.');
    if (!c.assistEnabled || !c.assistLimits || ASSISTS.some(k => typeof c.assistEnabled[k] !== 'boolean' || !integer(c.assistLimits[k], 0, 5))) errors.push('إعدادات المساعدات غير صالحة.');
    if (!Array.isArray(c.teams) || c.teams.length !== 2) return [...errors, 'يلزم فريقان بالضبط.'];
    const cats = [];
    c.teams.forEach((team, i) => {
      if (!team || !safeText(team.name, 32) || !team.name.trim()) errors.push(`اسم الفريق ${i + 1} غير صالح.`);
      if (!team || !/^#[0-9a-f]{6}$/i.test(team.color) || !safeText(team.avatar, 12)) errors.push('لون الفريق أو رمزه غير صالح.');
      if (!team || !Array.isArray(team.players) || team.players.length > 20 || team.players.some(name => !safeText(name, 32) || !name.trim())) errors.push('أسماء المشاركين غير صالحة.');
      if (!team || !Array.isArray(team.categories) || team.categories.length !== 3 || new Set(team.categories).size !== 3 || team.categories.some(id => !safeText(id, 64))) errors.push(`على الفريق ${i + 1} اختيار 3 فئات مختلفة.`);
      else cats.push(...team.categories);
      if (!team || !Array.isArray(team.assists) || team.assists.length > c.assistSlots || new Set(team.assists).size !== team.assists.length || team.assists.some(k => !ASSISTS.includes(k) || !c.assistEnabled?.[k] || c.assistLimits?.[k] <= 0 || (k === 'hint' && !c.hints))) errors.push('اختيارات المساعدات لا تطابق المساعدات المفعّلة وحدودها.');
    });
    c.teams.forEach((team, i) => { if (Array.isArray(team?.assists) && team.assists.includes('sitout') && (!Array.isArray(c.teams[1 - i]?.players) || !c.teams[1 - i].players.length)) errors.push('سجّل أسماء مشاركي الفريق المقابل لاستخدام مساعدة استريح.'); });
    if (cats.length === 6 && new Set(cats).size !== 6) errors.push('يجب أن تكون الفئات الست مختلفة بين الفريقين.');
    if (Array.isArray(bank) && cats.length === 6) {
      const count = c.board === 'classic' ? 2 : 1;
      for (const cat of cats) for (const value of VALUES) {
        if (bank.filter(q => !q.disabled && q.category === cat && pointValue(q) === value && (!c.spoilerProtection || !q.spoiler)).length < count) errors.push(`الفئة ${{anime:'الأنمي',football:'كرة القدم',prophets:'قصص الأنبياء',seerah:'السيرة النبوية',arabia:'التاريخ الجاهلي',islamic:'التاريخ الإسلامي',geo:'الجغرافيا',games:'ألعاب الفيديو'}[cat] || 'المحددة'} لا تضم ${count} سؤالًا متاحًا بقيمة ${value} بعد الفلترة.`);
      }
    }
    return [...new Set(errors)];
  }
  function cleanConfig(c) {
    const base = defaults(), out = {};
    for (const key of Object.keys(base)) {
      if (key === 'teams') out.teams = c.teams.map((t, i) => ({ name: cleanText(t.name, base.teams[i].name), color: t.color, avatar: t.avatar, players: t.players.map(n => cleanText(n, 'مشارك')), categories: [...t.categories], assists: [...t.assists] }));
      else if (key === 'assistEnabled' || key === 'assistLimits') out[key] = Object.fromEntries(ASSISTS.map(k => [k, c[key][k]]));
      else out[key] = c[key];
    }
    return out;
  }
  function create(config, bank, options = {}) {
    const errors = configErrors(config, bank);
    if (errors.length) throw Error(errors.join(' '));
    const now = options.now ?? Date.now(), seed = Number(options.seed ?? now) >>> 0, rng = rngFor(seed), c = cleanConfig(config), seen = new Set(Array.isArray(options.seen) ? options.seen : Object.keys(options.seen || {}));
    const categories = c.teams.flatMap(t => t.categories), board = [], taken = new Set();
    for (const category of categories) for (const value of VALUES) {
      const qs = shuffle(bank.filter(q => !q.disabled && q.category === category && pointValue(q) === value && (!c.spoilerProtection || !q.spoiler)), rng).sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id)));
      for (let slot = 0; slot < (c.board === 'classic' ? 2 : 1); slot++) {
        const q = qs.find(q => !taken.has(q.id));
        if (!q) throw Error('لا تكفي الأسئلة لبناء لوحة بلا تكرار.');
        taken.add(q.id); board.push({ id: `${category}-${value}-${slot}`, questionId: q.id, category, value, slot, done: false });
      }
    }
    const startingTeam = c.starter === 'random' ? Math.floor(rng() * 2) : Number(c.starter);
    return {
      version: VERSION, id: `match-${now}-${seed}`, state: 'BOARD', config: c, seed, createdAt: now,
      teams: c.teams.map((t, i) => ({ id: `team-${i}`, name: t.name, color: t.color, avatar: t.avatar, players: [...t.players], score: 0, correct: 0, incorrect: 0, steals: 0, assists: Object.fromEntries(t.assists.map(k => [k, c.assistLimits[k]])), assistHistory: [] })),
      categories, board, turn: startingTeam, startingTeam, current: null,
      transactions: [], history: [], knownAnswers: [], undo: [], serial: 0, lastError: null, completedAt: null, winner: null
    };
  }
  function reject(s, message) { s.lastError = message; return s; }
  function nextId(s, prefix) { s.serial++; return `${s.id}-${prefix}-${s.serial}`; }
  function checkpoint(s) { const snap = clone(s); delete snap.undo; s.undo.push(snap); if (s.undo.length > 24) s.undo.shift(); }
  function stopClock(c, now) { if (c.deadline !== null) c.remainingMs = Math.max(0, c.deadline - now); c.deadline = null; }
  function startClock(c, duration, enabled, now) { c.remainingMs = duration * 1000; c.timed = enabled; c.timerStarted = true; c.deadline = enabled ? now + c.remainingMs : null; }
  function refreshToken(s) { s.current.token = nextId(s, 'clock'); }
  function beginSteal(s, now) {
    const c = s.current; stopClock(c, now); c.phase = 'steal'; c.responder = 1 - c.selector;
    c.twice = false; c.hint = false; c.deadline = null; c.remainingMs = s.config.stealDuration * 1000;
    c.timed = s.config.timer; c.timerStarted = s.config.transition === 'auto';
    if (c.timerStarted && c.timed) c.deadline = now + c.remainingMs;
    c.closed = false; refreshToken(s); s.state = 'STEAL_OPPORTUNITY';
  }
  function reveal(s, now, pendingWinner = null) {
    const c = s.current; s.knownAnswers = [...new Set([...(s.knownAnswers || []), c.questionId])]; stopClock(c, now); c.closed = true; c.revealed = true;
    c.pendingWinner = pendingWinner; c.assistance = null; refreshToken(s); s.state = 'ANSWER_REVEAL';
  }
  function failAttempt(s, now, forceFinal = false, reason = 'incorrect') {
    const c = s.current, team = c.responder;
    c.attempts.push({ teamId: team, correct: false, reason, at: now });
    const attempts = c.attempts.filter(a => a.teamId === team).length;
    const twice = c.twiceTeam === team || c.secondTeam === team;
    if (twice && attempts < 2 && !forceFinal) { c.lastAttemptIncorrect = true; return; }
    if (!c.failedTeams.includes(team)) c.failedTeams.push(team);
    if (c.phase === 'first' && s.config.steal && !c.revealed) beginSteal(s, now);
    else reveal(s, now, null);
  }
  function transaction(s, team, delta, reason, modifier, now, groupId, questionId, value) {
    const target = s.teams[team], before = target.score;
    const after = s.config.negative ? before + delta : Math.max(0, before + delta);
    const tx = { id: nextId(s, 'score'), questionId, teamId: team, originalValue: value, reason, modifier, scoreBefore: before, scoreAfter: after, timestamp: now, groupId };
    target.score = after; s.transactions.push(tx); return tx.id;
  }
  function adjudicate(s, winner, now) {
    const c = s.current, tile = s.board.find(t => t.id === c.tileId);
    if (!tile || tile.done || c.resolved) return reject(s, 'حُسم هذا السؤال بالفعل.');
    checkpoint(s); const group = nextId(s, 'resolution'), ids = [], earned = winner === null || c.phase === 'trap' && s.config.trapSuccess === 'none' ? 0 : c.value * (c.doubleTeam === winner ? 2 : 1) + (s.config.bonus && winner === c.selector ? 50 : 0);
    if (winner !== null && !(c.phase === 'trap' && s.config.trapSuccess === 'none')) ids.push(transaction(s, winner, earned, c.phase === 'steal' && winner !== c.selector ? 'steal' : c.phase === 'trap' ? 'trap-correct' : 'correct', c.doubleTeam === winner ? 'double' : s.config.bonus && winner === c.selector ? 'bonus' : 'normal', now, group, c.questionId, c.value));
    if (c.pitTeam !== null && winner === c.pitTeam) ids.push(transaction(s, 1 - c.pitTeam, -c.value, 'pit', 'pit', now, group, c.questionId, c.value));
    if (c.pitTeam !== null && winner !== c.pitTeam && s.config.pitFailPenalty) ids.push(transaction(s, c.pitTeam, -c.value, 'pit-failed', 'pit', now, group, c.questionId, c.value));
    if (c.phase === 'trap' && winner !== c.responder) ids.push(transaction(s, c.responder, -c.value, 'trap-failed', 'trap', now, group, c.questionId, c.value));
    if (c.phase === 'steal' && winner !== c.responder && s.config.stealPenalty) ids.push(transaction(s, c.responder, -c.value, 'steal-failed', 'steal', now, group, c.questionId, c.value));
    const failed = new Set(c.failedTeams);
    if (winner === null) { failed.add(c.selector); if (c.phase !== 'first') failed.add(c.responder); }
    else if (winner !== c.selector) failed.add(c.selector);
    for (const i of failed) if (i !== winner) s.teams[i].incorrect++;
    if (winner !== null) { s.teams[winner].correct++; if (c.phase === 'steal' && winner !== c.selector) s.teams[winner].steals++; }
    tile.done = true; c.resolved = true; c.winner = winner; c.earned = earned; c.transactionIds = ids; c.closed = true;
    const q = { questionId: c.questionId, tileId: c.tileId, value: c.value, selector: c.selector, responder: c.responder, winner, phase: c.phase, correct: winner !== null, transactionIds: ids, at: now, assists: clone(c.usedAssists) };
    s.history.push(q); s.turn = 1 - c.selector; s.state = 'TURN_COMPLETE';
    s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1;
    return s;
  }
  /* Knowledge is irreversible even when a host undoes a scoring/helper action.
     Once players have seen a solution, the same question can only be adjudicated;
     it can never become a fresh timed/stealable attempt in this match. */
  function knowledge(s) {
    return [...new Set([
      ...(Array.isArray(s.knownAnswers) ? s.knownAnswers : []),
      ...(s.history || []).map(h => h.questionId),
      ...(s.current?.revealed ? [s.current.questionId] : [])
    ])];
  }
  function preserveKnowledge(s, now) {
    s.knownAnswers = knowledge(s);
    const c = s.current;
    if (c && s.knownAnswers.includes(c.questionId) && !c.revealed && !c.resolved) {
      stopClock(c, now); c.revealed = true; c.closed = true; c.pendingWinner = null;
      c.assistance = null; c.knowledgeLocked = true; delete s.pausedFrom;
      refreshToken(s); s.state = 'ANSWER_REVEAL';
    }
    return s;
  }
  function isActive(s) { return PLAY_STATES.includes(s.state) && s.current && !s.current.closed; }
  function assist(s, action, now) {
    const key = action.key, c = s.current;
    if (!c || !ASSISTS.includes(key) || !s.config.assistEnabled[key] || !action.confirmed) return reject(s, 'أكد استخدام المساعدة أولًا.');
    const i = action.teamId === undefined ? c.responder : teamIndex(action.teamId);
    if (i !== c.responder || !integer(s.teams[i]?.assists[key], 1, 5)) return reject(s, 'هذه المساعدة غير متاحة لهذا الفريق.');
    if (key === 'pit' ? s.state !== 'QUESTION_PREVIEW' : !isActive(s)) return reject(s, key === 'pit' ? 'تُفعّل الحفرة قبل كشف السؤال فقط.' : 'المساعدة متاحة أثناء الإجابة فقط.');
    if (c.usedAssists.some(a => a.key === key && a.teamId === i)) return reject(s, 'استُخدمت هذه المساعدة في السؤال الحالي.');
    if (key === 'hint' && !s.config.hints) return reject(s, 'التلميحات معطّلة في هذه المباراة.');
    if (key === 'time' && !c.timed) return reject(s, 'الوقت الإضافي يتطلب مؤقّتًا مفعّلًا.');
    if ((key === 'twice' || key === 'second') && (c.twiceTeam === i || c.secondTeam === i || c.attempts.some(a => a.teamId === i))) return reject(s, 'تُفعّل محاولة إضافية واحدة قبل اعتماد الإجابة.');
    if (key === 'trap' && (c.phase !== 'first' || c.attempts.length || c.trapTeam !== null)) return reject(s, 'لا يُنقل السؤال بالفخ أكثر من مرة.');
    const participant = cleanText(action.participant, '', 32);
    if (key === 'sitout' && (!participant || !s.teams[1 - i].players.includes(participant))) return reject(s, 'اختر مشاركًا مسجلًا من الفريق المقابل وأكد الاستراحة.');
    checkpoint(s); s.teams[i].assists[key]--;
    const record = { id: nextId(s, 'assist'), key, teamId: i, questionId: c.questionId, at: now, participant: key === 'sitout' ? participant : null };
    s.teams[i].assistHistory.push(record); c.usedAssists.push(record);
    if (key === 'pit') c.pitTeam = i;
    if (key === 'twice') { c.twiceTeam = i; c.twice = true; }
    if (key === 'second') c.secondTeam = i;
    if (key === 'hint') c.hint = true;
    if (key === 'double') c.doubleTeam = i;
    if (key === 'sitout') c.sitout = { teamId: 1 - i, participant };
    if (key === 'time') { c.remainingMs = c.deadline !== null ? Math.max(0, c.deadline - now) + 15000 : c.remainingMs + 15000; if (c.deadline !== null) c.deadline = now + c.remainingMs; }
    if (key === 'call') {
      const returnState = s.state;
      if (s.config.callPause) stopClock(c, now);
      c.assistance = { key: 'call', teamId: i, returnState, deadline: now + s.config.callDuration * 1000, remainingMs: s.config.callDuration * 1000, pausedMain: s.config.callPause };
      refreshToken(s); s.state = 'ASSISTANCE_ACTIVE';
    }
    if (key === 'trap') {
      stopClock(c, now); c.phase = 'trap'; c.trapTeam = i; c.responder = 1 - i; c.hint = false; c.twice = false;
      refreshToken(s); startClock(c, s.config.duration, s.config.timer, now); if (s.config.mode === 'presenter') { c.timerStarted = false; c.deadline = null; } s.state = 'QUESTION_ACTIVE';
    }
    if (key === 'skip') { c.skip = true; reveal(s, now, null); }
    return s;
  }
  function returnAssistance(s, now) {
    const c = s.current, a = c?.assistance;
    if (s.state !== 'ASSISTANCE_ACTIVE' || !a) return reject(s, 'لا توجد مساعدة نشطة.');
    s.state = a.returnState;
    if (a.pausedMain && c.timed && c.timerStarted) c.deadline = now + c.remainingMs;
    c.assistance = null; refreshToken(s);
    if (c.timed && c.deadline !== null && c.deadline <= now) failAttempt(s, now, true, 'timeout');
    return s;
  }
  function dispatch(raw, action, bank, now = Date.now()) {
    let s;
    try { s = clone(raw); } catch { throw Error('حالة المباراة غير قابلة للقراءة.'); }
    s.lastError = null; preserveKnowledge(s, now);
    if (!action || typeof action.type !== 'string' || !integer(now, 0, 1e14)) return reject(s, 'إجراء المباراة غير صالح.');
    const c = s.current, q = c ? bank.find(q => q.id === c.questionId) : null;
    if (action.type === 'UNDO') {
      if (!s.undo.length) return reject(s, 'لا توجد خطوة قابلة للتراجع.');
      const undo = s.undo.slice(), restored = undo.pop(); restored.undo = undo; restored.serial = Math.max(s.serial, restored.serial); restored.lastError = null;
      restored.knownAnswers = [...new Set([...knowledge(s), ...knowledge(restored)])];
      preserveKnowledge(restored, now);
      if (restored.current && PLAY_STATES.includes(restored.state)) { stopClock(restored.current, now); restored.pausedFrom = restored.state; restored.state = 'PAUSED'; }
      return restored;
    }
    if (action.type === 'ADJUST_SCORE') {
      const team = teamIndex(action.teamId);
      if (team === null || !integer(action.delta, -100000, 100000) || !action.delta || !safeText(action.reason || '', 160)) return reject(s, 'تصحيح النقاط غير صالح.');
      checkpoint(s); const group = nextId(s, 'correction'); transaction(s, team, action.delta, 'host-correction', cleanText(action.reason, 'تصحيح المضيف', 160), now, group, c?.questionId || null, c?.value || 0);
      s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1; return s;
    }
    if (action.type === 'PAUSE') {
      if (s.state === 'PAUSED' || s.state === 'MATCH_COMPLETE') return s;
      s.pausedFrom = s.state;
      if (c) { stopClock(c, now); if (c.assistance?.deadline !== null && c.assistance) { c.assistance.remainingMs = Math.max(0, c.assistance.deadline - now); c.assistance.deadline = null; } }
      s.state = 'PAUSED'; return s;
    }
    if (action.type === 'RESUME') {
      if (s.state !== 'PAUSED' || !STATES.includes(s.pausedFrom)) return reject(s, 'المباراة ليست متوقفة.');
      s.state = s.pausedFrom; delete s.pausedFrom;
      if (c) {
        if (c.timed && c.timerStarted && PLAY_STATES.includes(s.state)) c.deadline = now + c.remainingMs;
        if (s.state === 'ASSISTANCE_ACTIVE' && c.assistance) { c.assistance.deadline = now + c.assistance.remainingMs; if (!c.assistance.pausedMain && c.timed && c.timerStarted) c.deadline = now + c.remainingMs; }
        refreshToken(s);
      }
      return s;
    }
    if (s.state === 'PAUSED' || s.state === 'MATCH_COMPLETE') return reject(s, 'هذا الإجراء غير متاح في حالة المباراة الحالية.');
    if (action.type === 'SELECT_TILE') {
      if (s.state !== 'BOARD' || c) return reject(s, 'أكمل السؤال الحالي أولًا.');
      const tile = s.board.find(t => t.id === action.tileId);
      if (!tile || tile.done) return reject(s, 'هذه الخانة غير متاحة.');
      const question = bank.find(q => q.id === tile.questionId);
      const rng = rngFor(s.seed + s.serial + tile.value + s.history.length);
      const wrong = shuffle([0, 1, 2, 3].filter(i => i !== question.answer), rng).slice(0, s.config.choiceCount - 1);
      s.current = { tileId: tile.id, questionId: tile.questionId, value: tile.value, selector: s.turn, responder: s.turn, phase: 'first', token: '', deadline: null, remainingMs: s.config.duration * 1000, timed: s.config.timer, timerStarted: false, revealed: false, closed: false, resolved: false, pitTeam: null, doubleTeam: null, twiceTeam: null, secondTeam: null, twice: false, trapTeam: null, attempts: [], failedTeams: [], usedAssists: [], assistance: null, choices: shuffle([question.answer, ...wrong], rng), hint: false, pendingWinner: null, winner: null, earned: 0, transactionIds: [], lastAttemptIncorrect: false, skip: false, sitout: null };
      refreshToken(s); s.state = 'QUESTION_PREVIEW'; return preserveKnowledge(s, now);
    }
    if (action.type === 'START_QUESTION') {
      if (s.state !== 'QUESTION_PREVIEW' || !c) return reject(s, 'لا يوجد سؤال جاهز للكشف.');
      startClock(c, s.config.duration, s.config.timer, now); if (s.config.mode === 'presenter') { c.timerStarted = false; c.deadline = null; } refreshToken(s); s.state = 'QUESTION_ACTIVE'; return s;
    }
    if (action.type === 'START_TIMER') {
      if (s.state !== 'QUESTION_ACTIVE' || !c || c.timerStarted || !c.timed) return reject(s, 'المؤقّت غير متاح للبدء في هذه الحالة.');
      c.timerStarted = true; c.deadline = now + c.remainingMs; refreshToken(s); return s;
    }
    if (action.type === 'TICK') {
      if (!c || action.token !== c.token) return s;
      if (s.state === 'ASSISTANCE_ACTIVE' && c.assistance) {
        if (!c.assistance.pausedMain && c.timed && c.deadline !== null && now >= c.deadline) { s.state = c.assistance.returnState; c.assistance = null; failAttempt(s, now, true, 'timeout'); }
        else if (c.assistance.deadline !== null && now >= c.assistance.deadline) returnAssistance(s, now);
      } else if (isActive(s) && c.timed && c.timerStarted && c.deadline !== null && now >= c.deadline) failAttempt(s, now, true, 'timeout');
      return s;
    }
    if (isActive(s) && c.timed && c.timerStarted && c.deadline !== null && now >= c.deadline) { failAttempt(s, now, true, 'timeout'); return reject(s, 'انتهى وقت المحاولة.'); }
    if (action.type === 'START_STEAL') {
      if (s.state !== 'STEAL_OPPORTUNITY' || !c || c.timerStarted) return reject(s, 'فرصة السرقة ليست بانتظار البدء.');
      startClock(c, s.config.stealDuration, s.config.timer, now); refreshToken(s); return s;
    }
    if (action.type === 'DECLARE_INCORRECT' || action.type === 'STEAL') {
      if (!isActive(s)) return reject(s, 'لا توجد محاولة إجابة نشطة.');
      failAttempt(s, now, false, 'host-incorrect'); return s;
    }
    if (action.type === 'REVEAL') {
      if (!isActive(s)) return reject(s, 'لا يمكن كشف الإجابة في هذه الحالة.');
      const pending = action.outcome === 'none' ? null : c.responder;
      reveal(s, now, pending); return s;
    }
    if (action.type === 'ANSWER') {
      if (!isActive(s) || s.config.answerStyle === 'oral') return reject(s, 'اعتمد الإجابة الشفهية من أدوات المضيف.');
      const values = Array.isArray(action.values) ? action.values : Array.isArray(action.value) ? action.value : [action.value];
      const max = c.twiceTeam === c.responder || c.secondTeam === c.responder ? 2 : 1;
      if (!values.length || values.length > max || c.attempts.filter(a => a.teamId === c.responder).length + values.length > max) return reject(s, 'عدد الإجابات المقترحة يتجاوز المحاولات المتاحة.');
      let correct = false;
      if (s.config.answerStyle === 'choice') {
        if (values.some(v => !integer(v, 0, 3) || !c.choices.includes(v)) || new Set(values).size !== values.length) return reject(s, 'اختر إجابة متاحة.');
        correct = values.includes(q.answer);
      } else {
        if (values.some(v => !safeText(v, 180) || !normalizeAnswer(v))) return reject(s, 'اكتب إجابة صالحة أولًا.');
        const aliases = [q.options[q.answer], ...(q.acceptedAnswers || q.alternativeAnswers || q.alternatives || [])].filter(v => typeof v === 'string').map(normalizeAnswer);
        correct = values.some(v => aliases.includes(normalizeAnswer(v)));
      }
      if (correct) { c.attempts.push({ teamId: c.responder, correct: true, reason: 'answer', at: now, values: clone(values) }); reveal(s, now, c.responder); }
      else { const responder = c.responder; for (let i = 1; i < values.length; i++) c.attempts.push({ teamId: responder, correct: false, reason: 'answer', at: now, values: [values[i-1]] }); failAttempt(s, now, values.length === max, 'answer'); const last = c.attempts[c.attempts.length-1]; if (last && last.teamId === responder) last.values = [values[values.length-1]]; }
      return s;
    }
    if (action.type === 'ASSIST') return assist(s, action, now);
    if (action.type === 'RETURN_ASSISTANCE') return returnAssistance(s, now);
    if (action.type === 'BEGIN_ADJUDICATION') { if (s.state === 'ANSWER_REVEAL') s.state = 'SCORE_ADJUDICATION'; else reject(s, 'لم تُكشف الإجابة بعد.'); return s; }
    if (action.type === 'ADJUDICATE') {
      if (!['ANSWER_REVEAL', 'SCORE_ADJUDICATION'].includes(s.state) || !c || !c.revealed) return reject(s, 'اكشف الإجابة قبل تسجيل النتيجة.');
      const winner = action.teamId === null ? null : teamIndex(action.teamId);
      if (action.teamId !== null && winner === null) return reject(s, 'حدد الفريق الصحيح أو اختر لا أحد.');
      return adjudicate(s, c.skip ? null : winner, now);
    }
    if (action.type === 'NEXT_TURN') {
      if (s.state !== 'TURN_COMPLETE' || !c?.resolved) return reject(s, 'احسم السؤال قبل الانتقال.');
      s.current = null;
      if (s.board.every(t => t.done)) { s.state = 'MATCH_COMPLETE'; s.completedAt = now; s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1; }
      else s.state = 'BOARD'; return s;
    }
    return reject(s, 'إجراء غير معروف أو غير متاح.');
  }
  function validateState(raw, bank) {
    try {
      if (!raw || raw.version !== VERSION || !Array.isArray(bank) || configErrors(raw.config, null).length || !STATES.includes(raw.state) || !safeText(raw.id, 100) || !integer(raw.seed, 0, 4294967295) || !integer(raw.serial) || !integer(raw.createdAt, 0, 1e14) || !integer(raw.turn, 0, 1)) return null;
      const c = cleanConfig(raw.config), qmap = new Map(bank.map(q => [q.id, q])), expected = c.board === 'classic' ? 36 : 18;
      if (raw.knownAnswers !== undefined && (!Array.isArray(raw.knownAnswers) || raw.knownAnswers.length > expected || new Set(raw.knownAnswers).size !== raw.knownAnswers.length || raw.knownAnswers.some(id => !raw.board?.some(t => t.questionId === id)))) return null;
      if (!Array.isArray(raw.categories) || JSON.stringify(raw.categories) !== JSON.stringify(c.teams.flatMap(t => t.categories)) || !Array.isArray(raw.board) || raw.board.length !== expected || new Set(raw.board.map(t => t.id)).size !== expected || new Set(raw.board.map(t => t.questionId)).size !== expected) return null;
      for (const cat of raw.categories) for (const value of VALUES) if (raw.board.filter(t => t.category === cat && t.value === value).length !== (c.board === 'classic' ? 2 : 1)) return null;
      if (raw.board.some(t => !safeText(t.id, 120) || !qmap.has(t.questionId) || qmap.get(t.questionId).category !== t.category || (!raw.board.every(tile => tile.done) && pointValue(qmap.get(t.questionId)) !== t.value) || !integer(t.slot, 0, c.board === 'classic' ? 1 : 0) || typeof t.done !== 'boolean')) return null;
      if (!Array.isArray(raw.teams) || raw.teams.length !== 2 || !Array.isArray(raw.transactions) || raw.transactions.length > 1000 || !Array.isArray(raw.history) || raw.history.length > expected || !Array.isArray(raw.undo) || raw.undo.length > 24) return null;
      if ((raw.winner !== null && !integer(raw.winner, 0, 1)) || (raw.completedAt !== null && !integer(raw.completedAt, 0, 1e14))) return null;
      const scores = [0, 0], ids = new Set();
      for (const tx of raw.transactions) {
        if (!tx || !safeText(tx.id, 180) || ids.has(tx.id) || !integer(tx.teamId, 0, 1) || !integer(tx.originalValue, 0, 600) || !safeText(tx.reason, 80) || !safeText(tx.modifier, 160) || !integer(tx.scoreBefore, -1e8, 1e8) || !integer(tx.scoreAfter, c.negative ? -1e8 : 0, 1e8) || scores[tx.teamId] !== tx.scoreBefore || !integer(tx.timestamp, 0, 1e14) || !safeText(tx.groupId, 180) || (tx.questionId !== null && !qmap.has(tx.questionId))) return null;
        scores[tx.teamId] = tx.scoreAfter; ids.add(tx.id);
      }
      for (let i = 0; i < 2; i++) {
        const t = raw.teams[i];
        if (!t || t.id !== `team-${i}` || t.name !== c.teams[i].name || t.color !== c.teams[i].color || t.avatar !== c.teams[i].avatar || JSON.stringify(t.players) !== JSON.stringify(c.teams[i].players) || t.score !== scores[i] || ['correct', 'incorrect', 'steals'].some(k => !integer(t[k], 0, expected)) || !t.assists || !Array.isArray(t.assistHistory) || t.assistHistory.length > 50 || Object.keys(t.assists).some(k => !c.teams[i].assists.includes(k)) || c.teams[i].assists.some(k => !integer(t.assists[k], 0, c.assistLimits[k]))) return null;
        for (const a of t.assistHistory) if (!a || !ASSISTS.includes(a.key) || !c.teams[i].assists.includes(a.key) || a.teamId !== i || !raw.board.some(tile => tile.questionId === a.questionId) || !integer(a.at, 0, 1e14) || !safeText(a.id, 180) || (a.participant !== null && !safeText(a.participant, 32))) return null;
        for (const key of c.teams[i].assists) if (t.assists[key] + t.assistHistory.filter(a => a.key === key).length !== c.assistLimits[key]) return null;
      }
      const startingTeam = raw.startingTeam ?? (c.starter === '0' ? 0 : c.starter === '1' ? 1 : raw.history[0]?.selector ?? raw.current?.selector ?? raw.turn);
      if (!integer(startingTeam, 0, 1) || raw.turn !== (startingTeam ^ raw.history.length % 2)) return null;
      const historyIds = new Set();
      for (const [historyIndex,h] of raw.history.entries()) {
        const tile = raw.board.find(t => t.id === h.tileId);
        if (h.selector !== (startingTeam ^ historyIndex % 2) || !tile || !tile.done || tile.questionId !== h.questionId || historyIds.has(h.tileId) || !integer(h.selector, 0, 1) || !integer(h.responder, 0, 1) || (h.winner !== null && !integer(h.winner, 0, 1)) || !Array.isArray(h.transactionIds) || h.transactionIds.some(id => !ids.has(id)) || !Array.isArray(h.assists) || h.assists.some(a => !a || !ASSISTS.includes(a.key) || !integer(a.teamId, 0, 1) || !raw.teams[a.teamId].assistHistory.some(record => record.id === a.id)) || !integer(h.at, 0, 1e14) || !['first', 'steal', 'trap'].includes(h.phase)) return null;
        historyIds.add(h.tileId);
      }
      if (raw.board.filter(t => t.done).length !== raw.history.length) return null;
      if (raw.state === 'BOARD' && raw.current !== null || raw.state === 'MATCH_COMPLETE' && (raw.current !== null || raw.board.some(t => !t.done))) return null;
      if (raw.state === 'PAUSED' && (!STATES.includes(raw.pausedFrom) || raw.pausedFrom === 'PAUSED')) return null;
      if (raw.current !== null) {
        const a = raw.current, tile = raw.board.find(t => t.id === a.tileId);
        if (!tile || a.questionId !== tile.questionId || a.value !== tile.value || !integer(a.selector, 0, 1) || !integer(a.responder, 0, 1) || !['first', 'steal', 'trap'].includes(a.phase) || !safeText(a.token, 180) || !Array.isArray(a.choices) || a.choices.length !== c.choiceCount || new Set(a.choices).size !== c.choiceCount || a.choices.some(n => !integer(n, 0, 3)) || !a.choices.includes(qmap.get(a.questionId).answer) || !integer(a.remainingMs, 0, 1000000) || (a.deadline !== null && !integer(a.deadline, 0, 1e14)) || ['timed', 'timerStarted', 'revealed', 'closed', 'resolved', 'twice', 'hint', 'lastAttemptIncorrect', 'skip'].some(k => typeof a[k] !== 'boolean')) return null;
        if (!integer(a.earned) || a.usedAssists?.some(record => !record || !ASSISTS.includes(record.key) || !integer(record.teamId, 0, 1) || !raw.teams[record.teamId].assistHistory.some(item => item.id === record.id))) return null;
        if (a.sitout !== null && (!integer(a.sitout.teamId, 0, 1) || !raw.teams[a.sitout.teamId].players.includes(a.sitout.participant))) return null;
        if (['pitTeam', 'doubleTeam', 'twiceTeam', 'secondTeam', 'trapTeam', 'pendingWinner', 'winner'].some(k => a[k] !== null && !integer(a[k], 0, 1))) return null;
        if (!Array.isArray(a.attempts) || a.attempts.length > 8 || a.attempts.some(at => !integer(at.teamId, 0, 1) || typeof at.correct !== 'boolean' || !safeText(at.reason, 32) || !integer(at.at, 0, 1e14) || (at.values !== undefined && (!Array.isArray(at.values) || at.values.length > 2 || at.values.some(v => !(integer(v, 0, 3) || safeText(v, 180)))))) || !Array.isArray(a.failedTeams) || a.failedTeams.some(i => !integer(i, 0, 1)) || !Array.isArray(a.usedAssists) || a.usedAssists.length > 10 || !Array.isArray(a.transactionIds) || a.transactionIds.some(id => !ids.has(id))) return null;
        if (a.selector !== (a.resolved ? 1 - raw.turn : raw.turn) || a.responder !== (a.phase === 'first' ? a.selector : 1-a.selector)) return null;
        if (a.resolved !== tile.done || a.resolved && raw.state !== 'TURN_COMPLETE' && !(raw.state === 'PAUSED' && raw.pausedFrom === 'TURN_COMPLETE')) return null;
        const effective = raw.state === 'PAUSED' ? raw.pausedFrom : raw.state;
        if (['ANSWER_REVEAL', 'SCORE_ADJUDICATION', 'TURN_COMPLETE'].includes(effective) !== a.revealed || PLAY_STATES.includes(effective) && a.closed || effective === 'QUESTION_PREVIEW' && (a.revealed || a.timerStarted)) return null;
        if (a.assistance !== null) {
          const help = a.assistance;
          if (help.key !== 'call' || !integer(help.teamId, 0, 1) || !PLAY_STATES.includes(help.returnState) || (help.deadline !== null && !integer(help.deadline, 0, 1e14)) || !integer(help.remainingMs, 0, 300000) || typeof help.pausedMain !== 'boolean') return null;
        }
        if (effective === 'ASSISTANCE_ACTIVE' && !a.assistance) return null;
      } else if (!['BOARD', 'MATCH_COMPLETE'].includes(raw.state) && !(raw.state === 'PAUSED' && raw.pausedFrom === 'BOARD')) return null;
      const out = clone(raw); out.config = c; out.startingTeam = startingTeam; out.lastError = null;
      out.knownAnswers = knowledge(raw);
      /* Undo snapshots are validated when restored, not accepted as executable state.
         Keep only valid bounded snapshots; nested undo data is discarded. */
      out.undo = [];
      for (const snap of raw.undo) {
        if (!snap || snap.version !== VERSION || snap.id !== raw.id || snap.undo || JSON.stringify(snap.config) !== JSON.stringify(raw.config) || JSON.stringify(snap.board?.map(t => [t.id,t.questionId,t.value])) !== JSON.stringify(raw.board.map(t => [t.id,t.questionId,t.value]))) return null;
        const checked = validateState({ ...snap, undo: [] }, bank);
        if (!checked) return null;
        delete checked.undo; out.undo.push(checked);
      }
      if (out.state !== 'PAUSED' && out.state !== 'MATCH_COMPLETE') {
        out.pausedFrom = out.state; out.state = 'PAUSED';
        if (out.current) { const a = out.current; if (a.deadline !== null) a.remainingMs = Math.max(0, Math.min(a.remainingMs, a.deadline - Date.now())); a.deadline = null; if (a.assistance) { if (a.assistance.deadline !== null) a.assistance.remainingMs = Math.max(0, Math.min(a.assistance.remainingMs, a.assistance.deadline - Date.now())); a.assistance.deadline = null; } }
      }
      return preserveKnowledge(out, Date.now());
    } catch { return null; }
  }
  return Object.freeze({ VERSION, VALUES: Object.freeze(VALUES), ASSISTS: Object.freeze(ASSISTS), STATES: Object.freeze(STATES), defaults, validateConfig: configErrors, create, dispatch, validateState, normalizeAnswer, pointValue });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TeamEngine;
