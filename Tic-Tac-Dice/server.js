const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 16000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maitre.html'));
});

// One dedicated page per player: /joueur1 .. /joueur10
app.get(/^\/joueur([1-9]|10)$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

// Single-screen mode: one shared screen where everyone plays in turn (pass & play)
app.get('/ecran-unique', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

const COLORS = ['bleu', 'rouge', 'jaune', 'vert', 'orange', 'violet', 'rose', 'marron', 'noir', 'blanc'];

// ---------- Game state ----------
let state = null; // will be built on setup
let lastConfig = null;

function emptyBoard(size) {
  const board = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push({ color: null, ownerId: null, damaged: false });
    }
    board.push(row);
  }
  return board;
}

function createGame(config) {
  const { players, boardSize, winLength } = config;
  const board = emptyBoard(boardSize);
  const startIndex = Math.floor(Math.random() * players.length);
  return {
    status: 'playing',
    players: players.map((p, i) => ({ id: 'p' + i, name: p.name, color: p.color, isAI: !!p.isAI })),
    boardSize,
    winLength,
    board,
    currentPlayerIndex: startIndex,
    pendingRoll: null, // { d1, d2, options: [{row,col}, ...], resolved }
    lastMessage: `${players[startIndex].name} commence la partie !`,
    winner: null,
    winningCells: []
  };
}

function inBounds(size, r, c) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

function checkWin(board, size, winLength) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = board[r][c];
      if (!cell.color) continue;
      for (const [dr, dc] of dirs) {
        const cells = [{ r, c }];
        let ok = true;
        for (let k = 1; k < winLength; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (!inBounds(size, nr, nc) || board[nr][nc].color !== cell.color) {
            ok = false;
            break;
          }
          cells.push({ r: nr, c: nc });
        }
        if (ok) {
          return { color: cell.color, cells };
        }
      }
    }
  }
  return null;
}

function publicState() {
  if (!state) return null;
  return state;
}

function broadcastState() {
  io.emit('state', publicState());
}

// ---------- Shared move rules (used by humans and the AI) ----------

// Among the rolled options, exclude the player's own healthy pawn unless
// it's the only option available (no real choice).
function selectableOptions(current, board, options) {
  const isOwnHealthy = (opt) => {
    const cd = board[opt.row - 1][opt.col - 1];
    return !!cd.color && cd.ownerId === current.id && !cd.damaged;
  };
  const free = options.filter((o) => !isOwnHealthy(o));
  return free.length > 0 ? free : options;
}

// Apply a move on the board (mutates it) and return a short log message.
function applyMove(board, current, row, col) {
  const r = row - 1;
  const c = col - 1;
  const cell = board[r][c];
  let msg;
  if (!cell.color) {
    cell.color = current.color;
    cell.ownerId = current.id;
    cell.damaged = false;
    msg = `${current.name} place un pion ${current.color} en (${col},${row}).`;
  } else if (cell.ownerId === current.id) {
    if (cell.damaged) {
      cell.damaged = false;
      msg = `${current.name} récupère une vie sur son pion en (${col},${row}).`;
    } else {
      msg = `${current.name} retombe sur son propre pion en (${col},${row}), tour passé.`;
    }
  } else {
    if (!cell.damaged) {
      cell.damaged = true;
      msg = `${current.name} touche le pion ${cell.color} en (${col},${row}) : il perd une vie.`;
    } else {
      msg = `${current.name} capture la case (${col},${row}) : le pion ${cell.color} est remplacé par ${current.color} !`;
      cell.color = current.color;
      cell.ownerId = current.id;
      cell.damaged = false;
    }
  }
  return msg;
}

