const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 8000;
const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const IMAGES_POOL_DIR = path.join(__dirname, 'images_pool');
const UPLOAD_TMP_DIR = path.join(__dirname, 'uploads_tmp');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_POOL_DIR)) fs.mkdirSync(IMAGES_POOL_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_TMP_DIR)) fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/images_pool', express.static(IMAGES_POOL_DIR));

// ---------- Persistence des noms des joueurs ----------
function loadPlayersData() {
  try {
    return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  } catch (e) {
    return { lastNames: [], allNamesEver: [] };
  }
}
function savePlayersData(data) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

// ---------- Etat du jeu ----------
let game = null; // objet game courant, null tant que non démarré

function computeGrid(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { rows, cols };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickImagePool(numImages) {
  const files = fs.readdirSync(IMAGES_POOL_DIR).filter(f =>
    /\.(png|jpe?g|gif|webp)$/i.test(f)
  );
  const chosen = shuffle(files).slice(0, numImages);
  return chosen;
}

function buildBoardFromImages(imageFiles) {
  const order = shuffle(imageFiles);
  return order.map(filename => ({
    filename,
    bombs: [], // liste des index joueurs ayant posé une bombe ici
    taken: false,
    takenBy: null,
    isBomb: false,
  }));
}

function startNewRound(resetBoardOrder = true) {
  const activeIdx = game.players.filter(p => !p.eliminated).map(p => p.index);
  game.players.forEach(p => {
    if (p.eliminated) return;
    p.ready = false;
    p.bombsRemaining = game.config.numBombs;
    p.myBombs = [];
    p.drawnCards = [];
    p.complete = false;
  });
  if (resetBoardOrder) {
    game.board = buildBoardFromImages(game.imageSet);
  } else {
    game.board.forEach(c => { c.bombs = []; c.taken = false; c.takenBy = null; c.isBomb = false; });
  }
  game.phase = 'placement';
  game.drawOrder = [];
  game.currentTurnIndex = 0;
  game.roundNumber += 1;
  game.roundWinnersOfRound = [];
  game.lastReveal = null;
  game.turnLocked = false;
}

function allActivePlayers() {
  return game.players.filter(p => !p.eliminated);
}

function checkAllValidated() {
  const active = allActivePlayers();
  if (active.length > 0 && active.every(p => p.ready)) {
    // passage en phase de tirage
    game.drawOrder = shuffle(active.map(p => p.index));
    game.currentTurnIndex = 0;
    game.phase = 'draw';
  }
}

function nextAvailableTurnIndex(startFrom) {
  const n = game.drawOrder.length;
  if (n === 0) return -1;
  for (let step = 0; step < n; step++) {
    const idx = (startFrom + step) % n;
    const pIdx = game.drawOrder[idx];
    const player = game.players[pIdx];
    if (!player.complete && !player.eliminated) return idx;
  }
  return -1;
}

function boardHasAvailableCards() {
  return game.board.some(c => !c.taken);
}

function checkRoundEnd() {
  const active = allActivePlayers();
  const allComplete = active.length > 0 && active.every(p => p.complete);
  if (!boardHasAvailableCards() || allComplete) {
    game.phase = 'roundEnd';
  }
}

function checkGameOverByElimination() {
  const active = allActivePlayers();
  if (active.length <= 1) {
    game.phase = 'gameEnd';
    game.winner = active.length === 1 ? active[0].name : null;
  }
}

function drawCard(playerIdx, imgIndex) {
  if (game.phase !== 'draw') return;
  if (game.turnLocked) return;
  const turnIdx = nextAvailableTurnIndex(game.currentTurnIndex);
  if (turnIdx === -1) { checkRoundEnd(); return; }
  const currentPlayerIdx = game.drawOrder[turnIdx];
  if (currentPlayerIdx !== playerIdx) return; // pas son tour
  const img = game.board[imgIndex];
  if (!img || img.taken) return;

  img.taken = true;
  img.takenBy = playerIdx;
  const bombCount = img.bombs.length;
  const isBomb = bombCount > 0;
  img.isBomb = isBomb;

  const player = game.players[playerIdx];
  const card = { imgIndex, filename: img.filename, lost: isBomb };
  player.drawnCards.push(card);

  let eliminatedNow = false;
  if (isBomb) {
    const multiboomActive = !!game.config.multiboom && bombCount >= 2;
    // le tirage compte déjà comme 1 perte ; on retire en plus les cartes
    // saines précédentes les plus récentes : 1 en mode normal, (bombCount - 1) en multi-boom
    const additionalLosses = multiboomActive ? (bombCount - 1) : 1;
    let removed = 0;
    for (let i = player.drawnCards.length - 2; i >= 0 && removed < additionalLosses; i--) {
      if (!player.drawnCards[i].lost) {
        player.drawnCards[i].lost = true;
        removed++;
      }
    }
    if (multiboomActive) {
      const safeCountNow = player.drawnCards.filter(c => !c.lost).length;
      if (safeCountNow === 0) {
        player.eliminated = true;
        eliminatedNow = true;
      }
    }
  }

  const safeCount = player.drawnCards.filter(c => !c.lost).length;
  const justCompleted = safeCount >= game.config.maxCards && !player.complete;
  if (justCompleted) player.complete = true;

  // annonce visible par tout le monde pendant 2s avant de résoudre le tour suivant
  game.lastReveal = {
    playerIndex: playerIdx,
    playerName: player.name,
    filename: img.filename,
    isBomb,
    bombCount,
  };
  game.turnLocked = true;
  broadcastState();

  setTimeout(() => {
    if (!game) return; // partie réinitialisée entre temps
    game.turnLocked = false;
    game.lastReveal = null;

    if (game.config.intouchable && justCompleted) {
      game.phase = 'gameEnd';
      game.winner = player.name;
      broadcastState();
      return;
    }
    if (eliminatedNow) {
      checkGameOverByElimination();
      if (game.phase === 'gameEnd') { broadcastState(); return; }
    }

    const nt = nextAvailableTurnIndex(turnIdx + 1);
    game.currentTurnIndex = nt === -1 ? turnIdx : nt;
    checkRoundEnd();
    broadcastState();
  }, 2000);
}

function toggleBomb(playerIdx, imgIndex) {
  if (game.phase !== 'placement') return;
  const player = game.players[playerIdx];
  if (!player || player.ready) return;
  const img = game.board[imgIndex];
  if (!img) return;
  const already = img.bombs.includes(playerIdx);
  if (already) {
    img.bombs = img.bombs.filter(i => i !== playerIdx);
    player.myBombs = player.myBombs.filter(i => i !== imgIndex);
    player.bombsRemaining += 1;
  } else {
    if (player.bombsRemaining <= 0) return;
    img.bombs.push(playerIdx);
    player.myBombs.push(imgIndex);
    player.bombsRemaining -= 1;
  }
}

// ---------- Construction de l'état envoyé aux clients ----------
function safeBoardForRole(role, playerIndex) {
  return game.board.map((c, idx) => {
    const base = {
      idx,
      filename: c.filename,
      taken: c.taken,
      takenBy: c.takenBy,
    };
    if (role === 'master') {
      base.bombs = c.bombs;
      base.isBomb = c.isBomb;
      base.bombCount = c.bombs.length;
    } else {
      // joueur : ne voit que ses propres bombes tant que la case n'est pas révélée
      base.mine = c.bombs.includes(playerIndex);
      if (c.taken) base.isBomb = c.isBomb;
    }
    return base;
  });
}

function buildState(role, playerIndex) {
  if (!game) return { started: false };
  const currentTurnIdx = game.phase === 'draw' ? nextAvailableTurnIndex(game.currentTurnIndex) : -1;
  const currentPlayer = currentTurnIdx !== -1 ? game.drawOrder[currentTurnIdx] : null;
  return {
    started: true,
    phase: game.phase,
    roundNumber: game.roundNumber,
    config: game.config,
    gridCols: game.gridCols,
    gridRows: game.gridRows,
    players: game.players.map(p => ({
      index: p.index,
      name: p.name,
      eliminated: p.eliminated,
      ready: p.ready,
      bombsRemaining: p.bombsRemaining,
      myBombs: role === 'master' || p.index === playerIndex ? p.myBombs : undefined,
      drawnCards: p.drawnCards,
      complete: p.complete,
      safeCount: p.drawnCards.filter(c => !c.lost).length,
    })),
    board: safeBoardForRole(role, playerIndex),
    drawOrder: game.drawOrder,
    currentPlayer,
    winner: game.winner || null,
    lastReveal: game.lastReveal || null,
    turnLocked: !!game.turnLocked,
  };
}

function broadcastState() {
  if (!game) return;
  io.to('master').emit('state', buildState('master'));
  game.players.forEach(p => {
    io.to('player-' + p.index).emit('state', buildState('player', p.index));
  });
}

// ---------- API HTTP ----------
app.get('/api/init-data', (req, res) => {
  const data = loadPlayersData();
  res.json(data);
});

const upload = multer({ dest: UPLOAD_TMP_DIR });
app.post('/api/upload-zip', upload.single('zipfile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    // vider le pool actuel
    fs.readdirSync(IMAGES_POOL_DIR).forEach(f => fs.unlinkSync(path.join(IMAGES_POOL_DIR, f)));
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries().filter(e =>
      !e.isDirectory && /\.(png|jpe?g|gif|webp)$/i.test(e.entryName)
    );
    entries.forEach(e => {
      const base = path.basename(e.entryName).replace(/[^a-zA-Z0-9._-]/g, '_');
      let dest = path.join(IMAGES_POOL_DIR, base);
      let counter = 1;
      while (fs.existsSync(dest)) {
        const ext = path.extname(base);
        const name = path.basename(base, ext);
        dest = path.join(IMAGES_POOL_DIR, `${name}_${counter}${ext}`);
        counter++;
      }
      fs.writeFileSync(dest, e.getData());
    });
    fs.unlinkSync(req.file.path);
    const count = fs.readdirSync(IMAGES_POOL_DIR).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)).length;
    res.json({ ok: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du dézippage: ' + err.message });
  }
});

