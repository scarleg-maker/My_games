const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 2000;
const PUBLIC = path.join(__dirname, 'public');

app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(PUBLIC, { index: false }));

const THEMES_AVAILABLE = [
  "Prénom (Homme)", "Prénom (Femme)", "Animal", "Ville", "Pays", "Métier", "Fruit ou légume",
  "Objet", "Couleur", "Marque", "Film ou série", "Sport",
  "Instrument de musique", "Plante ou fleur", "Boisson",
  "Expression ou proverbe", "Personnage célèbre", "Capitale", "Monument"
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const REDRAW_PENALTY = 3;

// ================================================================ salons
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante.
const rooms = new Map();                                   // code -> { code, game, timers, lastActivity }
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'CONFIG', 'JOUEUR', 'MASTER', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'REJOINDRE', 'SOCKET', 'FAVICON']);
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sans 0/O, 1/I/L pour éviter les confusions
const ROOM_IDLE_MS = 6 * 3600 * 1000;                      // salon sans page ouverte depuis 6 h : supprimé
const MAX_ROOMS = 200;

const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d*$/.test(c);

function newCode() {
  for (let len = 4; ; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(c) && validCode(c)) return c;
    }
  }
}

function socketCount(roomName) {
  const r = io.sockets.adapter.rooms.get(roomName);
  return r ? r.size : 0;
}

function destroyRoom(room) {
  clearTimers(room);
  rooms.delete(room.code);
}

function purgeRooms(force) {
  for (const room of Array.from(rooms.values())) {
    if (socketCount(room.code) > 0) continue;
    if (force || Date.now() - room.lastActivity > ROOM_IDLE_MS) destroyRoom(room);
  }
}
setInterval(() => purgeRooms(false), 10 * 60 * 1000);

function touch(room) { room.lastActivity = Date.now(); }

// Temporisations rattachées au salon et à la partie en cours : elles s'annulent si la partie est remplacée ou le salon supprimé.
function later(room, ms, fn) {
  const g = room.game;
  const h = setTimeout(() => {
    room.timers.delete(h);
    if (rooms.get(room.code) !== room || room.game !== g || !g) return;
    fn();
  }, ms);
  room.timers.add(h);
  return h;
}
function clearTimers(room) {
  room.timers.forEach(clearTimeout);
  room.timers.clear();
}

// ================================================================ logique de jeu (par salon)
function emitAll(room, event, payload) { io.to(room.code).emit(event, payload); }

function notify(room, message, type = 'info') {
  emitAll(room, 'notification', { message, type });
}

function pickLetter(room) {
  const game = room.game;
  let pool = ALPHABET.filter(l => !game.usedLetters.includes(l));
  if (pool.length === 0) {
    game.usedLetters = [];
    pool = ALPHABET.slice();
    notify(room, "Toutes les lettres ont été tirées : la liste est réinitialisée.", 'info');
  }
  const letter = pool[Math.floor(Math.random() * pool.length)];
  game.usedLetters.push(letter);
  return letter;
}

function publicState(room) {
  const game = room && room.game;
  if (!game) return null;
  const now = Date.now();
  return {
    room: room.code,
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

function broadcastState(room) {
  emitAll(room, 'state', publicState(room));
}

function reviewPayload(room) {
  const game = room.game;
  if (!game || game.phase !== 'reviewing') return null;
  const theme = game.themes[game.reviewThemeIndex];
  const rows = game.players.map(p => ({
    playerId: p.id,
    name: p.name,
    answer: (game.answers[p.id] && game.answers[p.id][theme]) || ''
  }));
  return { theme, themeIndex: game.reviewThemeIndex, totalThemes: game.themes.length, rows };
}

function endActiveRound(room) {
  const game = room.game;
  if (!game || game.phase !== 'active') return;
  if (game.roundTimeoutHandle) {
    clearTimeout(game.roundTimeoutHandle);
    room.timers.delete(game.roundTimeoutHandle);
    game.roundTimeoutHandle = null;
  }
  game.phase = 'reviewing';
  game.reviewThemeIndex = 0;
  broadcastState(room);
  emitAll(room, 'review-data', reviewPayload(room));
}

// Tirage animé (2 s) puis affichage plein écran (3 s) puis phase "ready"
function runDrawSequence(room) {
  const game = room.game;
  game.letter = null;
  game.phase = 'drawing';
  game.drawEnd = Date.now() + 2000;
  broadcastState(room);

  later(room, 2000, () => {
    game.letter = pickLetter(room);
    game.phase = 'letter-reveal';
    broadcastState(room);

    later(room, 3000, () => {
      game.phase = 'ready';
      broadcastState(room);
    });
  });
}

// ================================================================ HTTP : API
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
    }
  }
  return out;
}

