const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 2500;
const MAX_PLAYERS = 8;

app.use(express.static(path.join(__dirname, 'public')));

// Routes joueurs statiques /joueur1 .. /joueur8
for (let i = 1; i <= MAX_PLAYERS; i++) {
  app.get(`/joueur${i}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
  });
}
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// ---------------------------------------------------------------------
// Etat du jeu (une seule partie active à la fois, usage local)
// ---------------------------------------------------------------------
let game = null;

function resetGame() {
  game = {
    players: [],       // { id, name, score, socketId }
    theme: '',
    targetScore: 50,
    started: false,
    bmOrderIndex: 0,
    round: null,        // voir startRound()
  };
}
resetGame();

function currentBM() {
  return game.players[game.bmOrderIndex] || null;
}

function advanceBM() {
  game.bmOrderIndex = (game.bmOrderIndex + 1) % game.players.length;
}

function publicPlayers() {
  return game.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: !!p.socketId,
  }));
}

function masterState() {
  return {
    players: publicPlayers(),
    theme: game.theme,
    targetScore: game.targetScore,
    started: game.started,
  };
}

function roundSummaryForMaster() {
  const bm = currentBM();
  return {
    phase: game.round ? game.round.phase : null,
    bmName: bm ? bm.name : null,
    guessedCount: game.round ? Object.keys(game.round.guesses).length : 0,
    totalNeeded: game.players.length ? game.players.length - 1 : 0,
  };
}

// ---------------------------------------------------------------------
// Déroulement d'une manche
// ---------------------------------------------------------------------
function startRound() {
  const bm = currentBM();
  if (!bm) return;

  game.round = {
    phase: 'bm-announce',
    target: null,
    clue: '',
    guesses: {},
    lastResults: null,
  };

  game.players.forEach(p => {
    io.to(p.id).emit('round:bm-announced', {
      isYou: p.id === bm.id,
      bmName: bm.name,
    });
  });
  io.to('master').emit('round:bm-announced', { bmName: bm.name });
  io.to('master').emit('round:update', roundSummaryForMaster());

  setTimeout(() => {
    if (!game.round || game.round.phase !== 'bm-announce') return;
    game.round.phase = 'bm-turn';
    game.round.target = Math.floor(Math.random() * 101);

    io.to(bm.id).emit('round:your-turn', {
      target: game.round.target,
      theme: game.theme,
    });
    game.players.forEach(p => {
      if (p.id !== bm.id) {
        io.to(p.id).emit('round:waiting-bm', { bmName: bm.name, theme: game.theme });
      }
    });
    io.to('master').emit('round:update', roundSummaryForMaster());
  }, 2000);
}

function checkAllGuessed() {
  const bm = currentBM();
  const others = game.players.filter(p => p.id !== bm.id);
  const allGuessed = others.every(p => game.round.guesses[p.id] !== undefined);
  if (allGuessed) computeResults();
}

function computeResults() {
  const bm = currentBM();
  const target = game.round.target;
  const results = [];

  game.players.forEach(p => {
    if (p.id === bm.id) return;
    const guess = game.round.guesses[p.id];
    const diff = Math.abs(guess - target);
    let pts = 0;
    if (diff === 0) pts = 5;
    else if (diff <= 2) pts = 3;
    else if (diff <= 5) pts = 2;
    else if (diff <= 8) pts = 1;
    p.score += pts;
    results.push({ playerId: p.id, name: p.name, guess, points: pts });
  });

  game.round.phase = 'results';
  const winner = game.players.find(p => p.score >= game.targetScore) || null;

  const payload = {
    target,
    clue: game.round.clue,
    bmName: bm.name,
    bmId: bm.id,
    results,
    scores: publicPlayers(),
    gameOver: !!winner,
    winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
  };
  game.round.lastResults = payload;

  io.emit('round:results', payload);
  io.to('master').emit('round:results', payload);

  if (winner) {
    game.started = false;
  }
}

function sendRoundStateTo(socket, player) {
  if (!game.round) return;
  const bm = currentBM();
  const phase = game.round.phase;

  if (phase === 'bm-announce') {
    socket.emit('round:bm-announced', { isYou: player.id === bm.id, bmName: bm.name });
  } else if (phase === 'bm-turn') {
    if (player.id === bm.id) {
      socket.emit('round:your-turn', { target: game.round.target, theme: game.theme });
    } else {
      socket.emit('round:waiting-bm', { bmName: bm.name, theme: game.theme });
    }
  } else if (phase === 'guessing') {
    if (player.id === bm.id) {
      socket.emit('round:your-turn', { target: game.round.target, theme: game.theme, clueSent: true });
    } else if (game.round.guesses[player.id] === undefined) {
      socket.emit('round:clue', { clue: game.round.clue, theme: game.theme, bmName: bm.name });
    } else {
      socket.emit('player:guess-received');
    }
  } else if (phase === 'results' && game.round.lastResults) {
    socket.emit('round:results', game.round.lastResults);
  }
}

// ---------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------
io.on('connection', socket => {
  socket.on('master:join', () => {
    socket.join('master');
    socket.emit('game:state', masterState());
    if (game.round) {
      io.to('master').emit('round:update', roundSummaryForMaster());
      if (game.round.phase === 'results' && game.round.lastResults) {
        socket.emit('round:results', game.round.lastResults);
      }
    }
  });

  socket.on('master:configure', ({ numPlayers, names, theme, targetScore }) => {
    resetGame();
    const n = Math.max(2, Math.min(MAX_PLAYERS, parseInt(numPlayers, 10) || 2));
    game.theme = (theme || '').trim();
    game.targetScore = parseInt(targetScore, 10) || 50;
    for (let i = 0; i < n; i++) {
      const name = (names[i] || '').trim() || `Joueur ${i + 1}`;
      game.players.push({ id: `joueur${i + 1}`, name, score: 0, socketId: null });
    }
    io.to('master').emit('game:state', masterState());
  });

  socket.on('master:start', () => {
    if (!game.players.length) return;
    game.started = true;
    game.players.forEach(p => (p.score = 0));
    game.bmOrderIndex = Math.floor(Math.random() * game.players.length);
    io.emit('game:started', masterState());
    io.to('master').emit('game:state', masterState());
    startRound();
  });

  socket.on('player:join', ({ playerId }) => {
    const p = game.players.find(pl => pl.id === playerId);
    if (!p) {
      socket.emit('player:error', { message: 'La partie n\'est pas encore configurée pour ce joueur.' });
      return;
    }
    p.socketId = socket.id;
    socket.data.playerId = playerId;
    socket.join(playerId);
    socket.emit('player:joined', { name: p.name, theme: game.theme });
    io.to('master').emit('game:state', masterState());
    sendRoundStateTo(socket, p);
  });

  socket.on('bm:submit-clue', ({ clue }) => {
    const playerId = socket.data.playerId;
    const bm = currentBM();
    if (!game.round || game.round.phase !== 'bm-turn' || !bm || bm.id !== playerId) return;
    game.round.clue = (clue || '').trim();
    game.round.phase = 'guessing';
    game.players.forEach(p => {
      if (p.id !== bm.id) {
        io.to(p.id).emit('round:clue', { clue: game.round.clue, theme: game.theme, bmName: bm.name });
      }
    });
    io.to(bm.id).emit('bm:clue-sent');
    io.to('master').emit('round:update', roundSummaryForMaster());
  });

  socket.on('player:guess', ({ value }) => {
    const playerId = socket.data.playerId;
    const bm = currentBM();
    if (!game.round || game.round.phase !== 'guessing' || !bm || playerId === bm.id) return;
    if (game.round.guesses[playerId] !== undefined) return;
    const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    game.round.guesses[playerId] = v;
    io.to(playerId).emit('player:guess-received');
    io.to('master').emit('round:update', roundSummaryForMaster());
    checkAllGuessed();
  });

  socket.on('bm:next-round', () => {
    const playerId = socket.data.playerId;
    const bm = currentBM();
    if (!game.round || game.round.phase !== 'results' || !bm || bm.id !== playerId) return;
    if (!game.started) return; // partie terminée
    advanceBM();
    startRound();
  });

  socket.on('master:new-game', () => {
    resetGame();
    io.emit('game:reset');
    io.to('master').emit('game:state', masterState());
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId;
    if (playerId && game.players) {
      const p = game.players.find(pl => pl.id === playerId);
      if (p && p.socketId === socket.id) p.socketId = null;
      io.to('master').emit('game:state', masterState());
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur du jeu d'estimation lancé sur http://localhost:${PORT}`);
});
