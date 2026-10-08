const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { randomUUID } = require('crypto');

const { GameManager } = require('./gameEngine');

const PORT = 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const ROOMS_DATA_DIR = path.join(__dirname, 'data', 'rooms');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ROOMS_DATA_DIR)) fs.mkdirSync(ROOMS_DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/static', express.static(PUBLIC_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

// ================================================================ registre des salons
// Chaque salon est une partie indépendante : sa propre partie (GameManager), son propre
// minuteur IA, son propre dossier d'images importées, ses propres noms de joueurs mémorisés.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L pour éviter les confusions
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'ASSETS', 'FAVICON']);
const MAX_ROOMS = 50;
const ROOM_IDLE_MS = 6 * 3600 * 1000; // un salon inactif depuis 6h (aucune page ouverte) est supprimé

const rooms = new Map(); // code -> { code, gameManager, aiTimer, uploadDir, lastActivity }

function cleanCode(c) {
  return String(c || '').trim().toUpperCase();
}
function validCode(code) {
  return CODE_RE.test(code) && !RESERVED.has(code) && !/^JOUEUR\d+$/.test(code);
}
function newCode() {
  for (let len = 4; ; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && validCode(c)) return c;
    }
  }
}
function touch(room) {
  room.lastActivity = Date.now();
}
function createRoom(code) {
  const uploadDir = path.join(UPLOADS_DIR, code);
  fs.mkdirSync(uploadDir, { recursive: true });
  const room = { code, gameManager: new GameManager(), aiTimer: null, uploadDir, lastActivity: Date.now() };
  rooms.set(code, room);
  return room;
}
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  if (rooms.size >= MAX_ROOMS) purgeIdleRooms(true);
  return createRoom(code);
}
function destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.aiTimer) clearTimeout(room.aiTimer);
  rooms.delete(code);
  try {
    fs.rmSync(room.uploadDir, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
}
function purgeIdleRooms(force) {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const clientsInRoom = io.sockets.adapter.rooms.get(code);
    const hasClients = clientsInRoom && clientsInRoom.size > 0;
    if (!hasClients && (force || now - room.lastActivity > ROOM_IDLE_MS)) destroyRoom(code);
  }
}
setInterval(() => purgeIdleRooms(false), 10 * 60 * 1000);

function roomInfo(room) {
  const gm = room.gameManager;
  if (!gm.isConfigured()) return { exists: true, configured: false, code: room.code };
  const s = gm.getPublicState();
  return {
    exists: true,
    configured: true,
    code: room.code,
    mode: s.mode,
    theme: s.theme,
    status: s.status,
    players: s.players,
    aiPlayers: s.aiPlayers,
    round: s.round,
    totalRounds: s.totalRounds
  };
}

// ---------- noms de joueurs mémorisés, par salon ----------
function roomPlayersFile(code) {
  return path.join(ROOMS_DATA_DIR, `${code}.json`);
}
function loadSavedPlayers(code) {
  try {
    const raw = fs.readFileSync(roomPlayersFile(code), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.players) ? data.players : [];
  } catch (e) {
    return [];
  }
}
function savePlayers(code, list) {
  fs.writeFileSync(roomPlayersFile(code), JSON.stringify({ players: list }, null, 2));
}

// ---------- planification des coups IA, par salon ----------
function scheduleAI(room) {
  if (room.aiTimer) {
    clearTimeout(room.aiTimer);
    room.aiTimer = null;
  }
  const gm = room.gameManager;
  if (!gm.isConfigured()) return;
  const state = gm.getPublicState();
  if (state.status !== 'playing') return;
  const current = state.currentPlayer;
  if (!current || !gm.isAI(current)) return;

  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!gm.isConfigured()) return;
    const s = gm.getPublicState();
    if (s.status !== 'playing' || s.currentPlayer !== current || !gm.isAI(current)) return;
    try {
      const move = gm.chooseAIMove(current);
      if (move) {
        if (move.type === 'play') gm.playCard(current, move.cardId);
        else if (move.type === 'pass') gm.pass(current);
        else if (move.type === 'endTrick') gm.endTrick(current);
      }
    } catch (err) {
      console.error(`Erreur IA [${room.code}] :`, err.message);
    }
    io.to(room.code).emit('state-updated');
    scheduleAI(room);
  }, 900 + Math.random() * 700);
}

function requireRoom(req, res, next) {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide.' });
  const room = getRoom(code, false);
  if (!room) return res.status(404).json({ error: "Ce salon n'existe pas ou plus. Retournez à l'accueil." });
  touch(room);
  req.room = room;
  next();
}

