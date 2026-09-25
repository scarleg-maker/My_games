'use strict';
/**
 * Duo-Master — serveur Node.js (aucune dépendance externe).
 * Temps réel via Server-Sent Events (/events), API JSON sous /api/*.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 13000;
const ROLL_MS = 2000; // durée du défilement avant révélation du tirage
const ANSWER_MS = 10000; // durée laissée aux joueurs pour écrire leur réponse (mode « Réponse »)
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const MIN_TARGET = 3;
const MAX_TARGET = 20;

const DIR_PUBLIC = path.join(__dirname, 'public');
const DIR_THEMES = path.join(__dirname, 'themes');
const DIR_DATA = path.join(__dirname, 'data');
const FILE_STATE = path.join(DIR_DATA, 'state.json');

/* ------------------------------------------------------------------ */
/* Outils                                                             */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// Comparaison joueur ↔ réponse : accents/casse ignorés, ponctuation et espaces multiples aussi
// (« méga dracaufeu-x » == « Méga-Dracaufeu X »), pour rester tolérant sans faire de correction floue.
const normLoose = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toInt = (v, what) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new HttpError(400, `Valeur invalide : ${what}`);
  return n;
};
const cleanName = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 24);

/* ------------------------------------------------------------------ */
/* Thèmes (fichiers JSON dans /themes, relus automatiquement)         */
/* ------------------------------------------------------------------ */
const DEFAULT_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9',
  '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];
const themeCache = new Map(); // fichier -> { mtime, theme }

function normValues(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((v, i) => {
    const o = typeof v === 'string' ? { name: v } : (v || {});
    if (!o.name) return null;
    const color = /^#[0-9a-f]{3,8}$/i.test(o.color || '') ? o.color : DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    return { name: String(o.name), color, emoji: o.emoji ? String(o.emoji) : '' };
  }).filter(Boolean);
}

function normalizeTheme(id, raw) {
  if (!raw || typeof raw !== 'object') throw new Error('JSON invalide');
  const lists = {};
  for (const [k, arr] of Object.entries(raw.lists || {})) lists[k] = normValues(arr);
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).map((s, i) => {
    const values = s.values ? normValues(s.values) : lists[s.list];
    if (!values || !values.length) throw new Error(`le tirage n°${i + 1} n'a aucune valeur (list "${s.list}" ?)`);
    return { id: String(s.id || `slot${i + 1}`), label: String(s.label || `Tirage ${i + 1}`), values };
  });
  if (!slots.length) throw new Error('aucun "slots" défini');
  const mode = raw.answerMode === 'slots' ? 'slots' : 'set';
  const answers = (Array.isArray(raw.answers) ? raw.answers : []).filter((a) => a && a.name).map((a) => {
    const rawTags = [].concat(a.tags == null ? [] : a.tags).map(String);
    const fields = {};
    for (const s of slots) {
      if (a[s.id] != null) fields[s.id] = new Set([].concat(a[s.id]).map((x) => norm(String(x))));
    }
    return {
      name: String(a.name),
      info: a.info != null ? String(a.info) : '',
      raw: rawTags,
      tags: new Set(rawTags.map(norm)),
      fields,
    };
  });
  return {
    id,
    name: String(raw.name || id),
    emoji: raw.emoji ? String(raw.emoji) : '🎲',
    description: String(raw.description || ''),
    answerMode: mode,
    skipEmpty: raw.skipEmpty !== false, // évite les tirages sans aucune réponse
    slots,
    answers,
  };
}

function readThemeFile(id) {
  if (!/^[a-z0-9_-]+$/i.test(String(id))) return null;
  const file = path.join(DIR_THEMES, `${id}.json`);
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const cached = themeCache.get(file);
  if (cached && cached.mtime === st.mtimeMs) return cached.theme;
  let theme = null;
  try {
    theme = normalizeTheme(id, JSON.parse(fs.readFileSync(file, 'utf8')));
    theme.rev = st.mtimeMs;
  } catch (e) {
    console.warn(`[thème "${id}"] ignoré : ${e.message}`);
  }
  themeCache.set(file, { mtime: st.mtimeMs, theme });
  return theme;
}

function listThemes() {
  let files = [];
  try { files = fs.readdirSync(DIR_THEMES); } catch { /* dossier absent */ }
  return files
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => readThemeFile(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, description: t.description, answers: t.answers.length }));
}

