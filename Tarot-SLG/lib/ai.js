const { cardValue, isBout, isKing } = require('./deck');
const { CONFIG, BID_LEVELS, determineLedSuit, legalMoves, resolveTrick } = require('./rules');

const BOT_NAMES = ['Aristide', 'Bérénice', 'Casimir', 'Delphine', 'Eustache', 'Fantine', 'Gaspard', 'Honorine'];
let botNameIdx = 0;
function nextBotName() {
  const name = BOT_NAMES[botNameIdx % BOT_NAMES.length];
  botNameIdx += 1;
  return `${name} (IA)`;
}

const DIFFICULTIES = ['debutant', 'confirme', 'expert'];
function normDiff(d) { return DIFFICULTIES.includes(d) ? d : 'confirme'; }

// Rough hand-strength estimate: trumps, oudlers and honours count for more.
function handStrength(hand) {
  let s = 0;
  for (const c of hand) {
    if (c.suit === 'X') s += 3;
    else if (c.suit === 'A') s += (c.rank === 1 || c.rank === 21) ? 3 : 1;
    else if (c.rank === 14) s += 3;
    else if (c.rank === 13) s += 1.5;
    else if (c.rank === 12) s += 0.7;
  }
  return s;
}

// ---------- Bidding ----------
// Beginners misjudge their hand a lot (large random noise -> both under- and over-bidding).
// Experts evaluate more precisely (little noise) and weigh oudlers more heavily, since oudlers
// are what really lowers the points threshold needed to win the contract.
function chooseBid(game, joueurId, difficulty) {
  const diff = normDiff(difficulty);
  const hand = game.hands[joueurId];
  let strength = handStrength(hand);

  if (diff === 'expert') {
    const oudlers = hand.filter(isBout).length;
    strength += oudlers * 1.2;
    strength += (Math.random() * 1 - 0.5);
  } else if (diff === 'confirme') {
    strength += (Math.random() * 3 - 1.5);
  } else {
    strength += (Math.random() * 9 - 4.5);
  }

  let desiredIdx = -1;
  if (strength >= 26) desiredIdx = 3;
  else if (strength >= 18) desiredIdx = 2;
  else if (strength >= 12) desiredIdx = 1;
  else if (strength >= 7) desiredIdx = 0;

  const curIdx = game.currentBid ? BID_LEVELS.indexOf(game.currentBid.level) : -1;
  if (desiredIdx > curIdx) return BID_LEVELS[desiredIdx];
  return 'passe';
}

// ---------- Chien discard ----------
// Confirmed/expert always keep the lowest-value safe cards (protect strength). Expert additionally
// favours emptying a suit it's already short in, to create trumping opportunities later. Beginners
// discard a random safe card instead of the objectively best one.
function suitCounts(hand) {
  const counts = {};
  for (const c of hand) counts[c.suit] = (counts[c.suit] || 0) + 1;
  return counts;
}

function chooseDiscard(game, joueurId, difficulty) {
  const diff = normDiff(difficulty);
  const cfg = CONFIG[game.maxJoueurs];
  const hand = game.hands[joueurId];
  const safe = hand.filter((c) => c.suit !== 'A' && c.suit !== 'X' && !isKing(c));

  let ordered;
  if (diff === 'debutant') {
    ordered = safe.slice();
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  } else if (diff === 'expert') {
    const counts = suitCounts(hand);
    ordered = safe.slice().sort((a, b) => (counts[a.suit] - counts[b.suit]) || (cardValue(a) - cardValue(b)) || (a.rank - b.rank));
  } else {
    ordered = safe.slice().sort((a, b) => cardValue(a) - cardValue(b) || a.rank - b.rank);
  }

  let picks = ordered.slice(0, cfg.chien);
  if (picks.length < cfg.chien) {
    const lowTrumps = hand.filter((c) => c.suit === 'A' && !isBout(c)).sort((a, b) => a.rank - b.rank);
    picks = picks.concat(lowTrumps.slice(0, cfg.chien - picks.length));
  }
  return picks.map((c) => c.id);
}

// ---------- King call (5 joueurs) ----------
function chooseKing(game, joueurId) {
  const hand = game.hands[joueurId];
  const held = new Set(hand.filter((c) => isKing(c)).map((c) => c.suit));
  const suits = ['C', 'D', 'P', 'T'];
  return suits.find((s) => !held.has(s)) || suits[0];
}

