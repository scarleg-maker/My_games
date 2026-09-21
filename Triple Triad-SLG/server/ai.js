'use strict';
const { placeCard } = require('./engine');

function getEmptyCells(board) {
  const cells = [];
  for (let i = 0; i < 9; i++) if (!board[i]) cells.push(i);
  return cells;
}

/** Liste tous les coups possibles (carte de la main x case vide) avec leur nombre de captures. */
function evaluateAllMoves(board, hand, rules) {
  const emptyCells = getEmptyCells(board);
  const moves = [];
  for (let h = 0; h < hand.length; h++) {
    for (const cell of emptyCells) {
      const { flipped } = placeCard(board, cell, hand[h], rules);
      moves.push({ cardIndexInHand: h, cellIndex: cell, captures: flipped.length });
    }
  }
  return moves;
}

function isAdjacent(cellA, cellB) {
  const rowA = Math.floor(cellA / 3), colA = cellA % 3;
  const rowB = Math.floor(cellB / 3), colB = cellB % 3;
  return (Math.abs(rowA - rowB) + Math.abs(colA - colB)) === 1;
}

/**
 * Score "Identique/Plus" d'un placement : compte combien de voisins déjà posés satisfont une
 * condition Identique (même valeur) sur le côté qui les sépare — sert à repérer les positions qui
 * exploitent bien ces règles, au-delà des captures déjà comptées par le moteur.
 */
function samePlusAffinity(board, cellIndex, card, rules) {
  if (!rules.same && !rules.plus) return 0;
  const row = Math.floor(cellIndex / 3), col = cellIndex % 3;
  const sides = [
    { dir: 'top', ni: row > 0 ? cellIndex - 3 : null, opp: 'bottom' },
    { dir: 'right', ni: col < 2 ? cellIndex + 1 : null, opp: 'left' },
    { dir: 'bottom', ni: row < 2 ? cellIndex + 3 : null, opp: 'top' },
    { dir: 'left', ni: col > 0 ? cellIndex - 1 : null, opp: 'right' },
  ];
  let affinity = 0;
  for (const s of sides) {
    if (s.ni === null || !board[s.ni]) continue;
    const neighborCard = board[s.ni];
    if (rules.same && card[s.dir] === neighborCard[s.opp]) affinity += 1;
  }
  return affinity;
}

/**
 * Choisit un coup pour l'IA.
 * difficulty: 'random' | 'greedy' | 'smart' | 'seasoned' | 'expert' | 'bluff'
 * hand: cartes encore en main de l'IA (owner déjà = 'B' par ex.)
 * opponentHand: cartes encore en main de l'adversaire (nécessaire pour 'expert' et 'seasoned')
 * Retourne { cardIndexInHand, cellIndex }
 */
function chooseAIMove(board, hand, rules, difficulty, opponentHand = []) {
  const emptyCells = getEmptyCells(board);

  if (difficulty === 'random' || hand.length === 0) {
    const cardIndexInHand = Math.floor(Math.random() * hand.length);
    const cellIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    return { cardIndexInHand, cellIndex };
  }

  // ---- Bluff : joue le meilleur coup 60% du temps, un coup du "top 3" au hasard sinon ----
  // (rend l'IA moins prévisible sans la rendre incompétente : elle reste dans les bons coups)
  if (difficulty === 'bluff') {
    const moves = evaluateAllMoves(board, hand, rules);
    moves.sort((a, b) => b.captures - a.captures);
    if (Math.random() < 0.6 || moves.length === 1) {
      return { cardIndexInHand: moves[0].cardIndexInHand, cellIndex: moves[0].cellIndex };
    }
    const poolSize = Math.min(3, moves.length);
    const pick = moves[Math.floor(Math.random() * poolSize)];
    return { cardIndexInHand: pick.cardIndexInHand, cellIndex: pick.cellIndex };
  }

  // ---- Expert : anticipe 2 coups à l'avance (minimax) — simule la meilleure réplique adverse
  // possible après chacun de ses propres coups, et choisit celui qui laisse le pire dégât possible
  // le plus faible pour lui. Le plus fort des 6 niveaux. ----
  if (difficulty === 'expert') {
    let best = null;
    for (let h = 0; h < hand.length; h++) {
      for (const cell of emptyCells) {
        const { board: boardAfterMe, flipped } = placeCard(board, cell, hand[h], rules);
        const myGain = flipped.length;

        let worstOpponentReply = 0;
        if (opponentHand.length > 0) {
          const emptyCellsAfter = getEmptyCells(boardAfterMe);
          for (let oh = 0; oh < opponentHand.length; oh++) {
            for (const oCell of emptyCellsAfter) {
              const { flipped: oFlipped } = placeCard(boardAfterMe, oCell, opponentHand[oh], rules);
              if (oFlipped.length > worstOpponentReply) worstOpponentReply = oFlipped.length;
            }
          }
        }
        const netScore = myGain - worstOpponentReply * 0.9;
        if (!best || netScore > best.score) best = { score: netScore, cardIndexInHand: h, cellIndex: cell };
      }
    }
    return { cardIndexInHand: best.cardIndexInHand, cellIndex: best.cellIndex };
  }

  // ---- Seasoned : maîtrise les règles Identique/Plus (bonus si le coup les exploite bien, malus
  // si le placement expose une prise Identique facile à l'adversaire réel), mais reste à 1 coup
  // d'anticipation seulement — battable, contrairement à Expert. ----
  if (difficulty === 'seasoned') {
    let best = null;
    for (let h = 0; h < hand.length; h++) {
      for (const cell of emptyCells) {
        const { board: resultBoard, flipped } = placeCard(board, cell, hand[h], rules);
        let score = flipped.length;
        const card = hand[h];
        const exposedLowSides = [card.top, card.right, card.bottom, card.left].filter(v => v <= 3).length;
        score -= exposedLowSides * 0.15;

        score += samePlusAffinity(board, cell, card, rules) * 0.4;

        if ((rules.same || rules.plus) && opponentHand.length > 0) {
          const adjacentEmpty = getEmptyCells(resultBoard).filter(c => isAdjacent(cell, c));
          outer:
          for (const oCell of adjacentEmpty) {
            for (const oCard of opponentHand) {
              if (samePlusAffinity(resultBoard, oCell, oCard, rules) > 0) { score -= 0.3; break outer; }
            }
          }
        }

        if (!best || score > best.score) best = { score, cardIndexInHand: h, cellIndex: cell };
      }
    }
    return { cardIndexInHand: best.cardIndexInHand, cellIndex: best.cellIndex };
  }

  // ---- greedy / smart (comportement historique, inchangé) ----
  let best = null;
  for (let h = 0; h < hand.length; h++) {
    for (const cell of emptyCells) {
      const { flipped } = placeCard(board, cell, hand[h], rules);
      let score = flipped.length;

      if (difficulty === 'smart') {
        const card = hand[h];
        const exposedLowSides = [card.top, card.right, card.bottom, card.left].filter(v => v <= 3).length;
        score -= exposedLowSides * 0.15;
      }

      if (!best || score > best.score) {
        best = { score, cardIndexInHand: h, cellIndex: cell };
      }
    }
  }
  return { cardIndexInHand: best.cardIndexInHand, cellIndex: best.cellIndex };
}

module.exports = { chooseAIMove };
