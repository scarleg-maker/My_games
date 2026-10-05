// Puis-thème 4 — serveur de jeu (Node.js, aucune dépendance)
// Lancement : node server.js  →  http://localhost:14400
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AI = require('./ai');

const PORT = process.env.PORT || 14400;   // Render fournit son propre port via PORT
const ROWS = 6, COLS = 7, MAX_PLAYERS = 6;
const FLIP_MS = 2000, SPIN_MS = 1600;   // renversement normal / aléatoire (3 tours)
const PUBLIC = path.join(__dirname, 'public');
const THEMES_DIR = path.join(__dirname, 'thematiques');
const SAVE_FILE = path.join(__dirname, 'sauvegarde.json');

const COLORS = [
  { id: 'rouge', nom: 'Rouge', hex: '#e03131' },
  { id: 'jaune', nom: 'Jaune', hex: '#f5c518' },
  { id: 'bleu', nom: 'Bleu', hex: '#2f6fed' },
  { id: 'vert', nom: 'Vert', hex: '#2fa84f' },
  { id: 'orange', nom: 'Orange', hex: '#f7760f' },
  { id: 'violet', nom: 'Violet', hex: '#8b4dde' },
  { id: 'rose', nom: 'Rose', hex: '#f062b0' },
  { id: 'cyan', nom: 'Cyan', hex: '#1cc6d8' },
  { id: 'marron', nom: 'Marron', hex: '#8d5a34' },
  { id: 'blanc', nom: 'Blanc', hex: '#f2f0ea' },
];
const MODES = ['classique', 'renverse', 'thematique'];

// ---------------------------------------------------------------- utilitaires
const norm = s => {
  const raw = String(s).trim().toLowerCase();
  const k = raw.replace(/♀/g, 'f').replace(/♂/g, 'm').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return k || raw;
};
const cellLabel = (r, c) => 'ABCDEFG'[c] + (ROWS - r);
const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function intersect(a, b) { // Map(clé→nom) ∩ Map(clé→nom)
  if (!a || !b) return [];
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const out = [];
  for (const [k, v] of small) if (big.has(k)) out.push({ key: k, nom: v });
  return out.sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
}

