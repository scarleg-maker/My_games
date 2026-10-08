// Jeu de la Bombe — serveur multi-salons (Node.js)
// Lancement : npm start  →  http://localhost:8000
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante :
// ses joueurs, ses images, son plateau, ses réglages.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const AdmZip = require('adm-zip');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'salons.json');
const IMAGES_ROOT = path.join(__dirname, 'images_pool');     // images_pool/<CODE>/...
const UPLOAD_TMP_DIR = path.join(__dirname, 'uploads_tmp');
const ARCHIVES_DIR = path.join(__dirname, 'archives');         // ZIP d'images livrés avec le jeu (proposés à l'arbitre)
const IMG_RE = /\.(png|jpe?g|gif|webp)$/i;
const MAX_PLAYERS = 8;

for (const d of [DATA_DIR, IMAGES_ROOT, UPLOAD_TMP_DIR, ARCHIVES_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

app.use(express.json({ limit: '100kb' }));
app.use('/static', express.static(PUBLIC_DIR));
app.use('/images_pool', express.static(IMAGES_ROOT));

// ================================================================ utilitaires
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function computeGrid(n) {
  const cols = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / cols), cols };
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}
const imagesDir = code => path.join(IMAGES_ROOT, code);
function listImages(code) {
  try { return fs.readdirSync(imagesDir(code)).filter(f => IMG_RE.test(f)); } catch { return []; }
}
// archives livrées avec le jeu : archives/*.zip, avec le nombre d'images de chacune (mis en cache selon la date du fichier)
const archiveCache = new Map();
function listArchives() {
  let files = [];
  try { files = fs.readdirSync(ARCHIVES_DIR).filter(f => /\.zip$/i.test(f)).sort((a, b) => a.localeCompare(b, 'fr')); } catch { }
  return files.map(f => {
    const full = path.join(ARCHIVES_DIR, f);
    let st; try { st = fs.statSync(full); } catch { return null; }
    const c = archiveCache.get(f);
    if (c && c.mt === st.mtimeMs) return c.info;
    let info;
    try {
      const n = new AdmZip(full).getEntries().filter(e => !e.isDirectory && IMG_RE.test(e.entryName) && !/(^|\/)__MACOSX\//.test(e.entryName)).length;
      info = { file: f, nom: f.replace(/\.zip$/i, ''), count: n, ok: n > 0 };
    } catch { info = { file: f, nom: f.replace(/\.zip$/i, ''), count: 0, ok: false }; }
    archiveCache.set(f, { mt: st.mtimeMs, info });
    return info;
  }).filter(Boolean);
}
function removeImagesDir(code) {
  try { fs.rmSync(imagesDir(code), { recursive: true, force: true }); } catch { }
}

// ================================================================ sauvegarde par salon
// data/salons.json : réglages et noms des joueurs de chaque code de salon (les 100 plus récents)
const MAX_SAVED = 100;
const rooms = new Map();                 // code → salon en mémoire
let savedRooms = {};
try {
  const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  savedRooms = d && d.rooms && typeof d.rooms === 'object' ? d.rooms : {};
} catch { }
let saveTimer = null;
function saveRoom(code, data) {
  savedRooms[code] = { ...(savedRooms[code] || {}), ...data, t: Date.now() };
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(MAX_SAVED)) {
    delete savedRooms[k];
    if (!rooms.has(k)) removeImagesDir(k);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: savedRooms }, null, 1), () => { }), 300);
}

