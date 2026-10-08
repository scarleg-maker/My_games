const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 2500;
const MAX_PLAYERS = 8;
const ROOM_IDLE_MS = 6 * 3600 * 1000; // un salon vide depuis 6h est supprimé

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------------------------------------------------------------------
// Utilitaires salons
// ---------------------------------------------------------------------
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'CSS', 'JS', 'FAVICON', 'ACCUEIL', 'JOUEUR', 'MAITRE', 'STATIC']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L (évite les confusions)

const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-8]$/.test(c);

function newCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    if (!rooms.has(c) && validCode(c)) return c;
  }
  return 'R' + Date.now().toString(36).toUpperCase(); // secours improbable
}

function lanUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------
// Logique d'un salon (une partie indépendante)
// ---------------------------------------------------------------------
const rooms = new Map(); // code -> room

function createRoom(code) {
  const room = {
    code,
    players: [],       // { id, name, score, socketId }
    theme: '',
    targetScore: 50,
    started: false,
    bmOrderIndex: 0,
    round: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function touch(room) { room.lastActivity = Date.now(); }

function roomHasConnectedClients(room) {
  if (room.players.some(p => p.socketId)) return true;
  for (const [, s] of io.sockets.sockets) {
    if (s.data && s.data.code === room.code && s.data.isMaster) return true;
  }
  return false;
}

function purgeRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!roomHasConnectedClients(room) && now - room.lastActivity > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
}
setInterval(purgeRooms, 10 * 60 * 1000);

function currentBM(room) {
  return room.players[room.bmOrderIndex] || null;
}
function advanceBM(room) {
  room.bmOrderIndex = (room.bmOrderIndex + 1) % room.players.length;
}
function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: !!p.socketId,
  }));
}
function masterState(room) {
  return {
    code: room.code,
    players: publicPlayers(room),
    theme: room.theme,
    targetScore: room.targetScore,
    started: room.started,
  };
}
function roomInfoPublic(room) {
  return {
    exists: true,
    code: room.code,
    started: room.started,
    theme: room.theme,
    targetScore: room.targetScore,
    players: publicPlayers(room),
  };
}
function roundSummaryForMaster(room) {
  const bm = currentBM(room);
  return {
    phase: room.round ? room.round.phase : null,
    bmName: bm ? bm.name : null,
    guessedCount: room.round ? Object.keys(room.round.guesses).length : 0,
    totalNeeded: room.players.length ? room.players.length - 1 : 0,
  };
}

// Groupes Socket.io : `${code}` (tout le salon), `${code}:master`, `${code}:${playerId}`
const roomTopic = code => code;
const masterTopic = code => `${code}:master`;
const playerTopic = (code, playerId) => `${code}:${playerId}`;

// ---------------------------------------------------------------------
// Déroulement d'une manche (paramétré par room pour supporter plusieurs salons)
// ---------------------------------------------------------------------
function startRound(room) {
  const bm = currentBM(room);
  if (!bm) return;

  room.round = { phase: 'bm-announce', target: null, clue: '', guesses: {}, lastResults: null };

  room.players.forEach(p => {
    io.to(playerTopic(room.code, p.id)).emit('round:bm-announced', { isYou: p.id === bm.id, bmName: bm.name });
  });
  io.to(masterTopic(room.code)).emit('round:bm-announced', { bmName: bm.name });
  io.to(masterTopic(room.code)).emit('round:update', roundSummaryForMaster(room));

  setTimeout(() => {
    if (!room.round || room.round.phase !== 'bm-announce') return;
    room.round.phase = 'bm-turn';
    room.round.target = Math.floor(Math.random() * 101);

    io.to(playerTopic(room.code, bm.id)).emit('round:your-turn', { target: room.round.target, theme: room.theme });
    room.players.forEach(p => {
      if (p.id !== bm.id) {
        io.to(playerTopic(room.code, p.id)).emit('round:waiting-bm', { bmName: bm.name, theme: room.theme });
      }
    });
    io.to(masterTopic(room.code)).emit('round:update', roundSummaryForMaster(room));
  }, 2000);
}

function checkAllGuessed(room) {
  const bm = currentBM(room);
  const others = room.players.filter(p => p.id !== bm.id);
  const allGuessed = others.every(p => room.round.guesses[p.id] !== undefined);
  if (allGuessed) computeResults(room);
}

