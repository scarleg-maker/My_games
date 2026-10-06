const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { Server } = require('socket.io');

const PORT = 3500;
const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true });

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function stripExt(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}
function clearDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
}
function randomPick(arr, n) {
  const copy = [...arr];
  const picked = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}

// ================================================================ SALONS
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante :
// ses propres joueurs, ses propres photos, son propre état de jeu.
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'UPLOADS', 'STATIC', 'FAVICON', 'COMMON', 'MASTER', 'JOUEUR', 'ACCUEIL']);
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L (confusions)
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000; // un salon sans page ouverte depuis 12h est supprimé
const MAX_ROOMS = 300;

const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d+$/.test(c);

function roomDir(code) { return path.join(ROOMS_DIR, code); }
function roomUploadsDir(code) { return path.join(roomDir(code), 'uploads'); }
function roomPlayersFile(code) { return path.join(roomDir(code), 'players.json'); }
function ensureRoomDirs(code) {
  fs.mkdirSync(roomUploadsDir(code), { recursive: true });
  if (!fs.existsSync(roomPlayersFile(code))) fs.writeFileSync(roomPlayersFile(code), JSON.stringify({ names: [] }, null, 2));
}

function newUniqueCode() {
  for (let len = 4; ; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
      if (!rooms.has(c) && !fs.existsSync(roomDir(c)) && validCode(c)) return c;
    }
  }
}

// ---------- état de jeu d'un salon (logique identique aux modes A/B/C/D précédents) ----------
function freshState(code) {
  return {
    code,
    phase: 'setup', // setup | playing | elimination | finished
    mode: null,     // 'A' | 'B' | 'C' | 'D'
    theme: '',
    numDraws: 5,
    numRounds: 5,
    maxGifts: 2,
    players: [],
    images: [],
    pool: [],
    currentPlayerIndex: 0,
    winner: null,
    lastEvent: null,
    candidates: null,
    round: 0,
    roundPhase: 'ready',
    pendingDraws: {},
    decisions: {},
    decidedPlayers: [],
    trimNeeded: []
  };
}

