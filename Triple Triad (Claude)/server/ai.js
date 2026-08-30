'use strict';
const { placeCard } = require('./engine');

function getEmptyCells(board) {
  const cells = [];
  for (let i = 0; i < 9; i++) if (!board[i]) cells.push(i);
  return cells;
}

/**
 * Choisit un coup pour l'IA.
 * difficulty: 'random' | 'greedy' | 'smart'
 * hand: cartes encore en main de l'IA (owner déjà = 'B' par ex.)
 * Retourne { cardIndexInHand, cellIndex }
 */
function chooseAIMove(board, hand, rules, difficulty) {
  const emptyCells = getEmptyCells(board);

  if (difficulty === 'random' || hand.length === 0) {
    const cardIndexInHand = Math.floor(Math.random() * hand.length);
    const cellIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    return { cardIndexInHand, cellIndex };
  }

  // greedy / smart: on simule chaque coup possible et on prend celui qui capture le plus
  // 'smart' regarde en plus le risque immédiat pris par la case choisie (1 coup d'anticipation légère)
  let best = null;
  for (let h = 0; h < hand.length; h++) {
    for (const cell of emptyCells) {
      const { board: resultBoard, flipped } = placeCard(board, cell, hand[h], rules);
      let score = flipped.length;

      if (difficulty === 'smart') {
        // pénalise les positions qui exposent une valeur faible à un voisin vide fort potentiel
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