// Adresse à mettre dans le QR code : en local, « localhost » n'est pas joignable depuis un téléphone → adresse du réseau.
function originFor(req) {
  const host = req.hostname || '';
  const isLocal = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/.test(host);
  if (isLocal) {
    const lan = lanUrls();
    if (lan.length) return lan[0];
  }
  return `${req.protocol}://${req.get('host')}`;
}

function roomInfo(room, req) {
  const game = room.game;
  return {
    exists: true,
    code: room.code,
    configured: !!game,
    phase: game ? game.phase : null,
    round: game ? game.round : 0,
    joinUrl: `${originFor(req)}/${room.code}/rejoindre`,
    players: game
      ? game.players.map(p => ({ id: p.id, name: p.name, online: socketCount(`${room.code}:p${p.id}`) > 0 }))
      : []
  };
}

app.get('/api/themes', (req, res) => {
  res.json(THEMES_AVAILABLE);
});

app.post('/api/rooms', (req, res) => {
  const wanted = req.body && req.body.code ? cleanCode(req.body.code) : null;
  const code = wanted || newCode();
  if (!validCode(code)) {
    return res.status(400).json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres.' });
  }
  if (rooms.has(code)) {
    return res.status(409).json({ ok: false, error: `Le salon ${code} existe déjà. Choisis un autre code, ou rejoins-le.` });
  }
  if (rooms.size >= MAX_ROOMS) purgeRooms(true);
  if (rooms.size >= MAX_ROOMS) {
    return res.status(503).json({ ok: false, error: 'Trop de salons ouverts sur ce serveur.' });
  }
  rooms.set(code, { code, game: null, timers: new Set(), lastActivity: Date.now() });
  res.json({ ok: true, code });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) return res.json({ exists: false, code });
  res.json(roomInfo(room, req));
});