// Commit a validated placement: mutate the board, check win, advance turn,
// broadcast, and kick off the next AI turn if needed.
function commitPlacement(row, col) {
  if (!state) return;
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

// ---------- Moderate AI ----------

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

function lineRunLength(board, size, r, c, color) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
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

// Score a candidate move for the "moderate" AI: favors winning moves,
// building its own lines, capturing, and damaging opponents who are
// close to their own alignment (a soft form of blocking).
function scoreOption(board, size, winLength, current, opt) {
  const r = opt.row - 1;
  const c = opt.col - 1;
  const b2 = cloneBoard(board);
  const cell = b2[r][c];
  let score = 0;
  let resultColor = null;

  if (!cell.color) {
    cell.color = current.color;
    cell.ownerId = current.id;
    cell.damaged = false;
    resultColor = current.color;
  } else if (cell.ownerId === current.id) {
    if (cell.damaged) {
      cell.damaged = false;
      resultColor = current.color;
      score += 8;
    }
    // landing on own healthy pawn: no-op, score stays 0
  } else {
    if (!cell.damaged) {
      const oppRun = lineRunLength(b2, size, r, c, cell.color);
      cell.damaged = true;
      score += 5 + oppRun * 8; // discourage opponents who are building a line
    } else {
      score += 15;
      cell.color = current.color;
      cell.ownerId = current.id;
      cell.damaged = false;
      resultColor = current.color;
    }
  }

  if (resultColor === current.color) {
    const run = lineRunLength(b2, size, r, c, current.color);
    if (run >= winLength) score += 10000; // winning move
    else score += run * 10;
  }

  // small randomness so the AI doesn't feel robotic on tied scores
  score += Math.random() * 2;
  return score;
}

function aiSelectOption() {
  const current = state.players[state.currentPlayerIndex];
  const options = selectableOptions(current, state.board, state.pendingRoll.options);
  let best = options[0];
  let bestScore = -Infinity;
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
  io.emit('game:rolling', { d1, d2, faces: size });
  setTimeout(() => {
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
  setTimeout(() => {
    if (!state || state.status !== 'playing' || state.pendingRoll) return;
    const stillCurrent = state.players[state.currentPlayerIndex];
    if (!stillCurrent.isAI) return;
    performRoll();
  }, 800 + Math.random() * 500);
}

function maybeAIPlace() {
  if (!state || state.status !== 'playing' || !state.pendingRoll || !state.pendingRoll.resolved) return;
  const current = state.players[state.currentPlayerIndex];
  if (!current.isAI) return;
  setTimeout(() => {
    if (!state || !state.pendingRoll || !state.pendingRoll.resolved) return;
    const stillCurrent = state.players[state.currentPlayerIndex];
    if (!stillCurrent.isAI) return;
    const opt = aiSelectOption();
    commitPlacement(opt.row, opt.col);
  }, 900 + Math.random() * 600);
}

// ---------- Socket handling ----------
io.on('connection', (socket) => {
  socket.data.playerIndex = null; // 0-based index for a /joueurN page, null for master / unknown
  socket.data.singleScreen = false; // true for the shared /ecran-unique page

  // Send current config (for master prefill) and current game state
  if (lastConfig) socket.emit('setup:config', lastConfig);
  if (state) socket.emit('state', publicState());

  socket.on('setup:getConfig', () => {
    if (lastConfig) socket.emit('setup:config', lastConfig);
  });

  socket.on('identify', ({ playerNum, single }) => {
    if (single) {
      socket.data.singleScreen = true;
      socket.data.playerIndex = null;
    } else if (Number.isInteger(playerNum) && playerNum >= 1 && playerNum <= 10) {
      socket.data.playerIndex = playerNum - 1;
      socket.data.singleScreen = false;
    }
  });

  socket.on('setup:start', (config) => {
    try {
      const { players, boardSize, winLength } = config;
      if (!Array.isArray(players) || players.length < 2 || players.length > 10) return;
      if (![6, 7, 8, 9].includes(boardSize)) return;
      if (![3, 4].includes(winLength)) return;
      if (boardSize === 6 && winLength === 4) return; // forbidden combo
      const usedColors = new Set();
      for (const p of players) {
        if (!p.name || !p.name.trim()) return;
        if (!COLORS.includes(p.color)) return;
        if (usedColors.has(p.color)) return;
        usedColors.add(p.color);
      }
      // Player 1 (index 0) always stays human so there is always at least one human.
      const normalizedPlayers = players.map((p, i) => ({
        name: p.name,
        color: p.color,
        isAI: i === 0 ? false : !!p.isAI
      }));
      lastConfig = { players: normalizedPlayers, boardSize, winLength };
      state = createGame(lastConfig);
      broadcastState();
      maybeAIRoll();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('game:roll', () => {
    if (!state || state.status !== 'playing' || state.pendingRoll) return;
    if (state.players[state.currentPlayerIndex].isAI) return; // AI plays on its own
    if (!(socket.data.singleScreen || socket.data.playerIndex === state.currentPlayerIndex)) return;
    performRoll();
  });

  socket.on('game:place', ({ row, col }) => {
    if (!state || state.status !== 'playing' || !state.pendingRoll || !state.pendingRoll.resolved) return;
    if (state.players[state.currentPlayerIndex].isAI) return; // AI plays on its own
    if (!(socket.data.singleScreen || socket.data.playerIndex === state.currentPlayerIndex)) return;

    const valid = state.pendingRoll.options.some((o) => o.row === row && o.col === col);
    if (!valid) return;

    const size = state.boardSize;
    const r = row - 1;
    const c = col - 1;
    if (!inBounds(size, r, c)) return;

    const current = state.players[state.currentPlayerIndex];
    const allowed = selectableOptions(current, state.board, state.pendingRoll.options);
    const isAllowed = allowed.some((o) => o.row === row && o.col === col);
    if (!isAllowed) return; // must choose an allowed option (no-choice exception handled by selectableOptions)

    commitPlacement(row, col);
  });

  socket.on('game:reset', () => {
    if (!lastConfig) return;
    state = createGame(lastConfig);
    broadcastState();
    maybeAIRoll();
  });

  socket.on('game:edit', () => {
    state = null;
    io.emit('state', null);
    if (lastConfig) io.emit('setup:config', lastConfig);
  });

  // Master page: switch a player between human and AI control, mid-game.
  // Player 1 (index 0) can never be turned into an AI.
  socket.on('game:setPlayerAI', ({ playerIndex, isAI }) => {
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
  });
});

server.listen(PORT, () => {
  console.log(`Tic-Tac-Dice lancé sur http://localhost:${PORT}`);
  console.log(`Page maître : http://localhost:${PORT}/`);
  console.log(`Page joueur : http://localhost:${PORT}/joueur1`);
});