const publicTheme = (t) => ({
  id: t.id, name: t.name, emoji: t.emoji, description: t.description, rev: t.rev,
  slots: t.slots.map((s) => ({ id: s.id, label: s.label, values: s.values })),
});

/** Réponses possibles pour un tirage (ne va jamais aux pages joueurs) */
function findAnswers(theme, draw) {
  const d = draw.map(norm);
  if (theme.answerMode === 'set') {
    const ds = new Set(d);
    const exact = [];
    const also = [];
    for (const a of theme.answers) {
      if (![...ds].every((x) => a.tags.has(x))) continue;
      (a.tags.size === ds.size ? exact : also).push(a);
    }
    return {
      exact,
      also: ds.size === 1 ? also : [],
      alsoLabel: ds.size === 1 ? `Acceptables aussi : contiennent ce type (${draw[0]})` : '',
    };
  }
  const exact = theme.answers.filter((a) => theme.slots.every((s, i) => {
    const f = a.fields[s.id];
    return !f || f.has(d[i]);
  }));
  return { exact, also: [], alsoLabel: '' };
}

function pickDraw(theme) {
  const pick = () => theme.slots.map((s) => s.values[Math.floor(Math.random() * s.values.length)].name);
  let draw = pick();
  if (theme.skipEmpty && theme.answers.length) {
    for (let i = 0; i < 300 && findAnswers(theme, draw).exact.length === 0; i++) draw = pick();
  }
  return draw;
}

/* ------------------------------------------------------------------ */
/* État du jeu                                                        */
/* ------------------------------------------------------------------ */
const S = {
  names: Array.from({ length: MAX_PLAYERS }, (_, i) => `Joueur ${i + 1}`),
  scores: new Array(MAX_PLAYERS).fill(0),
  playerCount: 2,
  target: 10,
  themeId: 'pokemon',
  started: false, // false = salon (réglages), true = partie lancée par l'arbitre
  mode: 'speed', // 'speed' = Rapidité (l'arbitre désigne le vainqueur) | 'answer' = Réponse (les joueurs écrivent, vérif auto)
  phase: 'idle', // idle | rolling | drawn
  draw: null,
  round: 0,
  gameOver: false,
  winnerId: null,
  lastEvent: null,
  eventSeq: 0,
  submissions: {}, // mode "answer" : playerId -> { text, correct, awarded, at } pour le tour en cours
  answerDeadline: null, // mode "answer" : horodatage (ms) de fin du minuteur du tour en cours
  subRev: 0, // incrémenté à chaque réponse reçue, pour rafraîchir la vue arbitre
};
let rollTimer = null;
let pendingDraw = null;
let answerTimer = null; // mode "answer" : clôture officielle du tour à la fin du délai de réponse

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE_STATE, 'utf8'));
    if (Array.isArray(j.names)) j.names.slice(0, MAX_PLAYERS).forEach((n, i) => { if (typeof n === 'string' && n.trim()) S.names[i] = cleanName(n); });
    if (Array.isArray(j.scores)) j.scores.slice(0, MAX_PLAYERS).forEach((n, i) => { S.scores[i] = Math.max(0, Math.round(Number(n)) || 0); });
    S.playerCount = clamp(Math.round(Number(j.playerCount)) || 2, MIN_PLAYERS, MAX_PLAYERS);
    S.target = clamp(Math.round(Number(j.target)) || 10, MIN_TARGET, MAX_TARGET);
    if (typeof j.themeId === 'string') S.themeId = j.themeId;
    S.mode = j.mode === 'answer' ? 'answer' : 'speed';
    S.round = Math.max(0, Math.round(Number(j.round)) || 0);
    S.started = j.started === undefined ? (S.round > 0 || S.scores.some((n) => n > 0)) : !!j.started;
  } catch { /* premier lancement */ }
  if (!readThemeFile(S.themeId)) {
    const first = listThemes()[0];
    S.themeId = first ? first.id : 'pokemon';
  }
  checkGameOver();
}

function saveState() {
  try {
    fs.mkdirSync(DIR_DATA, { recursive: true });
    fs.writeFileSync(FILE_STATE, JSON.stringify({
      names: S.names, scores: S.scores, playerCount: S.playerCount, target: S.target,
      themeId: S.themeId, round: S.round, started: S.started, mode: S.mode,
    }, null, 2));
  } catch (e) {
    console.warn('Sauvegarde impossible :', e.message);
  }
}