function computeResults(room) {
  const bm = currentBM(room);
  const target = room.round.target;
  const results = [];

  room.players.forEach(p => {
    if (p.id === bm.id) return;
    const guess = room.round.guesses[p.id];
    const diff = Math.abs(guess - target);
    let pts = 0;
    if (diff === 0) pts = 5;
    else if (diff <= 2) pts = 3;
    else if (diff <= 5) pts = 2;
    else if (diff <= 8) pts = 1;
    p.score += pts;
    results.push({ playerId: p.id, name: p.name, guess, points: pts });
  });

  room.round.phase = 'results';
  const winner = room.players.find(p => p.score >= room.targetScore) || null;

  const payload = {
    target,
    clue: room.round.clue,
    bmName: bm.name,
    bmId: bm.id,
    results,
    scores: publicPlayers(room),
    gameOver: !!winner,
    winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
  };
  room.round.lastResults = payload;

  io.to(roomTopic(room.code)).emit('round:results', payload);
  if (winner) room.started = false;
}

function sendRoundStateTo(socket, room, player) {
  if (!room.round) return;
  const bm = currentBM(room);
  const phase = room.round.phase;

  if (phase === 'bm-announce') {
    socket.emit('round:bm-announced', { isYou: player.id === bm.id, bmName: bm.name });
  } else if (phase === 'bm-turn') {
    if (player.id === bm.id) socket.emit('round:your-turn', { target: room.round.target, theme: room.theme });
    else socket.emit('round:waiting-bm', { bmName: bm.name, theme: room.theme });
  } else if (phase === 'guessing') {
    if (player.id === bm.id) {
      socket.emit('round:your-turn', { target: room.round.target, theme: room.theme, clueSent: true });
    } else if (room.round.guesses[player.id] === undefined) {
      socket.emit('round:clue', { clue: room.round.clue, theme: room.theme, bmName: bm.name });
    } else {
      socket.emit('player:guess-received');
    }
  } else if (phase === 'results' && room.round.lastResults) {
    socket.emit('round:results', room.round.lastResults);
  }
}

// ---------------------------------------------------------------------
// Routes HTTP
// ---------------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'accueil.html')));

app.get('/api/server-info', (req, res) => {
  res.json({ port: PORT, lanUrls: lanUrls() });
});

app.post('/api/rooms', (req, res) => {
  const body = req.body || {};
  let code = body.code ? cleanCode(body.code) : newCode();
  if (!validCode(code)) {
    return res.json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres.' });
  }
  if (rooms.has(code)) {
    return res.json({ ok: false, error: `Le salon « ${code} » est déjà utilisé.` });
  }
  createRoom(code);
  res.json({ ok: true, code });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) return res.json({ exists: false, code });
  res.json(roomInfoPublic(room));
});

// Page "rejoindre" avec le code pré-rempli (lien du QR code) -> même page que l'accueil
app.get(/^\/([A-Za-z0-9]{3,10})\/rejoindre$/, (req, res, next) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return next();
  res.sendFile(path.join(__dirname, 'public', 'accueil.html'));
});

// Page joueur : /CODE/joueur1 .. /CODE/joueur8
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur([1-8])$/, (req, res, next) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return next();
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

// Page maître d'un salon : /CODE
app.get(/^\/([A-Za-z0-9]{3,10})$/, (req, res, next) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return next();
  res.sendFile(path.join(__dirname, 'public', 'maitre.html'));
});