function createRoom(code) {
  let state = freshState(code);
  let eventCounter = 0;
  let lastActivity = Date.now();

  function touch() { lastActivity = Date.now(); }
  function pushEvent(evt) {
    eventCounter += 1;
    state.lastEvent = { id: eventCounter, ...evt };
  }
  function broadcast() { io.to(code).emit('state', state); }
  function checkForWinner() {
    const remaining = state.players.filter(p => !p.eliminated);
    if (remaining.length === 1 && state.players.length > 1) {
      state.phase = 'finished';
      state.winner = remaining[0];
    }
  }

  function drawSingle({ playerIndex }) {
    if (state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player || player.eliminated) return;
    if (state.pool.length === 0) return;
    const [fileName] = randomPick(state.pool, 1);
    state.pool = state.pool.filter(f => f !== fileName);
    const img = state.images.find(i => i.file === fileName);
    player.team.push(img);
    pushEvent({ type: 'draw', playerIndex, image: img });
  }

  function drawAll() {
    if (state.phase !== 'playing') return;
    const active = state.players.map((p, idx) => ({ p, idx })).filter(x => !x.p.eliminated);
    const results = [];
    for (const { p, idx } of active) {
      if (state.pool.length === 0) break;
      const [fileName] = randomPick(state.pool, 1);
      state.pool = state.pool.filter(f => f !== fileName);
      const img = state.images.find(i => i.file === fileName);
      p.team.push(img);
      results.push({ playerIndex: idx, image: img });
    }
    pushEvent({ type: 'draw-all', results });
  }

  function drawCandidates({ playerIndex }) {
    if (state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player || player.eliminated) return;
    const files = randomPick(state.pool, Math.min(5, state.pool.length));
    const imgs = files.map(f => state.images.find(i => i.file === f));
    state.candidates = { playerIndex, images: imgs };
    pushEvent({ type: 'candidates', playerIndex, images: imgs });
  }

  function choiceConfirm({ playerIndex, file }) {
    if (state.phase !== 'playing') return;
    if (!state.candidates || state.candidates.playerIndex !== playerIndex) return;
    const player = state.players[playerIndex];
    const img = state.candidates.images.find(i => i.file === file);
    if (!player || !img) return;
    state.pool = state.pool.filter(f => f !== file);
    player.team.push(img);
    state.candidates = null;
    pushEvent({ type: 'choice-result', playerIndex, image: img });
  }

  function nextPlayer() {
    if (state.phase !== 'playing') return;
    let idx = state.currentPlayerIndex;
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const cand = (idx + i) % n;
      if (!state.players[cand].eliminated) {
        state.currentPlayerIndex = cand;
        break;
      }
    }
    state.candidates = null;
    pushEvent({ type: 'next-player', playerIndex: state.currentPlayerIndex });
  }

  function drawRoundD() {
    if (state.phase !== 'playing' || state.mode !== 'D') return;
    if (state.roundPhase !== 'ready') return;
    if (state.round >= state.numRounds) return;
    const active = state.players.map((p, idx) => ({ p, idx })).filter(x => !x.p.eliminated);
    const pending = {};
    for (const { idx } of active) {
      if (state.pool.length === 0) break;
      const [fileName] = randomPick(state.pool, 1);
      state.pool = state.pool.filter(f => f !== fileName);
      pending[idx] = state.images.find(i => i.file === fileName);
    }
    state.pendingDraws = pending;
    state.decisions = {};
    state.decidedPlayers = [];
    state.roundPhase = 'deciding';
    state.round += 1;
    pushEvent({ type: 'draw-round-d', pending });
  }

  function decision({ playerIndex, action, targetIndex }) {
    if (state.phase !== 'playing' || state.mode !== 'D' || state.roundPhase !== 'deciding') return;
    if (!(playerIndex in state.pendingDraws)) return;
    if (state.decisions[playerIndex]) return;

    if (action === 'give') {
      if (targetIndex === playerIndex) return;
      const target = state.players[targetIndex];
      const giver = state.players[playerIndex];
      if (!target || target.eliminated || !giver) return;
      if (giver.giftsUsed >= state.maxGifts) return;
      giver.giftsUsed += 1;
      state.decisions[playerIndex] = { action: 'give', targetIndex };
    } else if (action === 'keep') {
      state.decisions[playerIndex] = { action: 'keep', targetIndex: null };
    } else {
      return;
    }
    state.decidedPlayers.push(Number(playerIndex));

    const pendingIndexes = Object.keys(state.pendingDraws).map(Number);
    const allDecided = pendingIndexes.every(idx => state.decisions[idx] !== undefined);

    if (allDecided) {
      pendingIndexes.forEach(idx => {
        const dec = state.decisions[idx];
        const img = state.pendingDraws[idx];
        const recipientIdx = dec.action === 'give' ? dec.targetIndex : idx;
        state.players[recipientIdx].team.push(img);
      });
      state.pendingDraws = {};
      state.decisions = {};
      state.decidedPlayers = [];
      state.trimNeeded = state.players
        .map((p, i) => i)
        .filter(i => state.players[i].team.length > state.numDraws);

      if (state.trimNeeded.length > 0) {
        state.roundPhase = 'trimming';
      } else {
        state.roundPhase = 'ready';
        if (state.round >= state.numRounds) state.phase = 'elimination';
      }
      pushEvent({ type: 'round-resolved-d' });
    } else {
      pushEvent({ type: 'decision-made-d', playerIndex });
    }
  }

  function trimImage({ playerIndex, file }) {
    if (state.roundPhase !== 'trimming') return;
    if (!state.trimNeeded.includes(playerIndex)) return;
    const player = state.players[playerIndex];
    if (!player) return;
    const idx = player.team.findIndex(i => i.file === file);
    if (idx === -1) return;
    player.team.splice(idx, 1);
    if (player.team.length <= state.numDraws) {
      state.trimNeeded = state.trimNeeded.filter(i => i !== playerIndex);
    }
    if (state.trimNeeded.length === 0) {
      state.roundPhase = 'ready';
      if (state.round >= state.numRounds) state.phase = 'elimination';
    }
    pushEvent({ type: 'trim-d', playerIndex });
  }

  function goToElimination() {
    state.phase = 'elimination';
    pushEvent({ type: 'elimination-start' });
  }

  function eliminatePlayer({ playerIndex }) {
    if (state.phase !== 'elimination' && state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player) return;
    player.eliminated = true;
    pushEvent({ type: 'eliminated', playerIndex });
    checkForWinner();
  }

  function resetGame() {
    state = freshState(code);
    pushEvent({ type: 'reset' });
  }

  function startGame({ mode, players, theme, numDraws, numRounds, maxGifts }) {
    state = freshState(code);
    state.mode = mode;
    state.theme = theme || '';
    state.numDraws = numDraws;
    state.numRounds = numRounds;
    state.maxGifts = maxGifts;
    const files = fs.readdirSync(roomUploadsDir(code)).filter(f => IMAGE_EXT.includes(path.extname(f).toLowerCase()));
    state.images = files.map(f => ({ file: f, url: `/uploads/${code}/${encodeURIComponent(f)}`, name: stripExt(f) }));
    state.pool = state.images.map(i => i.file);
    state.players = players.map(name => ({ name, eliminated: false, team: [], giftsUsed: 0 }));
    state.phase = 'playing';
    state.currentPlayerIndex = 0;
  }

  return {
    code,
    get state() { return state; },
    touch,
    idleMs: () => Date.now() - lastActivity,
    broadcast,
    startGame,
    setUploadedImages(images) { state.images = images; },
    socketCount: () => (io.sockets.adapter.rooms.get(code) || new Set()).size,
    destroy() { /* rien à nettoyer en mémoire au-delà du retrait du registre */ },
    actions: {
      'draw-single': drawSingle, 'draw-all': drawAll, 'draw-candidates': drawCandidates,
      'choice-confirm': choiceConfirm, 'next-player': nextPlayer, 'go-to-elimination': goToElimination,
      'eliminate-player': eliminatePlayer, 'reset-game': resetGame,
      'draw-round-d': drawRoundD, decision, 'trim-image': trimImage
    }
  };
}