function checkGameOver() {
  if (S.mode === 'answer') {
    // Mode Réponse : les points peuvent tomber simultanément, donc une égalité au sommet
    // (même au-delà de l'objectif) ne termine pas la partie — il faut être seul en tête.
    let best = -1;
    let idx = -1;
    let tie = false;
    for (let i = 0; i < S.playerCount; i++) {
      if (S.scores[i] > best) { best = S.scores[i]; idx = i; tie = false; }
      else if (S.scores[i] === best) { tie = true; }
    }
    S.gameOver = idx >= 0 && best >= S.target && !tie;
    S.winnerId = S.gameOver ? idx + 1 : null;
  } else {
    let best = -1;
    let idx = -1;
    for (let i = 0; i < S.playerCount; i++) {
      if (S.scores[i] >= S.target && S.scores[i] > best) { best = S.scores[i]; idx = i; }
    }
    S.gameOver = idx >= 0;
    S.winnerId = idx >= 0 ? idx + 1 : null;
  }
  if (S.gameOver && S.phase !== 'idle') stopRound();
}

function stopRound() {
  clearTimeout(rollTimer);
  rollTimer = null;
  pendingDraw = null;
  clearTimeout(answerTimer);
  answerTimer = null;
  S.phase = 'idle';
}

/**
 * Mode Réponse : décide du sort du tour en cours (victoire ou égalité, on continue).
 * Appelé à la fin du délai de réponse, ou juste avant de lancer le tirage suivant
 * si l'arbitre avance la main avant l'échéance — jamais au fil des réponses reçues,
 * pour laisser sa chance à chaque joueur jusqu'à la fin du tour.
 */
function closeAnswerRound() {
  clearTimeout(answerTimer);
  answerTimer = null;
  checkGameOver();
}

function resetRound() {
  stopRound();
  S.draw = null;
  S.lastEvent = null;
  S.submissions = {};
  S.answerDeadline = null;
}

function setEvent(type, playerId) {
  S.eventSeq += 1;
  S.lastEvent = {
    id: S.eventSeq, type, playerId: playerId || null,
    name: playerId ? S.names[playerId - 1] : '', at: Date.now(),
  };
}

function publicState() {
  const theme = readThemeFile(S.themeId);
  return {
    players: Array.from({ length: S.playerCount }, (_, i) => ({ id: i + 1, name: S.names[i], score: S.scores[i] })),
    maxPlayers: MAX_PLAYERS,
    target: S.target,
    themeId: S.themeId,
    themeRev: theme ? theme.rev : 0,
    started: S.started,
    mode: S.mode,
    phase: S.phase,
    draw: S.draw,
    round: S.round,
    gameOver: S.gameOver,
    winnerId: S.winnerId,
    lastEvent: S.lastEvent,
    answerDeadline: S.answerDeadline,
    answerMs: ANSWER_MS,
    subRev: S.subRev,
  };
}

/* ------------------------------------------------------------------ */
/* Temps réel (SSE)                                                   */
/* ------------------------------------------------------------------ */
const clients = new Set();

function broadcast() {
  const msg = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(msg);
}
function commit() { saveState(); broadcast(); }

