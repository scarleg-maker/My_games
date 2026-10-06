const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 16000;
const PUBLIC = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.static(PUBLIC));

const COLORS = ['bleu', 'rouge', 'jaune', 'vert', 'orange', 'violet', 'rose', 'marron', 'noir', 'blanc'];

// ================================================================ utilitaires salons
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set([
  'API', 'FAVICON', 'STYLE', 'ACCUEIL', 'MAITRE', 'JOUEUR',
  'JOUEUR1', 'JOUEUR2', 'JOUEUR3', 'JOUEUR4', 'JOUEUR5',
  'JOUEUR6', 'JOUEUR7', 'JOUEUR8', 'JOUEUR9', 'JOUEUR10',
  'ECRAN-UNIQUE', 'ECRANUNIQUE'
]);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L pour éviter les confusions
const ROOM_IDLE_MS = 6 * 3600 * 1000; // un salon inactif depuis 6h est supprimé
const MAX_ROOMS = 300;

const cleanCode = (c) => String(c || '').trim().toUpperCase();
const validCode = (c) => CODE_RE.test(c) && !RESERVED.has(c);

function newCode() {
  for (let len = 4; ; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && validCode(c)) return c;
    }
  }
}

// ================================================================ logique de jeu (partagée)
function emptyBoard(size) {
  const board = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push({ color: null, ownerId: null, damaged: false });
    board.push(row);
  }
  return board;
}

function inBounds(size, r, c) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

function checkWin(board, size, winLength) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = board[r][c];
      if (!cell.color) continue;
      for (const [dr, dc] of dirs) {
        const cells = [{ r, c }];
        let ok = true;
        for (let k = 1; k < winLength; k++) {
          const nr = r + dr * k, nc = c + dc * k;
          if (!inBounds(size, nr, nc) || board[nr][nc].color !== cell.color) { ok = false; break; }
          cells.push({ r: nr, c: nc });
        }
        if (ok) return { color: cell.color, cells };
      }
    }
  }
  return null;
}

function selectableOptions(current, board, options) {
  const isOwnHealthy = (opt) => {
    const cd = board[opt.row - 1][opt.col - 1];
    return !!cd.color && cd.ownerId === current.id && !cd.damaged;
  };
  const free = options.filter((o) => !isOwnHealthy(o));
  return free.length > 0 ? free : options;
}

function applyMove(board, current, row, col) {
  const r = row - 1, c = col - 1;
  const cell = board[r][c];
  let msg;
  if (!cell.color) {
    cell.color = current.color; cell.ownerId = current.id; cell.damaged = false;
    msg = `${current.name} place un pion ${current.color} en (${col},${row}).`;
  } else if (cell.ownerId === current.id) {
    if (cell.damaged) { cell.damaged = false; msg = `${current.name} récupère une vie sur son pion en (${col},${row}).`; }
    else msg = `${current.name} retombe sur son propre pion en (${col},${row}), tour passé.`;
  } else {
    if (!cell.damaged) { cell.damaged = true; msg = `${current.name} touche le pion ${cell.color} en (${col},${row}) : il perd une vie.`; }
    else {
      msg = `${current.name} capture la case (${col},${row}) : le pion ${cell.color} est remplacé par ${current.color} !`;
      cell.color = current.color; cell.ownerId = current.id; cell.damaged = false;
    }
  }
  return msg;
}

function cloneBoard(board) { return board.map((row) => row.map((cell) => ({ ...cell }))); }

function lineRunLength(board, size, r, c, color) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  let best = 1;
  for (const [dr, dc] of dirs) {
    let count = 1;
    let nr = r + dr, nc = c + dc;
    while (inBounds(size, nr, nc) && board[nr][nc].color === color) { count++; nr += dr; nc += dc; }
    nr = r - dr; nc = c - dc;
    while (inBounds(size, nr, nc) && board[nr][nc].color === color) { count++; nr -= dr; nc -= dc; }
    if (count > best) best = count;
  }
  return best;
}

