const { buildDeck, cardValue, isBout, isKing, shuffle, sortHand, cardLabel } = require('./deck');
const { CONFIG, BID_LEVELS, BID_LABELS, BID_MULT, seuil, determineLedSuit, legalMoves, resolveTrick } = require('./rules');
const { nextBotName } = require('./ai');

let handCounter = 1;

class Game {
  constructor(roomId, maxJoueurs, hostName) {
    this.roomId = roomId;
    this.maxJoueurs = maxJoueurs;
    this.joueurs = []; // {id, name, connected}
    this.scores = {};
    this.phase = 'lobby';
    this.dealerIndex = -1;
    this.handNo = 0;
    this.history = []; // finished hands summaries
    this.aiDifficulty = 'confirme'; // 'debutant' | 'confirme' | 'expert'
  }

  addJoueur(id, name, isAI = false) {
    if (this.joueurs.find((p) => p.id === id)) return;
    if (this.joueurs.length >= this.maxJoueurs) throw new Error('La table est complète.');
    this.joueurs.push({ id, name, connected: true, isAI });
    this.scores[id] = this.scores[id] || 0;
  }

  addJoueurIA() {
    if (this.phase !== 'lobby') throw new Error("Impossible d'ajouter une IA : la partie a déjà commencé.");
    if (this.joueurs.length >= this.maxJoueurs) throw new Error('La table est complète.');
    const id = 'ai_' + Math.random().toString(36).slice(2, 9);
    this.addJoueur(id, nextBotName(), true);
    return id;
  }

  removeJoueurIA(aiId) {
    if (this.phase !== 'lobby') throw new Error('Impossible de retirer un joueur : la partie a déjà commencé.');
    const p = this.joueurs.find((p) => p.id === aiId);
    if (!p || !p.isAI) throw new Error('Ce joueur IA est introuvable.');
    this.joueurs = this.joueurs.filter((p) => p.id !== aiId);
    delete this.scores[aiId];
  }

  setAIDifficulty(level) {
    if (!['debutant', 'confirme', 'expert'].includes(level)) throw new Error('Niveau IA invalide.');
    if (this.phase !== 'lobby') throw new Error('Le niveau des IA ne peut être changé que dans le salon.');
    this.aiDifficulty = level;
  }

  setConnected(id, val) {
    const p = this.joueurs.find((p) => p.id === id);
    if (p) p.connected = val;
  }

  joueurName(id) {
    const p = this.joueurs.find((p) => p.id === id);
    return p ? p.name : '???';
  }

  seatIndex(id) {
    return this.joueurs.findIndex((p) => p.id === id);
  }

  teamOf(id) {
    if (id === this.taker) return 'attack';
    if (this.partnerId && id === this.partnerId) return 'attack';
    return 'defense';
  }

  canStart() {
    return this.joueurs.length === this.maxJoueurs && (this.phase === 'lobby' || this.phase === 'scoring');
  }

  // ---------- Distribution ----------
  startHand() {
    const n = this.maxJoueurs;
    const cfg = CONFIG[n];
    this.dealerIndex = (this.dealerIndex + 1) % n;
    this.handNo += 1;

    const deck = shuffle(buildDeck());
    this.hands = {};
    this.joueurs.forEach((p) => (this.hands[p.id] = []));
    let idx = 0;
    for (let i = 0; i < cfg.handSize; i++) {
      for (let s = 0; s < n; s++) {
        const seat = (this.dealerIndex + 1 + s) % n;
        this.hands[this.joueurs[seat].id].push(deck[idx++]);
      }
    }
    Object.keys(this.hands).forEach((id) => (this.hands[id] = sortHand(this.hands[id])));
    this.chien = deck.slice(idx, idx + cfg.chien);

    this.phase = 'bidding';
    this.bidOrder = [];
    for (let s = 0; s < n; s++) this.bidOrder.push(this.joueurs[(this.dealerIndex + 1 + s) % n].id);
    this.bidPointer = 0;
    this.bids = {};
    this.currentBid = null;
    this.taker = null;
    this.bidLevel = null;
    this.chien = this.chien;
    this.calledKing = null;
    this.partnerId = null;
    this.poignees = [];
    this.chelemAnnonce = false;
    this.pile = { attack: [], defense: [] };
    this.tricks = [];
    this.currentTrick = [];
    this.turnIndex = null;
    this.readySet = new Set();
    this.petitAuBoutTeam = null;
    this.lastResult = null;
  }

