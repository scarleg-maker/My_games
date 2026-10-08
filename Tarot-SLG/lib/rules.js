const CONFIG = {
  3: { handSize: 24, chien: 6, poignee: { simple: 13, double: 15, triple: 18 } },
  4: { handSize: 18, chien: 6, poignee: { simple: 10, double: 13, triple: 15 } },
  5: { handSize: 15, chien: 3, poignee: { simple: 8, double: 10, triple: 13 } },
};

const BID_LEVELS = ['petite', 'garde', 'garde_sans', 'garde_contre'];
const BID_LABELS = {
  petite: 'Petite',
  garde: 'Garde',
  garde_sans: 'Garde Sans le chien',
  garde_contre: 'Garde Contre le chien',
};
const BID_MULT = { petite: 1, garde: 2, garde_sans: 4, garde_contre: 6 };

function seuil(nbBouts) {
  return { 0: 56, 1: 51, 2: 41, 3: 36 }[nbBouts];
}

function determineLedSuit(trickCards) {
  const nonExcuse = trickCards.find((t) => t.card.suit !== 'X');
  return nonExcuse ? nonExcuse.card.suit : null;
}

function legalMoves(hand, trickCards, ledSuit) {
  const excuse = hand.find((c) => c.suit === 'X');
  if (!ledSuit) return hand.slice();

  const ledCards = hand.filter((c) => c.suit === ledSuit);
  let base;
  if (ledSuit !== 'A') {
    if (ledCards.length > 0) {
      base = ledCards;
    } else {
      const atouts = hand.filter((c) => c.suit === 'A');
      if (atouts.length > 0) {
        const maxAtout = Math.max(0, ...trickCards.filter((t) => t.card.suit === 'A').map((t) => t.card.rank));
        const higher = atouts.filter((c) => c.rank > maxAtout);
        base = higher.length > 0 ? higher : atouts;
      } else {
        base = hand.slice();
      }
    }
  } else {
    const atouts = hand.filter((c) => c.suit === 'A');
    if (atouts.length > 0) {
      const maxAtout = Math.max(0, ...trickCards.filter((t) => t.card.suit === 'A').map((t) => t.card.rank));
      const higher = atouts.filter((c) => c.rank > maxAtout);
      base = higher.length > 0 ? higher : atouts;
    } else {
      base = hand.slice();
    }
  }
  const set = new Set(base.map((c) => c.id));
  if (excuse) set.add(excuse.id);
  return hand.filter((c) => set.has(c.id));
}

function resolveTrick(trickCards) {
  const nonExcuse = trickCards.filter((t) => t.card.suit !== 'X');
  const atoutsPlayed = nonExcuse.filter((t) => t.card.suit === 'A');
  let winner;
  if (atoutsPlayed.length > 0) {
    winner = atoutsPlayed.reduce((a, b) => (b.card.rank > a.card.rank ? b : a));
  } else {
    const ledSuit = determineLedSuit(trickCards);
    const ledCards = nonExcuse.filter((t) => t.card.suit === ledSuit);
    if (ledCards.length === 0) return trickCards[0].joueurId; // defensive fallback, should not normally happen
    winner = ledCards.reduce((a, b) => (b.card.rank > a.card.rank ? b : a));
  }
  return winner.joueurId;
}

module.exports = { CONFIG, BID_LEVELS, BID_LABELS, BID_MULT, seuil, determineLedSuit, legalMoves, resolveTrick };
