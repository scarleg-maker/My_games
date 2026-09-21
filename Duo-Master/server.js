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
  phase: 'idle', // idle | rolling | drawn
  draw: null,
  round: 0,
  gameOver: false,
  winnerId: null,
  lastEvent: null,
  eventSeq: 0,
};
let rollTimer = null;
let pendingDraw = null;

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE_STATE, 'utf8'));
    if (Array.isArray(j.names)) j.names.slice(0, MAX_PLAYERS).forEach((n, i) => { if (typeof n === 'string' && n.trim()) S.names[i] = cleanName(n); });
    if (Array.isArray(j.scores)) j.scores.slice(0, MAX_PLAYERS).forEach((n, i) => { S.scores[i] = Math.max(0, Math.round(Number(n)) || 0); });
    S.playerCount = clamp(Math.round(Number(j.playerCount)) || 2, MIN_PLAYERS, MAX_PLAYERS);
    S.target = clamp(Math.round(Number(j.target)) || 10, MIN_TARGET, MAX_TARGET);
    if (typeof j.themeId === 'string') S.themeId = j.themeId;
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
      themeId: S.themeId, round: S.round, started: S.started,
    }, null, 2));
  } catch (e) {
    console.warn('Sauvegarde impossible :', e.message);
  }
}

function checkGameOver() {
  let best = -1;
  let idx = -1;
  for (let i = 0; i < S.playerCount; i++) {
    if (S.scores[i] >= S.target && S.scores[i] > best) { best = S.scores[i]; idx = i; }
  }
  S.gameOver = idx >= 0;
  S.winnerId = idx >= 0 ? idx + 1 : null;
  if (S.gameOver && S.phase !== 'idle') stopRound();
}

function stopRound() {
  clearTimeout(rollTimer);
  rollTimer = null;
  pendingDraw = null;
  S.phase = 'idle';
}

function resetRound() {
  stopRound();
  S.draw = null;
  S.lastEvent = null;
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
    phase: S.phase,
    draw: S.draw,
    round: S.round,
    gameOver: S.gameOver,
    winnerId: S.winnerId,
    lastEvent: S.lastEvent,
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
    if (!S.draw || S.phase === 'rolling' || !hasAnswers) {
      return json(res, 200, { hasAnswers, exact: [], also: [], alsoLabel: '' });
    }
    const r = findAnswers(theme, S.draw);
    const pub = (a) => ({ name: a.name, info: a.info, detail: theme.answerMode === 'set' ? a.raw.join(' / ') : '' });
    return json(res, 200, { hasAnswers, exact: r.exact.map(pub), also: r.also.map(pub), alsoLabel: r.alsoLabel });
  }

  // --- actions ---
  if (!isPost) throw new HttpError(405, 'Méthode non autorisée');
  const b = await readBody(req);

  if (p === '/api/start') {
    S.started = true;
    resetRound();
    setEvent('start');
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/draw') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    if (S.gameOver) throw new HttpError(409, 'La partie est terminée : lancez une nouvelle partie.');
    if (S.phase === 'rolling') throw new HttpError(409, 'Tirage déjà en cours.');
    const theme = readThemeFile(S.themeId);
    if (!theme) throw new HttpError(404, 'Thème introuvable');
    pendingDraw = pickDraw(theme);
    S.phase = 'rolling';
    S.draw = null;
    S.round += 1;
    S.lastEvent = null;
    commit();
    rollTimer = setTimeout(() => {
      rollTimer = null;
      S.draw = pendingDraw;
      pendingDraw = null;
      S.phase = 'drawn';
      commit();
    }, ROLL_MS);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/award') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    if (S.gameOver) throw new HttpError(409, 'La partie est terminée.');
    if (S.phase !== 'drawn') throw new HttpError(409, 'Aucun tirage en attente d\'un vainqueur.');
    const i = playerIndex(b);
    S.scores[i] += 1;
    S.phase = 'idle';
    setEvent('point', i + 1);
    checkGameOver();
    commit();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/adjust') {
    if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
    const i = playerIndex(b);
    const delta = toInt(b.delta, 'delta') < 0 ? -1 : 1;
    const next = clamp(S.scores[i] + delta, 0, S.target);
    if (next === S.scores[i]) return json(res, 200, { ok: true });
    S.scores[i] = next;
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
      resetRound();
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
