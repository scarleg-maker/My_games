'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const engine = require('./engine');
const { chooseAIMove } = require('./ai');
const { applyTradeRule } = require('./tradeRules');
const { buildHand, ALL_CARDS } = require('./cardLoader');
const { assignRandomElements, applyElementalAdjustment } = require('./elements');
const saveManager = require('./saveManager');
const legendaryRegistry = require('./legendaryRegistry');
const shop = require('./shop');
const sets = require('./sets');
const tournament = require('./tournament');
const ELEMENTS = require('../data/elements.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// ---------- Helpers set ----------

function requireValidSet(req, res) {
  const setId = req.params.set;
  if (!sets.isValidSet(setId)) {
    res.status(400).json({ error: `Set inconnu: ${setId}` });
    return null;
  }
  return setId;
}

// ---------- API REST ----------

app.get('/api/sets', (req, res) => res.json(sets.getSets()));
app.get('/api/elements', (req, res) => res.json(ELEMENTS));
app.get('/api/shop/tiers', (req, res) => res.json(shop.getBuyTiers()));
app.get('/api/tournament/tiers', (req, res) => res.json(tournament.getVisibleTiers()));

app.get('/api/:set/cards', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  res.json(sets.getCardsForSet(setId));
});

app.get('/api/:set/opponents', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  res.json(sets.getOpponentsForSet(setId));
});

app.get('/api/:set/legendary-holders', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  const result = {};
  for (const cardId of legendaryRegistry.getLegendaryCardIds(setId)) {
    const holder = legendaryRegistry.getHolder(setId, cardId);
    result[cardId] = holder
      ? { tier: holder.tier, opponentIndex: holder.opponentIndex, opponentName: legendaryRegistry.getHolderName(setId, cardId) }
      : null;
  }
  res.json(result);
});

app.get('/api/:set/save/:name', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  const save = saveManager.loadOrCreateSave(req.params.name, setId);
  res.json(save);
});

app.post('/api/:set/save/:name/reset', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  const save = saveManager.resetSave(req.params.name, setId);
  res.json(save);
});

app.delete('/api/:set/save/:name', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  saveManager.deleteSave(req.params.name, setId);
  res.json({ ok: true });
});