// ================================================================ salons
function createRoom(code, saved) {
  fs.mkdirSync(imagesDir(code), { recursive: true });

  let game = null;                       // null tant qu'aucune partie n'est lancée
  const clients = new Map();             // socket.id → { role, index }
  let lastActivity = Date.now();
  let destroyed = false;
  const touch = () => { lastActivity = Date.now(); };
  const sock = suffix => `${code}:${suffix}`;
  const isOnline = i => [...clients.values()].some(c => c.role === 'player' && c.index === i);

  // ---------------------------------------------------------------- logique de jeu
  function buildBoardFromImages(imageFiles) {
    return shuffle(imageFiles).map(filename => ({
      filename,
      bombs: [],            // index des joueurs ayant posé une bombe ici
      taken: false,
      takenBy: null,
      isBomb: false,
    }));
  }

  function startNewRound() {
    game.players.forEach(p => {
      if (p.eliminated) return;
      p.ready = false;
      p.bombsRemaining = game.config.numBombs;
      p.myBombs = [];
      p.drawnCards = [];
      p.complete = false;
    });
    game.board = buildBoardFromImages(game.imageSet);
    game.phase = 'placement';
    game.drawOrder = [];
    game.currentTurnIndex = 0;
    game.roundNumber += 1;
    game.lastReveal = null;
    game.turnLocked = false;
  }

  const allActivePlayers = () => game.players.filter(p => !p.eliminated);

  function checkAllValidated() {
    const active = allActivePlayers();
    if (active.length > 0 && active.every(p => p.ready)) {
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
      const player = game.players[game.drawOrder[idx]];
      if (!player.complete && !player.eliminated) return idx;
    }
    return -1;
  }

  function checkRoundEnd() {
    const active = allActivePlayers();
    const allComplete = active.length > 0 && active.every(p => p.complete);
    if (!game.board.some(c => !c.taken) || allComplete) game.phase = 'roundEnd';
  }

  function checkGameOverByElimination() {
    const active = allActivePlayers();
    if (active.length <= 1) {
      game.phase = 'gameEnd';
      game.winner = active.length === 1 ? active[0].name : null;
    }
  }

  function drawCard(playerIdx, imgIndex) {
    if (!game || game.phase !== 'draw' || game.turnLocked) return;
    const turnIdx = nextAvailableTurnIndex(game.currentTurnIndex);
    if (turnIdx === -1) { checkRoundEnd(); broadcastState(); return; }
    if (game.drawOrder[turnIdx] !== playerIdx) return; // pas son tour
    const img = game.board[imgIndex];
    if (!img || img.taken) return;

    img.taken = true;
    img.takenBy = playerIdx;
    const bombCount = img.bombs.length;
    const isBomb = bombCount > 0;
    img.isBomb = isBomb;

    const player = game.players[playerIdx];
    player.drawnCards.push({ imgIndex, filename: img.filename, lost: isBomb });

    let eliminatedNow = false;
    if (isBomb) {
      const multiboomActive = !!game.config.multiboom && bombCount >= 2;
      // le tirage compte déjà comme 1 perte ; on retire en plus les cartes saines
      // précédentes les plus récentes : 1 en mode normal, (bombCount - 1) en multi-boom
      const additionalLosses = multiboomActive ? (bombCount - 1) : 1;
      let removed = 0;
      for (let i = player.drawnCards.length - 2; i >= 0 && removed < additionalLosses; i--) {
        if (!player.drawnCards[i].lost) { player.drawnCards[i].lost = true; removed++; }
      }
      if (multiboomActive && player.drawnCards.filter(c => !c.lost).length === 0) {
        player.eliminated = true;
        eliminatedNow = true;
      }
    }

    const safeCount = player.drawnCards.filter(c => !c.lost).length;
    const justCompleted = safeCount >= game.config.maxCards && !player.complete;
    if (justCompleted) player.complete = true;

    // annonce visible par tout le monde pendant 2 s avant de résoudre le tour suivant
    game.lastReveal = { playerIndex: playerIdx, playerName: player.name, filename: img.filename, isBomb, bombCount };
    game.turnLocked = true;
    broadcastState();

    const g = game;
    setTimeout(() => {
      if (destroyed || game !== g) return;   // salon fermé ou partie réinitialisée entre temps
      game.turnLocked = false;
      game.lastReveal = null;

      if (game.config.intouchable && justCompleted) {
        game.phase = 'gameEnd';
        game.winner = player.name;
        return broadcastState();
      }
      if (eliminatedNow) {
        checkGameOverByElimination();
        if (game.phase === 'gameEnd') return broadcastState();
      }
      const nt = nextAvailableTurnIndex(turnIdx + 1);
      game.currentTurnIndex = nt === -1 ? turnIdx : nt;
      checkRoundEnd();
      broadcastState();
    }, 2000);
  }

  function toggleBomb(playerIdx, imgIndex) {
    if (!game || game.phase !== 'placement') return;
    const player = game.players[playerIdx];
    if (!player || player.ready || player.eliminated) return;
    const img = game.board[imgIndex];
    if (!img) return;
    if (img.bombs.includes(playerIdx)) {
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

  // ---------------------------------------------------------------- état envoyé aux clients
  function safeBoardForRole(role, playerIndex) {
    return game.board.map((c, idx) => {
      const base = { idx, filename: c.filename, taken: c.taken, takenBy: c.takenBy };
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
    return {
      started: true,
      room: code,
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
        online: isOnline(p.index),
        bombsRemaining: p.bombsRemaining,
        myBombs: role === 'master' || p.index === playerIndex ? p.myBombs : undefined,
        drawnCards: p.drawnCards,
        complete: p.complete,
        safeCount: p.drawnCards.filter(c => !c.lost).length,
      })),
      board: safeBoardForRole(role, playerIndex),
      drawOrder: game.drawOrder,
      currentPlayer: currentTurnIdx !== -1 ? game.drawOrder[currentTurnIdx] : null,
      winner: game.winner || null,
      lastReveal: game.lastReveal || null,
      turnLocked: !!game.turnLocked,
    };
  }

  function broadcastState() {
    if (!game || destroyed) return;
    io.to(sock('master')).emit('state', buildState('master'));
    game.players.forEach(p => io.to(sock('p' + p.index)).emit('state', buildState('player', p.index)));
  }

  // ---------------------------------------------------------------- actions (appelées par les sockets / l'API)
  function startGame(body) {
    touch();
    if (game && game.phase !== 'gameEnd') return { error: 'Une partie est déjà en cours dans ce salon' };
    const { names, numImages, maxCards, numBombs, intouchable, multiboom } = body || {};
    if (!Array.isArray(names) || names.length < 2 || names.length > MAX_PLAYERS)
      return { error: 'Nombre de joueurs invalide (2 à 8)' };
    const cleanNames = names.map((n, i) => String(n ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20) || `Joueur ${i + 1}`);
    const nImg = parseInt(numImages, 10), mCards = parseInt(maxCards, 10), nBombs = parseInt(numBombs, 10);
    if (!(nImg >= 20 && nImg <= 75)) return { error: "Nombre d'images invalide (20 à 75)" };
    if (!(mCards >= 5 && mCards <= 10)) return { error: 'Cartes max par joueur invalide (5 à 10)' };
    if (!(nBombs >= 1 && nBombs <= 10)) return { error: 'Nombre de bombes invalide (1 à 10)' };

    const files = listImages(code);
    if (files.length < nImg)
      return { error: `Seulement ${files.length} image(s) disponible(s) dans ce salon, il en faut au moins ${nImg}. Chargez une archive ZIP.` };

    const { rows, cols } = computeGrid(nImg);
    game = {
      config: {
        numPlayers: cleanNames.length, numImages: nImg, maxCards: mCards, numBombs: nBombs,
        intouchable: !!intouchable, multiboom: !!multiboom,
      },
      players: cleanNames.map((name, i) => ({
        index: i, name, eliminated: false, ready: false,
        bombsRemaining: nBombs, myBombs: [], drawnCards: [], complete: false,
      })),
      imageSet: shuffle(files).slice(0, nImg),
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
    startNewRound();

    // mémorisation des noms et réglages de CE salon
    const prev = savedRooms[code] || {};
    const all = Array.isArray(prev.allNamesEver) ? prev.allNamesEver.slice() : [];
    cleanNames.forEach(n => { if (!all.includes(n)) all.push(n); });
    saveRoom(code, {
      lastNames: cleanNames, allNamesEver: all.slice(-100),
      numImages: nImg, maxCards: mCards, numBombs: nBombs, intouchable: !!intouchable, multiboom: !!multiboom,
    });
    broadcastState();
    return { ok: true };
  }

  function importZip(filePath, archiveName) {
    touch();
    if (game && game.phase !== 'gameEnd') throw new Error('Une partie est en cours dans ce salon : impossible de changer les images');
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter(e => !e.isDirectory && IMG_RE.test(e.entryName) && !/(^|\/)__MACOSX\//.test(e.entryName)).slice(0, 500);
    const dir = imagesDir(code);
    for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch { } }
    for (const e of entries) {
      const base = path.basename(e.entryName).replace(/[^a-zA-Z0-9._-]/g, '_');
      let dest = path.join(dir, base), counter = 1;
      while (fs.existsSync(dest)) {
        const ext = path.extname(base);
        dest = path.join(dir, `${path.basename(base, ext)}_${counter++}${ext}`);
      }
      fs.writeFileSync(dest, e.getData());
    }
    saveRoom(code, { archive: archiveName || null });
    return listImages(code).length;
  }

  const actions = {
    toggleBomb(i, imgIndex) { toggleBomb(i, imgIndex); broadcastState(); },
    validatePlacement(i) {
      const p = game && game.phase === 'placement' && game.players[i];
      if (p && !p.eliminated && p.bombsRemaining === 0) { p.ready = true; checkAllValidated(); broadcastState(); }
    },
    unvalidatePlacement(i) {
      const p = game && game.phase === 'placement' && game.players[i];
      if (p) { p.ready = false; broadcastState(); }
    },
    drawCard(i, imgIndex) { drawCard(i, imgIndex); },
    eliminatePlayer(i) {
      const p = game && game.players[i];
      if (!p) return;
      p.eliminated = true;
      checkGameOverByElimination();
      broadcastState();
    },
    restorePlayer(i) {
      const p = game && game.players[i];
      if (p && game.phase !== 'gameEnd') { p.eliminated = false; broadcastState(); }
    },
    newRound() {
      if (!game || game.phase !== 'roundEnd' || allActivePlayers().length < 1) return;
      startNewRound();
      broadcastState();
    },
    resetGame() {
      game = null;
      io.to(sock('all')).emit('state', { started: false });
    },
  };
  function act(name, ...args) { touch(); if (game || name === 'resetGame') actions[name](...args); }

  // ---------------------------------------------------------------- connexions temps réel
  function join(socket, role, index) {
    clients.set(socket.id, { role, index });
    touch();
    socket.join(sock('all'));
    if (role === 'master') {
      socket.join(sock('master'));
      socket.emit('state', buildState('master'));
    } else {
      socket.join(sock('p' + index));
      socket.emit('state', buildState('player', index));
      if (game) io.to(sock('master')).emit('state', buildState('master')); // pastille « connecté »
    }
  }
  function leave(socket) {
    const c = clients.get(socket.id);
    clients.delete(socket.id);
    touch();
    if (c && c.role === 'player' && game) io.to(sock('master')).emit('state', buildState('master'));
  }

  function info() {
    return {
      exists: true, code, started: !!game, phase: game ? game.phase : null, roundNumber: game ? game.roundNumber : 0,
      seats: game ? game.players.map(p => ({ index: p.index, name: p.name, eliminated: p.eliminated, online: isOnline(p.index) })) : [],
      imageCount: listImages(code).length,
    };
  }
  function destroy() { destroyed = true; game = null; }

  return {
    code, join, leave, act, startGame, importZip, info, destroy,
    clientCount: () => clients.size,
    inProgress: () => !!game && game.phase !== 'gameEnd',
    idle: () => Date.now() - lastActivity,
  };
}

// ================================================================ registre des salons
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'IMAGES', 'JOUEUR', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'FAVICON', 'SOCKET']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sans 0/O, 1/I/L pour éviter les confusions
const ROOM_IDLE_MS = 6 * 3600 * 1000;                 // salon sans page ouverte depuis 6 h : libéré de la mémoire
const MAX_ROOMS = 300;

const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d+$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !savedRooms[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms)
    if (r.clientCount() === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000).unref();
// un salon connu du fichier de sauvegarde est recréé à la demande (après un redémarrage du serveur)
function getRoom(code, create) {
  if (!validCode(code)) return null;
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  if (rooms.size >= MAX_ROOMS) return null;
  const r = createRoom(code, savedRooms[code] || null);
  rooms.set(code, r);
  if (!savedRooms[code]) saveRoom(code, {});
  return r;
}

// ================================================================ HTTP
const page = name => (req, res) => res.sendFile(path.join(PUBLIC_DIR, name));

app.get('/', page('accueil.html'));
app.get('/favicon.ico', (req, res) => res.status(204).end());
// anciennes adresses sans salon (/joueur1) → accueil
app.get(/^\/joueur\d+\/?$/i, (req, res) => res.redirect('/'));

app.get('/api/qr.svg', async (req, res) => {
  const text = String(req.query.text || '');
  if (!/^https?:\/\//i.test(text) || text.length > 300) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1a0a00', light: '#fff4e6' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch { res.status(500).end(); }
});

app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const r = getRoom(code, false);
  res.set('Cache-Control', 'no-store');
  res.json(r ? r.info() : { exists: false, code });
});