// ---------------------------------------------------------------- thématiques
// Formats JSON acceptés (voir README.md) :
//  1) Format « listes + slots » (vos fichiers pokemon / dragonball / onepiece) :
//     { name, emoji, description, answerMode: "set"|"slots", lists: { liste: [{name, emoji, color}] },
//       slots: [{id, label, list}, {id, label, list}], answers: [{ name, info, <id ou liste ou tags>: [...] }] }
//     - "slots" : la réponse doit avoir le thème de la ligne dans son 1er champ ET celui de la colonne dans le 2e.
//     - "set"   : les thèmes de la réponse doivent être exactement {ligne, colonne} (Feu + Feu = Feu pur).
//  2) { titre, reponses: [ ["Bulbizarre","Plante","Poison"], … ] }        (réponse ayant les deux thèmes)
//  3) { titre, themes: { "Eau": [réponses], … } }
//  4) { titre, lignes: { thème: [réponses] }, colonnes: { thème: [réponses] } }
function buildPool(obj) {
  const pool = {};
  for (const [theme, list] of Object.entries(obj || {})) {
    if (!Array.isArray(list)) continue;
    const m = new Map();
    for (const a of list) if (a != null && String(a).trim()) m.set(norm(a), String(a).trim());
    pool[theme] = m;
  }
  return pool;
}
function loadThematique(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, path.basename(file)), 'utf8'));
  const th = {
    file, titre: raw.titre || raw.name || raw.title || file.replace(/\.json$/i, ''),
    emoji: raw.emoji || '', description: raw.description || '',
    meta: {},            // thème → { emoji, color }
    axisA: [], axisB: [],// thèmes possibles pour le 1er et le 2e slot
    distinct: false,     // true : une ligne et une colonne ne peuvent pas avoir le même thème
    labels: ['Ligne', 'Colonne'],
    cellFn: null, all: [],
  };
  const allMap = new Map();
  const addAll = (key, nom, info) => { if (!allMap.has(key)) allMap.set(key, { key, nom, info: info || '' }); };

  if (raw.lists && Array.isArray(raw.slots) && Array.isArray(raw.answers)) {
    const [s1, s2] = raw.slots;
    if (!s1 || !s2 || !raw.lists[s1.list] || !raw.lists[s2.list]) throw new Error('"slots" doit décrire deux listes existantes');
    const names = l => raw.lists[l].map(x => (typeof x === 'string' ? x : x.name));
    for (const l of Object.values(raw.lists)) for (const x of l) if (x && typeof x === 'object') th.meta[x.name] = { emoji: x.emoji || '', color: x.color || '' };
    th.axisA = names(s1.list); th.axisB = names(s2.list);
    th.labels = [s1.label || s1.id, s2.label || s2.id];
    const mode = raw.answerMode === 'set' ? 'set' : 'slots';
    const field = (a, sl) => a[sl.id] ?? a[sl.list] ?? a.tags ?? [];
    const answers = raw.answers.filter(a => a && a.name).map(a => ({ key: norm(a.name), nom: String(a.name), info: a.info || '', a }));
    answers.forEach(x => addAll(x.key, x.nom, x.info));
    if (mode === 'set') {
      const bySet = new Map();
      for (const x of answers) {
        const k = [...new Set(field(x.a, s1))].sort().join('\u0001');
        if (!bySet.has(k)) bySet.set(k, []);
        bySet.get(k).push(x);
      }
      th.cellFn = (a, b) => bySet.get([...new Set([a, b])].sort().join('\u0001')) || [];
      th.distinct = false;
    } else {
      th.cellFn = (a, b) => answers.filter(x => field(x.a, s1).includes(a) && field(x.a, s2).includes(b));
      th.distinct = s1.list === s2.list;
    }
  } else {
    let rowPool, colPool;
    if (raw.lignes && raw.colonnes) {
      rowPool = buildPool(raw.lignes); colPool = buildPool(raw.colonnes);
    } else if (raw.themes && !Array.isArray(raw.themes) && typeof raw.themes === 'object') {
      rowPool = colPool = buildPool(raw.themes); th.distinct = true;
    } else if (Array.isArray(raw.reponses)) {
      const obj = {};
      if (Array.isArray(raw.themes)) raw.themes.forEach(t => (obj[t] = []));
      for (const r of raw.reponses) {
        let nom, tt = [];
        if (Array.isArray(r)) [nom, ...tt] = r;
        else if (r && typeof r === 'object') { nom = r.nom ?? r.name; tt = r.themes || r.types || []; }
        if (!nom) continue;
        for (const t of tt) (obj[t] ||= []).push(nom);
      }
      rowPool = colPool = buildPool(obj); th.distinct = true;
    } else throw new Error('Format non reconnu (attendu : "lists"/"slots"/"answers", "reponses", "themes" ou "lignes"/"colonnes")');
    th.axisA = Object.keys(rowPool); th.axisB = Object.keys(colPool);
    [rowPool, colPool].forEach(p => Object.values(p).forEach(m => m.forEach((v, k) => addAll(k, v))));
    th.cellFn = (a, b) => intersect(rowPool[a], colPool[b]);
  }
  // cache des cases, réponses triées
  const cache = new Map();
  th.cell = (a, b) => {
    const k = a + '\u0002' + b;
    if (!cache.has(k)) cache.set(k, [...th.cellFn(a, b)].map(x => ({ key: x.key, nom: x.nom, info: x.info || '' })).sort((x, y) => x.nom.localeCompare(y.nom, 'fr')));
    return cache.get(k);
  };
  th.all = [...allMap.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (th.distinct && new Set([...th.axisA, ...th.axisB]).size < ROWS + COLS) throw new Error(`Il faut au moins ${ROWS + COLS} thèmes différents`);
  if (th.axisA.length < 2 || th.axisB.length < 2) throw new Error('Pas assez de thèmes');
  return th;
}
// Tirage de la grille. Les thèmes d'une même direction sont différents tant que la liste le permet ;
// s'il en manque (ex. 5 factions pour 6 lignes), certains sont répétés. On essaie aussi l'orientation inverse
// (1re liste en colonnes) et on garde la grille où le plus de cases ont au moins une réponse.
function pick(list, n) {
  const a = shuffle(list).slice(0, n);
  while (a.length < n) a.push(list[(Math.random() * list.length) | 0]);
  return shuffle(a);
}
const repeats = arr => arr.length - new Set(arr).size;
function drawGrid(th) {
  let best = null;
  const orients = th.axisA.join() === th.axisB.join() ? [false] : [false, true];
  for (let i = 0; i < 4000; i++) {
    const swap = orients[i % orients.length];
    const rowList = swap ? th.axisB : th.axisA, colList = swap ? th.axisA : th.axisB;
    let rows, cols;
    if (th.distinct) { const x = shuffle(rowList).slice(0, ROWS + COLS); rows = x.slice(0, ROWS); cols = x.slice(ROWS); }
    else { rows = pick(rowList, ROWS); cols = pick(colList, COLS); }
    let filled = 0, min = Infinity, total = 0;
    for (const r of rows) for (const c of cols) {
      const n = (swap ? th.cell(c, r) : th.cell(r, c)).length;
      if (n > 0) filled++; min = Math.min(min, n); total += n;
    }
    const score = filled * 1e6 - (repeats(rows) + repeats(cols)) * 2.5e6 + Math.min(min, 99) * 1e3 + Math.min(total, 999);
    if (!best || score > best.score) best = { score, rows, cols, swap, filled };
    if (filled === ROWS * COLS && min >= 3 && !repeats(rows) && !repeats(cols)) break;
  }
  const empty = best.rows.map(r => best.cols.map(c => (best.swap ? th.cell(c, r) : th.cell(r, c)).length === 0));
  return { rows: best.rows, cols: best.cols, swap: best.swap, filled: best.filled, empty };
}
const fileCache = new Map();
function listThemeFiles() {
  let files = [];
  try { files = fs.readdirSync(THEMES_DIR).filter(f => f.toLowerCase().endsWith('.json')).sort(); } catch { }
  return files.map(f => {
    let mt = 0;
    try { mt = fs.statSync(path.join(THEMES_DIR, f)).mtimeMs; } catch { }
    const c = fileCache.get(f);
    if (c && c.mt === mt) return c.info;
    let info;
    try {
      const t = loadThematique(f);
      info = { file: f, titre: t.titre, emoji: t.emoji, description: t.description, ok: true, nbThemes: new Set([...t.axisA, ...t.axisB]).size, nbReponses: t.all.length };
    } catch (e) { info = { file: f, titre: f, ok: false, error: e.message }; }
    fileCache.set(f, { mt, info });
    return info;
  });
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

// sauvegarde des réglages par code de salon (fichier sauvegarde.json)
let savedRooms = {};
try {
  const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  savedRooms = d && d.rooms && typeof d.rooms === 'object' ? d.rooms : {};
} catch { }
let saveTimer = null;
function saveRoom(code, data) {
  savedRooms[code] = { ...data, t: Date.now() };
  // on ne garde que les 100 salons les plus récents
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(100)) delete savedRooms[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: savedRooms }, null, 1), () => { }), 300);
}
// ================================================================ salons
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante.
function createRoom(code, saved) {
  // ---------------------------------------------------------------- état du jeu
  let thematique = null;
  const state = {
      phase: 'setup',            // setup | playing | over
      mode: 'classique',
      nbJoueurs: 2,
      singleScreen: false,       // Classique / Renversé joués entièrement sur la page maître
      freeEmpty: true,           // Thématique : une case sans aucune réponse possible = pion posé librement
      randomFlip: false,         // Renversé aléatoire : la colonne tourne 3 fois, 1 chance sur 2 d'être renversée
      wrongRule: 'give',         // Thématique, mauvaise réponse : pass | give | steal
      gameId: 0,
      roster: [],                // joueurs habituels mémorisés { name, color }
      excluded: [],              // réponses exclues par l'arbitre { key, nom }
      seats: Array(MAX_PLAYERS).fill(null), // { name, color, ai }
      themeFile: null, themeError: null, grid: null,
      board: emptyBoard(), current: 0, starter: 0,
      turnPhase: null,           // flip | anim | drop | answer
      pending: null,             // { row, col, rowTheme, colTheme, answer, steal, from }
      used: [], winner: null, winCells: [], draw: false,
      lastMove: null, anim: null, flash: null, log: [], seq: 0,
    };
  const nbActive = () => (state.mode === 'classique' ? 2 : state.nbJoueurs);
  const isSingle = () => state.singleScreen && state.mode !== 'thematique';
  const blockedKeys = () => new Set([...state.used.map(u => u.key), ...state.excluded.map(x => x.key)]);

  // ---------------------------------------------------------------- sauvegarde (réglages et joueurs habituels du salon)
  function settings() {
    return { roster: state.roster, mode: state.mode, nbJoueurs: state.nbJoueurs, singleScreen: state.singleScreen, freeEmpty: state.freeEmpty, randomFlip: state.randomFlip, wrongRule: state.wrongRule, themeFile: state.themeFile };
  }
  function save() { saveRoom(code, settings()); }
  function remember(name, color) {
    state.roster = [{ name, color }, ...state.roster.filter(r => norm(r.name) !== norm(name))].slice(0, 30);
  }
  const pname = i => state.seats[i]?.name || `Joueur ${i + 1}`;
  function log(text) { state.log.unshift({ t: Date.now(), text }); state.log.length = Math.min(state.log.length, 40); }
  function flash(text, kind = 'info') { state.flash = { id: ++state.seq, text, kind }; }

  function landing(col) { for (let r = ROWS - 1; r >= 0; r--) if (state.board[r][col] === null) return r; return -1; }
  function columnStack(col) { return state.board.map(r => r[col]).filter(v => v !== null); }
  function flippableCols() {
    const out = [];
    for (let c = 0; c < COLS; c++) {
      const s = columnStack(c);
      if (s.length >= 2 && s.some((v, i) => v !== s[s.length - 1 - i])) out.push(c);
    }
    return out;
  }
  function winCells(b, p) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], set = new Set();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (b[r][c] !== p) continue;
      for (const [dr, dc] of dirs) {
        const cells = [];
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr][cc] !== p) break;
          cells.push(rr + ',' + cc);
        }
        if (cells.length === 4) cells.forEach(x => set.add(x));
      }
    }
    return [...set].map(s => s.split(',').map(Number));
  }
  function startPhase() { return state.mode === 'renverse' && flippableCols().length ? 'flip' : 'drop'; }
  function nextTurn() {
    state.current = (state.current + 1) % nbActive();
    state.pending = null;
    state.turnPhase = startPhase();
  }
  function endGame(winner, cells, why) {
    state.phase = 'over'; state.turnPhase = null; state.pending = null;
    state.winner = winner; state.winCells = cells; state.draw = winner === null;
    const msg = winner === null ? 'Match nul : la grille est pleine.' : `${pname(winner)} aligne 4 pions${why ? ' ' + why : ''} !`;
    log(msg); flash(msg, 'win');
  }
  // keepTurn : le joueur garde la main après la pose (vol de case réussi)
  function place(row, col, keepTurn) {
    state.board[row][col] = state.current;
    state.lastMove = { row, col, id: ++state.seq };
    const w = winCells(state.board, state.current);
    if (w.length) return endGame(state.current, w);
    if (state.board[0].every(v => v !== null)) return endGame(null, []);
    if (keepTurn) { state.pending = null; state.turnPhase = startPhase(); return; }
    nextTurn();
  }
  function flip(col) {
    const before = state.board.map(r => r[col]);
    const stack = before.filter(v => v !== null), k = stack.length, rev = [...stack].reverse();
    const random = state.randomFlip, flipped = !random || Math.random() < 0.5;
    if (flipped) for (let r = 0; r < ROWS; r++) state.board[r][col] = r < ROWS - k ? null : rev[r - (ROWS - k)];
    const id = ++state.seq, dur = random ? SPIN_MS : FLIP_MS, L = 'ABCDEFG'[col];
    state.anim = { id, col, before, k, start: Date.now(), random, flipped, dur };
    state.turnPhase = 'anim';
    if (!random) log(`${pname(state.current)} renverse la colonne ${L}`);
    setTimeout(() => {
      if (!state.anim || state.anim.id !== id) return;
      state.anim = null;
      if (random) {
        const msg = flipped ? `La colonne ${L} de ${pname(state.current)} se renverse !` : `La colonne ${L} de ${pname(state.current)} retombe à l'endroit.`;
        log(msg); flash(msg, flipped ? 'ok' : 'info');
      }
      const n = nbActive();
      for (let i = 0; i < n; i++) {        // le joueur actif est prioritaire en cas d'alignements multiples
        const p = (state.current + i) % n, w = winCells(state.board, p);
        if (w.length) { endGame(p, w, p === state.current ? 'grâce au renversement' : 'après le renversement de ' + pname(state.current)); return broadcast(); }
      }
      state.turnPhase = 'drop';
      broadcast();
    }, dur);
  }
  function available(row, col) {
    if (!thematique || !state.grid) return { cands: [], cited: [] };
    const all = cellAnswers(row, col);
    const usedKeys = blockedKeys();
    return { cands: all.filter(a => !usedKeys.has(a.key)), cited: all.filter(a => usedKeys.has(a.key)) };
  }
  function newGame(rematch) {
    const n = nbActive();
    if (state.mode === 'thematique' && (rematch || !state.grid)) state.grid = drawGrid(thematique);
    Object.assign(state, {
      phase: 'playing', board: emptyBoard(), used: [], excluded: [], winner: null, winCells: [], draw: false,
      lastMove: null, anim: null, pending: null, log: [],
      starter: rematch ? (state.starter + 1) % n : 0,
    });
    state.current = state.starter;
    state.gameId++;
    state.turnPhase = startPhase();
    log(`Nouvelle partie — ${pname(state.current)} commence`);
    flash(`C'est parti ! ${pname(state.current)} commence.`);
  }
  function setThemeFile(file) {
    state.themeFile = file || null; state.themeError = null; thematique = null; state.grid = null;
    if (!file) return;
    try { thematique = loadThematique(file); state.grid = drawGrid(thematique); }
    catch (e) { state.themeError = e.message; }
  }

  // Mauvaise réponse en Thématique, selon la règle choisie
  function wrongAnswer(what) {
    const p = state.pending, cur = state.current, n = nbActive(), next = (cur + 1) % n;
    const L = cellLabel(p.row, p.col);
    log(`✘ ${pname(cur)} : ${what} refusée`);
    if (p.steal) {                                   // le voleur s'est trompé : il joue quand même son tour
      flash(`${what} refusée — personne ne prend la case ${L}, ${pname(cur)} joue son tour`, 'bad');
      state.pending = null; state.turnPhase = startPhase();
      return;
    }
    if (state.wrongRule === 'give' && n === 2) {     // l'adversaire prend la case, puis joue son tour
      state.board[p.row][p.col] = next;
      state.lastMove = { row: p.row, col: p.col, id: ++state.seq };
      log(`${pname(next)} prend la case ${L}`);
      flash(`${what} refusée — ${pname(next)} prend la case ${L} !`, 'bad');
      const w = winCells(state.board, next);
      if (w.length) { state.current = next; return endGame(next, w, 'grâce à la case offerte'); }
      if (state.board[0].every(v => v !== null)) return endGame(null, []);
      state.current = next; state.pending = null; state.turnPhase = startPhase();
      return;
    }
    if (state.wrongRule === 'steal') {               // le joueur suivant peut répondre pour la même case
      state.pending = { ...p, answer: null, steal: true, from: cur };
      state.current = next;
      log(`${pname(next)} peut voler la case ${L}`);
      flash(`${what} refusée — ${pname(next)} peut voler la case ${L} !`, 'bad');
      return;
    }
    flash(`${what} refusée — ${pname(cur)} passe son tour`, 'bad');
    nextTurn();
  }

  function excludeAnswer(key, nom) {
    if (blockedKeys().has(key)) return;
    const hit = thematique && thematique.all.find(x => x.key === key);
    state.excluded.push({ key, nom: hit ? hit.nom : nom });
    log(`⊘ « ${hit ? hit.nom : nom} » exclue pour le reste de la partie`);
  }

  // ---------------------------------------------------------------- actions
  function handle(who, a) {
    const isAI = who === 'ai', isMaster = who === 'master' || isAI;
    const mySeat = /^p[1-6]$/.test(who) ? +who.slice(1) - 1 : null;
    const need = (cond, msg) => { if (!cond) throw new Error(msg); };
    const playing = () => need(state.phase === 'playing', "La partie n'est pas en cours");
    const myTurn = () => {
      playing(); need(isMaster || mySeat === state.current, "Ce n'est pas ton tour");
      need(isAI || !state.seats[state.current]?.ai, "C'est au tour de l'IA");
    };
    const masterOnly = () => need(isMaster, "Action réservée à l'arbitre");

    switch (a.type) {
      // --- configuration
      case 'config': {
        masterOnly(); need(state.phase === 'setup', 'Configuration impossible pendant une partie');
        if (MODES.includes(a.mode)) state.mode = a.mode;
        if (a.nbJoueurs) state.nbJoueurs = Math.max(2, Math.min(MAX_PLAYERS, a.nbJoueurs | 0));
        if ('singleScreen' in a) state.singleScreen = !!a.singleScreen;
        if ('freeEmpty' in a) state.freeEmpty = !!a.freeEmpty;
        if ('randomFlip' in a) state.randomFlip = !!a.randomFlip;
        if (['pass', 'give', 'steal'].includes(a.wrongRule)) state.wrongRule = a.wrongRule;
        if ('themeFile' in a) setThemeFile(a.themeFile);
        if (state.mode === 'thematique' && !state.themeFile) {
          const first = listThemeFiles().find(f => f.ok);
          if (first) setThemeFile(first.file);
        }
        save(); break;
      }
      case 'redraw': {
        masterOnly(); need(state.phase === 'setup' && thematique, 'Aucune thématique chargée');
        state.grid = drawGrid(thematique); break;
      }
      case 'register': {
        const seat = isMaster ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0 && seat < MAX_PLAYERS, 'Siège invalide');
        need(state.phase === 'setup', 'Les inscriptions sont fermées pendant la partie');
        need(isMaster || !state.seats[seat]?.ai, "Ce siège est joué par l'IA : l'arbitre doit d'abord le libérer");
        const name = String(a.name || '').trim().slice(0, 20);
        need(name, 'Indique un nom');
        need(COLORS.some(c => c.id === a.color), 'Choisis une couleur');
        const taken = state.seats.findIndex((s, i) => i !== seat && i < nbActive() && s && s.color === a.color);
        need(taken < 0, `Couleur déjà prise par ${pname(taken)}`);
        const ai = isMaster && !!a.ai;
        state.seats[seat] = { name, color: a.color, ai };
        save();
        break;
      }
      case 'unregister': {
        const seat = isMaster ? a.seat | 0 : mySeat;
        need(seat !== null, 'Siège invalide');
        need(state.phase === 'setup', 'Impossible pendant la partie');
        need(isMaster || !state.seats[seat]?.ai, "Ce siège est joué par l'IA");
        state.seats[seat] = null; save(); break;
      }
      case 'start': {
        masterOnly(); need(state.phase === 'setup', 'Partie déjà lancée');
        const n = nbActive();
        for (let i = 0; i < n; i++) need(state.seats[i], `Le joueur ${i + 1} n'est pas inscrit`);
        const cols = state.seats.slice(0, n).map(s => s.color);
        need(new Set(cols).size === n, 'Deux joueurs ont la même couleur');
        if (state.mode === 'thematique') {
          need(state.themeFile, 'Choisis une thématique');
          try { thematique = loadThematique(state.themeFile); } catch (e) { throw new Error('Thématique invalide : ' + e.message); }
        }
        // les joueurs humains qui démarrent une partie rejoignent les « joueurs habituels »
        for (let i = n - 1; i >= 0; i--) if (!state.seats[i].ai) remember(state.seats[i].name, state.seats[i].color);
        newGame(false); save(); break;
      }
      case 'clearSeats': {
        masterOnly(); need(state.phase === 'setup', 'Impossible pendant la partie');
        state.seats = Array(MAX_PLAYERS).fill(null); save(); break;
      }
      case 'clearRoster': { masterOnly(); state.roster = []; save(); break; }
      case 'forget': {
        masterOnly();
        state.roster = state.roster.filter(r => norm(r.name) !== norm(a.name || ''));
        save(); break;
      }
      case 'rematch': { masterOnly(); need(state.phase !== 'setup', 'Aucune partie'); newGame(true); break; }
      case 'reset': {
        masterOnly();
        state.gameId++;
        Object.assign(state, { phase: 'setup', turnPhase: null, pending: null, anim: null, winner: null, winCells: [], draw: false, lastMove: null, board: emptyBoard(), used: [], excluded: [] });
        if (thematique) state.grid = drawGrid(thematique);
        break;
      }
      // --- tour de jeu
      case 'flip': {
        myTurn(); need(state.turnPhase === 'flip', 'Le renversement se choisit en début de tour');
        need(flippableCols().includes(a.col), 'Cette colonne ne peut pas être renversée');
        flip(a.col); break;
      }
      case 'noflip': { myTurn(); need(state.turnPhase === 'flip', 'Rien à passer'); state.turnPhase = 'drop'; break; }
      case 'drop': {
        myTurn();
        const col = a.col | 0;
        need(col >= 0 && col < COLS, 'Colonne invalide');
        const changing = state.turnPhase === 'answer' && state.pending && !state.pending.answer && !state.pending.steal;
        need(state.turnPhase === 'drop' || changing, "Ce n'est pas le moment de jouer un pion");
        const row = landing(col);
        need(row >= 0, 'Colonne pleine');
        if (state.mode === 'thematique' && state.freeEmpty && state.grid.empty[row][col]) {
          log(`${pname(state.current)} prend la case libre ${cellLabel(row, col)} (${state.grid.rows[row]} × ${state.grid.cols[col]})`);
          flash(`Case libre : ${pname(state.current)} pose son pion sans répondre`);
          place(row, col);
        } else if (state.mode === 'thematique') {
          state.pending = { row, col, rowTheme: state.grid.rows[row], colTheme: state.grid.cols[col], answer: null };
          state.turnPhase = 'answer';
          log(`${pname(state.current)} vise la case ${cellLabel(row, col)} (${state.pending.rowTheme} × ${state.pending.colTheme})`);
        } else place(row, col);
        break;
      }
      case 'answer': {
        myTurn(); need(state.turnPhase === 'answer' && state.pending, 'Aucune case choisie');
        const txt = String(a.text || '').trim().slice(0, 60);
        need(txt, 'Réponse vide');
        state.pending.answer = txt;
        log(`${pname(state.current)} propose « ${txt} »`);
        break;
      }
      case 'cancel': {
        myTurn(); need(state.turnPhase === 'answer' && state.pending, 'Rien à annuler');
        need(isMaster || !state.pending.answer, "Réponse déjà envoyée : l'arbitre doit trancher");
        need(!state.pending.steal, 'Pendant un vol, la case ne peut pas être changée');
        state.pending = null; state.turnPhase = 'drop'; break;
      }
      case 'declineSteal': {
        myTurn(); need(state.turnPhase === 'answer' && state.pending && state.pending.steal && !state.pending.answer, 'Aucun vol en cours');
        log(`${pname(state.current)} renonce au vol et joue son tour`);
        state.pending = null; state.turnPhase = startPhase(); break;
      }
      // --- arbitrage (thématique)
      case 'validate':
      case 'accept': {
        masterOnly(); playing(); need(state.turnPhase === 'answer' && state.pending, 'Aucune réponse en attente');
        const { row, col, rowTheme, colTheme } = state.pending;
        let nom, key;
        if (a.type === 'validate') {
          const hit = available(row, col).cands.find(x => x.key === a.key);
          need(hit, 'Réponse indisponible (déjà citée ?)');
          ({ nom, key } = hit);
        } else {
          nom = String(a.text || state.pending.answer || '').trim();
          need(nom, 'Aucune réponse à accepter');
          key = norm(nom);
        }
        need(!state.used.some(u => u.key === key), `« ${nom} » a déjà été citée`);
        need(!state.excluded.some(x => x.key === key), `« ${nom} » a été exclue par l'arbitre`);
        state.used.push({ nom, key, player: state.current, row, col, rowTheme, colTheme });
        log(`✔ ${pname(state.current)} : « ${nom} » validée en ${cellLabel(row, col)}`);
        const stole = !!state.pending.steal;
        flash(stole ? `Case volée par ${pname(state.current)} avec « ${nom} » ! À lui de jouer son tour.` : `« ${nom} » validée pour ${pname(state.current)}`, 'ok');
        place(row, col, stole);
        break;
      }
      case 'reject': {
        masterOnly(); playing(); need(state.turnPhase === 'answer' && state.pending, 'Aucune réponse en attente');
        const what = state.pending.answer ? `« ${state.pending.answer} »` : 'Pas de réponse';
        if (a.exclude && state.pending.answer) excludeAnswer(norm(state.pending.answer), state.pending.answer);
        wrongAnswer(what); break;
      }
      // --- exclusion de réponses (thématique)
      case 'exclude': {
        masterOnly(); playing(); need(thematique, 'Aucune thématique');
        let key = a.key, nom;
        if (key) { const hit = thematique.all.find(x => x.key === key); nom = hit ? hit.nom : a.text || key; }
        else { nom = String(a.text || '').trim(); key = norm(nom); }
        need(nom, 'Réponse vide');
        need(!blockedKeys().has(key), `« ${nom} » est déjà citée ou exclue`);
        excludeAnswer(key, nom);
        break;
      }
      case 'unexclude': {
        masterOnly(); playing();
        const x = state.excluded.find(e => e.key === a.key);
        need(x, 'Réponse non exclue');
        state.excluded = state.excluded.filter(e => e.key !== a.key);
        log(`↺ « ${x.nom} » est de nouveau disponible`);
        break;
      }
      case 'skip': {
        masterOnly(); playing(); need(state.turnPhase !== 'anim', 'Attends la fin du renversement');
        log(`${pname(state.current)} passe son tour`); nextTurn(); break;
      }
      default: throw new Error('Action inconnue');
    }
  }

  function cellAnswers(row, col) {
    const g = state.grid, r = g.rows[row], c = g.cols[col];
    return g.swap ? thematique.cell(c, r) : thematique.cell(r, c);
  }

  // ---------------------------------------------------------------- vues & diffusion
  const clients = new Set();
  const online = i => [...clients].some(c => c.who === 'p' + (i + 1));
  function view(who) {
    const s = state, isMaster = who === 'master';
    touch();
    const v = {
      room: code, you: who, phase: s.phase, mode: s.mode, nbJoueurs: s.nbJoueurs, nbActive: nbActive(),
      singleScreen: isSingle(), wrongRule: s.wrongRule, roster: s.roster, excluded: s.excluded.map(x => ({ key: x.key, nom: x.nom })),
      rows: ROWS, cols: COLS, colors: COLORS,
      seats: s.seats.map((x, i) => ({ name: x?.name || null, color: x?.color || null, ai: !!x?.ai, online: online(i) })), randomFlip: s.randomFlip,
      themeFile: s.themeFile, themeTitle: thematique?.titre || null, themeError: s.themeError,
      grid: s.grid ? { rows: s.grid.rows, cols: s.grid.cols, empty: s.grid.empty } : null, freeEmpty: s.freeEmpty,
      themeMeta: thematique ? thematique.meta : {}, themeDescription: thematique ? thematique.description : '',
      board: s.board, current: s.current, turnPhase: s.turnPhase,
      flippable: s.turnPhase === 'flip' ? flippableCols() : [],
      pending: s.pending ? { ...s.pending } : null,
      used: s.used.map(u => ({ key: u.key, nom: u.nom, player: u.player, cell: cellLabel(u.row, u.col), rowTheme: u.rowTheme, colTheme: u.colTheme })),
      winner: s.winner, winCells: s.winCells, draw: s.draw, lastMove: s.lastMove,
      anim: s.anim ? { id: s.anim.id, col: s.anim.col, before: s.anim.before, k: s.anim.k, random: s.anim.random, flipped: s.anim.flipped, dur: s.anim.dur, elapsed: Date.now() - s.anim.start } : null,
      flash: s.flash, log: s.log.slice(0, 20),
    };
    if (isMaster) {
      v.themeFiles = listThemeFiles();
      v.lanUrls = lanUrls();
      if (thematique && s.mode === 'thematique' && s.phase !== 'setup') v.allAnswers = thematique.all;
      if (s.grid && thematique) {
        v.grid.filled = s.grid.filled;
        v.grid.counts = s.grid.rows.map((_, r) => s.grid.cols.map((_, c) => available(r, c).cands.length));
      }
      if (s.pending && thematique) {
        const { cands, cited } = available(s.pending.row, s.pending.col);
        v.pending.cands = cands; v.pending.cited = cited.map(x => x.nom);
        if (s.pending.answer) {
          const k = norm(s.pending.answer);
          v.pending.match = cands.find(x => x.key === k) ? { status: 'ok', key: k }
            : s.used.some(u => u.key === k) ? { status: 'used' } : { status: 'unknown' };
        }
      }
    }
    return v;
  }
  function send(c) { c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`); }
  function broadcast() { for (const c of clients) send(c); scheduleAI(); }

  // ---------------------------------------------------------------- joueurs IA
  let aiTimer = null, aiKey = null;
  function aiAct(type, data = {}) {
    try { handle('ai', { type, ...data }); } catch (e) { console.log('IA :', e.message); }
    broadcast();
  }
  function scheduleAI() {
    const s = state;
    const answering = s.turnPhase === 'answer' && s.pending && !s.pending.answer;
    if (s.phase !== 'playing' || !s.seats[s.current]?.ai || !(['flip', 'drop'].includes(s.turnPhase) || answering)) return;
    const key = `${s.gameId}:${s.seq}:${s.current}:${s.turnPhase}`;
    if (aiKey === key) return;              // déjà programmé pour cette situation
    aiKey = key; clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      if (aiKey !== key || `${s.gameId}:${s.seq}:${s.current}:${s.turnPhase}` !== key) return;
      aiTurn();
    }, 700 + Math.random() * 600);
  }
  function aiTurn() {
    const s = state, me = s.current, n = nbActive();
    if (s.turnPhase === 'answer') return aiAnswer();
    if (s.turnPhase === 'flip') {
      const c = AI.chooseFlip(s.board, me, n, flippableCols(), s.randomFlip);
      return c >= 0 ? aiAct('flip', { col: c }) : aiAct('noflip');
    }
    let allowed = null;
    if (s.mode === 'thematique') {
      allowed = [];
      for (let c = 0; c < COLS; c++) {
        const r = landing(c);
        if (r < 0) continue;
        if ((s.freeEmpty && s.grid.empty[r][c]) || available(r, c).cands.length) allowed.push(c);
      }
      if (!allowed.length) allowed = null;   // plus aucune case avec réponse : l'IA tente sa chance n'importe où
    }
    const col = AI.chooseDrop(s.board, me, n, allowed);
    if (col < 0) { nextTurn(); return broadcast(); }
    aiAct('drop', { col });
  }
  // Thématique : l'IA « répond » (juste 8 fois sur 10), puis la réponse est jugée automatiquement
  function aiAnswer() {
    const s = state, me = s.current, gid = s.gameId, { row, col } = s.pending;
    const { cands } = available(row, col);
    let text;
    if (cands.length && Math.random() < 0.8) text = cands[(Math.random() * cands.length) | 0].nom;
    else {
      const blocked = blockedKeys(), good = new Set(cands.map(x => x.key));
      const wrong = thematique.all.filter(x => !good.has(x.key) && !blocked.has(x.key));
      text = wrong.length ? wrong[(Math.random() * wrong.length) | 0].nom : '…';
    }
    aiAct('answer', { text });
    setTimeout(() => {
      if (s.gameId !== gid || s.current !== me || s.turnPhase !== 'answer' || !s.pending || !s.pending.answer) return;
      const k = norm(s.pending.answer);
      if (available(row, col).cands.some(x => x.key === k)) aiAct('validate', { key: k });
      else aiAct('reject');
    }, 1800);
  }

  // reprise des réglages enregistrés pour ce code (les sièges repartent vides)
  if (saved) {
    const d = saved;
    if (Array.isArray(d.roster)) state.roster = d.roster.filter(r => r && r.name).slice(0, 30);
    if (MODES.includes(d.mode)) state.mode = d.mode;
    if (d.nbJoueurs) state.nbJoueurs = Math.max(2, Math.min(MAX_PLAYERS, d.nbJoueurs | 0));
    state.singleScreen = !!d.singleScreen;
    if ('freeEmpty' in d) state.freeEmpty = !!d.freeEmpty;
    state.randomFlip = !!d.randomFlip;
    if (['pass', 'give', 'steal'].includes(d.wrongRule)) state.wrongRule = d.wrongRule;
    if (d.themeFile && fs.existsSync(path.join(THEMES_DIR, path.basename(d.themeFile)))) setThemeFile(d.themeFile);
  }
  let lastActivity = Date.now();
  function touch() { lastActivity = Date.now(); }

  // connexion temps réel d'une page de ce salon
  function addClient(res, who, req) {
    const presence = () => state.seats.map((_, i) => online(i)).join();
    const before = presence();
    const c = { res, who };
    clients.add(c); touch();
    // on ne prévient tout le monde que si la présence d'un joueur change ; sinon seul le nouveau venu reçoit l'état
    if (presence() !== before) broadcast(); else send(c);
    req.on('close', () => {
      const b = presence();
      clients.delete(c); touch();
      if (presence() !== b) broadcast();
    });
  }
  function act(who, a) { touch(); handle(who, a); broadcast(); }
  function destroy() { clearTimeout(aiTimer); state.anim = null; state.gameId++; }
  function info() {
    return { code, phase: state.phase, mode: state.mode, nbActive: nbActive(), singleScreen: isSingle(),
      seats: state.seats.slice(0, nbActive()).map((x, i) => ({ name: x?.name || null, ai: !!x?.ai, online: online(i) })) };
  }
  return { code, clients, addClient, act, destroy, info, idle: () => Date.now() - lastActivity };

}
// ================================================================ registre des salons
const rooms = new Map();                     // code → salon
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'EVENTS', 'JOUEUR', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'FAVICON']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';      // sans 0/O, 1/I/L pour éviter les confusions
const ROOM_IDLE_MS = 6 * 3600 * 1000;        // un salon sans page ouverte depuis 6 h est supprimé
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
  for (const [code, r] of rooms)
    if (r.clients.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000);
// un salon connu du fichier de sauvegarde est recréé à la demande (utile en local après un redémarrage)
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code, savedRooms[code] || null);
  rooms.set(code, r);
  if (!savedRooms[code]) saveRoom(code, {});
  return r;
}
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 15000);

// ================================================================ HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => { let a = {}; try { a = JSON.parse(body || '{}'); } catch { } cb(a); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if (req.method === 'GET') {
    if (p === '/') return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.startsWith('/static/')) {
      const f = path.normalize(path.join(PUBLIC, p.slice(8)));
      if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      return sendFile(res, f);
    }
    // anciennes adresses sans salon → accueil
    if (/^\/(joueur[1-6]|maitre|arbitre)\/?$/i.test(p)) { res.writeHead(302, { Location: '/' }); return res.end(); }
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
      // en-têtes adaptés aux hébergeurs derrière un proxy (Render…) : pas de mise en tampon ni de compression
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
      return r.addClient(res, who, req);
    }
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([1-6])\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'joueur.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'maitre.html'));
  }
  if (req.method === 'POST' && p === '/api/rooms') {
    return readBody(req, a => {
      let code = a.code ? cleanCode(a.code) : newCode();
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
      try { r.act(a.who, a); json(res, { ok: true }); }
      catch (e) { json(res, { ok: false, error: e.message }); }
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Puis-thème 4 est lancé !`);
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
