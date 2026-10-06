'use strict';
/**
 * Duo-Master — serveur Node.js (aucune dépendance externe).
 * Chaque partie vit dans son propre « salon » (code court, ex. K7QF), totalement indépendant
 * des autres : thème, joueurs, scores, tirage en cours... rien n'est partagé entre deux salons.
 * Temps réel via Server-Sent Events (/events?room=CODE), API JSON sous /api/*.
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
const FILE_ROOMS = path.join(DIR_DATA, 'rooms.json');
const MAX_SAVED_ROOMS = 300;       // salons conservés sur disque (les plus récents)
const ROOM_IDLE_MS = 6 * 3600 * 1000; // salon sans aucune page ouverte depuis 6h → libéré de la mémoire
const MAX_ROOMS_LIVE = 500;        // salons simultanément en mémoire (garde-fou)

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
/* Partagés entre tous les salons : un thème n'appartient à aucun salon. */
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

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sauvegarde des salons (fichier unique data/rooms.json)             */
/* Chaque salon y a son entrée ; on ne garde que les plus récents.    */
/* ------------------------------------------------------------------ */
let savedRooms = {}; // code -> données sauvegardées (+ t: dernière activité)
try {
  const j = JSON.parse(fs.readFileSync(FILE_ROOMS, 'utf8'));
  if (j && typeof j === 'object') savedRooms = j;
} catch { /* premier lancement */ }
let saveTimer = null;
function persistRoom(code, data) {
  savedRooms[code] = { ...data, t: Date.now() };
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(MAX_SAVED_ROOMS)) delete savedRooms[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR_DATA, { recursive: true });
      fs.writeFileSync(FILE_ROOMS, JSON.stringify(savedRooms, null, 1));
    } catch (e) { console.warn('Sauvegarde impossible :', e.message); }
  }, 300);
}
function forgetRoom(code) { delete savedRooms[code]; persistFlush(); }
function persistFlush() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DIR_DATA, { recursive: true });
    fs.writeFileSync(FILE_ROOMS, JSON.stringify(savedRooms, null, 1));
  } catch { /* tant pis */ }
}