app.post('/api/:set/save/import', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  try {
    const save = saveManager.importSave(req.body, setId);
    res.json(save);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/:set/save/:name/shop/buy', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  try {
    const { tierKey } = req.body;
    const { card, cost } = shop.buyRandomCard(setId, tierKey);
    saveManager.spendPoints(req.params.name, setId, cost); // lève une erreur si solde insuffisant
    saveManager.addCardsToSave(req.params.name, setId, [card.id]);
    const save = saveManager.loadOrCreateSave(req.params.name, setId);
    res.json({ save, purchasedCard: card });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/:set/save/:name/shop/sell', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  try {
    const { cardId } = req.body;
    const save = saveManager.loadOrCreateSave(req.params.name, setId);
    if (!save.collection.includes(cardId)) throw new Error('Carte non possédée.');
    const def = ALL_CARDS.find(c => c.id === cardId);
    if (!def) throw new Error('Carte inconnue.');
    const price = shop.sellPrice(def.level);
    if (price === null) throw new Error('Cette carte ne peut pas être vendue.');
    saveManager.removeCardsFromSave(req.params.name, setId, [cardId]);
    saveManager.addPoints(req.params.name, setId, price);
    const updated = saveManager.loadOrCreateSave(req.params.name, setId);
    res.json({ save: updated, soldCardId: cardId, earned: price });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Tournoi : démarrage / abandon (REST) ----------

app.post('/api/:set/save/:name/tournament/start', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  try {
    const { deckCardIds, rules, tierKey } = req.body;
    const name = req.params.name;
    const save = saveManager.loadOrCreateSave(name, setId);

    if (save.tournament && save.tournament.active && !save.tournament.finished) {
      throw new Error('Un tournoi est déjà en cours. Terminez-le, reprenez-le, ou abandonnez-le avant d\'en démarrer un nouveau.');
    }
    const tierDef = tournament.getTierDef(tierKey);
    if (!tierDef) throw new Error('Palier de tournoi invalide.');
    if (!tournament.isTierUnlocked(tierDef, save)) throw new Error('Ce palier de tournoi n\'est pas encore débloqué.');
    const parsedRules = defaultRules(rules);
    if (!parsedRules.random) {
      if (!Array.isArray(deckCardIds) || deckCardIds.length !== 5) throw new Error('Il faut exactement 5 cartes.');
      const collectionCopy = [...save.collection];
      for (const id of deckCardIds) {
        const idx = collectionCopy.indexOf(id);
        if (idx === -1) throw new Error(`Carte non possédée: ${id}`);
        collectionCopy.splice(idx, 1);
      }
    }

    saveManager.spendPoints(name, setId, tierDef.cost); // lève une erreur si solde insuffisant

    const rounds = tournament.pickTournamentOpponents(setId, tierDef);
    const freshSave = saveManager.loadOrCreateSave(name, setId);
    freshSave.tournament = {
      active: true,
      finished: false,
      placement: null,
      tierKey: tierDef.id,
      deckCardIds: [...deckCardIds],
      rules: parsedRules,
      opponents: rounds,       // 5 manches normales, choisies une fois pour toute la durée du tournoi
      deciderOpponent: null,   // rempli seulement si la manche décisive se déclenche (défaite en manche 4)
      roundIndex: 0,           // 0 à 4 = manches normales 1 à 5
      isDecider: false,
      results: [],             // historique 'win'/'loss' des manches déjà jouées
    };
    saveManager.writeSave(freshSave);
    res.json({ save: freshSave });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/:set/save/:name/tournament/abandon', (req, res) => {
  const setId = requireValidSet(req, res);
  if (!setId) return;
  const save = saveManager.loadOrCreateSave(req.params.name, setId);
  save.tournament = null; // aucun remboursement des points d'entrée
  saveManager.writeSave(save);
  res.json({ save });
});

// ---------- État en mémoire ----------
const soloSessions = new Map();       // socket.id -> session (mode Solo)
const tournamentSessions = new Map(); // socket.id -> session (une manche de Tournoi)
const pvpRooms = new Map();           // roomCode -> room
const tradeRooms = new Map();         // roomCode -> room (échange de cartes/points entre 2 joueurs)

function genRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function defaultRules(rulesInput) {
  return {
    same: !!rulesInput?.same,
    plus: !!rulesInput?.plus,
    combo: !!rulesInput?.combo,
    suddenDeath: !!rulesInput?.suddenDeath,
    elemental: !!rulesInput?.elemental,
    wallAce: !!rulesInput?.wallAce,
    open: !!rulesInput?.open,
    random: !!rulesInput?.random,
  };
}

/** Choisit 5 cartes au hasard dans la collection réelle du joueur (règle "Aléatoire"). */
function pickRandomHandCardIds(collection) {
  const pool = [...collection];
  const hand = [];
  for (let i = 0; i < 5 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    hand.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return hand;
}

/**
 * Calcule le délai (ms) à laisser avant que l'IA ne joue après un coup du joueur, pour laisser le
 * temps aux animations client de se terminer avant d'enchaîner (flip 1s, + badge "Plus"/"Égal" 1s
 * si déclenché), plus une pause de lisibilité de 2,5s.
 */
function computeAiDelay(lastMove) {
  const READ_PAUSE = 2500;
  if (!lastMove) return READ_PAUSE;
  const hasSpecialTrigger = (lastMove.ruleTriggered === 'same' || lastMove.ruleTriggered === 'plus')
    && lastMove.flippedIndices && lastMove.flippedIndices.length > 0;
  if (hasSpecialTrigger) return 2000 + READ_PAUSE; // badge (1s) + flip (1s)
  if (lastMove.flippedIndices && lastMove.flippedIndices.length > 0) return 1000 + READ_PAUSE; // simple flip
  return READ_PAUSE;
}

function publicBoard(board) {
  return board; // déjà sérialisable
}

// ================= SOLO / TOURNOI / PVP =================

io.on('connection', (socket) => {

  socket.on('solo:start', ({ set, name, tier, opponentIndex, rules, tradeRule, deckCardIds }) => {
    try {
      if (!sets.isValidSet(set)) return socket.emit('error:msg', `Set inconnu: ${set}`);
      const save = saveManager.loadOrCreateSave(name, set);
      const opponentsForSet = sets.getOpponentsForSet(set);
      const tierData = opponentsForSet.find(t => t.tier === tier);
      if (!tierData) return socket.emit('error:msg', 'Palier invalide.');
      const opponent = tierData.opponents[opponentIndex];
      if (!opponent) return socket.emit('error:msg', 'Adversaire invalide.');

      // Certains adversaires imposent leurs propres règles et leur propre condition de victoire
      // (définies dans data/opponents*.json, champs "imposedRules"/"imposedTradeRule") : elles
      // remplacent alors intégralement le choix du joueur, côté serveur (source de vérité).
      const effectiveRulesInput = opponent.imposedRules || rules;
      const effectiveTradeRule = opponent.imposedTradeRule || tradeRule || 'one';

      const parsedRules = defaultRules(effectiveRulesInput);

      // Règle "Aléatoire" : les 5 cartes du joueur sont tirées au hasard dans sa collection réelle,
      // le deck choisi dans l'écran de configuration est alors ignoré.
      const actualDeckCardIds = parsedRules.random
        ? pickRandomHandCardIds(save.collection)
        : deckCardIds;

      if (!parsedRules.random) {
        // Vérifie que les 5 cartes choisies appartiennent bien à la collection du joueur
        const collectionCopy = [...save.collection];
        for (const id of actualDeckCardIds) {
          const idx = collectionCopy.indexOf(id);
          if (idx === -1) return socket.emit('error:msg', `Carte non possédée: ${id}`);
          collectionCopy.splice(idx, 1);
        }
        if (actualDeckCardIds.length !== 5) return socket.emit('error:msg', 'Il faut exactement 5 cartes.');
      }

      const handA = buildHand(actualDeckCardIds, 'A');  // joueur
      // Deck réellement distribué à l'IA : une carte légendaire déjà obtenue par CE joueur (ou ayant
      // migré chez un autre adversaire suite à une défaite passée) est remplacée par un substitut.
      const resolvedDeckB = legendaryRegistry.resolveOpponentDeck(set, opponent.deck, tier, opponentIndex, save.discovered || []);
      const handB = buildHand(resolvedDeckB, 'B');     // IA
      const startingPlayer = Math.random() < 0.5 ? 'A' : 'B';
      const cellElements = parsedRules.elemental ? assignRandomElements() : Array(9).fill(null);

      const session = {
        set,
        name,
        tier,
        opponentIndex,
        board: engine.createEmptyBoard(),
        hands: { A: handA, B: handB },
        originalDeck: { A: [...actualDeckCardIds], B: [...resolvedDeckB] },
        rules: parsedRules,
        cellElements,
        tradeRule: effectiveTradeRule,
        turn: startingPlayer,
        opponentName: opponent.name,
        aiDifficulty: opponent.ai,
      };
      soloSessions.set(socket.id, session);

      socket.emit('solo:state', {
        board: publicBoard(session.board),
        hands: session.hands,
        turn: session.turn,
        opponentName: session.opponentName,
        rules: session.rules,
        tradeRule: session.tradeRule,
        cellElements: session.cellElements,
      });

      if (startingPlayer === 'B') aiPlaySolo(socket, session);
    } catch (e) {
      socket.emit('error:msg', e.message);
    }
  });

  socket.on('solo:place', ({ instanceId, cellIndex }) => {
    const session = soloSessions.get(socket.id);
    if (!session) return socket.emit('error:msg', 'Aucune partie solo en cours.');
    if (session.turn !== 'A') return socket.emit('error:msg', 'Ce n\'est pas votre tour.');
    const lastMove = playMove(session, 'A', instanceId, cellIndex);
    socket.emit('solo:state', {
      board: publicBoard(session.board),
      hands: session.hands,
      turn: session.turn,
      rules: session.rules,
      cellElements: session.cellElements,
      tradeRule: session.tradeRule,
      lastMove,
    });
    if (finishIfBoardFull(socket, session, true)) return;
    aiPlaySolo(socket, session, computeAiDelay(lastMove));
  });

  socket.on('solo:cardChosen', ({ chosenCardIds }) => {
    const session = soloSessions.get(socket.id);
    if (!session || !session.pendingWin) return socket.emit('error:msg', 'Aucun choix en attente.');
    const { score, n } = session.pendingWin;
    if (!Array.isArray(chosenCardIds) || chosenCardIds.length !== n) {
      return socket.emit('error:msg', `Choisissez exactement ${n} carte(s).`);
    }
    const pool = [...session.originalDeck.B];
    for (const id of chosenCardIds) {
      const idx = pool.indexOf(id);
      if (idx === -1) return socket.emit('error:msg', 'Sélection invalide.');
      pool.splice(idx, 1);
    }
    delete session.pendingWin;
    finalizeSoloResult(socket, session, score, 'wins', chosenCardIds);
  });

  // ---------- TOURNOI ----------

  socket.on('tournament:playRound', ({ set, name }) => {
    try {
      if (!sets.isValidSet(set)) return socket.emit('error:msg', `Set inconnu: ${set}`);
      const save = saveManager.loadOrCreateSave(name, set);
      const t = save.tournament;
      if (!t || !t.active || t.finished) return socket.emit('error:msg', 'Aucun tournoi actif à jouer.');

      const opponentInfo = t.isDecider ? t.deciderOpponent : t.opponents[t.roundIndex];
      if (!opponentInfo) return socket.emit('error:msg', 'Manche introuvable.');

      const opponentsForSet = sets.getOpponentsForSet(set);
      const tierData = opponentsForSet.find(tr => tr.tier === opponentInfo.tier);
      const opponent = tierData && tierData.opponents[opponentInfo.opponentIndex];
      if (!opponent) return socket.emit('error:msg', 'Adversaire du tournoi introuvable.');

      // Règle "Aléatoire" : à chaque manche, les 5 cartes du joueur sont retirées au hasard dans sa
      // collection réelle (le deck choisi à l'entrée du tournoi est alors ignoré pour cette manche).
      const actualDeckCardIds = t.rules.random
        ? pickRandomHandCardIds(save.collection)
        : t.deckCardIds;

      const handA = buildHand(actualDeckCardIds, 'A');
      const resolvedDeckB = legendaryRegistry.resolveOpponentDeck(set, opponent.deck, opponentInfo.tier, opponentInfo.opponentIndex, save.discovered || []);
      const handB = buildHand(resolvedDeckB, 'B');
      const startingPlayer = Math.random() < 0.5 ? 'A' : 'B';
      const cellElements = t.rules.elemental ? assignRandomElements() : Array(9).fill(null);

      const session = {
        set,
        name,
        board: engine.createEmptyBoard(),
        hands: { A: handA, B: handB },
        rules: t.rules,
        cellElements,
        turn: startingPlayer,
        opponentName: opponent.name,
        aiDifficulty: opponent.ai,
        roundIndex: t.roundIndex,
        isDecider: t.isDecider,
      };
      tournamentSessions.set(socket.id, session);

      socket.emit('tournament:state', {
        board: publicBoard(session.board),
        hands: session.hands,
        turn: session.turn,
        rules: session.rules,
        cellElements: session.cellElements,
        opponentName: session.opponentName,
        bracket: t,
      });

      if (startingPlayer === 'B') aiPlayTournament(socket, session);
    } catch (e) {
      socket.emit('error:msg', e.message);
    }
  });

  socket.on('tournament:place', ({ instanceId, cellIndex }) => {
    const session = tournamentSessions.get(socket.id);
    if (!session) return socket.emit('error:msg', 'Aucune manche de tournoi en cours.');
    if (session.turn !== 'A') return socket.emit('error:msg', 'Ce n\'est pas votre tour.');
    const lastMove = playMove(session, 'A', instanceId, cellIndex);
    socket.emit('tournament:state', {
      board: publicBoard(session.board),
      hands: session.hands,
      turn: session.turn,
      rules: session.rules,
      cellElements: session.cellElements,
      lastMove,
    });
    if (finishTournamentIfBoardFull(socket, session)) return;
    aiPlayTournament(socket, session, computeAiDelay(lastMove));
  });

  socket.on('pvp:create', ({ set, playerName, rules, tradeRule, deckCardIds }) => {
    if (!sets.isValidSet(set)) return socket.emit('error:msg', `Set inconnu: ${set}`);
    const parsedRules = defaultRules(rules);
    if (!parsedRules.random) {
      const err = validatePvpDeck(playerName, set, deckCardIds);
      if (err) return socket.emit('error:msg', err);
    }

    const roomCode = genRoomCode();
    const room = {
      code: roomCode,
      set,
      rules: parsedRules,
      cellElements: parsedRules.elemental ? assignRandomElements() : Array(9).fill(null),
      tradeRule: tradeRule || 'one',
      players: [{ socketId: socket.id, name: playerName, deckCardIds, owner: 'A' }],
      board: engine.createEmptyBoard(),
      hands: {},
      started: false,
    };
    pvpRooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('pvp:created', { roomCode });
  });

  socket.on('pvp:join', ({ roomCode, playerName, deckCardIds }) => {
    const room = pvpRooms.get(roomCode);
    if (!room) return socket.emit('error:msg', 'Salon introuvable.');
    if (!room.rules.random) {
      const err = validatePvpDeck(playerName, room.set, deckCardIds);
      if (err) return socket.emit('error:msg', err);
    }
    if (room.players.length >= 2) return socket.emit('error:msg', 'Salon complet.');
    room.players.push({ socketId: socket.id, name: playerName, deckCardIds, owner: 'B' });
    socket.join(roomCode);

    // démarrage automatique dès que 2 joueurs sont présents
    const [p1, p2] = room.players;
    const save1 = saveManager.loadOrCreateSave(p1.name, room.set);
    const save2 = saveManager.loadOrCreateSave(p2.name, room.set);
    const actualDeckA = room.rules.random ? pickRandomHandCardIds(save1.collection) : p1.deckCardIds;
    const actualDeckB = room.rules.random ? pickRandomHandCardIds(save2.collection) : p2.deckCardIds;
    room.hands.A = buildHand(actualDeckA, 'A');
    room.hands.B = buildHand(actualDeckB, 'B');
    room.originalDeck = { A: [...actualDeckA], B: [...actualDeckB] };
    room.turn = Math.random() < 0.5 ? 'A' : 'B';
    room.started = true;

    io.to(roomCode).emit('pvp:start', {
      board: publicBoard(room.board),
      hands: room.hands,
      turn: room.turn,
      rules: room.rules,
      tradeRule: room.tradeRule,
      cellElements: room.cellElements,
      players: room.players.map(p => ({ name: p.name, owner: p.owner })),
    });
  });

  socket.on('pvp:place', ({ roomCode, instanceId, cellIndex }) => {
    const room = pvpRooms.get(roomCode);
    if (!room || !room.started) return socket.emit('error:msg', 'Partie introuvable.');
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return socket.emit('error:msg', 'Vous n\'êtes pas dans ce salon.');
    if (room.turn !== player.owner) return socket.emit('error:msg', 'Ce n\'est pas votre tour.');

    const lastMove = playMove(room, player.owner, instanceId, cellIndex);
    io.to(roomCode).emit('pvp:state', {
      board: publicBoard(room.board),
      hands: room.hands,
      turn: room.turn,
      cellElements: room.cellElements,
      rules: room.rules,
      tradeRule: room.tradeRule,
      lastMove,
    });

    if (engine.isBoardFull(room.board)) {
      const score = engine.countScore(room.board);
      io.to(roomCode).emit('pvp:gameover', { score, players: room.players.map(p => ({ name: p.name, owner: p.owner })) });
    }
  });

  // ---------- ÉCHANGE ENTRE JOUEURS ----------

  socket.on('trade:create', ({ set, playerName }) => {
    if (!sets.isValidSet(set)) return socket.emit('error:msg', `Set inconnu: ${set}`);
    if (!playerName) return socket.emit('error:msg', 'Nom de joueur manquant.');
    const roomCode = genRoomCode();
    const room = {
      code: roomCode,
      set,
      players: [{ socketId: socket.id, name: playerName, ready: false, offer: { cardId: null, points: 0 } }],
    };
    tradeRooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('trade:created', { roomCode });
  });

  socket.on('trade:join', ({ roomCode, playerName }) => {
    const room = tradeRooms.get(roomCode);
    if (!room) return socket.emit('error:msg', 'Salon d\'échange introuvable.');
    if (room.players.length >= 2) return socket.emit('error:msg', 'Salon complet.');
    if (!playerName) return socket.emit('error:msg', 'Nom de joueur manquant.');
    if (room.players.some(p => p.name === playerName)) return socket.emit('error:msg', 'Ce nom est déjà présent dans le salon.');
    room.players.push({ socketId: socket.id, name: playerName, ready: false, offer: { cardId: null, points: 0 } });
    socket.join(roomCode);
    broadcastTradeState(room);
  });

  socket.on('trade:setOffer', ({ roomCode, cardId, points }) => {
    const room = tradeRooms.get(roomCode);
    if (!room) return socket.emit('error:msg', 'Salon d\'échange introuvable.');
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return socket.emit('error:msg', 'Vous n\'êtes pas dans ce salon.');
    player.offer = { cardId: cardId || null, points: Math.max(0, Math.floor(Number(points)) || 0) };
    // toute modification d'offre annule les validations déjà données (protection anti "bait and switch")
    room.players.forEach(p => { p.ready = false; });
    broadcastTradeState(room);
  });

  socket.on('trade:ready', ({ roomCode }) => {
    const room = tradeRooms.get(roomCode);
    if (!room) return socket.emit('error:msg', 'Salon d\'échange introuvable.');
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return socket.emit('error:msg', 'Vous n\'êtes pas dans ce salon.');
    if (!player.offer.cardId && !player.offer.points) {
      return socket.emit('error:msg', 'Proposez au moins une carte ou des points avant de valider.');
    }
    player.ready = true;
    broadcastTradeState(room);

    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      executeTrade(room);
    }
  });

  socket.on('trade:unready', ({ roomCode }) => {
    const room = tradeRooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (player) player.ready = false;
    broadcastTradeState(room);
  });

  socket.on('trade:leave', ({ roomCode }) => {
    const room = tradeRooms.get(roomCode);
    if (!room) return;
    tradeRooms.delete(roomCode);
    io.to(roomCode).emit('trade:cancelled', { reason: 'L\'un des deux joueurs a quitté l\'échange.' });
  });

  socket.on('disconnect', () => {
    soloSessions.delete(socket.id);
    tournamentSessions.delete(socket.id);
    for (const [code, room] of pvpRooms.entries()) {
      if (room.players.some(p => p.socketId === socket.id)) {
        io.to(code).emit('error:msg', 'L\'adversaire s\'est déconnecté.');
        pvpRooms.delete(code);
      }
    }
    for (const [code, room] of tradeRooms.entries()) {
      if (room.players.some(p => p.socketId === socket.id)) {
        io.to(code).emit('trade:cancelled', { reason: 'L\'autre joueur s\'est déconnecté.' });
        tradeRooms.delete(code);
      }
    }
  });
});

// ---------- Helpers de jeu partagés ----------

// ---------- Échange entre joueurs ----------

function broadcastTradeState(room) {
  io.to(room.code).emit('trade:state', {
    players: room.players.map(p => ({ name: p.name, ready: p.ready, offer: p.offer })),
  });
}

function validateTradeOffer(player, setId) {
  const save = saveManager.loadOrCreateSave(player.name, setId);
  if (player.offer.cardId && !save.collection.includes(player.offer.cardId)) {
    throw new Error(`${player.name} ne possède plus la carte offerte.`);
  }
  if (player.offer.points && (save.points || 0) < player.offer.points) {
    throw new Error(`${player.name} n'a plus assez de points.`);
  }
}

/**
 * Exécute l'échange une fois les deux joueurs prêts : revalide les offres (au cas où la collection
 * ou le solde auraient changé entre-temps ailleurs), puis transfère cartes et points dans les deux
 * sens. En cas d'échec de validation, l'échange est annulé sans aucun effet (rien n'est modifié).
 */
function executeTrade(room) {
  const [p1, p2] = room.players;
  try {
    validateTradeOffer(p1, room.set);
    validateTradeOffer(p2, room.set);

    if (p1.offer.cardId) {
      saveManager.removeCardsFromSave(p1.name, room.set, [p1.offer.cardId]);
      saveManager.addCardsToSave(p2.name, room.set, [p1.offer.cardId]);
    }
    if (p2.offer.cardId) {
      saveManager.removeCardsFromSave(p2.name, room.set, [p2.offer.cardId]);
      saveManager.addCardsToSave(p1.name, room.set, [p2.offer.cardId]);
    }
    if (p1.offer.points) {
      saveManager.spendPoints(p1.name, room.set, p1.offer.points);
      saveManager.addPoints(p2.name, room.set, p1.offer.points);
    }
    if (p2.offer.points) {
      saveManager.spendPoints(p2.name, room.set, p2.offer.points);
      saveManager.addPoints(p1.name, room.set, p2.offer.points);
    }
  } catch (e) {
    room.players.forEach(p => { p.ready = false; });
    io.to(room.code).emit('error:msg', `Échange annulé : ${e.message}`);
    broadcastTradeState(room);
    return;
  }

  io.to(room.code).emit('trade:executed', {
    offers: room.players.map(p => ({ socketId: p.socketId, name: p.name, offer: p.offer })),
  });
  tradeRooms.delete(room.code);
}

function validatePvpDeck(playerName, setId, deckCardIds) {
  if (!playerName) return 'Nom de joueur manquant.';
  if (!Array.isArray(deckCardIds) || deckCardIds.length !== 5) return 'Il faut exactement 5 cartes.';
  const save = saveManager.loadOrCreateSave(playerName, setId);
  const collectionCopy = [...save.collection];
  for (const id of deckCardIds) {
    const idx = collectionCopy.indexOf(id);
    if (idx === -1) return `Carte non possédée: ${id}`;
    collectionCopy.splice(idx, 1);
  }
  return null;
}

function playMove(session, owner, instanceId, cellIndex) {
  const hand = session.hands[owner];
  const cardIdx = hand.findIndex(c => c.instanceId === instanceId);
  if (cardIdx === -1) throw new Error('Carte introuvable en main.');
  const [card] = hand.splice(cardIdx, 1);
  const cellElement = session.cellElements ? session.cellElements[cellIndex] : null;
  const effectiveCard = session.rules.elemental ? applyElementalAdjustment(card, cellElement) : card;
  const { board, flipped, ruleTriggered } = engine.placeCard(session.board, cellIndex, effectiveCard, session.rules);
  session.board = board;
  session.turn = engine.opponentOf(owner);
  return { cellIndex, ruleTriggered, flippedIndices: flipped };
}

function aiPlaySolo(socket, session, delay = 650) {
  if (session.turn !== 'B') return;
  setTimeout(() => {
    const hand = session.hands.B;
    if (hand.length === 0) return;
    const { cardIndexInHand, cellIndex } = chooseAIMove(session.board, hand, session.rules, session.aiDifficulty);
    const instanceId = hand[cardIndexInHand].instanceId;
    const lastMove = playMove(session, 'B', instanceId, cellIndex);
    socket.emit('solo:state', {
      board: publicBoard(session.board),
      hands: session.hands,
      turn: session.turn,
      rules: session.rules,
      cellElements: session.cellElements,
      tradeRule: session.tradeRule,
      lastMove,
    });
    finishIfBoardFull(socket, session, false);
  }, delay);
}

function finishIfBoardFull(socket, session, triggeredByPlayer) {
  if (!engine.isBoardFull(session.board)) return false;

  const score = engine.countScore(session.board);
  let result;
  if (score.A > score.B) result = 'wins';
  else if (score.A < score.B) result = 'losses';
  else result = 'draws';

  // Victoire du joueur avec une règle de mise "One" ou "Diff" : on lui laisse choisir sa carte.
  if (result === 'wins' && (session.tradeRule === 'one' || session.tradeRule === 'diff')) {
    const n = session.tradeRule === 'one' ? 1 : Math.max(1, Math.min(5, score.A - score.B));
    session.pendingWin = { score, n };
    socket.emit('solo:chooseCard', {
      options: session.originalDeck.B,
      count: n,
    });
    return true; // la partie n'est pas terminée tant que le choix n'est pas fait
  }

  finalizeSoloResult(socket, session, score, result, null);
  return true;
}

function finalizeSoloResult(socket, session, score, result, chosenGains) {
  let gains = [];
  let losses = [];

  if (result === 'wins') {
    if (chosenGains) {
      gains = chosenGains;
    } else {
      const trade = applyTradeRule(session.tradeRule, {
        winnerOriginalDeck: session.originalDeck.A,
        loserOriginalDeck: session.originalDeck.B,
        scoreWinner: score.A,
        scoreLoser: score.B,
      });
      if (trade.mode === 'direct') {
        gains = session.board.filter(c => c && c.owner === 'A' && session.originalDeck.B.includes(c.cardId)).map(c => c.cardId);
      } else {
        gains = trade.winnerGains;
      }
    }
    if (gains.length) saveManager.addCardsToSave(session.name, session.set, gains);
    // Une carte légendaire gagnée quitte définitivement le "monde" des adversaires IA.
    for (const cardId of gains) {
      if (legendaryRegistry.isLegendary(cardId)) legendaryRegistry.clearHolder(session.set, cardId);
    }
  } else if (result === 'losses') {
    const trade = applyTradeRule(session.tradeRule, {
      winnerOriginalDeck: session.originalDeck.B,
      loserOriginalDeck: session.originalDeck.A,
      scoreWinner: score.B,
      scoreLoser: score.A,
    });
    if (trade.mode === 'direct') {
      losses = session.board.filter(c => c && c.owner === 'B' && session.originalDeck.A.includes(c.cardId)).map(c => c.cardId);
    } else {
      losses = trade.winnerGains; // cartes prises par l'IA
    }
    if (losses.length) saveManager.removeCardsFromSave(session.name, session.set, losses);
    // Une carte légendaire perdue migre (temporairement) vers l'adversaire qui vient de la gagner.
    for (const cardId of losses) {
      if (legendaryRegistry.isLegendary(cardId)) legendaryRegistry.setHolder(session.set, cardId, session.tier, session.opponentIndex);
    }
  }

  saveManager.recordResult(session.name, session.set, result);

  let pointsAwarded = 0;
  if (result === 'wins' && session.tradeRule !== 'none') {
    // Récompense de victoire : 50 points par palier de l'adversaire affronté (ajustable ici).
    // Aucun point n'est attribué si la règle de mise "Aucune" est active (aucune récompense du tout).
    pointsAwarded = (session.tier || 1) * 50;
    saveManager.addPoints(session.name, session.set, pointsAwarded);
  }

  socket.emit('solo:gameover', { score, result, gains, losses, pointsAwarded });
  soloSessions.delete(socket.id);
}

// ---------- Tournoi : IA et fin de manche ----------

function aiPlayTournament(socket, session, delay = 650) {
  if (session.turn !== 'B') return;
  setTimeout(() => {
    const hand = session.hands.B;
    if (hand.length === 0) return;
    const { cardIndexInHand, cellIndex } = chooseAIMove(session.board, hand, session.rules, session.aiDifficulty);
    const instanceId = hand[cardIndexInHand].instanceId;
    const lastMove = playMove(session, 'B', instanceId, cellIndex);
    socket.emit('tournament:state', {
      board: publicBoard(session.board),
      hands: session.hands,
      turn: session.turn,
      rules: session.rules,
      cellElements: session.cellElements,
      lastMove,
    });
    finishTournamentIfBoardFull(socket, session);
  }, delay);
}

/**
 * Fin d'une manche de tournoi : aucune carte n'est jamais gagnée ni perdue pendant le tournoi
 * (uniquement les récompenses finales, définies plus tard). Cette fonction met à jour la progression
 * persistée dans la sauvegarde et détermine la suite (manche suivante, manche décisive, ou fin).
 */
function finishTournamentIfBoardFull(socket, session) {
  if (!engine.isBoardFull(session.board)) return false;

  const score = engine.countScore(session.board);
  const result = score.A > score.B ? 'win' : 'loss'; // égalité impossible sur 9 cases

  const save = saveManager.loadOrCreateSave(session.name, session.set);
  const t = save.tournament;
  if (!t) { socket.emit('error:msg', 'Progression de tournoi introuvable.'); return true; }

  t.results.push(result);

  let finished = false;
  let placement = null;

  if (session.isDecider) {
    finished = true;
    placement = result === 'win' ? 'third' : 'eliminated';
  } else if (session.roundIndex === 4) {
    // 5e manche
    finished = true;
    placement = result === 'win' ? 'champion' : 'second';
  } else if (result === 'loss' && session.roundIndex === 3) {
    // défaite en 4e manche : déclenche la manche décisive pour la 3e place
    const lostRoundInfo = t.opponents[3];
    t.deciderOpponent = tournament.pickDeciderOpponent(session.set, lostRoundInfo.tier, lostRoundInfo.opponentIndex);
    t.isDecider = true;
  } else if (result === 'loss') {
    // défaite avant la 4e manche : élimination directe, pas de manche décisive
    finished = true;
    placement = 'eliminated';
  } else {
    // victoire normale : on passe à la manche suivante
    t.roundIndex += 1;
  }

  t.finished = finished;
  t.placement = placement;
  t.active = !finished; // reste "actif" (reprenable) tant que ce n'est pas fini

  if (finished) {
    tournament.grantTournamentReward(placement, { name: session.name, setId: session.set, tierKey: t.tierKey }, saveManager);
  }

  saveManager.writeSave(save);

  socket.emit('tournament:matchOver', { score, result, bracket: save.tournament, finished, placement });
  tournamentSessions.delete(socket.id);
  return true;
}

const PORT = process.env.PORT || 5550;
server.listen(PORT, () => console.log(`Triple Triad server listening on http://localhost:${PORT}`));
