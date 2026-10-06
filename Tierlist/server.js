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

// ---------- Rooms (salons) ----------
// Each group plays in its own room, identified by a short code (e.g. "F7K2"),
// so several separate tier lists can run at the same time on the same server.
const rooms = new Map(); // code -> game object (same shape as before, plus `code`)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L (avoids confusion)
const CODE_RE = /^[A-Z0-9]{4,10}$/;
const RESERVED_CODES = new Set(['API', 'UPLOADS', 'SETUP', 'JEU', 'ACCUEIL', 'FAVICON', 'STATIC']);

function cleanCode(c) { return String(c || '').trim().toUpperCase(); }
function validCode(c) { return CODE_RE.test(c) && !RESERVED_CODES.has(c) && !/^JOUEUR\d+$/.test(c); }
function generateCode() {
  for (let attempt = 0; attempt < 300; attempt++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return uuidv4().slice(0, 6).toUpperCase(); // extremely unlikely fallback
}

function readLastPlayers() {
  try { return JSON.parse(fs.readFileSync(LAST_PLAYERS_FILE, 'utf8')); } catch (e) { return []; }
}
function writeLastPlayers(names) {
  try { fs.writeFileSync(LAST_PLAYERS_FILE, JSON.stringify(names)); } catch (e) {}
}

app.get('/api/last-players', (req, res) => {
  res.json({ names: readLastPlayers() });
});

app.get('/api/new-code', (req, res) => {
  res.json({ code: generateCode() });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = rooms.get(code);
  if (!room) return res.json({ exists: false, code });
  res.json({
    exists: true,
    code,
    title: room.title,
    mode: room.mode,
    finished: room.finished,
    players: room.players.map(p => ({ num: p.num, name: p.name }))
  });
});

// ---------- Setup (creates/overwrites the game of a room) ----------
app.post('/api/:code/setup', upload.single('zipfile'), (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide.' });

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

    const room = {
      code,
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
    rooms.set(code, room);

    if (mode === 'multi') assignPendingIfNeeded(room);

    const playerLinks = players.map(p => ({ num: p.num, name: p.name, url: `/${code}/joueur${p.num}.html` }));
    res.json({ ok: true, code, mode, playerLinks, redirect: mode === 'solo' ? `/${code}/jeu.html` : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur: ' + err.message });
  }
});

function assignPendingIfNeeded(room) {
  if (!room || !room.suddenDeath || room.finished) return;
  const unplaced = room.items.filter(it => !(it.id in room.placements));
  if (unplaced.length === 0) { room.pendingRandomItem = null; return; }
  const pick = unplaced[Math.floor(Math.random() * unplaced.length)];
  room.pendingRandomItem = pick.id;
}

function currentPlayerNum(room) {
  if (!room || room.turnOrder.length === 0) return null;
  return room.turnOrder[room.currentTurnIdx % room.turnOrder.length];
}

function rowCount(room, rowIndex) {
  return room.rowItems[rowIndex] ? room.rowItems[rowIndex].length : 0;
}

function removeFromRowItems(room, itemId) {
  const oldRow = room.placements[itemId];
  if (oldRow === undefined) return;
  const arr = room.rowItems[oldRow];
  if (!arr) return;
  const idx = arr.indexOf(itemId);
  if (idx !== -1) arr.splice(idx, 1);
}

function insertIntoRowItems(room, itemId, rowIndex, targetItemId) {
  const arr = room.rowItems[rowIndex];
  if (targetItemId && arr.includes(targetItemId)) {
    arr.splice(arr.indexOf(targetItemId), 0, itemId);
  } else {
    arr.push(itemId);
  }
}

function checkFinished(room) {
  const unplaced = room.items.filter(it => !(it.id in room.placements));
  if (unplaced.length === 0) room.finished = true;
}

function advanceTurn(room) {
  room.turnPlaceUsed = false;
  room.turnMoveUsed = false;
  checkFinished(room);
  if (!room.finished) {
    room.currentTurnIdx = (room.currentTurnIdx + 1) % room.turnOrder.length;
    assignPendingIfNeeded(room);
  } else {
    room.pendingRandomItem = null;
  }
}

function publicState(room) {
  if (!room) return null;
  return {
    code: room.code,
    sessionId: room.sessionId,
    title: room.title,
    rows: room.rows,
    maxPerRow: room.maxPerRow,
    mode: room.mode,
    suddenDeath: room.suddenDeath,
    lastChance: room.lastChance,
    items: room.items,
    placements: room.placements,
    rowItems: room.rowItems,
    players: room.players,
    currentPlayer: room.mode === 'multi' ? currentPlayerNum(room) : null,
    pendingRandomItem: room.pendingRandomItem,
    turnPlaceUsed: room.turnPlaceUsed,
    turnMoveUsed: room.turnMoveUsed,
    finished: room.finished,
    history: room.history
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('state', publicState(room));
}

// ---------- Pages ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'accueil.html')));

// Legacy bookmark without a room code: mint a fresh room and redirect to it.
app.get('/setup.html', (req, res) => res.redirect(`/${generateCode()}/setup.html`));
app.get(['/jeu.html', /^\/joueur\d+\.html$/], (req, res) => res.redirect('/'));

app.get('/:code/setup.html', (req, res, next) => {
  if (!validCode(cleanCode(req.params.code))) return next();
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.get('/:code/jeu.html', (req, res, next) => {
  if (!validCode(cleanCode(req.params.code))) return next();
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});
app.get(/^\/([A-Z0-9]{4,10})\/joueur\d+\.html$/i, (req, res, next) => {
  if (!validCode(cleanCode(req.params[0]))) return next();
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/:code/new-game', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = rooms.get(code);
  if (room) {
    rooms.delete(code);
    io.to(code).emit('state', null);
  }
  res.json({ ok: true });
});

// ---------- Sauvegarde / reprise ----------
app.get('/api/:code/export', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Aucune partie en cours à sauvegarder dans ce salon.' });
  res.json({ ok: true, save: room });
});

app.post('/api/:code/import', upload.single('zipfile'), (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide.' });

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

    const room = save;
    room.code = code; // the save is loaded into the room identified by this URL's code
    if (!room.placements) room.placements = {};
    if (!Array.isArray(room.players)) room.players = [];
    if (!Array.isArray(room.turnOrder)) room.turnOrder = room.players.map(p => p.num);
    if (typeof room.currentTurnIdx !== 'number') room.currentTurnIdx = 0;
    if (typeof room.turnPlaceUsed !== 'boolean') room.turnPlaceUsed = false;
    if (typeof room.turnMoveUsed !== 'boolean') room.turnMoveUsed = false;
    if (typeof room.finished !== 'boolean') room.finished = false;
    if (!Array.isArray(room.history)) room.history = [];
    if (room.maxPerRow === undefined) room.maxPerRow = null;
    if (!Array.isArray(room.rowItems)) {
      room.rowItems = room.rows.map(() => []);
      Object.entries(room.placements).forEach(([id, r]) => {
        if (room.rowItems[r]) room.rowItems[r].push(id);
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

      room.sessionId = sessionId;
      room.items = items;
      room.placements = {};
      room.rowItems = room.rows.map(() => []);
      room.pendingRandomItem = null;
      room.turnPlaceUsed = false;
      room.turnMoveUsed = false;
      room.finished = false;
      room.history = [];
      room.currentTurnIdx = 0;
    }

    rooms.set(code, room);
    if (room.mode === 'multi') assignPendingIfNeeded(room);

    broadcastRoom(room);
    const playerLinks = room.players.map(p => ({ num: p.num, name: p.name, url: `/${code}/joueur${p.num}.html` }));
    res.json({ ok: true, code, mode: room.mode, playerLinks, redirect: room.mode === 'solo' ? `/${code}/jeu.html` : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement : ' + err.message });
  }
});

// ---------- Sockets (each connection joins exactly one room, by its code) ----------
io.on('connection', (socket) => {
  socket.on('joinRoom', ({ code }) => {
    code = cleanCode(code);
    if (!validCode(code)) return;
    socket.data.code = code;
    socket.join(code);
    const room = rooms.get(code);
    socket.emit('state', publicState(room));
  });

  socket.on('place', ({ itemId, rowIndex, targetItemId, playerNum }) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.finished) return;
    if (!(rowIndex >= 0 && rowIndex < room.rows.length)) return;
    if (room.maxPerRow !== null && rowCount(room, rowIndex) >= room.maxPerRow) return;
    if (itemId in room.placements) return;

    if (room.mode === 'multi') {
      if (playerNum !== currentPlayerNum(room)) return;
      if (room.turnPlaceUsed) return; // only one "place new item" action per turn, must validate to continue
      if (room.suddenDeath) {
        if (itemId !== room.pendingRandomItem) return;
        room.placements[itemId] = rowIndex;
        insertIntoRowItems(room, itemId, rowIndex, targetItemId);
        room.turnPlaceUsed = true;
        room.history.push({ player: playerNum, action: 'place-random', itemId, rowIndex, turn: room.currentTurnIdx });
        checkFinished(room);
        broadcastRoom(room);
        return;
      }
      room.placements[itemId] = rowIndex;
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      room.turnPlaceUsed = true;
      room.history.push({ player: playerNum, action: 'place', itemId, rowIndex, turn: room.currentTurnIdx });
      checkFinished(room);
      broadcastRoom(room);
    } else {
      // solo: free placement, no turns, game never "ends"
      room.placements[itemId] = rowIndex;
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      broadcastRoom(room);
    }
  });

  socket.on('move', ({ itemId, rowIndex, targetItemId, playerNum }) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.finished) return;
    if (!(rowIndex >= 0 && rowIndex < room.rows.length)) return;
    if (!(itemId in room.placements)) return;
    if (room.maxPerRow !== null && rowCount(room, rowIndex) >= room.maxPerRow) return;

    if (room.mode === 'multi') {
      if (!room.lastChance) return;
      if (playerNum !== currentPlayerNum(room)) return;
      if (room.turnMoveUsed) return; // only one "move" action per turn
      removeFromRowItems(room, itemId);
      room.placements[itemId] = rowIndex;
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      room.turnMoveUsed = true;
      room.history.push({ player: playerNum, action: 'move', itemId, rowIndex, turn: room.currentTurnIdx });
      broadcastRoom(room);
    } else {
      removeFromRowItems(room, itemId);
      room.placements[itemId] = rowIndex;
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      broadcastRoom(room);
    }
  });

  // reorder an already-placed item within its own row (drag position, e.g. slot 3 -> slot 1)
  socket.on('reorder', ({ itemId, targetItemId, playerNum }) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.finished) return;
    if (!(itemId in room.placements) || !(targetItemId in room.placements)) return;
    const rowIndex = room.placements[itemId];
    if (room.placements[targetItemId] !== rowIndex) return; // must stay within the same row
    if (itemId === targetItemId) return;

    if (room.mode === 'multi') {
      if (!room.lastChance) return;
      if (playerNum !== currentPlayerNum(room)) return;
      if (room.turnMoveUsed) return; // shares the same "1 modification per turn" budget as move
      removeFromRowItems(room, itemId);
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      room.turnMoveUsed = true;
      room.history.push({ player: playerNum, action: 'reorder', itemId, rowIndex, turn: room.currentTurnIdx });
      broadcastRoom(room);
    } else {
      removeFromRowItems(room, itemId);
      insertIntoRowItems(room, itemId, rowIndex, targetItemId);
      broadcastRoom(room);
    }
  });

  socket.on('endTurn', ({ playerNum }) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.mode !== 'multi' || room.finished) return;
    if (playerNum !== currentPlayerNum(room)) return;
    if (!room.turnPlaceUsed) return; // must place your item (or the imposed random one) before validating
    advanceTurn(room);
    broadcastRoom(room);
  });

  socket.on('updateRow', ({ rowIndex, name, color }) => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    if (room.mode !== 'solo') return; // row names/colors are only editable live in solo mode
    if (!room.rows[rowIndex]) return;
    if (typeof name === 'string' && name.trim()) {
      room.rows[rowIndex].name = name.trim().slice(0, 20);
    }
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      room.rows[rowIndex].color = color;
    }
    broadcastRoom(room);
  });
});

// Rooms with nobody connected and no activity for a while are freed from memory.
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // 6h
setInterval(() => {
  for (const [code, room] of rooms) {
    const sockets = io.sockets.adapter.rooms.get(code);
    if (!sockets || sockets.size === 0) {
      room._idleSince = room._idleSince || Date.now();
      if (Date.now() - room._idleSince > ROOM_IDLE_MS) rooms.delete(code);
    } else {
      room._idleSince = null;
    }
  }
}, 15 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Tier List server lancé : http://localhost:${PORT}/`);
});