  currentBidder() {
    return this.bidOrder[this.bidPointer];
  }

  placeBid(joueurId, level) {
    if (this.phase !== 'bidding') throw new Error("Ce n'est pas la phase d'enchères.");
    if (this.currentBidder() !== joueurId) throw new Error("Ce n'est pas votre tour d'enchérir.");
    if (level !== 'passe') {
      if (!BID_LEVELS.includes(level)) throw new Error('Enchère invalide.');
      const idx = BID_LEVELS.indexOf(level);
      const curIdx = this.currentBid ? BID_LEVELS.indexOf(this.currentBid.level) : -1;
      if (idx <= curIdx) throw new Error('Votre enchère doit être plus haute que la précédente.');
      this.currentBid = { level, joueurId };
    }
    this.bids[joueurId] = level;
    this.bidPointer += 1;

    if (this.bidPointer >= this.bidOrder.length) {
      this.resolveBidding();
    }
  }

  resolveBidding() {
    if (!this.currentBid) {
      // Everyone passed: redeal, same dealer stays for the retry (dealer already advanced this call)
      this.phase = 'all_passed';
      return;
    }
    this.taker = this.currentBid.joueurId;
    this.bidLevel = this.currentBid.level;

    if (this.bidLevel === 'petite' || this.bidLevel === 'garde') {
      this.phase = 'chien';
      this.hands[this.taker] = sortHand(this.hands[this.taker].concat(this.chien));
    } else if (this.bidLevel === 'garde_sans') {
      this.pile.attack.push(...this.chien);
      this.afterChien();
    } else if (this.bidLevel === 'garde_contre') {
      this.pile.defense.push(...this.chien);
      this.afterChien();
    }
  }

  submitChienDiscard(joueurId, cardIds) {
    if (this.phase !== 'chien') throw new Error("Ce n'est pas la phase du chien.");
    if (joueurId !== this.taker) throw new Error('Seul le preneur écarte.');
    const cfg = CONFIG[this.maxJoueurs];
    if (cardIds.length !== cfg.chien) throw new Error(`Vous devez écarter ${cfg.chien} carte(s).`);
    const hand = this.hands[this.taker];
    const chosen = cardIds.map((id) => {
      const c = hand.find((h) => h.id === id);
      if (!c) throw new Error('Carte introuvable dans votre main.');
      return c;
    });
    const nonTrumpNonKing = hand.filter((c) => c.suit !== 'A' && c.suit !== 'X' && !isKing(c));
    for (const c of chosen) {
      if (c.suit === 'X') throw new Error("L'Excuse ne peut pas être écartée.");
      if (c.suit === 'A' && (c.rank === 1 || c.rank === 21)) throw new Error('Un bout ne peut pas être écarté.');
      if (isKing(c) && nonTrumpNonKing.length >= cfg.chien) throw new Error('Vous ne pouvez pas écarter un Roi tant que vous avez d\'autres cartes à écarter.');
      if (c.suit === 'A' && nonTrumpNonKing.length >= cfg.chien) throw new Error('Vous ne pouvez écarter un atout que si vous n\'avez pas assez d\'autres cartes.');
    }
    const chosenIds = new Set(cardIds);
    this.hands[this.taker] = hand.filter((c) => !chosenIds.has(c.id));
    this.pile.attack.push(...chosen);
    this.afterChien();
  }

  afterChien() {
    if (this.maxJoueurs === 5) {
      const kingsInHand = this.hands[this.taker].filter((c) => isKing(c)).map((c) => c.suit);
      this.needsKingCall = kingsInHand.length < 4;
      this.phase = 'calling';
      if (!this.needsKingCall) {
        // Taker holds all 4 kings: plays solo, no partner
        this.partnerId = null;
        this.calledKing = null;
        this.startPoignee();
      }
    } else {
      this.startPoignee();
    }
  }

  callKing(joueurId, suit) {
    if (this.phase !== 'calling') throw new Error("Ce n'est pas la phase d'appel.");
    if (joueurId !== this.taker) throw new Error('Seul le preneur appelle.');
    if (!['C', 'D', 'P', 'T'].includes(suit)) throw new Error('Couleur invalide.');
    const holdsKing = this.hands[this.taker].find((c) => c.suit === suit && c.rank === 14);
    if (holdsKing) throw new Error('Vous ne pouvez pas appeler un roi que vous possédez déjà.');
    this.calledKing = suit;
    const owner = this.joueurs.find((p) => this.hands[p.id].find((c) => c.suit === suit && c.rank === 14));
    this.partnerId = owner ? owner.id : null; // null => the king is in the chien-derived discard (impossible here) -> taker plays solo
    this.startPoignee();
  }