app.get('/api/rooms/:code/qr.svg', async (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) return res.status(404).end();
  try {
    const svg = await QRCode.toString(`${originFor(req)}/${code}/rejoindre`, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#10131a', light: '#ffffff' }
    });
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

app.post('/api/rooms/:code/setup', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) return res.status(404).json({ error: "Ce salon n'existe plus. Retourne à l'accueil." });

  const { playerNames, themes, timePerRound } = req.body || {};

  if (!Array.isArray(playerNames) || playerNames.length < 2 || playerNames.length > 25) {
    return res.status(400).json({ error: 'Nombre de joueurs invalide (2 à 25).' });
  }
  if (!Array.isArray(themes) || themes.length < 2 || themes.length > 10) {
    return res.status(400).json({ error: 'Nombre de thèmes invalide (2 à 10).' });
  }
  if (![30, 60, 90, 120, 150, 180].includes(Number(timePerRound))) {
    return res.status(400).json({ error: 'Temps invalide.' });
  }

  clearTimers(room);
  room.game = {
    players: playerNames.map((name, i) => ({
      id: i + 1,
      name: (name && String(name).trim()) || `Joueur ${i + 1}`,
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
  touch(room);

  res.json({ ok: true, numPlayers: room.game.players.length });
  broadcastState(room);
});

// ================================================================ HTTP : pages
const sendPage = (res, file) => res.sendFile(path.join(PUBLIC, file));

// Redirige vers l'accueil si le salon n'existe pas (ou a expiré)
function withRoom(file) {
  return (req, res) => {
    const code = cleanCode(req.params.code);
    if (!validCode(code) || !rooms.has(code)) {
      return res.redirect(`/?introuvable=${encodeURIComponent(code)}`);
    }
    touch(rooms.get(code));
    sendPage(res, file);
  };
}

app.get('/', (req, res) => sendPage(res, 'accueil.html'));

// anciennes adresses sans salon → accueil
app.get(['/master', '/maitre', '/arbitre'], (req, res) => res.redirect('/'));

app.get('/:code([A-Za-z0-9]{3,10})/rejoindre', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.redirect('/');
  sendPage(res, 'accueil.html');
});
app.get('/:code([A-Za-z0-9]{3,10})/config', withRoom('config.html'));
app.get('/:code([A-Za-z0-9]{3,10})/joueur:id(\\d+)', withRoom('joueur.html'));
app.get('/:code([A-Za-z0-9]{3,10})', withRoom('master.html'));

// ================================================================ temps réel
io.on('connection', (socket) => {
  const roomOf = () => {
    const room = rooms.get(socket.data.room);
    if (room) touch(room);
    return room;
  };

  function enter(code) {
    code = cleanCode(code);
    const room = validCode(code) ? rooms.get(code) : null;
    if (!room) { socket.emit('no-room'); return null; }
    if (socket.data.room && socket.data.room !== code) {
      socket.leave(socket.data.room);
    }
    socket.data.room = code;
    socket.join(code);
    touch(room);
    return room;
  }

  socket.on('join-master', ({ room: code } = {}) => {
    const room = enter(code);
    if (!room) return;
    socket.join(`${room.code}:master`);
    socket.emit('state', publicState(room));
    if (room.game && room.game.phase === 'reviewing') socket.emit('review-data', reviewPayload(room));
  });

  socket.on('join-player', ({ room: code, playerId } = {}) => {
    const room = enter(code);
    if (!room) return;
    socket.join(`${room.code}:p${playerId}`);
    socket.data.playerId = playerId;
    socket.emit('state', publicState(room));
    if (room.game && room.game.phase === 'reviewing') socket.emit('review-data', reviewPayload(room));
  });

  socket.on('draw-letter', () => {
    const room = roomOf();
    if (!room || !room.game) return;
    const game = room.game;
    game.round += 1;
    game.answers = {};
    game.players.forEach(p => { game.answers[p.id] = {}; });
    game.reviewThemeIndex = 0;
    game.roundResults = {};
    game.roundPoints = {};
    game.playersDone = new Set();
    game.timerEnd = null;
    game.countdownEnd = null;
    runDrawSequence(room);
  });

  socket.on('redraw-letter', () => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'ready') return;
    const game = room.game;
    const oldLetter = game.letter;
    game.players.forEach(p => { p.total = Math.max(0, p.total - REDRAW_PENALTY); });
    notify(room, `Nouvelle lettre demandée (lettre "${oldLetter}" écartée) : -${REDRAW_PENALTY} points pour tous les joueurs.`, 'penalty');
    runDrawSequence(room);
  });

  socket.on('start-round', () => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'ready') return;
    const game = room.game;
    game.phase = 'countdown';
    game.countdownEnd = Date.now() + 3000;
    broadcastState(room);

    later(room, 3000, () => {
      game.phase = 'active';
      game.timerEnd = Date.now() + game.timePerRound * 1000;
      game.playersDone = new Set();
      broadcastState(room);

      game.roundTimeoutHandle = later(room, game.timePerRound * 1000, () => {
        endActiveRound(room);
      });
    });
  });

  socket.on('update-answer', ({ playerId, theme, text } = {}) => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'active') return;
    const game = room.game;
    if (!game.answers[playerId]) game.answers[playerId] = {};
    game.answers[playerId][theme] = text;
  });

  // Relais en direct : à chaque clic de l'arbitre (avant la validation du thème), tout le salon voit la couleur.
  socket.on('review-live-status', ({ theme, playerId, status } = {}) => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'reviewing') return;
    if (theme !== room.game.themes[room.game.reviewThemeIndex]) return;
    emitAll(room, 'review-live-status', { theme, playerId, status });
  });

  socket.on('player-finished', ({ playerId } = {}) => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'active') return;
    const game = room.game;
    if (!game.playersDone) game.playersDone = new Set();
    game.playersDone.add(playerId);
    broadcastState(room);
    if (game.playersDone.size >= game.players.length) {
      endActiveRound(room);
    }
  });

  socket.on('validate-theme', ({ theme, results } = {}) => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'reviewing') return;
    const game = room.game;
    results = results || {};

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
      broadcastState(room);
      emitAll(room, 'review-data', reviewPayload(room));
    } else {
      game.players.forEach(p => {
        const pts = game.roundPoints[p.id] || 0;
        p.scores.push({
          letter: game.letter,
          points: pts,
          results: game.roundResults[p.id] || {}
        });
        p.total = Math.max(0, p.total + pts);
      });
      game.phase = 'round-summary';
      broadcastState(room);
    }
  });

  socket.on('next-round', () => {
    const room = roomOf();
    if (!room || !room.game || room.game.phase !== 'round-summary') return;
    room.game.phase = 'lobby';
    room.game.letter = null;
    broadcastState(room);
  });

  socket.on('end-game', () => {
    const room = roomOf();
    if (!room || !room.game) return;
    const game = room.game;
    const maxTotal = Math.max(...game.players.map(p => p.total));
    game.winner = game.players.filter(p => p.total === maxTotal).map(p => p.name);
    game.phase = 'finished';
    broadcastState(room);
  });

  socket.on('new-game', () => {
    const room = roomOf();
    if (!room) return;
    clearTimers(room);
    room.game = null;
    emitAll(room, 'reset');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Baccalauréat lancé !`);
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
