'use strict';

/**
 * Moteur de règles Triple Triad (FF8-like).
 * Plateau: tableau de 9 cases (index 0-8), 3 colonnes x 3 lignes.
 *   0 1 2
 *   3 4 5
 *   6 7 8
 *
 * Une carte posée est un objet:
 *   { instanceId, cardId, top, right, bottom, left, owner, baseTop?, baseRight?, baseBottom?, baseLeft? }
 * owner = 'A' ou 'B'
 * Les champs base* (optionnels) contiennent les valeurs d'origine avant ajustement élémental ; s'ils sont
 * absents, top/right/bottom/left font foi (carte non ajustée).
 *
 * rules = {
 *   same: bool,          // règle "Identique"
 *   plus: bool,          // règle "Plus"
 *   combo: bool,         // les captures Identique/Plus se propagent en chaîne aux cartes adjacentes
 *   suddenDeath: bool,   // rejoue en cas d'égalité
 *   wallAce: bool,       // "Mur en As" : les bords du plateau valent 10 pour Identique/Plus
 *   elemental: bool,     // bonus/malus élémental (n'affecte que la capture basique, jamais Identique/Plus)
 *   open: bool,          // affichage uniquement (les cartes adverses sont visibles ou non) : ignoré par le moteur
 *   random: bool,        // affichage uniquement (main tirée au hasard) : ignoré par le moteur
 * }
 */

// Pour chaque case, les 4 directions sont toujours présentes ; `null` = bord du plateau (pas de voisin réel).
const NEIGHBORS = {
  0: { top: null, right: [1, 'right', 'left'], bottom: [3, 'bottom', 'top'], left: null },
  1: { top: null, right: [2, 'right', 'left'], bottom: [4, 'bottom', 'top'], left: [0, 'left', 'right'] },
  2: { top: null, right: null, bottom: [5, 'bottom', 'top'], left: [1, 'left', 'right'] },
  3: { top: [0, 'top', 'bottom'], right: [4, 'right', 'left'], bottom: [6, 'bottom', 'top'], left: null },
  4: { top: [1, 'top', 'bottom'], right: [5, 'right', 'left'], bottom: [7, 'bottom', 'top'], left: [3, 'left', 'right'] },
  5: { top: [2, 'top', 'bottom'], right: null, bottom: [8, 'bottom', 'top'], left: [4, 'left', 'right'] },
  6: { top: [3, 'top', 'bottom'], right: [7, 'right', 'left'], bottom: null, left: null },
  7: { top: [4, 'top', 'bottom'], right: [8, 'right', 'left'], bottom: null, left: [6, 'left', 'right'] },
  8: { top: [5, 'top', 'bottom'], right: null, bottom: null, left: [7, 'left', 'right'] },
};

const WALL_VALUE = 10; // "As"
const BASE_FIELD = { top: 'baseTop', right: 'baseRight', bottom: 'baseBottom', left: 'baseLeft' };

// Valeur "de base" d'un côté de carte (utilisée pour Identique/Plus) : ignore l'ajustement élémental.
function baseSideValue(card, side) {
  const baseKey = BASE_FIELD[side];
  return card[baseKey] ?? card[side];
}

function createEmptyBoard() {
  return new Array(9).fill(null);
}

function opponentOf(owner) {
  return owner === 'A' ? 'B' : 'A';
}

/**
 * Pose une carte sur le plateau et applique les captures.
 * Retourne { board, flipped: [indices capturés], ruleTriggered: 'basic'|'same'|'plus'|null }
 */