app.get('/api/rooms/:code/init-data', (req, res) => {
  const code = cleanCode(req.params.code);
  const r = getRoom(code, false);
  if (!r) return res.status(404).json({ error: "Ce salon n'existe pas" });
  const s = savedRooms[code] || {};
  res.set('Cache-Control', 'no-store');
  res.json({
    code,
    lastNames: s.lastNames || [], allNamesEver: s.allNamesEver || [],
    settings: {
      numImages: s.numImages, maxCards: s.maxCards, numBombs: s.numBombs,
      intouchable: !!s.intouchable, multiboom: !!s.multiboom,
    },
    imageCount: listImages(code).length,
    archive: s.archive || null,
    lanUrls: lanUrls(),
  });
});

app.post('/api/rooms', (req, res) => {
  const a = req.body || {};
  const code = a.code ? cleanCode(a.code) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
  if (rooms.has(code) && !a.reuse) return res.json({ ok: false, error: `Le salon ${code} est déjà en cours d'utilisation` });
  if (!getRoom(code, true)) return res.json({ ok: false, error: 'Trop de salons ouverts, réessayez plus tard' });
  res.json({ ok: true, code });
});

const upload = multer({ dest: UPLOAD_TMP_DIR, limits: { fileSize: 500 * 1024 * 1024 } });
app.post('/api/rooms/:code/upload-zip', (req, res) => {
  const r = getRoom(cleanCode(req.params.code), false);
  if (!r) return res.status(404).json({ error: "Ce salon n'existe pas" });
  upload.single('zipfile')(req, res, err => {
    if (err) return res.status(400).json({ error: "Échec de l'envoi : " + err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    try {
      res.json({ ok: true, count: r.importZip(req.file.path) });
    } catch (e) {
      res.status(400).json({ error: e.message.startsWith('Une partie') ? e.message : 'Erreur lors du dézippage : ' + e.message });
    } finally {
      fs.unlink(req.file.path, () => { });
    }
  });
});

// utiliser une archive livrée avec le jeu (dossier archives/) : aucun envoi nécessaire
app.get('/api/archives', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ archives: listArchives() });
});
app.post('/api/rooms/:code/use-archive', (req, res) => {
  const r = getRoom(cleanCode(req.params.code), false);
  if (!r) return res.status(404).json({ error: "Ce salon n'existe pas" });
  const name = path.basename(String((req.body || {}).file || ''));   // basename : pas de remontée de dossier
  const a = listArchives().find(x => x.file === name);
  if (!a) return res.status(404).json({ error: "Cette archive n'existe pas" });
  if (!a.ok) return res.status(400).json({ error: "Cette archive ne contient aucune image" });
  try {
    res.json({ ok: true, count: r.importZip(path.join(ARCHIVES_DIR, a.file), a.file), nom: a.nom });
  } catch (e) {
    res.status(400).json({ error: e.message.startsWith('Une partie') ? e.message : 'Erreur lors du dézippage : ' + e.message });
  }
});