function scoreOption(board, size, winLength, current, opt) {
  const r = opt.row - 1, c = opt.col - 1;
  const b2 = cloneBoard(board);
  const cell = b2[r][c];
  let score = 0, resultColor = null;
  if (!cell.color) {
    cell.color = current.color; cell.ownerId = current.id; cell.damaged = false; resultColor = current.color;
  } else if (cell.ownerId === current.id) {
    if (cell.damaged) { cell.damaged = false; resultColor = current.color; score += 8; }
  } else {
    if (!cell.damaged) {
      const oppRun = lineRunLength(b2, size, r, c, cell.color);
      cell.damaged = true;
      score += 5 + oppRun * 8;
    } else {
      score += 15;
      cell.color = current.color; cell.ownerId = current.id; cell.damaged = false; resultColor = current.color;
    }
  }
  if (resultColor === current.color) {
    const run = lineRunLength(b2, size, r, c, current.color);
    if (run >= winLength) score += 10000;
    else score += run * 10;
  }
  score += Math.random() * 2;
  return score;
}

// ================================================================ un salon = une partie indépendante
function createRoomController(code) {
  let state = null;
  let lastConfig = null;
  let pendingRollTimeout = null;
  let aiRollTimeout = null;
  let aiPlaceTimeout = null;
  let lastActivity = Date.now();

  const touch = () => { lastActivity = Date.now(); };

  function createGame(config) {
    const { players, boardSize, winLength } = config;
    const board = emptyBoard(boardSize);
    const startIndex = Math.floor(Math.random() * players.length);
    return {
      status: 'playing',
      players: players.map((p, i) => ({ id: 'p' + i, name: p.name, color: p.color, isAI: !!p.isAI })),
      boardSize, winLength, board,
      currentPlayerIndex: startIndex,
      pendingRoll: null,
      lastMessage: `${players[startIndex].name} commence la partie !`,
      winner: null, winningCells: []
    };
  }

  function broadcastState() { io.to(code).emit('state', state); }

  function sendInitial(socket) {
    if (lastConfig) socket.emit('setup:config', lastConfig);
    socket.emit('state', state);
  }

  function aiSelectOption() {
    const current = state.players[state.currentPlayerIndex];
    const options = selectableOptions(current, state.board, state.pendingRoll.options);
    let best = options[0], bestScore = -Infinity;
    for (const opt of options) {
      const s = scoreOption(state.board, state.boardSize, state.winLength, current, opt);
      if (s > bestScore) { bestScore = s; best = opt; }
    }
    return best;
  }

  function performRoll() {
    const size = state.boardSize;
    const d1 = 1 + Math.floor(Math.random() * size);
    const d2 = 1 + Math.floor(Math.random() * size);
    const options = [{ row: d1, col: d2 }];
    if (d1 !== d2) options.push({ row: d2, col: d1 });
    state.pendingRoll = { d1, d2, options, resolved: false };
    io.to(code).emit('game:rolling', { d1, d2, faces: size });
    clearTimeout(pendingRollTimeout);
    pendingRollTimeout = setTimeout(() => {
      if (!state || !state.pendingRoll) return;
      state.pendingRoll.resolved = true;
      broadcastState();
      maybeAIPlace();
    }, 2000);
  }

  function maybeAIRoll() {
    if (!state || state.status !== 'playing' || state.pendingRoll) return;
    const current = state.players[state.currentPlayerIndex];
    if (!current.isAI) return;
    clearTimeout(aiRollTimeout);
    aiRollTimeout = setTimeout(() => {
      if (!state || state.status !== 'playing' || state.pendingRoll) return;
      if (!state.players[state.currentPlayerIndex].isAI) return;
      performRoll();
    }, 800 + Math.random() * 500);
  }

  function maybeAIPlace() {
    if (!state || state.status !== 'playing' || !state.pendingRoll || !state.pendingRoll.resolved) return;
    const current = state.players[state.currentPlayerIndex];
    if (!current.isAI) return;
    clearTimeout(aiPlaceTimeout);
    aiPlaceTimeout = setTimeout(() => {
      if (!state || !state.pendingRoll || !state.pendingRoll.resolved) return;
      if (!state.players[state.currentPlayerIndex].isAI) return;
      const opt = aiSelectOption();
      commitPlacement(opt.row, opt.col);
    }, 900 + Math.random() * 600);
  }

  function commitPlacement(row, col) {
    const current = state.players[state.currentPlayerIndex];
    state.lastMessage = applyMove(state.board, current, row, col);
    state.pendingRoll = null;

    const win = checkWin(state.board, state.boardSize, state.winLength);
    if (win) {
      state.status = 'finished';
      const winPlayer = state.players.find((p) => p.color === win.color);
      state.winner = winPlayer ? winPlayer.name : win.color;
      state.winningCells = win.cells.map((cc) => ({ row: cc.r + 1, col: cc.c + 1 }));
      state.lastMessage = `${state.winner} a gagné la partie !`;
    } else {
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    }
    broadcastState();
    maybeAIRoll();
  }

  function handleSetupStart(config) {
    touch();
    try {
      const { players, boardSize, winLength } = config;
      if (!Array.isArray(players) || players.length < 2 || players.length > 10) return;
      if (![6, 7, 8, 9].includes(boardSize)) return;
      if (![3, 4].includes(winLength)) return;
      if (boardSize === 6 && winLength === 4) return;
      const usedColors = new Set();
      for (const p of players) {
        if (!p.name || !p.name.trim()) return;
        if (!COLORS.includes(p.color)) return;
        if (usedColors.has(p.color)) return;
        usedColors.add(p.color);
      }
      const normalizedPlayers = players.map((p, i) => ({
        name: p.name, color: p.color, isAI: i === 0 ? false : !!p.isAI
      }));
      lastConfig = { players: normalizedPlayers, boardSize, winLength };
      state = createGame(lastConfig);
      broadcastState();
      maybeAIRoll();
    } catch (e) { console.error(e); }
  }

  function handleRoll(socket) {
    touch();
    if (!state || state.status !== 'playing' || state.pendingRoll) return;
    if (state.players[state.currentPlayerIndex].isAI) return;
    if (!(socket.data.singleScreen || socket.data.playerIndex === state.currentPlayerIndex)) return;
    performRoll();
  }

  function handlePlace(socket, row, col) {
    touch();
    if (!state || state.status !== 'playing' || !state.pendingRoll || !state.pendingRoll.resolved) return;
    if (state.players[state.currentPlayerIndex].isAI) return;
    if (!(socket.data.singleScreen || socket.data.playerIndex === state.currentPlayerIndex)) return;
    const valid = state.pendingRoll.options.some((o) => o.row === row && o.col === col);
    if (!valid) return;
    const size = state.boardSize;
    if (!inBounds(size, row - 1, col - 1)) return;
    const current = state.players[state.currentPlayerIndex];
    const allowed = selectableOptions(current, state.board, state.pendingRoll.options);
    if (!allowed.some((o) => o.row === row && o.col === col)) return;
    commitPlacement(row, col);
  }

  function handleReset() {
    touch();
    if (!lastConfig) return;
    state = createGame(lastConfig);
    broadcastState();
    maybeAIRoll();
  }

  function handleEdit() {
    touch();
    state = null;
    io.to(code).emit('state', null);
    if (lastConfig) io.to(code).emit('setup:config', lastConfig);
  }

  function handleSetPlayerAI(playerIndex, isAI) {
    touch();
    if (!state || state.status !== 'playing') return;
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= state.players.length) return;
    if (playerIndex === 0) return;
    const player = state.players[playerIndex];
    const newIsAI = !!isAI;
    if (player.isAI === newIsAI) return;
    player.isAI = newIsAI;
    state.lastMessage = `${player.name} est maintenant ${newIsAI ? "contrôlé par l'IA" : 'un joueur humain'}.`;
    broadcastState();
    if (state.currentPlayerIndex === playerIndex) {
      if (!state.pendingRoll) maybeAIRoll();
      else if (state.pendingRoll.resolved) maybeAIPlace();
    }
  }

  function destroy() {
    clearTimeout(pendingRollTimeout);
    clearTimeout(aiRollTimeout);
    clearTimeout(aiPlaceTimeout);
  }

  function idleMs() { return Date.now() - lastActivity; }

  function infoSummary() {
    return {
      code,
      status: state ? state.status : 'setup',
      players: (state ? state.players : (lastConfig ? lastConfig.players : [])).map((p) => ({
        name: p.name, color: p.color, isAI: !!p.isAI
      }))
    };
  }

  return {
    code, touch, destroy, idleMs, sendInitial, infoSummary,
    handleSetupStart, handleRoll, handlePlace, handleReset, handleEdit, handleSetPlayerAI
  };
}