function resolvePlayerName(room, playerIndex) {
  const idx = parseInt(playerIndex, 10) - 1;
  const name = room.gameManager.config && room.gameManager.config.players[idx];
  if (!name) throw new Error('Joueur inconnu.');
  return name;
}

// ================================================================ pages
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'accueil.html'));
});

app.get('/:code/joueur:num', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'joueur.html'));
});

app.get('/:code/rejoindre', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'accueil.html'));
});

app.get('/:code', (req, res, next) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return next();
  if (!rooms.has(code)) return res.redirect(`/?salon=${encodeURIComponent(code)}&introuvable=1`);
  res.sendFile(path.join(PUBLIC_DIR, 'master.html'));
});

// ================================================================ API : salons
app.post('/api/rooms', (req, res) => {
  let code = req.body.code ? cleanCode(req.body.code) : newCode();
  if (!validCode(code)) return res.status(400).json({ error: 'Code invalide : 3 à 10 lettres ou chiffres.' });
  if (rooms.has(code))
    return res.status(400).json({ error: `Le salon ${code} existe déjà. Choisissez un autre code ou rejoignez-le.` });
  getRoom(code, true);
  res.json({ ok: true, code });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  res.json(room ? roomInfo(room) : { exists: false, code });
});

// ================================================================ API : jeu (scopée par salon)
app.get('/api/:code/saved-players', requireRoom, (req, res) => {
  res.json({ players: loadSavedPlayers(req.room.code) });
});

app.get('/api/:code/image/:cardId', requireRoom, (req, res) => {
  const gm = req.room.gameManager;
  if (!gm.config || gm.config.mode !== 'B') return res.status(404).end();
  const card = gm.config.images.find((c) => c.id === req.params.cardId);
  if (!card) return res.status(404).end();
  res.sendFile(card.filepath);
});

