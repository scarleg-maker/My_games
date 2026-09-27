// Puis-thème 4 — IA des joueurs automatiques
// Recherche minimax « paranoïaque » (tous les adversaires jouent contre l'IA) avec élagage alpha-bêta,
// évaluation par fenêtres de 4 cases, préférence pour le centre et un peu de hasard pour varier les parties.
const ROWS = 6, COLS = 7;
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1e6;

// toutes les fenêtres de 4 cases alignées
const WINDOWS = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const w = [];
    for (let k = 0; k < 4; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
      w.push([rr, cc]);
    }
    if (w.length === 4) WINDOWS.push(w);
  }

const clone = b => b.map(r => r.slice());
function landing(b, c) { for (let r = ROWS - 1; r >= 0; r--) if (b[r][c] === null) return r; return -1; }
function winAt(b, r, c, p) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr][cc] === p) { n++; rr += dr * s; cc += dc * s; }
    }
    if (n >= 4) return true;
  }
  return false;
}
function hasLine(b, p) {
  for (const w of WINDOWS) if (w.every(([r, c]) => b[r][c] === p)) return true;
  return false;
}

const MINE = [0, 1, 6, 40, 1000], THEIRS = [0, 1, 8, 55, 1000];
function evaluate(b, me, n) {
  let s = 0;
  for (const w of WINDOWS) {
    let owner = -1, cnt = 0, mixed = false, lowOpen = 0;
    for (const [r, c] of w) {
      const v = b[r][c];
      if (v === null) { if (r === ROWS - 1 || b[r + 1][c] !== null) lowOpen++; continue; }
      if (owner === -1) owner = v; else if (owner !== v) { mixed = true; break; }
      cnt++;
    }
    if (mixed || cnt === 0) continue;
    // une menace dont la case vide est jouable tout de suite pèse plus lourd
    const bonus = cnt === 3 && lowOpen ? 1.6 : 1;
    if (owner === me) s += MINE[cnt] * bonus;
    else s -= THEIRS[cnt] * bonus * (owner === (me + 1) % n ? 1.2 : 1);
  }
  for (let r = 0; r < ROWS; r++) { if (b[r][3] === me) s += 4; if (b[r][2] === me || b[r][4] === me) s += 1; }
  return s;
}

// minimax paranoïaque : l'IA maximise, chaque adversaire minimise
function minimax(b, depth, p, me, n, alpha, beta) {
  if (depth === 0) return evaluate(b, me, n);
  const moves = ORDER.filter(c => b[0][c] === null);
  if (!moves.length) return 0;
  const next = (p + 1) % n;
  if (p === me) {
    let best = -Infinity;
    for (const c of moves) {
      const r = landing(b, c); b[r][c] = p;
      const v = winAt(b, r, c, p) ? WIN + depth : minimax(b, depth - 1, next, me, n, alpha, beta);
      b[r][c] = null;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const c of moves) {
    const r = landing(b, c); b[r][c] = p;
    const v = winAt(b, r, c, p) ? -WIN - depth : minimax(b, depth - 1, next, me, n, alpha, beta);
    b[r][c] = null;
    if (v < best) best = v;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}
const depthFor = n => (n === 2 ? 5 : 4);

// valeur de chaque colonne jouable pour l'IA
function scoreMoves(board, me, n, allowed, depth = depthFor(n)) {
  const b = clone(board), out = [];
  for (const c of ORDER) {
    if (allowed && !allowed.includes(c)) continue;
    const r = landing(b, c);
    if (r < 0) continue;
    b[r][c] = me;
    const v = winAt(b, r, c, me) ? WIN + depth : minimax(b, depth - 1, (me + 1) % n, me, n, -Infinity, Infinity);
    b[r][c] = null;
    out.push({ c, v });
  }
  return out;
}
function bestValue(board, me, n, depth) {
  const s = scoreMoves(board, me, n, null, depth);
  return s.length ? Math.max(...s.map(x => x.v)) : 0;
}

// choix de la colonne où lâcher le pion (allowed : colonnes autorisées, ex. en Thématique)
function chooseDrop(board, me, n, allowed) {
  const scored = scoreMoves(board, me, n, allowed);
  if (!scored.length) return -1;
  // un peu de hasard entre coups de valeur proche (jamais sur un coup gagnant ou perdant)
  let best = null;
  for (const m of scored) {
    const noisy = Math.abs(m.v) >= WIN / 2 ? m.v : m.v + Math.random() * 6;
    if (!best || noisy > best.n) best = { c: m.c, n: noisy };
  }
  return best.c;
}

// renversement : renvoie la colonne à retourner, ou -1 pour ne rien retourner
// random = true : le renversement n'a lieu qu'une fois sur deux
function flipColumn(board, col) {
  const b = clone(board);
  const stack = b.map(r => r[col]).filter(v => v !== null).reverse();
  const k = stack.length;
  for (let r = 0; r < ROWS; r++) b[r][col] = r < ROWS - k ? null : stack[r - (ROWS - k)];
  return b;
}
function afterFlipValue(b, me, n, depth) {
  if (hasLine(b, me)) return WIN;                        // le joueur actif est prioritaire
  for (let p = 0; p < n; p++) if (p !== me && hasLine(b, p)) return -WIN;
  return bestValue(b, me, n, depth);
}
function chooseFlip(board, me, n, flippable, random) {
  if (!flippable.length) return -1;
  const depth = n === 2 ? 4 : 3;
  const base = bestValue(board, me, n, depth);
  let best = -1, bestV = base + 25;                      // ne renverse que si le gain est net
  for (const c of flippable) {
    const fv = afterFlipValue(flipColumn(board, c), me, n, depth);
    const v = random ? (fv + base) / 2 : fv;
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

module.exports = { chooseDrop, chooseFlip };