/* ------------------------------------------------------------------ */
/* Un salon = une partie complète et indépendante                     */
/* ------------------------------------------------------------------ */
function createRoom(code, saved) {
  const S = {
    names: Array.from({ length: MAX_PLAYERS }, (_, i) => `Joueur ${i + 1}`),
    scores: new Array(MAX_PLAYERS).fill(0),
    playerCount: 2,
    target: 10,
    themeId: 'pokemon',
    started: false, // false = salon en réglages, true = partie lancée par l'arbitre
    mode: 'speed', // 'speed' = Rapidité (l'arbitre désigne le vainqueur) | 'answer' = Réponse (les joueurs écrivent, vérif auto)
    phase: 'idle', // idle | rolling | drawn
    draw: null,
    round: 0,
    gameOver: false,
    winnerId: null,
    lastEvent: null,
    eventSeq: 0,
    submissions: {}, // mode "answer" : playerId -> { text, correct, awarded, at } pour le tour en cours
    answerDeadline: null,
    subRev: 0,
  };
  let rollTimer = null;
  let pendingDraw = null;
  let answerTimer = null;
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  const onlineSeats = new Set(); // ids (1..6) des pages joueur actuellement connectées

  function applySaved(j) {
    if (!j) return;
    try {
      if (Array.isArray(j.names)) j.names.slice(0, MAX_PLAYERS).forEach((n, i) => { if (typeof n === 'string' && n.trim()) S.names[i] = cleanName(n); });
      if (Array.isArray(j.scores)) j.scores.slice(0, MAX_PLAYERS).forEach((n, i) => { S.scores[i] = Math.max(0, Math.round(Number(n)) || 0); });
      S.playerCount = clamp(Math.round(Number(j.playerCount)) || 2, MIN_PLAYERS, MAX_PLAYERS);
      S.target = clamp(Math.round(Number(j.target)) || 10, MIN_TARGET, MAX_TARGET);
      if (typeof j.themeId === 'string') S.themeId = j.themeId;
      S.mode = j.mode === 'answer' ? 'answer' : 'speed';
      S.round = Math.max(0, Math.round(Number(j.round)) || 0);
      S.started = j.started === undefined ? (S.round > 0 || S.scores.some((n) => n > 0)) : !!j.started;
    } catch { /* on garde les valeurs par défaut */ }
  }
  applySaved(saved);
  if (!readThemeFile(S.themeId)) {
    const first = listThemes()[0];
    S.themeId = first ? first.id : 'pokemon';
  }

  function save() {
    persistRoom(code, {
      names: S.names, scores: S.scores, playerCount: S.playerCount, target: S.target,
      themeId: S.themeId, round: S.round, started: S.started, mode: S.mode,
    });
  }

  function checkGameOver() {
    if (S.mode === 'answer') {
      // Mode Réponse : les points peuvent tomber simultanément, donc une égalité au sommet
      // (même au-delà de l'objectif) ne termine pas la partie — il faut être seul en tête.
      let best = -1, idx = -1, tie = false;
      for (let i = 0; i < S.playerCount; i++) {
        if (S.scores[i] > best) { best = S.scores[i]; idx = i; tie = false; }
        else if (S.scores[i] === best) { tie = true; }
      }
      S.gameOver = idx >= 0 && best >= S.target && !tie;
      S.winnerId = S.gameOver ? idx + 1 : null;
    } else {
      let best = -1, idx = -1;
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
      code,
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

  /* ---------------- temps réel (clients SSE de CE salon) ---------------- */
  const clients = new Set(); // { res, role: 'referee' | 'ecran' | 1..6 }

  function broadcast() {
    const msg = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
    for (const c of clients) c.res.write(msg);
  }
  function commit() { save(); broadcast(); }

  function addClient(res, role) {
    const entry = { res, role };
    clients.add(entry);
    touch();
    if (typeof role === 'number') onlineSeats.add(role);
    res.write(`retry: 1000\nevent: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    return entry;
  }
  function removeClient(entry) {
    clients.delete(entry);
    touch();
    if (typeof entry.role === 'number' && ![...clients].some((c) => c.role === entry.role)) onlineSeats.delete(entry.role);
  }

  /* ---------------- réponses possibles pour le tirage en cours ---------------- */
  function answersPayload() {
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
    if (!S.draw || S.phase === 'rolling' || !hasAnswers) {
      return { hasAnswers, exact: [], also: [], alsoLabel: '', submissions: submissions() };
    }
    const r = findAnswers(theme, S.draw);
    const pub = (a) => ({ name: a.name, info: a.info, detail: theme.answerMode === 'set' ? a.raw.join(' / ') : '' });
    return { hasAnswers, exact: r.exact.map(pub), also: r.also.map(pub), alsoLabel: r.alsoLabel, submissions: submissions() };
  }

  function playerIndex(b) {
    const id = toInt(b.playerId, 'joueur');
    if (id < 1 || id > S.playerCount) throw new HttpError(400, 'Joueur inconnu');
    return id - 1;
  }

  /* ---------------- actions (POST) ---------------- */
  const actions = {
    start() {
      S.started = true;
      S.round = 0;
      resetRound();
      setEvent('start');
      commit();
    },

    draw() {
      // Mode Réponse : si l'arbitre avance la main avant la fin du délai, on tranche
      // maintenant le sort du tour qui vient de se jouer (au lieu d'attendre le minuteur).
      if (S.mode === 'answer' && S.phase === 'drawn') { closeAnswerRound(); if (S.gameOver) commit(); }
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
    },

    award(b) {
      if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
      if (S.gameOver) throw new HttpError(409, 'La partie est terminée.');
      if (S.phase !== 'drawn') throw new HttpError(409, 'Aucun tirage en attente d\'un vainqueur.');
      const i = playerIndex(b);
      if (S.submissions[i + 1] && S.submissions[i + 1].awarded) throw new HttpError(409, 'Ce joueur a déjà son point pour ce tour.');
      S.scores[i] += 1;
      S.submissions[i + 1] = { ...(S.submissions[i + 1] || { text: '', correct: null, at: Date.now() }), awarded: true };
      if (S.mode === 'answer') S.subRev += 1;
      if (S.mode !== 'answer') {
        S.phase = 'idle';
        checkGameOver();
      }
      setEvent('point', i + 1);
      commit();
    },

    answer(b) {
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
      let correct = null;
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
      }
      commit();
      return { correct };
    },

    adjust(b) {
      if (!S.started) throw new HttpError(409, 'La partie n\'est pas lancée.');
      const i = playerIndex(b);
      const delta = toInt(b.delta, 'delta') < 0 ? -1 : 1;
      const next = clamp(S.scores[i] + delta, 0, S.target);
      if (next === S.scores[i]) return;
      S.scores[i] = next;
      if (delta < 0 && S.submissions[i + 1] && S.submissions[i + 1].awarded) {
        S.submissions[i + 1].awarded = false;
        if (S.mode === 'answer') S.subRev += 1;
      }
      setEvent(delta < 0 ? 'remove' : 'add', i + 1);
      checkGameOver();
      commit();
    },

    newgame() {
      S.scores.fill(0);
      S.round = 0;
      S.started = false;
      resetRound();
      setEvent('newgame');
      checkGameOver();
      commit();
    },

    settings(b) {
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
    },
  };

  function handle(action, body) {
    const fn = actions[action];
    if (!fn) throw new HttpError(404, 'Action inconnue');
    touch();
    const out = fn(body || {});
    return out || {};
  }

  function destroy() { clearTimeout(rollTimer); clearTimeout(answerTimer); }

  /** Résumé léger, pour la page d'accueil (recherche d'un salon par son code) */
  function info() {
    const theme = readThemeFile(S.themeId);
    return {
      exists: true,
      code,
      themeId: S.themeId,
      themeName: theme ? theme.name : S.themeId,
      themeEmoji: theme ? theme.emoji : '🎲',
      mode: S.mode,
      started: S.started,
      gameOver: S.gameOver,
      target: S.target,
      round: S.round,
      playerCount: S.playerCount,
      players: Array.from({ length: S.playerCount }, (_, i) => ({
        id: i + 1, name: S.names[i], score: S.scores[i], online: onlineSeats.has(i + 1),
      })),
    };
  }

  checkGameOver();
  return {
    code, clients, addClient, removeClient, handle, destroy, info, publicState, answersPayload,
    idleMs: () => Date.now() - lastActivity,
  };
}

/* ------------------------------------------------------------------ */
/* Registre des salons                                                */
/* ------------------------------------------------------------------ */
const rooms = new Map(); // code -> salon
const CODE_RE = /^[A-Z0-9]{3,8}$/;
const RESERVED = new Set(['API', 'EVENTS', 'STYLE', 'COMMON', 'ARBITRE', 'JOUEUR', 'ACCUEIL', 'FAVICON', 'ASSETS', 'STATIC', 'ECRAN', 'REJOINDRE']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I/L, pour éviter les confusions à l'oral/à l'écrit
const cleanCode = (c) => String(c || '').trim().toUpperCase();
const validCode = (c) => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-6]$/.test(c);

function newCode() {
  for (let len = 4; ; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !savedRooms[c] && validCode(c)) return c;
    }
  }
}

function purgeRooms(force) {
  for (const [code, r] of rooms) {
    if (r.clients.size === 0 && (force || r.idleMs() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
  }
}
setInterval(() => purgeRooms(false), 10 * 60 * 1000).unref();
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 20000).unref();

/** Renvoie le salon demandé. create=true : le crée s'il n'existe pas encore (nouveau ou restauré depuis le disque). */
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS_LIVE) purgeRooms(true);
  const r = createRoom(code, savedRooms[code] || null);
  rooms.set(code, r);
  return r;
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
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }

/* ------------------------------------------------------------------ */
/* API                                                                 */
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const method = req.method;
    let m;

    if (method === 'GET') {
      if (p === '/') return sendFile(res, path.join(DIR_PUBLIC, 'accueil.html'));
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

      // --- fichiers statiques (feuilles de style, scripts partagés) ---
      if (/^\/(style\.css|common\.js|accueil\.js|arbitre\.js|joueur\.js)$/.test(p)) {
        return sendFile(res, path.join(DIR_PUBLIC, p.slice(1)));
      }

      // --- anciennes adresses sans salon → accueil (elles n'ont plus de sens à présent) ---
      if (/^\/(arbitre|ecran|joueur[1-6])\/?$/.test(p)) return redirect(res, '/');

      // --- API en lecture ---
      if (p === '/api/info') return json(res, 200, { port: PORT, ips: lanIPs() });
      if (p === '/api/themes') return json(res, 200, listThemes());
      if (p.startsWith('/api/theme/')) {
        const theme = readThemeFile(p.slice('/api/theme/'.length));
        if (!theme) throw new HttpError(404, 'Thème introuvable');
        return json(res, 200, publicTheme(theme));
      }
      if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,10})$/))) {
        const code = cleanCode(m[1]);
        const r = validCode(code) ? getRoom(code, false) : null;
        return json(res, 200, r ? r.info() : { exists: false, code });
      }
      if (p === '/api/state' || p === '/api/answers') {
        const code = cleanCode(url.searchParams.get('room'));
        const r = validCode(code) ? getRoom(code, false) : null;
        if (!r) throw new HttpError(404, 'Ce salon n\'existe pas (ou plus).');
        return json(res, 200, p === '/api/state' ? r.publicState() : r.answersPayload());
      }

      // --- temps réel ---
      if (p === '/events') {
        const code = cleanCode(url.searchParams.get('room'));
        const roleRaw = url.searchParams.get('role') || '';
        const role = roleRaw === 'referee' ? 'referee' : roleRaw === 'ecran' ? 'ecran' : /^[1-6]$/.test(roleRaw) ? Number(roleRaw) : null;
        if (!validCode(code) || role === null) { res.writeHead(400); return res.end(); }
        const r = getRoom(code, false);
        if (!r) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const entry = r.addClient(res, role);
        req.on('close', () => r.removeClient(entry));
        return;
      }

      // --- adresses d'un salon : /CODE, /CODE/joueurN, /CODE/ecran, /CODE/rejoindre ---
      if ((m = p.match(/^\/([A-Za-z0-9]{3,8})\/joueur([1-6])\/?$/)) && validCode(cleanCode(m[1]))) {
        return sendFile(res, path.join(DIR_PUBLIC, 'joueur.html'));
      }
      if ((m = p.match(/^\/([A-Za-z0-9]{3,8})\/ecran\/?$/)) && validCode(cleanCode(m[1]))) {
        return sendFile(res, path.join(DIR_PUBLIC, 'joueur.html'));
      }
      if ((m = p.match(/^\/([A-Za-z0-9]{3,8})\/rejoindre\/?$/)) && validCode(cleanCode(m[1]))) {
        return sendFile(res, path.join(DIR_PUBLIC, 'accueil.html'));
      }
      if ((m = p.match(/^\/([A-Za-z0-9]{3,8})\/?$/)) && validCode(cleanCode(m[1]))) {
        return sendFile(res, path.join(DIR_PUBLIC, 'arbitre.html'));
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }

    if (method === 'POST') {
      if (p === '/api/rooms') {
        const b = await readBody(req);
        let code = b.code ? cleanCode(b.code) : newCode();
        if (!validCode(code)) return json(res, 200, { ok: false, error: 'Code invalide : 3 à 8 lettres/chiffres (sans 0, O, 1, I, L).' });
        if (rooms.has(code) && !b.reuse) return json(res, 200, { ok: false, error: `Le salon ${code} est déjà utilisé. Choisis-en un autre, ou rejoins-le.` });
        getRoom(code, true);
        return json(res, 200, { ok: true, code });
      }
      if ((m = p.match(/^\/api\/(start|draw|award|answer|adjust|newgame|settings)$/))) {
        const b = await readBody(req);
        const code = cleanCode(b.room);
        const r = validCode(code) ? getRoom(code, false) : null;
        if (!r) throw new HttpError(404, 'Ce salon n\'existe pas (ou plus). Recharge la page.');
        const out = r.handle(m[1], b);
        return json(res, 200, { ok: true, ...out });
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { ok: false, error: e.message || 'Erreur serveur' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎲 Duo-Master est lancé !\n');
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  const ips = lanIPs();
  if (ips.length) {
    console.log('\n  Depuis un téléphone (même réseau Wi-Fi) :');
    for (const ip of ips) console.log(`    http://${ip}:${PORT}/`);
  }
  console.log(`\n  Thèmes disponibles : ${listThemes().map((t) => t.name).join(', ') || '(aucun)'}\n`);
  console.log(`  Salons restaurés depuis le disque : ${Object.keys(savedRooms).length}\n`);
});

process.on('SIGINT', () => { persistFlush(); process.exit(0); });
process.on('SIGTERM', () => { persistFlush(); process.exit(0); });