app.post('/api/:code/start-game', requireRoom, upload.single('photos'), (req, res) => {
  const room = req.room;
  try {
    const mode = req.body.mode;
    const players = JSON.parse(req.body.players || '[]').map((p) => String(p).trim()).filter(Boolean);
    const theme = String(req.body.theme || '').trim();
    const totalRounds = parseInt(req.body.totalRounds, 10);
    const pointsToWin = parseInt(req.body.pointsToWin, 10);
    const handSizeRaw = req.body.handSize;
    const handSize = handSizeRaw === 'all' ? 'all' : parseInt(handSizeRaw, 10);
    let aiPlayers = [];
    try {
      aiPlayers = JSON.parse(req.body.aiPlayers || '[]');
    } catch (e) {
      aiPlayers = [];
    }

    if (!['A', 'B'].includes(mode)) return res.status(400).json({ error: 'Mode invalide.' });
    if (players.length < 2 || players.length > 6)
      return res.status(400).json({ error: 'Il faut entre 2 et 6 joueurs.' });
    if (new Set(players).size !== players.length)
      return res.status(400).json({ error: 'Les noms des joueurs doivent être uniques.' });
    if (mode === 'A' && players.length < 4)
      return res.status(400).json({ error: 'Le mode "Cartes standardes" nécessite au moins 4 joueurs.' });
    if (!Number.isInteger(totalRounds) || totalRounds < 3 || totalRounds > 20)
      return res.status(400).json({ error: 'Le nombre de tours doit être entre 3 et 20.' });
    if (!Number.isInteger(pointsToWin) || pointsToWin < 50 || pointsToWin > 100 || pointsToWin % 10 !== 0)
      return res.status(400).json({ error: 'Le nombre de points doit être entre 50 et 100, par palier de 10.' });
    if (handSize !== 'all' && (!Number.isInteger(handSize) || handSize < 6 || handSize > 20))
      return res.status(400).json({ error: 'Le nombre de cartes par joueur doit être "Toutes" ou entre 6 et 20.' });
    const effectiveHandSize = mode === 'A' ? 'all' : handSize; // verrouillé sur "Toutes" en mode A

    let images = [];
    if (mode === 'B') {
      if (!req.file) return res.status(400).json({ error: 'Merci de sélectionner une archive ZIP de photos.' });

      // on repart d'un dossier propre pour ce salon à chaque nouvel import
      fs.rmSync(room.uploadDir, { recursive: true, force: true });
      fs.mkdirSync(room.uploadDir, { recursive: true });

      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      const imageExt = /\.(jpe?g|png|gif|webp)$/i;
      // Le niveau doit être écrit sur deux chiffres, zéro devant obligatoire (01 à 20).
      const nameLevelRegex = /^(.+?)\s*\((\d{2})\)\.[a-zA-Z0-9]+$/;

      for (const entry of entries) {
        const baseName = path.basename(entry.entryName);
        if (!imageExt.test(baseName)) continue;
        const match = baseName.match(nameLevelRegex);
        if (!match) continue;
        const name = match[1].trim();
        const level = parseInt(match[2], 10);
        if (!name || level < 1 || level > 20) continue;

        const ext = path.extname(baseName);
        const filepath = path.join(room.uploadDir, `${randomUUID()}${ext}`);
        fs.writeFileSync(filepath, entry.getData());
        images.push({ id: randomUUID(), name, level, filepath });
      }

      if (images.length < 42) {
        return res.status(400).json({
          error: `L'archive doit contenir au moins 42 images valides nommées "Nom (niveau).ext", niveau sur deux chiffres de 01 à 20 (${images.length} trouvée(s)).`
        });
      }

      if (effectiveHandSize !== 'all') {
        const maxPerPlayer = Math.floor(images.length / players.length);
        if (effectiveHandSize > maxPerPlayer) {
          return res.status(400).json({
            error: `Avec ${images.length} images importées et ${players.length} joueurs, vous pouvez distribuer au maximum ${maxPerPlayer} cartes par joueur.`
          });
        }
      }
    }

    savePlayers(room.code, players);

    if (room.aiTimer) {
      clearTimeout(room.aiTimer);
      room.aiTimer = null;
    }
    room.gameManager.configure({
      mode,
      players,
      theme,
      totalRounds,
      pointsToWin,
      handSize: effectiveHandSize,
      images,
      aiPlayers: aiPlayers.filter((p) => players.includes(p))
    });
    io.to(room.code).emit('state-updated');
    res.json({ ok: true, playerUrls: players.map((p, i) => `/${room.code}/joueur${i + 1}`) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
});

app.get('/api/:code/state', requireRoom, (req, res) => {
  const gm = req.room.gameManager;
  if (!gm.isConfigured()) return res.json({ configured: false });
  const state = gm.getPublicState();
  state.masterExtra = gm.getMasterTableExtra();
  res.json(state);
});

app.get('/api/:code/state/:playerIndex', requireRoom, (req, res) => {
  const gm = req.room.gameManager;
  if (!gm.isConfigured()) return res.json({ configured: false });
  const idx = parseInt(req.params.playerIndex, 10) - 1;
  const name = gm.config.players[idx];
  if (!name) return res.status(404).json({ error: 'Joueur inconnu.' });
  res.json({ ...gm.getPlayerState(name), yourName: name, yourIndex: idx + 1 });
});

app.post('/api/:code/toggle-ai', requireRoom, (req, res) => {
  try {
    const name = resolvePlayerName(req.room, req.body.playerIndex);
    req.room.gameManager.setAI(name, !!req.body.isAI);
    io.to(req.room.code).emit('state-updated');
    scheduleAI(req.room);
    res.json(req.room.gameManager.getPublicState());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/:code/start-round', requireRoom, (req, res) => {
  try {
    if (!req.room.gameManager.isConfigured()) return res.status(400).json({ error: 'Aucune partie configurée.' });
    const state = req.room.gameManager.startRound();
    io.to(req.room.code).emit('state-updated');
    scheduleAI(req.room);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/:code/new-game', requireRoom, (req, res) => {
  const room = req.room;
  if (room.aiTimer) {
    clearTimeout(room.aiTimer);
    room.aiTimer = null;
  }
  room.gameManager.reset();
  io.to(room.code).emit('state-updated');
  res.json({ ok: true });
});

app.post('/api/:code/action/play', requireRoom, (req, res) => {
  try {
    const name = resolvePlayerName(req.room, req.body.playerIndex);
    const state = req.room.gameManager.playCard(name, req.body.cardId);
    io.to(req.room.code).emit('state-updated');
    scheduleAI(req.room);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/:code/action/pass', requireRoom, (req, res) => {
  try {
    const name = resolvePlayerName(req.room, req.body.playerIndex);
    const state = req.room.gameManager.pass(name);
    io.to(req.room.code).emit('state-updated');
    scheduleAI(req.room);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/:code/action/end-trick', requireRoom, (req, res) => {
  try {
    const name = resolvePlayerName(req.room, req.body.playerIndex);
    const state = req.room.gameManager.endTrick(name);
    io.to(req.room.code).emit('state-updated');
    scheduleAI(req.room);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================================================================ temps réel
io.on('connection', (socket) => {
  socket.on('join-room', (code) => {
    const c = cleanCode(code);
    if (validCode(c)) socket.join(c);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur lancé : http://localhost:${PORT}`);
});