// ---------- registre des salons ----------
const rooms = new Map(); // code -> room

function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  if (rooms.size >= MAX_ROOMS) purgeIdleRooms(true);
  ensureRoomDirs(code);
  const room = createRoom(code);
  rooms.set(code, room);
  return room;
}
function purgeIdleRooms(force) {
  for (const [code, room] of rooms) {
    if (room.socketCount() === 0 && (force || room.idleMs() > ROOM_IDLE_MS)) {
      room.destroy();
      rooms.delete(code);
    }
  }
}
setInterval(() => purgeIdleRooms(false), 15 * 60 * 1000);

// ================================================================ ROUTES API

app.post('/api/rooms', (req, res) => {
  const requested = req.body && req.body.code ? cleanCode(req.body.code) : null;
  const code = requested || newUniqueCode();
  if (!validCode(code)) return res.status(400).json({ error: 'Code invalide : 3 à 10 lettres ou chiffres' });
  if (rooms.has(code)) return res.status(400).json({ error: `Le salon ${code} est déjà utilisé. Choisissez un autre code.` });
  getRoom(code, true);
  res.json({ ok: true, code });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.json({ exists: false });
  const room = getRoom(code, false);
  if (room) {
    const s = room.state;
    return res.json({ exists: true, phase: s.phase, mode: s.mode, players: s.players.map(p => ({ name: p.name, eliminated: p.eliminated })) });
  }
  if (fs.existsSync(roomDir(code))) return res.json({ exists: true, phase: 'setup', mode: null, players: [] });
  res.json({ exists: false });
});

app.get('/api/rooms/:code/players', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide' });
  ensureRoomDirs(code);
  const data = JSON.parse(fs.readFileSync(roomPlayersFile(code), 'utf-8'));
  res.json(data);
});

app.post('/api/rooms/:code/players', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide' });
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names doit être un tableau' });
  ensureRoomDirs(code);
  fs.writeFileSync(roomPlayersFile(code), JSON.stringify({ names }, null, 2));
  res.json({ ok: true });
});

// Toile cible de redimensionnement : ratio 3:4, identique à toutes les vignettes côté client.
const CANVAS_W = 500;
const CANVAS_H = 667;
const JPEG_QUALITY = 85;
const PAD_COLOR = { r: 238, g: 238, b: 238, alpha: 1 };