// ================================================================ registre des salons
const rooms = new Map(); // code -> controller

function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoomController(code);
  rooms.set(code, r);
  return r;
}

function purge(force) {
  for (const [code, r] of rooms) {
    const hasClients = (io.sockets.adapter.rooms.get(code) || new Set()).size > 0;
    if (force || (!hasClients && r.idleMs() > ROOM_IDLE_MS)) {
      r.destroy();
      rooms.delete(code);
    }
  }
}
setInterval(() => purge(false), 10 * 60 * 1000);

// ================================================================ HTTP
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'accueil.html')));

// anciennes adresses sans salon → accueil
app.get(/^\/(joueur([1-9]|10)|ecran-unique)$/i, (req, res) => res.redirect('/'));

app.post('/api/rooms', (req, res) => {
  const body = req.body || {};
  let code = body.code ? cleanCode(body.code) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres.' });
  if (rooms.has(code) && !body.reuse) {
    return res.json({ ok: false, error: `Le salon ${code} est déjà utilisé. Choisis un autre code ou rejoins-le.` });
  }
  getRoom(code, true);
  res.json({ ok: true, code });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const r = validCode(code) ? rooms.get(code) : null;
  if (!r) return res.json({ exists: false, code });
  res.json({ exists: true, ...r.infoSummary() });
});

