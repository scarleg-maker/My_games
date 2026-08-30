const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 2000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const THEMES_AVAILABLE = [
  "Prénom (Homme)", "Prénom (Femme)", "Animal", "Ville", "Pays", "Métier", "Fruit ou légume",
  "Objet", "Couleur", "Marque", "Film ou série", "Sport",
  "Instrument de musique", "Plante ou fleur", "Boisson",
  "Expression ou proverbe", "Personnage célèbre", "Capitale", "Monument"
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const REDRAW_PENALTY = 3;

let game = null;

function notify(message, type = 'info') {
  io.emit('notification', { message, type });
}

function pickLetter() {
  let pool = ALPHABET.filter(l => !game.usedLetters.includes(l));
  if (pool.length === 0) {
    game.usedLetters = [];
    pool = ALPHABET.slice();
    notify("Toutes les lettres ont été tirées : la liste est réinitialisée.", 'info');
  }
  const letter = pool[Math.floor(Math.random() * pool.length)];
  game.usedLetters.push(letter);
  return letter;
}

function publicState() {
  if (!game) return null;
  const now = Date.now();
  return {
    phase: game.phase,
    round: game.round,
    letter: game.letter,
    themes: game.themes,
    timePerRound: game.timePerRound,
    timerRemainingMs: game.timerEnd ? Math.max(0, game.timerEnd - now) : null,
    countdownRemainingMs: game.countdownEnd ? Math.max(0, game.countdownEnd - now) : null,
    drawRemainingMs: game.drawEnd ? Math.max(0, game.drawEnd - now) : null,
    players: game.players.map(p => ({ id: p.id, name: p.name, scores: p.scores, total: p.total })),
    winner: game.winner,
    reviewThemeIndex: game.reviewThemeIndex,
    usedLetters: game.usedLetters,
    playersDone: Array.from(game.playersDone || [])
  };
}

function broadcastState() {
  io.emit('state', publicState());
}

function masterReviewPayload() {
  if (!game || game.phase !== 'reviewing') return null;
  const theme = game.themes[game.reviewThemeIndex];
  const rows = game.players.map(p => ({
    playerId: p.id,
    name: p.name,
    answer: (game.answers[p.id] && game.answers[p.id][theme]) || ''
  }));
  return { theme, themeIndex: game.reviewThemeIndex, totalThemes: game.themes.length, rows };
}

function endActiveRound() {
  if (!game || game.phase !== 'active') return;
  if (game.roundTimeoutHandle) {
    clearTimeout(game.roundTimeoutHandle);
    game.roundTimeoutHandle = null;
  }
  game.phase = 'reviewing';
  game.reviewThemeIndex = 0;
  broadcastState();
  io.emit('review-data', masterReviewPayload());
}

app.get('/api/themes', (req, res) => {
  res.json(THEMES_AVAILABLE);
});

app.post('/api/setup', (req, res) => {
  const { playerNames, themes, timePerRound } = req.body;

  if (!Array.isArray(playerNames) || playerNames.length < 2 || playerNames.length > 25) {
    return res.status(400).json({ error: 'Nombre de joueurs invalide (2 à 25).' });
  }
  if (!Array.isArray(themes) || themes.length < 2 || themes.length > 10) {
    return res.status(400).json({ error: 'Nombre de thèmes invalide (2 à 10).' });
  }
  if (![30, 60, 90, 120, 150, 180].includes(Number(timePerRound))) {
    return res.status(400).json({ error: 'Temps invalide.' });
  }

  game = {
    players: playerNames.map((name, i) => ({
      id: i + 1,
      name: (name && name.trim()) || `Joueur ${i + 1}`,
      scores: [],
      total: 0
    })),
    themes,
    timePerRound: Number(timePerRound),
    round: 0,
    letter: null,
    phase: 'lobby',
    answers: {},
    reviewThemeIndex: 0,
    roundResults: {},
    roundPoints: {},
    usedLetters: [],
    playersDone: new Set(),
    roundTimeoutHandle: null,
    timerEnd: null,
    countdownEnd: null,
    drawEnd: null,
    winner: null
  };

  res.json({ ok: true, numPlayers: game.players.length });
  broadcastState();
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

app.get('/joueur:id(\\d+)', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

io.on('connection', (socket) => {
  socket.on('join-master', () => {
    socket.join('master');
    socket.emit('state', publicState());
    if (game && game.phase === 'reviewing') socket.emit('review-data', masterReviewPayload());
  });

  socket.on('join-player', ({ playerId }) => {
    socket.join('player-' + playerId);
    socket.data.playerId = playerId;
    socket.emit('state', publicState());
    if (game && game.phase === 'reviewing') socket.emit('review-data', masterReviewPayload());
  });

  socket.on('draw-letter', () => {
    if (!game) return;
    game.round += 1;
    game.answers = {};
    game.players.forEach(p => { game.answers[p.id] = {}; });
    game.reviewThemeIndex = 0;
    game.roundResults = {};
    game.roundPoints = {};
    game.playersDone = new Set();
    game.letter = null;
    game.phase = 'drawing';
    game.drawEnd = Date.now() + 2000;
    broadcastState();

    setTimeout(() => {
      if (!game) return;
      game.letter = pickLetter();
      game.phase = 'letter-reveal';
      broadcastState();

      setTimeout(() => {
        if (!game) return;
        game.phase = 'ready';
        broadcastState();
      }, 3000);
    }, 2000);
  });

  socket.on('redraw-letter', () => {
    if (!game || game.phase !== 'ready') return;
    const oldLetter = game.letter;
    game.players.forEach(p => { p.total -= REDRAW_PENALTY; });
    notify(`Nouvelle lettre demandée (lettre "${oldLetter}" écartée) : -${REDRAW_PENALTY} points pour tous les joueurs.`, 'penalty');

    game.letter = null;
    game.phase = 'drawing';
    game.drawEnd = Date.now() + 2000;
    broadcastState();

    setTimeout(() => {
      if (!game) return;
      game.letter = pickLetter();
      game.phase = 'letter-reveal';
      broadcastState();

      setTimeout(() => {
        if (!game) return;
        game.phase = 'ready';
        broadcastState();
      }, 3000);
    }, 2000);
  });

  socket.on('start-round', () => {
    if (!game || game.phase !== 'ready') return;
    game.phase = 'countdown';
    game.countdownEnd = Date.now() + 3000;
    broadcastState();

    setTimeout(() => {
      if (!game) return;
      game.phase = 'active';
      game.timerEnd = Date.now() + game.timePerRound * 1000;
      game.playersDone = new Set();
      broadcastState();

      game.roundTimeoutHandle = setTimeout(() => {
        endActiveRound();
      }, game.timePerRound * 1000);
    }, 3000);
  });

  socket.on('update-answer', ({ playerId, theme, text }) => {
    if (!game || game.phase !== 'active') return;
    if (!game.answers[playerId]) game.answers[playerId] = {};
    game.answers[playerId][theme] = text;
  });

  // Live relay: as the referee clicks Correcte/Incomplète/Invalide (before validating
  // the theme), broadcast it immediately so every player sees the color update live.
  socket.on('review-live-status', ({ theme, playerId, status }) => {
    if (!game || game.phase !== 'reviewing') return;
    if (theme !== game.themes[game.reviewThemeIndex]) return;
    io.emit('review-live-status', { theme, playerId, status });
  });

  socket.on('player-finished', ({ playerId }) => {
    if (!game || game.phase !== 'active') return;
    if (!game.playersDone) game.playersDone = new Set();
    game.playersDone.add(playerId);
    broadcastState();
    if (game.playersDone.size >= game.players.length) {
      endActiveRound();
    }
  });

  socket.on('validate-theme', ({ theme, results }) => {
    if (!game || game.phase !== 'reviewing') return;

    game.players.forEach(p => {
      const status = results[p.id] || 'invalid';
      const pts = status === 'correct' ? 2 : status === 'incomplete' ? 1 : 0;
      game.roundPoints[p.id] = (game.roundPoints[p.id] || 0) + pts;
      if (!game.roundResults[p.id]) game.roundResults[p.id] = {};
      game.roundResults[p.id][theme] = {
        status,
        answer: (game.answers[p.id] && game.answers[p.id][theme]) || ''
      };
    });

    game.reviewThemeIndex += 1;
    if (game.reviewThemeIndex < game.themes.length) {
      broadcastState();
      io.emit('review-data', masterReviewPayload());
    } else {
      game.players.forEach(p => {
        const pts = game.roundPoints[p.id] || 0;
        p.scores.push({
          letter: game.letter,
          points: pts,
          results: game.roundResults[p.id] || {}
        });
        p.total += pts;
      });
      game.phase = 'round-summary';
      broadcastState();
    }
  });

  socket.on('next-round', () => {
    if (!game || game.phase !== 'round-summary') return;
    game.phase = 'lobby';
    game.letter = null;
    broadcastState();
  });

  socket.on('end-game', () => {
    if (!game) return;
    const maxTotal = Math.max(...game.players.map(p => p.total));
    const winners = game.players.filter(p => p.total === maxTotal).map(p => p.name);
    game.winner = winners;
    game.phase = 'finished';
    broadcastState();
  });

  socket.on('new-game', () => {
    game = null;
    io.emit('reset');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Baccalauréat lancé : http://localhost:${PORT}`);
});