  startPoignee() {
    this.phase = 'poignee';
    this.readySet = new Set();
  }

  declarePoignee(joueurId, cardIds) {
    if (this.phase !== 'poignee') throw new Error("Ce n'est pas la phase des poignées.");
    const cfg = CONFIG[this.maxJoueurs];
    const hand = this.hands[joueurId];
    const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) throw new Error('Cartes invalides.');
    if (!cards.every((c) => c.suit === 'A' || c.suit === 'X')) throw new Error('Une poignée ne contient que des atouts (et éventuellement l\'Excuse).');
    let type = null;
    if (cards.length === cfg.poignee.triple) type = 'triple';
    else if (cards.length === cfg.poignee.double) type = 'double';
    else if (cards.length === cfg.poignee.simple) type = 'simple';
    else throw new Error(`Nombre d'atouts invalide pour une poignée (${cfg.poignee.simple}/${cfg.poignee.double}/${cfg.poignee.triple} attendus).`);
    this.poignees = this.poignees.filter((p) => p.joueurId !== joueurId);
    this.poignees.push({ joueurId, type, count: cards.length });
  }

  announceChelem(joueurId) {
    if (this.phase !== 'poignee') throw new Error('Le chelem doit être annoncé avant le premier pli.');
    if (joueurId !== this.taker) throw new Error('Seul le preneur peut annoncer le chelem.');
    this.chelemAnnonce = true;
  }

  confirmReady(joueurId) {
    if (this.phase !== 'poignee') throw new Error("Ce n'est pas le moment.");
    this.readySet.add(joueurId);
    if (this.readySet.size >= this.joueurs.length) {
      this.phase = 'playing';
      const n = this.maxJoueurs;
      this.turnIndex = (this.dealerIndex + 1) % n;
    }
  }

  // ---------- Play ----------
  legalMovesFor(joueurId) {
    const hand = this.hands[joueurId];
    const ledSuit = this.currentTrick.length ? determineLedSuit(this.currentTrick) : null;
    return legalMoves(hand, this.currentTrick, ledSuit);
  }

  playCard(joueurId, cardId) {
    if (this.phase !== 'playing') throw new Error("Ce n'est pas la phase de jeu.");
    if (this.joueurs[this.turnIndex].id !== joueurId) throw new Error("Ce n'est pas votre tour.");
    const hand = this.hands[joueurId];
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error('Carte introuvable.');
    const legal = this.legalMovesFor(joueurId);
    if (!legal.find((c) => c.id === cardId)) throw new Error('Coup non autorisé.');

    this.hands[joueurId] = hand.filter((c) => c.id !== cardId);
    this.currentTrick.push({ joueurId, card });

    if (this.currentTrick.length === this.maxJoueurs) {
      this.resolveCurrentTrick();
    } else {
      this.turnIndex = (this.turnIndex + 1) % this.maxJoueurs;
    }
  }

  resolveCurrentTrick() {
    const trick = this.currentTrick;
    const winnerId = resolveTrick(trick);
    const isLastTrick = this.tricks.length + 1 === CONFIG[this.maxJoueurs].handSize;
    const winnerTeam = this.teamOf(winnerId);

    for (const t of trick) {
      if (t.card.suit === 'X' && !isLastTrick) {
        this.pile[this.teamOf(t.joueurId)].push(t.card);
      } else {
        this.pile[winnerTeam].push(t.card);
      }
      if (t.card.suit === 'A' && t.card.rank === 1 && isLastTrick) {
        this.petitAuBoutTeam = winnerTeam;
      }
    }

    this.tricks.push({ cards: trick, winnerId });
    this.currentTrick = [];
    this.turnIndex = this.seatIndex(winnerId);

    if (this.tricks.length === CONFIG[this.maxJoueurs].handSize) {
      this.computeScore();
      this.phase = 'scoring';
    }
  }

  computeScore() {
    const n = this.maxJoueurs;
    const attackPoints = this.pile.attack.reduce((s, c) => s + cardValue(c), 0);
    const nbBouts = this.pile.attack.filter(isBout).length;
    const need = seuil(nbBouts);
    const diff = attackPoints - need;
    const success = diff >= 0;
    const mult = BID_MULT[this.bidLevel];
    const contractPoints = (25 + Math.abs(diff)) * mult;

    let poigneeAttack = 0;
    let poigneeDefense = 0;
    const bonusFor = { simple: 20, double: 30, triple: 40 };
    for (const p of this.poignees) {
      const bonus = bonusFor[p.type];
      if (this.teamOf(p.joueurId) === 'attack') poigneeAttack += bonus;
      else poigneeDefense += bonus;
    }

    const attackWonAll = this.tricks.every((t) => this.teamOf(t.winnerId) === 'attack');
    let chelemBonus = 0;
    if (attackWonAll) chelemBonus = this.chelemAnnonce ? 400 : 200;
    else if (this.chelemAnnonce) chelemBonus = -200;

    let petitBonus = 0;
    if (this.petitAuBoutTeam) petitBonus = this.petitAuBoutTeam === 'attack' ? 10 : -10;

    const share = (success ? 1 : -1) * contractPoints + poigneeAttack - poigneeDefense + chelemBonus + petitBonus;

    const delta = {};
    this.joueurs.forEach((p) => {
      if (p.id === this.taker) delta[p.id] = share * (this.partnerId ? 2 : n - 1);
      else if (p.id === this.partnerId) delta[p.id] = share * 1;
      else delta[p.id] = -share;
    });
    Object.keys(delta).forEach((id) => (this.scores[id] += delta[id]));

    this.lastResult = {
      taker: this.taker,
      partnerId: this.partnerId,
      bidLevel: this.bidLevel,
      attackPoints: Math.round(attackPoints * 10) / 10,
      need,
      nbBouts,
      success,
      contractPoints,
      poigneeAttack,
      poigneeDefense,
      chelemBonus,
      petitBonus,
      share,
      delta,
      poignees: this.poignees,
      chelemAnnonce: this.chelemAnnonce,
      chien: this.chien.map((c) => c.id),
    };
  }

  // ---------- View projection ----------
  publicState(pourJoueurId) {
    const base = {
      roomId: this.roomId,
      maxJoueurs: this.maxJoueurs,
      joueurs: this.joueurs.map((p) => ({ id: p.id, name: p.name, connected: p.connected, isAI: !!p.isAI, seat: this.seatIndex(p.id) })),
      scores: this.scores,
      phase: this.phase,
      dealerIndex: this.dealerIndex,
      handNo: this.handNo,
      aiDifficulty: this.aiDifficulty,
    };
    if (this.phase === 'lobby') return base;

    base.bidOrder = this.bidOrder;
    base.bidPointer = this.bidPointer;
    base.bids = this.bids;
    base.currentBid = this.currentBid;
    base.taker = this.taker;
    base.bidLevel = this.bidLevel;
    base.calledKing = this.calledKing;
    base.partnerId = this.partnerId;
    base.poignees = this.poignees;
    base.chelemAnnonce = this.chelemAnnonce;
    base.readyCount = this.readySet ? this.readySet.size : 0;
    base.needsKingCall = this.needsKingCall;

    if (pourJoueurId && this.hands && this.hands[pourJoueurId]) {
      base.yourHand = this.hands[pourJoueurId];
    }
    base.handCounts = {};
    if (this.hands) this.joueurs.forEach((p) => (base.handCounts[p.id] = this.hands[p.id].length));

    if (this.phase === 'chien' && pourJoueurId === this.taker) {
      base.chien = this.chien;
    }
    if (['playing', 'scoring'].includes(this.phase)) {
      base.currentTrick = this.currentTrick;
      base.turnIndex = this.turnIndex;
      base.tricksPlayed = this.tricks.length;
      base.totalTricks = CONFIG[this.maxJoueurs].handSize;
      base.pileCount = { attack: this.pile.attack.length, defense: this.pile.defense.length };
    }
    if (this.phase === 'playing' && pourJoueurId) {
      base.legalMoves = this.legalMovesFor(pourJoueurId).map((c) => c.id);
    }
    if (this.phase === 'scoring') {
      base.lastResult = this.lastResult;
    }
    if (this.phase === 'bidding') {
      base.currentBidder = this.currentBidder();
    }
    return base;
  }
}

module.exports = { Game, BID_LABELS, BID_LEVELS, CONFIG, cardLabel };
