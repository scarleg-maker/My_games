const SUITS = ['C', 'D', 'P', 'T']; // Coeur, Carreau, Pique, Trefle
const SUIT_NAMES = { C: 'Cœur', D: 'Carreau', P: 'Pique', T: 'Trèfle', A: 'Atout', X: 'Excuse' };
const RANK_NAMES = { 11: 'Valet', 12: 'Cavalier', 13: 'Dame', 14: 'Roi' };

function buildDeck() {
  const cards = [];
  for (const s of SUITS) {
    for (let r = 1; r <= 14; r++) cards.push({ id: s + r, suit: s, rank: r });
  }
  for (let r = 1; r <= 21; r++) cards.push({ id: 'A' + r, suit: 'A', rank: r });
  cards.push({ id: 'X0', suit: 'X', rank: 0 });
  return cards;
}

function cardValue(card) {
  if (card.suit === 'X') return 4.5;
  if (card.suit === 'A') return (card.rank === 1 || card.rank === 21) ? 4.5 : 0.5;
  if (card.rank >= 11) return { 11: 1.5, 12: 2.5, 13: 3.5, 14: 4.5 }[card.rank];
  return 0.5;
}

function isBout(card) {
  return card.suit === 'X' || (card.suit === 'A' && (card.rank === 1 || card.rank === 21));
}

function isKing(card) {
  return card.suit !== 'A' && card.suit !== 'X' && card.rank === 14;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardLabel(card) {
  if (card.suit === 'X') return 'Excuse';
  if (card.suit === 'A') return `${card.rank} d'Atout`;
  const rn = RANK_NAMES[card.rank] || String(card.rank);
  return `${rn} de ${SUIT_NAMES[card.suit]}`;
}

function sortHand(cards) {
  const order = { C: 0, D: 1, P: 2, T: 3, A: 4, X: 5 };
  return cards.slice().sort((a, b) => {
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return a.rank - b.rank;
  });
}

module.exports = { SUITS, SUIT_NAMES, RANK_NAMES, buildDeck, cardValue, isBout, isKing, shuffle, cardLabel, sortHand };