app.get(/^\/([A-Z0-9]{3,10})\/joueur([1-9]|10)$/i, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon invalide');
  res.sendFile(path.join(PUBLIC, 'joueur.html'));
});

app.get(/^\/([A-Z0-9]{3,10})\/ecran-unique$/i, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon invalide');
  res.sendFile(path.join(PUBLIC, 'joueur.html'));
});

app.get(/^\/([A-Z0-9]{3,10})\/rejoindre$/i, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon invalide');
  res.sendFile(path.join(PUBLIC, 'accueil.html'));
});

app.get(/^\/([A-Z0-9]{3,10})$/i, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon invalide');
  res.sendFile(path.join(PUBLIC, 'maitre.html'));
});

// ================================================================ Socket.IO
io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.playerIndex = null;
  socket.data.singleScreen = false;

  socket.on('identify', (data) => {
    const code = cleanCode(data && data.code);
    if (!validCode(code)) return;
    const room = getRoom(code, true);
    socket.data.code = code;
    socket.join(code);
    room.touch();

    if (data.single) {
      socket.data.singleScreen = true;
      socket.data.playerIndex = null;
    } else if (Number.isInteger(data.playerNum) && data.playerNum >= 1 && data.playerNum <= 10) {
      socket.data.playerIndex = data.playerNum - 1;
      socket.data.singleScreen = false;
    }
    room.sendInitial(socket);
  });

  function currentRoom() {
    return socket.data.code ? rooms.get(socket.data.code) : null;
  }

  socket.on('setup:getConfig', () => {
    const room = currentRoom();
    if (room) room.sendInitial(socket);
  });

  socket.on('setup:start', (config) => {
    const room = currentRoom();
    if (room) room.handleSetupStart(config);
  });

  socket.on('game:roll', () => {
    const room = currentRoom();
    if (room) room.handleRoll(socket);
  });

  socket.on('game:place', ({ row, col }) => {
    const room = currentRoom();
    if (room) room.handlePlace(socket, row, col);
  });

  socket.on('game:reset', () => {
    const room = currentRoom();
    if (room) room.handleReset();
  });

  socket.on('game:edit', () => {
    const room = currentRoom();
    if (room) room.handleEdit();
  });

  socket.on('game:setPlayerAI', ({ playerIndex, isAI }) => {
    const room = currentRoom();
    if (room) room.handleSetPlayerAI(playerIndex, isAI);
  });
});

server.listen(PORT, () => {
  console.log(`Tic-Tac-Dice lancé sur http://localhost:${PORT}`);
  console.log(`Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
});
