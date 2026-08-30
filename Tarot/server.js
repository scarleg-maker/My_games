const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, BID_LABELS, CONFIG, cardLabel } = require('./lib/game');
const AI = require('./lib/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map(); // roomId -> Game
const socketRoom = new Map(); // socketId -> roomId
const socketJoueur = new Map(); // socketId -> joueurId

function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function broadcast(room) {
  for (const p of room.joueurs) {
    const sockets = [...socketRoom.entries()].filter(([sid, rid]) => rid === room.roomId && socketJoueur.get(sid) === p.id);
    for (const [sid] of sockets) {
      io.to(sid).emit('state', room.publicState(p.id));
    }
  }
}

function sendError(socket, message) {
  socket.emit('errorMsg', message);
}

// ---------- AI joueurs ----------
function performAIAction(game) {
  const phase = game.phase;

  if (phase === 'bidding') {
    const pid = game.currentBidder();
    const joueur = game.joueurs.find((p) => p.id === pid);
    if (joueur && joueur.isAI) {
      game.placeBid(pid, AI.chooseBid(game, pid, game.aiDifficulty));
      return true;
    }
    return false;
  }

  if (phase === 'chien') {
    const joueur = game.joueurs.find((p) => p.id === game.taker);
    if (joueur && joueur.isAI) {
      game.submitChienDiscard(game.taker, AI.chooseDiscard(game, game.taker, game.aiDifficulty));
      return true;
    }
    return false;
  }

  if (phase === 'calling') {
    const joueur = game.joueurs.find((p) => p.id === game.taker);
    if (joueur && joueur.isAI) {
      game.callKing(game.taker, AI.chooseKing(game, game.taker));
      return true;
    }
    return false;
  }

  if (phase === 'poignee') {
    const pending = game.joueurs.find((p) => p.isAI && !game.readySet.has(p.id));
    if (pending) {
      const decision = AI.choosePoignee(game, pending.id, game.aiDifficulty);
      if (decision) {
        try { game.declarePoignee(pending.id, decision); } catch (e) { /* ignore, just skip poignée */ }
      }
      if (!game.chelemAnnonce && AI.shouldAnnounceChelem(game, pending.id, game.aiDifficulty)) {
        try { game.announceChelem(pending.id); } catch (e) { /* ignore */ }
      }
      game.confirmReady(pending.id);
      return true;
    }
    return false;
  }

  if (phase === 'playing') {
    const current = game.joueurs[game.turnIndex];
    if (current && current.isAI) {
      const cardId = AI.chooseCard(game, current.id, game.aiDifficulty);
      game.playCard(current.id, cardId);
      return true;
    }
    return false;
  }

  return false;
}

function aiTick(game) {
  let acted = false;
  try {
    acted = performAIAction(game);
  } catch (e) {
    console.error('Erreur IA:', e.message);
  }
  if (acted) {
    broadcast(game);
    setTimeout(() => aiTick(game), 600 + Math.random() * 700);
  }
}

io.on('connection', (socket) => {
  socket.emit('meta', { bidLabels: BID_LABELS, config: CONFIG });

  socket.on('createRoom', ({ name, nombreJoueurs }) => {
    try {
      const count = Math.min(5, Math.max(3, parseInt(nombreJoueurs, 10) || 4));
      const roomId = makeRoomId();
      const game = new Game(roomId, count);
      const joueurId = socket.id;
      game.addJoueur(joueurId, (name || 'Joueur').slice(0, 20));
      rooms.set(roomId, game);
      socketRoom.set(socket.id, roomId);
      socketJoueur.set(socket.id, joueurId);
      socket.join(roomId);
      socket.emit('joined', { roomId, joueurId });
      broadcast(game);
    } catch (e) {
      sendError(socket, e.message);
    }
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    try {
      roomId = (roomId || '').toUpperCase().trim();
      const game = rooms.get(roomId);
      if (!game) throw new Error("Ce salon n'existe pas.");
      const joueurId = socket.id;
      game.addJoueur(joueurId, (name || 'Joueur').slice(0, 20));
      socketRoom.set(socket.id, roomId);
      socketJoueur.set(socket.id, joueurId);
      socket.join(roomId);
      socket.emit('joined', { roomId, joueurId });
      broadcast(game);
    } catch (e) {
      sendError(socket, e.message);
    }
  });

  socket.on('reconnectRoom', ({ roomId, joueurId }) => {
    const game = rooms.get((roomId || '').toUpperCase().trim());
    if (!game) return sendError(socket, "Ce salon n'existe plus.");
    if (!game.joueurs.find((p) => p.id === joueurId)) return sendError(socket, 'Joueur inconnu dans ce salon.');
    game.setConnected(joueurId, true);
    socketRoom.set(socket.id, game.roomId);
    socketJoueur.set(socket.id, joueurId);
    socket.join(game.roomId);
    socket.emit('joined', { roomId: game.roomId, joueurId });
    broadcast(game);
  });

  function withGame(fn) {
    return (payload) => {
      const roomId = socketRoom.get(socket.id);
      const joueurId = socketJoueur.get(socket.id);
      const game = rooms.get(roomId);
      if (!game) return sendError(socket, "Salon introuvable.");
      try {
        fn(game, joueurId, payload || {});
        broadcast(game);
        aiTick(game);
      } catch (e) {
        sendError(socket, e.message);
      }
    };
  }

  socket.on('addAI', withGame((game) => game.addJoueurIA()));
  socket.on('removeAI', withGame((game, joueurId, { aiId }) => game.removeJoueurIA(aiId)));
  socket.on('setAIDifficulty', withGame((game, joueurId, { level }) => game.setAIDifficulty(level)));

  socket.on('startHand', withGame((game) => {
    if (!game.canStart()) throw new Error("La table n'est pas complète.");
    game.startHand();
  }));

  socket.on('redeal', withGame((game) => {
    if (game.phase !== 'all_passed') throw new Error('Rien à redistribuer.');
    game.startHand();
  }));

  socket.on('bid', withGame((game, joueurId, { level }) => game.placeBid(joueurId, level)));
  socket.on('discardChien', withGame((game, joueurId, { cardIds }) => game.submitChienDiscard(joueurId, cardIds || [])));
  socket.on('callKing', withGame((game, joueurId, { suit }) => game.callKing(joueurId, suit)));
  socket.on('declarePoignee', withGame((game, joueurId, { cardIds }) => game.declarePoignee(joueurId, cardIds || [])));
  socket.on('announceChelem', withGame((game, joueurId) => game.announceChelem(joueurId)));
  socket.on('confirmReady', withGame((game, joueurId) => game.confirmReady(joueurId)));
  socket.on('playCard', withGame((game, joueurId, { cardId }) => game.playCard(joueurId, cardId)));
  socket.on('nextHand', withGame((game) => {
    if (game.phase !== 'scoring') throw new Error('La manche est en cours.');
    game.startHand();
  }));

  socket.on('disconnect', () => {
    const roomId = socketRoom.get(socket.id);
    const joueurId = socketJoueur.get(socket.id);
    const game = rooms.get(roomId);
    if (game && joueurId) {
      const stillConnected = [...socketJoueur.entries()].some(([sid, pid]) => sid !== socket.id && pid === joueurId);
      if (!stillConnected) {
        game.setConnected(joueurId, false);
        broadcast(game);
      }
    }
    socketRoom.delete(socket.id);
    socketJoueur.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tarot server listening on http://localhost:${PORT}`));