app.post('/api/start-game', (req, res) => {
  try {
    const { names, numImages, maxCards, numBombs, intouchable, multiboom } = req.body;
    if (!Array.isArray(names) || names.length < 2 || names.length > 8) {
      return res.status(400).json({ error: 'Nombre de joueurs invalide (2 à 8)' });
    }
    const nImg = parseInt(numImages, 10);
    const mCards = parseInt(maxCards, 10);
    const nBombs = parseInt(numBombs, 10);
    if (nImg < 25 || nImg > 75) return res.status(400).json({ error: 'Nombre d\'images invalide (25 à 75)' });
    if (mCards < 5 || mCards > 10) return res.status(400).json({ error: 'Cartes max par joueur invalide (5 à 10)' });
    if (nBombs < 1 || nBombs > 5) return res.status(400).json({ error: 'Nombre de bombes invalide (1 à 5)' });

    const availableCount = fs.readdirSync(IMAGES_POOL_DIR).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)).length;
    if (availableCount < nImg) {
      return res.status(400).json({ error: `Seulement ${availableCount} images disponibles dans l'archive, il en faut au moins ${nImg}` });
    }

    const imageSet = pickImagePool(nImg);
    const { rows, cols } = computeGrid(nImg);

    game = {
      config: {
        numPlayers: names.length, numImages: nImg, maxCards: mCards, numBombs: nBombs,
        intouchable: !!intouchable, multiboom: !!multiboom,
      },
      players: names.map((name, i) => ({
        index: i, name, eliminated: false, ready: false,
        bombsRemaining: nBombs, myBombs: [], drawnCards: [], complete: false,
      })),
      imageSet,
      gridRows: rows,
      gridCols: cols,
      board: [],
      phase: 'placement',
      drawOrder: [],
      currentTurnIndex: 0,
      roundNumber: 0,
      winner: null,
      lastReveal: null,
      turnLocked: false,
    };
    startNewRound(true);
    game.roundNumber = 1;

    // persistance des noms
    const data = loadPlayersData();
    data.lastNames = names;
    names.forEach(n => { if (!data.allNamesEver.includes(n)) data.allNamesEver.push(n); });
    savePlayersData(data);

    res.json({ ok: true });
    broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur au démarrage: ' + err.message });
  }
});

// pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maitre.html'));
});
app.get(/^\/joueur(\d+)$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  socket.on('register', ({ role, index }) => {
    if (role === 'master') {
      socket.join('master');
      socket.data.role = 'master';
      socket.emit('state', buildState('master'));
    } else if (role === 'player') {
      socket.join('player-' + index);
      socket.data.role = 'player';
      socket.data.index = index;
      socket.emit('state', buildState('player', index));
    }
  });

  socket.on('toggleBomb', ({ index, imgIndex }) => {
    if (!game) return;
    toggleBomb(index, imgIndex);
    broadcastState();
  });

  socket.on('validatePlacement', ({ index }) => {
    if (!game) return;
    const player = game.players[index];
    if (!player) return;
    if (player.bombsRemaining === 0) {
      player.ready = true;
      checkAllValidated();
      broadcastState();
    }
  });

  socket.on('unvalidatePlacement', ({ index }) => {
    if (!game || game.phase !== 'placement') return;
    const player = game.players[index];
    if (player) { player.ready = false; broadcastState(); }
  });

  socket.on('drawCard', ({ index, imgIndex }) => {
    if (!game) return;
    drawCard(index, imgIndex);
  });

  socket.on('eliminatePlayer', ({ index }) => {
    if (!game) return;
    const player = game.players[index];
    if (player) player.eliminated = true;
    checkGameOverByElimination();
    broadcastState();
  });

  socket.on('restorePlayer', ({ index }) => {
    if (!game) return;
    const player = game.players[index];
    if (player) player.eliminated = false;
    broadcastState();
  });

  socket.on('newRound', () => {
    if (!game) return;
    const active = allActivePlayers();
    if (active.length < 1) return;
    startNewRound(true);
    broadcastState();
  });

  socket.on('resetGame', () => {
    game = null;
    io.to('master').emit('state', { started: false });
  });
});

server.listen(PORT, () => {
  console.log(`Jeu de la bombe lancé sur http://localhost:${PORT}`);
});
