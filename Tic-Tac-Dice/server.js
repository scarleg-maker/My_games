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

// One dedicated page per player: /joueur1 .. /joueur6
app.get(/^\/joueur([1-6])$/, (req, res) => {
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
    players: players.map((p, i) => ({ id: 'p' + i, name: p.name, color: p.color })),
    boardSize,
    winLength,
    board,
    currentPlayerIndex: startIndex,
    pendingRoll: null, // { d1, d2, options: [{row,col}, ...] }
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

// ---------- Socket handling ----------
io.on('connection', (socket) => {
  socket.data.playerIndex = null; // 0-based index for a /joueurN page, null for master / unknown

  // Send current config (for master prefill) and current game state
  if (lastConfig) socket.emit('setup:config', lastConfig);
  if (state) socket.emit('state', publicState());

  socket.on('setup:getConfig', () => {
    if (lastConfig) socket.emit('setup:config', lastConfig);
  });

  socket.on('identify', ({ playerNum }) => {
    if (Number.isInteger(playerNum) && playerNum >= 1 && playerNum <= 6) {
      socket.data.playerIndex = playerNum - 1;
    }
  });

  socket.on('setup:start', (config) => {
    try {
      const { players, boardSize, winLength } = config;
      if (!Array.isArray(players) || players.length < 2 || players.length > 6) return;
      if (![6, 7, 8].includes(boardSize)) return;
      if (![3, 4].includes(winLength)) return;
      if (boardSize === 6 && winLength === 4) return; // forbidden combo
      const usedColors = new Set();
      for (const p of players) {
        if (!p.name || !p.name.trim()) return;
        if (!COLORS.includes(p.color)) return;
        if (usedColors.has(p.color)) return;
        usedColors.add(p.color);
      }
      lastConfig = { players, boardSize, winLength };
      state = createGame(lastConfig);
      broadcastState();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('game:roll', () => {
    if (!state || state.status !== 'playing' || state.pendingRoll) return;
    if (socket.data.playerIndex !== state.currentPlayerIndex) return; // only the active player's page can roll
    const size = state.boardSize;
    const d1 = 1 + Math.floor(Math.random() * size);
    const d2 = 1 + Math.floor(Math.random() * size);
    const options = [];
    options.push({ row: d1, col: d2 });
    if (d1 !== d2) options.push({ row: d2, col: d1 });
    state.pendingRoll = { d1, d2, options, resolved: false };
    io.emit('game:rolling', { d1, d2, faces: size });
    // Reveal after 2s animation, keep same values (already fixed for sync)
    setTimeout(() => {
      if (!state || !state.pendingRoll) return;
      state.pendingRoll.resolved = true;
      broadcastState();
    }, 2000);
  });

  socket.on('game:place', ({ row, col }) => {
    if (!state || state.status !== 'playing' || !state.pendingRoll || !state.pendingRoll.resolved) return;
    if (socket.data.playerIndex !== state.currentPlayerIndex) return; // only the active player's page can place
    const valid = state.pendingRoll.options.some((o) => o.row === row && o.col === col);
    if (!valid) return;

    const size = state.boardSize;
    const r = row - 1;
    const c = col - 1;
    if (!inBounds(size, r, c)) return;

    const current = state.players[state.currentPlayerIndex];

    // A player may not pick their own healthy (undamaged) pawn if another
    // option from this roll is available — unless they have no choice.
    const isOwnHealthy = (opt) => {
      const cd = state.board[opt.row - 1][opt.col - 1];
      return !!cd.color && cd.ownerId === current.id && !cd.damaged;
    };
    const chosenIsOwnHealthy = isOwnHealthy({ row, col });
    const hasAlternative = state.pendingRoll.options.some(
      (o) => !(o.row === row && o.col === col) && !isOwnHealthy(o)
    );
    if (chosenIsOwnHealthy && hasAlternative) return; // must choose the other option

    const cell = state.board[r][c];

    if (!cell.color) {
      // empty cell -> place pawn
      cell.color = current.color;
      cell.ownerId = current.id;
      cell.damaged = false;
      state.lastMessage = `${current.name} place un pion ${current.color} en (${col},${row}).`;
    } else if (cell.ownerId === current.id) {
      if (cell.damaged) {
        // owner restores their own damaged pawn
        cell.damaged = false;
        state.lastMessage = `${current.name} récupère une vie sur son pion en (${col},${row}).`;
      } else {
        state.lastMessage = `${current.name} retombe sur son propre pion en (${col},${row}), tour passé.`;
      }
    } else {
      // opponent's cell
      if (!cell.damaged) {
        cell.damaged = true;
        state.lastMessage = `${current.name} touche le pion ${cell.color} en (${col},${row}) : il perd une vie.`;
      } else {
        // capture
        state.lastMessage = `${current.name} capture la case (${col},${row}) : le pion ${cell.color} est remplacé par ${current.color} !`;
        cell.color = current.color;
        cell.ownerId = current.id;
        cell.damaged = false;
      }
    }

    state.pendingRoll = null;

    const win = checkWin(state.board, size, state.winLength);
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
  });

  socket.on('game:reset', () => {
    if (!lastConfig) return;
    state = createGame(lastConfig);
    broadcastState();
  });

  socket.on('game:edit', () => {
    state = null;
    io.emit('state', null);
    if (lastConfig) io.emit('setup:config', lastConfig);
  });
});

server.listen(PORT, () => {
  console.log(`Tic-Tac-Dice lancé sur http://localhost:${PORT}`);
  console.log(`Page maître : http://localhost:${PORT}/`);
  console.log(`Page joueur : http://localhost:${PORT}/joueur1`);
});
