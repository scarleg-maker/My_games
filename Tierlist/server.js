const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 9500;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const LAST_PLAYERS_FILE = path.join(__dirname, 'lastPlayers.json');
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function extractItemsFromZipBuffer(buffer, sessionDir, sessionId) {
  const items = [];
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  entries.forEach(entry => {
    if (entry.isDirectory) return;
    const ext = path.extname(entry.entryName).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) return;
    const baseName = path.basename(entry.entryName);
    const safeName = `${uuidv4().slice(0, 6)}_${baseName}`;
    fs.writeFileSync(path.join(sessionDir, safeName), entry.getData());
    items.push({
      id: uuidv4(),
      type: 'image',
      name: path.basename(entry.entryName, ext),
      url: `/uploads/${sessionId}/${safeName}`
    });
  });
  return items;
}

function itemsFromNamesList(names) {
  const items = [];
  names.forEach(n => {
    if (!n || !n.trim()) return;
    items.push({ id: uuidv4(), type: 'text', name: n.trim(), url: null });
  });
  return items;
}

function shuffleItems(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// ---------- State ----------
let game = null; // current game session (single active session on this server)

function readLastPlayers() {
  try { return JSON.parse(fs.readFileSync(LAST_PLAYERS_FILE, 'utf8')); } catch (e) { return []; }
}
function writeLastPlayers(names) {
  try { fs.writeFileSync(LAST_PLAYERS_FILE, JSON.stringify(names)); } catch (e) {}
}

app.get('/api/last-players', (req, res) => {
  res.json({ names: readLastPlayers() });
});

// ---------- Setup ----------
app.post('/api/setup', upload.single('zipfile'), (req, res) => {
  try {
    const body = req.body;
    const title = (body.title || 'Ma Tier List').toString().slice(0, 120);
    const rows = JSON.parse(body.rows); // [{name, color}]
    const maxPerRow = body.maxPerRow === 'infini' ? null : parseInt(body.maxPerRow, 10);
    const mode = body.mode === 'multi' ? 'multi' : 'solo';
    const suddenDeath = body.suddenDeath === 'true';
    const lastChance = body.lastChance === 'true' && !suddenDeath;
    let players = [];
    if (mode === 'multi') {
      players = JSON.parse(body.players); // [name, name...]
      players = players.slice(0, 8).map((name, i) => ({ num: i + 1, name: (name || `Joueur ${i + 1}`).toString().slice(0, 40) }));
      writeLastPlayers(players.map(p => p.name));
    }

    const sessionId = uuidv4().slice(0, 8);
    const sessionDir = path.join(UPLOAD_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    let items = [];
    if (req.file) {
      items = extractItemsFromZipBuffer(req.file.buffer, sessionDir, sessionId);
    } else if (body.namesList) {
      items = itemsFromNamesList(JSON.parse(body.namesList));
    }

    if (items.length === 0) {
      return res.status(400).json({ error: 'Aucune image ou nom fourni.' });
    }

    shuffleItems(items); // shuffle for pool order

    game = {
      sessionId,
      title,
      rows,
      maxPerRow,
      mode,
      suddenDeath,
      lastChance,
      items,
      placements: {}, // itemId -> rowIndex
      rowItems: rows.map(() => []), // itemId order within each row (for manual reordering)
      players,
      turnOrder: players.map(p => p.num),
      currentTurnIdx: 0,
      pendingRandomItem: null, // for sudden death: itemId assigned this turn
      turnMoveUsed: false, // for last chance: whether the "move" action was used this turn
      turnPlaceUsed: false,
      finished: false,
      history: [] // log of actions for recap
    };

    if (mode === 'multi') {
      assignPendingIfNeeded();
    }

    const playerLinks = players.map(p => ({ num: p.num, name: p.name, url: `/joueur${p.num}.html` }));
    res.json({ ok: true, sessionId, mode, playerLinks, redirect: mode === 'solo' ? '/jeu.html' : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur: ' + err.message });
  }
});

function assignPendingIfNeeded() {
  if (!game || !game.suddenDeath || game.finished) return;
  const unplaced = game.items.filter(it => !(it.id in game.placements));
  if (unplaced.length === 0) { game.pendingRandomItem = null; return; }
  const pick = unplaced[Math.floor(Math.random() * unplaced.length)];
  game.pendingRandomItem = pick.id;
}

function currentPlayerNum() {
  if (!game || game.turnOrder.length === 0) return null;
  return game.turnOrder[game.currentTurnIdx % game.turnOrder.length];
}

function rowCount(rowIndex) {
  return game.rowItems[rowIndex] ? game.rowItems[rowIndex].length : 0;
}

function removeFromRowItems(itemId) {
  const oldRow = game.placements[itemId];
  if (oldRow === undefined) return;
  const arr = game.rowItems[oldRow];
  if (!arr) return;
  const idx = arr.indexOf(itemId);
  if (idx !== -1) arr.splice(idx, 1);
}

function insertIntoRowItems(itemId, rowIndex, targetItemId) {
  const arr = game.rowItems[rowIndex];
  if (targetItemId && arr.includes(targetItemId)) {
    arr.splice(arr.indexOf(targetItemId), 0, itemId);
  } else {
    arr.push(itemId);
  }
}

function checkFinished() {
  const unplaced = game.items.filter(it => !(it.id in game.placements));
  if (unplaced.length === 0) game.finished = true;
}

function advanceTurn() {
  game.turnPlaceUsed = false;
  game.turnMoveUsed = false;
  checkFinished();
  if (!game.finished) {
    game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;
    assignPendingIfNeeded();
  } else {
    game.pendingRandomItem = null;
  }
}

function publicState() {
  if (!game) return null;
  return {
    sessionId: game.sessionId,
    title: game.title,
    rows: game.rows,
    maxPerRow: game.maxPerRow,
    mode: game.mode,
    suddenDeath: game.suddenDeath,
    lastChance: game.lastChance,
    items: game.items,
    placements: game.placements,
    rowItems: game.rowItems,
    players: game.players,
    currentPlayer: game.mode === 'multi' ? currentPlayerNum() : null,
    pendingRandomItem: game.pendingRandomItem,
    turnPlaceUsed: game.turnPlaceUsed,
    turnMoveUsed: game.turnMoveUsed,
    finished: game.finished,
    history: game.history
  };
}

function broadcast() {
  io.emit('state', publicState());
}

// dynamic player page routes: /joueur1.html ... /joueur8.html
app.get(/^\/joueur(\d+)\.html$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/jeu.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.post('/api/new-game', (req, res) => {
  game = null;
  broadcast();
  res.json({ ok: true });
});

// ---------- Sauvegarde / reprise ----------
app.get('/api/export', (req, res) => {
  if (!game) return res.status(404).json({ error: 'Aucune partie en cours à sauvegarder.' });
  res.json({ ok: true, save: game });
});

app.post('/api/import', upload.single('zipfile'), (req, res) => {
  try {
    const body = req.body;
    let save;
    try {
      save = JSON.parse(body.save);
    } catch (e) {
      return res.status(400).json({ error: 'Fichier de sauvegarde invalide ou corrompu.' });
    }
    if (!save || !Array.isArray(save.items) || !Array.isArray(save.rows)) {
      return res.status(400).json({ error: 'Fichier de sauvegarde invalide ou corrompu.' });
    }
    game = save;
    if (!game.placements) game.placements = {};
    if (!Array.isArray(game.players)) game.players = [];
    if (!Array.isArray(game.turnOrder)) game.turnOrder = game.players.map(p => p.num);
    if (typeof game.currentTurnIdx !== 'number') game.currentTurnIdx = 0;
    if (typeof game.turnPlaceUsed !== 'boolean') game.turnPlaceUsed = false;
    if (typeof game.turnMoveUsed !== 'boolean') game.turnMoveUsed = false;
    if (typeof game.finished !== 'boolean') game.finished = false;
    if (!Array.isArray(game.history)) game.history = [];
    if (game.maxPerRow === undefined) game.maxPerRow = null;
    if (!Array.isArray(game.rowItems)) {
      game.rowItems = game.rows.map(() => []);
      Object.entries(game.placements).forEach(([id, r]) => {
        if (game.rowItems[r]) game.rowItems[r].push(id);
      });
    }

    // Optionally replace the images/names of this save with a new set.
    // Any items already placed in rows are dropped, since they no longer exist.
    const replaceContent = body.replaceContent === 'true';
    if (replaceContent) {
      const sessionId = uuidv4().slice(0, 8);
      const sessionDir = path.join(UPLOAD_DIR, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

      let items = [];
      if (req.file) {
        items = extractItemsFromZipBuffer(req.file.buffer, sessionDir, sessionId);
      } else if (body.namesList) {
        items = itemsFromNamesList(JSON.parse(body.namesList));
      }
      if (items.length === 0) {
        return res.status(400).json({ error: 'Aucune image ou nom fourni pour remplacer le contenu.' });
      }
      shuffleItems(items);

      game.sessionId = sessionId;
      game.items = items;
      game.placements = {};
      game.rowItems = game.rows.map(() => []);
      game.pendingRandomItem = null;
      game.turnPlaceUsed = false;
      game.turnMoveUsed = false;
      game.finished = false;
      game.history = [];
      game.currentTurnIdx = 0;
    }

    if (game.mode === 'multi') assignPendingIfNeeded();

    broadcast();
    const playerLinks = game.players.map(p => ({ num: p.num, name: p.name, url: `/joueur${p.num}.html` }));
    res.json({ ok: true, mode: game.mode, playerLinks, redirect: game.mode === 'solo' ? '/jeu.html' : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement : ' + err.message });
  }
});

// ---------- Sockets ----------
io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('place', ({ itemId, rowIndex, targetItemId, playerNum }) => {
    if (!game) return;
    if (game.finished) return;
    if (!(rowIndex >= 0 && rowIndex < game.rows.length)) return;
    if (game.maxPerRow !== null && rowCount(rowIndex) >= game.maxPerRow) return;
    if (itemId in game.placements) return;

    if (game.mode === 'multi') {
      if (playerNum !== currentPlayerNum()) return;
      if (game.turnPlaceUsed) return; // only one "place new item" action per turn, must validate to continue
      if (game.suddenDeath) {
        if (itemId !== game.pendingRandomItem) return;
        game.placements[itemId] = rowIndex;
        insertIntoRowItems(itemId, rowIndex, targetItemId);
        game.turnPlaceUsed = true;
        game.history.push({ player: playerNum, action: 'place-random', itemId, rowIndex, turn: game.currentTurnIdx });
        checkFinished();
        broadcast();
        return;
      }
      game.placements[itemId] = rowIndex;
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      game.turnPlaceUsed = true;
      game.history.push({ player: playerNum, action: 'place', itemId, rowIndex, turn: game.currentTurnIdx });
      checkFinished();
      broadcast();
    } else {
      // solo: free placement, no turns, game never "ends"
      game.placements[itemId] = rowIndex;
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      broadcast();
    }
  });

  socket.on('move', ({ itemId, rowIndex, targetItemId, playerNum }) => {
    if (!game || game.finished) return;
    if (!(rowIndex >= 0 && rowIndex < game.rows.length)) return;
    if (!(itemId in game.placements)) return;
    if (game.maxPerRow !== null && rowCount(rowIndex) >= game.maxPerRow) return;

    if (game.mode === 'multi') {
      if (!game.lastChance) return;
      if (playerNum !== currentPlayerNum()) return;
      if (game.turnMoveUsed) return; // only one "move" action per turn
      removeFromRowItems(itemId);
      game.placements[itemId] = rowIndex;
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      game.turnMoveUsed = true;
      game.history.push({ player: playerNum, action: 'move', itemId, rowIndex, turn: game.currentTurnIdx });
      broadcast();
    } else {
      removeFromRowItems(itemId);
      game.placements[itemId] = rowIndex;
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      broadcast();
    }
  });

  // reorder an already-placed item within its own row (drag position, e.g. slot 3 -> slot 1)
  socket.on('reorder', ({ itemId, targetItemId, playerNum }) => {
    if (!game || game.finished) return;
    if (!(itemId in game.placements) || !(targetItemId in game.placements)) return;
    const rowIndex = game.placements[itemId];
    if (game.placements[targetItemId] !== rowIndex) return; // must stay within the same row
    if (itemId === targetItemId) return;

    if (game.mode === 'multi') {
      if (!game.lastChance) return;
      if (playerNum !== currentPlayerNum()) return;
      if (game.turnMoveUsed) return; // shares the same "1 modification per turn" budget as move
      removeFromRowItems(itemId);
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      game.turnMoveUsed = true;
      game.history.push({ player: playerNum, action: 'reorder', itemId, rowIndex, turn: game.currentTurnIdx });
      broadcast();
    } else {
      removeFromRowItems(itemId);
      insertIntoRowItems(itemId, rowIndex, targetItemId);
      broadcast();
    }
  });


  socket.on('endTurn', ({ playerNum }) => {
    if (!game || game.mode !== 'multi' || game.finished) return;
    if (playerNum !== currentPlayerNum()) return;
    if (!game.turnPlaceUsed) return; // must place your item (or the imposed random one) before validating
    advanceTurn();
    broadcast();
  });

  socket.on('updateRow', ({ rowIndex, name, color }) => {
    if (!game) return;
    if (game.mode !== 'solo') return; // row names/colors are only editable live in solo mode
    if (!game.rows[rowIndex]) return;
    if (typeof name === 'string' && name.trim()) {
      game.rows[rowIndex].name = name.trim().slice(0, 20);
    }
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      game.rows[rowIndex].color = color;
    }
    broadcast();
  });

  socket.on('newGame', () => {
    game = null;
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`Tier List server lancé : http://localhost:${PORT}/setup.html`);
});