// ---------- Poignée / Chelem ----------
// A beginner sometimes simply forgets to show a poignée they're entitled to.
function choosePoignee(game, joueurId, difficulty) {
  const diff = normDiff(difficulty);
  if (diff === 'debutant' && Math.random() < 0.45) return null;
  const cfg = CONFIG[game.maxJoueurs];
  const trumps = game.hands[joueurId].filter((c) => c.suit === 'A' || c.suit === 'X');
  let count = 0;
  if (trumps.length >= cfg.poignee.triple) count = cfg.poignee.triple;
  else if (trumps.length >= cfg.poignee.double) count = cfg.poignee.double;
  else if (trumps.length >= cfg.poignee.simple) count = cfg.poignee.simple;
  if (!count) return null;
  return trumps.slice(0, count).map((c) => c.id);
}

// Only an expert taker with an overwhelming hand risks announcing the chelem.
function shouldAnnounceChelem(game, joueurId, difficulty) {
  if (normDiff(difficulty) !== 'expert') return false;
  if (game.taker !== joueurId) return false;
  const hand = game.hands[joueurId];
  const trumps = hand.filter((c) => c.suit === 'A' || c.suit === 'X').length;
  const cfg = CONFIG[game.maxJoueurs];
  return trumps >= cfg.handSize - 3; // hand is almost entirely trumps/excuse
}

// ---------- Card play ----------
function chooseCard(game, joueurId, difficulty) {
  const diff = normDiff(difficulty);
  const hand = game.hands[joueurId];
  const trick = game.currentTrick;
  const ledSuit = trick.length ? determineLedSuit(trick) : null;
  const legal = legalMoves(hand, trick, ledSuit);
  if (legal.length === 1) return legal[0].id;

  if (diff === 'debutant') {
    return legal[Math.floor(Math.random() * legal.length)].id;
  }

  const myTeam = game.teamOf(joueurId);
  const rankValue = (c) => (c.suit === 'A' ? 100 + c.rank : c.rank);

  // resolveTrick can't be evaluated while the only card played so far is the Excuse
  // (it doesn't set a led suit and isn't itself a valid trick winner).
  const hasDeterminableWinner = (t) => t.some((x) => x.card.suit !== 'X');
  const currentWinner = hasDeterminableWinner(trick) ? resolveTrick(trick) : null;
  const partnerLeading = currentWinner && game.teamOf(currentWinner) === myTeam;

  const wouldWin = (card) => {
    if (card.suit === 'X') return false;
    const hypo = trick.concat([{ joueurId: '__ME__', card }]);
    if (!hasDeterminableWinner(hypo)) return false;
    return resolveTrick(hypo) === '__ME__';
  };

  const sortLowFirst = (arr) => arr.slice().sort((a, b) => {
    const boutDiff = (isBout(a) ? 1 : 0) - (isBout(b) ? 1 : 0);
    if (boutDiff !== 0) return boutDiff;
    return cardValue(a) - cardValue(b) || rankValue(a) - rankValue(b);
  });

  if (trick.length === 0) {
    if (diff === 'expert') {
      // Lead from the shortest non-trump suit to work toward a void (future trumping power).
      const bySuit = {};
      for (const c of hand) { if (c.suit !== 'A' && c.suit !== 'X') (bySuit[c.suit] = bySuit[c.suit] || []).push(c); }
      const suitsHeld = Object.keys(bySuit);
      if (suitsHeld.length) {
        suitsHeld.sort((a, b) => bySuit[a].length - bySuit[b].length);
        const shortest = sortLowFirst(bySuit[suitsHeld[0]]);
        if (shortest.length) return shortest[0].id;
      }
    }
    const opts = sortLowFirst(legal);
    return opts[0].id;
  }

  if (partnerLeading) {
    const points = legal.filter((c) => !isBout(c) && c.rank >= 11 && c.suit !== 'A');
    if (points.length) return sortLowFirst(points).reverse()[0].id;
    return sortLowFirst(legal)[0].id;
  }

  const winners = legal.filter(wouldWin);
  if (winners.length) {
    winners.sort((a, b) => rankValue(a) - rankValue(b));
    return winners[0].id;
  }
  return sortLowFirst(legal)[0].id;
}

module.exports = { nextBotName, DIFFICULTIES, chooseBid, chooseDiscard, chooseKing, choosePoignee, shouldAnnounceChelem, chooseCard };