app.post('/api/rooms/:code/start-game', (req, res) => {
  const r = getRoom(cleanCode(req.params.code), false);
  if (!r) return res.status(404).json({ error: "Ce salon n'existe pas" });
  try {
    const out = r.startGame(req.body);
    if (out.error) return res.status(400).json(out);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur au démarrage : ' + e.message });
  }
});

// pages d'un salon : /CODE (arbitre), /CODE/joueurN, /CODE/rejoindre (cible du QR code)
const roomPage = (file, re) => app.get(re, (req, res, next) =>
  validCode(cleanCode(req.params[0])) ? res.sendFile(path.join(PUBLIC_DIR, file)) : next());
roomPage('joueur.html', /^\/([A-Za-z0-9]{3,10})\/joueur[1-8]\/?$/);
roomPage('accueil.html', /^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/);
roomPage('maitre.html', /^\/([A-Za-z0-9]{3,10})\/?$/);

// ================================================================ Socket.IO
const roomOf = s => (s.data && s.data.room ? rooms.get(s.data.room) : null);
const isInt = n => Number.isInteger(n);

io.on('connection', socket => {
  socket.on('register', (msg = {}) => {
    const code = cleanCode(msg.room);
    const r = getRoom(code, false);
    if (!r) return socket.emit('noroom');
    const role = msg.role === 'master' ? 'master' : 'player';
    const index = Number(msg.index);
    if (role === 'player' && !(isInt(index) && index >= 0 && index < MAX_PLAYERS)) return;
    const prev = roomOf(socket);
    if (prev) prev.leave(socket);
    socket.data = { room: code, role, index: role === 'player' ? index : null };
    r.join(socket, role, index);
  });
  socket.on('disconnect', () => { const r = roomOf(socket); if (r) r.leave(socket); });

  // actions d'un joueur : l'index vient de la connexion (un joueur ne peut pas jouer pour un autre)
  const asPlayer = (name, withImg) => socket.on(name, (msg = {}) => {
    const r = roomOf(socket);
    if (!r || socket.data.role !== 'player') return;
    if (withImg) { if (isInt(msg.imgIndex)) r.act(name, socket.data.index, msg.imgIndex); }
    else r.act(name, socket.data.index);
  });
  asPlayer('toggleBomb', true);
  asPlayer('drawCard', true);
  asPlayer('validatePlacement', false);
  asPlayer('unvalidatePlacement', false);

  // actions de l'arbitre
  const asMaster = (name, withIndex) => socket.on(name, (msg = {}) => {
    const r = roomOf(socket);
    if (!r || socket.data.role !== 'master') return;
    if (withIndex) { if (isInt(msg.index)) r.act(name, msg.index); }
    else r.act(name);
  });
  asMaster('eliminatePlayer', true);
  asMaster('restorePlayer', true);
  asMaster('newRound', false);
  asMaster('resetGame', false);
});

server.listen(PORT, () => {
  console.log(`\n  Jeu de la Bombe lancé !`);
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
