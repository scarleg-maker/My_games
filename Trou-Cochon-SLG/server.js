// Trou-cochon-SLG — serveur de jeu (Node.js, aucune dépendance)
// Lancement : node server.js  →  http://localhost:19000/maitre
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 19000;
const MAX_PLAYERS = 6;
const ROLL_MS = 1500;      // animation du dé
const HOLD_MS = 1600;      // pause de lecture quand un tour se termine
const DRAW_MS = 2600;      // tirage au sort du premier joueur
const PUBLIC = path.join(__dirname, 'public');
const SAVE_FILE = path.join(__dirname, 'sauvegarde.json');

const COLORS = [
  { id: 'rouge', nom: 'Rouge', hex: '#e03131' },
  { id: 'orange', nom: 'Orange', hex: '#f7760f' },
  { id: 'jaune', nom: 'Jaune', hex: '#f5c518' },
  { id: 'lime', nom: 'Vert clair', hex: '#9be12f' },
  { id: 'cyan', nom: 'Turquoise', hex: '#1cc6d8' },
  { id: 'bleu', nom: 'Bleu', hex: '#2f6fed' },
  { id: 'violet', nom: 'Violet', hex: '#8b4dde' },
  { id: 'rose', nom: 'Rose', hex: '#f77fc4' },
  { id: 'magenta', nom: 'Magenta', hex: '#c2188f' },
  { id: 'marron', nom: 'Marron', hex: '#a0643a' },
  { id: 'blanc', nom: 'Blanc', hex: '#f4f1ea' },
  { id: 'gris', nom: 'Gris', hex: '#8e949c' },
];
const clamp = (v, a, b, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const norm = s => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '') || String(s).trim().toLowerCase();
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

// ---------------------------------------------------------------- sauvegarde des réglages par salon
let savedRooms = {};
try { const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); savedRooms = d && d.rooms && typeof d.rooms === 'object' ? d.rooms : {}; } catch { }
let saveTimer = null;
function saveRoom(code, data) {
  savedRooms[code] = { ...data, t: Date.now() };
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(100)) delete savedRooms[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: savedRooms }, null, 1), () => { }), 300);
}

// ================================================================ moteur de jeu (pur, testable)
// Une partie : N cases (= faces du dé). Les trous 1..N-1 sont sur le plateau, le trou N est le « dernier trou » (pions perdus).
function createEngine(opts = {}) {
  const rnd = opts.rnd || Math.random;
  const g = {
    nbCases: 8, nbPions: 6,
    order: [],        // sièges participants, dans l'ordre de jeu (à partir du premier tiré au sort)
    hand: {}, holes: [], lost: [], ranking: [],
    idx: 0, current: null, round: 1, rollsLeft: 1, over: false,
  };
  const rollsFor = round => (round === 1 ? 1 : 3);
  g.start = (participants, nbCases, nbPions, starter) => {
    const sorted = [...participants].sort((a, b) => a - b);
    const k = starter !== undefined ? sorted.indexOf(starter) : Math.floor(rnd() * sorted.length);
    g.order = sorted.slice(k).concat(sorted.slice(0, k));
    g.nbCases = nbCases; g.nbPions = nbPions;
    g.hand = {}; for (const s of g.order) g.hand[s] = nbPions;
    g.holes = Array(nbCases - 1).fill(null); g.lost = []; g.ranking = [];
    g.idx = 0; g.current = g.order[0]; g.round = 1; g.rollsLeft = rollsFor(1); g.over = false;
  };
  const remaining = () => g.order.filter(s => !g.ranking.includes(s));
  // joue un lancer : renvoie le détail du résultat
  g.resolve = value => {
    const s = g.current, r = { seat: s, value, kind: null, from: null, finished: false, turnEnds: false, gameOver: false };
    if (value === g.nbCases) { r.kind = 'lost'; g.hand[s]--; g.lost.push(s); }
    else if (g.holes[value - 1] !== null) { r.kind = 'recover'; r.from = g.holes[value - 1]; g.holes[value - 1] = null; g.hand[s]++; r.turnEnds = true; }
    else { r.kind = 'place'; g.holes[value - 1] = s; g.hand[s]--; }
    g.rollsLeft--;
    if (g.hand[s] === 0) { g.ranking.push(s); r.finished = true; r.turnEnds = true; }
    if (g.rollsLeft <= 0) r.turnEnds = true;
    const rest = remaining();
    if (rest.length <= 1) { for (const x of rest) g.ranking.push(x); g.over = true; r.gameOver = true; r.turnEnds = true; }
    return r;
  };
  g.advance = () => {
    const n = g.order.length;
    for (let i = 0; i < n; i++) {
      g.idx = (g.idx + 1) % n;
      if (g.idx === 0) g.round++;
      if (!g.ranking.includes(g.order[g.idx])) break;
    }
    g.current = g.order[g.idx]; g.rollsLeft = rollsFor(g.round);
  };
  g.rollValue = () => 1 + Math.floor(rnd() * g.nbCases);
  return g;
}