function placeCard(board, cellIndex, card, rules) {
  if (board[cellIndex]) throw new Error('Case déjà occupée');
  const newBoard = board.slice();
  const placed = { ...card };
  newBoard[cellIndex] = placed;

  const neighbors = NEIGHBORS[cellIndex];
  // touching : valeurs EFFECTIVES (post-élémental) -> utilisées pour la capture basique uniquement.
  const touching = [];
  // touchingBase : valeurs DE BASE (pré-élémental) -> utilisées pour Identique et Plus.
  const touchingBase = [];

  for (const dir of Object.keys(neighbors)) {
    const entry = neighbors[dir];
    if (entry) {
      const [idx, placedSide, neighborSide] = entry;
      const neighborCard = newBoard[idx];
      if (!neighborCard) continue;
      const isOpponent = neighborCard.owner !== placed.owner;
      touching.push({
        index: idx,
        placedVal: placed[placedSide],
        neighborVal: neighborCard[neighborSide],
        isOpponent,
      });
      touchingBase.push({
        index: idx,
        placedVal: baseSideValue(placed, placedSide),
        neighborVal: baseSideValue(neighborCard, neighborSide),
        isOpponent,
      });
    } else if (rules.wallAce) {
      // "Mur en As" : le bord du plateau agit comme une carte virtuelle de valeur 10 (As), identique
      // pour les valeurs effectives et de base (le mur n'est jamais affecté par l'élémental).
      touching.push({ index: null, placedVal: placed[dir], neighborVal: WALL_VALUE, isOpponent: false, isWall: true });
      touchingBase.push({ index: null, placedVal: baseSideValue(placed, dir), neighborVal: WALL_VALUE, isOpponent: false, isWall: true });
    }
  }

  let flipped = [];
  let ruleTriggered = null;

  // --- Règle Identique (sur les valeurs de base, non affectées par l'élémental) ---
  if (rules.same) {
    const matches = touchingBase.filter(t => t.placedVal === t.neighborVal);
    const opponentMatches = matches.filter(t => t.isOpponent);
    if (matches.length >= 2 && opponentMatches.length >= 1) {
      ruleTriggered = 'same';
      flipped.push(...opponentMatches.map(m => m.index));
    }
  }

  // --- Règle Plus (sur les valeurs de base, non affectées par l'élémental) ---
  if (rules.plus && ruleTriggered !== 'same') {
    const sums = touchingBase.map(t => ({ index: t.index, sum: t.placedVal + t.neighborVal, isOpponent: t.isOpponent }));
    const sumGroups = {};
    for (const s of sums) {
      sumGroups[s.sum] = sumGroups[s.sum] || [];
      sumGroups[s.sum].push(s);
    }
    for (const sum of Object.keys(sumGroups)) {
      const group = sumGroups[sum];
      if (group.length >= 2 && group.some(g => g.isOpponent)) {
        ruleTriggered = 'plus';
        flipped.push(...group.filter(g => g.isOpponent).map(g => g.index));
      }
    }
  }

  // Applique d'abord les captures Identique/Plus elles-mêmes (toujours, si déclenchées).
  if (flipped.length > 0) {
    flipped = [...new Set(flipped)];
    for (const idx of flipped) {
      newBoard[idx] = { ...newBoard[idx], owner: placed.owner };
    }
    // Combo : chaque carte retournée déclenche à son tour une capture "basique" en chaîne sur ses
    // propres voisins. Uniquement si la règle "Combo" est active.
    if (rules.combo) {
      const chainQueue = [...flipped];
      const alreadyChained = new Set();
      while (chainQueue.length) {
        const idx = chainQueue.shift();
        if (alreadyChained.has(idx)) continue;
        alreadyChained.add(idx);
        const chainFlipped = basicCaptureFrom(newBoard, idx);
        for (const f of chainFlipped) {
          if (!flipped.includes(f)) {
            flipped.push(f);
            chainQueue.push(f);
          }
        }
      }
    }
  } else {
    // --- Capture basique classique ---
    const basicFlipped = [];
    for (const t of touching) {
      if (t.isOpponent && t.placedVal > t.neighborVal) {
        basicFlipped.push(t.index);
      }
    }
    if (basicFlipped.length > 0) {
      ruleTriggered = ruleTriggered || 'basic';
      for (const idx of basicFlipped) {
        newBoard[idx] = { ...newBoard[idx], owner: placed.owner };
      }
      flipped.push(...basicFlipped);
    }
  }

  return { board: newBoard, flipped, ruleTriggered };
}

// Capture basique déclenchée par une carte déjà sur le plateau (utilisé pour les combos)
function basicCaptureFrom(board, cellIndex) {
  const card = board[cellIndex];
  const neighbors = NEIGHBORS[cellIndex];
  const flipped = [];
  for (const dir of Object.keys(neighbors)) {
    const entry = neighbors[dir];
    if (!entry) continue; // bord du plateau, pas de voisin réel à capturer
    const [idx, placedSide, neighborSide] = entry;
    const neighborCard = board[idx];
    if (!neighborCard || neighborCard.owner === card.owner) continue;
    if (card[placedSide] > neighborCard[neighborSide]) {
      board[idx] = { ...neighborCard, owner: card.owner };
      flipped.push(idx);
    }
  }
  return flipped;
}

function isBoardFull(board) {
  return board.every(c => c !== null);
}

function countScore(board) {
  let a = 0, b = 0;
  for (const c of board) {
    if (!c) continue;
    if (c.owner === 'A') a++; else b++;
  }
  return { A: a, B: b };
}

module.exports = {
  createEmptyBoard,
  placeCard,
  isBoardFull,
  countScore,
  opponentOf,
};