app.post('/api/rooms/:code/upload-zip', upload.single('zipfile'), async (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide' });
  const room = getRoom(code, true);
  room.touch();
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const uploadsDir = roomUploadsDir(code);
    clearDir(uploadsDir);
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const images = [];
    let skipped = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const base = path.basename(entry.entryName);
      const ext = path.extname(base).toLowerCase();
      if (!IMAGE_EXT.includes(ext)) continue;

      let outputBuffer, outExt;
      try {
        const img = sharp(entry.getData()).rotate();
        const meta = await img.metadata();
        const hasAlpha = !!meta.hasAlpha;
        const resized = img.resize({
          width: CANVAS_W, height: CANVAS_H, fit: 'contain', withoutEnlargement: true,
          background: hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : PAD_COLOR
        });
        if (hasAlpha) { outExt = '.png'; outputBuffer = await resized.png({ compressionLevel: 9 }).toBuffer(); }
        else { outExt = '.jpg'; outputBuffer = await resized.jpeg({ quality: JPEG_QUALITY }).toBuffer(); }
      } catch (imgErr) {
        console.error(`Image ignorée (illisible) : ${base} — ${imgErr.message}`);
        skipped++;
        continue;
      }

      let finalName = `${stripExt(base)}${outExt}`;
      let counter = 1;
      while (fs.existsSync(path.join(uploadsDir, finalName))) {
        finalName = `${stripExt(base)}_${counter}${outExt}`;
        counter++;
      }
      fs.writeFileSync(path.join(uploadsDir, finalName), outputBuffer);
      images.push({ file: finalName, url: `/uploads/${code}/${encodeURIComponent(finalName)}`, name: stripExt(finalName) });
    }
    room.setUploadedImages(images);
    res.json({ ok: true, count: images.length, images, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du zip : ' + err.message });
  }
});

app.post('/api/rooms/:code/start-game', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide' });
  const room = getRoom(code, true);
  room.touch();

  const { mode, players, theme, numDraws, numRounds, maxGifts } = req.body;
  if (!['A', 'B', 'C', 'D'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
  if (!Array.isArray(players) || players.length < 2) return res.status(400).json({ error: 'Il faut au moins 2 joueurs' });
  const uploadsDir = roomUploadsDir(code);
  const existingImages = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter(f => IMAGE_EXT.includes(path.extname(f).toLowerCase())) : [];
  if (existingImages.length === 0) return res.status(400).json({ error: 'Aucune image chargée' });
  const nd = parseInt(numDraws, 10);
  if (isNaN(nd) || nd < 3 || nd > 10) return res.status(400).json({ error: 'Nombre de tirages invalide (3 à 10)' });

  let nr = nd, mg = 2;
  if (mode === 'D') {
    nr = parseInt(numRounds, 10);
    if (isNaN(nr) || nr < 1 || nr > 30) return res.status(400).json({ error: 'Nombre de tours invalide (1 à 30)' });
    mg = parseInt(maxGifts, 10);
    if (isNaN(mg) || mg < 1 || mg > 5) return res.status(400).json({ error: 'Nombre de dons possible invalide (1 à 5)' });
  }

  ensureRoomDirs(code);
  fs.writeFileSync(roomPlayersFile(code), JSON.stringify({ names: players }, null, 2));

  room.startGame({ mode, players, theme, numDraws: nd, numRounds: nr, maxGifts: mg });
  const playerUrls = players.map((name, i) => `/${code}/joueur${i + 1}`);
  room.broadcast();
  res.json({ ok: true, code, playerUrls });
});

// Photos redimensionnées du salon
app.get(/^\/uploads\/([A-Za-z0-9]{3,10})\/(.+)$/, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(400).end();
  const filename = path.basename(req.params[1]);
  const filePath = path.join(roomUploadsDir(code), filename);
  res.sendFile(filePath, err => { if (err) res.status(404).end(); });
});

// ================================================================ PAGES

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'accueil.html'));
});

app.get(/^\/([A-Za-z0-9]{3,10})$/, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon introuvable.');
  getRoom(code, true);
  res.sendFile(path.join(PUBLIC_DIR, 'master.html'));
});

app.get(/^\/([A-Za-z0-9]{3,10})\/joueur(\d+)$/, (req, res) => {
  const code = cleanCode(req.params[0]);
  if (!validCode(code)) return res.status(404).send('Salon introuvable.');
  res.sendFile(path.join(PUBLIC_DIR, 'joueur.html'));
});

// ================================================================ SOCKET.IO

io.on('connection', (socket) => {
  const code = cleanCode(socket.handshake.query.room);
  const room = validCode(code) ? getRoom(code, false) : null;
  if (!room) {
    socket.emit('room-not-found');
    socket.disconnect(true);
    return;
  }
  socket.join(code);
  room.touch();
  socket.emit('state', room.state);

  for (const [name, fn] of Object.entries(room.actions)) {
    socket.on(name, (payload) => {
      room.touch();
      fn(payload || {});
      room.broadcast();
    });
  }

  socket.on('disconnect', () => { room.touch(); });
});

server.listen(PORT, () => {
  console.log(`Serveur lancé : http://localhost:${PORT}`);
});