function sse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 1000\nevent: state\ndata: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000).unref();

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) { reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function playerIndex(b) {
  const id = toInt(b.playerId, 'joueur');
  if (id < 1 || id > S.playerCount) throw new HttpError(400, 'Joueur inconnu');
  return id - 1;
}

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

async function handleApi(req, res, p) {
  const isPost = req.method === 'POST';

  // --- lecture ---
  if (p === '/api/state') return json(res, 200, publicState());
  if (p === '/api/themes') return json(res, 200, listThemes());
  if (p === '/api/info') return json(res, 200, { port: PORT, ips: lanIPs() });
  if (p.startsWith('/api/theme/')) {
    const theme = readThemeFile(p.slice('/api/theme/'.length));
    if (!theme) throw new HttpError(404, 'Thème introuvable');
    return json(res, 200, publicTheme(theme));
  }
  if (p === '/api/answers') {
    const theme = readThemeFile(S.themeId);
    if (!theme) throw new HttpError(404, 'Thème introuvable');
    const hasAnswers = theme.answers.length > 0;
    const submissions = () => S.mode === 'answer' ? Array.from({ length: S.playerCount }, (_, i) => {
      const sub = S.submissions[i + 1];
      return {
        id: i + 1,
        name: S.names[i],
        text: sub ? sub.text : '',
        correct: sub ? sub.correct : null,
        awarded: sub ? !!sub.awarded : false,
      };
    }) : undefined;
    if (!S.draw || S.phase === 'rolling') {
      return json(res, 200, { hasAnswers, exact: [], also: [], alsoLabel: '', submissions: submissions() });
    }
    if (!hasAnswers) {
      return json(res, 200, { hasAnswers, exact: [], also: [], alsoLabel: '', submissions: submissions() });
    }
    const r = findAnswers(theme, S.draw);
    const pub = (a) => ({ name: a.name, info: a.info, detail: theme.answerMode === 'set' ? a.raw.join(' / ') : '' });
    return json(res, 200, {
      hasAnswers, exact: r.exact.map(pub), also: r.also.map(pub), alsoLabel: r.alsoLabel, submissions: submissions(),
    });
  }

  // --- actions ---
  if (!isPost) throw new HttpError(405, 'Méthode non autorisée');
  const b = await readBody(req);

  if (p === '/api/start') {
    S.started = true;
    S.round = 0;
    resetRound();
    setEvent('start');
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/draw') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    // Mode Réponse : si l'arbitre avance la main avant la fin du délai, on tranche
    // maintenant le sort du tour qui vient de se jouer (au lieu d'attendre le minuteur).
    if (S.mode === 'answer' && S.phase === 'drawn') { closeAnswerRound(); if (S.gameOver) commit(); }
    if (S.gameOver) throw new HttpError(409, 'La partie est terminée : lancez une nouvelle partie.');
    if (S.phase === 'rolling') throw new HttpError(409, 'Tirage déjà en cours.');
    const theme = readThemeFile(S.themeId);
    if (!theme) throw new HttpError(404, 'Thème introuvable');
    pendingDraw = pickDraw(theme);
    S.phase = 'rolling';
    S.draw = null;
    S.round += 1;
    S.lastEvent = null;
    S.submissions = {};
    S.answerDeadline = null;
    commit();
    rollTimer = setTimeout(() => {
      rollTimer = null;
      S.draw = pendingDraw;
      pendingDraw = null;
      S.phase = 'drawn';
      S.submissions = {};
      if (S.mode === 'answer') {
        S.answerDeadline = Date.now() + ANSWER_MS;
        answerTimer = setTimeout(() => { closeAnswerRound(); commit(); }, ANSWER_MS + 50);
      } else {
        S.answerDeadline = null;
      }
      commit();
    }, ROLL_MS);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/award') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    if (S.gameOver) throw new HttpError(409, 'La partie est terminée.');
    if (S.phase !== 'drawn') throw new HttpError(409, 'Aucun tirage en attente d\'un vainqueur.');
    const i = playerIndex(b);
    if (S.submissions[i + 1] && S.submissions[i + 1].awarded) throw new HttpError(409, 'Ce joueur a déjà son point pour ce tour.');
    S.scores[i] += 1;
    S.submissions[i + 1] = { ...(S.submissions[i + 1] || { text: '', correct: null, at: Date.now() }), awarded: true };
    if (S.mode === 'answer') S.subRev += 1; // rafraîchit la vue « Réponses des joueurs » côté arbitre
    // Mode Rapidité : un seul point par tour, on referme aussitôt.
    // Mode Réponse : plusieurs joueurs peuvent encore marquer, le tour reste ouvert.
    if (S.mode !== 'answer') {
      S.phase = 'idle';
      checkGameOver();
    } // en mode Réponse : le tour reste ouvert, la victoire se tranche à sa clôture (closeAnswerRound)
    setEvent('point', i + 1);
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/answer') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    if (S.mode !== 'answer') throw new HttpError(409, 'Ce mode n\'accepte pas de réponse écrite.');
    if (S.gameOver) throw new HttpError(409, 'La partie est terminée.');
    if (S.phase !== 'drawn' || !S.draw) throw new HttpError(409, 'Aucun tirage en cours.');
    if (!S.answerDeadline || Date.now() > S.answerDeadline + 400) throw new HttpError(409, 'Le temps est écoulé pour ce tour.');
    const i = playerIndex(b);
    const prev = S.submissions[i + 1];
    if (prev && prev.awarded) throw new HttpError(409, 'Votre point est déjà validé pour ce tour.');
    const text = String(b.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text) throw new HttpError(400, 'Réponse vide.');

    const theme = readThemeFile(S.themeId);
    let correct = null; // null = thème sans liste de réponses : l'arbitre jugera
    if (theme && theme.answers.length) {
      const r = findAnswers(theme, S.draw);
      const target = normLoose(text);
      correct = r.exact.some((a) => normLoose(a.name) === target);
    }
    S.submissions[i + 1] = { text, correct, awarded: !!correct, at: Date.now() };
    S.subRev += 1;
    if (correct) {
      S.scores[i] += 1;
      setEvent('answer', i + 1);
      // On ne tranche pas la victoire ici : un autre joueur peut encore répondre
      // dans le même tour (closeAnswerRound s'en charge à la fin du délai).
    }
    commit();
    return json(res, 200, { ok: true, correct });
  }

  if (p === '/api/adjust') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    const i = playerIndex(b);
    const delta = toInt(b.delta, 'delta') < 0 ? -1 : 1;
    const next = clamp(S.scores[i] + delta, 0, S.target);
    if (next === S.scores[i]) return json(res, 200, { ok: true });
    S.scores[i] = next;
    if (delta < 0 && S.submissions[i + 1] && S.submissions[i + 1].awarded) {
      S.submissions[i + 1].awarded = false;
      if (S.mode === 'answer') S.subRev += 1;
    }
    setEvent(delta < 0 ? 'remove' : 'add', i + 1);
    checkGameOver();
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/newgame') {
    S.scores.fill(0);
    S.round = 0;
    S.started = false;
    resetRound();
    setEvent('newgame');
    checkGameOver();
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/settings') {
    if (Array.isArray(b.names)) {
      b.names.slice(0, MAX_PLAYERS).forEach((v, i) => {
        if (typeof v === 'string') S.names[i] = cleanName(v) || `Joueur ${i + 1}`;
      });
    }
    if (b.playerCount != null) S.playerCount = clamp(toInt(b.playerCount, 'nombre de joueurs'), MIN_PLAYERS, MAX_PLAYERS);
    if (b.target != null) S.target = clamp(toInt(b.target, 'objectif'), MIN_TARGET, MAX_TARGET);
    if (b.themeId != null && b.themeId !== S.themeId) {
      if (!readThemeFile(String(b.themeId))) throw new HttpError(404, 'Thème introuvable');
      S.themeId = String(b.themeId);
      S.round = 0;
      resetRound();
    }
    if (b.mode != null) {
      const m = b.mode === 'answer' ? 'answer' : 'speed';
      if (m !== S.mode) { S.mode = m; S.round = 0; resetRound(); }
    }
    checkGameOver();
    commit();
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Route inconnue');
}

