// Adversaire IA de Space-Battle-SLG — 3 niveaux : debutant, avance, expert.
// L'IA ne voit que des informations publiques : les tirs déjà faits (raté / touché)
// et les vaisseaux adverses déjà détruits. Elle ne lit jamais la flotte adverse.
'use strict';
const Fleet = require('./public/fleet.js');
const N = 10;
const LEVELS = ['debutant', 'avance', 'expert'];
const LEVEL_NAMES = { debutant: 'Débutant', avance: 'Avancé', expert: 'Expert' };
const rnd = n => (Math.random() * n) | 0;
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

// ------------------------------------------------------------ placement de la flotte
// ids : vaisseaux à placer ; retourne [{id, rot, r, c}]. Les vaisseaux ne se touchent jamais (règle du jeu).
function placeFleet(level, ids) {
  const out = Fleet.randomPlacement(ids, 800);
  if (!out) throw new Error('placement IA impossible');
  return out;
}

// ------------------------------------------------------------ choix des tirs
// k : { shots[100] (0 libre · 1 raté · 2 touché), sunk: [{cells}], remaining: [ids des vaisseaux encore à flot] }
// Règle « pas de contact » : toutes les cases voisines d'un vaisseau coulé sont forcément vides (inutile d'y tirer).
function unresolved(k) {
  const sunk = new Set(k.sunk.flatMap(s => s.cells));
  const out = [];
  k.shots.forEach((v, i) => { if (v === 2 && !sunk.has(i)) out.push(i); });
  return out;
}
const freeCells = k => { const f = []; k.shots.forEach((v, i) => { if (v === 0) f.push(i); }); return f; };
const deadZone = k => Fleet.halo(k.sunk.flatMap(s => s.cells));          // cases d'un vaisseau coulé + leurs voisines
const liveCells = k => { const d = deadZone(k); return freeCells(k).filter(i => !d.has(i)); };
const SHAPES = {};                                                          // rotations distinctes de chaque vaisseau
function rotations(id) {
  if (!SHAPES[id]) {
    const seen = new Map();
    for (let rot = 0; rot < 4; rot++) { const sh = Fleet.shape(id, rot); seen.set(sh.join('|'), { rot, ...Fleet.size(sh) }); }
    SHAPES[id] = [...seen.values()];
  }
  return SHAPES[id];
}

function pickTop(order, k, n) {
  const out = [];
  for (const i of order) if (k.shots[i] === 0 && !out.includes(i)) { out.push(i); if (out.length === n) break; }
  return out;
}

// Débutant : tire presque toujours au hasard ; une fois sur trois, il pense à viser à côté d'un touché
function debutant(k, n) {
  const hits = unresolved(k), out = [];
  const free = shuffle(freeCells(k));
  for (let s = 0; s < n; s++) {
    let pick = -1;
    if (hits.length && Math.random() < 0.33) {
      const h = hits[rnd(hits.length)], r = (h / N) | 0, c = h % N;
      const opts = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dr, dc]) => inb(r + dr, c + dc))
        .map(([dr, dc]) => (r + dr) * N + c + dc).filter(i => k.shots[i] === 0 && !out.includes(i));
      if (opts.length) pick = opts[rnd(opts.length)];
    }
    if (pick < 0) pick = free.find(i => !out.includes(i));
    if (pick === undefined || pick < 0) break;
    out.push(pick);
  }
  return out;
}

// Avancé : "chasse / poursuite" — après un touché il explore autour et prolonge les alignements ;
// sinon il tire en damier (un vaisseau fait au moins 2 cases)
function avance(k, n) {
  const hits = unresolved(k), hitSet = new Set(hits);
  const ends = new Set(), nbrs = new Set();
  for (const h of hits) {
    const r = (h / N) | 0, c = h % N;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (inb(r + dr, c + dc) && k.shots[(r + dr) * N + c + dc] === 0) nbrs.add((r + dr) * N + c + dc);
    }
    // alignement de plusieurs touchés : on prolonge aux deux bouts
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      if (!hitSet.has((r + dr) * N + c + dc) || !inb(r + dr, c + dc)) continue;
      let rr = r, cc = c;
      while (inb(rr - dr, cc - dc) && hitSet.has((rr - dr) * N + cc - dc)) { rr -= dr; cc -= dc; }
      let r2 = r, c2 = c;
      while (inb(r2 + dr, c2 + dc) && hitSet.has((r2 + dr) * N + c2 + dc)) { r2 += dr; c2 += dc; }
      for (const [er, ec] of [[rr - dr, cc - dc], [r2 + dr, c2 + dc]])
        if (inb(er, ec) && k.shots[er * N + ec] === 0) ends.add(er * N + ec);
    }
  }
  const dead = deadZone(k);
  for (const set of [ends, nbrs]) for (const i of [...set]) if (dead.has(i)) set.delete(i);
  const free = shuffle(liveCells(k));
  const parity = free.filter(i => (((i / N) | 0) + i % N) % 2 === 0);
  return pickTop([...shuffle([...ends]), ...shuffle([...nbrs]), ...parity, ...free], k, n);
}

// Expert : carte de probabilité — pour chaque vaisseau encore à flot (forme et rotations comprises), il compte toutes
// les positions compatibles avec les tirs connus ; celles qui recouvrent un touché non résolu pèsent très lourd.
function density(k) {
  const dead = deadZone(k);
  const hits = new Set(unresolved(k));
  const w = new Float64Array(N * N);
  for (const id of k.remaining) {
    for (const { rot, h, w: bw } of rotations(id)) {
      for (let r = 0; r <= N - h; r++) for (let c = 0; c <= N - bw; c++) {
        const cells = Fleet.place(id, rot, r, c);
        if (!cells || cells.some(i => k.shots[i] === 1 || dead.has(i))) continue;
        const cover = cells.filter(i => hits.has(i)).length;
        const weight = cover ? 1 + 40 * cover * cover : 1;
        for (const i of cells) if (k.shots[i] === 0) w[i] += weight;
      }
    }
  }
  return { w, hunting: hits.size === 0 };
}
function expert(k, n) {
  const { w, hunting } = density(k);
  const out = [];
  for (let s = 0; s < n; s++) {
    let best = -1, bv = -1;
    for (let i = 0; i < N * N; i++) {
      if (k.shots[i] !== 0 || out.includes(i)) continue;
      const v = w[i] * (1 + Math.random() * 0.02);        // départage les égalités au hasard
      if (v > bv) { bv = v; best = i; }
    }
    if (best < 0) break;
    out.push(best);
    if (hunting) {   // salve à l'aveugle : on évite de gaspiller deux tirs côte à côte
      const r = (best / N) | 0, c = best % N;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (inb(r + dr, c + dc)) w[(r + dr) * N + c + dc] *= 0.55;
    }
  }
  return out;
}

function chooseShots(level, k, n) {
  const f = level === 'expert' ? expert : level === 'avance' ? avance : debutant;
  const picks = f(k, n);
  if (picks.length < n) for (const i of shuffle(freeCells(k))) { if (!picks.includes(i)) picks.push(i); if (picks.length === n) break; }
  return picks;
}

module.exports = { LEVELS, LEVEL_NAMES, placeFleet, chooseShots };