// ================================================================ salons
function createRoom(code, saved) {
  const state = {
    phase: 'setup',            // setup | playing | over
    nbJoueurs: 2, nbPions: 6, nbCases: 8,
    competition: false, singleScreen: false,
    roster: [], seats: Array(MAX_PLAYERS).fill(null),
    comp: null,                // { alive, eliminated:[{seat,game}], game, final, done, standings }
    gameId: 0, turnPhase: null,
    roll: null, draw: null, flash: null, log: [], seq: 0,
    result: null,              // fin de partie : { ranking, podium, loser, ... }
  };
  let eng = createEngine();
  let hidden = null;           // valeur du dé pendant l'animation (non diffusée)
  let timers = [];
  let aiTimer = null;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; clearTimeout(aiTimer); aiTimer = null; };

  const pname = i => state.seats[i]?.name || `Joueur ${i + 1}`;
  const log = t => { state.log.unshift({ t: Date.now(), text: t }); state.log.length = Math.min(state.log.length, 40); };
  const flash = (text, kind = 'info') => { state.flash = { id: ++state.seq, text, kind }; };
  const participants = () => (state.comp ? state.comp.alive : Array.from({ length: state.nbJoueurs }, (_, i) => i));

  function settings() {
    return { roster: state.roster, nbJoueurs: state.nbJoueurs, nbPions: state.nbPions, nbCases: state.nbCases, competition: state.competition, singleScreen: state.singleScreen };
  }
  const save = () => saveRoom(code, settings());
  function remember(name, color) {
    state.roster = [{ name, color }, ...state.roster.filter(r => norm(r.name) !== norm(name))].slice(0, 30);
  }

  // ---------------------------------------------------------------- déroulement
  function newGame() {
    clearTimers(); hidden = null;
    const parts = participants();
    eng.start(parts, state.nbCases, state.nbPions);
    state.phase = 'playing'; state.result = null; state.roll = null; state.log = [];
    state.gameId++;
    const id = ++state.seq;
    state.draw = { id, starter: eng.current, candidates: [...parts], start: Date.now(), dur: DRAW_MS };
    state.turnPhase = 'draw';
    const label = state.comp ? (state.comp.final ? 'Finale' : `Manche ${state.comp.game}`) : 'Nouvelle partie';
    const gid = state.gameId;
    later(() => {   // le résultat du tirage n'est annoncé (journal, message) qu'à la fin de l'animation
      if (state.gameId !== gid) return;
      state.draw = null; state.turnPhase = 'ready';
      log(`${label} — tirage au sort : ${pname(eng.current)} commence`);
      flash(`${pname(eng.current)} est tiré au sort pour commencer !`);
      broadcast();
    }, DRAW_MS);
  }

  function roll() {
    state.turnPhase = 'rolling';
    hidden = eng.rollValue();
    const id = ++state.seq, gid = state.gameId, seat = eng.current;
    state.roll = { id, seat, value: null, kind: null, start: Date.now(), dur: ROLL_MS };
    later(() => { if (state.gameId !== gid) return; settle(hidden, id, seat); broadcast(); }, ROLL_MS);
  }

  function settle(value, id, seat) {
    const who = pname(seat);
    const r = eng.resolve(value);
    state.roll = { id, seat, value, kind: r.kind, from: r.from, finished: r.finished, start: Date.now() - ROLL_MS, dur: ROLL_MS, hole: value };
    hidden = null;
    if (r.kind === 'lost') { log(`${who} fait ${value} : le pion est perdu dans le dernier trou`); flash(`${who} : ${value} — pion perdu !`, 'bad'); }
    else if (r.kind === 'recover') {
      const own = r.from === seat;
      log(`${who} fait ${value} : récupère ${own ? 'son propre pion' : `le pion de ${pname(r.from)}`}, fin du tour`);
      flash(`${who} : ${value} — case occupée, il récupère ${own ? 'son pion' : `le pion de ${pname(r.from)}`}`, 'bad');
    } else { log(`${who} fait ${value} : pose un pion`); flash(`${who} : ${value} — pion posé`, 'ok'); }
    if (r.finished) { log(`${who} n'a plus de pion en main : ${eng.ranking.length}${eng.ranking.length === 1 ? 'er' : 'e'} !`); flash(`${who} a posé tous ses pions !`, 'ok'); }
    const gid = state.gameId;
    if (r.gameOver) {
      state.turnPhase = 'result';
      later(() => { if (state.gameId !== gid) return; finishGame(); broadcast(); }, HOLD_MS);
    } else if (r.turnEnds) {
      state.turnPhase = 'result';
      later(() => { if (state.gameId !== gid) return; eng.advance(); state.turnPhase = 'ready'; broadcast(); }, HOLD_MS);
    } else state.turnPhase = 'ready';
  }

  function finishGame() {
    const ranking = [...eng.ranking], loser = ranking[ranking.length - 1];
    state.phase = 'over'; state.turnPhase = 'over';
    state.result = { ranking, podium: ranking.slice(0, 3), loser };
    log(`Partie terminée — ${pname(ranking[0])} gagne, ${pname(loser)} reste avec des pions !`);
    flash(`${pname(ranking[0])} remporte la partie !`, 'win');
    const c = state.comp;
    if (c) {
      if (c.alive.length <= 2) {
        c.done = true; c.final = true;
        c.standings = [ranking[0], ranking[1], ...c.eliminated.slice().reverse().map(e => e.seat)];
        flash(`${pname(ranking[0])} gagne la compétition !`, 'win');
      } else {
        c.eliminated.push({ seat: loser, game: c.game });
        c.alive = c.alive.filter(s => s !== loser);
        c.lastEliminated = loser;
      }
    }
  }

  function startCompetition() {
    const alive = Array.from({ length: state.nbJoueurs }, (_, i) => i);
    state.comp = { alive, eliminated: [], game: 1, final: alive.length === 2, done: false, standings: null, lastEliminated: null };
  }

  // ---------------------------------------------------------------- actions
  function handle(who, a) {
    const isMaster = who === 'master';
    const mySeat = /^p[1-6]$/.test(who) ? +who.slice(1) - 1 : null;
    const need = (cond, msg) => { if (!cond) throw new Error(msg); };
    const masterOnly = () => need(isMaster, "Action réservée au maître du jeu");
    switch (a.type) {
      case 'config': {
        masterOnly(); need(state.phase === 'setup', 'Configuration impossible pendant une partie');
        if ('nbJoueurs' in a) state.nbJoueurs = clamp(a.nbJoueurs, 2, MAX_PLAYERS, state.nbJoueurs);
        if ('nbPions' in a) state.nbPions = clamp(a.nbPions, 5, 8, state.nbPions);
        if ('nbCases' in a) state.nbCases = clamp(a.nbCases, 6, 10, state.nbCases);
        if ('competition' in a) state.competition = !!a.competition;
        if ('singleScreen' in a) state.singleScreen = !!a.singleScreen;
        save(); break;
      }
      case 'register': {
        const seat = isMaster ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0 && seat < MAX_PLAYERS, 'Siège invalide');
        need(state.phase === 'setup', 'Les inscriptions sont fermées pendant la partie');
        const name = String(a.name || '').trim().slice(0, 20);
        need(name, 'Indique un nom');
        need(COLORS.some(c => c.id === a.color), 'Choisis une couleur');
        const taken = state.seats.findIndex((s, i) => i !== seat && i < state.nbJoueurs && s && s.color === a.color);
        need(taken < 0, `Couleur déjà prise par ${pname(taken)}`);
        const dup = state.seats.findIndex((s, i) => i !== seat && i < state.nbJoueurs && s && norm(s.name) === norm(name));
        need(dup < 0, `Le nom « ${name} » est déjà pris`);
        state.seats[seat] = { name, color: a.color, ai: false };
        remember(name, a.color);
        save(); break;
      }
      case 'unregister': {
        const seat = isMaster ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0, 'Siège invalide');
        need(state.phase === 'setup', 'Impossible pendant la partie');
        state.seats[seat] = null; save(); break;
      }
      case 'clearSeats': { masterOnly(); need(state.phase === 'setup', 'Impossible pendant la partie'); state.seats = Array(MAX_PLAYERS).fill(null); break; }
      case 'clearRoster': { masterOnly(); state.roster = []; save(); break; }
      case 'forget': { masterOnly(); state.roster = state.roster.filter(r => norm(r.name) !== norm(a.name || '')); save(); break; }
      case 'start': {
        masterOnly(); need(state.phase === 'setup', 'Partie déjà lancée');
        const n = state.nbJoueurs;
        for (let i = 0; i < n; i++) need(state.seats[i], `Le joueur ${i + 1} n'est pas inscrit`);
        need(new Set(state.seats.slice(0, n).map(s => s.color)).size === n, 'Deux joueurs ont la même couleur');
        state.comp = null;
        if (state.competition) startCompetition();
        newGame(); save(); break;
      }
      case 'setAI': {   // active / désactive un joueur IA (même en cours de partie)
        masterOnly();
        const seat = a.seat | 0, on = !!a.on;
        need(seat >= 0 && seat < state.nbJoueurs, 'Siège invalide');
        const x = state.seats[seat];
        if (state.phase === 'setup') {
          if (on) {
            if (!x) {
              let k = 1; while (state.seats.some((y, i) => i < state.nbJoueurs && y && norm(y.name) === norm('IA ' + k))) k++;
              const taken = new Set(state.seats.filter((y, i) => y && i < state.nbJoueurs).map(y => y.color));
              const col = COLORS.find(c => !taken.has(c.id));
              need(col, 'Plus de couleur disponible');
              state.seats[seat] = { name: 'IA ' + k, color: col.id, ai: true, auto: true };
            } else x.ai = true;
          } else if (x) { if (x.auto) state.seats[seat] = null; else x.ai = false; }
        } else {
          need(x, 'Siège vide');
          x.ai = on;
          log(`${x.name} ${on ? 'est maintenant joué par l\'IA' : 'est repris en main par un joueur'}`);
          flash(`${x.name} : ${on ? 'IA activée' : 'IA désactivée'}`);
        }
        break;
      }
      case 'roll': {
        need(state.phase === 'playing' && state.turnPhase === 'ready', "Le dé ne peut pas être lancé maintenant");
        need(!state.seats[eng.current]?.ai, "C'est au tour de l'IA (désactive-la pour jouer à sa place)");
        need(isMaster || mySeat === eng.current, "Ce n'est pas ton tour");
        roll(); break;
      }
      case 'rematch': {   // nouvelle partie (hors compétition) avec les mêmes joueurs
        masterOnly(); need(state.phase === 'over', 'La partie est en cours');
        need(!state.comp, 'En compétition, utilise « manche suivante »');
        newGame(); break;
      }
      case 'nextGame': {  // compétition : manche suivante
        masterOnly(); need(state.phase === 'over' && state.comp && !state.comp.done, 'Pas de manche suivante');
        state.comp.game++; state.comp.final = state.comp.alive.length === 2; state.comp.lastEliminated = null;
        newGame(); break;
      }
      case 'restartComp': {  // compétition terminée : en relancer une
        masterOnly(); need(state.phase === 'over' && state.comp && state.comp.done, 'La compétition est en cours');
        startCompetition(); newGame(); break;
      }
      case 'reset': {     // retour à la configuration
        masterOnly(); clearTimers(); hidden = null; state.gameId++;
        Object.assign(state, { phase: 'setup', turnPhase: null, roll: null, draw: null, result: null, comp: null, log: [] });
        break;
      }
      default: throw new Error('Action inconnue');
    }
  }

  // ---------------------------------------------------------------- vues & diffusion
  const clients = new Set();
  const online = i => [...clients].some(c => c.who === 'p' + (i + 1));
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  function view(who) {
    touch();
    const s = state, playing = s.phase !== 'setup';
    const v = {
      room: code, you: who, phase: s.phase, nbJoueurs: s.nbJoueurs, nbPions: s.nbPions, nbCases: s.nbCases,
      competition: s.competition, singleScreen: s.singleScreen, colors: COLORS, roster: s.roster,
      seats: s.seats.map((x, i) => ({ name: x?.name || null, color: x?.color || null, ai: !!x?.ai, online: online(i) })),
      turnPhase: s.turnPhase, gameId: s.gameId, flash: s.flash, log: s.log.slice(0, 25),
      draw: s.draw ? { ...s.draw, elapsed: Date.now() - s.draw.start } : null,
      roll: s.roll ? { ...s.roll, elapsed: Date.now() - s.roll.start } : null,
      result: s.result,
      comp: s.comp ? { alive: s.comp.alive, eliminated: s.comp.eliminated, game: s.comp.game, final: s.comp.final, done: s.comp.done, standings: s.comp.standings, lastEliminated: s.comp.lastEliminated } : null,
    };
    if (playing) {
      v.game = {
        order: eng.order, current: eng.current, round: eng.round, rollsLeft: eng.rollsLeft,
        rollsMax: eng.round === 1 ? 1 : 3,
        hand: eng.hand, holes: eng.holes, lost: eng.lost, ranking: eng.ranking,
      };
    }
    if (who === 'master') { v.lanUrls = lanUrls(); }
    return v;
  }
  const send = c => c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`);
  // joueurs IA : le dé est aléatoire, l'IA se contente de le lancer après une courte pause
  function scheduleAI() {
    clearTimeout(aiTimer); aiTimer = null;
    if (state.phase !== 'playing' || state.turnPhase !== 'ready' || !state.seats[eng.current]?.ai) return;
    const gid = state.gameId, seat = eng.current, seq = state.seq;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (state.gameId !== gid || state.turnPhase !== 'ready' || eng.current !== seat || state.seq !== seq || !state.seats[seat]?.ai) return;
      roll(); broadcast();
    }, 900 + Math.random() * 700);
  }
  function broadcast() { for (const c of clients) send(c); scheduleAI(); }

  if (saved) {
    const d = saved;
    if (Array.isArray(d.roster)) state.roster = d.roster.filter(r => r && r.name).slice(0, 30);
    state.nbJoueurs = clamp(d.nbJoueurs, 2, MAX_PLAYERS, 2);
    state.nbPions = clamp(d.nbPions, 5, 8, 6);
    state.nbCases = clamp(d.nbCases, 6, 10, 8);
    state.competition = !!d.competition; state.singleScreen = !!d.singleScreen;
  }

  function addClient(res, who, req) {
    const presence = () => state.seats.map((_, i) => online(i)).join();
    const before = presence();
    const c = { res, who };
    clients.add(c); touch();
    if (presence() !== before) broadcast(); else send(c);
    req.on('close', () => { const b = presence(); clients.delete(c); touch(); if (presence() !== b) broadcast(); });
  }
  function act(who, a) { touch(); handle(who, a); broadcast(); }
  function destroy() { clearTimers(); state.gameId++; }
  function info() {
    return { code, phase: state.phase, nbActive: state.nbJoueurs, singleScreen: state.singleScreen, competition: state.competition,
      seats: state.seats.slice(0, state.nbJoueurs).map((x, i) => ({ name: x?.name || null, color: x?.color || null, ai: !!x?.ai, online: online(i) })) };
  }
  return { code, clients, addClient, act, destroy, info, idle: () => Date.now() - lastActivity };
}

// ================================================================ registre des salons
const rooms = new Map();
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'EVENTS', 'JOUEUR', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'FAVICON']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 300;
const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-6]$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !savedRooms[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms) if (r.clients.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code, savedRooms[code] || null);
  rooms.set(code, r);
  if (!savedRooms[code]) saveRoom(code, {});
  return r;
}

// ================================================================ HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
const json = (res, obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => { let a = {}; try { a = JSON.parse(body || '{}'); } catch { } cb(a); });
}

function makeServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let m;
    if (req.method === 'GET') {
      if (p === '/' || /^\/(maitre|joueur[1-6])\/?$/i.test(p)) return sendFile(res, path.join(PUBLIC, 'accueil.html'));
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (p.startsWith('/static/')) {
        const f = path.normalize(path.join(PUBLIC, p.slice(8)));
        if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
        return sendFile(res, f);
      }
      if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})$/))) {
        const code = cleanCode(m[1]);
        const r = validCode(code) ? getRoom(code, false) : null;
        return json(res, r ? { exists: true, ...r.info() } : { exists: false, code });
      }
      if (p === '/events') {
        const code = cleanCode(url.searchParams.get('room')), who = url.searchParams.get('who');
        if (who !== 'master' && !/^p[1-6]$/.test(who)) { res.writeHead(400); return res.end(); }
        const r = validCode(code) ? getRoom(code, false) : null;
        if (!r) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
        return r.addClient(res, who, req);
      }
      if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([1-6])\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'jeu.html'));
      if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'accueil.html'));
      if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/maitre\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'jeu.html'));
      if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/?$/)) && validCode(cleanCode(m[1]))) { res.writeHead(302, { Location: `/${cleanCode(m[1])}/maitre` }); return res.end(); }
    }
    if (req.method === 'POST' && p === '/api/rooms') {
      return readBody(req, a => {
        const code = a.code ? cleanCode(a.code) : newCode();
        if (!validCode(code)) return json(res, { ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
        if (rooms.has(code) && !a.reuse) return json(res, { ok: false, error: `Le salon ${code} est déjà en cours d'utilisation` });
        getRoom(code, true);
        json(res, { ok: true, code });
      });
    }
    if (req.method === 'POST' && p === '/api') {
      return readBody(req, a => {
        const code = cleanCode(a.room);
        const r = validCode(code) ? getRoom(code, false) : null;
        if (!r) return json(res, { ok: false, error: "Ce salon n'existe plus. Recharge la page.", noroom: true });
        try { r.act(a.who, a); json(res, { ok: true }); } catch (e) { json(res, { ok: false, error: e.message }); }
      });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable');
  });
}

if (require.main === module) {
  setInterval(() => purge(false), 10 * 60 * 1000);
  setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 15000);
  makeServer().listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Trou-cochon-SLG est lancé !`);
    console.log(`  Maître du jeu (crée ou reprend un salon) : http://localhost:${PORT}/maitre`);
    console.log(`  Accueil (créer ou rejoindre un salon)    : http://localhost:${PORT}/`);
    for (const u of lanUrls()) console.log(`  Depuis le réseau local                   : ${u}/`);
    console.log('');
  });
}
module.exports = { createEngine, COLORS };