/* ------------------------------------------------------------------ */
/* Pages & fichiers statiques                                         */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

function handleStatic(res, p) {
  if (p === '/' || p === '/arbitre') return sendFile(res, path.join(DIR_PUBLIC, 'arbitre.html'));
  if (p === '/ecran' || /^\/joueur[1-6]$/.test(p)) return sendFile(res, path.join(DIR_PUBLIC, 'joueur.html'));
  const file = path.normalize(path.join(DIR_PUBLIC, p));
  if (!file.startsWith(DIR_PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  return sendFile(res, file);
}

const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p === '/events') return sse(req, res);
    if (p.startsWith('/api/')) return await handleApi(req, res, p);
    return handleStatic(res, p);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: e.message || 'Erreur serveur' });
  }
});

loadState();
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎲 Duo-Master est lancé !\n');
  console.log(`  Arbitre / écran unique : http://localhost:${PORT}/`);
  console.log(`  Écran commun (public)  : http://localhost:${PORT}/ecran`);
  console.log(`  Joueur 1 / Joueur 2    : http://localhost:${PORT}/joueur1  /joueur2  (… jusqu'à /joueur6)`);
  const ips = lanIPs();
  if (ips.length) {
    console.log('\n  Depuis un téléphone (même réseau Wi-Fi) :');
    for (const ip of ips) console.log(`    http://${ip}:${PORT}/joueur1`);
  }
  console.log(`\n  Thèmes disponibles : ${listThemes().map((t) => t.name).join(', ') || '(aucun)'}\n`);
});