// ---------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------
io.on('connection', socket => {
  socket.on('master:join', ({ code }) => {
    code = cleanCode(code);
    const room = rooms.get(code);
    if (!room) { socket.emit('room:error', { message: "Ce salon n'existe plus." }); return; }
    socket.data.code = code;
    socket.data.isMaster = true;
    socket.join(roomTopic(code));
    socket.join(masterTopic(code));
    socket.emit('game:state', masterState(room));
    if (room.round) {
      socket.emit('round:update', roundSummaryForMaster(room));
      if (room.round.phase === 'results' && room.round.lastResults) socket.emit('round:results', room.round.lastResults);
    }
  });

  socket.on('master:configure', ({ code, numPlayers, names, theme, targetScore }) => {
    code = cleanCode(code);
    const room = rooms.get(code);
    if (!room) return;
    touch(room);
    room.players = [];
    room.started = false;
    room.round = null;
    const n = Math.max(2, Math.min(MAX_PLAYERS, parseInt(numPlayers, 10) || 2));
    room.theme = (theme || '').trim();
    room.targetScore = parseInt(targetScore, 10) || 50;
    for (let i = 0; i < n; i++) {
      const name = (names[i] || '').trim() || `Joueur ${i + 1}`;
      room.players.push({ id: `joueur${i + 1}`, name, score: 0, socketId: null });
    }
    io.to(masterTopic(code)).emit('game:state', masterState(room));
  });

  socket.on('master:start', ({ code }) => {
    code = cleanCode(code);
    const room = rooms.get(code);
    if (!room || !room.players.length) return;
    touch(room);
    room.started = true;
    room.players.forEach(p => (p.score = 0));
    room.bmOrderIndex = Math.floor(Math.random() * room.players.length);
    io.to(roomTopic(code)).emit('game:started', masterState(room));
    io.to(masterTopic(code)).emit('game:state', masterState(room));
    startRound(room);
  });

  socket.on('player:join', ({ code, playerId }) => {
    code = cleanCode(code);
    const room = rooms.get(code);
    if (!room) { socket.emit('player:error', { message: "Ce salon n'existe plus." }); return; }
    const p = room.players.find(pl => pl.id === playerId);
    if (!p) { socket.emit('player:error', { message: "La partie n'est pas encore configurée pour ce joueur." }); return; }
    touch(room);
    p.socketId = socket.id;
    socket.data.code = code;
    socket.data.playerId = playerId;
    socket.join(roomTopic(code));
    socket.join(playerTopic(code, playerId));
    socket.emit('player:joined', { name: p.name, theme: room.theme, code });
    io.to(masterTopic(code)).emit('game:state', masterState(room));
    sendRoundStateTo(socket, room, p);
  });

  socket.on('bm:submit-clue', ({ clue }) => {
    const { code, playerId } = socket.data;
    const room = code && rooms.get(code);
    if (!room) return;
    const bm = currentBM(room);
    if (!room.round || room.round.phase !== 'bm-turn' || !bm || bm.id !== playerId) return;
    touch(room);
    room.round.clue = (clue || '').trim();
    room.round.phase = 'guessing';
    room.players.forEach(p => {
      if (p.id !== bm.id) io.to(playerTopic(code, p.id)).emit('round:clue', { clue: room.round.clue, theme: room.theme, bmName: bm.name });
    });
    io.to(playerTopic(code, bm.id)).emit('bm:clue-sent');
    io.to(masterTopic(code)).emit('round:update', roundSummaryForMaster(room));
  });

  socket.on('player:guess', ({ value }) => {
    const { code, playerId } = socket.data;
    const room = code && rooms.get(code);
    if (!room) return;
    const bm = currentBM(room);
    if (!room.round || room.round.phase !== 'guessing' || !bm || playerId === bm.id) return;
    if (room.round.guesses[playerId] !== undefined) return;
    touch(room);
    const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    room.round.guesses[playerId] = v;
    io.to(playerTopic(code, playerId)).emit('player:guess-received');
    io.to(masterTopic(code)).emit('round:update', roundSummaryForMaster(room));
    checkAllGuessed(room);
  });

  socket.on('bm:next-round', () => {
    const { code, playerId } = socket.data;
    const room = code && rooms.get(code);
    if (!room) return;
    const bm = currentBM(room);
    if (!room.round || room.round.phase !== 'results' || !bm || bm.id !== playerId) return;
    if (!room.started) return; // partie terminée
    touch(room);
    advanceBM(room);
    startRound(room);
  });

  socket.on('master:new-game', ({ code }) => {
    code = cleanCode(code);
    const room = rooms.get(code);
    if (!room) return;
    room.players = [];
    room.started = false;
    room.round = null;
    room.theme = '';
    touch(room);
    io.to(roomTopic(code)).emit('game:reset');
    io.to(masterTopic(code)).emit('game:state', masterState(room));
  });

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (playerId) {
      const p = room.players.find(pl => pl.id === playerId);
      if (p && p.socketId === socket.id) p.socketId = null;
      io.to(masterTopic(code)).emit('game:state', masterState(room));
    }
    touch(room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Jeu d'estimation lancé !`);
  console.log(`   Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`   Depuis le réseau local                 : ${u}/`);
  console.log('');
});
