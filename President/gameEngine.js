const { randomUUID } = require('crypto');

const POINTS_BY_RANK = [10, 7, 5, 3, 1, 1]; // place 1..6 in a round

// Convention demandée : "{valeur}-{lettre de couleur}", ex. 2-P, 10-T, 13-C, 14-R.
// La couleur n'a aucune incidence sur le jeu, seule la valeur (2 à 14) compte.
// spriteSuit/spriteRank pointent vers les visuels SVG dans public/assets/cards/.
const SUITS = [
  { letter: 'P', color: 'black', spriteSuit: 'spade' },   // Pique
  { letter: 'C', color: 'red', spriteSuit: 'heart' },     // Coeur
  { letter: 'T', color: 'black', spriteSuit: 'club' },    // Trèfle
  { letter: 'R', color: 'red', spriteSuit: 'diamond' }    // Carreau
];

function spriteRankFor(level) {
  if (level === 14) return '1'; // As
  if (level === 11) return 'jack';
  if (level === 12) return 'queen';
  if (level === 13) return 'king';
  return String(level);
}

function buildStandardDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let level = 2; level <= 14; level++) {
      deck.push({
        id: randomUUID(),
        level,
        label: `${String(level).padStart(2, '0')}-${suit.letter}`,
        color: suit.color,
        spriteId: `${suit.spriteSuit}_${spriteRankFor(level)}`
      });
    }
  }
  return deck;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deals cards/images equally at random among players. Leftovers are discarded (kept aside).
// perPlayer: explicit hand size, or undefined/null to split the whole deck as evenly as possible.
function dealEqually(deck, playerNames, perPlayer) {
  const shuffled = shuffle(deck);
  const count = Number.isInteger(perPlayer) ? perPlayer : Math.floor(shuffled.length / playerNames.length);
  const hands = {};
  playerNames.forEach((name, idx) => {
    hands[name] = shuffled.slice(idx * count, (idx + 1) * count);
  });
  return hands;
}

class GameManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.config = null; // { mode, players, theme, totalRounds, pointsToWin, images }
    this.state = null; // full runtime state
  }

  isConfigured() {
    return !!this.config;
  }

  configure(config) {
    this.config = config;
    this.state = {
      status: 'ready', // ready -> playing -> round-end -> game-over
      round: 0,
      scores: {},
      lastRoundScores: {},
      hands: {},
      table: null, // { card, playerName }
      order: [], // player name rotation for current round
      turnIndex: 0,
      trickStarterName: null,
      lastPlayedName: null,
      passed: new Set(),
      finished: [], // ordered list of player names who emptied their hand this round
      log: []
    };
    config.players.forEach((p) => {
      this.state.scores[p] = 0;
    });
    return this.getPublicState();
  }

  addLog(msg) {
    this.state.log.unshift(msg);
    this.state.log = this.state.log.slice(0, 30);
  }

  startRound() {
    const { mode, players, images } = this.config;
    this.state.round += 1;
    this.state.status = 'playing';
    this.state.table = null;
    this.state.finished = [];
    this.state.passed = new Set();
    this.state.lastRoundScores = {};

    let deck;
    if (mode === 'A') {
      deck = buildStandardDeck();
    } else {
      deck = images;
    }
    const perPlayer = this.config.handSize === 'all' ? undefined : this.config.handSize;
    this.state.hands = dealEqually(deck, players, perPlayer);

    // random order + random first player
    this.state.order = shuffle(players);
    const firstIdx = Math.floor(Math.random() * this.state.order.length);
    // rotate order so that first player is at index 0, but keep it as circular list
    this.state.order = this.state.order.slice(firstIdx).concat(this.state.order.slice(0, firstIdx));
    this.state.turnIndex = 0;
    this.state.trickStarterName = this.state.order[0];
    this.state.lastPlayedName = null;

    this.addLog(`Tour ${this.state.round} : distribution terminée. ${this.state.order[0]} commence.`);
    return this.getPublicState();
  }

  currentPlayer() {
    return this.state.order[this.state.turnIndex];
  }

  isPlayerActive(name) {
    return !this.state.finished.includes(name);
  }

  advanceTurn() {
    const n = this.state.order.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.state.turnIndex + step) % n;
      const name = this.state.order[idx];
      if (this.isPlayerActive(name) && !this.state.passed.has(name)) {
        this.state.turnIndex = idx;
        return;
      }
    }
    // nobody left to act naturally -> fall back to last player who played (trick closes)
    const lastIdx = this.state.order.indexOf(this.state.lastPlayedName);
    this.state.turnIndex = lastIdx >= 0 ? lastIdx : this.state.turnIndex;
  }

  trickIsClosed() {
    // Closed when everyone except the last player who played has either passed or finished
    if (!this.state.lastPlayedName) return false;
    return this.state.order.every((name) => {
      if (name === this.state.lastPlayedName) return true;
      return !this.isPlayerActive(name) || this.state.passed.has(name);
    });
  }

  playCard(playerName, cardId) {
    if (this.state.status !== 'playing') throw new Error("La partie n'est pas en cours.");
    if (this.currentPlayer() !== playerName) throw new Error("Ce n'est pas votre tour.");
    const hand = this.state.hands[playerName] || [];
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error('Carte introuvable dans votre main.');

    const isTrickLeaderReplay = this.state.lastPlayedName === playerName && this.trickIsClosed();
    if (this.state.table && !isTrickLeaderReplay && card.level <= this.state.table.card.level) {
      throw new Error('Cette carte doit être plus forte que la carte posée.');
    }
    if (this.state.table && isTrickLeaderReplay && card.level <= this.state.table.card.level) {
      throw new Error('Vous devez poser une carte encore plus forte, ou cliquer sur "Fin du tour".');
    }

    // play the card
    this.state.hands[playerName] = hand.filter((c) => c.id !== cardId);
    this.state.table = { card, playerName };
    this.state.lastPlayedName = playerName;
    this.state.passed.delete(playerName); // clean, though irrelevant now
    this.addLog(`${playerName} pose ${this.cardLabelForLog(card)}.`);

    if (this.state.hands[playerName].length === 0) {
      this.state.finished.push(playerName);
      this.addLog(`${playerName} a posé toutes ses cartes !`);
    }

    this.checkRoundCompletion();
    if (this.state.status === 'playing') {
      this.advanceTurn();
    }
    return this.getPublicState();
  }

  pass(playerName) {
    if (this.state.status !== 'playing') throw new Error("La partie n'est pas en cours.");
    if (this.currentPlayer() !== playerName) throw new Error("Ce n'est pas votre tour.");
    this.state.passed.add(playerName);
    this.addLog(`${playerName} passe.`);
    this.advanceTurn();
    return this.getPublicState();
  }

  endTrick(playerName) {
    // Only the player who currently holds the winning card, once the trick is closed, may reset it.
    if (this.state.status !== 'playing') throw new Error("La partie n'est pas en cours.");
    if (this.state.lastPlayedName !== playerName || !this.trickIsClosed()) {
      throw new Error('Vous ne pouvez pas terminer ce tour maintenant.');
    }
    this.state.table = null;
    this.state.passed = new Set();
    this.addLog(`${playerName} relance un nouveau tour de table.`);
    // it stays this player's turn (they lead the new trick)
    this.state.turnIndex = this.state.order.indexOf(playerName);
    return this.getPublicState();
  }

  checkRoundCompletion() {
    const activePlayers = this.config.players;
    if (this.state.finished.length >= activePlayers.length) {
      // round over: award points
      this.state.finished.forEach((name, idx) => {
        const pts = POINTS_BY_RANK[idx] ?? 0;
        this.state.lastRoundScores[name] = pts;
        this.state.scores[name] = (this.state.scores[name] || 0) + pts;
      });
      this.state.status = 'round-end';
      this.state.table = null;
      this.addLog(`Fin du tour ${this.state.round}.`);

      const reachedTarget = Object.values(this.state.scores).some((s) => s >= this.config.pointsToWin);
      const lastRound = this.state.round >= this.config.totalRounds;
      if (reachedTarget || lastRound) {
        this.state.status = 'game-over';
        this.addLog('Partie terminée !');
      }
    }
  }

  cardLabelForLog(card) {
    return this.config.mode === 'A' ? card.label : card.name;
  }

  // ---- state serialization ----

  getPublicState() {
    if (!this.config) return { configured: false };
    const mode = this.config.mode;
    const table = this.state.table
      ? {
          playerName: this.state.table.playerName,
          label: mode === 'A' ? this.state.table.card.label : this.state.table.card.name,
          color: mode === 'A' ? this.state.table.card.color : null,
          spriteId: mode === 'A' ? this.state.table.card.spriteId : null,
          imageId: mode === 'B' ? this.state.table.card.id : null
        }
      : null;

    return {
      configured: true,
      mode,
      theme: this.config.theme,
      players: this.config.players,
      totalRounds: this.config.totalRounds,
      pointsToWin: this.config.pointsToWin,
      handSize: this.config.handSize,
      status: this.state.status,
      round: this.state.round,
      scores: this.state.scores,
      lastRoundScores: this.state.lastRoundScores,
      order: this.state.order,
      currentPlayer: this.state.status === 'playing' ? this.currentPlayer() : null,
      table,
      finished: this.state.finished,
      handCounts: Object.fromEntries(
        this.config.players.map((p) => [p, (this.state.hands[p] || []).length])
      ),
      canEndTrick:
        this.state.status === 'playing' &&
        this.state.lastPlayedName &&
        this.trickIsClosed()
          ? this.state.lastPlayedName
          : null,
      log: this.state.log
    };
  }

  getPlayerState(playerName) {
    const base = this.getPublicState();
    if (!base.configured) return base;
    const hand = (this.state.hands[playerName] || []).slice();
    hand.sort((a, b) => a.level - b.level);
    const mode = this.config.mode;
    base.yourHand = hand.map((c) => {
      const isMyTurn = base.status === 'playing' && base.currentPlayer === playerName;
      const tableLevel = this.state.table ? this.state.table.card.level : null;
      const playable = isMyTurn && (tableLevel === null || c.level > tableLevel);
      return {
        id: c.id,
        display: mode === 'A' ? c.label : c.name,
        color: mode === 'A' ? c.color : null,
        spriteId: mode === 'A' ? c.spriteId : null,
        imageId: mode === 'B' ? c.id : null,
        playable
      };
    });
    base.isYourTurn = base.status === 'playing' && base.currentPlayer === playerName;
    base.canPass = base.isYourTurn;
    base.canEndTrickYou = base.canEndTrick === playerName;
    return base;
  }

  // Master-only view reveals the level of the card on the table
  getMasterTableExtra() {
    if (!this.state || !this.state.table) return null;
    return { level: this.state.table.card.level };
  }
}

module.exports = { GameManager, buildStandardDeck, shuffle, dealEqually };
