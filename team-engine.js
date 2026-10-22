/* Independent, pure two-team match engine. No DOM, storage, timers or network.
   Dispatch returns a new serializable state. The UI owns one clock and persists
   state after each action. Invalid/stale actions never mutate the supplied state. */
const TeamEngine = (() => {
  'use strict';
  const VERSION = 3;
  const MAX_SERIAL = 1e9;
  const VALUES = [200, 400, 600];
  const ASSISTS = ['call', 'twice', 'pit', 'sitout', 'trap', 'time', 'hint', 'double', 'skip', 'second'];
  const STATES = ['BOARD', 'QUESTION_PREVIEW', 'QUESTION_ACTIVE', 'STEAL_OPPORTUNITY', 'ASSISTANCE_ACTIVE', 'ANSWER_REVEAL', 'SCORE_ADJUDICATION', 'TURN_COMPLETE', 'PAUSED', 'MATCH_COMPLETE'];
  const PLAY_STATES = ['QUESTION_ACTIVE', 'STEAL_OPPORTUNITY'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = (n, min = 0, max = 1e9) => Number.isInteger(n) && n >= min && n <= max;
  const safeText = (value, max = 60) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const identifier = (value,max=180) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
  const contentText = (value,max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const cleanText = (value, fallback, max = 32) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) || fallback;
  const pointValue = q => VALUES.includes(q.points) ? q.points : q.level === 1 ? 200 : q.level === 2 ? 400 : 600;
  const FRANCHISES = Object.freeze([
    ['naruto', 'ناروتو', 'Naruto', 'manga'],
    ['naruto-shippuden', 'ناروتو شيبودن', 'Naruto Shippuden', 'manga'],
    ['one-piece', 'ون بيس', 'One Piece', 'manga'],
    ['dragon-ball', 'دراغون بول', 'Dragon Ball', 'manga'],
    ['bleach', 'بليتش', 'Bleach', 'manga'],
    ['hunter-x-hunter', 'هنتر × هنتر', 'Hunter x Hunter', 'manga'],
    ['attack-on-titan', 'هجوم العمالقة', 'Attack on Titan', 'manga'],
    ['demon-slayer', 'قاتل الشياطين', 'Demon Slayer', 'manga'],
    ['jujutsu-kaisen', 'جوجوتسو كايسن', 'Jujutsu Kaisen', 'manga'],
    ['death-note', 'ديث نوت', 'Death Note', 'manga'],
    ['solo-leveling', 'سولو ليفلينغ', 'Solo Leveling', 'novel/manhwa'],
    ['fullmetal-alchemist', 'الخيميائي المعدني الكامل', 'Fullmetal Alchemist', 'manga']
  ].map(([id, title, originalTitle, sourceMedia]) => Object.freeze({id, title, originalTitle, sourceMedia})));
  const freezeTree = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeTree); Object.freeze(value); } return value; };
  function franchiseId(q) {
    if (q.franchiseId) return q.franchiseId;
    return FRANCHISES.find(f => f.originalTitle.toLowerCase() === String(q.sub || '').toLowerCase() || f.title === q.sub)?.id || null;
  }
  function isEligible(q, config = {}) {
    config = config && typeof config === 'object' ? config : {};
    if (!q || !verifiedForPlay(q) || !publicContent(q) || !validFormat(q) || !validAnswerData(q, true) || !validSource(q.source) || !identifier(q.category,64) || !integer(q.level,1,4) || (q.image && !identifier(q.image,120)) || q.disabled || q.unavailable || q.available === false || !identifier(q.id,120) || !contentText(q.q, 2000) || !q.q.trim() || !Array.isArray(q.options) || q.options.length !== 4 || q.options.some(x => !contentText(x,500) || !x.trim()) || !integer(q.answer, 0, 3)) return false;
    if (config.contentPreset === 'family' && (q.familyFriendly !== true || q.familyReview?.status !== 'editorial-suitability-reviewed' || !integer(q.minAge,0,12) || q.q.length > 180)) return false;
    if (config.contentPreset === 'visual' && !q.image) return false;
    if (q.category !== 'anime') return !config.spoilerProtection || !q.spoiler;
    const id = franchiseId(q), a = config.anime;
    if (a && (!Array.isArray(a.selected) || !a.levels || typeof a.levels !== 'object' || !id || !a.selected.includes(id))) return false;
    const permitted = a ? a.levels[id] ?? 1 : config.spoilerProtection === false ? 3 : 1;
    // Missing or legacy spoiler metadata is treated conservatively; disabling the
    // old checkbox never overrides an explicitly configured franchise limit.
    const level = integer(q.spoilerLevel, 1, 3) ? q.spoilerLevel : q.spoiler ? 2 : 1;
    return level <= permitted;
  }
  // A URL alone is not evidence of a factual check. Keep legacy/editorial,
  // pending and disputed material available to the library, never the allocator.
  function verifiedForPlay(q) {
    const v = q?.verification;
    if (!v || v.status !== 'source-checked' || !contentText(v.referenceTitle,500) || !v.referenceTitle.trim() || !contentText(v.section,2000) || !v.section.trim() || !contentText(v.notes,4000) || !v.notes.trim() || typeof v.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.verifiedAt)) return false;
    const date = new Date(v.verifiedAt + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== v.verifiedAt || v.verifiedAt > new Date().toISOString().slice(0,10)) return false;
    return validSource({title:v.referenceTitle,reference:v.section,url:v.referenceUrl,bibliography:v.bibliography});
  }
  function eligibleQuestions(bank, config = {}, filter = {}) {
    if (!Array.isArray(bank)) return [];
    filter = filter && typeof filter === 'object' ? filter : {};
    return bank.filter(q => q && (!filter.category || q.category === filter.category) && (!filter.value || pointValue(q) === filter.value) && isEligible(q, config));
  }
  function getQuestion(match, id, bank = []) { return match?.questions && Object.hasOwn(match.questions,id) ? match.questions[id] : bank.find(q => q.id === id) || null; }
  function questionSnapshot(q) {
    const out = clone(q);
    // Missing v2-library fields are normalized once; explicit contradictory data
    // is preserved for validation and must never be silently repaired on restore.
    if (out.points === undefined) out.points = pointValue(out);
    if (out.correctAnswer === undefined) out.correctAnswer = out.options?.[out.answer];
    if (out.acceptedAnswers === undefined) out.acceptedAnswers = clone(out.alternativeAnswers ?? out.alternatives ?? []);
    return freezeTree(out);
  }
  function safeTree(value, depth = 0) {
    if (depth > 12) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return typeof value !== 'number' || Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 2000000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && !/^\s*(?:javascript|vbscript):/i.test(value);
    if (Array.isArray(value)) return value.length <= 5000 && value.every(v => safeTree(v, depth + 1));
    return typeof value === 'object' && Object.keys(value).length <= 200 && Object.keys(value).every(k => !['__proto__', 'prototype', 'constructor'].includes(k) && safeTree(value[k], depth + 1));
  }
  function validSource(source) {
    if (!source || !contentText(source.title,500) || !source.title.trim() || !contentText(source.reference,2000) || !source.reference.trim()) return false;
    if (!source.url) return contentText(source.bibliography,2000) && !!source.bibliography.trim();
    if (typeof source.url !== 'string' || /[\s\u0000-\u001f\u007f]/u.test(source.url)) return false;
    try { const url = new URL(source.url); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
  }
  function publicContent(q) {
    if (q.publicEligible === false) return false;
    // Missing verification belongs to the grandfathered editorial library. A
    // source link alone never upgrades an explicit verification claim.
    const v = q.verification;
    if (v === undefined) return true;
    if (!v || !['editorial', 'source-checked'].includes(v.status)) return false;
    if (v.status === 'editorial') return true;
    if (typeof v.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.verifiedAt)) return false;
    const date = new Date(v.verifiedAt + 'T00:00:00Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === v.verifiedAt &&
      contentText(v.referenceTitle,500) && !!v.referenceTitle.trim() &&
      contentText(v.section,2000) && !!v.section.trim() && contentText(v.notes,4000) && !!v.notes.trim() &&
      validSource({title:v.referenceTitle, reference:v.section, url:v.referenceUrl, bibliography:v.bibliography});
  }
  function validAnswerData(q, legacy = false) {
    if (!q || !Array.isArray(q.options) || q.options.length !== 4 || q.options.some(x => !contentText(x,500) || !normalizeAnswer(x)) || new Set(q.options.map(normalizeAnswer)).size !== 4 || !integer(q.answer,0,3)) return false;
    if (!(legacy && q.points === undefined) && !VALUES.includes(q.points)) return false;
    if (!(legacy && q.correctAnswer === undefined) && q.correctAnswer !== q.options[q.answer]) return false;
    const aliases = legacy && q.acceptedAnswers === undefined ? q.alternativeAnswers ?? q.alternatives ?? [] : q.acceptedAnswers;
    if (!Array.isArray(aliases) || aliases.length > 100) return false;
    const distractors = new Set(q.options.filter((_,i) => i !== q.answer).map(normalizeAnswer));
    return aliases.every(value => contentText(value,500) && normalizeAnswer(value) && !distractors.has(normalizeAnswer(value)));
  }
  function validFormat(q) {
    const type = q.type || (q.image ? 'image' : 'text');
    if (!['text','image','ordering','clues','multipart','logic'].includes(type)) return false;
    if (['ordering','clues','multipart','logic'].includes(type) && (!contentText(q.instructions,1000) || !q.instructions.trim() || !contentText(q.judging,2000) || !q.judging.trim())) return false;
    const list = (items,min,max) => Array.isArray(items) && items.length >= min && items.length <= max && items.every(t => contentText(t,500) && t.trim());
    if (type === 'ordering' && (!list(q.items,3,6) || !list(q.correctOrder,3,6) || q.items.length !== q.correctOrder.length || new Set(q.items.map(normalizeAnswer)).size !== q.items.length || new Set(q.correctOrder.map(normalizeAnswer)).size !== q.items.length || q.correctOrder.some(item => !q.items.includes(item)) || normalizeAnswer(q.correctOrder.join('، ثم ')) !== normalizeAnswer(q.correctAnswer || q.options?.[q.answer]))) return false;
    if (type === 'clues' && !list(q.clues,2,5)) return false;
    if (type === 'multipart' && !list(q.parts,2,5)) return false;
    return true;
  }
  function validQuestion(q) {
    return q && safeTree(q) && validFormat(q) && validAnswerData(q) && (q.image === undefined || q.image === null || q.image === '' || identifier(q.image,120)) && identifier(q.id,120) && identifier(q.category,64) && validSource(q.source) && contentText(q.q, 2000) && q.q.trim() && Array.isArray(q.options) && q.options.length === 4 && q.options.every(x => contentText(x, 500) && x.trim()) && new Set(q.options.map(normalizeAnswer)).size === 4 && integer(q.answer, 0, 3) && integer(q.level, 1, 4) && contentText(q.explanation || '', 4000);
  }
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
      mode: 'teams', board: 'classic', contentPreset: 'standard', variant: 'classic', categoryCount: 6, pointValues: [...VALUES], answerStyle: 'oral', choiceCount: 4,
      timer: true, duration: 60, steal: true, stealDuration: 10, negative: false,
      bonus: false, sound: true, animations: true, explanations: true, hints: true,
      spoilerProtection: true, repetition: 'recent', anime: {selected: FRANCHISES.map(f => f.id), levels: Object.fromEntries(FRANCHISES.map(f => [f.id, 1]))}, transition: 'auto', starter: '0', assistSlots: 3,
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
    if (c.contentPreset !== undefined && !['standard','family','visual'].includes(c.contentPreset)) errors.push('مرشح محتوى المباراة غير صالح.');
    if (c.variant !== undefined && !['classic','quick','challenge','visual','custom'].includes(c.variant)) errors.push('نوع المواجهة غير صالح.');
    const categoryCount = c.categoryCount === undefined ? 6 : c.categoryCount, values = c.pointValues === undefined ? VALUES : c.pointValues;
    if (![2,4,6].includes(categoryCount) || c.variant !== 'custom' && categoryCount !== 6) errors.push('عدد الفئات غير صالح؛ تسمح المباراة المخصصة بـ 2 أو 4 أو 6 فئات.');
    if (!Array.isArray(values) || !values.length || values.length > 3 || new Set(values).size !== values.length || values.some(v => !VALUES.includes(v)) || c.variant !== 'custom' && JSON.stringify(values) !== JSON.stringify(VALUES)) errors.push('قيم النقاط غير صالحة؛ اختر قيمًا مختلفة من 200 و400 و600.');
    for (const [key, allowed] of Object.entries({ mode: ['teams', 'presenter', 'party'], board: ['compact', 'classic'], answerStyle: ['oral', 'choice', 'typed'], choiceCount: [3, 4], transition: ['auto', 'host'], starter: ['0', '1', 'random'], trapSuccess: ['responder', 'none'] })) {
      if (!allowed.includes(c[key])) errors.push(`خيار ${ {mode:'نوع المباراة',board:'اللوحة',answerStyle:'الإجابة',choiceCount:'عدد الخيارات',transition:'الانتقال',starter:'البداية',trapSuccess:'الفخ'}[key] } غير صالح.`);
    }
    for (const key of ['timer', 'steal', 'negative', 'bonus', 'sound', 'animations', 'explanations', 'hints', 'spoilerProtection', 'callPause', 'pitFailPenalty', 'stealPenalty']) if (typeof c[key] !== 'boolean') errors.push('أحد مفاتيح القواعد غير صالح.');
    if (c.repetition !== undefined && !['recent', 'unseen', 'all'].includes(c.repetition)) errors.push('سياسة تكرار الأسئلة غير صالحة.');
    if (c.anime !== undefined && (!c.anime || !Array.isArray(c.anime.selected) || c.anime.selected.length > FRANCHISES.length || new Set(c.anime.selected).size !== c.anime.selected.length || c.anime.selected.some(id => !FRANCHISES.some(f => f.id === id)) || !c.anime.levels || FRANCHISES.some(f => !integer(c.anime.levels[f.id], 1, 3)))) errors.push('اختيار الأنمي أو حدود الحرق غير صالحة.');
    if (!integer(c.duration, 5, 600) || !integer(c.stealDuration, 3, 120) || !integer(c.callDuration, 10, 300)) errors.push('زمن السؤال أو السرقة أو الاتصال خارج النطاق المسموح.');
    if (!integer(c.assistSlots, 0, 5)) errors.push('اختر من 0 إلى 5 مساعدات لكل فريق.');
    if (!c.assistEnabled || !c.assistLimits || ASSISTS.some(k => typeof c.assistEnabled[k] !== 'boolean' || !integer(c.assistLimits[k], 0, 5))) errors.push('إعدادات المساعدات غير صالحة.');
    if (!Array.isArray(c.teams) || c.teams.length !== 2) return [...errors, 'يلزم فريقان بالضبط.'];
    const cats = [];
    c.teams.forEach((team, i) => {
      if (!team || !safeText(team.name, 32) || !team.name.trim()) errors.push(`اسم الفريق ${i + 1} غير صالح.`);
      if (!team || !/^#[0-9a-f]{6}$/i.test(team.color) || !safeText(team.avatar, 12)) errors.push('لون الفريق أو رمزه غير صالح.');
      if (!team || !Array.isArray(team.players) || team.players.length > 20 || team.players.some(name => !safeText(name, 32) || !name.trim())) errors.push('أسماء المشاركين غير صالحة.');
      if (!team || !Array.isArray(team.categories) || team.categories.length !== categoryCount / 2 || new Set(team.categories).size !== categoryCount / 2 || team.categories.some(id => !safeText(id, 64))) errors.push(`على الفريق ${i + 1} اختيار ${categoryCount / 2} فئات مختلفة.`);
      else cats.push(...team.categories);
      if (!team || !Array.isArray(team.assists) || team.assists.length > c.assistSlots || new Set(team.assists).size !== team.assists.length || team.assists.some(k => !ASSISTS.includes(k) || !c.assistEnabled?.[k] || c.assistLimits?.[k] <= 0 || (k === 'hint' && !c.hints))) errors.push('اختيارات المساعدات لا تطابق المساعدات المفعّلة وحدودها.');
    });
    c.teams.forEach((team, i) => { if (Array.isArray(team?.assists) && team.assists.includes('sitout') && (!Array.isArray(c.teams[1 - i]?.players) || !c.teams[1 - i].players.length)) errors.push('سجّل أسماء مشاركي الفريق المقابل لاستخدام مساعدة استريح.'); });
    if (cats.length === categoryCount && new Set(cats).size !== categoryCount) errors.push('يجب أن تكون الفئات مختلفة بين الفريقين.');
    if (Array.isArray(bank) && cats.length === categoryCount && Array.isArray(values) && values.every(v => VALUES.includes(v))) {
      const count = c.board === 'classic' ? 2 : 1;
      for (const cat of cats) for (const value of values) {
        if (eligibleQuestions(bank, c, {category:cat, value}).length < count) errors.push(`الفئة ${{anime:'الأنمي',football:'كرة القدم',prophets:'قصص الأنبياء',seerah:'السيرة النبوية',arabia:'التاريخ الجاهلي',islamic:'التاريخ الإسلامي',geo:'الجغرافيا',games:'ألعاب الفيديو',space:'الفضاء والفلك'}[cat] || 'المحددة'} لا تضم ${count} سؤالًا متاحًا بقيمة ${value} بعد الفلترة.`);
      }
    }
    return [...new Set(errors)];
  }
  function cleanConfig(c) {
    const base = defaults(), out = {};
    for (const key of Object.keys(base)) {
      if (key === 'teams') out.teams = c.teams.map((t, i) => ({ name: cleanText(t.name, base.teams[i].name), color: t.color, avatar: t.avatar, players: t.players.map(n => cleanText(n, 'مشارك')), categories: [...t.categories], assists: [...t.assists] }));
      else if (key === 'assistEnabled' || key === 'assistLimits') out[key] = Object.fromEntries(ASSISTS.map(k => [k, c[key][k]]));
      else if (key === 'anime') out[key] = clone(c.anime || base.anime);
      else if (key === 'pointValues') out[key] = [...(c.pointValues || VALUES)];
      else out[key] = c[key] === undefined ? clone(base[key]) : c[key];
    }
    return out;
  }
  function create(config, bank, options = {}) {
    const errors = configErrors(config, bank);
    if (errors.length) throw Error(errors.join(' '));
    const now = options.now ?? Date.now(), seed = Number(options.seed ?? now) >>> 0, rng = rngFor(seed), c = cleanConfig(config), seen = new Set(Array.isArray(options.seen) ? options.seen : Object.keys(options.seen || {}));
    const categories = c.teams.flatMap(t => t.categories), board = [], taken = new Set(), questions = Object.create(null), selectionWarnings = [], usedAnswers = new Set(), usedTopics = new Set();
    const seenAt = !Array.isArray(options.seen) && options.seen && typeof options.seen === 'object' ? options.seen : {};
    const recentIds = new Set((options.recentMatches || []).slice(-3).flatMap(m => m.questionIds || m.history?.map(h => h.questionId) || []));
    for (const [id, at] of Object.entries(seenAt)) if (Number.isFinite(at) && now - at <= 30 * 86400000) recentIds.add(id);
    // Existing array callers represent previously used questions without dates.
    if (Array.isArray(options.seen)) options.seen.forEach(id => recentIds.add(id));
    for (const category of categories) for (const value of c.pointValues) {
      const qs = shuffle(eligibleQuestions(bank, c, {category, value}), rng);
      if (c.repetition === 'unseen') qs.sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id)) || (seenAt[a.id] || 0) - (seenAt[b.id] || 0));
      else if (c.repetition === 'recent') qs.sort((a, b) => Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)) || (seenAt[a.id] || 0) - (seenAt[b.id] || 0));
      if (c.repetition === 'recent' && qs.filter(q => !recentIds.has(q.id)).length < (c.board === 'classic' ? 2 : 1)) selectionWarnings.push('أُعيد استخدام أقدم أسئلة متاحة لأن بدائل الأسئلة الحديثة غير كافية؛ بقيت قيود الحرق والفئات مطبّقة.');
      for (let slot = 0; slot < (c.board === 'classic' ? 2 : 1); slot++) {
        const available = qs.filter(q => !taken.has(q.id)), first = available[0];
        const priority = q => c.repetition === 'recent' ? Number(recentIds.has(q.id)) : c.repetition === 'unseen' ? Number(seen.has(q.id)) : 0;
        // Preserve recency/oldest priority; diversify equally eligible choices.
        const peers = first ? available.filter(q => priority(q) === priority(first) && (c.repetition === 'all' || (seenAt[q.id] || 0) === (seenAt[first.id] || 0))) : [];
        const variety = q => Number(usedAnswers.has(normalizeAnswer(q.options[q.answer]))) * 2 + Number(usedTopics.has(`${q.category}:${q.sub || ''}`));
        peers.sort((a,b) => (c.variant === 'visual' ? Number(!!b.image) - Number(!!a.image) : c.variant === 'challenge' ? b.level - a.level : 0) || variety(a) - variety(b));
        const q = peers[0];
        if (!q) throw Error('لا تكفي الأسئلة لبناء لوحة بلا تكرار.');
        if (c.variant === 'visual' && !q.image) selectionWarnings.push('أُكملت بعض خانات المواجهة البصرية بأسئلة نصية لأن الصور المؤهلة في مستوى النقاط المطلوب غير كافية.');
        taken.add(q.id); usedAnswers.add(normalizeAnswer(q.options[q.answer])); usedTopics.add(`${q.category}:${q.sub || ''}`); questions[q.id] = questionSnapshot(q); board.push({ id: `${category}-${value}-${slot}`, questionId: q.id, category, value, slot, done: false });
      }
    }
    const startingTeam = c.starter === 'random' ? Math.floor(rng() * 2) : Number(c.starter);
    return {
      version: VERSION, timing: {elapsedMs:0,lastActiveAt:now}, questions: freezeTree(questions), selectionWarnings: [...new Set(selectionWarnings)], statisticsVersion: 3, id: `match-${now}-${seed}`, state: 'BOARD', config: c, seed, createdAt: now,
      teams: c.teams.map((t, i) => ({ id: `team-${i}`, name: t.name, color: t.color, avatar: t.avatar, players: [...t.players], score: 0, correct: 0, incorrect: 0, steals: 0, assists: Object.fromEntries(t.assists.map(k => [k, c.assistLimits[k]])), assistHistory: [] })),
      categories, board, turn: startingTeam, startingTeam, current: null,
      transactions: [], history: [], knownAnswers: [], undo: [], serial: 0, lastError: null, completedAt: null, endedEarly:false, endReason:null, winner: null, lastResolution: null
    };
  }
  function reject(s, message) { s.lastError = message; return s; }
  function nextId(s, prefix) { if (!integer(s.serial,0,MAX_SERIAL-1)) throw Error('بلغ عداد المباراة الحد الآمن.'); s.serial++; return `${s.id}-${prefix}-${s.serial}`; }
  function checkpoint(s, kind = null) { const {questions, undo, ...rest} = s; const snap = clone(rest); if (kind) snap.undoAction = kind; s.undo.push(snap); if (s.undo.length > 24) s.undo.shift(); }
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
    c.pendingWinner = pendingWinner; c.assistance = null; refreshToken(s); c.resolutionId = nextId(s, 'judgment'); s.state = 'ANSWER_REVEAL';
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
    const tx = { id: nextId(s, 'score'), questionId, teamId: team, originalValue: value, delta, reason, modifier, scoreBefore: before, scoreAfter: after, timestamp: now, groupId };
    target.score = after; s.transactions.push(tx); return tx.id;
  }
  /* This pure preview is also the scoring plan used by adjudication. Deltas are
     actual changes after the configured zero floor, not promised deductions. */
  function explicitFailures(c, winner = null) { return new Set((c.attempts || []).filter(a => a.correct === false && !['timeout','skip','delegation'].includes(a.reason) && a.teamId !== winner).map(a => a.teamId)); }
  function scoreOutcome(s, requestedWinner, legacyFailureAccounting = false) {
    const c = s?.current;
    if (!c || (requestedWinner !== null && teamIndex(requestedWinner) === null)) return null;
    const winner = c.skip ? null : requestedWinner === null ? null : teamIndex(requestedWinner);
    const implicitSteal = c.phase === 'first' && winner !== null && winner !== c.selector && s.config.steal;
    const phase = implicitSteal ? 'steal' : c.phase;
    const responder = implicitSteal ? 1 - c.selector : c.responder;
    const doubled = winner !== null && questionAssists(c).some(a => a.key === 'double' && a.teamId === winner);
    const earned = winner === null || phase === 'trap' && s.config.trapSuccess === 'none' ? 0 : c.value * (doubled ? 2 : 1) + (s.config.bonus && winner === c.selector ? 50 : 0);
    const failed = explicitFailures(c, winner), transactions = [];
    const add = (teamId, delta, reason, modifier) => transactions.push({teamId, delta, reason, modifier});
    if (winner !== null && !(phase === 'trap' && s.config.trapSuccess === 'none')) add(winner, earned, phase === 'steal' && winner !== c.selector ? 'steal' : phase === 'trap' ? 'trap-correct' : 'correct', doubled ? 'double' : s.config.bonus && winner === c.selector ? 'bonus' : 'normal');
    if (c.pitTeam !== null && winner === c.pitTeam) add(1 - c.pitTeam, -c.value, 'pit', 'pit');
    if (c.pitTeam !== null && (legacyFailureAccounting ? winner !== c.pitTeam : failed.has(c.pitTeam)) && s.config.pitFailPenalty) add(c.pitTeam, -c.value, 'pit-failed', 'pit');
    if (phase === 'trap' && (legacyFailureAccounting ? winner !== responder : failed.has(responder))) add(responder, -c.value, 'trap-failed', 'trap');
    if (phase === 'steal' && (legacyFailureAccounting ? winner !== responder : failed.has(responder)) && s.config.stealPenalty) add(responder, -c.value, 'steal-failed', 'steal');
    const after = s.teams.map(t => t.score);
    for (const tx of transactions) after[tx.teamId] = s.config.negative ? after[tx.teamId] + tx.delta : Math.max(0, after[tx.teamId] + tx.delta);
    return {winner, earned, awarded:earned, deltas:after.map((n,i) => n - s.teams[i].score), transactions, phase, responder, steal:phase === 'steal' && winner !== null && winner !== c.selector};
  }
  function questionAssists(c) { return [...(c.usedAssists || []), ...(c.pendingAssists || [])]; }
  function pendingAssistsValid(s) {
    const c = s.current, pending = c?.pendingAssists ?? [];
    if (!Array.isArray(pending) || pending.length > 10) return false;
    if (!c || !Array.isArray(c.usedAssists)) return false;
    const effective = s.state === 'PAUSED' ? s.pausedFrom : s.state;
    if (pending.length && (!['ANSWER_REVEAL','SCORE_ADJUDICATION'].includes(effective) || c.resolved || !c.revealed || !c.closed)) return false;
    const combined = questionAssists(c), ids = new Set(), uses = new Map();
    if (combined.length > 10 || new Set(combined.map(a => `${a?.teamId}:${a?.key}`)).size !== combined.length) return false;
    for (const a of pending) {
      if (!a || !identifier(a.id) || ids.has(a.id) || !ASSISTS.includes(a.key) || !integer(a.teamId,0,1) || a.questionId !== c.questionId || !integer(a.at,0,1e14) || (a.participant !== null && !safeText(a.participant,32)) || !s.config.assistEnabled[a.key] || !s.config.teams[a.teamId].assists.includes(a.key) || s.teams.some(t => t.assistHistory.some(item => item.id === a.id)) || c.usedAssists.some(item => item.id === a.id)) return false;
      if (a.key === 'sitout' && !s.teams[1-a.teamId].players.includes(a.participant)) return false;
      ids.add(a.id); const key = `${a.teamId}:${a.key}`; uses.set(key,(uses.get(key)||0)+1);
      if (s.teams[a.teamId].assists[a.key] < uses.get(key)) return false;
    }
    for (const [field,key] of Object.entries({pitTeam:'pit',doubleTeam:'double',twiceTeam:'twice',secondTeam:'second',trapTeam:'trap'})) if (c[field] !== null && !combined.some(a => a.teamId === c[field] && a.key === key)) return false;
    if (c.phase === 'trap' && (c.trapTeam === null || !combined.some(a => a.key === 'trap' && a.teamId === c.selector))) return false;
    if (c.hint && !combined.some(a => a.key === 'hint') || c.skip && !combined.some(a => a.key === 'skip') || c.sitout && !combined.some(a => a.key === 'sitout' && a.participant === c.sitout.participant && a.teamId === 1-c.sitout.teamId)) return false;
    return true;
  }
  function consumePendingAssists(s) {
    const c = s.current;
    for (const a of c.pendingAssists || []) { s.teams[a.teamId].assists[a.key]--; s.teams[a.teamId].assistHistory.push(a); c.usedAssists.push(a); }
    c.pendingAssists = [];
  }
  function refundQuestionHelpers(state, records, questionId) {
    const ids = new Set(records.map(a => a.id));
    for (const team of state.teams) {
      const refunded = team.assistHistory.filter(a => ids.has(a.id));
      for (const a of refunded) team.assists[a.key]++;
      team.assistHistory = team.assistHistory.filter(a => !ids.has(a.id));
    }
    const c = state.current;
    if (c?.questionId === questionId) {
      // Entitlements remain attached to the question. Their inventory use is
      // deferred until readjudication so correction never loses Double/Pit.
      c.pendingAssists = [...new Map(questionAssists(c).map(a => [a.id, a])).values()];
      c.usedAssists = []; c.assistance = null;
      c.revealed = c.closed = c.knowledgeLocked = true; c.resolved = false;
      c.deadline = null; c.pendingWinner = c.winner = null; c.earned = 0; c.transactionIds = [];
      state.state = 'ANSWER_REVEAL'; delete state.pausedFrom;
    }
  }
  function resolutionCheckpoint(s) {
    const {questionId} = s.current, usedAssists = questionAssists(s.current);
    // Refunding a whole question must not resurrect its consumed helpers in an
    // older manual-adjustment Undo. Keep those adjustments, scrub helper use.
    s.undo = s.undo.filter(h => !(h.undoAction === 'assist' && h.current?.questionId === questionId));
    for (const snap of s.undo) if (snap.current?.questionId === questionId) refundQuestionHelpers(snap, usedAssists, questionId);
    checkpoint(s, 'question-resolution');
    refundQuestionHelpers(s.undo[s.undo.length - 1], usedAssists, questionId);
  }
  function finishTurn(s, now) {
    s.current = null;
    if (s.board.every(t => t.done)) { s.state = 'MATCH_COMPLETE'; if (s.timing) s.timing.lastActiveAt = null; s.completedAt = now; s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1; }
    else s.state = 'BOARD';
    return s;
  }
  function adjudicate(s, winner, now, atomic = false) {
    const c = s.current, tile = s.board.find(t => t.id === c.tileId);
    if (!tile || tile.done || c.resolved) return reject(s, 'حُسم هذا السؤال بالفعل.');
    if (!pendingAssistsValid(s)) return reject(s, 'تعذر إعادة اعتماد المساعدات المحفوظة؛ لم تتغير النقاط.');
    const outcome = scoreOutcome(s, winner);
    if (c.resolutionId && (s.history.some(h => h.resolutionId === c.resolutionId) || s.transactions.some(tx => tx.groupId === c.resolutionId))) return reject(s, 'سبق تطبيق نتيجة هذا السؤال.');
    if (atomic) resolutionCheckpoint(s); else checkpoint(s);
    consumePendingAssists(s);
    const group = c.resolutionId || nextId(s, 'resolution'), ids = [], earned = outcome.earned;
    winner = outcome.winner; c.phase = outcome.phase; c.responder = outcome.responder;
    for (const tx of outcome.transactions) ids.push(transaction(s, tx.teamId, tx.delta, tx.reason, tx.modifier, now, group, c.questionId, c.value));
    // Delegation, reveal, skip and clock transitions are not wrong answers.
    // A team's final host-approved success overrides its earlier rejected attempt.
    const failed = explicitFailures(c, winner);
    if (winner !== null) failed.delete(winner);
    for (const i of failed) if (i !== winner) s.teams[i].incorrect++;
    if (winner !== null) { s.teams[winner].correct++; if (c.phase === 'steal' && winner !== c.selector) s.teams[winner].steals++; }
    tile.done = true; c.resolved = true; c.winner = winner; c.earned = earned; c.transactionIds = ids; c.closed = true;
    const q = { scoringVersion:2, attemptAccounting:3, resolutionId:group, attempts: clone(c.attempts), incorrectTeams: [...failed], questionId: c.questionId, tileId: c.tileId, value: c.value, selector: c.selector, responder: c.responder, winner, phase: c.phase, correct: winner !== null, transactionIds: ids, at: now, assists: clone(c.usedAssists) };
    s.history.push(q); s.turn = 1 - c.selector; s.state = 'TURN_COMPLETE';
    s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1;
    if (atomic) {
      s.lastResolution = {id:group, questionId:c.questionId, tileId:c.tileId, token:c.token, winner, earned, deltas:outcome.deltas, transactionIds:ids, at:now, phase:outcome.phase, steal:outcome.steal};
      finishTurn(s, now);
    }
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
      refreshToken(s); c.resolutionId = nextId(s, 'judgment'); s.state = 'ANSWER_REVEAL';
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
    checkpoint(s, 'assist'); s.teams[i].assists[key]--;
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
    try { const {questions, ...mutable} = raw; s = clone(mutable); s.questions = questions || {}; } catch { throw Error('حالة المباراة غير قابلة للقراءة.'); }
    s.lastError = null;
    // Even a deliberately extreme imported counter must never wrap, duplicate
    // an ID or leave a state that cannot be saved. One dispatch mints at most
    // eight IDs; reject before clocks/knowledge/undo or scores can change.
    if (!integer(s.serial,0,MAX_SERIAL-8)) return reject(s, 'بلغ عداد المباراة الحد الآمن؛ صدّر نسخة احتياطية قبل بدء مباراة جديدة.');
    preserveKnowledge(s, now);
    if (s.timing && s.timing.lastActiveAt !== null && s.state !== 'PAUSED' && s.state !== 'MATCH_COMPLETE' && integer(now, 0, 1e14)) { s.timing.elapsedMs += Math.max(0, now - s.timing.lastActiveAt); s.timing.lastActiveAt = now; }
    if (!action || typeof action.type !== 'string' || !integer(now, 0, 1e14)) return reject(s, 'إجراء المباراة غير صالح.');
    const c = s.current, q = c ? getQuestion(s, c.questionId, bank) : null;
    const questionActions = ['START_QUESTION','START_TIMER','START_STEAL','PASS','DECLARE_INCORRECT','STEAL','REVEAL','ANSWER','ASSIST','RETURN_ASSISTANCE','BEGIN_ADJUDICATION','NEXT_CLUE'];
    if (questionActions.includes(action.type) && ((action.token !== undefined && action.token !== c?.token) || (action.questionId !== undefined && action.questionId !== c?.questionId) || (action.tileId !== undefined && action.tileId !== c?.tileId))) return reject(s, 'انتهت صلاحية إجراء السؤال.');
    if (action.type === 'UNDO') {
      if (!s.undo.length) return reject(s, 'لا توجد خطوة قابلة للتراجع.');
      if (action.expectedSerial !== undefined && action.expectedSerial !== s.serial || action.resolutionId !== undefined && (action.resolutionId !== s.lastResolution?.id || s.undo[s.undo.length-1]?.undoAction !== 'question-resolution')) return reject(s, 'انتهت صلاحية التراجع؛ راجع آخر إجراء في سجل المباراة.');
      const undo = s.undo.slice(), restored = undo.pop(); restored.undo = undo; restored.serial = Math.max(s.serial, restored.serial) + 1; restored.lastError = null; restored.questions = s.questions; restored.timing = s.timing ? {...s.timing, lastActiveAt:now} : null;
      const resolutionUndo = restored.undoAction === 'question-resolution'; delete restored.undoAction;
      restored.knownAnswers = [...new Set([...knowledge(s), ...knowledge(restored)])];
      preserveKnowledge(restored, now);
      if (restored.current && (resolutionUndo || restored.current.revealed && !restored.current.resolved)) { refreshToken(restored); restored.current.resolutionId = nextId(restored, 'judgment'); }
      if (restored.current && PLAY_STATES.includes(restored.state)) { stopClock(restored.current, now); restored.pausedFrom = restored.state; restored.state = 'PAUSED'; }
      if (restored.timing && ['PAUSED','MATCH_COMPLETE'].includes(restored.state)) restored.timing.lastActiveAt = null;
      return restored;
    }
    if (action.type === 'ADJUST_SCORE') {
      const team = teamIndex(action.teamId);
      if (team === null || !integer(action.delta, -100000, 100000) || !action.delta || !safeText(action.reason || '', 160) || !String(action.reason || '').trim()) return reject(s, 'تصحيح النقاط غير صالح.');
      if (action.operationId !== undefined && !identifier(action.operationId)) return reject(s, 'معرّف تصحيح النقاط غير صالح.');
      if (action.operationId && s.transactions.some(tx => tx.groupId === action.operationId)) return reject(s, 'سبق تطبيق هذا التصحيح.');
      // Keep enough room for every remaining question's complete linked award
      // and penalties, so a long correction history cannot create an unsavable
      // match that exceeds the import/restore limits.
      const remaining = s.board.filter(tile => !tile.done), reserve = remaining.reduce((sum,tile) => sum + tile.value * 3 + 50,0);
      const after = s.config.negative ? s.teams[team].score + action.delta : Math.max(0,s.teams[team].score + action.delta);
      if (s.transactions.length + 1 + remaining.length * 3 > 1000 || !integer(after,s.config.negative ? -1e8 + reserve : 0,1e8 - reserve)) return reject(s, 'بلغ سجل التصحيحات الحد الآمن؛ لم تتغير النقاط.');
      checkpoint(s); const group = action.operationId || nextId(s, 'correction'); transaction(s, team, action.delta, 'host-correction', cleanText(action.reason, 'تصحيح المضيف', 160), now, group, c?.questionId || null, c?.value || 0);
      s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1; return s;
    }
    if (action.type === 'SET_TIMER') {
      if (s.state !== 'PAUSED' || !c || c.revealed || !PLAY_STATES.includes(s.pausedFrom) || !integer(action.seconds,5,600)) return reject(s, 'أوقف محاولة السؤال أولًا، ثم اختر زمنًا بين 5 و600 ثانية.');
      checkpoint(s); c.remainingMs = action.seconds * 1000; c.deadline = null; c.timed = true; c.timerStarted = true; refreshToken(s); return s;
    }
    if (action.type === 'END_MATCH') {
      if (!action.confirmed || s.state === 'MATCH_COMPLETE' || action.reason !== undefined && (!safeText(action.reason,160) || !action.reason.trim())) return reject(s, 'أكد إنهاء المباراة قبل اعتماد النتيجة الحالية.');
      checkpoint(s); if (c) stopClock(c,now);
      // Keep consumed helper evidence for an unfinished question without
      // inventing a resolution or charging deferred helpers after Undo.
      s.abandonedAssists = c && !c.resolved ? clone(c.usedAssists) : [];
      s.current = null; s.state = 'MATCH_COMPLETE'; delete s.pausedFrom; s.completedAt = now; s.endedEarly = true; s.endReason = action.reason || 'أنهى المضيف المباراة بالنتيجة الحالية.';
      if (s.timing) s.timing.lastActiveAt = null;
      s.winner = s.teams[0].score === s.teams[1].score ? null : s.teams[0].score > s.teams[1].score ? 0 : 1; return s;
    }
    if (action.type === 'PAUSE') {
      if (s.state === 'PAUSED' || s.state === 'MATCH_COMPLETE') return s;
      s.pausedFrom = s.state; if (s.timing) s.timing.lastActiveAt = null;
      if (c) { stopClock(c, now); if (c.assistance?.deadline !== null && c.assistance) { c.assistance.remainingMs = Math.max(0, c.assistance.deadline - now); c.assistance.deadline = null; } }
      s.state = 'PAUSED'; return s;
    }
    if (action.type === 'RESUME') {
      if (s.state !== 'PAUSED' || !STATES.includes(s.pausedFrom)) return reject(s, 'المباراة ليست متوقفة.');
      s.state = s.pausedFrom; delete s.pausedFrom; if (s.timing) s.timing.lastActiveAt = now;
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
      const question = getQuestion(s, tile.questionId, bank);
      if (!question) return reject(s, 'تعذر العثور على نسخة السؤال المحفوظة.');
      const rng = rngFor(s.seed + s.serial + tile.value + s.history.length);
      const wrong = shuffle([0, 1, 2, 3].filter(i => i !== question.answer), rng).slice(0, s.config.choiceCount - 1);
      s.current = { tileId: tile.id, questionId: tile.questionId, value: tile.value, selector: s.turn, responder: s.turn, phase: 'first', token: '', deadline: null, remainingMs: s.config.duration * 1000, timed: s.config.timer, timerStarted: false, revealed: false, closed: false, resolved: false, pitTeam: null, doubleTeam: null, twiceTeam: null, secondTeam: null, twice: false, trapTeam: null, attempts: [], failedTeams: [], usedAssists: [], pendingAssists: [], assistance: null, choices: shuffle([question.answer, ...wrong], rng), hint: false, pendingWinner: null, winner: null, earned: 0, transactionIds: [], lastAttemptIncorrect: false, skip: false, sitout: null };
      if (question.type === 'clues') s.current.revealedClues = 1;
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
      c.timed = s.config.timer; c.timerStarted = true; c.deadline = c.timed ? now + c.remainingMs : null; refreshToken(s); return s;
    }
    if (action.type === 'PASS') {
      if (!isActive(s)) return reject(s, 'لا توجد محاولة نشطة لتجاوزها.');
      if (c.phase === 'first' && s.config.steal) beginSteal(s, now);
      else reveal(s, now, null);
      return s;
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
    if (action.type === 'NEXT_CLUE') {
      if (!isActive(s) || q?.type !== 'clues' || action.token !== c.token || !integer(c.revealedClues,1,q.clues.length) || c.revealedClues >= q.clues.length) return reject(s, 'لا يوجد تلميح جديد متاح لهذا السؤال.');
      c.revealedClues++; refreshToken(s); return s;
    }
    if (action.type === 'RETURN_ASSISTANCE') return returnAssistance(s, now);
    if (action.type === 'BEGIN_ADJUDICATION') { if (s.state === 'ANSWER_REVEAL') s.state = 'SCORE_ADJUDICATION'; else reject(s, 'لم تُكشف الإجابة بعد.'); return s; }
    if (action.type === 'RESOLVE_QUESTION') {
      if (!['ANSWER_REVEAL', 'SCORE_ADJUDICATION'].includes(s.state) || !c?.revealed || c.resolved) return reject(s, 'حُسم السؤال أو لم تُكشف إجابته بعد.');
      if (action.tileId !== c.tileId || action.questionId !== c.questionId || action.token !== c.token || action.resolutionId !== undefined && action.resolutionId !== c.resolutionId) return reject(s, 'انتهت صلاحية هذا الاختيار؛ استخدم خيارات السؤال الحالي.');
      const winner = action.teamId === null ? null : teamIndex(action.teamId);
      if (action.teamId !== null && winner === null) return reject(s, 'حدد الفريق الصحيح أو اختر محد جاوب صح.');
      return adjudicate(s, c.skip ? null : winner, now, true);
    }
    if (action.type === 'ADJUDICATE') {
      if (!['ANSWER_REVEAL', 'SCORE_ADJUDICATION'].includes(s.state) || !c || !c.revealed) return reject(s, 'اكشف الإجابة قبل تسجيل النتيجة.');
      if (action.tileId !== c.tileId || action.questionId !== c.questionId || action.token !== c.token || action.resolutionId !== undefined && action.resolutionId !== c.resolutionId) return reject(s, 'انتهت صلاحية اعتماد هذا السؤال.');
      const winner = action.teamId === null ? null : teamIndex(action.teamId);
      if (action.teamId !== null && winner === null) return reject(s, 'حدد الفريق الصحيح أو اختر لا أحد.');
      return adjudicate(s, c.skip ? null : winner, now);
    }
    if (action.type === 'NEXT_TURN') {
      if (s.state !== 'TURN_COMPLETE' || !c?.resolved) return reject(s, 'احسم السؤال قبل الانتقال.');
      return finishTurn(s, now);
    }
    return reject(s, 'إجراء غير معروف أو غير متاح.');
  }
  function migrateLegacy(raw, bank) {
    if (!raw || raw.version !== 2 || !Array.isArray(raw.board)) return null;
    const out = clone(raw), questions = Object.create(null);
    for (const tile of out.board) {
      const q = bank.find(q => q.id === tile.questionId);
      if (!q || !validQuestion(questionSnapshot(q))) return null;
      questions[q.id] = questionSnapshot({...q,category:tile.category,points:tile.value});
    }
    const upgrade = state => {
      state.version = VERSION;
      state.config = {...defaults(), ...state.config};
      state.config.anime = state.config.anime || {selected: FRANCHISES.map(f => f.id), levels: Object.fromEntries(FRANCHISES.map(f => [f.id, state.config.spoilerProtection ? 1 : 3]))};
      state.statisticsVersion = 1; state.timing = null;
      state.selectionWarnings = [];
      return state;
    };
    upgrade(out); out.questions = questions;
    if (Array.isArray(out.undo)) out.undo.forEach(upgrade);
    out.migration = {fromVersion:2, note:'حُفظت المباراة وتاريخها. أُنشئت نسخ الأسئلة من المكتبة الحالية؛ لم تتوفر نسخ تاريخية في الإصدار السابق.'};
    return out;
  }
  function restore(raw, bank) {
    const state = validateState(raw, bank);
    return state ? {state, error:null, backup:null} : {state:null, error:'تعذر استعادة المباراة بأمان. لم تُحذف النسخة الأصلية؛ صدّر نسخة احتياطية قبل بدء مباراة جديدة. قد يكون ملف الحفظ تالفًا أو أحد أسئلة الإصدار القديم غير متاح.', backup:raw};
  }
  /* Reconcile resolved questions against the same scoring plan used live. Score
     continuity alone is insufficient: forged files can change both the score
     and its final balance while leaving an apparently consistent ledger. */
  function validResolutionLedger(raw, config) {
    const txById = new Map(raw.transactions.map(tx => [tx.id,tx]));
    const assigned = new Set(), groups = new Set(), helpers = new Set();
    const records = raw.teams.flatMap(t => t.assistHistory);
    if (new Set(records.map(a => a.id)).size !== records.length) return false;
    const sameRecord = (a,b) => ['id','key','teamId','questionId','at','participant'].every(k => a[k] === b[k]);
    for (const h of raw.history) {
      if (new Set(h.transactionIds).size !== h.transactionIds.length || new Set(h.assists.map(a => `${a.teamId}:${a.key}`)).size !== h.assists.length) return false;
      for (const a of h.assists) {
        const record = records.find(r => r.id === a.id);
        if (!record || helpers.has(a.id) || !sameRecord(a,record)) return false;
        helpers.add(a.id);
      }
      const pit = h.assists.find(a => a.key === 'pit');
      const legacy = raw.statisticsVersion === 1 && h.scoringVersion === undefined;
      // V2 stored only the final Double owner and did not infer an implicit
      // steal from a host's opposite-team award. Preserve those historical
      // balances; new post-migration resolutions explicitly use version 2.
      const finalDouble = legacy ? h.assists.filter(a => a.key === 'double').at(-1) : null;
      const usedAssists = legacy ? h.assists.filter(a => a.key !== 'double' || a === finalDouble) : h.assists;
      const current = {value:h.value, selector:h.selector, responder:h.responder, phase:h.phase, attempts:h.attempts || [], usedAssists, pitTeam:pit?.teamId ?? null};
      const outcome = scoreOutcome({current, config:legacy ? {...config,steal:false} : config, teams:[{score:0},{score:0}]}, h.winner, h.attemptAccounting !== 3 && raw.statisticsVersion !== 3);
      if (!outcome || outcome.transactions.length !== h.transactionIds.length || outcome.phase !== h.phase) return false;
      let group = null;
      for (const [i,id] of h.transactionIds.entries()) {
        const tx = txById.get(id), expected = outcome.transactions[i];
        if (!tx || assigned.has(id) || tx.questionId !== h.questionId || tx.originalValue !== h.value || tx.timestamp !== h.at || tx.teamId !== expected.teamId || tx.reason !== expected.reason || tx.modifier !== expected.modifier || tx.delta !== undefined && tx.delta !== expected.delta || tx.scoreAfter !== (config.negative ? tx.scoreBefore + expected.delta : Math.max(0,tx.scoreBefore + expected.delta))) return false;
        if (group !== null && tx.groupId !== group) return false;
        group = tx.groupId; assigned.add(id);
      }
      if (group !== null) { if (groups.has(group)) return false; groups.add(group); }
    }
    for (const tx of raw.transactions) {
      if (assigned.has(tx.id)) continue;
      // Manual host corrections are deliberately importable and separately
      // bounded; they may occur between any two gameplay transactions.
      if (tx.reason !== 'host-correction' || groups.has(tx.groupId) || Math.abs(tx.scoreAfter - tx.scoreBefore) > 100000 || (tx.originalValue !== 0 && !VALUES.includes(tx.originalValue))) return false;
      groups.add(tx.groupId);
    }
    if (raw.current) for (const a of raw.current.usedAssists || []) {
      const record = records.find(r => r.id === a.id);
      if (!record || !sameRecord(a,record) || helpers.has(a.id) && !raw.current.resolved) return false;
      helpers.add(a.id);
    }
    const abandoned = raw.abandonedAssists === undefined ? raw.endedEarly ? records.filter(a => !helpers.has(a.id)) : [] : raw.abandonedAssists;
    if (!Array.isArray(abandoned) || abandoned.length > 10 || abandoned.length && (!raw.endedEarly || raw.current !== null) || new Set(abandoned.map(a => `${a?.teamId}:${a?.key}`)).size !== abandoned.length || new Set(abandoned.map(a => a?.questionId)).size > 1) return false;
    for (const a of abandoned) {
      const record = records.find(r => r.id === a?.id), tile = raw.board.find(t => t.questionId === a?.questionId);
      if (!record || !sameRecord(a,record) || helpers.has(a.id) || !tile || tile.done) return false;
      helpers.add(a.id);
    }
    return records.every(a => helpers.has(a.id));
  }
  function validSerialLedger(raw) {
    // Every generated identity carries the monotonically increasing counter.
    // Lowering only `serial` used to pass restore and later reuse score IDs.
    const prefix = raw.id + '-';
    const issued = (id, kinds) => {
      if (typeof id !== 'string' || !id.startsWith(prefix)) return false;
      const part = id.slice(prefix.length).match(/^(clock|assist|score|resolution|judgment|correction)-([1-9][0-9]*)$/);
      return !!part && kinds.includes(part[1]) && integer(Number(part[2]),1,raw.serial);
    };
    for (const tx of raw.transactions) if (!issued(tx.id,['score']) || (tx.reason === 'host-correction' ? !identifier(tx.groupId) : !issued(tx.groupId,['resolution','judgment']))) return false;
    for (const team of raw.teams) for (const record of team.assistHistory) if (!issued(record.id,['assist'])) return false;
    for (const h of raw.history) if (h.resolutionId !== undefined && !issued(h.resolutionId,['resolution','judgment']) || h.transactionIds.some(id => !issued(id,['score'])) || h.assists.some(a => !issued(a.id,['assist']))) return false;
    if (raw.current) {
      if (raw.current.resolutionId !== undefined && !issued(raw.current.resolutionId,['resolution','judgment'])) return false;
      if (!issued(raw.current.token,['clock']) || raw.current.transactionIds.some(id => !issued(id,['score']))) return false;
      for (const a of questionAssists(raw.current)) if (!issued(a.id,['assist'])) return false;
    }
    if (raw.lastResolution && (!issued(raw.lastResolution.id,['resolution','judgment']) || !issued(raw.lastResolution.token,['clock']) || raw.lastResolution.transactionIds.some(id => !issued(id,['score'])))) return false;
    return raw.undo.every(snap => integer(snap.serial,0,raw.serial));
  }
  function validateState(raw, bank, options = {}) {
    try {
      if (!safeTree(raw)) return null;
      if (raw?.version === 2) { raw = migrateLegacy(raw, bank); if (!raw) return null; }
      if (!raw || raw.version !== VERSION || !Array.isArray(bank) || configErrors(raw.config, null).length || !STATES.includes(raw.state) || !identifier(raw.id,100) || !integer(raw.seed, 0, 4294967295) || !integer(raw.serial) || !integer(raw.createdAt, 0, 1e14) || !integer(raw.turn, 0, 1)) return null;
      if (raw.timing !== undefined && raw.timing !== null && (!integer(raw.timing.elapsedMs, 0, 1e14) || (raw.timing.lastActiveAt !== null && !integer(raw.timing.lastActiveAt, 0, 1e14)))) return null;
      if (![1,2,3].includes(raw.statisticsVersion) || !Array.isArray(raw.selectionWarnings) || raw.selectionWarnings.length > 10 || raw.selectionWarnings.some(t => !safeText(t,1000))) return null;
      const c = cleanConfig(raw.config), expected = c.categoryCount * c.pointValues.length * (c.board === 'classic' ? 2 : 1);
      if (!raw.questions || typeof raw.questions !== 'object' || Array.isArray(raw.questions) || Object.keys(raw.questions).length !== expected || Object.entries(raw.questions).some(([id,q]) => id !== q?.id || !validQuestion(q))) return null;
      const qmap = new Map(Object.entries(raw.questions));
      if (raw.knownAnswers !== undefined && (!Array.isArray(raw.knownAnswers) || raw.knownAnswers.length > expected || new Set(raw.knownAnswers).size !== raw.knownAnswers.length || raw.knownAnswers.some(id => !raw.board?.some(t => t.questionId === id)))) return null;
      if (!Array.isArray(raw.categories) || JSON.stringify(raw.categories) !== JSON.stringify(c.teams.flatMap(t => t.categories)) || !Array.isArray(raw.board) || raw.board.length !== expected || new Set(raw.board.map(t => t.id)).size !== expected || new Set(raw.board.map(t => t.questionId)).size !== expected) return null;
      for (const cat of raw.categories) for (const value of c.pointValues) if (raw.board.filter(t => t.category === cat && t.value === value).length !== (c.board === 'classic' ? 2 : 1)) return null;
      if (raw.board.some(t => !identifier(t.id,120) || t.id !== `${t.category}-${t.value}-${t.slot}` || !qmap.has(t.questionId) || qmap.get(t.questionId).category !== t.category || pointValue(qmap.get(t.questionId)) !== t.value || !integer(t.slot, 0, c.board === 'classic' ? 1 : 0) || typeof t.done !== 'boolean')) return null;
      if (!Array.isArray(raw.teams) || raw.teams.length !== 2 || !Array.isArray(raw.transactions) || raw.transactions.length > 1000 || !Array.isArray(raw.history) || raw.history.length > expected || !Array.isArray(raw.undo) || raw.undo.length > 24) return null;
      if (raw.endedEarly !== undefined && typeof raw.endedEarly !== 'boolean' || raw.endedEarly && (raw.state !== 'MATCH_COMPLETE' || !safeText(raw.endReason,160) || !raw.endReason.trim() || !integer(raw.completedAt,0,1e14))) return null;
      if ((raw.winner !== null && !integer(raw.winner, 0, 1)) || (raw.completedAt !== null && !integer(raw.completedAt, 0, 1e14))) return null;
      const scores = [0, 0], ids = new Set();
      for (const tx of raw.transactions) {
        if (!tx || !identifier(tx.id) || ids.has(tx.id) || !integer(tx.teamId, 0, 1) || !integer(tx.originalValue, 0, 600) || !safeText(tx.reason, 80) || !safeText(tx.modifier, 160) || !integer(tx.scoreBefore, -1e8, 1e8) || !integer(tx.scoreAfter, c.negative ? -1e8 : 0, 1e8) || scores[tx.teamId] !== tx.scoreBefore || !integer(tx.timestamp, 0, 1e14) || !identifier(tx.groupId) || (tx.questionId !== null && !qmap.has(tx.questionId))) return null;
        if (tx.delta !== undefined && (!integer(tx.delta,-200000,200000) || tx.scoreAfter !== (c.negative ? tx.scoreBefore + tx.delta : Math.max(0,tx.scoreBefore + tx.delta)))) return null;
        scores[tx.teamId] = tx.scoreAfter; ids.add(tx.id);
      }
      for (let i = 0; i < 2; i++) {
        const t = raw.teams[i];
        if (!t || t.id !== `team-${i}` || t.name !== c.teams[i].name || t.color !== c.teams[i].color || t.avatar !== c.teams[i].avatar || JSON.stringify(t.players) !== JSON.stringify(c.teams[i].players) || t.score !== scores[i] || ['correct', 'incorrect', 'steals'].some(k => !integer(t[k], 0, expected)) || !t.assists || !Array.isArray(t.assistHistory) || t.assistHistory.length > 50 || Object.keys(t.assists).some(k => !c.teams[i].assists.includes(k)) || c.teams[i].assists.some(k => !integer(t.assists[k], 0, c.assistLimits[k]))) return null;
        for (const a of t.assistHistory) if (!a || !ASSISTS.includes(a.key) || !c.teams[i].assists.includes(a.key) || a.teamId !== i || !raw.board.some(tile => tile.questionId === a.questionId) || !integer(a.at, 0, 1e14) || !identifier(a.id) || (a.participant !== null && !safeText(a.participant, 32))) return null;
        for (const key of c.teams[i].assists) if (t.assists[key] + t.assistHistory.filter(a => a.key === key).length !== c.assistLimits[key]) return null;
      }
      const startingTeam = raw.startingTeam ?? (c.starter === '0' ? 0 : c.starter === '1' ? 1 : raw.history[0]?.selector ?? raw.current?.selector ?? raw.turn);
      if (!integer(startingTeam, 0, 1) || raw.turn !== (startingTeam ^ raw.history.length % 2)) return null;
      const historyIds = new Set(), resolutionIds = new Set();
      for (const [historyIndex,h] of raw.history.entries()) {
        const tile = raw.board.find(t => t.id === h.tileId);
        if (h.scoringVersion !== undefined && h.scoringVersion !== 2) return null;
        if (h.value !== tile?.value || h.correct !== (h.winner !== null) || h.selector !== (startingTeam ^ historyIndex % 2) || !tile || !tile.done || tile.questionId !== h.questionId || historyIds.has(h.tileId) || !integer(h.selector, 0, 1) || !integer(h.responder, 0, 1) || (h.winner !== null && !integer(h.winner, 0, 1)) || !Array.isArray(h.transactionIds) || new Set(h.transactionIds).size !== h.transactionIds.length || h.transactionIds.some(id => !ids.has(id) || raw.transactions.find(tx => tx.id === id).questionId !== h.questionId || raw.transactions.find(tx => tx.id === id).originalValue !== h.value) || !Array.isArray(h.assists) || h.assists.some(a => !a || !ASSISTS.includes(a.key) || !integer(a.teamId, 0, 1) || !raw.teams[a.teamId].assistHistory.some(record => record.id === a.id && record.key === a.key && record.questionId === h.questionId)) || !integer(h.at, 0, 1e14) || !['first', 'steal', 'trap'].includes(h.phase)) return null;
        if (h.resolutionId !== undefined && (!identifier(h.resolutionId) || resolutionIds.has(h.resolutionId) || h.transactionIds.some(id => raw.transactions.find(tx => tx.id === id)?.groupId !== h.resolutionId))) return null;
        if (h.attemptAccounting !== undefined && h.attemptAccounting !== 3) return null;
        if (h.resolutionId !== undefined) resolutionIds.add(h.resolutionId);
        historyIds.add(h.tileId);
      }
      if (raw.undoAction !== undefined && !['assist', 'question-resolution'].includes(raw.undoAction)) return null;
      if (raw.lastResolution !== undefined && raw.lastResolution !== null) {
        const result = raw.lastResolution, h = raw.history.find(h => h.tileId === result?.tileId);
        if (!h || h.resolutionId !== undefined && h.resolutionId !== result.id || !identifier(result.id) || result.questionId !== h.questionId || result.winner !== h.winner || result.phase !== h.phase || !identifier(result.token) || !integer(result.at,0,1e14) || result.at !== h.at || !integer(result.earned,0,1250) || !Array.isArray(result.deltas) || result.deltas.length !== 2 || result.deltas.some(n => !integer(n,-1e8,1e8)) || JSON.stringify(result.transactionIds) !== JSON.stringify(h.transactionIds) || result.steal !== (h.phase === 'steal' && h.winner !== null && h.winner !== h.selector)) return null;
        const deltas = [0,0]; let earned = 0;
        for (const id of result.transactionIds) {
          const tx = raw.transactions.find(tx => tx.id === id);
          if (!tx || tx.groupId !== result.id) return null;
          deltas[tx.teamId] += tx.scoreAfter - tx.scoreBefore;
          if (['correct','steal','trap-correct'].includes(tx.reason)) earned += tx.scoreAfter - tx.scoreBefore;
        }
        if (JSON.stringify(deltas) !== JSON.stringify(result.deltas) || earned !== result.earned) return null;
      }
      if ([2,3].includes(raw.statisticsVersion)) {
        const correct = [0,0], incorrect = [0,0], steals = [0,0];
        for (const h of raw.history) {
          if (!Array.isArray(h.attempts) || h.attempts.length > 8 || h.attempts.some(a => !a || !integer(a.teamId,0,1) || typeof a.correct !== 'boolean' || !safeText(a.reason,32) || !integer(a.at,0,1e14)) || !Array.isArray(h.incorrectTeams)) return null;
          const failed = raw.statisticsVersion === 3 || h.attemptAccounting === 3 ? [...explicitFailures(h, h.winner)] : [...new Set(h.attempts.filter(a => !['timeout','skip','delegation'].includes(a.reason) && a.teamId !== h.winner).map(a => a.teamId))];
          if (JSON.stringify(failed) !== JSON.stringify(h.incorrectTeams)) return null;
          failed.forEach(i => incorrect[i]++);
          if (h.winner !== null) {correct[h.winner]++; if (h.phase === 'steal' && h.winner !== h.selector) steals[h.winner]++;}
        }
        if (raw.teams.some((t,i) => t.correct !== correct[i] || t.incorrect !== incorrect[i] || t.steals !== steals[i])) return null;
      }
      if (raw.board.filter(t => t.done).length !== raw.history.length) return null;
      const leader = raw.teams[0].score === raw.teams[1].score ? null : raw.teams[0].score > raw.teams[1].score ? 0 : 1;
      if (raw.winner !== leader) return null;
      const effectiveState = raw.state === 'PAUSED' ? raw.pausedFrom : raw.state;
      if (effectiveState === 'MATCH_COMPLETE' ? raw.state !== 'MATCH_COMPLETE' || raw.completedAt === null : raw.completedAt !== null) return null;
      if (raw.state === 'BOARD' && raw.current !== null || raw.state === 'MATCH_COMPLETE' && (raw.current !== null || !raw.endedEarly && raw.board.some(t => !t.done))) return null;
      if (raw.state === 'PAUSED' && (!STATES.includes(raw.pausedFrom) || raw.pausedFrom === 'PAUSED')) return null;
      if (raw.current !== null) {
        const a = raw.current, tile = raw.board.find(t => t.id === a.tileId);
        if (!tile || a.questionId !== tile.questionId || a.value !== tile.value || !integer(a.selector, 0, 1) || !integer(a.responder, 0, 1) || !['first', 'steal', 'trap'].includes(a.phase) || !safeText(a.token, 180) || !Array.isArray(a.choices) || a.choices.length !== c.choiceCount || new Set(a.choices).size !== c.choiceCount || a.choices.some(n => !integer(n, 0, 3)) || !a.choices.includes(qmap.get(a.questionId).answer) || !integer(a.remainingMs, 0, 1000000) || (a.deadline !== null && !integer(a.deadline, 0, 1e14)) || ['timed', 'timerStarted', 'revealed', 'closed', 'resolved', 'twice', 'hint', 'lastAttemptIncorrect', 'skip'].some(k => typeof a[k] !== 'boolean')) return null;
        if (a.resolutionId !== undefined && !identifier(a.resolutionId)) return null;
        if (qmap.get(a.questionId).type === 'clues' ? !integer(a.revealedClues,1,qmap.get(a.questionId).clues.length) : a.revealedClues !== undefined) return null;
        if (!integer(a.earned) || a.usedAssists?.some(record => !record || !ASSISTS.includes(record.key) || !integer(record.teamId, 0, 1) || !raw.teams[record.teamId].assistHistory.some(item => item.id === record.id && item.key === record.key && item.questionId === a.questionId))) return null;
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
        if (!pendingAssistsValid(raw)) return null;
      } else if (!['BOARD', 'MATCH_COMPLETE'].includes(raw.state) && !(raw.state === 'PAUSED' && raw.pausedFrom === 'BOARD')) return null;
      if (!validResolutionLedger(raw,c)) return null;
      if (!validSerialLedger(raw)) return null;
      const {questions, ...mutable} = raw; const out = clone(mutable); out.questions = freezeTree(clone(questions)); out.config = c; out.startingTeam = startingTeam; out.lastError = null;
      out.knownAnswers = knowledge(raw);
      /* Undo snapshots are validated when restored, not accepted as executable state.
         Keep only valid bounded snapshots; nested undo data is discarded. */
      out.undo = [];
      for (const snap of raw.undo) {
        if (!snap || snap.version !== VERSION || snap.id !== raw.id || snap.undo || JSON.stringify(snap.config) !== JSON.stringify(raw.config) || JSON.stringify(snap.board?.map(t => [t.id,t.questionId,t.value])) !== JSON.stringify(raw.board.map(t => [t.id,t.questionId,t.value]))) return null;
        const checked = validateState({ ...snap, questions:out.questions, undo: [] }, bank, {undoSnapshot:true});
        if (!checked) return null;
        delete checked.undo; delete checked.questions; out.undo.push(checked);
      }
      if (!options.undoSnapshot && out.state !== 'PAUSED' && out.state !== 'MATCH_COMPLETE') {
        out.pausedFrom = out.state; out.state = 'PAUSED'; if (out.timing) out.timing.lastActiveAt = null;
        if (out.current) { const a = out.current; if (a.deadline !== null) a.remainingMs = Math.max(0, Math.min(a.remainingMs, a.deadline - Date.now())); a.deadline = null; if (a.assistance) { if (a.assistance.deadline !== null) a.assistance.remainingMs = Math.max(0, Math.min(a.assistance.remainingMs, a.assistance.deadline - Date.now())); a.assistance.deadline = null; } }
      }
      return preserveKnowledge(out, Date.now());
    } catch { return null; }
  }
  return Object.freeze({ VERSION, VALUES: Object.freeze(VALUES), ASSISTS: Object.freeze(ASSISTS), STATES: Object.freeze(STATES), defaults, validateConfig: configErrors, create, dispatch, scoreOutcome, validateState, restore, getQuestion, eligibleQuestions, isEligible, verifiedForPlay, FRANCHISES, normalizeAnswer, pointValue });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TeamEngine;
